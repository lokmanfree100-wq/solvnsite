import { settings } from './store.js';
import { isMediaUrl, blockedHost } from './sources.js';
import { STREMIO_ADDONS as DEFAULT_STREMIO_ADDONS } from './defaults.js';
import { gql } from './anilist.js';
import { proxyUrl } from './proxy.js';

const STORAGE_KEY = 'stremioAddons';
const CACHE_KEY = 'stremioStreamCache';
const MAP_CACHE_KEY = 'stremioIdMap';
const CACHE_TTL = 12 * 60 * 60 * 1000;
const MAP_TTL = 7 * 24 * 60 * 60 * 1000;

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

async function proxyFetch(base, relPath) {
  // Only useful when a proxy host is configured (Netlify deploy).
  try {
    const target = encodeURIComponent(base);
    const p = encodeURIComponent(relPath);
    const url = proxyUrl(`/.netlify/functions/proxy?kind=stremio&target=${target}&path=${p}`);
    // If proxyUrl returns same-origin (no API_HOST), the function may not exist locally.
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

async function addonFetch(base, relPath) {
  const url = addonUrl(base, relPath);
  const direct = await directFetch(url);
  if (direct.ok) return direct;
  // Fall back to proxy when available (production Netlify).
  const proxied = await proxyFetch(base, relPath);
  if (proxied.ok) return proxied;
  return direct; // keep original error
}

async function fetchManifest(base) {
  const r = await addonFetch(base, 'manifest.json');
  if (!r.ok) return { manifest: null, error: r.error || (r.status ? `HTTP ${r.status}` : 'unreachable') };
  if (!r.json || typeof r.json !== 'object') return { manifest: null, error: 'invalid manifest' };
  return { manifest: r.json, error: null };
}

export async function testAddon(base) {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  const problem = stremioAddonProblem(clean);
  if (problem) return { ok: false, error: problem, manifest: null, streams: [] };
  const { manifest, error } = await fetchManifest(clean);
  if (!manifest) {
    const corsHint = error === 'unreachable' || error === 'Failed to fetch'
      ? ' (CORS or network — addon must send Access-Control-Allow-Origin, or use a proxy host)'
      : '';
    return { ok: false, error: (error || 'no manifest') + corsHint, manifest: null, streams: [] };
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
    if (rec && Date.now() - rec.t < CACHE_TTL && Array.isArray(rec.v)) return rec.v;
  } catch {}
  return null;
}

function writeCache(anilistId, episode, streams) {
  try {
    const cache = settings.get(CACHE_KEY) || {};
    cache[cacheKey(anilistId, episode)] = { t: Date.now(), v: streams };
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
  for (const id of ids) {
    for (const type of typeList) {
      const r = await addonFetch(base, `stream/${type}/${encodeURIComponent(id)}.json`);
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
      }
    }
  }
  const seen = new Set();
  return out.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

export async function fetchStremioStreams(anilistId, episode, addonFilter) {
  const cached = readCache(anilistId, episode);
  if (cached && cached.length) return cached;

  let addons = storedStremioAddons();
  if (Array.isArray(addonFilter) && addonFilter.length) addons = addonFilter;
  if (!addons.length) return [];

  const mapping = await fetchIdMapping(anilistId);

  const manifests = await Promise.all(addons.map((b) => fetchManifest(b).then((x) => x.manifest)));

  const results = await Promise.all(addons.map(async (base, i) => {
    const m = manifests[i];
    const types = Array.isArray(m?.types) ? m.types : null;
    const prefixes = Array.isArray(m?.idPrefixes) ? m.idPrefixes : null;
    const ids = candidateIds(mapping, episode, prefixes);
    return fetchFromAddon(base, ids, types);
  }));

  const streams = results.flat();
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));

  if (unique.length) writeCache(anilistId, episode, unique);
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
