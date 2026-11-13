/** Home: one full-screen featured showcase, then five dense poster rows. */

import { h } from '../lib/dom.js';
import { browse, hiddenGems } from '../lib/anilist.js';
import { continueWatching, settings } from '../lib/store.js';
import { makeDeduper } from '../lib/dedupe.js';
import { lazyRow } from '../components/media.js';
import { categoryTabs } from '../components/cats.js';
import { continueRail } from '../components/continue-watching.js';
import { cinematicShowcase } from '../components/cinematic-showcase.js';
import { t } from '../lib/i18n.js';

/** Interleave ranked lists so one query cannot fill a whole rail by itself. */
function blend(lists, keyOf = (m) => m.id) {
  const out = [];
  const seen = new Set();
  const at = lists.map(() => 0);
  for (;;) {
    let moved = false;
    lists.forEach((list, k) => {
      const m = list[at[k]++];
      if (!m) return;
      moved = true;
      const key = keyOf(m);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    });
    if (!moved) return out;
  }
}

const itemsOf = (r) => (Array.isArray(r) ? r : (r?.items ?? []));

export async function HomeView(ctx) {
  const year = new Date().getFullYear();
  const allowNsfw = settings.get('showNsfw');
  const visible = (items) => (allowNsfw ? items : items.filter((m) => !m.isAdult));
  const dedupe = makeDeduper();

  const wrap = h('div.page-home');

  /* Death Note leads the anime half of the site. The showcase is editorial and
     local, so it paints immediately instead of waiting on a catalogue request. */
  const featureSlot = h('div.home-feature-slot', {}, cinematicShowcase('anime', { onCleanup: ctx?.onCleanup }));
  wrap.append(featureSlot, categoryTabs());

  /* Headings arrive already translated so the year in "Best Anime of 2026" can
     interpolate without turning the i18n key into a template. `fetch` is the one
     pipeline every shelf shares: the same blended queries and the same turn in
     the dedupe queue. */
  const fetch = (loads) => async () => {
    const parts = await Promise.all(loads.map((f) => Promise.resolve(f()).then(itemsOf).catch(() => [])));
    return visible(await dedupe.claim(blend(parts)));
  };

  /* Exactly five full-width rows. Each row is the same rail: a poster, a title
     and one line of facts, scrollable sideways. Continue-watching is the first
     when this browser has progress — and then the last row makes way, so the
     page always lands on five, never four and never six. */
  const row = (heading, sub, loads, extra = {}) =>
    lazyRow({ heading, sub, load: fetch(loads), ...extra });

  /* One resumed title is a note, not a row: a rail with a single poster in it
     reads as a broken shelf. The history row appears once there is enough of
     it to scroll. */
  const resumed = continueWatching(20);
  const rows = [
    resumed.length >= 3 ? continueRail(dedupe.claimSync(resumed)) : null,
    row(
      t('Trending Now'),
      t('What everyone is watching right now.'),
      [
        () => browse({ sort: ['TRENDING_DESC'], perPage: 24 }),
        () => browse({ sort: ['POPULARITY_DESC'], perPage: 18 }),
      ],
      { viewAll: '#/discover?sort=TRENDING_DESC' },
    ),
    row(
      t('Popular This Season'),
      t('The season everyone is talking about.'),
      [
        () => browse({ sort: ['POPULARITY_DESC'], seasonYear: year, perPage: 20 }),
        () => browse({ sort: ['TRENDING_DESC'], perPage: 16 }),
      ],
      { viewAll: `#/discover?sort=POPULARITY_DESC&year=${year}` },
    ),
    row(
      t('Top Rated Masterpieces'),
      t('The best-scoring completed series, in order.'),
      [() => browse({ sort: ['SCORE_DESC'], status: 'FINISHED', minimumScore: 80, perPage: 24 })],
      { viewAll: '#/discover?sort=SCORE_DESC&status=FINISHED' },
    ),
    row(
      t('New & Upcoming'),
      t('Fresh airdates and the next big premieres.'),
      [
        () => browse({ sort: ['START_DATE_DESC'], perPage: 20 }),
        () => browse({ status: 'NOT_YET_RELEASED', sort: ['POPULARITY_DESC'], perPage: 16 }),
      ],
      { viewAll: '#/discover?sort=START_DATE_DESC' },
    ),
    row(
      t('Hidden Gems & Sci-Fi'),
      t('Praised by few, and futures worth the detour.'),
      [hiddenGems, () => browse({ genre: 'Sci-Fi', sort: ['SCORE_DESC'], perPage: 16 })],
      { viewAll: '#/discover?genre=Sci-Fi&sort=SCORE_DESC' },
    ),
  ].filter(Boolean);

  wrap.append(...rows.slice(0, 5));

  return wrap;
}
