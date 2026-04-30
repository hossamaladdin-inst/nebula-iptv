/**
 * Nebula IPTV – popup.js
 * Supports:
 *   • Xtream Codes API  (live TV / VOD movies / series)
 *   • M3U playlist URL  (group-title based categories)
 */

"use strict";

/* ═══════════════════════════════════════════════════
   Xtream Codes API helper
   All URL construction lives here — never hardcode paths outside this object.
═══════════════════════════════════════════════════ */
const XtreamAPI = {
  /**
   * Build a player_api.php URL.
   * @param {string} server  – base URL, e.g. "http://host:port"
   * @param {string} user
   * @param {string} pass
   * @param {string} action  – Xtream action name
   * @param {Object} [extra] – additional query params (e.g. { category_id: "5" })
   */
  apiUrl(server, user, pass, action, extra = {}) {
    const base = server.replace(/\/$/, "");
    const params = new URLSearchParams({ username: user, password: pass, action, ...extra });
    return `${base}/player_api.php?${params}`;
  },

  /**
   * Build a playable stream URL.
   * @param {"live"|"vod"|"series"} type
   */
  streamUrl(server, user, pass, type, streamId, ext = "m3u8") {
    const base = server.replace(/\/$/, "");
    const segment = type === "live" ? "live" : type === "vod" ? "movie" : "series";
    return `${base}/${segment}/${user}/${pass}/${streamId}.${ext}`;
  },

  /* ── Category endpoints (returns Promise<Array>) ── */
  async fetchCategories(server, user, pass, type) {
    const actionMap = {
      live:   "get_live_categories",
      vod:    "get_vod_categories",
      series: "get_series_categories",
    };
    const url = this.apiUrl(server, user, pass, actionMap[type]);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json(); // [{ category_id, category_name, parent_id }, ...]
  },

  /* ── Stream list by category ── */
  async fetchStreams(server, user, pass, type, categoryId) {
    const actionMap = {
      live:   "get_live_streams",
      vod:    "get_vod_streams",
      series: "get_series",
    };
    const url = this.apiUrl(server, user, pass, actionMap[type], { category_id: categoryId });
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
    // live/vod items have: stream_id, name, stream_icon, container_extension
    // series items have:   series_id, name, cover, category_id
  },

  /* ── Series episodes (for a specific series) ── */
  async fetchSeriesInfo(server, user, pass, seriesId) {
    const url = this.apiUrl(server, user, pass, "get_series_info", { series_id: seriesId });
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json(); // { info, episodes: { "1": [...], "2": [...] } }
  },
};

/* ═══════════════════════════════════════════════════
   M3U parser helper
═══════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   App state
═══════════════════════════════════════════════════ */
const state = {
  sourceType: "xtream",
  server: "", user: "", pass: "", m3uUrl: "",
  currentType: "live",
  categories: [],
  m3uGroups: [],
  streams: [],
  currentCategory: null,
  epgData: {},
  epgShowToggle: true,
  // streamCache[type][category_id] = streams[]
  streamCache: { live: {}, vod: {}, series: {} },
  // how many categories have been fetched for current type
  cacheProgress: { live: 0, vod: 0, series: 0 },
  cacheTotals:   { live: 0, vod: 0, series: 0 },
  // Multiple playlists
  playlists:   [],     // [{ id, name, type:"xtream"|"m3u", server?, user?, pass?, m3uUrl? }]
  activePl:    null,   // id of currently active playlist
  editingPl:   null,   // id being edited in form (null = new)
  formSrcType: "xtream",
};

/* ═══════════════════════════════════════════════════
   DOM refs
═══════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const panelSettings  = $("panel-settings");
const panelBrowser   = $("panel-browser");
const browserMsg     = $("browser-state-msg");
const typeTabs       = $("type-tabs");
const catListWrap    = $("cat-list-wrap");
const catList        = $("cat-list");
const streamListWrap = $("stream-list-wrap");
const streamList     = $("stream-list");
const streamCount    = $("stream-count");
const catSearch      = $("cat-search");
const streamSearch   = $("stream-search");

/* ═══════════════════════════════════════════════════
   Utilities
═══════════════════════════════════════════════════ */
function showSpinner(ul) {
  ul.innerHTML = '<li><span class="spinner"></span></li>';
}

