/**
 * The inbox, held once for the whole app.
 *
 * Two screens read this: the navigation badge, which has to know about a message
 * the moment it lands even while nobody is looking at Messages, and the Messages
 * page itself, which needs the same rows plus the raw event to append a line to
 * the conversation on screen. Neither of them owns the socket — one pipe per
 * person is what the server's `inbox:<id>` feed is for, and a second copy of it
 * would double every delivery.
 *
 * Like comments, this is a local-server feature. `messagesUsable()` says whether
 * the copy on screen has a place to store a message at all, and every entry
 * point asks it before offering one.
 */

import {
  currentUser,
  followInbox,
  inboxThreads,
  isSignedIn,
  markThreadRead,
  messagesUsable,
  onAccount,
} from './account.js';

const listeners = new Set();

let threads = [];
let unread = 0;
let loaded = false;
let failed = false;
let stop = null;

const emit = (event) => {
  const state = { threads, unread, loaded, failed };
  for (const fn of listeners) {
    try {
      fn(state, event);
    } catch { /* one deaf listener must not mute the others */ }
  }
};

export { messagesUsable as inboxUsable } from './account.js';
export const inboxState = () => ({ threads, unread, loaded, failed });

/**
 * The pair address, built exactly the way the server builds it: two ids, lowest
 * first. A chat screen only needs it to answer "is this line one of mine?", which
 * is a question about the pair, not about who typed last.
 */
export const pairKey = (a, b) => (String(a) < String(b) ? `${a}:${b}` : `${b}:${a}`);

/** `fn(state, event)` — event is the live frame, when there is one. */
export function subscribeInbox(fn) {
  listeners.add(fn);
  fn(inboxState(), null);
  return () => listeners.delete(fn);
}

export async function refreshInbox() {
  if (!messagesUsable() || !isSignedIn()) return inboxState();
  try {
    const data = await inboxThreads();
    threads = data.threads || [];
    unread = Number(data.unread) || 0;
    loaded = true;
    failed = false;
  } catch {
    /* The badge keeps the last number it knew rather than dropping to zero — a
       failed read is not an empty inbox, and a zero that lies is worse than a
       stale count. */
    failed = true;
    loaded = true;
  }
  emit(null);
  return inboxState();
}

/**
 * A line that arrived over the socket. A conversation already in the list is
 * patched in place so the badge updates without another request; one that is not
 * in the list is somebody new, and only a fetch can say who.
 */
function absorb(m) {
  const me = currentUser()?.id;
  if (!me) return;
  const other = m.from === me ? m.to : m.from;
  const at = threads.findIndex((row) => row.with?.id === other);
  if (at < 0) {
    refreshInbox();
    return;
  }
  const row = threads[at];
  const next = {
    with: row.with,
    opened: row.opened,
    last: { id: m.id, text: m.text, at: m.at, mine: m.from === me },
    unread: row.unread + (m.to === me && !m.read ? 1 : 0),
  };
  threads = [next, ...threads.filter((r) => r !== row)].sort((a, b) => b.last.at - a.last.at);
  unread = threads.reduce((n, r) => n + r.unread, 0);
  emit({ kind: 'dm', message: m });
}

/** Open the pipe and fill the list. Calling it twice does not open twice. */
export function startInbox() {
  if (!messagesUsable() || !isSignedIn() || stop) return;
  stop = followInbox({
    onMessage: absorb,
    /* A line taken back changes the last line of a conversation, so the list has
       to be asked again — and the page looking at that conversation is told so it
       can drop the bubble without waiting for a reload. */
    onRemove: (data) => {
      refreshInbox();
      emit({ kind: 'remove', id: data.id, pair: data.pair });
    },
    /* The other side read my lines. The list does not show ticks, so this only
       travels to the page that is looking at the conversation. */
    onSeen: (data) => emit({ kind: 'seen', pair: data.pair, at: data.at }),
    /* A trade rides this pipe because it is the same person's inbox — one socket
       per account is what the server's feed is for. Nothing here reads it: the
       deal is re-emitted so `lib/trades.js`, which owns the binder side of a
       trade, can reconcile against it the moment the ledger moves. */
    onTrade: (data) => emit({ kind: 'trade', trade: data }),
    /* An episode that landed is a line in the inbox from the catalogue rather than
       from a person — and one pipe per account is what this feed is for, so the
       bell hears it here instead of opening a second socket. `lib/notices.js` is
       the listener that does something with it. */
    onNotice: (data) => emit({ kind: 'notice', note: data }),
    /* A duel is announced for both members in it, on the same feed, so the arena
       page learns an opponent committed without polling. Nothing here reads it —
       `lib/duels.js` owns the fight and the record. */
    onDuel: (data) => emit({ kind: 'duel', duel: data }),
    /* A friend request or an acceptance. `views/messages.js` owns the panel and
       asks for the lists again; nothing else on this pipe reads it. */
    onFriend: (data) => emit({ kind: 'friend', with: data }),
    onError: () => {
      stop = null;
      failed = true;
      emit(null);
    },
  });
  refreshInbox();
}

export function stopInbox() {
  stop?.();
  stop = null;
  threads = [];
  unread = 0;
  loaded = false;
  emit(null);
}

/** Reading a thread is a write, so the count comes back from the server. */
export async function markRead(withId) {
  const data = await markThreadRead(withId);
  threads = threads.map((row) => (row.with?.id === withId ? { ...row, unread: 0 } : row));
  unread = Number(data.unread) || 0;
  emit({ kind: 'read', with: withId });
}

/* Signing in opens the pipe; signing out closes it and wipes what it carried.
   The account layer is the only place that knows either happened. */
onAccount(() => {
  if (isSignedIn()) startInbox();
  else stopInbox();
});
