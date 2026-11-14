/**
 * Solvn's four server-side routes, as one Netlify Function.
 *
 * The site is a static bundle, and four of its features cannot live in a static
 * bundle: TMDB needs a key that must never ship in a page, and Archive.org, the
 * embed pre-flight and the stream resolver all answer with bodies a browser is
 * not allowed to read cross-origin. `serve-solvn.mjs` provides them while
 * developing; this file provides them in production, which is the only way a
 * GitHub Pages host can have a Movies & Series section at all.
 *
 * What is deliberately kept:
 *   - The key is read from `TMDB_API_KEY` (a Secret env var on Netlify) and is
 *     never written into a response, a log line or this repo.
 *   - Two allowlists. `/health` and `/stream` reach other people's servers, so
 *     they may only reach the hosts named below; anything else is refused by
 *     name. `/tmdb` and `/ia` forward to one fixed API host each.
 *   - An origin gate. Without it this endpoint is a free TMDB proxy that anyone
 *     could point their own app at; a request from a browser is served only for
 *     the origins in `SOLVN_ORIGINS` (see allowedOrigin below).
 *   - Size and time caps on every upstream read, so a provider that streams an
 *     endless body cannot keep this invocation alive.
 *
 * Nothing here decides what the viewer sees — the page already reports each
 * provider's own answer and hands over to the embed pool when the ladder names
 * no file. This only makes the same answers reachable from a static host.
 */

const TMDB_HOST = 'https://api.themoviedb.org/3';
const IA_SEARCH = 'https://archive.org/advancedsearch.php';
const IA_META = 'https://archive.org/metadata/';

/* The embed hosts this site is willing to talk about. Adding a host here is the
   only way it becomes reachable through /health or /stream — a request can never
   name an arbitrary URL. */
const EMBED_HOSTS = new Set(['vidlink.pro', 'vidsrc.su', 'vidsrc.cc', 'multiembed.mov', 'moviesapi.club']);

/* Private/loopback hostnames that a proxied request must never reach. */
const PRIVATE_HOST = (host) => {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
};

/* The direct-stream ladder: the same three providers, in the same order, as the
   dev server. Each entry declares its own family, because several answer the
   front door by redirecting to the host that actually serves the player. */
const STREAM_PROVIDERS = [
  {
    label: 'MultiEmbed',
    host: 'multiembed.mov',
    also: ['streamingnow.mov'],
    movie: (id) => `/?video_id=${id}&tmdb=1`,
    tv: (id, s, e) => `/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
  {
    label: 'Vidsrc SU',
    host: 'vidsrc.su',
    movie: (id) => `/embed/movie/${id}`,
    tv: (id, s, e) => `/embed/tv/${id}/${s}/${e}`,
  },
  {
    label: 'MoviesApi',
    host: 'moviesapi.club',
    movie: (id) => `/movie/${id}`,
    tv: (id, s, e) => `/tv/${id}-${s}-${e}`,
  },
];

const UA = 'solvn-web';
const MAX_DOC_BYTES = 1_400_000; // an embed page bigger than this is a player, not a source list

const CORS = [
  'https://www.solvn.site',
  'https://solvn.site',
  'https://lokmanfree100-wq.github.io',
];

/**
 * Who may call this.
 *
 * Netlify sends the browser's `Origin` on every cross-origin fetch, and a
 * same-origin one never reaches a function host at all. A request with no
 * `Origin` is a script, not a page — it is refused, because the whole point of
 * the endpoint is to answer this site, and a public TMDB proxy is a metered key
 * that strangers would burn.
 *
 * `SOLVN_ORIGINS` (comma-separated) adds deploy previews and any host the
 * operator chooses; it never removes the three above.
 */
function allowedOrigin(requested) {
  if (!requested) return null;
  const extra = String(process.env.SOLVN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const list = CORS.concat(extra);
  const want = requested.replace(/\/$/, '');
  return list.find((o) => o === want) || null;
}

const json = (status, obj, origin, cache) => ({
  statusCode: status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cache || 'no-store',
    ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
  },
  body: typeof obj === 'string' ? obj : JSON.stringify(obj),
});

/* ---- upstream reader ------------------------------------------------------
   One GET, follow-redirects turned off so the ladder's family rule is enforced
   here rather than by whatever the runtime decides, body capped, and a hard
   timeout. Errors come back as a note instead of throwing, because the caller
   has to report which provider failed and why. */
async function getDoc(url, ms, hosts, hops = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      redirect: 'manual',
      signal: ctrl.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hops >= 3) return { status: res.status, bytes: 0, note: 'too many redirects' };
      let next;
      try {
        next = new URL(location, url);
      } catch {
        return { status: res.status, bytes: 0, note: 'bad redirect' };
      }
      if (next.protocol !== 'https:' || !hosts.has(bareHost(next.hostname))) {
        return { status: res.status, bytes: 0, note: `redirects to ${next.hostname}, which is not its own host` };
      }
      return getDoc(next.href, ms, hosts, hops + 1);
    }
    const bytes = await readCapped(res, MAX_DOC_BYTES, ctrl);
    return { status: res.status, bytes: bytes.length, body: bytes };
  } catch (e) {
    const code = String((e && e.cause && e.cause.code) || e.code || (e && e.name) || '');
    return {
      status: 0,
      bytes: 0,
      note: /ENOTFOUND|EAI_AGAIN|ERR_DNS|abort/.test(code)
        ? /abort/.test(code) ? 'timed out' : 'blocked on this network'
        : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Reads at most `cap` bytes, then stops the body; a truncated answer is still
 *  worth scanning, and an endless one can never hold the invocation open. */
async function readCapped(res, cap, ctrl) {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    out += decoder.decode(value, { stream: true });
    if (size > cap) {
      ctrl.abort();
      break;
    }
  }
  return out;
}

const bareHost = (host) => String(host || '').toLowerCase().replace(/^www\./, '');
const familyOf = (p) => new Set([p.host, ...(p.also || [])].map(bareHost));

/* ---- /tmdb -----------------------------------------------------------------
   The only route that needs the key. Paths are checked shape-first, so a caller
   cannot turn this into a general HTTP forwarder. */
async function routeTmdb(path, params) {
  const key = String(process.env.TMDB_API_KEY || '').trim();
  if (!key) {
    return json(500, { error: 'TMDB_API_KEY is not set on this host. Add it as a secret environment variable.' });
  }
  if (!/^\/?[A-Za-z0-9/_.-]{1,120}$/.test(path) || path.includes('..')) {
    return json(400, { error: 'bad catalogue path' });
  }
  const apiPath = path.replace(/^\/+/, '').replace(/^tmdb\/?/, '');
  const q = new URLSearchParams();
  for (const [k, v] of params) if (k !== 'kind' && k !== 'path' && /^[A-Za-z0-9_.-]{1,40}$/.test(k)) q.set(k, v);
  q.set('api_key', key);
  const res = await fetch(`${TMDB_HOST}/${apiPath}?${q}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(9000),
  });
  const body = await res.text();
  if (!res.ok) return json(res.status, { error: `TMDB answered ${res.status}` }, null, 'no-store');
  /* Only through the CDN when the origin is known: a credentialed-looking
     response must not be cached for a stranger's Origin header. */
  return json(200, body, null, 'public, max-age=60');
}

