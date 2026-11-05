/**
 * The five categories, in one strip.
 *
 * A viewer arrives thinking in kinds, not in databases: أفلام, مسلسلات, أنمي,
 * كرتونز, أفلام الأطفال. Behind those five words sit two APIs — TMDB for films
 * and series, AniList for anime and the classic shelves — but a tab that changes
 * the data source while keeping the label is the whole point: the page is allowed
 * to be complicated so the navigation does not have to be.
 *
 * These are links, not buttons that swap content in place, because each category
 * has its own filters worth bookmarking and sending to someone: `#/movies` keeps
 * its year and genre in the URL, and the links here simply carry the viewer to
 * the right place to use them.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

export const CATEGORIES = [
  { id: 'movie', href: '#/movies?type=movie', icon: 'film', label: 'Movies' },
  { id: 'tv', href: '#/movies?type=tv', icon: 'tv', label: 'Series' },
  { id: 'anime', href: '#/discover', icon: 'sparkles', label: 'Anime' },
  { id: 'toons', href: '#/toons', icon: 'cat', label: 'Cartoons' },
  { id: 'kids', href: '#/movies?list=kids', icon: 'popcorn', label: 'Kids Movies' },
];

export function categoryTabs(active) {
  return h(
    'nav.cat-tabs',
    { role: 'navigation', 'aria-label': t('Categories') },
    ...CATEGORIES.map((c) =>
      h(
        `a.cat-tab${c.id === active ? '.is-on' : ''}`,
        { href: c.href, 'aria-current': c.id === active ? 'page' : null },
        icon(c.icon),
        h('span', {}, t(c.label)),
      ),
    ),
  );
}
