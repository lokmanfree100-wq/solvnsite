/**
 * Local persistence: settings, library lists, watch progress, search history.
 * Everything lives in localStorage under namespaced keys and survives reloads.
 */

const NS = 'kitsune:';
const read = (k, fallback) => {
  try {
    const raw = localStorage.getItem(NS + k);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(NS + k, JSON.stringify(v));
  } catch { /* storage full or blocked */ }
};

export const LISTS = ['watching', 'completed', 'onHold', 'dropped', 'planned'];
export const LIST_LABELS = {
  watching: 'Watching',
  completed: 'Completed',
  onHold: 'On Hold',
  dropped: 'Dropped',
  planned: 'Plan to Watch',
};

export const DEFAULT_ACCENT = 'violet';
/** Highlight shades, id -> hex the framed player also accepts. Keep in sync with
   the --accent fill in tokens.css; violet is :root itself. */
export const ACCENTS = {
  violet: '8b6cff',
  iris: '6d7bff',
  orchid: 'c06bff',
  lilac: 'd5c7ff',
};
export const accentHex = (id) => ACCENTS[id] || ACCENTS[DEFAULT_ACCENT];

/* ---- quality --------------------------------------------------------
   The framed player owns the stream, so this is a request, not a promise: the
   number is remembered, shown as the target, and used to pick the
   highest-bitrate source this device can decode. Never label it "playing in 4K". */
export const QUALITIES = [
  { id: 'auto', label: 'Auto' },
  { id: '144p', label: '144p' },
  { id: '360p', label: '360p' },
  { id: '480p', label: '480p' },
  { id: '720p', label: '720p HD' },
  { id: '1080p', label: '1080p Full HD' },
  { id: '1440p', label: '1440p QHD' },
  { id: '2160p', label: '2160p 4K' },
];
export const qualityLabel = (id) => (QUALITIES.find((q) => q.id === id) || QUALITIES[0]).label;

const DEFAULT_SETTINGS = {
  lang: 'en',
  accent: DEFAULT_ACCENT,
  autoplay: true, // embed advances to next episode on its own
  defaultAudio: 'sub', // sub | dub
  quality: 'auto', // target bitrate class, see QUALITIES
  theater: false, // watch page dims the rest of the interface
  scheduleView: 'list', // list | calendar on the airing schedule
  showNsfw: false,
  reduceBackdrop: false,
  discordHook: '', // optional Discord webhook for a status line
  discordShare: false, // post it as each episode starts
  servers: [], // extra streaming servers the ladder may try, see lib/sources.js
  failover: 8, // seconds the player waits for a frame before hopping servers
  serverStats: {}, // which servers this device has seen answer, see lib/sources.js
  welcomeDismissed: false, // Home greeting strip is turned off for good
  /* What the footer is allowed to show. Nothing in the footer links to another
     site any more, so this is only the address a rights holder writes to — and
     the DMCA paragraph stays worded without a mailto until it is filled in. */
  contactEmail: '',
};

/* ---- settings ------------------------------------------------------ */
export const settings = {
  get all() {
    return { ...DEFAULT_SETTINGS, ...read('settings', {}) };
  },
  get(key) {
    return this.all[key];
  },
  set(key, value) {
    write('settings', { ...read('settings', {}), [key]: value });
    settingsListeners.forEach((fn) => fn(key, value));
  },
  reset() {
    write('settings', {});
    settingsListeners.forEach((fn) => fn('*', null));
  },
};

const settingsListeners = [];
export function onSettings(fn) {
  settingsListeners.push(fn);
  return () => settingsListeners.splice(settingsListeners.indexOf(fn), 1);
}

/* ---- guest ---------------------------------------------------------- */
/** "Continue as Guest" is a durable choice: this device stops prompting. */
export const isGuest = () => read('guest', false) === true;

export function setGuest(on) {
  write('guest', Boolean(on));
}

