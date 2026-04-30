"use strict";

/* ── DOM refs ── */
const video       = document.getElementById("video");
const overlay     = document.getElementById("overlay");
const bigIcon     = document.getElementById("big-icon");
const controls    = document.getElementById("controls");
const btnPlay     = document.getElementById("btn-play");
const btnPrev     = document.getElementById("btn-prev");
const btnNext     = document.getElementById("btn-next");
const btnRw       = document.getElementById("btn-rw");
const btnFfw      = document.getElementById("btn-ffw");
const btnMute     = document.getElementById("btn-mute");
const btnFs       = document.getElementById("btn-fs");
const btnSlower   = document.getElementById("btn-slower");
const btnFaster   = document.getElementById("btn-faster");
const btnSidebar  = document.getElementById("btn-sidebar");
const seekbar     = document.getElementById("seekbar");
const volbar      = document.getElementById("volbar");
const rateBadge   = document.getElementById("rate-badge");
const plPos       = document.getElementById("pl-pos");
const timeCur     = document.getElementById("time-current");
const timeTotal   = document.getElementById("time-total");
const buffering   = document.getElementById("buffering");
const errorMsg    = document.getElementById("error-msg");
const errorText   = document.getElementById("error-text");
const titleEl     = document.getElementById("stream-title");
const sidebar         = document.getElementById("sidebar");
const sidebarTrigger  = document.getElementById("sidebar-trigger");
const sidebarSearch   = document.getElementById("sidebar-search");
const sidebarList     = document.getElementById("sidebar-list");
const plLabel         = document.getElementById("pl-label");
const plCount         = document.getElementById("pl-count");

/* ── Playlist state ── */
let playlist   = [];   // [{ url, name, logo? }]
let currentIdx = 0;

/* ── Rates cycle ── */
const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4];
let rateIdx = RATES.indexOf(1);

/* ══════════════════════════════════════════════════
   Auto-hide controls
══════════════════════════════════════════════════ */
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

/* ══════════════════════════════════════════════════
   Sidebar auto-hide
══════════════════════════════════════════════════ */
let sidebarTimer  = null;
let sidebarPinned = false;

function showSidebar() {
  sidebar.classList.add("show");
  clearTimeout(sidebarTimer);
}
function scheduleSidebarHide() {
  if (sidebarPinned) return;
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(() => sidebar.classList.remove("show"), 2500);
}
function toggleSidebar() {
  sidebarPinned = !sidebarPinned;
  if (sidebarPinned) showSidebar();
  else sidebarTimer = setTimeout(() => sidebar.classList.remove("show"), 800);
}

sidebarTrigger.addEventListener("mouseenter", showSidebar);
sidebar.addEventListener("mouseenter",  showSidebar);
sidebar.addEventListener("mouseleave",  scheduleSidebarHide);
sidebarTrigger.addEventListener("mouseleave", scheduleSidebarHide);
btnSidebar.addEventListener("click", toggleSidebar);

