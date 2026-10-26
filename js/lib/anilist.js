/**
 * AniList GraphQL client.
 * - same-origin proxy first (a direct fetch hides the reason behind CORS), and
 *   skipped entirely on a static host, which has no `/api` to relay through
 * - two-tier cache (memory + localStorage) so repeat navigations feel instant
 * - a stale copy paints immediately and the live answer replaces it in the cache,
 *   so a slow API is never a page of error panels
 * - a queue: a page of sixteen rails asks politely instead of all at once
 * - a clock on every leg, so a request that never answers cannot park a queue
 *   slot and leave a rail under a skeleton for the rest of the afternoon
 * - retries 429/5xx with the server's Retry-After hint, and only a genuine
 *   shutdown or a dead network stops us knocking for a while
 * - when the API refuses us: yesterday's copy, then the bundled snapshot
 * - when it answers with *nothing* (a half-response with no `Page` node), the
 *   snapshot too — a blank shelf and an empty one are not the same event
 */

import * as seed from './seed.js';
import { staticHost } from './account.js';
/* A leaf module — nothing in it imports the data layer, so reading a setting
   here cannot close a cycle. */
import { settings } from './store.js';

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
/* One background revalidation per key: a page with sixteen visible rails must
   not turn every paint into a second request for the same rail. */
const revalidating = new Set();

let outageUntil = 0;
let outageNote = '';
let recoveryTimer = 0;

/* AniList disables its API in one line; a request that never lands says only
   "network". Both mean the same thing to us: stop knocking for a while. */
const DISABLED = /temporarily disabled|severe stability/i;
const RECOVERY = '{ Page(perPage: 1) { id } }';

/**
 * The reason we are being refused, plus how long to wait before asking again.
 *
 * A 429 or a 502 is *not* in here. Those are the API telling us to slow down, or
 * one request tumbling over on its way through a CDN, and both are answered by
 * the retry in `rawRequest`. Treating them as an outage is what turned a single
 * rate-limited rail into every rail on the page saying "could not reach the
 * catalogue" for the next minute — the breaker must only ever fire when the API
 * has actually closed its doors, or when nothing on this device can reach it.
 */
function outageFor(err) {
  const m = String(err?.message || '');
  if (DISABLED.test(m)) return { note: 'The catalogue is temporarily down.', backoff: OUTAGE_BACKOFF };
  if (/^HTTP 403$|^(network)$|unreachable|timed out/i.test(m))
    return { note: 'The catalogue is unreachable.', backoff: BLOCK_BACKOFF };
  return null;
}

/** Did the catalogue itself fail to hand over an answer? (Seed fallback.) */
function refused(err) {
  if (apiDown()) return true;
  const m = String(err?.message || '');
  return /^(HTTP 403|network|rate-limited|server)$|unreachable|timed out|temporarily disabled/i.test(m);
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

/* ---- the clocks -------------------------------------------------------
   A fetch has no deadline of its own: a socket that hangs at the far end hangs
   here too, and a hung request does not just lose a rail — it holds one of four
   queue slots, so the fifteen rows behind it hang with it. Two timers, one
   narrow and one wide:
   LEG_TIMEOUT bounds a single HTTP call (relay or direct, headers and body),
   JOB_BUDGET bounds the whole job once it is dequeued and hands its slot back. */
const LEG_TIMEOUT = 8000;
const JOB_BUDGET = 12000;
/* The other clock, measured from the moment a view asked rather than from the
   moment the queue got round to it. On a congested page the wait can outlast the
   work, and a rail that is told to give up *before* it starts costs nobody a
   slot — it just stops the page hanging on a request that would have been the
   twenty-third of its second.

   QUEUE + JOB is the worst case a view can be made to wait, and it is the
   number `watched()` in util.js has to sit outside of: a rail that gives up
   first throws away the saved copy sitting two lines below the request. */
const QUEUE_BUDGET = 6000;

/* Old engines have no AbortSignal.timeout; a request without a signal is still
   bounded by the job budget, so this degrades rather than breaks. */
const legSignal = () =>
  typeof AbortSignal === 'function' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(LEG_TIMEOUT)
    : undefined;

/** Did a clock stop this, rather than the other end answering? */
const stopped = (err) =>
  err?.name === 'AbortError' ||
  err?.name === 'TimeoutError' ||
  /timed out|aborted/i.test(String(err?.message || ''));

/**
 * Wait for `task` for `ms` and then stop listening.
 *
 * The rejection is the message every fallback already understands — `refused()`
 * reads `timed out` as a dead network, so the view answers from the snapshot
 * instead of spinning. `task` is called with a predicate it can consult between
 * retries, which is what gives the queue slot back early instead of after the
 * third hanging attempt.
 */
function withBudget(task, ms) {
  let expired = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('timed out'));
    }, ms);
    const over = () => expired;
    const settle = (fn) => (value) => {
      clearTimeout(timer);
      fn(value);
    };
    Promise.resolve().then(() => task(over)).then(settle(resolve), settle(reject));
  });
}

