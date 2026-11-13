/**
 * TMDB catalogue client for the Movies & Series section.
 *
 * Every call goes through the /tmdb proxy (see lib/proxy.js for where that
 * lives), which holds the key, so the token never reaches the browser. Results
 * are cached in memory for the life of the page: TMDB pages are stable, and the
 * same home rail re-fetched per mount would only hammer the proxy.
 *
 * When the host answers with nothing that looks like catalogue JSON — which is
 * what a static host does, because it runs no server code at all — the same call
 * is answered from data/catalogue.json instead (see lib/catalogue.js). The
 * snapshot carries no key, so it is the only way these pages can fill on
 * GitHub Pages, and a host that does run the proxy keeps serving live TMDB.
 */

import { proxyUrl } from './proxy.js';
import { answer as catalogueAnswer, hasCatalogue, loadCatalogue, servingOffline } from './catalogue.js';
import { t } from './i18n.js';

export { servingOffline };

const BASE = '/tmdb';
const memCache = new Map();

/* Thrown when the address under BASE did not answer with catalogue JSON and no
   snapshot is loaded either — a host that has no /tmdb route replies with its own
   HTML page, and calling that "empty results" would leave the rails silently
   blank. */
export class ProxyMissing extends Error {
  constructor(url) {
    super(`No catalogue proxy at ${url}`);
    this.name = 'ProxyMissing';
  }
}

/* The proxy is absent but the snapshot is in hand, and this particular title is
   simply not in it. Different sentence, because it is a different fact: the
   shelves work, one title does not. */
export class NotInCatalogue extends Error {
  constructor(path) {
    super(`Offline catalogue has no entry for ${path}`);
    this.name = 'NotInCatalogue';
  }
}

export async function tmdb(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const url = proxyUrl(`${BASE}${path}?${qs}`);
  if (memCache.has(url)) return memCache.get(url);
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
    const text = await res.text();
    data = JSON.parse(text);
  } catch {
    /* Nothing usable from this host. The snapshot is the only other answer, and
       it is consulted before the page writes an empty rail. */
    await loadCatalogue();
    const offline = await catalogueAnswer(path, params);
    if (offline) return offline;
    throw hasCatalogue() ? new NotInCatalogue(path) : new ProxyMissing(url);
  }
  memCache.set(url, data);
  return data;
}

/* ---- artwork --------------------------------------------------------- */
/* Catalogue snapshots can also carry a full artwork URL (the Cinemeta seed
   does). A path is still prefixed with TMDB's CDN; an absolute URL and a local
   /assets path are already complete and must not be prefixed twice. */
