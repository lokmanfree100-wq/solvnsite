/** Toasts, modal sheets and confirm dialogs. */

import { h, icon, qs } from './dom.js';
import { t } from './i18n.js';
import { sfx } from './sounds.js';

const stack = () => qs('#toasts');
const modalRoot = () => qs('#modal-root');

export function toast(message, { tone = '', iconName = 'sparkles', timeout = 2600 } = {}) {
  const el = h(`div.toast${tone ? `.is-${tone}` : ''}`, {}, icon(iconName), h('span', {}, message));
  stack().appendChild(el);
  const kill = () => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 260);
  };
  const timer = setTimeout(kill, timeout);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    kill();
  });
  return el;
}

/**
 * Open a sheet. `render(close)` returns the body node(s); a close button is
 * always provided so nothing can trap the user.
 */
/** Only one sheet at a time; opening a second replaces the first. */
let active = null;

/**
 * Open a sheet. `render(close)` returns the body node(s); a close button is
 * always provided so nothing can trap the user.
 */
export function sheet({ heading, sub, render, footer, width }) {
  active?.close();
  /* The arrival and the exit each get their own cue. They share one slot in the
     sound layer, so a sheet replacing another is one gesture, not two. */
  sfx.open();

  let node;
  /* One close, however many ways reach it: the X, the backdrop, Escape, the
     next sheet, and the view that called `api.close()` itself. */
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    node?.remove();
    sfx.close();
    document.removeEventListener('keydown', onKey);
    if (active === api) active = null;
    if (!active) document.body.style.removeProperty('overflow');
    onClosed?.();
  };
  let onClosed;
  const api = { close };

  const body = render(api);
  const panel = h(
    'div.sheet',
    { style: width ? { maxWidth: `${width}px` } : null, role: 'dialog', 'aria-modal': 'true', 'aria-label': heading || t('Dialog') },
    h(
      'div.sheet-head',
      {},
      h('div.grow', {}, h('h3', {}, heading || ''), sub ? h('p.muted', { style: { fontSize: '13px', marginTop: '2px' } }, sub) : null),
      h('button.icon-btn', { onclick: close, 'aria-label': t('Close') }, icon('x')),
    ),
    h('div.sheet-body', {}, body),
    footer ? h('div.sheet-foot', {}, footer) : null,
  );

  node = h(
    'div.modal-backdrop',
    {
      onclick: (e) => {
        if (e.target === node) close();
      },
    },
    panel,
  );

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  active = api;
  modalRoot().appendChild(node);
  requestAnimationFrame(() => {
    (qs('input, button.btn--primary, [autofocus]', panel) || panel).focus?.({ preventScroll: true });
  });
  return Object.assign(api, {
    onClose(fn) {
      onClosed = fn;
    },
  });
}

export function confirmSheet({ heading, body, confirmLabel = 'Confirm', tone = 'danger', onConfirm }) {
  const api = sheet({
    heading,
    render: () => h('p', { style: { color: 'var(--text-dim)', fontSize: '14px', lineHeight: '1.6' } }, body),
    footer: [
      h(
        'button.btn.grow',
        {
          onclick: () => api.close(),
        },
        t('Cancel'),
      ),
      h(
        `button.btn.grow${tone === 'danger' ? '' : '.btn--primary'}`,
        {
          /* --danger is a light red, so the ink has to go dark to clear 4.5:1. */
          style: tone === 'danger' ? { background: 'var(--danger)', color: 'var(--void)', borderColor: 'transparent' } : null,
          onclick: () => {
            api.close();
            onConfirm?.();
          },
        },
        t(confirmLabel),
      ),
    ],
  });
  return api;
}

export function closeSheets() {
  if (active) active.close();
}
