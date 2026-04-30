"use strict";

const video     = document.getElementById("video");
const overlay   = document.getElementById("overlay");
const bigIcon   = document.getElementById("big-icon");
const controls  = document.getElementById("controls");
const btnPlay   = document.getElementById("btn-play");
const btnRw     = document.getElementById("btn-rw");
const btnFfw    = document.getElementById("btn-ffw");
const btnMute   = document.getElementById("btn-mute");
const btnFs     = document.getElementById("btn-fs");
const btnSlower = document.getElementById("btn-slower");
const btnFaster = document.getElementById("btn-faster");
const seekbar   = document.getElementById("seekbar");
const volbar    = document.getElementById("volbar");
const rateBadge = document.getElementById("rate-badge");
const timeCur   = document.getElementById("time-current");
const timeTotal = document.getElementById("time-total");
const buffering = document.getElementById("buffering");
const errorMsg  = document.getElementById("error-msg");
const errorText = document.getElementById("error-text");
const titleEl   = document.getElementById("stream-title");

/* ── Rates cycle ── */
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
let rateIdx = RATES.indexOf(1);

/* ── Auto-hide controls ── */
let hideTimer = null;
function resetHideTimer() {
  controls.classList.remove("hide");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!video.paused) controls.classList.add("hide");
  }, 3000);
}
document.addEventListener("mousemove", resetHideTimer);
document.addEventListener("keydown",   resetHideTimer);

/* ── Format time ── */
function fmt(s) {
  if (!isFinite(s)) return "Live";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
    : `${m}:${String(sec).padStart(2,"0")}`;
}

/* ── Seek bar update ── */
video.addEventListener("timeupdate", () => {
  if (!video.duration || !isFinite(video.duration)) {
    seekbar.value = 0;
    timeCur.textContent = fmt(video.currentTime);
    timeTotal.textContent = "Live";
    return;
  }
  timeCur.textContent  = fmt(video.currentTime);
  timeTotal.textContent = fmt(video.duration);
  seekbar.value = Math.round((video.currentTime / video.duration) * 1000);
});

seekbar.addEventListener("input", () => {
  if (video.duration && isFinite(video.duration)) {
    video.currentTime = (seekbar.value / 1000) * video.duration;
  }
});

/* ── Volume ── */
volbar.addEventListener("input", () => {
  video.volume = parseFloat(volbar.value);
  video.muted  = video.volume === 0;
  updateMuteIcon();
});

function updateMuteIcon() {
  if (video.muted || video.volume === 0) {
    btnMute.textContent = "🔇";
  } else if (video.volume < 0.5) {
    btnMute.textContent = "🔉";
  } else {
    btnMute.textContent = "🔊";
  }
}

btnMute.addEventListener("click", () => {
  video.muted = !video.muted;
  volbar.value = video.muted ? 0 : video.volume;
  updateMuteIcon();
});

/* ── Play / Pause ── */
function togglePlay() {
  if (video.paused) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
}

overlay.addEventListener("click", () => {
  togglePlay();
  flashIcon(video.paused ? "⏸" : "▶");
});

btnPlay.addEventListener("click", togglePlay);

video.addEventListener("play",  () => { btnPlay.textContent = "⏸"; resetHideTimer(); });
video.addEventListener("pause", () => { btnPlay.textContent = "▶"; controls.classList.remove("hide"); clearTimeout(hideTimer); });

function flashIcon(icon) {
  bigIcon.textContent = icon;
  bigIcon.classList.add("show");
  clearTimeout(bigIcon._t);
  bigIcon._t = setTimeout(() => bigIcon.classList.remove("show"), 600);
}

/* ── FFW / Rewind ── */
const SKIP = 10;
btnRw.addEventListener("click",  () => { video.currentTime = Math.max(0, video.currentTime - SKIP); flashIcon("⏪"); });
btnFfw.addEventListener("click", () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SKIP); flashIcon("⏩"); });

/* ── Playback rate ── */
function setRate(idx) {
  rateIdx = Math.max(0, Math.min(RATES.length - 1, idx));
  video.playbackRate = RATES[rateIdx];
  rateBadge.textContent = RATES[rateIdx] + "×";
}
btnSlower.addEventListener("click", () => setRate(rateIdx - 1));
btnFaster.addEventListener("click", () => setRate(rateIdx + 1));

/* ── Fullscreen ── */
btnFs.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    btnFs.textContent = "⛶";
  } else {
    document.exitFullscreen();
    btnFs.textContent = "⛶";
  }
});

/* ── Keyboard shortcuts ── */
document.addEventListener("keydown", e => {
  if (e.target.tagName === "INPUT") return;
  switch (e.key) {
    case " ":      e.preventDefault(); togglePlay(); break;
    case "ArrowLeft":  video.currentTime = Math.max(0, video.currentTime - SKIP); flashIcon("⏪"); break;
    case "ArrowRight": video.currentTime = Math.min(video.duration || Infinity, video.currentTime + SKIP); flashIcon("⏩"); break;
    case "ArrowUp":    video.volume = Math.min(1, video.volume + 0.05); volbar.value = video.volume; updateMuteIcon(); break;
    case "ArrowDown":  video.volume = Math.max(0, video.volume - 0.05); volbar.value = video.volume; updateMuteIcon(); break;
    case "m": case "M": video.muted = !video.muted; updateMuteIcon(); break;
    case "f": case "F": btnFs.click(); break;
    case ",": setRate(rateIdx - 1); break;
    case ".": setRate(rateIdx + 1); break;
  }
});

/* ── Buffering ── */
video.addEventListener("waiting", () => buffering.classList.add("show"));
video.addEventListener("canplay", () => buffering.classList.remove("show"));
video.addEventListener("playing", () => buffering.classList.remove("show"));

/* ── Errors ── */
video.addEventListener("error", () => {
  buffering.classList.remove("show");
  errorText.textContent = video.error ? `Error ${video.error.code}: ${video.error.message}` : "Stream failed to load.";
  errorMsg.classList.add("show");
});

/* ── HLS.js loader ── */
let hls = null;

function loadStream(url, name) {
  titleEl.textContent = name || url;
  document.title      = name || "Nebula IPTV";
  errorMsg.classList.remove("show");
  buffering.classList.add("show");

  if (hls) { hls.destroy(); hls = null; }

  const isHLS = url.includes(".m3u8") || url.includes("type=m3u8") || url.includes("output=m3u8");

  if (isHLS && typeof Hls !== "undefined" && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        errorText.textContent = `HLS fatal error: ${data.details}`;
        errorMsg.classList.add("show");
        buffering.classList.remove("show");
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl") && isHLS) {
    // Safari native HLS
    video.src = url;
    video.play().catch(() => {});
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

/* ── Boot: read URL from query string or storage ── */
(async () => {
  const params = new URLSearchParams(window.location.search);
  const urlParam  = params.get("url");
  const nameParam = params.get("name");

  if (urlParam) {
    loadStream(decodeURIComponent(urlParam), decodeURIComponent(nameParam || ""));
  } else {
    // Fallback: check storage for lastStream
    const { lastStream } = await chrome.storage.local.get("lastStream");
    if (lastStream && lastStream.url) {
      loadStream(lastStream.url, lastStream.name || "");
    } else {
      titleEl.textContent = "No stream selected";
      buffering.classList.remove("show");
    }
  }
})();