/* ---- admin: hold the local numbers back ----------------------------- */
/**
 * God mode edits the server copy of a member's stats. This device would
 * overwrite them with its own estimate on the next episode, so the admin page
 * can pin its figures while it plays with them.
 */
export const statsLocked = () => read('statsLock', false) === true;

export function setStatsLock(on) {
  write('statsLock', Boolean(on));
}

/* ---- now watching ---------------------------------------------------- */
/* Only the current episode of the current title, and only for a while — a
   "now watching" line that never expires is just an old log entry. */
const NOW_TTL = 40 * 60 * 1000;

export function setNowWatching(media, ep) {
  write('now', {
    id: media.id,
    title: pickTitle(media),
    cover: media.coverImage?.large || null,
    ep: Number(ep) || 1,
    at: Date.now(),
  });
}

export function nowWatching() {
  const n = read('now', null);
  if (!n || !n.id || Date.now() - (n.at || 0) > NOW_TTL) return null;
  return n;
}

/* ---- library ------------------------------------------------------- */
function listsMap() {
  const raw = read('lists', {});
  const out = {};
  for (const k of LISTS) out[k] = Array.isArray(raw[k]) ? raw[k] : [];
  return out;
}

export function listEntries(list) {
  const arr = listsMap()[list] || [];
  return [...arr].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export function inList(mediaId) {
  const map = listsMap();
  for (const k of LISTS) if (map[k].some((e) => e.id === mediaId)) return k;
  return null;
}

export function toggleList(media, list) {
  const map = listsMap();
  const was = map[list].find((e) => e.id === media.id);
  for (const k of LISTS) map[k] = map[k].filter((e) => e.id !== media.id);
  if (!was) {
    map[list] = [
      { id: media.id, addedAt: Date.now(), title: pickTitle(media), cover: media.coverImage?.large, format: media.format, episodes: media.episodes, seasonYear: media.seasonYear },
      ...map[list],
    ];
  }
  write('lists', map);
  return !was;
}

export function removeFromLists(mediaId) {
  const map = listsMap();
  for (const k of LISTS) map[k] = map[k].filter((e) => e.id !== mediaId);
  write('lists', map);
}

export function listCount(list) {
  return (listsMap()[list] || []).length;
}

export function totalListCount() {
  return LISTS.reduce((n, k) => n + listCount(k), 0);
}

/* ---- favourites (heart) -------------------------------------------- */
export function favouriteEntries() {
  return read('favs', [])
    .map((f) => (typeof f === 'number' ? { id: f } : f))
    .filter(Boolean)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
export function favouriteIds() {
  return new Set(favouriteEntries().map((f) => f.id));
}
export function isFavourite(id) {
  return favouriteIds().has(id);
}
export function toggleFavourite(media) {
  const arr = read('favs', []).map((f) => (typeof f === 'number' ? { id: f } : f));
  const exists = arr.some((f) => f.id === media.id);
  const next = exists ? arr.filter((f) => f.id !== media.id) : [
    { id: media.id, addedAt: Date.now(), title: pickTitle(media), cover: media.coverImage?.large, format: media.format, episodes: media.episodes, seasonYear: media.seasonYear },
    ...arr,
  ];
  write('favs', next);
  return !exists;
}

/* ---- continue watching --------------------------------------------- */
export function progressMap() {
  return read('progress', {});
}
export function getProgress(id) {
  return progressMap()[String(id)] || null;
}
export function setProgress(media, episode, opts = {}) {
  const map = progressMap();
  const key = String(media.id);
  const prev = map[key] || {};
  const mins = opts.mins ?? prev.mins ?? runtimeOf(media);
  map[key] = {
    id: media.id,
    title: pickTitle(media),
    cover: media.coverImage?.large,
    format: media.format,
    total: media.episodes || prev.total || null,
    episode,
    audio: opts.audio || prev.audio || 'sub',
    at: Date.now(),
    seconds: opts.seconds ?? prev.seconds ?? 0,
    duration: opts.duration ?? prev.duration ?? 0,
    mins,
  };
  // keep the map small — most recent 60 titles
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 60),
  );
  write('progress', trimmed);
  markWatched(media, episode, mins);
}
export function continueWatching(limit = 20) {
  return Object.values(progressMap())
    .filter((p) => p && p.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}
export function clearProgress(id) {
  const map = progressMap();
  delete map[String(id)];
  write('progress', map);
}

/* ---- viewing log --------------------------------------------------- */
/**
 * Every episode this browser has opened, keyed by title + number so a rewatch
 * moves the timestamp instead of counting twice. Profile numbers are derived
 * from here, which makes them an honest estimate rather than a measurement:
 * the player iframe never tells us how much of a frame was actually watched.
 */
const SEEN_TITLES = 200;
const SEEN_EPISODES = 400;

function seenMap() {
  const raw = read('seen', {});
  return raw && typeof raw === 'object' ? raw : {};
}

function runtimeOf(media) {
  const mins = Number(media?.duration) || 0;
  return mins > 0 && mins < 240 ? Math.round(mins) : 24;
}

const newest = (entry) =>
  Object.values(entry?.eps || {}).reduce((max, v) => Math.max(max, v.at || 0), 0);

function trimSeen(map) {
  const out = {};
  const keep = Object.entries(map)
    .sort((a, b) => newest(b[1]) - newest(a[1]))
    .slice(0, SEEN_TITLES);
  for (const [key, entry] of keep) {
    const pairs = Object.entries(entry.eps || {});
    entry.eps = Object.fromEntries(
      pairs.length > SEEN_EPISODES
        ? pairs.sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, SEEN_EPISODES)
        : pairs,
    );
    out[key] = entry;
  }
  return out;
}