/* ---- the queue --------------------------------------------------------
   AniList is a public API shared by every app on the internet, and it answers
   roughly thirty requests in ten seconds. The retro hub alone opens with
   sixteen rails, the home page with a dozen more, and a browser fires what it
   is handed the moment it is handed it. That burst is where "Could not reach
   the catalogue" comes from: not a dead API, our own good afternoon of requests
   arriving inside the same second.
   So nothing leaves this module directly. A handful go at a time, spaced, and
   the rest wait their turn — which costs a page a second of fill time and saves
   it from the minute of refused requests a burst buys. */
const MAX_PARALLEL = 4;
const SPACING_MS = 240;

const waiting = [];
let running = 0;
let lastOut = 0;
let pumpTimer = 0;

function pump() {
  pumpTimer = 0;
  while (waiting.length && running < MAX_PARALLEL) {
    const gap = SPACING_MS - (Date.now() - lastOut);
    if (gap > 0) {
      clearTimeout(pumpTimer);
      pumpTimer = setTimeout(pump, gap);
      return;
    }
    const job = waiting.shift();
    running += 1;
    lastOut = Date.now();
    /* `task` is a *thunk*, not a promise: calling it here is what puts the
       request on the wire. Reading it as a promise (`job.task.then(...)`) threw
       before a byte was asked for, and because the throw happened after the
       slot was taken, the slot was never handed back — four requests in and the
       queue jammed for the rest of the session, which is what an "infinite
       Loading…" page actually is. */
    let started;
    try {
      started = Promise.resolve(job.task());
    } catch (err) {
      started = Promise.reject(err);
    }
    started
      .then(job.resolve, job.reject)
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/**
 * Ask for `task` in turn, and stop waiting if our turn never comes.
 *
 * `JOB_BUDGET` only starts once a slot opens, so on a congested page a job can
 * sit in `waiting` far longer than it would take to run. This clock starts at
 * the ask: a job still queued when it expires is removed from the line and
 * rejected with the timeout message, which costs no slot and hands the view its
 * saved copy. Once a job has left `waiting` there is nothing to cancel — the
 * request is already on the wire and `JOB_BUDGET` owns it from there.
 */
function queued(task) {
  return new Promise((resolve, reject) => {
    const job = { task: () => withBudget(task, JOB_BUDGET), resolve, reject };
    const timer = setTimeout(() => {
      const at = waiting.indexOf(job);
      if (at < 0) return;
      waiting.splice(at, 1);
      reject(new Error('timed out'));
    }, QUEUE_BUDGET);
    job.resolve = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    job.reject = (err) => {
      clearTimeout(timer);
      reject(err);
    };
    waiting.push(job);
    pump();
  });
}

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
 * The maturity bound for the three whole-catalogue windows.
 *
 * `prune()` drops the `undefined` when the setting is on, which leaves the
 * argument out of the request and the R+ rows in the answer — the views then
 * decide what to paint. Because the disk key hashes the variables, flipping the
 * setting cannot serve a rail cached under the other value.
 */
const maturity = (vars = {}) => ({ isAdult: settings.get('showNsfw') ? undefined : false, ...vars });

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
      signal: legSignal(),
    });
    /* Anything that is not JSON (a 404 page from a static host) is not the relay. */
    if (!(res.headers.get('content-type') || '').includes('application/json')) {
      proxyUsable = false;
      return null;
    }
    proxyUsable = true;
    return res;
  } catch (err) {
    /* A relay that ran out of time says nothing about whether the relay *is* —
       a busy server is still the server. Retiring it here would push every
       following rail onto a direct call whose failure CORS hides from us, so a
       timeout is reported as what it is and the verdict stays unmade. */
    if (stopped(err)) throw new Error('timed out', { cause: err });
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
      signal: legSignal(),
    }));

  if (res.status === 429 || res.status >= 500) {
    const err = new Error(res.status === 429 ? 'rate-limited' : 'server');
    err.retryAfter = Number(res.headers.get('Retry-After')) || 0;
    throw err;
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || body?.errors?.length) throw new Error(body?.errors?.[0]?.message || `HTTP ${res.status}`);
  /* 200 with no parsable body is a truncated answer, not an empty one — and a
     `body.data` read on `null` would surface as a TypeError, which the retry
     loop below would happily pay for three times. */
  if (!body || typeof body !== 'object') throw new Error('network');
  return body.data;
}

