/** Watch: framed player with server failover, episode rail, sub/dub switch, progress. */

import { h, icon, qs } from '../lib/dom.js';
import { detail, episodes as fetchEpisodes } from '../lib/anilist.js';
import { go, parse } from '../lib/router.js';
import {
  settings,
  getProgress,
  setProgress,
  clearProgress,
  inList,
  toggleList,
  LISTS,
  isFavourite,
  toggleFavourite,
  pushHistory,
  history as watchHistory,
  listEntries,
  QUALITIES,
  qualityLabel,
  setNowWatching,
} from '../lib/store.js';
import { isSignedIn, tellDiscord } from '../lib/account.js';
import { followTitle } from '../lib/notices.js';
import { title, formatLabel, yearOf, statusLabel, listLabel, STATUS_TONE, plainDescription, countdown, scoreLabel, clamp, watched } from '../lib/util.js';
import { buildEpisodes, episodeCountIsGuess, resolveEpisodeCount } from '../lib/embed.js';
import { FRAME_ALLOW, FRAME_SANDBOX, asTrack, audioChoices, clearCooldowns, cooling, failoverMs, isTrack, markServer, serverName, serverTracks, serverUrl, servers, trackCarried, trackChip, trackName, tracksOffered } from '../lib/sources.js';
import { accentValue } from '../lib/accent.js';
import { mediaRow, emptyState, episodeArt } from '../components/media.js';
import { reportSheet } from '../components/report-issue.js';
import { commentPanel } from '../components/comments.js';
import { partyPanel, parseCode } from '../components/party.js';
import { moveParty } from '../lib/rooms.js';
import { sheet, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';

/**
 * What rides along on every link this page makes. A track is only named when it
 * is not the plain original, and a room only while one is open — so
 * `…/watch/1535/9` is Japanese with subtitles, `?audio=ar` is the request a
 * viewer would paste to a friend, and `?room=7K2M4Q` is the seat that friend
 * lands in. Both have to survive a hop to the next episode or a party started on
 * Ep 1 ends the moment anybody presses Next.
 */
function querySuffix(track, room) {
  const parts = [];
  if (isTrack(track) && track !== 'sub') parts.push(`audio=${track}`);
  if (room) parts.push(`room=${encodeURIComponent(room)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function WatchView({ params, route, onCleanup }) {
  const id = params.id;
  const requestedEp = Math.max(1, Number(route.segments[2]) || 0);

  /* The player needs two things — an AniList id and an episode number — and this
     route carries both, so it is mounted from them at once. Everything that
     needs the *title* (rail, synopsis, chat) waits for the catalogue and is
     painted in after: a slow or dead metadata query can no longer keep a viewer
     away from the play button. */
  let media = savedMedia(id);
  let total = resolveEpisodeCount(media);
  /* False for the long runners the catalogue lists without a count. The floor
     of twelve is then where the rail starts, not where the show ends. */
  let counted = !episodeCountIsGuess(media);
  let isMovie = media.format === 'MOVIE';
  let eps = isMovie ? [{ number: 1, title: title(media) }] : [];
  const stored = getProgress(id);
  /* Only the lower bound is applied here. Until the catalogue answers, `total`
     is a guess, and clamping a shared link like …/24 against a guessed 12 would
     quietly play the wrong episode. `repaint` clamps it for real. */
  let ep = Math.max(1, requestedEp || stored?.episode || 1);

  /* A title the catalogue gives no count for has no ceiling we were told, so
     none is invented: `hasNext` stays alive past the twelve the rail starts on,
     and the rail grows to hold whatever episode the viewer reaches. `OPEN_END`
     is only the arithmetic guard on a hand-typed address. */
  const OPEN_END = 2000;
  function hasNext() {
    return !isMovie && (!counted || ep < total);
  }
  function makeRoom(n) {
    for (let i = eps.length + 1; i <= n; i++) eps.push({ number: i, title: null, thumb: null, desc: null });
  }
  /* Audio precedence: the link you followed beats where this show left off,
     and both beat the default — so "start new episodes dubbed" finally reaches
     a title this browser has never opened.

     A track the configured servers do not declare is dropped rather than asked
     for. `ar` sent to a sub-and-dub-only player is not a missing language, it is
     a black frame with a spinner, so the preference falls back to the original
     Japanese and says so in the switcher instead. */
  const offered = tracksOffered();
  const want = (value) => {
    const track = asTrack(value);
    return offered.includes(track) ? track : 'sub';
  };
  const pref = want(settings.get('defaultAudio'));
  const q = isTrack(route.query.audio) ? route.query.audio : null;
  let audio = want(q || stored?.audio || pref);
  let current = eps.find((e) => e.number === ep) || { number: ep, title: null };
  /* An invite in the address is a seat, and the card beside the player takes it.
     Nothing here joins or hosts on its own — that is the panel's decision, and it
     needs the catalogue title before it can open a room. */
  let room = parseCode(route.query.room) || null;
  /** Put or clear the code in the address without losing the track or the scroll. */
  function setRoomCode(next) {
    const wanted = next || null;
    if (wanted === room) return;
    room = wanted;
    go(`/watch/${media.id}/${ep}${querySuffix(audio, room)}`, { replace: true, keepScroll: true });
  }
  /** Every link this page makes to another episode: same track, same room. */
  const epHref = (n) => `#/watch/${media.id}/${n}${querySuffix(audio, room)}`;
  /* A metadata answer that lands after the viewer moved on must not paint into
     a route nobody is looking at any more. */
  let live = true;
  onCleanup(() => {
    live = false;
  });

  function mark() {
    setProgress(media, ep, { audio });
    setNowWatching(media, ep);
    /* The host's own position, told to the room. Only ever one write: a guest
     * calling this does nothing, because there is only one hand on a party. */
    moveParty({ media: Number(media.id), ep, audio });
  }
  mark();

  /* ---------------- player ---------------- */
  const bootSpin = h('div.spinner', { style: { width: '26px', height: '26px' } });
  const bootMsg = h('span', {}, t('Warming up the player…'));
  /* Retry and Switch server sit on the overlay from the first frame, not only
     after we declare the source dead: a viewer who thinks the video is crawling
     should not have to wait for our opinion of it. */
  const bootRetry = h('button.btn.btn--sm.btn--glass', {
    onclick: () => {
      // Retry means the whole ladder again, not the last rung that failed.
      startRun();
      play(t('Reloading the player…'));
    },
  }, icon('refresh'), t('Retry'));
  const bootSwap = h('button.btn.btn--sm.btn--glass', { onclick: () => advance(true) }, icon('shuffle'), t('Switch server'));
  const bootNext = h('button.btn.btn--sm.btn--glass.hide', { onclick: () => goEp(ep + 1) }, icon('next'), t('Next episode'));
  const bootList = h('a.btn.btn--sm.btn--glass.hide', { href: `#/anime/${id}` }, icon('list'), t('Episode list'));
  /* The way out of an episode that does not exist yet: the last one that really
     does. The number is written when the panel opens, because only the
     catalogue knows what has aired. */
  const bootJumpLabel = h('span', {});
  const bootJump = h('button.btn.btn--sm.btn--glass.hide', {
    onclick: () => {
      const last = latestAired();
      if (last >= 1) goEp(last);
    },
  }, icon('play'), bootJumpLabel);
  /* Following a title is how the bell knows to shout when this episode does
     air, so the dead end comes with the thing that un-deads it. */
  const bootNotify = h('button.btn.btn--sm.btn--glass.hide', {
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (!(await followTitle(Number(media.id), title(media)))) throw new Error('refused');
        toast(t('We will tell you when it airs.'), { tone: 'ok', iconName: 'bell' });
        btn.classList.add('is-done');
      } catch {
        toast(t('Could not save that.'), { tone: 'bad', iconName: 'alert' });
      } finally {
        btn.disabled = false;
      }
    },
  }, icon('bell'), t('Notify me'));
  const bootWhen = h('span.player-boot-when.hide', {});
  /* The way out when nothing answered: another server to try. It is a route, not
     a promise — adding a source is the viewer's call, and only they know which
     ones their network can reach. */
  const bootServers = h('a.btn.btn.btn--sm.btn--glass.hide', { href: '#/settings' }, icon('sliders'), t('Add a server'));
  /* The other half of a silent ladder: the viewer says the episode did not
     play, and Solvn writes down what it already knows — the title, the number,
     the track and every address it walked. A report of "some shows don't work"
     is not actionable; this one is. */
  const bootReport = h('button.btn.btn--sm.btn--glass.hide', {
    onclick: () =>
      reportSheet({
        where: `${title(media)} · ${t('Episode {n}', { n: ep })} · ${trackName(audio)}`,
        detail: t('Nothing played on any server for this episode. Servers tried: {list}', {
          list: pool.map((s) => serverName(s)).join(', '),
        }),
      }),
  }, icon('alert'), t('Report this episode'));
  const bootLast = [bootNext, bootList, bootServers, bootReport, bootJump, bootNotify];
  const boot = h('div.player-boot', {},
    h('div.player-boot-stack', {},
      bootSpin,
      bootMsg,
      bootWhen,
      h('div.rowline.wrap', { style: { gap: '8px', justifyContent: 'center' } }, bootRetry, bootSwap, ...bootLast),
    ),
  );

  /* Sandboxed without top-navigation, popups or modals: a player may do what it
     likes inside its own frame, and it cannot move the tab, open a window or
     hand the viewer to another site. */
  const makeFrame = () => {
    const elt = h('iframe', {
      title: `${title(media)} — ${t('Episode {n}', { n: ep })}`,
      sandbox: FRAME_SANDBOX,
      allow: FRAME_ALLOW,
      referrerpolicy: 'strict-origin-when-cross-origin',
      loading: 'eager',
    });
    /* News from a frame the viewer already left is not news. A slow document can
       finish loading after the ladder has moved on, and letting that through
       would hide the boot overlay on a server that has answered nothing. */
    elt.addEventListener('load', () => {
      if (elt === frame) hideBoot();
    });
    return elt;
  };
  let frame = makeFrame();
  /* The provider's own corner watermark lives inside its cross-origin frame and
     cannot be removed from here, so Solvn's brand chip covers the same spot. */
  const frameBox = h('div.player-frame', {}, frame, boot, h('div.player-brand', { 'aria-hidden': 'true' }, 'solvn.site'));

  /* A frame quieter than this is treated as a dead server. The number comes
     from Settings so a viewer on a fast line can demand three seconds; the
     reasoning behind the default is in `failoverMs`. */
  let watchdog = null;
  let pool = servers();
  let run = [];
  let pos = 0;
  let serverIdx = 0;

  const frameUrl = () =>
    serverUrl(pool[serverIdx] || pool[0], {
      id,
      episode: ep,
      audio,
      autoNext: settings.get('autoplay'),
      accent: accentValue(),
    });

  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => advance(false), failoverMs());
  }

  /**
   * Every server that carries this track, then the same servers on the other
   * language, and finally one more attempt at the head of the queue.
   *
   * A server this device just watched fail goes to the back of the queue rather
   * than opening the next episode, so one dead frame does not cost a dozen
   * seconds every time the viewer hops. `ordered` + `pinned` are the case where
   * they picked that server by name: that list is used exactly as given.
   *
   * The repeat at the end is not decoration. Most stalls are transient — a slow
   * CDN edge, an episode still being mirrored, a phone that slept through the
   * request — and on a one-server install a ladder without it means the player
   * gives up after a single try.
   */
  function startRun(ordered, pinned) {
    pool = ordered || servers();
    if (serverIdx >= pool.length) serverIdx = 0;
    const order = pool.map((_, i) => i);
    if (!pinned) order.sort((a, b) => Number(cooling(pool[a].id)) - Number(cooling(pool[b].id)));

    const lap = (tracks) => {
      const out = [];
      for (const track of tracks) {
        order.forEach((i) => {
          if (serverTracks(pool[i]).includes(track)) out.push({ i, track });
        });
      }
      return out;
    };

    /* Japanese subtitles are the floor: the one track a Solvn with nothing added
       to it can always answer. Already on it, the other chance is English. */
    let steps = lap([audio, audio === 'sub' ? 'dub' : 'sub']);
    if (!steps.length) steps = lap(['sub', 'dub']);
    if (!steps.length) steps = order.map((i) => ({ i, track: 'sub' }));

    /* The address or the preference named a language nothing in this pool
       carries. Drop to the first rung that exists and let the chip say so,
       instead of framing a track that was never there. */
    if (steps[0].track !== audio) setTrack(steps[0].track);

    run = [...steps, steps[0]];
    pos = 0;
  }

  /* ---- the airing lock ---------------------------------------------------
     AniList names the episode that has *not* aired yet, so Solvn knows which
     numbers on the rail are fiction. A frame aimed at one of those answers with
     somebody else's error page — a cross-origin player cannot be told what to
     hide, and its own "not aired" notice carries its own branding. So the frame
     is never aimed there: the ladder stops, the overlay says what is true in
     Solvn's words, and the viewer is handed the last episode that really is out.
     ------------------------------------------------------------------------ */
  function nextUnaired() {
    if (isMovie || media.status !== 'RELEASING') return 0;
    return Number(media.nextAiringEpisode?.episode) || 0;
  }

  function latestAired() {
    const next = nextUnaired();
    if (!next) return 0;
    const at = Number(media.nextAiringEpisode?.airingAt) || 0;
    return at * 1000 > Date.now() ? Math.max(1, next - 1) : next;
  }

  /** Show Solvn's own notice and take the provider's page back out of the frame. */
  function showLocked() {
    clearTimeout(watchdog);
    watchdog = null;
    /* A frame that was already pointed at this episode before the catalogue
       answered is replaced with an empty one: leaving it loaded would keep the
       other site's error page — and anything still playing out of it — behind our
       own notice. */
    if (frame.getAttribute('src')) {
      const blank = makeFrame();
      frameBox.replaceChild(blank, frame);
      frame = blank;
    }
    const last = latestAired();
    bootSpin.classList.add('hide');
    boot.classList.remove('is-gone');
    bootLast.forEach((b) => b.classList.add('hide'));
    /* Retry and Switch server are honest answers to a silent frame and a lie
       about this one: no server carries an episode that has not been made yet. */
    bootRetry.classList.add('hide');
    bootSwap.classList.add('hide');
    bootMsg.textContent = t('Episode {n} has not aired yet.', { n: ep });
    bootWhen.classList.remove('hide');
    bootWhen.textContent = t('Airing {when}', { when: countdown(Number(media.nextAiringEpisode?.airingAt) || 0) });
    if (last >= 1) {
      bootJumpLabel.textContent = t('Play episode {n}', { n: last });
      bootJump.classList.remove('hide');
    }
    bootList.classList.remove('hide');
    if (isSignedIn()) bootNotify.classList.remove('hide');
  }

  function hideBoot() {
    /* News from a frame the viewer should never have been shown is not news: if
       the catalogue has since told us this episode is not out, the notice stands. */
    const next = nextUnaired();
    if (next && ep >= next) return showLocked();
    clearTimeout(watchdog);
    watchdog = null;
    /* The document arrived. That is the only good news a cross-origin frame can
       give, so it is the news the ladder runs on: it lifts the earlier ban and
       keeps this server at the front next time. */
    markServer(pool[serverIdx] && pool[serverIdx].id, true);
    boot.classList.add('is-gone');
    bootSpin.classList.remove('hide');
    bootLast.forEach((b) => b.classList.add('hide'));
    bootMsg.textContent = t('Warming up the player…');
  }

  /**
   * Point the frame at `src` — and make sure it actually loads it.
   *
   * An iframe that already holds this exact address ignores the assignment, so
   * "Retry" on a one-server install would redraw the same frozen 0:00 poster.
   * Replacing the element is the one reload a cross-origin frame can be given
   * from outside, and it costs nothing: no state of ours lives inside it.
   */
  function loadFrame(src) {
    if (frame.getAttribute('src') === src) {
      const next = makeFrame();
      frameBox.replaceChild(next, frame);
      frame = next;
    }
    frame.src = src;
  }

  /** Point the frame at the current rung of the ladder and restart the clock. */
  function play(msg) {
    const next = nextUnaired();
    if (next && ep >= next) return showLocked();
    boot.classList.remove('is-gone');
    bootSpin.classList.remove('hide');
    bootLast.forEach((b) => b.classList.add('hide'));
    bootRetry.classList.remove('hide');
    bootSwap.classList.remove('hide');
    bootWhen.classList.add('hide');
    bootMsg.textContent = msg || t('Warming up the player…');
    loadFrame(frameUrl());
    frame.title = `${title(media)} — ${t('Episode {n}', { n: ep })} (${trackName(audio)})`;
    arm();
  }

  /* A cross-origin frame cannot report a failed video, so silence is the only
     automatic signal there is: no `load` inside the failover window counts that
     server dead and the next rung is loaded into the same frame — no error page,
     no leaving the site. A viewer who presses "Switch server" while a frame is
     sitting on 0:00 is the second signal, and it is treated the same way: that
     server is dropped to the back of the queue for the rest of the cooldown. */
  function advance(manual) {
    /* A locked episode is not a dead server, so hopping must not blame one: the
       notice replaces the ladder instead of walking it. */
    const next = nextUnaired();
    if (next && ep >= next) return showLocked();
    clearTimeout(watchdog);
    watchdog = null;
    markServer(pool[serverIdx] && pool[serverIdx].id, false);
    if (!run.length) startRun();
    pos += 1;
    if (pos >= run.length) {
      if (!manual) return giveUp();
      startRun(); // the viewer asked for another go: cycle from the top
      bootMsg.textContent = t('Starting again from the first server…');
    }
    const step = run[pos];
    if (step.track !== audio) setTrack(step.track);
    serverIdx = step.i;
    serverChip.replaceChildren(icon('cast'), h('span', {}, serverName(pool[step.i])));
    if (pos > 0) {
      bootMsg.textContent =
        step.track !== run[0].track
          ? t('Trying the {a} source instead.', { a: trackName(step.track) })
          : t('Trying {name}…', { name: serverName(pool[step.i]) });
    }
    loadFrame(frameUrl());
    frame.title = `${title(media)} — ${t('Episode {n}', { n: ep })} (${trackName(audio)})`;
    arm();
  }

  function giveUp() {
    /* Every server had its turn on both tracks and said nothing. Their bans are
       lifted rather than extended: a pool that goes into the next episode
       already assumed dead starts that episode at the back of its own queue, and
       the viewer sees a slower player for a reason they cannot see. */
    clearCooldowns();
    bootSpin.classList.add('hide');
    /* The one meaning this can have, said plainly: a cross-origin player cannot
       report *why* it showed nothing, and Solvn only indexes titles — it holds no
       video of its own. So the gap is in what the servers carry, and the moves
       left are theirs: another server, another episode, another title. */
    bootMsg.textContent = t('Nothing answered on any server, on either track. This one is not carried yet.');
    /* The one move that is not "try again later": on a serialised show that is
       still releasing, an episode the mirrors have not caught up with is common,
       and the one before it nearly always plays. */
    const last = latestAired();
    if (last >= 1 && last < ep) {
      bootJumpLabel.textContent = t('Play episode {n}', { n: last });
      bootJump.classList.remove('hide');
    }
    bootServers.classList.remove('hide');
    if (hasNext()) bootNext.classList.remove('hide');
    bootList.classList.remove('hide');
    bootReport.classList.remove('hide');
  }

  /** Change track without remounting the view — the ladder's own step. */
  function setTrack(next) {
    audio = next;
    mark();
    paintTrackSeg();
    /* A hop nobody clicked still has to be reflected in the address, or a link
       copied from the bar at that moment opens the other track. */
    go(`/watch/${media.id}/${ep}${querySuffix(audio, room)}`, { replace: true, keepScroll: true });
  }

  /** Manual choice from the sheet: that server first, the rest as the ladder. */
  function chooseServer(picked) {
    const all = servers();
    const head = picked && all.includes(picked) ? picked : all[0];
    startRun([head, ...all.filter((s) => s !== head)], true);
    serverIdx = 0;
    play();
    paintBar();
  }

  const playerShell = h('div.player-shell', {}, frameBox, h('div.player-bar'));

  /* ---------------- controls ---------------- */
  /* Three buttons from the first frame — SUB, EN DUB, AR DUB — plus any other
     language a configured server declares. The Arabic chip is on the bar because
     it is the language this site's viewers ask for, and it is honest because a
     press on a track nothing here carries answers with words and a route, not
     with a black frame: the built-in player only ever spoke sub and dub, so
     `audio=ar` is a real request to a real server the viewer has to add. */
  const audioSeg = h('div.seg.seg--tracks', { role: 'group', 'aria-label': t('Audio track') });
  function paintTrackSeg() {
    audioSeg.replaceChildren(
      ...audioChoices().map((tr) => {
        const carried = trackCarried(tr);
        return h(`button${audio === tr ? '.is-active' : ''}`, {
          'aria-pressed': String(audio === tr),
          title: carried ? trackName(tr) : t('{track} — no server here carries it yet', { track: trackName(tr) }),
          'aria-label': trackName(tr),
          class: carried ? null : 'is-uncarried',
          onclick: () => swap(tr),
        }, trackChip(tr), carried ? null : icon('lock'));
      }),
    );
  }
  paintTrackSeg();

  /* Which server is on screen right now, and a way to pick another one without
     waiting for the silence clock. */
  const serverChip = h('button.btn.btn--sm.btn--glass.q-chip', {
    'aria-label': t('Streaming server'),
    onclick: () => openServerSheet(),
  }, icon('cast'), h('span', {}, serverName(pool[serverIdx])));

  /* A frame can load its page and still show nothing but 0:00, and a
     cross-origin player cannot tell us that happened. So the viewer says it
     instead: one tap here drops the current server to the back of the queue and
     loads the same episode from the next one, inside this frame. */
  const hopBtn = h('button.btn.btn--sm.btn--glass', {
    'aria-label': t('Not playing? Switch to another server'),
    onclick: () => advance(true),
  }, icon('refresh'), h('span', {}, t('Not playing?')));

  /**
   * The server sheet.
   *
   * `wanted` is the track a chip asked for and nothing carried — naming it here
   * is what lets the sheet say which of these addresses would answer it instead
   * of listing servers that all play the same two languages. Each row prints the
   * tracks its server actually declares, so a server that speaks Arabic is
   * recognisable before it is picked rather than after it fails.
   */
  function openServerSheet(wanted) {
    const ask = isTrack(wanted) ? wanted : null;
    const pick = h('div.stack');
    const paint = () => {
      /* A server can be added in Settings while this page sits open. Rebuilding
         the queue around whatever is already on screen keeps the tick, the frame
         and the ladder pointing at the same thing — and reloads nothing under
         the viewer's feet. */
      const onScreen = pool[serverIdx] || pool[0];
      const all = servers();
      startRun([onScreen, ...all.filter((s) => s !== onScreen)], true);
      serverIdx = 0;
      pick.replaceChildren(
        ...pool.map((s, i) => {
          const carried = serverTracks(s);
          const answers = !ask || carried.includes(ask);
          return h(`button.check${i === serverIdx ? '.is-on' : ''}`, {
            style: { height: '46px', padding: '0 14px', fontSize: '14px', width: '100%' },
            type: 'button',
            'aria-pressed': String(i === serverIdx),
            onclick: () => {
              chooseServer(s);
              api.close();
            },
          },
            i === serverIdx ? icon('check') : null,
            h('span.grow', { style: { textAlign: 'start' } }, serverName(s)),
            h('span.muted', {
              style: { fontSize: '11.5px', letterSpacing: '0.04em', color: answers ? null : 'var(--warn)' },
            }, carried.map(trackChip).join(' · ')),
          );
        }),
        h('a.btn.btn--sm', { href: '#/settings' }, icon('sliders'), t('Add another server in Settings')),
      );
    };
    paint();
    const api = sheet({
      heading: t('Streaming server'),
      sub: ask
        ? t('No server here carries {track} yet. These are the languages each one plays.', { track: trackName(ask) })
        : t('If the video stalls, pick the next one here or just wait — Solvn moves to it by itself.'),
      width: 400,
      render: () => pick,
    });
  }

  const autoNextSwitch = h('button.switch', {
    role: 'switch',
    'aria-checked': String(Boolean(settings.get('autoplay'))),
    'aria-label': t('Auto-play next episode'),
    onclick: (e) => {
      const next = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', String(next));
      settings.set('autoplay', next);
      // Deliberately not reloading the embed: the flag only matters at the end of
      // this episode, and reloading would throw away the viewer's position.
      toast(next ? t('Next episode plays automatically from here on') : t('The player will stop after this episode'), { iconName: next ? 'play' : 'pause' });
    },
  });

  /**
   * Android/Chrome can fullscreen the shell around our own controls. iOS WebKit
   * refuses to fullscreen arbitrary elements, so a rejected request says where the
   * real control lives instead of failing silently.
   */
  const fsSupported =
    typeof playerShell.requestFullscreen === 'function' || typeof playerShell.webkitRequestFullscreen === 'function';

  function fsHint() {
    toast(t('This browser blocked full screen — use the player’s own button, or rotate your device'), { iconName: 'smartphone' });
  }
  function toggleFullscreen() {
    const current = document.fullscreenElement || document.webkitFullscreenElement;
    if (current) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
      return;
    }
    const request = playerShell.requestFullscreen || playerShell.webkitRequestFullscreen;
    if (!request) return fsHint();
    try {
      Promise.resolve(request.call(playerShell, { navigationUI: 'hide' })).catch(fsHint);
    } catch {
      fsHint();
    }
  }
  const fsBtn = h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Full screen'), onclick: toggleFullscreen }, icon('expand'));

  function syncFsState() {
    const on = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    fsBtn.setAttribute('aria-label', on ? t('Leave full screen') : t('Full screen'));
    fsBtn.replaceChildren(icon(on ? 'shrink' : 'expand'));
  }
  if (fsSupported) {
    for (const type of ['fullscreenchange', 'webkitfullscreenchange']) {
      document.addEventListener(type, syncFsState);
      onCleanup(() => document.removeEventListener(type, syncFsState));
    }
  }

  /* ---------------- theater mode ---------------- */
  // The class lives on documentElement so chrome this view never owns — topbar,
  // sidenav, footer, tab bar — can dim from theater.css. Stripped on cleanup, so
  // the lights never stay low once another route loads.
  const theaterBtn = h('button.btn.btn--sm.btn--icon.theater-toggle', {
    'aria-label': t('Theater mode'),
    'aria-pressed': 'false',
    onclick: () => {
      const next = !document.documentElement.classList.contains('theater');
      settings.set('theater', next);
      paintTheater(next);
    },
  }, icon('moon'));

  function paintTheater(on) {
    document.documentElement.classList.toggle('theater', on);
    theaterBtn.setAttribute('aria-pressed', String(on));
  }
  paintTheater(Boolean(settings.get('theater')));
  onCleanup(() => document.documentElement.classList.remove('theater'));

  /* ---------------- quality target ---------------- */
  // The framed player picks the stream, so this is a stated preference it aims
  // for — not a switch that can force 2160p. The sheet says so in plain words.
  const qChip = h('button.btn.btn--sm.btn--glass.q-chip', { 'aria-label': t('Player settings'), onclick: openPlayerSheet }, icon('sliders'), h('span', {}, qualityLabel(settings.get('quality'))));

  function openPlayerSheet() {
    const grid = h('div.q-grid');
    const paint = () => {
      const cur = settings.get('quality');
      grid.replaceChildren(
        ...QUALITIES.map((q) =>
          h(`button.check${q.id === cur ? '.is-on' : ''}`, {
            type: 'button',
            'aria-pressed': String(q.id === cur),
            onclick: () => {
              settings.set('quality', q.id);
              paint();
              qChip.replaceChildren(icon('sliders'), h('span', {}, qualityLabel(q.id)));
              toast(t('Saved as {label}', { label: q.label }), { tone: 'ok', iconName: 'check' });
            },
          }, q.id === cur ? icon('check') : null, h('span', {}, q.label), q.id === '2160p' ? h('span.badge.badge--4k', {}, t('4K')) : null),
        ),
      );
    };
    paint();
    sheet({
      heading: t('Player settings'),
      sub: title(media),
      width: 430,
      render: () =>
        h('div.stack', {},
          h('p', { style: { fontSize: '13.5px', color: 'var(--text-dim)', lineHeight: '1.6' } },
            t('The player streams what its source actually has, so this is the quality it aims for rather than a guarantee. Most anime caps out at 1080p and 4K is rare.')),
          grid,
          h('p.faint', { style: { fontSize: '12.5px', lineHeight: '1.55' } },
            t('Your choice is remembered and used for every episode you open.')),
        ),
    });
  }

  const bar = qs('.player-bar', playerShell);
  function paintBar() {
    bar.replaceChildren(
      ...[
        isMovie ? null : h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Previous episode'), class: ep <= 1 ? 'is-disabled' : '', onclick: () => goEp(ep - 1) }, icon('prev', { cls: 'flip' })),
        isMovie ? null : h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Next episode'), class: hasNext() ? '' : 'is-disabled', onclick: () => goEp(ep + 1) }, icon('next', { cls: 'flip' })),
        offered.length > 1 ? audioSeg : null,
        h('div.now-playing', {},
          h('div.np-1', {}, isMovie ? t('Film') : counted ? t('Episode {ep} of {total}', { ep, total }) : t('Episode {n}', { n: ep })),
          h('div.np-2', {}, current.title || title(media)),
        ),
        h('span.rowline', { style: { gap: '10px' } },
          theaterBtn,
          serverChip,
          hopBtn,
          qChip,
          h('span.faint.only-desktop', { style: { fontSize: '12px' } }, t('Auto-next')),
          autoNextSwitch,
          fsSupported ? fsBtn : null,
        ),
      ].filter(Boolean),
    );
  }
  paintBar();

  /* ---------------- main info ---------------- */
  /* Everything except the player is painted from `media`, which starts as a
     local stub and becomes the real record once the catalogue answers. So each
     section is a host plus a builder: a late answer repaints the page instead
     of leaving it half-filled, and a missing answer leaves it playable. */
  const infoHost = h('div');
  const seasonHost = h('div');
  const upNextHost = h('div');
  const recsHost = h('div');

  function paintInfo() {
    const listState = inList(media.id);
    const fav = isFavourite(media.id) || media.isFavourite;
    const synopsis = plainDescription(media.description, 260);
    infoHost.replaceChildren(
      h('div.watch-info', {},
        h('div.watch-meta', {},
          h('span.badge', {}, formatLabel(media.format)),
          h('span.badge', { class: STATUS_TONE[media.status] ? `badge--${STATUS_TONE[media.status]}` : null }, statusLabel(media.status)),
          yearOf(media) ? h('span.badge', {}, String(yearOf(media))) : null,
          media.averageScore ? h('span.badge.badge--gold', {}, icon('star'), scoreLabel(media.averageScore)) : null,
        ),
        h('h1', { style: { marginTop: '12px' } },
          h('a', { href: `#/anime/${media.id}`, style: { color: 'var(--text-dim)', fontWeight: 600 }, class: 'clamp-1' }, title(media)),
        ),
        h('p', { style: { marginTop: '6px', fontSize: '15px' } }, isMovie ? t('Full film') : `${t('Episode {n}', { n: ep })}${current.title ? ` · ${current.title}` : ''}`),
        synopsis ? h('p.muted', { style: { marginTop: '12px', fontSize: '13.5px', lineHeight: '1.65' } }, synopsis) : null,
        h('div.rowline.wrap', { style: { gap: '8px', marginTop: '18px' } },
          h('button.btn.btn--sm', { onclick: () => openListSheet(media, listState, paintRail) }, icon(listState ? 'check' : 'bookmark'), listState ? listLabel(listState) : t('Add to list')),
          h('button.btn.btn--sm', {
            style: fav ? { color: 'var(--danger)' } : null,
            onclick: (e) => {
              const now = toggleFavourite(media);
              e.currentTarget.style.color = now ? 'var(--danger)' : '';
              toast(now ? t('Added to favourites') : t('Removed from favourites'), { tone: now ? 'ok' : '', iconName: 'heart' });
            },
          }, icon('heart'), fav ? t('Favourited') : t('Favourite')),
          h('a.btn.btn--sm', { href: `#/anime/${media.id}` }, icon('info'), t('Details')),
          h('button.btn.btn--sm', { onclick: () => {
            clearProgress(media.id);
            toast(t('Progress cleared'), { tone: 'ok', iconName: 'check' });
            paintRail();
          } }, icon('refresh'), t('Reset progress')),
        ),
      ),
    );
  }

  /* ---------------- episode rail ---------------- */
  // Long-running titles list 1000+ episodes, so the rail is windowed in blocks
  // that start on the block containing the episode currently playing.
  const WINDOW = 100;
  const maxStart = () => Math.max(0, eps.length - WINDOW);
  const blockOf = (n) => clamp(Math.floor((n - 1) / WINDOW) * WINDOW, 0, maxStart());
  let start = blockOf(ep);

  const railHeading = h('h3.grow', {}, t('Episodes'));
  const rail = h('div');
  const railRange = h('span.badge');
  const railPrev = h('button.icon-btn', { 'aria-label': t('Earlier episodes'), onclick: () => { start = clamp(start - WINDOW, 0, maxStart()); paintRail(); } }, icon('chevronLeft', { cls: 'flip' }));
  const railNext = h('button.icon-btn', { 'aria-label': t('Later episodes'), onclick: () => { start = clamp(start + WINDOW, 0, maxStart()); paintRail(); } }, icon('chevronRight', { cls: 'flip' }));

  function paintRail() {
    if (!eps.length) {
      railHeading.textContent = t('Episodes');
      railRange.textContent = '…';
      railPrev.hidden = railNext.hidden = true;
      rail.replaceChildren(h('div.panel-body', {}, h('p.muted', {}, t('Loading episodes…'))));
      return;
    }
    railHeading.textContent = isMovie ? t('Film') : t('Episodes');
    /* Only the arrows move the window; a repaint keeps the viewer where they
       scrolled to, so the block is clamped rather than re-derived from `ep`. */
    start = clamp(start, 0, maxStart());
    const win = eps.slice(start, start + WINDOW);
    railRange.textContent = eps.length > WINDOW ? `${win[0]?.number ?? 0}–${win.at(-1)?.number ?? 0} / ${eps.length}` : String(eps.length);
    railPrev.hidden = railNext.hidden = eps.length <= WINDOW || isMovie;
    railPrev.disabled = start <= 0;
    railNext.disabled = start >= maxStart();

    const list = h('div.ep-scroll');
    for (const e of win) {
      const locked = !isMovie && media.status === 'RELEASING' && media.nextAiringEpisode && e.number >= media.nextAiringEpisode.episode;
      const watched = e.number < (getProgress(media.id)?.episode || ep);
      list.append(
        h(
          `a.ep${e.number === ep ? '.is-current' : ''}${watched ? '.is-watched' : ''}${locked ? '.is-locked' : ''}`,
          { href: locked ? null : epHref(e.number), 'aria-disabled': String(locked) },
          h('div.ep-num.tnum', {}, locked ? icon('clock') : String(e.number)),
          h('div.ep-body', {},
            h('div.ep-title.clamp-2', { style: { fontSize: '13.5px' } }, e.title || t('Episode {n}', { n: e.number })),
            h('div.ep-sub', {}, locked ? t('Not aired yet') : e.number === ep ? t('Now playing') : t('Ep {n}', { n: e.number })),
          ),
          e.number === ep ? h('span.badge.badge--accent', {}, icon('play')) : null,
        ),
      );
    }
    rail.replaceChildren(list);
  }

  function paintSeasonNote() {
    seasonHost.replaceChildren(
      ...(media.nextAiringEpisode && media.status === 'RELEASING'
        ? [h('div.panel-body', { style: { paddingTop: '0' } },
            h('p', { style: { fontSize: '12.5px', color: 'var(--text-dim)' } },
              h('span', { style: { color: 'var(--accent-text)', fontWeight: 700, fontFamily: 'var(--font-display)' } }, `${t('Ep {n}', { n: media.nextAiringEpisode.episode })} `),
              t('airs {when}', { when: countdown(media.nextAiringEpisode.airingAt) })))]
        : []),
    );
  }

  function paintUpNext() {
    /* Hidden rather than guessed when no count came back: the Next button will
       keep walking, but nothing here promises a card for an episode nobody has
       confirmed exists. */
    if (isMovie || !counted || !hasNext()) return upNextHost.replaceChildren();
    const n = eps.find((e) => e.number > ep);
    upNextHost.replaceChildren(
      h('div.panel-card', {},
        h('div.panel-head', {}, icon('next', { cls: 'flip' }), h('h3.grow', {}, t('Up next'))),
        n
          ? h('a.up-next', { href: epHref(n.number) },
              h('div.up-next-art', {}, h('span.art-ph', {}, icon('film')), episodeArt(media, n, { eager: true })),
              h('div.grow', {},
                h('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '13.5px' } }, n.title || t('Episode {n}', { n: n.number })),
                h('div', { style: { fontSize: '12px', color: 'var(--text-faint)' } }, t('Next · Ep {n}', { n: n.number })),
              ),
              icon('chevronRight', { cls: 'flip' }),
            )
          : h('div.panel-body', {}, h('p.muted', {}, t('That was the last episode.'))),
      ),
    );
  }

  const railCard = h('div.panel-card', {},
    h('div.panel-head', {},
      icon('list'),
      railHeading,
      railPrev,
      railRange,
      railNext,
    ),
    seasonHost,
    rail,
  );

  /* ---------------- recommendations ---------------- */
  function paintRecs() {
    const parts = [];
    const recs = (media.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean).slice(0, 14);
    if (recs.length) parts.push(mediaRow({ heading: t('Viewers also enjoyed'), items: recs }));
    const rels = (media.relations?.edges || []).filter((e) => e.node && e.node.format !== 'MUSIC');
    if (rels.length) parts.push(mediaRow({ heading: t('Related'), items: rels.map((e) => e.node).slice(0, 14) }));
    recsHost.replaceChildren(...parts);
  }

  /* ---------------- watch together ---------------- */
  /**
   * Move this page to wherever the room is. A guest following the host and the
   * Catch up button both land here, and both go through the view's own moves —
   * `swap` so an uncarried track still answers with words instead of a black
   * frame, `goEp` so the progress, the rail and the address all follow.
   */
  function goToRoom(target) {
    const wanted = clamp(Math.max(1, Number(target.ep) || 1), 1, OPEN_END);
    const nextAudio = isTrack(target.audio) ? target.audio : audio;
    const otherTitle = Number(target.media) && String(target.media) !== String(media.id);
    if (otherTitle) {
      /* The host jumped to another show. That is a different page with a
         different catalogue, so the whole link goes — with the room still riding
         in it, or the party ends at the first scene change. */
      go(`/watch/${target.media}/${wanted}${querySuffix(nextAudio, room)}`);
      return;
    }
    if (nextAudio !== audio) swap(nextAudio);
    if (wanted !== ep) goEp(wanted);
  }

  const partyCard = partyPanel({
    code: room,
    where: () => ({ media: Number(media.id), ep, audio, label: title(media) }),
    moveTo: goToRoom,
    /* The countdown is absolute server time, so both ends reload their own frame
       on it. That is the whole of the sync Solvn can honestly deliver. */
    restart: () => play(t('Starting together…')),
    onCode: setRoomCode,
    onCleanup,
  });

  /* ---------------- assembly ---------------- */
  const wrap = h('div.watch', {},
    h('div.rowline', { style: { padding: '10px 0 4px' } },
      h('a.btn.btn--sm.btn--ghost', { href: `#/anime/${media.id}` }, icon('arrowLeft', { cls: 'flip' }), t('Back to details')),
      h('span.topbar-spacer'),
      h('a.btn.btn--sm.btn--ghost', { href: '#/discover' }, icon('compass'), t('Discover')),
    ),
    playerShell,
    h('div.watch-layout', {},
      infoHost,
      h('div.side-panel', {}, upNextHost, railCard, partyCard, commentPanel(media, ep, { onCleanup })),
    ),
    recsHost,
  );

  paintInfo();
  paintSeasonNote();
  paintUpNext();
  paintRail();
  paintRecs();

  function syncTitle() {
    document.title = `${isMovie ? title(media) : `${title(media)} — E${ep}`} · Solvn`;
  }
  syncTitle();
  window.scrollTo({ top: 0 });

  /* ---------------- start the ladder ---------------- */
  startRun();
  play();
  onCleanup(() => clearTimeout(watchdog));

  /* ---------------- metadata ---------------- */
  /* The catalogue answer is decoration, not a gate. Title, synopsis, episode
     names and recommendations arrive when they arrive; if AniList never
     answers, this device's own records are still enough to fill the rail. */
  function repaint(asked) {
    total = resolveEpisodeCount(media);
    counted = !episodeCountIsGuess(media);
    isMovie = media.format === 'MOVIE';
    ep = counted ? clampEp(asked, total) : clamp(Math.max(1, asked), 1, OPEN_END);
    if (!counted) makeRoom(ep);
    current = eps.find((e) => e.number === ep) || { number: ep, title: null };
    start = blockOf(ep);
    mark();
    paintInfo();
    paintSeasonNote();
    paintUpNext();
    paintRail();
    paintRecs();
    paintBar();
    syncTitle();
    /* The catalogue answers after the player is already on the page, so this is
       the moment a locked episode can be discovered mid-flight. */
    const next = nextUnaired();
    if (next && ep >= next) showLocked();
    else if (ep !== asked) play(); // the link asked for an episode that does not exist
  }

  async function hydrate() {
    const asked = ep;
    let learned = false;
    try {
      /* Both clocks matter here: the player is already on the page and the
         title came with the link that opened it, so metadata is a refinement.
         A request that hangs would otherwise keep `repaint()` from ever
         running, and a watch page that never repaints has no episode list, no
         server bar and no next-episode button. */
      const record = await watched(detail(id));
      if (!live) return;
      if (record?.id) {
        if (record.type !== 'ANIME') return go(`/anime/${id}`);
        media = record;
        learned = true;
      }
      eps = media.format === 'MOVIE' ? [{ number: 1, title: title(media) }] : await watched(loadEpisodes(media));
    } catch {
      if (!live) return;
      eps = buildEpisodes(media, media.streamingEpisodes || []);
    }
    if (!live) return;
    if (learned) {
      pushHistory(media);
      announce(media, ep, audio);
    }
    repaint(asked);
  }
  hydrate();

  /* ---------------- navigation helpers ---------------- */
  function goEp(n) {
    const target = counted ? clampEp(n, total) : clamp(Math.max(1, n), 1, OPEN_END);
    if (target === ep) return;
    if (!counted) makeRoom(target);
    setProgress(media, target, { audio });
    go(`/watch/${media.id}/${target}${querySuffix(audio, room)}`);
  }

  function swap(nextAudio) {
    if (nextAudio === audio) return;
    /* A language nothing on this device carries is not a track to load — it is a
       thing to explain, and a way to get it. The frame stays on what is already
       playing, the viewer is told plainly which chip they pressed and why it is
       quiet, and the sheet that opens is the one with every server and the
       Settings route in it. So the button is never dead: it answers. */
    if (!trackCarried(nextAudio)) {
      toast(t('No server here carries {track} yet. Add one that does and this button plays it.', { track: trackName(nextAudio) }), {
        tone: 'info',
        iconName: 'info',
      });
      openServerSheet(nextAudio);
      return;
    }
    /* setTrack puts the new track in the address bar for us. The viewer picked a
       track, so the ladder restarts on it rather than finishing a run that was
       built for the other one. */
    setTrack(nextAudio);
    startRun();
    play();
    paintBar();
  }

  return wrap;
}

