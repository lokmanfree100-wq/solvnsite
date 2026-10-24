/**
 * Episode chat: one thread per episode, live over a server-sent event stream.
 *
 * Comments are read by anybody, but only a signed-in member can post one, and
 * the server decides who may delete. When the stream drops we say so and offer
 * a refresh instead of quietly showing a stale thread.
 *
 * The same panel serves a whole title and the site as a whole: the thread is
 * named by `media` and `ep`, and every piece of wording is a parameter with the
 * episode chat as its default. Callers that pass nothing get exactly what the
 * watch page always got.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { account, isSignedIn, commentsFor, postComment, removeComment, followComments, staticHost } from '../lib/account.js';
import { cloudActive } from '../lib/cloud.js';
import { avatar, authSheet, say } from './account.js';
import { relativeTime } from '../lib/util.js';

const MAX = 300;

export function commentPanel(
  media,
  ep,
  {
    onCleanup = null,
    heading = t('Episode chat'),
    ariaLabel = t('Episode comments'),
    placeholder = t('Say something about this episode…'),
    emptyText = t('No one has said anything on this episode yet.'),
    /* A thread that stands on its own on a page puts its count in the heading
       row; the episode chat beside the player keeps it by the send button. */
    countInHead = false,
  } = {},
) {
  /* A Supabase project or a static folder has no comment table, so this panel
     could only ever fail. Leave it out and keep the player clean. */
  if (cloudActive() || staticHost()) return h('div');

  const list = h('ul.chat-list', { role: 'log', 'aria-label': ariaLabel, tabindex: '0' });
  const live = h('span.chat-live', { 'aria-live': 'polite' });
  const counter = h('span.chat-count.tnum', {}, '0');
  const body = h('textarea.input.chat-box', {
    rows: 2,
    maxlength: MAX,
    placeholder,
    'aria-label': t('Write a comment'),
  });
  const send = h('button.btn.btn--primary.btn--sm', { type: 'button', disabled: true }, icon('share'), h('span', {}, t('Post')));

  let items = [];
  let stop = null;
  let closed = false;

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  const stick = () => {
    list.scrollTop = list.scrollHeight;
  };

  function paintLive(state) {
    live.replaceChildren(
      ...[
        h(`i.dot${state === 'live' ? '.is-live' : ''}`),
        h('span', {}, state === 'live' ? t('Live') : state === 'retry' ? t('Not live — refresh') : t('Loading…')),
        state === 'retry'
          ? h('button.btn.btn--sm.btn--icon', { type: 'button', 'aria-label': t('Refresh comments'), onclick: () => open() }, icon('refresh'))
          : null,
      ].filter(Boolean),
    );
  }

  function message(c) {
    return h(
      'li.chat-msg',
      { 'data-id': c.id },
      h(
        'div.chat-who',
        {},
        avatar(c.author || {}, { size: 'sm' }),
        c.author?.id
          ? h('a.chat-name', { href: `#/profile/${encodeURIComponent(c.author.id)}` }, c.author.username)
          : h('span.chat-name', {}, c.author?.username || t('Guest')),
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
      ),
      h('p.chat-text', {}, c.text),
    );
  }

  function paint() {
    counter.textContent = String(items.length);
    list.replaceChildren(
      ...(items.length
        ? items.map(message)
        : [h('li.chat-none', {}, h('p.muted', {}, emptyText))]),
    );
  }

  const add = (c) => {
    if (items.some((x) => x.id === c.id)) return;
    const keep = nearBottom();
    items = [...items, c].sort((a, b) => a.at - b.at);
    paint();
    if (keep) stick();
  };

  const drop = (id) => {
    items = items.filter((c) => c.id !== id);
    paint();
  };

  function listen() {
    stop?.();
    stop = followComments({
      media: media.id,
      ep,
      onComment: add,
      onRemove: (data) => drop(data.id),
      onError: () => {
        if (!closed) paintLive('retry');
      },
    });
    paintLive('live');
  }

  async function open() {
    paintLive('loading');
    try {
      const data = await commentsFor(media.id, ep);
      items = (data.comments || []).slice();
      paint();
      stick();
      listen();
    } catch {
      list.replaceChildren(h('li.chat-none', {}, h('p.muted', {}, t('The comment thread is not answering.'))));
      paintLive('retry');
    }
  }

  async function submit() {
    const text = body.value.trim();
    if (!text || !isSignedIn()) return;
    send.disabled = true;
    try {
      const data = await postComment({ media: media.id, ep, text });
      body.value = '';
      add(data.comment);
      stick();
    } catch (err) {
      toast(say(err), { tone: 'err', iconName: 'alert' });
    } finally {
      send.disabled = false;
    }
  }

  send.addEventListener('click', submit);
  body.addEventListener('input', () => (send.disabled = !body.value.trim()));
  body.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });

  const composer = h('div.chat-form', {}, body, h('div.chat-foot', {}, countInHead ? null : counter, send));
  const signInPrompt = h(
    'button.btn.btn--sm',
    { type: 'button', onclick: () => authSheet('login') },
    icon('user'),
    h('span', {}, t('Sign in to join in')),
  );
  const foot = h('div.chat-foot-bar', {}, isSignedIn() ? composer : signInPrompt);

  /* Signing in changes two things at once: the composer appears and the server
     starts telling us whose comments this viewer may delete. */
  const onAccount = () => {
    if (!isSignedIn()) return;
    foot.replaceChildren(composer);
    open();
  };
  document.addEventListener('kitsune:account', onAccount);

  const panel = h(
    'section.chat.panel-card',
    {},
    h('div.panel-head', {}, icon('users'), h('h3.grow', {}, heading), countInHead ? counter : null, live),
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