export function markWatched(media, episode, mins) {
  if (!media?.id || !episode) return;
  const map = seenMap();
  const key = String(media.id);
  const entry = map[key] || { title: pickTitle(media), eps: {} };
  entry.eps = entry.eps || {};
  const minutes = Number(mins);
  entry.eps[String(episode)] = { at: Date.now(), mins: minutes > 0 ? Math.round(minutes) : runtimeOf(media) };
  map[key] = entry;
  write('seen', trimSeen(map));
}

/** Flat, oldest-first list of every episode open recorded on this device. */
export function viewLog() {
  const out = [];
  for (const [id, entry] of Object.entries(seenMap())) {
    for (const [ep, v] of Object.entries(entry.eps || {})) {
      out.push({
        id: Number(id) || id,
        title: entry.title || '',
        episode: Number(ep),
        at: v.at || 0,
        mins: v.mins || 0,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function clearViewLog() {
  write('seen', {});
}

/* ---- history ------------------------------------------------------- */
export function history(limit = 30) {
  return read('history', []).slice(0, limit);
}
export function pushHistory(media) {
  const arr = read('history', []).filter((e) => e.id !== media.id);
  arr.unshift({ id: media.id, title: pickTitle(media), cover: media.coverImage?.large, at: Date.now() });
  write('history', arr.slice(0, 60));
}
export function clearHistory() {
  write('history', []);
}

/* ---- search history ------------------------------------------------ */
export function recentSearches(limit = 10) {
  return read('queries', []).slice(0, limit);
}
export function pushQuery(q) {
  const t = q.trim();
  if (t.length < 2) return;
  const arr = read('queries', []).filter((x) => x.toLowerCase() !== t.toLowerCase());
  write('queries', [t, ...arr].slice(0, 12));
}
export function clearQueries() {
  write('queries', []);
}

/* ---- wipe ---------------------------------------------------------- */
export function clearAll() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(NS) && !k.startsWith('kitsune:anilist:'))
    .forEach((k) => localStorage.removeItem(k));
}

/* ---- shared -------------------------------------------------------- */
export function pickTitle(media) {
  return media?.title?.english || media?.title?.romaji || media?.title?.native || 'Untitled';
}
