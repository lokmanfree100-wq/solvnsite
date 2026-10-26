/**
 * Optional Supabase backend. When a verified project is configured in Settings,
 * the same account calls this adapter instead of the local JSON API; without a
 * configuration nothing here runs and Solvn stays on server.js.
 *
 * Only the public anon key is ever kept here, and only in this browser. The
 * session is kept in localStorage with its refresh token, because a phone
 * browser does not have tabs: a session that dies with the tab means every
 * return visit is signed out, and the profile page falls back to this device's
 * local history. Supabase's own client persists sessions the same way. The
 * trade is that a script injected into this page could read the token — which
 * is why nothing here ever stores the project's secret key.
 */

const KEY = 'kitsune:cloud';
const TOKEN = 'kitsune:cloud:token'; // legacy: the sessionStorage copy this file used before
const SESSION = 'kitsune:cloud:session';
/* Refresh a little early so a request never travels on a token that expires
   between here and the project. */
const EXPIRY_LEEWAY_MS = 60 * 1000;

/* ---- the permanent home -----------------------------------------------
   solvn.site is wired to the one central Solvn Supabase project in code: no
   per-browser Settings step, every visitor meets the same database. The key
   here is publishable by design — it can only do what row-level security
   allows — and the secret key is never part of any file. On any other host
   (the LAN preview, a hand-uploaded folder) the Settings flow below still
   rules, so a second project can be tested without touching this default. */
export const HOME_HOST = 'solvn.site';

const BUILT_IN = {
  url: 'https://omefwehdgfifeoibisth.supabase.co',
  /* Publishable, by design public. Row-level security is the door. */
  key: 'sb_publishable_YKm0-DevDi__Ua5xH9T6Ig_t_Vbze4p',
};

/** Is this copy running on the permanent domain? */
export const homeCloud = () => {
  try {
    return /(^|\.)solvn\.site$/i.test(location.hostname);
  } catch {
    return false;
  }
};

export function cloudConfig() {
  if (homeCloud()) return { ...BUILT_IN, verified: true, builtin: true };
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch { /* junk in storage counts as unconfigured */ }
  if (!raw || typeof raw.url !== 'string' || typeof raw.key !== 'string') return null;
  const url = baseUrl(raw.url);
  if (!url) return null;
  return { url, key: raw.key.trim(), verified: raw.verified === true };
}

export const cloudActive = () => {
  const cfg = cloudConfig();
  return cfg && cfg.verified && schema.state !== 'missing' && token() ? cfg : null;
};

/* ---- has that database actually been built? --------------------------
   On the permanent domain the project address is compiled in, so `verified` is
   a promise this bundle makes rather than one the browser has checked. The
   promise only holds once the Solvn tables exist: until they do, a cloud
   sign-up would open an account that every later read answers 404 on, and a
   form whose only reply is a thin line of red text reads, to the person holding
   it, like a button that does nothing. So ask once at boot and let the answer
   choose between the cloud and this device.

   `wait` means "not yet known, assume the cloud" — an unreachable project must
   not quietly move somebody off the account they already have. */
const schema = { state: homeCloud() ? 'wait' : 'none' };

