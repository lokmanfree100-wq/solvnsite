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
    loading = fetch(SEED_URL, { headers: { Accept: 'application/json' } })
      .then(async (r) => {
        if (!r.ok) return null;
        /* A host that cannot find the snapshot answers 200 with its own 404 or
           index page — which is exactly what a folder of files behind an SPA
           rewrite does — and `r.json()` on that HTML used to reject, empty the
           pool and leave every fallback in the app returning nothing. Read the
           text, and only parse a body that is shaped like JSON. */
        const text = await r.text();
        if (!/^\s*[[{]/.test(text)) return null;
        return JSON.parse(text);
      })
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
  /* The live windows send `isAdult: false` unless mature titles are enabled.
     Absent means "asked for everything", so the snapshot stops only on false. */
  if (vars.isAdult === false && m.isAdult) return false;

  /* The live date-window rails bound on `startDate`, a FuzzyDateInt like
     19630101. A snapshot keeps only the year, which is the part those rails
     actually sort by, so the bound is read down to its year and compared
     against `seasonYear`. */
  const yearOf = (d) => Math.floor(Number(d) / 10000) || 0;
  const from = yearOf(vars.startDateGreater);
  const to = yearOf(vars.startDateLesser);
  if ((from || to) && m.seasonYear) {
    if (from && m.seasonYear < from) return false;
    if (to && m.seasonYear > to) return false;
  }

  const season = seasonParts(vars.season);
  if (season.season && m.season !== season.season) return false;
  const year = vars.seasonYear || vars.year || season.year;
  /* A title the snapshot never gave a year to stays in a year-filtered window.
     Dropping it made the offline catalogue thinner than the live one for no
     reason — the year is unknown, not different. The date-window test above has
     always behaved this way; this bound now matches it. */
  if (year && m.seasonYear && m.seasonYear !== year) return false;

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

/** Mirrors Q_CLASSIC: a filtered, sorted window rather than a paged result. */
export async function classic(vars = {}) {
  const list = await ensure();
  if (!list.length) return null;
  return select(list, { sort: ['POPULARITY_DESC'], perPage: 0, ...vars });
}

/** Mirrors Q_IDS — the curated shelves of the retro hub. */
export async function byIds(ids = []) {
  const list = await ensure();
  if (!list.length) return null;
  const wanted = new Set(ids.map(Number));
  return list.filter((m) => wanted.has(m.id)).sort(SORTERS.POPULARITY_DESC);
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

/**
 * The air calendar, from whatever the snapshot last saw going.
 *
 * `Q_SCHEDULE` is the only rail in the app that has no equivalent browse
 * filter, so the next-airing stamp each title carries is all there is to work
 * with — one row per title, in the shape the live query hands over. It is a
 * stale calendar on an API that is not answering, which beats an empty one.
 */
export async function schedule(from, to) {
  const list = await ensure();
  if (!list.length) return null;
  return list
    .filter((m) => {
      const at = m.nextAiringEpisode?.airingAt || 0;
      return at >= from && at <= to;
    })
    .map((m) => ({
      id: m.id,
      airingAt: m.nextAiringEpisode.airingAt,
      episode: m.nextAiringEpisode.episode || 0,
      timeUntilAiring: Math.max(0, m.nextAiringEpisode.airingAt - stamp / 1000),
      media: m,
    }))
    .sort((a, b) => a.airingAt - b.airingAt);
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
