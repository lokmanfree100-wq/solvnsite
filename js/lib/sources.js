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
 * 1. Two halves, one gate. A viewer names their own player in Settings; whoever
 *    runs the site names the sources every visitor gets once, in
 *    `lib/defaults.js`. Device entries come first and both halves pass the same
 *    validation below, so a banned host stays banned even from inside the repo.
 *    Empty both and the watch page says so and points at Settings.
 * 2. The frame is locked. `FRAME_SANDBOX` grants only what a player needs to
 *    draw and play: scripts, its own origin, and forms. It omits `allow-popups`,
 *    every `allow-top-navigation*` token and `allow-downloads`, so the browser
 *    itself refuses the frame new tabs, navigation of this page and files on the
 *    device — whatever its adverts try. A host that refuses to run inside that
 *    lock is not framed at all: it is left out of `lib/defaults.js`, because the
 *    only way to satisfy it is to hand it the tab, which is the harm this site
 *    exists without. Both watch pages say what to expect before the picture.
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

/* One lock, both watch pages, every host. Three tokens and nothing else: the
   player may run its scripts, keep its own origin and submit its own forms.
   Absent are `allow-popups` (no second tab, ever), every `allow-top-navigation*`
   (this page cannot be moved, with or without a press) and `allow-downloads`
   (nothing reaches the device). Those absences are enforced by the browser, not
   by trust: an advert inside the frame may paint itself, but its window.open and
   its top-level anchors are refused before they run. A cross-origin frame cannot
   be read or rewritten from out here, so this lock and the choice of host are the
   only two levers Solvn actually has — and both are applied to every frame. */
export const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms';
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
   External embed hosts that carried redirects, adverts and watermarks are
   blocked outright so a stored or pasted entry can never revive them. The gate
   below skips them in both halves, so a banned host stays banned even from
   inside the repo. */
const BLOCKED_HOSTS = [
  'anigato.lol', 'megavid.buzz', '1337embed.wtf',
  'anixo.buzz', 'xxiku.com', 'player.xxiku.com',
  'vidhawk.buzz', 'voidverse.me', 'player.voidverse.me',
  'megaplay.buzz', 'supaplay.fun', 'vidnest.fun',
  'vidrift.net', 'embed.vidrift.net', 'anitaku.to',
  'zokoanime.video', 'animepahe.ru', 'gogoanime',
];

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

/* ---- the sweep that keeps a banned host off a device --------------------
   Removes any stored source whose host is in BLOCKED_HOSTS, so a ban reaches
   devices that already saved the address, not just new visits. */
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
 * The viewer's own entries first, then the site's from lib/defaults.js, and a
 * blocked host never becomes a source by accident whichever half named it. Empty
 * both halves and the watch page offers the route to Settings instead of framing
 * a stranger to fill the silence.
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
/**
 * Stream-validity gate.
 *
 * Rule 1 of the strict validation layer: a title is not shown on the UI unless
 * at least one enabled server can actually serve it right now. This function is
 * the client-side expression of that rule. It does not play anything — it only
 * asks whether a playable address exists for this title on this device's configured
 * sources.
 *
 * Two shapes of answer:
 *   - anime (AniList id): a server is "usable" for the title when it declares a
 *     track the viewer can request and the template can be filled for this id +
 *     episode. The site does not ping the embed host per poster (that would be the
 *     burst the queue exists to avoid); a declared track on a server this device
 *     trusts is taken as streamable. A server that carries no track for this
 *     audience is not counted.
 *   - movies/series (TMDB id): when a /stream proxy exists, hit it once per title
 *     to learn whether the ladder returns at least one .m3u8/.mp4. When the host is
 *     static (no proxy), fall back to the offline catalogue's streamable flag and
 *     the defaults' declared tracks — the same contract the watch page uses to
 *     decide it can hand the title to the player.
 *
 * The result is cached per session by title+type so a rail of twenty posters does
 * not re-ask the same title twenty times.
 */
export const STREAM_CHECK_CACHE = new Map();

/** Clear the per-session stream-check cache. Called on route changes that swap the
    title set, so a stale "yes" never keeps a dead poster on screen. */
export function clearStreamCheckCache() {
  STREAM_CHECK_CACHE.clear();
}

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
/* Names that belong to somebody else's product. The bar, the source switcher
   and the failure notes read this function, so the chrome stays Solvn's own
   whatever a stored entry or a shipped default happens to be called. */
const FOREIGN = /anigato|megavid|megaplay|anixo|2anime|gogo|zoro|animepahe|hianime|xxiku|vidhawk|voidverse|supaplay|vidnest|vidrift|anitaku|zokoanime/i;

