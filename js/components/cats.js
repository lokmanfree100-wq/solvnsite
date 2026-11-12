/**
 * The category strip: the two catalogues Solvn is open for.
 *
 * Movies and Series are parked in development, so they are not drawn here at
 * all. A tab that opens nothing is a promise the strip cannot keep, and a "Soon"
 * chip on every visit is louder than the one short note a film address raises
 * (components/films-gate.js). Everything drawn is an anchor: each category keeps
 * its filters in the URL and a tab worth bookmarking has to be a real link.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

export const CATEGORIES = [
  { id: 'anime', href: '#/discover', icon: 'sparkles', label: 'Anime' },
  { id: 'toons', href: '#/toons', icon: 'cat', label: 'Cartoons' },
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