export const img = (p, size) =>
  p ? (/^https?:\/\//.test(p) || p.startsWith('/assets/') ? p : `https://image.tmdb.org/t/p/${size}${p}`) : null;
export const poster = (p, size = 'w342') => img(p, size) || '';
export const backdrop = (p, size = 'w1280') => img(p, size);

/* ---- endpoints ------------------------------------------------------- */

export const api = {
  trending: (window = 'week', page = 1) => tmdb(`/trending/all/${window}`, { page }),
  popularMovies: (page = 1) => tmdb('/movie/popular', { page }),
  popularTv: (page = 1) => tmdb('/tv/popular', { page }),
  topMovies: (page = 1) => tmdb('/movie/top_rated', { page }),
  topTv: (page = 1) => tmdb('/tv/top_rated', { page }),
  nowPlaying: (page = 1) => tmdb('/movie/now_playing', { page }),
  upcoming: (page = 1) => tmdb('/movie/upcoming', { page }),
  airingToday: (page = 1) => tmdb('/tv/airing_today', { page }),
  onTheAir: (page = 1) => tmdb('/tv/on_the_air', { page }),
  details: (type, id) =>
    tmdb(`/${type}/${id}`, {
      append_to_response: 'videos,credits,similar,recommendations',
    }),
  search: (query, type, page = 1) =>
    tmdb(`/search/${type === 'tv' ? 'tv' : 'movie'}`, { query, page, include_adult: 'false' }),
  discover: (type, params) => tmdb(`/discover/${type}`, params),
  genres: (type) => tmdb(`/genre/${type}/list`),
  season: (id, s) => tmdb(`/tv/${id}/season/${s}`),
};

/* ---- shared helpers -------------------------------------------------- */

export const nameOf = (d) => d?.title || d?.name || d?.original_title || d?.original_name || 'Untitled';

export const dateOf = (d) => d?.release_date || d?.first_air_date || '';

export const yearOf = (d) => (dateOf(d) || '').slice(0, 4);

export const typeOf = (d) => (d?.media_type === 'tv' || d?.first_air_date || d?.name ? 'tv' : 'movie');

export const rating = (v) => (Number(v) ? Number(v).toFixed(1) : '–');

export const runtimeText = (m) => (m ? `${Math.floor(m / 60)}h ${m % 60}m` : '');

/** "1 seasons" is wrong in English and worse in Arabic, and both the hub and the
    detail page print this number. */
export const seasonsLabel = (n) => (Number(n) === 1 ? t('{n} season', { n: 1 }) : t('{n} seasons', { n: n }));

/** Nice date in the page's own language, e.g. "Nov 4, 2026" / "4 novembre 2026". */
export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const genreCache = { movie: null, tv: null };
export async function genreMap() {
  if (!genreCache.movie) genreCache.movie = (await api.genres('movie')).genres;
  if (!genreCache.tv) genreCache.tv = (await api.genres('tv')).genres;
  const map = {};
  for (const g of [...genreCache.movie, ...genreCache.tv]) map[g.id] = g.name;
  return map;
}

export function firstTrailer(videos = []) {
  const ys = videos.filter((v) => v.site === 'YouTube');
  return (
    ys.find((v) => v.type === 'Trailer' && v.official) ||
    ys.find((v) => v.type === 'Trailer') ||
    ys.find((v) => v.type === 'Teaser') ||
    ys[0] ||
    null
  );
}

/* ---- movie watchlist (local, tmdb-prefixed so anime ids never clash) -- */

const WATCH_KEY = 'tmdbWatch';

export function movieWatchlist() {
  const list = storageSafe(WATCH_KEY, []);
  return list;
}
export function inMovieWatchlist(type, id) {
  return movieWatchlist().some((e) => e.type === type && e.id === id);
}
export function toggleMovieWatchlist({ type, id, title, posterPath }) {
  const list = movieWatchlist();
  const hit = list.find((e) => e.type === type && e.id === id);
  const next = hit
    ? list.filter((e) => !(e.type === type && e.id === id))
    : [{ type, id, title, poster: posterPath || null, at: Date.now() }, ...list];
  writeSafe(WATCH_KEY, next.slice(0, 60));
  return !hit;
}

/* Movie progress lives under a tmdb: key inside the shared progress map, so a
   TMDB id and an AniList id can never collide on "continue watching". */
export function movieProgress(id) {
  const map = readSafe('progress', {});
  return map[`tmdb:${id}`] || null;
}
export function setMovieProgress({ type, id, title, posterPath, season = 1, episode, seconds = 0, duration = 0 }) {
  const map = readSafe('progress', {});
  const key = `tmdb:${id}`;
  const prev = map[key] || {};
  map[key] = {
    id,
    key,
    type,
    title,
    poster: posterPath || prev.poster || null,
    season: Number(season) || prev.season || 1,
    episode: Number(episode) || prev.episode || 1,
    seconds,
    duration: Number(duration) || prev.duration || 0,
    at: Date.now(),
    plays: (Number(prev.plays) || 0) + 1,
  };
  const trimmed = Object.fromEntries(
    Object.entries(map)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, 60),
  );
  writeSafe('progress', trimmed);
}
export function movieContinueWatching(limit = 14) {
  return Object.entries(readSafe('progress', {}))
    .filter(([k]) => k.startsWith('tmdb:'))
    .map(([, p]) => p)
    .filter((p) => p && p.at)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

function storageSafe(k, fallback) {
  try {
    const raw = localStorage.getItem(`kitsune:${k}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function readSafe(k, fallback) {
  return storageSafe(k, fallback);
}
function writeSafe(k, v) {
  try {
    localStorage.setItem(`kitsune:${k}`, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}