export async function verifyCloudSchema() {
  if (schema.state !== 'wait') return schema.state === 'live';
  const cfg = cloudConfig();
  if (!cfg) {
    schema.state = 'none';
    return false;
  }
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/kitsune_ready`, {
      method: 'POST',
      headers: headers(cfg, false),
      body: 'null',
    });
    if (res.ok) {
      schema.state = (await res.json()) === true ? 'live' : 'missing';
    } else {
      /* Only "this project has no Solvn schema" moves the site to the device
         backend. A 5xx or a rate limit is the project being briefly itself, and
         guessing from that would split one account across two stores. */
      schema.state = res.status === 404 || res.status === 425 ? 'missing' : 'wait';
    }
  } catch {
    schema.state = 'wait';
  }
  /* The sheet, the chip and the Settings panel all read this, so say when the
     answer lands rather than waiting for the next route change. */
  document.dispatchEvent(new CustomEvent('kitsune:account'));
  return schema.state === 'live';
}

export const cloudSchemaMissing = () => schema.state === 'missing';

/** Saved but not yet proven — the Google button waits for `verified`. */
export function saveCloudConfig({ url, key }) {
  const base = baseUrl(url || '');
  if (!base) throw badRequest('That project URL does not look right.', 'bad-url');
  if (!/^[A-Za-z0-9_-]{16,}$/.test((key || '').trim())) throw badRequest('That key does not look right.', 'bad-key');
  localStorage.setItem(KEY, JSON.stringify({ url: base, key: key.trim(), verified: false }));
  setToken(null);
  return cloudConfig();
}

export function clearCloudConfig() {
  localStorage.removeItem(KEY);
  setToken(null);
  localStorage.removeItem(FLOW);
  sessionStorage.removeItem(AWAITING);
}

/**
 * Is a Supabase project configured *and* proven?
 *
 * This is the one that decides whether the sign-in sheet may offer email
 * sign-up, "Forgot password?" and Google at all. `cloudActive()` below is the
 * stricter question — "is there a session to spend" — and an adapter that only
 * answered that one could never open a session in the first place.
 */
export const authReady = () => Boolean(cloudConfig()?.verified) && schema.state !== 'missing';

/* ---- where the browser is sent back to --------------------------------
   A reset email and an OAuth round trip only land if the address matches the
   project's Site URL / Redirect URLs list exactly, so on the permanent domain it
   is spelled out as the https site rather than inherited from whatever scheme or
   LAN address this particular tab happens to be on. */
export const cloudReturnUrl = () => (homeCloud() ? `https://${HOME_HOST}/` : `${location.origin}${location.pathname}`);

/* ---- the link the browser comes back with ----------------------------
   A reset email hands the browser either a fragment (`#access_token=…&type=recovery`,
   the implicit flow) or a one-time `?code=` that has to be exchanged with the PKCE
   verifier we generated when we asked. A Google sign-in arrives the same way as the
   fragment. All three are read here, and the address is cleaned afterwards so a
   refresh cannot spend the same code twice. */
const FLOW = 'kitsune:cloud:pkce';
const AWAITING = 'kitsune:cloud:awaiting-reset';

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * A PKCE pair for this reset request, or null.
 *
 * `crypto.subtle` only exists in a secure context, so a preview on
 * http://192.168.1.153 cannot ask for a code link — it gets the implicit one
 * instead, which needs no verifier. On the https deployment both work.
 */
async function pkcePair() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || !globalThis.crypto?.getRandomValues) return null;
  try {
    const verifier = b64url(globalThis.crypto.getRandomValues(new Uint8Array(48)));
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return { verifier, challenge: b64url(new Uint8Array(digest)) };
  } catch {
    return null;
  }
}

/** Ask Supabase to email a reset link. It answers the same either way. */
export async function requestPasswordReset(email) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('No Supabase project is connected.', 'no-cloud');
  const pair = await pkcePair();
  if (pair) localStorage.setItem(FLOW, pair.verifier);
  else localStorage.removeItem(FLOW);
  sessionStorage.setItem(AWAITING, '1');
  const q = new URLSearchParams({ redirect_to: cloudReturnUrl() });
  if (pair) {
    q.set('code_challenge', pair.challenge);
    q.set('code_challenge_method', 'S256');
  }
  await req(cfg, `/auth/v1/recover?${q}`, { method: 'POST', auth: false, body: { email } });
  return { link: pair ? 'code' : 'token' };
}

