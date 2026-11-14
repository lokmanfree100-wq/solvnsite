import { settings } from './store.js';
import { isMediaUrl, blockedHost } from './sources.js';
import { STREMIO_ADDONS as DEFAULT_STREMIO_ADDONS } from './defaults.js';
import { gql } from './anilist.js';
import { proxyUrl, API_HOST } from './proxy.js';

const STORAGE_KEY = 'stremioAddons';
const CACHE_KEY = 'stremioStreamCache';
const MAP_CACHE_KEY = 'stremioIdMap2';
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
  const anilistId = mapping.anilist;
  /* Episode-specific ids are tried first: an addon that keys off them (AcuAnime)
     returns the right episode, while an addon that ignores the suffix returns
     an empty list and we fall through to the base id (Anixio-style). */
  all.push(`anilist:${anilistId}:${ep}`);
  all.push(`anilist:${anilistId}`);
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
  const typeList = (types && types.length) ? types : ['anime', 'series', 'movie'];
  /* Candidate ids are tried in priority order. We want streams for the
     *requested* episode. If a suffixed id answers with streams but none of them
     are for the requested episode (AcuAnime can return an E1 sitting in slot N,
     or a "No streams found" notice card), that id does not satisfy the add-on
     for this episode.
     If later a bare id for the same base also answers with only E1 streams, skip
     it too so we never start on E1 for episode N we asked for. */
  const want = Number(episode) || 1;
  let lastBaseHadStreamsNoMatch = false;
  let got = 0;
  let hadStreamsNoMatch = false;
  for (const id of ids) {
    const pathId = encodeURIComponent(id).replace(/%3A/gi, ':');
    for (const type of typeList) {
      const r = await addonFetch(base, `stream/${type}/${pathId}.json`);
      if (!r.ok) continue;
      const streams = Array.isArray(r.json?.streams) ? r.json.streams : [];
      for (const s of streams) {
        const u = s?.url || s?.externalUrl;
        if (typeof u !== 'string' || !u.trim()) continue;
        const clean = u.trim();
        if (!/^https:\/\//i.test(clean)) continue;
        if (blockedHost(clean)) continue;
        if (isPlaceholderStream(clean, s)) continue;
        if (!isMediaUrl(clean)) continue;
        const title = String(s?.title || s?.name || '').trim();
        if (matchEpisode(title, want)) {
          out.push({ url: clean, title });
          got += 1;
        } else if (streams.length > 0) {
          hadStreamsNoMatch = true;
        }
      }
      if (got) break;
    }
    if (hadStreamsNoMatch) lastBaseHadStreamsNoMatch = true;
    if (got) break;
  }
  /* If the suffixed ids never matched the requested episode but a bare id did
     match only on the bare list, the bare match reflects the bare-id E1 (or a
     call that the add-on keeps as a fallback). For a requested non-1 episode,
     that is a same-shape mismatch as above — do not present it as the requested
     episode. */
  if (!got && out.length && want !== 1 && lastBaseHadStreamsNoMatch) {
    /* keep only what actually names the requested episode (there is none), so
       this add-on contributes nothing. */
    out.length = 0;
  }
  const seen = new Set();
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}


export async function fetchStremioStreams(anilistId, episode, addonFilter) {
  const inCache = Number(episode);
  const cached = readCache(anilistId, inCache);
  if (cached) return cached; // includes a cached empty result for that episode

  let addons = storedStremioAddons();
  if (Array.isArray(addonFilter) && addonFilter.length) addons = addonFilter;
  if (!addons.length) return [];

  const mapping = await fetchIdMapping(anilistId);

  const manifests = await Promise.all(addons.map((b) => fetchManifest(b).then((x) => x.manifest)));

  /* Only ask add-ons that declare a stream resource. A default catalog add-on
     (Anime Kitsu, Cinemeta) names catalog/meta only; skipping it here keeps a
     pre-configured list from costing a request per episode for nothing. */
  const usable = [];
  addons.forEach((base, i) => {
    const m = manifests[i];
    if (!m) return;
    const res = Array.isArray(m.resources) ? m.resources : [];
    const hasStream = res.length ? res.some((r) => (typeof r === 'string' ? r === 'stream' : r && r.name === 'stream')) : true;
    if (hasStream) usable.push({ base, m });
  });
  if (!usable.length) { writeCache(anilistId, episode, [], EMPTY_TTL); return []; }

  const results = await Promise.all(usable.map(async ({ base, m }) => {
    const types = Array.isArray(m?.types) ? m.types : null;
    const prefixes = Array.isArray(m?.idPrefixes) ? m.idPrefixes : null;
    const ids = candidateIds(mapping, episode, prefixes);
    return fetchFromAddon(base, ids, types, episode);
  }));

  const streams = results.flat();
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));

  writeCache(anilistId, episode, unique, unique.length ? CACHE_TTL : EMPTY_TTL);
  return unique;
}

