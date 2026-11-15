import { settings } from './store.js';
import { isMediaUrl, blockedHost } from './sources.js';
import { STREMIO_ADDONS as DEFAULT_STREMIO_ADDONS } from './defaults.js';
import { gql } from './anilist.js';
import { proxyUrl, API_HOST } from './proxy.js';
import { isYtId, ytEmbedUrl } from './youtube.js';

const STORAGE_KEY = 'stremioAddons';
/* Bumped to v3: CORS fix (blob-URL captions) + Solvn add-on redeploy changed
   what streams/captions are served, so pre-v3 entries (cached before the fix)
   must not be served. Old keys are dropped on first load to free the space. */
const CACHE_KEY = 'stremioStreamCache3';
const MAP_CACHE_KEY = 'stremioIdMap3';
try { localStorage.removeItem('stremioStreamCache'); } catch {}
try { localStorage.removeItem('stremioStreamCache2'); } catch {}
try { localStorage.removeItem('stremioIdMap'); } catch {}
try { localStorage.removeItem('stremioIdMap2'); } catch {}
/* Drop stale TMDB stream cache entries written under the old key prefix. */
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && (k.startsWith('stremio.tmdb:') || k.startsWith('stremio.tmdb2:'))) localStorage.removeItem(k);
  }
} catch {}
const CACHE_TTL = 12 * 60 * 60 * 1000;
const MAP_TTL = 7 * 24 * 60 * 60 * 1000;
const MANIFEST_TTL = 60 * 60 * 1000;
const EMPTY_TTL = 10 * 60 * 1000; // cache "no streams" briefly so misses are not refetched
const manifestMem = new Map();
const inflight = new Map(); // de-dupe concurrent identical fetches
let cooldownUntil = 0; // circuit breaker: stop hitting the proxy after repeated 429s

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* CORS is not a server feature here: solvn.site is static, so an add-on that
   refuses a cross-origin read is fetched through the site's dedicated CORS
   proxy (stremioProxy, a Cloudflare Worker). The direct fetch always wins when
   the add-on allows it, and there is no third-party proxy in the chain. */

export function storedStremioAddons() {
  const v = settings.get(STORAGE_KEY);
  const stored = Array.isArray(v) ? v : [];
  const def = Array.isArray(DEFAULT_STREMIO_ADDONS) ? DEFAULT_STREMIO_ADDONS : [];
  const merged = [...def];
  for (const u of stored) if (!merged.includes(u)) merged.push(u);
  return merged;
}

export function stremioAddonProblem(url) {
  const raw = String(url || '').trim();
  if (!raw) return 'Add an add-on address.';
  if (raw.length > 500) return 'That address is too long.';
  if (!/^https:\/\/\S+$/i.test(raw)) return 'It must start with https://';
  try { new URL(raw); } catch { return 'That is not a valid URL.'; }
  return null;
}

export function addStremioAddon(url) {
  const problem = stremioAddonProblem(url);
  if (problem) return problem;
  const clean = String(url).trim().replace(/\/+$/, '');
  const list = storedStremioAddons().slice();
  if (list.includes(clean)) return 'Already added.';
  list.push(clean);
  settings.set(STORAGE_KEY, list);
  return null;
}

export function removeStremioAddon(url) {
  const clean = String(url).trim().replace(/\/+$/, '');
  settings.set(STORAGE_KEY, storedStremioAddons().filter((u) => u !== clean));
}

/* ---- Proxy-aware fetch (clean CORS) ------------------------------------ */
function addonUrl(base, relPath) {
  const b = String(base).replace(/\/+$/, '');
  const p = String(relPath).replace(/^\/+/, '');
  return `${b}/${p}`;
}

async function directFetch(url) {
  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status, json: null, text: '' };
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: true, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: '', error: String((e && e.message) || e) };
  }
}

