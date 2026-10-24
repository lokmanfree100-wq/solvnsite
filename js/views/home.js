/** Home: a spotlight, four curated sections, and no title twice. */

import { h, icon } from '../lib/dom.js';
import { browse, hiddenGems, genres, spotlight } from '../lib/anilist.js';
import { continueWatching, settings } from '../lib/store.js';
import { lazyRow, lazyFeature, lazySplit } from '../components/media.js';
import { continueRail } from '../components/continue-watching.js';
import { discussionStrip } from '../components/discussion.js';
import { hero, heroSkeleton } from '../components/hero.js';
import { t, genre } from '../lib/i18n.js';

/**
 * One title, once per page. Rails answer in whatever order the network replies,
 * so each claim queues behind the section above it: the order a viewer reads the
 * page is the order titles get taken, and an id taken by one rail can never
 * surface in another, however many queries ask for it.
 */
function makeDeduper() {
  const taken = new Set();
  let turn = Promise.resolve();

  const take = (items) => {
    const fresh = [];
    for (const m of items || []) {
      if (!m?.id || taken.has(m.id)) continue;
      taken.add(m.id);
      fresh.push(m);
    }
    return fresh;
  };

  return {
    claim(items, { after } = {}) {
      const mine = turn
        .then(() => (after ? after.catch(() => {}) : undefined))
        .then(() => take(items));
      turn = mine.then(
        () => {},
        () => {},
      );
      return mine;
    },
    /** For rows painted straight from local data, before anything resolves. */
    claimSync: take,
  };
}

/** Interleave ranked lists so one query cannot fill a whole rail by itself. */
function blend(lists) {
  const out = [];
  const seen = new Set();
  const at = lists.map(() => 0);
  for (;;) {
    let moved = false;
    lists.forEach((list, k) => {
      const m = list[at[k]++];
      if (!m) return;
      moved = true;
      if (!seen.has(m.id)) {
        seen.add(m.id);
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
  return continueRail(dedupe.claimSync(continueWatching(14)));
}

/** Sequels of the same show collapse to one spotlight slot, so 15 slides means
 *  15 different franchises rather than four rounds of Attack on Titan. The key
 *  is the leading words of the base title, which is what carries the franchise. */
const franchise = (m) =>
  (m.title?.romaji || m.title?.english || '')
    .toLowerCase()
    .split(':')[0]
    .replace(/\(.*?\)/g, '')
    .replace(/\bseason\s*\d+\b/g, ' ')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');

function uniqueFranchises(items) {
  const seen = new Set();
  return items.filter((m) => {
    const key = franchise(m);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Slim greeting strip above the spotlight. Once dismissed it is remembered in
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
      h('p.welcome-title', {}, t('Welcome to Solvn – Free HD Anime Streaming')),
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
  const heroSlot = h('div.home-hero-slot', {}, heroSkeleton());
  wrap.append(heroSlot);

  /* Rails hold off until the spotlight has taken its picks — that slate is the
     one thing on the page chosen on purpose — but only briefly, so a slow API
     cannot keep every row waiting. */
  let releaseHero;
  const heroChosen = new Promise((r) => {
    releaseHero = r;
  });
  const heroWait = Promise.race([heroChosen, new Promise((r) => setTimeout(r, 2000))]);

  /* Headings arrive already translated so the year in "Best Anime of 2026" can
     interpolate without turning the i18n key itself into a template.
     `fetch` is the one pipeline every shape shares: the same blended queries,
     the same turn in the dedupe queue, the same wait for the spotlight. Only
     the frame the titles land in changes per section. */
  const fetch = (loads) => async () => {
    const parts = await Promise.all(loads.map((f) => Promise.resolve(f()).then(itemsOf).catch(() => [])));
    return visible(await dedupe.claim(blend(parts), { after: heroWait }));
  };

  const rail = (heading, sub, loads, extra = {}) =>
    lazyRow({ heading, sub, load: fetch(loads), ...extra });
  const feature = (heading, sub, loads, extra = {}) =>
    lazyFeature({ heading, sub, load: fetch(loads), ...extra });
  const split = (heading, sub, loads, extra = {}) =>
    lazySplit({ heading, sub, load: fetch(loads), ...extra });

  const genreSection = h('div.home-genre-slot');

  /* Five sections, and no two adjacent ones cut the same shape: the local shelf
     is a rail, the ranked shelf is the feature block, the year is a rail, the
     mood shelf is the magazine split, then the genre pills break the run before
     the last rail. The page reads as an edit, not as a repeating tile. */
  const sections = [
    continueRow(dedupe),
    feature(
      t('Top Rated Masterpieces'),
      t('The best-scoring completed series, in order.'),
      [() => browse({ sort: ['SCORE_DESC'], status: 'FINISHED', minimumScore: 80, perPage: 24 })],
      { rank: true, viewAll: '#/discover?sort=SCORE_DESC&status=FINISHED' },
    ),
    rail(
      t('Best Anime of {year}', { year }),
      t('Fresh airdates and what everyone is watching this year.'),
      [
        () => browse({ sort: ['POPULARITY_DESC'], seasonYear: year, perPage: 16 }),
        () => browse({ sort: ['START_DATE_DESC'], perPage: 12 }),
        () => browse({ sort: ['TRENDING_DESC'], perPage: 16 }),
      ],
      { viewAll: '#/discover?sort=START_DATE_DESC' },
    ),
    split(
      t('Dark, Moody & Indie Aesthetic Picks'),
      t('Brooding thrillers, quiet psychological drama, off-format one-offs.'),
      [
        () => browse({ genre: 'Psychological', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ genre: 'Mystery', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ genre: 'Thriller', sort: ['SCORE_DESC'], perPage: 12 }),
        () => browse({ format: 'OVA', sort: ['SCORE_DESC'], minimumScore: 72, perPage: 10 }),
        () => browse({ format: 'ONA', sort: ['SCORE_DESC'], minimumScore: 72, perPage: 10 }),
      ],
      { viewAll: '#/discover?genre=Psychological&sort=SCORE_DESC' },
    ),
    rail(
      t('Hidden Gems & Sci-Fi'),
      t('Praised by few, and futures worth the detour.'),
      [hiddenGems, () => browse({ genre: 'Sci-Fi', sort: ['SCORE_DESC'], perPage: 16 })],
      { viewAll: '#/discover?genre=Sci-Fi&sort=SCORE_DESC' },
    ),
    genreSection,
    /* Last, and smaller than everything above it: the site room is a note at the
       foot of the page, not a section to browse. */
    discussionStrip({ onCleanup: ctx?.onCleanup }),
  ].filter(Boolean);

  wrap.append(...sections);

  /* Trending right now plus the all-time favourites the spotlight already
     weaves together. hero() shuffles what it is handed, so the opening frame
     and the running order differ on every visit. */
  Promise.all([
    spotlight(25).catch(() => []),
    browse({ sort: ['TRENDING_DESC'], perPage: 16 }).then(itemsOf).catch(() => []),
  ])
    .then(([spot, trend]) => {
      const picks = dedupe.claimSync(uniqueFranchises(visible(blend([spot, trend]))).slice(0, 15));
      releaseHero();
      if (!picks.length) return heroSlot.remove();
      heroSlot.replaceChildren(hero(picks, { onCleanup: ctx?.onCleanup }));
    })
    .catch(() => {
      releaseHero();
      heroSlot.remove();
    });

  genres()
    .then((list) => genreSection.replaceChildren(genreStrip(list.slice(0, 14))))
    .catch(() => genreSection.remove());

  return wrap;
}