/* A rate limit says "again in a second", a 5xx says "again, probably". Both are
   worth three tries with the wait the API asked for; none of them is an outage,
   which is why the breaker is not consulted down here. */
const ATTEMPTS = 3;

/**
 * `dead` is the queue's budget: once it is true, another attempt is pointless
 * because nobody is waiting for the answer any more, and holding the slot while
 * we ask anyway is how one slow rail stalls fifteen.
 */
async function rawRequest(query, variables, dead) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (dead?.()) {
      lastError = lastError || new Error('timed out');
      break;
    }
    try {
      return await send(query, variables);
    } catch (err) {
      const message = String(err?.message || '');
      const retryable = message === 'rate-limited' || message === 'server' || err instanceof TypeError;
      lastError = err;
      if (!retryable || attempt === ATTEMPTS) break;
      await sleep(Math.min(err?.retryAfter || 0, 8) * 1000 || 600 * 2 ** (attempt - 1));
    }
  }
  /* A fetch that never lands reports only "Failed to fetch", and a leg we cut
     short reports only that it was aborted. Normalise both so the outage breaker
     can tell a dead network from one of our own bad queries, which must never
     trip the breaker — and so the view reads either one as "use the snapshot". */
  if (stopped(lastError)) throw new Error('timed out', { cause: lastError });
  if (lastError instanceof TypeError) throw new Error('network', { cause: lastError });
  throw lastError;
}

/** Ask for `query` in the background and bank the answer for the next paint. */
function revalidate(key, dk, query, variables) {
  if (revalidating.has(dk) || inflight.has(key) || apiDown()) return;
  revalidating.add(dk);
  queued((dead) => rawRequest(query, variables, dead))
    .then((data) => {
      if (!bankable(data)) return;
      mem.set(key, { t: Date.now(), v: data });
      diskWrite(dk, data);
      markLive();
    })
    .catch(() => {
      /* The copy on disk stays, the page already showed it, and the breaker or
         the next navigation will take it from here. Nothing to say. */
    })
    .finally(() => revalidating.delete(dk));
}

/**
 * Is this body worth banking?
 *
 * A CDN that half-answers returns HTTP 200 with `{data:{Media:null}}` — no
 * error, no row, and nothing a view can paint. A `null` node is the shape of a
 * failure, not an answer, and writing it to the cache made the failure stick:
 * the title read as missing for the memory window, then kept painting that
 * empty copy as a "stale" one for thirty days. One bad moment used to be enough
 * to make an anime disappear, which is exactly the bug report.
 *
 * A list with zero rows is still bankable — that is what "nothing matches this
 * search" looks like, and remembering it is honest. What must never be kept is a
 * body with no list in it at all: `{data:{}}` is a relay that answered without
 * answering, and banking it made the hole permanent for the memory window, then
 * served as a "stale" copy for the disk one.
 */
