/**
 * Who is here, from this browser's point of view.
 *
 * A static copy has no socket to hold a roster, and even behind the dev server
 * the admin desk has no presence table to read. So the tab checks itself in:
 * every route change and every half-minute stamps the signed-in member, the
 * path they are on and the time. The admin page reads those stamps and says
 * plainly that this is what one browser can see — not a claim about the world.
 *
 * The rows live in `localStorage`, so two tabs of the same account collapse
 * into one row and a closed tab stops counting after five minutes instead of
 * claiming to be online forever.
 */

const PRESENCE_KEY = 'kitsune:presence';
const ACTIVITY_KEY = 'kitsune:activity';
export const ONLINE_MS = 5 * 60 * 1000;
const PRESENCE_KEEP = 40;
const ACTIVITY_KEEP = 120;
const TEXT_MAX = 120;

const read = (key) => {
  try {
    const rows = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
};

const write = (key, rows) => {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* Private windows without storage simply have no pulse to show. */
  }
};

const person = (user, at) => ({
  id: String(user?.id || ''),
  userId: Number(user?.userId) || 0,
  username: user?.username || '',
  displayName: user?.displayName || user?.username || '',
  avatar: user?.avatar || null,
  at,
});

function log(user, kind, text = '') {
  if (!user?.id) return;
  const row = { id: `${user.id}:${Date.now().toString(36)}`, ...person(user, Date.now()), kind, text: String(text).slice(0, TEXT_MAX) };
  write(ACTIVITY_KEY, [row, ...read(ACTIVITY_KEY)].slice(0, ACTIVITY_KEEP));
}

/** Stamp the current member. A new route is one activity row, not one per beat. */
export function beat(user, path) {
  if (!user?.id) return;
  const clean = String(path || '').slice(0, TEXT_MAX);
  const rows = read(PRESENCE_KEY);
  const at = rows.findIndex((row) => String(row.id) === String(user.id));
  if (at >= 0) {
    const previous = rows[at];
    if (clean && previous.path !== clean) log(user, 'visit', clean);
    rows[at] = { ...person(user, Date.now()), path: clean || previous.path || '' };
  } else {
    rows.push({ ...person(user, Date.now()), path: clean });
    log(user, 'join', clean);
  }
  write(PRESENCE_KEY, rows.sort((a, b) => b.at - a.at).slice(0, PRESENCE_KEEP));
}

/** A deliberate exit is worth a row; a closed tab simply ages out. */
export function markAway(user) {
  if (!user?.id) return;
  const rows = read(PRESENCE_KEY).filter((row) => String(row.id) !== String(user.id));
  write(PRESENCE_KEY, rows);
  log(user, 'leave', '');
}

/** The presence board: newest first, each row carrying whether it still counts. */
export function presence() {
  const now = Date.now();
  return read(PRESENCE_KEY)
    .sort((a, b) => b.at - a.at)
    .map((row) => ({ ...row, online: now - Number(row.at || 0) < ONLINE_MS }));
}

/** Recent site activity, newest first. */
export function activity(limit = ACTIVITY_KEEP) {
  return read(ACTIVITY_KEY).slice(0, limit);
}
