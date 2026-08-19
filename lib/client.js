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
        return u ? "url('" + u.dataUrl + "')" : null;
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

    function applyVideoWallpaper(u) {
      const v = document.createElement('video');
      v.id = 'dsh-wallpaper-video';
      v.setAttribute('data-plugin', 'dsh-wallpaper');
      v.src = u.dataUrl;
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

    function applyWallpaper(next) {
      if (effects) {
        try { if (effects.theme) effects.theme(); } catch (e) {}
        try { if (effects.style) effects.style(); } catch (e) {}
        try { if (effects.video) effects.video(); } catch (e) {}
        effects = null;
      }
      if (!next || !next.enabled || !next.kind || !next.value) return;
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
            const videoDispose = applyVideoWallpaper(uv);
            effects = { theme: themeDispose, style: styleDispose, video: videoDispose };
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
      try { idbPut(IDB_UPLOADS_KEY, next.uploads || []); } catch (e) {}
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
        const uploads = s.uploads.concat([{ id, name: e.pending.name, dataUrl: e.pending.dataUrl, w: e.pending.w || 0, h: e.pending.h || 0, crop: clean }]).slice(-5);
        commit({ ...s, enabled: true, kind: 'upload', value: id, uploads });
      } else if (e.id) {
        const uploads = s.uploads.map((u) => (u.id === e.id ? { ...u, crop: clean } : u));
        commit({ ...s, enabled: true, kind: 'upload', value: e.id, uploads });
      }
      closeEditor();
    }

    function probeVideoDims(item) {
      try {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = () => {
          const w = v.videoWidth || 0;
          const h = v.videoHeight || 0;
          try { v.removeAttribute('src'); v.load(); } catch (e) {}
          if (!w || !h) return;
          const st = store.get();
          const uploads = (st.uploads || []).map((x) => (x.id === item.id ? { ...x, w, h } : x));
          commit({ ...st, uploads });
        };
        v.onerror = () => { try { v.removeAttribute('src'); v.load(); } catch (e) {} };
        v.src = item.dataUrl;
      } catch (e) {}
    }

    function bytesToBase64(u8) {
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < u8.length; i += CH) {
        bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
      }
      return btoa(bin);
    }

    // 分块读取文件并转 dataUrl: 实时进度 + 可取消, 避免一次性大缓冲卡死界面
    function readFileWithProgress(file, onProgress) {
      const signal = { canceled: false };
      const promise = (async () => {
        if (typeof file.stream === 'function' && typeof ReadableStream !== 'undefined') {
          const reader = file.stream().getReader();
          let base64 = '';
          let carry = new Uint8Array(0);
          let loaded = 0;
          const total = file.size || 0;
          while (true) {
            if (signal.canceled) { try { await reader.cancel(); } catch (e) {} throw new Error('canceled'); }
            const { done, value } = await reader.read();
            if (done) break;
            loaded += value.byteLength;
            const merged = new Uint8Array(carry.length + value.byteLength);
            merged.set(carry);
            merged.set(value, carry.length);
            const usable = Math.floor(merged.length / 3) * 3;
            if (usable > 0) base64 += bytesToBase64(merged.subarray(0, usable));
            carry = merged.slice(usable);
            onProgress(loaded, total);
          }
          if (carry.length > 0) base64 += bytesToBase64(carry);
          return 'data:' + (file.type || 'application/octet-stream') + ';base64,' + base64;
        }
        // 回退: FileReader (现代浏览器均走上面 stream 分支, 这里保底)
        return await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onprogress = (e) => { if (e && e.lengthComputable) onProgress(e.loaded, e.total); };
          r.onload = () => resolve(r.result);
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

    function onFileChosen(file, onError) {
      if (!file) return;
      const canRead = typeof FileReader !== 'undefined' || (typeof file.stream === 'function' && typeof ReadableStream !== 'undefined');
      if (!canRead) { if (onError) onError('当前环境不支持本地上传'); return; }
      if (uploadProgress.get()) { if (onError) onError('已有文件正在读取，请先等待完成或点击取消'); return; }
      try {
        if (file.size > MAX_UPLOAD_BYTES) {
          if (onError) onError('文件过大（' + fmtBytes(file.size) + '），超过上限 ' + fmtBytes(MAX_UPLOAD_BYTES) + '，请压缩后再上传');
          return;
        }
        const isVideo = /^video\//i.test(file.type || '') || /\.(mp4|webm|ogv|ogg|mov)$/i.test(file.name || '');
        const name = file.name || (isVideo ? '视频' : '图片');
        if (file.size > SOFT_WARN_BYTES) {
          try { if (onError) onError('文件较大（' + fmtBytes(file.size) + '），读取与播放会占用较多内存，若卡顿建议压缩后再试'); } catch (e) {}
        }
        uploadProgress.set({ name, loaded: 0, total: file.size || 0, canceled: false });
        const { promise, cancel } = readFileWithProgress(file, (loaded, total) => {
          const cur = uploadProgress.get();
          if (cur) uploadProgress.set({ ...cur, loaded, total });
        });
        activeUploadCancel = () => {
          try {
            const cur = uploadProgress.get();
            if (cur) uploadProgress.set({ ...cur, canceled: true });
          } catch (e) {}
          cancel();
        };
        promise.then((dataUrl) => {
          activeUploadCancel = null;
          uploadProgress.set(null);
          if (isVideo) {
            // 视频: 跳过裁剪编辑器, 直接应用为动态壁纸 (静音循环播放)
            const s = store.get();
            const id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const item = { id, name, dataUrl, w: 0, h: 0, isVideo: true };
            commit({ ...s, enabled: true, kind: 'upload', value: id, uploads: s.uploads.concat([item]).slice(-5) });
            probeVideoDims(item);
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

    function SettingsPage() {
      const s = useStore(store);
      const up = useStore(uploadProgress);
      const [hint, setHint] = React.useState('');
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
        React.createElement('video', {
          src: u.dataUrl,
          muted: true,
          playsInline: true,
          preload: 'metadata',
          title: u.name || '视频',
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
        }),
        React.createElement('div', { style: { position: 'absolute', left: 4, top: 4, fontSize: 10, background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 5, padding: '1px 6px', pointerEvents: 'none', zIndex: 1 } }, 'MP4 · 循环'),
        React.createElement('button', {
          onClick: () => removeUpload(u.id),
          title: '删除该壁纸',
          'aria-label': '删除该壁纸',
          style: { position: 'absolute', bottom: 4, right: 4, width: 22, height: 22, lineHeight: '18px', borderRadius: 11, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', fontSize: 14, padding: 0, zIndex: 1 },
        }, '\u00d7'),
      );

      const uploadNode = (u) => u.isVideo ? videoNode(u) : React.createElement('div', { key: u.id, style: { position: 'relative' } },
        thumb("url('" + u.dataUrl + "')", 'upload', u.id, () => selectUpload(u.id)),
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
          React.createElement('button', { onClick: resetWallpaper, style: btnStyle }, '恢复默认')),
        hint && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-warn-primary, #d97706)' } }, hint),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          React.createElement('div', { style: { fontSize: 13, fontWeight: 600 } }, '区域不透明度（0% = 完全透明露出壁纸，100% = 完全不透明；中间对话仅作用于对话区，设置面板等不受影响）'),
          sliderRow('左侧边栏', s.opLeft, setOpLeft),
          sliderRow('中间对话', s.opMid, setOpMid),
          HAS_BETTER_SIDEBAR && sliderRow('右侧边栏', s.opRight, setOpRight)),
        !s.enabled && React.createElement('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #999)' } }, '当前未启用壁纸，点击上方任意一张启用。'),
        React.createElement(EditorModal),
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
            uploads: uploads.filter((u) => u && typeof u.id === 'string' && typeof u.dataUrl === 'string').slice(-5),
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
      tokenLabel: "平台 Token（可选）",
      tokenPlaceholder: "localStorage 的 userToken",
      tokenSave: "保存",
      tokenSaving: "保存中…",
      tokenSaved: "已保存，重新获取中",
      tokenHint: "平台 Token 存在 platform.deepseek.com 的浏览器存储中，DSH 无法直接读取。用书签按钮一键获取：① 把「获取 Token 按钮」拖到书签栏（仅一次）② 打开用量页后点一下书签 ③ 回到 DSH 点「从剪贴板导入」。",
      bmLabel: "获取 Token 按钮（拖到书签栏）",
      bmTitle: "拖到浏览器书签栏；在 platform.deepseek.com 登录状态下点击，即可复制 userToken",
      importClipboard: "从剪贴板导入",
      imported: "已从剪贴板导入并保存，正在刷新",
      clipboardEmpty: "剪贴板中未检测到 Token：请先在平台页点击书签按钮复制",
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
      tokenLabel: "Platform token (optional)",
      tokenPlaceholder: "userToken from localStorage",
      tokenSave: "Save",
      tokenSaving: "Saving…",
      tokenSaved: "Saved, refreshing",
      tokenHint: "The platform token lives in platform.deepseek.com's own browser storage; DSH cannot read it directly. Use the bookmark button: ① drag the \"Get token button\" to the bookmark bar (once) ② open the usage page and click the bookmark ③ back in DSH click \"Import from clipboard\".",
      bmLabel: "Get token button (drag to bookmark bar)",
      bmTitle: "Drag to the bookmark bar; while logged in on platform.deepseek.com, click it to copy the userToken",
      importClipboard: "Import from clipboard",
      imported: "Imported and saved from clipboard, refreshing",
      clipboardEmpty: "No token detected in clipboard: click the bookmark on the platform page first",
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

    // One-click token capture: a bookmarklet the user drags to the bookmark bar.
    // On the logged-in platform page it copies localStorage.userToken to the
    // clipboard; the widget then imports it via "从剪贴板导入".
    var BOOKMARKLET =
      "javascript:(function(){var t=localStorage.getItem('userToken')||'';if(!t){alert('未找到 userToken：请先登录 platform.deepseek.com')}else{navigator.clipboard.writeText(t).then(function(){alert('已复制 Token：回到 DSH 点击「从剪贴板导入」')},function(){var v=prompt('复制这个 Token（Ctrl+C）：',t);if(v)void 0})}})();";

    var connectionApi = null;

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
      var tokenRef = useState("");
      var token = tokenRef[0];
      var setToken = tokenRef[1];
      var savingRef = useState(false);
      var saving = savingRef[0];
      var setSaving = savingRef[1];
      var savedAtRef = useState(0);
      var savedAt = savedAtRef[0];
      var setSavedAt = savedAtRef[1];
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
      var platformConfigured = ok && !!data.platformConfigured;

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

      var saveTokenValue = function (value) {
        var v = (value || "").trim();
        if (!v || !connectionApi || saving) return;
        setSaving(true);
        connectionApi.credentials
          .set({ ref: "DEEPSEEK_PLATFORM_TOKEN", value: v })
          .then(function (resp) {
            setSaving(false);
            if (resp && resp.result && resp.result.ok) {
              setSavedAt(Date.now());
              setToken("");
              refreshBalance();
            } else {
              var msg = resp && resp.result && resp.result.error && resp.result.error.message;
              setErr(msg || t("errFetch"));
            }
          })
          .catch(function (e) {
            setSaving(false);
            setErr(String((e && e.message) || e));
          });
      };

      var onSaveToken = function () {
        saveTokenValue(token);
      };

      var onImportClipboard = function () {
        if (typeof navigator === "undefined" || !navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
          setErr(t("errFetch") + "（浏览器不支持剪贴板读取，请手动粘贴）");
          return;
        }
        navigator.clipboard
          .readText()
          .then(function (text) {
            var value = (text || "").trim();
            if (value.length < 8) {
              setErr(t("clipboardEmpty"));
              return;
            }
            saveTokenValue(value);
          })
          .catch(function (e) {
            setErr("读取剪贴板失败：" + ((e && e.message) || e));
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
      popChildren.push(jsx("div", { key: "div1", className: "bw-div" }));

      if (!platformConfigured) {
        popChildren.push(jsx("div", { key: "hint", className: "bw-hint", children: t("tokenHint") }));
      }
      popChildren.push(
        jsxs("div", {
          key: "help",
          className: "bw-hint",
          children: [
            jsx("a", { key: "bm", className: "bw-link", href: BOOKMARKLET, title: t("bmTitle"), children: t("bmLabel") }),
            " · ",
            jsx("a", {
              key: "ug",
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
      popChildren.push(
        jsxs("div", {
          key: "tok",
          className: "bw-tok",
          children: [
            jsx("span", { className: "bw-hint", children: t("tokenLabel") }),
            jsx("input", {
              className: "bw-input",
              type: "password",
              placeholder: t("tokenPlaceholder"),
              value: token,
              onChange: function (e) {
                setToken(e.target.value);
              },
              onKeyDown: function (e) {
                if (e.key === "Enter") onSaveToken();
              }
            }),
            jsx("button", {
              className: "bw-btn",
              type: "button",
              disabled: saving || token.trim() === "",
              onClick: onSaveToken,
              children: saving ? t("tokenSaving") : t("tokenSave")
            })
          ]
        })
      );
      popChildren.push(
        jsx("div", {
          key: "imp",
          className: "bw-hint",
          children: jsx("button", {
            className: "bw-btn",
            type: "button",
            disabled: saving,
            onClick: onImportClipboard,
            children: saving ? t("tokenSaving") : t("importClipboard")
          })
        })
      );
      if (savedAt > 0) {
        popChildren.push(
          jsx("div", { key: "saved", className: "bw-hint", children: t("tokenSaved") + " (" + clock(savedAt) + ")" })
        );
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
    // merged plugin body
    // =====================================================================

    function apply(ctx) {
      // ---- wallpaper ----
      const slots = ctx.get('slots');
      const theme = ctx.get('theme');
      if (theme) themeSvc = theme;
      // ---- balance widget ----
      connectionApi = ctx.connection ? ctx.connection.api : null;
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
      }
      loadPersisted();
    }

    module.exports = { inject: ["slots", "theme", "locale", "connection"], apply };
    return module.exports;
  }
});
