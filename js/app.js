/** App boot: route table, view mounting, global shortcuts, theme. */

import { qs, h, icon } from './lib/dom.js';
import { parse, start as startRouter, onChange, go, rememberScroll } from './lib/router.js';
import { paintAccent } from './lib/accent.js';
import { apiDown, retryNow } from './lib/anilist.js';
import { t } from './lib/i18n.js';
import { renderNav, setTopbarStuck, focusSearch } from './components/nav.js';
import { renderFooter, footerVisible } from './components/footer.js';
import { errorState } from './components/media.js';
import { closeSheets } from './lib/ui.js';
import { initTilt } from './lib/tilt.js';
import { installInterfaceSounds } from './lib/sounds.js';

import { HomeView } from './views/home.js';
import { DiscoverView } from './views/discover.js';
import { ToonsView } from './views/toons.js';
import { SearchView } from './views/search.js';
import { DetailView } from './views/detail.js';
import { WatchView } from './views/watch.js';
import { LibraryView } from './views/library.js';
import { UpdatesView } from './views/updates.js';
import { SettingsView } from './views/settings.js';
import { ProfileView } from './views/profile.js';
import { CollectionView } from './views/collection.js';
import { LeaderboardView } from './views/leaderboard.js';
import { MessagesView } from './views/messages.js';
import { TradesView } from './views/trades.js';
import { ArenaView } from './views/arena.js';
import { SpinView } from './views/spin.js';
import { TopView } from './views/top.js';
import { AdminView } from './views/admin.js';
import { restore, pushStats, staticHost, takeRecovery } from './lib/account.js';
import { askAboutAccount, resetSheet } from './components/account.js';

const ROUTES = [
  { match: /^\/$/, view: HomeView, nav: true },
  { match: /^\/discover$/, view: DiscoverView, nav: true },
  { match: /^\/toons$/, view: ToonsView, nav: true },
  { match: /^\/search$/, view: SearchView, nav: true },
  { match: /^\/library$/, view: LibraryView, nav: true },
  { match: /^\/updates$/, view: UpdatesView, nav: true },
  { match: /^\/top$/, view: TopView, nav: true },
  { match: /^\/profile$/, view: ProfileView, nav: true },
  { match: /^\/profile\/[\w-]+$/, view: ProfileView, nav: true },
  { match: /^\/packs$/, view: CollectionView, nav: true },
  { match: /^\/leaderboard$/, view: LeaderboardView, nav: true },
  { match: /^\/messages$/, view: MessagesView, nav: true },
  { match: /^\/trades$/, view: TradesView, nav: true },
  { match: /^\/arena$/, view: ArenaView, nav: true },
  { match: /^\/spin$/, view: SpinView, nav: true },
  { match: /^\/settings$/, view: SettingsView, nav: true },
  { match: /^\/admin$/, view: AdminView, nav: true },
  { match: /^\/anime\/(\d+)/, view: DetailView, nav: true },
  { match: /^\/watch\/(\d+)/, view: WatchView, nav: false },
];

const root = () => qs('#view');

/* Netlify puts its watermark in the bottom-right corner — the same corner the
   mobile dock lives in. base.css hides the mark, and this flag raises the dock
   above that corner as well, so the navigation stays reachable even on a plan
   that will not let the badge go. A plain host never matches, so nothing moves. */
if (/\.netlify\.(app|site|com)$/i.test(location.hostname)) {
  document.documentElement.dataset.hostBadge = 'netlify';
}

function applyTheme() {
  paintAccent();
  const meta = qs('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(bg)) meta.content = bg;
  }
}

let token = 0;
let disposers = [];
let lastRoute = null;

/** Views register teardown here; run before every mount so timers/listeners die with the route. */
function dispose() {
  // A sheet left open over a route change traps the viewer behind a backdrop
  // they cannot dismiss on a touch screen.
  closeSheets();
  // Leaving a view is the moment the hours moved. The call is a no-op unless
  // the figures actually changed, so a route that never watched anything costs
  // nothing.
  pushStats();
  const pending = disposers;
  disposers = [];
  pending.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a dead view must not block the next one */
    }
  });
}

