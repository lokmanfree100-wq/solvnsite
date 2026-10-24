/**
 * AniList GraphQL client.
 * - same-origin proxy first (a direct fetch hides the reason behind CORS), and
 *   skipped entirely on a static host, which has no `/api` to relay through
 * - two-tier cache (memory + localStorage) so repeat navigations feel instant
 * - single-flight dedupe for identical in-flight queries
 * - one retry on 429/5xx using the server's Retry-After hint
 * - when the API refuses us: yesterday's copy, then the bundled snapshot
 */

import * as seed from './seed.js';
import { staticHost } from './account.js';

const ENDPOINT = 'https://graphql.anilist.co';
const PROXY = '/api/anilist';
const MEM_TTL = 5 * 60 * 1000;
const DISK_TTL = 60 * 60 * 1000;
/* How long we stop knocking while the API is refusing us. */
const OUTAGE_BACKOFF = 5 * 60 * 1000;
/* A blocked request tells us less than a 403 body, so probe again sooner. */
const BLOCK_BACKOFF = 60 * 1000;
const RECOVERY_PROBE = 5 * 60 * 1000;
/* AniList outages run for days. A copy from last week beats an empty screen —
   but not a copy from last season, so stale still has a floor. */
const STALE_MAX = 30 * 24 * 60 * 60 * 1000;
const DISK_PREFIX = 'kitsune:anilist:';
const DISK_MAX = 140;

const mem = new Map();
const inflight = new Map();

let outageUntil = 0;
let outageNote = '';
let recoveryTimer = 0;

/* AniList disables its API in one line; a request that never lands says only
   "network". Both mean the same thing to us: stop knocking for a while. */
const DISABLED = /temporarily disabled|severe stability/i;
const RECOVERY = '{ Page(perPage: 1) { id } }';

/** The reason we are being refused, plus how long to wait before asking again. */
function outageFor(err) {
  const m = String(err?.message || '');
  if (DISABLED.test(m)) return { note: 'The catalogue is temporarily down.', backoff: OUTAGE_BACKOFF };
  if (/^HTTP 403$|^(network|rate-limited|server)$|unreachable|timed out/i.test(m))
    return { note: 'The catalogue is unreachable.', backoff: BLOCK_BACKOFF };
  return null;
}

/* Going quiet is silent: saved copies keep the page full, so no event is
   dispatched and no view is interrupted. Only recovery announces itself. */
function markOutage(message, backoff) {
  outageUntil = Date.now() + backoff;
  outageNote = message;
  armRecovery(backoff);
}

function markLive() {
  clearTimeout(recoveryTimer);
  recoveryTimer = 0;
  snapshotUsed = false;
  if (!outageNote) return;
  outageUntil = 0;
  outageNote = '';
  document.dispatchEvent(new CustomEvent('kitsune:api', { detail: { down: false } }));
}

/**
 * An outage that lasts until the viewer refreshes by hand is a bad outage.
 * After the backoff, one cheap query decides whether AniList is serving again.
 */
function armRecovery(backoff) {
  if (recoveryTimer || typeof setTimeout !== 'function') return;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = 0;
    if (document.hidden) return;
    outageUntil = 0;
    rawRequest(RECOVERY, {}).then(markLive).catch(() => {
      const o = outageFor(new Error('network'));
      if (o) markOutage(o.note, RECOVERY_PROBE);
    });
  }, Math.max(backoff, 15000));
}

/** True while AniList is refusing requests and calls are short-circuited. */
export const apiDown = () => Date.now() < outageUntil;

/**
 * One quiet line for Settings, which is the only place the data source is ever
 * mentioned now that no banner interrupts the page. Labels are i18n keys.
 */
export function apiStatus() {
  if (apiDown() || snapshotUsed)
    return { tone: 'saved', label: 'Saved data', hint: 'The catalogue is not answering, so rows come from this device.' };
  return { tone: 'live', label: 'Live data', hint: 'Rows are fetched live, then cached here.' };
}

/** Settings' "Check now": drop the backoff, knock once, and report honestly. */
export async function checkNow() {
  retryNow();
  try {
    await rawRequest(RECOVERY, {});
    markLive();
    return true;
  } catch (err) {
    const o = outageFor(err) || { note: 'The catalogue is unreachable.', backoff: BLOCK_BACKOFF };
    markOutage(o.note, o.backoff);
    return false;
  }
}

/** Forget the backoff and knock again — what "Try again" and a refocus do. */
export function retryNow() {
  outageUntil = 0;
  clearTimeout(recoveryTimer);
  recoveryTimer = 0;
}


