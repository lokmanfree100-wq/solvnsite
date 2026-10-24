/**
 * The card binder: fifteen tiers you can roll, one you cannot, and nothing
 * for sale.
 *
 * A pull is a coin flip and nothing else. There is no store, no rewarded ad, no
 * "boost" you can buy and no pity timer that quietly hands a legend to anybody
 * who clicks enough — the drop table below is the whole of it, and the odds
 * printed on the binder are the odds the code runs. The random source is the
 * browser's own entropy (`crypto.getRandomValues`) with rejection sampling, so a
 * tier cannot be over-favoured by the modulo at the end of a smaller draw, and
 * the result cannot be steered from the outside.
 *
 * What a member gets for free is fifteen packs a day, and only once they have an
 * account: a guest would simply be re-handed the same fifteen every time they
 * cleared their browser. The day turns at 04:00 local, whatever is left unopened
 * rolls into a bank that does not expire, and a run of consecutive days spent
 * pulling raises a *printed* floor under every pack — see `STREAK_STEPS`. A
 * bonus that is not on the screen is not a reward, it is a rig.
 *
 * Evolution is the patient half of the hobby — ten to twenty copies of the same
 * character at the same tier fuse into one card a tier higher, drawn in its
 * transformed art. Above all fifteen tiers sits one card the roll cannot hand
 * over at all: the `ULTIMATE` below, weight zero, awarded only to a binder that
 * holds every tier in the set, and the only plate in the game printed in black and
 * electric blue with a light that breathes.
 *
 * Every tier is printed in its own two colours with a deeper ring and a livelier
 * shine than the one below it, and none carries a weather layer: no bolts, no
 * flame, no falling code, no disc. A tier you reach once a month should read as
 * *rarer*, and a colour you cannot buy anywhere else does that better than a
 * strobe the grid cannot render anyway.
 *
 * The collection itself lives on this device, in the namespaced store, under a
 * key that carries the account id. Nothing here needs a server table, so a
 * binder filled in on a phone stays on that phone.
 */

import { storage } from './store.js';
import { currentUser, isSignedIn, isStaff, pushCards } from './account.js';
import { roster } from './anilist.js';
import { t } from './i18n.js';
import { LOGO_SRC } from './brand.js';

/* ---- the drop table --------------------------------------------------
   `weight` is a share of exactly 100,000 points, so a rate is weight/1000
   percent. The total is computed from the table rather than written twice: if a
   tier is ever added or retuned, the printed odds follow it automatically. */
export const RARITIES = [
  { lv: 1, id: 'basic', label: 'Basic', weight: 36360, a: '#7c869a', b: '#3f4655', glow: '#8b93a6' },
  { lv: 2, id: 'common', label: 'Common', weight: 20000, a: '#8fa3b8', b: '#4c5b6b', glow: '#a9bdd1' },
  { lv: 3, id: 'uncommon', label: 'Uncommon', weight: 13000, a: '#5fd0a0', b: '#1f7a57', glow: '#5fd0a0' },
  { lv: 4, id: 'scarce', label: 'Scarce', weight: 9000, a: '#4fc3f7', b: '#1f5fa8', glow: '#4fc3f7' },
  { lv: 5, id: 'notable', label: 'Notable', weight: 6500, a: '#6d8bff', b: '#2f3cae', glow: '#6d8bff' },
  { lv: 6, id: 'rare', label: 'Rare', weight: 4800, a: '#8b6cff', b: '#4a26b8', glow: '#8b6cff' },
  { lv: 7, id: 'rarer', label: 'Rarer', weight: 3400, a: '#b06bff', b: '#6a24c4', glow: '#b06bff' },
  { lv: 8, id: 'very-rare', label: 'Very Rare', weight: 2400, a: '#ff4fa3', b: '#a81f63', glow: '#ff4fa3' },
  { lv: 9, id: 'elite', label: 'Elite', weight: 1700, a: '#ff3b5c', b: '#a3122c', glow: '#ff3b5c' },
  { lv: 10, id: 'epic', label: 'Epic', weight: 1150, a: '#ff7b3d', b: '#a83c08', glow: '#ff7b3d' },
  { lv: 11, id: 'legendary', label: 'Legendary', weight: 750, a: '#ffc247', b: '#a86a05', glow: '#ffc247' },
  { lv: 12, id: 'mystic', label: 'Mystic', weight: 480, a: '#22e0f5', b: '#0b6f82', glow: '#22e0f5' },
  { lv: 13, id: 'prismatic', label: 'Prismatic', weight: 300, a: '#2ee6a6', b: '#0b6e52', glow: '#2ee6a6', sheen: true },
  { lv: 14, id: 'celestial', label: 'Celestial', weight: 120, a: '#a85cff', b: '#4a12a0', glow: '#a85cff', sheen: true },
  /* Fifteen tiers, and the last one is allowed to be hard: the whole set is
     five cards a pack, so 1 in 2,500 is roughly one Rainbow Holo a month. Nine
     more colours above it used to stretch the same odds thinner without making
     any of them mean more. */
  { lv: 15, id: 'rainbow', label: 'Rainbow Holo', weight: 40, a: '#ff4fa3', b: '#22e0f5', glow: '#ffffff', holo: true },
];

export const TOP_LV = RARITIES[RARITIES.length - 1].lv;

/* ---- the card the roll cannot hand over -------------------------------
   `weight: 0` is not a rounding mistake — the cumulative walk in `rollRarity`
   can only stop on a tier whose band the draw landed in, and a zero-width band
   is never landed in. So this card is never pulled, never fusable away (it sits
   past `TOP_LV`, where `canMerge` stops asking) and never sold. It is *awarded*,
   once, to a binder that holds all fifteen tiers, and it is the only plate in
   the game whose Power reads INFINITY because there is no band left to grade it in.
   The art is the site's own mark: the platform as a character, which is what an
   exclusive of this kind is for.
   `ultimate` is the class the stylesheet keys the one-of-one's own light to: a
   black plate, an electric blue ring, and a slow pulse on the bevel that no tier
   below it wears. Being unmatched is the point. */
export const ULTIMATE = {
  lv: 16,
  id: 'solvn',
  label: 'SOLVN',
  weight: 0,
  a: '#0b6bff',
  b: '#0a1f6b',
  glow: '#2f9cff',
  holo: true,
  cosmic: true,
  crown: true,
  ultimate: true,
};
export const ULTIMATE_KEY = 'solvn:16';
/* The card wears the site's own mark, read from the one path the brand keeps —
   so a rebranded logo repaints the one-of-one on the same commit. */
export const ULTIMATE_ART = LOGO_SRC;

/** The whole set: the fifteen that can roll, then the one that cannot. */
export const ALL_RARITIES = [...RARITIES, ULTIMATE];