async function mount(route) {
  const mine = ++token;
  const entered = route.raw !== lastRoute;
  const match = ROUTES.find((r) => r.match.test(route.path));
  const host = root();

  dispose();
  renderNav();
  qs('#topbar').hidden = !match || match.nav === false;

  /* The footer is chrome, rebuilt with each mount so a new language or a freshly
     configured social profile shows up without a reload. It bows out on the
     watch page, where the player owns the viewport. */
  renderFooter();
  footerVisible(!(match && match.nav === false));

  if (!match) {
    host.replaceChildren(
      h(
        'div.state',
        {},
        h('div.state-art', {}, icon('compass')),
        h('h3', {}, t('Page not found')),
        h('p', {}, t('Nothing lives at {path}.', { path: route.path })),
        h('a.btn.btn--primary', { href: '#/' }, t('Back to home')),
      ),
    );
    return;
  }

  /* AniList ids are numbers; a member id is an opaque string. */
  const idMatch = route.path.match(/^\/(anime|watch|profile)\/([^/?#]+)/);
  const ctx = {
    route,
    params: idMatch ? { id: idMatch[1] === 'profile' ? idMatch[2] : Number(idMatch[2]) } : {},
    go,
    onCleanup: (fn) => disposers.push(fn),
  };

  let node;
  try {
    node = await match.view(ctx);
  } catch (err) {
    if (mine !== token) return;
    node = errorState(t('That page'), () => mount(parse()));
  }
  if (mine !== token) return;

  host.replaceChildren(node);
  node.classList?.add('view-enter');
  lastRoute = route.raw;
  if (entered && route.path === '/') toTop();
  document.title = pageTitle(route.path.split('/')[1] || '');
}

/**
 * Home always starts at the very top, spotlight flush under the header — no
 * remembered offset, no banner pushing the fold down. A short hop is animated;
 * a long one is not, because sliding past a pageful of stale rows to reach the
 * top reads as a glitch, not as motion.
 *
 * `behavior` must be an explicit "instant" when we do not animate: "auto" means
 * "follow CSS", and `html { scroll-behavior: smooth }` turns every reset into a
 * scroll that never completes while the tab is hidden.
 */
function toTop() {
  const smooth = window.scrollY > 0 && window.scrollY < window.innerHeight * 1.5 &&
    !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'instant' });
}

const PAGE_TITLES = {
  '': 'Solvn — Watch Anime',
  discover: 'Discover — Solvn',
  toons: 'Classic & Toons — Solvn',
  search: 'Search — Solvn',
  library: 'Your Library — Solvn',
  updates: 'Airing Schedule — Solvn',
  top: 'Top 100 — Solvn',
  profile: 'Profile — Solvn',
  packs: 'Card Binder — Solvn',
  leaderboard: 'Leaderboard — Solvn',
  messages: 'Messages — Solvn',
  trades: 'Trades — Solvn',
  arena: 'Arena — Solvn',
  spin: 'Fortune Wheel — Solvn',
  settings: 'Settings — Solvn',
  admin: 'Admin — Solvn',
  anime: 'Details — Solvn',
  watch: 'Watch — Solvn',
};
const pageTitle = (seg) => t(PAGE_TITLES[seg] || PAGE_TITLES['']);

/* ---- global shortcuts ------------------------------------------------ */
function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === '/' && !typing) {
      e.preventDefault();
      focusSearch();
      return;
    }
    if (e.key === 'Escape' && !typing) {
      const sheet = qs('.modal-backdrop');
      if (sheet) sheet.remove();
      return;
    }
    if (typing) return;
    if (e.key === 'h') go('/');
    if (e.key === 'd') go('/discover');
    if (e.key === 'l') go('/library');
    if (e.key === 'u') go('/updates');
    if (e.key === 'p') go('/profile');
  });
}

/* A route change cannot fix the strings the HTML shipped with, so the few
   outside the view are synced by hand — once at boot, once per language. */
function syncChrome() {
  const skip = qs('.skip-link');
  if (skip) skip.textContent = t('Skip to content');
  const desc = qs('meta[name="description"]');
  if (desc) desc.content = t('Solvn — browse, search and watch anime with polished episode pages.');
  const label = t('Primary navigation');
  for (const id of ['sidenav', 'tabbar']) qs(`#${id}`)?.setAttribute('aria-label', label);
}

/* ---- boot ------------------------------------------------------------ */
applyTheme();
syncChrome();
installShortcuts();
installInterfaceSounds();
initTilt();

/* The intro animates itself in CSS over 3.5s; JS only lifts the dead node out
   once the veil has finished fading. Under reduced motion the whole thing is a
   short fade, so the node goes early rather than holding a still frame.
   `introMs` is also when the interface is worth talking to: the veil sits at
   full opacity until ~78% of the animation and is layered above every sheet, so
   anything opened before it lifts is spent behind a black screen. */
const splash = qs('#splash');
const introMs = splash ? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 900 : 3600) : 0;
const introEnds = Date.now() + introMs;
if (splash) {
  setTimeout(() => splash.remove(), introMs);
}

let lastY = 0;
window.addEventListener(
  'scroll',
  () => {
    const y = window.scrollY;
    if ((y > 8) !== (lastY > 8)) setTopbarStuck(y > 8);
    lastY = y;
  },
  { passive: true },
);

window.addEventListener('beforeunload', rememberScroll);
onChange(mount);
document.addEventListener('kitsune:nav', renderNav);
document.addEventListener('kitsune:theme', applyTheme);
/* A session change only swaps the chip and the nav counts — the page is the same. */
document.addEventListener('kitsune:account', renderNav);

/* A new language rewrites every label, so the live view is rebuilt rather than
   patched — same route, new strings, new inline direction. */
document.addEventListener('kitsune:lang', () => {
  syncChrome();
  mount(parse());
});

/* Recovery is the only thing the API layer announces, and even that is just a
   repaint: rows swap from saved copies back to live data with no interrupting
   bar. Going quiet needs no announcement — the page simply stays full. */
document.addEventListener('kitsune:api', () => mount(parse()));

/* Coming back to the tab is the moment a viewer expects fresh rows, so drop the
   outage backoff instead of serving the same snapshot for another five minutes. */
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !apiDown()) return;
  retryNow();
  mount(parse());
});

startRouter();

/* The page never waits on the session: the chip repaints itself when the answer
   arrives. Only the pages that are *about* the session are rebuilt, and only if
   somebody deep-linked straight into one of them. The same probe finds out
   whether this copy has a server at all — if it does not, the view is rebuilt
   once so that the controls needing one are taken out rather than left to fail. */
restore().then(() => {
  const { path } = parse();
  if (staticHost() || path === '/profile' || path.startsWith('/profile/')) mount(parse());
  /* An email link that came here to reset a password carries a session that
     exists for no other purpose, so the first thing on screen is the sheet that
     spends it. Nothing else about the page changes. */
  if (takeRecovery()) {
    resetSheet();
    return;
  }
  /* A first visitor is asked about an account once, and only after the answer
     about the session is known — otherwise a returning member would be offered
     a signup form over their own profile. It waits for the intro as well, since
     a sheet under the veil is a sheet nobody sees. A deep link straight into the
     player is the one screen it must not land on: the episode owns that moment. */
  if (path.startsWith('/watch/')) return;
  setTimeout(askAboutAccount, Math.max(0, introEnds - Date.now()));
});
