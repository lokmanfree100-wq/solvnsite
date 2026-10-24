/**
 * Accounts, playlists and the community feed. Everything goes through the same
 * JSON API the local server mounts (see account-api.js), and the session rides
 * on an HttpOnly cookie — no token is ever kept where a script could read it.
 */

import { localStats, AVATAR_UPLOAD, BANNER_UPLOAD } from './ranks.js';
import { statsLocked } from './store.js';
import {
  authReady,
  captureFromRedirect,
  cloudActive,
  cloudApi,
  requestPasswordReset,
  updatePassword,
} from './cloud.js';
import { deviceApi } from './device.js';

const listeners = [];
let lastPush = '';
/* Flipped by the first call that gets a web page back instead of JSON: a plain
   host answers `/api/anything` with index.html, which is how a static deploy
   discovers it has no server. */
let noServer = false;

const state = {
  status: 'unknown', // unknown | signedout | signedin | offline
  user: null,
  playlists: [],
};

export function account() {
  return state;
}

export const isSignedIn = () => state.status === 'signedin';
export const currentUser = () => state.user;

/**
 * The name to put on screen. `username` is the handle picked at registration
 * and it never changes — links, mentions and reports all point at it — so
 * every place a person is *shown* a name uses this, and it falls back to the
 * handle for an account that has not chosen one.
 */
export const shownName = (user) => user?.displayName || user?.username || '';

/**
 * The one handle that opens the staff doors, and the only place the client
 * decides who holds it.
 *
 * It mirrors the server exactly: `ADMIN_NAMES` in the API is the set
 * `{'solvn'}` and `isAdmin()` there lower-cases and strips whitespace before
 * comparing — the same normalisation registration uses to refuse a duplicate
 * name. So `Solvn`, ` solvn ` and `SOLVN` all resolve to the one account that
 * cannot be claimed twice, and no case or space trick squats it.
 *
 * A signed-in account is required, because an empty handle normalises into a
 * name and a nameless visitor must match nothing. And a `false` on the account
 * record vetoes the whole thing: when a backend says this user is not staff, the
 * name alone is not enough.
 *
 * This is a visibility check, not a permission check. Every admin route answers
 * 403 to a non-admin whatever the browser thinks, so hiding a toolbar is about
 * not showing a control that cannot work — the door is locked on the server.
 */
export const STAFF_HANDLES = ['solvn'];
const handleKey = (text) => String(text || '').toLowerCase().replace(/\s+/g, '');
/** The handle alone answers it, exactly as the server's `ADMIN_NAMES` does —
    this is the rule, and both backends and both gated screens read this one. */
export const holdsStaffHandle = (username) => STAFF_HANDLES.includes(handleKey(username));
export function isStaff(user = currentUser()) {
  if (!isSignedIn() || !user) return false;
  if (user.isAdmin === false) return false;
  return holdsStaffHandle(user.username);
}

/**
 * Is this copy of the site running without its server?
 *
 * The static export puts `data-api="off"` on `<html>` because a folder of files
 * on a plain web host has no `/api` at all: accounts, comments, playlists and
 * the Discord bridge could only ever fail there, so those controls are left out
 * instead of drawn. The second half is the runtime version of the same test, for
 * somebody who uploads `public/` by hand — see `api()`.
 */
export const staticHost = () => document.documentElement.dataset.api === 'off' || noServer;

export function onAccount(fn) {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn), 1);
}

function set(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
  document.dispatchEvent(new CustomEvent('kitsune:account'));
}

/** Messages the server could not translate arrive as codes; the UI maps them. */
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `http-${status}`;
  }
}

/* Auth routes go to Supabase as soon as a verified project is configured —
   there is no session to spend yet, which is exactly what they are for. The
   plain `account/me` probe goes with them so a cloud device reports "signed
   out" instead of knocking on a server it does not use. Everything that writes
   waits for `cloudActive()`, because a token has to be behind it. */
const AUTH_ROUTE = /^account\/(signup|login|logout)$/;
/* The account fields a verified Supabase project owns. On a static copy every
   other route is answered by `lib/device.js`, so friends and messages still
   work even when the member signed in through the cloud. */
const CLOUD_OWN = /^account\/(me|avatar|stats|cards)$|^favourite$/;

