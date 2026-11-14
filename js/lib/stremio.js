import { settings } from './store.js';
import { isMediaUrl, blockedHost } from './sources.js';
import { STREMIO_ADDONS as DEFAULT_STREMIO_ADDONS } from './defaults.js';
import { gql } from './anilist.js';
import { proxyUrl, API_HOST } from './proxy.js';

const STORAGE_KEY = 'stremioAddons';
const CACHE_KEY = 'stremioStreamCache';
const MAP_CACHE_KEY = 'stremioIdMap';
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
      }
    }
  } catch {}
  const v = { anilist: String(anilistId), mal, imdb };
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
  all.push(`anilist:${anilistId}`);
  all.push(`anilist:${anilistId}:${ep}`);
  if (mapping.mal) {
    all.push(`mal:${mapping.mal}`);
    all.push(`mal:${mapping.mal}:${ep}`);
  }
  if (mapping.imdb) {
    all.push(mapping.imdb);
    all.push(`${mapping.imdb}:${ep}`);
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

async function fetchFromAddon(base, ids, types) {
  const out = [];
  const typeList = (types && types.length) ? types : ['anime', 'series', 'movie'];
  /* Candidate ids are tried in priority order and we stop at the first id that
     answers with streams, so a normal episode is a couple of requests, not one
     per id × type. */
  for (const id of ids) {
    let got = 0;
    for (const type of typeList) {
      /* Stremio ids carry literal colons (anilist:123, mal:456); encode the
         rest of the segment but leave ':' as the protocol expects, or an add-on
         with a strict path match never sees its id. */
      const pathId = encodeURIComponent(id).replace(/%3A/gi, ':');
      const r = await addonFetch(base, `stream/${type}/${pathId}.json`);
      if (!r.ok) continue;
      const streams = Array.isArray(r.json?.streams) ? r.json.streams : [];
      for (const s of streams) {
        const u = s?.url || s?.externalUrl;
        if (typeof u !== 'string' || !u.trim()) continue;
        const clean = u.trim();
        if (!/^https:\/\//i.test(clean)) continue;
        if (blockedHost(clean)) continue;
        if (!isMediaUrl(clean)) continue;
        out.push({ url: clean, title: String(s?.title || s?.name || '').trim() });
        got += 1;
      }
    }
    if (got) break;
  }
  const seen = new Set();
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

export async function fetchStremioStreams(anilistId, episode, addonFilter) {
  const cached = readCache(anilistId, episode);
  if (cached) return cached; // includes a cached empty result

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
    return fetchFromAddon(base, ids, types);
  }));

  const streams = results.flat();
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));

  writeCache(anilistId, episode, unique, unique.length ? CACHE_TTL : EMPTY_TTL);
  return unique;
}

export function stremioServers(streams) {
  return (streams || []).map((s, i) => ({
    id: `stremio:${i}:${s.url.slice(-12)}`,
    name: s.title || `Stream ${i + 1}`,
    url: s.url,
    tracks: ['sub'],
  }));
}

export function clearStremioCache() {
  settings.set(CACHE_KEY, {});
  settings.set(MAP_CACHE_KEY, {});
}
