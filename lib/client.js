window.__ModuleLoader__.load({
  id: "dsh-WallpaperAndCost",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var react_jsx_runtime = require("react/jsx-runtime");
    var jsx = react_jsx_runtime.jsx;
    var jsxs = react_jsx_runtime.jsxs;
    const React = react;

    // =====================================================================
    // 壁纸功能 (merged from dsh-wallpaper)
    // =====================================================================

    const KEY = "dsw.wallpaper.v1";
    const IDB_NAME = "dsw-wallpaper";
    const IDB_STORE = "kv";
    const IDB_UPLOADS_KEY = "uploads.v1";

    const BUILTINS = [
      { id: 'dusk', name: '暮色', css: 'radial-gradient(at 20% 25%, rgba(255,255,255,0.10) 0%, transparent 45%), linear-gradient(135deg, #1b1035 0%, #45236e 55%, #7a3b8f 100%)' },
      { id: 'abyss', name: '深渊', css: 'radial-gradient(at 75% 20%, rgba(120,200,255,0.16) 0%, transparent 50%), linear-gradient(160deg, #081526 0%, #0e3a5c 60%, #0a2a44 100%)' },
      { id: 'dawn', name: '晨曦', css: 'linear-gradient(120deg, #ffe9d6 0%, #ffb8a0 45%, #e88aa0 100%)' },
      { id: 'forest', name: '森林', css: 'radial-gradient(at 80% 75%, rgba(120,220,160,0.14) 0%, transparent 50%), linear-gradient(150deg, #0c2014 0%, #1c4a2c 60%, #2d6b42 100%)' },
      { id: 'starry', name: '星夜', css: 'radial-gradient(circle at 30% 28%, rgba(120,160,255,0.20) 0%, transparent 38%), radial-gradient(circle at 72% 70%, rgba(160,120,255,0.14) 0%, transparent 45%), linear-gradient(180deg, #080c1c 0%, #131c38 100%)' },
      { id: 'sunset', name: '暖阳', css: 'radial-gradient(at 15% 85%, rgba(255,220,150,0.25) 0%, transparent 45%), linear-gradient(135deg, #ff8c3a 0%, #ff5e62 55%, #c23a5e 100%)' },
      { id: 'sky', name: '青空', css: 'linear-gradient(180deg, #7ec8e3 0%, #cdeef6 55%, #f2fafd 100%)' },
      { id: 'graphite', name: '石墨', css: 'radial-gradient(at 50% 0%, rgba(255,255,255,0.07) 0%, transparent 55%), linear-gradient(180deg, #232733 0%, #13151c 100%)' },
    ];

    const DEFAULT_STATE = { version: 4, enabled: false, kind: null, value: null, opLeft: 60, opMid: 50, opRight: 70, uploads: [] };

    function makeStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        get: () => value,
        set: (next) => { value = next; listeners.forEach((fn) => fn()); },
        subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      };
    }

    const store = makeStore(DEFAULT_STATE);
    const editor = makeStore({ open: false, id: null, pending: null });
    // 上传读取进度: null 或 { name, loaded, total, canceled }
    const uploadProgress = makeStore(null);

    // 防卡死: 硬上限 (超过直接拒绝) + 软提醒 (超过提示占用内存)
    const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
    const SOFT_WARN_BYTES = 80 * 1024 * 1024;

    function fmtBytes(n) {
      if (n >= 1 << 30) return (n / (1 << 30)).toFixed(2) + ' GB';
      if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB';
      if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + ' KB';
      return n + ' B';
    }

    function detectBetterSidebar() {
      try {
        const m = globalThis.__DSH_MODULES__;
        if (m) {
          if (m.graphRows && m.graphRows.has('dsh-better-sidebar')) return true;
          if (m.factories && m.factories.has('dsh-better-sidebar')) return true;
          if (m.loadCache && m.loadCache.has('dsh-better-sidebar')) return true;
        }
      } catch (e) {}
      try {
        if (typeof document !== 'undefined') {
          if (document.querySelector('style[data-plugin="dsh-better-sidebar"]')) return true;
          if (document.querySelector('.nArs4W_panel')) return true;
        }
      } catch (e) {}
      return false;
    }
    const HAS_BETTER_SIDEBAR = detectBetterSidebar();

    let themeSvc = null;
    let effects = null;
    let activeUploadCancel = null;
    const thumbQueue = new Set(); // 正在生成首帧缩略图的视频 id (去重)

    function clamp(v, lo, hi) {
      return Math.max(lo, Math.min(hi, v));
    }

    function resolveValue(s) {
      if (s.kind === 'builtin') {
        const b = BUILTINS.find((x) => x.id === s.value);
        return b ? b.css : null;
      }
      if (s.kind === 'upload') {
        const u = (s.uploads || []).find((x) => x.id === s.value);
        if (!u) return null;
        if (u.isVideo) return 'video'; // 视频走 applyVideoWallpaper 分支, 此处仅需 truthy
        return u.dataUrl ? "url('" + u.dataUrl + "')" : null;
      }
      return null;
    }

    function buildBodyCss(v) {
      return 'html{background:transparent!important}body{background-image:' + v + '!important;background-size:cover!important;background-position:center!important;background-repeat:no-repeat!important;background-attachment:fixed!important}';
    }

    function buildUploadCss(u) {
      const ratio = (u.w / u.h).toFixed(6);
      const crop = u.crop || { zoom: 1, x: 50, y: 50 };
      const z = clamp(crop.zoom || 1, 1, 4);
      const x = clamp(crop.x == null ? 50 : crop.x, 0, 100);
      const y = clamp(crop.y == null ? 50 : crop.y, 0, 100);
      return 'html{background:transparent!important}body{background-image:url(\'' + u.dataUrl + '\')!important;background-size:max(calc(100vw * ' + z + '), calc(100vh * ' + ratio + ' * ' + z + '))!important;background-position:' + x + '% ' + y + '%!important;background-repeat:no-repeat!important;background-attachment:fixed!important}';
    }

    function buildRightRule(opRightRaw) {
      if (!HAS_BETTER_SIDEBAR) return '';
      const or = clamp(opRightRaw == null ? 70 : opRightRaw, 0, 100) / 100;
      if (or <= 0) {
        return '[class*="detailsCol"]{background:transparent!important}.nArs4W_panel,.nArs4W_bottomPanel{background:transparent!important}';
      }
      const light = 'rgba(244,246,250,' + or.toFixed(3) + ')';
      const dark = 'rgba(16,18,24,' + or.toFixed(3) + ')';
      return '[class*="detailsCol"]{background:' + light + '!important}body[data-ds-dark-theme] [class*="detailsCol"]{background:' + dark + '!important}'
        + '.nArs4W_panel,.nArs4W_bottomPanel{background:' + light + '!important}'
        + 'body[data-ds-dark-theme] .nArs4W_panel,body[data-ds-dark-theme] .nArs4W_bottomPanel{background:' + dark + '!important}';
    }

    function buildTokens(next) {
      const ol = clamp(next.opLeft == null ? 60 : next.opLeft, 0, 100) / 100;
      const o = (r, g, b, a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
      return {
        '--dsw-alias-bg-base': { light: 'transparent', dark: 'transparent' },
        '--dsw-specific-sidebar-fill': { light: o(236, 239, 246, ol.toFixed(3)), dark: o(8, 10, 16, ol.toFixed(3)) },
      };
    }

    function buildMidRule(opMidRaw) {
      const om = clamp(opMidRaw == null ? 50 : opMidRaw, 0, 100) / 100;
      // The center conversation column: #root > div[data-slot="root"] > div (the
      // AppFrame grid) > nth-child(2) (sidebarCol=1, centerCol=2, detailsCol=3).
      // Same structural selector the better-sidebar layout push relies on.
      const sel = '#root > div[data-slot="root"] > div > div:nth-child(2)';
      if (om <= 0) return sel + '{background:transparent!important}';
      const light = 'rgba(255,255,255,' + om.toFixed(3) + ')';
      const dark = 'rgba(24,27,34,' + om.toFixed(3) + ')';
      return sel + '{background:' + light + '!important}body[data-ds-dark-theme] ' + sel + '{background:' + dark + '!important}';
    }

    function insertStyle(css) {
      let el = document.getElementById('dsh-wallpaper-style');
      if (el) el.remove();
      el = document.createElement('style');
      el.id = 'dsh-wallpaper-style';
      el.setAttribute('data-plugin-css', 'dsh-wallpaper');
      el.textContent = css;
      document.head.appendChild(el);
      return () => { if (el.isConnected) el.remove(); };
    }

    function disposeWallpaperVideo() {
      try {
        const el = document.getElementById('dsh-wallpaper-video');
        if (el) {
          try { el.pause(); } catch (e) {}
          try { el.removeAttribute('src'); } catch (e) {}
          try { el.load(); } catch (e) {}
          if (el.parentNode) el.parentNode.removeChild(el);
        }
      } catch (e) {}
    }

    // 视频源: 优先 Blob objectURL (流式读取, 不整包解码), 回退旧版 dataUrl
    function videoSource(u) {
      if (!u) return null;
      if (u.url) return u.url;
      if (u.blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try { u.url = URL.createObjectURL(u.blob); return u.url; } catch (e) {}
      }
      return u.dataUrl || null;
    }

    function applyVideoWallpaper(u) {
      const v = document.createElement('video');
      v.id = 'dsh-wallpaper-video';
      v.setAttribute('data-plugin', 'dsh-wallpaper');
      v.src = videoSource(u);
      v.muted = true;          // 浏览器自动播放策略要求静音
      v.loop = true;           // 动态壁纸: 循环播放
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('preload', 'auto');
      v.setAttribute('aria-hidden', 'true');
      v.tabIndex = -1;
      v.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;object-fit:cover!important;z-index:-1!important;pointer-events:none!important;background:#000';
      document.body.insertBefore(v, document.body.firstChild);
      try {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
      return () => disposeWallpaperVideo();
    }

    // 壁纸指纹: 只有影响画面的状态变化才重建壁纸,
    // 修 bug: 打开设置/补缩略图等 commit 不再重载已有壁纸
    let lastWallpaperFp = null;
    let activeVideoKey = null; // 当前铺底视频对应的上传 id
    function wallpaperFingerprint(next) {
      if (!next || !next.enabled || !next.kind || !next.value) return 'off';
      let f = next.kind + '|' + next.value + '|' + (next.opLeft ?? '') + '|' + (next.opMid ?? '') + '|' + (next.opRight ?? '');
      if (next.kind === 'upload' && next.value) {
        const u = (next.uploads || []).find((x) => x.id === next.value);
        if (u) {
          f += '|' + (u.isVideo ? 'v' : 'i');
          f += '|' + (u.dataUrl || (u.blob ? 'b' : '') || '');
          f += '|' + (u.w || '') + 'x' + (u.h || '');
          f += '|' + ((u.crop && u.crop.zoom) || '') + ',' + ((u.crop && u.crop.x) ?? '') + ',' + ((u.crop && u.crop.y) ?? '');
        }
      }
      return f;
    }

    function applyWallpaper(next) {
      const fp = wallpaperFingerprint(next);
      if (fp === lastWallpaperFp) return; // 画面未变化: 跳过重建

      // 视频复用: 仍是同一视频源时, 只更新样式/主题, 保留铺底 <video> 元素
      // (拖透明度/补缩略图等 commit 不会销毁并重启视频) —— 必须在通用清理之前判断
      if (next && next.enabled && next.kind === 'upload' && next.value) {
        const uv = (next.uploads || []).find((x) => x.id === next.value);
        if (uv && uv.isVideo && activeVideoKey === uv.id && effects && effects.video && document.getElementById('dsh-wallpaper-video')) {
          try {
            if (effects.style) { try { effects.style(); } catch (e) {} }
            if (effects.theme) { try { effects.theme(); } catch (e) {} }
            const styleDispose = insertStyle('html{background:transparent!important}body{background:transparent!important}' + buildMidRule(next.opMid) + buildRightRule(next.opRight));
            let themeDispose = null;
            if (themeSvc && typeof themeSvc.overrideTokens === 'function') {
              themeDispose = themeSvc.overrideTokens('dsw-wallpaper', buildTokens(next));
            }
            effects = { theme: themeDispose, style: styleDispose, video: () => { activeVideoKey = null; disposeWallpaperVideo(); } };
            lastWallpaperFp = fp;
          } catch (e) {
            try { console.error('[wallpaper] video restyle failed', e); } catch (_) {}
          }
          return;
        }
      }

      if (effects) {
        try { if (effects.theme) effects.theme(); } catch (e) {}
        try { if (effects.style) effects.style(); } catch (e) {}
        try { if (effects.video) effects.video(); } catch (e) {}
        effects = null;
      }
      if (!next || !next.enabled || !next.kind || !next.value) { lastWallpaperFp = fp; return; }
      // 动态壁纸 (MP4 视频): 挂载铺底 <video> 元素, 静音循环播放
      if (next.kind === 'upload') {
        const uv = (next.uploads || []).find((x) => x.id === next.value);
        if (uv && uv.isVideo) {
          try {
            const styleDispose = insertStyle('html{background:transparent!important}body{background:transparent!important}' + buildMidRule(next.opMid) + buildRightRule(next.opRight));
            let themeDispose = null;
            if (themeSvc && typeof themeSvc.overrideTokens === 'function') {
              themeDispose = themeSvc.overrideTokens('dsw-wallpaper', buildTokens(next));
            }
            activeVideoKey = uv.id;
            applyVideoWallpaper(uv);
            effects = { theme: themeDispose, style: styleDispose, video: () => { activeVideoKey = null; disposeWallpaperVideo(); } };
            lastWallpaperFp = fp;
          } catch (e) {
            try { console.error('[wallpaper] video apply failed', e); } catch (_) {}
          }
          return;
        }
      }
      let body = null;
      if (next.kind === 'upload') {
        const u = (next.uploads || []).find((x) => x.id === next.value);
        if (u && u.w && u.h) body = buildUploadCss(u);
      }
      if (!body) body = buildBodyCss(resolveValue(next));
      if (!body) return;
      try {
        const styleDispose = insertStyle(body + buildMidRule(next.opMid) + buildRightRule(next.opRight));
        let themeDispose = null;
        if (themeSvc && typeof themeSvc.overrideTokens === 'function') {
          themeDispose = themeSvc.overrideTokens('dsw-wallpaper', buildTokens(next));
        }
        effects = { theme: themeDispose, style: styleDispose };
        lastWallpaperFp = fp;
      } catch (e) {
        try { console.error('[wallpaper] apply failed', e); } catch (_) {}
      }
    }

    function idbOpen() {
      return new Promise((resolve, reject) => {
        try {
          const req = indexedDB.open(IDB_NAME, 1);
          req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch (e) {} };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch (e) { reject(e); }
      });
    }

    function idbPut(key, value) {
      return idbOpen().then((db) => new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(value, key);
          tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
          tx.onerror = () => { try { db.close(); } catch (e) {} reject(tx.error); };
        } catch (e) { reject(e); }
      })).catch(() => {});
    }

    function idbGet(key) {
      return idbOpen().then((db) => new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = () => { try { db.close(); } catch (e) {} resolve(req.result); };
          req.onerror = () => { try { db.close(); } catch (e) {} reject(req.error); };
        } catch (e) { reject(e); }
      })).catch(() => undefined);
    }

    function persist(next) {
      try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
          localStorage.setItem(KEY, JSON.stringify({ ...next, uploads: [] }));
        }
      } catch (e) {}
      try {
        // 持久化时去掉运行时 objectURL (重启后需重新创建), Blob 本身可存 IndexedDB
        const clean = (next.uploads || []).map((u) => { const c = { ...u }; delete c.url; return c; });
        idbPut(IDB_UPLOADS_KEY, clean);
      } catch (e) {}
    }

    function commit(next) {
      applyWallpaper(next);
      persist(next);
      store.set(next);
    }

    function useStore(s) {
      const [, force] = React.useState(0);
      React.useEffect(() => s.subscribe(() => force((n) => n + 1)), [s]);
      return s.get();
    }

    function selectBuiltin(id) {
      commit({ ...store.get(), enabled: true, kind: 'builtin', value: id });
    }

    function selectUpload(id) {
      commit({ ...store.get(), enabled: true, kind: 'upload', value: id });
    }

    function setOpLeft(v) { commit({ ...store.get(), opLeft: clamp(Math.round(v), 0, 100) }); }
    function setOpMid(v) { commit({ ...store.get(), opMid: clamp(Math.round(v), 0, 100) }); }
    function setOpRight(v) { commit({ ...store.get(), opRight: clamp(Math.round(v), 0, 100) }); }

    function randomize() {
      const b = BUILTINS[Math.floor(Math.random() * BUILTINS.length)];
      selectBuiltin(b.id);
    }

    function resetWallpaper() {
      commit({ ...DEFAULT_STATE, uploads: store.get().uploads });
    }

    function removeUpload(id) {
      const s = store.get();
      const rm = (s.uploads || []).find((x) => x.id === id);
      if (rm && rm.url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try { URL.revokeObjectURL(rm.url); } catch (e) {}
      }
      const uploads = s.uploads.filter((u) => u.id !== id);
      const next = { ...s, uploads };
      if (s.kind === 'upload' && s.value === id) {
        next.enabled = false;
        next.kind = null;
        next.value = null;
      }
      commit(next);
    }

    function openEditor(id) {
      editor.set({ open: true, id, pending: null });
    }

    function closeEditor() {
      editor.set({ open: false, id: null, pending: null });
    }

    function commitEditor(crop) {
      const e = editor.get();
      const clean = { zoom: clamp(crop.zoom || 1, 1, 4), x: clamp(crop.x == null ? 50 : crop.x, 0, 100), y: clamp(crop.y == null ? 50 : crop.y, 0, 100) };
      const s = store.get();
      if (e.pending) {
        const id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const item = { id, name: e.pending.name, dataUrl: e.pending.dataUrl, w: e.pending.w || 0, h: e.pending.h || 0, crop: clean };
        const uploads = s.uploads.concat([item]).slice(-5);
        commit({ ...s, enabled: true, kind: 'upload', value: id, uploads });
        captureImageThumb(item); // 立即生成小缩略图, 面板只渲染小图
      } else if (e.id) {
        const uploads = s.uploads.map((u) => (u.id === e.id ? { ...u, crop: clean } : u));
        commit({ ...s, enabled: true, kind: 'upload', value: e.id, uploads });
      }
      closeEditor();
    }

    // 视频: 获取分辨率 + 截取首帧缩略图 (canvas -> JPEG dataURL)。
    // 设置面板只渲染静态小图, 避免同时挂多个 <video> 元素导致卡顿。
    function captureVideoThumb(item, onDone) {
      if (!item || !item.isVideo || item.thumb || thumbQueue.has(item.id)) {
        if (onDone) { try { onDone(); } catch (e) {} }
        return;
      }
      thumbQueue.add(item.id);
      try {
        const v = document.createElement('video');
        v.preload = 'auto';      // 保证能解码出帧 (metadata 模式可能只到黑帧/空帧)
        v.muted = true;
        v.playsInline = true;
        let finished = false;
        const finish = (dataUrl, w, h) => {
          if (finished) return;
          finished = true;
          thumbQueue.delete(item.id);
          try { v.removeAttribute('src'); v.load(); } catch (e) {}
          try {
            const st = store.get();
            if ((st.uploads || []).some((x) => x.id === item.id)) {
              const uploads = (st.uploads || []).map((x) => (x.id === item.id
                ? { ...x, w: w || x.w || 0, h: h || x.h || 0, thumb: dataUrl || x.thumb || undefined, thumbFailed: dataUrl ? false : true }
                : x));
              commit({ ...st, uploads });
            }
          } catch (e) {}
          if (onDone) { try { onDone(); } catch (e) {} }
        };
        v.onerror = () => finish(null, 0, 0);
        const draw = () => {
          try {
            const w = v.videoWidth || 0;
            const h = v.videoHeight || 0;
            if (!w || !h) { finish(null, 0, 0); return; }
            const maxW = 320; // 缩略图宽度上限, 控制内存
            const tw = Math.min(w, maxW);
            const th = Math.max(1, Math.round((h * tw) / w));
            const cv = document.createElement('canvas');
            cv.width = tw;
            cv.height = th;
            const ctx = cv.getContext('2d');
            if (!ctx) { finish(null, w, h); return; }
            ctx.drawImage(v, 0, 0, tw, th);
            let url = null;
            try { url = cv.toDataURL('image/jpeg', 0.8); } catch (e) { url = null; }
            finish(url, w, h);
          } catch (e) { finish(null, 0, 0); }
        };
        // 等真正渲染出一帧再截, 避免 drawImage 拿到黑帧/空白帧
        const drawWhenReady = () => {
          if (finished) return;
          let tries = 0;
          const poll = () => {
            if (finished) return;
            if (v.readyState >= 2 && v.currentTime > 0 && (v.videoWidth || 0) > 0) {
              if (tries++ < 3) draw();
              else finish(null, v.videoWidth || 0, v.videoHeight || 0);
              return;
            }
            if (tries++ > 150) { finish(null, 0, 0); return; } // ~2.5s 超时
            try { requestAnimationFrame(poll); } catch (e) { draw(); }
          };
          if (typeof v.requestVideoFrameCallback === 'function') {
            try {
              v.requestVideoFrameCallback(() => { if (!finished) draw(); });
              // 兜底: rVFC 万一不触发, 1.5s 后改用轮询
              setTimeout(() => { if (!finished) poll(); }, 1500);
              return;
            } catch (e) {}
          }
          try { requestAnimationFrame(poll); } catch (e) { draw(); }
        };
        v.addEventListener('loadeddata', () => {
          // 取一个真实内容帧 (25% 处, 上限 1.5s): 很多视频从黑帧/淡入开始,
          // 取 t=0 会截到黑图 -> 预览"看不到画面"
          try {
            const d = v.duration || 0;
            const t = (d > 0) ? Math.min(1.5, Math.max(0.05, d * 0.25)) : 0.05;
            v.currentTime = t;
          } catch (e) { drawWhenReady(); }
        });
        v.addEventListener('seeked', drawWhenReady);
        v.addEventListener('timeupdate', drawWhenReady);
        v.src = videoSource(item);
      } catch (e) {
        thumbQueue.delete(item.id);
        if (onDone) { try { onDone(); } catch (e) {} }
      }
    }

    // 图片: 生成小尺寸缩略图, 设置面板只渲染小图, 避免解码多张原图 (4K 图最明显)
    function captureImageThumb(item, onDone) {
      if (!item || item.isVideo || item.thumb || thumbQueue.has(item.id)) {
        if (onDone) { try { onDone(); } catch (e) {} }
        return;
      }
      if (!item.dataUrl) {
        try {
          const st = store.get();
          if ((st.uploads || []).some((x) => x.id === item.id)) {
            const uploads = (st.uploads || []).map((x) => (x.id === item.id ? { ...x, thumbFailed: true } : x));
            commit({ ...st, uploads });
          }
        } catch (e) {}
        if (onDone) { try { onDone(); } catch (e) {} }
        return;
      }
      thumbQueue.add(item.id);
      try {
        const img = new Image();
        img.decoding = 'async';
        const finish = (thumb) => {
          thumbQueue.delete(item.id);
          try {
            const st = store.get();
            if ((st.uploads || []).some((x) => x.id === item.id)) {
              const uploads = (st.uploads || []).map((x) => (x.id === item.id
                ? { ...x, thumb: thumb || x.thumb || undefined, thumbFailed: thumb ? false : true }
                : x));
              commit({ ...st, uploads });
            }
          } catch (e) {}
          if (onDone) { try { onDone(); } catch (e) {} }
        };
        img.onload = () => {
          try {
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (!w || !h) { finish(null); return; }
            const maxW = 320; // 缩略图宽度上限, 控制内存
            const tw = Math.min(w, maxW);
            const th = Math.max(1, Math.round((h * tw) / w));
            const cv = document.createElement('canvas');
            cv.width = tw;
            cv.height = th;
            const ctx = cv.getContext('2d');
            if (!ctx) { finish(null); return; }
            ctx.drawImage(img, 0, 0, tw, th);
            let url = null;
            try { url = cv.toDataURL('image/jpeg', 0.8); } catch (e) { url = null; }
            finish(url);
          } catch (e) { finish(null); }
        };
        img.onerror = () => finish(null);
        img.src = item.dataUrl;
      } catch (e) {
        thumbQueue.delete(item.id);
        if (onDone) { try { onDone(); } catch (e) {} }
      }
    }

    function bytesToBase64(u8) {
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < u8.length; i += CH) {
        bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
      }
      return btoa(bin);
    }

    // 分块读取文件: 实时进度 + 可取消, 避免一次性大缓冲卡死界面。
    // 视频只需 Blob (objectURL 流式读取), 图片需要 dataUrl (裁剪编辑器/背景图)。
    function readFileWithProgress(file, onProgress, needDataUrl) {
      const signal = { canceled: false };
      const promise = (async () => {
        if (typeof file.stream === 'function' && typeof ReadableStream !== 'undefined') {
          const reader = file.stream().getReader();
          const chunks = [];
          let base64 = '';
          let carry = new Uint8Array(0);
          let loaded = 0;
          const total = file.size || 0;
          while (true) {
            if (signal.canceled) { try { await reader.cancel(); } catch (e) {} throw new Error('canceled'); }
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            chunks.push(value);
            if (needDataUrl) {
              const merged = new Uint8Array(carry.length + value.byteLength);
              merged.set(carry);
              merged.set(value, carry.length);
              const usable = Math.floor(merged.length / 3) * 3;
              if (usable > 0) base64 += bytesToBase64(merged.subarray(0, usable));
              carry = merged.slice(usable);
            }
            onProgress(loaded, total);
          }
          const blob = new Blob(chunks, { type: file.type || 'application/octet-stream' });
          if (needDataUrl) {
            if (carry.length > 0) base64 += bytesToBase64(carry);
            return { blob, dataUrl: 'data:' + (file.type || 'application/octet-stream') + ';base64,' + base64 };
          }
          return { blob, dataUrl: null };
        }
        // 回退: FileReader (现代浏览器均走上面 stream 分支, 这里保底)
        return await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onprogress = (e) => { if (e && e.lengthComputable) onProgress(e.loaded, e.total); };
          r.onload = () => resolve({ blob: file, dataUrl: needDataUrl ? r.result : null });
          r.onerror = () => reject(r.error || new Error('read-failed'));
          r.onabort = () => reject(new Error('canceled'));
          signal.cancel = () => { try { r.abort(); } catch (e) {} };
          r.readAsDataURL(file);
        });
      })();
      return {
        promise,
        cancel: () => { signal.canceled = true; try { if (signal.cancel) signal.cancel(); } catch (e) {} },
      };
    }

    function cancelUpload() {
      try { if (activeUploadCancel) activeUploadCancel(); } catch (e) {}
    }

    // =====================================================================
    // 从 Wallpaper 导入 (Steam 创意工坊): 浏览器端解析 PKG/TEX, 提取 jpg/mp4
    // 规律: ①直接 mp4/jpg ②scene.pkg 内 .tex(内嵌 PNG/JPEG/MP4) ③preview.jpg 兜底
    // =====================================================================
    const WS_ROOT_KEY = 'ws-root-handle';
    const WS_MAX_PKG = 400 * 1024 * 1024;   // pkg 解析上限
    const WS_MAX_MEDIA = 800 * 1024 * 1024; // 导入媒体上限 (有 320MB 的直接 mp4)
    const importModal = makeStore({ open: false });

    function openImportModal() { importModal.set({ open: true }); }
    function closeImportModal() { importModal.set({ open: false }); }

    function mimeOf(kind) {
      return ({ jpg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' }[kind] || 'application/octet-stream');
    }

    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        try {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(r.error || new Error('read-failed'));
          r.readAsDataURL(file);
        } catch (e) { reject(e); }
      });
    }

    // 纯 JS LZ4 block 解码 (兼容 LZ4_decompress_safe)
    // 格式: token → 字面量 → offset(2B) → match长度扩展(若低4位=15) → 拷贝
    function lz4Decode(src, dstSize) {
      const out = [];
      let pos = 0;
      while (pos < src.length && out.length < dstSize) {
        const token = src[pos++];
        let litLen = token >> 4;
        if (litLen === 15) {
          while (true) { const b = src[pos++]; litLen += b; if (b !== 255) break; }
        }
        for (let i = 0; i < litLen; i++) out.push(src[pos++]);
        if (pos >= src.length) break;
        if (pos + 1 >= src.length) throw new Error('LZ4 数据截断');
        const offset = src[pos] | (src[pos + 1] << 8);
        pos += 2;
        let matchLen = token & 0x0f;
        if (matchLen === 15) {
          while (true) { const b = src[pos++]; matchLen += b; if (b !== 255) break; }
        }
        matchLen += 4;
        if (offset === 0 || offset > out.length) throw new Error('LZ4 偏移非法');
        const start = out.length - offset;
        for (let i = 0; i < matchLen; i++) out.push(out[start + i]);
      }
      if (out.length !== dstSize) throw new Error('LZ4 解压大小不符');
      return new Uint8Array(out);
    }

    function sniffMediaKind(u8) {
      if (u8.length >= 12 && u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return 'mp4'; // ....ftyp
      if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xd8) return 'jpg';
      if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'png';
      return null;
    }

    // 解析 PKG 目录 (PKGV0021/0023/0024 通用)
    function parsePkgEntries(buf) {
      const u8 = new Uint8Array(buf);
      const dv = new DataView(buf);
      let p = 0;
      const ml = dv.getUint32(p, true); p += 4;
      p += ml; // 魔数
      const count = dv.getUint32(p, true); p += 4;
      if (count < 0 || count > 4096) throw new Error('PKG 条目数异常');
      const entries = [];
      for (let i = 0; i < count; i++) {
        if (p + 4 > u8.length) throw new Error('PKG 目录截断');
        const nl = dv.getUint32(p, true); p += 4;
        const name = new TextDecoder().decode(u8.subarray(p, p + nl)); p += nl;
        const off = dv.getUint32(p, true); p += 4;
        const len = dv.getUint32(p, true); p += 4;
        entries.push({ name, off, len });
      }
      return { entries, dataStart: p };
    }

    // 解析单个 .tex (TEXV0005, TEXB0003/0004), 返回可展示媒体 [{name, kind, data, size}]
    function extractTexMedia(u8, texName) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let p = 0;
      const readN = () => {
        let e = p;
        while (e < u8.length && u8[e] !== 0) e++;
        const s = new TextDecoder().decode(u8.subarray(p, e));
        p = e + 1;
        return s;
      };
      const m1 = readN();
      const m2 = readN();
      if (m1 !== 'TEXV0005' || m2 !== 'TEXI0001') return [];
      const fmt = dv.getUint32(p, true);
      const flags = dv.getUint32(p + 4, true);
      p += 28;
      const m3 = readN();
      if (!/^TEXB\d{4}$/.test(m3)) return [];
      const ver = m3.slice(4);
      let imageFormat = -1;
      let imageCount;
      if (ver === '0004') { imageCount = dv.getInt32(p, true); imageFormat = dv.getInt32(p + 4, true); p += 12; }
      else if (ver === '0003') { imageCount = dv.getInt32(p, true); imageFormat = dv.getInt32(p + 4, true); p += 8; }
      else { imageCount = dv.getInt32(p, true); p += 4; }
      if (imageCount < 0 || imageCount > 64) return [];
      const isVideo = (flags & 0x20) !== 0;
      const out = [];
      for (let i = 0; i < imageCount; i++) {
        if (p + 4 > u8.length) break;
        const mipCount = dv.getInt32(p, true); p += 4;
        for (let j = 0; j < Math.min(Math.max(mipCount, 0), 32); j++) {
          if (p + 20 > u8.length) return out;
          const isLz4 = dv.getInt32(p + 8, true);
          const decCount = dv.getInt32(p + 12, true);
          const byteCount = dv.getInt32(p + 16, true);
          p += 20;
          if (byteCount < 0 || p + byteCount > u8.length) return out;
          let data = u8.slice(p, p + byteCount);
          p += byteCount;
          if (isLz4) {
            try { data = lz4Decode(data, decCount); } catch (e) { break; }
          }
          let kind = null;
          if (isVideo || imageFormat === 35) kind = 'mp4';
          else if (imageFormat === 2) kind = 'jpg';
          else if (imageFormat === 13) kind = 'png';
          else kind = sniffMediaKind(data);
          if (!kind) break; // DXT/raw -> 不可直接显示
          out.push({ name: texName.replace(/\.tex$/i, '') + '.' + kind, kind, data, size: data.length });
          break; // 每个 image 只取最大的一级 mipmap
        }
      }
      return out;
    }

    // 提取 pkg 内全部可显示媒体
    function extractPkgMedia(buf) {
      const u8 = new Uint8Array(buf);
      const { entries, dataStart } = parsePkgEntries(buf);
      const out = [];
      for (const e of entries) {
        if (!/\.tex$/i.test(e.name)) continue;
        if (e.off < 0 || e.len < 0 || e.off + e.len > buf.byteLength) continue;
        try {
          const media = extractTexMedia(u8.subarray(dataStart + e.off, dataStart + e.off + e.len), e.name);
          for (const m of media) out.push(m);
        } catch (err) { /* 跳过损坏的 tex */ }
      }
      return out;
    }

    // 挑选最佳壁纸: 视频优先, 其次最大图片
    function pickBestMedia(media) {
      let best = null;
      for (const m of media) {
        if (m.kind === 'mp4') return m;
        if (!best || m.size > best.size) best = m;
      }
      return best;
    }

    // 统计 pkg 内"素材纹理"数量 (排除遮罩): 数量过多 -> 分尸/傀儡场景壁纸
    function pkgTexPieces(buf) {
      try {
        const { entries } = parsePkgEntries(buf);
        return entries.filter((e) => /\.tex$/i.test(e.name) && !/mask/i.test(e.name)).length;
      } catch (e) { return 0; }
    }

    function WallpaperImportModal() {
      const state = useStore(importModal);
      const [step, setStep] = React.useState('root'); // root | items | options | files
      const [items, setItems] = React.useState([]);
      const [busy, setBusy] = React.useState(false);
      const [msg, setMsg] = React.useState('');
      const [hasStored, setHasStored] = React.useState(false);
      const [currentDir, setCurrentDir] = React.useState(null);
      const [currentFiles, setCurrentFiles] = React.useState([]);
      const [hasPreview, setHasPreview] = React.useState(false);

      React.useEffect(() => {
        if (!state.open) return;
        setMsg(''); setStep('root'); setBusy(false);
        idbGet(WS_ROOT_KEY).then((h) => setHasStored(!!h)).catch(() => {});
      }, [state.open]);

      if (!state.open) return null;

      const scanRoot = async (dir) => {
        setBusy(true); setMsg('正在扫描创意工坊…');
        try {
          const list = [];
          const makeUrl = async (fh) => { try { const f = await fh.getFile(); return URL.createObjectURL(f); } catch (e) { return null; } };
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind !== 'directory') continue;
            let kind = '未知', preview = null, videoUrl = null;
            try {
              for await (const [fname, fh] of handle.entries()) {
                if (fname === 'scene.pkg') kind = '场景';
                else if (/\.mp4$/i.test(fname)) { kind = '视频'; if (!videoUrl && fname.toLowerCase() !== 'preview.mp4') videoUrl = await makeUrl(fh); }
                else if (/^wallpaper\.(jpg|jpeg|png)$/i.test(fname)) kind = '图片';
                else if (fname === 'preview.jpg' && !preview) preview = await makeUrl(fh);
              }
            } catch (e) {}
            // 没有 preview 的视频壁纸: 用 mp4 内联显示一帧, 而不是干巴巴的"视频"二字
            list.push({ name, handle, kind, preview, videoUrl });
          }
          list.sort((a, b) => a.name.localeCompare(b.name));
          setItems(list);
          setStep('items');
        } catch (e) { setMsg('扫描失败: ' + ((e && e.message) || e)); }
        setBusy(false);
      };

      const pickRoot = async () => {
        try {
          if (typeof window.showDirectoryPicker === 'function') {
            const dir = await window.showDirectoryPicker({ mode: 'read' });
            try { await idbPut(WS_ROOT_KEY, dir); } catch (e) {}
            setHasStored(true);
            await scanRoot(dir);
          } else {
            setMsg('当前浏览器不支持文件夹选择，请改用「选择 scene.pkg 文件」导入。');
            pickPkgFile();
          }
        } catch (e) { /* 用户取消或权限拒绝 */ }
      };

      const useStored = async () => {
        try {
          const h = await idbGet(WS_ROOT_KEY);
          if (!h) { setMsg('没有保存过的文件夹，请重新选择'); return; }
          let perm = 'granted';
          try { perm = await h.queryPermission({ mode: 'read' }); } catch (e) {}
          if (perm !== 'granted') {
            try { perm = await h.requestPermission({ mode: 'read' }); } catch (e) {}
          }
          if (perm !== 'granted') { setMsg('未获得读取权限，请重新选择文件夹'); return; }
          await scanRoot(h);
        } catch (e) { setMsg('读取失败: ' + ((e && e.message) || e)); }
      };

      const pickPkgFile = () => {
        try {
          const inp = document.createElement('input');
          inp.type = 'file';
          inp.accept = '.pkg';
          inp.onchange = () => {
            const f = inp.files && inp.files[0];
            if (f) importPkgFile(f, f.name || 'pkg');
          };
          inp.click();
        } catch (e) { setMsg('无法打开文件选择器'); }
      };

      const importPkgFile = async (file, label) => {
        setBusy(true); setMsg('正在解析 ' + label + '…');
        try {
          if (file.size > WS_MAX_PKG) { setMsg('pkg 超过 400MB，暂不支持解析'); return; }
          const buf = await file.arrayBuffer();
          const media = extractPkgMedia(buf);
          const best = pickBestMedia(media);
          if (best) {
            const out = new File([new Blob([best.data], { type: mimeOf(best.kind) })], (label.replace(/\.pkg$/i, '') || 'wallpaper') + '.' + best.kind, { type: mimeOf(best.kind) });
            onFileChosen(out, (m) => setMsg(m), { maxBytes: WS_MAX_MEDIA });
            closeImportModal();
          } else {
            setMsg('未在 pkg 中找到可直接显示的图片/视频（多为 DXT 场景壁纸），可改用 preview.jpg 或直接文件。');
          }
        } catch (e) { setMsg('解析失败: ' + ((e && e.message) || e)); }
        setBusy(false);
      };

      const extractFromDir = async (dir) => {
        const files = {};
        try {
          for await (const [fname, fh] of dir.entries()) {
            if (fh.kind === 'file') files[fname] = fh;
          }
        } catch (e) {}
        // 读取 preview.jpg (用作缩略图 / 分尸兜底)
        let previewFile = null;
        let previewDataUrl = null;
        if (files['preview.jpg']) {
          try {
            previewFile = await files['preview.jpg'].getFile();
            previewDataUrl = await fileToDataUrl(previewFile);
          } catch (e) {}
        }
        // 1) 直接媒体文件 (mp4 / wallpaper.jpg)
        const direct = Object.keys(files).find((n) => /\.(mp4|webm)$/i.test(n) || /^wallpaper\.(jpg|jpeg|png)$/i.test(n));
        if (direct) {
          const f = await files[direct].getFile();
          return { best: { name: direct, blob: f, kind: /\.(mp4|webm)$/i.test(direct) ? 'mp4' : 'jpg' }, previewDataUrl };
        }
        // 2) scene.pkg
        if (files['scene.pkg']) {
          const pf = await files['scene.pkg'].getFile();
          if (pf.size <= WS_MAX_PKG) {
            const buf = await pf.arrayBuffer();
            const media = extractPkgMedia(buf);
            const videos = media.filter((x) => x.kind === 'mp4');
            // 非 mask 素材纹理数: 过多(>10)即分尸/傀儡场景, 直接改用 preview
            const pieces = pkgTexPieces(buf);
            const mainImages = media.filter((x) => x.kind !== 'mp4' && !/mask/i.test(x.name));
            if (videos.length > 0) {
              // 视频壁纸: 直接导入视频, 用 preview 作缩略图
              const v = videos[0];
              return { best: { name: 'wallpaper.mp4', blob: new Blob([v.data], { type: 'video/mp4' }), kind: 'mp4' }, previewDataUrl };
            }
            if (pieces > 10 && previewFile) {
              // 分尸/傀儡场景壁纸 (素材过多, 往往是 DXT 无法直接显示): 直接用 preview.jpg
              return { best: { name: 'wallpaper (preview).jpg', blob: previewFile, kind: 'jpg', fromPreview: true }, previewDataUrl };
            }
            if (mainImages.length > 0 && mainImages.length <= 10) {
              // 普通图片/小场景壁纸: 取最大一张
              const best = pickBestMedia(mainImages);
              return { best: { name: 'wallpaper.' + best.kind, blob: new Blob([best.data], { type: mimeOf(best.kind) }), kind: best.kind }, previewDataUrl };
            }
          }
        }
        // 3) 无可用媒体: 交给选项 (preview.jpg / 浏览文件)
        const fileList = [];
        for (const n of Object.keys(files)) {
          try { const f = await files[n].getFile(); fileList.push({ name: n, size: f.size, handle: files[n] }); } catch (e) {}
        }
        return { best: null, files: fileList, hasPreview: !!files['preview.jpg'], previewDataUrl };
      };

      const importItem = async (item) => {
        setBusy(true); setMsg('正在提取 ' + item.name + '…');
        try {
          const result = await extractFromDir(item.handle);
          if (result.best) {
            const b = result.best;
            const file = new File([b.blob], b.name, { type: mimeOf(b.kind) });
            const opts = { maxBytes: WS_MAX_MEDIA };
            if (result.previewDataUrl) opts.thumb = result.previewDataUrl; // 视频用 preview 作缩略图
            if (b.fromPreview) opts.applyAsImage = true;                    // 分尸/预览 直接应用为图片
            onFileChosen(file, (m) => setMsg(m), opts);
            closeImportModal();
          } else {
            setCurrentDir(item.handle);
            setCurrentFiles(result.files || []);
            setHasPreview(!!result.hasPreview);
            setMsg('未能自动提取到可直接使用的图片/视频');
            setStep('options');
          }
        } catch (e) {
          setMsg('提取失败: ' + ((e && e.message) || e));
          setCurrentDir(item.handle);
          setCurrentFiles([]);
          setStep('options');
        }
        setBusy(false);
      };

      const importPreview = async () => {
        if (!currentDir) return;
        setBusy(true);
        try {
          const fh = await currentDir.getFileHandle('preview.jpg');
          const f = await fh.getFile();
          onFileChosen(f, (m) => setMsg(m), { maxBytes: WS_MAX_MEDIA });
          closeImportModal();
        } catch (e) { setMsg('读取 preview.jpg 失败'); setBusy(false); }
      };

      const importFile = async (fh, name) => {
        setBusy(true);
        try {
          const f = await fh.getFile();
          onFileChosen(f, (m) => setMsg(m), { maxBytes: WS_MAX_MEDIA });
          closeImportModal();
        } catch (e) { setMsg('读取失败: ' + ((e && e.message) || e)); setBusy(false); }
      };

      const ovStyle = { position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', pointerEvents: 'auto' };
      const boxStyle = { display: 'flex', flexDirection: 'column', gap: 12, width: 'min(560px, 94vw)', maxHeight: '82vh', overflow: 'auto', background: 'var(--dsw-specific-menu, #1c1f27)', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4))', borderRadius: 14, padding: 16, boxShadow: '0 12px 48px rgba(0,0,0,0.6)' };
      const titleStyle = { fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #fff)' };
      const subStyle = { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #bbb)', lineHeight: '20px' };

      let body = null;
      if (step === 'root') {
        body = React.createElement(React.Fragment, null,
          React.createElement('div', { style: titleStyle }, '从 Wallpaper 导入'),
          React.createElement('div', { style: subStyle }, '选择 Wallpaper Engine 的创意工坊文件夹（通常为 …steamapps\\workshop\\content\\431960）。插件会自动识别：直接 mp4/jpg、scene.pkg 内的图片/视频，失败时可用 preview.jpg 或手动选文件。'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
            React.createElement('button', { onClick: pickRoot, disabled: busy, style: btnStyle }, '选择创意工坊文件夹…'),
            hasStored && React.createElement('button', { onClick: useStored, disabled: busy, style: btnStyle }, '使用上次的文件夹'),
            React.createElement('button', { onClick: pickPkgFile, disabled: busy, style: btnStyle }, '选择 scene.pkg 文件…')),
        );
      } else if (step === 'items') {
        body = React.createElement(React.Fragment, null,
          React.createElement('div', { style: titleStyle }, '选择要导入的壁纸（' + items.length + ' 个）'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 } },
            items.map((it) => React.createElement('div', {
              key: it.name,
              onClick: () => importItem(it),
              title: it.name + '（' + it.kind + '）',
              style: { cursor: busy ? 'wait' : 'pointer', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))', background: '#111318' },
            },
              it.preview
                ? React.createElement('img', { src: it.preview, alt: it.name, style: { width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', background: '#000' } })
                : it.videoUrl
                  ? React.createElement('video', {
                      src: it.videoUrl,
                      muted: true,
                      playsInline: true,
                      preload: 'metadata',
                      style: { width: '100%', aspectRatio: '16/10', objectFit: 'cover', display: 'block', background: '#000' },
                      onLoadedMetadata: (ev) => { try { const el = ev.currentTarget; const d = el.duration || 0; el.currentTime = (d > 0) ? Math.min(1.5, Math.max(0.05, d * 0.25)) : 0.05; } catch (e) {} },
                      onSeeked: (ev) => { try { ev.currentTarget.pause(); } catch (e) {} },
                    })
                  : React.createElement('div', { style: { width: '100%', aspectRatio: '16/10', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1d26', color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11 } }, it.kind),
              React.createElement('div', { style: { padding: '6px 8px', fontSize: 11, color: 'var(--dsw-alias-label-secondary, #bbb)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, it.name + ' · ' + it.kind),
            ))),
          React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
            React.createElement('button', { onClick: () => setStep('root'), style: btnStyle }, '返回')),
        );
      } else if (step === 'options') {
        body = React.createElement(React.Fragment, null,
          React.createElement('div', { style: titleStyle }, '未能自动提取'),
          React.createElement('div', { style: subStyle }, (msg || '该壁纸未找到可直接使用的图片/视频，请选择一种方式：')),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 } },
            hasPreview && React.createElement('button', { onClick: importPreview, disabled: busy, style: btnStyle }, '使用 preview.jpg（预览图）'),
            React.createElement('button', { onClick: () => { setStep('files'); setMsg(''); }, disabled: busy, style: btnStyle }, '浏览该文件夹中的文件…'),
            React.createElement('button', { onClick: closeImportModal, style: btnStyle }, '取消')),
        );
      } else if (step === 'files') {
        const mediaFiles = currentFiles.filter((f) => /\.(mp4|webm|jpg|jpeg|png|gif)$/i.test(f.name));
        const others = currentFiles.filter((f) => !/\.(mp4|webm|jpg|jpeg|png|gif)$/i.test(f.name));
        const rows = mediaFiles.concat(others).slice(0, 200);
        body = React.createElement(React.Fragment, null,
          React.createElement('div', { style: titleStyle }, '选择文件'),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '50vh', overflow: 'auto' } },
            rows.map((f) => React.createElement('button', {
              key: f.name,
              onClick: () => importFile(f.handle, f.name),
              title: fmtBytes(f.size),
              style: Object.assign({}, btnStyle, { textAlign: 'left', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }),
            },
              React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name),
              React.createElement('span', { style: { flex: 'none', color: 'var(--dsw-alias-label-tertiary, #888)' } }, fmtBytes(f.size))))),
          React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
            React.createElement('button', { onClick: () => setStep('options'), style: btnStyle }, '返回')),
        );
      }

      return React.createElement('div', { style: ovStyle, onClick: closeImportModal },
        React.createElement('div', { style: boxStyle, onClick: (ev) => ev.stopPropagation() },
          busy && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #bbb)' } }, msg || '处理中…'),
          !busy && msg && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary, #d97706)' } }, msg),
          body,
        ),
      );
    }

    function onFileChosen(file, onError, opts) {
      if (!file) return;
      const maxBytes = (opts && opts.maxBytes) || MAX_UPLOAD_BYTES;
      const canRead = typeof FileReader !== 'undefined' || (typeof file.stream === 'function' && typeof ReadableStream !== 'undefined');
      if (!canRead) { if (onError) onError('当前环境不支持本地上传'); return; }
      if (uploadProgress.get()) { if (onError) onError('已有文件正在读取，请先等待完成或点击取消'); return; }
      try {
        if (file.size > maxBytes) {
          if (onError) onError('文件过大（' + fmtBytes(file.size) + '），超过上限 ' + fmtBytes(maxBytes) + '，请压缩后再上传');
          return;
        }
        const isVideo = /^video\//i.test(file.type || '') || /\.(mp4|webm|ogv|ogg|mov)$/i.test(file.name || '');
        const name = file.name || (isVideo ? '视频' : '图片');
        if (file.size > SOFT_WARN_BYTES) {
          try { if (onError) onError('文件较大（' + fmtBytes(file.size) + '），读取与播放会占用较多内存，若卡顿建议压缩后再试'); } catch (e) {}
        }
        uploadProgress.set({ name, loaded: 0, total: file.size || 0, canceled: false });
        // 视频不生成 dataUrl (用 Blob+objectURL, 省内存), 图片需要 dataUrl
        const { promise, cancel } = readFileWithProgress(file, (loaded, total) => {
          const cur = uploadProgress.get();
          if (cur) uploadProgress.set({ ...cur, loaded, total });
        }, !isVideo);
        activeUploadCancel = () => {
          try {
            const cur = uploadProgress.get();
            if (cur) uploadProgress.set({ ...cur, canceled: true });
          } catch (e) {}
          cancel();
        };
        promise.then(({ blob, dataUrl }) => {
          activeUploadCancel = null;
          uploadProgress.set(null);
          if (isVideo) {
            // 视频: 跳过裁剪编辑器, 直接应用为动态壁纸 (静音循环播放)
            const s = store.get();
            const id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const item = { id, name, blob, w: 0, h: 0, isVideo: true };
            const thumb = (opts && opts.thumb) || null;
            if (thumb) item.thumb = thumb; // 创意工坊导入: 直接用 preview.jpg 作视频缩略图
            commit({ ...s, enabled: true, kind: 'upload', value: id, uploads: s.uploads.concat([item]).slice(-5) });
            if (!thumb) captureVideoThumb(item);
          } else if (opts && opts.applyAsImage) {
            // 直接应用为图片壁纸 (创意工坊分尸/无法裁剪提取时用 preview, 跳过裁剪编辑器)
            const s = store.get();
            const id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const item = { id, name, dataUrl, w: 0, h: 0, crop: { zoom: 1, x: 50, y: 50 } };
            commit({ ...s, enabled: true, kind: 'upload', value: id, uploads: s.uploads.concat([item]).slice(-5) });
            captureImageThumb(item);
          } else {
            editor.set({ open: true, id: null, pending: { dataUrl, name, w: 0, h: 0 } });
          }
        }).catch((e) => {
          activeUploadCancel = null;
          uploadProgress.set(null);
          if (e && e.message === 'canceled') return; // 用户主动取消, 不报错
          if (onError) onError('读取文件失败，请重试');
        });
      } catch (e) {
        uploadProgress.set(null);
        if (onError) onError('读取文件失败');
      }
    }

    const btnStyle = {
      padding: '6px 12px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4))',
      background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.08))',
      color: 'var(--dsw-alias-label-primary, #ddd)',
      cursor: 'pointer',
      fontSize: 13,
    };

    // 服务器目录创意工坊壁纸提取 (通过 scripts/extract_scene_pkg.py)
    function WorkshopServerExtract() {
      const [folder, setFolder] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [msg, setMsg] = React.useState('');
      const [job, setJob] = React.useState(null);
      const [files, setFiles] = React.useState([]);

      const extract = async () => {
        const f = folder.trim();
        if (!f) { setMsg('请先输入创意工坊条目文件夹的完整路径'); return; }
        setBusy(true); setMsg('正在调用 extract_scene_pkg.py 提取…'); setFiles([]); setJob(null);
        try {
          const res = await fetch('/api/wallpaper-workshop/extract?folder=' + encodeURIComponent(f), { headers: { Accept: 'application/json' } });
          const data = await res.json();
          if (!data.ok) {
            let why = data.message || '提取失败';
            if (data.stdout) {
              const lines = String(data.stdout).split('\n').filter(Boolean);
              const last = lines[lines.length - 1];
              if (last) why += '（' + last + '）';
            }
            setMsg(why);
          } else {
            setJob(data.job);
            setFiles(data.files || []);
            setMsg('提取成功：' + (data.files || []).length + ' 个文件');
          }
        } catch (e) { setMsg('请求失败：' + ((e && e.message) || e)); }
        setBusy(false);
      };

      const fileUrl = (name) => '/api/wallpaper-workshop/file?job=' + encodeURIComponent(job) + '&name=' + encodeURIComponent(name);

      const card = (f) => {
        const src = fileUrl(f.name);
        let media = null;
        if (f.kind === 'mp4' || f.kind === 'webm') {
          media = React.createElement('video', { src, muted: true, playsInline: true, loop: true, controls: true, style: { width: '100%', maxHeight: 240, background: '#000', borderRadius: 8 } });
        } else if (f.kind === 'jpg' || f.kind === 'png' || f.kind === 'gif') {
          media = React.createElement('img', { src, alt: f.name, style: { width: '100%', maxHeight: 240, objectFit: 'contain', background: '#000', borderRadius: 8 } });
        } else {
          media = React.createElement('div', { style: { height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#16181f', borderRadius: 8, color: 'var(--dsw-alias-label-tertiary, #888)', fontSize: 11 } }, String(f.kind) + ' · ' + fmtBytes(f.size));
        }
        return React.createElement('div', { key: f.name, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          media,
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
            React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #bbb)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name + ' · ' + fmtBytes(f.size)),
            React.createElement('a', { href: src, download: f.name, style: btnStyle, title: '下载 ' + f.name }, '下载'),
          ),
        );
      };

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.25))', paddingTop: 12, marginTop: 4 } },
        React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, '创意工坊壁纸提取（服务器目录）'),
        React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)', lineHeight: '18px' } }, '输入 Wallpaper Engine 创意工坊条目文件夹的完整路径（…steamapps\\workshop\\content\\431960\\<id>），插件会调用内置的 scripts/extract_scene_pkg.py 解析 scene.pkg / .tex 并提取最佳壁纸，可预览与下载。需要运行 DSH 的机器装有 Python 3。'),
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          React.createElement('input', { type: 'text', value: folder, placeholder: '例如 D:\\Steam\\steamapps\\workshop\\content\\431960\\1234567890', onChange: (e) => setFolder(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') extract(); }, style: { flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4))', background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.05))', color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12 } }),
          React.createElement('button', { onClick: extract, disabled: busy, style: btnStyle }, busy ? '提取中…' : '提取'),
        ),
        msg && React.createElement('div', { style: { fontSize: 12, color: busy ? 'var(--dsw-alias-label-secondary, #bbb)' : 'var(--dsw-alias-state-warn-primary, #d97706)' } }, msg),
        files.length > 0 && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 } }, files.map(card)),
      );
    }

    function SettingsPage() {
      const s = useStore(store);
      const up = useStore(uploadProgress);
      const [hint, setHint] = React.useState('');
      // 为没有缩略图的上传项(历史图片/视频)逐个生成首帧缩略图, 串行执行避免同时解码多个大图/视频。
      // 跳过 thumbFailed 项: 失败过一次就不再反复重试, 否则会形成
      // commit→重渲染→再生成→commit 的无限循环, 让设置页卡死。
      React.useEffect(() => {
        let cancelled = false;
        const need = (s.uploads || []).filter((u) => !u.thumb && !u.thumbFailed && !thumbQueue.has(u.id));
        let idx = 0;
        const next = () => {
          if (cancelled || idx >= need.length) return;
          const u = need[idx++];
          const run = u.isVideo ? captureVideoThumb : captureImageThumb;
          run(u, () => next());
        };
        next();
        return () => { cancelled = true; };
      }, [s.uploads]);
      const isActive = (kind, id) => s.enabled && s.kind === kind && s.value === id;
      const thumb = (bg, kind, id, onClick) => React.createElement('div', {
        key: id,
        onClick,
        title: id,
        style: {
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 10,
          cursor: 'pointer',
          backgroundImage: bg,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          boxSizing: 'border-box',
          border: isActive(kind, id) ? '2px solid var(--dsw-alias-brand-primary, #5b8cff)' : '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
        },
      });

      const videoNode = (u) => React.createElement('div', { key: u.id, style: { position: 'relative' } },
        (u.thumb
          ? React.createElement('img', {
              src: u.thumb,
              title: u.name || '视频',
              alt: u.name || '视频',
              onClick: () => selectUpload(u.id),
              style: {
                width: '100%',
                aspectRatio: '16 / 10',
                borderRadius: 10,
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
                boxSizing: 'border-box',
                background: '#000',
                border: isActive('upload', u.id) ? '2px solid var(--dsw-alias-brand-primary, #5b8cff)' : '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
              },
            })
          : React.createElement('video', {
              src: videoSource(u),
              muted: true,
              playsInline: true,
              preload: 'metadata',
              autoPlay: false,
              title: u.name || '视频',
              onClick: () => selectUpload(u.id),
              onLoadedMetadata: (ev) => {
                try {
                  const el = ev.currentTarget;
                  const d = el.duration || 0;
                  el.currentTime = (d > 0) ? Math.min(1.5, Math.max(0.05, d * 0.25)) : 0.05; // 显示有内容的帧
                } catch (e) {}
              },
              onSeeked: (ev) => { try { ev.currentTarget.pause(); } catch (e) {} },
              style: {
                width: '100%',
                aspectRatio: '16 / 10',
                borderRadius: 10,
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                background: '#000',
                border: isActive('upload', u.id) ? '2px solid var(--dsw-alias-brand-primary, #5b8cff)' : '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
              },
            })),
        React.createElement('div', { style: { position: 'absolute', left: 4, top: 4, fontSize: 10, background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 5, padding: '1px 6px', pointerEvents: 'none', zIndex: 1 } }, 'MP4 · 循环'),
        React.createElement('button', {
          onClick: () => removeUpload(u.id),
          title: '删除该壁纸',
          'aria-label': '删除该壁纸',
          style: { position: 'absolute', bottom: 4, right: 4, width: 22, height: 22, lineHeight: '18px', borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 14, padding: 0, zIndex: 1 },
        }, '\u00d7'),
      );

      const uploadNode = (u) => u.isVideo ? videoNode(u) : React.createElement('div', { key: u.id, style: { position: 'relative' } },
        (u.thumb
          ? React.createElement('img', {
              src: u.thumb,
              alt: u.name || '图片',
              title: u.name || '图片',
              decoding: 'async',
              onClick: () => selectUpload(u.id),
              style: {
                width: '100%',
                aspectRatio: '16 / 10',
                borderRadius: 10,
                objectFit: 'cover',
                display: 'block',
                cursor: 'pointer',
                boxSizing: 'border-box',
                background: '#1a1d26',
                border: isActive('upload', u.id) ? '2px solid var(--dsw-alias-brand-primary, #5b8cff)' : '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
              },
            })
          : React.createElement('div', {
              title: u.name || '图片',
              style: {
                width: '100%',
                aspectRatio: '16 / 10',
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxSizing: 'border-box',
                background: '#1a1d26',
                color: 'var(--dsw-alias-label-tertiary, #888)',
                fontSize: 11,
                border: isActive('upload', u.id) ? '2px solid var(--dsw-alias-brand-primary, #5b8cff)' : '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.35))',
              },
            }, '缩略图生成中…')),
        React.createElement('button', {
          onClick: () => openEditor(u.id),
          title: '预览/调整裁剪',
          'aria-label': '预览/调整裁剪',
          style: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, lineHeight: '18px', borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 12, padding: 0, zIndex: 1 },
        }, '\uD83D\uDC41'),
        React.createElement('button', {
          onClick: () => removeUpload(u.id),
          title: '删除该壁纸',
          'aria-label': '删除该壁纸',
          style: { position: 'absolute', bottom: 4, right: 4, width: 22, height: 22, lineHeight: '18px', borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 14, padding: 0, zIndex: 1 },
        }, '\u00d7'),
      );

      const sliderRow = (label, value, onChange) => React.createElement('div', { key: label, style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement('span', { style: { fontSize: 13, flex: 'none', minWidth: 84 } }, label),
        React.createElement('input', { type: 'range', min: 0, max: 100, value: value, style: { flex: 1 }, onChange: (ev) => onChange(Number(ev.target.value)) }),
        React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)', flex: 'none', width: 36, textAlign: 'right' } }, value + '%'),
      );

      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 16px' } },
        React.createElement('div', { style: { fontSize: 15, fontWeight: 600 } }, '壁纸'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 } },
          BUILTINS.map((b) => thumb(b.css, 'builtin', b.id, () => selectBuiltin(b.id)))),
        (s.uploads.length > 0) && React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)' } }, '我的上传（图片原图不压缩 · 视频壁纸自动静音循环播放）'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 } }, s.uploads.map(uploadNode))),
        (up) && React.createElement('div', { key: 'up-progress', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)' } },
            React.createElement('span', { style: { flex: 'none', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, up.name),
            React.createElement('span', { style: { flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
              up.total > 0 ? Math.round((100 * up.loaded) / up.total) + '%（' + fmtBytes(up.loaded) + ' / ' + fmtBytes(up.total) + '）' : '读取中…')),
          React.createElement('div', { style: { height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--dsw-alias-fill-l1, rgba(128,128,128,0.22))' } },
            React.createElement('div', { style: { height: '100%', borderRadius: 3, background: 'var(--dsw-alias-brand-primary, #5b8cff)', transition: 'width .12s linear', width: up.total > 0 ? Math.max(2, Math.min(100, Math.round((100 * up.loaded) / up.total))) + '%' : '35%' } })),
          React.createElement('button', { onClick: cancelUpload, style: Object.assign({}, btnStyle, { padding: '2px 12px', fontSize: 12, alignSelf: 'flex-end' }) }, '取消')),
        React.createElement('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
          React.createElement('label', { style: { ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: up ? 0.5 : 1, pointerEvents: up ? 'none' : 'auto' } },
            up ? '读取中…' : '上传图片 / MP4 视频',
            React.createElement('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,video/ogg', style: { display: 'none' }, onChange: (e) => {
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              onFileChosen(f, (m) => setHint(m));
              e.target.value = '';
            } })),
          React.createElement('button', { onClick: randomize, style: btnStyle }, '随机'),
          React.createElement('button', { onClick: resetWallpaper, style: btnStyle }, '恢复默认'),
          React.createElement('button', { onClick: openImportModal, style: btnStyle }, '从 Wallpaper 导入')),
        hint && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary, #d97706)' } }, hint),
        React.createElement(WorkshopServerExtract),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, '区域不透明度（0% = 完全透明露出壁纸，100% = 完全不透明；中间对话仅作用于对话区，设置面板等不受影响）'),
          sliderRow('左侧边栏', s.opLeft, setOpLeft),
          sliderRow('中间对话', s.opMid, setOpMid),
          HAS_BETTER_SIDEBAR && sliderRow('右侧边栏', s.opRight, setOpRight)),
        !s.enabled && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)' } }, '当前未启用壁纸，点击上方任意一张启用。'),
        React.createElement(EditorModal),
        React.createElement(WallpaperImportModal),
      );
    }

    function EditorModal() {
      const e = useStore(editor);
      const s = useStore(store);
      const [crop, setCrop] = React.useState({ zoom: 1, x: 50, y: 50 });
      const dragRef = React.useRef(null);

      React.useEffect(() => {
        if (!e.open) return;
        let base = { zoom: 1, x: 50, y: 50 };
        if (e.id) {
          const u = (s.uploads || []).find((x) => x.id === e.id);
          if (u && u.crop) base = { zoom: u.crop.zoom || 1, x: u.crop.x == null ? 50 : u.crop.x, y: u.crop.y == null ? 50 : u.crop.y };
        }
        setCrop(base);
      }, [e.open, e.id]);

      React.useEffect(() => {
        if (!e.open) return;
        let src = null;
        let known = false;
        if (e.pending) {
          src = e.pending.dataUrl;
          known = !!(e.pending.w && e.pending.h);
        } else {
          const u = (s.uploads || []).find((x) => x.id === e.id);
          if (u) {
            src = u.dataUrl;
            known = !!(u.w && u.h);
          }
        }
        if (!src || known) return;
        try {
          const img = new Image();
          img.onload = () => {
            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            if (!w || !h) return;
            if (e.pending) {
              editor.set({ ...editor.get(), pending: { ...e.pending, w, h } });
            } else {
              const st = store.get();
              const uploads = (st.uploads || []).map((x) => (x.id === e.id ? { ...x, w, h } : x));
              commit({ ...st, uploads });
            }
          };
          img.src = src;
        } catch (_) {}
      }, [e.open, e.id]);

      if (!e.open) return null;
      let src = null;
      let name = '';
      let w = 0;
      let h = 0;
      if (e.pending) {
        src = e.pending.dataUrl;
        name = e.pending.name;
        w = e.pending.w;
        h = e.pending.h;
      } else {
        const u = (s.uploads || []).find((x) => x.id === e.id);
        if (u) {
          src = u.dataUrl;
          name = u.name || '图片';
          w = u.w || 0;
          h = u.h || 0;
        }
      }
      if (!src) return null;

      let aspect = 16 / 9;
      try {
        if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
          aspect = window.innerWidth / window.innerHeight;
        }
      } catch (_) {}
      const opMid = clamp(s.opMid == null ? 50 : s.opMid, 0, 100);
      const scrimA = (opMid / 100).toFixed(3);
      const boxWidth = 'min(92vw, calc(72vh * ' + aspect.toFixed(4) + '))';
      const ratio = w && h ? w / h : aspect;
      const coverW = Math.max(100, (100 * ratio) / aspect);
      const bgSize = (coverW * crop.zoom).toFixed(2) + '%';

      const onPointerDown = (ev) => {
        dragRef.current = { x: ev.clientX, y: ev.clientY };
        try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (_) {}
      };
      const onPointerMove = (ev) => {
        const d = dragRef.current;
        if (!d) return;
        const rect = ev.currentTarget.getBoundingClientRect();
        const dx = ev.clientX - d.x;
        const dy = ev.clientY - d.y;
        dragRef.current = { x: ev.clientX, y: ev.clientY };
        if (rect.width > 0 && rect.height > 0) {
          setCrop((c) => ({ ...c, x: Math.max(0, Math.min(100, c.x - (dx / rect.width) * 100)), y: Math.max(0, Math.min(100, c.y - (dy / rect.height) * 100)) }));
        }
      };
      const onPointerUp = (ev) => {
        dragRef.current = null;
        try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch (_) {}
      };

      return React.createElement('div', {
        style: { position: 'fixed', inset: 0, zIndex: 2147483000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', pointerEvents: 'auto' },
        onClick: closeEditor,
      },
        React.createElement('div', {
          onClick: (ev) => ev.stopPropagation(),
          style: { display: 'flex', flexDirection: 'column', gap: 12, width: boxWidth, maxWidth: '94vw' },
        },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600, color: '#fff' } }, '调整壁纸 — ' + name + '（原图 ' + (w ? w + '×' + h : '读取中…') + '）'),
          React.createElement('div', {
            onPointerDown,
            onPointerMove,
            onPointerUp,
            style: {
              width: '100%',
              aspectRatio: aspect.toFixed(4),
              borderRadius: 12,
              overflow: 'hidden',
              position: 'relative',
              boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
              cursor: 'grab',
              touchAction: 'none',
              backgroundImage: "url('" + src + "')",
              backgroundSize: bgSize,
              backgroundPosition: crop.x + '% ' + crop.y + '%',
              backgroundRepeat: 'no-repeat',
            },
          },
            React.createElement('div', { style: { position: 'absolute', inset: 0, background: 'rgba(10,12,18,' + scrimA + ')', pointerEvents: 'none' } }),
            React.createElement('div', { style: { position: 'absolute', left: 10, top: 8, fontSize: 11, color: 'rgba(255,255,255,0.9)', background: 'rgba(0,0,0,0.45)', borderRadius: 6, padding: '2px 8px', pointerEvents: 'none' } }, '拖动图片调整位置'),
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #bbb)' } }, '缩放 ' + Math.round(crop.zoom * 100) + '%'),
            React.createElement('input', { type: 'range', min: 100, max: 250, value: Math.round(crop.zoom * 100), style: { flex: 1 }, onChange: (ev) => setCrop((c) => ({ ...c, zoom: Number(ev.target.value) / 100 })) }),
            React.createElement('button', { onClick: () => setCrop({ zoom: 1, x: 50, y: 50 }), style: Object.assign({}, btnStyle, { padding: '4px 10px' }) }, '重置'),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'flex-end' } },
            React.createElement('button', { onClick: closeEditor, style: Object.assign({}, btnStyle, { color: 'var(--dsw-alias-label-secondary, #bbb)' }) }, '取消'),
            React.createElement('button', { onClick: () => commitEditor(crop), style: Object.assign({}, btnStyle, { borderColor: 'var(--dsw-alias-brand-primary, #5b8cff)' }) }, '应用此壁纸')),
        ),
      );
    }

    function loadPersisted() {
      Promise.resolve().then(async () => {
        try {
          if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return;
          const raw = localStorage.getItem(KEY);
          if (!raw) return;
          const p = JSON.parse(raw);
          if (!p || typeof p !== 'object') return;
          const v = p.version;
          if (v < 1 || v > 4) return;
          const isOld = v !== 4;
          let uploads = Array.isArray(p.uploads) ? p.uploads : [];
          if (uploads.length === 0) {
            const idbU = await idbGet(IDB_UPLOADS_KEY);
            if (Array.isArray(idbU)) uploads = idbU;
          }
          const next = {
            version: 4,
            enabled: !!p.enabled,
            kind: (p.kind === 'builtin' || p.kind === 'upload') ? p.kind : null,
            value: p.value || null,
            opLeft: (isOld || typeof p.opLeft !== 'number') ? 60 : clamp(p.opLeft, 0, 100),
            opMid: (isOld || typeof p.opMid !== 'number') ? 50 : clamp(p.opMid, 0, 100),
            opRight: (isOld || typeof p.opRight !== 'number') ? 70 : clamp(p.opRight, 0, 100),
            uploads: uploads.filter((u) => u && typeof u.id === 'string' && (typeof u.dataUrl === 'string' || !!u.blob)).slice(-5),
          };
          if (next.enabled && next.kind && !resolveValue(next)) next.enabled = false;
          commit(next);
        } catch (e) {}
      });
    }

    // =====================================================================
    // 余额/用量功能 (merged from dsh-balance-widget)
    // =====================================================================

    var CSS_TAG = "dsh-balance-widget/styles";
    var CSS =
      ".bw-root{position:relative;display:inline-flex}" +
      ".bw-trigger{min-height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;" +
      "border:0;border-radius:8px;align-items:center;justify-content:center;gap:6px;padding:4px 10px;" +
      "font-size:14px;line-height:22px;display:inline-flex;font-variant-numeric:tabular-nums;text-align:center}" +
      ".bw-trigger:hover,.bw-trigger:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}" +
      ".bw-dot{width:8px;height:8px;border-radius:50%;flex:none}" +
      ".bw-dot-ok{background:#22c55e}.bw-dot-bad{background:#ef4444}.bw-dot-neutral{background:var(--dsw-alias-border-l3)}" +
      ".bw-pop{z-index:120;box-sizing:border-box;width:320px;border:1px solid var(--dsw-alias-border-l2);" +
      "background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;" +
      "padding:12px 14px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-secondary);" +
      "position:absolute;top:calc(100% + 5px);right:0;flex-direction:column;gap:4px;display:flex;text-align:center;" +
      "max-height:72vh;overflow-y:auto}" +
      ".bw-row{display:flex;align-items:center;justify-content:center;gap:10px}" +
      ".bw-row dd{margin:0;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}" +
      ".bw-sub{color:var(--dsw-alias-label-tertiary);text-align:center}" +
      ".bw-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;text-align:center}" +
      ".bw-div{height:1px;background:var(--dsw-alias-border-l1);margin:7px 0}" +
      ".bw-tok{display:flex;align-items:center;justify-content:center;gap:6px}" +
      ".bw-input{flex:1;min-width:0;max-width:190px;box-sizing:border-box;height:28px;border:1px solid var(--dsw-alias-border-l2);" +
      "border-radius:6px;background:var(--dsw-alias-fill-l1);color:var(--dsw-alias-label-primary);" +
      "padding:0 8px;font-size:13px;outline:0}" +
      ".bw-input:focus{border-color:var(--dsw-alias-border-accent)}" +
      ".bw-btn{background:0 0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);" +
      "cursor:pointer;border-radius:6px;padding:2px 12px;font-size:13px;line-height:22px;flex:none}" +
      ".bw-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
      ".bw-btn:disabled{opacity:.5;cursor:default}" +
      ".bw-foot{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}" +
      ".bw-link{color:var(--dsw-alias-label-secondary);text-decoration:none;" +
      "border-bottom:1px dashed var(--dsw-alias-border-l2);padding:0 2px}" +
      ".bw-link:hover{color:var(--dsw-alias-label-primary)}" +
      ".bw-err{color:var(--dsw-danger-fg,#ef4444)}";

    function injectStyles() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]')) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-balance-widget";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var zh = {
      loading: "余额加载中…",
      balance: "余额",
      today: "今日已消费",
      todayTitle: "今日已消费：配置平台 Token 后显示平台真实数据，否则为余额差值估算（≈）",
      session: "本会话",
      sessionTitle: "本会话 token 用量与估算费用（价格表在 index.js，仅估算）",
      grant: "赠送",
      recharge: "充值",
      refresh: "刷新",
      usage: "用量",
      usageTitle: "打开 DeepSeek 平台用量页",
      clockTitle: "最近刷新时间",
      estimate: "估算",
      official: "平台",
      errFetch: "查询失败",
      unpriced: "未定价",
      unpricedHint: "部分请求的模型不在官方价目表中（如第三方提供商），仅计入 tokens，费用未估算。",
      formulaTitle: "费用 = tokens × 官方价目表单价（¥/百万 tokens，峰谷分时）",
      window: "时段",
      windowTitle: "会话费用按每条消息实际发生时段（高峰/低谷）与当时生效的价格计算",
      peak: "高峰",
      offPeak: "低谷",
      nowPeak: "当前为高峰时段",
      nowOffPeak: "当前为低谷时段",
      models: "分模型",
      modelsTitle: "各模型独立计费：切换模型后，历史消耗仍按原模型及其当时价格单独记录",
      modelUnpriced: "未定价",
      openDetails: "DeepSeek 余额与用量"
    };
    var en = {
      loading: "Loading balance…",
      balance: "Balance",
      today: "Today used",
      todayTitle: "Today's consumption: official platform data when the platform token is set, else a balance-delta estimate (≈)",
      session: "This session",
      sessionTitle: "This session's token usage and estimated cost (price table in index.js; estimate only)",
      grant: "Granted",
      recharge: "Topped up",
      refresh: "Refresh",
      usage: "Usage",
      usageTitle: "Open DeepSeek platform usage page",
      clockTitle: "Last refreshed",
      estimate: "estimate",
      official: "platform",
      errFetch: "Query failed",
      unpriced: "unpriced",
      unpricedHint: "Some requests used models absent from the official price list (e.g. third-party providers); tokens are counted, cost is not estimated.",
      formulaTitle: "cost = tokens × official unit price (¥/1M tokens, peak/valley windows)",
      window: "Window",
      windowTitle: "Session cost is priced per message by its actual time window (peak/valley) and the rate in effect at that time",
      peak: "Peak",
      offPeak: "Valley",
      nowPeak: "Peak window now",
      nowOffPeak: "Valley window now",
      models: "By model",
      modelsTitle: "Per-model accounting: after switching models, past usage stays billed at the old model's then-current rate",
      modelUnpriced: "unpriced",
      openDetails: "DeepSeek balance & usage"
    };

    function money(value, currency) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "—";
      var sign = value < 0 ? "-" : "";
      var s = Math.abs(value).toFixed(2);
      return sign + (currency === "CNY" ? "¥" : currency + " ") + s;
    }

    function tokensLabel(n) {
      if (!n) return "0";
      if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
      return String(n);
    }

    function rateText(r) {
      if (typeof r !== "number" || !Number.isFinite(r)) return "—";
      var s = r >= 1 ? r.toFixed(2) : r.toFixed(4);
      s = s.replace(/0+$/, "").replace(/\.$/, "");
      return s === "" ? "0" : s;
    }

    function clock(ts) {
      var d = new Date(ts);
      var p = function (x) {
        return String(x).padStart(2, "0");
      };
      return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    function fallbackT(key) {
      return zh[key] || key;
    }

    // The platform token (DEEPSEEK_PLATFORM_TOKEN) is read from DSH's credential
    // store by the host (ctx.credentials.resolve), same as DEEPSEEK_API_KEY and
    // OPENCODE_GO_API_KEY — the browser never handles it.

    function BalanceWidget(props) {
      var sessionId = props.sessionId;
      var t = typeof props.t === "function" ? props.t : fallbackT;
      var useState = react.useState;
      var useEffect = react.useEffect;
      var useCallback = react.useCallback;
      var useRef = react.useRef;

      var dataRef = useState(null);
      var data = dataRef[0];
      var setData = dataRef[1];
      var costRef = useState(null);
      var cost = costRef[0];
      var setCost = costRef[1];
      var errRef = useState(null);
      var err = errRef[0];
      var setErr = errRef[1];
      var openRef = useState(false);
      var open = openRef[0];
      var setOpen = openRef[1];
      var nowRef = useState(function () {
        return Date.now();
      });
      var now = nowRef[0];
      var setNow = nowRef[1];
      var rootRef = useRef(null);

      var refreshBalance = useCallback(function () {
        fetch("/api/deepseek-balance", { headers: { Accept: "application/json" } })
          .then(function (r) {
            return r.json();
          })
          .then(function (d) {
            setData(d);
            setErr(d && d.ok === false ? d.message || "查询失败" : null);
            setNow(Date.now());
          })
          .catch(function (e) {
            setErr(String((e && e.message) || e));
            setNow(Date.now());
          });
      }, []);

      var refreshCost = useCallback(
        function () {
          if (!sessionId) return;
          fetch(
            "/api/deepseek-session-cost?sessionId=" + encodeURIComponent(sessionId),
            { headers: { Accept: "application/json" } }
          )
            .then(function (r) {
              return r.json();
            })
            .then(function (d) {
              if (d && d.ok) setCost(d);
            })
            .catch(function () {});
        },
        [sessionId]
      );

      useEffect(function () {
        refreshBalance();
        var id = setInterval(refreshBalance, 60000);
        return function () {
          clearInterval(id);
        };
      }, [refreshBalance]);

      useEffect(function () {
        refreshCost();
        var id = setInterval(refreshCost, 20000);
        return function () {
          clearInterval(id);
        };
      }, [refreshCost]);

      useEffect(function () {
        if (!open) return;
        var onDown = function (e) {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        var onKey = function (e) {
          if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return function () {
          document.removeEventListener("mousedown", onDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      var ok = !!(data && data.ok);
      var bal = ok ? data.balance : null;
      var infos = bal && Array.isArray(bal.balance_infos) ? bal.balance_infos : [];
      var first = infos.length > 0 ? infos[0] : null;
      var currency = first && first.currency ? first.currency : "CNY";
      var total = first ? parseFloat(first.total_balance) : NaN;
      var granted = first ? parseFloat(first.granted_balance) : NaN;
      var topped = first ? parseFloat(first.topped_up_balance) : NaN;
      var available = ok && !!bal.is_available;

      var today = ok ? data.todayConsumed : null;
      var todayValue =
        today === null || today === undefined
          ? "—"
          : data.todayConsumedSource === "official"
            ? money(today, currency)
            : "≈" + money(today, currency);

      var tokens = cost ? (cost.inputTokens || 0) + (cost.cacheReadTokens || 0) + (cost.outputTokens || 0) : 0;
      var sessionValue = cost
        ? cost.priced === false
          ? tokensLabel(tokens) + " tokens · " + t("unpriced")
          : tokensLabel(tokens) + " tokens · ≈" + money(cost.cost, "CNY")
        : "—";
      var sessionShort = cost ? "≈" + money(cost.cost, "CNY") : "—";

      var dotCls = "bw-dot ";
      dotCls += err ? "bw-dot-bad" : !data ? "bw-dot-neutral" : available ? "bw-dot-ok" : "bw-dot-bad";

      var todayShort =
        today === null || today === undefined
          ? "—"
          : data.todayConsumedSource === "official"
            ? money(today, currency)
            : "≈" + money(today, currency);

      var balanceShort = err || !data ? "—" : Number.isFinite(total) ? money(total, currency) : "—";
      var buttonLabel =
        balanceShort + " · " + t("today") + " " + todayShort + " · " + t("session") + " " + sessionShort;
      var buttonTitle =
        t("openDetails") + ": " + (err || (Number.isFinite(total) ? money(total, currency) : "—"));

      var toggle = function () {
        setOpen(function (v) {
          return !v;
        });
      };

      var onRefreshAll = function () {
        refreshBalance();
        refreshCost();
        setNow(Date.now());
      };

      var sub = [];
      if (Number.isFinite(granted) && granted > 0) sub.push(t("grant") + " " + money(granted, currency));
      if (Number.isFinite(topped) && topped > 0) sub.push(t("recharge") + " " + money(topped, currency));

      var popChildren = [];
      popChildren.push(
        jsxs("div", {
          key: "r1",
          className: "bw-row",
          children: [
            jsx("dt", { children: t("balance") }),
            jsxs("dd", {
              children: [
                jsx("span", { key: "d", className: dotCls, "aria-hidden": true }),
                " " + (Number.isFinite(total) ? money(total, currency) : "—")
              ]
            })
          ]
        })
      );
      if (sub.length > 0) {
        popChildren.push(jsx("div", { key: "r1b", className: "bw-row bw-sub", children: sub.join(" · ") }));
      }
      popChildren.push(
        jsxs("div", {
          key: "r2",
          className: "bw-row",
          children: [
            jsx("dt", { title: t("todayTitle"), children: t("today") }),
            jsx("dd", {
              children:
                todayValue +
                (today === null || today === undefined
                  ? ""
                  : " (" + (data.todayConsumedSource === "official" ? t("official") : t("estimate")) + ")")
            })
          ]
        })
      );
      popChildren.push(
        jsxs("div", {
          key: "r3",
          className: "bw-row",
          children: [
            jsx("dt", { title: t("sessionTitle"), children: t("session") }),
            jsx("dd", { children: sessionValue })
          ]
        })
      );
      if (cost && cost.windows) {
        popChildren.push(
          jsxs("div", {
            key: "r3w",
            className: "bw-row",
            children: [
              jsx("dt", { title: t("windowTitle"), children: t("window") }),
              jsx("dd", {
                children:
                  t("peak") +
                  " " +
                  money(cost.windows.peak.cost, "CNY") +
                  " / " +
                  t("offPeak") +
                  " " +
                  money(cost.windows.offPeak.cost, "CNY")
              })
            ]
          })
        );
        var winRanges = "";
        if (Array.isArray(cost.peakWindows) && cost.peakWindows.length > 0) {
          var pad2 = function (x) {
            return String(x).padStart(2, "0");
          };
          winRanges = cost.peakWindows
            .map(function (w) {
              return pad2(w.startHour) + "-" + pad2(w.endHour);
            })
            .join(", ");
        }
        popChildren.push(
          jsx("div", {
            key: "r3n",
            className: "bw-sub",
            children:
              (cost.nowPeak ? t("nowPeak") : t("nowOffPeak")) +
              (winRanges !== "" ? " (" + winRanges + ")" : "")
          })
        );
      }
      if (cost && Array.isArray(cost.models) && cost.models.length > 0) {
        var showModels =
          cost.models.length > 1 ||
          cost.models.some(function (m) {
            return m.priced === false;
          });
        if (showModels) {
          popChildren.push(
            jsx("div", {
              key: "mh",
              className: "bw-sub",
              title: t("modelsTitle"),
              children: t("models")
            })
          );
          for (var mi = 0; mi < cost.models.length; mi++) {
            var m = cost.models[mi];
            popChildren.push(
              jsx("div", {
                key: "m-" + mi,
                className: "bw-row bw-sub",
                title: t("modelsTitle"),
                children:
                  m.model +
                  ": " +
                  tokensLabel(m.tokens) +
                  (m.priced === false
                    ? " · " + t("modelUnpriced")
                    : " · ≈" + money(m.cost, "CNY"))
              })
            );
          }
        }
      }
      if (cost && Array.isArray(cost.breakdown) && cost.breakdown.length > 0) {
        for (var bi = 0; bi < cost.breakdown.length; bi++) {
          var b = cost.breakdown[bi];
          popChildren.push(
            jsx("div", {
              key: "bd-" + bi,
              className: "bw-row bw-sub",
              title: t("formulaTitle"),
              children:
                b.label +
                ": " +
                tokensLabel(b.tokens) +
                " × ¥" +
                rateText(b.rate) +
                "/M = " +
                money(b.subtotal, "CNY")
            })
          );
        }
        if (cost.priced === false) {
          popChildren.push(
            jsx("div", { key: "unpriced", className: "bw-hint", children: t("unpricedHint") })
          );
        }
      }
      if (err) {
        popChildren.push(jsx("div", { key: "err", className: "bw-hint bw-err", children: "⚠ " + err }));
      }
      popChildren.push(jsx("div", { key: "div2", className: "bw-div" }));
      popChildren.push(
        jsxs("div", {
          key: "foot",
          className: "bw-foot",
          children: [
            jsxs("span", {
              children: [
                jsx("button", {
                  key: "rf",
                  type: "button",
                  className: "bw-btn",
                  onClick: onRefreshAll,
                  title: t("refresh"),
                  children: "↻ " + t("refresh")
                }),
                " · ",
                jsx("span", { key: "clk", className: "bw-sub", title: t("clockTitle"), children: clock(now) })
              ]
            }),
            jsx("a", {
              key: "lnk",
              className: "bw-link",
              href: "https://platform.deepseek.com/usage",
              target: "_blank",
              rel: "noreferrer",
              title: t("usageTitle"),
              children: t("usage") + " ↗"
            })
          ]
        })
      );

      return jsxs("div", {
        ref: rootRef,
        className: "bw-root",
        children: [
          jsxs("button", {
            key: "btn",
            type: "button",
            className: "bw-trigger",
            "aria-expanded": open,
            "aria-label": buttonTitle,
            title: buttonTitle,
            onClick: toggle,
            children: [
              jsx("span", { key: "dot", className: dotCls, "aria-hidden": true }),
              jsx("span", { key: "label", children: buttonLabel })
            ]
          }),
          open ? jsxs("div", { key: "pop", className: "bw-pop", children: popChildren }) : null
        ]
      });
    }

    // =====================================================================
    // OpenCode Go plan usage — rolling / weekly / monthly
    // Reuses the same host-route + header-action pattern as the balance widget.
    // =====================================================================

    function formatRemaining(seconds) {
      if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '未知';
      if (seconds <= 0) return '已重置';
      var d = Math.floor(seconds / 86400);
      var h = Math.floor((seconds % 86400) / 3600);
      var m = Math.floor((seconds % 3600) / 60);
      var parts = [];
      if (d > 0) parts.push(d + ' 天');
      if (h > 0) parts.push(h + ' 小时');
      if (m > 0) parts.push(m + ' 分钟');
      return parts.length ? parts.join(' ') : '不足 1 分钟';
    }

    function OpenCodeUsage() {
      var useState = react.useState;
      var useEffect = react.useEffect;
      var useRef = react.useRef;
      var [open, setOpen] = useState(false);
      var [windows, setWindows] = useState([]);
      var [err, setErr] = useState(null);
      var rootRef = useRef(null);

      useEffect(function () {
        var alive = true;
        var load = function () {
          fetch('/api/opencode-go-usage', { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
              if (!alive) return;
              if (d && d.ok) { setWindows((d.data && d.data.windows) || []); setErr(null); }
              else setErr((d && d.message) || (d && d.error) || '查询失败');
            })
            .catch(function (e) { if (alive) setErr('请求失败：' + ((e && e.message) || e)); });
        };
        load();
        var id = setInterval(load, 60000);
        return function () { alive = false; clearInterval(id); };
      }, []);

      useEffect(function () {
        if (!open) return;
        var onDown = function (e) {
          if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
        };
        var onKey = function (e) { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return function () {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);

      var percentOf = function (w) {
        return w && typeof w.percent === 'number' && Number.isFinite(w.percent) ? w.percent : null;
      };
      var shortLabel = function (key) {
        return key === 'rolling' ? '滚动' : key === 'weekly' ? '周' : '月';
      };

      // Collapsed: only the three percentage values.
      var summary = windows.map(function (w) {
        var p = percentOf(w);
        return shortLabel(w.key) + (p === null ? '?' : Math.round(p) + '%');
      }).join(' ');
      var btnLabel = windows.length ? summary : (err ? 'Go 不可用' : 'Go …');

      var bar = function (w) {
        var p = percentOf(w);
        var pct = p === null ? 0 : Math.min(100, Math.max(0, p));
        return React.createElement('div', { key: w.key, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
            React.createElement('span', { style: { fontSize: 12 } }, w.label),
            React.createElement('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } },
              (p === null ? '—' : p.toFixed(0) + '%') + ' · 重置于 ' + formatRemaining(w.resetsInSeconds))),
          React.createElement('div', { style: { height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--dsw-alias-fill-l1, rgba(128,128,128,0.22))' } },
            React.createElement('div', { style: { height: '100%', borderRadius: 3, background: 'var(--dsw-alias-brand-primary, #5b8cff)', width: pct + '%' } })));
      };

      var rowStyle = { position: 'relative' };
      return React.createElement('div', { ref: rootRef, style: rowStyle },
        React.createElement('button', {
          type: 'button',
          onClick: function () { setOpen(!open); },
          title: 'OpenCode Go 用量：点开查看进度条与重置时间',
          'aria-expanded': open,
          style: {
            padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontVariantNumeric: 'tabular-nums',
            border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,0.4))',
            background: 'var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.08))',
            color: 'var(--dsw-alias-label-primary, #ddd)', fontSize: 12,
          },
        }, 'Go ' + btnLabel),
        open && React.createElement('div', {
          onClick: function (ev) { ev.stopPropagation(); },
          style: {
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 2147483000,
            display: 'flex', flexDirection: 'column', gap: 10,
            minWidth: 260, padding: 12, borderRadius: 12,
            background: 'var(--dsw-specific-menu, #1c1f27)',
            border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4))',
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
          },
        },
          React.createElement('div', { style: { fontSize: 14, fontWeight: 600 } }, 'OpenCode Go 用量'),
          err
            ? React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary, #d97706)' } }, err)
            : windows.length
              ? windows.map(bar)
              : React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #bbb)' } }, '暂无数据'),
          React.createElement('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #888)' } }, '点空白处关闭'),
        ),
      );
    }

    // =====================================================================
    // merged plugin body
    // =====================================================================

    function apply(ctx) {
      // ---- wallpaper ----
      const slots = ctx.get('slots');
      const theme = ctx.get('theme');
      if (theme) themeSvc = theme;
      // ---- balance widget ----
      ctx.effect(() => { ctx.locale.register("balance", { zh, en }); }, "merged: balance dictionaries");
      ctx.effect(() => { injectStyles(); }, "merged: balance styles");
      if (slots) {
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'wallpaper', order: 60, label: '壁纸' },
          () => React.createElement(SettingsPage),
        ));
        slots.inject("conversation.session.header.actions", () => slots.register(
          { name: "conversation.session.header.actions", id: "dsh-balance-widget", order: 30, locale: "balance" },
          BalanceWidget,
        ));
        slots.inject("conversation.session.header.actions", () => slots.register(
          { name: "conversation.session.header.actions", id: "dsh-opencode-go-usage", order: 40 },
          OpenCodeUsage,
        ));
      }
      loadPersisted();
    }

    module.exports = { inject: ["slots", "theme", "locale", "connection"], apply };
    return module.exports;
  }
});
