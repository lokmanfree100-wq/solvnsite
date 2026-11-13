/**
 * The category strip: Anime, Kids Cartoons, Movies and Series.
 *
 * Each keeps its filters in the URL, and a tab worth bookmarking is a real
 * link. The film tabs point at their own hubs rather than a shared query.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

export const CATEGORIES = [
  { id: 'anime', href: '#/discover', icon: 'sparkles', label: 'Anime' },
  { id: 'toons', href: '#/kids', icon: 'cat', label: 'Kids Cartoons' },
  { id: 'movie', href: '#/movies', icon: 'film', label: 'Movies' },
  { id: 'tv', href: '#/series', icon: 'film', label: 'Series' },
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
