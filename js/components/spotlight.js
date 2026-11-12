/**
 * The Spotlight: one title at a time, its own atmosphere, and its own episodes.
 *
 * It is deliberately not a carousel the visitor drives. There are no dots, no
 * arrows and no swipe: the band advances every five seconds on its own, and the
 * only things on it are the artwork, the title, a short line and two buttons.
 * Anything that would ask the viewer to operate the feature is left out.
 *
 * Three things move together on every slide — the artwork, the palette and the
 * episode collection — because a banner that changes while its episode strip
 * still belongs to the previous show is worse than no banner at all. The
 * collection is therefore cleared the moment the index changes and rebuilt
 * under a token; a late reply for a slide nobody is looking at any more is
 * dropped instead of painting over the current one.
 *
 * Colour comes from the title itself: AniList publishes a dominant
 * `coverImage.color`, so no pixel is ever sampled from cross-origin art (which
 * would taint a canvas) and no palette is invented. The ramp is derived from
 * that hex with the same maths Settings uses, then written to this section only
 * — the chrome stays charcoal, the spotlight changes weather.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { title, plainDescription } from '../lib/util.js';
import { stillImage } from './media.js';
import { episodes as fetchEpisodes } from '../lib/anilist.js';
import { buildEpisodes, resolveEpisodeCount } from '../lib/embed.js';
import { rampFrom } from '../lib/color.js';

const ROTATE_MS = 5000;
const MAX_SLIDES = 8;
const MAX_EPISODES = 12;
const FALLBACK_TINT = '#9ca3af';

/** One slide per show: same id twice, or four seasons of one shonen, is a loop. */
export function pickSpotlight(items) {
  const seenId = new Set();
  const seenBase = new Set();
  const out = [];
  for (const m of items || []) {
    if (!m?.id || seenId.has(m.id)) continue;
    if (!m.bannerImage && !m.coverImage?.extraLarge && !m.coverImage?.large) continue;
    const base = String(m.title?.romaji || m.title?.english || '')
      .toLowerCase()
      .split(':')[0]
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 2)
      .join(' ');
    if (base && seenBase.has(base)) continue;
    seenId.add(m.id);
    if (base) seenBase.add(base);
    out.push(m);
    if (out.length >= MAX_SLIDES) break;
  }
  return out;
}

const tintOf = (m) => m.coverImage?.color || FALLBACK_TINT;

/** Curated art first, banner second, poster last: a still that 404s still lands. */
function episodeArt(m, ep, eager) {
  const cover = m.coverImage?.extraLarge || m.coverImage?.large;
  const img = stillImage([ep.thumb, m.bannerImage, cover], { alt: '', eager });
  return img || h('span.card-ph', {}, icon('film'));
}

function art(m, eager) {
  const cover = m.coverImage?.extraLarge || m.coverImage?.large;
  /* A banner is already widescreen. Without one, a portrait poster stretched
     across the band is a crop, not a composition: the poster is kept whole on
     one side and a blurred copy of it becomes the room around it. */
  const box = h(`div.spot-figure${m.bannerImage ? '' : '.is-portrait'}`);
  if (m.bannerImage) {
    box.append(
      h('img.spot-art', {
        src: m.bannerImage,
        alt: '',
        decoding: 'async',
        fetchpriority: eager ? 'high' : null,
      }),
    );
  } else {
    box.append(
      h('img.spot-ambient', { src: cover, alt: '', 'aria-hidden': 'true', decoding: 'async' }),
      h('img.spot-poster', { src: cover, alt: '', decoding: 'async', fetchpriority: eager ? 'high' : null }),
    );
  }
  box.querySelectorAll('img').forEach((img) =>
    img.addEventListener('error', () => box.classList.add('is-fallback'), { once: true }),
  );
  return box;
}

