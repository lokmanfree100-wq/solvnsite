/**
 * Site footer: branding, a DMCA note, real navigation and the copyright line.
 * It is chrome, not a view, so `app.js` renders it once at boot and re-renders
 * it when the language changes; it hides itself on the watch page, where the
 * player owns the viewport.
 *
 * Nothing here leaves Solvn. The social row and the Discord invite used to be
 * outbound links with `target="_blank"`, and they are gone: a footer button that
 * hands the viewer to another site is exactly what this app promises never to
 * do. The only address left is the DMCA `mailto:` — it opens the viewer's own
 * mail client to write to us, it does not move the page.
 */

import { h, icon, qs } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { settings } from '../lib/store.js';
import { cloudActive } from '../lib/cloud.js';
import { staticHost } from '../lib/account.js';
import { reportSheet } from './report-issue.js';

const FOOT = '#sitefoot';

/**
 * Every entry points at a route that actually exists. Labels are literal `t()`
 * calls so the i18n extractor can see them, resolved at render time so a
 * language switch — which re-renders the footer — takes effect immediately.
 */
function navColumn() {
  const items = [
    { href: '#/', label: t('Home') },
    { href: '#/discover', label: t('Discover') },
    { href: '#/library', label: t('Library') },
    { href: '#/updates', label: t('Airing schedule') },
    { href: '#/top', label: t('Top 100') },
    { href: '#/settings', label: t('Settings') },
  ];
  return h(
    'nav.foot-nav',
    { 'aria-label': t('Footer navigation') },
    h('h3.foot-h', {}, t('Explore')),
    h('ul.foot-list', {}, ...items.map((l) => h('li', {}, h('a.foot-link', { href: l.href }, l.label)))),
  );
}

/**
 * One way to reach a human that stays on this page: the report form posts to our
 * own endpoint, so it works with nobody signed in. It is left out where that
 * endpoint does not exist — a cloud project or a static folder — because a
 * button that can only ever fail is not a button.
 */
function actions() {
  return h(
    'div.foot-actions',
    { 'aria-label': t('Ways to reach us') },
    cloudActive() || staticHost()
      ? null
      : h(
          'button.foot-action',
          { type: 'button', onclick: () => reportSheet() },
          icon('edit'),
          h('span', {}, t('Report an issue')),
        ),
  );
}

function brand() {
  return h(
    'div.foot-brand',
    {},
    h(
      'a.foot-logo',
      { href: '#/', 'aria-label': t('Solvn home') },
      h('span.foot-mark', {}, icon('cat', { weight: 1.6 })),
      h('span.foot-word', {}, 'SOLVN'),
    ),
    h('p.foot-tagline', {}, t('Free HD anime streaming — browse, search and watch in one quiet place.')),
    actions(),
  );
}

function dmca() {
  /* A takedown notice needs an address that exists. Until the owner fills one
     in through Settings → Footer links, the paragraph asks for the details but
     no mailto is offered, because a link to a mailbox nobody reads is worse
     than none. */
  const contact = String(settings.get('contactEmail') || '').trim();
  return h(
    'section.foot-dmca',
    {},
    h('h3.foot-h', {}, t('DMCA')),
    h('p.foot-dmca-line', {}, t('Solvn does not store files on server')),
    h(
      'p',
      {},
      contact
        ? t(
            'Titles and episode sources are indexed from third-party providers. If you hold the rights to something listed here and would like it taken down, write to us and we will remove the links promptly.',
          )
        : t(
            'Titles and episode sources are indexed from third-party providers. If you hold the rights to something listed here, ask the source that hosts it to take it down and the link will drop out on its own.',
          ),
    ),
    contact ? h('a.foot-link', { href: `mailto:${contact}` }, contact) : null,
  );
}

export function renderFooter() {
  const foot = qs(FOOT);
  if (!foot) return;
  const year = new Date().getFullYear(); // generated at render time

  foot.replaceChildren(
    h(
      'div.foot-inner',
      {},
      brand(),
      navColumn(),
      dmca(),
      h(
        'div.foot-bottom',
        {},
        h('p', {}, t('© {year} Solvn. All rights reserved.', { year })),
        h('p.foot-note', {}, t('A fan-made project. Not affiliated with any studio, publisher or rights holder.')),
      ),
    ),
  );
}

/** Called on every route change; the watch page gives the viewport to the player. */
export function footerVisible(on) {
  const foot = qs(FOOT);
  if (foot) foot.hidden = !on;
}
