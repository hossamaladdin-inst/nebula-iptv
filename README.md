# 🌌 Nebula IPTV

A Chrome extension for browsing and playing IPTV streams from **Xtream Codes API** servers and **M3U playlists** — with a built-in HLS player, async stream cache, deep search, EPG, and channel logos.

![Nebula IPTV](icons/icon128.png)

---

## Features

- **Xtream Codes API** — full support for Live TV, Movies, and Series categories
- **M3U playlist** — auto-parses `#EXTINF` entries with `group-title` tag support
- **Auto-detection** — paste a `get.php` M3U URL and it auto-switches to Xtream API mode
- **Async stream cache** — all streams prefetch in background (4 concurrent workers), cached to `chrome.storage.local` for instant reuse across sessions
- **Smart cache refresh** — stale cache (>30 min) is silently refreshed on next open
- **Deep search** — search inside the current content type (Live/Movies/Series) across all streams, not just category names
- **Channel logos** — `tvg-logo` icons displayed per stream
- **EPG support** — now/next programme info per channel
- **Built-in HLS player** — powered by [HLS.js](https://github.com/video-dev/hls.js/), with:
  - ⏩ Fast-forward / ⏪ Rewind (10s per click, or `←` `→`)
  - 🔊 Volume slider + mute (`M`)
  - ⏸ Play/Pause (`Space`)
  - 🔼🔽 Volume via keyboard (`↑` `↓`)
  - 🐇 Speed control (`<` slower / `>` faster, 0.25×–4×)
  - ⛶ Fullscreen (`F`)
  - Auto-hide controls, buffering spinner, error display

---

## Installation

> Chrome Web Store submission coming. For now, load as an unpacked extension.

1. Clone or download this repo
2. Open `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. Click the 🌌 Nebula IPTV icon in your toolbarnn

---

## Setup

### Xtream Codes
1. Click ⚙️ → **Xtream** tab
2. Enter your server URL, username, and password
3. Click **Save & Connect**

### M3U URL
1. Click ⚙️ → **M3U URL** tab
2. Paste your M3U URL (e.g. `http://server/get.php?username=X&password=Y&type=m3u_plus`)
   - If the URL contains Xtream credentials, it auto-switches to API mode
3. Click **Save & Connect**

---

## Project Structure

```
nebula-iptv/
├── manifest.json       # Chrome MV3 manifest
├── popup.html          # Extension popup UI
├── popup.css           # Popup styles
├── popup.js            # Xtream API, M3U parser, cache, search, navigation
├── player.html         # Full-tab video player
├── player.js           # HLS.js player controls
├── background.js       # Service worker — M3U fetch, player tab management
├── icons/              # Extension icons (PNG + SVG)
└── libs/
    └── hls.min.js      # HLS.js (bundled)
```

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome / Chromium | ✅ Full support |
| Microsoft Edge | ✅ Full support |
| Brave / Vivaldi / Opera | ✅ Full support |
| Firefox | ⚠️ Requires manifest adaptation |

---

## License

MIT