/** Drop the credentials out of the address bar once they are spent. */
function cleanUrl() {
  const params = new URLSearchParams(location.search);
  ['code', 'access_token', 'refresh_token', 'id_token', 'type', 'expires_in'].forEach((k) => params.delete(k));
  const query = params.toString();
  const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  ['access_token', 'refresh_token', 'id_token', 'type', 'expires_in', 'code'].forEach((k) => hashParams.delete(k));
  const rest = hashParams.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}${rest ? `#${rest}` : ''}`);
}

/**
 * Spend whatever the email link left behind.
 * Returns 'recovery' when the viewer is here to choose a new password,
 * 'session' when they simply came back signed in, '' for neither.
 */
export async function captureFromRedirect() {
  const cfg = cloudConfig();
  if (!cfg) return '';
  const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const code = query.get('code') || hash.get('code');

  if (code) {
    const verifier = localStorage.getItem(FLOW);
    localStorage.removeItem(FLOW);
    if (!verifier) return ''; // the link was opened in a different browser
    try {
      const data = await req(cfg, '/auth/v1/token?grant_type=pkce', {
        method: 'POST',
        auth: false,
        body: { auth_code: code, code_verifier: verifier },
      });
      setToken(data);
      cleanUrl();
      return waitingForReset() ? 'recovery' : 'session';
    } catch {
      cleanUrl(); // a spent code must not be offered again on refresh
      return '';
    }
  }

  const access = hash.get('access_token');
  if (!access) return '';
  setToken({ access_token: access });
  const wasRecovery = hash.get('type') === 'recovery' || waitingForReset();
  cleanUrl();
  return wasRecovery ? 'recovery' : 'session';
}

function waitingForReset() {
  const waiting = sessionStorage.getItem(AWAITING) === '1';
  sessionStorage.removeItem(AWAITING);
  return waiting;
}

/**
 * Spend a reset address the viewer pasted in instead of following.
 *
 * Supabase sends a *link*, not a code you can type: the six-figure token is in
 * the address. Plenty of mail apps open that address in their own webview, where
 * the session it hands over dies with the preview — so the sheet lets the person
 * copy the link back here instead, and this reads the credentials out of it.
 * Both forms are accepted: the one-time `?code=` of the PKCE flow and the
 * `#access_token=…&type=recovery` of the implicit one.
 */
export async function spendResetLink(text) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('No Supabase project is connected.', 'no-cloud');
  const raw = String(text || '').trim();
  if (!/^https?:\/\//i.test(raw)) {
    throw badRequest('Paste the whole link from the email, starting with https.', 'bad-link');
  }
  let link = null;
  try {
    link = new URL(raw);
  } catch {
    throw badRequest('That link does not look right.', 'bad-link');
  }
  const query = new URLSearchParams(link.search);
  const hash = new URLSearchParams((link.hash || '').replace(/^#/, ''));
  const read = (k) => query.get(k) || hash.get(k) || '';
  const code = read('code');
  const access = read('access_token');

  if (code) {
    const verifier = localStorage.getItem(FLOW);
    localStorage.removeItem(FLOW);
    if (!verifier) {
      throw badRequest('Ask for a new email in this browser — the one you pasted belongs to another.', 'no-verifier');
    }
    const data = await req(cfg, '/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      auth: false,
      body: { auth_code: code, code_verifier: verifier },
    });
    setToken(data);
    return 'recovery';
  }

  if (!access) throw badRequest('That link holds no reset code. Ask for a new email.', 'no-code');
  if (read('type') && read('type') !== 'recovery') throw badRequest('That is not a password reset link.', 'not-recovery');
  setToken({ access_token: access });
  return 'recovery';
}

/**
 * Set the password of the session in hand — the last step of a recovery, and
 * the same call an account makes to change it from the profile.
 */
export async function updatePassword(password) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('No Supabase project is connected.', 'no-cloud');
  if (!token()) {
    throw badRequest('Please open the reset link again — this one has expired.', 'no-session');
  }
  await req(cfg, '/auth/v1/user', { method: 'PATCH', body: { password } });
  return true;
}

/**
 * May the sheet offer Google at all? The same answer as email sign-up: a
 * verified project whose schema is actually in place. Whether the provider is
 * enabled on top of that is asked per press, in `googleAvailable()`.
 */
export function googleReady() {
  return authReady();
}

function baseUrl(value) {
  const v = (value || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(v) ? v : '';
}

function session() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION) || 'null');
    if (raw && typeof raw.access_token === 'string') return raw;
  } catch { /* junk in storage counts as signed out */ }
  return null;
}

function token() {
  try {
    /* One last look at the old per-tab copy, so a visitor who was signed in
       before this change is not silently asked for their password. */
    return session()?.access_token || sessionStorage.getItem(TOKEN) || '';
  } catch {
    return '';
  }
}

function setToken(next) {
  try {
    sessionStorage.removeItem(TOKEN);
    if (!next?.access_token) {
      localStorage.removeItem(SESSION);
      return;
    }
    const expiresIn = Number(next.expires_in);
    localStorage.setItem(
      SESSION,
      JSON.stringify({
        access_token: next.access_token,
        refresh_token: typeof next.refresh_token === 'string' ? next.refresh_token : '',
        /* No lifetime in the reply means no proactive refresh; the request that
           fails on it will say so, which is honest. */
        expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
      }),
    );
  } catch { /* a private window that refuses storage stays signed out */ }
}

