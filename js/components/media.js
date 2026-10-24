/** Media card, carousel row, and the shared loading/error/empty states. */

import { h, icon, qs, scrollMax, scrollPos, scrollInlineBy } from '../lib/dom.js';
import { title, formatLabel, yearOf, episodeCount, scoreTone, scoreLabel, statusLabel, STATUS_TONE } from '../lib/util.js';
import { getProgress } from '../lib/store.js';
import { t } from '../lib/i18n.js';

/* ---- image with fade-in and a fallback ladder ---------------------- */
/**
 * AniList is frequently missing or wrong about one particular image size, and a
 * per-episode still only exists at all for licensed titles, so every frame in
 * the app is fed a ladder: each source is tried in order and the element only
 * removes itself once the ladder runs out, leaving the caller's placeholder.
 */
export function stillImage(sources, { alt = '', eager = false } = {}) {
  const list = [...new Set((sources || []).filter(Boolean))];
  if (!list.length) return null;
  let i = 0;
  const img = h('img', {
    alt,
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    fetchpriority: eager ? 'high' : null,
    onload: () => img.classList.add('is-loaded'),
    onerror: () => {
      i += 1;
      if (i < list.length) img.src = list[i];
      else img.remove();
    },
  });
  img.src = list[0];
  return img;
}

/**
 * `extraLarge` is the ceiling AniList publishes for a cover (~1220px on the
 * long edge), so a lead slot asks for it and `large` stays as a rung, not the
 * choice. Rails and the 54px split thumbs keep asking for `large`: the frame
 * never gets wide enough to show the difference, and a grid of forty 1220px
 * crops is forty fetches paid for nothing.
 */
export function posterImage(media, { eager = false, size = 'large' } = {}) {
  const c = media?.coverImage;
  return stillImage([c?.[size], c?.large, c?.extraLarge, media?.bannerImage], {
    eager,
    alt: t('{title} key art', { title: title(media) }),
  }) || h('span.card-ph', {}, icon('film'));
}

/**
 * Art for one episode row: the curated still when AniList has one, then the
 * show's own banner and cover, so a row can never render as an empty frame.
 */
export function episodeArt(media, ep, { eager = false } = {}) {
  const c = media?.coverImage;
  return stillImage([ep?.thumb, media?.bannerImage, c?.large, c?.extraLarge], { eager });
}

/** The little contextual pill on a poster, mirroring the reference's tag. */
function cardFlag(media) {
  const p = getProgress(media.id);
  if (p?.episode) {
    return h('span.flag', {}, icon('history'), t('Ep {n}', { n: p.episode }));
  }
  if (media.status === 'RELEASING') {
    return h('span.flag', {}, icon('film'), t('Airing'));
  }
  if (media.format === 'MOVIE') {
    return h('span.flag', {}, icon('sparkles'), t('Film'));
  }
  if (media.status === 'NOT_YET_RELEASED') {
    return h('span.flag', {}, icon('calendar'), t('Upcoming'));
  }
  return null;
}

