"use strict";

/* ════════════════════════════════════════════════════════════════════
   Localhost helper bridge.

   Talks to the small Python helper running on http://127.0.0.1:9123 (see
   local_helper/helper.py). The helper spawns native ffmpeg to transcode
   AC-3/DTS into AAC inside an HLS playlist served from the same loopback
   URL. The browser plays it via hls.js — smooth, hardware-decoded, no
   download visible to the user.

   We use this instead of Chrome's native messaging API because Comet
   silently refuses to launch user-level native messaging hosts.

   exposes window.NativeMkv = {
     available(): Promise<boolean>             // helper /health responds
     play(url): Promise<{ hlsUrl, stop() }>    // start a new stream
   }
═══════════════════════════════════════════════════════════════════════ */
(function () {
  const HELPER_URL = "http://127.0.0.1:9123";
  let _availableCached = null;

  async function available() {
    if (_availableCached !== null) return _availableCached;
    _availableCached = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1500);
        const r = await fetch(HELPER_URL + "/health", { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return false;
        const j = await r.json();
        return !!(j && j.ok);
      } catch { return false; }
    })();
    return _availableCached;
  }

  async function play(url) {
    const r = await fetch(HELPER_URL + "/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) {
      let msg = `helper HTTP ${r.status}`;
      try { const j = await r.json(); if (j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const j = await r.json();
    if (!j.hls_url || !j.id) throw new Error("helper returned bad response");
    return {
      hlsUrl: j.hls_url,
      id: j.id,
      stop() {
        // Best-effort; helper cleans up on its own when stream ends.
        fetch(HELPER_URL + `/stop/${j.id}`, { method: "POST" }).catch(() => {});
      },
    };
  }

  self.NativeMkv = { available, play };
})();
