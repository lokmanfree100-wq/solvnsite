/** Home: five dense poster rows under one cinematic spotlight, and no title twice. */

import { h, icon } from '../lib/dom.js';
import { browse, hiddenGems } from '../lib/anilist.js';
import { continueWatching, settings } from '../lib/store.js';
import { watched } from '../lib/util.js';
import { makeDeduper } from '../lib/dedupe.js';
import { lazyRow } from '../components/media.js';
import { categoryTabs } from '../components/cats.js';
import { continueRail } from '../components/continue-watching.js';
import { spotlight, spotlightSkeleton, pickSpotlight } from '../components/spotlight.js';
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

/**
 * Slim greeting strip above the shelves. Once dismissed it is remembered in
 * settings and does not come back on the next load.
 */
function welcomeBanner() {
  if (settings.get('welcomeDismissed')) return null;
  const dismiss = () => {
    settings.set('welcomeDismissed', true);
    el.classList.add('is-gone');
    setTimeout(() => el.remove(), 320);
  };
  const el = h(
    'section.welcome',
    { 'aria-label': t('Welcome') },
    h(
      'div.welcome-copy',
      {},
      h('p.welcome-title', {}, t('Welcome to Solvn — anime & cartoons in HD')),
      h('p.welcome-sub', {}, t('Trending picks and all-time favourites, streaming in crisp HD.')),
    ),
    h('button.welcome-close', { type: 'button', 'aria-label': t('Dismiss this banner'), onclick: dismiss }, icon('x')),
  );
  return el;
}

export async function HomeView(ctx) {
  const year = new Date().getFullYear();
  const allowNsfw = settings.get('showNsfw');
  const visible = (items) => (allowNsfw ? items : items.filter((m) => !m.isAdult));
  const dedupe = makeDeduper();

  const wrap = h('div.page-home');
  const banner = welcomeBanner();
  if (banner) wrap.append(banner);

  /* The spotlight leads the page. Its titles are claimed before any shelf asks,
     so nothing in the band of eight can reappear in a grid directly below it. */
  const spotSlot = h('div.home-spot-slot', {}, spotlightSkeleton());
  wrap.append(spotSlot, categoryTabs());

  let releaseSpot;
  const spotReady = new Promise((r) => {
    releaseSpot = r;
  });
  const spotWait = Promise.race([spotReady, new Promise((r) => setTimeout(r, 2500))]);

  /* Headings arrive already translated so the year in "Best Anime of 2026" can
     interpolate without turning the i18n key into a template. `fetch` is the one
     pipeline every shelf shares: the same blended queries and the same turn in
     the dedupe queue. */
  const fetch = (loads) => async () => {
    const parts = await Promise.all(loads.map((f) => Promise.resolve(f()).then(itemsOf).catch(() => [])));
    return visible(await dedupe.claim(blend(parts), { after: spotWait }));
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

  /* Three slates, blended so one query cannot fill the band. The component
     folds franchises and takes the top eight; a dead catalogue costs the
     spotlight, not the page. */
  const spotLoads = [
    () => browse({ sort: ['TRENDING_DESC'], perPage: 14 }),
    () => browse({ sort: ['POPULARITY_DESC'], perPage: 14 }),
    () => browse({ sort: ['SCORE_DESC'], status: 'FINISHED', minimumScore: 78, perPage: 12 }),
  ];

  Promise.all(spotLoads.map((f) => watched(f(), 4500).then(itemsOf).catch(() => [])))
    .then((lists) => {
      const picks = pickSpotlight(visible(blend(lists))).slice(0, 8);
      const claimed = dedupe.claimSync(picks);
      releaseSpot();
      const node = claimed.length ? spotlight(claimed, { onCleanup: ctx?.onCleanup }) : null;
      if (node) spotSlot.replaceChildren(node);
      else spotSlot.remove();
    })
    .catch(() => {
      releaseSpot();
      spotSlot.remove();
    });

  return wrap;
}
