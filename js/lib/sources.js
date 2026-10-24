/**
 * Streaming servers.
 *
 * Solvn does not host video and cannot scrape it: a server here is somebody
 * else's player page, framed inside Solvn. Two rules follow from that.
 *
 * 1. The frame never gets to move the *site* somewhere else. `FRAME_SANDBOX`
 *    omits `allow-top-navigation` and `allow-popups`, so a player cannot
 *    redirect the tab, open a window, or leave the site behind — whatever it
 *    does internally, the viewer stays on Solvn.
 * 2. When one server is silent, the watch page moves to the next one by itself.
 *    Every enabled server gets a turn on the current audio track, then a turn on
 *    the other one, and only after all of them does the player say there is
 *    nothing to play. That ladder is what "server hopping" means here: the same
 *    episode, re-requested from another address, inside the same frame.
 * 3. A server that went silent is remembered for half an hour and sent to the
 *    back of the queue, so the next episode does not start on the frame that
 *    just failed. Picking it by name in the server sheet overrides that.
 *
 * A custom server is a URL template. These placeholders are filled in:
 *   {anilist}  the AniList id of the title   (number)
 *   {episode}  episode number, 1-based       (number; 1 for a film)
 *   {audio}    `sub` or `dub`
 *   {next}     `1` when auto-next is on, else `0`
 *   {accent}  six hex digits, the highlight colour
 * Values are checked before they go in, and a template that is not https is
 * refused — a player loaded over http can be altered on the way to the viewer.
 */

import { settings } from './store.js';
import { t } from './i18n.js';

/** The server every copy of Solvn ships with. */
export const MAIN_SERVER = {
  id: 'main',
  name: 'Main server',
  url: 'https://anigato.lol/embed/anime/{anilist}/{episode}?audio={audio}&next={next}&accent={accent}',
};

/* How long a server stays out of the ladder after it has failed. Half an hour:
   long enough that the next twenty episodes do not start on a dead frame, short
   enough that a provider which recovers is used again by itself. */
const COOLDOWN_MS = 30 * 60 * 1000;

export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation';
export const FRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope';

const PLACEHOLDERS = ['anilist', 'episode', 'audio', 'next', 'accent'];
const MAX_URL = 500;

/** Extra servers this device added, in the order the ladder should try them. */
export function extraServers() {
  const list = settings.get('servers');
  return (Array.isArray(list) ? list : []).filter((s) => s && templateProblem(s.url) === null);
}

/** Everything the ladder may use: the main server first, then the added ones. */
export function servers() {
  const extra = extraServers();
  return [MAIN_SERVER, ...extra];
}

/* What this device has seen each server do: `{ id: { ok, bad, at } }`. It is
   only ever written by the watch page, and it is what makes "if Source A fails,
   try B" stick past the current episode instead of restarting the same dead
   frame on every hop. */
function records() {
  const raw = settings.get('serverStats');
  return raw && typeof raw === 'object' ? raw : {};
}

/** Called by the player: the frame answered, or it did not. */
export function markServer(id, ok) {
  if (!id) return;
  const all = records();
  const rec = all[id] || { ok: 0, bad: 0, at: 0 };
  if (ok) {
    rec.ok += 1;
    rec.at = 0; // a frame that loaded lifts the earlier ban at once
  } else {
    rec.bad += 1;
    rec.at = Date.now();
  }
  all[id] = rec;
  settings.set('serverStats', all);
}

/** Still in the dog-house from its last failure? */
export function cooling(id) {
  const rec = records()[id];
  return !!rec && !!rec.at && Date.now() - rec.at < COOLDOWN_MS;
}

/** null means the template is usable; otherwise this is the reason it is not. */
export function templateProblem(url) {
  const raw = String(url || '').trim();
  if (!raw) return t('Add a player address.');
  if (raw.length > MAX_URL) return t('That address is too long.');
  if (!/^https:\/\/[^\s]+$/i.test(raw)) return t('It must start with https://');
  if (!PLACEHOLDERS.some((p) => raw.includes(`{${p}}`))) {
    return t('It must use at least one of {anilist}, {episode}, {audio}.');
  }
  return null;
}

/** What a template looks like in the settings field before anything is typed. */
export const TEMPLATE_HINT = 'https://player.example/anime/{anilist}/{episode}?audio={audio}';

const safe = {
  num: (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 1e7 ? String(Math.trunc(n)) : '';
  },
  word: (v) => (v === 'dub' ? 'dub' : 'sub'),
  flag: (v) => (v ? '1' : '0'),
  hex: (v) => (/^[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : ''),
};

/**
 * Fill a template. The built-in server keeps its documented query shape; custom
 * ones get the same values in whichever placeholders they ask for.
 */
export function serverUrl(server, { id, episode = 1, audio = 'sub', autoNext = true, accent = '' }) {
  const values = {
    anilist: safe.num(id),
    episode: safe.num(episode) || '1',
    audio: safe.word(audio),
    next: safe.flag(autoNext),
    accent: safe.hex(accent),
  };
  return String(server.url).replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}

/** Name that is never empty and never absurdly long for a chip. */
export function serverName(server) {
  if (server.id === MAIN_SERVER.id) return t('Main server');
  const n = String(server.name || '').trim();
  return n ? n.slice(0, 28) : t('Server {n}', { n: servers().indexOf(server) + 1 });
}

/** Add a server; returns null on success or the reason it was refused. */
export function addServer({ name = '', url = '' } = {}) {
  const problem = templateProblem(url);
  if (problem) return problem;
  const list = extraServers();
  const clean = url.trim();
  if (list.some((s) => s.url === clean)) return t('That server is already listed.');
  list.push({
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(name).trim().slice(0, 28),
    url: clean,
  });
  settings.set('servers', list);
  return null;
}

export function removeServer(id) {
  settings.set('servers', extraServers().filter((s) => s.id !== id));
}

/** The speeds the settings card offers, seconds. */
export const FAILOVER_CHOICES = [3, 8, 15];

/**
 * How long the player waits for a frame before hopping to the next server.
 *
 * Three seconds is offered and is the right choice on a fast connection, but an
 * embed page is a whole document — DNS, TLS, its own scrape — and a browser on
 * mobile data can pass three seconds before that document has finished loading
 * on a server that would have played fine. Eight is the middle that does not
 * abandon a live server while still not sitting on a dead one for a dozen.
 */
export function failoverMs() {
  const n = Number(settings.get('failover'));
  const sec = Number.isFinite(n) && n >= 3 && n <= 30 ? Math.round(n) : 8;
  return Math.min(30, Math.max(3, sec)) * 1000;
}
