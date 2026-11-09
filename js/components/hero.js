/**
 * Spotlight — one banner, both halves of the site.
 *
 * The card carries facts and nothing else: the poster in the corner, the title,
 * the year, the kind, the score and up to three genres. No synopsis, no
 * alternate title, no episode count. A banner is a decision; the detail page is
 * the read, and on a phone the paragraph was the difference between a banner and
 * a wall.
 *
 * It advances on its own every 5s with a crossfade, and it also answers to the
 * 44px arrows and the dots. The timer is polite: it holds while a viewer is
 * pointing at the banner, holding a finger on it or tabbing through it, it holds
 * while the tab is hidden, and it never runs at all under
 * `prefers-reduced-motion`. It is torn down through the view's `onCleanup`, so a
 * route change cannot leave a phantom interval repainting a detached node.
 *
 * Vertical scrolling, the wheel and swipes belong to the page — nothing here
 * captures them.
 */

import { h, icon } from '../lib/dom.js';
import { title, formatLabel, yearOf, scoreLabel } from '../lib/util.js';
import { t, genre } from '../lib/i18n.js';
import { nameOf, typeOf, yearOf as filmYear, rating, poster as filmPoster, backdrop as filmBackdrop } from '../lib/tmdb.js';
import { sfx } from '../lib/sounds.js';

const MAX_SLIDES = 12;
const ROTATE_MS = 5000;
/* A touch longer than --t-slow (420ms) so an outgoing slide is only dropped
   once its fade-out has definitely finished — or, if `transitionend` never
   arrives, once this fallback timer does. */
const FADE_OUT_MS = 900;

/* ---- the two adapters ----------------------------------------------------
   AniList and TMDB name the same five facts differently and link to different
   players. Everything below this line reads one shape, so the banner cannot
   grow a second layout for the film half. `key` is stamped with the source
   because the two databases number their titles in separate sequences. */

/** An AniList media row. `id` stays on the pick: the page's anime de-dupe queue
    claims by it, so a spotlight title cannot reappear in a rail below. */
export function animePick(m) {
  const bits = [t('Anime')];
  const f = formatLabel(m.format);
  if (f) bits.push(f);
  return {
    key: `anilist:${m.id}`,
    id: m.id,
    source: 'anime',
    name: title(m),
    year: yearOf(m) ? String(yearOf(m)) : '',
    kind: bits.join(' · '),
    score: scoreLabel(m.averageScore),
    genres: (m.genres || []).slice(0, 3).map((g) => ({
      label: genre(g),
      href: `#/discover?genre=${encodeURIComponent(g)}`,
    })),
    poster: m.coverImage?.extraLarge || m.coverImage?.large || '',
    backdrop: m.bannerImage || '',
    watch: `#/watch/${m.id}/1`,
    detail: `#/anime/${m.id}`,
  };
}

/** A TMDB row. Shelf cards carry no genres, so `genres` may be filled in later
    from the title's own detail row — the pick is still complete without it. */
export function filmPick(d, type, genres = null) {
  const kind = type || typeOf(d);
  const list = genres || d.genres || [];
  return {
    key: `tmdb:${kind}:${d.id}`,
    id: d.id,
    media_type: kind,
    source: 'film',
    name: nameOf(d),
    year: filmYear(d),
    kind: kind === 'tv' ? t('Series') : t('Film'),
    score: d.vote_average ? rating(d.vote_average) : null,
    genres: list.slice(0, 3).map((g) => ({
      label: t(g.name),
      href: `#/movies?type=${kind}&genre=${g.id}`,
    })),
    poster: filmPoster(d.poster_path, 'w500'),
    backdrop: filmBackdrop(d.backdrop_path, 'w1280') || '',
    watch: kind === 'tv' ? `#/mwatch/${d.id}?type=tv&s=1&e=1` : `#/mwatch/${d.id}?type=movie`,
    detail: `#/movie/${d.id}?type=${kind}`,
  };
}

