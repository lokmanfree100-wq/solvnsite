/** Top bar, desktop side nav and mobile tab bar. */

import { h, icon, qs } from '../lib/dom.js';
import { go, parse } from '../lib/router.js';
import { totalListCount, settings, onSettings } from '../lib/store.js';
import { randomAnime } from '../lib/anilist.js';
import { sheet, toast } from '../lib/ui.js';
import { sfx } from '../lib/sounds.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { logoMark } from '../lib/brand.js';
import { accountChip } from './account.js';
import { inboxState, inboxUsable, subscribeInbox } from '../lib/dms.js';
import { tradeUsable } from '../lib/trades.js';
import { partyUsable } from '../lib/rooms.js';
import { isStaff } from '../lib/account.js';
import { mountLiveSearch, disposeLiveSearch } from './searchlive.js';
import { noticeBell, disposeBell } from './notices.js';

/* God mode has no entry point in the interface: /admin is reached by URL, by
   the one account the server recognises, and its gate is server-side. */

/* Five places a phone viewer returns to, then More. Toons is not one of them:
   every category — أفلام, مسلسلات, أنمي, كرتونز, أفلام الأطفال — already sits in
   the strip pinned under the top bar on the pages that have shelves, so the dock
   keeps its fifth slot for the films, series and lists this member actually goes
   back to. */
export const NAV = [
  { id: 'home', label: 'Home', path: '/', icon: 'home' },
  { id: 'movies', label: 'Movies', path: '/movies', icon: 'film' },
  { id: 'discover', label: 'Discover', path: '/discover', icon: 'compass' },
  { id: 'library', label: 'Library', path: '/library', icon: 'library' },
  { id: 'profile', label: 'Profile', path: '/profile', icon: 'user' },
];

/** Which tab (if any) a route belongs to. */
function tabFor(path) {
  if (path === '/') return 'home';
  if (path.startsWith('/search') || path.startsWith('/top')) return 'discover';
  if (path.startsWith('/anime') || path.startsWith('/watch')) return null;
  if (path.startsWith('/movies') || path.startsWith('/movie') || path.startsWith('/mwatch')) return 'movies';
  const seg = path.split('/')[1];
  if (seg === 'settings' || seg === 'updates' || seg === 'packs' || seg === 'messages' || seg === 'mailbox' || seg === 'trades' || seg === 'arena') return 'profile';
  return NAV.some((n) => n.id === seg) ? seg : null;
}

