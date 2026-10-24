/** Discover: filterable, paginated grid with shareable URL state. */

import { h, icon, qs } from '../lib/dom.js';
import { browse, genres, DEFAULT_GENRES } from '../lib/anilist.js';
import { go, parse } from '../lib/router.js';
import { settings } from '../lib/store.js';
import { SORTS, recentSeasons, seasonName, formatLabel, statusLabel, totalLabel, watched } from '../lib/util.js';
import { mediaCard, loadingGrid, emptyState, errorState } from '../components/media.js';
import { sheet, toast } from '../lib/ui.js';
import { t, genre } from '../lib/i18n.js';

const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA'];
const STATUSES = ['RELEASING', 'FINISHED', 'NOT_YET_RELEASED'];
const PER_PAGE = 24;

/* Asymmetric grid, driven purely by position: the same index always gets the
   same shape, so nothing moves while you scroll and "Load more" only ever adds
   rows at the bottom. Nine slots hold the pattern — one wide card, one tall —
   which is sparse enough that the page still scans as a grid. */
const STAGGER_CYCLE = 9;
const staggerClass = (i) => {
  const p = i % STAGGER_CYCLE;
  if (p === 0) return 'is-wide';
  if (p === 4) return 'is-tall';
  return null;
};

const read = () => {
  const q = parse().query;
  return {
    sort: q.sort || 'TRENDING_DESC',
    season: q.season || '',
    genre: q.genre || '',
    format: q.format || '',
    status: q.status || '',
    minScore: Number(q.minScore) || 0,
    search: q.search || '',
  };
};

const write = (state) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v) p.set(k, String(v));
  const s = p.toString();
  go(`/discover${s ? `?${s}` : ''}`, { replace: true, keepScroll: true });
};

