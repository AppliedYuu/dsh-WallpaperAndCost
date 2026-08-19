# dsh-WallpaperAndCost

A merged DSH web plugin combining **wallpaper customization** and the **DeepSeek balance & usage widget**.

## Features

### 🎨 Wallpaper (壁纸)
- 8 built-in curated gradients (暮色 / 深渊 / 晨曦 / 森林 / 星夜 / 暖阳 / 青空 / 石墨)
- Upload your own images **at full original resolution** (no compression), stored in IndexedDB
- **动态壁纸：上传 MP4/WebM 视频，自动静音循环播放**（铺底 `<video>` 元素，object-fit: cover）
- Crop editor: drag to pan + zoom (100%–250%) with a live viewport-proportional preview
- Independent **absolute opacity sliders (0–100%)** for the left sidebar, the conversation column and the right sidebar (dsh-better-sidebar panel, auto-hidden when that plugin is absent)
- Wallpaper choice persists across restarts (localStorage + IndexedDB)
- **创意工坊壁纸提取（服务器目录）**：输入 Wallpaper Engine 创意工坊条目文件夹的绝对路径（`…steamapps\workshop\content\431960\<id>`），由内置的 `scripts/extract_scene_pkg.py` 解析 `scene.pkg` / `.tex`（含 LZ4 解压、DXT/RGBA→PNG、内嵌 MP4），提取最佳壁纸供预览与下载。需要运行 DSH 的机器装有 Python 3（脚本为纯 Python，Pillow 可选）。

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
- Official DeepSeek CNY price table with peak/valley windows, per-model and per-window breakdown
- Platform token can be captured with a one-click bookmarklet + clipboard import (no console needed)
- The DeepSeek API key never leaves the host (host-side routes only)

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
- Optional `DEEPSEEK_PLATFORM_TOKEN` (via the widget) for exact platform consumption figures

## Structure
- `lib/index.js` — host half: balance/cost API routes (`/api/deepseek-balance`, `/api/deepseek-session-cost`) + workshop extraction routes (`/api/wallpaper-workshop/extract`, `/api/wallpaper-workshop/file`)
- `lib/client.js` — browser half: wallpaper + balance widget + workshop extraction UI (no build step required)
- `scripts/extract_scene_pkg.py` — standalone Wallpaper Engine `.pkg`/`.tex` extraction engine (called by the host route; also usable as a CLI)
- `cordis.patch.yml` — bundle patch mounting the plugin row

## License
MIT
