# dsh-WallpaperAndCost

A merged DSH web plugin combining **wallpaper customization** and the **DeepSeek balance & usage widget**.

## Features

### 🎨 Wallpaper (壁纸)
- 8 built-in curated gradients (暮色 / 深渊 / 晨曦 / 森林 / 星夜 / 暖阳 / 青空 / 石墨)
- Upload your own images **at full original resolution** (no compression), stored in IndexedDB
- **动态壁纸：上传 MP4/WebM 视频，自动静音循环播放**（铺底 `<video>` 元素，object-fit: cover）
- Crop editor: drag to pan + zoom (100%–250%) with a live viewport-proportional preview
- Independent **absolute opacity sliders (0–100%)** for the left sidebar, the conversation column and the right sidebar — the right-sidebar slider now drives **both** the dsh-better-sidebar panel *and* DSH's official right sidebar (dsh-client-ui-sidebar-right, detected via `[data-sidebar-right-panel]`); the slider auto-appears whenever either sidebar is present
- Wallpaper choice persists across restarts (localStorage + IndexedDB)
- **创意工坊壁纸提取（服务器目录）**：输入 Wallpaper Engine 创意工坊条目文件夹的绝对路径（`…steamapps\workshop\content\431960\<id>`），由内置的 `scripts/extract_scene_pkg.py` 解析 `scene.pkg` / `.tex`（含 LZ4 解压、DXT/RGBA→PNG、内嵌 MP4），提取最佳壁纸供预览与下载。需要运行 DSH 的机器装有 Python 3（脚本为纯 Python，Pillow 可选）。
  - **桌面端支持「选择文件夹…」**：DSH Desktop（Windows）上可直接用系统原生文件夹选择器选取条目文件夹，自动填入绝对路径，避免手输/粘贴路径出错而报"文件夹不存在"。
  - **路径自动规整 + 明确报错**：路径会先去空白、剥成对引号、展开 `~`，并校验是否为绝对路径；读取失败会区分「文件夹不存在」「没有权限读取该文件夹（含 Windows 受控文件夹访问拦截）」「路径不是文件夹」，不再把权限问题笼统报成"文件夹不存在"。

### 🔍 Wallpaper Engine 创意工坊提取脚本
- 仓库自带独立脚本 `scripts/extract_scene_pkg.py`，可单独命令行使用：
  ```sh
  python scripts/extract_scene_pkg.py --folder <创意工坊条目文件夹> --out <输出目录>
  python scripts/extract_scene_pkg.py <scene.pkg>          # 或直接解析单个 pkg
  python scripts/extract_scene_pkg.py <scene.pkg> --list   # 只列出包内文件
  ```
- 支持容器：PKGV（scene.pkg）、TEXV0005/TEXI0001/TEXB000x（.tex）。内容类型：内嵌 JPEG/MP4、DXT1/3/5→.dds（有 Pillow 转 .png）、RGBA8888/R8 裸像素→.png、其余文件原样导出。
- 浏览器端另有无需 Python 的「从 Wallpaper 导入」入口（File System Access API 纯 JS 解包），两者互补。