/* ---- poster card ---------------------------------------------------- */
export function mediaCard(media, { to, eager = false, showTitle = true, meta = true, rank = null, progress = null, size = 'large' } = {}) {
  const href = to || `#/anime/${media.id}`;
  const score = media.averageScore;
  const prog = progress ?? (getProgress(media.id) && media.format !== 'MOVIE' ? getProgress(media.id) : null);
  const pct = prog?.total ? Math.min(100, (prog.episode / prog.total) * 100) : null;

  const flag = cardFlag(media);
  const art = h(
    'div.card-art',
    {},
    posterImage(media, { eager, size }),
    flag ? h('div.card-flag', {}, flag) : null,
    score ? h('span.card-score', { class: scoreTone(score) === 'low' ? 'is-low' : null }, icon('star'), scoreLabel(score)) : null,
    h('div.card-play', {}, h('span', {}, icon('play'))),
    pct != null ? h('div.card-progress', {}, h('i', { style: { width: `${pct}%` } })) : null,
  );

  const metaBits = [];
  if (meta) {
    metaBits.push(h('span', {}, formatLabel(media.format)));
    const y = yearOf(media);
    if (y) metaBits.push(h('span.dot'), h('span.tnum', {}, String(y)));
    const ec = episodeCount(media);
    if (ec && media.format !== 'MOVIE') metaBits.push(h('span.dot'), h('span', {}, ec));
  }

  const card = h(
    `a.card${rank ? '.card--rank' : ''}`,
    { href, 'aria-label': title(media) },
    rank ? h('span.card-rank.tnum', {}, String(rank)) : null,
    art,
    showTitle
      ? h(
          'div.card-body',
          {},
          h('div.card-title.clamp-2', {}, title(media)),
          metaBits.length ? h('div.card-meta', {}, ...metaBits) : null,
        )
      : null,
  );
  return card;
}

export function cardSkeleton(count = 7) {
  return Array.from({ length: count }, () =>
    h('div.card', { 'aria-hidden': 'true' }, h('div.sk.sk--poster'), h('div.sk.sk--text'), h('div.sk.sk--text.w60')),
  );
}

/* ---- carousel row ---------------------------------------------------- */
export function mediaRow({ id, heading, sub, items = [], viewAll, skeleton = false, rank = false, empty }) {
  const track = h(`div.row.no-scrollbar${skeleton ? '.is-skeleton' : ''}`, { id, role: 'list' });
  const fill = () => {
    track.replaceChildren();
    if (skeleton) {
      track.append(...cardSkeleton(8));
      return;
    }
    if (!items.length) {
      track.append(h('p.muted', { style: { padding: '20px 0', fontSize: '14px' } }, empty || t('Nothing to show here right now.')));
      return;
    }
    items.forEach((m, i) => {
      const wrap = h('div', { role: 'listitem', style: { display: 'contents' } });
      wrap.append(mediaCard(m, { rank: rank ? i + 1 : null, eager: i < 4 }));
      track.append(wrap);
    });
  };
  fill();

  const prev = h('button.row-arrow.prev', { 'aria-label': t('Scroll backwards'), hidden: true }, icon('chevronLeft', { cls: 'flip' }));
  const next = h('button.row-arrow.next', { 'aria-label': t('Scroll forwards'), hidden: true }, icon('chevronRight', { cls: 'flip' }));

  const update = () => {
    if (skeleton) return;
    const max = scrollMax(track);
    const pos = scrollPos(track);
    prev.hidden = pos <= 4;
    next.hidden = max <= 4 || pos >= max - 4;
  };

  const nudge = (dir) => {
    scrollInlineBy(track, dir * Math.max(track.clientWidth * 0.8, 220));
  };
  prev.addEventListener('click', () => nudge(-1));
  next.addEventListener('click', () => nudge(1));
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  requestAnimationFrame(update);

  /* No wheel handler: a vertical scroll belongs to the page. Rows move with a
     horizontal trackpad swipe, a drag, or the arrows in their own header. */
  return h(
    'section.section.row-wrap',
    {},
    h(
      'div.section-head',
      {},
      h('h2', {}, heading),
      sub ? h('span.sub', {}, sub) : null,
      h('span.spacer'),
      viewAll ? h('a.link-all', { href: viewAll }, t('View all'), icon('chevronRight', { cls: 'flip' })) : null,
    ),
    track,
    prev,
    next,
  );
}

/* ---- editorial blocks -------------------------------------------------- */
/* Home's two non-rail shapes. Neither one touches a card: they only say where
   the cards that `mediaCard()` returns get put, so the poster ladder, the hover
   lift, the rank numerals and the progress bars all carry straight into the new
   arrangement. Sizing lives in layout.css — nothing here writes a style. */

