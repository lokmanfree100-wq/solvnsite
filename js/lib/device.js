/**
 * The API a static copy answers for itself.
 *
 * A folder on Netlify or htdocs has no `/api`, and this build does not pretend
 * otherwise: `data-api="off"` is still on `<html>`, so nothing knocks on a route
 * that cannot exist. What changes is that the pages which used to vanish with
 * the server — accounts, profiles, the card board, friends and messages — now
 * have a backend made of this browser's `localStorage`.
 *
 * It speaks the same route names and returns the same shapes as
 * `account-api.js`, which is why `lib/account.js` can hand it a path without
 * anything above it knowing which of the two answered. What it cannot do is
 * cross a device: an account here lives in one browser, and a message reaches
 * another person only if they sign in on the same one. The copy says that on the
 * sign-in sheet rather than promising a server it does not have.
 *
 * Passwords are kept as a salted digest, never as typed. On a secure origin the
 * digest is PBKDF2-SHA-256; a plain-http preview cannot reach `crypto.subtle`,
 * so it falls back to a salted string hash. That is a lock on a drawer, not a
 * vault: anything running on this page can read the same storage.
 */

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
const DM_MAX = 500;
const DM_PAGE = 120;
const DM_THREADS = 40;
const DM_FLOOR = 4;
const DM_SPAM_MS = 2500;
const PIN_MAX = 6;
const HOUSE = 'solvn';

const fail = (status, message, code) => {
  throw Object.assign(new Error(message), { status, code: code || `http-${status}` });
};

const fold = (value) => String(value || '').toLowerCase().replace(/\s+/g, '');
const pairKey = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);
const newId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const houseFace = () => {
  try {
    return new URL('assets/solvn-cat.jpg', document.baseURI).href;
  } catch {
    return '';
  }
};

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
  for (const key of ['users', 'byEmail', 'byName', 'dms', 'friendship', 'friendReqs', 'playlists']) {
    base[key] = raw[key] && typeof raw[key] === 'object' ? raw[key] : {};
  }
  base.session = typeof raw.session === 'string' ? raw.session : null;
  base.seeded = raw.seeded === true;
  return base;
}

function seed(target) {
  if (target.seeded) return;
  target.seeded = true;
  if (target.users.solvn) return;
  const user = {
    id: 'solvn',
    userId: ADMIN_USER_ID,
    email: 'solvn@solvn.local',
    username: HOUSE,
    displayName: 'Solvn',
    bio: 'The house account. This copy of Solvn keeps accounts, friends and messages in your browser.',
    avatar: { glyph: 'fox', hue: 265, photo: houseFace(), file: null, face: null },
    banner: null,
    cards: null,
    title: null,
    isAdmin: true,
    createdAt: Date.UTC(2025, 0, 1),
    stats: { hours: 0, episodes: 0, completed: 0, titles: 0, badges: [], xp: 0, level: MAX_LEVEL, updatedAt: 0 },
    duel: { wins: 0, losses: 0, streak: 0, best: 0, fought: 0 },
    unlocks: { banners: [], avatars: [], faces: 0 },
    fortune: { day: null, at: 0, prize: null, spins: 0, faces: 0 },
    salt: '',
    hash: '',
  };
  target.users[user.id] = user;
  target.byName[HOUSE] = user.id;
}

function data() {
  if (db) return db;
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch { /* junk in storage counts as a first visit */ }
  db = normalise(raw);
  seed(db);
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
      isAdmin: viewer.isAdmin === true,
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

function welcome(target, member) {
  const pair = pairKey(member.id, HOUSE);
  if (Object.values(target.dms).some((m) => m.pair === pair && m.from === HOUSE)) return;
  const message = {
    id: newId(),
    pair,
    from: HOUSE,
    to: member.id,
    text: `Welcome to Solvn, ${member.displayName || member.username}. This build keeps accounts, friends and messages inside your browser. The card binder is under More — open a pack, then pin your best card to the board.`,
    at: Date.now(),
    read: false,
  };
  target.dms[message.id] = message;
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
    if (target.byName[nameKey]) fail(409, 'That name is taken.');

    const salt = randomSalt();
    const user = {
      id: newId(),
      userId: freshUserId(target),
      email,
      username,
      displayName: username,
      bio: '',
      avatar: avatarOf({ hue: Math.floor(Math.random() * 360) }),
      banner: null,
      cards: null,
      title: null,
      favourite: null,
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
    /* A duel is settled by two browsers through a shared server. This copy has
       neither the second browser nor the server, so the board is honestly
       empty instead of inventing a record. */
    const me = openSession(target, viewer, allowSession);
    return {
      users: [],
      me: null,
      totals: { members: Object.keys(target.users).length, duellists: 0, fights: 0, runs: 0 },
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
    /* The house account is the one member this copy can answer for, so a
       request to it lands instead of waiting for somebody who is not here.
       The greeting is the proof that Messages works on a single browser. */
    if (isAdmin(other)) {
      befriend(target, user.id, other.id);
      welcome(target, user);
      persist();
      return { state: 'friend' };
    }
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

  fail(404, 'That is not the right method.', 'no-route');
}