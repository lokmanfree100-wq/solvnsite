/**
 * Spotlight banner used on Home.
 *
 * It advances on its own every 5s with a crossfade, and it also answers to
 * the 44px arrows and the dots. The timer is polite: it holds while a viewer
 * is pointing at the banner, holding a finger on it or tabbing through it, it
 * holds while the tab is hidden, and it never runs at all under
 * `prefers-reduced-motion`. It is torn down through the view's `onCleanup`, so
 * a route change cannot leave a phantom interval repainting a detached node.
 *
 * Vertical scrolling, the wheel and swipes belong to the page — nothing here
 * captures them.
 */

import { h, icon } from '../lib/dom.js';
import { title, titleAlt, formatLabel, yearOf, episodeCount, statusLabel, plainDescription, scoreLabel } from '../lib/util.js';
import { t, genre } from '../lib/i18n.js';
import { sfx } from '../lib/sounds.js';

const MAX_SLIDES = 15;
const ROTATE_MS = 5000;
/* A touch longer than --t-slow (420ms) so an outgoing slide is only dropped
   once its fade-out has definitely finished — or, if `transitionend` never
   arrives, once this fallback timer does. */
const FADE_OUT_MS = 900;

/** Fisher-Yates: a fresh order and a fresh opening frame on every visit. */
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * `hero(items)` expects a curated slate; the rotation order is randomised here
 * so a returning viewer never meets the same first three frames twice.
 */
export function hero(items, { onCleanup } = {}) {
  const slides = shuffle(
    items.filter((m) => m.bannerImage || m.coverImage?.extraLarge || m.coverImage?.large),
  ).slice(0, MAX_SLIDES);
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

  slides.forEach((m, i) =>
    dots.append(
      h('button', {
        role: 'tab',
        type: 'button',
        'aria-selected': i === 0 ? 'true' : 'false',
        'aria-label': title(m),
        onclick: () => go(i),
      }),
    ),
  );

  function content(m) {
    const genres = (m.genres || []).slice(0, 3);
    const metaBits = [formatLabel(m.format)];
    const y = yearOf(m);
    if (y) metaBits.push(String(y));
    const ec = episodeCount(m);
    if (ec && m.status !== 'RELEASING') metaBits.push(ec);
    const s = scoreLabel(m.averageScore);
    if (s) metaBits.push(t('{score}/10', { score: s }));
    if (m.status && m.status !== 'FINISHED') metaBits.push(statusLabel(m.status));

    return h(
      'div.hero-content',
      {},
      h('div.hero-eyebrow', {}, icon('trending'), t('Spotlight')),
      h('h2.hero-title.display', {}, title(m)),
      titleAlt(m) ? h('p.hero-alt.clamp-1', {}, titleAlt(m)) : null,
      h('div.hero-meta', {}, ...metaBits.flatMap((bit, i) => (i ? [h('span.sep', {}, '·'), h('span', { class: 'tnum' }, bit)] : [h('span', {}, bit)]))),
      h('p.hero-desc.clamp-2', {}, plainDescription(m.description, 170) || t('No synopsis available yet.')),
      genres.length
        ? h(
            'div.hero-genres',
            {},
            ...genres.map((g) => h('a.hero-chip', { href: `#/discover?genre=${encodeURIComponent(g)}` }, genre(g))),
          )
        : null,
      h(
        'div.hero-actions',
        {},
        h('a.btn.btn--primary.btn--lg', { href: `#/watch/${m.id}/1` }, icon('play'), t('Start watching')),
        h('a.btn.btn--glass.btn--lg', { href: `#/anime/${m.id}` }, icon('info'), t('Details')),
      ),
      // The dots element is reused across slides; appending it moves the node.
      h('div.hero-foot', {}, dots),
    );
  }

  /**
   * Backdrop ladder, highest resolution first: banner, then the biggest cover
   * we were given, then the poster. Each `<img>` walks its own remaining
   * sources on error, so a missing size falls through instead of leaving a
   * blank stage. `slides` already guarantees one of these exists.
   */
  function coverImg(cls, sources, eager) {
    const list = [...new Set(sources.filter(Boolean))];
    const img = h(`img.${cls}`, { alt: '', decoding: 'async', fetchpriority: eager ? 'high' : null });
    let i = 0;
    img.addEventListener('error', () => {
      i += 1;
      if (i < list.length) img.src = list[i];
      else img.remove();
    });
    img.src = list[0];
    return img;
  }

  function art(m, eager) {
    const xL = m.coverImage?.extraLarge;
    const large = m.coverImage?.large;

    if (m.bannerImage) {
      const banner = h('img.hero-banner', { src: m.bannerImage, alt: '', decoding: 'async', fetchpriority: eager ? 'high' : null });
      // A banner can 404 or be trimmed oddly for a given title; the cover
      // treatment below then takes over instead of leaving an empty stage.
      banner.addEventListener(
        'error',
        () => {
          m.bannerImage = null;
          if (slides[index] === m) show(index, { animate: false });
        },
        { once: true },
      );
      return h('div.hero-art', {}, banner, h('div.hero-scrim'));
    }

    return h(
      'div.hero-art.is-fallback',
      {},
      coverImg('hero-blur', [xL, large], eager),
      coverImg('hero-poster', [xL, large], eager),
      h('div.hero-scrim'),
    );
  }

  function show(i, { animate = true } = {}) {
    index = (i + slides.length) % slides.length;
    const m = slides[index];
    const eager = index === 0;
    const next = h('div.hero-slide', {}, art(m, eager), content(m));

    if (!animate || reduceQ.matches) {
      next.classList.add('is-instant');
      stage.replaceChildren(next);
      current = next;
      requestAnimationFrame(() => next.classList.add('is-in'));
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
  return h('section.hero-wrap', {}, h('div.hero.sk', { style: { minHeight: '420px', borderRadius: 'var(--r-xl)' } }));
}
