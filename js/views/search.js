/** Search: instant suggestions, recent queries, full result grid. */

import { h, icon, qs } from '../lib/dom.js';
import { search } from '../lib/anilist.js';
import { go, parse } from '../lib/router.js';
import { recentSearches, pushQuery, clearQueries, settings } from '../lib/store.js';
import { title, formatLabel, yearOf, compactNumber, debounce } from '../lib/util.js';
import { mediaCard, loadingGrid, emptyState } from '../components/media.js';
import { avatar, titleChip } from '../components/account.js';
import { searchMembers, shownName, staticHost } from '../lib/account.js';
import { toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';

const SORTS = [
  ['SEARCH_MATCH', 'Best match'],
  ['POPULARITY_DESC', 'Most popular'],
  ['SCORE_DESC', 'Highest rated'],
  ['START_DATE_DESC', 'Newest'],
];

export async function SearchView() {
  const wrap = h('div.page-search');
  const initial = parse().query.q || '';
  let sort = parse().query.sort || 'SEARCH_MATCH';
  let timer = null;
  let suggestReq = 0;
  let resultReq = 0;

  const results = h('div.grid');
  const summary = h('p.muted', { style: { fontSize: '13px', marginTop: '6px' } });
  const suggestions = h('div.suggest.hide');

  const PER_PAGE = 36;
  const moreBtn = h('button.btn.btn--primary', { onclick: () => loadNextPage() }, icon('chevronDown'), t('Load more'));
  const pager = h('div.pager.hide', {}, moreBtn);
  let page = 1;
  let hasNext = false;
  let lastQ = '';

  const input = h('input', {
    type: 'search',
    placeholder: t('Try “Frieren”, “cowboy”, “slice of life”…'),
    'aria-label': t('Search anime'),
    autocomplete: 'off',
    spellcheck: false,
    value: initial,
  });

  const field = h('div.search-big', {}, icon('search'), input, h('button.icon-btn.hide', { 'aria-label': t('Clear search') }, icon('x')));
  field.appendChild(suggestions);
  const clearBtn = qs('button', field);

  /* ---------- suggestions ---------- */
  const runSuggest = debounce(async (q) => {
    const mine = ++suggestReq;
    try {
      const { items } = await search(q, { perPage: 6, sort: ['POPULARITY_DESC'] });
      if (mine !== suggestReq) return;
      suggestions.replaceChildren(
        h('div.suggest-head', {}, t('Titles')),
        ...(items.length
          ? items.map((m) =>
              h(
                'a.suggest-item',
                {
                  href: `#/anime/${m.id}`,
                  onclick: () => {
                    pushQuery(title(m));
                    hideSuggestions();
                  },
                },
                h('img', { src: m.coverImage?.large, alt: '', loading: 'lazy' }),
                h('div', {}, h('div.t.clamp-1', {}, title(m)), h('div.s', {}, `${formatLabel(m.format)} · ${yearOf(m) || t('TBA')}`)),
              ),
            )
          : [h('div.suggest-item', {}, icon('ghost'), h('div.t', {}, t('No matches')))]),
      );
      suggestions.classList.remove('hide');
    } catch {
      if (mine === suggestReq) suggestions.classList.add('hide');
    }
  }, 260);

  const hideSuggestions = () => suggestions.classList.add('hide');

  input.addEventListener('input', () => {
    clearBtn.classList.toggle('hide', !input.value);
    if (input.value.trim().length >= 2) runSuggest(input.value.trim());
    else hideSuggestions();
    debouncedSearch();
  });

  input.addEventListener('keydown', (e) => {
    const items = [...suggestions.querySelectorAll('.suggest-item[href]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cur = items.findIndex((i) => i.classList.contains('is-cursor'));
      items.forEach((i) => i.classList.remove('is-cursor'));
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = cur < 0 ? (step > 0 ? 0 : items.length - 1) : (cur + step + items.length) % items.length;
      items[next]?.classList.add('is-cursor');
      items[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const focused = items.find((i) => i.classList.contains('is-cursor'));
      if (focused) {
        location.hash = focused.getAttribute('href');
        return;
      }
      commit(input.value);
    } else if (e.key === 'Escape') {
      hideSuggestions();
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!field.contains(e.target) && !suggestions.contains(e.target)) hideSuggestions();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hide');
    hideSuggestions();
    findMembers('');
    commit('');
    input.focus();
  });

  /* ---------- members ----------------------------------------------------
     The same words find people as well as shows. A rail of profiles appears
     under the field as soon as a handle or a display name matches, and says
     nothing at all when the account layer is not there: the anime search works
     on its own either way, so a missing server never costs this page a button. */
  const members = h('div.member-rail.hide');
  let memberReq = 0;

  async function findMembers(q) {
    const token = ++memberReq;
    members.classList.add('hide');
    members.replaceChildren();
    const term = (q || '').trim();
    if (term.length < 2 || staticHost()) return;
    let list;
    try {
      list = (await searchMembers(term)).users || [];
    } catch {
      return;
    }
    if (token !== memberReq) return;
    members.replaceChildren(
      h(
        'div.section-head',
        {},
        h('h2', {}, t('Members')),
        h('span.spacer'),
        h('a.link-all', { href: '#/leaderboard' }, icon('trophy'), t('Leaderboard')),
      ),
      h(
        'div.member-row',
        {},
        ...list.map((u) =>
          h(
            'a.member-chip',
            { href: `#/profile/${encodeURIComponent(u.id)}`, 'aria-label': t('Open {name}', { name: shownName(u) }) },
            avatar(u, { size: 'sm' }),
            h('span.member-names', {}, h('b', {}, shownName(u), titleChip(u)), h('span.faint', {}, `@${u.username}`)),
          ),
        ),
      ),
    );
    members.classList.remove('hide');
  }

  /* ---------- results ---------- */
  const debouncedSearch = debounce(() => commit(input.value, true), 520);

  async function commit(rawQ, fromTyping = false) {
    const q = (rawQ || '').trim();
    if (!fromTyping) hideSuggestions();

    if (q.length < 2) {
      findMembers('');
      if (fromTyping) return; // wait until the query is worth a request
      clearBtn.classList.add('hide');
      go('/search', { replace: true, keepScroll: true });
      renderLanding();
      return;
    }
    pushQuery(q);
    findMembers(q);
    go(`/search?q=${encodeURIComponent(q)}${sort !== 'SEARCH_MATCH' ? `&sort=${sort}` : ''}`, { replace: true, keepScroll: true });
    renderLoading();
    const mine = ++resultReq;
    page = 1;
    lastQ = q;
    try {
      const { items, info } = await search(q, { perPage: PER_PAGE, page, sort: [sort] });
      if (mine !== resultReq) return;
      const allow = settings.get('showNsfw');
      const clean = allow ? items : items.filter((m) => !m.isAdult);
      hasNext = Boolean(info.hasNextPage);
      renderResults(clean, q);
    } catch {
      if (mine !== resultReq) return;
      results.replaceChildren(emptyState({ iconName: 'offline', heading: t('Search failed'), body: t('The search did not answer. Give it a second and try again.') }));
      summary.textContent = '';
      pager.classList.add('hide');
    }
  }

  async function loadNextPage() {
    const mine = resultReq;
    moreBtn.disabled = true;
    moreBtn.textContent = t('Loading…');
    try {
      const { items, info } = await search(lastQ, { perPage: PER_PAGE, page: page + 1, sort: [sort] });
      if (mine !== resultReq) return;
      const allow = settings.get('showNsfw');
      const clean = allow ? items : items.filter((m) => !m.isAdult);
      page += 1;
      hasNext = Boolean(info.hasNextPage);
      results.append(...clean.map((m) => mediaCard(m)));
      paintSummary(lastQ);
      paintPager();
    } catch {
      toast(t('Could not load more results'), { tone: 'err', iconName: 'alert' });
    } finally {
      if (mine === resultReq) paintPager();
    }
  }

  function paintPager() {
    moreBtn.disabled = false;
    moreBtn.textContent = '';
    moreBtn.append(icon('chevronDown'), t('Load more'));
    pager.classList.toggle('hide', !hasNext);
  }

  function renderLoading() {
    results.className = 'grid';
    results.replaceChildren(...loadingGrid(12).children);
    pager.classList.add('hide');
    summary.textContent = t('Searching…');
  }

  function renderResults(items, q) {
    if (!items.length) {
      results.className = '';
      results.replaceChildren(
        emptyState({
          heading: t('Nothing found for “{q}”', { q }),
          body: t('Check the spelling, try the Japanese title, or browse Discover instead.'),
          action: h('a.btn.btn--primary', { href: '#/discover' }, icon('compass'), t('Open Discover')),
        }),
      );
      summary.textContent = '';
      pager.classList.add('hide');
      return;
    }
    results.className = 'grid';
    results.replaceChildren(...items.map((m, i) => mediaCard(m, { eager: i < 8 })));
    paintSummary(q);
    paintPager();
  }

  // AniList reports an inflated `pageInfo.total` for text search, so quote what we
  // actually have and mark it open-ended while more pages remain.
  function paintSummary(q) {
    const n = results.children.length;
    const count = hasNext ? `${compactNumber(n)}+` : compactNumber(n);
    summary.textContent = n === 1
      ? t('{count} result for “{q}”', { count, q })
      : t('{count} results for “{q}”', { count, q });
  }

  /* ---------- landing (no query) ---------- */
  function renderLanding() {
    results.className = '';
    pager.classList.add('hide');
    const recents = recentSearches(8);
    results.replaceChildren(
      h('div.search-landing', {},
        recents.length
          ? h('section.section', {},
              h('div.section-head', {}, h('h2', {}, t('Recent searches')), h('span.spacer'),
                h('button.link-all', { onclick: () => { clearQueries(); renderLanding(); } }, icon('trash'), t('Clear'))),
              h('div.genre-strip', {}, ...recents.map((r) =>
                h('button.genre-pill', { onclick: () => { input.value = r; clearBtn.classList.remove('hide'); commit(r); } }, icon('history'), r),
              )),
            )
          : null,
        h('section.section', {},
          h('div.section-head', {}, h('h2', {}, t('Popular searches')), h('span.spacer')),
          h('div.genre-strip', {}, ...['Frieren', 'Jujutsu Kaisen', 'One Piece', 'Chainsaw Man', 'Spy x Family', 'Vinland Saga', 'Bocchi the Rock', 'Solo Leveling'].map((r) =>
            h('button.genre-pill', { onclick: () => { input.value = r; clearBtn.classList.remove('hide'); commit(r); } }, icon('search'), r),
          )),
        ),
        h('section.section', {},
          h('div.section-head', {}, h('h2', {}, t('Or just browse'))),
          h('div.rowline.wrap', { style: { gap: '10px' } },
            h('a.btn', { href: '#/discover?sort=TRENDING_DESC' }, icon('trending'), t('Trending')),
            h('a.btn', { href: '#/discover?status=RELEASING' }, icon('film'), t('Airing now')),
            h('a.btn', { href: '#/discover?format=MOVIE' }, icon('tv'), t('Films')),
            h('a.btn', { href: '#/discover?sort=SCORE_DESC' }, icon('star'), t('Top rated')),
          ),
        ),
      ),
    );
  }

  const sortBar = h('div.rowline.wrap', { style: { gap: '8px', marginTop: 'var(--sp-5)' } },
    h('span.faint', { style: { fontSize: '12.5px', fontFamily: 'var(--font-display)', fontWeight: '600' } }, t('Sort')),
    ...SORTS.map(([id, label]) =>
      h(`button.chip.btn--sm.chip--xs${id === sort ? '.is-active' : ''}`, {
        onclick: (e) => {
          sort = id;
          [...e.currentTarget.parentElement.querySelectorAll('.chip')].forEach((c) => c.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
          if (input.value.trim().length >= 2) commit(input.value);
        },
      }, t(label)),
    ),
  );

  wrap.append(
    h('div.search-hero', {},
      h('div.eyebrow', { style: { marginBottom: '10px' } }, t('SEARCH')),
      h('h1.display', { style: { fontSize: 'clamp(26px,5vw,38px)' } }, t('Find anything')),
      field,
      summary,
    ),
    sortBar,
    members,
    results,
    pager,
  );

  if (initial.length >= 2) {
    clearBtn.classList.remove('hide');
    commit(initial);
  } else {
    renderLanding();
    requestAnimationFrame(() => input.focus());
  }

  return wrap;
}
