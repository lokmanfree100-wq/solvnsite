/**
 * Movies & Series hub — the TMDB half of the site.
 *
 * `/movies`            → the film hub: spotlight, rails, genre strip
 * `/series`            → the TV hub, with its own spotlight and rows
 * `/movies?list=…`     → a paginated grid for one rail ("View all")
 * `/movies?genre=…`    → a paginated genre grid
 * `/movies?q=…`        → its own search results grid
 *
 * All data comes through the /tmdb proxy; the key never reaches the browser.
 */

import { h, icon, scrollMax, scrollPos, scrollInlineBy } from '../../lib/dom.js';
import { go } from '../../lib/router.js';
import { t } from '../../lib/i18n.js';
import { sheet } from '../../lib/ui.js';
import { stillImage } from '../../components/media.js';
import { categoryTabs } from '../../components/cats.js';
import { cinematicShowcase } from '../../components/cinematic-showcase.js';
import { makeDeduper } from '../../lib/dedupe.js';
import {
  api, poster, nameOf, genreMap,
  movieContinueWatching, movieWatchlist, servingOffline,
} from '../../lib/tmdb.js';
import { canStreamTitle } from '../../lib/sources.js';
import { streamableInCatalogue } from '../../lib/catalogue.js';

/**
 * Rule 1 — only streamable titles reach the wall.
 *
 * A film/series card is rendered only when the title is streamable on this device.
 * On a static host the snapshot is the source of truth (`streamableInCatalogue`);
 * on a host with the /stream proxy, the live resolver is asked (`canStreamTitle`).
 * The catalogue results already carry the snapshot's judgement when they came from it,
 * so the fast path is the offline flag; the slow path is the live resolver for live/proxy
 * results.
 *
 * This is asynchronous and non-blocking for the viewer: a rail keeps its skeletons
 * while the check runs, and a title that cannot be verified simply never gets a card.
 * The rail still fills with the ones that can.
 */
const inferType = (m) => (m?.media_type === 'tv' || m?.first_air_date || m?.name ? 'tv' : 'movie');

const isStreamable = async (m, type) => {
  const id = Number(m.id);
  if (!id) return false;
  type = type || inferType(m);
  /* Fast path: the snapshot already said so. `type` is the TMDB media type ('tv' or
     'movie'), which is exactly what streamableInCatalogue and canStreamTitle expect. */
  const offline = streamableInCatalogue(type, id);
  if (offline === true) return true;
  if (offline === false) return false;
  return canStreamTitle({ type, id, tmdb: id });
};

/** Drop titles that cannot be streamed on this device *before* they touch the wall.
 *  Returns the same-shape list the rail/grid expect, minus the dead ones.
 *
 *  The result array is parallel to `items` (same length, same order), so a title with
 *  a non-numeric id is safely treated as not streamable rather than silently mis-indexed.
 */
export async function streamableOnly(items, type) {
  if (!items.length) return [];
  type = type || inferType(items[0]);
  /* One check per item, in the same order as `items`, so the filter below stays
     aligned. Titles without a numeric id are marked false (not streamable) immediately.
     Batches are bounded so a large shelf never opens an unbounded number of resolver
     calls at once; the resolver itself is session-cached, so this is a concurrency cap
     more than a correctness requirement. */
  const checks = new Array(items.length).fill(false);
  const batch = [];
  for (let i = 0; i < items.length; i++) {
    const id = Number(items[i].id);
    if (!id) continue;
    batch.push({ at: i, id });
    if (batch.length < 8) continue;
    const ids = batch.map((b) => b.id);
    const results = await Promise.all(ids.map((id) => isStreamable({ id }, type)));
    for (let k = 0; k < batch.length; k++) checks[batch[k].at] = results[k];
    batch.length = 0;
  }
  if (batch.length) {
    const ids = batch.map((b) => b.id);
    const results = await Promise.all(ids.map((id) => isStreamable({ id }, type)));
    for (let k = 0; k < batch.length; k++) checks[batch[k].at] = results[k];
  }
  return items.filter((_, i) => checks[i]);
}


