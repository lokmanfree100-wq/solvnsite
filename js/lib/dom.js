/** Tiny hyperscript + DOM helpers. No framework, no build step. */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('div.card#id', {onclick}, [children, 'text'])
 * Class strings merge with the `.foo` shorthand. `data-`/`aria-` keys set attrs.
 */
function isProps(v) {
  return v !== null && typeof v === 'object' && !(v instanceof Node) && !Array.isArray(v);
}

/**
 * h('div.card#id', {onclick}, [children, 'text'])
 * Class strings merge with the `.foo` shorthand. `data-`/`aria-` keys set attrs.
 */
export function h(spec, ...rest) {
  let props = null;
  if (rest.length && isProps(rest[0])) {
    props = rest[0];
    rest = rest.slice(1);
  }
  let tag = 'div';
  let selectors = spec || '';

  const m = selectors.match(/^([a-zA-Z0-9-]+)?((?:[#.][^.#]+)*)$/);
  if (m) {
    tag = m[1] || 'div';
    for (const part of (m[2] || '').match(/([#.][^.#]+)/g) || []) {
      if (part[0] === '#') {
        props = { ...(props || {}), id: part.slice(1) };
      } else {
        const cls = (props && props.class) || '';
        props = { ...(props || {}), class: cls ? `${cls} ${part.slice(1)}` : part.slice(1) };
      }
    }
  }

  const el = document.createElement(tag);

  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'ref' && typeof v === 'function') v(el);
    else if (k in el && !['list', 'type', 'size', 'value', 'id'].includes(k) && !k.startsWith('data-') && !k.startsWith('aria-')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }

  append(el, rest.flat(Infinity));
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false || kid === true) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export const frag = (...kids) => {
  const f = document.createDocumentFragment();
  append(f, kids.flat(Infinity));
  return f;
};

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ---- inline-axis scrolling ------------------------------------------ */
/* Rails scroll along the inline axis, which points left in RTL. Chrome and
   Safari report RTL scrollLeft as negative; older WebKit counts down from the
   far end. The engine's model is measured once per scroller rather than guessed. */

const RTL_MODEL = new WeakMap();
const inlineRtl = (el) => getComputedStyle(el).direction === 'rtl';

function rtlModel(el) {
  if (!inlineRtl(el)) return 'ltr';
  if (RTL_MODEL.has(el)) return RTL_MODEL.get(el);
  const prev = el.scrollLeft;
  el.scrollLeft = -1;
  const model = el.scrollLeft < 0 ? 'negative' : 'legacy';
  el.scrollLeft = prev;
  RTL_MODEL.set(el, model);
  return model;
}

export const scrollMax = (el) => Math.max(0, el.scrollWidth - el.clientWidth);

/** 0 at the reading start, `scrollMax()` at the end, whatever the direction. */
export function scrollPos(el) {
  const model = rtlModel(el);
  if (model === 'ltr') return el.scrollLeft;
  const end = el.scrollWidth - el.clientWidth;
  return model === 'negative' ? -el.scrollLeft : end - el.scrollLeft;
}

/** `scrollBy` is physical, so advancing a rail means moving left in RTL. */
export function scrollInlineBy(el, delta) {
  el.scrollBy({ left: (inlineRtl(el) ? -1 : 1) * delta, behavior: 'smooth' });
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Build an inline SVG icon from a path definition. */
export function icon(name, opts = {}) {
  const def = ICONS[name] || ICONS.dot;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(opts.weight || 1.9));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (def.fill) svg.setAttribute('fill', 'currentColor'), svg.setAttribute('stroke', 'none');
  for (const p of def.d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', p);
    if (def.fill) path.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(path);
  }
  if (opts.cls) svg.setAttribute('class', opts.cls);
  return svg;
}

const I = (d, fill = false) => ({ d: Array.isArray(d) ? d : [d], fill });

export const ICONS = {
  dot: I('M12 12h.01'),
  home: I('M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5'),
  compass: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M15.8 8.2 13.9 13.9 8.2 15.8 10.1 10.1l5.7-1.9Z']),
  search: I(['M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z', 'M20.5 20.5 16.4 16.4']),
  library: I(['M4 4.5h5.2A2.8 2.8 0 0 1 12 7.3V19a2.2 2.2 0 0 0-2.2-2.2H4V4.5Z', 'M20 4.5h-5.2A2.8 2.8 0 0 0 12 7.3', 'M20 4.5V19h-3.8A2.2 2.2 0 0 0 14 21']),
  sparkles: I(['M12 3.2 13.7 8l4.8 1.7-4.8 1.7L12 16.2 10.3 11.4 5.5 9.7 10.3 8 12 3.2Z', 'M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z']),
  settings: I(['M12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z', 'M19.4 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.5 7.5 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5a7.4 7.4 0 0 0 .1-1Z']),
  play: I('M7 4.6v14.8a.8.8 0 0 0 1.22.68l11.8-7.4a.8.8 0 0 0 0-1.36L8.22 3.92A.8.8 0 0 0 7 4.6Z', true),
  pause: I(['M8 4.5h2.6v15H8zM13.4 4.5H16v15h-2.6z'], true),
  next: I(['M5.5 4.8 15 12l-9.5 7.2V4.8Z', 'M18.5 4.8v14.4'], true),
  prev: I(['M18.5 4.8 9 12l9.5 7.2V4.8Z', 'M5.5 4.8v14.4'], true),
  chevronLeft: I('M15 5l-7 7 7 7'),
  chevronRight: I('M9 5l7 7-7 7'),
  chevronDown: I('M6 9.5l6 6 6-6'),
  chevronUp: I('M6 14.5l6-6 6 6'),
  arrowLeft: I(['M19 12H5', 'M11 6l-6 6 6 6']),
  arrowUpRight: I(['M7 17 17 7', 'M8 7h9v9']),
  star: I('M12 3.6l2.55 5.4 5.9.8-4.3 4.1 1.06 5.86L12 17.06 6.79 19.76 7.85 13.9 3.55 9.8l5.9-.8L12 3.6Z'),
  heart: I('M12 20.3 4.6 13.2a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5L12 20.3Z'),
  bookmark: I('M6.5 4h11a1 1 0 0 1 1 1v15.2l-6.5-4-6.5 4V5a1 1 0 0 1 1-1Z'),
  plus: I('M12 5v14M5 12h14'),
  check: I('M4.5 12.5 9.5 17.5 19.5 6.5'),
  x: I('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  x: I('M6 6l12 12M18 6 6 18'),
  clock: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2']),
  calendar: I(['M4.5 6.5h15v13h-15z', 'M8 3.5v5M16 3.5v5M4.5 11h15']),
  film: I(['M3.5 5.5h17v13h-17z', 'M8 5.5v13M16 5.5v13M3.5 12h17M3.5 8.8h4.5M3.5 15.2h4.5M16 8.8h4.5M16 15.2h4.5']),
  tv: I(['M4 8h16v11H4z', 'M8.5 4 12 8l3.5-4']),
  flame: I(['M12 21c3.9 0 6.5-2.5 6.5-6 0-4.6-4.2-6.4-4.2-9.8 0 0-2.1 1.1-2.9 3.6-.6-1.2-1.6-2-2.4-2.6.3 2.1-1.3 3.2-2.4 4.8A6.7 6.7 0 0 0 5.5 15c0 3.5 2.6 6 6.5 6Z', 'M12 21c1.9 0 3.2-1.3 3.2-3 0-2.3-2.1-3.2-2.1-4.9-1 .8-1.6 1.7-1.9 2.7-.5-.5-1-1-1.2-1.7-.6 1-1.2 1.9-1.2 3.2 0 2 1.4 3.7 3.2 3.7Z']),
  trending: I(['M3.5 16.5 9 11l3.5 3.5L20.5 6', 'M15.5 6h5v5']),
  grid: I(['M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z']),
  list: I(['M8 6.5h12M8 12h12M8 17.5h12', 'M4 6.5h.01M4 12h.01M4 17.5h.01']),
  sliders: I(['M4 8h10M18 8h2M4 16h4M12 16h8', 'M16 5.5v5M10 13.5v5']),
  refresh: I(['M20 12a8 8 0 1 1-2.4-5.7', 'M20 4v4h-4']),
  info: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5.5M12 7.6h.01']),
  alert: I(['M12 3.5 21.5 20h-19L12 3.5Z', 'M12 10v4M12 17h.01']),
  /* The bell: a handle with a clapper under it, so it reads as a notice rather than
     as the warning triangle the admin tools already wear. */
  bell: I(['M6.5 9a5.5 5.5 0 0 1 11 0c0 6.4 2.7 8.3 2.7 8.3H3.8S6.5 15.4 6.5 9Z', 'M10.3 20.4a1.9 1.9 0 0 0 3.4 0']),
  trash: I(['M4.5 7h15', 'M9.5 7V4.5h5V7', 'M6.5 7l1 13h9l1-13', 'M10 11v5M14 11v5']),
  eye: I(['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Z']),
  calendarStar: I(['M4.5 6.5h15v13h-15z', 'M8 3.5v5M16 3.5v5M4.5 11h15', 'M12 13.4l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 15.5l2-.3.9-1.8Z']),
  /* The brand mark: the same ears-and-head silhouette as the startup cat art,
     so the wordmark in the dock and the footer belong to one drawing. */
  cat: I(['M4.6 11.2 3.2 4.6l5.1 3.1h7.4l5.1-3.1-1.4 6.6a7.4 7.4 0 0 1-14.8 0Z', 'M9.6 13.4h.01M14.4 13.4h.01', 'M12 15.8v1.3']),
  ghost: I(['M5.5 20.5V10a6.5 6.5 0 0 1 13 0v10.5l-2.2-1.6-2.15 1.6-2.15-1.6-2.15 1.6L7.7 18.9l-2.2 1.6Z', 'M9.5 10h.01M14.5 10h.01'], true),
  monitor: I(['M3.5 5h17v11h-17z', 'M9 20.5h6M12 16v4.5']),
  smartphone: I(['M7 3h10v18H7z', 'M10.5 18.2h3']),
  cast: I(['M3.5 18.5a2 2 0 0 1 2 2', 'M3.5 14.2a6.3 6.3 0 0 1 6.3 6.3', 'M3.5 5.5h17v15h-6.8', 'M20.5 9.5a9 9 0 0 0-8.6-2.9']),
  shuffle: I(['M17 4.5 20.5 8 17 11.5', 'M17 12.5 20.5 16 17 19.5', 'M3.5 8h4.2c1.5 0 2.7.7 3.6 1.9l4.4 6c.9 1.2 2.1 1.9 3.6 1.9h1.2', 'M3.5 16h4.2c1.4 0 2.5-.6 3.3-1.6', 'M14.2 9.5c1-.9 1.9-1.5 3.2-1.5h3.1']),
  history: I(['M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3.5 4.5V10H9', 'M12 8v4.4l3 1.8']),
  volume: I(['M4 9.5h3l4.5-4v13L7 14.5H4z', 'M15.5 9.5a3.6 3.6 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10']),
  volumeOff: I(['M4 9.5h3l4.5-4v13L7 14.5H4z', 'M15.5 10l4.5 4M20 10l-4.5 4']),
  mic: I(['M12 15a3.2 3.2 0 0 0 3.2-3.2V6a3.2 3.2 0 1 0-6.4 0v5.8A3.2 3.2 0 0 0 12 15Z', 'M5.5 11a6.5 6.5 0 0 0 13 0M12 18.2V21']),
  caption: I(['M3.5 5.5h17v13h-17z', 'M10 10.2a2.4 2.4 0 1 0 0 3.6M16.5 10.2a2.4 2.4 0 1 0 0 3.6']),
  palette: I(['M12 21a9 9 0 1 1 0-18c4.9 0 9 3.4 9 7.5 0 2.5-2 4-4.2 4H15a1.8 1.8 0 0 0-1.3 3.1c.5.5.3 1.4-.5 1.4Z', 'M7.5 12h.01M9.5 8.5h.01M13.5 7.5h.01'], true),
  share: I(['M12 15.5V4', 'M8 7.5 12 3.5l4 4', 'M4.5 12.5v6a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6']),
  link: I(['M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.7a4 4 0 0 0-5.7-5.6l-1.3 1.3', 'M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.4']),
  offline: I(['M12 20.2h.01', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.8a9.5 9.5 0 0 1 14 0', 'M2 9a14 14 0 0 1 20 0', 'M3 3l18 18']),
  globe: I(['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3.2 9.5h17.6M3.2 14.5h17.6', 'M12 3c2.4 2.6 3.6 5.6 3.6 9S14.4 18.4 12 21c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z']),
  expand: I(['M9 4.5H4.5V9', 'M15 19.5h4.5V15', 'M4.5 15v4.5H9', 'M19.5 9V4.5H15']),
  shrink: I(['M4.5 9H9V4.5', 'M19.5 15H15v4.5', 'M15 4.5V9h4.5', 'M9 19.5V15H4.5']),
  /* account + community */
  user: I(['M12 11.2a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4Z', 'M4.8 20.4a7.2 7.2 0 0 1 14.4 0']),
  users: I(['M9.4 11.4a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M2.8 20.2a6.6 6.6 0 0 1 13.2 0', 'M16.2 4.9a3.5 3.5 0 0 1 0 6.9', 'M17.8 13.6a6.6 6.6 0 0 1 3.4 5.8']),
  /* A bubble with three dots in it: a chat, not a comment. The episode thread
     already owns `list`, and Messages needed a shape nobody else was wearing. */
  chat: I(['M7.9 20A9 9 0 1 0 4 16.1L2 22Z', 'M8.4 12h.01', 'M12 12h.01', 'M15.6 12h.01']),
  lock: I(['M6.6 10.6h10.8V21H6.6z', 'M9.2 10.6V7.4a2.8 2.8 0 0 1 5.6 0v3.2']),
  edit: I(['M4 20h4.4L20 8.4 15.6 4 4 15.6V20Z', 'M13.6 6 18 10.4']),
  trophy: I(['M7.4 4.6h9.2v4.8a4.6 4.6 0 0 1-9.2 0V4.6Z', 'M7.4 6.2H4.6v1.2a3.4 3.4 0 0 0 3.4 3.4', 'M16.6 6.2h2.8v1.2a3.4 3.4 0 0 1-3.4 3.4', 'M12 14v3.6', 'M8.4 20.6h7.2']),
  /* rank + badge glyphs */
  crown: I(['M3.6 6.8 8 10.4l4-6.4 4 6.4 4.4-3.6L19 18.6H5L3.6 6.8Z', 'M5 21h14']),
  fox: I(['M12 21 4.6 8.6 6.4 3l5.6 3.1L17.6 3l1.8 5.6L12 21Z', 'M9.6 10.4h.01M14.4 10.4h.01', 'M12 13.4v2.6']),
  moon: I('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z'),
  popcorn: I(['M7 10h10l-1.2 10.4H8.2L7 10Z', 'M9.6 10a2 2 0 1 1 .3-4 2.4 2.4 0 0 1 4.2 0 2 2 0 1 1 .3 4', 'M10.4 13.4 11 20M13.6 13.4 13 20']),
  bolt: I('M13.2 2.8 5.6 13.4h5l-1.8 7.8 7.8-11h-5l1.6-7.4Z'),
  /* Two arrows going opposite ways: one list for the other, and one coming back.
     `share` already means "send this out", which is the wrong shape for a trade. */
  swap: I(['M4 8.5h13.4', 'M14.4 5.3l3 3.2-3 3.2', 'M20 15.5H6.6', 'M9.6 12.3l-3 3.2 3 3.2']),
  /* The three moves of a fight, drawn so the action bar reads without labels:
     a blade for the strike, a ward for the brace, a processing die for the CPU. */
  sword: I(['M14.6 3.4 20.6 9.4 9.4 20.6H3.4v-6L14.6 3.4Z', 'M12.4 10.6 17 15.2', 'M7.5 15.5l2 2']),
  shield: I(['M12 3.5 19.5 6v5.5c0 4.4-3 7.6-7.5 9-4.5-1.4-7.5-4.6-7.5-9V6L12 3.5Z']),
  cpu: I(['M7 7h10v10H7z', 'M10 10h4v4h-4z', 'M9.5 3.5V7M14.5 3.5V7M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5']),
};