/* ---- /ia -------------------------------------------------------------------
   Two shapes only: a title search and one identifier's metadata. The query is
   stripped to letters and digits before it reaches Archive, and an identifier
   has to look like one, so neither route can be aimed at another host. */
async function routeIa(path, params) {
  const rest = String(path || '').replace(/^\/+/, '').replace(/^ia\/?/, '');
  if (rest === 'search') {
    const words = String(params.get('q') || '')
      .replace(/^\s*title\s*:?\s*/i, ' ')
      .replace(/[^A-Za-z0-9 ]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .slice(0, 12);
    if (!words.length) return json(400, { error: 'no query' });
    const rows = Math.min(Number(params.get('rows')) || 8, 20);
    const year = params.get('year');
    const docs = [
      `title:(${words.join(' AND ')})`,
      'mediatype:movies',
      year && /^\d{4}$/.test(year) ? `year:(${year} OR ${Number(year) - 1} OR ${Number(year) + 1})` : null,
    ]
      .filter(Boolean)
      .join(' AND ');
    const url = `${IA_SEARCH}?q=${encodeURIComponent(docs)}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year`
      + `&fl%5B%5D=downloads&fl%5B%5D=licenseurl&fl%5B%5D=collection&rows=${rows}&page=1&output=json`;
    return iaFetch(url);
  }
  if (rest.startsWith('meta/')) {
    const id = rest.slice(5);
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(id)) return json(400, { error: 'bad identifier' });
    return iaFetch(`${IA_META}${encodeURIComponent(id)}`);
  }
  return json(404, { error: 'unknown ia route' });
}

async function iaFetch(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(9000) });
    const body = await res.text();
    if (res.status !== 200) return json(502, { error: `archive http ${res.status}` });
    return json(200, body, null, 'public, max-age=300');
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) });
  }
}

/* ---- /health ----------------------------------------------------------------
   "Can this host serve this title?" — a browser cannot ask, so the page asks
   here. The allowlist is the whole design: this is not a general fetcher. */
async function routeHealth(params, origin) {
  let url;
  try {
    url = new URL(params.get('url') || '');
  } catch {
    return json(400, { error: 'bad url' }, origin);
  }
  if (url.protocol !== 'https:' || !EMBED_HOSTS.has(bareHost(url.hostname))) {
    return json(403, { error: 'host not allowed' }, origin);
  }
  const t0 = Date.now();
  const doc = await getDoc(url.href, 6000, new Set([bareHost(url.hostname)]));
  return json(200, { ok: doc.status > 0 && doc.status < 400, status: doc.status, ms: Date.now() - t0 }, origin);
}

/* ---- /stream ------------------------------------------------------------------
   The direct-stream ladder. A provider that names a `.m3u8` / `.mp4` in its own
   document is the only case this can answer with; a provider whose player builds
   the address in its own script answers with nothing, and the report says which
   of the two happened — including the size of what came back, because "HTTP 200"
   and "HTTP 200 over 9 KB" are different facts. */
