/**
 * Movies & Series watch page (`/mwatch/:id`, `/swatch/:id?s=&e=`).
 *
 * Two mirrors of the stream partner's embed, addressed by TMDB id. The ready
 * poster waits for a click, the iframe stays in a locked frame, and the source
 * chip switches mirrors without leaving the page. The fullscreen button
 * promotes the shell around it so the SOLVN mark stays in the top layer.
 */

import { h, icon } from '../../lib/dom.js';
import { t } from '../../lib/i18n.js';
import { errorState } from '../../components/media.js';
import { brandBubble, logoMark } from '../../lib/brand.js';
import { api, backdrop, poster, nameOf, setMovieProgress } from '../../lib/tmdb.js';
import { mRail } from './movies.js';
import { FRAME_SANDBOX } from '../../lib/sources.js';

/* Two addresses for the same player. The second is the same service on its
   alternate host, so one DNS or edge failure does not leave the film with no
   picture; the source chip beside the player switches between them by hand when
   the first page paints but never starts its video. */
const STREAM_SERVERS = [
  { name: 'Solvn Stream 1', host: 'anigato.lol' },
  { name: 'Solvn Stream 2', host: '1337embed.wtf' },
];
const streamUrl = (server, type, id, season, episode) =>
  type === 'tv'
    ? `https://${server.host}/embed/series/${id}/${season}/${episode}`
    : `https://${server.host}/embed/movie/${id}`;

