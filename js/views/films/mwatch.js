/**
 * Movies & Series watch page (`/mwatch/:id`, `/swatch/:id?s=&e=`).
 *
 * Plays a title's direct video address in Solvn's own <video> element. The ready
 * poster waits for a click, then the direct source mounts with native controls.
 * The fullscreen button promotes the shell around it so the SOLVN mark stays in
 * the top layer.
 */

import { h, icon } from '../../lib/dom.js';
import { t } from '../../lib/i18n.js';
import { errorState } from '../../components/media.js';
import { brandBubble, logoMark } from '../../lib/brand.js';
import { api, backdrop, poster, nameOf, setMovieProgress } from '../../lib/tmdb.js';
import { fetchStremioStreamsForTmdb, lastAddonState } from '../../lib/stremio.js';
import { isYtId, mountYouTubePlayer } from '../../lib/youtube.js';
import { attachMedia } from '../../lib/playback.js';
import { isMediaUrl } from '../../lib/sources.js';
import { mRail } from './movies.js';

/* Direct media only: Solvn plays a direct video address in its own <video>
   element. No third-party embed page, no redirects, no ads, no watermarks.
   The address is read from the title's `direct_url` field (set in the catalogue
   or supplied by the operator); when none is present the player says so honestly. */
const DIRECT_URL = (d) => (d && (d.direct_url || d.stream_url || d.video_url)) || '';

