// dsh-WallpaperAndCost — host half.
//
// Merged plugin: the DeepSeek balance & usage backend (from dsh-balance-widget)
// plus the wallpaper feature (dsh-wallpaper, which needs no host behavior —
// everything it does lives in the browser half).
//
// The balance half registers two exact HTTP routes on the dsh web server:
//
//   GET /api/deepseek-balance         — balance + today's consumption
//   GET /api/deepseek-session-cost    — one session's token usage / estimated cost
//
// The DeepSeek API key never leaves the host: the browser only talks to these
// two routes, and keys are resolved per request through the `ctx.credentials`
// service (the same `DEEPSEEK_API_KEY` reference the llm-deepseek adapter and
// the Models page use).
//
// Deliberately imports nothing outside node builtins: `fetch` is a global, and
// `ctx.credentials` / `ctx.webServer` / `ctx.sessionPersistence` are services
// resolved through the plugin's `inject` list, so this file needs no
// @deepseek-ai/* imports and therefore no extra npm dependencies.
//
// 今日已消费 (today's consumption) has two sources:
//   1. official — optional `DEEPSEEK_PLATFORM_TOKEN` credential (set in
//      设置 → 模型; it is the same value platform.deepseek.com keeps in its own
//      browser storage): queries the platform dashboard cost API
//      (`platform.deepseek.com/api/v0/usage/cost`) and picks today's row. This
//      is the same data the usage page shows.
//   2. estimate — fallback: meters the balance, persisting the first balance
//      of the local calendar day under $DSH_HOME/storages and reporting
//      max(0, opening − current).
//
// Session cost is priced per assistant/message event with the official DeepSeek
// CNY price table (see PRICE_RULES; source: api-docs.deepseek.com pricing page,
// the peak/valley rates effective since 2026-08-17, applied to all messages)
// plus the peak/valley window the Beijing hour falls in. Each event is also
// recorded into per-model buckets and peak/valley window buckets, so model
// switches and window transitions stay attributable, and an optional
// $DSH_HOME/dsh-balance-widget-prices.json override file re-prices history
// without code edits.

import { mkdirSync, readFileSync, writeFileSync, renameSync, statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, sep, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";

export const name = "dsh-WallpaperAndCost";

/** Services this plugin needs before its apply runs. */
export const inject = ["credentials", "webServer"];

/** Public DeepSeek API base. */
const PUBLIC_BASE_URL = "https://api.deepseek.com";
/** Environment override honored for parity with the llm-deepseek adapter. */
const BASE_URL_ENV = "DEEPSEEK_BASE_URL";
const BALANCE_PATH = "/user/balance";

/** Platform dashboard cost API (best-effort; requires the platform userToken). */
const PLATFORM_USAGE_URL = "https://platform.deepseek.com/api/v0/usage/cost";

/** Exact web routes this plugin owns. */
export const BALANCE_ROUTE = "/api/deepseek-balance";
export const SESSION_COST_ROUTE = "/api/deepseek-session-cost";
export const WORKSHOP_EXTRACT_ROUTE = "/api/wallpaper-workshop/extract";
export const WORKSHOP_FILE_ROUTE = "/api/wallpaper-workshop/file";

const TIMEOUT_MS = 15000;
const DAY_STATE_FILE = "deepseek-balance-widget-day.json";

/**
 * DeepSeek 官方价格表（单一时代，直接以 CNY/百万 tokens 计价，与官方账单币种一致，
 * 无汇率换算层）。权威来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *
 * flash 系列已合并为单一模型，官方 API 的模型名现在是 `deepseek-flash`；OpenCode Go
 * 路由仍在用旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`，因此三者
 * 共享同一份 flash 价格（表内实际价格不变）：
 *   - deepseek-flash（含 v4-flash、v4-flash-vision-exp 别名）：高峰 ¥2.0 输入(缓存未命中)
 *     / ¥0.04 缓存命中 / ¥8.0 输出；空闲时段为高峰的一半（¥1.0 / ¥0.02 / ¥4.0）；
 *     vision 模型的图片按输入 token 计费。
 *   - deepseek-v4-pro：高峰 ¥9.0 / ¥0.30 / ¥27.0；空闲 ¥4.5 / ¥0.15 / ¥13.5。
 * 高峰时段（北京时）为 09:00–12:00、14:00–18:00，其余为空闲时段；周末（周六、周日）全天按空闲时段计价，见官方页脚注。
 * 非 DeepSeek 官方模型（如第三方提供商的 MiMo）不在价目表中，按 `unpriced` 处理：
 * 只计 tokens 不计费，避免使用非官方估算价造成误导。
 *
 * `effectiveFrom` 与外部覆盖文件机制保留：将来官方再次调价后，可在
 * $DSH_HOME/dsh-balance-widget-prices.json 追加新规则，按消息时间选最新生效的价格
 * 重新计算历史消费。
 */

/** flash 系列统一价格（官方 deepseek-flash 与 opencode-go 旧名共享）。 */
const FLASH_PEAK = Object.freeze({ input: 2.0, cacheRead: 0.04, output: 8.0 });
const FLASH_OFF_PEAK = Object.freeze({ input: 1.0, cacheRead: 0.02, output: 4.0 });
/** deepseek-v4-pro 价格。 */
const PRO_PEAK = Object.freeze({ input: 9.0, cacheRead: 0.3, output: 27.0 });
const PRO_OFF_PEAK = Object.freeze({ input: 4.5, cacheRead: 0.15, output: 13.5 });

export const PRICE_RULES = Object.freeze([
  Object.freeze({
    effectiveFrom: 0,
    peakWindows: Object.freeze([
      Object.freeze({ startHour: 9, endHour: 12 }),
      Object.freeze({ startHour: 14, endHour: 18 })
    ]),
    models: Object.freeze({
      // 官方合并后的模型名（api.deepseek.com / deepseek-official 路由）
      "deepseek-flash": Object.freeze({ peak: FLASH_PEAK, offPeak: FLASH_OFF_PEAK }),
      // opencode-go 路由仍在使用旧名，按相同 flash 价计费
      "deepseek-v4-flash": Object.freeze({ peak: FLASH_PEAK, offPeak: FLASH_OFF_PEAK }),
      "deepseek-v4-flash-vision-exp": Object.freeze({ peak: FLASH_PEAK, offPeak: FLASH_OFF_PEAK }),
      "deepseek-v4-pro": Object.freeze({ peak: PRO_PEAK, offPeak: PRO_OFF_PEAK })
    })
  })
]);
/**
 * 参考汇率：仅用于把 CNY 费用折算成 USD 展示值（costUsd 字段）。
 * 所有价目表均直接以 CNY 计价，不再做 USD→CNY 换算。
 */
const REFERENCE_USD_CNY = 7.25;

// 模型名归一化：去掉 "提供方/模型名" 里的提供方前缀，只留模型名(价格表只认裸名)
function normalizeModel(model) {
  const text = String(model);
  const slash = text.lastIndexOf("/");
  return slash >= 0 ? text.slice(slash + 1) : text;
}
// 判断某个时刻(毫秒时间戳)在不在高峰窗口里(按北京时间换算)；周末(北京时周六/周日)全天按谷价，官方新规
function isPeak(peakWindows, timeMs) {
  const bj = new Date(timeMs + 8 * 3600 * 1000);
  const bjHour = bj.getUTCHours();
  const bjDay = bj.getUTCDay();   // 0=周日，6=周六（北京时间）
  if (bjDay === 0 || bjDay === 6) return false;   // 周末全天非高峰
  return peakWindows.some((w) => bjHour >= w.startHour && bjHour < w.endHour);
}

// 给规则表做指纹：整个规则对象转成一段字符串，内容一变指纹就变(用来判断缓存要不要作废)
function fingerprintOf(rules) {
  return JSON.stringify(rules);
}

// ---------------------------------------------------------------------------
// merged price rules: built-in PRICE_RULES + optional user override file
// ---------------------------------------------------------------------------

/** Optional user price-table override file under $DSH_HOME. */
const PRICES_OVERRIDE_FILE = "dsh-balance-widget-prices.json";

//打包后的内置规则表，和用户覆盖文件合并后形成最终规则表
let priceRulesState = {
  rules: PRICE_RULES,
  fingerprint: fingerprintOf(PRICE_RULES),
  fileMtime: -1
};

// 算用户价格覆盖文件的完整路径(文件放 $DSH_HOME 下，没设环境变量就默认用户目录的 .dsh)
function priceRulesPath() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, PRICES_OVERRIDE_FILE);
}

