/**
 * Accounts, playlists and the community feed. Everything goes through the same
 * JSON API the local server mounts (see account-api.js), and the session rides
 * on an HttpOnly cookie — no token is ever kept where a script could read it.
 */

import { localStats, AVATAR_UPLOAD } from './ranks.js';
import { statsLocked } from './store.js';
import { cloudActive, cloudApi, captureSessionFromHash } from './cloud.js';

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

async function api(path, { method = 'GET', body } = {}) {
  if (cloudActive()) {
    try {
      return await cloudApi(path, { method, body });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(err?.status || 0, err?.message || 'Something went wrong. Try again.', err?.code);
    }
  }
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
  /* A Google redirect lands here with the token in the URL hash. */
  if (captureSessionFromHash()) {
    try {
      applySession(await api('account/me'));
      await pushStats(true);
      return state;
    } catch { /* fall through to the normal restore */ }
  }
  try {
    applySession(await api('account/me'));
  } catch (err) {
    set({ status: err.status === 0 ? 'offline' : 'signedout', user: null });
  }
  return state;
}

export async function login(email, password) {
  await api('account/login', { method: 'POST', body: { email, password } });
  await refresh();
  await pushStats(true);
  return state.user;
}

export async function signup({ email, password, username }) {
  await api('account/signup', { method: 'POST', body: { email, password, username } });
  await refresh();
  await pushStats(true);
  return state.user;
}

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
 * the whole record rather than merging into it.
 */
const avatarPayload = (user, photo, file = null) => ({
  glyph: user?.avatar?.glyph || 'fox',
  hue: Number(user?.avatar?.hue) || 0,
  photo: photo === undefined ? user?.avatar?.photo || null : photo,
  file,
});

/** Upload or clear the profile picture; `null` puts the fallback back. */
export async function setAvatar(photo) {
  const me = state.user;
  const body =
    photo == null
      ? { photo: null, file: null }
      : { photo: photo.dataUrl || photo, file: photo.fileUrl && photo.fileUrl.length <= AVATAR_UPLOAD.maxStored ? photo.fileUrl : null };
  const d = await api('account/avatar', { method: 'POST', body });
  set({ user: d.user || { ...me, avatar: avatarOfValue(me, body) } });
  return state.user;
}

/** The shape the server answers with, used when a cloud reply has no user. */
function avatarOfValue(user, body) {
  return { ...avatarPayload(user, body.photo, body.file) };
}

/** Name one title as the favourite. Pass an AniList media; pass null to clear. */
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

/* ---- playlists ------------------------------------------------------ */
function storePlaylists(list) {
  if (Array.isArray(list)) set({ playlists: list });
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
/* A profile is still readable by id — a comment link can open one — but nobody
   is ranked against anybody any more, so there is no leaderboard to ask for. */
export const publicProfile = (id) => api(`users/${id}`);

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

/** The address is the viewer's own, so it travels with each post, not at rest. */
export const tellDiscord = ({ url, text }) => api('hooks/discord', { method: 'POST', body: { url, text } });

/**
 * The live feed for one episode. Returns a closer, because a route change must
 * drop the socket instead of leaving a tab that nobody is looking at.
 */
export function followComments({ media, ep, onComment, onRemove, onError }) {
  if (cloudActive()) return () => {};
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
  source.addEventListener('error', () => {
    if (source.readyState === 2) onError?.();
  });
  return () => source.close();
}
