/**
 * The brand mark.
 *
 * The wordmark is the logo: lowercase `solvn` in the display face, with the
 * two four-point stars sitting off the top-right corner of the `n`. The same
 * markup is drawn in the top bar, the footer and the startup veil, so the
 * emblem never drifts between three hand-made copies.
 *
 * `logoMark()` is still the cat artwork for the places that need a square icon
 * (player watermark, settings row, tab icon) rather than the wordmark.
 */

import { h } from './dom.js';

export const LOGO_SRC = 'assets/solvn-cat.jpg';
export const WORDMARK = 'solvn';

/** `size` is the intrinsic box; the stylesheets decide how big it is drawn. */
export function logoMark(size = 30) {
  return h('img.logo', {
    src: LOGO_SRC,
    alt: '',
    width: size,
    height: size,
    decoding: 'async',
    draggable: false,
  });
}

/** The two stars are decorative, so the whole lockup can be hidden from AT
    when its link already carries the accessible name. */
export function brandLockup({ hidden = true } = {}) {
  return h(
    'span.brand-lockup',
    hidden ? { 'aria-hidden': 'true' } : null,
    h('span.brand-word', {}, WORDMARK),
    h(
      'span.brand-stars',
      { 'aria-hidden': 'true' },
      h('i.brand-star.brand-star--lead'),
      h('i.brand-star.brand-star--tail'),
    ),
  );
}

/** The glass bubble the wordmark rides in. */
export function brandBubble({ variant = '' } = {}) {
  return h(
    'span',
    { class: variant ? `brand-bubble ${variant}` : 'brand-bubble' },
    brandLockup(),
  );
}