/* ── Cache status bar ─────────────────────────────── */
function updateCacheStatus() {
  const type = state.currentType;
  const done = state.cacheProgress[type];
  const total = state.cacheTotals[type];
  const bar = $("cache-status");
  if (!bar) return;
  if (total === 0 || done >= total) {
    bar.textContent = done > 0 ? `\u2713 ${total} categories loaded` : "";
    bar.style.color = "#3a3a5a";
  } else {
    bar.textContent = `\u23f3 Loading streams\u2026 ${done}/${total} categories`;
    bar.style.color = "#a78bfa";
  }
  // Live-refresh the category badges if a search is active
  if (catSearch.value.trim()) {
    const cats = state.sourceType === "m3u" ? state.m3uGroups : state.categories;
    renderCategoryList(cats, catSearch.value);
  }
}

function renderCategoryList(cats, filterVal = "") {
  const q = filterVal.toLowerCase().trim();
  let filtered = cats;

  if (q) {
    // Search stream names inside the loaded cache for current type
    const cache = state.streamCache[state.currentType] || {};
    filtered = cats.map(cat => {
      const catId = cat.category_id;
      const cachedStreams = cache[catId] || cat.streams || [];
      const catMatch = cat.category_name.toLowerCase().includes(q);
      const matchingStreams = cachedStreams.filter(s =>
        (s.name || s.title || "").toLowerCase().includes(q)
      );
      if (catMatch || matchingStreams.length > 0) {
        return { ...cat, _matchCount: matchingStreams.length, _matchedStreams: matchingStreams };
      }
      return null;
    }).filter(Boolean);
  }

  catList.innerHTML = "";
  if (!filtered.length) {
    catList.innerHTML = '<li style="color:#5555aa;cursor:default">No matches found</li>';
    return;
  }
  for (const cat of filtered) {
    const li = document.createElement("li");
    const cache = state.streamCache[state.currentType] || {};
    const loaded = cache[cat.category_id];
    const total  = loaded ? loaded.length : "";
    const badge  = q && cat._matchCount > 0
      ? `${cat._matchCount}${loaded ? "/" + total : ""}`
      : (total !== "" ? total : "...");
    li.innerHTML = `<span class="name">${escHtml(cat.category_name)}</span>
                    <span class="badge">${badge}</span>
                    <span class="play-btn">›</span>`;
    li.addEventListener("click", () => openCategoryFiltered(cat, q));
    catList.appendChild(li);
  }
}

function openCategoryFiltered(cat, searchTerm = "") {
  state.currentCategory = cat;
  catListWrap.classList.add("hidden");
  streamListWrap.classList.remove("hidden");
  streamSearch.value = searchTerm;

  // Try to serve from cache immediately
  const cached = state.streamCache[state.currentType]?.[cat.category_id];
  if (cached) {
    state.streams = cached;
    renderStreamList(cached, searchTerm);
    return;
  }

  // Not cached yet — fetch on demand
  showSpinner(streamList);
  (async () => {
    try {
      let streams;
      if (state.sourceType === "m3u") {
        streams = searchTerm && cat._matchedStreams ? cat._matchedStreams : (cat.streams || []);
      } else {
        streams = await XtreamAPI.fetchStreams(
          state.server, state.user, state.pass,
          state.currentType, cat.category_id
        );
        // Store in cache
        if (!state.streamCache[state.currentType]) state.streamCache[state.currentType] = {};
        state.streamCache[state.currentType][cat.category_id] = streams;
      }
      state.streams = streams;
      renderStreamList(streams, searchTerm);
    } catch (e) {
      streamList.innerHTML = `<li style="color:#f87171">Error: ${escHtml(e.message)}</li>`;
    }
  })();
}

