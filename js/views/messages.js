/**
 * Messages: the private half of the site.
 *
 * A conversation here belongs to exactly two accounts. The server answers for
 * whoever is standing on one end of the line and refuses everybody else — an
 * admin moderates the public rooms and does not read these — so the page has no
 * notion of a third party, no group, and no way to look at somebody else's
 * inbox. What arrives on the socket is the same object the list request gave,
 * which is why a line can be appended without asking again who typed it.
 *
 * Two panes on a wide screen, one at a time on a phone. The address is the whole
 * state: `#/messages` is the list, `#/messages?with=<id>` is that conversation,
 * so the back button leaves a chat the way a person expects and a thread can be
 * handed over as a link.
 */

import { h, icon } from '../lib/dom.js';
import { go } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { debounce, relativeTime, intlTime } from '../lib/util.js';
import {
  answerFriend,
  askFriend,
  currentUser,
  dropFriend,
  friendsList,
  isSignedIn,
  messageThread,
  removeMessage,
  searchMembers,
  sendMessage,
  shownName,
} from '../lib/account.js';
import { inboxState, inboxUsable, markRead, pairKey, refreshInbox, startInbox, subscribeInbox } from '../lib/dms.js';
import { avatar, authSheet, say, titleChip } from '../components/account.js';
import { emptyState } from '../components/media.js';

const MAX = 500;