const clampEp = (n, total) => Math.min(Math.max(1, n), Math.max(1, total));

/**
 * Discord has no browser presence API, so a status line is a webhook post sent
 * once as each episode starts. Silence on failure is deliberate: the viewer is
 * mid-episode and a broken hook is not worth covering the player with a toast —
 * Settings has a test button for that.
 */
function announce(media, ep, audio) {
  const hook = settings.get('discordHook');
  if (!hook || !settings.get('discordShare') || !isSignedIn()) return;
  const name = title(media);
  const line =
    media.format === 'MOVIE'
      ? `${t('Watching {title}', { title: name })} · ${t('Film')} · Solvn`
      : `${t('Watching {title}', { title: name })} · ${t('Ep {n}', { n: ep })} · ${trackChip(audio)} · Solvn`;
  tellDiscord({ url: hook, text: line }).catch(() => {});
}

async function loadEpisodes(media) {
  try {
    const m = await fetchEpisodes(media.id);
    // Keep the detail payload's stills when the episode query answers empty.
    const streamed = m?.streamingEpisodes?.length ? m.streamingEpisodes : media.streamingEpisodes || [];
    return buildEpisodes({ ...media, ...(m || {}) }, streamed);
  } catch {
    return buildEpisodes(media, media.streamingEpisodes || []);
  }
}

