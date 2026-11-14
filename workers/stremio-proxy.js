/**
 * Solvn — dedicated Stremio CORS proxy (Cloudflare Worker).
 *
 * Stremio add-ons are built for the Stremio app, not for web pages, so most do
 * not send `Access-Control-Allow-Origin` and a browser on solvn.site cannot read
 * their manifest or streams directly. This Worker fetches the add-on for the page
 * and adds the CORS headers, so you do not depend on flaky public proxies.
 *
 * Deploy (one file, ~2 minutes):
 *   1. dash.cloudflare.com ▸ Workers & Pages ▸ Create ▸ Worker.
 *   2. Replace the starter code with this file, Deploy.
 *   3. Copy the Worker URL (https://<name>.<subdomain>.workers.dev).
 *   4. In Solvn: Settings ▸ Stremio-style add-ons ▸ "CORS proxy" paste:
 *        https://<name>.<subdomain>.workers.dev/?url={url}
 *   5. Add your add-on and press Test — it should now say "Addon OK".
 *
 * Lock-down:
 *   - Only Stremio API paths: /manifest.json and /{stream|catalog|meta|subtitles}/…
 *   - https only, private/loopback hosts refused (no SSRF).
 *   - GET/OPTIONS only, 1.4 MB response cap, 9 s upstream timeout.
 *   - CORS answers only Solvn's own origins.
 *   - Rate limit: per-client-IP and a global per-isolate backstop. Counters are
 *     in memory, so each isolate enforces its own share; combined with the
 *     hosting daily/monthly quota this caps abuse without extra services.
 */

const MAX_BYTES = 1_400_000;
const TIMEOUT_MS = 9000;

/* Rate limit: a client may make up to PER_IP requests per WINDOW_MS; the whole
   isolate stops at GLOBAL in the same window. Tune down for a stricter proxy. */
const WINDOW_MS = 60_000;
const PER_IP = 120;
const GLOBAL = 6000;

const buckets = new Map(); // ip -> { count, reset }
let globalBucket = { count: 0, reset: Date.now() + WINDOW_MS };

const PRIVATE_HOST = (host) => {
  const h = String(host || '').toLowerCase();
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
};

const StremioPath = (pathname) => {
  const p = String(pathname || '').replace(/^\/+/, '');
  if (/(^|\/)manifest\.json$/.test(p)) return true;
  return /(^|\/)(stream|catalog|meta|subtitles)\//.test(p);
};

const ORIGIN_OK = (origin) => {
  const o = String(origin || '').replace(/\/$/, '');
  if (!o) return false;
  if (o === 'https://solvn.site' || o === 'https://www.solvn.site') return true;
  if (o === 'https://lokmanfree100-wq.github.io') return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) return true;
  return false;
};

const corsFor = (origin) => {
  const base = {
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': '*',
  };
  if (ORIGIN_OK(origin)) {
    return { ...base, 'access-control-allow-origin': origin.replace(/\/$/, ''), vary: 'Origin' };
  }
  return { ...base, 'access-control-allow-origin': 'https://solvn.site', vary: 'Origin' };
};

const clientIp = (request) =>
  request.headers.get('cf-connecting-ip') ||
  (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() ||
  'unknown';

/* Returns the number of seconds to wait, or 0 when allowed. */
function rateLimit(ip) {
  const now = Date.now();
  if (now >= globalBucket.reset) globalBucket = { count: 0, reset: now + WINDOW_MS };
  globalBucket.count += 1;
  if (globalBucket.count > GLOBAL) return Math.max(1, Math.ceil((globalBucket.reset - now) / 1000));

  if (buckets.size > 10000) buckets.clear();
  let b = buckets.get(ip);
  if (!b || now >= b.reset) {
    b = { count: 0, reset: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count += 1;
  if (b.count > PER_IP) return Math.max(1, Math.ceil((b.reset - now) / 1000));
  return 0;
}

const json = (status, obj, origin, extra) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(extra || {}), ...corsFor(origin) },
  });

export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(origin) });
    if (request.method !== 'GET') return json(405, { error: 'GET only' }, origin);

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return json(400, { error: 'missing ?url=' }, origin);

    let parsed;
    try { parsed = new URL(target); } catch { return json(400, { error: 'bad url' }, origin); }
    if (parsed.protocol !== 'https:') return json(403, { error: 'https required' }, origin);
    if (PRIVATE_HOST(parsed.hostname)) return json(403, { error: 'host not allowed' }, origin);
    if (!StremioPath(parsed.pathname)) return json(403, { error: 'not a Stremio endpoint' }, origin);

    /* Only valid Stremio fetches count against the limit, so malformed or
       probing requests never throttle a real viewer. */
    const wait = rateLimit(clientIp(request));
    if (wait) return json(429, { error: 'rate limited', retryAfter: wait }, origin, { 'retry-after': String(wait) });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(parsed.href, {
        headers: { 'User-Agent': 'solvn-stremio-proxy', Accept: 'application/json,*/*' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return json(413, { error: 'response too large' }, origin);
      return new Response(buf, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...corsFor(origin),
        },
      });
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) }, origin);
    } finally {
      clearTimeout(timer);
    }
  },
};