/* Title, one line of synopsis, two buttons. Nothing else lives on the band. */
function copyFor(m) {
  return [
    h('h2.spot-title', {}, title(m)),
    h('p.spot-desc', {}, plainDescription(m.description, 240) || t('No synopsis for this title yet.')),
    h(
      'div.spot-actions',
      {},
      h('a.spot-btn.spot-play', { href: `#/watch/${m.id}/1` }, icon('play'), h('span', {}, t('Play now'))),
      h('a.spot-btn.spot-more', { href: `#/anime/${m.id}` }, icon('info'), h('span', {}, t('Details'))),
    ),
  ];
}

export function spotlightSkeleton() {
  return h(
    'section.spot.spot-skeleton',
    { 'aria-hidden': 'true' },
    h('div.spot-hero'),
    h('div.spot-eps', {}, h('div.spot-eps-head', {}, h('div.sk.sk--row')), h('div.spot-eps-row', {}, h('div.sk.sk--wide'))),
  );
}

export function spotlight(items, { onCleanup } = {}) {
  const slides = pickSpotlight(items);
  if (!slides.length) return null;

  let index = 0;
  let timer = 0;
  let disposed = false;

  /* Episodes per title, resolved once. Switching back is instant, and a slide
     that is only being prefetched never touches the visible list. */
  const cache = new Map();
  let epToken = 0;

  const stage = h('div.spot-stage');
  const shots = [];
  const copies = [];

  slides.forEach((m, i) => {
    const shot = h('div.spot-shot', { 'aria-hidden': String(i !== 0) }, art(m, i === 0));
    shot.style.setProperty('--tint', tintOf(m));
    stage.append(shot);
    shots.push(shot);

    /* Inactive copies stay mounted so the fade is a transition rather than a
       re-render, but `inert` keeps their links out of the tab order. */
    copies.push(h('div.spot-copy', { 'aria-hidden': String(i !== 0), inert: i !== 0 }, copyFor(m)));
  });

  const copyLayer = h('div.spot-copies', {}, ...copies);

  const epCount = h('span.spot-eps-count');
  const epList = h('div.spot-eps-list', { role: 'list', 'aria-live': 'polite' });
  const epEmpty = h('p.spot-eps-empty', { hidden: true }, t('Episodes are not listed for this title yet.'));
  const epAll = h('a.spot-eps-all', { href: `#/anime/${slides[0].id}` }, t('All episodes'), icon('chevronRight', { cls: 'flip' }));

  const eps = h(
    'div.spot-eps',
    {},
    h('div.spot-eps-head', {}, h('div.spot-eps-heading', {}, h('h3.spot-eps-title', {}, t('Episodes')), epCount), epAll),
    epList,
    epEmpty,
  );

  const body = h('div.spot-body', {}, copyLayer);
  const stageHost = h('div.spot-hero', {}, stage, h('div.spot-scrim'), body);
  const wrap = h('section.spot', { 'aria-roledescription': t('carousel'), 'aria-label': t('Anime spotlight') }, stageHost, eps);

  /* ---- palette ---------------------------------------------------------- */
  function paintPalette(m) {
    const ramp = rampFrom(tintOf(m)) || rampFrom(FALLBACK_TINT);
    const set = (name, value) => wrap.style.setProperty(name, value);
    set('--spot-accent', ramp['--accent']);
    set('--spot-bright', ramp['--accent-text']);
    set('--spot-deep', ramp['--accent-deep']);
    set('--spot-glow', ramp['--accent-glow']);
    set('--spot-wash', ramp['--accent-wash']);
    set('--spot-line', ramp['--accent-line']);
  }

  /* ---- episodes --------------------------------------------------------- */
  function paintEpisodes(m, list, token) {
    if (token !== epToken || disposed) return;
    epList.replaceChildren();
    if (!list.length) {
      epEmpty.hidden = false;
      epCount.textContent = '';
      return;
    }
    epEmpty.hidden = true;
    /* Some titles list a stray special beyond the counted run; never show
       "12 of 9". */
    epCount.textContent = t('{n} of {total}', { n: list.length, total: Math.max(list.length, resolveEpisodeCount(m)) });
    const frag = document.createDocumentFragment();
    list.forEach((ep, i) => {
      const label = ep.title || t('Episode {n}', { n: ep.number });
      frag.append(
        h(
          'a.spot-ep',
          { href: `#/watch/${m.id}/${ep.number}`, role: 'listitem', 'aria-label': `${label} — ${t('Episode {n}', { n: ep.number })}` },
          h(
            'div.spot-ep-art',
            {},
            episodeArt(m, ep, i < 4),
            h('span.spot-ep-num.tnum', {}, String(ep.number).padStart(2, '0')),
            h('span.spot-ep-play', {}, icon('play')),
          ),
          h(
            'div.spot-ep-body',
            {},
            h('p.spot-ep-title.clamp-2', {}, label),
            h('p.spot-ep-meta', {}, m.duration ? t('{n} min', { n: m.duration }) : t('Episode {n}', { n: ep.number })),
          ),
        ),
      );
    });
    epList.append(frag);
  }

  function loadEpisodes(m) {
    const token = ++epToken;
    /* Nothing from the previous title survives the switch — not even for the
       frame the cache lookup takes, and not its count either. */
    epList.replaceChildren();
    epEmpty.hidden = true;
    epCount.textContent = '';

    const cached = cache.get(m.id);
    if (cached) {
      paintEpisodes(m, cached, token);
      return;
    }

    epList.append(
      ...Array.from({ length: 6 }, () =>
        h('div.spot-ep.is-sk', { 'aria-hidden': 'true' }, h('div.spot-ep-art.sk'), h('div.sk.sk--text'), h('div.sk.sk--text.w60')),
      ),
    );

    fetchEpisodes(m.id)
      .then((d) => {
        if (disposed) return;
        const merged = { ...m, ...(d || {}) };
        const list = buildEpisodes(merged, d?.streamingEpisodes || []).slice(0, MAX_EPISODES);
        cache.set(m.id, list);
        paintEpisodes(m, list, token);
      })
      .catch(() => {
        if (token !== epToken || disposed) return;
        epList.replaceChildren();
        epEmpty.hidden = false;
      });
  }

  /** Warm the next title while this one is on screen, so a natural rotation is instant. */
  function prefetch(i) {
    const m = slides[(i + slides.length) % slides.length];
    if (!m || cache.has(m.id)) return;
    fetchEpisodes(m.id)
      .then((d) => {
        if (disposed || !d) return;
        const merged = { ...m, ...d };
        cache.set(m.id, buildEpisodes(merged, d.streamingEpisodes || []).slice(0, MAX_EPISODES));
      })
      .catch(() => {});
  }

  /* ---- slides ----------------------------------------------------------- */
  function show(i) {
    index = (i + slides.length) % slides.length;
    const m = slides[index];
    paintPalette(m);
    shots.forEach((s, n) => {
      s.classList.toggle('is-on', n === index);
      s.setAttribute('aria-hidden', String(n !== index));
    });
    copies.forEach((c, n) => {
      c.classList.toggle('is-on', n === index);
      c.inert = n !== index;
      c.setAttribute('aria-hidden', String(n !== index));
    });
    epAll.setAttribute('href', `#/anime/${m.id}`);
    loadEpisodes(m);
    prefetch(index + 1);
  }

  /* ---- the five-second clock -------------------------------------------- */
  function arm() {
    clearTimeout(timer);
    timer = setTimeout(tick, ROTATE_MS);
  }

  function tick() {
    if (disposed) return;
    /* A hidden tab does not advance, but it must re-arm: returning without a
       new timeout would stop the spotlight for the rest of the visit. */
    if (document.hidden) {
      arm();
      return;
    }
    show(index + 1);
    arm();
  }

  const onVisibility = () => {
    if (document.hidden) {
      clearTimeout(timer);
      return;
    }
    arm();
  };
  document.addEventListener('visibilitychange', onVisibility);

  show(0);
  arm();

  onCleanup?.(() => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return wrap;
}
