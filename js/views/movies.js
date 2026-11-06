/**
 * Movies & Series hub — the TMDB half of the site.
 *
 * `/movies`            → hub: hero, continue watching, rails, genre strip
 * `/movies?type=tv`    → the Series hub
 * `/movies?list=…`     → a paginated grid for one rail ("View all")
 * `/movies?genre=…`    → a paginated genre grid
 * `/movies?q=…`        → its own search results grid
 *
 * All data comes through the /tmdb proxy; the key never reaches the browser.
 */

import { h, icon, scrollMax, scrollPos, scrollInlineBy } from '../lib/dom.js';
import { go } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { sheet } from '../lib/ui.js';
import { stillImage } from '../components/media.js';
import { categoryTabs } from '../components/cats.js';
import { makeDeduper } from '../lib/dedupe.js';
import {
  api, poster, backdrop, nameOf, yearOf, rating, runtimeText, seasonsLabel, genreMap,
  firstTrailer, movieContinueWatching, movieWatchlist, movieProgress, servingOffline,
} from '../lib/tmdb.js';

/* ---- one honest shelf per page ----------------------------------------
   A rail that cannot answer is a rail taken off the page, not a paragraph
   about infrastructure: the shelves beside it still fill, and the viewer is
   left with the ones that work. */

function failRail(root) {
  root.remove();
}

/* ---- links ------------------------------------------------------------ */

const detailHref = (t2, id) => `#/movie/${id}?type=${t2}`;
const watchHref = (t2, id, s = 1, e = 1) =>
  t2 === 'tv' ? `#/mwatch/${id}?type=tv&s=${s}&e=${e}` : `#/mwatch/${id}?type=movie`;

const typeOf = (t2) => (t2?.media_type === 'tv' || t2?.first_air_date || t2?.name ? 'tv' : 'movie');

/* ---- trailer sheet ------------------------------------------------------ */

export function openTrailer(key, title) {
  sheet({
    heading: title,
    sub: t('Trailer'),
    width: 920,
    render: () =>
      h(
        'div.trailer-frame',
        {},
        h('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0`,
          allow: 'autoplay; fullscreen; picture-in-picture',
          allowfullscreen: true,
          title: `${title} — ${t('Trailer')}`,
        }),
      ),
  });
}

/* ---- poster card -------------------------------------------------------- */

export function mCard(t2, { eager = false, wide = false } = {}) {
  const type = t2.media_type || typeOf(t2);
  const title = nameOf(t2);
  const href = t2._href || detailHref(type, t2.id);
  const prog = movieProgress(t2.id);
  const pct = prog?.duration && prog?.seconds ? Math.min(100, (prog.seconds / prog.duration) * 100) : null;
  const score = Number(t2.vote_average);

  return h(
    `a.card.m-card${wide ? '.is-wide' : ''}`,
    { href, 'aria-label': title },
    h(
      'div.card-art',
      {},
      /* One size is not a ladder. TMDB serves several crops of the same poster
         and an ad-blocker or a tired CDN edge can refuse exactly one of them, so
         the card asks for the sharp crop, then the standard one, and only then
         admits the art is missing — where a placeholder says so instead of
         leaving a black tile the viewer reads as a broken site. */
      stillImage([poster(t2.poster_path, 'w500'), poster(t2.poster_path, 'w342')], { eager }) ||
        h('span.card-ph', {}, icon('film')),
      prog?.episode ? h('span.flag', {}, icon('history'), t('Ep {n}', { n: prog.episode })) : null,
      score ? h('span.card-score', {}, icon('star'), rating(score)) : null,
      h('div.card-play', {}, h('span', {}, icon('play'))),
      pct != null ? h('div.card-progress', {}, h('i', { style: { width: `${pct}%` } })) : null,
    ),
    h(
      'div.card-body',
      {},
      h('div.card-title.clamp-2', {}, title),
      h(
        'div.card-meta',
        {},
        h('span', {}, type === 'tv' ? t('Series') : t('Movie')),
        yearOf(t2) ? h('span.dot') : null,
        yearOf(t2) ? h('span.tnum', {}, String(yearOf(t2))) : null,
      ),
    ),
  );
}

