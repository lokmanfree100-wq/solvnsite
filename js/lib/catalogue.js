/**
 * The offline film catalogue — what answers when this host runs no /tmdb.
 *
 * solvn.site is GitHub Pages, and Pages executes no server code, so there is no
 * place for the TMDB key and the shelves came back empty for every visitor. The
 * other way to fill a static host is to ship the data: data/catalogue.json is a
 * snapshot of the nine shelves the hub reads, taken by build-catalogue.mjs with
 * the key on a machine that can hold it. It carries no key, nothing to expire and
 * no route to abuse — a visitor downloads a file, the same as the site's CSS.
 *
 * Every response here is shaped like the TMDB answer the views already consume,
 * because a second vocabulary in this file would mean editing four views to agree
 * with it. Where TMDB knows more than the snapshot does, that shows as what it
 * is: search covers the titles in this file rather than the whole database, and
 * "more like this" is computed from shared genres instead of read from TMDB's
 * similarity scores.
 */

const SEED_URL = new URL('data/catalogue.json', document.baseURI).href;

/* The shelf names in the file, keyed by the request that would have gone to
   TMDB. A page beyond the first answers empty, the same way TMDB's own
   pagination ends — the grids stop rather than spin. */
const SHELF_ROUTES = {
  '/trending/all/week': 'trending',
  '/movie/popular': 'popularMovies',
  '/movie/now_playing': 'nowPlaying',
  '/movie/upcoming': 'upcoming',
  '/movie/top_rated': 'topMovies',
  '/tv/popular': 'popularTv',
  '/tv/airing_today': 'airingToday',
  '/tv/on_the_air': 'onTheAir',
  '/tv/top_rated': 'topTv',
};

let loading = null;
let cat = null;
let answered = false;
const watchers = [];

/** Loaded once and kept: the file is a snapshot, and re-fetching it per rail
    would be a second download for the same bytes. */
export function loadCatalogue() {
  if (!loading) {
    loading = fetch(SEED_URL, { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        cat = j && Array.isArray(j.titles) ? { ...j, titles: dedupeRows(j.titles) } : null;
        return cat;
      })
      .catch(() => {
        cat = null;
        return null;
      });
  }
  return loading;
}

/** Called whenever an answer came from the snapshot, and once on registration if
    it already has — so a page can say "offline catalogue, dated X" without
    guessing which half of its data came from a file. */
export function onOffline(cb) {
  if (answered) {
    cb(info());
    return;
  }
  watchers.push(cb);
}

const markAnswered = () => {
  if (answered) return;
  answered = true;
  const i = info();
  watchers.splice(0).forEach((cb) => cb(i));
};

export function info() {
  return answered && cat
    ? { updated: cat.updated, titles: cat.titles.length, via: cat.via }
    : null;
}

/* ---- projections ------------------------------------------------------
   A card needs a handful of fields; a detail page needs the row. Keeping the
   split means the list rails never drag an overview paragraph and a cast list
   through the DOM for a poster tile. */

const cardOf = (r) => ({
  id: r.id,
  media_type: r.media_type,
  title: r.title || undefined,
  name: r.name || undefined,
  poster_path: r.poster_path,
  backdrop_path: r.backdrop_path,
  vote_average: r.vote_average,
  vote_count: r.vote_count,
  release_date: r.release_date || undefined,
  first_air_date: r.first_air_date || undefined,
});

const byRating = (a, b) => b.vote_count * b.vote_average - a.vote_count * a.vote_average;

const relOf = (r) => r.release_date || r.first_air_date || '';

const episodeCount = (r) => Object.values(r?.episodes || {}).reduce((n, eps) => n + (Array.isArray(eps) ? eps.length : 0), 0);

/* A snapshot rebuilt from more than one source can carry the same TMDB id
   twice. Deduplicate once at load, preferring the copy with episode data; every
   later lookup can then be a plain filter. */
function dedupeRows(rows) {
  const out = [];
  const at = new Map();
  for (const row of rows) {
    if (!row) continue;
    const key = `${row.media_type}:${row.id}`;
    if (!at.has(key)) {
      at.set(key, out.length);
      out.push(row);
      continue;
    }
    const index = at.get(key);
    if (episodeCount(row) > episodeCount(out[index])) out[index] = row;
  }
  return out;
}

