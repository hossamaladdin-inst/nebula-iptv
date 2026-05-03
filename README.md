# 🌌 Nebula IPTV

A Chromium extension for browsing and playing IPTV streams from **Xtream Codes API** servers and **M3U playlists** — with a built-in HLS player, async stream cache, deep search, EPG, channel logos, and an optional local helper for AC-3 / DTS audio.

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
- **Optional AC-3 / DTS support** — local helper transcodes unsupported audio codecs on the fly (see below)

---

## Installation

> Chrome Web Store submission coming. For now, load as an unpacked extension.

1. Clone or download this repo
2. Open `chrome://extensions` (or `comet://extensions`, `brave://extensions`, …)
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the repo folder
5. Click the 🌌 Nebula IPTV icon in your toolbar

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

## AC-3 / DTS audio support (optional)

Browsers don't ship AC-3, E-AC-3, DTS, or TrueHD decoders (Dolby/DTS licensing). Streams with those audio codecs play silently or fail outright in pure-browser mode. To support them, this repo includes a tiny **localhost helper** that runs real native `ffmpeg` to transcode the audio on the fly into HLS — the browser plays the HLS via hls.js. No external player window, no full-file download. See [`local_helper/`](local_helper/).

### One-time setup

```sh
# 1. Install ffmpeg (one-time, ~50 MB)
brew install ffmpeg

# 2. Auto-start the helper at login (recommended)
open local_helper/install_launchagent.command
```

Or to start it once without auto-launching:

```sh
open local_helper/start_helper.command
```

The helper listens on `http://127.0.0.1:9123`. Verify with:

```sh
curl http://127.0.0.1:9123/health
# → {"ok": true, "version": 1, "ffmpeg": "/usr/local/bin/ffmpeg"}
```

### What it does

- Receives a stream URL from the extension over loopback HTTP.
- Spawns `ffmpeg` with `-c:v copy -c:a aac` to remux the video and transcode the audio to AAC.
- Throttled with `-re` so it consumes network bandwidth at the source's actual bitrate (no 5 GB local buffering).
- Keeps only ~24 s of HLS segments on disk at any moment (`-hls_list_size 12 -hls_flags delete_segments`).
- Cleans up the temp dir when the extension closes the stream.

### Removing the helper

```sh
launchctl unload ~/Library/LaunchAgents/ai.comet-iptv.helper.plist
rm ~/Library/LaunchAgents/ai.comet-iptv.helper.plist
```

If you don't install the helper, MKV streams with AAC/MP3/Opus/FLAC audio still work (those codecs play natively); only AC-3/DTS streams require the helper.

---

## Project Structure

```
nebula-iptv/
├── manifest.json          # Chrome MV3 manifest
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Xtream API, M3U parser, cache, search, navigation
├── player.html            # Full-tab video player
├── player.js              # HLS.js player controls
├── nativeStream.js        # Bridge from extension → local helper (AC-3/DTS path)
├── background.js          # Service worker — M3U fetch, player tab management
├── icons/                 # Extension icons
├── libs/
│   └── hls.min.js         # HLS.js (bundled)
└── local_helper/          # Optional native ffmpeg helper
    ├── helper.py
    ├── start_helper.command
    └── install_launchagent.command
```

---

## Browser Compatibility

| Browser | Status |
|---------|--------|
| Chrome / Chromium | ✅ Full support |
| Microsoft Edge | ✅ Full support |
| Brave / Vivaldi / Opera | ✅ Full support |
| Comet | ✅ Full support (AC-3/DTS via local helper only — Comet blocks Chrome's native messaging API) |
| Firefox | ⚠️ Requires manifest adaptation |

---

## License

MIT