export async function MovieWatchView(ctx) {
  const { query } = ctx.route;
  const isTv = query.type === 'tv';
  const id = Number(ctx.params.id);
  const season = isTv ? Number(query.s) || 1 : 1;
  const episode = isTv ? Number(query.e) || 1 : 1;
  const type = isTv ? 'tv' : 'movie';

  const shell = h('div.mwatch-shell');
  const cleanup = (fn) => ctx?.onCleanup?.(fn);

  let d;
  try {
    d = await api.details(type, id);
  } catch {
    return errorState(t('That title'), () => ctx.go(ctx.route.raw));
  }
  d.media_type = type;
  const title = nameOf(d);
  const year = String(d.release_date || d.first_air_date || '').slice(0, 4);

  /* ---------- top bar ---------- */
  const top = h(
    'div.mwatch-top',
    {},
    h('a.icon-btn', { href: isTv ? `#/series/${id}` : `#/movie/${id}`, 'aria-label': t('Back to details') }, icon('chevronLeft', { cls: 'flip' })),
    h(
      'div',
      { style: { minWidth: 0 } },
      h('h1', {}, title),
      h(
        'div.mwatch-ep',
        {},
        isTv
          ? `${t('Season')} ${season} · ${t('Episode')} ${episode}`
          : `${year}${d.runtime ? ` · ${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : ''}`,
      ),
    ),
    h('span.spacer'),
  );
  shell.append(top);

  /* ---------- source + safety ---------- */
  const chip = h('span.m-safety', { role: 'status' });
  let sourceIndex = 0;
  let streamStarted = false;
  const sourceName = h('span', {}, STREAM_SERVERS[sourceIndex].name);
  const sourceSwitch = h(
    'button.m-safety.m-source-switch',
    {
      type: 'button',
      'aria-label': t('Switch stream server'),
      title: t('Switch stream server'),
      onclick: () => switchSource(),
    },
    icon('shuffle'),
    sourceName,
  );
  const sourceRow = h(
    'div.m-mode-row',
    {},
    h('span.badge', {}, icon('play'), t('Solvn Player')),
    chip,
    sourceSwitch,
  );
  shell.append(sourceRow);

  /* ---------- player ---------- */
  const preconnects = STREAM_SERVERS.map((server) => h('link', {
    rel: 'preconnect',
    href: `https://${server.host}`,
    crossorigin: 'anonymous',
  }));
  document.head.append(...preconnects);
  cleanup(() => preconnects.forEach((link) => link.remove()));

  const readyArt = h('img.player-ready-art', { alt: '', decoding: 'async' });
  const readySrc = backdrop(d.backdrop_path) || poster(d.poster_path, 'w780');
  if (readySrc) readyArt.src = readySrc;
  else readyArt.hidden = true;

  const loadingText = h('span');
  const ready = h(
    'div.player-ready',
    {},
    readyArt,
    h('div.player-ready-shade'),
    h(
      'div.player-ready-copy.is-start',
      {},
      h('span.player-ready-kicker', {}, t('READY TO STREAM')),
      h('h2.player-ready-title', {}, title),
      h('p.player-ready-meta', {}, isTv
        ? `${t('Season')} ${season} · ${t('Episode')} ${episode}`
        : `${year || t('Film')} · ${t('Press play to start')}`),
      h('button.player-ready-play', {
        type: 'button',
        onclick: () => startStream(),
      }, icon('play'), h('span', {}, t('Play now'))),
    ),
  );

  const solvnMark = h(
    'div.m-solvn-mark',
    { 'aria-hidden': 'true' },
    logoMark(46),
    h('span.m-solvn-word', {}, 'SOLVN'),
  );
  const player = h(
    'div.m-player',
    {},
    ready,
    h('div.m-player-loading.hide', { role: 'status' }, h('span.m-spinner', { 'aria-hidden': 'true' }), loadingText),
    solvnMark,
  );
  const loading = player.querySelector('.m-player-loading');

  const fsLabel = h('span', {}, t('Fullscreen'));
  const fsBtn = h(
    'button.m-player-fs',
    {
      type: 'button',
      'aria-label': t('Fullscreen'),
      'aria-pressed': 'false',
      onclick: () => toggleFullscreen(),
    },
    icon('expand'),
    fsLabel,
  );
  const playerShell = h(
    'div.m-player-shell',
    {},
    h(
      'div.m-player-head',
      {},
      h(
        'div.m-player-brand',
        {},
        brandBubble({ variant: 'brand-bubble--player' }),
        h('span.mpb-sub', {}, t('Movies & Series')),
      ),
      fsBtn,
    ),
    player,
  );
  shell.append(playerShell);

  /* ---------- fullscreen ---------- */
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function paintFullscreen() {
    if (fsElement() === playerShell && playerShell.classList.contains('is-faux-fs')) {
      playerShell.classList.remove('is-faux-fs');
      document.body.classList.remove('m-faux-fs');
    }
    const on = fsElement() === playerShell || playerShell.classList.contains('is-faux-fs');
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.setAttribute('aria-label', on ? t('Exit fullscreen') : t('Fullscreen'));
    fsLabel.textContent = on ? t('Exit fullscreen') : t('Fullscreen');
  }
  function enterFaux() {
    playerShell.classList.add('is-faux-fs');
    document.body.classList.add('m-faux-fs');
    paintFullscreen();
  }
  function exitFaux() {
    playerShell.classList.remove('is-faux-fs');
    document.body.classList.remove('m-faux-fs');
    paintFullscreen();
  }
  async function toggleFullscreen() {
    if (playerShell.classList.contains('is-faux-fs')) {
      exitFaux();
      return;
    }
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        await exit?.call(document);
      } catch { /* already left fullscreen */ }
      paintFullscreen();
      return;
    }
    const request = playerShell.requestFullscreen || playerShell.webkitRequestFullscreen;
    if (!request) {
      enterFaux();
      return;
    }
    try {
      const pending = request.call(playerShell);
      if (pending && typeof pending.then === 'function') {
        await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 700))]);
      }
      if (!fsElement()) enterFaux();
      paintFullscreen();
    } catch {
      enterFaux();
    }
  }
  const onFsKey = (event) => {
    if (event.key === 'Escape' && playerShell.classList.contains('is-faux-fs')) exitFaux();
  };
  document.addEventListener('keydown', onFsKey);
  for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(name, paintFullscreen);
  cleanup(() => {
    document.removeEventListener('keydown', onFsKey);
    for (const name of ['fullscreenchange', 'webkitfullscreenchange']) document.removeEventListener(name, paintFullscreen);
    playerShell.classList.remove('is-faux-fs');
    document.body.classList.remove('m-faux-fs');
  });

  /* ---------- iframe ---------- */
  let frame = null;
  let loadTimer = 0;
  let hideTimer = 0;
  let loaded = false;

  const clearFail = () => player.querySelector('.m-fail')?.remove();

  function dropFrame() {
    clearTimeout(loadTimer);
    clearTimeout(hideTimer);
    loadTimer = 0;
    hideTimer = 0;
    loaded = false;
    if (frame) {
      frame.remove();
      frame = null;
    }
  }

  function showFail() {
    if (loaded) return;
    clearFail();
    loadingText.textContent = '';
    const box = h(
      'div.m-fail',
      {},
      h('h3', {}, t('The player did not open')),
      h('p', {}, t('The stream service did not answer this title. Check the connection, then try again.')),
      h(
        'div.m-fail-actions',
        {},
        h('button.btn.btn--primary.btn--sm', {
          type: 'button',
          onclick: () => {
            sourceIndex = 0;
            paintSource();
            startStream();
          },
        }, icon('refresh'), t('Re-check & retry')),
        h('button.btn.btn--glass.btn--sm', {
          type: 'button',
          onclick: () => switchSource(),
        }, icon('shuffle'), t('Try another server')),
        h('button.btn.btn--glass.btn--sm', {
          type: 'button',
          onclick: () => loading.classList.add('hide'),
        }, t('Hide this')),
      ),
    );
    loading.append(box);
  }

  function paintSource() {
    sourceName.textContent = STREAM_SERVERS[sourceIndex].name;
  }

  /** Move to the next mirror and, if a frame is already on screen, reload it. */
  function switchSource() {
    sourceIndex = (sourceIndex + 1) % STREAM_SERVERS.length;
    paintSource();
    if (streamStarted) startStream();
  }

  function mountFrame() {
    dropFrame();
    frame = h('iframe', {
      src: streamUrl(STREAM_SERVERS[sourceIndex], type, id, season, episode),
      sandbox: FRAME_SANDBOX,
      allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
      referrerpolicy: 'origin',
      title: `${title} player`,
    });
    frame.addEventListener('load', () => {
      if (loaded) return;
      loaded = true;
      clearTimeout(loadTimer);
      setMovieProgress({ type, id, title, posterPath: d.poster_path, season, episode });
      hideTimer = setTimeout(() => {
        loading.classList.add('hide');
        clearFail();
      }, 250);
    });
    frame.addEventListener('error', () => {
      loaded = false;
      showFail();
    });
    player.append(frame);
  }

  function startStream() {
    streamStarted = true;
    ready.hidden = true;
    clearFail();
    loading.classList.remove('hide');
    loadingText.textContent = t('Preparing your stream…');
    mountFrame();
    loadTimer = setTimeout(() => {
      /* A frame that has not even fired `load` has not painted, so this is the
         one failure a cross-origin player can report without being readable:
         move to the other mirror before asking the viewer to retry. */
      if (sourceIndex + 1 < STREAM_SERVERS.length) {
        sourceIndex += 1;
        paintSource();
        startStream();
        return;
      }
      showFail();
    }, 14000);
  }

  function paintMeta() {
    return h(
      'div.m-panel',
      {},
      h('h3', {}, title),
      h(
        'div.m-fact',
        {},
        h('b', {}, isTv ? t('Episode') : t('Released')),
        h('span', {}, isTv ? `${t('Season')} ${season} · ${t('Episode')} ${episode}` : year || t('Unknown')),
      ),
      d.overview ? h('p.m-overview', {}, d.overview) : null,
    );
  }

  const metaRow = h('div.m-meta', {}, paintMeta());
  shell.append(metaRow);

  const safetyPanel = h(
    'div.m-safety-panel',
    {},
    h('p.m-safety-about', {}, t('Solvn Player: the stream runs in a locked frame owned by our stream partner. The browser refuses it new tabs, movement of this page and downloads, so anything asking to install or update something is drawn inside that frame and cannot leave it.')),
    h('div.m-safety-list', {}, ...STREAM_SERVERS.map((server) => h('span.m-safety-origin', {}, server.host, h('b', {}, t('player'))))),
  );
  shell.append(safetyPanel);

  chip.replaceChildren(icon('shield'), h('span', {}, t('Locked stream frame')));
  chip.title = t('The stream is mounted in a sandboxed frame.');

  /* ---------- episode nav (TV) ---------- */
  if (isTv) {
    shell.insertBefore(
      h(
        'div.m-fail-actions',
        { style: { justifyContent: 'flex-start', margin: 0 } },
        h('a.btn.btn--glass.btn--sm', {
          href: `#/swatch/${id}?s=${season}&e=${Math.max(1, episode - 1)}`,
        }, icon('prev'), t('Prev episode')),
        h('a.btn.btn--glass.btn--sm', {
          href: `#/swatch/${id}?s=${season}&e=${episode + 1}`,
        }, t('Next episode'), icon('next')),
      ),
      metaRow,
    );
  }

  /* ---------- recommendations ---------- */
  const recs = ((d.recommendations || {}).results || (d.similar || {}).results || [])
    .filter((row) => row.poster_path)
    .slice(0, 16);
  if (recs.length) {
    shell.append(mRail({
      heading: t('More like this'),
      sub: title,
      fetcher: async () => recs.map((row) => ({ ...row, media_type: type })),
    }));
  }

  cleanup(() => {
    dropFrame();
    clearTimeout(loadTimer);
  });

  return shell;
}