export async function DiscoverView() {
  const state = read();
  const wrap = h('div.page-discover');

  const grid = h('div.grid.grid--staggered');
  const count = h('span.result-count');
  const moreBtn = h('button.btn.btn--primary', {}, t('Load more'));
  const filterBar = h('div.filter-bar');
  const activeRow = h('div.active-filters');

  let page = 1;
  let items = [];
  let hasNext = false;
  let busy = false;
  let total = 0;
  let requestId = 0;

  /* The genre sheet is a filter, not the page. Awaiting it here meant a request
     that hung kept the whole view from mounting — an empty screen and a title
     that never changed — so the shipped list paints now and the live one
     replaces the chip the moment AniList answers. */
  let genreList = DEFAULT_GENRES;
  genres().then((list) => {
    if (!list?.length || list === genreList) return;
    genreList = list;
    buildFilterBar();
  });

  /* ---------- filter bar ---------- */
  const select = ({ label, value, options, onPick }) => {
    const sel = h('select.select.select--filter', { 'aria-label': t(label) },
      ...options.map(([v, name]) => h('option', { value: v, selected: v === value }, name)));
    sel.addEventListener('change', () => onPick(sel.value));
    return sel;
  };

  const seasons = recentSeasons(10);
  const scoreChip = (n) => t('Score {n}+', { n });

  function buildFilterBar() {
    filterBar.replaceChildren(
      h('span.badge', {}, icon('sliders'), t('Filters')),
      select({
        label: 'Sort by',
        value: state.sort,
        options: SORTS.map((s) => [s.id, t(s.label)]),
        onPick: (v) => apply({ sort: v }),
      }),
      select({
        label: 'Season',
        value: state.season,
        options: [['', t('Any season')], ...seasons.map((s) => [`${s.season}_${s.year}`, s.label])],
        onPick: (v) => apply({ season: v }),
      }),
      select({
        label: 'Format',
        value: state.format,
        options: [['', t('Any format')], ...FORMATS.map((f) => [f, formatLabel(f)])],
        onPick: (v) => apply({ format: v }),
      }),
      select({
        label: 'Status',
        value: state.status,
        options: [['', t('Any status')], ...STATUSES.map((s) => [s, statusLabel(s)])],
        onPick: (v) => apply({ status: v }),
      }),
      h(
        'button.chip',
        { onclick: () => openGenreSheet(genreList, state.genre, (g) => apply({ genre: g })) },
        icon('palette'),
        state.genre ? genre(state.genre) : t('Genres'),
      ),
      h(
        'button.chip',
        { onclick: () => openMoreSheet(state, apply) },
        icon('list'),
        state.minScore ? scoreChip(state.minScore) : t('More'),
      ),
    );
  }

  buildFilterBar();

  /* ---------- active filter pills ---------- */
  function renderPills() {
    const [seasonKey, seasonYear] = state.season ? state.season.split('_') : [];
    const labels = {
      season: state.season ? seasonName(seasonKey, seasonYear) : '',
      genre: state.genre ? genre(state.genre) : '',
      format: state.format ? formatLabel(state.format) : '',
      status: statusLabel(state.status),
      minScore: state.minScore ? scoreChip(state.minScore) : '',
      search: state.search ? `“${state.search}”` : '',
    };
    const pills = [];
    for (const [key, label] of Object.entries(labels)) {
      if (!label) continue;
      pills.push(
        h(
          'span.pill-x',
          {},
          label,
          h('button', { 'aria-label': t('Remove {label}', { label }), onclick: () => apply({ [key]: '' }) }, icon('x')),
        ),
      );
    }
    if (pills.length) {
      pills.push(h('button.link-all', { onclick: resetAll }, icon('refresh'), t('Clear all')));
    }
    activeRow.replaceChildren(...pills);
    activeRow.classList.toggle('hide', !pills.length);
  }

  /* ---------- data ---------- */
  function varsFor(p) {
    const [season, year] = state.season ? state.season.split('_') : [];
    return {
      page: p,
      perPage: PER_PAGE,
      sort: [state.sort],
      search: state.search || null,
      genre: state.genre || null,
      format: state.format || null,
      status: state.status || null,
      season: season || null,
      seasonYear: year ? Number(year) : null,
      minimumScore: state.minScore || null,
    };
  }

  async function fetchPage(reset) {
    const mine = ++requestId;
    busy = true;
    moreBtn.classList.add('is-disabled');
    if (reset) {
      grid.replaceChildren(loadingGrid(12));
      count.textContent = t('Loading…');
    }
    try {
      /* The clock is what keeps `busy` from latching: an unbounded request that
         never settles leaves the grid under skeletons, the count reading
         "Loading…" forever, and both the button and the scroll sentinel locked
         off, so there is no way back except a reload. */
      const { items: got, info } = await watched(browse(varsFor(page)));
      if (mine !== requestId) return;
      const allow = settings.get('showNsfw');
      const clean = allow ? got : got.filter((m) => !m.isAdult);
      items = reset ? clean : items.concat(clean);
      hasNext = Boolean(info.hasNextPage);
      total = info.total || total;
      render();
    } catch (err) {
      if (mine !== requestId) return;
      if (reset) grid.replaceChildren(errorState(t('Discover'), () => fetchPage(true)));
      count.textContent = t('Unavailable');
      toast(t('The catalogue is busy — try again in a moment'), { tone: 'err', iconName: 'alert' });
    } finally {
      if (mine === requestId) {
        busy = false;
        moreBtn.classList.toggle('is-disabled', !hasNext || busy);
      }
    }
  }

  function render() {
    grid.replaceChildren();
    if (!items.length) {
      grid.replaceChildren(
        emptyState({
          heading: t('No titles match those filters'),
          body: t('Try widening the season, removing a genre, or lowering the score threshold.'),
          action: h('button.btn.btn--primary', { onclick: resetAll }, icon('refresh'), t('Clear filters')),
        }),
      );
      grid.classList.remove('grid');
      moreBtn.classList.add('hide');
      count.textContent = '';
      return;
    }
    grid.classList.add('grid');
    items.forEach((m, i) => {
      const card = mediaCard(m, { eager: i < 8 });
      /* The arrangement class goes on the card the page already has, so the
         card markup itself is untouched and keeps its art, score and title. */
      const shape = staggerClass(i);
      if (shape) card.classList.add(shape);
      grid.append(card);
    });
    count.textContent = totalLabel(total, items.length);
    moreBtn.classList.toggle('hide', !hasNext);
    moreBtn.replaceChildren(icon('chevronDown'), t('Load more'));
  }

  function apply(patch) {
    Object.assign(state, patch);
    page = 1;
    write(state);
    buildFilterBar();
    renderPills();
    fetchPage(true);
  }

  function resetAll() {
    Object.assign(state, { sort: 'TRENDING_DESC', season: '', genre: '', format: '', status: '', minScore: 0, search: '' });
    page = 1;
    items = [];
    write(state);
    buildFilterBar();
    renderPills();
    fetchPage(true);
  }

  moreBtn.addEventListener('click', () => {
    if (!hasNext || busy) return;
    page += 1;
    fetchPage(false);
  });

  // Infinite scroll once the manual button is in view.
  const sentinel = h('div', { style: { height: '1px' } });
  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasNext && !busy && items.length) {
      page += 1;
      fetchPage(false);
    }
  }, { rootMargin: '600px' }).observe(sentinel);

  renderPills();
  fetchPage(true);

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('DISCOVER')),
      h('h1.display', {}, t('Browse the catalogue')),
      h('p', {}, t('Filter every title we track — sort by trend, score or season, then narrow down by genre and format.')),
      h(
        'div.rowline',
        { style: { marginTop: 'var(--sp-4)' } },
        h('a.btn.btn--sm', { href: '#/toons' }, icon('tv'), h('span', {}, t('Classic & Toons'))),
      ),
    ),
    filterBar,
    h('div.discover-meta', {}, count, activeRow),
    grid,
    h('div.load-more', {}, moreBtn),
    sentinel,
  );
  return wrap;
}

