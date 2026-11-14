import { settings } from './store.js';
import { isMediaUrl, blockedHost } from './sources.js';
import { DIRECT_MEDIA as DEFAULT_DIRECT_MEDIA } from './defaults.js';

const STORAGE_KEY = 'directMedia';

export function storedDirectMedia() {
  const v = settings.get(STORAGE_KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

export function allDirectMedia() {
  const out = {};
  const def = (DEFAULT_DIRECT_MEDIA && typeof DEFAULT_DIRECT_MEDIA === 'object') ? DEFAULT_DIRECT_MEDIA : {};
  for (const [id, eps] of Object.entries(def)) {
    if (!eps || typeof eps !== 'object') continue;
    out[id] = { ...(out[id] || {}), ...eps };
  }
  const stored = storedDirectMedia();
  for (const [id, eps] of Object.entries(stored)) {
    if (!eps || typeof eps !== 'object') continue;
    out[id] = { ...(out[id] || {}), ...eps };
  }
  return out;
}

export function directMediaUrl(id, episode) {
  const map = allDirectMedia();
  const eps = map && map[id] && typeof map[id] === 'object' ? map[id] : null;
  if (!eps) return null;
  const url = eps[episode] ?? eps[String(episode)];
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

export function directMediaServers(id, episode) {
  const url = directMediaUrl(id, episode);
  if (!url) return [];
  return [{ id: `direct:${id}:${episode}`, name: 'Direct', url, tracks: ['sub'] }];
}

export function directMediaProblem({ id, episode, url }) {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0 || n >= 1e7) return 'Anime id must be a positive number.';
  const e = Number(episode);
  if (!Number.isFinite(e) || e <= 0 || e >= 1e7) return 'Episode must be a positive number.';
  const raw = String(url || '').trim();
  if (!raw) return 'Add a video address.';
  if (raw.length > 500) return 'That address is too long.';
  if (!/^https:\/\/\S+$/i.test(raw)) return 'It must start with https://';
  const blocked = blockedHost(raw);
  if (blocked) return `${blocked} is blocked on Solvn.`;
  if (!isMediaUrl(raw)) return 'It must be a direct media file (.m3u8/.mp4/.webm/…), not an embed page.';
  return null;
}

export function addDirectMedia({ id, episode, url }) {
  const problem = directMediaProblem({ id, episode, url });
  if (problem) return problem;
  const key = String(Number(id));
  const ep = String(Number(episode));
  const clean = String(url).trim();
  const stored = { ...storedDirectMedia() };
  stored[key] = { ...(stored[key] || {}), [ep]: clean };
  settings.set(STORAGE_KEY, stored);
  return null;
}

export function removeDirectMedia(id, episode) {
  const key = String(Number(id));
  const ep = String(Number(episode));
  const stored = { ...storedDirectMedia() };
  if (!stored[key]) return;
  const eps = { ...stored[key] };
  delete eps[ep];
  if (Object.keys(eps).length === 0) delete stored[key];
  else stored[key] = eps;
  settings.set(STORAGE_KEY, stored);
}

/* Bulk import: accepts a JSON string/object/array of clean direct links.
   Supported shapes:
     - Object form (matches DIRECT_MEDIA): { "16498": { "1": "https://...", "2": "https://..." } }
     - Array form: [ { "id": 16498, "episode": 1, "url": "https://..." }, ... ]
     - Also accepts { id, episode, url } or { anilistId, ep, link } aliases.
   Validates every entry with directMediaProblem; merges valid ones into stored
   directMedia. Returns { added, skipped, errors } where errors is a list of
   human-readable reasons for rejected entries. */
export function importDirectMediaBulk(input) {
  let data = input;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); }
    catch (e) { return { added: 0, skipped: 0, errors: ['Invalid JSON: ' + (e && e.message ? e.message : e)] }; }
  }
  const entries = [];
  if (Array.isArray(data)) {
    for (const r of data) entries.push(r);
  } else if (data && typeof data === 'object') {
    // object form: { id: { ep: url } }
    let isObjectForm = false;
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && !Array.isArray(v) &&
          Object.values(v).every(x => typeof x === 'string')) { isObjectForm = true; break; }
    }
    if (isObjectForm) {
      for (const [id, eps] of Object.entries(data)) {
        if (!eps || typeof eps !== 'object') continue;
        for (const [ep, url] of Object.entries(eps)) entries.push({ id, episode: ep, url });
      }
    } else if (data.id != null || data.anilistId != null || data.animeId != null) {
      entries.push(data);
    } else {
      // maybe { items: [...] }
      const arr = data.items || data.links || data.data || data.entries;
      if (Array.isArray(arr)) for (const r of arr) entries.push(r);
      else return { added: 0, skipped: 0, errors: ['Unrecognized format. Use object form {id:{ep:url}} or array form [{id,episode,url}].'] };
    }
  } else {
    return { added: 0, skipped: 0, errors: ['Input must be JSON text or an object/array.'] };
  }

  let added = 0;
  const errors = [];
  const stored = { ...storedDirectMedia() };
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') { errors.push('Skipped non-object entry.'); continue; }
    const id = raw.id ?? raw.anilistId ?? raw.animeId ?? raw.anime_id;
    const episode = raw.episode ?? raw.ep ?? raw.episodeNumber ?? raw.episode_number;
    const url = raw.url ?? raw.link ?? raw.src ?? raw.stream ?? raw.direct;
    const problem = directMediaProblem({ id, episode, url });
    if (problem) { errors.push(`#${id} Ep ${episode}: ${problem}`); continue; }
    const key = String(Number(id));
    const ep = String(Number(episode));
    const clean = String(url).trim();
    if (!stored[key]) stored[key] = {};
    stored[key][ep] = clean;
    added++;
  }
  settings.set(STORAGE_KEY, stored);
  return { added, skipped: errors.length, errors };
}

export function listDirectMedia() {
  const out = [];
  const map = allDirectMedia();
  for (const [id, eps] of Object.entries(map)) {
    if (!eps || typeof eps !== 'object') continue;
    for (const [ep, url] of Object.entries(eps)) {
      out.push({ id: Number(id), episode: Number(ep), url });
    }
  }
  out.sort((a, b) => a.id - b.id || a.episode - b.episode);
  return out;
}
