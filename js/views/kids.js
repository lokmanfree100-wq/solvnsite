/**
 * Kids Cartoons — Western animation only.
 *
 * The anime catalogue and the cartoon catalogue are different libraries, so
 * this room never asks AniList for a title. Seven shows, their real networks,
 * a short real episode list each, and the same TMDB-id player the series side
 * uses. Every card opens a detail sheet before it streams anything.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet } from '../lib/ui.js';
import { categoryTabs } from '../components/cats.js';

const POSTER = (path) => `https://image.tmdb.org/t/p/w500${path}`;

const SHOWS = [
  {
    id: 387,
    name: 'SpongeBob SquarePants',
    year: '1999',
    network: 'Nickelodeon',
    shelf: ['nick', 'classics'],
    runtime: '22m',
    poster: '/5h0EU2lqBb03dp5vtRuUHJwqzem.jpg',
    overview:
      'SpongeBob is an optimistic sea sponge who lives in a pineapple under the sea and works at the Krusty Krab. His best friend Patrick and his grumpy neighbour Squidward make every ordinary day in Bikini Bottom absurd.',
    episodes: [
      ['Help Wanted', '22m'],
      ['Reef Blower', '11m'],
      ['Tea at the Treedome', '11m'],
      ['Bubblestand', '11m'],
      ['Ripped Pants', '11m'],
      ['Jellyfishing', '11m'],
    ],
  },
  {
    id: 246,
    name: 'Avatar: The Last Airbender',
    year: '2005',
    network: 'Nickelodeon',
    shelf: ['nick', 'modern', 'classics'],
    runtime: '23m',
    poster: '/yaGt4GIutpbXHsv48tWceWg6s56.jpg',
    overview:
      'Aang is the Avatar, the one person who can bend all four elements. Together with Katara, Sokka and Appa, he travels a divided world to master the elements and stop the Fire Nation.',
    episodes: [
      ['The Boy in the Iceberg', '23m'],
      ['The Avatar Returns', '23m'],
      ['The Southern Air Temple', '23m'],
      ['The Warriors of Kyoshi', '23m'],
      ['The King of Omashu', '23m'],
      ['Imprisoned', '23m'],
    ],
  },
  {
    id: 4630,
    name: 'The Fairly OddParents',
    year: '2001',
    network: 'Nickelodeon',
    shelf: ['nick', 'classics'],
    runtime: '22m',
    poster: '/3ryMj7tIvVtiXyI2tLvHYTjOjq4.jpg',
    overview:
      'Timmy Turner has two fairy godparents, Cosmo and Wanda, who grant his wishes. The wishes usually solve one problem and create three much stranger ones in Dimmsdale.',
    episodes: [
      ['The Big Problem', '22m'],
      ['Power Mad', '11m'],
      ['Spaced Out', '11m'],
      ['TransParents', '11m'],
      ['A Wish Too Far', '11m'],
      ['Tiny Timmy', '11m'],
    ],
  },
  {
    id: 2309,
    name: 'Danny Phantom',
    year: '2004',
    network: 'Nickelodeon',
    shelf: ['nick', 'modern'],
    runtime: '22m',
    poster: '/pBUOFBmZLaIxzjDjQP7d3QZrd4w.jpg',
    overview:
      'Danny Fenton becomes half-ghost after an accident in his parents’ laboratory. He uses his powers to protect Amity Park while keeping his double life hidden from everyone but his closest friends.',
    episodes: [
      ['Mystery Meat', '22m'],
      ['Parental Bonding', '22m'],
      ['One of a Kind', '22m'],
      ['Attack of the Killer Garage Sale', '22m'],
      ['Splitting Images', '22m'],
      ['What You Want', '22m'],
    ],
  },
  {
    id: 607,
    name: 'The Powerpuff Girls',
    year: '1998',
    network: 'Cartoon Network',
    shelf: ['classics', 'modern'],
    runtime: '22m',
    poster: '/468mmhMd21pY4Yx0S0woqeEcxtL.jpg',
    overview:
      'Blossom, Bubbles and Buttercup are three superpowered kindergarten girls created in a laboratory. Between school and bedtime, they defend Townsville from monsters, villains and their own siblings.',
    episodes: [
      ['Monkey See, Monkey Do', '22m'],
      ['Insect Inside', '11m'],
      ['Powerpuff Bluff', '11m'],
      ['Buttercrush', '11m'],
      ['Fuzzy Logic', '11m'],
      ['Boogie Frights', '11m'],
    ],
  },
  {
    id: 40075,
    name: 'Gravity Falls',
    year: '2012',
    network: 'Disney Channel',
    shelf: ['modern'],
    runtime: '23m',
    poster: '/tLobFvxvgSLrZ1bglCIipymTj2j.jpg',
    overview:
      'Twins Dipper and Mabel spend the summer with their Great-Uncle Stan in Gravity Falls, Oregon. The town’s tourist trap hides a forest of ciphers, monsters and one very strange journal.',
    episodes: [
      ['Tourist Trapped', '23m'],
      ['The Legend of the Gobblewonker', '23m'],
      ['Headhunters', '23m'],
      ['The Hand That Rocks the Mabel', '23m'],
      ['The Inconveniencing', '23m'],
      ['Dipper vs. Manliness', '23m'],
    ],
  },
  {
    id: 4686,
    name: 'Ben 10',
    year: '2005',
    network: 'Cartoon Network',
    shelf: ['modern', 'classics'],
    runtime: '22m',
    poster: '/eogRp6oAPK0SEvQmCrQ78LTlSdp.jpg',
    overview:
      'Ten-year-old Ben Tennyson finds the Omnitrix, a watch that lets him transform into ten alien heroes. Road trips with Grandpa Max and cousin Gwen become a rescue mission every week.',
    episodes: [
      ['And Then There Were 10', '22m'],
      ['The Krakken', '22m'],
      ['The Alliance', '22m'],
      ['Permanent Retirement', '22m'],
      ['Hunted', '22m'],
      ['Tourist Trap', '22m'],
    ],
  },
];

const SHELVES = [
  { id: '', label: () => t('Everything') },
  { id: 'nick', label: () => t('Nickelodeon') },
  { id: 'classics', label: () => t('Classic cartoons') },
  { id: 'modern', label: () => t('Modern hits') },
];

function openShow(show) {
  sheet({
    heading: show.name,
    sub: `${show.year} · ${show.network} · ${show.runtime}`,
    width: 760,
    render: () =>
      h(
        'div.kids-detail',
        {},
        h('p.kids-detail-copy', {}, show.overview),
        h(
          'div.kids-ep-head',
          {},
          h('h3', {}, t('Episodes')),
          h('span', {}, `${show.episodes.length} ${t('listed')}`),
        ),
        h(
          'div.kids-ep-list',
          {},
          ...show.episodes.map(([title, runtime], i) =>
            h(
              `a.kids-ep${i === 0 ? '.is-first' : ''}`,
              { href: `#/swatch/${show.id}?s=1&e=${i + 1}` },
              h('span.kids-ep-num.tnum', {}, String(i + 1).padStart(2, '0')),
              h('span.kids-ep-title', {}, title),
              h('span.kids-ep-time', {}, runtime),
              h('span.kids-ep-play', {}, icon('play')),
            ),
          ),
        ),
        h(
          'p.kids-detail-note',
          {},
          t('Playback uses the same Solvn player as the rest of the site. Audio and subtitle tracks are listed by the source when it carries them, including Arabic when available.'),
        ),
      ),
  });
}

function card(show) {
  return h(
    'button.kids-card',
    {
      type: 'button',
      'aria-label': `${show.name} — ${show.year}`,
      onclick: () => openShow(show),
    },
    h(
      'span.kids-card-art',
      {},
      h('img', { src: POSTER(show.poster), alt: '', loading: 'lazy', decoding: 'async' }),
      h('span.kids-card-sheen', { 'aria-hidden': 'true' }),
      h('span.kids-card-play', {}, icon('play')),
      h('span.kids-card-net', {}, show.network),
    ),
    h(
      'span.kids-card-body',
      {},
      h('strong.kids-card-title.clamp-2', {}, show.name),
      h('span.kids-card-meta', {}, `${show.year} · ${show.runtime}`),
    ),
  );
}

export function KidsView() {
  const wrap = h('div.page-kids');
  let shelf = '';
  const bar = h('div.filter-bar', { role: 'group', 'aria-label': t('Kids cartoon shelves') });
  const grid = h('div.kids-grid');

  function paint() {
    bar.replaceChildren(
      h('span.badge', {}, icon('tv'), t('Shelves')),
      ...SHELVES.map((s) =>
        h(
          `button.chip${s.id === shelf ? '.is-active' : ''}`,
          {
            type: 'button',
            'aria-pressed': String(s.id === shelf),
            onclick: () => {
              if (s.id === shelf) return;
              shelf = s.id;
              paint();
            },
          },
          s.label(),
        ),
      ),
    );
    const list = SHOWS.filter((show) => !shelf || show.shelf.includes(shelf));
    grid.replaceChildren(...list.map(card));
  }

  paint();

  wrap.append(
    categoryTabs('toons'),
    h(
      'header.page-head',
      {},
      h('div.eyebrow', {}, t('KIDS CARTOONS')),
      h('h1.display', {}, t('Saturday morning, all week')),
      h(
        'p',
        {},
        t('Western animation only: Nickelodeon, Cartoon Network and Disney favourites, from the classics to the modern hits. No anime lives in this room.'),
      ),
      h(
        'div.kids-proof',
        {},
        h('span.badge', {}, icon('shield'), t('No anime')),
        h('span.badge', {}, icon('play'), t('Working streams')),
        h('span.badge', {}, icon('captions'), t('Arabic when the source carries it')),
      ),
    ),
    bar,
    grid,
    h(
      'p.kids-note',
      {},
      t('Every title here opens its own episode list before it plays. Language tracks stay honest: the player lists what the selected source actually declares.'),
    ),
  );

  return wrap;
}