//文件未改变，用原来的 priceRulesState,改变了就重新读取文件，解析 JSON，合并规则
export function refreshPriceRules() {
  const path = priceRulesPath();
  try {
    const st = statSync(path);
    if (st.mtimeMs === priceRulesState.fileMtime) return priceRulesState;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rules) ? parsed.rules : [];
    const extra = list.filter(
      (r) => r !== null && typeof r === "object" && typeof r.effectiveFrom === "number" && r.models !== null && typeof r.models === "object"
    );
    const rules = PRICE_RULES.concat(extra);
    priceRulesState = { rules, fingerprint: fingerprintOf(rules), fileMtime: st.mtimeMs };
  } catch {
    // absent / unreadable / malformed — stay on the built-in table
    priceRulesState = { rules: PRICE_RULES, fingerprint: fingerprintOf(PRICE_RULES), fileMtime: -1 };
  }
  return priceRulesState;
}

// 查价：给定"模型名 + 消息时间"，在最新规则表里挑当时生效的单价；表里没这模型就返回 null(不计钱)
export function priceAt(model, timeMs) {
  const id = normalizeModel(model);
  const rules = refreshPriceRules().rules;
  for (let i = rules.length - 1; i >= 0; i--) {
    const candidate = rules[i];
    if (timeMs < candidate.effectiveFrom) continue;
    const entry = candidate.models[id];
    if (entry === void 0) continue;
    const peak = isPeak(candidate.peakWindows, timeMs);
    const p = peak ? entry.peak : entry.offPeak;
    return {
      input: p.input,
      cacheRead: p.cacheRead,
      output: p.output,
      peak,
      effectiveFrom: candidate.effectiveFrom
    };
  }
  return null;
}

// 当前定价环境：最新的已生效时代的峰谷窗口 + 现在是否高峰(给前端打"高峰/空闲"标签用)
export function currentPricingContext(now = Date.now()) {
  const rules = refreshPriceRules().rules;
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (now >= rule.effectiveFrom) {
      return {
        peakWindows: rule.peakWindows,
        nowPeak: isPeak(rule.peakWindows, now),
        effectiveFrom: rule.effectiveFrom
      };
    }
  }
  return { peakWindows: [], nowPeak: false, effectiveFrom: 0 };
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

// 安全转数字：数字或"数字字符串"→ 有限数字；转不出来返回 NaN(防止接口返回怪数据)
function toFinite(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

// 拼余额接口的完整网址(支持环境变量 DEEPSEEK_BASE_URL 覆盖服务器地址)
function balanceUrl() {
  const base = process.env[BASE_URL_ENV] ?? PUBLIC_BASE_URL;
  return `${base.replace(/\/+$/, "")}${BALANCE_PATH}`;
}

// 把数据转成 JSON 格式的 HTTP 响应发给浏览器(附带统一的响应头)
function sendJson(res, status, body) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

// 从 DeepSeek 错误返回里抠出能看懂的中文错误信息；抠不出就用"DeepSeek 接口返回 HTTP 状态码"兜底
function providerMessage(text, status) {
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === "object" && parsed.error !== null && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    /* fall through */
  }
  return `DeepSeek 接口返回 HTTP ${status}`;
}

// 建一个空记账本：总账数字(次数/费用/tokens) + 峰谷两本分账(windows) + 按模型账本(models) + 明细仓(rates)
export function emptyRecord() {
  return {
    calls: 0,
    unpricedCalls: 0,
    cost: 0,
    costUsd: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    windows: {
      peak: { tokens: 0, cost: 0 },
      offPeak: { tokens: 0, cost: 0 }
    },
    models: {},
    // per (model × era × window × token-type) buckets — every bucket uses a
    // single official unit price, so the breakdown rows show clean official
    // rates (¥3.00/¥1.50/¥0.10…) instead of blended averages.
    rates: {}
  };
}

// 往明细仓记一笔：key 是"模型×时代×峰谷×类型"，同一个 key 单价相同，tokens/cost 累加
function addRate(record, model, era, win, type, tokens, cost) {
  if (tokens <= 0) return;
  const key = `${model}\u0000${era}\u0000${win}\u0000${type}`;
  let b = record.rates[key];
  if (b === void 0) {
    b = record.rates[key] = { model, era, win, type, tokens: 0, cost: 0 };
  }
  b.tokens += tokens;
  b.cost += cost;
}