/**
 * Trade the refresh token for a live access token when the old one is nearly
 * done. Called before every request, so a session opened this morning is still
 * working tonight without the viewer ever typing a password again.
 */
async function ensureFresh(cfg) {
  const now = session();
  if (!now?.refresh_token) return;
  if (now.expires_at && now.expires_at - Date.now() > EXPIRY_LEEWAY_MS) return;
  try {
    const data = await req(cfg, '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      auth: false,
      body: { refresh_token: now.refresh_token },
    });
    setToken(data);
  } catch {
    /* A refresh the project refuses — the token was revoked, or the project
       does not rotate them. Leave the session as it is: the call that follows
       will report the real failure, and a wrong password is not something this
       function gets to decide. */
  }
}

function badRequest(message, code) {
  return Object.assign(new Error(message), { status: 400, code });
}

/* ---- connection test ------------------------------------------------ */
/**
 * Proves the URL, the key and the schema in one round trip. Called by Settings
 * and by nothing else, so a half-configured cloud never reaches the UI.
 */
export async function testCloudConnection({ url, key }) {
  const base = baseUrl(url || '');
  if (!base) return { ok: false, message: 'That project URL does not look right.' };
  const cfg = { url: base, key: (key || '').trim() };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/kitsune_ready`, {
      method: 'POST',
      headers: headers(cfg, false),
      body: 'null',
    });
    if (!res.ok) return { ok: false, message: 'Solvn tables are missing — run the SQL in docs/supabase.sql.' };
    const data = await res.json();
    if (data !== true) return { ok: false, message: 'The schema check returned nothing usable.' };
    const saved = localStorage.getItem(KEY);
    const keep = saved ? JSON.parse(saved) : {};
    localStorage.setItem(KEY, JSON.stringify({ ...keep, url: cfg.url, key: cfg.key, verified: true }));
    return { ok: true, message: 'Connected.' };
  } catch {
    return { ok: false, message: 'The project did not answer.' };
  }
}

/* ---- plumbing -------------------------------------------------------- */
function headers(cfg, auth) {
  const h = { apikey: cfg.key, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth && token()) h.Authorization = `Bearer ${token()}`;
  return h;
}

async function req(cfg, path, { method = 'GET', body, auth = true, prefer } = {}) {
  let res;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { ...headers(cfg, auth), ...(prefer ? { Prefer: prefer } : {}) },
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('The project did not answer.'), { status: 0, code: 'offline' });
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* some REST replies are empty */ }
  if (!res.ok) {
    throw Object.assign(new Error(cloudMessage(data)), { status: res.status, code: data?.code || `http-${res.status}` });
  }
  return data;
}

/** GoTrue, PostgREST and the SQL raise in their own words; map to our copy. */
function cloudMessage(data) {
  const m = String(data?.msg || data?.error?.message || data?.message || data?.error_desc || data?.error_description || '');
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/invalid login credentials|Invalid password/i.test(m)) return 'Email or password is wrong.';
  if (/provider is not enabled|Unsupported provider/i.test(m)) return 'Google sign-in is not switched on for this project yet.';
  /* A missing table or function is the deployment not being finished, and it is
     worth naming: "Sign in failed" would send somebody hunting for a typo in
     their own password. */
  if (/does not exist|Could not find the (?:function|table relation)|PGRST20\d|PGRST404/i.test(m)) {
    return 'The central database is not set up yet — run the SQL in docs/supabase.sql.';
  }
  if (/reauthentication_needed|Reauthentication/i.test(m)) return 'Confirm your current password to finish that change.';
  if (/TokenExpired|invalid authorization code|invalid or expired recovery|expired/i.test(m)) {
    return 'That reset link has expired. Ask for a new one.';
  }
  if (/Forced authentication challenge|not allow(?:ed)? sign/i.test(m)) return 'This project is not allowing that sign-in method.';
  if (/user not found|not authorized|row level security/i.test(m)) return 'Please sign in first.';
  if (/duplicate key|username_(?:key|idx)/i.test(m)) return 'That name is taken.';
  if (/playlist is private/i.test(m)) return 'That playlist is private.';
  if (/playlist is gone/i.test(m)) return 'That playlist is gone.';
  return m || 'Something went wrong. Try again.';
}

/* ---- row shaping ----------------------------------------------------- */
function toUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    /* The number a member is searched by. It lives on the row, so signing out,
       changing device or clearing local storage all give back the same one. A
       project whose database predates the column reads 0, and `adopt` in
       device.js then derives a stable number instead of showing nothing. */
    userId: Number(row.user_id) || 0,
    username: row.username,
    /* The handle is chosen once at registration and never changes; the name
       people see is separate. An account that has not set one shows its handle. */
    displayName: row.display_name || row.username,
    bio: row.bio || '',
    avatar: row.avatar || null,
    banner: row.banner || null,
    favourite: row.favourite || null,
    badges: Array.isArray(row.badges) ? row.badges : [],
    cards: row.cards || null,
    title: row.title || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    stats: {
      hours: Number(row.hours) || 0,
      episodes: Number(row.episodes) || 0,
      completed: Number(row.completed) || 0,
      titles: Number(row.titles) || 0,
    },
  };
}

function toPlaylist(row, likeIds) {
  return {
    id: String(row.id),
    title: row.title,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    items: Array.isArray(row.items) ? row.items : [],
    ownerId: String(row.owner),
    likeCount: Number(row.like_count) || 0,
    likedByMe: likeIds ? likeIds.has(String(row.id)) : false,
    owner: row.kitsune_profiles?.display_name || row.kitsune_profiles?.username || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

const likeIdsOf = (rows) => new Set((rows || []).map((r) => String(r.playlist)));

/** A core row: the binder, packs and XP the device sent up. */
function toCore(row) {
  if (!row) return null;
  return {
    collection: row.collection && typeof row.collection === 'object' ? row.collection : {},
    packs: row.packs && typeof row.packs === 'object' ? row.packs : {},
    xp: row.xp && typeof row.xp === 'object' ? row.xp : {},
    clientAt: Number(row.client_at) || 0,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
  };
}

/** One line of the Super Admin roster, already shaped by the SQL. */
function toRosterRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    username: row.username || '',
    displayName: row.displayName || row.username || '',
    email: row.email || '',
    level: Number(row.level) || 1,
    xp: Number(row.xp) || 0,
    cards: Number(row.cards) || 0,
    packs: Number(row.packs) || 0,
    pulls: Number(row.pulls) || 0,
    updatedAt: Number(row.updatedAt) || 0,
    createdAt: Number(row.createdAt) || 0,
  };
}

/** The account behind this browser's token, or nothing. */
async function myUid(cfg) {
  const me = await req(cfg, '/auth/v1/user');
  const uid = me?.id || me?.user?.id;
  if (!uid) throw badRequest('Please sign in first.', 'no-user');
  return String(uid);
}

/** One column at a time onto the member's own row, and read the row back. */
async function patchRow(cfg, uid, patch) {
  const rows = await req(cfg, `/rest/v1/kitsune_profiles?id=eq.${encodeURIComponent(uid)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch,
  });
  return toUser(rows?.[0]);
}

