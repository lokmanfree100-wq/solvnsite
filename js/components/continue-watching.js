/**
 * Continue watching: the one home row that is not a recommendation.
 *
 * Everything here comes from this browser's own progress store, so the row is
 * painted before any network call answers, and it disappears entirely when there
 * is nothing in it — a half-empty rail on the landing page would look like a
 * broken section rather than like an empty history.
 *
 * The card is a poster card in every way but one: it links to the watch page at
 * the saved episode with the saved audio track, instead to the title page. Each
 * one also carries a way to take itself off the row, because a show you are not
 * going to finish should not hold the top of the home page forever.
 *
 * Rule 1: a continue-watching card is only painted when the device can stream the
 * title. The row still reads as a Continue watching rail — a title that cannot be
 * verified simply never gets a card, so the viewer is not invited to click a poster
 * that cannot be played. */

import { h, icon, scrollMax, scrollPos, scrollInlineBy } from '../lib/dom.js';
import { streamableAnimeTitles } from '../lib/sources.js';
import { clearProgress } from '../lib/store.js';
import { stillImage } from './media.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';

/** Straight back to the player: the saved episode, and the saved track if it was not the original. */
const resumeUrl = (e) =>
  `#/watch/${e.id}/${Math.max(1, Number(e.episode) || 1)}${!e.audio || e.audio === 'sub' ? '' : `?audio=${e.audio}`}`;

function card(e, onRemove, { eager = false } = {}) {
  const movie = e.format === 'MOVIE';
  const ep = Math.max(1, Number(e.episode) || 1);
  const what = movie ? t('Watch film') : t('Episode {n}', { n: ep });

  return h(
    'div.cw-item',
    { role: 'listitem' },
    h(
      'a.card.cw-card',
      { href: resumeUrl(e), 'aria-label': `${e.title} — ${what}` },
      h(
        'div.card-art',
        {},
        stillImage([e.cover], { alt: '', eager }) || h('span.card-ph', {}, icon('film')),
      ),
      h('div.card-body', {}, h('div.card-title.clamp-2', {}, e.title)),
    ),
    h(
      'button.cw-kill',
      {
        type: 'button',
        title: t('Remove from Continue watching'),
        'aria-label': t('Remove from Continue watching'),
        onclick: () => onRemove(e),
      },
      icon('x'),
    ),
  );
}

/**
 * One rail of saved progress, or nothing at all. `entries` come from
 * `continueWatching()` in the caller, already handed through the page's dedupe
 * queue so a title in this row never shows up again further down.
 *
 * The rail is built only from the watchable subset, so the Continue watching heading
 * never stands over a dead poster. */
export async function continueRail(entries, { grid = false } = {}) {
  const items = (entries || []).filter((e) => e?.id && e.at);
  if (!items.length) return null;
  /* Rule 1 gate: keep only in-progress titles the device can stream. */
  const media = items.map((e) => ({
    id: e.id,
    title: { romaji: e.title },
    coverImage: { large: e.cover },
    format: e.format,
    episodes: e.episodes ?? e.total,
    seasonYear: e.seasonYear,
    status: 'FINISHED',
  }));
  const watchable = await streamableAnimeTitles(media);
  if (!watchable.length) return null;
  const ids = new Set(watchable.map((m) => m.id));
  const show = items.filter((e) => ids.has(e.id));

  const track = h(`div.${grid ? 'grid home-grid' : 'row.no-scrollbar'}`, {
    role: 'list',
    'aria-label': t('Continue watching'),
  });
  const section = h(
    `section.section.cw-wrap${grid ? '' : '.row-wrap'}`,
    {},
    h(
      'div.section-head',
      {},
      h('h2', {}, t('Continue watching')),
      h('span.sub', {}, t('Picks up where you left off')),
      h('span.spacer'),
      h('a.link-all', { href: '#/library?tab=progress' }, t('View all'), icon('chevronRight', { cls: 'flip' })),
    ),
    track,
  );

  const prev = h('button.row-arrow.prev', { 'aria-label': t('Scroll backwards'), hidden: true }, icon('chevronLeft', { cls: 'flip' }));
  const next = h('button.row-arrow.next', { 'aria-label': t('Scroll forwards'), hidden: true }, icon('chevronRight', { cls: 'flip' }));

  const update = () => {
    if (grid) return;
    const max = scrollMax(track);
    const pos = scrollPos(track);
    prev.hidden = pos <= 4;
    next.hidden = max <= 4 || pos >= max - 4;
  };
  if (!grid) {
    const nudge = (dir) => scrollInlineBy(track, dir * Math.max(track.clientWidth * 0.8, 220));
    prev.addEventListener('click', () => nudge(-1));
    next.addEventListener('click', () => nudge(1));
    track.addEventListener('scroll', update, { passive: true });
    new ResizeObserver(update).observe(track);
    requestAnimationFrame(update);
  }

  /* Taking one out deletes the saved position, so the row has to agree with the
     store right away — and if that was the last one, the whole section goes,
     because an empty continue-watching rail is not a thing worth showing. */
  const remove = (e) => {
    clearProgress(e.id);
    const node = [...track.children].find((c) => c.dataset.id === String(e.id));
    node?.remove();
    if (!track.children.length) section.remove();
    else update();
    toast(t('Removed from Continue watching'), { tone: 'ok', iconName: 'check' });
  };

  show.forEach((e, i) => {
    const node = card(e, remove, { eager: i < 4 });
    node.dataset.id = String(e.id);
    track.append(node);
  });

  if (!grid) section.append(prev, next);
  return section;
}
