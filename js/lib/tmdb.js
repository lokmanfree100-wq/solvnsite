/**
 * TMDB catalogue client for the Movies & Series section.
 *
 * Every call goes through the site's own /tmdb proxy (serve-solvn.mjs holds the
 * key), so the token never reaches the browser. Results are cached in memory for
 * the life of the page: TMDB pages are stable, and the same home rail re-fetched
 * per mount would only hammer the proxy.
 */

const BASE = '/tmdb';
const memCache = new Map();

/* Thrown when the address under BASE did not answer with catalogue JSON — a
   host that has no /tmdb route replies with its own HTML page, and calling
   that "empty results" would leave the rails silently blank. */
export class ProxyMissing extends Error {
  constructor(url) {
    super(`No catalogue proxy at ${url}`);
    this.name = 'ProxyMissing';
  }
}

export async function tmdb(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const url = `${BASE}${path}?${qs}`;
  if (memCache.has(url)) return memCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProxyMissing(url);
  }
  memCache.set(url, data);
  return data;
}

/* The state block the views show instead of an empty rail. Translated keys, so
   it reads the same in every language and never asks for a retry that cannot
   succeed: retrying does not install the endpoint. */
export const PROXY_NOTICE = {
  heading: 'No catalogue proxy on this host',
  body: 'Movies & Series read TMDB through the site’s own /tmdb endpoint. This address does not answer it, so there is nothing to list. Running the site with serve-solvn.mjs (or any host that proxies /tmdb) fills these pages.',
};

export const proxyNotice = (err) => (err instanceof ProxyMissing ? PROXY_NOTICE : null);

/* ---- artwork --------------------------------------------------------- */
export const img = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
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
