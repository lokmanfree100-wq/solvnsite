/**
 * The cinematic side-dock showcase.
 *
 * One full-bleed backdrop, the title and actions on the left, and exactly three
 * preview cards in a vertical glass dock on the right. The hero rotates through
 * a small editorial set every few seconds; the dock belongs to whichever title
 * is on screen and scrolls through its six preview cards, one card per arrow
 * press. Nothing is blurred over the artwork: the glass is only in the controls
 * and the dock, where it has an edge to sit against.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { inList, toggleList } from '../lib/store.js';
import { inMovieWatchlist, toggleMovieWatchlist } from '../lib/tmdb.js';

const ART = (path) => `https://image.tmdb.org/t/p/original${path}`;

const animeMedia = (slide) => ({
  id: slide.id,
  title: { romaji: slide.name, english: slide.name },
  coverImage: { large: slide.cover || null, extraLarge: slide.cover || null },
  bannerImage: slide.backdrop,
  format: 'TV',
  episodes: slide.episodes,
  seasonYear: slide.year,
});

const episodeCards = (images, titles, runtime, playBase) =>
  titles.map((title, i) => ({
    title,
    runtime,
    label: String(i + 1).padStart(2, '0'),
    art: ART(images[i % images.length]),
    href: `${playBase}${i + 1}`,
  }));

/* ---------- anime: Death Note leads, then two related top titles ---------- */

const DEATH_NOTE_CARDS = episodeCards(
  [
    '/z8IPicmEKXUO4I2UDdMEqw7RqOE.jpg',
    '/mOlEbXcb6ufRJKogI35KqsSlCfB.jpg',
    '/msyFkFfEMuHpKvq7cf4NnyugbXP.jpg',
    '/2VDG1hQxtHicTHHXFUuRmqta2CI.jpg',
    '/ohQf29xrgnC0uE5ABzKVsqEETDM.jpg',
    '/sFXiJuEPMAoHxri1gw1B0JimSKF.jpg',
  ],
  ['Rebirth', 'Confrontation', 'Dealings', 'Pursuit', 'Tactics', 'Unraveling'],
  '23m',
  '#/watch/1535/',
);

const AOT_CARDS = episodeCards(
  [
    '/2b0s0iMNl9CgrCMz0VGKlMw3vZw.jpg',
    '/3T5N0Fg6hE3lE6JHJJPKrjtdI4j.jpg',
    '/uACJw45EEkB5mfFw4SgMtgZgBBJ.jpg',
    '/aok7IhrbA83josNz9Dqh8tNA0Ao.jpg',
    '/lTDtH9YnFWJdwOgNuB4dUAzGOQl.jpg',
    '/myryZe4g6PrzGIfOSn9IYmvQ88H.jpg',
  ],
  [
    'To You, in 2000 Years',
    'That Day',
    'A Dim Light Amid Despair',
    'The Night of the Closing Ceremony',
    'First Battle',
    'The World the Girl Saw',
  ],
  '24m',
  '#/watch/16498/',
);

const NARUTO_CARDS = episodeCards(
  [
    '/iUfQjQ034DXnMsKfDmTfloigVuv.jpg',
    '/deng9qeymn2LTdkXLMpMu68ILn0.jpg',
    '/aUwCZ85zB1b39xZZOomVynuHewm.jpg',
    '/fV99ovmaQwZkLGh26NCDZM7Qvho.jpg',
    '/fLZgeYlrhkN7klayFTocllAPm9Y.jpg',
    '/dzV3wgIytzdiZfO9bWGs3ZVfVqN.jpg',
  ],
  [
    'Homecoming',
    'The Akatsuki Makes Its Move',
    'The Results of Training',
    'The Jinchuriki of the Sand',
    'The Kazekage Stands Tall',
    'Mission Cleared',
  ],
  '23m',
  '#/watch/1735/',
);

