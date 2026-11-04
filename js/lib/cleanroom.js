/* CLEAN ROOM — playback that never loads a third-party document.
   The Internet Archive open catalogue holds feature films that are public domain or CC-licensed,
   as plain MP4 files. We stream those files into Solvn's own <video> element, so the player
   chrome, the scripts and the click handling all stay ours. Nothing from the embed pool is used.
   Metadata goes through the site's /ia proxy (see lib/proxy.js); the video bytes come straight
   from archive.org, which CSP allows only through `media-src` (never `frame-src` or `script-src`). */

import { proxyUrl } from './proxy.js';

const norm = (s) => String(s || '').toLowerCase()
  .replace(/\(.*?\)|\[[^\]]*\]/g, ' ')
  .replace(/[^a-z0-9 ]+/g, ' ')
  .replace(/^\s*(the|a|an)\s+/, '')
  .replace(/\s+/g, ' ')
  .trim();

const titleOf = (doc) => {
  const t = doc?.title;
  if (Array.isArray(t)) return String(t[0] || doc?.identifier || '');
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return Object.values(t).join(' ');
  return doc?.identifier || '';
};

/* Score an IA hit against the TMDB title we were asked for. The rights statement in
   findCleanSource is what keeps modern films out; this score only has to keep the *wrong work*
   out, so a title that merely contains ours (a Street Fighter round narrated by "Nosferatu")
   needs enough extra words to be disqualified. */
function scoreMatch(query, candTitle) {
  const a = norm(query);
  const b = norm(candTitle);
  if (!a || !b) return 0;
  const leftover = b.split(' ').length - a.split(' ').length;
  if (a === b) return 4;
  if (b.startsWith(a) || a.startsWith(b)) return 3;
  if (b.includes(a) || a.includes(b)) return Math.abs(leftover) <= 4 ? 2 : 1;
  const aset = new Set(a.split(' '));
  const btokens = b.split(' ');
  let shared = 0;
  for (const t of aset) if (btokens.includes(t)) shared++;
  return shared / Math.max(1, Math.min(aset.size, new Set(btokens).size)) >= 0.75 && leftover <= 2 ? 1 : 0;
}

/* Files in an IA item: the original upload plus derived copies. Browsers decode H.264/AAC MP4 and
   Theora OGG reliably; MPEG-4 Part 2 (which is what a lot of old Archive uploads are) stalls in
   <video>, so an item whose only copy is Part 2 is skipped rather than "tried". */
function pickVideo(meta, id, wantSec) {
  const files = Array.isArray(meta?.files) ? meta.files : [];
  const bytes = (f) => Number(f.size) || 0;
  const candidates = files
    .filter((f) => typeof f.name === 'string' && /\.(mp4|ogv)$/i.test(f.name) && !/\.sub\.(mp4|ogv)$/i.test(f.name))
    .map((f) => {
      const tag = `${f.format || ''} ${f.name}`.toLowerCase();
      const ogv = /\.ogv$/i.test(f.name);
      const rank = /h\.?264|avc|x264/.test(tag) ? 0 : ogv ? 1 : /mpeg4|512kb|h\.?263|vcd|dvd|_alt/.test(tag) ? 9 : 2;
      return { f, rank, bytes: bytes(f), seconds: Math.round(Number(f.length) || 0), format: rank === 0 ? 'H.264 / AAC' : ogv ? 'Theora / OGG' : 'MP4' };
    })
    .filter((x) => x.rank < 9 && x.bytes > 3e6
      && (!wantSec || !x.seconds || (x.seconds > wantSec * 0.6 && x.seconds < wantSec * 1.9)))
    .sort((a, b) => a.rank - b.rank || b.bytes - a.bytes);
  const best = candidates.shift();
  if (!best) return null;
  const path = best.f.name.split('/').map(encodeURIComponent).join('/');
  return {
    bytes: best.bytes,
    seconds: best.seconds,
    format: best.format,
    url: `https://archive.org/download/${encodeURIComponent(id)}/${path}`,
  };
}

async function json(url) {
  const r = await fetch(proxyUrl(url), { cache: 'no-store' });
  if (!r.ok) throw new Error('ia http ' + r.status);
  return r.json();
}