function brand(compact) {
  return h(
    'a.brand',
    { href: '#/', 'aria-label': t('Solvn home'), style: compact ? { padding: '2px 12px 20px' } : null },
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

function sideLink({ label, path, iconName, count, badge: withBadge, active }) {
  return h(
    `a.side-link${active ? '.is-active' : ''}`,
    { href: `#${path}`, 'aria-current': active ? 'page' : null },
    icon(iconName),
    h('span.grow', {}, label),
    /* A badge link always carries its node, hidden when there is nothing to
       count — the rail paints that one text node instead of rebuilding. */
    withBadge ? h('span.count.tnum', { hidden: true }, '') : count ? h('span.count.tnum', {}, String(count)) : null,
  );
}

/* ---- the unread count in the rail --------------------------------------
   A line that lands while you are on Home should show up on the link before you
   go looking for it, so the rail keeps one node pointed at the inbox number and
   the store paints that node instead of rebuilding the whole navigation — a
   rebuild would throw away the header search box mid-type for something that is
   one text node away.

   The number moved onto Profile with the inbox it counts: private lines are read
   from the More sheet and gifts are opened under Profile ▸ Mail, so the one
   place that can honestly say "there is something waiting for you" is the link
   to the page that holds both. */
let badge = null;

function paintBadge() {
  if (!badge?.isConnected) return;
  const n = inboxState().unread;
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = !n;
  badge.title = n ? t('{n} unread in your inbox', { n }) : '';
}

/* The rail wears whatever number the inbox holds, so it repaints on every emit:
   a delivery, a read tick and a line taken back all move that figure, and one
   text node is cheaper than deciding after the fact which of them mattered. */
subscribeInbox(() => paintBadge());

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
          row(api, { href: '/movies', iconName: 'film', label: t('Movies'), on: path.startsWith('/movies') && query.type !== 'tv' }),
          row(api, { href: '/movies?type=tv', iconName: 'tv', label: t('Series'), on: path.startsWith('/movies') && query.type === 'tv' }),
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
  const onLibrary = path === '/library';
  /* The admin page is linked only while a staff session is open. The gate
     itself is the server's; this just keeps a dead door off everybody's rail. */
  const staff = isStaff();

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

  topbar.replaceChildren(
    brand(false),
    h('span.topbar-spacer'),
    field,
    randomButton(),
    soundToggle(),
    noticeBell(),
    h('div.lang-pick', {}, languagePicker()),
    accountChip(),
  );

  /* ---------------- side nav ---------------- */
  /* Built before the rail so the badge can be pointed at its node: the inbox
     number is painted after the mount, not guessed while the link is written. */
  const profileLink = sideLink({ label: t('Profile'), path: '/profile', iconName: 'user', badge: true, active: path.startsWith('/profile') });
  badge = profileLink.querySelector('.count');
  /* The TMDB half of the site: one rail entry per catalogue. A title's own pages
     (detail/watch) keep the entry lit by the type in the URL. */
  const onMovies = (p) => path.startsWith('/movies') || p.startsWith('/movie') || p.startsWith('/mwatch');
  qs('#sidenav').replaceChildren(
    brand(true),
    sideLink({ label: t('Home'), path: '/', iconName: 'home', active: tab === 'home' }),
    sideLink({ label: t('Discover'), path: '/discover', iconName: 'compass', active: tab === 'discover' }),
    sideLink({ label: t('Classic & Toons'), path: '/toons', iconName: 'tv', active: path === '/toons' }),
    h('div.side-sep'),
    sideLink({ label: t('Movies'), path: '/movies', iconName: 'film', active: onMovies(path) && query.type !== 'tv' }),
    sideLink({ label: t('Series'), path: '/movies?type=tv', iconName: 'tv', active: onMovies(path) && query.type === 'tv' }),
    h('div.side-sep'),
    /* One Library entry, not one per list: the tabs inside the page already say
       watching, completed and plan to watch, and a rail that repeats them turns
       four links into the same destination. */
    sideLink({ label: t('Library'), path: '/library', iconName: 'library', count: totalListCount(), active: onLibrary }),
    h('div.side-sep'),
    sideLink({ label: t('Airing schedule'), path: '/updates', iconName: 'calendarStar', active: path === '/updates' }),
    sideLink({ label: t('Card binder'), path: '/packs', iconName: 'sparkles', active: path.startsWith('/packs') }),
    /* Rooms holds the seat a friend invited you to. It takes the rail place that
       Messages used to keep: private chats stay one tap away in the More sheet,
       and a room is the thing a member actually walks back to mid-episode. */
    partyUsable() ? sideLink({ label: t('Rooms'), path: '/rooms', iconName: 'users', active: path === '/rooms' }) : null,
    /* The gift inbox lives inside Profile now, so it has no rail entry of its
       own: one place to look for anything addressed to this member. */
    /* A deal is written on the server that runs this site, for the same reason a
       message is — so the link appears and disappears with the same capability. */
    tradeUsable() ? sideLink({ label: t('Trades'), path: '/trades', iconName: 'swap', active: path === '/trades' }) : null,
    /* The rail's unread number rides on Profile now, because that is where the
       inbox it counts lives — private lines and gifted cards alike. */
    profileLink,
    sideLink({ label: t('Settings'), path: '/settings', iconName: 'settings', active: path === '/settings' }),
    staff ? sideLink({ label: t('Admin'), path: '/admin', iconName: 'lock', active: path === '/admin' }) : null,
    h('div.side-foot', {}, t('Solvn — anime, films & series in HD')),
  );
  paintBadge();

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