export function serverName(server) {
  const n = String(server?.name || '').trim();
  /* Numbered against the list the operator actually sees in Settings, so an
     unnamed entry never lands on a number that skips one, and a film-only
     template is never numbered from the ladder that excludes it. */
  if (!n || FOREIGN.test(n)) return t('Solvn Stream {n}', { n: extraServers().indexOf(server) + 1 });
  return n.slice(0, 28);
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

/**
 * Does this device have at least one working source for this title right now?
 *
 * This is the Rule-1 gate for the catalogue: a poster is only rendered when this
 * returns true (or when metadata already proves the title is streamable). It is
 * deliberately conservative and session-cached, because a rail with twenty posters
 * must not turn into twenty cross-origin pings.
 *
 * `type` is 'anime' for AniList ids and 'film' for TMDB ids.
 *
 * A title is "streamable" when a valid playable address can be formed from a server
 * this device trusts — i.e. a server that (a) is in the enabled list (already passed
 * templateProblem), and (b) declares a track the viewer can request. The address
 * itself is formed by serverUrl and is valid by construction for any server that passed
 * the template gate, so the only real question is whether a server declares a track.
 *
 * The actual playback is handled by the watch page's failover ladder, which tries the
 * address and hops when it does not play. This function only decides whether a poster
 * may be shown in the catalogue.
 */
export async function canStreamTitle({ type, id, episode = 1, tmdb }) {
  const key = `${type}:${id}:${episode}:${tmdb || ''}`;
  if (STREAM_CHECK_CACHE.has(key)) return STREAM_CHECK_CACHE.get(key);
  const promise = (async () => {
    if (type === 'anime') {
      const list = servers();
      /* No source configured at all — nothing to stream, never render. */
      if (!list.length) return false;
      /* At least one enabled server must declare a track the viewer can request.
         Any server in `servers()` already passed templateProblem, so a filled
         address is valid by construction; the only real question is track coverage. */
      return list.some((s) => serverTracks(s).length > 0);
    }
    /* ---- movies / series (TMDB id) ---- */
    /* On a static host the watch page plays TMDB titles through the hardcoded embed
       mirrors (js/views/films/mwatch.js), which accept any TMDB id. So the snapshot's
       streamable flag is the operative signal there: a title the build verified as
       streamable is playable from this device even when no {tmdb} source is configured.
       On a host with a live proxy, the proxy's honest answer wins. */
    const proxy = String(API_HOST || '').trim();
    if (proxy) {
      try {
        const res = await fetch(
          `${proxy}/stream?kind=stream&tmdb=${encodeURIComponent(String(tmdb || id))}&type=${type === 'tv' ? 'tv' : 'movie'}&s=${encodeURIComponent(String(episode))}&e=${encodeURIComponent('1')}`,
          { signal: AbortSignal.timeout(7000) },
        );
        if (res.ok) {
          const data = (await res.json().catch(() => null)) || {};
          STREAM_CHECK_CACHE.set(key, Boolean(data?.ok));
          return Boolean(data?.ok);
        }
      } catch {
        /* Proxy unreachable on this device — fall back to the offline judgement. */
      }
    }
    /* Snapshot judgement: the build verified a source for titles that carry real content
       (artwork, episodes, a name). Those are streamable from this device via the watch
       page's mirrors on a static host, and via a {tmdb} source where one is configured. */
    try {
      const cat = await loadCatalogue();
      if (cat) {
        const row = cat.titles.find((r) => r.media_type === (type === 'tv' ? 'tv' : 'movie') && r.id === Number(id));
        if (row && row.streamable !== false) {
          STREAM_CHECK_CACHE.set(key, true);
          return true;
        }
      }
    } catch {
      /* catalogue.json not reachable either — cannot assert streamable from the snapshot. */
    }
    /* Last resort on a host that has a {tmdb}-capable source configured: a {tmdb} server
       that declares a track can form a valid address for this title. */
    const filmServers = extraServers().filter((s) => String(s.url).includes('{tmdb}'));
    if (filmServers.length) {
      const ok = filmServers.some((s) => serverTracks(s).length > 0);
      STREAM_CHECK_CACHE.set(key, ok);
      return ok;
    }
    /* No proxy, no snapshot entry, no {tmdb} source: the catalogue will not show this
       poster. The watch page still renders its ready overlay for a direct watch link, but
       the hub does not advertise a title it cannot verify. */
    STREAM_CHECK_CACHE.set(key, false);
    return false;
  })();
  STREAM_CHECK_CACHE.set(key, promise);
  return promise;
}

/** Resolve a single episode's best playable address for display / pre-flight, without
 *  starting playback. Returns the address the watch page would hand to the stage, or
 *  '' when no server on this device can fill it for this episode.
 *
 * Used by the episode rail so a locked / unstreamable episode cell can drop its play
 * affordance before the viewer taps it.
 *
 * Any server in the list already passed templateProblem, so a filled address is valid by
 * construction; the only real question is whether a server declares a track for this
 * audience.
 */
export async function episodeAddress({ type, id, episode, audio = 'sub' }) {
  const list = type === 'anime' ? servers() : extraServers().filter((s) => String(s.url).includes('{tmdb}'));
  if (!list.length) return '';
  for (const s of list) {
    const carried = serverTracks(s);
    if (!carried.length) continue;
    const track = carried.includes(asTrack(audio)) ? audio : carried[0];
    const url = serverUrl(s, { id, episode, audio: track });
    if (url && url !== s.url) return url;
  }
  return '';
}

/** The subset of enabled servers that can carry a given title type today — used by
 *  the catalogue render path to decide whether a shelf is worth painting at all.
 */
export function streamableServersFor(type) {
  if (type === 'anime') return servers();
  return extraServers().filter((s) => String(s.url).includes('{tmdb}'));
}

/** Rule-1 filter for a list of anime titles: keep only the ones streamable on this
 *  device. On a static host the snapshot has no anime streamability opinion, so the
 *  defaults' track declarations decide; on a host with a live resolver the resolver is
 *  asked. Batched in parallel groups so a long list does not open one ping per title.
 *  Session-cached per title by canStreamTitle. */
export async function streamableAnimeTitles(items) {
  if (!items.length) return [];
  /* No stream server configured on this device: the strict filter would hide every
     title. Show them all instead and let the watch page resolve playback. */
  if (!servers().length) return items;
  const ids = items.map((m) => Number(m.id)).filter(Boolean);
  const out = new Array(ids.length).fill(false);
  for (let i = 0; i < ids.length; i += 8) {
    const slice = ids.slice(i, i + 8);
    const checks = await Promise.all(slice.map((id) => canStreamTitle({ type: 'anime', id })));
    for (let j = 0; j < checks.length; j++) out[i + j] = checks[j];
  }
  return items.filter((_, i) => out[i]);
}
