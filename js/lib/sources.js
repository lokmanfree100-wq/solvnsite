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
 *   {audio}    the track id: `sub`, `dub`, `ar` or `fr`
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
  name: 'Solvn Stream',
  url: 'https://anigato.lol/embed/anime/{anilist}/{episode}?audio={audio}&next={next}&accent={accent}',
  /* The two tracks this host's own `audio=` parameter understands. A server is
     only ever asked for a track it declares, which is what keeps an Arabic or
     French request from going out to an address that has never heard of them. */
  tracks: ['sub', 'dub'],
};

/* How long a server stays out of the ladder after it has failed. Half an hour:
   long enough that the next twenty episodes do not start on a dead frame, short
   enough that a provider which recovers is used again by itself. */
const COOLDOWN_MS = 30 * 60 * 1000;

export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation';
export const FRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope';

/* ---- audio tracks ------------------------------------------------------
   A track is one of the audio languages Solvn can put in the player. `sub` is
   the original Japanese with subtitles and `dub` is the English re-voice; both
   are what the built-in server's `audio=` parameter takes. `ar` and `fr` are
   real ids for a real purpose: a custom server that carries them declares them,
   gets `{audio}` filled with the id, and only then appears in the switcher, the
   ladder and the badges on the cards.

   Nothing here claims a language a server has not said it has. AniList carries
   no dub-availability field for a title, so Solvn cannot know whether episode 7
   of a given show was re-voiced into Arabic — it knows only which languages the
   players it is configured with offer. That is the honest ceiling, and it is why
   an unconfigured install shows `SUB` and `EN DUB` and nothing else. */
export const TRACKS = [
  { id: 'sub', chip: 'SUB', label: 'Japanese (Subbed)' },
  { id: 'dub', chip: 'EN DUB', label: 'English (Dubbed)' },
  { id: 'ar', chip: 'AR DUB', label: 'Arabic (Dubbed)' },
  { id: 'fr', chip: 'FR DUB', label: 'French (Dubbed)' },
];

const TRACK_IDS = TRACKS.map((tr) => tr.id);

/* The three buttons the player bar always offers. `sub` and `dub` are what the
   built-in server speaks; `ar` is here because the language of this site's
   audience is Arabic, and a switcher that hides the one track people ask for
   reads as a site that will not answer. Offering it is not the same as promising
   it: a press on a track no server here carries says so, and opens the server
   sheet with the settings route in it, instead of pointing the frame at an
   address that has never heard of `audio=ar`. */
const SHOWN_TRACKS = ['sub', 'dub', 'ar'];

export const isTrack = (value) => TRACK_IDS.includes(value);

/** Every language some enabled server can actually play, in table order. */
export function tracksOffered() {
  const all = servers();
  return TRACK_IDS.filter((id) => all.some((s) => serverTracks(s).includes(id)));
}

/** The chips to draw: the three standing offers, then anything else carried. */
export function audioChoices() {
  const out = TRACKS.filter((tr) => SHOWN_TRACKS.includes(tr.id)).map((tr) => tr.id);
  tracksOffered().forEach((id) => {
    if (!out.includes(id)) out.push(id);
  });
  return out;
}

/** Does any server on this device answer this track today? */
export const trackCarried = (id) => tracksOffered().includes(id);

/** The four languages a preference may name; anything else is Japanese subs. */
export const asTrack = (value) => (isTrack(value) ? value : 'sub');

export const trackChip = (id) => TRACKS.find((tr) => tr.id === id)?.chip || 'SUB';

/** Spoken name of a track, in the language the interface is using. Each call is
    written out so the translation extractor can see the key. */
export function trackName(id) {
  if (id === 'dub') return t('English (Dubbed)');
  if (id === 'ar') return t('Arabic (Dubbed)');
  if (id === 'fr') return t('French (Dubbed)');
  return t('Japanese (Subbed)');
}

/** What a server carries — a list that never contains an unknown id. */
export function serverTracks(server) {
  const declared = Array.isArray(server?.tracks) ? server.tracks.filter(isTrack) : [];
  return declared.length ? TRACK_IDS.filter((id) => declared.includes(id)) : ['sub'];
}

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

/**
 * Lift every ban. The watch page calls this once a whole ladder has come up
 * silent: at that point the cooldown has stopped protecting the viewer from a
 * dead frame and started guaranteeing that the next episode begins with every
 * server already assumed dead, which is the one thing a failover queue must
 * never become.
 */
export function clearCooldowns() {
  const all = records();
  let touched = false;
  for (const [id, rec] of Object.entries(all)) {
    if (rec?.at) {
      all[id] = { ...rec, at: 0 };
      touched = true;
    }
  }
  if (touched) settings.set('serverStats', all);
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
  flag: (v) => (v ? '1' : '0'),
  hex: (v) => (/^[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : ''),
};

/**
 * Fill a template. The built-in server keeps its documented query shape; custom
 * ones get the same values in whichever placeholders they ask for.
 *
 * The language that goes into `{audio}` is checked against the server first: an
 * address is never handed a track it does not declare, because the answer to
 * that is not an error but a player that sits there showing nothing.
 */
export function serverUrl(server, { id, episode = 1, audio = 'sub', autoNext = true, accent = '' }) {
  const wanted = asTrack(audio);
  const carried = serverTracks(server);
  const track = carried.includes(wanted) ? wanted : carried[0];
  const values = {
    anilist: safe.num(id),
    episode: safe.num(episode) || '1',
    audio: track,
    next: safe.flag(autoNext),
    accent: safe.hex(accent),
  };
  return String(server.url).replace(/\{(\w+)\}/g, (m, key) => (key in values ? values[key] : m));
}

/**
 * Name that is never empty and never absurdly long for a chip.
 *
 * Every label the player can show is Solvn's own: the built-in server is
 * `Solvn Stream` and the rest are numbered, because the address behind a chip is
 * a plumbing detail and the viewer chooses a server by number, not by whose
 * brand happens to be on the frame.
 */
export function serverName(server) {
  if (server.id === MAIN_SERVER.id) return t('Solvn Stream');
  const n = String(server.name || '').trim();
  return n ? n.slice(0, 28) : t('Solvn Stream {n}', { n: servers().indexOf(server) + 1 });
}

/** Add a server; returns null on success or the reason it was refused. */
export function addServer({ name = '', url = '', tracks = [] } = {}) {
  const problem = templateProblem(url);
  if (problem) return problem;
  const list = extraServers();
  const clean = url.trim();
  if (list.some((s) => s.url === clean)) return t('That server is already listed.');
  const carried = TRACK_IDS.filter((id) => tracks.includes(id));
  list.push({
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: String(name).trim().slice(0, 28),
    url: clean,
    /* Only stored when it is not the plain sub/dub pair, so the list a server
       has never been asked about stays the same shape it always was. */
    ...(!carried.includes('sub') || !carried.includes('dub') || carried.length > 2
      ? { tracks: carried.length ? carried : ['sub'] }
      : {}),
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
