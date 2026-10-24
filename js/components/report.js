/**
 * Reporting. A flag is a note for the admin queue, not a takedown: only Solvn
 * itself reads it, and the server allows one open report per member or list.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { isSignedIn, reportFlag, staticHost } from '../lib/account.js';
import { cloudActive } from '../lib/cloud.js';
import { authSheet, say } from './account.js';

function reportSheet({ kind, id, label }) {
  let dismiss = () => {};
  const box = h('textarea.input', {
    rows: 4,
    maxlength: 240,
    placeholder: t('What is wrong with it?'),
    'aria-label': label,
    oninput: () => (err.textContent = ''),
  });
  const err = h('span.field-err', { role: 'alert' });

  const send = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: async () => {
        const reason = box.value.trim();
        if (!reason) {
          err.textContent = t('Say what you are reporting.');
          box.focus();
          return;
        }
        send.disabled = true;
        try {
          await reportFlag({ kind, id, reason });
          dismiss();
          toast(t('Thanks — an admin will take a look.'), { tone: 'ok', iconName: 'check' });
        } catch (e) {
          err.textContent = say(e);
        } finally {
          send.disabled = false;
        }
      },
    },
    t('Send report'),
  );

  sheet({
    heading: label,
    sub: t('Only a Solvn admin can read this.'),
    width: 460,
    render: (api) => {
      dismiss = api.close;
      setTimeout(() => box.focus(), 0);
      return h('div.stack', {}, box, err, h('div.auth-foot', {}, send));
    },
  });
}

/** Icon-only affordance for a card corner; signed-out visitors get the sign-in sheet. */
export function reportButton({ kind, id, label }) {
  /* The queue lives on the local server — a cloud project or a static folder has
     no reports table, so shipping the button there would ship a dead control. */
  if (cloudActive() || staticHost()) return null;
  return h(
    'button.btn.btn--icon.btn--sm',
    {
      type: 'button',
      title: label,
      'aria-label': label,
      onclick: () => (isSignedIn() ? reportSheet({ kind, id, label }) : authSheet('login')),
    },
    icon('alert'),
  );
}

/** The same flow with room for words, for a profile header. */
export function reportAction({ kind, id, label }) {
  if (cloudActive() || staticHost()) return null;
  return h(
    'button.btn',
    {
      type: 'button',
      onclick: () => (isSignedIn() ? reportSheet({ kind, id, label }) : authSheet('login')),
    },
    icon('alert'),
    h('span', {}, label),
  );
}
