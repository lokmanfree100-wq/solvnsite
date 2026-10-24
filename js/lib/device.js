/**
 * The API a static copy answers for itself.
 *
 * A folder on Netlify or htdocs has no `/api`, and this build does not pretend
 * otherwise: `data-api="off"` is still on `<html>`, so nothing knocks on a route
 * that cannot exist. What changes is that every page that used to vanish with
 * the server — accounts, profiles, playlists, comments, friends, messages, card
 * trades, duels and the ranked board, the daily wheel, watch rooms and the
 * notice bell — now has a backend made of this browser's `localStorage`.
 *
 * It speaks the same route names and returns the same shapes as
 * `account-api.js`, which is why `lib/account.js` can hand it a path without
 * anything above it knowing which of the two answered. What it cannot do is
 * cross a device: an account here lives in one browser, so a deal, a duel or a
 * line reaches another person only if they sign in on the same one. The bell is
 * different — it asks AniList for air dates itself, so a schedule is compared
 * against this device's own saved list rather than the server's.
 *
 * Nothing is seeded: a fresh browser starts with no accounts, no cards and no
 * staff. `solvn` becomes the house account when it is created here with a
 * password, or when a verified Supabase session under that handle is mirrored
 * up; until then the admin routes have nobody to answer to.
 *
 * Passwords are kept as a salted digest, never as typed. On a secure origin the
 * digest is PBKDF2-SHA-256; a plain-http preview cannot reach `crypto.subtle`,
 * so it falls back to a salted string hash. That is a lock on a drawer, not a
 * vault: anything running on this page can read the same storage.
 */

import { BANNER_THEMES, BANNER_FREE } from './ranks.js';

const KEY = 'kitsune:device';
const GLYPHS = ['fox', 'moon', 'star', 'flame', 'ghost', 'bolt'];
const TIERS = [
  { id: 'bronze', min: 0 },
  { id: 'silver', min: 1.5 },
  { id: 'gold', min: 30 },
  { id: 'platinum', min: 60 },
];
const MAX_LEVEL = 100;
const ADMIN_USER_ID = 1000;
const USER_ID_MIN = 100000;
const USER_ID_MAX = 999999;
const NAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u;
const RE_CARD_KEY = /^[\w. -]{1,24}:\d{1,2}$/;
const DM_MAX = 500;
const DM_PAGE = 120;
const DM_THREADS = 40;
const DM_FLOOR = 4;
const DM_SPAM_MS = 2500;
const PIN_MAX = 6;
const HOUSE = 'solvn';
const REPORT_STATES = ['open', 'resolved', 'dismissed'];
const CARD_LV_MAX = 25;
const CARD_POWER_MAX = 9999;

/* Trades: the deal is the record, the cards stay in the binder. Same ceilings as
   `account-api.js` so a page reading this backend cannot tell which answered. */
const TRADE_NOTE_MAX = 140;
const TRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRADE_KEEP = 400;

/* Duels: two cards a side, one seed, and both line-ups committed before a
   result can be filed. */
const DUEL_CARDS = 2;
const DUEL_NOTE_MAX = 140;
const DUEL_TTL_MS = 30 * 60 * 1000;
const DUEL_KEEP = 400;
const DUEL_QUEUE_MS = 90 * 1000;
const DUEL_BAND = 0.2;
const DUEL_DIVISIONS = [
  { id: 'bronze', wins: 1 },
  { id: 'silver', wins: 5 },
  { id: 'gold', wins: 15 },
  { id: 'platinum', wins: 30 },
  { id: 'diamond', wins: 60 },
  { id: 'master', wins: 100 },
  { id: 'legendary', wins: 160 },
  { id: 'grandmaster', wins: 240 },
];

/* The wheel: weights are shares of exactly 100,000, the same table the served
   copy runs, so the odds printed beside the wheel are the odds that rolled. */
const SPIN_WEIGHTS = 100000;
const SPIN_PRIZES = [
  { id: 'xp-15', kind: 'xp', amount: 15, weight: 39000 },
  { id: 'xp-40', kind: 'xp', amount: 40, weight: 20000 },
  { id: 'pack-1', kind: 'pack', amount: 1, weight: 14000 },
  { id: 'card-4', kind: 'card', amount: 4, weight: 10000 },
  { id: 'pack-3', kind: 'pack', amount: 3, weight: 7000 },
  { id: 'card-9', kind: 'card', amount: 9, weight: 4200 },
  { id: 'avatar', kind: 'avatar', amount: 1, weight: 3800 },
  { id: 'banner', kind: 'banner', amount: 1, weight: 1000 },
  { id: 'card-11', kind: 'card', amount: 11, weight: 700 },
  { id: 'card-13', kind: 'card', amount: 13, weight: 250 },
  { id: 'card-15', kind: 'card', amount: 15, weight: 50 },
];
const SPIN_HOUR = 4;
const SPIN_FACE_BANK = 5;

/* Watch Together: a room moves the episode and the track, never a playhead. */
const ROOM_TITLE_MAX = 60;
const ROOM_MSG_MAX = 240;
const ROOM_SPAM_MS = 1500;
const ROOM_CAP = 12;
const ROOM_CHAT_KEEP = 60;
const ROOM_IDLE_MS = 4 * 60 * 1000;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const ROOM_KEEP = 200;
const ROOM_START_MAX_MS = 60 * 1000;
const ROOM_TRACKS = new Set(['sub', 'dub', 'ar', 'fr']);

/* The bell: only titles a member saved get a line, and a first pass over a new
   title stamps it quietly instead of ringing with its whole back catalogue. */
const NOTE_KEEP = 40;
const NOTE_WATCH_MAX = 150;
const NOTE_BATCH = 50;
const NOTE_POLL_MS = 10 * 60 * 1000;
const NOTE_TITLE_MAX = 120;
const NOTE_SYNC_MS = 30 * 1000;
const NOTE_CACHE_KEEP = 4000;
const ANILIST = 'https://graphql.anilist.co';

const BANNER_KEYS = BANNER_THEMES.map(([key]) => key);

const fail = (status, message, code) => {
  throw Object.assign(new Error(message), { status, code: code || `http-${status}` });
};

const fold = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');
const pairKey = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);
const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function randomInt(max) {
  const bytes = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function randomHex(size) {
  const bytes = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let db = null;
let memoryOnly = false;

function blank() {
  return {
    users: {},
    byEmail: {},
    byName: {},
    session: null,
    dms: {},
    friendship: {},
    friendReqs: {},
    playlists: {},
    reports: {},
    comments: {},
    trades: {},
    duels: {},
    rooms: {},
    watches: {},
    notes: {},
    airing: {},
    seeded: false,
  };
}

function persist() {
  if (memoryOnly || !db) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* A private window with storage switched off still gets a working session;
       it just forgets it when the tab closes. */
    memoryOnly = true;
  }
}

function normalise(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object') return base;
  for (const key of [
    'users', 'byEmail', 'byName', 'dms', 'friendship', 'friendReqs', 'playlists', 'reports', 'comments',
    'trades', 'duels', 'rooms', 'watches', 'notes', 'airing',
  ]) {
    base[key] = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
  }
  base.session = typeof raw.session === 'string' ? raw.session : null;
  base.seeded = raw.seeded === true;
  return base;
}

/**
 * Nothing is seeded into this store.
 *
 * An earlier build shipped a credential-less @solvn record with the admin flag,
 * a top-level account and a photo, so the owner could claim it. That made a
 * public copy look like it had a house account nobody had created — a profile on
 * the roster, a level-100 row on a board, a greeting in every new inbox. The
 * store starts empty now: an account exists only after somebody signs up, and
 * @solvn becomes staff only when that same handle is created with a password
 * (or mirrored from the owner's Supabase account). Cards, banners and faces are
 * never part of a fresh record.
 *
 * What this cannot do is tell the owner from a stranger who types @solvn first
 * on a device with no cloud project. The durable answer is the cloud sign-in —
 * that name is theirs there — and the device fallback is documented in
 * `lib/account.js` rather than pretended to be a locked door here.
 */
function purgeLegacyHouse(target) {
  const house = target.users.solvn;
  if (!house || house.hash) return;
  /* No credentials means no person: this row can only be the old seed, so every
     trace it left in an older file goes with it. */
  const gone = 'solvn';
  delete target.users[gone];
  if (target.byName[HOUSE] === gone) delete target.byName[HOUSE];
  for (const [email, id] of Object.entries(target.byEmail)) if (id === gone) delete target.byEmail[email];
  for (const [id, dm] of Object.entries(target.dms)) {
    if (dm.from === gone || dm.to === gone) delete target.dms[id];
  }
  for (const [id, playlist] of Object.entries(target.playlists)) {
    if (playlist.ownerId === gone) delete target.playlists[id];
  }
  for (const [id, comment] of Object.entries(target.comments)) {
    if (comment.by === gone) delete target.comments[id];
  }
  for (const [id, report] of Object.entries(target.reports)) {
    if (report.by === gone || (report.kind === 'user' && report.target === gone)) delete target.reports[id];
  }
  for (const [key, pair] of Object.entries(target.friendship)) {
    if (pair.a === gone || pair.b === gone) delete target.friendship[key];
  }
  for (const [key, req] of Object.entries(target.friendReqs)) {
    if (req.from === gone || req.to === gone) delete target.friendReqs[key];
  }
  for (const [id, trade] of Object.entries(target.trades)) {
    if (trade.from === gone || trade.to === gone) delete target.trades[id];
  }
  for (const [id, duel] of Object.entries(target.duels)) {
    if (duel.from === gone || duel.to === gone) delete target.duels[id];
  }
  for (const [id, room] of Object.entries(target.rooms)) {
    if (room.host === gone || room.members?.[gone]) delete target.rooms[id];
  }
  delete target.watches[gone];
  delete target.notes[gone];
  if (target.session === gone) target.session = null;
}

function data() {
  if (db) return db;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch { /* junk in storage counts as a first visit */ }
  db = normalise(raw);
  purgeLegacyHouse(db);
  persist();
  return db;
}

/* ---- shaping ---------------------------------------------------------- */
function text(value, max, { required = false } = {}) {
  if (value == null || value === '') {
    if (required) fail(400, 'That field is required.');
    return '';
  }
  if (typeof value !== 'string') fail(400, 'That field is not text.');
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean) {
    if (required) fail(400, 'That field is required.');
    return '';
  }
  if ([...clean].length > max) fail(400, `Keep it under ${max} characters.`);
  return clean;
}

function avatarOf(raw) {
  const av = raw && typeof raw === 'object' ? raw : {};
  const photo = typeof av.photo === 'string' && /^data:image\//i.test(av.photo) ? av.photo : null;
  const file = typeof av.file === 'string' && /^data:image\//i.test(av.file) ? av.file : null;
  const face = typeof av.face === 'string' && /^https:\/\//i.test(av.face) ? av.face : null;
  return {
    glyph: GLYPHS.includes(av.glyph) ? av.glyph : 'fox',
    hue: Number(av.hue) || 0,
    photo,
    file,
    face,
  };
}