/* ---------- sheets ---------- */
function openGenreSheet(all, current, onPick) {
  sheet({
    heading: t('Choose a genre'),
    sub: t('Pick one to filter the grid'),
    render: () =>
      h(
        'div.check-grid',
        {},
        h(`button.check${!current ? '.is-on' : ''}`, { onclick: (e) => { onPick(''); e.target.closest('.modal-backdrop').remove(); } }, icon('x'), t('Any')),
        ...all.map((g) =>
          h(`button.check${g === current ? '.is-on' : ''}`, { onclick: (e) => { onPick(g); e.target.closest('.modal-backdrop').remove(); } }, icon('check'), genre(g)),
        ),
      ),
  });
}

function openMoreSheet(state, apply) {
  const scores = [0, 50, 60, 70, 75, 80, 85];
  sheet({
    heading: t('More filters'),
    sub: t('Score threshold and keyword'),
    render: (api) => {
      const input = h('input.input', { type: 'search', placeholder: t('e.g. witch, mecha, isekai'), value: state.search || '' });
      return h(
        'div.stack',
        {},
        h('div.field', {}, h('label', {}, t('Keyword')), input),
        h('div.field', {},
          h('label', {}, t('Minimum score')),
          h('div.check-grid', {}, ...scores.map((n) =>
            h(`button.check${(state.minScore || 0) === n ? '.is-on' : ''}`, {
              onclick: (e) => {
                [...e.currentTarget.parentElement.children].forEach((c) => c.classList.remove('is-on'));
                e.currentTarget.classList.add('is-on');
                input.dataset.score = String(n);
              },
            }, n === 0 ? t('Any') : `${n}+`),
          )),
        ),
        h('div.rowline', { style: { justifyContent: 'flex-end', gap: '10px' } },
          h('button.btn', { onclick: () => api.close() }, t('Cancel')),
          h('button.btn.btn--primary', {
            onclick: () => {
              apply({ search: input.value.trim(), minScore: Number(input.dataset.score ?? state.minScore) || 0 });
              api.close();
            },
          }, icon('check'), t('Apply')),
        ),
      );
    },
  });
}
