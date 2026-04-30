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

  /* ── Shared fetch with timeout ── */
  async _fetch(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const resp = await fetch(url, { signal: ctrl.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} from server`);
      return resp.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Connection timed out (20s)");
      throw new Error(`${e.message} — check server URL and credentials`);
    } finally {
      clearTimeout(timer);
    }
  },

  /* ── Category endpoints (returns Promise<Array>) ── */
  async fetchCategories(server, user, pass, type) {
    const actionMap = {
      live:   "get_live_categories",
      vod:    "get_vod_categories",
      series: "get_series_categories",
    };
    return this._fetch(this.apiUrl(server, user, pass, actionMap[type]));
  },

  /* ── Stream list by category ── */
  async fetchStreams(server, user, pass, type, categoryId) {
    const actionMap = {
      live:   "get_live_streams",
      vod:    "get_vod_streams",
      series: "get_series",
    };
    return this._fetch(this.apiUrl(server, user, pass, actionMap[type], { category_id: categoryId }));
  },

  /* ── Series episodes (for a specific series) ── */
  async fetchSeriesInfo(server, user, pass, seriesId) {
    return this._fetch(this.apiUrl(server, user, pass, "get_series_info", { series_id: seriesId }));
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
    const cats = (state.sourceType === "m3u" || state.sourceType === "file") ? state.m3uGroups : state.categories;
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
      if (state.sourceType === "m3u" || state.sourceType === "file") {
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
  state.visibleStreams = filtered; // track for prev/next playlist
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
  // Series folder → show seasons/episodes first
  if (state.currentType === "series" && state.sourceType === "xtream" && stream.series_id) {
    await openSeriesInfo(stream);
    return;
  }

  function buildStreamUrl(s) {
    if (state.sourceType === "m3u" || state.sourceType === "file") return s.url;
    const ext = s.container_extension || (state.currentType === "live" ? "m3u8" : "mp4");
    const id  = s.stream_id || s.series_id;
    return XtreamAPI.streamUrl(state.server, state.user, state.pass, state.currentType, id, ext);
  }

  const streamUrl = buildStreamUrl(stream);

  // Build playlist for prev/next — use the currently-visible filtered list
  const visible = state.visibleStreams || [stream];
  const playlist = visible
    .filter(s => !(state.currentType === "series" && s.series_id)) // skip series folders
    .map(s => ({ url: buildStreamUrl(s), name: s.name || s.title || "" }));
  const currentIdx = Math.max(0, playlist.findIndex(p => p.url === streamUrl));

  await chrome.storage.local.set({
    lastStream:       { url: streamUrl, name: stream.name || stream.title },
    playerPlaylist:   playlist,
    playerIdx:        currentIdx,
    playerCategories: (state.sourceType === "m3u" || state.sourceType === "file")
                        ? state.m3uGroups.map(g => ({ name: g.name, streams: g.streams.map(s => ({ url: buildStreamUrl(s), name: s.name, logo: s.logo || s.stream_icon || "" })) }))
                        : null,
  });
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
    if (state.sourceType === "m3u" || state.sourceType === "file") {
      // M3U/file: streams already grouped in memory
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

function renderPlaylistList(filterVal) {
  const q = (filterVal !== undefined ? filterVal : ($('playlist-search') ? $('playlist-search').value : '')).toLowerCase().trim();
  const ul = $("playlist-list");
  ul.innerHTML = "";
  const visible = q ? state.playlists.filter(pl => pl.name.toLowerCase().includes(q)) : state.playlists;
  if (!state.playlists.length) {
    ul.innerHTML = '<li style="color:#5555aa;cursor:default;font-size:12px;padding:6px 0">No playlists yet. Add one below.</li>';
    return;
  }
  if (!visible.length) {
    ul.innerHTML = '<li style="color:#5555aa;cursor:default;font-size:12px;padding:6px 0">No matches.</li>';
    return;
  }
  for (const pl of visible) {
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
  $("src-m3u").classList.toggle("hidden",    srcType !== "m3u");
  $("src-file").classList.toggle("hidden",   srcType !== "file");
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
  if ($("cfg-file")) $("cfg-file").value = "";
  hideError();
}

function hidePlaylistForm() {
  $("playlist-form").classList.add("hidden");
  $("add-playlist-wrap").classList.remove("hidden");
  hideError();
}

$("btn-add-playlist").addEventListener("click", () => showPlaylistForm());
$("btn-cancel-form").addEventListener("click", hidePlaylistForm);
$("playlist-search").addEventListener("input", () => renderPlaylistList());

/* ═══════════════════════════════════════════════════
   Local M3U file parser (FileReader — no network needed)
═══════════════════════════════════════════════════ */
function parseM3UText(text, defaultGroup = "Channels") {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let current = null;
  // First pass: detect whether any group-title attributes are present
  const hasGroups = /group-title="/i.test(text);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXTINF")) {
      const name       = line.replace(/^#EXTINF[^,]*,/, "").trim();
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch  = line.match(/tvg-logo="([^"]*)"/i);
      // Use group-title if file has them; otherwise fall back to defaultGroup (filename)
      const group = hasGroups
        ? (groupMatch?.[1]?.trim() || "Uncategorized")
        : defaultGroup;
      current = { name: name || "Unnamed", group, logo: logoMatch ? logoMatch[1] : "" };
    } else if (line && !line.startsWith("#") && current) {
      current.url = line;
      channels.push(current);
      current = null;
    }
  }
  const map = {};
  for (const ch of channels) {
    if (!map[ch.group]) map[ch.group] = [];
    map[ch.group].push(ch);
  }
  const groups = Object.keys(map).sort().map(g => ({
    category_id: g, category_name: g, streams: map[g],
  }));
  return { groups, total: channels.length };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

/* ═══════════════════════════════════════════════════
   Save button — handles xtream / m3u URL / m3u file(s)
═══════════════════════════════════════════════════ */
$("btn-save").addEventListener("click", async () => {
  hideError();
  const name    = $("cfg-name").value.trim() || "Playlist";
  const srcType = state.formSrcType;

  // ── M3U File(s) ──────────────────────────────────
  if (srcType === "file") {
    const files = Array.from($("cfg-file").files || []);
    if (!files.length) { setStatus("Please select at least one .m3u file.", true); return; }
    let added = 0;
    for (const file of files) {
      try {
        const baseName = file.name.replace(/\.m3u8?$/i, "");
        const text     = await readFileAsText(file);
        const parsed   = parseM3UText(text, baseName);
        if (!parsed.total) { setStatus(`${file.name}: 0 channels found — skipped`, true); continue; }
        const plName   = (files.length === 1 && name) ? name : baseName;
        const pl = {
          id:       String(Date.now()) + "_" + added,
          name:     plName,
          type:     "file",
          m3uGroups: parsed.groups,
          total:    parsed.total,
        };
        state.playlists.push(pl);
        added++;
      } catch (e) {
        setStatus(`Error reading ${file.name}: ${e.message}`, true);
      }
    }
    if (!added) return;
    await savePlaylists();
    renderPlaylistList();
    hidePlaylistForm();
    setStatus(`✓ ${added} playlist(s) imported`);
    if (state.playlists.length === added) activatePlaylist(state.playlists[0].id);
    return;
  }

  // ── M3U URL ──────────────────────────────────────
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
    // ── Xtream ───────────────────────────────────────
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
  if (state.playlists.length === 1 || state.activePl === pl.id) {
    activatePlaylist(pl.id);
  }
});

async function activatePlaylist(id) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return;

  // Close any existing player stream before switching
  if (state.activePl && state.activePl !== id) {
    chrome.runtime.sendMessage({ action: "closeStream" });
    await new Promise(r => setTimeout(r, 300)); // brief pause so server releases the slot
  }

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

  if (pl.type === "file") {
    // Groups are stored inline — no fetch needed
    state.m3uGroups = pl.m3uGroups || [];
    launchBrowser("m3u");
  } else if (pl.type === "m3u") {
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
    await chrome.storage.local.remove(["activePl", "streamCache_live", "streamCache_vod", "streamCache_series",
                                       "m3uResult", "m3uResultTs", "m3uUrl"]);
    $("active-playlist-name").textContent = "";
    // Kill the player tab and stop the stream
    chrome.runtime.sendMessage({ action: "closeStream" });
    // Return to settings panel
    panelBrowser.classList.add("hidden");
    panelSettings.classList.remove("hidden");
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
   Source type tabs inside the add/edit form (Xtream / M3U / File)
═══════════════════════════════════════════════════ */
document.querySelectorAll(".src-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".src-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.formSrcType = btn.dataset.src;
    $("src-xtream").classList.toggle("hidden", state.formSrcType !== "xtream");
    $("src-m3u").classList.toggle("hidden",    state.formSrcType !== "m3u");
    $("src-file").classList.toggle("hidden",   state.formSrcType !== "file");
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
  if (state.sourceType === "m3u" || state.sourceType === "file") {
    renderCategoryList(state.m3uGroups);
  } else {
    renderCategoryList(state.categories);
  }
});

/* ═══════════════════════════════════════════════════
   Live search / filter
═══════════════════════════════════════════════════ */
catSearch.addEventListener("input", () => {
  const cats = (state.sourceType === "m3u" || state.sourceType === "file") ? state.m3uGroups : state.categories;
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