export function MessagesView({ route, onCleanup }) {
  /* A folder on a plain host, or a Supabase project, has nowhere to put a
     message. Say so once, in the place the link would have been, and hand the
     viewer back to the rest of the site rather than to a form that cannot post. */
  if (!inboxUsable()) {
    return h(
      'div.messages',
      {},
      emptyState({
        iconName: 'offline',
        heading: t('Messages need a Solvn server'),
        body: t('Private chats are stored by the server that runs this site, which this copy does not have.'),
        action: h('a.btn.btn--primary', { href: '#/' }, icon('home'), h('span', {}, t('Back to home'))),
      }),
    );
  }

  const me = () => currentUser();
  const withId = route.query.with || null;

  const wrap = h(`div.messages${withId ? '.is-thread' : ''}`, {});
  /* ---------------- the list ---------------- */
  const friendsSlot = h('div.msg-friends');
  const rows = h('ul.msg-rows', { 'aria-label': t('Conversations') });
  const list = h(
    'section.msg-list',
    {},
    h(
      'div.msg-head',
      {},
      h('h1.display', {}, t('Messages')),
      h(
        'button.btn.btn--sm',
        { type: 'button', onclick: () => newChatSheet(openWith) },
        icon('plus'),
        h('span', {}, t('New chat')),
      ),
    ),
    friendsSlot,
    rows,
  );

  /* ---------------- the thread ---------------- */
  const peerBar = h('div.msg-peer');
  const log = h('ul.msg-log', { role: 'log', 'aria-label': t('Messages'), tabindex: '0' });
  const box = h('textarea.input.msg-box', {
    rows: 1,
    maxlength: MAX,
    placeholder: t('Write a message…'),
    'aria-label': t('Message'),
  });
  const send = h('button.btn.btn--primary.btn--icon', { type: 'button', disabled: true, 'aria-label': t('Send') }, icon('share'));
  const composer = h('div.msg-form', {}, box, send);
  const thread = h('section.msg-thread', {}, peerBar, log, composer);

  let items = [];
  let peer = null;
  let busy = false;

  /* ---------------- painting ---------------- */
  /* Friends sit above the inbox because a request is the one row here that is
     waiting on the viewer: conversations can be read whenever, a request
     answered never. The list is small by construction — a friend is one row and
     a pair — so it is painted whole rather than patched. */
  async function paintFriends() {
    if (!isSignedIn()) {
      friendsSlot.replaceChildren();
      return;
    }
    let data;
    try {
      data = await friendsList();
    } catch {
      /* A failed read leaves what was there. Emptying it would say "no friends"
         about a server that simply did not answer. */
      return;
    }
    const incoming = data.incoming || [];
    const outgoing = data.outgoing || [];
    const friends = data.friends || [];
    const who = (u) =>
      h(
        'span.msg-friend-who',
        {},
        h('b', {}, shownName(u)),
        h('span.faint', {}, `@${u.username}`),
        u.userId ? h('span.msg-id', {}, `#${u.userId}`) : null,
      );
    const fail = (err) => toast(say(err), { tone: 'err', iconName: 'alert' });

    const rowsOf = [];
    for (const u of incoming) {
      rowsOf.push(
        h(
          'li.msg-friend-row.is-ask',
          {},
          avatar(u, { size: 'sm' }),
          who(u),
          h(
            'span.msg-friend-btns',
            {},
            h('button.btn.btn--sm.btn--primary', {
              type: 'button',
              onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                  await answerFriend(u.id, true);
                  paintFriends();
                } catch (err) {
                  e.currentTarget.disabled = false;
                  fail(err);
                }
              },
            }, t('Accept')),
            h('button.btn.btn--sm', {
              type: 'button',
              'aria-label': t('Decline'),
              onclick: async () => {
                try {
                  await answerFriend(u.id, false);
                  paintFriends();
                } catch (err) {
                  fail(err);
                }
              },
            }, icon('x')),
          ),
        ),
      );
    }
    for (const u of outgoing) {
      rowsOf.push(
        h(
          'li.msg-friend-row',
          {},
          avatar(u, { size: 'sm' }),
          who(u),
          h(
            'span.msg-friend-btns',
            {},
            h('span.faint', {}, t('Requested')),
            h('button.btn.btn--sm', {
              type: 'button',
              'aria-label': t('Cancel request'),
              onclick: async () => {
                try {
                  await dropFriend(u.id);
                  paintFriends();
                } catch (err) {
                  fail(err);
                }
              },
            }, icon('x')),
          ),
        ),
      );
    }
    for (const u of friends) {
      rowsOf.push(
        h(
          'li.msg-friend-row',
          {},
          avatar(u, { size: 'sm' }),
          who(u),
          h(
            'span.msg-friend-btns',
            {},
            h('button.btn.btn--sm', { type: 'button', onclick: () => openWith(u.id) }, icon('chat'), h('span', {}, t('Message'))),
          ),
        ),
      );
    }

    const add = h(
      'button.btn.btn--sm',
      { type: 'button', onclick: () => newChatSheet(openWith) },
      icon('plus'),
      h('span', {}, t('Add friend')),
    );

    if (!rowsOf.length) {
      friendsSlot.replaceChildren(
        h('div.msg-friends-empty', {}, icon('users'), h('p', {}, t('No friends yet. Find somebody by their name or user ID.')), add),
      );
      return;
    }
    friendsSlot.replaceChildren(
      h(
        'div.msg-friends-head',
        {},
        h('h2.msg-friends-title', {}, t('Friends')),
        h('span.faint.tnum', {}, String(friends.length)),
        add,
      ),
      h('ul.msg-friend-rows', {}, ...rowsOf),
    );
  }

  function paintRows() {
    const { threads, loaded, failed } = inboxState();
    if (!loaded) {
      rows.replaceChildren(h('li.msg-note', {}, t('Loading…')));
      return;
    }
    if (!threads.length) {
      rows.replaceChildren(
        h('li.msg-note', {}, failed ? t('The inbox is not answering right now.') : t('No conversations yet. Find somebody by name and say hello.')),
      );
      return;
    }
    rows.replaceChildren(
      ...threads.map((row) => {
        const on = row.with?.id === withId;
        /* A member who has gone leaves their lines behind but nobody to open
           them, so the row says so and stops being a button. */
        if (!row.with) {
          return h('li', {}, h('div.msg-row.is-gone', {}, icon('ghost'), h('span.grow', {}, t('This member is gone'))));
        }
        return h(
          'li',
          {},
          h(
            `button.msg-row${on ? '.is-on' : ''}`,
            { type: 'button', onclick: () => openWith(row.with.id) },
            avatar(row.with, { size: 'sm' }),
            h(
              'span.msg-row-main',
              {},
              h('span.msg-row-top', {}, h('b', {}, shownName(row.with)), titleChip(row.with)),
              h('span.msg-row-last', {}, row.last.mine ? `${t('You')}: ${row.last.text}` : row.last.text),
            ),
            h(
              'span.msg-row-side',
              {},
              h('span.faint.tnum', {}, relativeTime(row.last.at)),
              row.unread ? h('span.msg-badge.tnum', {}, String(row.unread)) : null,
            ),
          ),
        );
      }),
    );
  }

  function paintPeer() {
    /* No conversation open, no header: on a wide screen the list is already on
       screen, so an "Inbox" button here would only point at itself. */
    if (!withId) {
      peerBar.replaceChildren();
      return;
    }
    if (!peer) {
      peerBar.replaceChildren(h('span.faint', {}, t('Loading…')));
      return;
    }
    peerBar.replaceChildren(
      h('button.btn.btn--sm.msg-back', { type: 'button', onclick: () => go('/messages') }, icon('chevronLeft'), h('span', {}, t('Inbox'))),
      avatar(peer, { size: 'sm' }),
      h(
        'span.msg-peer-who',
        {},
        h('a.msg-peer-name', { href: `#/profile/${encodeURIComponent(peer.id)}` }, shownName(peer)),
        titleChip(peer),
        h('span.faint', {}, `@${peer.username}`),
      ),
    );
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 120;
  const stick = () => {
    log.scrollTop = log.scrollHeight;
  };

  function bubble(m) {
    const mine = m.from === me()?.id;
    return h(
      `li.msg-line${mine ? '.is-mine' : ''}`,
      { 'data-id': m.id },
      h(
        'div.msg-bubble',
        {},
        h('p.msg-text', {}, m.text),
        h(
          'span.msg-when',
          {},
          h('span.tnum', {}, intlTime(m.at, { hour: '2-digit', minute: '2-digit' })),
          /* A tick only goes on a line I typed: on somebody else's it would say
             something about my own reading, which is not a thing to report. */
          mine ? h(`span.msg-read${m.read ? '.is-seen' : ''}`, {}, m.read ? t('Seen') : t('Sent')) : null,
        ),
      ),
      mine
        ? h(
            'button.msg-unsend',
            {
              type: 'button',
              title: t('Take this back'),
              'aria-label': t('Take this back'),
              onclick: async () => {
                try {
                  await removeMessage(m.id);
                  dropLine(m.id);
                } catch (err) {
                  toast(say(err), { tone: 'err', iconName: 'alert' });
                }
              },
            },
            icon('trash'),
          )
        : null,
    );
  }

  function paintLog(scroll = false) {
    log.replaceChildren(
      ...(items.length
        ? items.map(bubble)
        : [h('li.msg-note', {}, peer ? t('Nothing said yet. Say hello.') : t('Loading…'))]),
    );
    if (scroll) stick();
  }

  /* ---------------- the thread ---------------- */
  const addLine = (m) => {
    if (items.some((x) => x.id === m.id)) return;
    const keep = nearBottom();
    items = [...items, m].sort((a, b) => a.at - b.at);
    paintLog(keep);
  };

  const dropLine = (id) => {
    items = items.filter((x) => x.id !== id);
    paintLog();
  };

  async function openThread() {
    if (!withId) {
      items = [];
      peer = null;
      thread.replaceChildren(h('div.msg-none', {}, icon('users'), h('p', {}, t('Pick a conversation, or start one.'))));
      return;
    }
    thread.replaceChildren(peerBar, log, composer);
    paintPeer();
    paintLog();
    try {
      const data = await messageThread(withId);
      peer = data.with || null;
      items = data.messages || [];
      paintPeer();
      paintLog(true);
      /* On screen means read: an inbox that counts a line nobody is looking at
         as waiting would leave a number that never goes away. A failed tick only
         leaves the badge one high, so it is not worth losing the thread over. */
      if (items.some((m) => m.to === me()?.id && !m.read)) markRead(withId).catch(() => {});
    } catch (err) {
      log.replaceChildren(h('li.msg-note', {}, say(err)));
    }
  }

  const openWith = (id) => go(`/messages?with=${encodeURIComponent(id)}`);

  async function submit() {
    const text = box.value.trim();
    if (!text || !withId || busy) return;
    busy = true;
    send.disabled = true;
    try {
      const data = await sendMessage({ to: withId, text });
      box.value = '';
      box.style.height = '';
      addLine(data.message);
      stick();
      /* The row in the list needs its new last line. The socket brings it for a
         pair already listed; a first message has no row yet, so ask for one. */
      if (!inboxState().threads.some((row) => row.with?.id === withId)) await refreshInbox();
    } catch (err) {
      toast(say(err), { tone: 'err', iconName: 'alert' });
    } finally {
      busy = false;
      send.disabled = !box.value.trim();
      box.focus();
    }
  }

  send.addEventListener('click', submit);
  box.addEventListener('input', () => {
    send.disabled = !box.value.trim();
    box.style.height = '';
    box.style.height = `${Math.min(box.scrollHeight, 132)}px`;
  });
  /* Enter sends, Shift+Enter breaks a line — the one habit a chat box has to
     keep, because a message that lands on a stray Enter cannot be taken back. */
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    submit();
  });

  /* ---------------- live ---------------- */
  const unlisten = subscribeInbox((state, event) => {
    paintRows();
    if (!event) return;
    /* A request that lands while this page is open is a row the viewer can
       answer without reloading. */
    if (event.kind === 'friend') paintFriends();
    if (!withId) return;
    if (event.kind === 'dm') {
      const m = event.message;
      const ours = (m.from === withId && m.to === me()?.id) || (m.from === me()?.id && m.to === withId);
      if (!ours) return;
      const keep = nearBottom();
      addLine(m);
      if (keep) stick();
      if (m.to === me()?.id && !m.read) markRead(withId).catch(() => {});
    }
    /* A line taken back goes for both people, so it leaves this screen too —
       the sender's own bubble was already dropped by the click, and `addLine`
       and `dropLine` are quiet about a line that is not here. */
    if (event.kind === 'remove') dropLine(event.id);
    /* The other side read my lines, and the pair key is the server's, so only
       this conversation's ticks move. */
    if (event.kind === 'seen' && event.pair === pairKey(me()?.id, withId)) {
      items = items.map((x) => (x.mine ? { ...x, read: true } : x));
      paintLog(nearBottom());
    }
  });

  /* Signing in is the moment this page becomes real: the list fills, and the
     socket opens with it. */
  const onAccount = () => {
    if (!isSignedIn()) return;
    startInbox();
    refreshInbox();
    paintFriends();
    openThread();
  };
  document.addEventListener('kitsune:account', onAccount);

  if (!isSignedIn()) {
    wrap.replaceChildren(
      emptyState({
        iconName: 'lock',
        heading: t('Sign in to read your messages'),
        body: t('A private chat is only private to the two accounts in it.'),
        action: h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet('login') }, icon('user'), h('span', {}, t('Sign in'))),
      }),
    );
    onCleanup(() => {
      unlisten();
      document.removeEventListener('kitsune:account', onAccount);
    });
    return wrap;
  }

  wrap.append(list, thread);
  paintFriends();
  paintRows();
  openThread();
  startInbox();
  refreshInbox();

  onCleanup(() => {
    unlisten();
    document.removeEventListener('kitsune:account', onAccount);
  });
  return wrap;
}