/** From this tier up the card wears the printed banner along its middle. */
export const BANNER_LV = 11;
/** The ceiling on any hand: what a pack costs, and what a day gives. */
export const PACK_CARDS = 5;
export const DAILY_PACKS = 15;
/** A card whose Power reaches this figure is a live card: the ring prints brighter,
    the rim takes the tier's colour and the foil answers the light. The line sits where the
    arithmetic puts it — the top two tiers clear it on a good pull, and a mid-tier
    card has to be fused to join them. A live card stays a thing you hunt for. */
export const LIVE_POWER = 620;

const TOTAL_WEIGHT = RARITIES.reduce((n, r) => n + r.weight, 0);
const CUMULATIVE = RARITIES.reduce((acc, r) => [...acc, (acc.at(-1) || 0) + r.weight], []);

export const rarityOf = (lv) => ALL_RARITIES.find((r) => r.lv === Number(lv)) || RARITIES[0];

/**
 * Which form of the character a tier prints.
 *
 * The art is borrowed from AniList, so a form is not a second drawing — it is a
 * different crop and a different grade of the same portrait, the way a card game
 * reframes an evolution on the plate it already has. Five bands, three tiers
 * apiece: a form has to mean something, and a card that changes its framing every
 * level would mean nothing at all. The bands sit where the drop table already
 * breaks: the first honest climbs, the holographic run, and the crowned peak.
 */
export const formOf = (lv) => {
  const n = Number(lv) || 1;
  if (n >= 13) return 5;
  if (n >= 10) return 4;
  if (n >= 7) return 3;
  if (n >= 4) return 2;
  return 1;
};

/** The honest odds, in the two forms a collector reads: a percent and a ratio.
    A tier with no weight cannot be rolled, so it is printed as what it is —
    something a binder is awarded rather than something a pack hands out. */
export function dropRate(lv) {
  const r = rarityOf(lv);
  if (!r.weight) return { pct: 0, label: '—', oneIn: 0, oneInLabel: t('Awarded'), never: true };
  const pct = (r.weight / TOTAL_WEIGHT) * 100;
  return {
    pct,
    label: pct >= 1 ? `${pct.toFixed(pct >= 10 ? 1 : 2)}%` : `${pct.toFixed(3)}%`,
    oneIn: Math.max(1, Math.round(TOTAL_WEIGHT / r.weight)),
    oneInLabel: null,
  };
}

/** How loud the opening gets, and how far the screen shakes. Derived from the
    tier alone, so an effect can never promise more than the roll delivered. */
export const dramaOf = (lv) => {
  const r = rarityOf(lv);
  if (r.ultimate) return { stage: 4, shake: 20 };
  if (r.crown) return { stage: 4, shake: 14 };
  if (r.cosmic) return { stage: 3, shake: 10 };
  if (r.holo) return { stage: 3, shake: 8 };
  if (r.sheen || lv >= 11) return { stage: 2, shake: 5 };
  if (lv >= 7) return { stage: 1, shake: 3 };
  return { stage: 0, shake: 0 };
};

/* ---- the roll -------------------------------------------------------- */
/**
 * A uniform integer in [0, n) from the browser's entropy pool. Drawing a whole
 * 32-bit word and taking `n` of it is biased — the leftover values at the top of
 * the range would never be reached — so anything past the largest exact multiple
 * is thrown away and drawn again. That rejection is the difference between a
 * drop table and a decorative suggestion.
 */
function below(n) {
  if (n <= 1) return 0;
  const words = new Uint32Array(1);
  const limit = Math.floor(4294967296 / n) * n;
  let x = 0;
  do {
    crypto.getRandomValues(words);
    x = words[0];
  } while (x >= limit);
  return x % n;
}

/** One roll against the table: the tier, never the character. */
export function rollRarity() {
  const point = Math.floor(squeeze(below(TOTAL_WEIGHT) / TOTAL_WEIGHT) * TOTAL_WEIGHT);
  let i = 0;
  while (i < CUMULATIVE.length - 1 && point >= CUMULATIVE[i]) i += 1;
  return RARITIES[i];
}

/* ---- the tester's thumb ------------------------------------------------
   One number between 0 and 1, and only the tester account can move it. It does
   not touch the table: it squeezes each draw toward the top of its own range, so
   at full luck a roll lands on Rainbow Holo and a stat band lands on its ceiling. A
   member's odds stay the printed ones, and the squeeze reads the account before
   it reads the number, so a stale value can never help a normal binder. */

/**
 * The one account on this site with a tester's hand, and the only gate the
 * debug toolbar, the forced hands and the odometer all check.
 *
 * The rule lives in `lib/account.js` as `isStaff()` — the same normalisation the
 * server runs over `ADMIN_NAMES`, so the handle cannot be squatted with a space
 * or a case trick, cannot be renamed into or out of, and can be vetoed by an
 * account record that says `isAdmin: false`. Here it keeps the binder's word for
 * it; the admin dashboard reads `isStaff()` directly, so both doors are locked
 * by the same key rather than two lookalikes.
 */
export const isTester = () => isStaff();

export const MAX_LUCK = 1;

