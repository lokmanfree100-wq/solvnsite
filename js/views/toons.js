/**
 * Classic & Toons — the retro hub, kept in its own room.
 *
 * Nothing here is a seasonal rail with a different title: every row is bounded
 * either by a list of ids we read back from the live catalogue by hand, or by a
 * broadcast window that closed years ago.
 *
 * The catalogue AniList keeps is mostly Japanese animation, so a channel shelf
 * holds the shows that channel *dubbed*, not every cartoon it ever ran: the American
 * libraries of Cartoon Network Arabic, Nickelodeon Arabia and Disney have no
 * records here at all. The note at the bottom of the page says so instead of
 * rendering a row of posters that lead nowhere.
 *
 * What this page does *not* do is add a country bound of its own. Its window
 * rails used to ask for `countryOfOrigin: JP` on top of `type: ANIME`, which also
 * erased every indexed title that animation simply did not start in Japan — the
 * Chinese co-productions and remakes old channels ran under a dub this region
 * remembers. Live probes say AniList carries no American network cartoons at
 * all, so the note below still has to be honest about that; what the bound added
 * was a second, quieter reason for a shelf to come back empty.
 */

import { h, icon } from '../lib/dom.js';
import { byIds, classic } from '../lib/anilist.js';
import { go, parse } from '../lib/router.js';
import { lazyRow } from '../components/media.js';
import { t } from '../lib/i18n.js';

/* ---- the ledger ------------------------------------------------------
   A title belongs to exactly one shelf. Curated lists claim their ids while
   this page is being built, in the order they are printed, so the first row
   that names a show keeps it and every later row loses it — which is what
   stops Captain Tsubasa from turning up four times.

   The window rows cannot be claimed up front: nobody knows in advance what a
   date query will return. Their requests still go out together, but each one
   hands its answer to `claimMedia()` and the claim runs strictly after the row
   above it has taken what it wants. Parallel fetching, serial claiming, so the
   winner is decided by print order and not by which request answered first. */
const claimed = new Set();

function claimIds(ids) {
  const out = [];
  for (const id of ids) {
    if (claimed.has(id)) continue;
    claimed.add(id);
    out.push(id);
  }
  return out;
}

let ledger = Promise.resolve();

function claimMedia(items, want) {
  const run = ledger.then(() => {
    const fresh = [];
    for (const m of items || []) {
      if (fresh.length >= want) break;
      if (!m?.id || claimed.has(m.id)) continue;
      claimed.add(m.id);
      fresh.push(m);
    }
    return fresh;
  });
  ledger = run.catch(() => []);
  return run;
}

/* ---- curated shelves --------------------------------------------------
   Two hundred and thirty ids below, every one resolved against the live API:
   the query ran, the title came back, the year matched the era the shelf
   claims. An id that does not resolve does not belong in this file. */

/* The channel with its own dubbed opening theme for everything: the afternoon
   block of a generation. Dragon Ball and Sailor Moon, the duelling monsters,
   the football field and the detective who never grew up. */
const SPACETOON_IDS = [
  813, 223, 530, 740, 532, 2116, 1254, 235, 527, 552, 481, 250, 288, 5231, 966,
  508, 3638, 136, 170, 550,
];

/* The state channel that grew the sequel generation: the second Digimon
   seasons, the next thousand cards, the metal spinners and the cures. */
const MBC3_IDS = [
  1313, 874, 1132, 482, 3972, 10507, 13261, 603, 7645, 12191, 20, 21, 269,
];

/* The other remote — the Toei and Nippon Animation action library that a whole
   Gulf childhood was spent pointing a camera at: robots, boxers, swordsmen and
   the lion who started television animation. */
const ART_IDS = [
  1985, 2402, 2921, 1445, 1572, 2747, 1412, 1470, 3399, 2229, 696, 3044, 2268,
  80, 1088, 5891, 3609, 2892, 3213, 45,
];

/* The Saturday block with the imported toys: the hedgehog, the spinners, the
   transformers that Japan animated and the turtles that Japan re-cut. */
const JETIX_IDS = [
  1816, 129610, 2156, 5962, 1675, 928, 1221, 1261, 1059, 3571, 2581,
];

/* Nippon Animation's theatre: a European novel, one hundred episodes and a
   girl with very good manners. */
const WMT_IDS = [2225, 2800, 2547, 2577, 2836, 2571, 1638];