/* ---- one honest shelf per page ----------------------------------------
   A rail that cannot answer is a rail taken off the page, not a paragraph
   about infrastructure: the shelves beside it still fill, and the viewer is
   left with the ones that work. */

function failRail(root) {
  root.remove();
}

/* ---- links ------------------------------------------------------------ */

const detailHref = (t2, id) => (t2 === 'tv' ? `#/series/${id}` : `#/movie/${id}`);
const watchHref = (t2, id, s = 1, e = 1) =>
  t2 === 'tv' ? `#/swatch/${id}?s=${s}&e=${e}` : `#/mwatch/${id}`;
/** The hub a type lives on: one base for tabs, filters, search and "View all". */
const baseFor = (t2) => (t2 === 'tv' ? '/series' : '/movies');

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
    ),
    h('div.card-body', {}, h('div.card-title.clamp-2', {}, title)),
  );
}

function mSkeletons(n) {
  return Array.from({ length: n }, () =>
    h('div.card.m-card', { 'aria-hidden': 'true' }, h('div.sk.sk--poster'), h('div.sk.sk--text')),
  );
}

/* ---- rail ----------------------------------------------------------------
   Same contract as the anime rows: vertical scrolling belongs to the page, the
   rail moves with a horizontal swipe/drag or its own visible 44px arrows. */