export function luck() {
  if (!isTester()) return 0;
  const n = Number(storage.read('luck', 0));
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function setLuck(n) {
  if (!isTester()) return 0;
  storage.write('luck', Math.min(1, Math.max(0, Number(n) || 0)));
  return luck();
}

/** A value in [0,1) pulled a share of the way toward 1. */
function squeeze(x) {
  const l = luck();
  return l > 0 ? x + l * (1 - x) : x;
}

/** A deterministic 32-bit value, so a card's stats never move between visits. */
function hash32(text) {
  let x = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

const frac = (seed) => (hash32(seed) % 100000) / 100000;

export const STAT_KEYS = ['power', 'speed', 'technique', 'aura'];
export const STAT_LABELS = { power: 'Power', speed: 'Speed', technique: 'Technique', aura: 'Aura' };

/**
 * The figure a card is graded on. Power is the headline number: the tier sets
 * the band, the serial decides where inside that band the card sits, and a fused
 * card reads thirty percent stronger. The band is built so the 700 line falls
 * from the high teens upward — or at a mid-tier card pushed over it by evolution
 * — so the animation marks a genuine hunt rather than a cosmetic label. Speed,
 * technique and aura read off the same head number, and the total is their sum.
 */
const POWER_BASE = (lv) => 45 + lv * 34;

function statsFor(cid, serial, lv, evolved) {
  const head = Math.round(
    POWER_BASE(lv) * (0.85 + squeeze(frac(`${cid}|${serial}|power`)) * 0.5) * (evolved ? 1.3 : 1),
  );
  const grade = (key, share) =>
    Math.round(head * share * (0.72 + squeeze(frac(`${cid}|${serial}|${key}`)) * 0.36));
  const out = {
    power: head,
    speed: grade('speed', 0.86),
    technique: grade('technique', 0.92),
    aura: grade('aura', 0.8),
  };
  out.overall = out.power + out.speed + out.technique + out.aura;
  return out;
}

export const isLive = (card) => Boolean(card?.ultimate) || (Number(card?.stats?.power) || 0) >= LIVE_POWER;

/**
 * The band a locked tile prints instead of a number: three tiers to a star, so
 * the top of the fifteen-tier set reads five and a Basic reads one. It is a
 * *band*, which is what a tier honestly is — the exact Power inside it is the
 * part a pull decides, and a pull nobody has made has no number to show.
 */
export const starsFor = (lv) => Math.min(5, Math.max(1, Math.ceil(Number(lv) / 3)));

/* ---- the roster ------------------------------------------------------ */
/**
 * Card artwork comes from the character page while AniList is answering, and
 * from the copy shipped with the build when it is not. A live roster is worth
 * keeping for the session: two requests, a hundred characters, and every pack
 * after that is free.
 */
const SEED_URL = new URL('data/packs.json', document.baseURI).href;
let pool = null;
let loading = null;

/* Two AniList entries can be the same person written two ways — a surname-first
   romanisation next to a given-name-first one, or a remake's spelling of the
   same name. A set that hands out two portraits of one character feels like a
   duplicate even when the ids differ, so the pool keeps the most-favourited
   spelling of each name and drops its echoes. Sorting the tokens first is what
   makes "Luffy Monkey" and "Monkey D. Luffy" the same key. */
const nameKey = (name) =>
  String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

async function bundledPool() {
  const res = await fetch(SEED_URL).catch(() => null);
  const doc = res && res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(doc?.characters) ? doc.characters : [];
}

export async function loadPool() {
  if (pool?.length) return pool;
  if (!loading) {
    loading = (async () => {
      let found = [];
      try {
        const pages = await Promise.all([roster(1, 50), roster(2, 50)]);
        const seen = new Set();
        const names = new Set();
        /* The roster arrives favourites-first, so the spelling kept for a name
           is the one the audience uses. */
        for (const card of pages.flat()) {
          if (!card || seen.has(card.id)) continue;
          const key = nameKey(card.name);
          if (key && names.has(key)) continue;
          seen.add(card.id);
          if (key) names.add(key);
          found.push(card);
        }
      } catch {
        found = [];
      }
      if (!found.length) found = await bundledPool();
      /* Nothing live and nothing bundled is not a crash: the binder says so and
         the pull is never attempted. */
      pool = found;
      return found;
    })().catch(() => {
      pool = [];
      return pool;
    });
  }
  return loading;
}

export const poolSize = () => pool?.length || 0;

/**
 * The character inside the tier. The most-favoured names appear far more often
 * than the deep cuts, which is how a real set behaves and why a duplicate is a
 * normal pull rather than a mistake. Weights are 1/(rank+6) over the roster.
 */
function rollCharacter(len) {
  const scale = 6;
  let total = 0;
  for (let i = 0; i < len; i += 1) total += 1 / (i + scale);
  let point = below(1000000) / 1000000 * total;
  for (let i = 0; i < len; i += 1) {
    point -= 1 / (i + scale);
    if (point <= 0) return i;
  }
  return len - 1;
}

/* ---- the collection --------------------------------------------------- */
const whoId = () => (currentUser()?.id != null ? String(currentUser().id) : 'device');
const collKey = () => `cards:${whoId()}`;
const empty = () => ({ owned: {}, serial: 0, packs: 0, pulls: 0, best: 0, pinned: [], escrow: {}, granted: [] });

/* The one-of-one has moved twice as the set shrank: Lv 21 when the set stopped
   at twenty, Lv 25 when it ran to twenty-four, and now Lv 16 above the fifteen
   that roll. A binder that already holds it would read the old key as a card of
   a tier that no longer exists while `ultimateState()` reported nothing owned.
   Moving the entry by key is the whole migration: once, idempotent, old keys
   removed. */
const LEGACY_MASTER_KEYS = ['solvn:21', 'solvn:25'];

function moveMaster(owned) {
  let moved = false;
  for (const key of LEGACY_MASTER_KEYS) {
    const old = owned[key];
    if (!old) continue;
    delete owned[key];
    if (!owned[ULTIMATE_KEY]) {
      owned[ULTIMATE_KEY] = { ...old, key: ULTIMATE_KEY, lv: ULTIMATE.lv, ultimate: true };
    }
    moved = true;
  }
  return moved;
}

/**
 * A binder that pulled when the set ran past fifteen now holds a card at a tier
 * that is gone. Rather than leave a STORM plate in a fifteen-tier collection, the
 * entry is rebuilt at the top of the current set — same character, same serial,
 * honest Rainbow Holo numbers — and its count folds into any copy already there.
 */
function collapseTiers(owned) {
  let moved = false;
  for (const key of Object.keys(owned)) {
    const entry = owned[key];
    if (!entry || entry.ultimate || Number(entry.lv) <= TOP_LV) continue;
    const cid = String(key).slice(0, String(key).lastIndexOf(':'));
    const card = build(
      {
        id: cid,
        name: entry.name,
        native: entry.native,
        image: entry.image,
        media: [{ id: entry.mediaId, title: entry.mediaTitle, year: entry.mediaYear, genres: entry.mediaGenres, cover: entry.cover }],
      },
      TOP_LV,
      entry.serial ?? 0,
      Boolean(entry.evolved),
    );
    const count = Number(entry.count) || 1;
    delete owned[key];
    const had = owned[card.key];
    owned[card.key] = had ? { ...had, count: (Number(had.count) || 1) + count } : { ...card, count };
    moved = true;
  }
  return moved;
}

function coll() {
  const raw = storage.read(collKey(), null);
  if (!raw || typeof raw !== 'object') return empty();
  const out = {
    owned: raw.owned && typeof raw.owned === 'object' ? raw.owned : {},
    serial: Number(raw.serial) || 0,
    packs: Number(raw.packs) || 0,
    pulls: Number(raw.pulls) || 0,
    best: Number(raw.best) || 0,
    pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((k) => typeof k === 'string') : [],
    /* `escrow` is this binder's copy of what a signature gave up, keyed by deal;
       `granted` remembers which completed deals were already applied, so a second
       page load of the same ledger cannot hand the same card over twice. */
    escrow: raw.escrow && typeof raw.escrow === 'object' ? raw.escrow : {},
    granted: Array.isArray(raw.granted) ? raw.granted.filter((k) => typeof k === 'string') : [],
  };
  const master = moveMaster(out.owned);
  const collapsed = collapseTiers(out.owned);
  if (master || collapsed) {
    if (master) out.best = Math.max(out.best, ULTIMATE.lv);
    out.best = Object.values(out.owned).reduce((n, e) => Math.max(n, Number(e?.lv) || 0), out.best);
    if (collapsed) out.pinned = [...new Set(out.pinned)];
    save(out);
  }
  return out;
}

function save(next) {
  storage.write(collKey(), next);
  /* One writer for every binder change means one place to publish from: a pull,
     a fuse, a grant and a pin all land here, so a profile can never be left
     holding a summary from before the card that changed it. */
  publishSoon();
  return next;
}

const keyOf = (cid, lv) => `${cid}:${lv}`;

/** Serials are the collector's record, not a random number: the 41st card this
    account pulls is #041, whatever tier it lands on. A card outside that count
    prints its own string — the one-of-one wears `1/1` rather than a padded zero. */
const serialLabel = (n) => (typeof n === 'string' ? n : `#${String(n).padStart(3, '0')}`);

function build(source, lv, serial, evolved) {
  const title = source.media[0] || {};
  return {
    key: keyOf(source.id, lv),
    cid: source.id,
    name: source.name,
    native: source.native || '',
    image: source.image,
    mediaId: title.id || null,
    mediaTitle: title.title || '',
    mediaYear: title.year || null,
    mediaGenres: title.genres || [],
    cover: title.cover || null,
    lv,
    serial,
    evolved: Boolean(evolved),
    stats: statsFor(source.id, serial, lv, Boolean(evolved)),
    at: Date.now(),
  };
}

/** Put one card in the binder, or add a copy to the one already there. */
function addOwned(next, card) {
  const had = next.owned[card.key];
  if (had) {
    next.owned[card.key] = { ...had, count: (Number(had.count) || 1) + 1 };
    return { card: had, dupe: true };
  }
  next.owned[card.key] = { ...card, count: 1 };
  return { card, dupe: false };
}

/* ---- the day ---------------------------------------------------------- */
/**
 * A card day runs 04:00 to 03:59, in the viewer's own timezone.
 *
 * The hour is a promise the page prints next to a countdown, so it is a constant
 * rather than whatever midnight happens to be on the device. The ordinal is a
 * UTC day number, which is what makes a streak countable across a daylight-
 * saving change without either the maths or the viewer noticing.
 */
export const PACK_HOUR = 4;
const DAY_MS = 86400000;

export function cardDay(at = Date.now()) {
  const d = new Date(at);
  d.setHours(PACK_HOUR, 0, 0, 0);
  if (at < d.getTime()) d.setDate(d.getDate() - 1);
  return {
    key: `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
    ord: Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS),
  };
}

/** The moment the current card day ends, as a timestamp for the countdown. */
export function nextResetAt(at = Date.now()) {
  const d = new Date(at);
  d.setHours(PACK_HOUR, 0, 0, 0);
  if (at >= d.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const resetInMs = (at = Date.now()) => Math.max(0, nextResetAt(at) - at);

/** The countdown's own words: hours, minutes and seconds, so a promise about
    04:00 can be watched instead of estimated. Tabular figures keep the header
    still while it ticks. */
export function resetText(at = Date.now()) {
  const left = Math.floor(resetInMs(at) / 1000);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ---- the streak --------------------------------------------------------
   A day counts when at least one pack is opened in it — that is the only signal
   a device-local binder can read, and it is what the page says out loud rather
   than "logged in", which Solvn cannot observe offline.

   The reward is a *floor*, printed beside the odds: while a run holds, nothing in
   a pack prints below that tier. It is not a hidden weight on the roll, because a
   bonus nobody can read is indistinguishable from a rig, and the whole argument
   of this file is that the table on the screen is the table that runs. */
export const STREAK_STEPS = [
  { days: 3, floor: 3 },
  { days: 5, floor: 4 },
  { days: 7, floor: 5, bonus: 3 },
  { days: 10, floor: 6 },
  { days: 14, floor: 7, bonus: 5 },
  { days: 21, floor: 8 },
  { days: 30, floor: 9, bonus: 10 },
  { days: 50, floor: 11 },
  { days: 75, floor: 12, bonus: 20 },
  { days: 100, floor: 13, bonus: 40 },
  { days: 150, floor: 14, bonus: 60 },
  /* The top of the ladder reads the top of the set: a two-hundred-day run puts a
     floor under Rainbow Holo, the 1-in-2,500 tier. Six months and a half of
     showing up is what that costs, and it is printed rather than hidden. */
  { days: 200, floor: 15, bonus: 100 },
];

export function streakFloor(run) {
  let lv = 0;
  for (const s of STREAK_STEPS) if (run >= s.days) lv = Math.max(lv, s.floor);
  return lv;
}

/** Packs added to the bank the day a milestone is reached — paid once per run. */
export const streakBonus = (run) => STREAK_STEPS.find((s) => s.days === Number(run))?.bonus || 0;

/** The next step worth getting up for, or null once the set is topped out. */
export function nextStreakStep(run) {
  return STREAK_STEPS.find((s) => s.days > (Number(run) || 0)) || null;
}

/* ---- the daily hand --------------------------------------------------- */
/**
 * Fifteen packs a day, a bank that does not expire, and a day that turns at
 * 04:00. The count follows the account id rather than the browser, so signing in
 * mid-afternoon cannot be answered with a fresh allowance.
 *
 * Reading the record is what rolls the day over: whatever the last day left
 * unopened moves into the bank instead of evaporating at 04:00, which is the only
 * meaning "save your packs for later" can honestly have. The streak is never
 * stored as a second copy — `streakNow` decides whether the run still stands at
 * the moment somebody asks, so a two-day gap breaks it immediately rather than
 * after the next write.
 */
export function quota() {
  const day = cardDay();
  const who = whoId();
  const raw = storage.read('packs', null);
  if (raw && raw.who === who && raw.day === day.key) return { ...raw, limit: DAILY_PACKS };

  const stale = raw && raw.who === who ? raw : null;
  const leftover = stale ? Math.max(0, (Number(stale.limit) || DAILY_PACKS) - (Number(stale.used) || 0)) : 0;
  const next = {
    who,
    day: day.key,
    ord: day.ord,
    used: 0,
    limit: DAILY_PACKS,
    bank: (stale ? Number(stale.bank) || 0 : 0) + leftover,
    streak: stale && stale.streak && typeof stale.streak === 'object' ? stale.streak : { last: 0, run: 0 },
  };
  storage.write('packs', next);
  return next;
}

/** The run as it reads right now: a day missed is a run broken, noticed or not. */
export function streakNow(q = quota()) {
  const run = Number(q.streak?.run) || 0;
  const last = Number(q.streak?.last) || 0;
  if (!run || !last) return 0;
  const ord = cardDay().ord;
  return last === ord || last === ord - 1 ? run : 0;
}

/** Packs still unopened today, before the bank. */
export function allowanceLeft() {
  const q = quota();
  return Math.max(0, (Number(q.limit) || DAILY_PACKS) - (Number(q.used) || 0));
}

/** Packs held in the bank — saved, never expiring, never lost to a rollover. */
export const bankedPacks = () => Math.max(0, Number(quota().bank) || 0);

/**
 * Put packs in the bank without spending a day.
 *
 * A level-up reward and a wheel prize both hand packs over, and neither of them
 * is a day of pulling — so they go straight to the bank, which is the only bucket
 * that does not care where a pack came from. This never touches `used`, and that
 * is the point: a reward must not quietly eat today's allowance.
 */
export function bankPacks(n) {
  const count = Math.max(0, Math.round(Number(n) || 0));
  if (!count) return bankedPacks();
  const q = quota();
  q.bank = bankedPacks() + count;
  storage.write('packs', q);
  return q.bank;
}

export function packsLeft() {
  if (!isSignedIn()) return 0;
  if (isTester()) return Infinity;
  return allowanceLeft() + bankedPacks();
}

/**
 * Spend one. Today's allowance goes first, because it is the part that would be
 * moved into the bank anyway — spending it directly just skips the trip. Then the
 * streak advances, and a milestone paid is a milestone banked.
 */
function spendPack() {
  if (isTester()) return { run: 0, bonus: 0, floor: 0 };
  const q = quota();
  const left = Math.max(0, (Number(q.limit) || DAILY_PACKS) - (Number(q.used) || 0));
  if (left > 0) q.used = (Number(q.used) || 0) + 1;
  else q.bank = Math.max(0, (Number(q.bank) || 0) - 1);

  const ord = cardDay().ord;
  const last = Number(q.streak?.last) || 0;
  const run = streakNow(q);
  const nextRun = last === ord ? Math.max(1, run) : last === ord - 1 ? run + 1 : 1;
  const bonus = streakBonus(nextRun);
  q.streak = { last: ord, run: nextRun };
  if (bonus) q.bank = (Number(q.bank) || 0) + bonus;
  storage.write('packs', q);
  return { run: nextRun, bonus, floor: streakFloor(nextRun) };
}

/* ---- pulls ------------------------------------------------------------ */
/**
 * Open one pack. The tier is rolled first and the character second, so nothing
 * about who you pulled can nudge what you got. The five come back as a hand for
 * the overlay to reveal one at a time.
 *
 * The day is spent before the dice are rolled, and that order is the whole of
 * the streak's honesty: the pack that completes a three-day run is lifted by
 * three days, not by two. A streak's floor is applied after the roll and says so
 * in the answer — a card lifted to the floor is the guarantee the page printed,
 * not a second table — and the hand carries `floor` so the reveal can mark which
 * cards were raised.
 */
export async function openPack() {
  const left = packsLeft();
  if (left <= 0) return { cards: [], blocked: isSignedIn() ? 'empty' : 'signedout' };
  const sources = await loadPool();
  if (!sources.length) return { cards: [], blocked: 'nopool' };

  const spent = spendPack();
  const floor = spent.floor;
  const next = coll();
  const out = [];
  for (let i = 0; i < PACK_CARDS; i += 1) {
    let rarity = rollRarity();
    const raised = floor > rarity.lv;
    if (raised) rarity = rarityOf(floor);
    const source = sources[rollCharacter(sources.length)];
    next.serial += 1;
    const card = build(source, rarity.lv, next.serial, false);
    const added = addOwned(next, card);
    next.pulls += 1;
    next.best = Math.max(next.best, rarity.lv);
    out.push({ ...card, dupe: added.dupe, rarity, raised });
  }
  next.packs += 1;
  save(next);
  return { cards: out, blocked: null, ...spent, floor };
}

/**
 * Hand over copies to fuse. Debug only, and it says so on screen: the point is
 * to see the evolution effect on a tier nobody reaches in a week of daily
 * packs, not to grow a binder somebody did not roll. Gated here as well as in
 * the markup, because a button the page hides is a courtesy and a function that
 * refuses is a control.
 */
export function grantCopies(cid, lv, count) {
  if (!isTester()) return 0;
  const sources = pool || [];
  const source = sources.find((s) => s.id === Number(cid));
  if (!source) return 0;
  const next = coll();
  let given = 0;
  for (let i = 0; i < count; i += 1) {
    next.serial += 1;
    const card = build(source, lv, next.serial, false);
    addOwned(next, card);
    next.pulls += 1;
    next.best = Math.max(next.best, lv);
    given += 1;
  }
  save(next);
  return given;
}

/** Force a hand at a chosen tier. Debug only, and gated twice: the toolbar is
    drawn for the tester account alone, and this returns nothing for anybody
    else. What it banks is exactly what a pack banks — same serials, same
    copies, same stat bands — so a live card can be examined the same afternoon
    the odds would otherwise take a year of daily packs to hand it over. */
export function forcePull(lv, count = PACK_CARDS) {
  if (!isTester()) return [];
  const tier = rarityOf(lv);
  /* Even a tester cannot force this one. A card that can be handed over by a
     button is not an exclusive, and the whole point of it is that a binder earns
     it by holding the set. */
  if (tier.ultimate) return [];
  const sources = pool || [];
  if (!sources.length) return [];
  const next = coll();
  const out = [];
  for (let i = 0; i < Math.min(PACK_CARDS, Number(count) || 1); i += 1) {
    const source = sources[rollCharacter(sources.length)];
    next.serial += 1;
    const card = build(source, tier.lv, next.serial, false);
    const added = addOwned(next, card);
    next.pulls += 1;
    next.best = Math.max(next.best, tier.lv);
    out.push({ ...card, dupe: added.dupe, rarity: tier });
  }
  next.packs += 1;
  save(next);
  return out;
}

/**
 * Turn the day's odometer back to full and leave the bank and the streak alone.
 * Only ever the tester's button, and it refuses anybody else: the toolbar is a
 * way in, this is the control.
 */
export function refillDaily() {
  if (!isTester()) return false;
  const raw = storage.read('packs', null) || {};
  storage.write('packs', { ...raw, ...cardDay(), who: whoId(), used: 0, limit: DAILY_PACKS });
  return true;
}

/**
 * Hand a single card of a chosen tier straight to the binder.
 *
 * The daily wheel promises a card at a tier, not a pack, so the prize has to be
 * drawable without rolling — but it is drawn through the same `build`, which
 * means the same deterministic `statsFor`, so a wheel card and a rolled card at
 * the same tier and serial are the same card. Two things deliberately do not
 * move: the pull count, because this was not pulled, and the master, because a
 * card a button can hand over is not an exclusive.
 */
export async function grantTier(lv) {
  const tier = Number(lv);
  if (!(tier >= 1 && tier < ULTIMATE.lv)) return null;
  const sources = (await loadPool().catch(() => [])) || [];
  if (!sources.length) return null;
  const next = coll();
  next.serial += 1;
  const card = build(sources[rollCharacter(sources.length)], tier, next.serial, false);
  const added = addOwned(next, card);
  next.best = Math.max(next.best, tier);
  save(next);
  return { ...card, dupe: added.dupe, rarity: rarityOf(tier) };
}

/* ---- evolution -------------------------------------------------------- */
/**
 * Ten copies at the bottom of the set, twenty at the top. The cost rises with
 * the tier because the copies themselves do: fusing a Celestial into a Rainbow
 * Holo is worth a week of daily packs, and a Basic into a Common is not.
 */
export function mergeCost(lv) {
  return Math.min(20, 10 + Math.floor(Number(lv) / 2));
}

export const canMerge = (entry) =>
  Boolean(entry) && entry.lv < TOP_LV && (Number(entry.count) || 1) >= mergeCost(entry.lv);

export function merge(key) {
  const next = coll();
  const entry = next.owned[key];
  if (!entry || entry.lv >= TOP_LV) return null;
  const cost = mergeCost(entry.lv);
  if ((Number(entry.count) || 1) < cost) return null;

  const left = (Number(entry.count) || 1) - cost;
  if (left > 0) next.owned[key] = { ...entry, count: left };
  else delete next.owned[key];

  next.serial += 1;
  const up = entry.lv + 1;
  const card = build(
    {
      id: entry.cid,
      name: entry.name,
      native: entry.native,
      image: entry.image,
      media: [{ id: entry.mediaId, title: entry.mediaTitle, year: entry.mediaYear, genres: entry.mediaGenres, cover: entry.cover }],
    },
    up,
    next.serial,
    true,
  );
  const added = addOwned(next, card);
  next.best = Math.max(next.best, up);
  save(next);
  return { card, dupe: added.dupe, from: entry.lv, cost };
}

/* ---- escrow -----------------------------------------------------------
   A signature is a promise with cards standing behind it, so signing lifts my
   side out of the binder and holds it aside until the deal resolves: done, and
   the escrow is gone for good; cancelled, lapsed, or edited underneath me, and
   every copy comes back. The server never sees any of this — it only knows that
   this end signed — which is why `lib/trades.js` re-reads the ledger on every
   arrival and reconciles the binder against it. Nothing can leave a member who
   has not pressed sign, and nothing stays locked in a deal that is over.
   */

/** A stack rather than a key: `key#serial` is one pile of copies, not a tier. */
const stackId = (card) => `${card.key}#${card.serial}`;

/** The character a key belongs to — everything before the last colon. */
const cidOf = (key) => String(key).slice(0, String(key).lastIndexOf(':'));

/** Lift one copy out of `next` in place, or return null when it is not there. */
function takeFrom(next, card) {
  const had = next.owned[card.key];
  if (!had) return null;
  const count = Number(had.count) || 1;
  if (count > 1) next.owned[card.key] = { ...had, count: count - 1 };
  else delete next.owned[card.key];
  return had;
}

/**
 * Whether this binder can still cover a whole side. The side is spent against a
 * throwaway copy, so two listings of the same stack need two copies — the same
 * arithmetic `escrowTake` runs, which is what makes a "yes" here mean the cards
 * really are there.
 */
export function holdsSide(cards) {
  const throwaway = coll();
  return (cards || []).every((card) => takeFrom(throwaway, card) !== null);
}

/** Everything this device is holding back, in the shape a page prints it. */
export function escrowedList() {
  const raw = coll().escrow;
  return Object.keys(raw)
    .map((id) => ({ id, cards: (raw[id] || []).map((c) => ({ ...c, count: Number(c.count) || 1 })) }))
    .filter((row) => row.cards.length);
}

export const escrowOf = (tradeId) => (coll().escrow[tradeId] || []).map((c) => ({ ...c, count: Number(c.count) || 1 }));

/** Sign: put my side in escrow. Returns the cards actually taken. */
export function escrowTake(tradeId, cards) {
  const next = coll();
  const held = [];
  for (const card of cards || []) {
    const had = takeFrom(next, card);
    if (had) held.push({ ...had });
  }
  if (!held.length) delete next.escrow[tradeId];
  else next.escrow[tradeId] = held;
  /* The deal pins the copy it was offered, so a pinned card that leaves the
     binder must stop being pinned — a profile tile for a card that is no longer
     here renders blank while claiming to be somebody's best pull. */
  next.pinned = next.pinned.filter((k) => next.owned[k] || staffByKey().has(k));
  save(next);
  return held;
}

/** Called off, lapsed, or changed after I signed: the cards come home. */
export function escrowReturn(tradeId) {
  const next = coll();
  const held = next.escrow[tradeId];
  if (!held) return 0;
  for (const card of held) addOwned(next, card);
  delete next.escrow[tradeId];
  save(next);
  return held.length;
}

/** Completed: my side is handed over, so the escrow is simply dropped. */
export function escrowSettle(tradeId) {
  const next = coll();
  if (!next.escrow[tradeId]) return false;
  delete next.escrow[tradeId];
  save(next);
  return true;
}

/**
 * The other direction, and the only way a card enters a binder that was not
 * rolled. `statsFor` is deterministic, so rebuilding from the serial the deal
 * carries reproduces the numbers the giver was shown — a traded card is the same
 * card, not a picture of one. Neither the serial count nor the pull count moves:
 * those are this account's own pulling record, and a card that arrived by trade
 * was not pulled here.
 */
export function grantTraded(cards) {
  const next = coll();
  let given = 0;
  for (const card of cards || []) {
    if (Number(card.lv) >= ULTIMATE.lv) continue;
    const rebuilt = build(
      {
        id: cidOf(card.key),
        name: card.name,
        native: card.native,
        image: card.image,
        media: [{ id: card.mediaId, title: card.mediaTitle, year: card.mediaYear }],
      },
      Number(card.lv) || 1,
      card.serial ?? 0,
      Boolean(card.evolved),
    );
    addOwned(next, rebuilt);
    next.best = Math.max(next.best, rebuilt.lv);
    given += 1;
  }
  if (given) save(next);
  return given;
}

/**
 * Has this completed deal already been applied on this device? A ledger read
 * happens every time the page opens, so without this a finished trade would
 * hand its cards over again on each visit.
 */
export const wasGranted = (tradeId) => coll().granted.includes(String(tradeId));

export function markGranted(tradeId) {
  const next = coll();
  const id = String(tradeId);
  if (next.granted.includes(id)) return false;
  /* A completion is remembered, not re-run — so the list only has to be long
     enough to outlive the server's own trade window many times over. */
  next.granted = [...next.granted, id].slice(-600);
  save(next);
  return true;
}

/* ---- the staff showcase ----------------------------------------------
 * The master account is meant to hold every card in the game — and writing two
 * thousand four hundred binder entries into `localStorage` to prove it would be
 * the single slowest thing this module could do: every `coll()` reads that blob,
 * so a megabyte of JSON turns each pull into a parse.
 *
 * So the set is *drawn, not stored*. It exists only in memory, rebuilt once per
 * session from the roster, and it is merged into whatever the real binder holds
 * at read time. Nothing writes it, nothing trades it and nothing fuses it: a
 * virtual card is a showcase, which is exactly what the admin account needs it
 * to be, and the account is excluded from the leaderboards that count collections.
 */
const virtualSerial = (index, lv) => 500000 + lv * 1000 + index;
let staffCache = null;
let staffPool = null;

function staffSet() {
  if (!isTester()) return [];
  if (staffCache && staffPool === pool) return staffCache;
  if (!pool?.length) return [];
  const out = [];
  for (const tier of RARITIES) {
    for (let i = 0; i < pool.length; i += 1) {
      out.push({ ...build(pool[i], tier.lv, virtualSerial(i, tier.lv), false), count: 1, virtual: true });
    }
  }
  out.push({ ...ultimateCard(), count: 1, virtual: true });
  staffCache = out;
  staffPool = pool;
  return out;
}

const staffByKey = () => new Map(staffSet().map((e) => [e.key, e]));

/** One card by key: the binder's copy if it has one, the showcase's if not. */
export function findCard(key) {
  const real = coll().owned[key];
  if (real) return { ...real, count: Number(real.count) || 1 };
  return staffByKey().get(key) || null;
}

/* ---- reading the binder ---------------------------------------------- */
export function ownedEntries() {
  const owned = Object.values(coll().owned).map((e) => ({ ...e, count: Number(e.count) || 1 }));
  const seen = new Set(owned.map((e) => e.key));
  const list = staffSet().filter((e) => !seen.has(e.key)).concat(owned);
  return list.sort((a, b) => b.lv - a.lv || (b.stats?.overall || 0) - (a.stats?.overall || 0) || String(a.name).localeCompare(String(b.name)));
}

export function binderStats() {
  const entries = ownedEntries();
  return {
    packs: coll().packs,
    pulls: coll().pulls,
    unique: entries.length,
    copies: entries.reduce((n, e) => n + e.count, 0),
    best: entries.length ? entries[0].lv : 0,
    holo: entries.filter((e) => e.lv >= BANNER_LV).reduce((n, e) => n + e.count, 0),
  };
}

/* ---- what a profile publishes ---------------------------------------- */
/**
 * The binder itself never leaves this device — it is one `storage` key and it
 * dies with Settings ▸ "Clear everything". A profile and a leaderboard need
 * something far smaller: which number this collection peaks at, and the handful
 * of cards the member chose to show. That is what this section publishes.
 *
 * Nothing here is trusted. It is derived from the local record on the member's
 * own device, so a profile is a claim about a binder, not the binder's ledger;
 * the server only ever checks the *shape* of what arrives.
 */

/** How many cards a member can pin to their profile. */
export const PIN_MAX = 6;

/**
 * The figure every power ranking sorts on.
 *
 * The one-of-one is graded `INFINITY` on screen, and its stored stats stop at
 * 999 because that is the highest number a card face can print. A Rainbow Holo
 * pushed past 999 by evolution would therefore out-rank it on a raw
 * `stats.power` sort — so the master is read at a sentinel above the whole band
 * instead of at the digit its own artwork displays.
 */
export const ULTIMATE_POWER = 9999;

export const powerOf = (card) => (card?.ultimate ? ULTIMATE_POWER : Number(card?.stats?.power) || 0);

/** The keys this binder holds, in the order the member pinned them. */
export function pins() {
  return coll().pinned.slice(0, PIN_MAX);
}

export const isPinned = (key) => pins().includes(key);

/**
 * Pin or un-pin one card. A key this binder does not hold is refused rather than
 * stored: a pin for a card nobody owns would publish a fake, and the tile would
 * render blank on the profile while claiming to be somebody's best pull.
 */
export function togglePin(key) {
  const next = coll();
  if (!next.owned[key] && !staffByKey().has(key)) return { ok: false, pinned: next.pinned };
  const at = next.pinned.indexOf(key);
  if (at >= 0) next.pinned.splice(at, 1);
  else if (next.pinned.length >= PIN_MAX) return { ok: false, pinned: next.pinned };
  else next.pinned.push(key);
  save(next);
  return { ok: true, pinned: next.pinned.slice() };
}

/** One card, in the only shape that is ever sent to the server. */
function published(card) {
  return {
    key: card.key,
    lv: Number(card.lv) || 0,
    name: String(card.name || '').slice(0, 60),
    native: String(card.native || '').slice(0, 120),
    image: card.image || null,
    mediaId: card.mediaId ?? null,
    mediaTitle: String(card.mediaTitle || '').slice(0, 200),
    mediaYear: card.mediaYear ?? null,
    serial: typeof card.serial === 'string' ? card.serial : Number(card.serial) || 0,
    /* Part of the card's identity, not its look: a fused copy is graded higher,
       and a trade proposal read off a profile has to say so or the copy that
       arrives is a weaker one under the same name. */
    evolved: Boolean(card.evolved),
    power: powerOf(card),
    ultimate: Boolean(card.ultimate),
    /* The rest of the plate travels too, because a duel is decided by all four:
       speed picks who strikes first, technique is the critical chance, aura soaks
       what lands. A profile never prints them — the showcase is a Power board —
       but the server keeps whatever arrives, and the arena reads them back. */
    speed: Number(card?.stats?.speed) || 0,
    technique: Number(card?.stats?.technique) || 0,
    aura: Number(card?.stats?.aura) || 0,
  };
}

/**
 * The same record, offered to the trade desk.
 *
 * A profile and a trade proposal describe one copy of one card, and they need
 * exactly the same fields to do it: what it is, where the art lives, the serial
 * stamped on it, and whether it was fused. So this is not a second shape to keep
 * in step — it is the published record with a job title, which is why a card you
 * ask for off somebody's showcase is the card they actually hold.
 */
export const tradeCard = published;

/**
 * The other direction: a published summary back into something a card frame can
 * draw. A profile and the board receive the flat record above, and `gachaCard`
 * wants a tier, a portrait and a stats plate — so the number rides back in as
 * `stats.power`, which is also what decides whether the card runs live.
 */
export const displayCard = (pub) => (pub ? {
  key: pub.key,
  lv: Number(pub.lv) || 1,
  name: pub.name || '',
  native: pub.native || '',
  image: pub.image || null,
  serial: pub.serial ?? 0,
  ultimate: Boolean(pub.ultimate),
  evolved: Boolean(pub.evolved),
  mediaId: pub.mediaId ?? null,
  mediaTitle: pub.mediaTitle || '',
  mediaYear: pub.mediaYear ?? null,
  stats: {
    power: Number(pub.power) || 0,
    speed: Number(pub.speed) || 0,
    technique: Number(pub.technique) || 0,
    aura: Number(pub.aura) || 0,
  },
} : null);

/**
 * The whole published record: the peak number the leaderboard ranks on, the
 * strongest card behind it, and the pinned row. `best` is a Power, not a tier —
 * which is the difference the brief asked for, because the highest tier in a
 * binder is not always the highest number in it.
 */
export function cardSummary() {
  const entries = ownedEntries();
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const strongest = entries.reduce((a, b) => (powerOf(b) > powerOf(a) ? b : a), null);
  return {
    best: strongest ? powerOf(strongest) : 0,
    topTier: entries.length ? Number(entries[0].lv) : 0,
    unique: entries.length,
    pulls: coll().pulls,
    top: strongest ? published(strongest) : null,
    pinned: pins().map((k) => byKey.get(k)).filter(Boolean).map(published),
    updatedAt: Date.now(),
  };
}

/* Two ways to send that record up. `publish` is the one a button waits on, so a
   pin that failed to land can be reported; `publishSoon` is the one `save()`
   calls, and a five-card pack must not become five round trips. */
let publishTimer = 0;

/** Ship the summary now, and hand back what the server stored. */
export function publish() {
  if (!isSignedIn()) return Promise.resolve(null);
  return pushCards(cardSummary());
}

export function publishSoon() {
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => publish().catch(() => {}), 4000);
}

/** Cards the tester asked to see: one per tier, drawn from the roster in order. */
export async function showcaseSet() {
  const sources = await loadPool();
  if (!sources.length) return [];
  const out = [];
  for (let i = 0; i < RARITIES.length; i += 1) {
    const r = RARITIES[i];
    out.push(build(sources[i % sources.length], r.lv, 1000 + i, r.lv >= 13));
  }
  return out;
}

/* ---- the compendium --------------------------------------------------- */
/**
 * Every character the roster holds at the tier you ask for, owned or not.
 *
 * This is the "gotta collect them all" view, and it stays blunt about what is
 * missing: an unowned tile keeps its frame and its tier colours, so a
 * set worth hunting still looks like one — but its exact Power is withheld and a
 * star band stands in for it. A grade you have not earned is a promise rather
 * than a record, and a binder that prints the numbers on a card nobody owns is
 * telling you what a roll you did not make would have said.
 */
const ownedAt = (cid, lv) => coll().owned[keyOf(cid, Number(lv))] || staffByKey().get(keyOf(cid, Number(lv))) || null;

/** A locked tile: the character and the tier, with no grade on it. */
function previewCard(source, lv) {
  return { ...build(source, lv, 0, false), locked: true };
}

/** One tier of the set, in roster order. Owned cards carry their real numbers. */
export function compendium(lv) {
  const tier = Number(lv);
  if (tier === ULTIMATE.lv) {
    const owned = findCard(ULTIMATE_KEY);
    return [owned ? { ...owned, count: Number(owned.count) || 1 } : { ...ultimateCard(), locked: true }];
  }
  return (pool || []).map((source) => {
    const owned = ownedAt(source.id, tier);
    return owned ? { ...owned, count: Number(owned.count) || 1, locked: false } : previewCard(source, tier);
  });
}

/** How many of this tier the binder holds, against how many there are to hold. */
export function tierProgress(lv) {
  const tier = Number(lv);
  if (tier === ULTIMATE.lv) {
    const have = findCard(ULTIMATE_KEY) ? 1 : 0;
    return { tier, have, total: 1, done: have === 1 };
  }
  const list = pool || [];
  const have = list.filter((s) => ownedAt(s.id, tier)).length;
  return { tier, have, total: list.length, done: list.length > 0 && have === list.length };
}

/* ---- the one-of-one --------------------------------------------------- */
/**
 * The card the table cannot hand over.
 *
 * It lives in the binder as a normal entry, so it survives everything else does,
 * and there is exactly one way in: hold at least one copy of all fifteen tiers
 * and the page offers it. It sits past `TOP_LV`, so `canMerge` never asks
 * it for ten copies back — an exclusive that can be fused away is a component.
 */
export function ultimateCard() {
  return {
    key: ULTIMATE_KEY,
    cid: 'solvn',
    name: 'Solvn',
    native: '',
    image: ULTIMATE_ART,
    mediaId: null,
    mediaTitle: '',
    mediaYear: null,
    mediaGenres: [],
    cover: null,
    lv: ULTIMATE.lv,
    serial: '1/1',
    evolved: false,
    ultimate: true,
    stats: { power: 999, speed: 999, technique: 999, aura: 999, overall: 3996 },
    at: Date.now(),
  };
}

/** Which of the rollable tiers this binder holds at least one copy of. */
function tiersHeld() {
  const held = new Set();
  for (const e of Object.values(coll().owned)) {
    const lv = Number(e?.lv);
    if (lv >= 1 && lv <= TOP_LV) held.add(lv);
  }
  return held;
}

export function ultimateState() {
  const held = tiersHeld();
  const missing = [];
  for (let lv = 1; lv <= TOP_LV; lv += 1) if (!held.has(lv)) missing.push(lv);
  return {
    have: Boolean(coll().owned[ULTIMATE_KEY]),
    held: held.size,
    need: TOP_LV,
    missing,
    ready: missing.length === 0,
  };
}

/**
 * The only place this card enters a binder, and it refuses on two counts.
 *
 * `staff` is the tester handle asking for its own binder: it lifts the set
 * requirement and nothing else. It cannot be rolled (`weight: 0`), cannot be
 * forced into a hand, cannot be fused away, and one binder still holds exactly
 * one copy of it — so a staff grant costs a member nothing but the card's own
 * rarity, which is why the button that does it only ever renders for `solvn`.
 */
export function awardUltimate({ staff = false } = {}) {
  const st = ultimateState();
  if (st.have) return { ...st, granted: false };
  if (!st.ready && !(staff && isTester())) return { ...st, granted: false };
  const next = coll();
  addOwned(next, ultimateCard());
  save(next);
  return { ...ultimateState(), granted: true };
}

export const serialText = serialLabel;