async function siteProxyFetch(base, relPath) {
  // Netlify function, only when a proxy host is configured.
  try {
    const target = encodeURIComponent(base);
    const p = encodeURIComponent(relPath);
    const url = proxyUrl(`/.netlify/functions/proxy?kind=stremio&target=${target}&path=${p}`);
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) return { ok: false, status: res.status, json: null, text: '' };
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: true, status: res.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: '', error: String((e && e.message) || e) };
  }
}

function configuredProxy() {
  try {
    const t = String(settings.get('stremioProxy') || '').trim();
    if (t && t.includes('{url}')) return t;
  } catch {}
  return null;
}

async function configuredProxyFetch(url) {
  const cfg = configuredProxy();
  if (!cfg) return { ok: false, status: 0, json: null, text: '' };
  const framed = cfg.replace('{url}', encodeURIComponent(url));
  let last = { ok: false, status: 0, json: null, text: '' };
  /* A 429 is transient: honour retry-after (capped) and try once more before
     giving up, so a burst never turns into a visible empty player. */
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(framed, { mode: 'cors', credentials: 'omit' });
      if (res.status === 429 && attempt === 0) {
        const ra = Number(res.headers.get('retry-after')) || 0;
        await sleep(Math.min(Math.max(ra * 1000, 700), 3500));
        continue;
      }
      if (res.status === 429) {
        /* Still throttled after one retry: back off for a minute so the page
           stops spending the quota, and report it as a soft failure. */
        cooldownUntil = Date.now() + 60_000;
        return { ok: false, status: 429, json: null, text: '' };
      }
      if (!res.ok) return { ok: false, status: res.status, json: null, text: '' };
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { ok: true, status: res.status, json, text };
    } catch (e) {
      last = { ok: false, status: 0, json: null, text: '', error: String((e && e.message) || e) };
    }
  }
  return last;
}

async function addonFetchInner(base, relPath) {
  const url = addonUrl(base, relPath);
  const direct = await directFetch(url);
  if (direct.ok) return direct;
  // 1. Site's own Netlify function, when configured.
  if (API_HOST) {
    const site = await siteProxyFetch(base, relPath);
    if (site.ok) return site;
  }
  // 2. The dedicated CORS proxy (stremioProxy). No third-party proxies.
  if (Date.now() < cooldownUntil) return { ok: false, status: 429, json: null, text: '', error: 'proxy cooling down' };
  const cfg = await configuredProxyFetch(url);
  if (cfg.ok) return cfg;
  return direct; // keep the original error for the report
}

