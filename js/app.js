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
import './lib/core.js';

/* Two preferences change the live document rather than a single page: the
   watched-episode blur and the hero title alignment. Keep them on <html> so a
   view mounted later inherits the same answer without a second copy. */
const applyInterfacePreferences = () => {
  document.documentElement.dataset.blurWatched = String(Boolean(settings.get('blurWatched')));
  document.documentElement.dataset.titleAlign = String(settings.get('titleAlign') || 'start');
};
applyInterfacePreferences();
onSettings((key) => {
  if (key === 'blurWatched' || key === 'titleAlign' || key === '*') applyInterfacePreferences();
});

import { HomeView } from './views/home.js';
import { DiscoverView } from './views/discover.js';
import { KidsView } from './views/kids.js';
import { SearchView } from './views/search.js';
import { DetailView } from './views/detail.js';
import { WatchView } from './views/watch.js';
import { LibraryView } from './views/library.js';
import { UpdatesView } from './views/updates.js';
import { SettingsView } from './views/settings.js';
import { ProfileView } from './views/profile.js';
import { CollectionView } from './views/collection.js';
import { MessagesView } from './views/messages.js';
import { RoomsView } from './views/rooms.js';
import { TradesView } from './views/trades.js';
import { ArenaView } from './views/arena.js';
import { TopView } from './views/top.js';
import { AdvertiseView } from './views/advertise.js';
import { AdminView } from './views/admin.js';
import { MoviesView, SeriesView } from './views/films/movies.js';
import { MovieDetailView } from './views/films/mdetail.js';
import { MovieWatchView } from './views/films/mwatch.js';
import { restore, pushStats, staticHost, takeRecovery, account } from './lib/account.js';
import { settings, onSettings, DEFAULT_ACCENT } from './lib/store.js';
import { noteSeen } from './lib/cards.js';
import { verifyCloudSchema } from './lib/cloud.js';
import { beat, markAway } from './lib/presence.js';
import { askAboutAccount, resetSheet } from './components/account.js';
import { leaveForHome } from './lib/domain.js';
import { MAINTENANCE_MODE, mountMaintenance } from './lib/maintenance.js';

/* Mail became a shelf on the profile page. The old /mailbox address stays alive
   for bookmarks and saved links, and does one thing: carries the visitor to
   where the box actually lives now. */
function openProfileMail() {
  setTimeout(() => go('/profile?tab=mail'), 0);
  return h('div.p-muted', {}, t('Opening your profile…'));
}

/* Series detail and watch are the same views as film detail and watch, with the
   type fixed by the route rather than read from a query string. */
const asSeries = (view) => (ctx) =>
  view({
    ...ctx,
    route: { ...ctx.route, query: { ...ctx.route.query, type: 'tv' } },
  });
const SeriesDetailView = asSeries(MovieDetailView);
const SeriesWatchView = asSeries(MovieWatchView);