function mSkeletons(n) {
  return Array.from({ length: n }, () =>
    h('div.card.m-card', { 'aria-hidden': 'true' }, h('div.sk.sk--poster'), h('div.sk.sk--text'), h('div.sk.sk--text.w60')),
  );
}

/* ---- rail ----------------------------------------------------------------
   Same contract as the anime rows: vertical scrolling belongs to the page, the
   rail moves with a horizontal swipe/drag or its own visible 44px arrows. */

export function mRail({ heading, sub, viewAll, fetcher }) {
  const track = h('div.row.no-scrollbar.m-track', { role: 'list' });
  const root = h('section.section.row-wrap');
  const fill = (items) => {
    if (!items.length) {
      /* A shelf the snapshot simply does not fill — a genre with no titles in it
         — leaves no heading standing over nothing. On a live connection an empty
         shelf is a fault, so it stays visible and says so. */
      if (servingOffline()) {
        root.remove();
        return;
      }
      track.replaceChildren(h('p.muted', { style: { padding: '20px 0', fontSize: '14px' } }, t('Nothing to show here right now.')));
      return;
    }
    track.replaceChildren();
    items.forEach((m, i) => {
      const wrap = h('div', { role: 'listitem', style: { display: 'contents' } });
      wrap.append(mCard(m, { eager: i < 4 }));
      track.append(wrap);
    });
  };
  track.append(...mSkeletons(8));

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

  root.replaceChildren(
    h(
      'div.section-head',
      {},
      h('h2', {}, heading),
      sub ? h('span.sub', {}, sub) : null,
      h('span.spacer'),
      viewAll ? h('a.link-all', { href: viewAll }, t('View all'), icon('chevronRight', { cls: 'flip' })) : null,
    ),
    track,
    prev,
    next,
  );

  fetcher()
    .then(fill)
    .catch(() => failRail(root));
  return root;
}

/* ---- grid (one list, paginated) ------------------------------------------ */

function mGrid({ title, sub, type, fetcher }) {
  const box = h('div.m-grid', { role: 'list' });
  /* One type per grid, and the grid stamps it on every tile anyway, so the key
     is the same for every page it pulls in. */
  const dedupe = makeDeduper((m) => `${type}:${m.id}`);
  let page = 1;
  let done = false;
  let loading = false;
  const more = h('button.btn.btn--glass.m-more', { type: 'button' }, icon('plus'), t('Load more'));

  const append = (raw, atPage) => {
    /* A grid pages through one list, and one list is where a duplicate hurts
       most: the same poster twice in a wall of tiles, a page apart. */
    const items = dedupe.claimSync(raw);
    items.forEach((m) => {
      m.media_type = type;
      const wrap = h('div', { role: 'listitem', style: { display: 'contents' } });
      wrap.append(mCard(m));
      box.append(wrap);
    });
    if (atPage === 1 && !items.length) {
      box.replaceChildren(h('p.muted', { style: { padding: '24px 0' } }, t('Nothing to show here right now.')));
      more.hidden = true;
    }
  };

  const load = async () => {
    if (loading || done) return;
    loading = true;
    more.classList.add('is-busy');
    more.setAttribute('aria-busy', 'true');
    try {
      const r = await fetcher(page);
      const items = Array.isArray(r) ? r : (r?.results || []);
      /* Two ways this list can be over: a short page, or the last page TMDB said
         there was. The second one matters because a shelf of exactly twenty
         answers the first test with "there may be more" and leaves a Load more
         button on screen that can only ever bring back nothing. */
      const pages = Array.isArray(r) ? 0 : Number(r?.total_pages) || 0;
      if (items.length < 20 || (pages && page >= pages)) done = true;
      page += 1;
      append(items, page - 1);
    } catch {
      /* The list is over either way; the only difference is whether anything
         reached the wall. Page one with nothing is an empty shelf, a later page
         is a button that asks to be pressed again. */
      done = true;
      if (page === 1) {
        box.replaceChildren(h('p.muted', { style: { padding: '24px 0' } }, t('Nothing to show here right now.')));
      } else {
        more.replaceChildren(t('Could not load more — try again?'));
      }
    } finally {
      loading = false;
      more.classList.remove('is-busy');
      more.removeAttribute('aria-busy');
      more.hidden = done;
    }
  };

  more.addEventListener('click', load);
  load();

  return h(
    'section.section',
    {},
    h(
      'div.section-head',
      {},
      h('h2', {}, title),
      sub ? h('span.sub', {}, sub) : null,
      h('span.spacer'),
      h('a.link-all', { href: `#/movies?type=${type}` }, icon('chevronLeft', { cls: 'flip' }), type === 'tv' ? t('Back to Series') : t('Back to Movies')),
    ),
    box,
    h('div.m-more-wrap', {}, more),
  );
}