function addonFetch(base, relPath) {
  const key = `${base}|${relPath}`;
  const hit = inflight.get(key);
  if (hit) return hit;
  const p = addonFetchInner(base, relPath).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fetchManifest(base) {
  const hit = manifestMem.get(base);
  if (hit && Date.now() - hit.t < MANIFEST_TTL) return hit.v;
  const r = await addonFetch(base, 'manifest.json');
  let out;
  if (!r.ok) out = { manifest: null, error: r.error || (r.status ? `HTTP ${r.status}` : 'unreachable') };
  else if (!r.json || typeof r.json !== 'object') out = { manifest: null, error: 'invalid manifest' };
  else out = { manifest: r.json, error: null };
  if (out.manifest) manifestMem.set(base, { t: Date.now(), v: out });
  return out;
}

export async function testAddon(base) {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  const problem = stremioAddonProblem(clean);
  if (problem) return { ok: false, error: problem, manifest: null, streams: [] };
  const { manifest, error } = await fetchManifest(clean);
  if (!manifest) {
    return {
      ok: false,
      error: (error || 'no manifest') + ' (direct and the site CORS proxy both failed — the add-on may be down, or set a working proxy in Settings)',
      manifest: null,
      streams: [],
    };
  }
  const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
  const hasStream = resources.some((r) => (typeof r === 'string' ? r === 'stream' : r?.name === 'stream'));
  if (!hasStream) {
    return { ok: false, error: 'Addon provides no streams (catalog/meta only).', manifest: { name: manifest.name, version: manifest.version, types: manifest.types, idPrefixes: manifest.idPrefixes }, streams: [] };
  }
  const streams = await fetchStremioStreams(16498, 1, [clean]);
  return {
    ok: true,
    error: null,
    manifest: { name: manifest.name || clean, version: manifest.version || '', types: Array.isArray(manifest.types) ? manifest.types : [], idPrefixes: Array.isArray(manifest.idPrefixes) ? manifest.idPrefixes : [] },
    streams,
  };
}

/* ---- ID mapping --------------------------------------------------------- */
async function fetchIdMapping(anilistId) {
  const id = Number(anilistId);
  if (!Number.isFinite(id) || id <= 0) return { anilist: String(anilistId), mal: null, imdb: null };
  try {
    const cache = settings.get(MAP_CACHE_KEY) || {};
    const rec = cache[id];
    if (rec && Date.now() - rec.t < MAP_TTL) return rec.v;
  } catch {}
  let mal = null;
  let imdb = null;
  let kitsu = null;
  try {
    const data = await gql('query ($id: Int) { Media(id: $id) { idMal externalLinks { site url } } }', { id });
    const m = data?.Media;
    if (m) {
      mal = m.idMal ? Number(m.idMal) : null;
      const links = Array.isArray(m.externalLinks) ? m.externalLinks : [];
      for (const l of links) {
        const site = String(l?.site || '').toLowerCase();
        const url = String(l?.url || '');
        if (site.includes('imdb') || /imdb\.com\/title\/(tt\d+)/i.test(url)) {
          const mm = url.match(/tt\d+/);
          if (mm) imdb = mm[0];
        }
        /* AniList usually links Kitsu; use it when ani.zip lacks a mapping. */
        if (site.includes('kitsu') || /kitsu\.(?:io|app)\/anime\/(\d+)/i.test(url)) {
          const km = url.match(/anime\/(\d+)/);
          if (km) kitsu = Number(km[1]) || null;
        }
      }
    }
  } catch {}
  /* AcuAnime (and others) key off Kitsu ids; fetch from ani.zip. */
  try {
    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${id}`, { cache: 'default' });
    if (res.ok) {
      const data = await res.json();
      const m = data?.mappings || {};
      if (m.kitsu_id) kitsu = Number(m.kitsu_id) || null;
      if (!imdb && m.imdb_id) imdb = String(m.imdb_id);
    }
  } catch {}
  const v = { anilist: String(anilistId), mal, imdb, kitsu };
  try {
    const cache = settings.get(MAP_CACHE_KEY) || {};
    cache[id] = { t: Date.now(), v };
    settings.set(MAP_CACHE_KEY, cache);
  } catch {}
  return v;
}

function candidateIds(mapping, episode, prefixes) {
  const ep = Number(episode) || 1;
  const all = [];
  /* Episode-specific ids are tried first: an addon that keys off them (AcuAnime)
     returns the right episode, while an addon that ignores the suffix returns
     an empty list and we fall through to the base id (Anixio-style). The AniList
     pair is skipped when there is no AniList id: the TMDB fallback can turn up
     an IMDb id alone for a live-action title. */
  if (mapping.anilist) {
    all.push(`anilist:${mapping.anilist}:${ep}`);
    all.push(`anilist:${mapping.anilist}`);
  }
  if (mapping.mal) {
    all.push(`mal:${mapping.mal}:${ep}`);
    all.push(`mal:${mapping.mal}`);
  }
  if (mapping.kitsu) {
    all.push(`kitsu:${mapping.kitsu}:${ep}`);
    all.push(`kitsu:${mapping.kitsu}`);
  }
  if (mapping.imdb) {
    all.push(`${mapping.imdb}:${ep}`);
    all.push(mapping.imdb);
  }
  const filtered = (prefixes && prefixes.length)
    ? all.filter((c) => prefixes.some((p) => c.startsWith(p) || c.split(':')[0] === String(p).replace(/:$/, '')))
    : all;
  const list = (filtered.length ? filtered : all);
  return [...new Set(list)];
}

/* ---- Stream caching ----------------------------------------------------- */
function cacheKey(anilistId, episode) { return `${anilistId}:${episode}`; }

function readCache(anilistId, episode) {
  try {
    const cache = settings.get(CACHE_KEY) || {};
    const rec = cache[cacheKey(anilistId, episode)];
    const ttl = rec?.ttl || CACHE_TTL;
    if (rec && Date.now() - rec.t < ttl && Array.isArray(rec.v)) return rec.v;
  } catch {}
  return null;
}

function writeCache(anilistId, episode, streams, ttl) {
  try {
    const cache = settings.get(CACHE_KEY) || {};
    cache[cacheKey(anilistId, episode)] = { t: Date.now(), v: streams, ttl: ttl || CACHE_TTL };
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
      for (let i = 0; i < keys.length - 200; i++) delete cache[keys[i]];
    }
    settings.set(CACHE_KEY, cache);
  } catch {}
}

/* Add-ons answer "nothing here" with a real .mp4 of a message card
   (Yukistreams: /assets/stream-errors/no-stream-found.mp4, PenguPlay:
   /signin.mp4) and flag it with behaviorHints.notWebReady. Those are
   placeholders, not media, so they must never reach the player. */
const PLACEHOLDER_STREAM = /\/assets\/stream-errors\/|\/(?:no-stream-found|media-unsupported|signin)\.mp4(?:$|\?)/i;
/* `notWebReady` alone is NOT a placeholder signal: legitimate proxy addons
   (e.g. AcuAnime) mark real streams with it because they need headers, and
   serve them through their own /proxy/ URL. Treat a stream as a placeholder
   only when its URL is a known error/sign-in card. */
const isPlaceholderStream = (url, stream) => PLACEHOLDER_STREAM.test(String(url || ''));

/* Resolve a stream title to the episode number it claims, or null. Mirrors the
   watch-page parser so "the episode it plays" is defined identically in both.
   AcuAnime stream titles look like:
     "Attack on Titan S1 • E5 - \"First Battle: Battle of Trost (1)\""
     "One Piece S14 • E500 - \"...\""   */
function matchEpisode(title, want) {
  if (!Number.isFinite(want)) return false;
  const t = String(title || '');
  let np = t.match(/(\d{1,4})\s*(?:серия|серии|серий)/i);
  let ep = t.match(/(?:episode|ep\.?|e)\s*(\d{1,4})/i);
  let bare = t.match(/—\s*(\d{1,4})\s*серия/i) || t.match(/(?:^|[\s—–-])(\d{1,4})(?:\s*(?:серия|серии|episode|ep\.?))?\s*(?:\(|$)/i);
  const n = Number((np && np[1]) || (ep && ep[1]) || (bare && bare[1]));
  if (!Number.isFinite(n) || n <= 0 || n >= 10000) return false;
  return n === want;
}

async function fetchFromAddon(base, ids, types, episode) {
  const out = [];
  let answered = false;
  const typeList = (types && types.length) ? types : ['anime', 'series', 'movie'];
  const want = Number(episode) || 1;
  const namesEpisode = (text) => /(\d{1,4})\s*(?:серия|серии|серий)|(?:episode|ep\.?|e)\s*(\d{1,4})/i.test(String(text || ''));
  let got = 0;
  for (const id of ids) {
    const pathId = encodeURIComponent(id).replace(/%3A/gi, ':');
    for (const type of typeList) {
      const r = await addonFetch(base, `stream/${type}/${pathId}.json`);
      if (!r.ok) continue;
      answered = true;
      const streams = Array.isArray(r.json?.streams) ? r.json.streams : [];
      // First pass: which streams answer this request?
      const matched = [];
      for (const s of streams) {
        const title = String(s?.title || s?.name || '').trim();
        if (isYtId(s?.ytId)) {
          if (matchEpisode(title, want) || !namesEpisode(title)) {
            matched.push({ kind: 'yt', ytId: String(s.ytId), title });
          }
          continue;
        }
        const u = s?.url || s?.externalUrl;
        if (typeof u !== 'string' || !u.trim()) continue;
        const clean = u.trim();
        if (!/^https:\/\//i.test(clean)) continue;
        if (blockedHost(clean)) continue;
        if (isPlaceholderStream(clean, s)) continue;
        if (!isMediaUrl(clean)) continue;
        if (matchEpisode(title, want)) {
          matched.push({ kind: 'url', url: clean, title });
        }
      }
      if (!matched.length) continue;
      // Fetch captions only now that this candidate carries the episode.
      const subR = await addonFetch(base, `subtitles/${type}/${pathId}.json`);
      const subtitles = Array.isArray(subR?.json?.subtitles) ? subR.json.subtitles : [];
      for (const m of matched) {
        if (m.kind === 'yt') {
          out.push({ ytId: m.ytId, title: m.title });
        } else {
          out.push({ url: m.url, title: m.title, subtitles });
        }
        got += 1;
      }
      if (got) break;
    }
    if (got) break;
  }
  const seen = new Set();
  return { streams: out.filter((s) => (seen.has(keyOf(s)) ? false : (seen.add(keyOf(s)), true))), answered };
}


/** What makes two stream entries the same stream: its file address, or its
 *  video id when the address is YouTube's player rather than a file. */
const keyOf = (s) => s?.url || s?.ytId || '';


export async function fetchStremioStreams(anilistId, episode, addonFilter) {
  const inCache = Number(episode);
  const cached = readCache(anilistId, inCache);
  if (cached) return cached; // includes a cached empty result for that episode

  let addons = storedStremioAddons();
  if (Array.isArray(addonFilter) && addonFilter.length) addons = addonFilter;
  if (!addons.length) return [];

  const mapping = await fetchIdMapping(anilistId);

  /* Only ask add-ons that declare a stream resource. A default catalog add-on
     (Anime Kitsu, Cinemeta) names catalog/meta only; skipping it here keeps a
     pre-configured list from costing a request per episode for nothing. */
  const { usable } = await streamAddons(addons);
  if (!usable.length) { writeCache(anilistId, episode, [], EMPTY_TTL); return []; }

  const results = await Promise.all(usable.map(async ({ base, m }) => {
    const types = Array.isArray(m?.types) ? m.types : null;
    const prefixes = Array.isArray(m?.idPrefixes) ? m.idPrefixes : null;
    const ids = candidateIds(mapping, episode, prefixes);
    return { base, ...(await fetchFromAddon(base, ids, types, episode)) };
  }));
  noteSilentAddons(results);

  const streams = results.flatMap((r) => r.streams);
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(keyOf(s)) ? false : (seen.add(keyOf(s)), true)));

  writeCache(anilistId, episode, unique, unique.length ? CACHE_TTL : EMPTY_TTL);
  return unique;
}

function tryGetStrArr(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || null; } catch { return null; }
}

/* Why a title did or did not play, in one place. The watch page deliberately
   swallows a failed resolve — its no-streams card is the answer the viewer
   gets — so without this a title that maps to nothing looks exactly like an
   add-on that is down. Keeps the last 60 lines in localStorage so they can be
   read after the fact, not only while the console is open. */
function logTmdb(tmdbId, stage, detail) {
  try { console.info(`[stremio] tmdb:${tmdbId} ${stage}${detail ? ` — ${detail}` : ''}`); } catch (e) {}
  pushLog({ tmdb: tmdbId, stage: String(stage), detail: detail ? String(detail) : null });
}

/* One ring buffer for both tracks, so a dead source leaves the same trail a
   failed mapping does. */
function pushLog(entry) {
  try {
    const prev = JSON.parse(localStorage.getItem('stremio:logs') || '[]');
    const log = Array.isArray(prev) ? prev : [];
    log.push({ t: Date.now(), ...entry });
    localStorage.setItem('stremio:logs', JSON.stringify(log.slice(-60)));
  } catch (e) {}
}

/* The address a person would recognize: no scheme, no trailing slash. */
const addonLabel = (base) => String(base || '').replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/^www\./i, '');

/* A configured add-on whose manifest did not answer at all. Naming it is the
   whole point: "no stream" reads as a missing feature, while "this add-on is
   unreachable" reads as the dead source it actually is. */
function logAddonDown(base) {
  try { console.warn(`[stremio] add-on unreachable — ${base} (no answer to its manifest or stream requests; down or moved)`); } catch (e) {}
  pushLog({ tmdb: null, stage: 'add-on unreachable', detail: String(base) });
}

/* ---- what actually answered ---------------------------------------------
   Both resolvers need the same three facts: which add-ons a stream can come
   from, which ones never answered, and that answer for the card that follows.
   A watch page with nothing to play reads `lastAddonState()` so it can tell a
   dead source apart from a title no add-on carries — only one of those is
   worth sending the viewer to Settings for. */
let addonState = { down: [], live: 0 };

/** Add-ons that failed to answer during the last resolve, as display names,
 *  plus how many answered with a stream resource. */
export function lastAddonState() {
  return { down: addonState.down.slice(), live: addonState.live };
}

async function streamAddons(addons) {
  const list = Array.isArray(addons) ? addons : storedStremioAddons();
  const manifests = await Promise.all(list.map((b) => fetchManifest(b).then((x) => x.manifest)));
  const usable = [];
  const down = [];
  list.forEach((base, i) => {
    const m = manifests[i];
    /* No manifest means the host did not answer — as opposed to an add-on that
       answered but is a catalog/meta add-on, which is down to its declaration. */
    if (!m) { down.push(base); return; }
    const res = Array.isArray(m.resources) ? m.resources : [];
    const hasStream = res.length ? res.some((r) => (typeof r === 'string' ? r === 'stream' : r && r.name === 'stream')) : true;
    if (hasStream) usable.push({ base, m });
  });
  down.forEach(logAddonDown);
  addonState = { down: down.map(addonLabel), live: usable.length };
  return { usable, down };
}

/* An add-on that answered nothing at all — not one 2xx for any candidate id —
   is unreachable, even though its manifest may still be cached from the last
   day it worked. Recording that is the difference between "this add-on is
   gone" and "this title is not carried". */
function noteSilentAddons(results) {
  const silent = results.filter((r) => !r.answered).map((r) => r.base);
  if (!silent.length) return;
  silent.forEach(logAddonDown);
  addonState = {
    live: Math.max(0, addonState.live - silent.length),
    down: [...new Set([...addonState.down, ...silent.map(addonLabel)])],
  };
}

/* ---- TMDB id → the ids an add-on actually answers ------------------------
   A watch page holds a TMDB id; no Stremio add-on asks for one. They ask for an
   IMDb id (tt…), or a Kitsu/AniList id for anime, so the id has to be mapped
   first. ani.zip is the one keyless service that answers "which anime is this
   TMDB id" (api.ani.zip/mappings?themoviedb_id=…), and AniList fills in the MAL
   id and a Kitsu link when ani.zip carried neither.

   That mapping covers anime only, and that is not a gap to paper over: ani.zip
   answers 404 for a live-action title (Breaking Bad, The Flash), and Cinemeta —
   Stremio's own metadata service — refuses a numeric TMDB id outright. With no
   TMDB key on a static host there is no honest bridge for live action, so this
   returns null and the watch page shows its "no direct streams" card rather
   than pretending a source exists. */
async function fetchIdMappingForTmdb(tmdbId, type = 'movie') {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const key = `tmdb:${type === 'tv' ? 'tv' : 'movie'}:${id}`;
  try {
    const cache = settings.get(MAP_CACHE_KEY) || {};
    const rec = cache[key];
    if (rec && Date.now() - rec.t < MAP_TTL) return rec.v;
  } catch {}

  const out = { anilist: null, mal: null, imdb: null, kitsu: null, via: 'ani.zip themoviedb_id' };

  try {
    const res = await fetch(`https://api.ani.zip/mappings?themoviedb_id=${id}`, { cache: 'default' });
    if (res.ok) {
      const m = (await res.json())?.mappings || {};
      if (m.anilist_id) out.anilist = String(m.anilist_id);
      if (m.kitsu_id) out.kitsu = Number(m.kitsu_id) || null;
      if (m.imdb_id) out.imdb = String(m.imdb_id);
    } else {
      logTmdb(id, 'ani.zip non-ok', `status=${res.status}`);
    }
  } catch (e) {
    logTmdb(id, 'ani.zip error', String(e?.message || e));
  }

  /* ani.zip only names the anime; AniList knows its MAL id and usually links
     Kitsu, which is the id AcuAnime and the Kitsu add-ons key on. */
  if (out.anilist) {
    const extra = await fetchIdMapping(out.anilist).catch(() => null);
    if (extra) {
      out.mal = out.mal || extra.mal || null;
      out.kitsu = out.kitsu || extra.kitsu || null;
      out.imdb = out.imdb || extra.imdb || null;
      out.via = 'ani.zip themoviedb_id + AniList';
    }
  }

  const v = out.anilist || out.imdb || out.kitsu ? out : null;
  try {
    const cache = settings.get(MAP_CACHE_KEY) || {};
    cache[key] = { t: Date.now(), v };
    settings.set(MAP_CACHE_KEY, cache);
  } catch {}
  return v;
}

/* Films & series in the TMDB catalogue carry a TMDB id, not an AniList id.
   This resolves one through ani.zip so the same direct sources can serve those
   titles too. It is the fallback the watch page takes when the catalogue holds
   no operator `direct_url` — never a replacement for one. */
export async function fetchStremioStreamsForTmdb(tmdbId, type = 'movie', season = 1, episode = 1) {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const cacheKey = `stremio.tmdb3:${id}:${type}:${season}:${episode}`;
  const cached = tryGetStrArr(cacheKey);
  if (cached) return cached;

  logTmdb(id, 'resolve start', `type=${type} s=${season} e=${episode}`);

  const mapping = await fetchIdMappingForTmdb(id, type);
  if (!mapping) {
    logTmdb(id, 'resolve fail', `no AniList/Kitsu/IMDb counterpart for TMDB id ${id} — ani.zip answers anime only and Cinemeta refuses a numeric TMDB id, so no add-on is queried`);
    return [];
  }
  logTmdb(id, 'resolve ok', `via=${mapping.via} anilist=${mapping.anilist ?? 'none'} mal=${mapping.mal ?? 'none'} kitsu=${mapping.kitsu ?? 'none'} imdb=${mapping.imdb ?? 'none'}`);

  const eps = Math.max(1, Number(episode) || 1);
  const addons = storedStremioAddons();
  if (!addons.length) {
    logTmdb(id, 'no add-ons', 'storedStremioAddons is empty, nothing to query');
    return [];
  }

  const { usable } = await streamAddons(addons);
  if (!usable.length) {
    logTmdb(id, 'no stream-capable add-ons', 'no configured add-on answered with a stream resource');
    return [];
  }

  logTmdb(id, 'querying', `add-ons=${usable.map((u) => u.base).join(', ')} ids=${candidateIds(mapping, eps).join(' ')}`);

  const results = await Promise.all(usable.map(async ({ base, m }) => ({
    base,
    ...(await fetchFromAddon(
      base,
      candidateIds(mapping, eps, Array.isArray(m?.idPrefixes) ? m.idPrefixes : null),
      Array.isArray(m?.types) ? m.types : null,
      eps,
    )),
  })));
  noteSilentAddons(results);

  const streams = results.flatMap((r) => r.streams);
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(keyOf(s)) ? false : (seen.add(keyOf(s)), true)));

  if (unique.length) {
    logTmdb(id, 'streams found', `count=${unique.length}`);
  } else {
    logTmdb(id, 'no streams', `mapped via ${mapping.via} but no stream-capable add-on returned a direct .m3u8/.mp4 for the requested episode`);
  }

  /* Only a hit is worth remembering. Caching the empty result would answer the
     next Play from storage, skipping the add-on probe — and with it the reason
     the card is meant to show. */
  if (unique.length) { try { localStorage.setItem(cacheKey, JSON.stringify(unique)); } catch {} }
  return unique;
}