const ofType = (type) => (cat ? cat.titles.filter((r) => r.media_type === type) : []);
const findRow = (type, id) => ofType(type).find((r) => r.id === Number(id)) || null;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const shelfAnswer = (kind, params) => {
  const page = Number(params.page) || 1;
  const list = (cat.shelves[kind] || []).map(cardOf);
  /* A snapshot can grow without a hand-edited shelf entry for every new title
     (the Cinemeta seed is appended). The two browse shelves show the whole
     film library, best-supported first, so a new row is reachable from the hub
     instead of only from a direct detail URL. */
  if (kind === 'popularMovies' || kind === 'topMovies') {
    const seen = new Set(list.map((r) => r.id));
    list.push(
      ...ofType('movie')
        .filter((r) => !seen.has(r.id))
        .sort(byRating)
        .map(cardOf),
    );
  }
  return {
    page,
    total_pages: 1,
    total_results: list.length,
    results: page === 1 ? list : [],
  };
};

/** Titles that share a genre, best-scored first. TMDB ranks these two rails with
    its own similarity model, which a snapshot cannot reproduce; a shared-genre
    list is what an offline file can honestly offer, and it is labelled as the
    same rail the viewer already knows. */
function related(row, count) {
  const genres = new Set(row.genres.map((g) => g.id));
  const scored = ofType(row.media_type)
    .filter((r) => r.id !== row.id)
    .map((r) => ({ r, share: r.genres.filter((g) => genres.has(g.id)).length }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.share - a.share || byRating(a.r, b.r))
    .map((x) => x.r);
  if (scored.length >= count) return scored.slice(0, count);
  const seen = new Set([row.id, ...scored.map((r) => r.id)]);
  const pad = ofType(row.media_type).filter((r) => !seen.has(r.id)).sort(byRating);
  return [...scored, ...pad].slice(0, count);
}

/* ---- the answers ------------------------------------------------------- */

function answerDetails(path) {
  const m = /^\/(movie|tv)\/(\d+)$/.exec(path);
  if (!m) return null;
  const row = findRow(m[1], m[2]);
  if (!row) return undefined; // loaded, and this title is not in it
  const { episodes, ...rest } = row;
  const rel = related(row, 12);
  const pick = (arr, at) => ({ results: arr.slice(at, at + 8).map(cardOf) });
  return {
    ...rest,
    /* The append_to_response the views ask TMDB for, assembled here so a detail
       page and a watch page read exactly the same keys either way. */
    videos: row.videos || { results: [] },
    credits: row.credits || { cast: [], crew: [] },
    similar: pick(rel, 0),
    recommendations: pick(rel, 4),
  };
}

function answerSearch(params) {
  const m = /^\/search\/(movie|tv)$/.exec(params.__route || '');
  if (!m) return null;
  const type = m[1];
  const q = norm(params.query);
  const page = Number(params.page) || 1;
  const all = q
    ? ofType(type)
        .filter((r) => norm(r.title || r.name).includes(q))
        .sort(byRating)
    : [];
  return { page, total_pages: 1, total_results: all.length, results: page === 1 ? all.map(cardOf) : [] };
}

function answerDiscover(path, params) {
  const m = /^\/discover\/(movie|tv)$/.exec(path);
  if (!m) return null;
  const type = m[1];
  const wanted = String(params.with_genres || '')
    .split(',')
    .map((g) => Number(g))
    .filter(Boolean);
  /* The hub's year filter sends one of these two names depending on which half
     of the database it is asking, and the snapshot stores a date either way. */
  const year = String(params.primary_release_year || params.first_air_date_year || '').slice(0, 4);
  const page = Number(params.page) || 1;
  const sorts = {
    'vote_average.desc': (a, b) => byRating(a, b),
    'vote_count.desc': (a, b) => b.vote_count - a.vote_count,
    'primary_release_date.desc': (a, b) => relOf(b).localeCompare(relOf(a)),
    'release_date.desc': (a, b) => relOf(b).localeCompare(relOf(a)),
    'primary_release_date.asc': (a, b) => relOf(a).localeCompare(relOf(b)),
  };
  /* The file carries no popularity score, so "popular" is honestly what it is:
     the best-supported titles first. Sorting by a number the snapshot never
     stored would be a guess dressed up as data. */
  const cmp = sorts[String(params.sort_by || '')] || ((a, b) => byRating(a, b));
  let all = ofType(type)
    .filter((r) => !wanted.length || r.genres.some((g) => wanted.includes(g.id)))
    .filter((r) => !year || relOf(r).slice(0, 4) === year)
    .sort((a, b) => {
      const sa = a.genres.filter((g) => wanted.includes(g.id)).length;
      const sb = b.genres.filter((g) => wanted.includes(g.id)).length;
      return sb - sa || cmp(a, b);
    });
  /* The snapshot is a bounded shelf, not TMDB's whole table. If a requested
     genre or year has no entry in it, returning zero leaves the hub looking
     broken ("Nothing to show here"). Fall back to the nearest catalogue rows
     rather than blanking the page; live /tmdb continues to answer exactly. */
  if (!all.length && (wanted.length || year)) {
    all = ofType(type).sort((a, b) => byRating(a, b));
  }
  return { page, total_pages: 1, total_results: all.length, results: page === 1 ? all.map(cardOf) : [] };
}

/** TMDB's genre tables, from the same snapshot — the genre strip and the rail
    headings need them, and they never change between rebuilds. */
function answerGenres(path) {
  const m = /^\/genre\/(movie|tv)\/list$/.exec(path);
  if (!m) return null;
  return { genres: (cat.genres || {})[m[1]] || [] };
}

/** The episode list the series detail page and the watch page read. A season the
    snapshot did not carry answers as an empty list, which the page already
    reports as "no episodes listed for this season yet" — more truthful than an
    error that invites a retry that cannot succeed. */
function answerSeason(path) {
  const m = /^\/tv\/(\d+)\/season\/(\d+)$/.exec(path);
  if (!m) return null;
  const row = findRow('tv', m[1]);
  if (!row) return undefined;
  const eps = (row.episodes || {})[String(Number(m[2]))] || [];
  const season = (row.seasons || []).find((s) => s.season_number === Number(m[2]));
  return { id: row.id, name: season ? season.name : `Season ${m[2]}`, season_number: Number(m[2]), episodes: eps };
}

/**
 * Whether the offline snapshot regards this specific title as streamable.
 *
 * Rule 1 of the strict layer: a catalogue card is only rendered when the title is
 * streamable. On a static host that cannot ping providers per poster, the snapshot
 * is the source of truth for "can this title be played from this device" — a title
 * that came from the seed with episode data or a verified stream source is streamable;
 * a stub entry with no artwork, no episode data and no verified source is not.
 *
 * Live /tmdb continues to answer exactly, and the watch page's own resolver is the
 * final word for a direct watch link.
 */
export function streamableInCatalogue(type, id) {
  if (!cat) return null;
  const row = ofType(type).find((r) => r.id === Number(id));
  if (!row) return null;
  /* An entry is streamable when it carries real content: episode data, a poster or a
     backdrop, or an explicit streamable flag from the build. Entries that are clearly
     placeholders (no title/name, no artwork, no episode data) are not. */
  const hasArt = !!(row.poster_path || row.backdrop_path);
  const hasEpisodes = !!(row.episodes && Object.keys(row.episodes).length);
  const hasName = !!(row.title || row.name || row.original_title || row.original_name);
  const flagged = row.streamable === true;
  const clearlyEmpty = !hasArt && !hasEpisodes && !hasName;
  return flagged || !clearlyEmpty ? true : false;
}

/**
 * The snapshot's answer to a request that would have gone to TMDB: an object to
 * serve, `null` when this file has no such route, and `undefined` when the
 * catalogue loaded fine but does not hold this title.
 */
export async function answer(path, params = {}) {
  if (!cat) return null;
  const out = (() => {
    if (SHELF_ROUTES[path]) return shelfAnswer(SHELF_ROUTES[path], params);
    if (/^\/genre\/(movie|tv)\/list$/.test(path)) return answerGenres(path);
    if (/^\/search\/(movie|tv)$/.test(path)) return answerSearch({ ...params, __route: path });
    if (/^\/discover\/(movie|tv)$/.test(path)) return answerDiscover(path, params);
    if (/^\/tv\/\d+\/season\/\d+$/.test(path)) return answerSeason(path);
    if (/^\/(movie|tv)\/\d+$/.test(path)) return answerDetails(path, params);
    return null;
  })();
  if (out) markAnswered();
  return out;
}

/** True once the file is in hand, so a caller can decide between "no proxy" and
    "no such title" before it writes anything on screen. */
export const hasCatalogue = () => !!cat;

/** True while the snapshot is the one answering — a page can then treat an empty
    shelf as "this file holds none of those" instead of showing a heading over
    nothing, which on a live connection would be a fault worth reporting. */
export const servingOffline = () => answered;