export function mRail({ heading, sub, viewAll, fetcher }) {
  const track = h('div.row.no-scrollbar.m-track', { role: 'list' });
  const root = h('section.section.row-wrap');
  const fill = async (items) => {
    /* Rule 1: do not render a poster the device cannot stream. Filter before the
       rail touches the DOM so a dead title never flashes on screen. */
    const good = await streamableOnly(items);
    if (!good.length) {
      /* A shelf the snapshot simply does not fill — a genre with no titles in it,
         or a shelf whose titles are all unstreamable on this device — leaves no
         heading standing over nothing. On a live connection an empty shelf is a
         fault, so it stays visible and says so. */
      if (servingOffline()) {
        root.remove();
        return;
      }
      track.replaceChildren(h('p.muted', { style: { padding: '20px 0', fontSize: '14px' } }, t('Nothing to show here right now.')));
      return;
    }
    track.replaceChildren();
    good.forEach((m, i) => {
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

  fetcher().then(fill).catch(() => failRail(root));
  return root;
}

/* ---- grid (one list, paginated) ------------------------------------------ */

function mGrid({ title, sub, type, fetcher, base = baseFor(type) }) {
  const box = h('div.m-grid', { role: 'list' });
  /* One type per grid, and the grid stamps it on every tile anyway, so the key
     is the same for every page it pulls in. */
  const dedupe = makeDeduper((m) => `${type}:${m.id}`);
  let page = 1;
  let done = false;
  let loading = false;
  const more = h('button.btn.btn--glass.m-more', { type: 'button' }, icon('plus'), t('Load more'));

  const append = async (raw, atPage) => {
    /* A grid pages through one list, and one list is where a duplicate hurts
       most: the same poster twice in a wall of tiles, a page apart. */
    const items = dedupe.claimSync(raw);
    /* Rule 1 again: a tile is only painted when the title is streamable on this device. */
    const good = await streamableOnly(items, type);
    good.forEach((m) => {
      m.media_type = type;
      const wrap = h('div', { role: 'listitem', style: { display: 'contents' } });
      wrap.append(mCard(m));
      box.append(wrap);
    });
    if (atPage === 1 && !good.length) {
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
      await append(items, page - 1);
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
      h('a.link-all', { href: `#${base}` }, icon('chevronLeft', { cls: 'flip' }), type === 'tv' ? t('Back to Series') : t('Back to Movies')),
    ),
    box,
    h('div.m-more-wrap', {}, more),
  );
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
    ['trending', 'Trending Movies', 'What everyone is watching right now.'],
    ['popular', 'Popular Movies', 'The most-watched films on the catalogue.'],
    ['now', 'Recently Added', 'Fresh in cinemas and new to the catalogue.'],
    ['top', 'Top Rated', 'The best-scoring films, in order.'],
  ],
  tv: [
    ['trending', 'Trending Series', 'What everyone is watching right now.'],
    ['popular', 'Popular Shows', 'The most-watched series on the catalogue.'],
    ['onair', 'Recently Updated', 'Series with fresh chapters this week.'],
    ['airing', 'New This Week', 'Fresh chapters landing today.'],
    ['top', 'Top Rated', 'The best-scoring series, in order.'],
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

function filterBar(type, q, base = baseFor(type)) {
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
    go(`${base}?${p.toString()}`);
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
        { type: 'button', onclick: () => go(base) },
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
  const base = baseFor(type);
  const wrap = h('div.page-movies');

  /* A grid is a shelf of the same catalogue, so it keeps the same tabs and the
     same three controls above it: picking a year inside "Horror" should not
     feel like leaving the page you were filtering. */
  const gridMode = (fetcher) => {
    wrap.append(categoryTabs(type));
    wrap.append(filterBar(type, query, base));
    return filteredTitle(type, query, query.list || null)
      .then((title) => {
        wrap.append(mGrid({ title, sub: type === 'tv' ? t('Series') : t('Movies'), type, fetcher, base }));
        return wrap;
      })
      .catch(() => {
        wrap.append(mGrid({ title: type === 'tv' ? t('Series') : t('Movies'), type, fetcher, base }));
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
  /* The spotlight is the page's first object: the editorial lead (Resident
     Evil on Movies, The Mentalist on Series), its 4K backdrop edge to edge,
     and a three-card vertical preview dock on the right. Tabs, filters and
     search follow the stage rather than pushing the art below the fold. */
  wrap.append(cinematicShowcase(type, { onCleanup: ctx?.onCleanup }));
  wrap.append(categoryTabs(type));
  wrap.append(filterBar(type, query, base));

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
    go(q ? `${base}?q=${encodeURIComponent(q)}` : base);
  });
  wrap.append(searchField);

  /* ---- one title, once --------------------------------------------------
     TMDB's shelves genuinely overlap — a film in release is in "Now Playing" and
     "Upcoming" at the same time, and every popular query returns the same
     blockbusters — so without this the same poster led three rows on one page.
     The claim queue runs in the order the sections appear, so a title belongs to
     whichever shelf sits higher up and simply does not repeat below. */
  const dedupe = makeDeduper((m) => `${typeOf(m)}:${m.id}`);

  /* continue watching — local, tmdb-prefixed, never collides with anime ids */
  const cw = movieContinueWatching(14).filter((p) => p.type === type);
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
  const wl = movieWatchlist().filter((e) => e.type === type);
  if (wl.length) {
    wrap.append(mRail({
      heading: type === 'tv' ? t('My Series Watchlist') : t('My Movies Watchlist'),
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
      viewAll: `#${base}?list=${list}`,
      /* Claim first, then trim to a rail: a shelf that hands twenty titles to
         the queue and keeps sixteen is still full, while one that trims first
         would show eighteen and quietly lose four to the row above it. */
      fetcher: () =>
        listFetcher(list, type)
          .then((r) => dedupe.claim(r.results))
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
          viewAll: `#${base}?genre=${ids.split(',')[0]}`,
          fetcher: () =>
            genreFetcher(ids, type)
              .then((r) => dedupe.claim(r.results))
              .then((fresh) => fresh.slice(0, 18)),
        }));
      }
    })
    .catch(() => genreSlot.remove());

  return wrap;
}

/** `/series` — the TV half of the same machinery, with its own base path and
    its own rows, so the two catalogues never share a shelf. */
export function SeriesView(ctx) {
  return MoviesView({
    ...ctx,
    route: { ...ctx.route, query: { ...ctx.route.query, type: 'tv' } },
  });
}
