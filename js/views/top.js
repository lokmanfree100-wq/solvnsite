/**
 * Top 100 — the community's highest-rated anime, ranked by AniList score.
 *
 * A ranking is only as honest as its source, so every row carries the number it
 * was placed by and the page says where that number comes from.
 */

import { h, icon } from '../lib/dom.js';
import { top100 } from '../lib/anilist.js';
import { settings } from '../lib/store.js';
import { title, formatLabel, yearOf, scoreLabel, compactNumber } from '../lib/util.js';
import { posterImage, errorState, emptyState } from '../components/media.js';
import { t } from '../lib/i18n.js';

export async function TopView() {
  const wrap = h('div.page-top');
  const list = h('ol.rank-list');

  function paintLoading() {
    list.replaceChildren(
      ...Array.from({ length: 12 }, () => h('li', {}, h('div.skel-row'))),
    );
  }

  async function load() {
    paintLoading();
    let items;
    try {
      items = await top100();
    } catch {
      list.replaceChildren(errorState(t('The ranking'), load));
      return;
    }
    const visible = settings.get('showNsfw') ? items : items.filter((m) => !m.isAdult);
    if (!visible.length) {
      list.replaceChildren(emptyState({ iconName: 'offline', heading: t('Nothing to rank'), body: t('The catalogue returned no scored titles.') }));
      return;
    }
    list.replaceChildren(...visible.map(row));
  }

  function row(m, i) {
    const n = i + 1;
    const score = m.averageScore || 0;
    const genres = (m.genres || []).slice(0, 3).join(' · ');
    return h('li', {},
      h(
        `a.rank-row${n <= 3 ? `.is-top${n}` : ''}`,
        { href: `#/anime/${m.id}` },
        h('span.rank-pos.tnum', {}, String(n)),
        h('span.rank-art', {}, posterImage(m, { eager: n <= 8 })),
        h('span.rank-body', {},
          h('span.rank-title.clamp-2', {}, title(m)),
          h('span.rank-meta', {},
            `${formatLabel(m.format)}${yearOf(m) ? ` · ${yearOf(m)}` : ''}${m.episodes ? ` · ${t('Ep {n}', { n: m.episodes })}` : ''}`,
            genres ? h('span.rank-genre', {}, ` · ${genres}`) : null,
          ),
          h('span.score-bar', { 'aria-hidden': 'true' }, h('i', { style: { width: `${Math.max(4, score)}%` } })),
        ),
        h('span.rank-score', {},
          h('b.tnum', {}, scoreLabel(score) || '—'),
          h('i', {}, t('score')),
          h('span.rank-fans.faint.tnum', {}, m.popularity ? `${compactNumber(m.popularity)} ${t('watching')}` : ''),
        ),
      ),
    );
  }

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('RANKING')),
      h('h1.display', {}, t('Top 100')),
      h('p', {}, t('The hundred highest-rated anime we track, ordered by the viewer score out of ten. Popularity only breaks ties.')),
      h('div.rowline', { style: { marginTop: 'var(--sp-4)' } },
        h('a.btn.btn--sm', { href: '#/discover' }, icon('compass'), h('span', {}, t('Browse everything'))),
      ),
    ),
    list,
  );
  load();
  return wrap;
}