function bankable(data) {
  if (!data || typeof data !== 'object') return false;
  /* The genre collection has no node shape to test, so the only honest check is
     that it arrived as a list with something in it. */
  if ('GenreCollection' in data) return Array.isArray(data.GenreCollection) && data.GenreCollection.length > 0;
  if (!('Page' in data) && !('Media' in data)) return false;
  const node = data.Page ?? data.Media;
  if (!node || typeof node !== 'object') return false;
  const rows = node.media ?? node.airingSchedules ?? node.characters;
  return Boolean(node.pageInfo || node.id || Array.isArray(rows));
}

export async function gql(query, variables = {}) {
  const key = JSON.stringify([query, variables]);
  const dk = diskKey(key);
  const hit = mem.get(key);
  if (hit && Date.now() - hit.t < MEM_TTL) return hit.v;

  const rec = diskPeek(dk);
  const age = rec ? Date.now() - rec.t : Infinity;
  if (rec && age < DISK_TTL) {
    mem.set(key, { t: Date.now(), v: rec.v });
    return rec.v;
  }
  if (inflight.has(key)) return inflight.get(key);

  const stale = rec && age < STALE_MAX ? rec.v : null;

  /* Past its freshness, still well inside its shelf life: show the copy this
     device already has and go get a newer one behind it. A rail fills instantly
     instead of waiting on the queue, and an API that is slow, rate-limiting us
     or briefly shut is never a screenful of "could not reach the catalogue". */
  if (stale) {
    revalidate(key, dk, query, variables);
    return stale;
  }

  // While the API is refusing us, don't re-probe on every view: answer from
  // whatever we saved, or fail fast so the view can fall back or retry.
  if (Date.now() < outageUntil) {
    throw new Error(outageNote || 'The catalogue is temporarily unavailable');
  }

  const p = queued((dead) => rawRequest(query, variables, dead))
    .then((data) => {
      if (bankable(data)) {
        mem.set(key, { t: Date.now(), v: data });
        diskWrite(dk, data);
      }
      markLive();
      return data;
    })
    .catch((err) => {
      // Blocked, rate limited or outright refused: hold off on further probes
      // and answer from the disk copy if there is one.
      const outage = outageFor(err);
      if (outage) markOutage(outage.note, outage.backoff);
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
  if (!refused(err)) throw err;
  const found = await lookup();
  if (!found) throw err;
  snapshotUsed = true;
  return found;
}

/**
 * The same last resort for an answer that arrived empty rather than failing.
 *
 * `orSnapshot` only fires on a request that threw, so a `{data:{Media:null}}`
 * body — which a healthy endpoint can still hand back for a title in the middle
 * of being re-indexed — walked past it and the page showed a hole. A single title
 * is worth one more try against the bundled snapshot; a *list* that answered
 * zero rows is not, because an empty search genuinely means nothing matched —
 * see `orRows()` for the half-response that is not the same thing.
 */
async function orMissing(found, lookup) {
  if (found) return found;
  const saved = await lookup();
  if (!saved) return null;
  snapshotUsed = true;
  return saved;
}

/**
 * The same last resort for a *half*-answer, which is the shape that blanks a page.
 *
 * A CDN that is having a moment returns 200 with no `Page` node at all. That
 * used to resolve to an empty list, and every view reads an empty list as an
 * answer: Discover painted "no titles match those filters" over a catalogue that
 * was fine, and Home took the rail off the page. So a missing node is treated as
 * a refusal and the snapshot answers it, while a page that genuinely holds zero
 * rows is left exactly as the API said it — "nothing matches this genre" is real
 * information and must not be papered over with saved rows.
 */
async function orRows(page, rows, lookup) {
  if (rows.length || page) return rows;
  const saved = await lookup().catch(() => null);
  if (!saved?.length) return rows;
  snapshotUsed = true;
  return saved;
}

/** `browse()` shape: `{ items, info }`, from the API or from the snapshot. */
async function orPage(page, vars, lookup) {
  const items = page?.media ?? [];
  if (items.length || page) return { items, info: page?.pageInfo ?? {} };
  const saved = await lookup(vars).catch(() => null);
  if (!saved?.items?.length) return { items: [], info: {} };
  snapshotUsed = true;
  return saved;
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
  query ($search: String!, $perPage: Int, $page: Int, $sort: [MediaSort], $isAdult: Boolean) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total hasNextPage currentPage lastPage }
      media(search: $search, type: ANIME, sort: $sort, isAdult: $isAdult) {
        ...MediaFields
      }
    }
  }
