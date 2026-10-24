/**
 * Cursor-driven 3D tilt for poster cards.
 *
 * CSS owns the transform (see .card in components.css); this only writes the
 * --tilt-x/--tilt-y/--mx/--my custom properties for whatever is under the
 * pointer, so the effect costs one layout read and four style writes per frame
 * and disappears entirely on touch devices or under reduced motion.
 */

const MAX_TILT = 7; // degrees
const HOVER = '(hover: hover) and (pointer: fine)';
const REDUCED = '(prefers-reduced-motion: reduce)';

export function initTilt() {
  if (window.matchMedia(HOVER).matches === false) return;

  let frame = 0;
  let queued = null;

  const paint = () => {
    frame = 0;
    if (!queued) return;
    const el = queued.el;
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (queued.x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (queued.y - r.top) / r.height));
    el.style.setProperty('--tilt-y', `${((px - 0.5) * MAX_TILT * 2).toFixed(2)}deg`);
    el.style.setProperty('--tilt-x', `${((0.5 - py) * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    queued = null;
  };

  const release = (el) => {
    el.style.removeProperty('--tilt-x');
    el.style.removeProperty('--tilt-y');
    el.style.removeProperty('--mx');
    el.style.removeProperty('--my');
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || window.matchMedia(REDUCED).matches) return;
      const el = e.target instanceof Element ? e.target.closest('.card') : null;
      if (!el) return;
      queued = { el, x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    },
    { passive: true },
  );

  document.addEventListener(
    'pointerout',
    (e) => {
      const from = e.target instanceof Element ? e.target.closest('.card') : null;
      if (from && !from.contains(e.relatedTarget)) release(from);
      if (queued && queued.el === from) queued = null;
    },
    { passive: true },
  );

  // A route swap throws away the hovered card, so its tilt vars go with it.
  window.addEventListener('blur', () => {
    document.querySelectorAll('.card[style*="--tilt-x"]').forEach(release);
  });
}