const wrapCloud = async (path, opts) => {
  try {
    return await cloudApi(path, opts);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.status || 0, err?.message || 'Something went wrong. Try again.', err?.code);
  }
};

const wrapDevice = async (path, opts) => {
  try {
    return await deviceApi(path, opts, state.status === 'signedin' ? state.user : null, !authReady());
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.status || 0, err?.message || 'Something went wrong. Try again.', err?.code);
  }
};

async function api(path, { method = 'GET', body } = {}) {
  const opts = { method, body };
  /* Without a server the browser is the backend. A verified cloud project still
     keeps the account fields it owns, but the social pages beside them belong to
     this device — a folder on a plain host has no other place to keep a chat. */
  if (staticHost()) {
    const route = path.split('?')[0];
    if ((cloudActive() && CLOUD_OWN.test(route)) || (authReady() && AUTH_ROUTE.test(route))) {
      return wrapCloud(path, opts);
    }
    return wrapDevice(path, opts);
  }
  const authOnly = authReady() && (AUTH_ROUTE.test(path) || path === 'account/me');
  if (cloudActive() || authOnly) return wrapCloud(path, opts);
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'The site could not be reached.', 'offline');
  }
  /* An origin with no API behind it answers every unknown path with the page
     itself. Treating that as "signed out" would leave a Sign-in button on screen
     that cannot do anything, so it is reported as the missing server it is. */
  if (!(res.headers.get('content-type') || '').includes('json')) {
    /* Only a *successful* page counts: a 404 or a 500 from our own server is
       still just an HTTP error, and must not put the whole app in offline mode. */
    if (res.ok) {
      noServer = true;
      throw new ApiError(0, 'The site could not be reached.', 'offline');
    }
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* an empty 204 or a stray HTML page */ }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Something went wrong. Try again.', data?.code);
  }
  return data || {};
}

/* ---- session -------------------------------------------------------- */
export function applySession(data) {
  set({
    status: data?.user ? 'signedin' : 'signedout',
    user: data?.user || null,
    playlists: data?.playlists || state.playlists,
  });
  return state.user;
}

/** Called once at boot. A dead server is not an error page — just stay quiet. */
export async function restore() {
  /* A password-reset link — and a Google sign-in — land here carrying their
     credentials in the address. A recovery is not a sign-in yet: the session it
     hands over exists only so the new password can be written to it. */
  const landed = await captureFromRedirect();
  if (landed) {
    recoveryWaits = landed === 'recovery';
    try {
      applySession(await api('account/me'));
      if (landed === 'session') await pushStats(true);
      return state;
    } catch { /* fall through to the normal restore */ }
  }
  try {
    applySession(await api('account/me'));
  } catch (err) {
    /* The first request is also how a hand-uploaded copy discovers it has no
       server: the host answered with the page itself. That flips `staticHost`,
       so ask once more — this time the device backend answers — instead of
       leaving a member with a saved device session signed out. */
    if (staticHost()) {
      try {
        applySession(await api('account/me'));
        return state;
      } catch { /* fall through to the honest signed-out state */ }
    }
    set({ status: err.status === 0 ? 'offline' : 'signedout', user: null });
  }
  return state;
}

/* Set when an email link arrives asking for a new password; read once by the
   boot code, which then opens the sheet. */
let recoveryWaits = false;

export function takeRecovery() {
  const was = recoveryWaits;
  recoveryWaits = false;
  return was;
}

export async function login(email, password) {
  await api('account/login', { method: 'POST', body: { email, password } });
  await refresh();
  await pushStats(true);
  return state.user;
}

/**
 * Create the account. `needsVerify` is the project asking for a confirmed
 * address first: the row exists, this browser has no session, and the welcome
 * has to say "check your email" instead of welcoming somebody who is not in.
 */
export async function signup({ email, password, username }) {
  const res = await api('account/signup', { method: 'POST', body: { email, password, username } });
  await refresh();
  await pushStats(true);
  return { user: state.user, needsVerify: res?.signedIn === false };
}

/** Email a reset link. Only ever offered with a connected Supabase project. */
export const forgotPassword = (email) => requestPasswordReset(email);

