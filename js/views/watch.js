/** Watch: framed player with server failover, episode rail, sub/dub switch, progress. */

import { h, icon, qs } from '../lib/dom.js';
import { detail, episodes as fetchEpisodes } from '../lib/anilist.js';
import { go, parse } from '../lib/router.js';
import {
  settings,
  accentHex,
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
import { title, formatLabel, yearOf, statusLabel, listLabel, STATUS_TONE, plainDescription, countdown, scoreLabel, clamp } from '../lib/util.js';
import { buildEpisodes, resolveEpisodeCount } from '../lib/embed.js';
import { FRAME_ALLOW, FRAME_SANDBOX, cooling, failoverMs, markServer, serverName, serverUrl, servers } from '../lib/sources.js';
import { mediaRow, emptyState, episodeArt } from '../components/media.js';
import { commentPanel } from '../components/comments.js';
import { sheet, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';

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
  let isMovie = media.format === 'MOVIE';
  let eps = isMovie ? [{ number: 1, title: title(media) }] : [];
  const stored = getProgress(id);
  /* Only the lower bound is applied here. Until the catalogue answers, `total`
     is a guess, and clamping a shared link like …/24 against a guessed 12 would
     quietly play the wrong episode. `repaint` clamps it for real. */
  let ep = Math.max(1, requestedEp || stored?.episode || 1);
  /* Audio precedence: the link you followed beats where this show left off,
     and both beat the default — so "start new episodes dubbed" finally reaches
     a title this browser has never opened. */
  const pref = settings.get('defaultAudio') === 'dub' ? 'dub' : 'sub';
  const q = route.query.audio === 'dub' || route.query.audio === 'sub' ? route.query.audio : null;
  let audio = q || stored?.audio || pref;
  let current = eps.find((e) => e.number === ep) || { number: ep, title: null };
  /* A metadata answer that lands after the viewer moved on must not paint into
     a route nobody is looking at any more. */
  let live = true;
  onCleanup(() => {
    live = false;
  });

  function mark() {
    setProgress(media, ep, { audio });
    setNowWatching(media, ep);
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
  const bootLast = [bootNext, bootList];
  const boot = h('div.player-boot', {},
    h('div.player-boot-stack', {},
      bootSpin,
      bootMsg,
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
  const frameBox = h('div.player-frame', {}, frame, boot);

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
      accent: accentHex(settings.get('accent')),
    });

  function arm() {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => advance(false), failoverMs());
  }

  /**
   * Every enabled server on this track, then the same run on the other one.
   *
   * A server this device just watched fail goes to the back of the queue rather
   * than opening the next episode, so one dead frame does not cost a dozen
   * seconds every time the viewer hops. `ordered` + `pinned` are the case where
   * they picked that server by name: that list is used exactly as given.
   */
  function startRun(ordered, pinned) {
    pool = ordered || servers();
    if (serverIdx >= pool.length) serverIdx = 0;
    const other = audio === 'dub' ? 'sub' : 'dub';
    const order = pool.map((_, i) => i);
    if (!pinned) order.sort((a, b) => Number(cooling(pool[a].id)) - Number(cooling(pool[b].id)));
    run = [];
    for (const track of [audio, other]) order.forEach((i) => run.push({ i, track }));
    pos = 0;
  }

  function hideBoot() {
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
    boot.classList.remove('is-gone');
    bootSpin.classList.remove('hide');
    bootLast.forEach((b) => b.classList.add('hide'));
    bootMsg.textContent = msg || t('Warming up the player…');
    loadFrame(frameUrl());
    frame.title = `${title(media)} — ${t('Episode {n}', { n: ep })} (${audio === 'dub' ? t('Dub') : t('Sub')})`;
    arm();
  }

  /* A cross-origin frame cannot report a failed video, so silence is the only
     automatic signal there is: no `load` inside the failover window counts that
     server dead and the next rung is loaded into the same frame — no error page,
     no leaving the site. A viewer who presses "Switch server" while a frame is
     sitting on 0:00 is the second signal, and it is treated the same way: that
     server is dropped to the back of the queue for the rest of the cooldown. */
  function advance(manual) {
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
          ? t('Trying the {a} source instead.', { a: step.track === 'dub' ? t('Dub') : t('Sub') })
          : t('Trying {name}…', { name: serverName(pool[step.i]) });
    }
    loadFrame(frameUrl());
    frame.title = `${title(media)} — ${t('Episode {n}', { n: ep })} (${audio === 'dub' ? t('Dub') : t('Sub')})`;
    arm();
  }

  function giveUp() {
    /* Every server on this track and the other one had its turn and said
       nothing. Marking the whole pool is honest, and it means the next episode
       starts on a fresh window instead of the same silent ladder. */
    pool.forEach((s) => markServer(s.id, false));
    bootSpin.classList.add('hide');
    bootMsg.textContent = t('No server answered for this episode.');
    if (ep < total) bootNext.classList.remove('hide');
    bootList.classList.remove('hide');
  }

  /** Change track without remounting the view — the ladder's own step. */
  function setTrack(next) {
    audio = next;
    mark();
    subBtn.classList.toggle('is-active', audio === 'sub');
    dubBtn.classList.toggle('is-active', audio === 'dub');
    subBtn.setAttribute('aria-pressed', String(audio === 'sub'));
    dubBtn.setAttribute('aria-pressed', String(audio === 'dub'));
    /* A hop nobody clicked still has to be reflected in the address, or a link
       copied from the bar at that moment opens the other track. */
    go(`/watch/${media.id}/${ep}${audio === 'dub' ? '?audio=dub' : ''}`, { replace: true, keepScroll: true });
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
  const subBtn = h('button.is-active', { 'aria-pressed': 'true', onclick: () => swap('sub') }, t('Sub'));
  const dubBtn = h('button', { 'aria-pressed': 'false', onclick: () => swap('dub') }, t('Dub'));
  const audioSeg = h('div.seg', { role: 'group', 'aria-label': t('Audio track') }, subBtn, dubBtn);

  /* Which server is on screen right now, and a way to pick another one without
     waiting for the silence clock. */
  const serverChip = h('button.btn.btn--sm.btn--glass.q-chip', {
    'aria-label': t('Streaming server'),
    onclick: openServerSheet,
  }, icon('cast'), h('span', {}, serverName(pool[serverIdx])));

  /* A frame can load its page and still show nothing but 0:00, and a
     cross-origin player cannot tell us that happened. So the viewer says it
     instead: one tap here drops the current server to the back of the queue and
     loads the same episode from the next one, inside this frame. */
  const hopBtn = h('button.btn.btn--sm.btn--glass', {
    'aria-label': t('Not playing? Switch to another server'),
    onclick: () => advance(true),
  }, icon('refresh'), h('span', {}, t('Not playing?')));

  function openServerSheet() {
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
        ...pool.map((s, i) =>
          h(`button.check${i === serverIdx ? '.is-on' : ''}`, {
            style: { height: '46px', padding: '0 14px', fontSize: '14px' },
            type: 'button',
            'aria-pressed': String(i === serverIdx),
            onclick: () => {
              chooseServer(s);
              api.close();
            },
          }, i === serverIdx ? icon('check') : null, h('span', {}, serverName(s))),
        ),
        h('a.btn.btn--sm', { href: '#/settings' }, icon('sliders'), t('Add another server in Settings')),
      );
    };
    paint();
    const api = sheet({
      heading: t('Streaming server'),
      sub: t('If the video stalls, pick the next one here or just wait — Solvn moves to it by itself.'),
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
          }, q.id === cur ? icon('check') : null, h('span', {}, q.label), q.id === '2160p' ? h('span.badge', {}, t('4K')) : null),
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
        ),
    });
  }

  const bar = qs('.player-bar', playerShell);
  function paintBar() {
    bar.replaceChildren(
      ...[
        isMovie ? null : h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Previous episode'), class: ep <= 1 ? 'is-disabled' : '', onclick: () => goEp(ep - 1) }, icon('prev', { cls: 'flip' })),
        isMovie ? null : h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Next episode'), class: ep >= total ? 'is-disabled' : '', onclick: () => goEp(ep + 1) }, icon('next', { cls: 'flip' })),
        audioSeg,
        h('div.now-playing', {},
          h('div.np-1', {}, isMovie ? t('Film') : t('Episode {ep} of {total}', { ep, total })),
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
          { href: locked ? null : `#/watch/${media.id}/${e.number}${audio === 'dub' ? '?audio=dub' : ''}`, 'aria-disabled': String(locked) },
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
    if (isMovie || ep >= total) return upNextHost.replaceChildren();
    const n = eps.find((e) => e.number > ep);
    upNextHost.replaceChildren(
      h('div.panel-card', {},
        h('div.panel-head', {}, icon('next', { cls: 'flip' }), h('h3.grow', {}, t('Up next'))),
        n
          ? h('a.up-next', { href: `#/watch/${media.id}/${n.number}${audio === 'dub' ? '?audio=dub' : ''}` },
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
      h('div.side-panel', {}, upNextHost, railCard, commentPanel(media, ep, { onCleanup })),
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
    isMovie = media.format === 'MOVIE';
    ep = clampEp(asked, total);
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
    if (ep !== asked) play(); // the link asked for an episode that does not exist
  }

  async function hydrate() {
    const asked = ep;
    let learned = false;
    try {
      const record = await detail(id);
      if (!live) return;
      if (record?.id) {
        if (record.type !== 'ANIME') return go(`/anime/${id}`);
        media = record;
        learned = true;
      }
      eps = media.format === 'MOVIE' ? [{ number: 1, title: title(media) }] : await loadEpisodes(media);
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
    const target = clampEp(n, total);
    if (target === ep) return;
    setProgress(media, target, { audio });
    go(`/watch/${media.id}/${target}${audio === 'dub' ? '?audio=dub' : ''}`);
  }

  function swap(nextAudio) {
    if (nextAudio === audio) return;
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
      : `${t('Watching {title}', { title: name })} · ${t('Ep {n}', { n: ep })}${audio === 'dub' ? ` · ${t('Dub')}` : ` · ${t('Sub')}`} · Solvn`;
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