/* ---- the adapter ----------------------------------------------------- */
export async function cloudApi(path, { method = 'GET', body } = {}) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('Cloud sync is not configured.', 'no-cloud');
  await ensureFresh(cfg);

  const [route, query = ''] = path.split('?');
  const seg = route.split('/');
  const params = new URLSearchParams(query);

  /* -- auth -- */
  if (seg[0] === 'account' && seg[1] === 'signup') {
    const data = await req(cfg, '/auth/v1/signup', {
      method: 'POST',
      auth: false,
      body: { email: body.email, password: body.password, data: { username: body.username } },
    });
    setToken(data);
    if (!data?.access_token) {
      /* Email confirmation is switched on: the account exists but this browser
         has no session yet, and the profile row arrives with the trigger when
         the address is confirmed. The UI has to say so instead of welcoming
         somebody who is not signed in. */
      return { signedIn: false };
    }
    await req(cfg, '/rest/v1/rpc/kitsune_join', { method: 'POST', body: { p_username: body.username } });
    return { signedIn: true };
  }

  if (seg[0] === 'account' && seg[1] === 'login') {
    const data = await req(cfg, '/auth/v1/token?grant_type=password', {
      method: 'POST',
      auth: false,
      body: { email: body.email, password: body.password },
    });
    setToken(data);
    return {};
  }

  if (seg[0] === 'account' && seg[1] === 'logout') {
    try {
      await req(cfg, '/auth/v1/logout', { method: 'POST' });
    } finally {
      setToken(null);
    }
    return {};
  }

  if (seg[0] === 'account' && seg[1] === 'me' && method === 'GET') {
    const me = await req(cfg, '/auth/v1/user');
    const uid = me?.id || me?.user?.id;
    if (!uid) return { user: null, playlists: [] };
    const [profiles, playlists, likes] = await Promise.all([
      req(cfg, `/rest/v1/kitsune_profiles?id=eq.${encodeURIComponent(uid)}&select=*`),
      req(cfg, `/rest/v1/kitsune_playlists?owner=eq.${encodeURIComponent(uid)}&order=created_at.desc&select=*`),
      req(cfg, `/rest/v1/kitsune_likes?usr=eq.${encodeURIComponent(uid)}&select=playlist`),
    ]);
    const ids = likeIdsOf(likes);
    return {
      user: profiles.length ? { ...toUser(profiles[0]), email: me?.email || me?.user?.email || '' } : null,
      playlists: playlists.map((p) => toPlaylist(p, ids)),
    };
  }

  if (seg[0] === 'account' && seg[1] === 'me') {
    /* `body.username` may arrive (the local API echoes the handle back), but it
       is never written here: the handle is the permanent key a profile is
       addressed by, so the only name this call can change is the display one. */
    const rows = await req(cfg, '/rest/v1/rpc/kitsune_profile_update', {
      method: 'POST',
      body: { p_display_name: body.displayName, p_bio: body.bio, p_avatar: body.avatar, p_banner: body.banner },
    });
    let user = toUser(rows);
    /* The title is written straight onto the row rather than through that
       function, because its argument list is frozen: a member whose database
       predates the `title` column then loses titles alone, not their name,
       picture and background as well. */
    if (body.title !== undefined) {
      const uid = await myUid(cfg);
      user = await patchRow(cfg, uid, { title: body.title });
    }
    return { user };
  }

  if (seg[0] === 'account' && seg[1] === 'avatar') {
    /* This replaces the whole avatar record, so the glyph and hue a member
       already chose ride along with the new picture — the same contract the
       local API keeps. */
    const uid = await myUid(cfg);
    const [row] = await req(cfg, `/rest/v1/kitsune_profiles?id=eq.${encodeURIComponent(uid)}&select=avatar`);
    const held = row?.avatar || {};
    return {
      user: await patchRow(cfg, uid, {
        avatar: {
          glyph: held.glyph || 'fox',
          hue: Number(held.hue) || 0,
          photo: body.photo ?? null,
          /* A gallery face or a pasted link travels as an address, not as bytes. */
          face: body.face ?? null,
          file: body.file ?? null,
        },
      }),
    };
  }

  if (seg[0] === 'favourite') {
    const uid = await myUid(cfg);
    const value = body?.id ? { id: Number(body.id), title: body.title, image: body.image } : null;
    return { user: await patchRow(cfg, uid, { favourite: value }) };
  }

  if (seg[0] === 'account' && seg[1] === 'stats') {
    const rows = await req(cfg, '/rest/v1/rpc/kitsune_stats', {
      method: 'POST',
      body: {
        p_hours: body.hours,
        p_episodes: body.episodes,
        p_completed: body.completed,
        p_titles: body.titles,
        p_badges: body.badges,
      },
    });
    return { user: toUser(rows) };
  }

  if (seg[0] === 'account' && seg[1] === 'cards') {
    /* Whole-record replace, exactly like the local API: the binder itself stays
       on the device and only the published summary travels, so a stale tab
       cannot resurrect a card that was just fused away. */
    const uid = await myUid(cfg);
    return { user: await patchRow(cfg, uid, { cards: body.cards || null }) };
  }

  /* -- the central core: binder, packs and XP -- */
  if (seg[0] === 'account' && seg[1] === 'core' && method === 'GET') {
    const data = await req(cfg, '/rest/v1/rpc/kitsune_core_get');
    return { core: data?.core ? toCore(data.core) : null };
  }

  if (seg[0] === 'account' && seg[1] === 'core') {
    const data = await req(cfg, '/rest/v1/rpc/kitsune_core_put', {
      method: 'POST',
      body: {
        p_collection: body.collection ?? {},
        p_packs: body.packs ?? {},
        p_xp: body.xp ?? {},
        p_client_at: Number(body.client_at) || 0,
      },
    });
    return { core: data?.core ? toCore(data.core) : null };
  }

  /* The Super Admin's global roster — the RPC decides who may see it. */
  if (seg[0] === 'admin' && seg[1] === 'core-roster' && method === 'GET') {
    const data = await req(cfg, '/rest/v1/rpc/kitsune_core_roster');
    return { users: (data?.users || []).map(toRosterRow).filter(Boolean) };
  }

  /* -- playlists -- */
  if (seg[0] === 'playlists' && !seg[1]) {
    const rows = await req(cfg, '/rest/v1/kitsune_playlists?select=*', {
      method: 'POST',
      prefer: 'return=representation',
      body: { title: body.title, items: body.items, visibility: body.visibility },
    });
    return { playlist: toPlaylist(rows[0]) };
  }

  if (seg[0] === 'playlists' && seg[1] && seg[2] === 'like') {
    const row = await req(cfg, '/rest/v1/rpc/kitsune_toggle_like', { method: 'POST', body: { p_playlist: seg[1] } });
    return { playlist: toPlaylist(row) };
  }

  if (seg[0] === 'playlists' && seg[1] && method === 'PATCH') {
    const row = await req(cfg, '/rest/v1/rpc/kitsune_playlist_update', {
      method: 'POST',
      body: { p_playlist: seg[1], p_title: body.title, p_items: body.items, p_visibility: body.visibility },
    });
    const mine = await req(cfg, '/rest/v1/rpc/kitsune_my_likes');
    return { playlist: toPlaylist(row, likeIdsOf(mine)) };
  }

  if (seg[0] === 'playlists' && seg[1] && method === 'DELETE') {
    await req(cfg, `/rest/v1/kitsune_playlists?id=eq.${encodeURIComponent(seg[1])}`, { method: 'DELETE' });
    return {};
  }

  /* -- community -- */
  if (seg[0] === 'users' && seg[1]) {
    /* The route answers for a handle, an auth id or the member's number, because
       the copy button on a profile prints the number and that is what a friend
       pastes. `kitsune_profile` only takes a uuid, so a number is resolved to the
       row first. */
    let key = seg[1];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (/^\d+$/.test(key) || !uuid.test(key)) {
      const by = /^\d+$/.test(key) ? `user_id=eq.${encodeURIComponent(key)}` : `username=eq.${encodeURIComponent(key)}`;
      const [row] = await req(cfg, `/rest/v1/kitsune_profiles?${by}&select=id&limit=1`);
      if (!row?.id) return { user: null, playlists: [] };
      key = String(row.id);
    }
    const data = await req(cfg, '/rest/v1/rpc/kitsune_profile', { method: 'POST', body: { p_id: key } });
    return {
      user: data?.user ? toUser(data.user) : null,
      playlists: (data?.playlists || []).map((p) => toPlaylist(p)),
    };
  }

  if (seg[0] === 'members') {
    /* The term goes into a PostgREST filter, so it is cut down to the characters
       a handle can hold — and a filter built from nothing but those cannot
       escape the string it was meant to search for. Prefix match first, exactly
       like the local route. A run of digits is read as a user number instead. */
    const term = (params.get('q') || '').replace(/[^A-Za-z0-9 ._-]/g, '').trim();
    if (term.length < 2) return { users: [] };
    if (/^\d+$/.test(term)) {
      const rows = await req(cfg, `/rest/v1/kitsune_profiles?user_id=eq.${encodeURIComponent(term)}&limit=8&select=*`);
      return { users: (rows || []).map(toUser) };
    }
    const like = encodeURIComponent(term.toLowerCase());
    const rows = await req(
      cfg,
      `/rest/v1/kitsune_profiles?or=(username.ilike.${like}*,display_name.ilike.${like}*)&order=username.asc&limit=8&select=*`,
    );
    return { users: (rows || []).map(toUser) };
  }

  if (seg[0] === 'community' && seg[1] === 'collectors') {
    /* The RPC returns each row with its place already printed on it, so the
       number the board sorts by and the number it shows cannot drift apart. */
    const data = await req(cfg, '/rest/v1/rpc/kitsune_collectors', {
      method: 'POST',
      body: { p_limit: Number(params.get('n')) || 20 },
    });
    const placed = (row) => (row ? { ...toUser(row), place: Number(row.place) || 0 } : null);
    return {
      users: (data?.users || []).map(placed),
      me: placed(data?.me),
      totals: {
        members: Number(data?.totals?.members) || 0,
        collectors: Number(data?.totals?.collectors) || 0,
        pulls: Number(data?.totals?.pulls) || 0,
        highest: Number(data?.totals?.highest) || 0,
      },
    };
  }

  if (seg[0] === 'community' && seg[1] === 'leaderboard') {
    const data = await req(cfg, '/rest/v1/rpc/kitsune_leaderboard', {
      method: 'POST',
      body: { p_limit: Number(params.get('limit')) || 20 },
    });
    return {
      users: (data?.users || []).map((u, i) => ({ ...toUser(u), place: i + 1 })),
      me: data?.me ? { ...toUser(data.me), place: data.me_place } : null,
      totals: { members: data?.totals?.members || 0, hours: data?.totals?.hours || 0, playlists: data?.totals?.playlists || 0 },
    };
  }

  if (seg[0] === 'community' && seg[1] === 'playlists') {
    const rows = await req(cfg, '/rest/v1/rpc/kitsune_trending');
    const mine = token() ? await req(cfg, '/rest/v1/rpc/kitsune_my_likes') : null;
    const ids = mine ? likeIdsOf(mine) : null;
    return { playlists: (rows || []).map((p) => toPlaylist(p, ids)) };
  }

  throw Object.assign(new Error('That is not the right method.'), { status: 404, code: 'no-route' });
}

