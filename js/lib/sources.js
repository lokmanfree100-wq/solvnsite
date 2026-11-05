/**
 * Streaming servers.
 *
 * Solvn indexes titles and hosts no video of its own, so a server can only ever
 * be one of two things:
 *
 * - a **media** address — an `.m3u8`, `.mp4` or `.webm` file Solvn plays itself
 *   in a `<video>` element it owns. Our controls, our quality list, our corner
 *   mark, and nothing drawn by a third party anywhere on the screen.
 * - an **embed** page — somebody else's player, framed inside Solvn. Whatever is
 *   painted inside a cross-origin frame belongs to that frame: it cannot be
 *   re-skinned, muted, restyled or covered from out here.
 *
 * Two rules follow from that.
 *
 * 1. Nothing is planted. A fresh install has no source of its own, and the watch
 *    page says so and points at Settings; whoever runs the site either names one
 *    there, or names the sources every visitor should get once, in
 *    `lib/defaults.js`. Both go through the same gate below.
 * 2. The frame can advertise, but it cannot move the visitor. `FRAME_SANDBOX`
 *    grants `allow-popups`, so an ad a player opens lands in a new browser tab
 *    and the viewer steps back to Solvn; it omits `allow-top-navigation` and
 *    `allow-downloads`, so the same player cannot pull this page away to its own
 *    site and cannot put a file on the device without being asked.
 * 3. When one server is silent, the watch page moves to the next one by itself.
 *    Every enabled server gets a turn on the current audio track, then a turn on
 *    the other one, and only after all of them does the player say there is
 *    nothing to play. That ladder is what "server hopping" means here: the same
 *    episode, re-requested from another address, in the same stage.
 * 4. A server that went silent is remembered for half an hour and sent to the
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
import { DEFAULT_SERVERS } from './defaults.js';
import { t } from './i18n.js';

/* How long a server stays out of the ladder after it has failed. Half an hour:
   long enough that the next twenty episodes do not start on a dead frame, short
   enough that a provider which recovers is used again by itself. */
const COOLDOWN_MS = 30 * 60 * 1000;

/* One list, both watch pages. `allow-popups` plus `allow-popups-to-escape-sandbox`
   is the deliberate concession: a player's advert opens as an ordinary browser
   tab, which the viewer closes or steps back from. What stays refused is the two
   things that actually cost a person something — moving *this* tab somewhere else
   (`allow-top-navigation`) and writing a file to the device (`allow-downloads`). */
export const FRAME_SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-presentation allow-popups allow-popups-to-escape-sandbox';
export const FRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture; accelerometer; gyroscope';

/* ---- audio tracks ------------------------------------------------------
   A track is one of the audio languages Solvn can put in the player. `sub` is
   the original Japanese with subtitles and `dub` is the English re-voice — the
   pair a template with `{audio}` in it almost always answers. `ar` and `fr` are
   real ids for a real purpose: a server that carries them declares them, gets
   `{audio}` filled with the id, and only then appears in the switcher, the
   ladder and the badges on the cards.

   Nothing here claims a language a server has not said it has. AniList carries
   no dub-availability field for a title, so Solvn cannot know whether episode 7
   of a given show was re-voiced into Arabic — it knows only which languages the
   players it is configured with offer. That is the honest ceiling, and it is why
   a server that declared nothing offers Japanese subtitles and nothing else. */
export const TRACKS = [
  { id: 'sub', chip: 'SUB', label: 'Japanese (Subbed)' },
  { id: 'dub', chip: 'EN DUB', label: 'English (Dubbed)' },
  { id: 'ar', chip: 'AR DUB', label: 'Arabic (Dubbed)' },
  { id: 'fr', chip: 'FR DUB', label: 'French (Dubbed)' },
];

const TRACK_IDS = TRACKS.map((tr) => tr.id);

/* The three buttons the player bar always offers. `sub` and `dub` are what a
   `{audio}` template speaks by default; `ar` is here because the language of this
   site's audience is Arabic, and a switcher that hides the one track people ask
   for reads as a site that will not answer. Offering it is not the same as
   promising it: a press on a track no server here carries says so, and opens the
   server sheet with the settings route in it, instead of pointing the player at
   an address that has never heard of `audio=ar`. */
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