function bannerOf(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  return {
    hue: Number(b.hue) || 210,
    theme: typeof b.theme === 'string' ? b.theme.slice(0, 40) : null,
    photo: typeof b.photo === 'string' && /^data:image\//i.test(b.photo) ? b.photo : null,
    file: typeof b.file === 'string' && /^data:image\//i.test(b.file) ? b.file : null,
    url: typeof b.url === 'string' && /^https:\/\//i.test(b.url) ? b.url : null,
  };
}

function favouriteOf(raw) {
  const id = Number(raw?.id);
  if (!id) return null;
  return {
    id,
    title: text(raw?.title, 120) || 'Untitled',
    image: typeof raw?.image === 'string' && /^https:\/\//i.test(raw.image) ? raw.image : null,
  };
}

function titleOf(raw) {
  const value = typeof raw === 'string' ? raw.trim().slice(0, 40) : '';
  return value || null;
}

function cardOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || '').slice(0, 40);
  if (!key) return null;
  return {
    key,
    cid: Number(raw.cid) || 0,
    name: text(raw.name, 80) || 'Unknown',
    native: text(raw.native, 80),
    image: typeof raw.image === 'string' ? raw.image.slice(0, 400) : '',
    mediaId: Number(raw.mediaId) || null,
    mediaTitle: text(raw.mediaTitle, 120),
    mediaYear: Number(raw.mediaYear) || null,
    lv: Math.max(1, Math.min(25, Number(raw.lv) || 1)),
    ultimate: raw.ultimate === true,
    stats: {
      power: Number(raw.stats?.power) || 0,
      speed: Number(raw.stats?.speed) || 0,
      technique: Number(raw.stats?.technique) || 0,
      aura: Number(raw.stats?.aura) || 0,
    },
  };
}

function cardsOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    best: Math.max(0, Math.min(9999, Number(raw.best) || 0)),
    topTier: Math.max(0, Math.min(25, Number(raw.topTier) || 0)),
    unique: Math.max(0, Number(raw.unique) || 0),
    pulls: Math.max(0, Number(raw.pulls) || 0),
    top: cardOf(raw.top),
    pinned: (Array.isArray(raw.pinned) ? raw.pinned : []).map(cardOf).filter(Boolean).slice(0, PIN_MAX),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

function isAdmin(user) {
  return !!user && fold(user.username) === HOUSE && user.isAdmin !== false;
}

function publicUser(user) {
  const stats = user.stats || {};
  const hours = Number(stats.hours) || 0;
  let index = 0;
  TIERS.forEach((tier, i) => {
    if (hours >= tier.min) index = i;
  });
  const next = TIERS[index + 1] || null;
  return {
    id: user.id,
    userId: Number(user.userId) || 0,
    username: user.username,
    displayName: user.displayName || user.username,
    bio: user.bio || '',
    avatar: user.avatar || avatarOf({}),
    banner: user.banner || null,
    favourite: user.favourite || null,
    cards: user.cards || null,
    title: user.title || null,
    isAdmin: isAdmin(user),
    createdAt: user.createdAt || Date.now(),
    badges: Array.isArray(stats.badges) ? stats.badges : [],
    stats: {
      hours: Math.round(hours * 10) / 10,
      episodes: Number(stats.episodes) || 0,
      completed: Number(stats.completed) || 0,
      titles: Number(stats.titles) || 0,
      updatedAt: Number(stats.updatedAt) || 0,
      xp: Math.max(0, Math.min(1e9, Number(stats.xp) || 0)),
      level: isAdmin(user) ? MAX_LEVEL : Math.max(1, Math.min(MAX_LEVEL, Number(stats.level) || 1)),
    },
    duel: {
      wins: Number(user.duel?.wins) || 0,
      losses: Number(user.duel?.losses) || 0,
      streak: Number(user.duel?.streak) || 0,
      best: Number(user.duel?.best) || 0,
      fought: Number(user.duel?.fought) || 0,
    },
    unlocks: {
      banners: Array.isArray(user.unlocks?.banners) ? user.unlocks.banners : [],
      avatars: Array.isArray(user.unlocks?.avatars) ? user.unlocks.avatars : [],
      faces: Number(user.unlocks?.faces) || 0,
    },
    fortune: {
      day: user.fortune?.day || null,
      at: Number(user.fortune?.at) || 0,
      prize: user.fortune?.prize || null,
      spins: Number(user.fortune?.spins) || 0,
    },
    nameNextAt: user.nameAt ? user.nameAt + NAME_COOLDOWN_MS : null,
    rank: {
      tier: TIERS[index].id,
      nextTier: next ? next.id : null,
      nextAtHours: next ? next.min : null,
      hoursToNext: next ? Math.max(0, Math.round((next.min - hours) * 10) / 10) : 0,
    },
  };
}

function personOf(user) {
  if (!user) return null;
  return {
    id: user.id,
    userId: Number(user.userId) || 0,
    username: user.username,
    displayName: user.displayName || user.username,
    avatar: user.avatar || avatarOf({}),
    title: user.title || null,
  };
}

function publicMessage(m, viewer) {
  return {
    id: m.id,
    from: m.from,
    to: m.to,
    text: m.text,
    at: m.at,
    read: !!m.read,
    mine: !!viewer && m.from === viewer.id,
  };
}

function publicPlaylist(p, viewerId) {
  const likes = Array.isArray(p.likes) ? p.likes : [];
  return {
    id: p.id,
    ownerId: p.ownerId,
    title: p.title,
    items: Array.isArray(p.items) ? p.items : [],
    visibility: p.visibility === 'private' ? 'private' : 'public',
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    likeCount: likes.length,
    likedByMe: !!viewerId && likes.includes(viewerId),
  };
}

const int = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

/* ---- card records -----------------------------------------------------
   A published summary only has to look right on a profile. A card inside a
   deal or a line-up is a whole instance that will be put into somebody else's
   binder, so it carries the serial and all four combat figures. The receiving
   client rebuilds the plate from the key; nothing here invents a number.
   ------------------------------------------------------------------------ */
function tradeCardOf(raw) {
  if (!raw || typeof raw !== 'object') fail(400, 'A traded card needs a key, a tier and a name.');
  const key = text(raw.key, 24, { required: true });
  if (!RE_CARD_KEY.test(key)) fail(400, 'That is not a card key.');
  const lv = int(raw.lv, 1, CARD_LV_MAX);
  if (lv === CARD_LV_MAX) fail(400, 'That card cannot be traded.');
  const art = text(raw.image, 500);
  return {
    key,
    lv,
    name: text(raw.name, 60, { required: true }),
    native: text(raw.native, 120) || '',
    image: art && /^(https?:\/\/|\/)/i.test(art) ? art : null,
    mediaId: raw.mediaId == null ? null : int(raw.mediaId, 1, 1e9) || null,
    mediaTitle: text(raw.mediaTitle, 200) || '',
    mediaYear: raw.mediaYear == null ? null : int(raw.mediaYear, 0, 9999),
    serial: raw.serial == null ? 0 : typeof raw.serial === 'string' ? text(raw.serial, 12) : int(raw.serial, 0, 1e9),
    evolved: raw.evolved === true,
    power: int(raw.power, 0, CARD_POWER_MAX),
    speed: int(raw.speed, 0, CARD_POWER_MAX),
    technique: int(raw.technique, 0, CARD_POWER_MAX),
    aura: int(raw.aura, 0, CARD_POWER_MAX),
  };
}

function tradeSideOf(raw) {
  if (!Array.isArray(raw)) fail(400, 'Those cards must be a list.');
  if (!raw.length) fail(400, 'A trade needs something on both sides.');
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const card = tradeCardOf(entry);
    const id = `${card.key}#${card.serial}`;
    if (seen.has(id)) fail(400, 'That card is listed twice on one side.');
    seen.add(id);
    out.push(card);
  }
  return out;
}

function lineupOfCards(raw) {
  if (!Array.isArray(raw)) fail(400, 'Your line-up has to be a list of cards.');
  if (raw.length !== DUEL_CARDS) fail(400, `A duel line-up is ${DUEL_CARDS} cards.`);
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const card = tradeCardOf(entry);
    const id = `${card.key}#${card.serial}`;
    if (seen.has(id)) fail(400, 'That card is in your line-up twice.');
    seen.add(id);
    out.push(card);
  }
  return out;
}

const lineupPower = (cards) => (cards || []).reduce((n, c) => Math.max(n, Number(c.power) || 0), 0);

/* ---- trades ------------------------------------------------------------ */
function committedBy(target, userId, except) {
  const held = new Set();
  for (const t of Object.values(target.trades)) {
    if (t.state !== 'awaiting' || t.id === except) continue;
    const mine = t.from === userId ? t.give : t.to === userId ? t.want : null;
    for (const card of mine || []) held.add(`${card.key}#${card.serial}`);
  }
  return held;
}

function guardSpend(target, userId, cards, except) {
  const held = committedBy(target, userId, except);
  for (const card of cards) {
    if (held.has(`${card.key}#${card.serial}`)) fail(409, 'That card is already in another trade.');
  }
}

function publicTrade(target, t, viewer) {
  const mine = viewer ? (viewer.id === t.from ? 'give' : viewer.id === t.to ? 'want' : null) : null;
  return {
    id: t.id,
    at: t.at,
    updated: t.updated,
    closed: t.closed || null,
    state: t.state,
    note: t.note || '',
    from: personOf(target.users[t.from]),
    to: personOf(target.users[t.to]),
    give: t.give,
    want: t.want,
    signed: { from: t.signed[t.from] || null, to: t.signed[t.to] || null },
    mine,
    iSigned: !!mine && !!t.signed[viewer?.id],
    expiresIn: t.state === 'awaiting' ? Math.max(0, t.at + TRADE_TTL_MS - Date.now()) : 0,
  };
}

function expireTrades(target) {
  for (const t of Object.values(target.trades)) {
    if (t.state !== 'awaiting' || Date.now() - t.at <= TRADE_TTL_MS) continue;
    t.state = 'expired';
    t.closed = Date.now();
  }
}

function trimTrades(target) {
  const all = Object.values(target.trades);
  if (all.length <= TRADE_KEEP) return;
  for (const t of all.sort((a, b) => a.at - b.at).slice(0, all.length - TRADE_KEEP)) delete target.trades[t.id];
}

/* ---- duels ------------------------------------------------------------- */
const duelStates = new Set(['awaiting', 'ready', 'done', 'cancelled', 'expired']);
const duelQueue = new Map();