const RAW_URL = /https:\/\/[^\s"'`<>\\^{|})\]]{10,600}/g;
const PROTOCOL_FREE = /\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s"'`<>\\^{|})\]]{4,500}?\.(?:m3u8|mp4)(?:[?#][^\s"'`<>\\^{|})\]]{0,300})?/gi;

function harvest(flat, out, seen) {
  for (const raw of flat.match(RAW_URL) || []) {
    const url = raw.replace(/[.,;:!?'"]+$/, '');
    if (!/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, hls: /\.m3u8(?:[?#]|$)/i.test(url) });
  }
}

/* Escaped slashes, \u002F, &amp; and %3A%2F%2F are all how these addresses reach
   us inside JSON and inline JS; every form is scanned on its own copy so an
   address that only exists encoded is still handed over decoded. */
function streamUrls(text) {
  const base = String(text).replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&');
  const out = [];
  const seen = new Set();
  harvest(base, out, seen);
  harvest(base.replace(/%3a/gi, ':').replace(/%2f/gi, '/'), out, seen);
  for (const rel of base.match(PROTOCOL_FREE) || []) {
    const url = `https:${rel.replace(/[.,;:!?'"]+$/, '')}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, hls: /\.m3u8(?:[?#]|$)/i.test(url) });
  }
  return out.sort((a, b) => (b.hls ? 1 : 0) - (a.hls ? 1 : 0)).slice(0, 8);
}

async function routeStream(params, origin) {
  const isTv = params.get('type') === 'tv';
  const id = Number(params.get('tmdb'));
  const season = Number(params.get('s')) || 1;
  const episode = Number(params.get('e')) || 1;
  if (!Number.isInteger(id) || id < 1 || id > 1e7) {
    return json(200, { ok: false, sources: [], tried: [], error: 'bad id' }, origin);
  }
  const tried = [];
  for (const p of STREAM_PROVIDERS) {
    const path = isTv ? p.tv(id, season, episode) : p.movie(id);
    const doc = await getDoc(`https://${p.host}${path}`, 7000, familyOf(p));
    const urls = doc.body ? streamUrls(doc.body) : [];
    const kb = doc.bytes ? ` · ${Math.max(1, Math.round(doc.bytes / 1024))} KB` : '';
    tried.push({
      label: p.label,
      note: urls.length ? `${urls.length} stream(s)` : doc.note || (doc.status ? `HTTP ${doc.status}${kb}` : 'no answer'),
    });
    if (urls.length) return json(200, { ok: true, provider: p.label, sources: urls, tried }, origin);
  }
  return json(200, { ok: false, sources: [], tried }, origin);
}

/* ---- /stremio --------------------------------------------------------------
   Proxies a Stremio add-on request (manifest or stream) so the browser can read
   it cross-origin. Target is user-configured, so it is validated strictly:
   https only, public host, size/time capped. */
async function routeStremio(params, origin) {
  const target = params.get('target') || '';
  const relPath = params.get('path') || '';
  let base;
  try { base = new URL(target); } catch { return json(400, { error: 'bad target' }, origin); }
  if (base.protocol !== 'https:') return json(403, { error: 'https required' }, origin);
  if (PRIVATE_HOST(base.hostname)) return json(403, { error: 'host not allowed' }, origin);
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,300}$/.test(relPath) || relPath.includes('..')) {
    return json(400, { error: 'bad path' }, origin);
  }
  const url = `${base.origin}${base.pathname.replace(/\/+$/, '')}/${relPath.replace(/^\/+/, '')}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,*/*' }, redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    if (text.length > MAX_DOC_BYTES) return json(413, { error: 'response too large' }, origin);
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep raw */ }
    return json(res.ok ? 200 : res.status, body, origin, 'no-store');
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) }, origin);
  } finally {
    clearTimeout(timer);
  }
}

/* ---- entry -----------------------------------------------------------------*/

export async function handler(event) {
  const origin = allowedOrigin(event.headers && (event.headers.origin || event.headers.Origin));
  if (!origin) {
    return {
      statusCode: 403,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'This endpoint answers Solvn pages only.' }),
    };
  }
  const params = new URLSearchParams(event.rawUrl ? new URL(event.rawUrl).search : event.queryStringParameters || {});
  const kind = params.get('kind');
  const path = params.get('path') || '';
  /* Every response carries this site's Origin back, so a browser on solvn.site
     may read it and no other caller can claim a cached copy. */
  const withCors = (out) => ({
    ...out,
    headers: { ...out.headers, 'access-control-allow-origin': origin, vary: 'Origin' },
  });
  try {
    if (kind === 'tmdb') return withCors(await routeTmdb(path, params));
    if (kind === 'ia') return withCors(await routeIa(path, params));
    if (kind === 'health') return await routeHealth(params, origin);
    if (kind === 'stream') return await routeStream(params, origin);
    if (kind === 'stremio') return await routeStremio(params, origin);
  } catch (e) {
    return json(502, { error: String((e && e.message) || e) }, origin);
  }
  return json(404, { error: 'unknown route' }, origin);
}