/** Last step of a recovery: write the new password onto the session the link brought. */
export async function setNewPassword(password) {
  await updatePassword(password);
  await refresh();
  await pushStats(true);
  return state.user;
}

/**
 * Can this copy sign anybody in at all?
 *
 * `staticHost()` means "no Node server behind these files", which used to be
 * the same thing as "no accounts". Two things broke that equation: a verified
 * Supabase project answers sign-up and sign-in from the browser, and without
 * one `lib/device.js` keeps the accounts itself. Either way the sheet can sign
 * somebody in, so the answer is always yes.
 */
export const authUsable = () => true;

export async function logout() {
  try {
    await api('account/logout', { method: 'POST' });
  } finally {
    set({ status: 'signedout', user: null, playlists: [] });
  }
}

export async function refresh() {
  applySession(await api('account/me'));
  return state.user;
}

export function patchMe(patch) {
  return api('account/me', { method: 'PATCH', body: patch }).then((d) => {
    set({ user: d.user || state.user });
    return d.user;
  });
}

/* ---- what a member chooses about themselves -------------------------
   Both are server fields, so a picture or a favourite anime follows the person
   onto another device. Each one takes the account store's own user object in
   the same breath it saves, so the nav chip repaints without a reload. */

/**
 * The avatar as the API stores it. The glyph and hue a member already chose
 * ride along with the new picture, because `POST /api/account/avatar` replaces
 * the whole record rather than merging into it — so exactly one source is ever
 * filled: `photo`/`file` for bytes the browser produced, `face` for a gallery
 * portrait or a link somebody pasted.
 */
const avatarPayload = (user, { photo = null, file = null, face = null } = {}) => ({
  glyph: user?.avatar?.glyph || 'fox',
  hue: Number(user?.avatar?.hue) || 0,
  photo,
  file,
  face,
});

/**
 * Set or clear the profile picture.
 * Pass null to put the fallback back, an upload result to store bytes, or an
 * `https://` address to point the profile at a picture that stays elsewhere.
 */
export async function setAvatar(source) {
  const me = state.user;
  let body;
  if (source == null) body = {};
  else if (typeof source === 'string') body = { face: source };
  else {
    body = {
      photo: source.dataUrl || null,
      file: source.fileUrl && source.fileUrl.length <= AVATAR_UPLOAD.maxStored ? source.fileUrl : null,
    };
  }
  const d = await api('account/avatar', { method: 'POST', body });
  set({ user: d.user || { ...me, avatar: avatarPayload(me, body) } });
  return state.user;
}

/**
 * The band behind a profile as the API stores it: exactly one source is filled,
 * because `PATCH /api/account/me` replaces the whole record rather than merging
 * into it — `theme` for one of the animation pairs, `photo`/`file` for bytes the
 * browser produced, `url` for a picture that stays elsewhere.
 */
const bannerPayload = (user, { theme = null, photo = null, file = null, url = null } = {}) => ({
  hue: Number(user?.banner?.hue) || 210,
  theme,
  photo,
  file,
  url,
});

/**
 * Set or clear the profile background.
 * Pass null to go back to the plain band, a `{ theme }` to wear one of the
 * gallery animations, an upload result to store bytes, or an `https://` address
 * to point at a picture that stays elsewhere.
 */
export async function setBanner(source) {
  const me = state.user;
  let body;
  if (source == null) body = {};
  else if (typeof source === 'string') body = { url: source };
  else if (typeof source.theme === 'string') body = { theme: source.theme };
  else {
    body = {
      photo: source.dataUrl || null,
      file: source.fileUrl && source.fileUrl.length <= BANNER_UPLOAD.maxStored ? source.fileUrl : null,
    };
  }
  const banner = bannerPayload(me, body);
  const d = await api('account/me', { method: 'PATCH', body: { banner } });
  set({ user: d.user || { ...me, banner } });
  return state.user;
}

/**
 * Wear one earned title next to the name, or none at all. The account only
 * stores the id — which titles the figures on this record unlock is worked out
 * from `TITLES` on whichever screen shows it, so a visitor sees the same answer
 * as the owner.
 */
export async function setTitle(id) {
  const me = state.user;
  const d = await api('account/me', { method: 'PATCH', body: { title: id || null } });
  set({ user: d.user || { ...me, title: id || null } });
  return state.user;
}