const ANIME_SLIDES = [
  {
    kind: 'anime',
    id: 1535,
    name: 'Death Note',
    year: '2006',
    episodes: 37,
    kicker: '2006 · 37 episodes · Psychological mystery',
    overview:
      'A brilliant student finds a notebook that kills anyone whose name is written inside. What begins as justice becomes a duel of minds against the world’s greatest detective.',
    backdrop: ART('/mRwV4W2BAEpte7xlawJP4fsBpmS.jpg'),
    play: '#/watch/1535/1',
    detail: '#/anime/1535',
    cards: DEATH_NOTE_CARDS,
    dockLabel: 'Episodes',
  },
  {
    kind: 'anime',
    id: 16498,
    name: 'Attack on Titan',
    year: '2013',
    episodes: 25,
    kicker: '2013 · 25 episodes · Dark fantasy',
    overview:
      'Humanity survives behind enormous walls until a Titan breaches them. Eren Yeager joins the fight to reclaim the world beyond the wall and uncover what the Titans really are.',
    backdrop: ART('/rqbCbjB19amtOtFQbb3K2lgm2zv.jpg'),
    play: '#/watch/16498/1',
    detail: '#/anime/16498',
    cards: AOT_CARDS,
    dockLabel: 'Episodes',
  },
  {
    kind: 'anime',
    id: 1735,
    name: 'Naruto Shippuden',
    year: '2007',
    episodes: 500,
    kicker: '2007 · 500 episodes · Ninja adventure',
    overview:
      'Naruto returns after years of training to face the Akatsuki, protect the Hidden Leaf, and chase the promise he made to bring Sasuke home.',
    backdrop: ART('/z0YhJvomqedHF85bplUJEotkN5l.jpg'),
    play: '#/watch/1735/1',
    detail: '#/anime/1735',
    cards: NARUTO_CARDS,
    dockLabel: 'Episodes',
  },
];

/* ---------- series: The Mentalist leads the procedural set --------------- */

const MENTALIST_CARDS = episodeCards(
  [
    '/rJFqKcmMSttdNP58l0dVzY2NcTA.jpg',
    '/eUg803qy6luwe8Rys1PkDTw629C.jpg',
    '/ov0WjAg0CclTDLBPy36nBiJ1fN5.jpg',
    '/jh9YpYaG1be7FOtBUxkLTIkhQHI.jpg',
    '/1mOt9QtVJAAeFD4mF33Bpr2Msv7.jpg',
    '/9ln4NNAE3iIpjxU84AF8ED1mnyv.jpg',
  ],
  ['Pilot', 'Red Hair and Silver Tape', 'Red Tide', 'Ladies in Red', 'Redwood', 'Red Handed'],
  '43m',
  '#/swatch/5920?s=1&e=',
);

const MONK_CARDS = episodeCards(
  [
    '/dMY7XUfEAK0Rl8hsgc8ufEOaiZ2.jpg',
    '/sqtSI7uHhFSCvTx60pdqPXGhYCF.jpg',
    '/zUNM4dhtozyucdMlz0oZbZ8CgyH.jpg',
    '/gZ1wXDLWyWSndXwZFhfHf9NxG20.jpg',
    '/rAuQB909278cC2rRoTebhrhFSRY.jpg',
    '/j7KQSiIWq3heT9OuUfOYDF3QCot.jpg',
  ],
  [
    'Mr. Monk and the Candidate',
    'Mr. Monk and the Psychic',
    'Mr. Monk Meets Dale the Whale',
    'Mr. Monk Goes to the Carnival',
    'Mr. Monk Goes to the Asylum',
    'Mr. Monk and the Billionaire Mugger',
  ],
  '43m',
  '#/swatch/1695?s=1&e=',
);

const CASTLE_CARDS = episodeCards(
  [
    '/A7r4EHJVQRmT6qzKQvIEMLAKdrM.jpg',
    '/cA6zKWk2DbLoY44W4IWwAw2prdR.jpg',
    '/3OzfOlqluvV7KwAu1Q9hApf5HbK.jpg',
    '/15AQn2AOzHXnCm2H6ieXSFSBS5b.jpg',
    '/aCcHmpiBEKrl2787Kke5MjCmAaZ.jpg',
    '/srCbdUKXdOZdk1eqQ9YOYRel1jQ.jpg',
  ],
  ['Flowers for Your Grave', 'Nanny McDead', 'Hedge Fund Homeboys', 'Hell Hath No Fury', 'A Chill Goes Through Her Veins', 'Always Buy Retail'],
  '43m',
  '#/swatch/1419?s=1&e=',
);