`;

export const Q_BROWSE = /* GraphQL */ `
  ${MEDIA}
  query ($page: Int, $perPage: Int, $sort: [MediaSort], $search: String, $genre: String,
        $format: MediaFormat, $status: MediaStatus, $season: MediaSeason,
        $seasonYear: Int, $minimumScore: Int, $isAdult: Boolean) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total hasNextPage currentPage lastPage perPage }
      media(type: ANIME, sort: $sort, search: $search, genre: $genre,
            format: $format, status: $status, season: $season, seasonYear: $seasonYear,
            averageScore_greater: $minimumScore, isAdult: $isAdult) {
        ...MediaFields
      }
    }
  }
`;

/* Three windows over the whole catalogue: search, the browse grid and the retro
   hub's date rails. None of them bounds `countryOfOrigin` any more. The bound
   used to sit in all three, so any indexed title that animation merely did not
   start in Japan — the Chinese co-productions, the French-Italian runs, a
   Korean remake — was invisible to search, to the browse grid and to the retro
   hub's era rows, and a shelf came back empty for a reason nobody could see in
   the query. (Live probes say AniList itself carries no American network
   cartoons, so this widens the catalogue rather than inventing one.)
   `type: ANIME` is the real filter here: it keeps live action out while leaving
   the animated catalogue whole.

   `isAdult` became a variable for the same kind of reason. Every view already
   drops R+ rows unless Settings ▸ "Show mature titles" is on, so a literal
   `isAdult: false` in the query fetched a list that setting could never change —
   a control that looked live and was not.

   The editorial rails (spotlight, genre rows, the ranking, hidden gems, the
   surprise pick) keep their `countryOfOrigin: JP` bound. Those are curated
   slates of Japanese anime by name, and widening them would change what the
   banner and the Top 100 mean. */
/* Two shapes the browse query cannot express, both asked for by the retro hub:
   a fixed list of verified ids, and a broadcast window. AniList has no
   seasonYear comparison arguments, so the years are bounded with startDate_
   instead — the same field, in date form. */
export const Q_IDS = /* GraphQL */ `
  ${MEDIA}
  query ($ids: [Int]!) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME, sort: [POPULARITY_DESC]) {
        ...MediaFields
      }
    }
  }
`;

export const Q_CLASSIC = /* GraphQL */ `
  ${MEDIA}
  query ($page: Int, $perPage: Int, $sort: [MediaSort], $genre: String, $format: MediaFormat,
        $startDateGreater: FuzzyDateInt, $startDateLesser: FuzzyDateInt, $minimumScore: Int,
        $isAdult: Boolean) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total hasNextPage }
      media(type: ANIME, sort: $sort, genre: $genre, format: $format,
            startDate_greater: $startDateGreater, startDate_lesser: $startDateLesser,
            averageScore_greater: $minimumScore, isAdult: $isAdult) {
        ...MediaFields
      }
    }
  }
