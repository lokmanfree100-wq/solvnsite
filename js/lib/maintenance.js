/** Full-site maintenance gate.
 *
 *  MAINTENANCE_MODE is the single switch. While it is true, app.js never starts
 *  the router and never mounts a view: this overlay owns the viewport and the
 *  site underneath is left completely intact. Flip it to false and the next
 *  load boots the real interface again — nothing else has to change.
 */

import { h, icon, qs, qsa } from './dom.js';

/* Off while the anime and cartoon catalogue is open. The gate itself is
   untouched: flip this back to true and the next load returns the overlay. */
export const MAINTENANCE_MODE = false;

/* The three messages exactly as briefed. The em-dash in the source copy is the
   seam between the headline and the body, so each is split for the layout but
   the wording is untouched. */
const COPY = {
  en: {
    dir: 'ltr',
    badge: 'Maintenance in progress',
    title: 'Site Under Maintenance',
    body: 'We are upgrading solvn.site for a much better experience. Stay tuned!',
    emailLabel: 'Email us',
  },
  ar: {
    dir: 'rtl',
    badge: 'الصيانة جارية',
    title: 'الموقع تحت الصيانة',
    body: 'نقوم حالياً بتطوير وتحسين solvn.site لتجربة أفضل بكثير. ترقبونا قريبًا!',
    emailLabel: 'راسلنا',
  },
  fr: {
    dir: 'ltr',
    badge: 'Maintenance en cours',
    title: 'Site en maintenance',
    body: "Nous mettons à jour solvn.site pour une meilleure expérience. Restez à l'écoute !",
    emailLabel: 'Écrivez-nous',
  },
};

const LANG_LABEL = { en: 'EN', ar: 'العربية', fr: 'FR' };

/* Brand glyphs are not in the shared icon set, so they are inlined here. Both
   are constant, trusted markup — no user input ever reaches innerHTML. */
const DISCORD_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

const INSTAGRAM_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.6" y="2.6" width="18.8" height="18.8" rx="5.4"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none"/></svg>';

const MAIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.6" y="4.6" width="18.8" height="14.8" rx="3.2"/><path d="m3.6 6.6 8.4 6.4 8.4-6.4"/></svg>';

const CONTACT_EMAIL = 'adminsolvn7@gmail.com';

const SOCIALS = [
  {
    name: 'Discord',
    sub: 'QF22JG9H',
    href: 'https://discord.gg/QF22JG9H',
    svg: DISCORD_SVG,
    cls: 'mnt-social--discord',
  },
  {
    name: 'Instagram',
    sub: '@nothrtype',
    href: 'https://instagram.com/nothrtype',
    svg: INSTAGRAM_SVG,
    cls: 'mnt-social--insta',
  },
];

export function mountMaintenance() {
  /* The intro veil sits above everything; lift it at once so the overlay is the
     first and only thing on screen rather than waiting out a startup animation
     for a page nobody can use. */
  qs('#splash')?.remove();

  const shell = qs('.app-shell');
  if (shell) {
    shell.inert = true;
    shell.setAttribute('aria-hidden', 'true');
  }
  document.documentElement.classList.add('mnt-lock');
  document.body.classList.add('mnt-lock');
  document.title = 'Solvn — Under Maintenance';

  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  let lang = COPY[nav] ? nav : 'en';

  const badgeText = h('span.mnt-badge-text');
  const emailLabel = h('small.mnt-email-label');
  const titleEl = h('h1.mnt-title');
  const bodyEl = h('p.mnt-body');
  const msg = h('div.mnt-msg', { role: 'status', 'aria-live': 'polite' }, titleEl, bodyEl);

  const pills = h(
    'div.mnt-langs',
    { role: 'group', 'aria-label': 'Language' },
    Object.keys(COPY).map((k) =>
      h(
        'button.mnt-pill',
        {
          type: 'button',
          dataset: { lang: k },
          'aria-pressed': 'false',
          onclick: () => {
            lang = k;
            paint();
          },
        },
        LANG_LABEL[k],
      ),
    ),
  );

  const socials = h(
    'div.mnt-socials',
    {},
    SOCIALS.map((s) =>
      h(
        'a.mnt-social',
        {
          class: s.cls,
          href: s.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `${s.name} — ${s.sub}`,
        },
        h('span.mnt-social-ic', { html: s.svg }),
        h('span.mnt-social-tx', {}, h('strong', {}, s.name), h('small', {}, s.sub)),
        h('span.mnt-social-arrow', {}, icon('arrowUpRight')),
      ),
    ),
  );

  const email = h(
    'a.mnt-email',
    { href: `mailto:${CONTACT_EMAIL}`, 'aria-label': `${CONTACT_EMAIL}` },
    h('span.mnt-email-ic', { html: MAIL_SVG }),
    h('span.mnt-email-tx', {}, h('strong', {}, CONTACT_EMAIL), emailLabel),
    h('span.mnt-social-arrow', {}, icon('arrowUpRight')),
  );

  const card = h(
    'div.mnt-card',
    {},
    h(
      'header.mnt-head',
      {},
      h('div.mnt-mark', {}, h('img.mnt-logo', { src: 'assets/solvn-cat.jpg', alt: 'Solvn', decoding: 'async' })),
      h('div.mnt-brand', {}, h('span.mnt-word', {}, 'Solvn'), h('span.mnt-tld', {}, 'solvn.site')),
    ),
    h('div.mnt-badge', {}, h('span.mnt-dot', { 'aria-hidden': 'true' }), badgeText),
    pills,
    msg,
    h('div.mnt-divider', { 'aria-hidden': 'true' }),
    socials,
    email,
    h('footer.mnt-foot', {}, icon('globe'), h('span', {}, 'solvn.site')),
  );

  const overlay = h(
    'div.mnt-overlay',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Site under maintenance' },
    h(
      'div.mnt-bg',
      { 'aria-hidden': 'true' },
      h('span.mnt-orb.mnt-orb--blue'),
      h('span.mnt-orb.mnt-orb--ice'),
      h('span.mnt-orb.mnt-orb--deep'),
    ),
    h('div.mnt-grain', { 'aria-hidden': 'true' }),
    h('div.mnt-vignette', { 'aria-hidden': 'true' }),
    card,
  );

  function paint() {
    const c = COPY[lang];
    msg.dir = c.dir;
    msg.lang = lang;
    titleEl.textContent = c.title;
    bodyEl.textContent = c.body;
    badgeText.textContent = c.badge;
    emailLabel.textContent = c.emailLabel;
    for (const b of qsa('.mnt-pill', overlay)) {
      const on = b.dataset.lang === lang;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  document.body.append(overlay);
  paint();

  /* The overlay is the whole page now: keep the tab ring inside it so keyboard
     and screen-reader users never land on the inert shell behind the glass. */
  const focusables = () => qsa('button, a[href]', overlay);
  focusables()[0]?.focus({ preventScroll: true });
  overlay.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && i === f.length - 1) {
      e.preventDefault();
      f[0].focus();
    }
  });
}