const SERIES_SLIDES = [
  {
    kind: 'tv',
    id: 5920,
    name: 'The Mentalist',
    year: '2008',
    episodes: 22,
    kicker: '2008 · Crime drama · 7 seasons',
    overview:
      'Patrick Jane, a former celebrity psychic, uses razor-sharp observation to solve crimes with the California Bureau of Investigation while hunting the killer who took his family.',
    backdrop: ART('/kAgork03BAj6Q1NBrsWh4ppK0yi.jpg'),
    play: '#/swatch/5920?s=1&e=1',
    detail: '#/series/5920',
    cards: MENTALIST_CARDS,
    dockLabel: 'Episodes',
  },
  {
    kind: 'tv',
    id: 1695,
    name: 'Monk',
    year: '2002',
    episodes: 16,
    kicker: '2002 · Detective comedy-drama · 8 seasons',
    overview:
      'Adrian Monk is a brilliant detective whose obsessive-compulsive disorder makes ordinary life impossible. His old assistant Sharona helps him work the cases nobody else can close.',
    backdrop: ART('/xUkFWJUXpYccVc5jZgdy0RGjjvU.jpg'),
    play: '#/swatch/1695?s=1&e=1',
    detail: '#/series/1695',
    cards: MONK_CARDS,
    dockLabel: 'Episodes',
  },
  {
    kind: 'tv',
    id: 1419,
    name: 'Castle',
    year: '2009',
    episodes: 10,
    kicker: '2009 · Crime mystery · 8 seasons',
    overview:
      'Novelist Richard Castle shadows NYPD detective Kate Beckett for research. His imagination and her discipline turn every murder into a partnership neither of them expected.',
    backdrop: ART('/nU2CJaoY9wFKzvgMJWLf26XGr3x.jpg'),
    play: '#/swatch/1419?s=1&e=1',
    detail: '#/series/1419',
    cards: CASTLE_CARDS,
    dockLabel: 'Episodes',
  },
];

/* ---------- movies: the Resident Evil collection leads ------------------ */

const RE_CARDS = [
  { title: 'Resident Evil', runtime: '1h 40m', label: '01', art: ART('/1qmqIdPOX2aFfT9BSAfJr5rAbt6.jpg'), href: '#/mwatch/1576' },
  { title: 'Apocalypse', runtime: '1h 34m', label: '02', art: ART('/2FKLlIR8RFeIFpgTLLPniyAd3mi.jpg'), href: '#/mwatch/1577' },
  { title: 'Extinction', runtime: '1h 35m', label: '03', art: ART('/1NnxcFwUNSKN3jnnKeQojB1bYti.jpg'), href: '#/mwatch/7737' },
  { title: 'Afterlife', runtime: '1h 37m', label: '04', art: ART('/3MSYCvckKzJ8Fhp4eYHVInNomKE.jpg'), href: '#/mwatch/35791' },
  { title: 'Retribution', runtime: '1h 36m', label: '05', art: ART('/1uLVyo7Eke8Skc2DidfrHqjAOi1.jpg'), href: '#/mwatch/71679' },
  { title: 'The Final Chapter', runtime: '1h 47m', label: '06', art: ART('/24bqa26Cu7IJ2ByrMj98WYYzaPN.jpg'), href: '#/mwatch/173897' },
];

const MOVIE_SLIDES = [
  {
    kind: 'movie',
    id: 1423191,
    name: 'Resident Evil',
    year: '2026',
    kicker: '2026 · Film · 1h 34m · Horror',
    overview:
      'Medical courier Bryan unwittingly finds himself fighting for survival as one fateful, horrifying night collapses around him in chaos.',
    backdrop: ART('/3icyRAqgakNcQn6aDVz9libFmBA.jpg'),
    play: '#/mwatch/1423191',
    detail: '#/movie/1423191',
    posterPath: '/gAgWJhUSQWCgtKR8170nMkYlBda.jpg',
    cards: RE_CARDS,
    dockLabel: 'The collection',
  },
  {
    kind: 'movie',
    id: 1576,
    name: 'Resident Evil',
    year: '2002',
    kicker: '2002 · Film · 1h 40m · Horror',
    overview:
      'A security team enters an underground laboratory after a viral outbreak. Alice wakes with no memory and a lethal facility closing around her.',
    backdrop: ART('/1qmqIdPOX2aFfT9BSAfJr5rAbt6.jpg'),
    play: '#/mwatch/1576',
    detail: '#/movie/1576',
    posterPath: '/1qmqIdPOX2aFfT9BSAfJr5rAbt6.jpg',
    cards: RE_CARDS,
    dockLabel: 'The collection',
  },
  {
    kind: 'movie',
    id: 1577,
    name: 'Resident Evil: Apocalypse',
    year: '2004',
    kicker: '2004 · Film · 1h 34m · Horror',
    overview:
      'The outbreak escapes Raccoon City. Alice joins a small group of survivors trying to reach the last evacuation route before the city is sealed for good.',
    backdrop: ART('/2FKLlIR8RFeIFpgTLLPniyAd3mi.jpg'),
    play: '#/mwatch/1577',
    detail: '#/movie/1577',
    posterPath: '/2FKLlIR8RFeIFpgTLLPniyAd3mi.jpg',
    cards: RE_CARDS,
    dockLabel: 'The collection',
  },
];

