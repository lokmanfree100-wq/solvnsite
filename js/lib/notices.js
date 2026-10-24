/**
 * The notice bell, held once for the whole app.
 *
 * AniList is the only thing that knows when an episode airs, and it cannot tell a
 * browser that has its tab shut — so the comparison happens on the local server,
 * which every ten minutes reads the air schedule for the titles members saved and
 * writes a line to whoever is behind. This module never asks what is on the air: it
 * hands up the lists this device holds (they live in local storage, so only the
 * device can say what it follows), reads back what the server noticed, and listens
 * on the inbox pipe for the lines that land while the tab is open.
 *
 * Nothing here makes a sound. A notice is a thing you go and look at, not one that
 * interrupts you — the bell count is the alert.
 */

import {
  clearNotices,
  followWatch,
  isSignedIn,
  noticeList,
  noticesUsable,
  onAccount,
  readNotice,
} from './account.js';
import { subscribeInbox } from './dms.js';
import { LISTS, favouriteEntries, listEntries, progressMap } from './store.js';

const listeners = new Set();

/* The same two ceilings the server puts on the same list: sending more would be
   refused, and a refused request is a bell that quietly never starts. */
const FOLLOW_MAX = 150;
const NOTE_MAX = 40;
/* A short list of titles does not change between two route jumps, so the app does
   not re-send it on every one. The server guards the same window from its side. */
const SYNC_MS = 40 * 1000;

let notes = [];
let unread = 0;
let loaded = false;
let failed = false;
let syncedAt = 0;

const emit = () => {
  const state = { notes, unread, loaded, failed };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch { /* one deaf listener must not mute the others */ }
  }
};

export { noticesUsable } from './account.js';
export const noticesState = () => ({ notes, unread, loaded, failed });

/** `fn(state)` — called now, and on every change. */
export function subscribeNotices(fn) {
  listeners.add(fn);
  fn(noticesState());
  return () => listeners.delete(fn);
}

/**
 * Everything this device follows: the five lists, the heart and anything with a
 * line of progress in it. Most recent first, because the ceiling bites on a long
 * library and a saved-today title matters more than one filed two years ago.
 */
function followed() {
  const rows = [];
  const seen = new Set();
  const add = (entry) => {
    const id = Number(entry?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = String(entry.title || '').slice(0, 120);
    rows.push({ id, title });
  };
  for (const list of LISTS) for (const e of listEntries(list)) add(e);
  for (const e of favouriteEntries()) add(e);
  for (const e of Object.values(progressMap())) add(e);
  return rows.slice(0, FOLLOW_MAX);
}

/**
 * Hand the list up. A refusal is not worth an error on screen — the server has the
 * list it was given last time, and a bell that reads stale is still a bell.
 */
export async function syncFollowed(force = false) {
  if (!noticesUsable() || !isSignedIn()) return false;
  if (!force && Date.now() - syncedAt < SYNC_MS) return false;
  syncedAt = Date.now();
  try {
    await followWatch(followed());
    return true;
  } catch {
    /* Let the next jump try again rather than waiting out the whole window. */
    syncedAt = 0;
    return false;
  }
}

/**
 * Follow one title, from wherever the viewer is standing.
 *
 * The server takes the followed list whole — it replaces what it had — so this
 * sends the device's list with the new title in front, never the new title alone.
 * Anything else would silently unsubscribe the rest of the library.
 */
export async function followTitle(id, name) {
  const num = Number(id);
  if (!noticesUsable() || !isSignedIn() || !num) return false;
  const rows = followed().filter((row) => row.id !== num);
  rows.unshift({ id: num, title: String(name || '').slice(0, 120) });
  try {
    await followWatch(rows.slice(0, FOLLOW_MAX));
    return true;
  } catch {
    /* The server guards a 30-second window of its own; a title that misses it is
       still in this device's list and rides up on the next sync. */
    syncedAt = 0;
    return false;
  }
}

export async function refreshNotices() {
  if (!noticesUsable() || !isSignedIn()) return noticesState();
  try {
    const data = await noticeList();
    notes = Array.isArray(data.notes) ? data.notes.slice(0, NOTE_MAX) : [];
    unread = Number(data.unread) || 0;
    loaded = true;
    failed = false;
  } catch {
    /* Keep the last list the bell knew: a failed read is not an empty one, and a
       zero that lies is worse than a count that is stale. */
    failed = true;
    loaded = true;
  }
  emit();
  return noticesState();
}

/** Both doors into the bell: the list is asked for, and the list is handed up. */
export async function openNotices() {
  await syncFollowed();
  return refreshNotices();
}

/** A line that landed while the tab was open. */
function absorb(note) {
  if (!note || !note.id) return;
  notes = [note, ...notes.filter((n) => n.id !== note.id)].slice(0, NOTE_MAX);
  unread = notes.reduce((n, x) => n + (x.read ? 0 : 1), 0);
  emit();
}

/** Reading is a write, so the count comes back from the server. */
export async function markNoticeRead(id) {
  try {
    const data = await readNotice(id);
    notes = notes.map((n) => (!id || n.id === id ? { ...n, read: true } : n));
    unread = Number(data.unread) || 0;
  } catch {
    return noticesState();
  }
  emit();
  return noticesState();
}

export async function wipeNotices() {
  try {
    await clearNotices();
  } catch {
    return noticesState();
  }
  notes = [];
  unread = 0;
  loaded = true;
  emit();
  return noticesState();
}

/* A line the server pushed is the same object the list shows, so the pipe needs no
   second read — and one inbox socket per person is what it already runs. */
subscribeInbox((state, event) => {
  if (event?.kind === 'notice') absorb(event.note);
});

/* Signing in is what makes a bell worth having: the list is handed up, then asked
   for. Signing out closes it and forgets what it carried. */
onAccount(() => {
  if (isSignedIn() && noticesUsable()) {
    syncFollowed().then(refreshNotices);
    return;
  }
  notes = [];
  unread = 0;
  loaded = false;
  failed = false;
  syncedAt = 0;
  emit();
});