function diskPeek(key) {
  try {
    const raw = localStorage.getItem(DISK_PREFIX + key);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return rec && typeof rec.t === 'number' ? rec : null;
  } catch {
    return null;
  }
}

function diskWrite(key, value) {
  let keys;
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(DISK_PREFIX));
    if (keys.length > DISK_MAX) {
      keys
        .slice(0, keys.length - DISK_MAX)
        .forEach((k) => localStorage.removeItem(k));
    }
    localStorage.setItem(DISK_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    /* quota — memory cache still serves this session */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * AniList rejects explicit nulls for comparison operators
 * (`averageScore_greater: null` → "Illegal operator and value combination"),
 * so unset filters must be absent rather than null.
 */
export function prune(vars) {
  const out = {};
  for (const [k, v] of Object.entries(vars)) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Disk keys must identify the *variables*, not just the query text.
 * Slicing the raw key would collide because every rail shares an identical
 * ~700-char query prefix, so all rows would serve the first result.
 */
function diskKey(raw) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}${raw.length.toString(36)}`;
}

/* Three states: null = never probed, true = same-origin relay answering,
   false = static host with no /api route. Remembering the verdict keeps a
   static deploy from paying for a dead POST on every single rail. */
let proxyUsable = null;

async function proxyPost(query, variables) {
  /* A folder of files on a plain host has no `/api` at all, and its 404 page is
     an HTML document — so the relay is not even knocked on here. AniList answers
     cross-origin requests itself, which is why the static build needs no
     server for search, rails, details or the player. */
  if (staticHost()) {
    proxyUsable = false;
    return null;
  }
  if (proxyUsable === false) return null;
  try {
    const res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    /* Anything that is not JSON (a 404 page from a static host) is not the relay. */
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      proxyUsable = false;
      return null;
    }
    proxyUsable = true;
    return res;
  } catch {
    proxyUsable = false;
    return null;
  }
}

async function send(query, variables) {
  /* The proxy is tried first: same-origin means the body survives, so a 403
     from AniList reads as "API temporarily disabled" instead of a CORS wall. */
  const res =
    (await proxyPost(query, variables)) ||
    (await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    }));

  if (res.status === 429 || res.status >= 500) {
    const err = new Error(res.status === 429 ? 'rate-limited' : 'server');
    err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
    throw err;
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) throw new Error(body?.errors?.[0]?.message || `HTTP ${res.status}`);
  return body.data;
}

async function rawRequest(query, variables) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await send(query, variables);
    } catch (err) {
      const message = String(err?.message || '');
      const retryable = message === 'rate-limited' || message === 'server' || err instanceof TypeError;
      lastError = err;
      if (!retryable || attempt === 2) break;
      await sleep(Math.min(err?.retryAfter || 1, 8) * 1000);
    }
  }
  /* A fetch that never lands reports only "Failed to fetch". Normalise it so
     the outage breaker can tell a dead network from one of our own bad
     queries, which must never trip the breaker. */
  if (lastError instanceof TypeError) throw new Error('network', { cause: lastError });
  throw lastError;
}

export async function gql(query, variables = {}) {
  const key = JSON.stringify([query, variables]);
  const dk = diskKey(key);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < MEM_TTL) return hit.v;

  const rec = diskPeek(dk);
  if (rec && Date.now() - rec.t < DISK_TTL) {
    mem.set(key, { t: Date.now(), v: rec.v });
    return rec.v;
  }
  if (inflight.has(key)) return inflight.get(key);

  const stale = rec && Date.now() - rec.t < STALE_MAX ? rec.v : null;

  // While the API is refusing us, don't re-probe on every view: answer from
  // whatever we saved, or fail fast so the view can fall back or retry.
  if (Date.now() < outageUntil) {
    if (stale) return stale;
    throw new Error(outageNote || 'The catalogue is temporarily unavailable');
  }

  const p = rawRequest(query, variables)
    .then((data) => {
      mem.set(key, { t: Date.now(), v: data });
      diskWrite(dk, data);
      markLive();
      return data;
    })
    .catch((err) => {
      // Blocked, rate limited or outright refused: hold off on further probes
      // and answer from the disk copy if there is one.
      const outage = outageFor(err);
      if (outage) markOutage(outage.note, outage.backoff);
      if (stale) return stale;
      throw err;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p;
}

/*
 * Last resort for a device that has nothing saved: the snapshot shipped with
 * the app. Nothing is announced when it answers — a page full of watchable
 * titles is its own notification, and Settings says where the rows came from.
 */
let snapshotUsed = false;

async function orSnapshot(err, lookup) {
  if (!apiDown() && !outageFor(err)) throw err;
  const found = await lookup();
  if (!found) throw err;
  snapshotUsed = true;
  return found;
}

export function clearCache() {
  mem.clear();
  Object.keys(localStorage)
    .filter((k) => k.startsWith(DISK_PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

/* ------------------------------------------------------------------ */

/*
 * `extraLarge` is the largest cover tier the API publishes and `bannerImage`
 * arrives at its own full width, so every big slot in the app — hero stage,
 * detail banner, feature lead, split art — can bind straight to the largest
 * source without a second round-trip. `large` rides along as the rung the
 * <img> ladder falls back to, since a single tier is frequently missing.
 */
const MEDIA = /* GraphQL */ `
  fragment MediaFields on Media {
    id
    idMal
    title { romaji english native }
    format
    type
    status(version: 2)
    episodes
    duration
    season
    seasonYear
    averageScore
    popularity
    favourites
    genres
    synonyms
    coverImage { extraLarge large color }
    bannerImage
    description
    countryOfOrigin
    isAdult
    isFavourite
    nextAiringEpisode { episode airingAt timeUntilAiring }
    studios(isMain: true) { nodes { id name } }
  }
`;

/* Spotlight slates: finished or airing, above a popularity floor, so only
   heavyweights reach the banner. Ranges are literals because AniList rejects
   comparison arguments bound to a null variable. */
export const Q_SPOTLIGHT = /* GraphQL */ `
  ${MEDIA}
  query ($perPage: Int, $sort: [MediaSort]!) {
    Page(perPage: $perPage) {
      media(type: ANIME, sort: $sort, status_in: [FINISHED, RELEASING],
            countryOfOrigin: JP, isAdult: false, popularity_greater: 40000) {
        ...MediaFields
      }
    }
  }
`;

export const Q_SPOTLIGHT_MODERN = /* GraphQL */ `
  ${MEDIA}
  query ($perPage: Int) {
    Page(perPage: $perPage) {
      media(type: ANIME, sort: [POPULARITY_DESC], status_in: [FINISHED, RELEASING],
            startDate_greater: 20190101, countryOfOrigin: JP, isAdult: false,
            popularity_greater: 40000) {
        ...MediaFields
      }
    }
  }
`;

export const Q_GENRE_ROW = /* GraphQL */ `
  ${MEDIA}
  query ($genre: String!, $perPage: Int) {
    Page(perPage: $perPage) {
      media(genre: $genre, type: ANIME, sort: [POPULARITY_DESC], countryOfOrigin: JP, isAdult: false) {
        ...MediaFields
      }
    }
  }
`;

export const Q_DETAIL = /* GraphQL */ `
  ${MEDIA}
  query ($id: Int) {
    Media(id: $id) {
      ...MediaFields
      relations {
        edges { relationType(version: 2) node { id title { romaji english } format coverImage { large extraLarge } seasonYear status } }
      }
      recommendations(sort: RATING_DESC, perPage: 12) {
        nodes { rating mediaRecommendation { id title { romaji english } format coverImage { large extraLarge } averageScore seasonYear } }
      }
      characters(perPage: 8, sort: ROLE_DESC) {
        nodes { id name { full } image { large } }
      }
      staff(perPage: 4, sort: RELEVANCE) {
        nodes { id name { full } image { large } }
      }
      streamingEpisodes { title thumbnail url site }
      externalLinks { id url color icon site }
    }
  }
`;

export const Q_EPISODES = /* GraphQL */ `
  query ($id: Int) {
    Media(id: $id) {
      id
      episodes
      status
      nextAiringEpisode { episode }
      streamingEpisodes { title thumbnail url site }
    }
  }
`;

export const Q_SEARCH = /* GraphQL */ `
  ${MEDIA}
  query ($search: String!, $perPage: Int, $page: Int, $sort: [MediaSort]) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total hasNextPage currentPage lastPage }
      media(search: $search, type: ANIME, sort: $sort, countryOfOrigin: JP, isAdult: false) {
        ...MediaFields
      }
    }
  }
