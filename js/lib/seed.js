/**
 * Offline snapshot.
 *
 * AniList switches its API off for days at a time, and a phone that has never
 * opened Solvn has nothing cached, so home would be an empty shell. The build
 * ships one saved catalogue (`public/data/seed.json`) and this module answers
 * the same calls from it — only after both the network and the local cache have
 * failed, so live data always wins.
 */

/* Resolved against the page rather than the host root, so a copy of Solvn in a
   subfolder still finds its own snapshot. */
const SEED_URL = new URL('data/seed.json', document.baseURI).href;

let pool = null;
let loading = null;
let stamp = 0;

async function ensure() {
  if (pool && pool.length) return pool;
  if (!loading) {
    loading = fetch(SEED_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((doc) => {
        pool = Array.isArray(doc?.media) ? doc.media : [];
        stamp = Number(doc?.savedAt) || 0;
        if (!pool.length) loading = null;
        return pool;
      })
      .catch(() => {
        /* A snapshot that never loaded is worth another try later. */
        loading = null;
        pool = [];
        return pool;
      });
  }
  return loading;
}

const title = (m) => m.title?.romaji || m.title?.english || m.title?.native || '';
const first = (sort) => (Array.isArray(sort) ? sort[0] : sort);

/** Popularity stands in for trend — a snapshot cannot know this week's numbers. */
const SORTERS = {
  POPULARITY_DESC: (a, b) => (b.popularity || 0) - (a.popularity || 0),
  TRENDING_DESC: (a, b) => (b.popularity || 0) - (a.popularity || 0),
  SEARCH_MATCH: (a, b) => (b.popularity || 0) - (a.popularity || 0),
  FAVOURITES_DESC: (a, b) => (b.favourites || 0) - (a.favourites || 0),
  SCORE_DESC: (a, b) => (b.averageScore || 0) - (a.averageScore || 0),
  RATING_DESC: (a, b) => (b.averageScore || 0) - (a.averageScore || 0),
  EPISODES_DESC: (a, b) => (b.episodes || 0) - (a.episodes || 0),
  RELEASE_DATE_DESC: (a, b) => (b.seasonYear || 0) - (a.seasonYear || 0) || (b.popularity || 0) - (a.popularity || 0),
  START_DATE_DESC: (a, b) => (b.seasonYear || 0) - (a.seasonYear || 0) || (b.popularity || 0) - (a.popularity || 0),
  TITLE_ROMAJI: (a, b) => title(a).localeCompare(title(b)),
};

/** `FALL_2026` and a bare `FALL` both arrive here depending on the caller. */
function seasonParts(value) {
  const [season, year] = String(value || '').split('_');
  return { season: season || '', year: Number(year) || 0 };
}

function matches(m, vars) {
  if (vars.format && m.format !== vars.format) return false;
  if (vars.status && m.status !== vars.status) return false;
  if (Array.isArray(vars.status_in) && !vars.status_in.includes(m.status)) return false;
  if (vars.minimumScore && (m.averageScore || 0) < vars.minimumScore) return false;
  if (vars.genre && !(m.genres || []).includes(vars.genre)) return false;

  const season = seasonParts(vars.season);
  if (season.season && m.season !== season.season) return false;
  const year = vars.seasonYear || vars.year || season.year;
  if (year && m.seasonYear !== year) return false;

  const q = String(vars.search || '').trim().toLowerCase();
  if (q) {
    const hay = [title(m), m.title?.english, ...(m.synonyms || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function select(list, vars) {
  const sort = SORTERS[first(vars.sort)] || SORTERS.POPULARITY_DESC;
  const found = list.filter((m) => matches(m, vars)).sort(sort);
  const perPage = Number(vars.perPage) || 0;
  if (!perPage) return found;
  const page = Math.max(Number(vars.page) || 1, 1);
  return found.slice((page - 1) * perPage, page * perPage);
}

export async function browse(vars) {
  const list = await ensure();
  if (!list.length) return null;
  const items = select(list, vars);
  return { items, info: { total: items.length, hasNextPage: false, currentPage: 1, lastPage: 1, perPage: items.length } };
}

export async function search(query, vars = {}) {
  const list = await ensure();
  if (!list.length) return null;
  const out = browse({ ...vars, search: query });
  return out;
}

/* Mirrors Q_HIDDEN, whose bounds are literals in the query text. */
export async function hiddenGems() {
  const list = await ensure();
  if (!list.length) return null;
  return list
    .filter(
      (m) =>
        (m.status === 'FINISHED' || m.status === 'RELEASING') &&
        (m.averageScore || 0) >= 72 &&
        (m.averageScore || 0) < 89 &&
        (m.popularity || 0) > 1200 &&
        (m.popularity || 0) < 60000,
    )
    .sort(SORTERS.SCORE_DESC);
}

/** The banner slate: the biggest titles the snapshot holds. */
export async function spotlight(perPage = 25) {
  const list = await ensure();
  if (!list.length) return null;
  return select(list, { sort: ['POPULARITY_DESC'], perPage });
}

export async function detail(id) {
  const list = await ensure();
  if (!list.length) return null;
  return list.find((m) => m.id === Number(id)) || null;
}

export async function episodes(id) {
  const found = await detail(id);
  return found || null;
}

/** Surprise pick from the snapshot, same score floor as the live query. */
export async function random() {
  const list = await ensure();
  if (!list.length) return null;
  const ok = list.filter((m) => (m.averageScore || 0) >= 70);
  if (!ok.length) return null;
  return ok[Math.floor(Math.random() * ok.length)];
}

export const savedOn = () => stamp;