/** Turn raw Stremio add-on streams into server objects the watch-page ladder can
 *  consume. Raw streams are `{ url, title }[]` from `fetchStremioStreams`; the
 *  ladder reads `.url`, `.name`, `.id`, `.tracks` (via `serverTracks`) and, for
 *  episode reordering, `.episode`.
 *
 *  Episode is inferred from the stream title with the same parser `matchEpisode`
 *  uses, so a multi-episode add-on list (Anixio-style) can still be reordered by
 *  the requested episode even when the add-on did not suffix the id. */
export function stremioServers(streams) {
  if (!Array.isArray(streams)) return [];
  const out = [];
  const seen = new Set();
  for (const s of streams) {
    const title = String(s?.title || s?.name || '').trim();
    /* An official YouTube stream: the player is framed from its own embed
       address, which is the same player the IFrame API would create. It is an
       embed on purpose — YouTube's branding, captions and adverts stay, as its
       terms require, and Solvn only decides where the box sits. */
    if (isYtId(s?.ytId)) {
      const embed = ytEmbedUrl(s.ytId);
      if (!embed || seen.has(embed)) continue;
      seen.add(embed);
      out.push({
        id: `youtube:${s.ytId}`,
        name: title || 'YouTube',
        url: embed,
        ytId: String(s.ytId),
        tracks: ['sub'],
        subtitles: Array.isArray(s?.subtitles) ? s.subtitles : [],
        episode: episodeFromTitle(title),
      });
      continue;
    }
    const u = String(s?.url || s?.stream_url || s?.video_url || '').trim();
    if (!u) continue;
    if (!/^https:\/\//i.test(u)) continue;
    if (blockedHost(u)) continue;
    if (!isMediaUrl(u)) continue;
    if (isPlaceholderStream(u, s)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    const ep = episodeFromTitle(title);
    out.push({
      id: `stremio:${u.slice(0, 64)}`,
      name: title || 'Stremio stream',
      url: u,
      tracks: ['sub'],
      subtitles: Array.isArray(s?.subtitles) ? s.subtitles : [],
      episode: ep,
    });
  }
  return out;
}

/** Pull the episode number a stream title claims, or 1 when the title is not
 *  parseable. Mirrors the `matchEpisode` logic so the ladder reorders by the
 *  same number the player would match. */
function episodeFromTitle(title) {
  const t = String(title || '');
  let np = t.match(/(\d{1,4})\s*(?:серия|серии|серий)/i);
  let ep = t.match(/(?:episode|ep\.?|e)\s*(\d{1,4})/i);
  let bare = t.match(/—\s*(\d{1,4})\s*серия/i)
    || t.match(/(?:^|[\s—–-])(\d{1,4})(?:\s*(?:серия|серии|episode|ep\.?))?\s*(?:\(|$)/i);
  const n = Number((np && np[1]) || (ep && ep[1]) || (bare && bare[1]));
  return (Number.isFinite(n) && n > 0 && n < 10000) ? n : 1;
}

export function clearStremioCache() {
  settings.set(CACHE_KEY, {});
  settings.set(MAP_CACHE_KEY, {});
}