`;

export const Q_BROWSE = /* GraphQL */ `
  ${MEDIA}
  query ($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $genre: String,
        $format: MediaFormat, $status: MediaStatus, $season: MediaSeason,
        $seasonYear: Int, $minimumScore: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total hasNextPage currentPage lastPage perPage }
      media(type: ANIME, sort: $sort, search: $search, genre: $genre,
            format: $format, status: $status, season: $season, seasonYear: $seasonYear,
            averageScore_greater: $minimumScore, countryOfOrigin: JP, isAdult: false) {
        ...MediaFields
      }
    }
  }
`;

export const Q_SCHEDULE = /* GraphQL */ `
  ${MEDIA}
  query ($from: Int, $to: Int) {
    Page(perPage: 50) {
      airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
        id
        airingAt
        episode
        timeUntilAiring
        media { ...MediaFields }
      }
    }
  }
`;

export const Q_GENRES = /* GraphQL */ `
  { GenreCollection }
`;

/* Random pick. The score floor is a literal because AniList rejects a
   comparison argument bound to a null variable. Paging uses a stable
   popularity sort — RANDOM re-shuffles per request, so page N would not
   belong to the same ordering as page 1. A page size of 1 is also legal,
   which makes the same query cheap enough to use for the page count. */
export const Q_RANDOM = /* GraphQL */ `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { lastPage }
      media(type: ANIME, sort: [POPULARITY_DESC], status_in: [FINISHED, RELEASING],
            averageScore_greater: 70, popularity_greater: 1000,
            countryOfOrigin: JP, isAdult: false) {
        id
        title { romaji english }
        coverImage { large }
        averageScore
        format
        seasonYear
      }
    }
  }