/** Fisher-Yates: a fresh order and a fresh opening frame on every visit. */
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hero(items, { onCleanup } = {}) {
  const slides = shuffle(items.filter((p) => p.poster || p.backdrop)).slice(0, MAX_SLIDES);
  if (!slides.length) return h('div');

  const reduceQ = matchMedia('(prefers-reduced-motion: reduce)');

  let index = 0;
  let current = null;
  let timer = 0;
  let hovering = false;
  let focused = false;
  let touching = false;

  const stage = h('div.hero');
  const dots = h('div.hero-dots', { role: 'tablist', 'aria-label': t('Featured titles') });

  slides.forEach((p, i) =>
    dots.append(
      h('button', {
        role: 'tab',
        type: 'button',
        'aria-selected': i === 0 ? 'true' : 'false',
        'aria-label': p.name,
        onclick: () => go(i),
      }),
    ),
  );

  function content(p) {
    const bits = [];
    if (p.year) bits.push(h('span.tnum', {}, p.year));
    if (p.kind) bits.push(h('span', {}, p.kind));
    if (p.score) bits.push(h('span.hero-score', {}, icon('star'), h('span.tnum', {}, p.score)));

    return h(
      'div.hero-content',
      {},
      /* Poster and title are flex siblings, so the corner art can never sit on
         top of the words at any width — the row is as tall as whichever of the
         two is taller, and the stage is sized from that. */
      h(
        'div.hero-head',
        {},
        thumb(p),
        h(
          'div.hero-heading',
          {},
          h('h2.hero-title.display.clamp-2', {}, p.name),
          h('div.hero-meta', {}, ...bits.flatMap((bit, i) => (i ? [h('span.sep', {}, '·'), bit] : [bit]))),
        ),
      ),
      p.genres.length
        ? h('div.hero-genres', {}, ...p.genres.map((g) => h('a.hero-chip', { href: g.href }, g.label)))
        : null,
      h(
        'div.hero-actions',
        {},
        h('a.btn.btn--primary.btn--lg', { href: p.watch }, icon('play'), h('span', {}, t('Start watching'))),
        h('a.btn.btn--glass.btn--lg', { href: p.detail }, icon('info'), h('span', {}, t('Details'))),
        p.onTrailer
          ? h(
              'button.btn.btn--glass.btn--lg.hero-trailer',
              { type: 'button', 'aria-label': t('Trailer'), onclick: p.onTrailer },
              icon('play'),
              h('span', {}, t('Trailer')),
            )
          : null,
      ),
      // The dots element is reused across slides; appending it moves the node.
      h('div.hero-foot', {}, dots),
    );
  }

  /** The corner poster. A missing or broken file leaves the backdrop carrying
      the frame on its own rather than an empty box beside the title. */
  function thumb(p) {
    if (!p.poster) return null;
    const img = h('img.hero-thumb', {
      src: p.poster,
      alt: '',
      decoding: 'async',
      loading: 'lazy',
      fetchpriority: null,
    });
    img.addEventListener('error', () => img.remove(), { once: true });
    return img;
  }

  /** A poster stretched across a wide stage crops to a face and a shoulder, so
      without a banner the poster is blurred into the stage instead and the sharp
      copy of it stays in the corner. A banner that 404s falls to the same
      treatment rather than leaving an empty frame. */
  function art(p, eager) {
    const box = h('div.hero-art');
    const blurred = () => {
      box.classList.add('is-fallback');
      const img = p.poster
        ? h('img.hero-blur', { src: p.poster, alt: '', decoding: 'async', fetchpriority: eager ? 'high' : null })
        : null;
      img?.addEventListener('error', () => img.remove(), { once: true });
      box.replaceChildren(...(img ? [img] : []), h('div.hero-scrim'));
    };
    if (!p.backdrop) {
      blurred();
      return box;
    }
    const banner = h('img.hero-banner', {
      src: p.backdrop,
      alt: '',
      decoding: 'async',
      fetchpriority: eager ? 'high' : null,
    });
    banner.addEventListener('error', blurred, { once: true });
    box.append(banner, h('div.hero-scrim'));
    return box;
  }

  function show(i, { animate = true } = {}) {
    index = (i + slides.length) % slides.length;
    const p = slides[index];
    const next = h('div.hero-slide', {}, art(p, index === 0), content(p));
    const lead = next.querySelector('.hero-thumb');
    if (lead && index === 0) {
      lead.loading = 'eager';
      lead.setAttribute('fetchpriority', 'high');
    }

    if (!animate || reduceQ.matches) {
      next.classList.add('is-instant', 'is-in');
      stage.replaceChildren(next);
      current = next;
    } else {
      /* A real crossfade: the outgoing slide is left mounted (absolute over the
         same footprint, so no layout shift) while the newcomer fades up over
         it, then drops out once its fade has landed. */
      const leaving = current;
      leaving?.classList.remove('is-in');
      stage.append(next);
      void next.offsetWidth; // reflow so the transition starts from opacity 0
      requestAnimationFrame(() => next.classList.add('is-in'));
      current = next;
      if (leaving) {
        const drop = () => leaving.remove();
        leaving.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, FADE_OUT_MS); // safety net; a repeat remove() is a no-op
      }
    }

    [...dots.children].forEach((d, n) => d.setAttribute('aria-selected', String(n === index)));
  }

  /* Manual choices reset the countdown, so a press is never instantly
     overwritten by a tick that happened to be about to fire. */
  function go(i) {
    show(i);
    sfx.slide();
    start();
  }

  /* ---- auto-rotation ------------------------------------------------- */
  function advance() {
    // Held: a hidden tab, the pointer resting on the banner, a finger on it,
    // or keyboard focus inside it. The interval keeps ticking, so it resumes
    // on the next tick.
    if (document.hidden || hovering || focused || touching) return;
    show(index + 1);
    sfx.slide();
  }

  function start() {
    clearInterval(timer);
    timer = 0;
    if (slides.length < 2 || reduceQ.matches) return;
    timer = setInterval(advance, ROTATE_MS);
  }

  const onReduce = () => start();
  reduceQ.addEventListener('change', onReduce);

  const wrap = h(
    'section.hero-wrap',
    {},
    stage,
    h(
      'div.hero-controls',
      {},
      h('button.hero-nav.prev', { type: 'button', 'aria-label': t('Previous spotlight'), onclick: () => go(index - 1) }, icon('chevronLeft', { cls: 'flip' })),
      h('button.hero-nav.next', { type: 'button', 'aria-label': t('Next spotlight'), onclick: () => go(index + 1) }, icon('chevronRight', { cls: 'flip' })),
    ),
  );

  // Pointer over the banner holds it; so does keyboard focus anywhere inside.
  wrap.addEventListener('pointerenter', () => {
    hovering = true;
  });
  wrap.addEventListener('pointerleave', () => {
    hovering = false;
  });
  wrap.addEventListener('focusin', () => {
    focused = true;
  });
  wrap.addEventListener('focusout', () => {
    focused = false;
  });
  /* `pointerenter` is not a promise on a touchscreen — a tap can report it and
     nothing else — so a finger down holds the banner in its own terms and the
     countdown gets a full interval once it lifts. */
  wrap.addEventListener('touchstart', () => {
    touching = true;
  }, { passive: true });
  const lift = () => {
    if (!touching) return;
    touching = false;
    start();
  };
  wrap.addEventListener('touchend', lift, { passive: true });
  wrap.addEventListener('touchcancel', lift, { passive: true });

  show(0, { animate: false });
  start();

  // Only the interval and the global media-query listener outlive this node,
  // so those are the two things cleanup has to release.
  onCleanup?.(() => {
    clearInterval(timer);
    timer = 0;
    reduceQ.removeEventListener('change', onReduce);
  });

  return wrap;
}

export function heroSkeleton() {
  return h('section.hero-wrap', {}, h('div.hero.sk'));
}