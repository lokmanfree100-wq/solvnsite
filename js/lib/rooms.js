/**
 * Watch Together, held for the whole tab.
 *
 * The room lives here rather than inside the panel because a watch page rebuilds
 * itself on every episode hop: the player is remounted, the side panel is rebuilt,
 * and a socket owned by either of them would be closed and re-opened once per hop.
 * One room, one pipe, one heartbeat — and the panel that is looking at it subscribes.
 *
 * What is shared is what Solvn can genuinely control. The picture plays inside a
 * third-party frame that reports nothing back and cannot be seeked from outside, so
 * a room moves the *episode* and the *track*, counts both ends down to the same
 * instant so their frames load together, and carries a chat. It never promises two
 * playheads parked on the same second, because no code on this site could deliver
 * that promise.
 *
 * One writer, always the host. That rule is the whole reason a synced player does
 * not fight itself: a guest follows and says nothing, so a pointer can only ever
 * come from one place.
 */

import {
  followRoom,
  isSignedIn,
  onAccount,
  roomClose,
  roomCount,
  roomJoin,
  roomLeave,
  roomList,
  roomMove,
  roomRead,
  roomSay,
  roomStart,
  roomsUsable,
} from './account.js';
import { storage } from './store.js';

export { roomsUsable as partyUsable };

const HEARTBEAT_MS = 100000;
/* Longer than the socket gap, shorter than the server's idle window: a tab that is
   open and looking keeps its name on the roster, and a tab that was closed simply
   stops asking. */
const FOLLOW_KEY = 'partyFollow';

const listeners = new Set();

let code = null;
let room = null;
let live = false;
let stop = null;
let beat = null;
/* The last episode a guest was sent to. A watch page clamps an episode the local
   catalogue does not know about, so a guest told to open 40 while holding a list
   that ends at 12 would otherwise be sent there again on every repaint, forever. */
let lastTarget = '';

const emit = (event) => {
  const state = partyState();
  for (const fn of listeners) {
    try {
      fn(state, event);
    } catch { /* one deaf listener must not mute the others */ }
  }
};

export const partyState = () => ({ room, code, live, following: isFollowing() });

/** A guest takes the host's episode unless this device said otherwise. */
export const isFollowing = () => storage.read(FOLLOW_KEY, true) !== false;

export function setFollowing(on) {
  storage.write(FOLLOW_KEY, !!on);
  emit({ kind: 'follow' });
}

/**
 * Claim a target. True the first time a room asks for this episode and never again
 * for the same one, so following is exactly one navigation per move.
 */
export function takeTarget(target) {
  if (!target || target === lastTarget) return false;
  lastTarget = target;
  return true;
}

/** `fn(state, event)` — called once on subscribe, so a page paints without waiting. */
export function subscribeParty(fn) {
  listeners.add(fn);
  fn(partyState(), null);
  wake();
  return () => {
    listeners.delete(fn);
    /* Nobody is looking. The pipe goes, the membership stays: a viewer who walks to
       Home is still in the party until their name goes stale on the server. */
    if (!listeners.size) sleep();
  };
}

/** Open the pipe and the heartbeat. Calling it twice does not open twice. */
function wake() {
  if (!code || stop) return;
  stop = followRoom({
    id: code,
    onRoom: (next) => apply(next, 'room'),
    onSync: (next) => apply(next, 'sync'),
    onStart: (next) => apply(next, 'start'),
    onHost: (next) => apply(next, 'host'),
    onMsg: (m) => emit({ kind: 'msg', message: m }),
    onClosed: () => {
      const gone = code;
      drop();
      emit({ kind: 'closed', id: gone });
    },
    onError: () => {
      live = false;
      emit({ kind: 'offline' });
    },
  });
  live = true;
  clearInterval(beat);
  beat = setInterval(refresh, HEARTBEAT_MS);
}

/** Drop the pipe without touching the membership. */
function sleep() {
  stop?.();
  stop = null;
  clearInterval(beat);
  beat = null;
  live = false;
}

/** Out of the room entirely: the name comes off the list and the pipe closes. */
function drop() {
  sleep();
  code = null;
  room = null;
}

/** A socket can be silent while a proxy eats it, so the panel also asks. */
async function refresh() {
  if (!code) return;
  try {
    const data = await roomRead(code);
    apply(data.room, 'poll');
  } catch (err) {
    if (err?.status === 410 || err?.status === 404) {
      drop();
      emit({ kind: 'closed' });
    } else {
      live = false;
      emit({ kind: 'offline' });
    }
  }
}

function apply(next, kind) {
  if (!next || next.id !== code) return;
  room = next;
  emit({ kind, room: next });
}

/* ---- the writes ---------------------------------------------------------- */

/** Start, or step back into, the room this member already hosts on this title. */
export async function hostParty({ media, title, ep, audio }) {
  const data = await roomStart({ media, title, ep, audio });
  room = data.room;
  code = room.id;
  lastTarget = '';
  wake();
  emit({ kind: 'enter', room });
  return room;
}

/** An invite is a code and nothing else. The server answers a join for a room this
    member already stands in, so a pasted link twice is one seat, not two. */
export async function joinParty(value) {
  const wanted = String(value || '').trim().toUpperCase().slice(0, 24);
  if (!wanted) return null;
  const data = await roomJoin(wanted);
  room = data.room;
  code = room.id;
  lastTarget = '';
  wake();
  emit({ kind: 'enter', room });
  return room;
}

/** Re-attach to a room this member is still in on this title — the party survives a
    link opened from the library, where no code rode along in the address. */
export async function restoreParty(media) {
  if (code || !isSignedIn() || !roomsUsable()) return null;
  try {
    const data = await roomList();
    const found = (data.rooms || []).find((r) => Number(r.media) === Number(media));
    if (!found) return null;
    room = found;
    code = found.id;
    wake();
    emit({ kind: 'enter', room });
    return room;
  } catch {
    /* A list that will not answer is not a room to be in. */
    return null;
  }
}

export async function leaveParty() {
  const at = code;
  sleep();
  drop();
  if (at) {
    try {
      await roomLeave(at);
    } catch { /* the seat goes stale on its own if that request fails */ }
  }
  emit({ kind: 'left', id: at });
}

/** The host's own position, pushed. A guest calling this does nothing at all —
    there is only ever one hand on the room. */
export async function moveParty({ media, ep, audio }) {
  if (!code || !room || !room.mine?.isHost) return null;
  try {
    const data = await roomMove(code, { media: media ?? room.media, ep, audio });
    room = data.room;
    emit({ kind: 'mine', room });
    return room;
  } catch {
    /* The episode is already playing; a room that did not hear about it is a
       problem for the next write, not a reason to interrupt the viewer. */
    return null;
  }
}

/** Arm a countdown both ends reload their frames on. `delay` is 0 for now. */
export async function callStart(delay) {
  if (!code || !room?.mine?.isHost) return null;
  const data = await roomCount(code, delay);
  room = data.room;
  emit({ kind: 'start', room });
  return room;
}

export async function sayInParty(text) {
  if (!code) return null;
  const data = await roomSay(code, text);
  return data.message;
}

export async function closeParty() {
  if (!code) return;
  const at = code;
  try {
    await roomClose(at);
  } catch { /* the host is told by the feed if the write itself failed */ }
  drop();
  emit({ kind: 'closed', id: at });
}

/* Signing out cannot leave a party standing: the roster is made of accounts, and a
   room whose members all went away closes itself. */
onAccount(() => {
  if (isSignedIn() || !code) return;
  sleep();
  drop();
  emit({ kind: 'left' });
});
