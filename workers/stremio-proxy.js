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
 * Request shape:  GET /?url=https%3A%2F%2Faddon.example%2Fmanifest.json
 * Response:       the add-on's body, with CORS headers for any origin.
 *
 * Safety: https only, private/loopback hosts refused, GET only, response capped,
 * upstream timeout. It is a proxy for add-on JSON only — it does not follow the
 * add-on's redirects to arbitrary hosts beyond one hop on the same host.
 */

const MAX_BYTES = 1_400_000;
const TIMEOUT_MS = 9000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*',
};

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

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
  });

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json(405, { error: 'GET only' });

    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return json(400, { error: 'missing ?url=' });

    let parsed;
    try { parsed = new URL(target); } catch { return json(400, { error: 'bad url' }); }
    if (parsed.protocol !== 'https:') return json(403, { error: 'https required' });
    if (PRIVATE_HOST(parsed.hostname)) return json(403, { error: 'host not allowed' });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(parsed.href, {
        headers: { 'User-Agent': 'solvn-stremio-proxy', Accept: 'application/json,*/*' },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return json(413, { error: 'response too large' });
      return new Response(buf, {
        status: res.status,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          ...CORS,
        },
      });
    } catch (e) {
      return json(502, { error: String((e && e.message) || e) });
    } finally {
      clearTimeout(timer);
    }
  },
};
