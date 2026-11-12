/** Top bar and mobile dock. */

import { h, icon, qs } from '../lib/dom.js';
import { go, parse } from '../lib/router.js';
import { settings, onSettings } from '../lib/store.js';
import { randomAnime } from '../lib/anilist.js';
import { sheet, toast } from '../lib/ui.js';
import { sfx } from '../lib/sounds.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { logoMark } from '../lib/brand.js';
import { accountChip } from './account.js';
import { inboxUsable } from '../lib/dms.js';
import { tradeUsable } from '../lib/trades.js';
import { partyUsable } from '../lib/rooms.js';
import { isStaff } from '../lib/account.js';
import { mountLiveSearch, disposeLiveSearch } from './searchlive.js';
import { noticeBell, disposeBell } from './notices.js';

/* God mode has no entry point in the interface: /admin is reached by URL, by
   the one account the server recognises, and its gate is server-side. */

/* Five places a phone viewer returns to, then More. Anime and Cartoons are the
   catalogue now, so the dock carries Cartoons where Movies used to sit: a locked
   tab would spend a thumb-sized slot on a page that cannot open. The category
   strip still names Movies and Series, marked "Soon" (lib/locks.js). */
export const NAV = [
  { id: 'home', label: 'Home', path: '/', icon: 'home' },
  { id: 'toons', label: 'Cartoons', path: '/toons', icon: 'cat' },
  { id: 'discover', label: 'Discover', path: '/discover', icon: 'compass' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
];

/* The desktop top bar. Same destinations as the dock, in the order a viewer
   scans them, plus the parked film catalogue: its address is live and raises
   the one-time note, so it is a real link with a lock on it rather than a
   disabled chip. Everything that does not fit lives behind the three dots. */
export const TOP_LINKS = [
  { id: 'home', label: 'Home', path: '/', icon: 'home' },
  { id: 'discover', label: 'Discover', path: '/discover', icon: 'compass' },
  { id: 'toons', label: 'Cartoons', path: '/toons', icon: 'cat' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library' },
  { id: 'movies', label: 'Movies', path: '/movies', icon: 'film', locked: true },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
];

/** Which tab (if any) a route belongs to. */
function tabFor(path) {
  if (path === '/') return 'home';
  if (path.startsWith('/search') || path.startsWith('/top')) return 'discover';
  if (path.startsWith('/anime') || path.startsWith('/watch')) return null;
  /* The parked catalogues have no dock tab: their pages are a status page, not a
     place to come back to. */
  if (path.startsWith('/movies') || path.startsWith('/movie') || path.startsWith('/mwatch')) return null;
  const seg = path.split('/')[1];
  if (seg === 'settings' || seg === 'updates' || seg === 'packs' || seg === 'messages' || seg === 'mailbox' || seg === 'trades' || seg === 'arena') return 'profile';
  return NAV.some((n) => n.id === seg) ? seg : null;
}

function brand() {
  return h(
    'a.brand',
    { href: '#/', 'aria-label': t('Solvn home') },
    h('span.brand-mark', {}, logoMark()),
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

/* ---- the More sheet ---------------------------------------------------
   Six controls is as wide as the dock goes before the labels start to squeeze,
   so the last one holds everything the rail has and the five tabs cannot. Each
   row is an anchor on the same hash the rail uses: the menu, the rail and the
   dock never keep separate ideas of where a page lives. Closing on the way out
   matters — a sheet lives outside the view, so a route change would leave it
   hanging over the page it just opened. */
function moreSheet() {
  const { path, query } = parse();
  const staff = isStaff();
  const row = (api, { href, iconName, label, on }) =>
    h(
      `a.more-row${on ? '.is-active' : ''}`,
      { href: `#${href}`, 'aria-current': on ? 'page' : null, onclick: () => api.close() },
      icon(iconName),
      h('span.grow', {}, label),
      icon('chevronRight', { cls: 'more-caret' }),
    );
  const group = (title, rows) =>
    h('div.more-group', {}, h('p.more-title', {}, title), h('div.more-rows', {}, ...rows));

  sheet({
    heading: t('All pages'),
    width: 460,
    render: (api) => {
      const libraryTab = (key) => path === '/library' && query.tab === key;
      const onPath = (p) => path === p;
      return h(
        'div.more-menu',
        {},
        group(t('Browse'), [
          row(api, { href: '/search', iconName: 'search', label: t('Search anime'), on: onPath('/search') }),
          row(api, { href: '/updates', iconName: 'calendarStar', label: t('Airing schedule'), on: onPath('/updates') }),
          row(api, { href: '/toons', iconName: 'tv', label: t('Classic & Toons'), on: onPath('/toons') }),
          row(api, { href: '/discover', iconName: 'compass', label: t('Discover'), on: onPath('/discover') }),
        ]),
        group(t('Library'), [
          row(api, { href: '/library', iconName: 'library', label: t('Everything'), on: onPath('/library') && !query.tab }),
          row(api, { href: '/library?tab=watching', iconName: 'eye', label: t('Watching'), on: libraryTab('watching') }),
          row(api, { href: '/library?tab=planned', iconName: 'clock', label: t('Plan to Watch'), on: libraryTab('planned') }),
          row(api, { href: '/library?tab=completed', iconName: 'check', label: t('Completed'), on: libraryTab('completed') }),
        ]),
        group(t('Play'), [
          row(api, { href: '/packs', iconName: 'sparkles', label: t('Card binder'), on: onPath('/packs') }),
          partyUsable()
            ? row(api, { href: '/rooms', iconName: 'users', label: t('Rooms'), on: onPath('/rooms') })
            : null,
          inboxUsable()
            ? row(api, { href: '/messages', iconName: 'chat', label: t('Messages & friends'), on: onPath('/messages') })
            : null,
          /* The gift inbox opens where a member expects to find anything
             addressed to them: on their own profile. */
          inboxUsable()
            ? row(api, { href: '/profile?tab=mail', iconName: 'gift', label: t('Mail in your profile'), on: path.startsWith('/profile') && query.tab === 'mail' })
            : null,
          tradeUsable()
            ? row(api, { href: '/trades', iconName: 'swap', label: t('Trades'), on: onPath('/trades') })
            : null,
        ]),
        group(t('Account'), [
          row(api, { href: '/profile', iconName: 'user', label: t('Profile'), on: path.startsWith('/profile') }),
          row(api, { href: '/settings', iconName: 'settings', label: t('Settings'), on: onPath('/settings') }),
          staff ? row(api, { href: '/admin', iconName: 'lock', label: t('Admin'), on: onPath('/admin') }) : null,
        ]),
      );
    },
  });
}

/* ---- the three-dot menu -----------------------------------------------
   The bar carries six destinations and a search box; everything else — the
   schedule, the binder, rooms, messages, settings, the admin door — waits
   behind this one control. It is a dropdown, not a sheet: on a desktop the
   pointer is on the bar already, so the menu opens under the button it came
   from and closes on the next click outside or Escape. */
function moreButton() {
  const wrap = h('div.nav-more');
  let menu = null;

  const shut = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey);
  };
  const outside = (e) => {
    if (!wrap.contains(e.target)) shut();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    shut();
    btn.focus();
  };

  const row = (href, iconName, label, on) =>
    h(
      `a.more-row${on ? '.is-active' : ''}`,
      { href: `#${href}`, 'aria-current': on ? 'page' : null, onclick: () => shut() },
      icon(iconName),
      h('span.grow', {}, label),
      icon('chevronRight', { cls: 'more-caret' }),
    );
  const group = (title, rows) =>
    h('div.more-group', {}, h('p.more-title', {}, title), h('div.more-rows', {}, ...rows));

  const build = () => {
    const { path } = parse();
    const on = (p) => path === p;
    const staff = isStaff();
    const community = [
      partyUsable() ? row('/rooms', 'users', t('Rooms'), on('/rooms')) : null,
      inboxUsable() ? row('/messages', 'chat', t('Messages & friends'), on('/messages')) : null,
      tradeUsable() ? row('/trades', 'swap', t('Trades'), on('/trades')) : null,
    ].filter(Boolean);

    return h(
      'div.nav-more-menu',
      { role: 'menu', 'aria-label': t('More') },
      h(
        'div.more-menu',
        {},
        /* The bar already carries Home, Discover, Cartoons, Library, Movies and
           Profile, so the menu holds only what it cannot: schedule, binder,
           community and the account doors that are settings-shaped. */
        group(t('Browse'), [
          row('/updates', 'calendarStar', t('Airing schedule'), on('/updates')),
          row('/packs', 'sparkles', t('Card binder'), on('/packs')),
        ]),
        community.length ? group(t('Community'), community) : null,
        group(
          t('Account'),
          [
            row('/settings', 'settings', t('Settings'), on('/settings')),
            staff ? row('/admin', 'lock', t('Admin'), on('/admin')) : null,
          ].filter(Boolean),
        ),
      ),
      h('div.nav-tools', {}, randomButton(), soundToggle()),
    );
  };

  const btn = h(
    'button.icon-btn.nav-more-btn',
    {
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      'aria-label': t('More'),
      title: t('More'),
    },
    icon('more', { weight: 2.6 }),
  );

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menu) return shut();
    menu = build();
    wrap.append(menu);
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey);
  });

  wrap.append(btn);
  return wrap;
}