function renderStreamList(streams, filterVal = "") {
  const q = filterVal.toLowerCase();
  const filtered = streams.filter(s => (s.name || s.title || "").toLowerCase().includes(q));
  streamCount.textContent = `${filtered.length} item(s)`;
  streamList.innerHTML = "";
  if (!filtered.length) {
    streamList.innerHTML = '<li style="color:#5555aa;cursor:default">No streams found</li>';
    return;
  }
  for (const s of filtered) {
    const li = document.createElement("li");
    const name = escHtml(s.name || s.title || "Unnamed");
    const logo = s.logo || s.tvg_logo || "";
    
    // Get EPG for this stream if available
    let epgText = "";
    if (state.epgShowToggle && state.epgData) {
      const channelId = s.tvg_id || s.stream_id || name;
      const epg = state.epgData[channelId];
      if (epg) {
        const now = epg.now ? `Now: ${escHtml(epg.now.title || "").substring(0, 30)}` : "";
        const next = epg.next ? ` | Next: ${escHtml(epg.next.title || "").substring(0, 20)}` : "";
        epgText = (now + next).trim();
      }
    }
    
    li.innerHTML = `
      <span class="logo ${logo ? "" : "placeholder"}">
        ${logo ? `<img src="${escHtml(logo)}" alt="logo" onerror="this.style.display='none'">` : "📺"}
      </span>
      <span class="info">
        <div class="name">${name}</div>
        ${epgText ? `<div class="epg">${epgText}</div>` : ""}
      </span>
      <span class="play-btn">▶</span>
    `;
    li.addEventListener("click", () => playOrBrowse(s));
    streamList.appendChild(li);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ═══════════════════════════════════════════════════
   Navigation
═══════════════════════════════════════════════════ */

async function playOrBrowse(stream) {
  // Series → show seasons/episodes first
  if (state.currentType === "series" && state.sourceType === "xtream" && stream.series_id) {
    await openSeriesInfo(stream);
    return;
  }

  let streamUrl;
  if (state.sourceType === "m3u") {
    streamUrl = stream.url;
  } else {
    const ext = stream.container_extension || (state.currentType === "live" ? "m3u8" : "mp4");
    const id  = stream.stream_id || stream.series_id;
    streamUrl = XtreamAPI.streamUrl(state.server, state.user, state.pass, state.currentType, id, ext);
  }

  // Save last played so background.js can open player tab
  await chrome.storage.local.set({ lastStream: { url: streamUrl, name: stream.name || stream.title } });
  chrome.runtime.sendMessage({ action: "openPlayer", url: streamUrl, name: stream.name || stream.title });
}

async function openSeriesInfo(series) {
  showSpinner(streamList);
  try {
    const info = await XtreamAPI.fetchSeriesInfo(state.server, state.user, state.pass, series.series_id);
    const episodes = [];
    const seasons = info.episodes || {};
    for (const seasonNum of Object.keys(seasons).sort((a, b) => +a - +b)) {
      for (const ep of seasons[seasonNum]) {
        episodes.push({
          name: `S${String(seasonNum).padStart(2,"0")}E${String(ep.episode_num).padStart(2,"0")} – ${ep.title || ""}`,
          stream_id: ep.id,
          container_extension: ep.container_extension || "mp4",
          _isSeries: true,
        });
      }
    }
    state.streams = episodes;
    renderStreamList(episodes);
  } catch (e) {
    streamList.innerHTML = `<li style="color:#f87171">Error: ${escHtml(e.message)}</li>`;
  }
}

/* Override playOrBrowse so episodes route to player directly */
const _origPlayOrBrowse = playOrBrowse;
// (handled by _isSeries flag above – series episode has stream_id, not series_id)

/* ═══════════════════════════════════════════════════
   Stream cache persistence (chrome.storage.local)
   Key format: streamCache_<type>  →  { ts, data: { [category_id]: streams[] } }
═══════════════════════════════════════════════════ */
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function saveCacheToStorage(type) {
  const key = `streamCache_${type}`;
  await chrome.storage.local.set({ [key]: { ts: Date.now(), data: state.streamCache[type] } });
}

async function loadCacheFromStorage(type) {
  const key = `streamCache_${type}`;
  const res = await chrome.storage.local.get(key);
  const entry = res[key];
  if (entry && entry.data && (Date.now() - entry.ts) < CACHE_TTL_MS) {
    state.streamCache[type] = entry.data;
    state.cacheProgress[type] = Object.keys(entry.data).length;
    state.cacheTotals[type]   = Object.keys(entry.data).length;
  }
}

/* ═══════════════════════════════════════════════════
   Load categories for a content type
═══════════════════════════════════════════════════ */
async function loadCategories(type) {
  state.currentType = type;
  streamListWrap.classList.add("hidden");
  catListWrap.classList.remove("hidden");
  catSearch.value = "";
  showSpinner(catList);

  try {
    if (state.sourceType === "m3u") {
      // M3U: all streams already grouped, just show them
      renderCategoryList(state.m3uGroups);
    } else {
      state.categories = await XtreamAPI.fetchCategories(state.server, state.user, state.pass, type);
      renderCategoryList(state.categories);
    }
  } catch (e) {
    catList.innerHTML = `<li style="color:#f87171">Error: ${escHtml(e.message)}</li>`;
  }
}

/* ═══════════════════════════════════════════════════
   Auto-detect Xtream credentials from an M3U/get.php URL
   e.g. http://host:port/get.php?username=X&password=Y&type=m3u_plus
═══════════════════════════════════════════════════ */
function tryParseXtreamFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const user = u.searchParams.get("username");
    const pass = u.searchParams.get("password");
    if ((u.pathname.includes("get.php") || u.pathname.includes("xmltv.php") ||
         u.pathname.includes("player_api.php")) && user && pass) {
      return { server: `${u.protocol}//${u.host}`, user, pass };
    }
    return null;
  } catch (_) { return null; }
}