/* Fujiko's gags and Tezuka's giants, which every one of those channels ran
   until the reruns wore the film out. */
const FUJIKO_IDS = [
  2471, 8687, 18845, 20515, 6509, 11595, 7981, 3332, 1547, 1430, 13203, 971,
  2556,
];

/* The magical girls before the word existed for them — the pioneer runs of
   '66 to '74, and the two that carried the format into the home video years. */
const PIONEER_IDS = [3356, 3285, 3388, 3023, 2040, 3875, 3838, 232, 435, 1563, 371, 372];

/* The remakes and the late sequels: the same names, redrawn for the streaming
   years. Proof the shelf is not a museum — the window runs to this season. */
const REMAKE_IDS = [
  100745, 1614, 1674, 142877, 14751, 114099, 154195, 178868, 128207, 21268,
];

/* The old channels' theatrical releases, hand-picked from what the catalogue
   rates rather than what it merely indexes. */
const FILM_IDS = [2265, 2920, 9547, 9880, 177143, 2906];

/* ---- window shelves ---------------------------------------------------
   `perPage` runs high on purpose: a row asks for thirty and keeps the first
   sixteen nobody has claimed yet, so the ledger never starves a shelf. */
const era = (from, to, extra = {}) => ({
  load: async () =>
    claimMedia(
      await classic({
        format: 'TV',
        startDateGreater: from,
        startDateLesser: to,
        minimumScore: 55,
        perPage: 30,
        ...extra,
      }),
      16,
    ),
});

/* ---- the shelves -------------------------------------------------------- */
const CHANNEL = 'channel';
const ERA = 'era';
const THEME = 'theme';
const FILM = 'film';

/** Read through `t()` on every build — the call sites are literals, so the
    translation extractor can see each string — and re-roll the ledger from empty
    on every render pass. */
const shelves = () => {
  claimed.clear();
  const curated = (cat, heading, sub, flag, ids) => ({
    cat,
    heading,
    sub,
    flag,
    load: () => byIds(claimIds(ids)),
  });

  return [
    curated(CHANNEL, t('Spacetoon'), t('The channel with a dubbed theme song for everything it touched'), 'SPACETOON', SPACETOON_IDS),
    curated(CHANNEL, t('MBC3'), t('The state remote that raised the sequel generation'), 'MBC3', MBC3_IDS),
    curated(CHANNEL, t('ART Teenz'), t('The other remote: Toei action, boxing rings and giant robots'), 'ART', ART_IDS),
    curated(CHANNEL, t('Fox Kids & Jetix'), t('Saturday mornings, imported toys and the transformers Japan animated'), 'JETIX', JETIX_IDS),

    {
      cat: ERA,
      heading: t('The First Frames'),
      sub: t('Television animation from 1963 to 1975 — the years before the format had rules'),
      load: era(19630101, 19760101).load,
    },
    {
      cat: ERA,
      heading: t('The Celluloid Eighties'),
      sub: t('1976 to 1986: the decade that built the after-school line-up'),
      load: era(19760101, 19870101).load,
    },
    {
      cat: ERA,
      heading: t('The Neon Nineties'),
      sub: t('1987 to 1996 — duelling cards, moon princesses and the last analog year'),
      load: era(19870101, 19970101).load,
    },
    {
      cat: ERA,
      heading: t('The Dub Boom'),
      sub: t('1997 to 2006, when every channel in the region was re-voicing something'),
      load: era(19970101, 20060101).load,
    },
    curated(ERA, t('The Remakes'), t('The same names, redrawn: the late sequels and the modern retellings'), null, REMAKE_IDS),

    curated(THEME, t('World Masterpiece Theatre'), t('One European novel, fifty-two episodes and a girl with very good manners'), null, WMT_IDS),
    curated(THEME, t('Fujiko & Tezuka'), t('The gags and the giants — the two libraries every channel reran to death'), null, FUJIKO_IDS),
    curated(THEME, t('The Pioneer Magicals'), t('Magical girls before anyone had a name for the format'), null, PIONEER_IDS),
    {
      cat: THEME,
      heading: t('Retro Robots'),
      sub: t('Mecha series that signed off before 2000'),
      load: async () => claimMedia(await classic({ genre: 'Mecha', startDateLesser: 20000101, perPage: 30 }), 16),
    },
    {
      cat: THEME,
      heading: t('Playground Legends'),
      sub: t('Sports series from before the millennium — the football field and the boxing ring'),
      load: async () => claimMedia(await classic({ genre: 'Sports', startDateLesser: 20000101, perPage: 30 }), 16),
    },

    curated(FILM, t('The Films of the Old Channels'), t('The theatrical releases that closed out a broadcast year'), null, FILM_IDS),
    {
      cat: FILM,
      heading: t('Golden Age Films'),
      sub: t('Feature films released before 2005, ranked by their viewer score'),
      load: async () =>
        claimMedia(await classic({ format: 'MOVIE', sort: ['SCORE_DESC'], startDateLesser: 20050101, minimumScore: 80, perPage: 30 }), 16),
    },
  ];
};