/* ---- the sound handle -------------------------------------------------
   Sound has two controls on purpose — this one in the header and the switch in
   Settings — and both read one setting. `onSettings` repaints the header when
   the change arrives from the other place, so the two can never disagree.
   The sound is drawn after the write, so turning the system on answers with the
   tone it just unlocked rather than with silence. */
let soundBtn = null;
const soundOn = () => settings.get('uiSound') !== false;
const soundLabel = () => (soundOn() ? t('Turn off interface sounds') : t('Turn on interface sounds'));

function paintSoundBtn() {
  if (!soundBtn?.isConnected) return;
  const on = soundOn();
  soundBtn.classList.toggle('is-on', on);
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.setAttribute('aria-label', soundLabel());
  soundBtn.replaceChildren(icon(on ? 'volume' : 'volumeOff'));
}
onSettings(paintSoundBtn);

function soundToggle() {
  soundBtn = h(
    `button.icon-btn.btn--sound${soundOn() ? '.is-on' : ''}`,
    {
      type: 'button',
      'aria-pressed': String(soundOn()),
      'aria-label': soundLabel(),
      onclick: () => {
        const next = !soundOn();
        settings.set('uiSound', next);
        sfx.toggle(next);
      },
    },
    icon(soundOn() ? 'volume' : 'volumeOff'),
  );
  return soundBtn;
}