/* ── Status line inside the settings panel ── */
function setStatus(msg, isError = false) {
  const el = $("cfg-error");
  el.textContent = msg;
  el.style.color = isError ? "#f87171" : "#a78bfa";
  el.classList.remove("hidden");
}

function hideError() {
  $("cfg-error").classList.add("hidden");
}

/* ── HTML escape helper ── */
// (defined earlier in the file)

/* ═══════════════════════════════════════════════════
   Playlist CRUD
═══════════════════════════════════════════════════ */
async function loadPlaylists() {
  const res = await chrome.storage.local.get("playlists");
  state.playlists = res.playlists || [];
}

async function savePlaylists() {
  await chrome.storage.local.set({ playlists: state.playlists });
}

function renderPlaylistList() {
  const ul = $("playlist-list");
  ul.innerHTML = "";
  if (!state.playlists.length) {
    ul.innerHTML = '<li style="color:#5555aa;cursor:default;font-size:12px;padding:6px 0">No playlists yet. Add one below.</li>';
    return;
  }
  for (const pl of state.playlists) {
    const li = document.createElement("li");
    li.className = pl.id === state.activePl ? "active-pl" : "";
    li.innerHTML = `<span class="pl-name">${escHtml(pl.name)}</span>` +
      `<span class="pl-type">${pl.type}</span>` +
      `<button class="pl-connect" data-id="${escHtml(pl.id)}">&#9654; Connect</button>` +
      `<button class="pl-delete" data-id="${escHtml(pl.id)}" title="Delete">&#10005;</button>`;
    li.querySelector(".pl-connect").addEventListener("click", e => { e.stopPropagation(); activatePlaylist(pl.id); });
    li.querySelector(".pl-delete").addEventListener("click", e => { e.stopPropagation(); deletePlaylist(pl.id); });
    ul.appendChild(li);
  }
}

function showPlaylistForm(pl = null) {
  state.editingPl = pl ? pl.id : null;
  $("playlist-form").classList.remove("hidden");
  $("add-playlist-wrap").classList.add("hidden");
  $("cfg-name").value = pl ? pl.name : "";
  const srcType = pl ? pl.type : "xtream";
  state.formSrcType = srcType;
  document.querySelectorAll(".src-tab").forEach(b => b.classList.toggle("active", b.dataset.src === srcType));
  $("src-xtream").classList.toggle("hidden", srcType !== "xtream");
  $("src-m3u").classList.toggle("hidden", srcType !== "m3u");
  if (pl && pl.type === "xtream") {
    $("cfg-server").value = pl.server || "";
    $("cfg-user").value   = pl.user   || "";
    $("cfg-pass").value   = pl.pass   || "";
    $("cfg-m3u").value    = "";
  } else if (pl && pl.type === "m3u") {
    $("cfg-m3u").value    = pl.m3uUrl || "";
    $("cfg-server").value = "";
    $("cfg-user").value   = "";
    $("cfg-pass").value   = "";
  } else {
    $("cfg-server").value = "";
    $("cfg-user").value   = "";
    $("cfg-pass").value   = "";
    $("cfg-m3u").value    = "";
  }
  hideError();
}