`;

/* The card binder's artwork: the most-favoured characters and the anime they
   are known from. Page-level `page`/`perPage` set the window — this schema
   version takes no arguments on the `characters` field itself, and returns a
   plain list rather than a connection, so there is no `nodes` to unwrap. */
export const Q_ROSTER = /* GraphQL */ `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      characters(sort: FAVOURITES_DESC) {
        id
        name { full native }
        image { large }
        favourites
        media(type: ANIME, perPage: 3, sort: POPULARITY_DESC) {
          edges { node { id title { romaji english } seasonYear format coverImage { extraLarge large } genres } }
        }
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
  const full = prune(maturity(vars));
  return gql(Q_BROWSE, full)
    .then((d) => orPage(d?.Page, full, seed.browse))
    .catch((err) => orSnapshot(err, () => seed.browse(full)));
}

/** Titles rated well by few people — the literal bounds are the filter. */
export function hiddenGems() {
  return gql(Q_HIDDEN, {})
    .then((d) => orRows(d?.Page, d?.Page?.media ?? [], () => seed.hiddenGems()))
    .catch((err) => orSnapshot(err, () => seed.hiddenGems()));
}

/**
 * A curated shelf: the ids we checked by hand, ordered by how many people are
 * watching them today. No snapshot fallback — a hand-picked list is picked for
 * what it is, and an empty one is honest enough for the rail to bow out.
 *
 * `Q_IDS` asks for one page and AniList caps a page at fifty, so a list longer
 * than that is sent in batches and stitched back together. The retro hub's
 * channel shelves are already past fifty between them.
 *
 * Batches settle separately. With `Promise.all`, one hiccupful batch rejected
 * the call and the shelf fell through to the snapshot — which has never heard of
 * most of these ids — so a whole hand-picked row could vanish because a single
 * request tripped.
 */
export function byIds(ids) {
  const clean = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!clean.length) return Promise.resolve([]);
  const pages = [];
  for (let i = 0; i < clean.length; i += 50) pages.push(clean.slice(i, i + 50));
  return Promise.allSettled(pages.map((batch) => gql(Q_IDS, { ids: batch })))
    .then((settled) => {
      if (settled.every((r) => r.status === 'rejected')) throw settled[0].reason;
      const seen = new Set();
      return settled
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value?.Page?.media ?? [])
        .filter((m) => m?.id && !seen.has(m.id) && seen.add(m.id))
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    })
    .catch((err) => orSnapshot(err, () => seed.byIds(clean)));
}

/** A date-windowed rail: format, genre, era and score floor are all optional. */
export function classic(vars) {
  const full = prune(maturity({ perPage: 20, sort: ['POPULARITY_DESC'], ...vars }));
  /* The snapshot answers in the shape `Page.media` would have, so a rail that
     cannot reach the API still fills with the titles this build shipped with. */
  return gql(Q_CLASSIC, full)
    .then((d) => orRows(d?.Page, d?.Page?.media ?? [], () => seed.classic(full)))
    .catch((err) => orSnapshot(err, () => seed.classic(full)));
}

/**
 * A character, in the one shape the binder uses: portrait, name, and the anime
 * they are best known from. Live answers and the bundled `data/packs.json` are
 * mapped through here so both sides of the fallback hand over the same object.
 *
 * Only a missing id or portrait can lose a card, because the tile has nothing to
 * draw without them. Everything else is a blank to fill in: AniList leaves
 * `name.full` empty for some lesser-known entries while `name.native` is set,
 * and a character with no credited anime still belongs in the pool — `build()`
 * reads `media[0] || {}`, so an empty list renders an unattributed card instead
 * of quietly shortening the roster by one every pull.
 */
function characterCard(node) {
  const anime = (node?.media?.edges || []).map((e) => e?.node).filter((m) => m?.id);
  if (!node?.id || !node.image?.large) return null;
  const name = node.name || {};
  return {
    id: node.id,
    name: name.full || name.native || name.english || 'Unknown',
    native: (name.full ? name.native : '') || '',
    image: node.image.large,
    favourites: Number(node.favourites) || 0,
    media: anime.map((m) => ({
      id: m.id,
      title: m.title?.romaji || m.title?.english || '',
      year: m.seasonYear || null,
      // `large` is 230x345 and the card frame is bigger, so it upscales soft; extraLarge is 460x690.
      cover: m.coverImage?.extraLarge || m.coverImage?.large || null,
      genres: (m.genres || []).slice(0, 3),
    })),
  };
}