export async function MovieWatchView(ctx) {
  const { query } = ctx.route;
  const id = Number(ctx.params.id);
  let type = query.type === 'tv' ? 'tv' : 'movie';
  let isTv = type === 'tv';
  let season = isTv ? Number(query.s) || 1 : 1;
  let episode = isTv ? Number(query.e) || 1 : 1;

  const shell = h('div.mwatch-shell');
  const cleanup = (fn) => ctx?.onCleanup?.(fn);

  let d;
  try {
    d = await api.details(type, id);
  } catch {
    /* A TMDB id belongs to exactly one media type, so a watch address that names
       the other one — /mwatch/<a series id>, or /swatch/<a film id> — asks for a
       title that does not exist and would end on the error card even though the
       title is right there. Ask once more for the other type before giving up. */
    const other = type === 'tv' ? 'movie' : 'tv';
    try {
      d = await api.details(other, id);
      type = other;
      isTv = other === 'tv';
      season = isTv ? Number(query.s) || 1 : 1;
      episode = isTv ? Number(query.e) || 1 : 1;
    } catch {
      return errorState(t('That title'), () => ctx.go(ctx.route.raw));
    }
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
  const sourceRow = h(
    'div.m-mode-row',
    {},
    h('span.badge', {}, icon('play'), t('Solvn Player')),
    chip,
  );
  shell.append(sourceRow);

  /* ---------- player ---------- */

  const readySrc = backdrop(d.backdrop_path) || poster(d.poster_path, 'w780');
  /* No artwork => no <img> at all: an <img> with an empty src makes the browser
     request the page URL and log a 404. */
  const readyArt = readySrc ? h('img.player-ready-art', { src: readySrc, alt: '', decoding: 'async' }) : null;

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

  /* ---------- player (direct media) ---------- */
  const clearFail = () => player.querySelector('.m-fail')?.remove();

  function dropFrame() {
    clearTimeout(hideTimer);
    hideTimer = 0;
    loaded = false;
    if (detachMedia) { detachMedia(); detachMedia = null; }
    if (detachYoutube) { detachYoutube(); detachYoutube = null; }
    if (frame) {
      frame.remove();
      frame = null;
    }
    /* Revoke any caption blob URLs the dropped frame was holding. */
    trackBlobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    trackBlobUrls = [];
  }

  function showFail(msg) {
    if (loaded) return;
    clearFail();
    loadingText.textContent = '';
    const box = h(
      'div.m-fail',
      {},
      h('h3', {}, t('No stream available')),
      h('p', {}, msg || t('No direct video source is configured for this title yet.')),
      h(
        'div.m-fail-actions',
        {},
        h('button.btn.btn--glass.btn--sm', {
          type: 'button',
          onclick: () => loading.classList.add('hide'),
        }, t('Hide this')),
      ),
    );
    loading.append(box);
  }

  let frame = null;
  let hideTimer = 0;
  let loaded = false;
  /* Blob URLs minted for cross-origin caption tracks. Tracked so they can be
     revoked when the frame is dropped or replaced. */
  let trackBlobUrls = [];

  let detachMedia = null;
  let detachYoutube = null;

  /* Official YouTube playback: YouTube's own player, in our box. We never skin
     it or cover its controls — that is their terms, not a preference — so the
     chrome around it is ours and everything inside it stays theirs. */
  function mountYouTube(ytId) {
    dropFrame();
    const host = h('div.m-youtube', {});
    player.append(host);
    mountYouTubePlayer({
      host,
      ytId,
      title,
      onReady: markLoaded,
      /* Embedding refused, video removed or region-locked: the rights holder's
         decision, said plainly instead of a spinner that never ends. */
      onError: () => showFail(t('The rights holder does not allow this video to be embedded.')),
    }).then((mount) => { detachYoutube = () => mount.destroy(); })
      .catch(() => showFail(t('The direct video source did not load.')));
  }

  function markLoaded() {
    if (loaded) return;
    loaded = true;
    setMovieProgress({ type, id, title, posterPath: d.poster_path, season, episode });
    hideTimer = setTimeout(() => {
      loading.classList.add('hide');
      clearFail();
    }, 250);
  }
  async function mountVideo(url, subs) {
    dropFrame();
    frame = h('video', {
      controls: true,
      autoplay: true,
      playsinline: true,
      title: `${title} player`,
    });
    /* External caption tracks (a proxied VTT) are declared as <track>
       elements before the file is loaded, so the browser parses them — and
       shows a `default` one — when attachMedia() sets the src. Cross-origin
       tracks would need CORS on the media element, which breaks hosts that do
       not send it (e.g. Archive.org), so each VTT is fetched into a
       same-origin blob URL first; tracks whose host blocks the fetch are
       dropped. */
    const list = Array.isArray(subs) ? subs : [];
    const converted = await Promise.all(list.map(async (sub) => {
      if (!sub || !sub.url) return null;
      try {
        const res = await fetch(sub.url, { mode: 'cors' });
        if (!res.ok) return null;
        const blob = await res.blob();
        return { ...sub, url: URL.createObjectURL(blob) };
      } catch {
        return null;
      }
    }));
    /* Track the freshly minted blob URLs so they can be revoked later. */
    trackBlobUrls = converted.filter(Boolean).map((s) => s.url);
    converted.filter(Boolean).forEach((sub, i) => {
      const tr = h('track', {
        kind: 'subtitles',
        src: sub.url,
        srclang: sub.lang || 'en',
        label: sub.label || sub.lang || `Subtitle ${i + 1}`,
      });
      if (i === 0) tr.setAttribute('default', '');
      frame.append(tr);
    });
    if (detachMedia) { detachMedia(); detachMedia = null; }
    attachMedia(frame, url).then((teardown) => { detachMedia = teardown; }).catch(() => {});
    frame.addEventListener('loadeddata', markLoaded);
    frame.addEventListener('error', () => {
      loaded = false;
      showFail(t('The direct video source did not load.'));
    });
    player.append(frame);
  }

  async function startStream() {
    ready.hidden = true;
    clearFail();
    loading.classList.remove('hide');
    loadingText.textContent = t('Preparing your stream…');
    let url = DIRECT_URL(d);
    let yt = '';
    let subs = [];
    if (url && Array.isArray(d?.subtitles)) subs = d.subtitles;
    /* No operator link: resolve the TMDB id through the configured anime
       add-ons so catalogue anime films and series play too. */
    if (!url) {
      try {
        const streams = await fetchStremioStreamsForTmdb(id, type, season, episode);
        /* A file Solvn plays itself always wins. An official YouTube entry is
           the next honest answer: it plays in the site, in YouTube's player. */
        const first = streams.find((s) => isMediaUrl(s.url));
        url = first?.url || '';
        if (url) subs = Array.isArray(first?.subtitles) ? first.subtitles : [];
        if (!url) yt = streams.find((s) => isYtId(s.ytId))?.ytId || '';
      } catch { /* fall through to the honest no-source state */ }
    }
    if (!url && !yt) {
      /* Two different dead ends, said differently. An add-on that never
         answered is a broken source the viewer can act on; a title nothing
         carries is not, and telling them to check settings they already have
         sends them hunting for a fault that is not there. */
      const { down, live } = lastAddonState();
      showFail(!live && down.length
        ? t('Your configured stream add-on could not be reached: {list}. It may be down or have moved.', { list: down.join(', ') })
        : t('No direct video source is configured for this title yet.'));
      return;
    }
    if (url) await mountVideo(url, subs);
    else mountYouTube(yt);
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
    h('p.m-safety-about', {}, t("Solvn Player: this title plays from a direct video source in Solvn's own player. No third-party embed page, no redirects, no ads, no watermarks.")),
  );
  shell.append(safetyPanel);

  chip.replaceChildren(icon('shield'), h('span', {}, t('Direct media')));
  chip.title = t("The stream plays directly in Solvn's own player.");

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
  });

  return shell;
}
