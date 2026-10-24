/** Top bar, desktop side nav and mobile tab bar. */

import { h, icon, qs } from '../lib/dom.js';
import { go, parse } from '../lib/router.js';
import { listCount, totalListCount } from '../lib/store.js';
import { randomAnime } from '../lib/anilist.js';
import { toast } from '../lib/ui.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { accountChip } from './account.js';
import { mountLiveSearch, disposeLiveSearch } from './searchlive.js';

/* God mode has no entry point in the interface: /admin is reached by URL, by
   the one account the server recognises, and its gate is server-side. */

export const NAV = [
  { id: 'home', label: 'Home', path: '/', icon: 'home' },
  { id: 'discover', label: 'Discover', path: '/discover', icon: 'compass' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
];

/** Which tab (if any) a route belongs to. */
function tabFor(path) {
  if (path === '/') return 'home';
  if (path.startsWith('/search')) return 'discover';
  if (path.startsWith('/anime') || path.startsWith('/watch')) return null;
  const seg = path.split('/')[1];
  if (seg === 'settings' || seg === 'updates') return 'profile';
  return NAV.some((n) => n.id === seg) ? seg : null;
}

function brand(compact) {
  return h(
    'a.brand',
    { href: '#/', 'aria-label': t('Solvn home'), style: compact ? { padding: '2px 12px 20px' } : null },
    h('span.brand-mark', {}, icon('cat')),
    h('span.brand-word', {}, 'Solvn'),
  );
}

/** One menu at a time — the closer unbinds the document listeners it added. */
let closeLangMenu = null;

function languagePicker() {
  const active = lang();
  const btn = h('button.btn.btn--lang', {
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-label': t('Change language'),
    title: t('Change language'),
  }, icon('globe'), h('span.lang-code.tnum', {}, LANGS[active].code), icon('chevronDown', { cls: 'lang-caret' }));

  const open = () => {
    const menu = h(
      'div.lang-menu',
      { role: 'menu', 'aria-label': t('Language') },
      ...Object.entries(LANGS).map(([id, l]) =>
        h(
          `button.lang-option${id === active ? '.is-on' : ''}`,
          {
            type: 'button',
            role: 'menuitemradio',
            'aria-checked': String(id === active),
            onclick: () => {
              shut();
              setLang(id);
            },
          },
          h('span.lang-name', {}, l.name),
          h('span.lang-abbr.tnum', {}, l.code),
          id === active ? icon('check') : null,
        ),
      ),
    );
    const shut = () => {
      menu.remove();
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey);
      if (closeLangMenu === shut) closeLangMenu = null;
    };
    const outside = (e) => {
      if (!wrap.contains(e.target)) shut();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') shut();
    };
    const wrap = btn.parentElement;
    wrap.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey);
    closeLangMenu = shut;
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (closeLangMenu) closeLangMenu();
    else open();
  });
  return btn;
}

function sideLink({ label, path, iconName, count, active }) {
  return h(
    `a.side-link${active ? '.is-active' : ''}`,
    { href: `#${path}`, 'aria-current': active ? 'page' : null },
    icon(iconName),
    h('span.grow', {}, label),
    count ? h('span.count.tnum', {}, String(count)) : null,
  );
}

/** One roll at a time — renderNav rebuilds the bar, so the flag lives here. */
let rolling = false;

function randomButton() {
  const btn = h(
    'button.btn.btn--random',
    {
      type: 'button',
      title: t('Take me to a random anime rated 7.0 or higher'),
      'aria-label': t('Surprise me with a random anime'),
      onclick: async () => {
        if (rolling) return;
        rolling = true;
        btn.classList.add('is-busy');
        btn.setAttribute('aria-busy', 'true');
        try {
          const m = await randomAnime();
          toast(t('Rolling with {title}', { title: m.title?.romaji || m.title?.english || t('a random pick') }), {
            iconName: 'sparkles',
          });
          go(`/anime/${m.id}`);
        } catch {
          toast(t('The catalogue would not hand over a pick. Try again?'), { tone: 'err', iconName: 'alert' });
        } finally {
          rolling = false;
          btn.classList.remove('is-busy');
          btn.removeAttribute('aria-busy');
        }
      },
    },
    icon('shuffle'),
    h('span.only-desktop', {}, t('Surprise me')),
  );
  return btn;
}

