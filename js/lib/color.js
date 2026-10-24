/**
 * Colour maths, with no DOM and no settings in it.
 *
 * The interface is mono and carries exactly one accent, but that accent is made
 * of eleven tokens: a fill, a lit end, a deep end, an ink that sits on the fill,
 * a text shade that sits on the page, and the low-alpha lights the fill throws.
 * Asking a person to hand-tune eleven values for a colour they picked from a
 * wheel is not fair, so they pick one and this file derives the rest — the same
 * relationships the hand-written ramps in tokens.css were built to.
 */

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
/* The page, and the two inks a label can be written in. */
const PAGE = [5, 5, 5];
const DARK_INK = [10, 7, 19];
const LIGHT_INK = [255, 255, 255];
/* A fill this pale cannot hold dark ink and a fill this deep cannot hold white
   ink at 4.5:1, so the crossover is a measured number rather than a taste call. */
const INK_SPLIT = 0.19;

/** `#abc`, `abc`, `#aabbcc`, `aabbcc` → `[r, g, b]`, or null when it is none of those. */
export function parseHex(input) {
  const raw = String(input || '').trim().replace(/^#/, '');
  const full = /^[0-9a-fA-F]{3}$/.test(raw) ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** Six digits, no `#` — the shape the player's `{accent}` placeholder wants. */
export const toHex = (rgb) =>
  rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');

const mix = (a, b, amount) => a.map((v, i) => v + (b[i] - v) * amount);
const lighten = (rgb, amount) => mix(rgb, WHITE, amount);
const darken = (rgb, amount) => mix(rgb, BLACK, amount);

/** WCAG relative luminance — the number every contrast ratio is built from. */
function luminance(rgb) {
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
}

/** An accent shade pale enough to read as text on this page, hue kept intact. */
function textShade(rgb) {
  let out = lighten(rgb, 0.34);
  for (let i = 0; i < 6 && contrast(out, PAGE) < 4.5; i += 1) out = lighten(out, 0.14);
  return out;
}

const rgba = (rgb, alpha) => `rgba(${rgb.map((v) => Math.round(v)).join(', ')}, ${alpha})`;

/**
 * One hex in, the whole accent ramp out, as the custom-property names the
 * stylesheets already use. Returns null for anything that is not a hex colour,
 * so a bad value can never paint the interface half-changed.
 */
export function rampFrom(input) {
  const base = parseHex(input);
  if (!base) return null;
  const fill = base;
  const bright = lighten(fill, 0.2);
  const deep = darken(fill, 0.22);
  const ink = luminance(fill) >= INK_SPLIT ? DARK_INK : LIGHT_INK;
  return {
    '--accent': `#${toHex(fill)}`,
    '--accent-bright': `#${toHex(bright)}`,
    '--accent-deep': `#${toHex(deep)}`,
    '--accent-text': `#${toHex(textShade(fill))}`,
    '--accent-ink': `#${toHex(ink)}`,
    '--accent-glow': rgba(fill, 0.3),
    '--accent-wash': rgba(fill, 0.13),
    '--accent-line': rgba(bright, 0.36),
    /* The field the page sits in and the tighter one under a lit control: both
       the same hue at a very low alpha, never a coloured gradient. */
    '--ambient': rgba(fill, 0.17),
    '--ambient-soft': rgba(fill, 0.09),
    /* The three legacy light names the artwork still reaches for — the pale
       end, the middle and the deep end of the same colour, not a second one. */
    '--glow-cyan': `#${toHex(lighten(fill, 0.75))}`,
    '--glow-violet': `#${toHex(lighten(fill, 0.55))}`,
    '--glow-blue': `#${toHex(darken(fill, 0.15))}`,
  };
}