/**
 * Where the browser should go for the Google flow.
 *
 * A PKCE pair is minted for the round trip and its verifier kept here, because
 * this project answers an OAuth callback with a one-time `?code=` that only
 * `captureFromRedirect()` can spend when the verifier that opened the flow is
 * still in reach. Without it the viewer would come back signed out and the
 * button would look broken.
 */
export async function googleAuthorizeUrl() {
  const cfg = cloudConfig();
  if (!cfg) return '';
  const pair = await pkcePair();
  if (pair) localStorage.setItem(FLOW, pair.verifier);
  else localStorage.removeItem(FLOW);
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: cloudReturnUrl(),
    scopes: 'openid email profile',
  });
  if (pair) {
    q.set('code_challenge', pair.challenge);
    q.set('code_challenge_method', 'S256');
  }
  return `${cfg.url}/auth/v1/authorize?${q}`;
}

/**
 * Is Google actually switched on in this project?
 *
 * The provider is a dashboard setting, and pressing an OAuth button whose
 * provider is disabled hands the whole tab to a Supabase error page — which is
 * what this check exists to avoid. A 302 out to Google means yes; the
 * "provider is not enabled" answer means no. Anything the browser will not let
 * us look at (a CORS-blocked probe) is read as yes, so a failed check can never
 * hide a working sign-in.
 */