const ROUTES = [
  { match: /^\/$/, view: HomeView, nav: true },
  { match: /^\/discover$/, view: DiscoverView, nav: true },
  /* The Anime door: the catalogue grid without the film/series split. */
  { match: /^\/anime$/, view: DiscoverView, nav: true },
  { match: /^\/toons$/, view: KidsView, nav: true },
  { match: /^\/kids$/, view: KidsView, nav: true },
  { match: /^\/search$/, view: SearchView, nav: true },
  { match: /^\/library$/, view: LibraryView, nav: true },
  { match: /^\/updates$/, view: UpdatesView, nav: true },
  { match: /^\/top$/, view: TopView, nav: true },
  /* The pitch page the footer link points at. Public, and it reads the same
     data/sponsor.json the banner itself is drawn from. */
  { match: /^\/advertise$/, view: AdvertiseView, nav: true },
  { match: /^\/profile$/, view: ProfileView, nav: true },
  { match: /^\/profile\/[\w-]+$/, view: ProfileView, nav: true },
  { match: /^\/packs$/, view: CollectionView, nav: true },
  { match: /^\/messages$/, view: MessagesView, nav: true },
  { match: /^\/rooms$/, view: RoomsView, nav: true },
  /* Mail moved onto the profile page, so an old bookmark or a saved link lands
     where the box actually lives now instead of on a page that only repeats it. */
  { match: /^\/mailbox$/, view: openProfileMail, nav: true },
  { match: /^\/trades$/, view: TradesView, nav: true },
  { match: /^\/arena$/, view: ArenaView, nav: true },
  { match: /^\/settings$/, view: SettingsView, nav: true },
  { match: /^\/admin$/, view: AdminView, nav: true },
  { match: /^\/anime\/(\d+)/, view: DetailView, nav: true },
  { match: /^\/watch\/(\d+)/, view: WatchView, nav: false },
  { match: /^\/movies$/, view: MoviesView, nav: true },
  { match: /^\/series$/, view: SeriesView, nav: true },
  { match: /^\/movie\/(\d+)/, view: MovieDetailView, nav: true },
  { match: /^\/series\/(\d+)/, view: SeriesDetailView, nav: true },
  { match: /^\/mwatch\/(\d+)/, view: MovieWatchView, nav: false },
  { match: /^\/swatch\/(\d+)/, view: SeriesWatchView, nav: false },
];

const root = () => qs('#view');

/* ---- the site heartbeat -------------------------------------------------
   One stamp per route change and one a minute after that: enough for the admin
   desk to answer "who is here now" without inventing a socket. A session that
   ends withdraws its stamp, so a signed-out tab stops counting at once. */
let lastPulseUser = null;
function pulse(path) {
  const user = account().user;
  if (user) {
    lastPulseUser = user;
    beat(user, path);
    return;
  }
  if (lastPulseUser) {
    markAway(lastPulseUser);
    lastPulseUser = null;
  }
}
if (!MAINTENANCE_MODE) setInterval(() => pulse(parse().path), 60_000);