// 核心计价：把一条 AI 消息的 token 数记进记账本(总账+峰谷分账+按模型分账+明细仓)；没带 usage 返回 false；没有官方价的模型只计次数不计钱
export function priceEventInto(record, event) {
  const data = event && typeof event === "object" ? event.data : void 0;
  const usage = data && typeof data === "object" ? data.usage : void 0;
  if (!usage || typeof usage !== "object") return false;
  const input = toFinite(usage.inputTokens);
  const output = toFinite(usage.outputTokens);
  if (!Number.isFinite(input) && !Number.isFinite(output)) return false;
  const cacheRead = Math.max(0, toFinite(usage.cacheReadTokens) || 0);
  // `usage.inputTokens` is already the uncached (cache-miss) portion — the
  // token-meter usage projection maps it straight to `uncachedInputTokens` —
  // so it must NOT be reduced by cacheRead again.
  const uncached = Number.isFinite(input) ? input : 0;
  const out = Number.isFinite(output) ? output : 0;
  const rawModel = typeof data.message?.source?.model === "string" ? data.message.source.model : "unknown";
  const id = normalizeModel(rawModel);
  const at = typeof event.time === "number" ? event.time : Date.now();
  const p = priceAt(id, at);

  record.calls += 1;
  record.inputTokens += uncached;
  record.cacheReadTokens += cacheRead;
  record.outputTokens += out;

  let cost = 0;
  if (p === null) {
    record.unpricedCalls += 1;
  } else {
    cost = (uncached * p.input + cacheRead * p.cacheRead + out * p.output) / 1e6;// 费用 = tokens × 单价 ÷ 1M
    record.cost += cost;
    record.costUsd += cost / REFERENCE_USD_CNY;
    const win = p.peak ? "peak" : "offPeak";
    const windowBucket = p.peak ? record.windows.peak : record.windows.offPeak;
    windowBucket.tokens += uncached + cacheRead + out;
    windowBucket.cost += cost;
    addRate(record, id, p.effectiveFrom, win, "input", uncached, (uncached * p.input) / 1e6);
    addRate(record, id, p.effectiveFrom, win, "cacheRead", cacheRead, (cacheRead * p.cacheRead) / 1e6);
    addRate(record, id, p.effectiveFrom, win, "output", out, (out * p.output) / 1e6);
  }

  let mb = record.models[id];
  if (mb === void 0) {
    mb = {
      model: id,
      rawModel,
      calls: 0,
      unpricedCalls: 0,
      tokens: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      cost: 0,
      costUsd: 0,
      peak: { tokens: 0, cost: 0 },
      offPeak: { tokens: 0, cost: 0 }
    };
    record.models[id] = mb;
  }
  mb.calls += 1;
  mb.tokens += uncached + cacheRead + out;
  mb.inputTokens += uncached;
  mb.cacheReadTokens += cacheRead;
  mb.outputTokens += out;
  if (p === null) {
    mb.unpricedCalls += 1;
  } else {
    mb.cost += cost;
    mb.costUsd += cost / REFERENCE_USD_CNY;
    const mbWindow = p.peak ? mb.peak : mb.offPeak;
    mbWindow.tokens += uncached + cacheRead + out;
    mbWindow.cost += cost;
  }
  return true;
}

// 把按模型的账本整理成表格行(模型名/次数/tokens/费用/峰谷拆分)，按费用从高到低排序，给前端展示用
export function modelRowsOf(record) {
  const rows = [];
  for (const key of Object.keys(record.models)) {
    const m = record.models[key];
    rows.push({
      model: m.model,
      rawModel: m.rawModel,
      calls: m.calls,
      unpricedCalls: m.unpricedCalls,
      priced: m.unpricedCalls === 0,
      tokens: m.tokens,
      inputTokens: m.inputTokens,
      cacheReadTokens: m.cacheReadTokens,
      outputTokens: m.outputTokens,
      cost: Math.round(m.cost * 1e6) / 1e6,
      costUsd: Math.round(m.costUsd * 1e6) / 1e6,
      peakTokens: m.peak.tokens,
      peakCost: Math.round(m.peak.cost * 1e6) / 1e6,
      offPeakTokens: m.offPeak.tokens,
      offPeakCost: Math.round(m.offPeak.cost * 1e6) / 1e6
    });
  }
  rows.sort((a, b) => b.cost - a.cost);
  return rows;
}

// 把明细仓整理成"公式明细"行：每行一个官方单价(单价=费用/tokens×1e6)；排序：模型费用↓ → 高峰在前 → 输入/缓存/输出
export function breakdownOf(record) {
  const typeLabel = { input: "输入(未命中)", cacheRead: "缓存命中", output: "输出" };
  const winLabel = { peak: "高峰", offPeak: "空闲" };
  const typeOrder = { input: 0, cacheRead: 1, output: 2 };
  const modelCost = {};
  for (const key of Object.keys(record.models)) modelCost[key] = record.models[key].cost;
  const multi = Object.keys(record.models).length > 1;
  const rows = [];
  for (const key of Object.keys(record.rates)) {
    const b = record.rates[key];
    if (b.tokens <= 0) continue;
    const tokens = b.tokens;
    const subtotal = Math.round(b.cost * 1e6) / 1e6;
    const rate = Math.round((b.cost / tokens) * 1e6 * 1e6) / 1e6;
    const parts = [];
    if (multi) parts.push(b.model);
    parts.push(winLabel[b.win]);
    parts.push(typeLabel[b.type]);
    rows.push({
      model: b.model,
      window: b.win,
      type: b.type,
      label: parts.join("·"),
      tokens,
      rate,
      subtotal
    });
  }
  rows.sort((a, b) => {
    const mc = (modelCost[b.model] ?? 0) - (modelCost[a.model] ?? 0);
    if (mc !== 0) return mc;
    const wc = (a.window === "peak" ? 0 : 1) - (b.window === "peak" ? 0 : 1);
    if (wc !== 0) return wc;
    return typeOrder[a.type] - typeOrder[b.type];
  });
  return rows;
}

// ---------------------------------------------------------------------------
// today's consumption: official platform source
// ---------------------------------------------------------------------------