export async function googleAvailable() {
  const cfg = cloudConfig();
  if (!cfg) return false;
  const q = new URLSearchParams({ provider: 'google', redirect_to: cloudReturnUrl() });
  try {
    const res = await fetch(`${cfg.url}/auth/v1/authorize?${q}`, {
      method: 'GET',
      redirect: 'manual',
      headers: { apikey: cfg.key, Accept: 'application/json' },
    });
    if (res.type === 'opaqueredirect') return true;
    if (res.status >= 300 && res.status < 400) return true;
    if (res.ok) return true;
    const data = await res.json().catch(() => null);
    const message = String(data?.error_description || data?.msg || data?.error || '');
    return !/provider is not enabled|Unsupported provider/i.test(message);
  } catch {
    return true;
  }
}

/* ---- the admin desk's own cloud door ------------------------------------
   The owner's staff account belongs to this site's backend, so signing into
   the central cloud for the global roster must not touch that session. These
   two only move the Supabase token in this browser. */
export async function cloudDirectLogin(email, password) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('Cloud sync is not configured.', 'no-cloud');
  const data = await req(cfg, '/auth/v1/token?grant_type=password', {
    method: 'POST',
    auth: false,
    body: { email, password },
  });
  setToken(data);
  const me = await req(cfg, '/auth/v1/user').catch(() => null);
  return { email: me?.email || me?.user?.email || email };
}

export function cloudSignOut() {
  setToken(null);
}