function publicDuel(target, d, viewer) {
  const mine = viewer ? (viewer.id === d.from ? 'from' : viewer.id === d.to ? 'to' : null) : null;
  return {
    id: d.id,
    at: d.at,
    updated: d.updated,
    closed: d.closed || null,
    state: d.state,
    mode: d.mode,
    note: d.note || '',
    seed: d.seed,
    from: personOf(target.users[d.from]),
    to: personOf(target.users[d.to]),
    lineups: { from: d.lineup[d.from] || [], to: d.lineup[d.to] || [] },
    power: { from: lineupPower(d.lineup[d.from]), to: lineupPower(d.lineup[d.to]) },
    signed: { from: d.signed[d.from] || null, to: d.signed[d.to] || null },
    mine,
    iSigned: !!mine && !!d.signed[viewer?.id],
    result: d.result || null,
    expiresIn: d.state === 'awaiting' ? Math.max(0, d.at + DUEL_TTL_MS - Date.now()) : 0,
  };
}

function expireDuels(target) {
  for (const d of Object.values(target.duels)) {
    if (d.state !== 'awaiting' || Date.now() - d.at <= DUEL_TTL_MS) continue;
    d.state = 'expired';
    d.closed = Date.now();
  }
}

function trimDuels(target) {
  const all = Object.values(target.duels);
  if (all.length <= DUEL_KEEP) return;
  for (const d of all.sort((a, b) => a.at - b.at).slice(0, all.length - DUEL_KEEP)) delete target.duels[d.id];
}

function newDuel(target, from, to, aCards, bCards, mode, note) {
  const d = {
    id: newId(),
    at: Date.now(),
    updated: Date.now(),
    closed: null,
    state: 'awaiting',
    mode,
    from,
    to,
    seed: randomHex(8),
    lineup: { [from]: aCards || [] },
    signed: {},
    result: null,
    note: note || '',
  };
  if (aCards?.length) d.signed[from] = Date.now();
  if (bCards?.length) {
    d.lineup[to] = bCards;
    d.signed[to] = Date.now();
  }
  if (d.signed[from] && d.signed[to]) d.state = 'ready';
  target.duels[d.id] = d;
  trimDuels(target);
  return d;
}

function settleDuel(target, d, winner) {
  const loser = winner === d.from ? d.to : d.from;
  d.result = { winner, at: Date.now(), score: d.pendingScore || null };
  d.state = 'done';
  d.closed = d.result.at;
  d.updated = d.result.at;
  delete d.pendingScore;
  for (const [id, won] of [[winner, true], [loser, false]]) {
    const user = target.users[id];
    if (!user) continue;
    const rec = user.duel || { wins: 0, losses: 0, streak: 0, best: 0, fought: 0 };
    rec.wins = Number(rec.wins) || 0;
    rec.losses = Number(rec.losses) || 0;
    rec.streak = Number(rec.streak) || 0;
    rec.best = Number(rec.best) || 0;
    rec.fought = (Number(rec.fought) || 0) + 1;
    if (won) {
      rec.wins += 1;
      rec.streak += 1;
      rec.best = Math.max(rec.best, rec.streak);
    } else {
      rec.losses += 1;
      rec.streak = 0;
    }
    user.duel = rec;
  }
  return d;
}

function linedUp(target, userId, except) {
  const held = new Set();
  for (const d of Object.values(target.duels)) {
    if (d.state === 'done' || d.state === 'cancelled' || d.state === 'expired' || d.id === except) continue;
    if (userId !== d.from && userId !== d.to) continue;
    for (const card of d.lineup[userId] || []) held.add(`${card.key}#${card.serial}`);
  }
  return held;
}

function guardLineup(target, userId, cards, except) {
  const held = linedUp(target, userId, except);
  for (const card of cards) {
    if (held.has(`${card.key}#${card.serial}`)) fail(409, 'That card is already fighting in another duel.');
  }
}

function pruneQueue(now = Date.now()) {
  for (const [id, entry] of duelQueue) if (now - entry.at > DUEL_QUEUE_MS) duelQueue.delete(id);
}

function findRival(user, cards) {
  pruneQueue();
  const mine = lineupPower(cards);
  const limit = Math.max(120, mine * DUEL_BAND);
  let best = null;
  let bestGap = Infinity;
  for (const [id, entry] of duelQueue) {
    if (id === user.id) continue;
    const gap = Math.abs(entry.power - mine);
    if (gap > limit || gap >= bestGap) continue;
    best = { id, entry };
    bestGap = gap;
  }
  return best;
}

function duelDivisionOf(wins) {
  let index = -1;
  const n = Number(wins) || 0;
  for (let i = 0; i < DUEL_DIVISIONS.length; i += 1) if (n >= DUEL_DIVISIONS[i].wins) index = i;
  return { index, id: index >= 0 ? DUEL_DIVISIONS[index].id : null };
}

