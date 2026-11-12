/**
 * The parked half of the catalogue, said once.
 *
 * Movies & Series are in development, and a whole page explaining that was
 * longer than the catalogue itself. This is the replacement: one small glass
 * card, three short lines and a single OK. It is raised on the first visit of a
 * session, and by any film address that still gets opened — never twice, and
 * never on the player, where an overlay would sit on top of the episode.
 *
 * "Once" is a session flag, not a permanent one: a visitor who comes back
 * tomorrow sees the note again only if nothing has changed, and reopening the
 * site in the same tab does not repeat it at all.
 */

import { h, icon, qs } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

const KEY = 'solvn.filmsGate';
const EXIT_MS = 190;

let open = false;

function seen() {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function remember() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* private mode can refuse storage; the note is still shown once per load */
  }
}

export function showFilmsGate() {
  if (open || seen()) return;
  if (document.querySelector('.films-pop')) return;
  open = true;
  remember();

  const close = () => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey);
    document.body.style.removeProperty('overflow');
    node.classList.add('is-out');
    setTimeout(() => node.remove(), EXIT_MS);
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const ok = h('button.btn.btn--primary.films-pop-ok', { type: 'button', dir: 'ltr', onclick: close }, t('OK'));

  const node = h(
    'div.films-pop',
    {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'films-pop-title',
      onclick: (e) => {
        if (e.target === node) close();
      },
    },
    h(
      'div.films-pop-card',
      {},
      h('div.films-pop-art', {}, icon('lock')),
      /* `dir="auto"` keeps an English fallback in an Arabic page from being
         re-ordered by the bidi algorithm — the full stop stays at the end of
         the sentence instead of jumping to its front. */
      h('p.films-pop-kicker', { dir: 'auto' }, t('Under development')),
      h('h2#films-pop-title.films-pop-title', { dir: 'auto' }, t('Movies & Series are coming soon')),
      h(
        'p.films-pop-body',
        { dir: 'auto' },
        t('Solvn is anime and cartoons right now. Films and series arrive in a later update.'),
      ),
      ok,
    ),
  );

  qs('#modal-root').appendChild(node);
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', onKey);
  ok.focus?.({ preventScroll: true });
}

/**
 * The first-visit note. It waits for the intro, never lands on the player, and
 * steps aside while another sheet owns the screen — the account prompt opens at
 * the same moment on a brand-new browser, and two glass boxes stacked is worse
 * than one note arriving a few seconds later.
 */
export function maybeFilmsGate() {
  if (seen()) return;
  if (String(location.hash).startsWith('#/watch/')) return;

  const attempt = (tries) => {
    if (document.querySelector('.modal-backdrop, .films-pop')) {
      if (tries > 0) setTimeout(() => attempt(tries - 1), 900);
      return;
    }
    showFilmsGate();
  };

  setTimeout(() => attempt(4), 500);
}
