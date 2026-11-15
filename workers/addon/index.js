/* Solvn's own Stremio-compatible add-on, deployed as a Cloudflare Worker.

   It exists because the site's playback depended on third-party add-ons that
   keep dying: one 404s its manifest, others redirect to "is-deprecated" hosts.
   This one answers for the titles in titles.js and for nothing else, so a dead
   upstream can no longer take the whole site down.

   Routes (Stremio's add-on protocol):
     GET /manifest.json
     GET /stream/<type>/<id>.json
     GET /subtitles/<type>/<id>.json
     GET /vtt?u=<declared caption url>     caption proxy, allow-listed
     GET /                                 what this add-on is, as JSON

   No dependencies, no bindings, no environment variables: it reads one data
   module and returns JSON. That is what makes it deployable anywhere workerd
   runs, including Sites. */

import { ADDON, TITLES } from './titles.js';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

const json = (body, { status = 200, maxAge = 300 } = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
  },
});

/* An add-on is asked about an episode as `tt0903747:5:14` or `kitsu:176:1`, and
   about the title itself as `tt0903747`. Both must find the same entry, so the
   season/episode tail is dropped here. */
export function baseId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (ADDON.idPrefixes.some((p) => p.endsWith(':') && raw.startsWith(p))) {
    return parts.slice(0, 2).join(':');
  }
  return parts[0];
}

function indexTitles(titles) {
  const byId = new Map();
  for (const entry of titles) {
    for (const id of entry.ids || []) {
      const key = String(id).toLowerCase();
      const list = byId.get(key);
      if (list) list.push(entry);
      else byId.set(key, [entry]);
    }
  }
  return byId;
}

/* Every caption file this add-on will proxy. Anything else is refused, so the
   worker cannot be used as an open relay. */
function allowedCaptions(titles) {
  const allowed = new Set();
  for (const entry of titles) {
    for (const sub of entry.subtitles || []) if (sub.url) allowed.add(sub.url);
  }
  return allowed;
}

const streamsFor = (entries) => entries.map((entry) => {
  const stream = {
    name: ADDON.tag,
    title: [entry.name, entry.credit].filter(Boolean).join('\n'),
  };
  if (entry.ytId) stream.ytId = entry.ytId;
  if (entry.url) stream.url = entry.url;
  return stream;
});

function subtitlesFor(entries, origin) {
  const seen = new Set();
  const subtitles = [];
  for (const entry of entries) {
    for (const sub of entry.subtitles || []) {
      if (!sub.url || seen.has(sub.url)) continue;
      seen.add(sub.url);
      subtitles.push({
        id: `${ADDON.id}-${sub.lang}-${subtitles.length}`,
        url: `${origin}/vtt?u=${encodeURIComponent(sub.url)}`,
        lang: sub.lang,
        label: sub.label || String(sub.lang || '').toUpperCase(),
      });
    }
  }
  return subtitles;
}

async function captionProxy(src) {
  if (!src) return json({ error: 'missing u' }, { status: 400 });
  const upstream = await fetch(src, { headers: { accept: 'text/vtt,text/plain,*/*' } });
  if (!upstream.ok) {
    return json({ error: 'caption unavailable', status: upstream.status }, { status: 502 });
  }
  /* The hosts serving these files label them text/plain or text/x-wiki; a
     <track> is only accepted as text/vtt, so the type is corrected here. */
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS,
      'content-type': 'text/vtt; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}

export async function handleAddon(request, titles = TITLES) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const byId = indexTitles(titles);
  const lookup = (id) => byId.get(baseId(id).toLowerCase()) || [];

  if (path === '/manifest.json') {
    return json({
      id: ADDON.id,
      version: ADDON.version,
      name: ADDON.name,
      description: ADDON.description,
      resources: ['stream', 'subtitles'],
      types: ADDON.types,
      idPrefixes: ADDON.idPrefixes,
      catalogs: [],
      behaviorHints: { adult: false },
    }, { maxAge: 3600 });
  }

  const stream = path.match(/^\/stream\/([^/]+)\/(.+)\.json$/);
  if (stream) return json({ streams: streamsFor(lookup(stream[2])) });

  const subs = path.match(/^\/subtitles\/([^/]+)\/(.+)\.json$/);
  if (subs) return json({ subtitles: subtitlesFor(lookup(subs[2]), url.origin) });

  if (path === '/vtt') {
    const src = url.searchParams.get('u');
    if (!allowedCaptions(titles).has(src)) {
      return json({ error: 'caption not listed' }, { status: 403 });
    }
    return captionProxy(src);
  }

  if (path === '/') {
    return json({
      name: ADDON.name,
      version: ADDON.version,
      titles: titles.length,
      sources: {
        youtube: titles.filter((t) => t.ytId).length,
        files: titles.filter((t) => t.url).length,
        captions: titles.reduce((n, t) => n + (t.subtitles || []).length, 0),
      },
      manifest: `${url.origin}/manifest.json`,
    });
  }

  return json({ error: 'not found' }, { status: 404 });
}

export default {
  fetch: (request) => handleAddon(request),
};