/** One lead card beside a stack of smaller ones. */
const FEATURE_ITEMS = 7;
/** One wide art card beside a short list of titled rows. */
const SPLIT_ITEMS = 5;

const blockHead = (opts) =>
  h(
    'div.section-head',
    {},
    h('h2', {}, opts.heading),
    opts.sub ? h('span.sub', {}, opts.sub) : null,
    h('span.spacer'),
    opts.viewAll
      ? h('a.link-all', { href: opts.viewAll }, t('View all'), icon('chevronRight', { cls: 'flip' }))
      : null,
  );

/** A body that holds a state rather than an arrangement gets out of the grid. */
function staticTrack(track, node) {
  track.classList.add('is-static');
  track.replaceChildren(node);
  return node;
}

const note = (text) => h('p.muted', { style: { padding: '20px 0', fontSize: '14px' } }, text);

export function mediaFeature({ id, heading, sub, items = [], viewAll, skeleton = false, rank = false, empty }) {
  const lead = h('div.feature-lead', { role: 'listitem' });
  const stack = h('div.feature-stack', { role: 'listitem' });
  const track = h(`div.feature.block-track${skeleton ? '.is-skeleton' : ''}`, { id, role: 'list' }, lead, stack);

  if (skeleton) {
    lead.append(cardSkeleton(1)[0]);
    stack.append(...cardSkeleton(FEATURE_ITEMS - 1));
  } else if (!items.length) {
    staticTrack(track, note(empty || t('Nothing to show here right now.')));
  } else {
    /* The lead takes five of twelve columns, so at the desktop width it is a
       ~560px poster: double-densities want the 1220px source. The stacked six
       never pass ~300px, where `large` already covers the device pixels. */
    items.slice(0, FEATURE_ITEMS).forEach((m, i) => {
      (i === 0 ? lead : stack).append(
        mediaCard(m, { rank: rank ? i + 1 : null, eager: i < 2, size: i === 0 ? 'extraLarge' : 'large' }),
      );
    });
  }

  return h('section.section.feature-wrap', {}, blockHead({ heading, sub, viewAll }), track);
}

/** A numbered list row for the magazine split: thumb, title, one line of facts. */
function splitRow(m, n) {
  const meta = [h('span', {}, formatLabel(m.format))];
  const y = yearOf(m);
  if (y) meta.push(h('span.split-dot'), h('span.tnum', {}, String(y)));
  const ec = episodeCount(m);
  if (ec && m.format !== 'MOVIE') meta.push(h('span.split-dot'), h('span', {}, ec));

  return h(
    'a.split-item',
    { href: `#/anime/${m.id}`, role: 'listitem' },
    h('span.split-num.tnum', {}, String(n)),
    h('div.split-thumb', {}, posterImage(m, {})),
    h(
      'div.split-copy',
      {},
      h('div.split-item-title.clamp-2', {}, title(m)),
      h('div.split-item-meta', {}, ...meta),
    ),
  );
}

export function mediaSplit({ id, heading, sub, items = [], viewAll, skeleton = false, empty }) {
  const art = h('div.split-art');
  const list = h('div.split-list', { role: 'list' });
  const track = h(`div.split.block-track${skeleton ? '.is-skeleton' : ''}`, { id }, art, list);

  if (skeleton) {
    art.append(h('div.card', { 'aria-hidden': 'true' }, h('div.sk.sk--wide'), h('div.sk.sk--text'), h('div.sk.sk--text.w60')));
    list.append(
      ...Array.from({ length: SPLIT_ITEMS - 1 }, () =>
        h('div.split-item.is-skeleton', { 'aria-hidden': 'true' }, h('div.split-thumb.sk'), h('div.split-copy', {}, h('div.sk.sk--text'), h('div.sk.sk--text.w60'))),
      ),
    );
  } else if (!items.length) {
    staticTrack(track, note(empty || t('Nothing to show here right now.')));
  } else {
    const head = items[0];
    /* A 16/9 frame cropped from a 2/3 cover shows only the middle band of the
       art at ~900px wide, so this is the one rail card that cannot afford the
       smaller tier. */
    art.append(mediaCard(head, { eager: true, size: 'extraLarge' }));
    items.slice(1, SPLIT_ITEMS).forEach((m, i) => list.append(splitRow(m, i + 2)));
  }

  return h('section.section.split-wrap', {}, blockHead({ heading, sub, viewAll }), track);
}

