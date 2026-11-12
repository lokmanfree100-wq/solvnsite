/** Home: one uniform grid of posters per shelf, and no title twice. */

import { h, icon } from '../lib/dom.js';
import { browse, hiddenGems, genres } from '../lib/anilist.js';
import { continueWatching, settings } from '../lib/store.js';
import { watched } from '../lib/util.js';
import { makeDeduper } from '../lib/dedupe.js';
import { lazyGrid } from '../components/media.js';
import { categoryTabs } from '../components/cats.js';
import { continueRail } from '../components/continue-watching.js';
import { discussionStrip } from '../components/discussion.js';
import { spotlight, spotlightSkeleton, pickSpotlight } from '../components/spotlight.js';
import { t, genre } from '../lib/i18n.js';

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

function genreStrip(list) {
  return h(
    'section.section',
    {},
    h(
      'div.section-head',
      {},
      h('h2', {}, t('Browse by genre')),
      h('span.spacer'),
      h('a.link-all', { href: '#/discover' }, t('Open discover'), icon('chevronRight', { cls: 'flip' })),
    ),
    h('div.genre-strip', {}, ...list.map((g) => h('a.genre-pill', { href: `#/discover?genre=${encodeURIComponent(g)}` }, genre(g)))),
  );
}

/**
 * Locally-stored progress, shown before anything else — and shown nowhere at all
 * when this browser has not started something. The titles it holds are claimed
 * here first, so a show you are mid-way through cannot turn up again in a rail
 * of recommendations below it.
 */
function continueRow(dedupe) {
  return continueRail(dedupe.claimSync(continueWatching(14)), { grid: true });
}

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

  /* One shape for every shelf: the same poster, the same frame, the same grid.
     The readings of the page differ by the query behind each grid, not by the
     size of a card — a lead poster twice the height of its neighbours was what
     made the old home look broken at every width between two breakpoints. */
  const grid = (heading, sub, loads, extra = {}) =>
    lazyGrid({ heading, sub, load: fetch(loads), ...extra });

  const genreSection = h('div.home-genre-slot');

  const sections = [
    continueRow(dedupe),
    grid(
      t('Top Rated Masterpieces'),
      t('The best-scoring completed series, in order.'),
      [() => browse({ sort: ['SCORE_DESC'], status: 'FINISHED', minimumScore: 80, perPage: 24 })],
      { viewAll: '#/discover?sort=SCORE_DESC&status=FINISHED', limit: 18 },
    ),
    grid(
      t('Best Anime of {year}', { year }),
      t('Fresh airdates and what everyone is watching this year.'),
      [
        () => browse({ sort: ['POPULARITY_DESC'], seasonYear: year, perPage: 16 }),
        () => browse({ sort: ['START_DATE_DESC'], perPage: 12 }),
        () => browse({ sort: ['TRENDING_DESC'], perPage: 16 }),
      ],
      { viewAll: '#/discover?sort=START_DATE_DESC', limit: 18 },
    ),
    grid(
      t('Dark, Moody & Indie Aesthetic Picks'),
      t('Brooding thrillers, quiet psychological drama, off-format one-offs.'),
      [
        () => browse({ genre: 'Psychological', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ genre: 'Mystery', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ genre: 'Thriller', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ format: 'OVA', sort: ['SCORE_DESC'], minimumScore: 72, perPage: 10 }),
        () => browse({ format: 'ONA', sort: ['SCORE_DESC'], minimumScore: 72, perPage: 10 }),
      ],
      { viewAll: '#/discover?genre=Psychological&sort=SCORE_DESC', limit: 18 },
    ),
    grid(
      t('Hidden Gems & Sci-Fi'),
      t('Praised by few, and futures worth the detour.'),
      [hiddenGems, () => browse({ genre: 'Sci-Fi', sort: ['SCORE_DESC'], perPage: 16 })],
      { viewAll: '#/discover?genre=Sci-Fi&sort=SCORE_DESC', limit: 18 },
    ),
    genreSection,
    /* Last, and smaller than everything above it: the site room is a note at the
       foot of the page, not a section to browse. */
    discussionStrip({ onCleanup: ctx?.onCleanup }),
  ].filter(Boolean);

  wrap.append(...sections);

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

  watched(genres())
    .then((list) => genreSection.replaceChildren(genreStrip(list.slice(0, 14))))
    .catch(() => genreSection.remove());

  return wrap;
}