export const CINEMATIC_FEATURED = {
  anime: ANIME_SLIDES,
  tv: SERIES_SLIDES,
  movie: MOVIE_SLIDES,
};

const featureId = (kind) => (kind === 'anime' ? 'anime' : kind);

function myListButton(kind, slide) {
  let active =
    kind === 'anime'
      ? Boolean(inList(slide.id))
      : inMovieWatchlist(kind, slide.id);
  const label = () => (active ? t('In My List') : t('My List'));
  const btn = h(
    'button.cine-btn.cine-mine',
    { type: 'button', class: active ? 'is-on' : null, 'aria-pressed': String(active) },
    icon(active ? 'check' : 'plus'),
    h('span', {}, label()),
  );
  btn.addEventListener('click', () => {
    if (kind === 'anime') {
      active = toggleList(animeMedia(slide), 'watching');
    } else {
      active = toggleMovieWatchlist({
        type: kind,
        id: slide.id,
        title: slide.name,
        posterPath: slide.posterPath || null,
      });
    }
    btn.classList.toggle('is-on', active);
    btn.setAttribute('aria-pressed', String(active));
    btn.replaceChildren(icon(active ? 'check' : 'plus'), h('span', {}, label()));
    toast(
      active
        ? t('Added “{title}” to My List', { title: slide.name })
        : t('Removed “{title}” from My List', { title: slide.name }),
      { iconName: 'bookmark' },
    );
  });
  return btn;
}

function copyFor(kind, slide) {
  return h(
    'div.cine-copy.is-in',
    { key: `${kind}:${slide.id}` },
    h('p.cine-kicker', {}, slide.kicker),
    h('h2.cine-title', {}, slide.name),
    h('p.cine-desc', {}, slide.overview),
    h(
      'div.cine-actions',
      {},
      h('a.cine-btn.cine-play', { href: slide.play }, icon('play'), h('span', {}, t('Play'))),
      myListButton(kind, slide),
      h('a.cine-btn.cine-more', { href: slide.detail }, icon('info'), h('span', {}, t('Details'))),
    ),
  );
}

function dockCard(card) {
  return h(
    'a.cine-card',
    {
      href: card.href,
      role: 'listitem',
      'aria-label': `${card.title} — ${card.runtime}`,
      target: card.external ? '_blank' : null,
      rel: card.external ? 'noreferrer' : null,
    },
    h(
      'span.cine-card-art',
      {},
      h('img', { src: card.art, alt: '', decoding: 'async', loading: 'lazy' }),
      h('span.cine-card-shade', { 'aria-hidden': 'true' }),
      h('span.cine-card-play', {}, icon('play')),
    ),
    h('span.cine-card-num.tnum', {}, card.label),
    h('span.cine-card-time', {}, card.runtime),
    h(
      'span.cine-card-copy',
      {},
      h('strong.cine-card-title.clamp-2', {}, card.title),
      h('span.cine-card-meta', {}, t('Watch now')),
    ),
  );
}