async function hits(title, year) {
  const q = new URLSearchParams({ q: title, rows: '20' });
  if (year) q.set('year', String(year));
  try {
    const res = await json(`/ia/search?${q}`);
    return res?.response?.docs || [];
  } catch { return []; }
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

const RIGHTS = /creativecommons\.org\/(publicdomain|licenses)|publicdomain\.org/i;
function rightsOf(doc, meta) {
  for (const c of [first(doc?.licenseurl), first(meta?.metadata?.licenseurl)]) {
    if (typeof c === 'string' && RIGHTS.test(c)) return c;
  }
  return '';
}

/* A licence tag is something the uploader chose, so it can be a lie — a 2025 screen recording of
   Breaking Bad sits on Archive under "CC BY-NC-ND". Dedications (public domain) are not claimed by
   the uploader the same way, but a CC label on a capture fingerprint is worthless, so captures only
   get through on a public-domain statement. */
const CAPTURE = /(?:vlc|udm|web|screen)[-_ ]?record|^youtube-|^dailymotion-|^vimeo-[0-9]|stream[-_ ]archiver|[-_ ]rec(?:ording)?\b/i;
const looksCaptured = (id, title) => CAPTURE.test(String(id || '')) || CAPTURE.test(String(title || ''));

function rightsLabel(url) {
  if (/publicdomain\/mark/i.test(url)) return 'Public domain mark';
  if (/publicdomain\/zero/i.test(url)) return 'CC0';
  const m = /licenses\/([a-z-]+(?:-[a-z0-9]+))?\/([0-9.]+)/i.exec(url);
  return m ? `CC ${m[1].toUpperCase().replace('-', ' ')} ${m[2]}` : /publicdomain/i.test(url) ? 'Public domain' : 'Creative Commons';
}

/**
 * Find a public-domain / CC copy of `title` on the Internet Archive.
 * @returns {{identifier:string,file:string,url:string,thumb:string,iaTitle:string,year:*,bytes:number,format:string,license:string}|null}
 */
export async function findCleanSource(title, year, runtimeMin = 0) {
  // Archive's own year field is the deposit year, not the release year, so a miss on the
  // year-limited pass retries unconstrained and lets the title score decide.
  let docs = year ? await hits(title, year) : [];
  if (!docs.length) docs = await hits(title, null);
  if (!docs.length) return null;

  const y0 = Number(year) || 0;
  const drift = (d) => {
    const y = Number(first(d.year)) || 0;
    return y0 && y ? Math.min(20, Math.abs(y - y0)) : 0;
  };
  const ranked = docs
    .map((d) => ({ d, s: scoreMatch(title, titleOf(d)) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s || drift(a.d) - drift(b.d) || (b.d.downloads || 0) - (a.d.downloads || 0))
    .slice(0, 6);
  if (!ranked.length) return null;

  const wantSec = (Number(runtimeMin) || 0) * 60;
  for (const { d } of ranked) {
    let meta;
    try { meta = await json(`/ia/meta/${encodeURIComponent(d.identifier)}`); } catch { continue; }
    if (meta?.is_dark) continue; // withheld by a rights holder — no files, nothing to play
    // The rights statement is the gate, not the shelf. Any visitor can upload a modern film with
    // faked metadata — "Breaking Bad (Castellano)" was on Archive with Vince Gilligan as creator —
    // so only items carrying an explicit public-domain mark or CC licence are ever played here.
    const lic = rightsOf(d, meta);
    if (!lic) continue;
    if (!/publicdomain/i.test(lic) && looksCaptured(d.identifier, titleOf(d))) continue;
    // A 3-minute Turner clip can share a title with a 113-minute feature; runtime separates them.
    const v = pickVideo(meta, d.identifier, wantSec);
    if (!v) continue;
    return {
      identifier: d.identifier,
      iaTitle: titleOf(d),
      year: first(d.year) || first(meta?.metadata?.year) || '',
      bytes: v.bytes,
      seconds: v.seconds,
      format: v.format,
      url: v.url,
      thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
      license: lic,
      rights: rightsLabel(lic),
    };
  }
  return null;
}

/* ---- safety readout ----
   Every load the page performs (including iframe documents) is a resource timing entry, so we can
   list the outside hosts this mode actually pulled in and in what role. Cross-origin frame internals
   are redacted by the browser — that gap is stated in the panel text, not papered over. */
export function loadReport() {
  const own = location.origin;
  const ROLE = {
    iframe: 'code', frame: 'code', script: 'code',
    css: 'style', link: 'style', font: 'font', img: 'image', image: 'image',
    video: 'media', audio: 'media', track: 'media',
    fetch: 'data', xmlhttprequest: 'data',
  };
  const LABEL = { code: 'ran code here', style: 'stylesheet', font: 'font file', image: 'image', media: 'media file only', data: 'api data', other: 'other' };
  const key = (origin) => origin.replace('://www.', '://'); // one host can answer on two origins
  const map = new Map();
  const live = [];
  const add = (origin, role) => {
    const k = key(origin);
    const hit = map.get(k) || { host: k.replace(/^https:\/\//, ''), roles: new Set(), count: 0 };
    hit.roles.add(role);
    hit.count++;
    map.set(k, hit);
  };
  for (const e of performance.getEntriesByType('resource')) {
    let u;
    try { u = new URL(e.name); } catch { continue; } // opaque cross-origin entry
    if (u.origin === own || !/^https?:$/.test(u.protocol)) continue;
    add(u.origin, ROLE[e.initiatorType] || 'other');
  }
  for (const f of document.querySelectorAll('iframe[src]')) {
    let o;
    try { o = new URL(f.getAttribute('src')).origin; } catch { continue; }
    if (o === own) continue;
    add(o, 'code');
    if (!live.some((l) => key(l) === key(o))) live.push(o);
  }
  const hosts = [...map.values()]
    .map((m) => {
      const roles = [...m.roles].sort((a, b) => (a === 'code' ? -1 : b === 'code' ? 1 : a.localeCompare(b)));
      return { host: m.host, count: m.count, roles, label: roles.map((r) => LABEL[r] || r).join(' + ') };
    })
    .sort((a, b) => (b.roles.includes('code') ? 1 : 0) - (a.roles.includes('code') ? 1 : 0) || a.host.localeCompare(b.host));
  /* Resource timings are a history of the whole page view, so the host list keeps growing after a
     mode switch. `live` is what is mounted right now — that is the number the chip shows. */
  return { hosts, liveCount: live.length, liveHosts: live.map((o) => key(o).replace(/^https:\/\//, '')) };
}