export function renderNav() {
  const { path, query } = parse();
  const tab = tabFor(path);
  const onLibrary = path === '/library';
  const libTab = query.tab || 'watching';

  /* A route change throws the top bar away, so drop the menu handle with it. */
  closeLangMenu = null;
  /* The live search box lives in the top bar too: tear its document listener
     down before this rebuild, otherwise every route change would stack another. */
  disposeLiveSearch();

  /* ---------------- top bar ---------------- */
  const topbar = qs('#topbar');
  const input = h('input', {
    type: 'search',
    id: 'global-search',
    placeholder: t('Search anime…'),
    'aria-label': t('Search anime'),
    autocomplete: 'off',
    spellcheck: false,
    value: path === '/search' ? query.q || '' : '',
  });

  const field = h(
    'div.searchbar',
    { role: 'search' },
    h('span.s-ico', {}, icon('search')),
    input,
    h('kbd', {}, '/'),
  );

  const live = mountLiveSearch({ input, field });

  input.addEventListener('keydown', (e) => {
    // Live search answers for the keys it owns; anything else (Enter with no
    // suggestion under the cursor, or Escape with the box closed) falls through.
    if (live.onKeydown(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      go(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
      input.blur();
    }
    if (e.key === 'Escape') {
      input.value = '';
      input.blur();
    }
  });

  topbar.replaceChildren(
    brand(false),
    h('span.topbar-spacer'),
    field,
    randomButton(),
    h('div.lang-pick', {}, languagePicker()),
    accountChip(),
  );

  /* ---------------- side nav ---------------- */
  qs('#sidenav').replaceChildren(
    brand(true),
    sideLink({ label: t('Home'), path: '/', iconName: 'home', active: tab === 'home' }),
    sideLink({ label: t('Discover'), path: '/discover', iconName: 'compass', active: tab === 'discover' }),
    sideLink({ label: t('Search'), path: '/search', iconName: 'search', active: path === '/search' }),
    h('div.side-sep'),
    h('div.side-title', {}, t('Your lists')),
    sideLink({ label: t('Library'), path: '/library', iconName: 'library', count: totalListCount(), active: onLibrary && !query.tab }),
    sideLink({ label: t('Watching'), path: '/library?tab=watching', iconName: 'eye', count: listCount('watching'), active: onLibrary && libTab === 'watching' }),
    sideLink({ label: t('Completed'), path: '/library?tab=completed', iconName: 'check', count: listCount('completed'), active: onLibrary && libTab === 'completed' }),
    sideLink({ label: t('Plan to watch'), path: '/library?tab=planned', iconName: 'bookmark', count: listCount('planned'), active: onLibrary && libTab === 'planned' }),
    h('div.side-sep'),
    sideLink({ label: t('Airing schedule'), path: '/updates', iconName: 'calendarStar', active: path === '/updates' }),
    sideLink({ label: t('Top 100'), path: '/top', iconName: 'trophy', active: path === '/top' }),
    sideLink({ label: t('Profile'), path: '/profile', iconName: 'user', active: path.startsWith('/profile') }),
    sideLink({ label: t('Settings'), path: '/settings', iconName: 'settings', active: path === '/settings' }),
    h('div.side-foot', {}, t('Free HD anime streaming.'), h('br'), t('Solvn does not store files on its own servers.')),
  );

  /* ---------------- tab bar ---------------- */
  qs('#tabbar').replaceChildren(
    ...NAV.map((n) =>
      h(
        `a.tab${tab === n.id ? '.is-active' : ''}`,
        { href: `#${n.path}`, 'aria-current': tab === n.id ? 'page' : null },
        icon(n.icon),
        h('span', {}, t(n.label)),
      ),
    ),
  );
}

export function setTopbarStuck(on) {
  qs('#topbar').classList.toggle('is-stuck', on);
}

export function focusSearch() {
  const el = qs('#global-search');
  if (!el) return false;
  el.focus();
  el.select();
  return true;
}