### 💰 Balance & usage (余额与用量)
- Balance button in the conversation header: balance, today's consumption, this session's token usage & estimated cost
- Prices come from **`pricing.json`** (data, not code): regex model ids, an optional peak/off-peak split, CNY per million tokens — see [Model pricing](#model-pricing-pricingjson)
- Per-model and per-window (peak/off-peak) breakdown in the popover
- The per-session ledger is **durable**: a host restart no longer zeroes the token meter. It is written to `$DSH_HOME/storages/dsh-wallpaper-cost-sessions.json` and dropped only once that conversation is archived/deleted
- Platform consumption (`DEEPSEEK_PLATFORM_TOKEN`) is read from DSH's credential store by the host (`ctx.credentials.resolve`), the same way `DEEPSEEK_API_KEY` and `OPENCODE_GO_API_KEY` are — no in-widget token capture
- The DeepSeek API key never leaves the host (host-side routes only)

### 🏷 Model pricing (`pricing.json`)

The price table is one JSON file at the package root — editing it needs no code change and no rebuild; the host reloads it as soon as its mtime changes, and history is re-priced on the next replay.

```jsonc
{
  "peakWindows": [{ "startHour": 9, "endHour": 12 }, { "startHour": 14, "endHour": 18 }],
  "models": [
    {
      "match": "deepseek.*flash",     // regex, matched against the bare model id
      "flags": "i",
      "label": "deepseek flash 系列",
      "peak": true,                   // true = peak + offPeak (6 numbers); false = one flat group (3 numbers)
      "price": {
        "peak":    { "cacheHit": 0.04, "cacheMiss": 2.0, "output": 8.0 },
        "offPeak": { "cacheHit": 0.02, "cacheMiss": 1.0, "output": 4.0 }
      }
    }
  ]
}
```

- **Regex ids**: a vendor prefix (`deepseek-official/deepseek-v4-flash`) is stripped before matching, so `deepseek.*flash` covers `deepseek-flash`, `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` in one rule. Rules are tried in file order; the first match wins.
- **`peak: false`** — a vendor that does not split peak/off-peak gets one group of three numbers (`cacheHit` 缓存命中, `cacheMiss` 缓存未命中, `output` 输出); the peak window is ignored for it.
- **`peak: true`** — six numbers: `price.peak` + `price.offPeak`, chosen by the message's Beijing hour.
- Units are **CNY per million tokens**. The window logic itself (hours from `peakWindows`, weekends always off-peak) stays in code because it is billing semantics, not price data.
- A model absent from the table is counted as tokens only (`unpriced`) instead of being priced with a guess; a missing/broken file falls back to a built-in flash table so costs never silently drop to zero.

### 🟢 OpenCode Go 用量 (rolling / weekly / monthly)
- 会话头部新增一个 `Go` 按钮（与余额按钮并列于顶端）：默认只显示**滚动 / 周 / 月**三个用量的百分比
- 点开后用**进度条**展示每个窗口用量，并显示各自的**重置时间**，以及上次刷新时间与实际使用的密钥名
- **刷新时机跟随两条 Go 路由的请求**：`opencodego`（自建供应商）与 `opencode-go`（DSH 官方供应商）任一发出请求（会话事件里的 `assistant/message` 或 `request/header` 带 `provider`），宿主就把用量版本号 +1，前端下次轮询才去上游拉一次；没有请求时前端每 5 秒问的只是本地宿主，宿主直接回缓存（不一定打上游）。点开面板会强刷一次（`?force=1`）
- 快照缓存 5 分钟保质、4 秒内合并连发的刷新；上游临时取不到时继续显示上次结果并给出提醒，不会把面板清空
- 数据来自 OpenCode Go 官方用量接口 `GET https://opencode.ai/zen/go/v1/usage`（Bearer 鉴权），由 host 端代理，key 通过 `ctx.credentials.resolve` 按 `OPENCODEGO_API_KEY` → `OPENCODE_GO_API_KEY` 顺序解析（前者 401/403 时自动退回后者），**从不入源码/浏览器**
- 该接口为社区发现的非官方文档化接口，响应结构可能随 OpenCode 变动；窗口解析做了兼容（`usage.` 前缀或裸窗口、`resetsAt` 或 `resetsInSeconds`）

## Install

```sh
dsh plugin --profile web add dsh-WallpaperAndCost
```

or from GitHub:

```sh
dsh plugin --profile web add github:<owner>/dsh-WallpaperAndCost
```

Restart DSH afterwards.

## Requirements
- DSH web profile
- `DEEPSEEK_API_KEY` credential (设置 → 模型) for the balance feature
- Optional `DEEPSEEK_PLATFORM_TOKEN` (set in 设置 → 模型) for exact platform consumption figures
- `OPENCODEGO_API_KEY`（自建 `opencodego` 供应商）或 `OPENCODE_GO_API_KEY`（官方 `opencode-go` 供应商）之一，用于 Go 用量面板

## Structure
- `lib/index.js` — host half: balance/cost API routes (`/api/deepseek-balance`, `/api/deepseek-session-cost`) + workshop extraction routes (`/api/wallpaper-workshop/extract`, `/api/wallpaper-workshop/file`) + OpenCode Go usage route (`/api/opencode-go-usage`, 支持 `?force=1`；刷新由 `opencodego` / `opencode-go` 的会话请求驱动)
- `lib/client.js` — browser half: wallpaper + balance widget + OpenCode usage widget + workshop extraction UI (no build step required)
- `pricing.json` — 模型计价表（正则 id、峰谷开关、CNY/百万 tokens），**唯一价格数据源**，改完热生效
- `scripts/extract_scene_pkg.py` — standalone Wallpaper Engine `.pkg`/`.tex` extraction engine (called by the host route; also usable as a CLI)
- `cordis.patch.yml` — bundle patch mounting the plugin row

## Runtime files (`$DSH_HOME/storages/`)
| File | Purpose |
|---|---|
| `deepseek-balance-widget-day.json` | 当日计量起点（余额差估算今日消费） |
| `dsh-wallpaper-cost-sessions.json` | 分会话 token/费用账本：重启不清零，对话被归档/删除后由定时清理移除 |

## License
MIT