/* ---- hero -----------------------------------------------------------------
   The same contract as the anime spotlight: 5s crossfade, held while pointed
   at, touched, focused or hidden, silent under reduced motion, 44px arrows and
   dots. Reuses the site's own .hero classes so it looks like the same banner. */

const ROTATE_MS = 5000;
const FADE_OUT_MS = 900;

function mHero(items, { onCleanup }) {
  const slides = items.slice(0, 6);
  if (!slides.length) return h('div');

  const reduceQ = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let current = null;
  let timer = 0;
  let hovering = false;
  let focused = false;
  let touching = false;

  const stage = h('div.hero');
  const dots = h('div.hero-dots', { role: 'tablist', 'aria-label': t('Featured titles') });

  slides.forEach((d, i) =>
    dots.append(
      h('button', {
        role: 'tab',
        type: 'button',
        'aria-selected': i === 0 ? 'true' : 'false',
        'aria-label': nameOf(d),
        onclick: () => go(i),
      }),
    ),
  );

  function content(d) {
    const type = typeOf(d);
    const trailer = firstTrailer((d.videos || {}).results);
    const metaBits = [];
    if (d.vote_average) metaBits.push(h('span', { class: 'tnum' }, icon('star'), ` ${rating(d.vote_average)}`));
    const y = yearOf(d);
    if (y) metaBits.push(h('span', { class: 'tnum' }, String(y)));
    if (type === 'movie' && d.runtime) metaBits.push(h('span', {}, runtimeText(d.runtime)));
    if (type === 'tv' && d.number_of_seasons) metaBits.push(h('span', {}, seasonsLabel(d.number_of_seasons)));

    return h(
      'div.hero-content',
      {},
      h('div.hero-eyebrow', {}, icon('trending'), t('Trending this week')),
      h('h2.hero-title.display', {}, nameOf(d)),
      h(
        'div.hero-meta',
        {},
        ...metaBits.flatMap((bit, i) => (i ? [h('span.sep', {}, '·'), bit] : [bit])),
      ),
      h('p.hero-desc.clamp-2', {}, d.overview || t('No synopsis available yet.')),
      (d.genres || []).length
        ? h(
            'div.hero-genres',
            {},
            ...d.genres.slice(0, 3).map((g) => h('a.hero-chip', { href: `#/movies?type=${type}&genre=${g.id}` }, t(g.name))),
          )
        : null,
      h(
        'div.hero-actions',
        {},
        h('a.btn.btn--primary.btn--lg', { href: watchHref(type, d.id) }, icon('play'), t('Start watching')),
        h('a.btn.btn--glass.btn--lg', { href: detailHref(type, d.id) }, icon('info'), t('Details')),
        trailer ? h('button.btn.btn--glass.btn--lg', { type: 'button', onclick: () => openTrailer(trailer.key, nameOf(d)) }, icon('play'), t('Trailer')) : null,
      ),
      h('div.hero-foot', {}, dots),
    );
  }

  function art(d, eager) {
    const banner = backdrop(d.backdrop_path, 'w1280');
    if (banner) {
      const imgEl = h('img.hero-banner', { src: banner, alt: '', decoding: 'async', fetchpriority: eager ? 'high' : null });
      imgEl.addEventListener(
        'error',
        () => {
          d.backdrop_path = null;
          if (slides[index] === d) show(index, { animate: false });
        },
        { once: true },
      );
      return h('div.hero-art', {}, imgEl, h('div.hero-scrim'));
    }
    const p = poster(d.poster_path, 'w500') || poster(d.poster_path, 'original');
    return h(
      'div.hero-art.is-fallback',
      {},
      p ? h('img.hero-blur', { src: p, alt: '', decoding: 'async' }) : null,
      p ? h('img.hero-poster', { src: p, alt: '', decoding: 'async' }) : null,
      h('div.hero-scrim'),
    );
  }

  function show(i, { animate = true } = {}) {
    index = (i + slides.length) % slides.length;
    const d = slides[index];
    const next = h('div.hero-slide', {}, art(d, index === 0), content(d));

    if (!animate || reduceQ.matches) {
      next.classList.add('is-instant');
      stage.replaceChildren(next);
      current = next;
      requestAnimationFrame(() => next.classList.add('is-in'));
    } else {
      const leaving = current;
      leaving?.classList.remove('is-in');
      stage.append(next);
      void next.offsetWidth;
      requestAnimationFrame(() => next.classList.add('is-in'));
      current = next;
      if (leaving) {
        const drop = () => leaving.remove();
        leaving.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, FADE_OUT_MS);
      }
    }

    [...dots.children].forEach((d2, n) => d2.setAttribute('aria-selected', String(n === index)));
  }

  function go(i) {
    show(i);
    start();
  }

  function advance() {
    if (document.hidden || hovering || focused || touching) return;
    show(index + 1);
  }

  function start() {
    clearInterval(timer);
    timer = 0;
    if (slides.length < 2 || reduceQ.matches) return;
    timer = setInterval(advance, ROTATE_MS);
  }

  const onReduce = () => start();
  reduceQ.addEventListener('change', onReduce);

  const wrap = h(
    'section.hero-wrap',
    {},
    stage,
    h(
      'div.hero-controls',
      {},
      h('button.hero-nav.prev', { type: 'button', 'aria-label': t('Previous spotlight'), onclick: () => go(index - 1) }, icon('chevronLeft', { cls: 'flip' })),
      h('button.hero-nav.next', { type: 'button', 'aria-label': t('Next spotlight'), onclick: () => go(index + 1) }, icon('chevronRight', { cls: 'flip' })),
    ),
  );

  wrap.addEventListener('pointerenter', () => { hovering = true; });
  wrap.addEventListener('pointerleave', () => { hovering = false; });
  wrap.addEventListener('focusin', () => { focused = true; });
  wrap.addEventListener('focusout', () => { focused = false; });
  wrap.addEventListener('touchstart', () => { touching = true; }, { passive: true });
  const lift = () => {
    if (!touching) return;
    touching = false;
    start();
  };
  wrap.addEventListener('touchend', lift, { passive: true });
  wrap.addEventListener('touchcancel', lift, { passive: true });

  show(0, { animate: false });
  start();

  onCleanup?.(() => {
    clearInterval(timer);
    timer = 0;
    reduceQ.removeEventListener('change', onReduce);
  });

  return wrap;
}

