/** Library: locally-stored lists, favourites and in-progress titles. */

import { h, icon } from '../lib/dom.js';
import { go, parse } from '../lib/router.js';
import {
  LISTS,
  LIST_LABELS,
  listEntries,
  listCount,
  totalListCount,
  favouriteEntries,
  toggleFavourite,
  continueWatching,
  removeFromLists,
  clearProgress,
  history,
} from '../lib/store.js';
import { relativeTime, listLabel } from '../lib/util.js';
import { mediaCard, emptyState } from '../components/media.js';
import { toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';

/* One row of pills, and every pill is a saved status: the three device views
   (in progress, favourites, recently viewed) are reached from the stat tiles
   above, because a filter row that mixes statuses with histories is the reason
   this page used to read as four tabs saying "watching". */
const TABS = [
  ['all', 'All Saved'],
  ['watching', LIST_LABELS.watching],
  ['completed', LIST_LABELS.completed],
  ['planned', LIST_LABELS.planned],
  ['onHold', LIST_LABELS.onHold],
  ['dropped', LIST_LABELS.dropped],
];

/** The views the pills do not carry, kept reachable by deep link and by tile. */
const VIEWS = ['progress', 'favourites', 'history'];

const tabOf = (raw) =>
  TABS.some(([key]) => key === raw) || VIEWS.includes(raw) ? raw : 'all';

const asMedia = (e) => ({
  id: e.id,
  title: { romaji: e.title },
  coverImage: { large: e.cover },
  format: e.format,
  episodes: e.episodes ?? e.total,
  seasonYear: e.seasonYear,
  status: 'FINISHED',
});

export async function LibraryView() {
  const { query } = parse();
  let tab = tabOf(query.tab);
  const wrap = h('div.page-library');

  const body = h('div');
  const tabBar = h('div.list-tabs', { role: 'tablist' });
  const stats = h('div.stat-row');

  const chips = new Map();

  const countFor = (key) =>
    key === 'all' ? totalListCount()
    : key === 'favourites' ? favouriteEntries().length
    : key === 'progress' ? continueWatching(99).length
    : key === 'history' ? history(99).length
    : listCount(key);

  for (const [key, label] of TABS) {
    const n = h('span', { style: { opacity: 0.65, fontSize: '11.5px' } });
    const chip = h(`button.chip${tab === key ? '.is-active' : ''}`, {
      role: 'tab',
      'aria-selected': String(tab === key),
      onclick: () => {
        if (tab === key) return;
        tab = key;
        for (const [k, el] of chips) {
          const on = k === key;
          el.classList.toggle('is-active', on);
          el.setAttribute('aria-selected', String(on));
        }
        go(`/library?tab=${key}`, { replace: true, keepScroll: true });
        render();
      },
    }, t(label), n);
    chips.set(key, chip);
    tabBar.append(chip);
  }

  /** Counts and stat tiles both change when a card is removed. */
  function paintMeta() {
    for (const [key, chip] of chips) {
      const c = countFor(key);
      const badge = chip.lastElementChild;
      badge.textContent = c ? String(c) : '';
      badge.hidden = !c;
    }
    stats.replaceChildren(
      stat(totalListCount(), t('Saved titles'), 'all', tab === 'all'),
      stat(continueWatching(99).length, t('In progress'), 'progress', tab === 'progress'),
      stat(favouriteEntries().length, t('Favourites'), 'favourites', tab === 'favourites'),
      stat(history(99).length, t('Recently viewed'), 'history', tab === 'history'),
    );
  }

  function render() {
    paintMeta();
    if (tab === 'favourites') return renderFavourites();
    if (tab === 'progress') return renderProgress();
    if (tab === 'history') return renderHistory();
    return renderList(tab);
  }

  function gridWith(items, onRemove) {
    const grid = h('div.grid');
    items.forEach((m, i) => {
      const card = mediaCard(m, { eager: i < 10 });
      if (!onRemove) {
        grid.append(card);
        return;
      }
      grid.append(
        h('div', { style: { position: 'relative' } }, card,
          h('button.icon-btn', {
            'aria-label': t('Remove from this list'),
            title: t('Remove from this list'),
            style: {
              position: 'absolute', top: '8px', insetInlineEnd: '8px', zIndex: 4,
              width: '28px', height: '28px', background: 'var(--glass-strong)',
              border: '1px solid var(--line-strong)', backdropFilter: 'blur(8px)',
            },
            onclick: () => {
              onRemove(m);
              render();
            },
          }, icon('x'))),
      );
    });
    return grid;
  }

  function renderList(key) {
    /* A title sits in exactly one list, so "All Saved" is a concatenation, not a
       merge — newest first, whatever shelf it belongs to. */
    const entries =
      key === 'all'
        ? LISTS.flatMap((k) => listEntries(k)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        : listEntries(key);
    if (!entries.length) {
      body.replaceChildren(
        emptyState({
          iconName: 'library',
          heading: key === 'all' ? t('Your library is empty') : t('Your {list} list is empty', { list: listLabel(key) }),
          body: t('Open any title and use “Add to list” to keep it here. Everything stays on this device.'),
          action: h('a.btn.btn--primary', { href: '#/discover' }, icon('compass'), t('Find something to watch')),
        }),
      );
      return;
    }
    body.replaceChildren(
      h('p.muted', { style: { fontSize: '13px', marginBottom: 'var(--sp-4)' } },
        entries.length === 1 ? t('{n} title · saved locally', { n: entries.length }) : t('{n} titles · saved locally', { n: entries.length })),
      gridWith(entries.map(asMedia), (m) => {
        removeFromLists(m.id);
        toast(t('Removed from your library'), { iconName: 'bookmark' });
        document.dispatchEvent(new CustomEvent('kitsune:nav'));
      }),
    );
  }

  function renderFavourites() {
    const entries = favouriteEntries();
    if (!entries.length) {
      body.replaceChildren(
        emptyState({
          iconName: 'heart',
          heading: t('No favourites yet'),
          body: t('Tap the heart on any title to pin it here.'),
          action: h('a.btn.btn--primary', { href: '#/discover' }, icon('compass'), t('Browse anime')),
        }),
      );
      return;
    }
    body.replaceChildren(
      h('p.muted', { style: { fontSize: '13px', marginBottom: 'var(--sp-4)' } },
        entries.length === 1 ? t('{n} favourite', { n: entries.length }) : t('{n} favourites', { n: entries.length })),
      gridWith(entries.map(asMedia), (m) => {
        toggleFavourite({ id: m.id });
        render();
      }),
    );
  }

  function renderProgress() {
    const entries = continueWatching(60);
    if (!entries.length) {
      body.replaceChildren(
        emptyState({
          iconName: 'history',
          heading: t('Nothing in progress'),
          body: t('Start any episode and it will show up here so you can pick up where you left off.'),
          action: h('a.btn.btn--primary', { href: '#/' }, icon('home'), t('Back to home')),
        }),
      );
      return;
    }
    body.replaceChildren(
      h('p.muted', { style: { fontSize: '13px', marginBottom: 'var(--sp-4)' } },
        t('{n} unfinished · last opened {when}', { n: entries.length, when: relativeTime(entries[0].at) })),
      gridWith(entries.map(asMedia), (m) => {
        clearProgress(m.id);
        toast(t('Progress cleared'), { tone: 'ok', iconName: 'check' });
        render();
      }),
    );
  }

  function renderHistory() {
    const entries = history(60);
    if (!entries.length) {
      body.replaceChildren(
        emptyState({ iconName: 'eye', heading: t('Nothing watched yet'), body: t('Titles you open will appear here.') }),
      );
      return;
    }
    body.replaceChildren(
      h('p.muted', { style: { fontSize: '13px', marginBottom: 'var(--sp-4)' } }, t('{n} recently viewed', { n: entries.length })),
      gridWith(entries.map(asMedia)),
    );
  }

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('LIBRARY')),
      h('h1.display', {}, t('Your library')),
      h('p', {}, t('Everything you save lives in this browser — no account, no sign-in, nothing sent anywhere.')),
    ),
    stats,
    tabBar,
    body,
  );
  render();
  return wrap;
}

/* A tile is a door, not a caption: each count already names a view, so it goes
   there rather than leaving three of them under the pills as dead numbers. */
const stat = (k, l, tab, active) =>
  h(`a.stat${active ? '.is-on' : ''}`, {
    href: `#/library?tab=${tab}`,
    'aria-label': l,
    title: l,
  }, h('div.k.tnum', {}, String(k)), h('div.l', {}, l));