const PLACEHOLDERS = ['anilist', 'tmdb', 'episode', 'audio', 'next', 'accent'];
const MAX_URL = 500;

/* ---- hosts Solvn will not play from, whoever pastes them ----------------
   AniGato is the source this build used to plant on every fresh device, and it
   is the reason a member who clicked play got a pop-under of porn before the
   episode did: the ads are not in Solvn, they are inside that company's page,
   and a frame we do not own cannot be filtered from outside — the browser will
   not let us read it. So the block lives at the gate every source passes before
   it is ever stored or framed: the address is refused, the ladder skips it, and
   the Settings field says why. Drop a domain in here and it stops being a
   source on every device, not just a disabled row somebody could re-enable. */
const BLOCKED_HOSTS = ['anigato.lol', 'anig.to'];

/** The host an address points at, or '' when it is not a whole https address. */
function hostOf(url) {
  const raw = String(url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(raw)) return '';
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Blocked outright, including anything served under the banned domain. */
export function blockedHost(url) {
  const host = hostOf(url);
  if (!host) return null;
  return BLOCKED_HOSTS.find((b) => host === b || host.endsWith(`.${b}`)) || null;
}

/* ---- what a server actually is ----------------------------------------
   Decided from the address, never from a guess about the host: a file Solvn can
   feed to its own `<video>` is a media source, and anything else is a player
   page that has to be framed. `{episode}` and friends sit before the extension
   in most templates, so the suffix tests still read correctly. */
const HLS_URL = /\.m3u8(?:[?#]|$)/i;
const FILE_URL = /\.(?:mp4|webm|ogv|mov|m4s)(?:[?#]|$)/i;

export const isHlsUrl = (url) => HLS_URL.test(String(url || ''));
export const isMediaUrl = (url) => HLS_URL.test(String(url || '')) || FILE_URL.test(String(url || ''));

/** `media` plays inside Solvn; `embed` is somebody else's page, framed. */
export const serverKind = (server) => (isMediaUrl(server?.url) ? 'media' : 'embed');

/* ---- a device that has configured nothing ------------------------------
   An earlier build planted AniGato's embed here so a first visit could play
   something without any setup. That plant is gone, and it is not coming back:
   seeding it would hand every new member precisely the pop-unders and adult
   ads the site has been asked to stop, because those live inside that company's
   page and cannot be filtered from a frame we do not own.

   So an empty ladder is now the honest starting point. The watch page says
   there is no source and points at Settings, and whoever runs the install
   chooses what Solvn plays — per viewer in Settings, or once for everyone in
   lib/defaults.js — which is the only arrangement where the ads question has an
   answer. */
function pruneBlockedSources() {
  const stored = settings.get('servers');
  if (!Array.isArray(stored)) return;
  /* A device that already carries the old plant gets it removed, not left in the
     list as a row that can never play. Same for any other host banned later. */
  const kept = stored.filter((s) => s && !blockedHost(s.url));
  if (kept.length !== stored.length) settings.set('servers', kept);
}

/** The sources this device was told about, and nothing else. */
function storedServers() {
  pruneBlockedSources();
  const list = settings.get('servers');
  return (Array.isArray(list) ? list : []).filter((s) => s && templateProblem(s.url) === null);
}

/** A stable identity for a deploy-time entry: the stats map remembers a failure
    against this id, so an address must keep the same one on every visit. */
const siteId = (url) => `site:${encodeURIComponent(String(url)).slice(0, 60)}`;

/**
 * Everything this browser may play from: what the viewer added in Settings, then
 * what whoever deployed the site named in lib/defaults.js.
 *
 * Device entries keep their order and their priority — a source chosen here
 * beats a stranger configured elsewhere — and an address that appears twice is
 * listed once. A default that fails the same gate a typed entry fails is not
 * used at all: a blocked host stays blocked even when it was typed into the
 * repo, because the gate is about what that page serves, not about who pasted it.
 */
export function extraServers() {
  const mine = storedServers();
  const seen = new Set(mine.map((s) => String(s.url)));
  const site = [];
  for (const s of Array.isArray(DEFAULT_SERVERS) ? DEFAULT_SERVERS : []) {
    const url = String(s?.url || '').trim();
    if (!url || seen.has(url) || templateProblem(url) !== null) continue;
    seen.add(url);
    site.push({ ...s, url, id: s.id || siteId(url), site: true });
  }
  return [...mine, ...site];
}

/** Is this row one the device could delete, or one that came with the site? */
export const isSiteServer = (server) => !!server?.site;

/**
 * Everything the anime ladder may use.
 *
 * Nothing is planted here. The watch page says "nothing to play" until whoever
 * runs the install points it at a source in Settings, and it offers that route
 * rather than framing a stranger to fill the silence: Solvn only plays what the
 * operator chose, and a blocked host never becomes a source by accident.
 *
 * One thing is filtered out: a template that asks for `{tmdb}` is a film
 * address, and an anime episode carries no TMDB id to put in it — so leaving it
 * in this ladder means clicking episode 4 and getting whatever that address
 * happens to hold. The movies page reads those entries for itself, and Settings
 * still lists every entry, because it reads `extraServers`.
 */
export function servers() {
  return extraServers().filter((s) => !String(s.url).includes('{tmdb}'));
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
  /* Checked before anything else, and before the file-address shortcut: a
     banned host is banned whether it hands over a player page or a raw stream. */
  const blocked = blockedHost(raw);
  if (blocked) return t('{host} is blocked on Solvn — its player page serves the pop-ups and adult ads members reported.', { host: blocked });
  /* A direct file address names the episode in its own path and needs no
     placeholder at all; anything else — a player page — has to be told how to
     receive the id, the number and the track. */
  if (isMediaUrl(raw)) return null;
  if (!PLACEHOLDERS.some((p) => raw.includes(`{${p}}`))) {
    return t('It must use at least one of {anilist}, {episode}, {audio}.');
  }
  return null;
}

/** What a template looks like in the settings field before anything is typed. */
export const TEMPLATE_HINT = 'https://player.example/anime/{anilist}/{episode}?audio={audio}';

/** The other shape the field accepts: a file Solvn plays in its own player. */
export const MEDIA_HINT = 'https://cdn.example/{anilist}/ep-{episode}.m3u8';

const safe = {
  num: (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 1e7 ? String(Math.trunc(n)) : '';
  },
  flag: (v) => (v ? '1' : '0'),
  hex: (v) => (/^[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : ''),
};

/**
 * Fill a template. Placeholders the address does not use are simply absent,
 * which is what lets a player page and a bare file share one registry.
 *
 * The language that goes into `{audio}` is checked against the server first: an
 * address is never handed a track it does not declare, because the answer to
 * that is not an error but a player that sits there showing nothing.
 */
export function serverUrl(server, { id, tmdb = '', episode = 1, audio = 'sub', autoNext = true, accent = '' }) {
  const wanted = asTrack(audio);
  const carried = serverTracks(server);
  const track = carried.includes(wanted) ? wanted : carried[0];
  const values = {
    anilist: safe.num(id),
    /* `{tmdb}` is what lets one Settings list feed the movies page too: the
       films and series live in TMDB, not AniList, and an address that names the
       id it actually needs is an address that can be played. */
    tmdb: safe.num(tmdb),
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
 * Every label the player can show is Solvn's own: a server is numbered, or called
 * whatever the operator typed, because the address behind a chip is a plumbing
 * detail and the viewer chooses a server by number — not by whose brand happens
 * to be on the frame.
 */
export function serverName(server) {
  const n = String(server?.name || '').trim();
  /* Numbered against the list the operator actually sees in Settings, so an
     unnamed entry never lands on a number that skips one, and a film-only
     template is never numbered from the ladder that excludes it. */
  return n ? n.slice(0, 28) : t('Solvn Stream {n}', { n: extraServers().indexOf(server) + 1 });
}

/** Add a server; returns null on success or the reason it was refused. */
export function addServer({ name = '', url = '', tracks = [] } = {}) {
  const problem = templateProblem(url);
  if (problem) return problem;
  /* Written to the device list only. Saving what this browser typed must not
     freeze the site's own defaults into storage, or a later change to
     lib/defaults.js would never reach this viewer again. */
  const list = storedServers();
  const clean = url.trim();
  if (extraServers().some((s) => s.url === clean)) return t('That server is already listed.');
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
  /* Only this device's own entries: a row that came with the site is not stored
     here, so there is nothing to delete, and Settings does not offer the button. */
  const rest = storedServers().filter((s) => s.id !== id);
  settings.set('servers', rest);
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