/* ---- hub sections --------------------------------------------------------- */

const listLabel = (list) =>
  ({
    trending: t('Trending This Week'),
    popular: t('Popular'),
    top: t('Top Rated'),
    now: t('Now Playing'),
    upcoming: t('Upcoming'),
    airing: t('Airing Today'),
    onair: t('On The Air'),
    kids: t('Kids Movies'),
  })[list] || t('Popular');

/* TMDB has no "kids" shelf — what it has is the Family genre on films and a
   Kids genre on series, and those two lists are the honest version of the tab. */
const KIDS_GENRE = { movie: '10751', tv: '10762' };

const listFetcher = (list, type, page = 1) => {
  /* Stamped with the type the grid is showing, and returned in TMDB's own shape:
     the page count travels with it, because a grid needs to know when a list is
     over and an array of twenty looks like a page that has more behind it. */
  const take = (r) => ({ ...r, results: (r?.results || []).map((m) => ({ ...m, media_type: type })) });
  const onlyType = (r) => {
    const out = take(r);
    out.results = out.results.filter((m) => typeOf(m) === type);
    return out;
  };
  switch (list) {
    case 'trending': return api.trending('week', page).then(onlyType);
    case 'popular': return (type === 'tv' ? api.popularTv(page) : api.popularMovies(page)).then(take);
    case 'top': return (type === 'tv' ? api.topTv(page) : api.topMovies(page)).then(take);
    case 'now': return api.nowPlaying(page).then(take);
    case 'upcoming': return api.upcoming(page).then(take);
    case 'airing': return api.airingToday(page).then(take);
    case 'onair': return api.onTheAir(page).then(take);
    case 'kids':
      return api
        .discover(type, { with_genres: KIDS_GENRE[type], sort_by: 'popularity.desc', 'vote_count.gte': 20, page })
        .then(take);
    default: return api.discover(type, { sort_by: 'popularity.desc', page }).then(take);
  }
};

