/**
 * The brand mark.
 *
 * One path to the logo file, because the navbar and the footer are the same
 * drawing and a rebrand should be a one-line change. It is the glow-cat artwork
 * the splash already shows, which index.html preloads at boot — so the mark
 * costs no request, no extra bytes and no second decode, and the tab icon, the
 * splash and the chrome are all one image.
 *
 * To replace it, drop a square file at `public/assets/solvn-cat.jpg` — same
 * name, and every place it appears picks it up. A different name means one edit
 * here, plus the `rel="icon"` and `rel="preload"` lines in `index.html`.
 *
 * It is an `<img>` rather than an inline icon so a raster logo can be swapped
 * in without touching a component, and so the browser can decode it while the
 * app modules are still arriving.
 */

import { h } from './dom.js';

export const LOGO_SRC = 'assets/solvn-cat.jpg';

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
