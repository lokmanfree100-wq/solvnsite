/**
 * Instant autocomplete for the top-bar search field.
 *
 * Owned by nav.js: the top bar is thrown away on every route change, so a single
 * live instance is kept here and the previous one is torn down before a new one
 * mounts — that is what stops the document click listener from stacking up.
 */

import { h, icon } from '../lib/dom.js';
import { search } from '../lib/anilist.js';
import { go } from '../lib/router.js';
import { title, formatLabel, yearOf, debounce } from '../lib/util.js';
import { t } from '../lib/i18n.js';

const PER_PAGE = 6;
const THRESHOLD = 2; // only worth a request from two characters on
const DELAY = 250;
const LIST_ID = 'global-search-live';

/** The one mounted instance; a nav rebuild disposes it before mounting the next. */
let active = null;

/**
 * Wire live suggestions onto the top-bar field.
 *
 * Returns a controller whose `onKeydown` nav.js consults first: it answers only
 * for the keys live search owns (arrows, Enter on a focused suggestion, Escape
 * while open), so the existing Enter→/search and Escape handlers stay the
 * fallback and are never duplicated.
 */
export function mountLiveSearch({ input, field }) {
  active?.dispose();

  let req = 0; // request token: a stale answer must never overwrite a newer one
  let items = []; // current suggestions, in the order drawn
  let cursor = -1; // highlighted row, or -1 for none

  const listbox = h('div.live-list', {
    id: LIST_ID,
    role: 'listbox',
    'aria-label': t('Search suggestions'),
  });

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', LIST_ID);
  input.setAttribute('aria-expanded', 'false');
  field.append(listbox);

  const isOpen = () => listbox.classList.contains('is-open');

  function close() {
    listbox.classList.remove('is-open');
    listbox.replaceChildren();
    items = [];
    cursor = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function render(list) {
    items = list;
    cursor = -1;
    if (!list.length) {
      // Intentional empty state rather than a blank box; not an option, so
      // Enter still falls through to the full /search page.
      listbox.replaceChildren(h('div.live-empty', {}, icon('ghost'), h('span', {}, t('No matches'))));
    } else {
      listbox.replaceChildren(
        ...list.map((m, i) =>
          h(
            'a.live-row',
            {
              id: `live-opt-${i}`,
              href: `#/anime/${m.id}`,
              role: 'option',
              'aria-selected': 'false',
              // Keep focus on the field so the click always lands on the row.
              onmousedown: (e) => e.preventDefault(),
            },
            h('img', { src: m.coverImage?.large, alt: '', loading: 'lazy' }),
            h(
              'div.live-body',
              {},
              h('div.live-t.clamp-1', {}, title(m)),
              h('div.live-s', {}, `${formatLabel(m.format)} · ${yearOf(m) || t('TBA')}`),
            ),
          ),
        ),
      );
    }
    listbox.classList.add('is-open');
    input.setAttribute('aria-expanded', 'true');
  }

  function setCursor(next) {
    const rows = listbox.querySelectorAll('.live-row');
    rows.forEach((r, i) => {
      const on = i === next;
      r.classList.toggle('is-cursor', on);
      r.setAttribute('aria-selected', String(on));
    });
    cursor = next;
    if (next >= 0 && rows[next]) {
      input.setAttribute('aria-activedescendant', `live-opt-${next}`);
      rows[next].scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  const runSuggest = debounce(async (q) => {
    if (active !== controller) return; // unmounted while the timer waited
    const mine = ++req;
    try {
      const { items: found } = await search(q, { perPage: PER_PAGE, sort: ['POPULARITY_DESC'] });
      if (mine !== req || active !== controller) return;
      render(found.slice(0, PER_PAGE));
    } catch {
      if (mine === req) close();
    }
  }, DELAY);

  function onInput() {
    const q = input.value.trim();
    if (q.length >= THRESHOLD) runSuggest(q);
    else close();
  }

  function onKeydown(e) {
    if (!isOpen()) return false;
    const count = listbox.querySelectorAll('.live-row').length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (count) setCursor(cursor < 0 ? 0 : (cursor + 1) % count);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (count) setCursor(cursor <= 0 ? count - 1 : cursor - 1);
      return true;
    }
    if (e.key === 'Enter') {
      // With a highlighted row, go straight to that title; with none, let the
      // field's own handler run the current /search?q navigation.
      if (cursor >= 0 && items[cursor]) {
        e.preventDefault();
        go(`/anime/${items[cursor].id}`);
        close();
        return true;
      }
      return false;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      input.blur();
      return true;
    }
    return false;
  }

  function outside(e) {
    if (!field.contains(e.target)) close();
  }

  function dispose() {
    runSuggest.cancel();
    req++; // invalidate anything still in flight
    document.removeEventListener('click', outside);
    input.removeEventListener('input', onInput);
    listbox.remove();
    if (active === controller) active = null;
  }

  input.addEventListener('input', onInput);
  document.addEventListener('click', outside);

  const controller = { onKeydown, dispose };
  active = controller;
  return controller;
}

/** Tear down the live instance. nav.js calls this on every top-bar rebuild. */
export function disposeLiveSearch() {
  active?.dispose();
  active = null;
}