/** One page of the roster, newest favourites first. Throws when nothing answers. */
export async function roster(page = 1, perPage = 50) {
  const d = await gql(Q_ROSTER, { page, perPage });
  const cards = (d?.Page?.characters ?? []).map(characterCard).filter(Boolean);
  if (!cards.length) throw new Error('The character roster is empty.');
  return cards;
}

/**
 * The hundred best-rated anime, two pages deep. No snapshot fallback: a ranked
 * list built from a stale sample would be a different list, so the caller shows
 * a retry instead of inventing positions.
 *
 * The two pages are settled rather than awaited together. One dead page used to
 * reject the whole ranking, and a fifty-row bar rejected a page that answered
 * with fewer rows than the hub asked for — so a partly-working API produced no
 * list at all. Whatever arrived is printed, in order, and only a complete
 * silence counts as a failure.
 */
export async function top100() {
  const pages = await Promise.allSettled([gql(Q_RANKED, { page: 1 }), gql(Q_RANKED, { page: 2 })]);
  const items = pages
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value?.Page?.media ?? [])
    .filter((m) => m?.id);
  if (!items.length) throw new Error('The ranking is not answering.');
  return items
    .sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0) || (b.popularity || 0) - (a.popularity || 0))
    .slice(0, 100);
}

export function search(q, vars = {}) {
  const full = prune(maturity({ search: q, perPage: 24, page: 1, sort: ['SEARCH_MATCH'], ...vars }));
  return gql(Q_SEARCH, full)
    .then((d) => orPage(d?.Page, full, (v) => seed.search(q, v)))
    .catch((err) => orSnapshot(err, () => seed.search(q, full)));
}

export function detail(id) {
  return gql(Q_DETAIL, { id })
    .then((d) => d?.Media ?? null)
    .catch((err) => orSnapshot(err, () => seed.detail(id)))
    .then((m) => orMissing(m, () => seed.detail(id)));
}

export function episodes(id) {
  return gql(Q_EPISODES, { id })
    .then((d) => d?.Media ?? null)
    .catch((err) => orSnapshot(err, () => seed.episodes(id)))
    .then((m) => orMissing(m, () => seed.episodes(id)));
}

export function schedule(from, to) {
  return gql(Q_SCHEDULE, { from, to })
    .then((d) => orRows(d?.Page, (d?.Page?.airingSchedules ?? []).filter((s) => s?.media), () => seed.schedule(from, to)))
    .catch((err) => orSnapshot(err, () => seed.schedule(from, to)));
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
  /* The list is a filter control, not a result set: an empty answer — thrown or
     merely hollow — would leave the genre sheet with nothing in it, so the
     shipped list stands in and the live one replaces it on the next visit. */
  try {
    const d = await gql(Q_GENRES, {});
    const list = (d?.GenreCollection ?? []).filter(Boolean).filter((g) => !HIDDEN_GENRES.has(g));
    return list.length ? list : DEFAULT_GENRES;
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
    /* The 7.0 floor is a literal inside `Q_RANDOM`, so re-testing it here only
       ever removed rows: a `null` score fails `>= 70` and a title the query
       already approved disappeared from the roll. Keep the id guard — that is
       what protects `pick.id` below — and let the query hold the rating. */
    items: (d?.Page?.media ?? []).filter((m) => m?.id),
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
    /* Both ways here deserve the snapshot: a refused API, and a set of pages
       that answered with nothing. A surprise pick is not a statement about what
       the catalogue indexes this minute, so `orSnapshot`'s outage-only rule
       would leave the button dead on a thin page instead of rolling a saved row. */
    const saved = await seed.random().catch(() => null);
    if (!saved) throw err;
    snapshotUsed = true;
    lastRandomId = saved.id;
    return saved;
  }
}