export function cinematicShowcase(kind = 'anime', { onCleanup } = {}) {
  const slides = CINEMATIC_FEATURED[kind] || CINEMATIC_FEATURED.anime;
  const key = featureId(kind);
  let active = 0;
  let disposed = false;
  let timer = 0;
  let paused = false;

  const stage = h('div.cine-stage');
  const shots = slides.map((slide, i) =>
    h(
      `div.cine-shot${i === 0 ? '.is-on' : ''}`,
      {},
      h('img', {
        src: slide.backdrop,
        alt: '',
        decoding: i === 0 ? 'sync' : 'async',
        fetchpriority: i === 0 ? 'high' : 'low',
        loading: i === 0 ? 'eager' : 'lazy',
      }),
    ),
  );
  stage.append(...shots);

  const copySlot = h('div.cine-copy-slot', {}, copyFor(kind, slides[0]));
  const dots = h('div.cine-dots', { role: 'tablist', 'aria-label': t('Featured titles') });
  const dotButtons = slides.map((slide, i) =>
    h(
      `button.cine-dot${i === 0 ? '.is-on' : ''}`,
      {
        type: 'button',
        role: 'tab',
        'aria-selected': String(i === 0),
        'aria-label': slide.name,
        onclick: () => {
          goTo(i);
          restart();
        },
      },
    ),
  );
  dots.append(...dotButtons);

  const dockList = h('div.cine-dock-list', { role: 'list' });
  const dockTitle = h('strong.cine-dock-title', {}, slides[0].dockLabel || t('Episodes'));
  const dockPrev = h(
    'button.cine-dock-btn.is-prev',
    { type: 'button', 'aria-label': t('Previous preview'), title: t('Previous preview') },
    icon('chevronUp'),
  );
  const dockNext = h(
    'button.cine-dock-btn',
    { type: 'button', 'aria-label': t('Next preview'), title: t('Next preview') },
    icon('chevronDown'),
  );

  const dock = h(
    'aside.cine-dock',
    { 'aria-label': t('Previews') },
    h(
      'header.cine-dock-head',
      {},
      h('div.cine-dock-label', {}, h('span.cine-dock-eyebrow', {}, t('Now featured')), dockTitle),
    ),
    h('div.cine-dock-viewport', {}, dockList),
    h('div.cine-dock-foot', {}, dockPrev, dockNext),
  );

  const section = h(
    `section.cine-spot.cine-spot--${key}`,
    { 'aria-label': t('Featured title') },
    h('div.cine-hero', {}, stage, h('div.cine-scrim'), h('div.cine-body', {}, copySlot, dots), dock),
  );

  function paintDock() {
    const slide = slides[active];
    dockTitle.textContent = slide.dockLabel || t('Episodes');
    dockList.replaceChildren(...slide.cards.map(dockCard));
    dockList.scrollTop = 0;
    requestAnimationFrame(updateDock);
  }

  function updateDock() {
    if (disposed) return;
    const max = dockList.scrollHeight - dockList.clientHeight;
    const pos = dockList.scrollTop;
    dockPrev.disabled = pos <= 2;
    dockNext.disabled = max <= 2 || pos >= max - 2;
  }

  function nudgeDock(dir) {
    const card = dockList.querySelector('.cine-card');
    const gap = 10;
    const step = (card?.getBoundingClientRect().height || 140) + gap;
    dockList.scrollTo({
      top: dockList.scrollTop + dir * step,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setTimeout(updateDock, 320);
  }

  dockPrev.addEventListener('click', () => nudgeDock(-1));
  dockNext.addEventListener('click', () => nudgeDock(1));
  dockList.addEventListener('scroll', updateDock, { passive: true });
  window.addEventListener('resize', updateDock);

  function goTo(index) {
    if (disposed || index === active) return;
    active = (index + slides.length) % slides.length;
    shots.forEach((shot, i) => shot.classList.toggle('is-on', i === active));
    dotButtons.forEach((dot, i) => {
      dot.classList.toggle('is-on', i === active);
      dot.setAttribute('aria-selected', String(i === active));
    });
    copySlot.replaceChildren(copyFor(kind, slides[active]));
    paintDock();
  }

  function nextSlide() {
    goTo(active + 1);
  }

  function stop() {
    clearTimeout(timer);
    timer = 0;
  }

  function schedule() {
    stop();
    if (disposed || paused || matchMedia('(prefers-reduced-motion: reduce)').matches || slides.length < 2) return;
    timer = setTimeout(() => {
      nextSlide();
      schedule();
    }, 6500);
  }

  function restart() {
    schedule();
  }

  const pause = () => {
    paused = true;
    stop();
  };
  const resume = () => {
    paused = false;
    schedule();
  };

  section.addEventListener('pointerenter', pause);
  section.addEventListener('pointerleave', resume);
  section.addEventListener('focusin', pause);
  section.addEventListener('focusout', (event) => {
    if (!section.contains(event.relatedTarget)) resume();
  });
  const onVisibility = () => {
    if (document.hidden) stop();
    else schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);

  paintDock();
  requestAnimationFrame(updateDock);
  schedule();

  onCleanup?.(() => {
    disposed = true;
    stop();
    section.removeEventListener('pointerenter', pause);
    section.removeEventListener('pointerleave', resume);
    document.removeEventListener('visibilitychange', onVisibility);
    dockList.removeEventListener('scroll', updateDock);
    window.removeEventListener('resize', updateDock);
  });

  return section;
}

export const animeShowcase = (opts) => cinematicShowcase('anime', opts);
export const movieShowcase = (opts) => cinematicShowcase('movie', opts);
export const seriesShowcase = (opts) => cinematicShowcase('tv', opts);
