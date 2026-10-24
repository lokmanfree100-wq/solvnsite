/** Hash router. Keeps scroll per-route and supports query params. */

const listeners = [];
let current = null;
const scrollMemo = new Map();

export function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  }
  return { path: `/${segments.join('/')}`, segments, query, raw };
}

export function go(to, { replace = false, keepScroll = false } = {}) {
  if (!keepScroll && current) scrollMemo.set(current.raw, window.scrollY);
  const hash = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    // replaceState never fires hashchange, and callers use this purely to keep
    // the address bar shareable while updating their own state in place.
    // Re-emitting here would remount the view and loop back into write().
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    current = parse();
    return;
  }
  if (location.hash === hash) emit();
  else location.hash = hash;
}

export function href(to) {
  return `#${to}`;
}

function emit() {
  const route = parse();
  current = route;
  // Home is the spotlight page: arriving here always means "start at the top",
  // so a remembered offset would open on a half-scrolled banner.
  if (route.path === '/') scrollMemo.delete(route.raw);
  listeners.forEach((fn) => fn(route));
  const memo = scrollMemo.get(route.raw);
  requestAnimationFrame(() => {
    // "instant", not "auto": html sets scroll-behavior:smooth, and a remembered
    // offset should land, not glide down the page behind the new view.
    window.scrollTo({ top: memo ?? 0, behavior: 'instant' });
  });
}

export function onChange(fn) {
  listeners.push(fn);
  return () => listeners.splice(listeners.indexOf(fn), 1);
}

export const getCurrent = () => current || parse();

/** Intercept clicks on in-app anchor tags so links behave like a router. */
export function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#/"]');
    if (!a) return;
    current = current || parse();
    scrollMemo.set(current.raw, window.scrollY);
  });
}

export function start() {
  window.addEventListener('hashchange', emit);
  installLinkInterceptor();
  emit();
}

export function rememberScroll() {
  if (current) scrollMemo.set(current.raw, window.scrollY);
}
