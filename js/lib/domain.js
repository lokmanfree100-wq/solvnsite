/**
 * The one address the site lives at.
 *
 * A domain change outlives itself: bookmarks from the first week, a name pasted
 * in a chat, a search result the crawler has not visited since. Whoever arrives
 * that way is not lost — they are standing at the right site under an old
 * spelling of it — so the page says where Solvn is now and takes them there,
 * keeping the page they were reaching for.
 *
 * Two addresses are never touched. The site's own, so nobody is bounced off a
 * host that is already correct; and a machine address, because 192.168.x.x or
 * localhost is somebody previewing the build, not a stale link.
 */

import { h } from './dom.js';
import { t } from './i18n.js';
import { logoMark } from './brand.js';

export const HOME = 'solvn.site';

/* How long the notice sits before the jump. Long enough to read one sentence,
   short enough that nobody thinks the page has stalled. */
const NOTICE_MS = 2400;

function host() {
  return String(location.hostname || '').toLowerCase();
}

/** Every spelling of the site's own address, including any future subdomain. */
export function isHome() {
  const name = host();
  return name === HOME || name.endsWith(`.${HOME}`);
}

/** A bare machine: an IP, a loopback name, a development box. Never a redirect. */
function isMachine() {
  const name = host();
  return (
    !name ||
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    /\.(?:test|example|invalid)$/.test(name) ||
    name.includes(':') ||
    name.startsWith('[') ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(name)
  );
}

/** The address to move to, carrying the hash route so the page survives the trip. */
export function homeUrl() {
  const route = location.hash && location.hash !== '#' ? location.hash : '';
  return `https://${HOME}/${route}`;
}

function notice() {
  const veil = h('div.reloc', { role: 'alert' }, [
    logoMark(58),
    h('span.reloc-word', 'Solvn'),
    h('p.reloc-line', t('The site address has been updated to solvn.site')),
    h(
      'a.reloc-go',
      { href: homeUrl(), rel: 'me' },
      h('span', t('Go to solvn.site now')),
    ),
  ]);
  document.body.appendChild(veil);
  return veil;
}

/**
 * Show the notice and hand the browser over. Returns whether this copy of the
 * page is on its way out, so the boot can stop wiring a site it is leaving.
 *
 * `replace` rather than `assign`: the old address is not a step anyone wants to
 * press Back into again.
 */
export function leaveForHome() {
  if (isHome() || isMachine()) return false;
  notice();
  setTimeout(() => location.replace(homeUrl()), NOTICE_MS);
  return true;
}