/* ---- the daily wheel --------------------------------------------------- */
function spinDay(at = Date.now()) {
  const d = new Date(at);
  d.setHours(SPIN_HOUR, 0, 0, 0);
  if (at < d.getTime()) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function nextSpinAt(at = Date.now()) {
  const d = new Date(at);
  d.setHours(SPIN_HOUR, 0, 0, 0);
  if (at >= d.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function rollPrize() {
  const point = randomInt(SPIN_WEIGHTS);
  let acc = 0;
  for (let i = 0; i < SPIN_PRIZES.length; i += 1) {
    acc += SPIN_PRIZES[i].weight;
    if (point < acc) return { prize: SPIN_PRIZES[i], at: i };
  }
  return { prize: SPIN_PRIZES[SPIN_PRIZES.length - 1], at: SPIN_PRIZES.length - 1 };
}

function bannerHeldBy(user) {
  const earned = Array.isArray(user?.unlocks?.banners) ? user.unlocks.banners : [];
  const list = isAdmin(user) ? BANNER_KEYS : [...BANNER_KEYS.slice(0, BANNER_FREE), ...earned];
  return new Set(list.filter((theme) => BANNER_KEYS.includes(theme)));
}

function faceBank(user) {
  return Math.max(0, Math.min(SPIN_FACE_BANK, Number(user?.fortune?.faces) || 0));
}

function prizeTable(user) {
  const held = bannerHeldBy(user);
  return SPIN_PRIZES.map((p, index) => ({
    id: p.id,
    index,
    kind: p.kind,
    amount: p.amount,
    weight: p.weight,
    pct: (p.weight / SPIN_WEIGHTS) * 100,
    oneIn: Math.max(1, Math.round(SPIN_WEIGHTS / p.weight)),
    lockedOnly: p.kind === 'banner' ? BANNER_KEYS.filter((t) => !held.has(t)).length : null,
  }));
}

/* ---- watch-together rooms ---------------------------------------------- */
const ROOM_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function newRoomId(target) {
  for (let tries = 0; tries < 12; tries += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
    if (!target.rooms[code]) return code;
  }
  return newId().toUpperCase();
}

function roomRoster(room) {
  const edge = Date.now() - ROOM_IDLE_MS;
  return Object.keys(room.members).filter((id) => (room.members[id].seen || 0) > edge);
}

function roomPointer(raw) {
  return {
    ep: int(raw?.ep, 0, 10000),
    audio: ROOM_TRACKS.has(raw?.audio) ? raw.audio : 'sub',
  };
}

function roomOf(target, value) {
  const room = target.rooms[String(value || '').trim().toUpperCase().slice(0, 24)];
  if (!room) fail(404, 'That room is gone.');
  if (!room.closed && Date.now() - room.at > ROOM_TTL_MS) room.closed = Date.now();
  return room;
}

function openRoom(target, value) {
  const room = roomOf(target, value);
  if (room.closed) fail(410, 'That room has closed.');
  return room;
}

function roomMessage(m, viewer) {
  return { id: m.id, text: m.text, at: m.at, mine: !!viewer && m.by === viewer.id };
}

function roomAuthor(target, id) {
  const user = target.users[id];
  return user ? personOf(user) : { id: null, username: '(gone)', displayName: '(gone)', avatar: null, title: null };
}

function publicRoom(target, room, viewer) {
  const member = !!viewer && !!room.members[viewer.id];
  const here = member ? roomRoster(room) : [];
  return {
    id: room.id,
    media: room.media,
    title: room.title || '',
    at: room.at,
    updated: room.updated,
    closed: room.closed || null,
    cap: room.cap,
    member,
    host: roomAuthor(target, room.host),
    people: here.map((id) => roomAuthor(target, id)),
    pointer: { ...room.pointer, by: roomAuthor(target, room.pointer.by) },
    start: room.start && room.start.at > Date.now() ? room.start : null,
    chat: member ? (room.chat || []).map((m) => ({ ...roomMessage(m, viewer), author: roomAuthor(target, m.by) })) : [],
    mine: { inRoom: member, isHost: !!viewer && viewer.id === room.host },
    expiresIn: room.closed ? 0 : Math.max(0, room.at + ROOM_TTL_MS - Date.now()),
  };
}

function touchRoom(room, userId) {
  const entry = room.members[userId];
  if (!entry) return;
  entry.seen = Date.now();
  room.updated = Date.now();
}

function promoteHost(room) {
  const here = roomRoster(room);
  if (here.includes(room.host)) return false;
  const next = here.sort((a, b) => (room.members[a].joined || 0) - (room.members[b].joined || 0))[0];
  if (!next) {
    room.closed = Date.now();
    return false;
  }
  room.host = next;
  room.updated = Date.now();
  return true;
}

function expireRooms(target) {
  const edge = Date.now() - ROOM_TTL_MS;
  for (const room of Object.values(target.rooms)) {
    if (room.closed || room.at > edge) continue;
    room.closed = Date.now();
  }
}

function trimRooms(target) {
  const all = Object.values(target.rooms);
  if (all.length <= ROOM_KEEP) return;
  for (const room of all.sort((a, b) => a.at - b.at).slice(0, all.length - ROOM_KEEP)) delete target.rooms[room.id];
}

/* ---- the notice bell ----------------------------------------------------
   The served copy compares air dates on a timer of its own. A folder of files
   cannot keep a timer for a closed tab, so the comparison runs here when the
   bell is opened or somebody signs in, and the stamps it writes are what the
   next pass reads. The query is the same one `account-api.js` sends: only the
   titles this device follows, fifty at a time.
   ------------------------------------------------------------------------ */
const NOTE_QUERY = `query NoticeAiring($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(id_in: $ids, type: ANIME, sort: ID) {
      id
      status
      episodes
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

let noticePollAt = 0;
let noticePolling = null;

function airedCount(node, now) {
  const next = node?.nextAiringEpisode;
  const wanted = Number(next?.episode) || 0;
  if (wanted > 0) {
    const at = Number(next.airingAt) || 0;
    return at * 1000 > now ? Math.max(0, wanted - 1) : wanted;
  }
  return node?.status === 'FINISHED' ? Number(node.episodes) || 0 : 0;
}

function noteFeed(target, userId) {
  if (!Array.isArray(target.notes[userId])) target.notes[userId] = [];
  return target.notes[userId];
}

const unreadNotes = (target, userId) => noteFeed(target, userId).reduce((n, x) => n + (x.read ? 0 : 1), 0);

function pushNote(target, userId, note) {
  const rows = noteFeed(target, userId);
  const item = { id: newId(), at: Date.now(), read: false, ...note };
  rows.unshift(item);
  if (rows.length > NOTE_KEEP) rows.length = NOTE_KEEP;
  return item;
}

function trimAiring(target) {
  const wanted = new Set();
  for (const rec of Object.values(target.watches)) for (const id of Object.keys(rec?.ids || {})) wanted.add(id);
  for (const id of Object.keys(target.airing)) if (!wanted.has(id)) delete target.airing[id];
  const all = Object.keys(target.airing);
  if (all.length <= NOTE_CACHE_KEEP) return;
  for (const id of all.sort((a, b) => (target.airing[a].at || 0) - (target.airing[b].at || 0)).slice(0, all.length - NOTE_CACHE_KEEP)) {
    delete target.airing[id];
  }
}

function applyAiring(target, node, now) {
  const media = Number(node?.id);
  if (!media) return 0;
  const key = String(media);
  const status = typeof node.status === 'string' ? node.status : '';
  const aired = airedCount(node, now);
  target.airing[key] = {
    at: now,
    aired,
    status,
    next: (Number(node.nextAiringEpisode?.airingAt) || 0) * 1000,
  };
  let made = 0;
  for (const [userId, rec] of Object.entries(target.watches)) {
    const stamp = rec?.ids?.[key];
    if (!stamp) continue;
    const before = Number.isFinite(stamp.seen) ? stamp.seen : null;
    const wasDone = stamp.status === 'FINISHED';
    const nowAired = Math.max(aired, before ?? 0);
    stamp.seen = nowAired;
    if (status) stamp.status = status;
    if (before == null) continue;
    const gap = nowAired - before;
    if (gap > 0) {
      pushNote(target, userId, { kind: 'aired', media, ep: nowAired, count: gap, title: stamp.title || '' });
      made += 1;
    }
    if (!wasDone && status === 'FINISHED') {
      pushNote(target, userId, { kind: 'finished', media, ep: nowAired, count: 0, title: stamp.title || '' });
      made += 1;
    }
  }
  return made;
}

async function pollNotices(target) {
  if (noticePolling) return noticePolling;
  const ids = [...new Set(Object.values(target.watches).flatMap((rec) => Object.keys(rec?.ids || {})))]
    .map(Number)
    .filter((n) => n > 0);
  if (!ids.length) {
    noticePollAt = Date.now();
    return 0;
  }
  noticePolling = (async () => {
    let made = 0;
    const now = Date.now();
    try {
      for (let i = 0; i < ids.length; i += NOTE_BATCH) {
        try {
          const res = await fetch(ANILIST, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: NOTE_QUERY, variables: { ids: ids.slice(i, i + NOTE_BATCH) } }),
            signal: globalThis.AbortSignal?.timeout ? AbortSignal.timeout(12000) : undefined,
          });
          if (!res.ok) continue;
          const body = await res.json().catch(() => null);
          const nodes = body?.data?.Page?.media;
          if (!Array.isArray(nodes)) continue;
          for (const node of nodes) made += applyAiring(target, node, now);
        } catch {
          /* One dead page is not a dead pass; the stamps keep their numbers. */
        }
      }
      trimAiring(target);
      persist();
    } finally {
      noticePolling = null;
      noticePollAt = Date.now();
    }
    return made;
  })();
  return noticePolling;
}

/* ---- identity --------------------------------------------------------- */
function freshUserId(target) {
  const taken = new Set(Object.values(target.users).map((u) => Number(u.userId) || 0));
  for (let i = 0; i < 64; i += 1) {
    const n = USER_ID_MIN + Math.floor(Math.random() * (USER_ID_MAX - USER_ID_MIN + 1));
    if (!taken.has(n)) return n;
  }
  for (let n = USER_ID_MIN; n <= USER_ID_MAX; n += 1) if (!taken.has(n)) return n;
  fail(503, 'No user IDs left — contact the operator.');
  return 0;
}

function byUserId(target, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < ADMIN_USER_ID) return null;
  return Object.values(target.users).find((u) => Number(u.userId) === n) || null;
}

function findUser(target, value) {
  return target.users[value] || byUserId(target, value);
}

/** Re-encode the public half of a signed-in member so social routes have a record. */
function adopt(target, viewer) {
  if (!viewer?.id) return null;
  const id = String(viewer.id);
  let user = target.users[id];
  if (!user) {
    user = {
      id,
      userId: Number(viewer.userId) || 0,
      email: '',
      username: viewer.username || 'member',
      displayName: viewer.displayName || viewer.username || 'Member',
      bio: viewer.bio || '',
      avatar: viewer.avatar || avatarOf({}),
      banner: viewer.banner || null,
      cards: viewer.cards || null,
      title: viewer.title || null,
      favourite: viewer.favourite || null,
      /* A cloud profile does not carry `isAdmin`; the handle is the rule both
         backends share, so a Supabase account named solvn is staff here too. */
      isAdmin: viewer.isAdmin === true || fold(viewer.username || '') === HOUSE,
      createdAt: Number(viewer.createdAt) || Date.now(),
      stats: { hours: 0, episodes: 0, completed: 0, titles: 0, badges: [], xp: 0, level: 1, updatedAt: 0 },
      duel: { wins: 0, losses: 0, streak: 0, best: 0, fought: 0 },
      unlocks: { banners: [], avatars: [], faces: 0 },
      fortune: { day: null, at: 0, prize: null, spins: 0, faces: 0 },
      salt: '',
      hash: '',
      mirror: true,
    };
    target.users[id] = user;
  }
  /* A cloud profile can change under this mirror between calls; take the public
     fields it owns and leave the local credentials (a device account with the
     same id would be the same person anyway). */
  for (const key of ['username', 'displayName', 'bio', 'avatar', 'banner', 'favourite', 'cards', 'title', 'isAdmin', 'createdAt']) {
    if (viewer[key] !== undefined) user[key] = viewer[key];
  }
  if (viewer.stats) user.stats = { ...user.stats, ...viewer.stats };
  if (viewer.duel) user.duel = { ...user.duel, ...viewer.duel };
  if (viewer.unlocks) user.unlocks = { ...user.unlocks, ...viewer.unlocks };
  if (viewer.fortune) user.fortune = { ...user.fortune, ...viewer.fortune };
  if (!user.userId && Number(viewer.userId)) user.userId = Number(viewer.userId);
  const nameKey = fold(user.username);
  if (nameKey) target.byName[nameKey] = id;
  return user;
}

function openSession(target, viewer, allowSession) {
  const adopted = adopt(target, viewer);
  if (adopted) return adopted;
  if (!allowSession || !target.session) return null;
  return target.users[target.session] || null;
}

function need(target, viewer, allowSession) {
  const user = openSession(target, viewer, allowSession);
  if (!user) fail(401, 'Please sign in first.');
  return user;
}

/* ---- passwords -------------------------------------------------------- */
function fallbackHash(value) {
  let a = 0x811c9dc5;
  let b = 0x1000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

async function digest(password, salt) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const encoder = new TextEncoder();
      const key = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits(
        { name: 'PBKDF2', salt: encoder.encode(salt), iterations: 120000, hash: 'SHA-256' },
        key,
        256,
      );
      return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { /* a plain-http origin has no subtle crypto; the fallback answers */ }
  }
  return fallbackHash(`${salt}|${password}`);
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- messages and friendships ----------------------------------------- */
function unreadFor(target, user) {
  let n = 0;
  for (const m of Object.values(target.dms)) if (m.to === user.id && !m.read) n += 1;
  return n;
}

function befriend(target, a, b) {
  target.friendship[pairKey(a, b)] = { a, b, at: Date.now() };
  delete target.friendReqs[`${a}>${b}`];
  delete target.friendReqs[`${b}>${a}`];
}

function friendState(target, viewerId, otherId) {
  if (!viewerId) return 'none';
  if (viewerId === otherId) return 'me';
  if (target.friendship[pairKey(viewerId, otherId)]) return 'friend';
  if (target.friendReqs[`${viewerId}>${otherId}`]) return 'out';
  if (target.friendReqs[`${otherId}>${viewerId}`]) return 'in';
  return 'none';
}

/* ---- the site pulse ---------------------------------------------------
   Presence is the browser's own business: `lib/presence.js` keeps the
   heartbeat, so it works the same behind a server and on a plain host. What
   lives here is only what the admin page reads from this device's records.
   ------------------------------------------------------------------------ */
function needStaff(target, viewer, allowSession) {
  const user = need(target, viewer, allowSession);
  if (!isAdmin(user)) fail(403, 'Admins only.');
  return user;
}

function playlistsOf(target, ownerId, viewerId) {
  return Object.values(target.playlists)
    .filter((p) => p.ownerId === ownerId && (p.visibility !== 'private' || ownerId === viewerId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((p) => publicPlaylist(p, viewerId));
}

/* ---- the router ------------------------------------------------------- */
/**
 * Answer one path. `viewer` is the account layer's current user (a cloud
 * session signs in through Supabase and still wants local friends and chats);
 * `allowSession` is false once a verified cloud project owns sign-in, so an old
 * device session cannot answer for the wrong person.
 */
export async function deviceApi(path, { method = 'GET', body } = {}, viewer = null, allowSession = true) {
  const target = data();
  const [route, queryString = ''] = String(path || '').split('?');
  const seg = route.split('/');
  const query = new URLSearchParams(queryString);

  /* -- accounts -- */
  if (seg[0] === 'account' && seg[1] === 'signup' && method === 'POST') {
    const email = text(body?.email, 254, { required: true }).toLowerCase();
    if (!RE_EMAIL.test(email)) fail(400, 'That email address does not look right.');
    const password = typeof body?.password === 'string' ? body.password : '';
    if (password.length < 8 || password.length > 200 || /[\u0000-\u001f\u007f]/.test(password)) {
      fail(400, 'Use 8 to 200 characters for your password.');
    }
    const username = text(body?.username, 24, { required: true });
    if (!RE_NAME.test(username)) fail(400, 'Use 2-24 letters, numbers, spaces or . _ - for your name.');
    const nameKey = fold(username);
    if (target.byEmail[email]) fail(409, 'That email already has an account. Sign in instead.');
    /* The admin handle is a name, not a seeded record: the account is created
       here, with this person's own password, a level-1 ladder and an empty
       binder. Whoever registers @solvn on a device with no cloud project holds
       the staff name there — the Supabase account is the portable answer. */
    if (target.byName[nameKey]) fail(409, 'That name is taken.');

    const salt = randomSalt();
    const staff = nameKey === HOUSE;
    const user = {
      id: newId(),
      userId: staff ? ADMIN_USER_ID : freshUserId(target),
      email,
      username,
      displayName: username,
      bio: '',
      avatar: avatarOf({ hue: Math.floor(Math.random() * 360) }),
      banner: null,
      cards: null,
      title: null,
      favourite: null,
      isAdmin: staff,
      createdAt: Date.now(),
      stats: { hours: 0, episodes: 0, completed: 0, titles: 0, badges: [], xp: 0, level: 1, updatedAt: 0 },
      duel: { wins: 0, losses: 0, streak: 0, best: 0, fought: 0 },
      unlocks: { banners: [], avatars: [], faces: 0 },
      fortune: { day: null, at: 0, prize: null, spins: 0, faces: 0 },
      salt,
      hash: await digest(password, salt),
    };
    target.users[user.id] = user;
    target.byEmail[email] = user.id;
    target.byName[nameKey] = user.id;
    target.session = user.id;
    persist();
    return { user: publicUser(user) };
  }

  if (seg[0] === 'account' && seg[1] === 'login' && method === 'POST') {
    const email = text(body?.email, 254, { required: true }).toLowerCase();
    const password = typeof body?.password === 'string' ? body.password : '';
    const user = target.users[target.byEmail[email] || ''];
    if (!user || !user.salt || !user.hash || (await digest(password, user.salt)) !== user.hash) {
      fail(401, 'Email or password is wrong.');
    }
    target.session = user.id;
    persist();
    return { user: publicUser(user) };
  }

  if (seg[0] === 'account' && seg[1] === 'logout' && method === 'POST') {
    target.session = null;
    persist();
    return { ok: true };
  }

  if (seg[0] === 'account' && seg[1] === 'me' && method === 'GET') {
    const user = openSession(target, viewer, allowSession);
    return {
      user: user ? publicUser(user) : null,
      playlists: user ? playlistsOf(target, user.id, user.id) : [],
    };
  }

  if (seg[0] === 'account' && seg[1] === 'me' && method === 'PATCH') {
    const user = need(target, viewer, allowSession);
    if (body?.username !== undefined) {
      const wanted = text(body.username, 24, { required: true });
      if (fold(wanted) !== fold(user.username)) fail(403, 'Your @handle is permanent and cannot be changed.');
    }
    if (body?.displayName !== undefined) {
      const shown = text(body.displayName, 24);
      if (shown && !RE_NAME.test(shown)) fail(400, 'Use 2-24 letters, numbers, spaces or . _ - for your name.');
      if (shown !== (user.displayName || '')) {
        /* The cooldown is deliberately not enforced here: this record belongs
           to one browser and cannot be handed to another person, and a member
           tidying their own device should not be locked out for a fortnight. */
        user.displayName = shown;
        user.nameAt = Date.now();
      }
    }
    if (body?.bio !== undefined) user.bio = text(body.bio, 140);
    if (body?.avatar !== undefined) user.avatar = avatarOf(body.avatar);
    if (body?.banner !== undefined) user.banner = bannerOf(body.banner);
    if (body?.title !== undefined) user.title = titleOf(body.title);
    if (body?.favourite !== undefined) user.favourite = favouriteOf(body.favourite);
    persist();
    return { user: publicUser(user) };
  }

  if (seg[0] === 'account' && seg[1] === 'avatar' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    user.avatar = { ...avatarOf({}), ...avatarOf(body || {}) };
    persist();
    return {
      user: publicUser(user),
      avatar: {
        glyph: user.avatar.glyph,
        hue: user.avatar.hue,
        hasPhoto: !!(user.avatar.photo || user.avatar.face),
        photoBytes: user.avatar.photo ? user.avatar.photo.length : 0,
        hasFile: !!user.avatar.file,
        fileBytes: user.avatar.file ? user.avatar.file.length : 0,
      },
    };
  }

  if (seg[0] === 'favourite' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    user.favourite = favouriteOf(body);
    persist();
    return { user: publicUser(user), favourite: user.favourite };
  }

  if (seg[0] === 'account' && seg[1] === 'stats' && method === 'PUT') {
    const user = need(target, viewer, allowSession);
    const num = (value, max, int = false) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > max || (int && !Number.isInteger(n))) return 0;
      return n;
    };
    user.stats = {
      hours: Math.round(num(body?.hours, 100000) * 10) / 10,
      episodes: num(body?.episodes, 1000000, true),
      completed: num(body?.completed, 100000, true),
      titles: num(body?.titles, 100000, true),
      badges: Array.isArray(body?.badges)
        ? [...new Set(body.badges.filter((b) => typeof b === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(b)))].slice(0, 32)
        : [],
      xp: num(body?.xp, 1e9, true),
      level: Math.max(1, Math.min(MAX_LEVEL, num(body?.level, MAX_LEVEL, true) || 1)),
      updatedAt: Date.now(),
    };
    persist();
    return { user: publicUser(user) };
  }

  if (seg[0] === 'account' && seg[1] === 'cards' && method === 'PUT') {
    const user = need(target, viewer, allowSession);
    user.cards = cardsOf(body?.cards);
    persist();
    return { user: publicUser(user), cards: user.cards };
  }

  /* -- profiles and the boards -- */
  if (seg[0] === 'users' && seg[1]) {
    const found = findUser(target, seg[1]);
    if (!found) fail(404, 'No such member.');
    const me = openSession(target, viewer, allowSession);
    return {
      user: publicUser(found),
      playlists: playlistsOf(target, found.id, me?.id),
      isMe: me?.id === found.id,
      friend: friendState(target, me?.id, found.id),
    };
  }

  if (seg[0] === 'members') {
    const q = text(query.get('q'), 24).trim().toLowerCase();
    if (q.length < 2) return { users: [] };
    const wanted = /^\d{4,6}$/.test(q) ? Number(q) : 0;
    const score = (u) => {
      const handle = String(u.username || '').toLowerCase();
      const shown = String(u.displayName || u.username || '').toLowerCase();
      if (wanted) {
        if (Number(u.userId) === wanted) return 0;
        if (handle === q) return 1;
        return -1;
      }
      if (handle === q) return 0;
      if (handle.startsWith(q)) return 1;
      if (shown.startsWith(q)) return 2;
      if (handle.includes(q) || shown.includes(q)) return 3;
      return -1;
    };
    const users = Object.values(target.users)
      .map((u) => ({ u, at: score(u) }))
      .filter((row) => row.at >= 0)
      .sort((a, b) => a.at - b.at || String(a.u.username).localeCompare(String(b.u.username)))
      .slice(0, 8)
      .map(({ u }) => publicUser(u));
    return { users };
  }

  if (seg[0] === 'community' && seg[1] === 'collectors') {
    const limit = Math.max(1, Math.min(50, Number(query.get('n')) || 20));
    const me = openSession(target, viewer, allowSession);
    const ranked = Object.values(target.users)
      .filter((u) => !isAdmin(u))
      .map(publicUser)
      .filter((u) => (u.cards?.best || 0) > 0)
      .sort((a, b) => b.cards.best - a.cards.best
        || (b.cards.topTier || 0) - (a.cards.topTier || 0)
        || (b.cards.unique || 0) - (a.cards.unique || 0)
        || a.username.localeCompare(b.username))
      .map((user, i) => ({ ...user, place: i + 1 }));
    const top = ranked.slice(0, limit);
    const mine = me ? ranked.find((u) => u.id === me.id) : null;
    return {
      users: top,
      me: mine && !top.some((u) => u.id === mine.id) ? mine : null,
      totals: {
        members: Object.keys(target.users).length,
        collectors: ranked.length,
        pulls: ranked.reduce((n, u) => n + (u.cards?.pulls || 0), 0),
        highest: ranked.length ? ranked[0].cards.best : 0,
      },
    };
  }

  if (seg[0] === 'community' && seg[1] === 'ranked') {
    const limit = Math.max(1, Math.min(50, Number(query.get('n')) || 20));
    const me = openSession(target, viewer, allowSession);
    const fought = (u) => u.duel.wins + u.duel.losses;
    const rate = (u) => (fought(u) ? u.duel.wins / fought(u) : 0);
    const ranked = Object.values(target.users)
      .filter((u) => !isAdmin(u))
      .map(publicUser)
      .filter((u) => fought(u) > 0)
      .sort((a, b) => duelDivisionOf(b.duel.wins).index - duelDivisionOf(a.duel.wins).index
        || (b.cards?.best || 0) - (a.cards?.best || 0)
        || b.duel.wins - a.duel.wins
        || rate(b) - rate(a)
        || b.duel.streak - a.duel.streak
        || a.username.localeCompare(b.username))
      .map((user, i) => ({ ...user, place: i + 1, winRate: Math.round(rate(user) * 1000) / 10 }));
    const top = ranked.slice(0, limit);
    const mine = me ? ranked.find((u) => u.id === me.id) : null;
    return {
      users: top,
      me: mine && !top.some((u) => u.id === mine.id) ? mine : null,
      totals: {
        members: Object.keys(target.users).length,
        duellists: ranked.length,
        fights: ranked.reduce((n, u) => n + u.duel.fought, 0),
        runs: ranked.reduce((n, u) => Math.max(n, u.duel.best), 0),
      },
      mine: me?.id || null,
    };
  }

  if (seg[0] === 'community' && seg[1] === 'playlists') {
    const me = openSession(target, viewer, allowSession);
    return {
      playlists: Object.values(target.playlists)
        .filter((p) => p.visibility !== 'private')
        .sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0) || b.createdAt - a.createdAt)
        .slice(0, 40)
        .map((p) => publicPlaylist(p, me?.id)),
    };
  }

  /* -- playlists -- */
  if (seg[0] === 'playlists' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const playlist = {
      id: newId(),
      ownerId: user.id,
      title: text(body?.title, 60, { required: true }),
      items: Array.isArray(body?.items) ? body.items.slice(0, 120) : [],
      visibility: body?.visibility === 'private' ? 'private' : 'public',
      likes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    target.playlists[playlist.id] = playlist;
    persist();
    return { playlist: publicPlaylist(playlist, user.id) };
  }

  if (seg[0] === 'playlists' && seg[1] && method === 'PATCH') {
    const user = need(target, viewer, allowSession);
    const playlist = target.playlists[seg[1]];
    if (!playlist) fail(404, 'That playlist is gone.');
    if (playlist.ownerId !== user.id) fail(403, 'That playlist is not yours.');
    if (body?.title !== undefined) playlist.title = text(body.title, 60, { required: true });
    if (body?.items !== undefined) playlist.items = Array.isArray(body.items) ? body.items.slice(0, 120) : [];
    if (body?.visibility !== undefined) playlist.visibility = body.visibility === 'private' ? 'private' : 'public';
    playlist.updatedAt = Date.now();
    persist();
    return { playlist: publicPlaylist(playlist, user.id) };
  }

  if (seg[0] === 'playlists' && seg[1] && method === 'DELETE') {
    const user = need(target, viewer, allowSession);
    const playlist = target.playlists[seg[1]];
    if (!playlist) fail(404, 'That playlist is gone.');
    if (playlist.ownerId !== user.id) fail(403, 'That playlist is not yours.');
    delete target.playlists[playlist.id];
    persist();
    return {};
  }

  if (seg[0] === 'playlists' && seg[1] && seg[2] === 'like' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const playlist = target.playlists[seg[1]];
    if (!playlist) fail(404, 'That playlist is gone.');
    if (playlist.visibility === 'private' && playlist.ownerId !== user.id) fail(403, 'That playlist is private.');
    playlist.likes = Array.isArray(playlist.likes) ? playlist.likes : [];
    const at = playlist.likes.indexOf(user.id);
    if (at >= 0) playlist.likes.splice(at, 1);
    else playlist.likes.push(user.id);
    persist();
    return { playlist: publicPlaylist(playlist, user.id) };
  }

  /* -- friends -- */
  if (seg[0] === 'friends' && seg[1] === 'request' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const other = findUser(target, body?.id);
    if (!other) fail(404, 'That member is not here.');
    if (other.id === user.id) fail(400, 'That is your own profile.');
    if (friendState(target, user.id, other.id) === 'friend') return { state: 'friend' };
    if (target.friendReqs[`${other.id}>${user.id}`]) {
      befriend(target, user.id, other.id);
      persist();
      return { state: 'friend' };
    }
    target.friendReqs[`${user.id}>${other.id}`] = { from: user.id, to: other.id, at: Date.now() };
    persist();
    return { state: 'out' };
  }

  if (seg[0] === 'friends' && seg[1] === 'answer' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const other = findUser(target, body?.id);
    if (!other) fail(404, 'That member is not here.');
    const key = `${other.id}>${user.id}`;
    if (!target.friendReqs[key]) return { state: 'none' };
    delete target.friendReqs[key];
    if (body?.accept === false) {
      persist();
      return { state: 'none' };
    }
    befriend(target, user.id, other.id);
    persist();
    return { state: 'friend' };
  }

  if (seg[0] === 'friends' && seg[1] && method === 'DELETE') {
    const user = need(target, viewer, allowSession);
    const other = findUser(target, seg[1]);
    if (!other) fail(404, 'That member is not here.');
    delete target.friendship[pairKey(user.id, other.id)];
    delete target.friendReqs[`${user.id}>${other.id}`];
    delete target.friendReqs[`${other.id}>${user.id}`];
    persist();
    return { ok: true };
  }

  if (seg[0] === 'friends' && method === 'GET') {
    const user = need(target, viewer, allowSession);
    const friends = [];
    for (const f of Object.values(target.friendship)) {
      if (f.a !== user.id && f.b !== user.id) continue;
      const other = target.users[f.a === user.id ? f.b : f.a];
      if (other) friends.push(personOf(other));
    }
    const incoming = [];
    const outgoing = [];
    for (const r of Object.values(target.friendReqs)) {
      if (r.to === user.id && target.users[r.from]) incoming.push(personOf(target.users[r.from]));
      else if (r.from === user.id && target.users[r.to]) outgoing.push(personOf(target.users[r.to]));
    }
    const byName = (x, y) => String(x.username).localeCompare(String(y.username));
    return {
      friends: friends.sort(byName).slice(0, 200),
      incoming: incoming.sort(byName),
      outgoing: outgoing.sort(byName),
    };
  }

  /* -- private messages -- */
  if (seg[0] === 'dms' && seg[1] === 'thread' && method === 'GET') {
    const user = need(target, viewer, allowSession);
    const other = target.users[query.get('with')] || byUserId(target, query.get('with'));
    if (!other) fail(404, 'That member is not here.');
    const pair = pairKey(user.id, other.id);
    const messages = Object.values(target.dms)
      .filter((m) => m.pair === pair)
      .sort((a, b) => a.at - b.at)
      .slice(-DM_PAGE)
      .map((m) => publicMessage(m, user));
    return { messages, with: personOf(other) };
  }

  if (seg[0] === 'dms' && seg[1] === 'read' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const other = target.users[body?.with] || byUserId(target, body?.with);
    if (!other) fail(404, 'That member is not here.');
    const pair = pairKey(user.id, other.id);
    for (const m of Object.values(target.dms)) {
      if (m.pair === pair && m.to === user.id && !m.read) m.read = true;
    }
    persist();
    return { unread: unreadFor(target, user) };
  }

  if (seg[0] === 'dms' && seg[1] && method === 'DELETE') {
    const user = need(target, viewer, allowSession);
    const m = target.dms[seg[1]];
    if (!m) fail(404, 'That message is gone.');
    if (m.from !== user.id) fail(403, 'Only the person who typed that can take it back.');
    delete target.dms[m.id];
    persist();
    return { ok: true, id: m.id };
  }

  if (seg[0] === 'dms' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const other = target.users[body?.to] || byUserId(target, body?.to);
    if (!other) fail(404, 'That member is not here.');
    if (other.id === user.id) fail(400, 'You cannot message yourself.');
    /* Friends only: a line never reaches an account that has not accepted its
       sender, which keeps the inbox a place friends talk rather than a place
       anybody can write into. */
    if (!target.friendship[pairKey(user.id, other.id)]) fail(403, 'Messages open once you are friends.');
    const line = text(body?.text, DM_MAX, { required: true });

    const pair = pairKey(user.id, other.id);
    const lines = Object.values(target.dms).filter((m) => m.pair === pair);
    const lastOut = lines.filter((m) => m.from === user.id).sort((a, b) => b.at - a.at)[0];
    if (lastOut && Date.now() - lastOut.at < DM_SPAM_MS) fail(429, 'Give that a moment before the next message.');
    const answered = lines.some((m) => m.to === user.id);
    if (!answered && lines.filter((m) => m.from === user.id).length >= DM_FLOOR) {
      fail(403, 'They have not answered yet. Give them time to read it.');
    }

    const message = {
      id: newId(),
      pair,
      from: user.id,
      to: other.id,
      text: line,
      at: Date.now(),
      read: false,
    };
    target.dms[message.id] = message;
    persist();
    return { message: publicMessage(message, user) };
  }

  if (seg[0] === 'dms' && method === 'GET') {
    const user = need(target, viewer, allowSession);
    const rows = new Map();
    for (const m of Object.values(target.dms)) {
      if (m.from !== user.id && m.to !== user.id) continue;
      const row = rows.get(m.pair) || { last: null, unread: 0, opened: m.at };
      if (m.at < row.opened) row.opened = m.at;
      if (!row.last || m.at > row.last.at) row.last = m;
      if (m.to === user.id && !m.read) row.unread += 1;
      rows.set(m.pair, row);
    }
    const threads = [...rows.values()]
      .sort((a, b) => b.last.at - a.last.at)
      .slice(0, DM_THREADS)
      .map((row) => {
        const otherId = row.last.from === user.id ? row.last.to : row.last.from;
        return {
          with: personOf(target.users[otherId]),
          opened: row.opened,
          unread: row.unread,
          last: {
            id: row.last.id,
            text: row.last.text,
            at: row.last.at,
            mine: row.last.from === user.id,
          },
        };
      });
    return { threads, unread: threads.reduce((n, row) => n + row.unread, 0) };
  }

  /* -- reports and the admin desk -- */
  if (seg[0] === 'reports' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const kind = body?.kind === 'playlist' ? 'playlist' : body?.kind === 'user' ? 'user' : null;
    if (!kind) fail(400, 'Say what you are reporting.');
    const targetId = text(body?.id, 32, { required: true });
    const reason = text(body?.reason, 240, { required: true });
    if (kind === 'user' && !findUser(target, targetId)) fail(404, 'No such member.');
    if (kind === 'playlist' && !target.playlists[targetId]) fail(404, 'That playlist is gone.');
    if (targetId === user.id) fail(400, 'That is your own profile.');
    const dup = Object.values(target.reports).find(
      (r) => r.by === user.id && r.kind === kind && r.target === targetId && r.status === 'open',
    );
    if (dup) fail(409, 'You already reported that.');

    const rec = { id: newId(), by: user.id, kind, target: targetId, reason, status: 'open', createdAt: Date.now() };
    target.reports[rec.id] = rec;
    const all = Object.values(target.reports);
    if (all.length > 400) {
      for (const old of all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - 400)) {
        delete target.reports[old.id];
      }
    }
    persist();
    return { ok: true, id: rec.id };
  }

  if (seg[0] === 'admin' && seg[1] === 'users' && !seg[2] && method === 'GET') {
    const me = needStaff(target, viewer, allowSession);
    const reports = Object.values(target.reports);
    const members = Object.values(target.users)
      /* A mirror of a cloud profile has no local password but is a real member;
         one that claims a staff handle yet was never actually admitted is not
         edited from this desk. */
      .filter((u) => u === me || u.hash || u.mirror || !isAdmin(u))
      .map((u) => ({
        ...publicUser(u),
        muted: !!u.muted,
        playlists: Object.values(target.playlists).filter((p) => p.ownerId === u.id).length,
        reports: reports.filter((r) => r.kind === 'user' && r.target === u.id && r.status === 'open').length,
      }))
      .sort((a, b) => b.stats.hours - a.stats.hours || a.username.localeCompare(b.username));
    return {
      members,
      totals: {
        members: members.length,
        hours: Math.round(members.reduce((n, u) => n + (u.stats?.hours || 0), 0) * 10) / 10,
        playlists: Object.keys(target.playlists).length,
        open: reports.filter((r) => r.status === 'open').length,
        comments: Object.keys(target.comments).length,
      },
    };
  }

  if (seg[0] === 'admin' && seg[1] === 'users' && seg[2] && method === 'PATCH') {
    needStaff(target, viewer, allowSession);
    const user = findUser(target, seg[2]);
    if (!user) fail(404, 'No such member.');
    const stats = user.stats || { hours: 0, episodes: 0, completed: 0, titles: 0, badges: [], updatedAt: 0 };
    const num = (value, max, int = false) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return 0;
      const capped = Math.min(n, max);
      return int ? Math.round(capped) : capped;
    };
    if (body?.hours !== undefined) stats.hours = Math.round(num(body.hours, 100000) * 10) / 10;
    if (body?.episodes !== undefined) stats.episodes = num(body.episodes, 1000000, true);
    if (body?.completed !== undefined) stats.completed = num(body.completed, 100000, true);
    if (body?.titles !== undefined) stats.titles = num(body.titles, 100000, true);
    if (body?.badges !== undefined) {
      if (!Array.isArray(body.badges)) fail(400, 'Badges must be a list.');
      stats.badges = [...new Set(body.badges.filter((b) => typeof b === 'string' && /^[a-z0-9][a-z0-9_-]{1,31}$/.test(b)))].slice(0, 32);
    }
    if (body?.muted !== undefined) user.muted = !!body.muted;
    user.stats = { ...stats, updatedAt: Date.now() };
    persist();
    return { user: publicUser(user) };
  }

  if (seg[0] === 'admin' && seg[1] === 'reports' && !seg[2] && method === 'GET') {
    needStaff(target, viewer, allowSession);
    const nameOf = (id) => {
      const u = target.users[id];
      return u ? u.displayName || u.username : '(gone)';
    };
    return {
      reports: Object.values(target.reports)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          target: r.target,
          reason: r.reason,
          status: r.status,
          createdAt: r.createdAt,
          reporter: nameOf(r.by),
          targetName: r.kind === 'user' ? nameOf(r.target) : (target.playlists[r.target] || {}).title || '(gone)',
          targetOwner: r.kind === 'playlist' ? nameOf((target.playlists[r.target] || {}).ownerId) : null,
        })),
    };
  }

  if (seg[0] === 'admin' && seg[1] === 'reports' && seg[2] && method === 'PATCH') {
    needStaff(target, viewer, allowSession);
    const rec = target.reports[seg[2]];
    if (!rec) fail(404, 'No such report.');
    if (!REPORT_STATES.includes(body?.status)) fail(400, 'That is not a report state.');
    rec.status = body.status;
    persist();
    return { ok: true, id: rec.id, status: rec.status };
  }

  if (seg[0] === 'admin' && seg[1] === 'comments' && method === 'GET') {
    needStaff(target, viewer, allowSession);
    /* Episode chat is not part of the device backend, so this queue is empty by
       construction rather than by accident. */
    return {
      comments: Object.values(target.comments)
        .sort((a, b) => b.at - a.at)
        .map((c) => ({ ...c, author: personOf(target.users[c.by]) })),
    };
  }

  if (seg[0] === 'comments' && seg[1] && method === 'DELETE') {
    const user = need(target, viewer, allowSession);
    const comment = target.comments[seg[1]];
    if (!comment) fail(404, 'That comment is gone.');
    if (comment.by !== user.id && !isAdmin(user)) fail(403, 'That comment is not yours.');
    delete target.comments[comment.id];
    persist();
    return { ok: true, id: comment.id };
  }

  /* -- trades ------------------------------------------------------------
     Same five routes as the served copy. The cards never move through here;
     each binder reconciles itself against the deal, and a signature is the
     moment a card is set aside. */
  if (seg[0] === 'trades' && !seg[1] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    expireTrades(target);
    const list = Object.values(target.trades)
      .filter((t) => t.from === user.id || t.to === user.id)
      .sort((a, b) => b.at - a.at)
      .slice(0, 60)
      .map((t) => publicTrade(target, t, user));
    persist();
    return { trades: list, open: list.filter((t) => t.state === 'awaiting').length };
  }

  if (seg[0] === 'trades' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot trade right now.');
    const other = findUser(target, body?.to);
    if (!other) fail(404, 'That member is not here.');
    if (other.id === user.id) fail(400, 'You cannot trade with yourself.');
    const give = tradeSideOf(body?.give);
    const want = tradeSideOf(body?.want);
    const note = text(body?.note, TRADE_NOTE_MAX);
    guardSpend(target, user.id, give, null);

    const t = {
      id: newId(),
      at: Date.now(),
      updated: Date.now(),
      closed: null,
      from: user.id,
      to: other.id,
      give,
      want,
      note: note || '',
      state: 'awaiting',
      signed: {},
    };
    target.trades[t.id] = t;
    trimTrades(target);
    persist();
    return { trade: publicTrade(target, t, user) };
  }

  if (seg[0] === 'trades' && seg[1] && seg[2] === 'sign' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const t = target.trades[seg[1]];
    if (!t) fail(404, 'That trade is gone.');
    if (t.from !== user.id && t.to !== user.id) fail(403, 'Only the two members in a trade can sign it.');
    if (t.state !== 'awaiting') fail(409, 'That trade is already closed.');
    if (Date.now() - t.at > TRADE_TTL_MS) {
      t.state = 'expired';
      t.closed = Date.now();
      persist();
      fail(409, 'That offer has run out of time.');
    }
    if (t.signed[user.id]) fail(409, 'You have already signed that trade.');
    guardSpend(target, user.id, t.from === user.id ? t.give : t.want, t.id);
    t.signed[user.id] = Date.now();
    t.updated = Date.now();
    if (t.signed[t.from] && t.signed[t.to]) {
      t.state = 'done';
      t.closed = Date.now();
    }
    persist();
    return { trade: publicTrade(target, t, user) };
  }

  if (seg[0] === 'trades' && seg[1] && seg[2] === 'amend' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const t = target.trades[seg[1]];
    if (!t) fail(404, 'That trade is gone.');
    if (t.from !== user.id && t.to !== user.id) fail(403, 'Only the two members in a trade can change it.');
    if (t.state !== 'awaiting') fail(409, 'That trade is already closed.');
    const side = t.from === user.id ? 'give' : 'want';
    const next = tradeSideOf(body?.[side]);
    guardSpend(target, user.id, next, t.id);
    t[side] = next;
    t.signed = {};
    t.updated = Date.now();
    persist();
    return { trade: publicTrade(target, t, user) };
  }

  if (seg[0] === 'trades' && seg[1] && seg[2] === 'cancel' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const t = target.trades[seg[1]];
    if (!t) fail(404, 'That trade is gone.');
    if (t.from !== user.id && t.to !== user.id) fail(403, 'Only the two members in a trade can call it off.');
    if (t.state !== 'awaiting') fail(409, 'That trade is already closed.');
    t.state = 'cancelled';
    t.closed = Date.now();
    t.updated = t.closed;
    persist();
    return { trade: publicTrade(target, t, user) };
  }

  /* -- duels ------------------------------------------------------------- */
  if (seg[0] === 'duels' && seg[1] === 'practice' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot duel right now.');
    const won = body?.won === true;
    const rec = user.duel || { wins: 0, losses: 0, streak: 0, best: 0, fought: 0 };
    rec.wins = Number(rec.wins) || 0;
    rec.losses = Number(rec.losses) || 0;
    rec.streak = Number(rec.streak) || 0;
    rec.best = Number(rec.best) || 0;
    rec.fought = (Number(rec.fought) || 0) + 1;
    if (won) {
      rec.wins += 1;
      rec.streak += 1;
      rec.best = Math.max(rec.best, rec.streak);
    } else {
      rec.losses += 1;
      rec.streak = 0;
    }
    user.duel = rec;
    persist();
    return { record: { ...rec, division: duelDivisionOf(rec.wins).id } };
  }

  if (seg[0] === 'duels' && !seg[1] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    expireDuels(target);
    pruneQueue();
    const list = Object.values(target.duels)
      .filter((d) => d.from === user.id || d.to === user.id)
      .sort((a, b) => b.at - a.at)
      .slice(0, 40)
      .map((d) => publicDuel(target, d, user));
    persist();
    return {
      duels: list,
      open: list.filter((d) => d.state === 'awaiting' || d.state === 'ready').length,
      waiting: duelQueue.has(user.id),
      rivals: Math.max(0, duelQueue.size - (duelQueue.has(user.id) ? 1 : 0)),
    };
  }

  if (seg[0] === 'duels' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot duel right now.');
    const other = findUser(target, body?.to);
    if (!other) fail(404, 'That member is not here.');
    if (other.id === user.id) fail(400, 'You cannot duel yourself.');
    const cards = lineupOfCards(body?.cards);
    guardLineup(target, user.id, cards, null);
    const note = text(body?.note, DUEL_NOTE_MAX);
    const dup = Object.values(target.duels).find(
      (d) => d.state === 'awaiting' && d.mode === 'invite'
        && ((d.from === user.id && d.to === other.id) || (d.from === other.id && d.to === user.id)),
    );
    if (dup) fail(409, 'There is already a challenge open between you.');
    const d = newDuel(target, user.id, other.id, cards, null, 'invite', note);
    persist();
    return { duel: publicDuel(target, d, user) };
  }

  if (seg[0] === 'duels' && seg[1] === 'queue' && seg[2] === 'leave' && method === 'POST') {
    duelQueue.delete(need(target, viewer, allowSession).id);
    return { ok: true, queued: false };
  }

  if (seg[0] === 'duels' && seg[1] === 'queue' && !seg[2] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot duel right now.');
    const cards = lineupOfCards(body?.cards);
    guardLineup(target, user.id, cards, null);
    const rival = findRival(user, cards);
    if (!rival) {
      duelQueue.set(user.id, { id: user.id, cards, power: lineupPower(cards), at: Date.now() });
      return {
        queued: true,
        power: lineupPower(cards),
        rivals: Math.max(0, duelQueue.size - 1),
        waitsFor: DUEL_QUEUE_MS,
      };
    }
    duelQueue.delete(rival.id);
    duelQueue.delete(user.id);
    const other = target.users[rival.id];
    if (!other) {
      duelQueue.set(user.id, { id: user.id, cards, power: lineupPower(cards), at: Date.now() });
      return { queued: true, power: lineupPower(cards), rivals: 0, waitsFor: DUEL_QUEUE_MS };
    }
    const d = newDuel(target, user.id, other.id, cards, rival.entry.cards, 'queue', '');
    persist();
    return { duel: publicDuel(target, d, user), queued: false };
  }

  if (seg[0] === 'duels' && seg[1] && seg[2] === 'sign' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const d = target.duels[seg[1]];
    if (!d) fail(404, 'That duel is gone.');
    if (d.from !== user.id && d.to !== user.id) fail(403, 'Only the two members in a duel can commit to it.');
    if (d.state !== 'awaiting') fail(409, 'That duel is already closed.');
    if (Date.now() - d.at > DUEL_TTL_MS) {
      d.state = 'expired';
      d.closed = Date.now();
      persist();
      fail(409, 'That challenge has run out of time.');
    }
    if (d.signed[user.id]) fail(409, 'You have already committed that line-up.');
    const cards = lineupOfCards(body?.cards);
    guardLineup(target, user.id, cards, d.id);
    d.lineup[user.id] = cards;
    d.signed[user.id] = Date.now();
    d.updated = Date.now();
    if (d.signed[d.from] && d.signed[d.to]) d.state = 'ready';
    persist();
    return { duel: publicDuel(target, d, user) };
  }

  if (seg[0] === 'duels' && seg[1] && seg[2] === 'result' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const d = target.duels[seg[1]];
    if (!d) fail(404, 'That duel is gone.');
    if (d.from !== user.id && d.to !== user.id) fail(403, 'Only the two members in a duel can settle it.');
    if (d.state === 'done') return { duel: publicDuel(target, d, user) };
    if (d.state !== 'ready') fail(409, 'That duel has not started yet.');
    const winner = text(body?.winner, 32, { required: true });
    if (winner !== d.from && winner !== d.to) fail(400, 'That winner is not in this duel.');
    const raw = Array.isArray(body?.score) ? body.score : [];
    d.pendingScore = { from: int(raw[0], 0, 1e6), to: int(raw[1], 0, 1e6) };
    duelQueue.delete(d.from);
    duelQueue.delete(d.to);
    settleDuel(target, d, winner);
    persist();
    return { duel: publicDuel(target, d, user) };
  }

  if (seg[0] === 'duels' && seg[1] && seg[2] === 'cancel' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const d = target.duels[seg[1]];
    if (!d) fail(404, 'That duel is gone.');
    if (d.from !== user.id && d.to !== user.id) fail(403, 'Only the two members in a duel can call it off.');
    if (d.state === 'done') fail(409, 'That duel has already been fought.');
    if (d.state === 'cancelled') return { duel: publicDuel(target, d, user) };
    d.state = 'cancelled';
    d.closed = Date.now();
    d.updated = d.closed;
    duelQueue.delete(d.from);
    duelQueue.delete(d.to);
    persist();
    return { duel: publicDuel(target, d, user) };
  }

  /* -- the daily wheel --------------------------------------------------- */
  if (seg[0] === 'fortune' && !seg[1] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    return {
      prizes: prizeTable(user),
      held: [...bannerHeldBy(user)],
      level: publicUser(user).stats.level,
      day: spinDay(),
      nextAt: nextSpinAt(),
      spun: user.fortune?.day === spinDay(),
      prize: user.fortune?.prize || null,
      faces: faceBank(user),
      spins: Number(user.fortune?.spins) || 0,
      at: Number(user.fortune?.at) || 0,
    };
  }

  if (seg[0] === 'fortune' && seg[1] === 'spin' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot spin right now.');
    const day = spinDay();
    if (user.fortune?.day === day) fail(409, 'Your spin is used. Come back after 04:00.');
    const drawn = rollPrize();
    const won = { ...drawn.prize, index: drawn.at };

    if (won.kind === 'banner') {
      const locked = BANNER_KEYS.filter((theme) => !bannerHeldBy(user).has(theme));
      if (!locked.length) {
        won.kind = 'xp';
        won.amount = 120;
        won.id = 'xp-banners';
      } else {
        won.theme = locked[randomInt(locked.length)];
      }
    }

    const record = user.fortune || { day: null, at: 0, prize: null, faces: 0, spins: 0 };
    const unlocks = user.unlocks || {};
    const banners = Array.isArray(unlocks.banners) ? unlocks.banners : [];
    const avatars = Array.isArray(unlocks.avatars) ? unlocks.avatars : [];
    if (won.kind === 'banner' && won.theme && !banners.includes(won.theme)) banners.push(won.theme);
    user.unlocks = { banners, avatars };
    record.day = day;
    record.at = Date.now();
    record.prize = won;
    record.spins = (Number(record.spins) || 0) + 1;
    record.faces = won.kind === 'avatar' ? faceBank(user) + 1 : faceBank(user);
    user.fortune = record;
    persist();
    return {
      prize: won,
      index: won.index,
      day,
      nextAt: nextSpinAt(),
      faces: faceBank(user),
      unlocks: publicUser(user).unlocks,
    };
  }

  if (seg[0] === 'fortune' && seg[1] === 'pick' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (!faceBank(user)) fail(403, 'You have no face to spend. Win one on the wheel first.');
    const face = int(body?.face, 1, 2 ** 31 - 1);
    if (!face) fail(400, 'That is not a character id.');
    const unlocks = user.unlocks || {};
    const banners = Array.isArray(unlocks.banners) ? unlocks.banners : [];
    const avatars = Array.isArray(unlocks.avatars) ? unlocks.avatars : [];
    if (!avatars.includes(face)) avatars.push(face);
    user.unlocks = { banners, avatars: avatars.slice(-400) };
    user.fortune = { ...(user.fortune || {}), faces: faceBank(user) - 1 };
    persist();
    return { user: publicUser(user), faces: faceBank(user) };
  }

  /* -- watch together ---------------------------------------------------- */
  if (seg[0] === 'rooms' && !seg[1] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    expireRooms(target);
    const rooms = Object.values(target.rooms)
      .filter((room) => !room.closed && room.members[user.id])
      .sort((a, b) => b.updated - a.updated)
      .slice(0, 10)
      .map((room) => publicRoom(target, room, user));
    persist();
    return { rooms };
  }

  if (seg[0] === 'rooms' && !seg[1] && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot start a room right now.');
    const media = int(body?.media, 1, 2 ** 31 - 1);
    const label = text(body?.title, ROOM_TITLE_MAX);
    const wanted = roomPointer(body);
    if (!wanted.ep) fail(400, 'That room needs an episode to start on.');

    const mine = Object.values(target.rooms).find((room) => !room.closed && room.host === user.id && room.media === media);
    if (mine) {
      mine.pointer = { ...wanted, at: Date.now(), by: user.id };
      mine.start = null;
      touchRoom(mine, user.id);
      mine.updated = mine.pointer.at;
      persist();
      return { room: publicRoom(target, mine, user) };
    }

    const now = Date.now();
    const room = {
      id: newRoomId(target),
      at: now,
      updated: now,
      closed: null,
      media,
      title: label,
      cap: ROOM_CAP,
      host: user.id,
      pointer: { ...wanted, at: now, by: user.id },
      start: null,
      members: { [user.id]: { joined: now, seen: now } },
      chat: [],
    };
    target.rooms[room.id] = room;
    trimRooms(target);
    persist();
    return { room: publicRoom(target, room, user) };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'join' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot join a room right now.');
    const room = openRoom(target, seg[1]);
    if (room.members[user.id]) {
      touchRoom(room, user.id);
      persist();
      return { room: publicRoom(target, room, user) };
    }
    if (roomRoster(room).length >= room.cap) fail(409, 'That room is full.');
    const now = Date.now();
    room.members[user.id] = { joined: now, seen: now };
    room.updated = now;
    persist();
    return { room: publicRoom(target, room, user) };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'leave' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const room = roomOf(target, seg[1]);
    if (!room.members[user.id]) return { ok: true, id: room.id, closed: !!room.closed };
    delete room.members[user.id];
    room.updated = Date.now();
    promoteHost(room);
    persist();
    return { ok: true, id: room.id, closed: !!room.closed };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'state' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const room = openRoom(target, seg[1]);
    if (room.host !== user.id) fail(403, 'Only the host can move the room.');
    const wanted = roomPointer(body);
    if (!wanted.ep) fail(400, 'That room needs an episode to move to.');
    if (body?.media != null && body.media !== '') room.media = int(body.media, 1, 2 ** 31 - 1);
    room.pointer = { ...wanted, at: Date.now(), by: user.id };
    room.start = null;
    room.updated = room.pointer.at;
    touchRoom(room, user.id);
    persist();
    return { room: publicRoom(target, room, user) };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'start' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const room = openRoom(target, seg[1]);
    if (room.host !== user.id) fail(403, 'Only the host can start the room.');
    const delay = int(body?.delay, 0, ROOM_START_MAX_MS);
    room.start = { at: Date.now() + delay, by: user.id };
    room.updated = Date.now();
    persist();
    return { room: publicRoom(target, room, user) };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'msg' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    if (user.muted) fail(403, 'This account cannot write in a room right now.');
    const room = openRoom(target, seg[1]);
    if (!room.members[user.id]) fail(403, 'You are not in that room.');
    const line = text(body?.text, ROOM_MSG_MAX, { required: true });
    const last = (room.chat || []).filter((m) => m.by === user.id).at(-1);
    if (last && Date.now() - last.at < ROOM_SPAM_MS) fail(429, 'Give that a moment before the next line.');
    const m = { id: newId(), by: user.id, text: line, at: Date.now() };
    room.chat = [...(room.chat || []), m].slice(-ROOM_CHAT_KEEP);
    room.updated = m.at;
    persist();
    return { message: { ...roomMessage(m, user), author: roomAuthor(target, m.by) } };
  }

  if (seg[0] === 'rooms' && seg[1] && seg[2] === 'close' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const room = openRoom(target, seg[1]);
    if (room.host !== user.id) fail(403, 'Only the host can close the room.');
    room.closed = Date.now();
    room.updated = room.closed;
    persist();
    return { ok: true, id: room.id };
  }

  if (seg[0] === 'rooms' && seg[1] && !seg[2] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    const room = openRoom(target, seg[1]);
    if (room.members[user.id]) {
      touchRoom(room, user.id);
      promoteHost(room);
      persist();
    }
    return { room: publicRoom(target, room, user) };
  }

  /* -- the notice bell ----------------------------------------------------
     Reading the bell is what triggers the comparison, because a folder has no
     timer of its own. `GET notices` returns what is stored even when AniList
     is unreachable: an outage delays a line, it never loses one. */
  if (seg[0] === 'notices' && !seg[1] && method === 'GET') {
    const user = need(target, viewer, allowSession);
    if (Date.now() - noticePollAt > NOTE_POLL_MS) await pollNotices(target);
    return { notes: noteFeed(target, user.id).slice(0, NOTE_KEEP), unread: unreadNotes(target, user.id) };
  }

  if (seg[0] === 'notices' && seg[1] === 'watch' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length > NOTE_WATCH_MAX) fail(400, 'That list is too long to follow.');
    const rec = target.watches[user.id] || (target.watches[user.id] = { at: Date.now(), synced: 0, ids: {} });
    if (!rec.ids || typeof rec.ids !== 'object') rec.ids = {};
    if (rec.synced && Date.now() - rec.synced < NOTE_SYNC_MS) fail(429, 'Give that a moment before the next list.');
    const next = {};
    for (const raw of items) {
      const media = int(raw?.id, 1, 2 ** 31 - 1);
      if (!media) continue;
      const title = text(raw?.title, NOTE_TITLE_MAX);
      const old = rec.ids[String(media)];
      next[String(media)] = old
        ? { seen: old.seen, status: old.status || '', title: title || old.title || '' }
        : { seen: null, status: '', title };
    }
    rec.ids = next;
    rec.at = Date.now();
    rec.synced = rec.at;
    noticePollAt = 0;
    persist();
    return { count: Object.keys(next).length, every: NOTE_POLL_MS };
  }

  if (seg[0] === 'notices' && seg[1] === 'read' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    const wanted = body?.id == null || body.id === '' ? null : text(body.id, 40);
    for (const n of noteFeed(target, user.id)) if (!wanted || n.id === wanted) n.read = true;
    persist();
    return { unread: unreadNotes(target, user.id) };
  }

  if (seg[0] === 'notices' && seg[1] === 'clear' && method === 'POST') {
    const user = need(target, viewer, allowSession);
    target.notes[user.id] = [];
    persist();
    return { notes: [], unread: 0 };
  }

  fail(404, 'That is not the right method.', 'no-route');
}