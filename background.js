// background.js – service worker
"use strict";

/* ── M3U parser (same logic as popup.js, runs in background so popup can close) ── */
const M3UParser = {
  parse(text) {
    const lines = text.split(/\r?\n/);
    const channels = [];
    let current = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("#EXTINF")) {
        const name       = line.replace(/^#EXTINF[^,]*,/, "").trim();
        const groupMatch = line.match(/group-title="([^"]*)"/i);
        const logoMatch  = line.match(/tvg-logo="([^"]*)"/i);
        current = {
          name:  name || "Unnamed",
          group: groupMatch ? groupMatch[1].trim() : "Uncategorized",
          logo:  logoMatch  ? logoMatch[1]  : "",
        };
      } else if (line && !line.startsWith("#") && current) {
        current.url = line;
        channels.push(current);
        current = null;
      }
    }
    return channels;
  },

  groupByCategory(channels) {
    const map = {};
    for (const ch of channels) {
      if (!map[ch.group]) map[ch.group] = [];
      map[ch.group].push(ch);
    }
    return Object.keys(map).sort().map(g => ({
      category_id:   g,
      category_name: g,
      streams:       map[g],
    }));
  },
};

async function fetchM3U(m3uUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000); // 90s timeout
  try {
    const resp = await fetch(m3uUrl, { signal: controller.signal });
    if (!resp.ok) throw new Error(`Server returned HTTP ${resp.status}`);
    const text = await resp.text();
    const channels = M3UParser.parse(text);
    if (!channels.length) throw new Error("Playlist parsed but contained 0 channels. Check credentials or URL.");
    const groups = M3UParser.groupByCategory(channels);
    return { ok: true, groups, total: channels.length };
  } catch (e) {
    return { ok: false, error: e.name === "AbortError" ? "Request timed out after 90 seconds" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "openPlayer") {
    const url  = encodeURIComponent(msg.url  || "");
    const name = encodeURIComponent(msg.name || "");
    const playerUrl = chrome.runtime.getURL(`player.html?url=${url}&name=${name}`);
    chrome.tabs.query({ url: chrome.runtime.getURL("player.html*") }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url: playerUrl, active: true });
      } else {
        chrome.tabs.create({ url: playerUrl });
      }
    });
    return false;
  }

  if (msg.action === "fetchM3U") {
    // Runs in background — popup may close without killing this fetch
    fetchM3U(msg.url).then(result => {
      chrome.storage.local.set({ m3uResult: result, m3uResultTs: Date.now() });
      // Try to notify popup if still open
      chrome.runtime.sendMessage({ action: "m3uResult", ...result }).catch(() => {});
    });
    sendResponse({ queued: true });
    return true; // keep channel open
  }

  return false;
});
