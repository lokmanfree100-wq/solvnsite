/**
 * Public-domain fallback: when no Stremio-style add-on names a direct file for
 * this title, ask Archive.org for a copy that carries an explicit public-domain
 * or Creative-Commons statement and hand its direct MP4 to our own player.
 *
 * No key, no account, no proxy: archive.org's search and metadata endpoints send
 * `Access-Control-Allow-Origin: *`, and a plain `<video src>` plays the download
 * without needing CORS on the final 302. Anything without a clear licence, an
 * obvious screen recording, or a title that does not match is refused.
 */

const IA_SEARCH = 'https://archive.org/advancedsearch.php';
const IA_META = 'https://archive.org/metadata/';
const PD_LICENSE = /(publicdomain|public-domain|creativecommons|\/zero\/|\/mark\/|\/by\/|\/by-sa\/)/i;
const VIDEO_FILE = /\.(mp4|webm)$/i;
const BAD_FILE = /(trailer|teaser|sample|screener|screen.?record|interview|reaction|q&a|review|behind.?the.?scenes|clip|intro|outro)/i;
/* Archive carries a lot of YouTube re-uploads of copyrighted shows. Only a
   stated public-domain/CC licence counts, and those uploads never do. */
const BAD_ITEM = /^(youtube-|youtu-|archive-.*-youtube)|(youtube|full episode|english (sub|dub)|episode \d+)/i;
const MIN_BYTES = 8 * 1024 * 1024;
const CACHE_TTL = 30 * 60 * 1000;

const cache = new Map();

async function getJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', mode: 'cors' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\(\d{4}\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function titleMatches(query, candidate) {
  const wanted = norm(query).split(' ').filter((w) => w.length > 1);
  if (!wanted.length) return false;
  const hay = norm(candidate);
  const hit = wanted.filter((w) => hay.includes(w)).length;
  return hit / wanted.length >= 0.7;
}

function licenseOk(meta) {
  /* A licence URL is the only proof strong enough to play a whole film. A
     collection name or a vague "rights" note is not. */
  return PD_LICENSE.test(String(meta?.licenseurl || ''));
}

/** The smallest usable file that is not Archive's own derivative, else the derivative. */
function pickFile(files) {
  const usable = (Array.isArray(files) ? files : []).filter((f) => {
    const name = String(f?.name || '');
    return VIDEO_FILE.test(name) && !BAD_FILE.test(name) && Number(f?.size || 0) >= MIN_BYTES;
  });
  usable.sort((a, b) => {
    const da = /\.ia\.mp4$/i.test(String(a.name)) ? 1 : 0;
    const db = /\.ia\.mp4$/i.test(String(b.name)) ? 1 : 0;
    if (da !== db) return da - db;
    return Number(b.size || 0) - Number(a.size || 0);
  });
  return usable[0]?.name || null;
}

function downloadUrl(identifier, name) {
  const path = String(name).split('/').map((p) => encodeURIComponent(p)).join('/');
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${path}`;
}

/**
 * Direct Archive.org MP4s for `title`, best candidate first. An empty result is
 * cached too, so a title with no public-domain copy costs one search per session.
 */
export async function archiveStreams(titleText, { year } = {}) {
  const clean = String(titleText || '').trim();
  if (clean.length < 2 || norm(clean) === 'untitled') return [];
  const key = `${norm(clean)}|${year || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;

  const q = `title:("${clean.replace(/["\\]/g, ' ')}") AND mediatype:movies`;
  const search = await getJson(`${IA_SEARCH}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=licenseurl&rows=20&page=1&output=json`);
  const docs = Array.isArray(search?.response?.docs) ? search.response.docs : [];

  const candidates = docs.filter((doc) => {
    if (!doc?.identifier || !titleMatches(clean, doc.title)) return false;
    if (BAD_ITEM.test(String(doc.identifier)) || BAD_ITEM.test(String(doc.title || ''))) return false;
    /* The search row already carries the licence; trailers and re-uploads do not
       state one, so they never reach the per-item metadata call. */
    if (!PD_LICENSE.test(String(doc.licenseurl || ''))) return false;
    if (year && doc.year && Math.abs(Number(doc.year) - Number(year)) > 3) return false;
    return true;
  }).slice(0, 2);

  const metas = await Promise.all(candidates.map((doc) => getJson(`${IA_META}${encodeURIComponent(doc.identifier)}`)));
  const out = [];
  for (let i = 0; i < candidates.length; i++) {
    const doc = candidates[i];
    const meta = metas[i];
    if (!meta || !licenseOk(meta.metadata || {})) continue;
    const file = pickFile(meta.files);
    if (!file) continue;
    out.push({
      id: `archive:${doc.identifier}`,
      name: `${meta.metadata?.title || doc.title || clean} · Archive.org (public domain)`,
      url: downloadUrl(doc.identifier, file),
      tracks: [],
    });
    if (out.length >= 2) break;
  }

  cache.set(key, { t: Date.now(), v: out });
  return out;
}

/**
 * Last resort, always playable: real open films under CC-BY, served as HLS with
 * CORS enabled. It is not the requested episode, and the server name says so.
 */
const OPEN_REEL = [
  {
    id: 'open:tears-of-steel',
    name: 'Open reel · Tears of Steel (CC-BY)',
    url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    tracks: [],
  },
  {
    id: 'open:mux-hls',
    name: 'Open reel · HLS test stream',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    tracks: [],
  },
];

export function openReel() {
  return OPEN_REEL.map((s) => ({ ...s }));
}

/**
 * Servers for this title, in order: Archive.org's public-domain copy when there
 * is one, otherwise the open reel. Never empty.
 *
 * Only a film can have a film copy; an episode is never replaced by a feature
 * of the same name, so series go straight to the open reel. The Archive lookup
 * is also raced against a short deadline so a slow catalogue never holds the
 * player on "warming up".
 */
export async function publicDomainServers(titleText, opts = {}) {
  if (!opts.movie) return openReel();
  try {
    const own = await Promise.race([
      archiveStreams(titleText, opts),
      new Promise((resolve) => setTimeout(() => resolve([]), 6000)),
    ]);
    if (own && own.length) return own;
  } catch {}
  return openReel();
}