// 把日期转成 "YYYY-MM-DD" 字符串(平台账单按这个格式分天)
export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 调平台官网用量接口拿"今天"的官方消费金额；官网返回格式变过多次所以防御式解析；解析不出返回 null，网络/接口报错直接抛异常
export async function fetchPlatformTodayCost(token) {
  const now = new Date();
  const url = `${PLATFORM_USAGE_URL}?month=${now.getMonth() + 1}&year=${now.getFullYear()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "x-app-version": "1.0.0",
      Origin: "https://platform.deepseek.com",
      Referer: "https://platform.deepseek.com/usage"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`DeepSeek 平台用量接口返回 HTTP ${response.status}`);
  const body = await response.json();
  const biz = body && typeof body === "object" ? body.data : void 0;
  if (body?.code !== 0 || biz === void 0 || biz.biz_code !== 0) {
    const code = body?.code ?? biz?.biz_code;
    if (code === 40002 || code === 40003) {
      throw new Error("DEEPSEEK_PLATFORM_TOKEN 已过期：请重新登录 platform.deepseek.com 并更新 userToken");
    }
    throw new Error(`DeepSeek 平台用量接口错误 (code ${code ?? "unknown"})`);
  }
  const bizData = biz.biz_data;
  const container = Array.isArray(bizData) ? bizData[0] : bizData;
  const days = container && typeof container === "object" ? container.days : void 0;
  if (!Array.isArray(days)) return null;
  const today = localDate();
  const entry = days.find((d) => d && d.date === today);
  if (!entry || !Array.isArray(entry.data)) return null;
  let total = 0;
  for (const modelEntry of entry.data) {
    if (!modelEntry || typeof modelEntry !== "object" || !Array.isArray(modelEntry.usage)) continue;
    for (const u of modelEntry.usage) {
      if (!u || typeof u !== "object") continue;
      const value = toFinite(u.cost ?? u.amount);
      if (Number.isFinite(value)) total += value;
    }
  }
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// today's consumption: balance-delta estimate
// ---------------------------------------------------------------------------

// 每日计量状态文件的绝对路径($DSH_HOME/storages 下)
function dayStatePath() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "storages", DAY_STATE_FILE);
}

// 读上次存盘的计量状态；文件不存在或格式坏了返回 null(当作新的一天从头算)
function loadDayState(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.date === "string" &&
      typeof parsed.opening === "number" &&
      typeof parsed.last === "number"
    ) {
      return parsed;
    }
  } catch {
    /* absent or broken — reset */
  }
  return null;
}

// 把计量状态存盘(先写临时文件再改名，防止写一半断电留坏文件；失败就算了不影响主流程)
function saveDayState(path, state) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), "utf8");
    renameSync(tmp, path);
  } catch {
    /* best-effort only */
  }
}

// 用余额差估算今日消费：记住今天第一次看到的余额，今日消费 = max(0, 开头余额 − 当前余额)；余额不合法返回 null
export function computeTodayConsumed(balance) {
  if (!Number.isFinite(balance)) return null;
  const path = dayStatePath();
  const today = localDate();
  const stored = loadDayState(path);
  const opening = stored !== null && stored.date === today ? stored.opening : (stored !== null ? stored.last : balance);
  saveDayState(path, { date: today, opening, last: balance });
  const consumed = Math.max(0, opening - balance);
  return Math.round(consumed * 100) / 100;
}

// ---------------------------------------------------------------------------
// per-session cost
// ---------------------------------------------------------------------------

/** Min interval between log re-decodings of the same session. */
const REPLAY_MIN_INTERVAL_MS = 2000;

/** Whole-session log replay cache: sessionId -> { record, revision, at }. */
const logCostCache = new Map();

// 重放某会话的历史日志：把每条 AI 消息都算一遍钱，费用覆盖整个会话(含插件加载前的消息)；
// 带缓存：日志版本或价格指纹没变就直接用上次结果，且两次重放至少隔 2 秒；读不了返回 null
async function replaySessionCost(ctx, sessionId) {
  const persistence = ctx.get("sessionPersistence");
  if (persistence === void 0 || typeof persistence.readRaw !== "function" || typeof persistence.readStoredRevision !== "function") {
    return null;
  }
  let revision;
  try {
    revision = await persistence.readStoredRevision(sessionId);
  } catch (error) {
    ctx.logger.warn("dsh-WallpaperAndCost: failed to read session log revision");
    ctx.logger.warn(error);
    return null;
  }
  if (revision === void 0) return null;
  const state = refreshPriceRules();
  const cached = logCostCache.get(sessionId);
  if (cached !== void 0) {
    if (cached.revision === revision && cached.fingerprint === state.fingerprint) return cached;
    if (Date.now() - cached.at < REPLAY_MIN_INTERVAL_MS) return cached;
  }
  try {
    const raw = await persistence.readRaw(sessionId);
    if (raw === void 0 || raw === null || typeof raw.content !== "string") return null;
    const record = emptyRecord();
    for (const line of raw.content.split("\n")) {
      if (line === "") continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event === null || typeof event !== "object" || event.type !== "assistant/message") continue;
      try {
        priceEventInto(record, event);
      } catch {
        // one malformed message must not fail the whole replay
      }
    }
    const result = { ...record, revision, at: Date.now(), fingerprint: state.fingerprint };
    logCostCache.set(sessionId, result);
    return result;
  } catch (error) {
    ctx.logger.warn("dsh-WallpaperAndCost: failed to replay session log for costing");
    ctx.logger.warn(error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wallpaper Engine workshop extraction (server-side, via scripts/extract_scene_pkg.py)
// ---------------------------------------------------------------------------

/** Absolute path of the bundled extract_scene_pkg.py script. */
export const EXTRACT_SCRIPT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "extract_scene_pkg.py"
);

// 创意工坊提取产物的输出根目录($DSH_HOME/storages/wallpaper-workshop)
function workshopOutRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
  return join(home, "storages", "wallpaper-workshop");
}

// 给文件夹路径算一个 16 位短哈希 id：同一路径永远得到同一个 id(也用作输出子目录名)
export function workshopJob(folder) {
  return createHash("sha1").update(String(folder)).digest("hex").slice(0, 16);
}

// 规整用户输入的文件夹路径：
//   1) 去首尾空白；
//   2) 剥掉一对成对的引号（从 Windows 对话框/文档里复制路径时经常带着引号，Node 会把
//     带引号的路径当作「相对路径」去解析，于是明明存在的文件夹也被报成 文件夹不存在）；
//   3) 展开 `~` / `~/` / `~\` 开头的写法；
//   4) 校验是否为绝对路径（盘符:\、UNC \\、或 POSIX / 开头）。
// 返回 { folder } 或 { error, message }。桌面端报"文件夹不存在"的绝大多数情况，
// 都是手输/粘贴的路径带了引号、用了相对写法或盘符写错，先在这里把能自动修正的修掉。
export function normalizeWorkshopFolder(raw) {
  let folder = String(raw ?? "").trim();
  if (folder.length >= 2 && (folder[0] === '"' || folder[0] === "'") && folder[folder.length - 1] === folder[0]) {
    folder = folder.slice(1, -1).trim();
  }
  if (folder === "~" || folder.startsWith("~/") || folder.startsWith("~\\")) {
    folder = join(homedir(), folder.slice(2));
  }
  if (folder === "") return { error: "empty" };
  const absolute = isAbsolute(folder) || /^[A-Za-z]:[\\/]/.test(folder) || /^\\\\/.test(folder);
  if (!absolute) {
    return {
      error: "not-absolute",
      message: "请输入绝对路径（以盘符开头，例如 D:\\SteamLibrary\\steamapps\\workshop\\content\\431960\\1234567890）。相对路径、带引号或含 ~ 的路径无法定位到创意工坊文件夹。"
    };
  }
  return { folder };
}

// 截长文本只留末尾 n 个字符(脚本输出太长时只把最后一段给浏览器看)
function tail(text, n) {
  const s = String(text || "").trim();
  return s.length > n ? "…" + s.slice(-n) : s;
}

// 运行内置的 python 提取脚本，返回 { code, stdout, stderr }；先试 python 再试 py，都找不到报"请安装 Python"
async function runExtractScript(args) {
  const attempt = (bin) =>   // 尝试用某个解释器(bin)再跑一次脚本
    new Promise((resolve, reject) => {
      execFile(
        bin,
        [EXTRACT_SCRIPT_PATH].concat(args),
        {
          timeout: 120000,
          maxBuffer: 32 * 1024 * 1024,
          windowsHide: true,
          encoding: "utf8"
        },
        (err, stdout, stderr) => {
          if (err) {
            if (err.code === "ENOENT") {
              if (bin === "py") {
                reject(new Error("未找到 Python：请安装 Python 3，或将 python / py 加入 PATH 后重启 DSH"));
              } else {
                attempt("py").then(resolve, reject);
              }
              return;
            }
            resolve({ code: typeof err.code === "number" ? err.code : 1, stdout: stdout || "", stderr: stderr || "" });
            return;
          }
          resolve({ code: 0, stdout: stdout || "", stderr: stderr || "" });
        }
      );
    });
  return attempt("python");
}

// 看扩展名分类：mp4/webm/gif/jpg/png 各归各，dds 等特殊格式归"bin(二进制)"(前端据此决定预览还是下载)
export function mediaKind(name) {
  const ext = String(name).split(".").pop().toLowerCase();
  if (ext === "mp4") return "mp4";
  if (ext === "webm") return "webm";
  if (ext === "gif") return "gif";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "png") return "png";
  if (ext === "dds" || ext === "bmp" || ext === "tga") return "bin";
  return "bin";
}

// 按文件名返回浏览器认识的 MIME 类型；认不出来就当二进制流(application/octet-stream)发
function mimeOf(name) {
  const kind = mediaKind(name);
  return ({
    mp4: "video/mp4",
    webm: "video/webm",
    gif: "image/gif",
    jpg: "image/jpeg",
    png: "image/png"
  }[kind] || "application/octet-stream");
}

// ---------------------------------------------------------------------------
// OpenCode Go plan usage (rolling / weekly / monthly) — mirrors the balance fetch
// ---------------------------------------------------------------------------

/** Exact route for OpenCode Go usage. */
export const OPCODE_GO_USAGE_ROUTE = "/api/opencode-go-usage";

/** Upstream OpenCode Go usage endpoint (community-discovered, non-documented). */
const OPCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

/** The three Go quota windows, in display order. */
export const OPCODE_GO_WINDOWS = [
  { key: "rolling", label: "滚动用量" },
  { key: "weekly", label: "每周用量" },
  { key: "monthly", label: "每月用量" }
];

/**
 * 可能装着 OpenCode Go 用量 key 的凭据名，按优先级排列：
 *   1. OPENCODEGO_API_KEY — 自建供应商 `opencodego`（官方不再维护 opencode-go 的模型列表后新增的）
 *   2. OPENCODE_GO_API_KEY — DSH 官方供应商 `opencode-go`
 * 两个 key 都指向同一个 opencode.ai/zen/go 账号，用量是同账号共享的，所以谁有就用谁；
 * 前一个鉴权失败（401/403）时自动退回下一个。
 */
export const OPCODE_GO_KEY_REFS = ["OPENCODEGO_API_KEY", "OPENCODE_GO_API_KEY"];

/**
 * 算作 OpenCode Go 流量的供应商路由名：官方 `opencode-go` 与自建的 `opencodego`
 * （正则容忍连字符/下划线两种写法），任一命中都视作"该刷新额度了"。
 */
const GO_PROVIDER_RE = /^opencode[-_]?go$/i;

/** 快照最长保质期：即使没有新请求，超过这个时间也主动去上游核一次。 */
const OPCODE_GO_MAX_AGE_MS = 5 * 60 * 1000;

/** 两次上游调用之间的最短间隔：一轮对话里连着好几步时，把刷新合并掉。 */
const OPCODE_GO_MIN_INTERVAL_MS = 4000;

/**
 * OpenCode Go 通道上的活动信号：只要 opencodego / opencode-go 发过一次请求，
 * revision 就 +1。前端轮询用它判断"要不要真的去上游拉额度"。
 */
const goActivity = { revision: 0, at: 0, provider: null, model: null };

/**
 * 上游用量快照缓存。`revision` 是这份快照对应的活动版本号（不是当前版本号）：
 * 前端拿着它和自己的已显示版本比对，就能知道手里的数据是否已经过期。
 */
const goUsageState = { snapshot: null, at: 0, revision: 0, keyRef: null };

// 从会话事件里抠出"这次请求/这条回复走的是哪个供应商-模型"：
// assistant/message 的消息源带 provider/model；request/header 的 header.config 也带。
export function providerOfEvent(event) {
  const data = event !== null && typeof event === "object" ? event.data : void 0;
  if (data === null || typeof data !== "object") return null;
  const source = data.message !== null && typeof data.message === "object" ? data.message.source : void 0;
  const config = data.header !== null && typeof data.header === "object" ? data.header.config : void 0;
  const provider = typeof source?.provider === "string" ? source.provider : typeof config?.provider === "string" ? config.provider : null;
  if (provider === null) return null;
  const model = typeof source?.model === "string" ? source.model : typeof config?.model === "string" ? config.model : null;
  return { provider, model };
}

// 记一次 Go 通道活动：只有 opencodego / opencode-go 的请求才算，命中就把 revision +1
export function noteGoActivity(provider, model, at = Date.now()) {
  if (typeof provider !== "string" || !GO_PROVIDER_RE.test(provider)) return false;
  goActivity.revision += 1;
  goActivity.at = Number.isFinite(at) ? at : Date.now();
  goActivity.provider = provider;
  goActivity.model = typeof model === "string" ? model : null;
  return true;
}

// 直接看活动状态的只读副本（调试/自检用）
export function goActivityState() {
  return { revision: goActivity.revision, at: goActivity.at, provider: goActivity.provider, model: goActivity.model };
}

// 调 OpenCode Go 官方用量接口(15 秒超时)：key 以 Bearer 方式带上；key 缺失/接口失败都会抛错
export async function fetchOpencodeGoUsage(apiKey, timeoutMs = 15000) {
  if (!apiKey) throw new Error("未配置 OpenCode Go 的 API Key（OPENCODEGO_API_KEY / OPENCODE_GO_API_KEY）");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPCODE_GO_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": "dsh-WallpaperAndCost/1.0"
      },
      signal: controller.signal,
      redirect: "follow"
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenCode Go 用量接口返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 120)}` : ""}`);
    }
    const json = await response.json();
    return normalizeOpencodeUsage(json);
  } finally {
    clearTimeout(timer);
  }
}

// 解析用量接口返回：兼容有/无 usage 前缀、重置时间两种格式，统一成 滚动/周/月 三个窗口(百分比+剩余秒数)
export function normalizeOpencodeUsage(json) {
  const root = json && typeof json === "object" ? json : {};
  const u = root.usage && typeof root.usage === "object" ? root.usage : root;
  const windows = [];
  for (const { key, label } of OPCODE_GO_WINDOWS) {
    const w = u && typeof u === "object" ? u[key] : void 0;
    if (!w || typeof w !== "object") continue;
    const status = typeof w.status === "string" ? w.status : "ok";
    const percent = typeof w.percent === "number" && Number.isFinite(w.percent) ? w.percent : null;
    let resetsInSeconds = null;
    if (typeof w.resetsInSeconds === "number" && Number.isFinite(w.resetsInSeconds)) {
      resetsInSeconds = Math.max(0, Math.floor(w.resetsInSeconds));
    } else if (typeof w.resetsAt === "string") {
      const ms = Date.parse(w.resetsAt);
      if (Number.isFinite(ms)) resetsInSeconds = Math.max(0, Math.floor((ms - Date.now()) / 1000));
    }
    windows.push({ key, label, status, percent, resetsInSeconds });
  }
  if (windows.length === 0) throw new Error("OpenCode Go 用量接口未返回可解析的用量窗口");
  return { windows, fetchedAt: Date.now(), raw: root };
}

/** 给前端的数据视图：只暴露窗口和取数时间，不带上游原始响应。 */
function goUsageData() {
  const snapshot = goUsageState.snapshot;
  return snapshot === null ? null : { windows: snapshot.windows, fetchedAt: goUsageState.at };
}

// 把能用的 Go key 都解析出来（优先 opencodego，再退 opencode-go）；空值当作没配
async function resolveGoKeys(ctx) {
  const keys = [];
  for (const ref of OPCODE_GO_KEY_REFS) {
    try {
      const hit = await ctx.credentials.resolve(ref);
      if (hit !== void 0 && typeof hit.value === "string" && hit.value.trim() !== "") {
        keys.push({ ref, value: hit.value });
      }
    } catch {
      /* 读不出来的凭据跳过，试下一个 */
    }
  }
  return keys;
}

/**
 * 查一次用量。命中缓存就直接返回：前端每几秒轮询一次，只要两个 Go 供应商都
 * 没发过请求（活动版本没变）且快照还新鲜，宿主一个上游请求都不会发。
 *
 * force —— 用户手动点开面板时忽略"有没有新请求"直接核一次。
 */
async function queryGoUsage(ctx, force) {
  const now = Date.now();
  const cached = goUsageState.snapshot;
  const newActivity = goUsageState.revision !== goActivity.revision;
  const tooOld = cached === null || now - goUsageState.at >= OPCODE_GO_MAX_AGE_MS;
  const tooSoon = cached !== null && now - goUsageState.at < OPCODE_GO_MIN_INTERVAL_MS;
  if (!force && !tooOld && !(newActivity && !tooSoon)) {
    return { ok: true, unchanged: true, revision: goUsageState.revision, data: goUsageData(), keyRef: goUsageState.keyRef };
  }
  const keys = await resolveGoKeys(ctx);
  if (keys.length === 0) {
    return {
      ok: false,
      error: "no-api-key",
      message: "未配置 OpenCode Go 的 API Key：请在 设置 → 模型 里填 opencodego 供应商（OPENCODEGO_API_KEY）或 opencode-go 供应商（OPENCODE_GO_API_KEY）的 Key。",
      revision: goUsageState.revision
    };
  }
  let parsed = null;
  let usedRef = null;
  let lastError = null;
  for (const key of keys) {
    try {
      parsed = await fetchOpencodeGoUsage(key.value);
      usedRef = key.ref;
      break;
    } catch (error) {
      lastError = error;
      // 只有鉴权类失败才值得换下一把 key；网络/解析错误换成另一把也一样
      const message = error instanceof Error ? error.message : String(error);
      if (!/HTTP 40[13]/.test(message)) break;
    }
  }
  if (parsed === null) throw lastError ?? new Error("OpenCode Go 用量接口请求失败");
  goUsageState.snapshot = parsed;
  goUsageState.at = Date.now();
  goUsageState.revision = goActivity.revision;
  goUsageState.keyRef = usedRef;
  return { ok: true, unchanged: false, revision: goUsageState.revision, data: goUsageData(), keyRef: usedRef };
}

// ---------------------------------------------------------------------------
// plugin body
// ---------------------------------------------------------------------------

// 插件入口：DSH 启动时调用；实时监听每条 AI 消息记账 + 注册下面 5 个 HTTP 路由
export function apply(ctx) {
  // 内存账本：记录"正在进行中"的会话的实时费用(消息还没落盘先记这儿)
  const bySession = new Map();

  // 实时监听：每来一条 AI 消息就立刻记一笔(按会话分账)
  ctx.on("session/event", (session, event) => {
    try {
      // OpenCode Go 额度：只要 opencodego / opencode-go 两条路由发过请求，
      // 就把活动版本 +1 —— 前端轮询据此决定去上游拉一次新额度。
      // assistant/message 是"某一步模型调用已结束"，request/header 是"一次请求开始"，
      // 两者都看，既抓得到快速连续的多步，也抓得到换了模型/供应商的那一次。
      if (event?.type === "assistant/message" || event?.type === "request/header") {
        const route = providerOfEvent(event);
        if (route !== null) noteGoActivity(route.provider, route.model, typeof event.time === "number" ? event.time : Date.now());
      }
      if (event?.type !== "assistant/message") return;
      refreshPriceRules();
      let record = bySession.get(session.id);
      if (record === void 0) {
        record = emptyRecord();
        bySession.set(session.id, record);
      }
      priceEventInto(record, event);
    } catch (error) {
      ctx.logger.warn("dsh-WallpaperAndCost: failed to price a live assistant/message event");
      ctx.logger.warn(error);
    }
  });

  // 路由①：查余额 + 今日消费（官方数据优先，没有就用余额差估算兜底）
  // ---- GET /api/deepseek-balance ----------------------------------------
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: BALANCE_ROUTE,
      // 流程：取 API key → 调 DeepSeek 余额接口 → 查今日消费(官方→估算) → 拼 JSON 返回
      handler: async (req, res) => {
        try {
          const hit = await ctx.credentials.resolve("DEEPSEEK_API_KEY");
          if (hit === void 0) {
            sendJson(res, 503, {
              ok: false,
              error: "no-api-key",
              message: "未配置 DEEPSEEK_API_KEY：请在 设置 → 模型 中填写 DeepSeek API Key。"
            });
            return;
          }
          const response = await fetch(balanceUrl(), {
            headers: {
              Authorization: `Bearer ${hit.value}`,
              Accept: "application/json"
            },
            signal: AbortSignal.timeout(TIMEOUT_MS)
          });
          const text = await response.text();
          if (!response.ok) {
            sendJson(res, response.status, {
              ok: false,
              error: "provider",
              message: providerMessage(text, response.status)
            });
            return;
          }
          let body = null;
          try {
            body = JSON.parse(text);
          } catch {
            /* provider returned non-JSON with 2xx — report it below */
          }
          const total = body && Array.isArray(body.balance_infos) ? toFinite(body.balance_infos[0]?.total_balance) : NaN;

          // Today's consumption: official platform data first, then the
          // balance-delta estimate.
          let todayConsumed = null;
          let todayConsumedSource = "estimate";
          const platformHit = await ctx.credentials.resolve("DEEPSEEK_PLATFORM_TOKEN");
          if (platformHit !== void 0) {
            try {
              const official = await fetchPlatformTodayCost(platformHit.value);
              if (official !== null) {
                todayConsumed = official;
                todayConsumedSource = "official";
              } else {
                ctx.logger.warn("dsh-WallpaperAndCost: platform usage returned no today row; falling back to the balance-delta estimate");
              }
            } catch (error) {
              ctx.logger.warn("dsh-WallpaperAndCost: platform usage fetch failed; falling back to the balance-delta estimate");
              ctx.logger.warn(error);
            }
          }
          if (todayConsumedSource !== "official" && Number.isFinite(total)) {
            todayConsumed = computeTodayConsumed(total);
          }

          sendJson(res, 200, {
            ok: true,
            balance: body,
            todayConsumed,
            todayConsumedSource,
            platformConfigured: platformHit !== void 0,
            fetchedAt: Date.now()
          });
        } catch (error) {
          ctx.logger.warn("dsh-WallpaperAndCost: failed to fetch DeepSeek balance");
          ctx.logger.warn(error);
          sendJson(res, 502, {
            ok: false,
            error: "fetch-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }),
    "dsh-WallpaperAndCost: balance route"
  );

  // 路由②：查某个会话的总费用（先重放历史日志，日志没有就用内存里的实时账本）
  // ---- GET /api/deepseek-session-cost?sessionId=<id> ---------------------
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: SESSION_COST_ROUTE,
      // 流程：取 sessionId → 重放日志算全量费用，失败退回实时账本 → 拼成前端要的 JSON(含按模型/峰谷/明细)
      handler: async (req, res) => {
        try {
          const sessionId = new URL(req.url ?? "/", "http://x").searchParams.get("sessionId") ?? "";
          let record = null;
          let source = null;
          if (sessionId !== "") {
            const replay = await replaySessionCost(ctx, sessionId);
            if (replay !== null) {
              record = replay;
              source = "log";
            } else {
              const live = bySession.get(sessionId);
              if (live !== void 0) {
                record = live;
                source = "live";
              }
            }
          }
          if (record === null) {
            const emptyCtx = currentPricingContext();
            sendJson(res, 200, {
              ok: true,
              sessionId,
              source: null,
              calls: 0,
              unpricedCalls: 0,
              priced: true,
              cost: 0,
              costUsd: 0,
              inputTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              models: [],
              windows: {
                peak: { tokens: 0, cost: 0 },
                offPeak: { tokens: 0, cost: 0 }
              },
              nowPeak: emptyCtx.nowPeak,
              peakWindows: emptyCtx.peakWindows.map((w) => ({ startHour: w.startHour, endHour: w.endHour })),
              breakdown: []
            });
            return;
          }
          const pricingCtx = currentPricingContext();
          sendJson(res, 200, {
            ok: true,
            sessionId,
            source,
            calls: record.calls,
            unpricedCalls: record.unpricedCalls,
            priced: record.unpricedCalls === 0,
            cost: Math.round(record.cost * 1e6) / 1e6,
            costUsd: Math.round(record.costUsd * 1e6) / 1e6,
            inputTokens: record.inputTokens,
            cacheReadTokens: record.cacheReadTokens,
            outputTokens: record.outputTokens,
            models: modelRowsOf(record),
            windows: {
              peak: { tokens: record.windows.peak.tokens, cost: Math.round(record.windows.peak.cost * 1e6) / 1e6 },
              offPeak: { tokens: record.windows.offPeak.tokens, cost: Math.round(record.windows.offPeak.cost * 1e6) / 1e6 }
            },
            nowPeak: pricingCtx.nowPeak,
            peakWindows: pricingCtx.peakWindows.map((w) => ({ startHour: w.startHour, endHour: w.endHour })),
            breakdown: breakdownOf(record)
          });
        } catch (error) {
          ctx.logger.warn("dsh-WallpaperAndCost: session-cost lookup failed");
          ctx.logger.warn(error);
          sendJson(res, 500, { ok: false, error: "internal", message: "internal error" });
        }
      }
    }),
    "dsh-WallpaperAndCost: session cost route"
  );

  // 路由③：解析创意工坊壁纸 —— 校验文件夹路径，跑 python 解包脚本，列出提取到的媒体(按大小降序)
  // ---- GET /api/wallpaper-workshop/extract?folder=<abs path> --------------
  // Runs scripts/extract_scene_pkg.py against a server-local Wallpaper Engine
  // workshop item folder (…steamapps\workshop\content\431960\<id>) and returns
  // the best extracted media (video / largest image / preview fallback).
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: WORKSHOP_EXTRACT_ROUTE,
      // 流程：folder 参数 → 规整并校验路径 → 必须是存在的文件夹 → 跑脚本到输出目录 → 读产物列表；一个媒体都没有给 422
      handler: async (req, res) => {
        try {
          const raw = new URL(req.url ?? "/", "http://x").searchParams.get("folder") ?? "";
          const norm = normalizeWorkshopFolder(raw);
          if (norm.error === "empty") {
            sendJson(res, 400, {
              ok: false,
              error: "no-folder",
              message: "缺少 folder 参数（Wallpaper Engine 创意工坊条目文件夹的绝对路径）。"
            });
            return;
          }
          if (norm.error === "not-absolute") {
            sendJson(res, 400, { ok: false, error: "not-absolute", message: norm.message });
            return;
          }
          const folder = norm.folder;
          let st;
          try {
            st = statSync(folder);
          } catch (e) {
            // 把真实的失败原因告诉用户：权限问题不再被笼统地报成"文件夹不存在"
            const code = (e && e.code) || "";
            if (code === "EACCES" || code === "EPERM") {
              sendJson(res, 403, {
                ok: false,
                error: "no-permission",
                message: `没有权限读取该文件夹：${folder}（请检查文件夹访问权限；若开启了 Windows「受控文件夹访问」，需把 DSH 加入允许列表）。`
              });
            } else if (code === "ENOENT") {
              sendJson(res, 404, {
                ok: false,
                error: "not-found",
                message: `文件夹不存在：${folder}（请确认路径拼写、创意工坊条目 id 正确，且文件夹确实位于该位置）。`
              });
            } else {
              sendJson(res, 404, {
                ok: false,
                error: "not-found",
                message: `无法访问该文件夹：${folder}（${code || "未知错误"}）。`
              });
            }
            return;
          }
          if (!st.isDirectory()) {
            sendJson(res, 400, { ok: false, error: "not-dir", message: `路径不是文件夹：${folder}` });
            return;
          }
          const root = workshopOutRoot();
          mkdirSync(root, { recursive: true });
          const outDir = join(root, workshopJob(folder));
          const result = await runExtractScript(["--folder", folder, "--out", outDir]);
          const printed = `${tail(result.stdout, 3000)}${result.stderr ? "\n[stderr] " + tail(result.stderr, 1000) : ""}`;
          let files = [];
          try {
            files = readdirSync(outDir, { withFileTypes: true })
              .filter((d) => d.isFile())
              .map((d) => {
                const p = join(outDir, d.name);
                return { name: d.name, size: statSync(p).size, kind: mediaKind(d.name) };
              })
              .sort((a, b) => b.size - a.size);
          } catch {
            /* outDir not created — treat as no media below */
          }
          if (files.length === 0) {
            sendJson(res, 422, {
              ok: false,
              error: "no-media",
              message: "未提取到可显示的壁纸媒体（可能是 DXT 场景/傀儡壁纸，或文件夹里没有 scene.pkg / mp4 / wallpaper.jpg / preview.jpg）。",
              stdout: printed
            });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            folder,
            job: workshopJob(folder),
            outDir,
            files,
            stdout: printed
          });
        } catch (error) {
          ctx.logger.warn("dsh-WallpaperAndCost: workshop extraction failed");
          ctx.logger.warn(error);
          sendJson(res, 500, {
            ok: false,
            error: "run-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }),
    "dsh-WallpaperAndCost: workshop extract route"
  );

  // 路由④：把之前提取好的某个媒体文件发给浏览器预览/下载（严格校验 job 和文件名，防越权读别的文件）
  // ---- GET /api/wallpaper-workshop/file?job=<hash>&name=<file> -------------
  // Serves one previously extracted media file for preview / download.
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: WORKSHOP_FILE_ROUTE,
      // 安全双重校验：job 必须是 16 位十六进制、文件名不能带空字节/不能跳出输出目录，然后读文件按 MIME 发出去
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? "/", "http://x");
          const job = url.searchParams.get("job") ?? "";
          const name = url.searchParams.get("name") ?? "";
          if (!/^[0-9a-f]{16}$/.test(job) || name === "" || name.indexOf("\0") >= 0) {
            sendJson(res, 400, { ok: false, error: "bad-args", message: "参数不合法" });
            return;
          }
          const outDir = join(workshopOutRoot(), job);
          const target = join(outDir, name);
          const rel = relative(outDir, target);
          if (rel === "" || isAbsolute(rel) || rel.split(sep)[0] === "..") {
            sendJson(res, 400, { ok: false, error: "bad-path", message: "非法文件名" });
            return;
          }
          let data;
          try {
            data = readFileSync(target);
          } catch {
            sendJson(res, 404, { ok: false, error: "not-found", message: "文件不存在" });
            return;
          }
          res.writeHead(200, {
            "content-type": mimeOf(name),
            "content-length": data.length,
            "cache-control": "no-store",
            "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`
          });
          res.end(data);
        } catch (error) {
          ctx.logger.warn("dsh-WallpaperAndCost: workshop file serve failed");
          ctx.logger.warn(error);
          if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal", message: "internal error" });
          else res.end();
        }
      }
    }),
    "dsh-WallpaperAndCost: workshop file route"
  );

  // 路由⑤：查 OpenCode Go 套餐用量（滚动/周/月三个窗口，key 从 DSH 凭据库取，不进浏览器）
  // ---- GET /api/opencode-go-usage[?force=1] -------------------------------
  // 刷新时机由"两个 Go 供应商有没有发过请求"驱动：opencodego（自建）和
  // opencode-go（官方）任一发出请求 → 会话事件把活动版本 +1 → 前端下一次轮询
  // 才会真的来这里拉一次上游；平时轮询拿到的是宿主缓存（unchanged: true），
  // 不会反复打上游。?force=1 是用户手动点开面板时的强刷。
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: OPCODE_GO_USAGE_ROUTE,
      handler: async (req, res) => {
        try {
          const force = new URL(req.url ?? "/", "http://x").searchParams.get("force") === "1";
          sendJson(res, 200, await queryGoUsage(ctx, force));
        } catch (error) {
          ctx.logger.warn("dsh-WallpaperAndCost: opencode-go usage fetch failed");
          ctx.logger.warn(error);
          const message = error instanceof Error ? error.message : String(error);
          const cached = goUsageData();
          // 拉取失败但手里有旧快照：继续显示旧数据（stale 标记），别让一次网络抖动把面板清空
          sendJson(res, 200, cached === null
            ? { ok: false, error: "fetch-failed", message, revision: goUsageState.revision }
            : { ok: true, unchanged: true, stale: true, warning: message, revision: goUsageState.revision, data: cached, keyRef: goUsageState.keyRef });
        }
      }
    }),
    "dsh-WallpaperAndCost: opencode-go usage route"
  );
}
