/** Home: a spotlight, four curated sections, and no title twice. */

import { h, icon } from '../lib/dom.js';
import { browse, hiddenGems, genres, spotlight } from '../lib/anilist.js';
import { api as tmdb, typeOf } from '../lib/tmdb.js';
import { continueWatching, settings } from '../lib/store.js';
import { watched } from '../lib/util.js';
import { makeDeduper } from '../lib/dedupe.js';
import { lazyRow, lazyFeature, lazySplit } from '../components/media.js';
import { categoryTabs } from '../components/cats.js';
import { mRail } from './movies.js';
import { continueRail } from '../components/continue-watching.js';
import { discussionStrip } from '../components/discussion.js';
import { hero, heroSkeleton, animePick, filmPick } from '../components/hero.js';
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
  return continueRail(dedupe.claimSync(continueWatching(14)));
}

/** Sequels of the same show collapse to one spotlight slot, so a full banner
 *  means a dozen different franchises rather than four rounds of Attack on
 *  Titan. The key is the leading words of the base title, which is what carries
 *  the franchise — and it works across both halves, so a live-action remake
 *  cannot take the slot its anime original already holds. */
const franchise = (p) =>
  String(p.name || '')
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
  return items.filter((p) => {
    const key = franchise(p);
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
      h('p.welcome-title', {}, t('Welcome to Solvn — anime, films & series in HD')),
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
  wrap.append(heroSlot, categoryTabs());

  /* Every shelf on the page holds off until the spotlight has taken its picks —
     that slate is the one thing here chosen on purpose, and it is the only row
     that asks both databases at once. The grace it is given is longer than one
     round trip because it fires eight queries; past that a dead API must not
     keep every row below it waiting. */
  let releaseHero;
  const heroChosen = new Promise((r) => {
    releaseHero = r;
  });
  const heroWait = Promise.race([heroChosen, new Promise((r) => setTimeout(r, 4500))]);

  /* The film shelves sit directly under the spotlight, in the same order as the
     tabs above them, so the top of the page previews the whole site and not only
     the anime half. They queue on their own de-dupe, keyed by type + id: TMDB and
     AniList number their titles separately, and film ids are a sequence of their
     own too, so a rail stamps the form it is showing and the key keeps the two
     apart. */
  const filmDedupe = makeDeduper((m) => `${m.media_type}:${m.id}`);
  const filmLoad = (type, list) => async () => {
    const r = await list();
    const items = (r?.results || [])
      .filter((m) => !m.media_type || m.media_type === type)
      .map((m) => ({ ...m, media_type: type }));
    return (await filmDedupe.claim(items, { after: heroWait })).slice(0, 18);
  };
  const filmRail = (heading, sub, viewAll, load) =>
    mRail({ heading: t(heading), sub: t(sub), viewAll, fetcher: load });
  const kidsShelf = () =>
    tmdb.discover('movie', { with_genres: '10751', sort_by: 'popularity.desc', 'vote_count.gte': 20 });
  const filmRails = [
    filmRail('Movies', t('The films people are watching this week.'), '#/movies?type=movie', filmLoad('movie', () => tmdb.popularMovies())),
    filmRail('Series', t('What is on the air, and what to binge next.'), '#/movies?type=tv', filmLoad('tv', () => tmdb.popularTv())),
    filmRail('Kids Movies', t('Family films, animation and something for younger viewers.'), '#/movies?list=kids', filmLoad('movie', kidsShelf)),
  ];

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

  /* Films first — three rows straight under the spotlight, in tab order — then
     the anime edit. No two adjacent anime sections cut the same shape: the local
     shelf is a rail, the ranked shelf is the feature block, the year is a rail,
     the mood shelf is the magazine split, then the genre pills break the run
     before the last rail. The page reads as an edit, not a repeating tile. */
  const sections = [
    ...filmRails,
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

  /* The spotlight is the whole site in one frame: what is new, what is trending
     and what is popular, from the anime half and the film half alike. Each half
     is blended down to one list first and the two then take turns, so the banner
     is half anime and half films/series rather than whichever API happened to
     answer with the longer page. hero() shuffles what it is handed, so the
     opening frame and the running order differ on every visit. */
  const animeLoads = [
    () => browse({ sort: ['TRENDING_DESC'], perPage: 16 }).then(itemsOf),
    () => browse({ sort: ['START_DATE_DESC'], perPage: 14 }).then(itemsOf),
    () => spotlight(25),
  ];
  const filmLoads = [
    () => tmdb.trending('week'),
    () => tmdb.nowPlaying(),
    () => tmdb.onTheAir(),
    () => tmdb.popularMovies(),
    () => tmdb.popularTv(),
  ];
  const hasArt = (m) => !!(m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large);
  const filmRows = (r) =>
    (r?.results || []).filter((m) => !m.adult && m.media_type !== 'person' && (m.poster_path || m.backdrop_path));

  /* Eight queries, and the banner is built from whichever of them answered: a
     shelf that is slow or down costs its own picks, not the whole frame. The
     array is pre-filled because a hole in it would shift the film half into the
     anime half when the two are sliced apart below. */
  const answers = new Array(animeLoads.length + filmLoads.length).fill(null);
  const gather = Promise.all(
    [...animeLoads, ...filmLoads].map((f, i) =>
      watched(f(), 4000)
        .then((r) => {
          answers[i] = r;
        })
        .catch(() => {}),
    ),
  );

  Promise.race([gather, new Promise((r) => setTimeout(r, 4200))])
    .then(async () => {
      const anime = answers
        .slice(0, animeLoads.length)
        .map((list) => visible(itemsOf(list)).filter(hasArt).map(animePick));
      const films = answers.slice(animeLoads.length).map((r) => filmRows(r).map((m) => filmPick(m, typeOf(m))));
      const byKey = (p) => p.key;
      const slate = uniqueFranchises(blend([blend(anime, byKey), blend(films, byKey)], byKey)).slice(0, 12);

      /* Claimed before the rails below ask, and on each half's own queue: TMDB
         and AniList number their titles in separate sequences. */
      const taken = new Set([
        ...dedupe.claimSync(slate.filter((p) => p.source === 'anime')).map(byKey),
        ...filmDedupe.claimSync(slate.filter((p) => p.source === 'film')).map(byKey),
      ]);
      const mine = slate.filter((p) => taken.has(p.key));
      releaseHero();
      if (!mine.length) return heroSlot.remove();

      /* A shelf card carries no genres, so a chosen film asks for its own row
         once. The banner does not wait on that for long: the year, the kind and
         the score already make a complete card without the genre chips. */
      const ready = await Promise.race([
        Promise.all(
          mine.map(async (p) => {
            if (p.source !== 'film' || p.genres.length) return p;
            const d = await tmdb.details(p.media_type, p.id).catch(() => null);
            return d ? filmPick(d, p.media_type) : p;
          }),
        ),
        new Promise((r) => setTimeout(() => r(mine), 2500)),
      ]);
      heroSlot.replaceChildren(hero(ready, { onCleanup: ctx?.onCleanup }));
    })
    .catch(() => {
      releaseHero();
      heroSlot.remove();
    });

  watched(genres())
    .then((list) => genreSection.replaceChildren(genreStrip(list.slice(0, 14))))
    .catch(() => genreSection.remove());

  return wrap;
}