/* Films & series in the TMDB catalogue carry a TMDB id, not an AniList id.
   ani.zip can map a TMDB id straight to a Kitsu/IMDb id, so the same direct
   sources can serve those titles too. Used by the movies/series watch page when
   no operator `direct_url` is configured. */
function tryGetStrArr(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || null; } catch { return null; }
}

export async function fetchStremioStreamsForTmdb(tmdbId, type = 'movie', season = 1, episode = 1) {
  const id = Number(tmdbId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const cacheKey = `stremio.tmdb:${id}:${type}:${season}:${episode}`;
  const ttlKey = `${cacheKey}:ttl`;
  const cached = tryGetStrArr(cacheKey);
  if (cached) return cached;

  let kitsu = null;
  let imdb = null;
  try {
    const res = await fetch(`https://api.ani.zip/mappings?themoviedb_id=${id}`, { cache: 'default' });
    if (res.ok) {
      const data = await res.json();
      const m = data?.mappings || {};
      if (m.kitsu_id) kitsu = Number(m.kitsu_id) || null;
      if (m.imdb_id) imdb = String(m.imdb_id);
    }
  } catch {}
  if (!kitsu && !imdb) return [];

  const eps = Math.max(1, Number(episode) || 1);
  const ids = [];
  if (kitsu) {
    ids.push(`kitsu:${kitsu}:${eps}`);
    ids.push(`kitsu:${kitsu}`);
  }
  if (imdb) {
    ids.push(`${imdb}:${eps}`);
    ids.push(imdb);
  }

  const addons = storedStremioAddons();
  if (!addons.length) return [];
  const manifests = await Promise.all(addons.map((b) => fetchManifest(b).then((x) => x.manifest)));
  const usable = [];
  addons.forEach((base, i) => {
    const m = manifests[i];
    if (!m) return;
    const res = Array.isArray(m.resources) ? m.resources : [];
    const hasStream = res.length ? res.some((r) => (typeof r === 'string' ? r === 'stream' : r && r.name === 'stream')) : true;
    if (hasStream) usable.push({ base, m });
  });
  if (!usable.length) return [];

  const results = await Promise.all(usable.map(async ({ base, m }) => {
    const types = Array.isArray(m?.types) ? m.types : null;
    const prefixes = Array.isArray(m?.idPrefixes) ? m.idPrefixes : null;
    const filtered = (prefixes && prefixes.length)
      ? ids.filter((c) => prefixes.some((p) => c.startsWith(p) || c.split(':')[0] === String(p).replace(/:$/, '')))
      : ids;
    return fetchFromAddon(base, filtered.length ? filtered : ids, types, eps);
  }));

  const streams = results.flat();
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
  try {
    localStorage.setItem(cacheKey, JSON.stringify(unique));
    try { settings.set(ttlKey, String(Date.now())); } catch {};
  } catch {}
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
    const u = String(s?.url || s?.stream_url || s?.video_url || '').trim();
    if (!u) continue;
    if (!/^https:\/\//i.test(u)) continue;
    if (blockedHost(u)) continue;
    if (!isMediaUrl(u)) continue;
    if (isPlaceholderStream(u, s)) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    const title = String(s?.title || s?.name || '').trim();
    const ep = episodeFromTitle(title);
    out.push({
      id: `stremio:${u.slice(0, 64)}`,
      name: title || 'Stremio stream',
      url: u,
      tracks: ['sub'],
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
