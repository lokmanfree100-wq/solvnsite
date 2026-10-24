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
 */

import { h, icon, scrollMax, scrollPos, scrollInlineBy } from '../lib/dom.js';
import { clearProgress } from '../lib/store.js';
import { stillImage } from './media.js';
import { clamp } from '../lib/util.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';

/** Straight back to the player: the saved episode, and the dub only if that is where the show left off. */
const resumeUrl = (e) =>
  `#/watch/${e.id}/${Math.max(1, Number(e.episode) || 1)}${e.audio === 'dub' ? '?audio=dub' : ''}`;

/**
 * How far along this is, in per cent. The player has never reported a position
 * for a saved entry, so the only honest bar most cards get is the one drawn from
 * the series length; a title with neither number gets no bar at all rather than
 * a made-up one.
 */
function percent(e) {
  const duration = Number(e.duration) || 0;
  const seconds = Number(e.seconds) || 0;
  if (duration > 0) return clamp((seconds / duration) * 100, 3, 100);
  const total = Number(e.total) || 0;
  if (total > 0) return clamp(((Number(e.episode) || 1) / total) * 100, 3, 100);
  return null;
}

function minutesLeft(e) {
  const duration = Number(e.duration) || 0;
  const seconds = Number(e.seconds) || 0;
  if (duration > 0) return Math.max(0, Math.round((duration - seconds) / 60));
  return Math.max(0, Math.round(Number(e.mins) || 0));
}

function card(e, onRemove, { eager = false } = {}) {
  const movie = e.format === 'MOVIE';
  const ep = Math.max(1, Number(e.episode) || 1);
  const left = minutesLeft(e);
  const pct = percent(e);
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
        h('div.card-play', {}, h('span', {}, icon('play'))),
        pct != null ? h('div.card-progress', {}, h('i', { style: { width: `${pct}%` } })) : null,
      ),
      h(
        'div.card-body',
        {},
        h('div.card-title.clamp-2', {}, e.title),
        h(
          'div.card-meta',
          {},
          h('span', {}, movie ? t('Film') : t('Episode {n}', { n: ep })),
          // Minutes left only means something for an episodic show.
          left > 0 && !movie ? h('span.dot') : null,
          left > 0 && !movie ? h('span', {}, t('{n} min left', { n: left })) : null,
        ),
      ),
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
 */
export function continueRail(entries) {
  const items = (entries || []).filter((e) => e?.id && e.at);
  if (!items.length) return null;

  const track = h('div.row.no-scrollbar', { role: 'list', 'aria-label': t('Continue watching') });
  const section = h(
    'section.section.row-wrap.cw-wrap',
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
    const max = scrollMax(track);
    const pos = scrollPos(track);
    prev.hidden = pos <= 4;
    next.hidden = max <= 4 || pos >= max - 4;
  };
  const nudge = (dir) => scrollInlineBy(track, dir * Math.max(track.clientWidth * 0.8, 220));
  prev.addEventListener('click', () => nudge(-1));
  next.addEventListener('click', () => nudge(1));
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  requestAnimationFrame(update);

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

  items.forEach((e, i) => {
    const node = card(e, remove, { eager: i < 4 });
    node.dataset.id = String(e.id);
    track.append(node);
  });

  section.append(prev, next);
  return section;
}