/* ══════════════════════════════════════════════════
   Sidebar rendering
══════════════════════════════════════════════════ */
function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function renderSidebar(filterVal = "") {
  const q = filterVal.toLowerCase();
  const items = playlist
    .map((p, i) => ({ ...p, _i: i }))
    .filter(p => !q || p.name.toLowerCase().includes(q));

  plLabel.textContent = "Playlist";
  plCount.textContent = playlist.length ? `${playlist.length} items` : "";
  sidebarList.innerHTML = "";

  if (!items.length) {
    sidebarList.innerHTML = '<li style="color:#5555aa;cursor:default;padding:10px 14px">No results</li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement("li");
    if (item._i === currentIdx) li.classList.add("active");
    const logoHtml = item.logo
      ? `<img class="sb-logo" src="${escHtml(item.logo)}" alt="" onerror="this.style.display='none'">`
      : "";
    li.innerHTML =
      `<span class="sb-num">${item._i + 1}</span>` +
      logoHtml +
      `<span class="sb-name">${escHtml(item.name || "Unnamed")}</span>`;
    li.addEventListener("click", () => { navigateTo(item._i); scheduleSidebarHide(); });
    sidebarList.appendChild(li);
  }
  const active = sidebarList.querySelector("li.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

sidebarSearch.addEventListener("input", () => renderSidebar(sidebarSearch.value));

/* ══════════════════════════════════════════════════
   Playlist navigation
══════════════════════════════════════════════════ */
function updatePlPos() {
  if (plPos) plPos.textContent = playlist.length ? `${currentIdx + 1}/${playlist.length}` : "";
  if (btnPrev) btnPrev.disabled = currentIdx <= 0;
  if (btnNext) btnNext.disabled = currentIdx >= playlist.length - 1;
}

function navigateTo(idx) {
  if (idx < 0 || idx >= playlist.length) return;
  currentIdx = idx;
  const item = playlist[idx];
  loadStream(item.url, item.name);
  chrome.storage.local.set({ playerIdx: idx, lastStream: { url: item.url, name: item.name } });
  renderSidebar(sidebarSearch.value);
  updatePlPos();
}

function prevStream() { if (currentIdx > 0) navigateTo(currentIdx - 1); }
function nextStream() { if (currentIdx < playlist.length - 1) navigateTo(currentIdx + 1); }

if (btnPrev) btnPrev.addEventListener("click", () => { prevStream(); flashIcon("⏮"); });
if (btnNext) btnNext.addEventListener("click", () => { nextStream(); flashIcon("⏭"); });

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
    case "[": prevStream(); flashIcon("\u23ee"); break;
    case "]": nextStream(); flashIcon("\u23ed"); break;
    case "l": case "L": toggleSidebar(); break;
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

const btnTracks   = document.getElementById("btn-tracks");
const trackPanel  = document.getElementById("track-panel");
const tpSubLabel  = document.getElementById("tp-sub-label");
const tpSubList   = document.getElementById("tp-sub-list");
const tpAudLabel  = document.getElementById("tp-aud-label");
const tpAudList   = document.getElementById("tp-aud-list");

/* ── Track panel ── */
function buildTrackPanel() {
  if (!hls) return;

  const subs  = hls.subtitleTracks || [];
  const auds  = hls.audioTracks    || [];
  const hasSub = subs.length > 0;
  const hasAud = auds.length > 1;   // only show if >1 audio track

  tpSubLabel.style.display = hasSub ? "" : "none";
  tpAudLabel.style.display = hasAud ? "" : "none";
  btnTracks.style.display  = (hasSub || hasAud) ? "" : "none";

  // Subtitles
  tpSubList.innerHTML = "";
  if (hasSub) {
    const offBtn = document.createElement("button");
    offBtn.textContent = "Off";
    if (hls.subtitleTrack === -1) offBtn.classList.add("active");
    offBtn.addEventListener("click", () => {
      hls.subtitleTrack = -1;
      buildTrackPanel();
    });
    tpSubList.appendChild(offBtn);
    subs.forEach((t, i) => {
      const btn = document.createElement("button");
      btn.textContent = t.name || t.lang || `Track ${i + 1}`;
      if (hls.subtitleTrack === i) btn.classList.add("active");
      btn.addEventListener("click", () => {
        hls.subtitleTrack = i;
        buildTrackPanel();
      });
      tpSubList.appendChild(btn);
    });
  }

  // Audio
  tpAudList.innerHTML = "";
  if (hasAud) {
    auds.forEach((t, i) => {
      const btn = document.createElement("button");
      btn.textContent = t.name || t.lang || `Audio ${i + 1}`;
      if (hls.audioTrack === i) btn.classList.add("active");
      btn.addEventListener("click", () => {
        hls.audioTrack = i;
        buildTrackPanel();
      });
      tpAudList.appendChild(btn);
    });
  }
}

btnTracks.addEventListener("click", (e) => {
  e.stopPropagation();
  trackPanel.classList.toggle("show");
  if (trackPanel.classList.contains("show")) buildTrackPanel();
});

document.addEventListener("click", (e) => {
  if (!trackPanel.contains(e.target) && e.target !== btnTracks) {
    trackPanel.classList.remove("show");
  }
});

/* ── Mouse wheel volume ── */
document.addEventListener("wheel", (e) => {
  if (trackPanel.classList.contains("show")) return; // don't conflict with panel scroll
  e.preventDefault();
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  video.volume = Math.min(1, Math.max(0, video.volume + delta));
  video.muted  = video.volume === 0;
  volbar.value = video.volume;
  updateMuteIcon();
  flashIcon(video.muted ? "🔇" : video.volume < 0.5 ? "🔉" : "🔊");
}, { passive: false });

/* ── HLS.js loader ── */
let hls = null;

function stopAndRelease() {
  video.pause();
  if (hls) { hls.destroy(); hls = null; }
  video.removeAttribute("src");
  video.load(); // abort any pending network request
}

function loadStream(url, name) {
  titleEl.textContent = name || url;
  document.title      = name || "Nebula IPTV";
  errorMsg.classList.remove("show");
  buffering.classList.add("show");

  stopAndRelease();
  btnTracks.style.display = "none";
  trackPanel.classList.remove("show");

  const isHLS = url.includes(".m3u8") || url.includes("type=m3u8") || url.includes("output=m3u8");

  if (isHLS && typeof Hls !== "undefined" && Hls.isSupported()) {
    hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      buildTrackPanel();
    });
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, buildTrackPanel);
    hls.on(Hls.Events.AUDIO_TRACKS_UPDATED,    buildTrackPanel);
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

/* ── Stop playback when tab is closed or navigated away ── */
window.addEventListener("beforeunload", stopAndRelease);

/* ════════════════════════════════════════════════════
   Boot: load stream + playlist from storage
════════════════════════════════════════════════════ */
(async () => {
  const stored = await chrome.storage.local.get(["playerPlaylist", "playerIdx", "lastStream"]);

  // Load playlist
  if (Array.isArray(stored.playerPlaylist) && stored.playerPlaylist.length) {
    playlist   = stored.playerPlaylist;
    currentIdx = typeof stored.playerIdx === "number" ? stored.playerIdx : 0;
  }

  // Determine what to play
  const params    = new URLSearchParams(window.location.search);
  const urlParam  = params.get("url");
  const nameParam = params.get("name");

  let playUrl, playName;
  if (urlParam) {
    playUrl  = decodeURIComponent(urlParam);
    playName = decodeURIComponent(nameParam || "");
    const match = playlist.findIndex(p => p.url === playUrl);
    if (match >= 0) currentIdx = match;
  } else if (stored.lastStream?.url) {
    playUrl  = stored.lastStream.url;
    playName = stored.lastStream.name || "";
    const match = playlist.findIndex(p => p.url === playUrl);
    if (match >= 0) currentIdx = match;
  }

  if (playUrl) {
    loadStream(playUrl, playName);
  } else {
    titleEl.textContent = "No stream selected";
    buffering.classList.remove("show");
  }

  renderSidebar();
  updatePlPos();

  // Briefly show sidebar on first load so user knows it exists
  if (playlist.length > 1) {
    showSidebar();
    sidebarTimer = setTimeout(() => sidebar.classList.remove("show"), 3000);
  }
})();