/**
 * Shared plumbing for the two editorial blocks above, mirroring `lazyRow()`:
 * a skeleton that already has the final shape is painted first, then swapped
 * whole for the real block once the rail resolves. A block with no data takes
 * itself off the page; only a `required` one spends its frame on an error.
 */
function lazyBlock(opts, build) {
  const section = build({ ...opts, items: [], skeleton: true });
  const track = qs('.block-track', section);
  opts
    .load()
    .then((items) => {
      if (!items?.length) {
        section.remove();
        return;
      }
      section.replaceWith(build({ ...opts, items, skeleton: false }));
    })
    .catch(() => {
      if (opts.required) {
        track.replaceChildren(errorState(opts.heading));
        track.classList.add('is-static');
      } else {
        section.remove();
      }
    });
  return section;
}

export const lazyFeature = (opts) => lazyBlock(opts, mediaFeature);
export const lazySplit = (opts) => lazyBlock(opts, mediaSplit);

/** Row whose content arrives later. `load()` resolves to an array of media. */
export function lazyRow(opts) {
  const section = mediaRow({ ...opts, items: [], skeleton: true });
  const track = qs('.row', section);
  opts
    .load()
    .then((items) => {
      if (!items?.length) {
        section.remove();
        return;
      }
      const fresh = mediaRow({ ...opts, items, skeleton: false });
      section.replaceWith(fresh);
    })
    .catch(() => {
      if (opts.required) {
        track.replaceChildren(errorState(opts.heading));
        track.classList.remove('no-scrollbar');
      } else {
        section.remove();
      }
    });
  return section;
}

export const rowSkeletonBlock = (heading, viewAll) =>
  h(
    'section.section',
    {},
    h('div.section-head', {}, h('div.sk.sk--row'), h('span.spacer'), viewAll ? h('div.sk.sk--chip') : null),
    h('div.row.no-scrollbar', {}, ...cardSkeleton(7)),
  );

/* ---- states ---------------------------------------------------------- */
export function stateBlock(...inner) {
  return h('div.state', {}, ...inner.filter(Boolean));
}

export function emptyState({ iconName = 'ghost', heading, body, action }) {
  return stateBlock(
    h('div.state-art', {}, icon(iconName)),
    h('h3', {}, heading),
    body ? h('p', {}, body) : null,
    action || null,
  );
}

export function errorState(what, retry, opts = {}) {
  return stateBlock(
    h('div.state-art', { style: { color: 'var(--danger)' } }, icon('offline')),
    h('h3', {}, opts.heading ? t(opts.heading) : t('Could not reach the catalogue')),
    h(
      'p',
      {},
      opts.body
        ? t(opts.body)
        : t('{what} needs live data, which is not answering right now.', { what }),
    ),
    retry ? h('button.btn.btn--primary', { onclick: retry }, icon('refresh'), t('Retry')) : null,
  );
}

export function loadingGrid(count = 18) {
  return h('div.grid', { 'aria-hidden': 'true' }, ...Array.from({ length: count }, () =>
    h('div.card', {}, h('div.sk.sk--poster'), h('div.sk.sk--text'), h('div.sk.sk--text.w60')),
  ));
}

/* ---- status pill ----------------------------------------------------- */
export function statusBadge(media) {
  const label = statusLabel(media.status);
  if (!label) return null;
  const tone = STATUS_TONE[media.status];
  return h('span.badge', { class: tone ? `badge--${tone}` : null }, media.status === 'RELEASING' ? icon('clock') : null, label);
}
