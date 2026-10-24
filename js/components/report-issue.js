/**
 * The footer's issue report: one small form, one public endpoint.
 *
 * It is deliberately not the same thing as flagging a member or a playlist —
 * that flow is a member reporting another member, and it needs an account. This
 * one is a viewer telling us the site is broken, and a viewer who cannot watch
 * anything is exactly the person who should not have to sign in first. So the
 * server has a public route for it, gated per address instead of per account.
 *
 * Nothing here is destructive: a refused send keeps every character the visitor
 * typed, the error appears next to the field it came from, and the only way this
 * sheet closes is on a report that actually landed.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { say } from './account.js';

/* The same ceilings the API enforces, so a form that types out never bounces. */
const MAX = { detail: 600, where: 140, contact: 80 };

/**
 * A plain fetch rather than the account wrapper: `lib/account.js` speaks for the
 * session routes, and this one has no session to speak of. Same JSON, same
 * cookies — the server only accepts a request that carries our own origin, which
 * a form on this page always does.
 */
async function sendReport(payload) {
  let res;
  try {
    res = await fetch('/api/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('The site could not be reached.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* an empty answer or a stray HTML page */ }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong. Try again.');
  return data || {};
}

/** A labelled control with its own error line, cleared the moment it is typed in. */
function field(id, label, control) {
  const err = h('span.field-err', { role: 'alert' });
  const node = h('div.field', {}, h('label', { for: id }, label), control, err);
  control.addEventListener('input', () => {
    err.textContent = '';
  });
  return { node, err, set: (m) => (err.textContent = m) };
}

export function reportSheet() {
  const detail = h('textarea.input', {
    id: 'report-detail',
    rows: 4,
    maxlength: MAX.detail,
    placeholder: t('What happened, and what did you expect instead?'),
    'aria-label': t('Describe the problem'),
  });
  const where = h('input.input', {
    id: 'report-where',
    type: 'text',
    maxlength: MAX.where,
    placeholder: t('Title and episode, if it is about one'),
    'aria-label': t('Where it happened'),
  });
  const contact = h('input.input', {
    id: 'report-contact',
    type: 'text',
    maxlength: MAX.contact,
    placeholder: t('Email or handle — only if you want an answer'),
    'aria-label': t('Contact'),
  });

  const detailField = field('report-detail', t('What is broken?'), detail);
  const whereField = field('report-where', t('Where did it happen?'), where);
  const contactField = field('report-contact', t('Contact (optional)'), contact);
  const formErr = h('p.field-err', { role: 'alert' });

  const send = h(
    'button.btn.btn--primary',
    { type: 'button' },
    icon('share'),
    h('span', {}, t('Send report')),
  );

  async function submit(close) {
    const text = detail.value.trim();
    detailField.set('');
    whereField.set('');
    contactField.set('');
    formErr.textContent = '';

    if (!text) {
      detailField.set(t('Tell us what is broken.'));
      detail.focus();
      return;
    }

    /* Held until the answer: a button that can be pressed twice while a request
       is in flight files the same report twice. */
    send.disabled = true;
    try {
      await sendReport({ detail: text, where: where.value.trim(), contact: contact.value.trim() });
      close();
      toast(t('Report sent — thank you.'), { tone: 'ok', iconName: 'check' });
    } catch (err) {
      /* The words stay exactly where they are; only the reason goes in. */
      formErr.textContent = say(err);
      send.disabled = false;
      detail.focus();
    }
  }

  const api = sheet({
    heading: t('Report an issue'),
    sub: t('Only a Solvn admin can read this.'),
    width: 480,
    render: ({ close }) => {
      send.addEventListener('click', () => submit(close));
      /* The sheet sends focus to its first input on the next frame; a report
         starts with the description, so the claim is made a beat later. */
      setTimeout(() => detail.focus({ preventScroll: true }), 120);
      return h('div.stack', {}, detailField.node, whereField.node, contactField.node, formErr);
    },
    footer: send,
  });
  return api;
}