const genreFetcher = (genre, type, page = 1) =>
  api.discover(type, { with_genres: genre, sort_by: 'popularity.desc', 'vote_count.gte': 60, page });

const GENRE_ROWS = {
  movie: [
    ['28,12', 'Action & Adventure'],
    ['35', 'Comedy'],
    ['27,53', 'Horror & Thriller'],
    ['878', 'Sci-Fi'],
    ['16', 'Animation'],
    ['99', 'Documentaries'],
  ],
  tv: [
    ['80,18', 'Crime & Drama'],
    ['10765', 'Sci-Fi & Fantasy'],
    ['16', 'Animation'],
    ['35', 'Comedy'],
    ['9648', 'Mystery'],
    ['99', 'Documentaries'],
  ],
};

const LIST_ROWS = {
  movie: [
    ['trending', 'Trending This Week', 'What everyone is watching right now.'],
    ['popular', 'Popular Movies', 'The most-watched films on the catalogue.'],
    ['top', 'Top Rated Movies', 'The best-scoring films, in order.'],
    ['now', 'Now Playing', 'Fresh in cinemas and already streaming.'],
    ['upcoming', 'Upcoming', 'Releases worth the wait.'],
  ],
  tv: [
    ['trending', 'Trending This Week', 'What everyone is watching right now.'],
    ['popular', 'Popular Series', 'The most-watched series on the catalogue.'],
    ['top', 'Top Rated Series', 'The best-scoring series, in order.'],
    ['airing', 'Airing Today', 'Episodes dropping today.'],
    ['onair', 'On The Air', 'Seasons running right now.'],
  ],
};

/* ---- the filters ---------------------------------------------------------
   Year, genre and order, all three in the URL: a filtered shelf is worth
   bookmarking and worth sending to someone, and a control that only lives in
   memory is neither. Everything here is a discover query the proxy or the
   snapshot can answer — no client-side filtering of a page the server already
   cut, which would leave the viewer counting tiles that are not the list. */

/* Labels stay untranslated here and get `t()` at render, exactly like the sort
   table on the anime discover page: a key frozen at import time would keep
   speaking English to a viewer who switches language mid-session. */