function applyTheme() {
  /* One-time palette migration. A saved accent is normally the viewer's choice
     and is never touched; but a redesign has to be seen once, or every returning
     browser keeps the colour of the layout it had before. Bumping the revision
     repaints the new default once and then leaves the picker alone again. */
  if (settings.get('themeRev') !== 3) {
    settings.set('accent', DEFAULT_ACCENT);
    settings.set('accentCustom', '');
    settings.set('themeRev', 3);
  }
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
  pulse(route.path);
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
  const idMatch = route.path.match(/^\/(anime|watch|profile|movie|mwatch|series|swatch)\/([^/?#]+)/);
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
 * Home always starts at the very top, showcase flush under the header — no
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
  '': 'Solvn — anime & cartoons in HD',
  discover: 'Discover — Solvn',
  toons: 'Kids Cartoons — Solvn',
  search: 'Search — Solvn',
  library: 'Your Library — Solvn',
  updates: 'Airing Schedule — Solvn',
  top: 'Top 100 — Solvn',
  profile: 'Profile — Solvn',
  packs: 'Card Binder — Solvn',
  messages: 'Messages — Solvn',
  rooms: 'Rooms — Solvn',
  mailbox: 'Mailbox — Solvn',
  trades: 'Trades — Solvn',
  arena: 'Arena — Solvn',
  settings: 'Settings — Solvn',
  admin: 'Admin — Solvn',
  anime: 'Anime — Solvn',
  watch: 'Watch — Solvn',
  movies: 'Movies — Solvn',
  series: 'TV Series — Solvn',
  movie: 'Details — Solvn',
  mwatch: 'Watch — Solvn',
  swatch: 'Watch — Solvn',
  kids: 'Kids Cartoons — Solvn',
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
  if (desc) desc.content = t('Solvn — anime & cartoons in HD. One player, no installs, nothing to pay for.');
  const label = t('Primary navigation');
  for (const id of ['sidenav', 'tabbar']) qs(`#${id}`)?.setAttribute('aria-label', label);
}

/* ---- boot ------------------------------------------------------------ */
/* Maintenance is a hard gate: while the flag is up the router never starts and
   no view mounts, so every address lands on the overlay and the real interface
   below stays untouched. Flip MAINTENANCE_MODE (lib/maintenance.js) to lift it. */
if (MAINTENANCE_MODE) {
  mountMaintenance();
} else {
  applyTheme();
  syncChrome();
  installShortcuts();
  installInterfaceSounds();
  initTilt();

  /* The intro animates itself in CSS over 1.5s; JS lifts the dead node a frame
     after the veil has finished fading. Under reduced motion the whole thing is
     a short fade, so the node goes early rather than holding a still frame.
     `introMs` is also when the interface is worth talking to: the veil sits at
     full opacity until the last quarter of the animation and is layered above
     every sheet, so anything opened before it lifts is spent behind a black
     screen. */
  const splash = qs('#splash');
  const introMs = splash ? (matchMedia('(prefers-reduced-motion: reduce)').matches ? 650 : 1600) : 0;
  const introEnds = Date.now() + introMs;
  if (splash) {
    setTimeout(() => splash.remove(), introMs);
  }

  /* Somebody who reached the site under an address it no longer uses is looking at
     a page that has already told them where Solvn lives and is on its way there.
     The notice owns the screen, so the only thing worth doing here is not spending
     the next two seconds building and fetching a view nobody will read. */
  const leaving = leaveForHome();

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
  /* A session change only swaps the chip and the nav counts — the page is the same,
     except for the heartbeat, which gains or loses a row at the same moment. */
  document.addEventListener('kitsune:account', () => {
    renderNav();
    pulse(parse().path);
    /* A session arriving or leaving is a day of showing up, counted here rather
       than on the binder alone: the card a signed-in day guarantees should not
       depend on which page a member happened to open. */
    noteSeen();
  });

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
    if (document.hidden) return;
    /* A tab left open across 04:00 is still a member who came back the next day,
       and the run should read that way rather than wait for a reload. */
    noteSeen();
    if (!apiDown()) return;
    retryNow();
    mount(parse());
  });

  if (!leaving) {
    startRouter();

    /* The page never waits on the session: the chip repaints itself when the answer
       arrives. Only the pages that are *about* the session are rebuilt, and only if
       somebody deep-linked straight into one of them. The same probe finds out
       whether this copy has a server at all — if it does not, the view is rebuilt
       once so that the controls needing one are taken out rather than left to fail.

       The cloud is asked first, and the session only after it: on the permanent
       domain the project address is compiled in, so whether that database really
       exists is what decides where an account lives — and a sign-in that reaches a
       schema nobody has built yet looks from the outside like a dead button. */
    verifyCloudSchema()
      .catch(() => {})
      .then(restore)
      /* A session this browser cannot read is not a reason to leave the site dead:
         the chain that mounts the first page and wires every button hangs off it,
         so a throw here would look exactly like a Sign in button that does nothing. */
      .catch(() => {})
      .then(() => {
        /* The session is known now, so today can be counted. Idempotent inside a
           card day, silent for a guest, and it never blocks the first paint. */
        noteSeen();
        const { path } = parse();
        if (staticHost() || path === '/profile' || path.startsWith('/profile/')) mount(parse());
        /* An email link that came here to reset a password carries a session that
           exists for no other purpose, so the first thing on screen is the sheet
           that spends it. Nothing else about the page changes. */
        if (takeRecovery()) {
          resetSheet();
          return;
        }
        /* A first visitor is asked about an account once, and only after the answer
           about the session is known — otherwise a returning member would be offered
           a signup form over their own profile. It waits for the intro as well, since
           a sheet under the veil is a sheet nobody sees. A deep link straight into the
           player is the one screen it must not land on: the episode owns that moment. */
        if (path.startsWith('/watch/') || /^\/(movies|series|movie|mwatch|swatch)(\/|$)/.test(path)) return;
        setTimeout(askAboutAccount, Math.max(0, introEnds - Date.now()));
      });
  }
}