/** Pick the one series this profile names as its favourite. Pass null to clear. */
export function setFavourite(media) {
  const value = media
    ? {
        id: Number(media.id),
        title: media.title?.romaji || media.title?.english || media.title?.native || 'Untitled',
        image: media.coverImage?.large || media.coverImage?.extraLarge || null,
      }
    : null;
  return api('favourite', { method: 'POST', body: value || {} }).then((d) => {
    set({ user: d.user || { ...state.user, favourite: d.favourite ?? null } });
    return state.user?.favourite ?? null;
  });
}

/* ---- stats ---------------------------------------------------------- */
/**
 * Upload what this device has watched. Signing in calls it with force, so a new
 * account starts with real numbers instead of a zero; later calls only write
 * when the figures actually moved. Nothing on the profile shows any of this —
 * it is kept for the gated /admin dashboard, which still reads the server copy.
 */
export async function pushStats(force = false) {
  if (!isSignedIn()) return null;
  /* The admin page pins these figures while it previews a rank or badge. */
  if (statsLocked()) return state.user;
  const stats = localStats({
    playlists: state.playlists.filter((p) => p.visibility === 'public').length,
  });
  const body = {
    hours: stats.hours,
    episodes: stats.episodes,
    completed: stats.completed,
    titles: stats.titles,
    badges: stats.badges,
    /* The ladder rides along with the watch counters because this route replaces
       the whole stats object: a summary without them would store a level 1 over
       somebody who had just reached twenty. */
    xp: stats.xp,
    level: stats.level,
  };
  const signature = JSON.stringify(body);
  if (!force && signature === lastPush) return state.user;
  lastPush = signature;
  try {
    const d = await api('account/stats', { method: 'PUT', body });
    set({ user: d.user || state.user });
    return d.user;
  } catch {
    lastPush = ''; // the next watch should try again
    return null;
  }
}

/* ---- the published card summary ------------------------------------- */
/**
 * Put this device's card report on the account record, or take it back down.
 *
 * The binder is deliberately storage-local, so a profile page and the global
 * leaderboard can only work from the short summary the client hands over here.
 * It arrives already built by `lib/cards.js` — this module knows nothing about
 * cards and must not start importing them: `cards.js` already imports *this*
 * file for `currentUser()` and `isStaff()`, and that loop would be a module
 * cycle for the sake of a number.
 *
 * Failures are not swallowed here: a pin the member just tapped must be able to
 * say it did not land, while the automatic publish after a pack catches its own.
 */
export async function pushCards(cards) {
  if (!isSignedIn()) return null;
  const d = await api('account/cards', { method: 'PUT', body: { cards: cards || null } });
  set({ user: d.user || state.user });
  /* Read the stored copy back out of the reply rather than returning what was
     sent: the local API normalises the summary, and a hand-tweaked power or tier
     would otherwise be reported to the caller as if it had been accepted. */
  return state.user?.cards ?? null;
}

/* ---- playlists ------------------------------------------------------ */
function storePlaylists(list) {  if (Array.isArray(list)) set({ playlists: list });
  return list;
}

export function createPlaylist({ title, items = [], visibility = 'public' }) {
  return api('playlists', { method: 'POST', body: { title, items, visibility } }).then((d) => {
    set({ playlists: [d.playlist, ...state.playlists] });
    pushStats();
    return d.playlist;
  });
}

export function patchPlaylist(id, patch) {
  return api(`playlists/${id}`, { method: 'PATCH', body: patch }).then((d) => {
    storePlaylists(state.playlists.map((p) => (p.id === id ? d.playlist : p)));
    return d.playlist;
  });
}

export function deletePlaylist(id) {
  return api(`playlists/${id}`, { method: 'DELETE' }).then(() => {
    storePlaylists(state.playlists.filter((p) => p.id !== id));
    pushStats();
  });
}

/** Toggles on the server, so the caller paints whatever count comes back. */
export function likePlaylist(id) {
  return api(`playlists/${id}/like`, { method: 'POST' }).then((d) => {
    storePlaylists(state.playlists.map((p) => (p.id === d.playlist.id ? d.playlist : p)));
    return d.playlist;
  });
}