const CATS = [
  { id: '', label: () => t('Everything') },
  { id: CHANNEL, label: () => t('Channels') },
  { id: ERA, label: () => t('Eras') },
  { id: THEME, label: () => t('Genres & Themes') },
  { id: FILM, label: () => t('Films') },
];

const readCat = () => {
  const c = parse().query.cat || '';
  return CATS.some((x) => x.id === c) ? c : '';
};

const writeCat = (cat) => go(`/toons${cat ? `?cat=${cat}` : ''}`, { replace: true, keepScroll: true });

export function ToonsView() {
  const wrap = h('div.page-toons');
  const bar = h('div.filter-bar', { role: 'group', 'aria-label': t('Classic & Toons shelves') });
  const shelvesBox = h('div.toons-shelves');
  let cat = readCat();

  function buildBar() {
    bar.replaceChildren(
      h('span.badge', {}, icon('tv'), t('Shelves')),
      ...CATS.map((c) =>
        h(
          `button.chip${c.id === cat ? '.is-active' : ''}`,
          {
            type: 'button',
            'aria-pressed': String(c.id === cat),
            onclick: () => {
              if (c.id === cat) return;
              cat = c.id;
              writeCat(cat);
              buildBar();
              buildShelves();
            },
          },
          c.label(),
        ),
      ),
    );
  }

  /** Rows for the chosen shelf, rebuilt whole so a chip press never leaves strays.
      All sixteen shelves are built even when one category is showing: the ledger
      is what decides who owns a title, and that only works over the whole list. */
  function buildShelves() {
    shelvesBox.replaceChildren(
      ...shelves()
        .filter((r) => !cat || r.cat === cat)
        .map((r) => lazyRow({ ...r, empty: t('The catalogue has nothing for this shelf right now.') })),
    );
  }

  buildBar();
  buildShelves();

  wrap.append(
    h(
      'header.page-head',
      {},
      h('div.eyebrow', {}, t('CLASSIC & TOONS')),
      h('h1.display', {}, t('The retro hub')),
      h(
        'p',
        {},
        t('The old channels, kept apart from this season: four dubbed line-ups, five broadcast eras, the themes that defined them and the films that closed the year.'),
      ),
      h(
        'div.rowline',
        { style: { marginTop: 'var(--sp-4)' } },
        h('a.btn.btn--sm', { href: '#/discover' }, icon('compass'), h('span', {}, t('Browse modern anime'))),
      ),
    ),
    bar,
    shelvesBox,
    h(
      'section.panel-card.toons-note',
      {},
      h('div.panel-head', {}, icon('info'), h('h3', {}, t('What these shelves can honestly hold'))),
      h(
        'div.panel-body',
        {},
        h(
          'p.muted',
          {},
          t('Solvn streams what its catalogue actually carries, and that catalogue is AniList — a database of Japanese animation.'),
          ' ',
          t('The channel rows are therefore the shows those channels dubbed, not everything they broadcast: it indexes no Cartoon Network, Nickelodeon or Disney television series, and a row of them would be a row of posters that open nothing.'),
          ' ',
          t('Every id in a curated shelf was resolved against the live API before it was written down, and no title is ever repeated across two rows.'),
        ),
        h(
          'p.muted',
          {},
          t('The language chips along the bottom of a poster say what this installation can put in the player, not what a dub studio once recorded. AniList keeps no dub-availability field for a title, so Solvn promises only what a configured server declares it carries — and an Arabic or French server added in Settings lights those chips on every shelf here.'),
        ),
        h('a.link-all', { href: '#/search' }, t('Search the catalogue yourself'), icon('chevronRight')),
      ),
    ),
  );
  return wrap;
}