const FILM_SORTS = [
  ['', 'Most popular'],
  ['vote_average.desc', 'Top rated'],
  ['primary_release_date.desc', 'Newest first'],
];

const yearParam = (type) => (type === 'tv' ? 'first_air_date_year' : 'primary_release_year');

const isFiltered = (q) => !!(q.genre || q.year || q.sort);

function discoverParams(type, q, page = 1) {
  const p = { sort_by: q.sort || 'popularity.desc', page };
  if (q.year) p[yearParam(type)] = String(q.year);
  if (q.genre) p.with_genres = String(q.genre);
  /* TMDB ranks a title with three votes above one with three thousand, so a
     "top rated" list with no floor is a wall of obscurities nobody chose. */
  else if (p.sort_by === 'vote_average.desc') p['vote_count.gte'] = 50;
  return p;
}

/** The heading a filtered grid prints: the genre's own name where the map knows
    it, then the year and the order, in the page's language. */
async function filteredTitle(type, q, list) {
  if (q.q) return t('Search results for “{q}”', { q: String(q.q).trim() });
  const bits = [];
  if (list) bits.push(listLabel(list));
  if (q.genre) {
    let name = String(q.genre);
    try {
      const map = await genreMap();
      if (map[name]) name = map[name];
    } catch { /* a numeric id still says which shelf this is */ }
    bits.push(t(name));
  }
  if (q.year) bits.push(String(q.year));
  const sort = FILM_SORTS.find((s) => s[0] === (q.sort || ''));
  if (q.sort && sort) bits.push(t(sort[1]));
  return bits.join(' · ') || (type === 'tv' ? t('Series') : t('Movies'));
}

function filterBar(type, q) {
  const bar = h('div.filter-bar', { role: 'group', 'aria-label': t('Filter') });

  /* One control at a time, and the rest of the state travels with it: picking a
     year inside Horror keeps Horror rather than silently dropping back to
     everything. */
  const apply = (next) => {
    /* The shelf the viewer is standing in — Kids, or a "View all" rail — is part
       of the answer, not part of the chrome: filtering by 2024 inside Kids must
       not walk them out of it. */
    const state = { type, list: q.list || '', genre: q.genre || '', year: q.year || '', sort: q.sort || '', ...next };
    /* A shelf and a filter are two ways of asking one question, and only Kids can
       survive both: TMDB answers "Now Playing in 2024" with a discover query, so
       printing "Now Playing" over it would name a list that is not there. The
       shelf gives way instead of lying. */
    if (state.list !== 'kids' && (state.genre || state.year || state.sort)) state.list = '';
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v) p.set(k, String(v));
    go(`/movies?${p.toString()}`);
  };

  const sel = (label, value, options, onPick) => {
    const s = h(
      'select.select.select--filter',
      { 'aria-label': t(label) },
      ...options.map(([v, name]) => h('option', { value: v, selected: v === value }, name)),
    );
    s.addEventListener('change', () => onPick(s.value));
    return s;
  };

  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = thisYear; y >= thisYear - 14; y -= 1) years.push([String(y), String(y)]);

  bar.append(
    h('span.badge', {}, icon('sliders'), t('Filters')),
    sel('Sort by', q.sort || '', FILM_SORTS.map(([v, l]) => [v, t(l)]), (v) => apply({ sort: v })),
    sel('Year', q.year || '', [['', t('Any year')], ...years], (v) => apply({ year: v })),
  );

  /* AniList paints its genre list from a request; TMDB's table is small and
     fixed, so it lands here as a select the moment the map answers — the two
     controls beside it are useful before then. */
  const genreSlot = h('span.select-slot');
  bar.append(genreSlot);
  genreMap()
    .then((map) => {
      const opts = Object.entries(map).map(([id, name]) => [id, t(name)]);
      if (!opts.length) return;
      genreSlot.replaceChildren(
        sel('Genre', q.genre || '', [['', t('All genres')], ...opts], (v) => apply({ genre: v })),
      );
    })
    .catch(() => {});

  if (isFiltered(q)) {
    bar.append(
      h(
        'button.btn.btn--sm.btn--glass',
        { type: 'button', onclick: () => go(`/movies?type=${type}`) },
        icon('x'),
        t('Clear filters'),
      ),
    );
  }
  return bar;
}