export function renderNav() {
  const { path, query } = parse();
  const tab = tabFor(path);

  /* A route change throws the top bar away, so drop the menu handle with it. */
  closeLangMenu = null;
  /* The live search box lives in the top bar too: tear its document listener
     down before this rebuild, otherwise every route change would stack another. */
  disposeLiveSearch();
  /* Same for an open bell menu: it hangs off a node this rebuild is about to
     throw away, and its outside-click listener would outlive both of them. */
  disposeBell();

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

  /* One bar, three zones: brand and the destinations on the left, the search
     box in the middle, and the handful of account tools on the right with
     everything else folded into the three dots. The side rail and the dock are
     hidden from 1000px up, so this row is the only navigation on a desktop. */
  const topnav = h(
    'nav.topnav',
    { 'aria-label': t('Primary') },
    ...TOP_LINKS.map((l) => {
      const on = tab === l.id || path === l.path;
      return h(
        `a.topnav-link${on ? '.is-on' : ''}${l.locked ? '.is-locked' : ''}`,
        { href: `#${l.path}`, 'aria-current': on ? 'page' : null, 'aria-label': t(l.label) },
        icon(l.icon),
        h('span', {}, t(l.label)),
        l.locked ? icon('lock', { cls: 'topnav-lock' }) : null,
      );
    }),
  );

  topbar.replaceChildren(
    brand(),
    topnav,
    h('span.topbar-spacer'),
    field,
    noticeBell(),
    h('div.lang-pick', {}, languagePicker()),
    accountChip(),
    moreButton(),
  );

  /* The desktop rail is gone: from 1000px up this bar is the navigation, and
     the dock below is the phone's. Nothing renders into `#sidenav` any more,
     so there is no hidden tree of links and no unread-count node to maintain. */

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
    /* The dock answers for the five places a viewer returns to. Everything
       else — schedule, top 100, lists, packs, settings — waits behind this one
       control instead of stretching the bar into unreadable slivers. */
    h(
      'button.tab',
      { type: 'button', 'aria-haspopup': 'dialog', onclick: moreSheet },
      icon('grid'),
      h('span', {}, t('More')),
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
