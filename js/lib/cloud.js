/**
 * Optional Supabase backend. When a verified project is configured in Settings,
 * the same account calls this adapter instead of the local JSON API; without a
 * configuration nothing here runs and Solvn stays on server.js.
 *
 * Only the public anon key is ever kept here, and only in this browser. The
 * session token lives in sessionStorage so it dies with the tab.
 */

const KEY = 'kitsune:cloud';
const TOKEN = 'kitsune:cloud:token';

export function cloudConfig() {
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
  return cfg && cfg.verified && token() ? cfg : null;
};

/** Saved but not yet proven — the Google button waits for `verified`. */
export function saveCloudConfig({ url, key }) {
  const base = baseUrl(url || '');
  if (!base) throw badRequest('That project URL does not look right.', 'bad-url');
  if (!/^[A-Za-z0-9_-]{16,}$/.test((key || '').trim())) throw badRequest('That key does not look right.', 'bad-key');
  localStorage.setItem(KEY, JSON.stringify({ url: base, key: key.trim(), verified: false }));
  sessionStorage.removeItem(TOKEN);
  return cloudConfig();
}

export function clearCloudConfig() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(TOKEN);
}

export function googleReady() {
  const cfg = cloudConfig();
  return Boolean(cfg && cfg.verified);
}

function baseUrl(value) {
  const v = (value || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(v) ? v : '';
}

function token() {
  try {
    return sessionStorage.getItem(TOKEN) || '';
  } catch {
    return '';
  }
}

function setToken(session) {
  if (session?.access_token) sessionStorage.setItem(TOKEN, session.access_token);
  else sessionStorage.removeItem(TOKEN);
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

async function req(cfg, path, { method = 'GET', body, auth = true } = {}) {
  let res;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: headers(cfg, auth),
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
  const m = String(data?.msg || data?.error?.message || data?.message || data?.error_desc || '');
  if (/already registered|already exists/i.test(m)) return 'That email already has an account. Sign in instead.';
  if (/invalid login credentials|Invalid password/i.test(m)) return 'Email or password is wrong.';
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
    username: row.username,
    bio: row.bio || '',
    avatar: row.avatar || null,
    banner: row.banner || null,
    badges: Array.isArray(row.badges) ? row.badges : [],
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
    owner: row.kitsune_profiles?.username || null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

const likeIdsOf = (rows) => new Set((rows || []).map((r) => String(r.playlist)));

/* ---- the adapter ----------------------------------------------------- */
export async function cloudApi(path, { method = 'GET', body } = {}) {
  const cfg = cloudConfig();
  if (!cfg) throw badRequest('Cloud sync is not configured.', 'no-cloud');

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
      // email confirmation on: the row is created after the user signs in
      return {};
    }
    await req(cfg, '/rest/v1/rpc/kitsune_join', { method: 'POST', body: { p_username: body.username } });
    return {};
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
    const rows = await req(cfg, '/rest/v1/rpc/kitsune_profile_update', {
      method: 'POST',
      body: { p_username: body.username, p_bio: body.bio, p_avatar: body.avatar, p_banner: body.banner },
    });
    return { user: toUser(rows) };
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

  /* -- playlists -- */
  if (seg[0] === 'playlists' && !seg[1]) {
    const rows = await req(cfg, '/rest/v1/kitsune_playlists?select=*', {
      method: 'POST',
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
    const data = await req(cfg, '/rest/v1/rpc/kitsune_profile', { method: 'POST', body: { p_id: seg[1] } });
    return {
      user: data?.user ? toUser(data.user) : null,
      playlists: (data?.playlists || []).map((p) => toPlaylist(p)),
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

/** Where the browser should go for the Google flow, once the project allows it. */
export function googleSignInUrl() {
  const cfg = cloudConfig();
  if (!cfg) return '';
  const next = `${location.origin}${location.pathname}`;
  const q = new URLSearchParams({
    provider: 'google',
    redirect_to: next,
    scopes: 'openid email profile',
  });
  return `${cfg.url}/auth/v1/authorize?${q}`;
}

/** After the redirect Supabase hands back #access_token=… in the URL hash. */
export function captureSessionFromHash() {
  const hash = location.hash || '';
  if (!hash.includes('access_token=')) return false;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const access = params.get('access_token');
  if (access) sessionStorage.setItem(TOKEN, access);
  params.delete('access_token');
  params.delete('refresh_token');
  const clean = `${location.pathname}${location.search}${params.toString() ? `#${params}` : ''}`;
  history.replaceState(null, '', clean);
  return Boolean(access);
}