/* ---- start a chat -------------------------------------------------------
   The same member search the search page uses, in a sheet: type a name or the
   six-digit ID a member quoted, pick a person. Nobody is invented here — a chat
   only opens with an account the server hands back, so the list can never offer
   a thread that has nothing at the end of it.

   Each row carries the friendship as it stands, because the same search is how
   a friend is made: the button says "Add friend", "Requested", "Accept" or
   "Friends" and does exactly that. The state is read once on open and then kept
   in `states`, so pressing one row does not re-ask the server about the others. */
function newChatSheet(openWith) {
  const field = h('input.input', {
    type: 'search',
    placeholder: t('Name or user ID…'),
    'aria-label': t('Find a member by name or user ID'),
    autocomplete: 'off',
  });
  const found = h('div.msg-found', { 'aria-live': 'polite' }, h('p.faint', {}, t('Type a name or an ID to find somebody.')));
  let term = 0;
  let people = [];
  const states = new Map();

  const idTag = (u) => (u.userId ? h('span.msg-id', {}, `#${u.userId}`) : null);

  function addButton(u) {
    const verb = () => {
      const state = states.get(u.id) || 'none';
      if (state === 'friend') return t('Friends');
      if (state === 'out') return t('Requested');
      if (state === 'in') return t('Accept');
      return t('Add friend');
    };
    const btn = h('button.btn.btn--sm.msg-found-add', {
      type: 'button',
      onclick: async (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        try {
          const state = states.get(u.id) || 'none';
          const data = state === 'in' ? await answerFriend(u.id, true) : await askFriend(u.id);
          states.set(u.id, data.state === 'friend' ? 'friend' : data.state || 'out');
          btn.textContent = verb();
          btn.classList.toggle('is-done', states.get(u.id) === 'friend');
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
        } finally {
          const state = states.get(u.id) || 'none';
          btn.disabled = state === 'friend' || state === 'out';
        }
      },
    }, verb());
    const state = states.get(u.id) || 'none';
    btn.disabled = state === 'friend' || state === 'out';
    btn.classList.toggle('is-done', state === 'friend');
    return btn;
  }

  function paint() {
    if (!people.length) {
      found.replaceChildren(h('p.faint', {}, t('Nobody by that name yet.')));
      return;
    }
    found.replaceChildren(
      ...people.map((u) =>
        h(
          'div.msg-found-row',
          {},
          h(
            'button.msg-found-open',
            { type: 'button', onclick: () => { opened.close(); openWith(u.id); } },
            avatar(u, { size: 'sm' }),
            h(
              'span.msg-found-names',
              {},
              h('b', {}, shownName(u)),
              h('span.faint', {}, `@${u.username}`),
            ),
            idTag(u),
            titleChip(u),
          ),
          addButton(u),
        ),
      ),
    );
  }

  /* Where each result already stands. One read on open, and a failure only
     means the rows draw "Add friend" until the server is asked for real. */
  friendsList()
    .then((data) => {
      for (const u of data.friends || []) states.set(u.id, 'friend');
      for (const u of data.outgoing || []) states.set(u.id, 'out');
      for (const u of data.incoming || []) states.set(u.id, 'in');
      if (people.length) paint();
    })
    .catch(() => {});

  const search = debounce(async () => {
    const q = field.value.trim();
    const mine = currentUser()?.id;
    if (q.length < 2) {
      people = [];
      found.replaceChildren(h('p.faint', {}, t('Type a name or an ID to find somebody.')));
      return;
    }
    const at = ++term;
    try {
      const data = await searchMembers(q);
      if (at !== term) return;
      people = (data.users || []).filter((u) => u.id && u.id !== mine);
      paint();
    } catch {
      if (at !== term) return;
      people = [];
      found.replaceChildren(h('p.faint', {}, t('The member list is not answering right now.')));
    }
  }, 220);

  field.addEventListener('input', search);

  const opened = sheet({
    heading: t('Find people'),
    sub: t('Search by name or by the user ID on their profile.'),
    width: 520,
    render: () => h('div.stack', {}, field, found),
  });
  requestAnimationFrame(() => field.focus());
  return opened;
}
