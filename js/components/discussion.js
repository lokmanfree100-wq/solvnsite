/**
 * Two threads that are not about one episode: every title gets a discussion on
 * its own detail page, and the site gets one general room on the home page.
 *
 * Both reuse the comment API, which names a thread by `media` and `ep`. AniList
 * ids start at 1 and so do episode numbers, so a zero is a scope nothing else
 * can ever claim: `media:<id>, ep:0` is the whole-title thread and `media:0,
 * ep:0` is the site one. Episode threads are untouched — they still post with an
 * episode number of 1 or higher and keep every comment they already have.
 *
 * The home strip is deliberately smaller than the panel on a title page: the
 * most recent few lines plus a composer, no scrollback and no load-more, so it
 * reads as a note under the rails rather than as a second feed to keep up with.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { isSignedIn, shownName, commentsFor, postComment, removeComment, followComments, staticHost } from '../lib/account.js';
import { cloudActive } from '../lib/cloud.js';
import { avatar, authSheet, say, titleChip } from './account.js';
import { relativeTime } from '../lib/util.js';
import { commentPanel } from './comments.js';

/** Whole-title threads hang off episode 0; the site room owns media 0 / ep 0. */
export const TITLE_EP = 0;
export const SITE = { media: 0, ep: 0 };

const MAX = 300;
const RECENT = 8;

/** The thread under a title's episode list. Nothing renders without a server. */
export function titleDiscussion(media, { onCleanup = null } = {}) {
  if (cloudActive() || staticHost()) return null;
  return commentPanel(media, TITLE_EP, {
    onCleanup,
    heading: t('Discussion'),
    ariaLabel: t('Title comments'),
    placeholder: t('Say something about this title…'),
    emptyText: t('No one has talked about this title yet.'),
    countInHead: true,
  });
}

/** The site-wide room, as a compact strip for the foot of the home page. */
export function discussionStrip({ onCleanup = null } = {}) {
  if (cloudActive() || staticHost()) return null;

  const list = h('ul.discuss-list', { 'aria-label': t('Site discussion') });
  const counter = h('span.chat-count.tnum', {}, '0');
  const status = h('span.discuss-status', { 'aria-live': 'polite' });
  const body = h('textarea.input.discuss-input', {
    rows: 1,
    maxlength: MAX,
    placeholder: t('Say something about Solvn…'),
    'aria-label': t('Write a comment'),
  });
  const send = h('button.btn.btn--primary.btn--sm', { type: 'button', disabled: true }, icon('share'), h('span', {}, t('Post')));

  let items = [];
  let stop = null;
  let closed = false;

  function paintStatus(state) {
    status.replaceChildren(
      ...[
        state === 'loading' ? h('span.discuss-loading', {}, t('Loading…')) : null,
        state === 'retry' ? h('span', {}, t('Not live — refresh')) : null,
        state === 'retry'
          ? h('button.btn.btn--sm.btn--icon', { type: 'button', 'aria-label': t('Refresh comments'), onclick: () => open() }, icon('refresh'))
          : null,
      ].filter(Boolean),
    );
  }

  function line(c) {
    return h(
      'li.discuss-row',
      { 'data-id': c.id },
      avatar(c.author || {}, { size: 'sm' }),
      c.author?.id
        ? h('a.chat-name', { href: `#/profile/${encodeURIComponent(c.author.id)}` }, shownName(c.author))
        : h('span.chat-name', {}, shownName(c.author) || t('Guest')),
      titleChip(c.author),
      h('p.chat-text', {}, c.text),
      h('span.chat-when.faint.tnum', {}, relativeTime(c.at)),
      c.canDelete
        ? h(
            'button.chat-del',
            {
              type: 'button',
              title: t('Delete comment'),
              'aria-label': t('Delete comment'),
              onclick: async () => {
                try {
                  await removeComment(c.id);
                  drop(c.id);
                } catch (err) {
                  toast(say(err), { tone: 'err', iconName: 'alert' });
                }
              },
            },
            icon('x'),
          )
        : null,
    );
  }

  function paint() {
    counter.textContent = String(items.length);
    const rows = items.slice().sort((a, b) => b.at - a.at).slice(0, RECENT);
    list.replaceChildren(
      ...(rows.length ? rows.map(line) : [h('li.discuss-none', {}, h('p.muted', {}, t('Nothing has been said here yet.')))]),
    );
  }

  const add = (c) => {
    if (items.some((x) => x.id === c.id)) return;
    items = [...items, c];
    paint();
  };

  const drop = (id) => {
    items = items.filter((c) => c.id !== id);
    paint();
  };

  function listen() {
    stop?.();
    stop = followComments({
      media: SITE.media,
      ep: SITE.ep,
      onComment: add,
      onRemove: (data) => drop(data.id),
      onError: () => {
        if (!closed) paintStatus('retry');
      },
    });
  }

  async function open() {
    paintStatus('loading');
    try {
      const data = await commentsFor(SITE.media, SITE.ep);
      items = (data.comments || []).slice();
      paint();
      listen();
    } catch {
      list.replaceChildren(h('li.discuss-none', {}, h('p.muted', {}, t('The comment thread is not answering.'))));
      paintStatus('retry');
    }
  }

  async function submit() {
    const text = body.value.trim();
    if (!text || !isSignedIn()) return;
    send.disabled = true;
    try {
      const data = await postComment({ media: SITE.media, ep: SITE.ep, text });
      body.value = '';
      add(data.comment);
    } catch (err) {
      toast(say(err), { tone: 'err', iconName: 'alert' });
    } finally {
      send.disabled = !body.value.trim();
    }
  }

  send.addEventListener('click', submit);
  body.addEventListener('input', () => (send.disabled = !body.value.trim()));
  body.addEventListener('keydown', (e) => {
    /* A strip is a one-liner: Enter posts, and only a deliberate Shift+Enter
       makes a second line. Cmd/Ctrl+Enter works too, as it does in the chat. */
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  const composer = h(
    'div.discuss-form',
    {},
    body,
    h('div.discuss-foot', {}, send),
  );
  const signInPrompt = h(
    'button.btn.btn--sm',
    { type: 'button', onclick: () => authSheet('login') },
    icon('user'),
    h('span', {}, t('Sign in to join in')),
  );
  const foot = h('div.chat-foot-bar', {}, isSignedIn() ? composer : signInPrompt);

  /* The same two things change when somebody signs in mid-visit: the composer
     appears, and the server starts saying which lines this viewer may delete.
     Signing out takes both back off, so the switch goes both ways. */
  const onAccount = () => {
    foot.replaceChildren(isSignedIn() ? composer : signInPrompt);
    open();
  };
  document.addEventListener('kitsune:account', onAccount);

  const panel = h(
    'section.discuss.panel-card',
    {},
    h(
      'div.panel-head',
      {},
      icon('users'),
      h('h3.grow', {}, t('Site discussion')),
      counter,
      status,
    ),
    list,
    foot,
  );

  open();
  onCleanup?.(() => {
    closed = true;
    stop?.();
    document.removeEventListener('kitsune:account', onAccount);
  });

  return panel;
}