function hidePlaylistForm() {
  $("playlist-form").classList.add("hidden");
  $("add-playlist-wrap").classList.remove("hidden");
  hideError();
}

$("btn-add-playlist").addEventListener("click", () => showPlaylistForm());
$("btn-cancel-form").addEventListener("click", hidePlaylistForm);

$("btn-save").addEventListener("click", async () => {
  hideError();
  const name = $("cfg-name").value.trim() || "Playlist";
  const srcType = state.formSrcType;
  let pl;

  if (srcType === "m3u") {
    const raw = $("cfg-m3u").value.trim();
    if (!raw) { setStatus("Please enter a URL.", true); return; }
    const creds = tryParseXtreamFromUrl(raw);
    if (creds) {
      pl = { id: state.editingPl || String(Date.now()), name, type: "xtream", ...creds };
    } else {
      pl = { id: state.editingPl || String(Date.now()), name, type: "m3u", m3uUrl: raw };
    }
  } else {
    const server = $("cfg-server").value.trim();
    const user   = $("cfg-user").value.trim();
    const pass   = $("cfg-pass").value.trim();
    if (!server || !user || !pass) { setStatus("Fill in all Xtream fields.", true); return; }
    pl = { id: state.editingPl || String(Date.now()), name, type: "xtream", server, user, pass };
  }

  // Save immediately — no blocking connection test
  const idx = state.playlists.findIndex(p => p.id === pl.id);
  if (idx >= 0) state.playlists[idx] = pl; else state.playlists.push(pl);
  await savePlaylists();
  renderPlaylistList();
  hidePlaylistForm();
  // Auto-activate if first playlist or editing the active one
  if (state.playlists.length === 1 || state.activePl === pl.id) {
    activatePlaylist(pl.id);
  }
});

async function activatePlaylist(id) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return;
  state.activePl = id;
  await chrome.storage.local.set({ activePl: id });
  state.sourceType = pl.type;
  if (pl.type === "xtream") {
    state.server = pl.server; state.user = pl.user; state.pass = pl.pass;
  } else {
    state.m3uUrl = pl.m3uUrl;
  }
  // Clear cache so we get fresh data for this source
  state.streamCache  = { live: {}, vod: {}, series: {} };
  state.cacheProgress = { live: 0, vod: 0, series: 0 };
  state.cacheTotals   = { live: 0, vod: 0, series: 0 };
  $("active-playlist-name").textContent = pl.name;
  renderPlaylistList();
  panelSettings.classList.add("hidden");
  panelBrowser.classList.remove("hidden");

  if (pl.type === "m3u") {
    setStatus("⏳ Loading playlist…");
    // Check storage cache first (5 min TTL)
    const stored = await chrome.storage.local.get(["m3uResult", "m3uResultTs", "m3uUrl"]);
    if (stored.m3uResult?.ok && stored.m3uUrl === pl.m3uUrl && (Date.now() - (stored.m3uResultTs || 0)) < 300_000) {
      state.m3uGroups = stored.m3uResult.groups;
      launchBrowser("m3u");
      return;
    }
    state.m3uUrl = pl.m3uUrl;
    const onResult = (msg) => {
      if (msg.action !== "m3uResult") return;
      chrome.runtime.onMessage.removeListener(onResult);
      if (msg.ok) { state.m3uGroups = msg.groups; launchBrowser("m3u"); }
      else setStatus(`Error: ${msg.error}`, true);
    };
    chrome.runtime.onMessage.addListener(onResult);
    chrome.runtime.sendMessage({ action: "fetchM3U", url: pl.m3uUrl });
  } else {
    launchBrowser("xtream");
  }
}

async function deletePlaylist(id) {
  state.playlists = state.playlists.filter(p => p.id !== id);
  await savePlaylists();
  if (state.activePl === id) {
    state.activePl = null;
    await chrome.storage.local.remove("activePl");
    $("active-playlist-name").textContent = "";
  }
  renderPlaylistList();
}

function launchBrowser(mode) {
  panelSettings.classList.add("hidden");
  panelBrowser.classList.remove("hidden");
  browserMsg.classList.add("hidden");

  if (mode === "m3u") {
    typeTabs.classList.add("hidden");
    catListWrap.classList.remove("hidden");
    renderCategoryList(state.m3uGroups);
  } else {
    typeTabs.classList.remove("hidden");
    loadCategories("live");
  }
}