/* ---- community ------------------------------------------------------ */
/* A profile is still readable by id — a comment link can open one. The board
   that ranks people now ranks one thing only: the strongest card a member chose
   to publish. Watch hours are not on it, because hours count viewing and cards
   count collecting. */
export const publicProfile = (id) => api(`users/${id}`);

/** The card board, ranked on the highest Power each member published. */
export const collectors = (n = 20) => api(`community/collectors?n=${n}`);

/** Members whose @handle, display name or user ID matches this term, best first. */
export const searchMembers = (q) => api(`members?q=${encodeURIComponent(String(q || '').trim().slice(0, 24))}`);

/* ---- friends ----------------------------------------------------------
   A request and a friendship are both the same pair of accounts, so the two
   sides read one word for `state` and the buttons follow from it. */
export const friendsList = () => api('friends');
export const askFriend = (id) => api('friends/request', { method: 'POST', body: { id } });
export const answerFriend = (id, accept) => api('friends/answer', { method: 'POST', body: { id, accept } });
export const dropFriend = (id) => api(`friends/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** kind is 'user' or 'playlist'; the server files it for an admin to read. */
export const reportFlag = ({ kind, id, reason }) =>
  api('reports', { method: 'POST', body: { kind, id, reason } });

/* ---- admin ---------------------------------------------------------- */
/* These four routes only exist on the local server, and only answer for a
   name in ADMIN_NAMES. Cloud mode simply gets a 403 back. */
export const adminUsers = () => api('admin/users');
export const adminPatchUser = (id, patch) => api(`admin/users/${id}`, { method: 'PATCH', body: patch });
export const adminReports = () => api('admin/reports');
export const adminPatchReport = (id, status) => api(`admin/reports/${id}`, { method: 'PATCH', body: { status } });
export const adminComments = () => api('admin/comments');

/* ---- comments ------------------------------------------------------- */
/* Threads are per episode on this server only. A Supabase project has no
   comment table, so the UI hides the panel in cloud mode rather than posting
   into a 404. */
export const commentsFor = (media, ep) => api(`comments?media=${media}&ep=${ep}`);
export const postComment = ({ media, ep, text }) => api('comments', { method: 'POST', body: { media, ep, text } });
export const removeComment = (id) => api(`comments/${id}`, { method: 'DELETE' });

/**
 * Every social page has somewhere to write, whichever host it lands on.
 *
 * A served copy keeps deals, fights, the wheel, rooms and the bell in the
 * server's file. A static copy answers the same routes from `lib/device.js`,
 * which stores them in this browser — the same place messages and friends
 * already live there. The two backends return the same shapes, so a page does
 * not need to know which one answered, and nothing is hidden from the export.
 *
 * The honest limit is reach, not presence: a deal or a duel on a plain host is
 * between accounts that signed in on the same browser, and a notice compares
 * air dates from this device's own list rather than from a timer that runs
 * while the tab is shut. The pages say so where it matters.
 */
export const socialUsable = () => true;

/* ---- private messages -------------------------------------------------
   On a served copy a chat lives in the server's file; on a static copy it lives
   in this browser (see `lib/device.js`). Either way there is a real place to put
   a line, so the page and its links are offered. What is *not* offered is the
   server-only half of the community — deals, duels, the wheel, rooms and the
   bell — which all answer through the same switch below. */
export const messagesUsable = () => true;
export const inboxThreads = () => api('dms');
export const messageThread = (withId) => api(`dms/thread?with=${encodeURIComponent(withId)}`);
export const sendMessage = ({ to, text }) => api('dms', { method: 'POST', body: { to, text } });
export const markThreadRead = (withId) => api('dms/read', { method: 'POST', body: { with: withId } });
export const removeMessage = (id) => api(`dms/${id}`, { method: 'DELETE' });

/* ---- trades ------------------------------------------------------------
   The server keeps the deal, never the card: both lists are written into the
   offer and it completes when the two members in it have each signed. `lib/
   cards.js` is what moves the binder, so a trade page always reconciles the two
   together — see `lib/trades.js`. */
export const tradesUsable = () => socialUsable();
export const tradeList = () => api('trades');
export const offerTrade = ({ to, give, want, note }) => api('trades', { method: 'POST', body: { to, give, want, note } });
export const signTrade = (id) => api(`trades/${encodeURIComponent(id)}/sign`, { method: 'POST', body: {} });
export const amendTrade = (id, side) => api(`trades/${encodeURIComponent(id)}/amend`, { method: 'POST', body: side });
export const cancelTrade = (id) => api(`trades/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });

/** The address is the viewer's own, so it travels with each post, not at rest. */
export const tellDiscord = ({ url, text }) => api('hooks/discord', { method: 'POST', body: { url, text } });

/* ---- duels -------------------------------------------------------------
   The server holds the record — both line-ups, who signed, and the win/loss
   tally — and the fight itself is run on each device from the one seed it hands
   back. `lib/duels.js` is where that engine lives; these are only the wires. */
export const duelsUsable = () => socialUsable();
export const duelList = () => api('duels');
export const offerDuel = ({ to, cards, note }) => api('duels', { method: 'POST', body: { to, cards, note } });
export const queueDuel = (cards) => api('duels/queue', { method: 'POST', body: { cards } });
export const leaveDuelQueue = () => api('duels/queue/leave', { method: 'POST', body: {} });
export const commitDuel = (id, cards) => api(`duels/${encodeURIComponent(id)}/sign`, { method: 'POST', body: { cards } });
export const fileDuel = (id, { winner, score }) =>
  api(`duels/${encodeURIComponent(id)}/result`, { method: 'POST', body: { winner, score } });
export const cancelDuel = (id) => api(`duels/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });

/* ---- the daily wheel ----------------------------------------------------
   The roll happens on the server, so the answer cannot be re-spun until the page
   likes it, and the odds printed on the wheel are the weights that ran. */
export const fortuneUsable = () => socialUsable();
export const fortuneRead = () => api('fortune');
export const fortuneSpin = () => api('fortune/spin', { method: 'POST', body: {} });
export const fortuneFace = (face) => api('fortune/pick', { method: 'POST', body: { face } });

/** Duel wins first, then win rate, then the strongest card. Staff sit it out. */
export const rankedBoard = () => api('community/ranked');

/* ---- watch together -------------------------------------------------------
   A room shares the two things a watch page can actually control from outside a
   third-party frame — the episode and the track — plus who is standing in it, a
   countdown both ends reload their player on, and a chat. Nothing here claims to
   move a playhead, because nothing here can. Rooms live in this server's file like
   messages do, so the same flag decides whether the watch page offers one. */
export const roomsUsable = () => socialUsable();
export const roomList = () => api('rooms');
export const roomRead = (id) => api(`rooms/${encodeURIComponent(id)}`);
export const roomStart = ({ media, title, ep, audio }) => api('rooms', { method: 'POST', body: { media, title, ep, audio } });
export const roomJoin = (id) => api(`rooms/${encodeURIComponent(id)}/join`, { method: 'POST', body: {} });
export const roomLeave = (id) => api(`rooms/${encodeURIComponent(id)}/leave`, { method: 'POST', body: {} });
export const roomMove = (id, { media, ep, audio }) => api(`rooms/${encodeURIComponent(id)}/state`, { method: 'POST', body: { media, ep, audio } });
export const roomCount = (id, delay) => api(`rooms/${encodeURIComponent(id)}/start`, { method: 'POST', body: { delay } });
export const roomSay = (id, text) => api(`rooms/${encodeURIComponent(id)}/msg`, { method: 'POST', body: { text } });
export const roomClose = (id) => api(`rooms/${encodeURIComponent(id)}/close`, { method: 'POST', body: {} });

/* ---- notices ----------------------------------------------------------------
   The bell. AniList owns air dates, so this server compares what a member was
   last told about against what the catalogue says is out; the browser's only job
   is to hand up the titles it has saved. Those lists live on the device, not in
   the account, which is why the list travels as ids rather than being read here. */
export const noticesUsable = () => socialUsable();
export const noticeList = () => api('notices');
export const followWatch = (items) => api('notices/watch', { method: 'POST', body: { items } });
export const readNotice = (id) => api('notices/read', { method: 'POST', body: id ? { id } : {} });
export const clearNotices = () => api('notices/clear', { method: 'POST', body: {} });

/**
 * The live feed for one episode. Returns a closer, because a route change must
 * drop the socket instead of leaving a tab that nobody is looking at.
 */
export function followComments({ media, ep, onComment, onRemove, onError }) {
  if (staticHost() || cloudActive()) return () => {};
  const source = new EventSource(`/api/comments/stream?media=${media}&ep=${ep}`);
  source.addEventListener('comment', (e) => {
    try {
      onComment(JSON.parse(e.data));
    } catch { /* a frame we cannot read is worth one dropped comment, not a crash */ }
  });
  source.addEventListener('remove', (e) => {
    try {
      onRemove(JSON.parse(e.data));
    } catch { /* same */ }
  });
  return () => source.close();
}

/**
 * The inbox pipe. One socket carries every conversation the signed-in member
 * has, because the server files the feed by person rather than by pair — that is
 * what lets the unread badge in the navigation stay live with nobody looking at
 * the Messages page, and what a later notice bell will ride on too.
 *
 * It is opened once, by `lib/dms.js`, and only for a signed-in member: a socket
 * that the server would answer with 401 is a socket the browser would retry
 * forever. Returns a closer like the comment feed does.
 */
export function followInbox({ onMessage, onRemove, onSeen, onTrade, onNotice, onDuel, onFriend, onError }) {
  /* The device inbox has no socket: every write happens in this tab, and the
     page that made it already knows. A feed opened against a static host would
     only retry a route that does not exist. */
  if (staticHost() || cloudActive() || !isSignedIn()) return () => {};
  const source = new EventSource('/api/dms/inbox');
  const read = (e, fn) => {
    try {
      fn(JSON.parse(e.data));
    } catch { /* an unreadable frame costs one line, not the feed */ }
  };
  source.addEventListener('dm', (e) => read(e, onMessage));
  source.addEventListener('remove', (e) => read(e, onRemove));
  source.addEventListener('seen', (e) => read(e, onSeen));
  /* A trade travels on the same pipe as a message: it is the same person's inbox,
     and a deal that moved without either end noticing is a deal nobody trusts. */
  source.addEventListener('trade', (e) => read(e, onTrade));
  /* An episode that landed is a message from the catalogue rather than from a
     person, but it arrives in the same inbox and wants the same liveness, so it
     travels on this pipe too instead of asking for a second socket per person. */
  source.addEventListener('notice', (e) => read(e, onNotice));
  /* A duel is announced the same way a trade is: it is a thing that happened to
     this person, and a challenge that arrived without the page noticing is a
     challenge nobody answers. */
  source.addEventListener('duel', (e) => read(e, onDuel));
  /* A request or an acceptance, on the same feed: the friends panel redraws
     itself instead of being polled while the page is open. */
  source.addEventListener('friend', (e) => read(e, onFriend));
  source.addEventListener('error', () => {
    if (source.readyState === 2) onError?.();
  });
  return () => source.close();
}

/**
 * One room's pipe. The server attaches it only for a member of that room, so this
 * runs *after* a join and never instead of one — and it is held by `lib/rooms.js`,
 * which closes it when no watch page is looking at the party any more. Every event
 * carries the room in the shape its receiver is allowed to see, so a push needs no
 * second read.
 */
export function followRoom({ id, onRoom, onSync, onStart, onHost, onMsg, onClosed, onError }) {
  if (staticHost() || cloudActive() || !isSignedIn()) return () => {};
  const source = new EventSource(`/api/rooms/stream?id=${encodeURIComponent(id)}`);
  const read = (e, fn) => {
    try {
      fn(JSON.parse(e.data));
    } catch { /* an unreadable frame costs one line, not the feed */ }
  };
  source.addEventListener('room', (e) => read(e, onRoom));
  source.addEventListener('sync', (e) => read(e, onSync));
  source.addEventListener('start', (e) => read(e, onStart));
  source.addEventListener('host', (e) => read(e, onHost));
  source.addEventListener('msg', (e) => read(e, onMsg));
  source.addEventListener('closed', (e) => read(e, onClosed));
  source.addEventListener('error', () => {
    if (source.readyState === 2) onError?.();
  });
  return () => source.close();
}