`;

/* The ranking: highest-rated Japanese TV first. AniList sorts a bare
   SCORE_DESC with unrated entries at the top of the tie block, so a status
   floor keeps upcoming titles out of a list that is about what people scored. */
export const Q_RANKED = /* GraphQL */ `
  ${MEDIA}
  query ($page: Int!) {
    Page(page: $page, perPage: 50) {
      pageInfo { total lastPage }
      media(type: ANIME, sort: SCORE_DESC, status_in: [FINISHED, RELEASING],
            countryOfOrigin: JP, isAdult: false) {
        ...MediaFields
      }
    }
  }
`;

/* Hidden gems: well rated but never seen by the masses. Every bound is a
   literal because AniList rejects a comparison argument bound to a null
   variable, and this query is only ever called with no variables at all. */
export const Q_HIDDEN = /* GraphQL */ `
  ${MEDIA}
  query {
    Page(perPage: 16) {
      media(type: ANIME, sort: [SCORE_DESC, POPULARITY_DESC], status_in: [FINISHED, RELEASING],
            averageScore_greater: 72, averageScore_lesser: 89,
            popularity_greater: 1200, popularity_lesser: 60000,
            countryOfOrigin: JP, isAdult: false) {
        ...MediaFields
      }
    }
  }
`;

/* ------------------------------------------------------------------ */
/* High level calls                                                    */

/** Round-robin several ranked lists into one slate, de-duplicating by id. */
function weave(lists, weights = lists.map(() => 1)) {
  const out = [];
  const seen = new Set();
  const cursors = lists.map(() => 0);
  for (;;) {
    let moved = false;
    lists.forEach((list, k) => {
      for (let n = 0; n < weights[k]; n++) {
        const m = list[cursors[k]++];
        if (!m) continue;
        moved = true;
        if (!seen.has(m.id)) {
          seen.add(m.id);
          out.push(m);
        }
      }
    });
    if (!moved) return out;
  }
}

/**
 * The spotlight slate: AniList's most-popular and most-favoured anime of all
 * time, with the modern blockbusters woven in at roughly one slot in three, so
 * the banner carries giants rather than whichever show trends this week.
 */
export async function spotlight(perPage = 25) {
  const settled = await Promise.allSettled([
    gql(Q_SPOTLIGHT, { perPage, sort: ['POPULARITY_DESC'] }),
    gql(Q_SPOTLIGHT, { perPage, sort: ['FAVOURITES_DESC'] }),
    gql(Q_SPOTLIGHT_MODERN, { perPage: 16 }),
  ]);
  const [pop, fav, modern] = settled.map((r) => (r.status === 'fulfilled' ? (r.value?.Page?.media ?? []) : []));
  if (pop.length || fav.length || modern.length) {
    const allTime = weave([pop, fav]);
    return weave([allTime, modern], [2, 1]);
  }
  const saved = await seed.spotlight(perPage);
  if (!saved?.length) throw new Error('spotlight unavailable');
  snapshotUsed = true;
  return saved;
}

export function browse(vars) {
  const full = prune(vars);
  return gql(Q_BROWSE, full)
    .then((d) => ({ items: d?.Page?.media ?? [], info: d?.Page?.pageInfo ?? {} }))
    .catch((err) => orSnapshot(err, () => seed.browse(full)));
}

/** Titles rated well by few people — the literal bounds are the filter. */
export function hiddenGems() {
  return gql(Q_HIDDEN, {})
    .then((d) => d?.Page?.media ?? [])
    .catch((err) => orSnapshot(err, () => seed.hiddenGems()));
}

/**
 * The hundred best-rated anime, two pages deep. No snapshot fallback: a ranked
 * list built from a stale sample would be a different list, so the caller shows
 * a retry instead of inventing positions.
 */
export async function top100() {
  const pages = await Promise.all([gql(Q_RANKED, { page: 1 }), gql(Q_RANKED, { page: 2 })]);
  const items = pages.flatMap((d) => d?.Page?.media ?? []).filter((m) => m?.id);
  if (items.length < 50) throw new Error('The ranking is not answering.');
  return items
    .sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0) || (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 100);
}

export function search(q, vars = {}) {
  const full = prune({ search: q, perPage: 24, page: 1, sort: ['SEARCH_MATCH'], ...vars });
  return gql(Q_SEARCH, full)
    .then((d) => ({ items: d?.Page?.media ?? [], info: d?.Page?.pageInfo ?? {} }))
    .catch((err) => orSnapshot(err, () => seed.search(q, full)));
}

export function detail(id) {
  return gql(Q_DETAIL, { id })
    .then((d) => d?.Media ?? null)
    .catch((err) => orSnapshot(err, () => seed.detail(id)));
}

export function episodes(id) {
  return gql(Q_EPISODES, { id })
    .then((d) => d?.Media ?? null)
    .catch((err) => orSnapshot(err, () => seed.episodes(id)));
}

export function schedule(from, to) {
  return gql(Q_SCHEDULE, { from, to }).then((d) =>
    (d?.Page?.airingSchedules ?? []).filter((s) => s.media),
  );
}

/**
 * The whole window, not just its first page. AniList answers one page per call
 * and a busy stretch holds several pages, so the range is walked in spans and
 * stitched together — otherwise "this week" quietly becomes "this Monday".
 * A span that fails is skipped; a partial schedule beats an empty screen.
 */
const SPAN = 3 * 86400;

export async function scheduleRange(from, to) {
  const spans = [];
  for (let start = from; start < to && spans.length < 20; start += SPAN) {
    spans.push([start, Math.min(to, start + SPAN)]);
  }
  const settled = await Promise.allSettled(spans.map(([a, b]) => schedule(a, b)));
  const seen = new Set();
  const out = [];
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    for (const s of r.value) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  if (!out.length && settled.every((r) => r.status === 'rejected')) throw new Error('The schedule is not answering.');
  return out.sort((a, b) => a.airingAt - b.airingAt);
}

/** AniList's collection includes adult-only genre labels we never surface. */
const HIDDEN_GENRES = new Set(['Hentai']);

export async function genres() {
  try {
    const d = await gql(Q_GENRES, {});
    return (d?.GenreCollection ?? []).filter(Boolean).filter((g) => !HIDDEN_GENRES.has(g));
  } catch {
    return DEFAULT_GENRES;
  }
}

export const DEFAULT_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror', 'Mahou Shoujo',
  'Mecha', 'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life',
  'Sports', 'Supernatural', 'Thriller',
];

/** Two identical rolls in a row feel broken even though they're valid. */
let lastRandomId = 0;

async function randomPage(page, perPage) {
  const d = await gql(Q_RANDOM, { page, perPage });
  return {
    lastPage: d?.Page?.pageInfo?.lastPage || 1,
    items: (d?.Page?.media ?? []).filter((m) => m?.id && m.averageScore >= 70),
  };
}

/**
 * Surprise pick: a random anime rated 7.0 or better. AniList has no random
 * endpoint, so we roll a page inside the filtered set and then a title inside
 * that page, which spreads results far wider than shuffling the top 50.
 */
export async function randomAnime() {
  try {
    // lastPage is perPage-dependent, so read it from a page of the same size we
    // intend to roll; a count taken at perPage 1 would point far past the end.
    const { lastPage } = await randomPage(1, 50);
    const roll = () => 1 + Math.floor(Math.random() * lastPage);

    for (let attempt = 0; attempt < 3; attempt++) {
      const { items } = await randomPage(roll(), 50);
      if (!items.length) continue;
      const pick = items[Math.floor(Math.random() * items.length)];
      if (pick.id !== lastRandomId || attempt === 2) {
        lastRandomId = pick.id;
        return pick;
      }
    }
    throw new Error('no random anime available');
  } catch (err) {
    const pick = await orSnapshot(err, () => seed.random());
    lastRandomId = pick.id;
    return pick;
  }
}

