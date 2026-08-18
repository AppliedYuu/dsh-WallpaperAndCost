# dsh-WallpaperAndCost

A merged DSH web plugin combining **wallpaper customization** and the **DeepSeek balance & usage widget**.

## Features

### 🎨 Wallpaper (壁纸)
- 8 built-in curated gradients (暮色 / 深渊 / 晨曦 / 森林 / 星夜 / 暖阳 / 青空 / 石墨)
- Upload your own images **at full original resolution** (no compression), stored in IndexedDB
- Crop editor: drag to pan + zoom (100%–250%) with a live viewport-proportional preview
- Independent **absolute opacity sliders (0–100%)** for the left sidebar, the conversation column and the right sidebar (dsh-better-sidebar panel, auto-hidden when that plugin is absent)
- Wallpaper choice persists across restarts (localStorage + IndexedDB)

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
- `lib/index.js` — host half: balance/cost API routes (`/api/deepseek-balance`, `/api/deepseek-session-cost`)
- `lib/client.js` — browser half: wallpaper + balance widget (no build step required)
- `cordis.patch.yml` — bundle patch mounting the plugin row

## License
MIT