/* ---- the view -------------------------------------------------------------- */

export async function MoviesView(ctx) {
  const { query } = ctx.route;
  const type = query.type === 'tv' ? 'tv' : 'movie';
  const wrap = h('div.page-movies');

  /* A grid is a shelf of the same catalogue, so it keeps the same tabs and the
     same three controls above it: picking a year inside "Horror" should not
     feel like leaving the page you were filtering. */
  const gridMode = (fetcher) => {
    wrap.append(categoryTabs(query.list === 'kids' ? 'kids' : type));
    wrap.append(filterBar(type, query));
    return filteredTitle(type, query, query.list || null)
      .then((title) => {
        wrap.append(mGrid({ title, sub: type === 'tv' ? t('Series') : t('Movies'), type, fetcher }));
        return wrap;
      })
      .catch(() => {
        wrap.append(mGrid({ title: type === 'tv' ? t('Series') : t('Movies'), type, fetcher }));
        return wrap;
      });
  };

  /* ---- grid modes ---- */
  if (query.q) {
    const q = String(query.q).trim();
    return gridMode((page) => api.search(q, type, page));
  }

  if (isFiltered(query) || query.list) {
    /* Unfiltered, a shelf is exactly what its name says: "View all" on Now
       Playing answers with Now Playing. Once the viewer starts naming a year or
       a genre there is no shelf left to stand in — that is a discover query, and
       the only shelf-shaped one worth keeping is Kids, whose own genre the tab
       has already chosen. */
    const useShelf = !isFiltered(query) && query.list && query.list !== 'kids';
    const withGenres = query.genre || (query.list === 'kids' ? KIDS_GENRE[type] : '');
    return gridMode(
      useShelf
        ? (page) => listFetcher(query.list, type, page)
        : (page) =>
            api.discover(type, {
              ...discoverParams(type, query, page),
              ...(withGenres ? { with_genres: withGenres } : {}),
            }),
    );
  }

  /* ---- hub ---- */
  /* The two-way Movies/Series switch this page used to carry is the same choice
     the category strip makes with five of them, so the strip replaced it: one
     row of tabs, and the page you are on is the tab that is lit. */
  wrap.append(categoryTabs(type));
  wrap.append(filterBar(type, query));

  /* its own search box — the header field searches anime, this one the TMDB side */
  const searchInput = h('input.m-search', {
    type: 'search',
    placeholder: type === 'tv' ? t('Search series…') : t('Search movies…'),
    'aria-label': type === 'tv' ? t('Search series') : t('Search movies'),
    autocomplete: 'off',
    spellcheck: false,
  });
  const searchField = h(
    'div.m-searchbar',
    { role: 'search' },
    h('span.s-ico', {}, icon('search')),
    searchInput,
  );
  searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = searchInput.value.trim();
    go(q ? `/movies?type=${type}&q=${encodeURIComponent(q)}` : `/movies?type=${type}`);
  });
  wrap.append(searchField);

  const heroSlot = h('div.home-hero-slot', {}, h('section.hero-wrap', {}, h('div.hero.sk', { style: { minHeight: '420px', borderRadius: 'var(--r-xl)' } })));
  wrap.append(heroSlot);

  /* ---- one title, once --------------------------------------------------
     TMDB's shelves genuinely overlap — a film in release is in "Now Playing" and
     "Upcoming" at the same time, and every popular query returns the same
     blockbusters — so without this the same poster led three rows on one page.
     The claim queue runs in the order the sections appear, so a title belongs to
     whichever shelf sits higher up and simply does not repeat below. The
     spotlight waits at the front of that queue: it is the one slate chosen on
     purpose, and a slow API must not keep the whole page hanging, so the rails
     hold off for it briefly rather than forever. */
  const dedupe = makeDeduper((m) => `${typeOf(m)}:${m.id}`);
  let releaseHero;
  const heroChosen = new Promise((r) => {
    releaseHero = r;
  });
  const heroWait = Promise.race([heroChosen, new Promise((r) => setTimeout(r, 2000))]);

  /* continue watching — local, tmdb-prefixed, never collides with anime ids */
  const cw = movieContinueWatching(14);
  if (cw.length) {
    wrap.append(mRail({
      heading: t('Continue Watching'),
      sub: t('Movies & series you started.'),
      fetcher: async () =>
        dedupe.claimSync(
          cw.map((p) => ({
            id: p.id,
            media_type: p.type,
            title: p.title,
            name: p.title,
            poster_path: p.poster,
            vote_average: 0,
            _href: watchHref(p.type, p.id, p.season || 1, p.episode || 1),
          })),
        ),
    }));
  }

  /* watchlist — the films/series saved from their detail pages */
  const wl = movieWatchlist();
  if (wl.length) {
    wrap.append(mRail({
      heading: t('My Movies Watchlist'),
      sub: t('Saved from detail pages.'),
      fetcher: async () =>
        dedupe.claimSync(
          wl.map((e) => ({
            id: e.id,
            media_type: e.type,
            title: e.title,
            name: e.title,
            poster_path: e.poster,
            vote_average: 0,
          })),
        ),
    }));
  }

  /* the rails */
  for (const [list, heading, sub] of LIST_ROWS[type]) {
    wrap.append(mRail({
      heading: t(heading),
      sub: t(sub),
      viewAll: `#/movies?type=${type}&list=${list}`,
      /* Claim first, then trim to a rail: a shelf that hands twenty titles to
         the queue and keeps sixteen is still full, while one that trims first
         would show eighteen and quietly lose four to the row above it. */
      fetcher: () =>
        listFetcher(list, type)
          .then((r) => dedupe.claim(r.results, { after: heroWait }))
          .then((fresh) => fresh.slice(0, 18)),
    }));
  }

  /* genre rows */
  const genreSlot = h('div.m-genre-rows');
  wrap.append(genreSlot);
  genreMap()
    .then((map) => {
      for (const [ids, heading] of GENRE_ROWS[type]) {
        const names = ids.split(',').map((gid) => map[gid]).filter(Boolean);
        genreSlot.append(mRail({
          heading: t(heading),
          sub: names.slice(0, 2).map((n) => t(n)).join(' · '),
          viewAll: `#/movies?type=${type}&genre=${ids.split(',')[0]}`,
          fetcher: () =>
            genreFetcher(ids, type)
              .then((r) => dedupe.claim(r.results, { after: heroWait }))
              .then((fresh) => fresh.slice(0, 18)),
        }));
      }
    })
    .catch(() => genreSlot.remove());

  /* hero last-in: trending picks with details for the trailer button */
  api
    .trending('week')
    .then((r) => (r.results || []).filter((m) => typeOf(m) === type).slice(0, 6))
    .catch(() => [])
    .then(async (picks) => {
      const details = await Promise.all(picks.map((p) => api.details(typeOf(p), p.id).catch(() => p)));
      for (const d of details) if (!d.media_type) d.media_type = typeOf(d);
      const mine = dedupe.claimSync(details.filter((d) => d.backdrop_path || d.poster_path));
      releaseHero();
      if (!mine.length) return heroSlot.remove();
      heroSlot.replaceChildren(mHero(mine, { onCleanup: ctx.onCleanup }));
    })
    .catch(() => {
      releaseHero();
      heroSlot.remove();
    });

  return wrap;
}