/* ═══════════════════════════════════════════════════
   Source type tabs inside the add/edit form (Xtream / M3U)
═══════════════════════════════════════════════════ */
document.querySelectorAll(".src-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".src-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.formSrcType = btn.dataset.src;
    $("src-xtream").classList.toggle("hidden", state.formSrcType !== "xtream");
    $("src-m3u").classList.toggle("hidden",    state.formSrcType !== "m3u");
    hideError();
  });
});

/* ═══════════════════════════════════════════════════
   Content type tabs (Live / VOD / Series) — Xtream only
═══════════════════════════════════════════════════ */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadCategories(btn.dataset.type);
  });
});

/* ═══════════════════════════════════════════════════
   Settings toggle
═══════════════════════════════════════════════════ */
$("btn-settings").addEventListener("click", () => {
  const settingsOpen = !panelSettings.classList.contains("hidden");
  // Only allow closing settings if there's an active playlist to go back to
  if (settingsOpen && !state.activePl) return;
  panelSettings.classList.toggle("hidden", settingsOpen);
  panelBrowser.classList.toggle("hidden", !settingsOpen);
  if (!settingsOpen) renderPlaylistList();
  hideError();
});

/* ═══════════════════════════════════════════════════
   Back to categories
═══════════════════════════════════════════════════ */
$("btn-back-cats").addEventListener("click", () => {
  streamListWrap.classList.add("hidden");
  catListWrap.classList.remove("hidden");
  catSearch.value = "";
  if (state.sourceType === "m3u") {
    renderCategoryList(state.m3uGroups);
  } else {
    renderCategoryList(state.categories);
  }
});

/* ═══════════════════════════════════════════════════
   Live search / filter
═══════════════════════════════════════════════════ */
catSearch.addEventListener("input", () => {
  const cats = state.sourceType === "m3u" ? state.m3uGroups : state.categories;
  renderCategoryList(cats, catSearch.value.trim());
});

streamSearch.addEventListener("input", () => {
  renderStreamList(state.streams, streamSearch.value);
});

// EPG toggle
const epgToggle = $("toggle-epg");
if (epgToggle) {
  epgToggle.addEventListener("change", () => {
    state.epgShowToggle = epgToggle.checked;
    renderStreamList(state.streams, streamSearch.value);
  });
}

/* ═══════════════════════════════════════════════════
   Restore saved session on popup open
═══════════════════════════════════════════════════ */
(async () => {
  await loadPlaylists();
  renderPlaylistList();

  const res = await chrome.storage.local.get("activePl");
  const activePl = res.activePl && state.playlists.find(p => p.id === res.activePl);
  if (!activePl) return; // show settings panel (already visible by default)

  const pl = activePl;
  state.activePl   = pl.id;
  state.sourceType = pl.type;
  if (pl.type === "xtream") {
    state.server = pl.server; state.user = pl.user; state.pass = pl.pass;
    await Promise.all(["live", "vod", "series"].map(t => loadCacheFromStorage(t)));
    $("active-playlist-name").textContent = pl.name;
    launchBrowser("xtream");
  } else {
    state.m3uUrl = pl.m3uUrl;
    $("active-playlist-name").textContent = pl.name;
    const stored = await chrome.storage.local.get(["m3uResult", "m3uResultTs", "m3uUrl"]);
    if (stored.m3uResult?.ok && stored.m3uUrl === pl.m3uUrl && (Date.now() - (stored.m3uResultTs || 0)) < 300_000) {
      state.m3uGroups = stored.m3uResult.groups;
      launchBrowser("m3u");
    } else {
      setStatus("⏳ Loading playlist…");
      const onResult = (msg) => {
        if (msg.action !== "m3uResult") return;
        chrome.runtime.onMessage.removeListener(onResult);
        if (msg.ok) { state.m3uGroups = msg.groups; launchBrowser("m3u"); }
        else setStatus(`Error: ${msg.error}`, true);
      };
      chrome.runtime.onMessage.addListener(onResult);
      chrome.runtime.sendMessage({ action: "fetchM3U", url: pl.m3uUrl });
      // Still show browser panel while loading
      panelSettings.classList.add("hidden");
      panelBrowser.classList.remove("hidden");
    }
  }
})();