/**
 * Enough of a Media record to drive the watch page while AniList is unreachable.
 * The library, progress and history entries this browser already saved carry the
 * title, cover and episode count — and the embed only ever needs the ID.
 */
function savedMedia(id) {
  for (const list of LISTS) {
    const e = listEntries(list).find((x) => Number(x.id) === Number(id));
    if (e) return stubFrom(e, id);
  }
  const p = getProgress(id);
  if (p) return stubFrom(p, id);
  const watched = watchHistory(60).find((x) => Number(x.id) === Number(id));
  if (watched) return stubFrom(watched, id);
  return stubFrom({}, id);
}

function stubFrom(e, id) {
  return {
    id: Number(id),
    type: 'ANIME',
    title: { romaji: e.title || `Anime #${id}` },
    coverImage: { large: e.cover || null },
    format: e.format || null,
    episodes: e.episodes || e.total || null,
    seasonYear: e.seasonYear || null,
    status: null,
    averageScore: null,
    description: null,
    genres: [],
    isFavourite: false,
    isAdult: false,
    nextAiringEpisode: null,
    streamingEpisodes: [],
  };
}

function openListSheet(media, currentState, onDone) {
  const api = sheet({
    heading: t('Add to your library'),
    sub: title(media),
    render: () =>
      h('div.stack', {},
        ...LISTS.map((k) =>
          h(`button.check${currentState === k ? '.is-on' : ''}`, {
            style: { height: '46px', padding: '0 14px', fontSize: '14px' },
            onclick: (e) => {
              const added = toggleList(media, k);
              [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('is-on'));
              e.currentTarget.classList.add('is-on');
              toast(added ? t('Saved to {list}', { list: listLabel(k) }) : t('Removed from list'), { tone: added ? 'ok' : '', iconName: 'check' });
              document.dispatchEvent(new CustomEvent('kitsune:nav'));
              onDone?.();
              setTimeout(() => api.close(), 380);
            },
          }, currentState === k ? icon('check') : null, listLabel(k)),
        ),
      ),
  });
}
