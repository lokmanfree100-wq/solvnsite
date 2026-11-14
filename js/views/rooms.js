/**
 * Rooms: the door that answers a Watch Together invite.
 *
 * The room itself lives on the watch page — that is where a host opens one, where
 * the chat runs, and where the countdown hands both ends the same episode. This
 * page is the way back in when you are not already sitting there: the rooms that
 * still hold your seat, and the one field that takes a code a friend pasted.
 *
 * There is deliberately no list of strangers' rooms. The server only ever returns
 * rooms this member stands in, and an invite code is the way in — a public
 * directory would turn "watch with my friends" into "anybody walking by may take
 * a seat", which is not what a room is for.
 */

import { h, icon } from '../lib/dom.js';
import { go } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { isSignedIn, roomList } from '../lib/account.js';
import { partyUsable, joinParty, leaveParty, partyState } from '../lib/rooms.js';
import { parseCode } from '../components/party.js';
import { authSheet } from '../components/account.js';
import { emptyState, errorState } from '../components/media.js';

/** Where a seat is actually taken up: the player, with the code riding along. */
const watchPath = (room) => `/watch/${room.media}?room=${encodeURIComponent(room.id)}`;

/* Read off the server's own constant rather than retyped: a hint that promises 8
   seats while the room holds 12 is a number nobody maintains and everybody
   believes. `room.cap` on each row is still the truth of that particular room. */
const SEAT_HINT = 12;

const roomName = (room) => room.title?.trim() || t('Watch together');

/**
 * The name a person is shown by.
 *
 * The server hands back `{ username, displayName, … }` and, for an account that
 * has been deleted, a placeholder whose name is literally '(gone)' — so the row
 * says "a room nobody is hosting" rather than printing that placeholder as if it
 * were a member.
 */
const hostName = (person) => {
  const n = person?.displayName || person?.username || '';
  return n && n !== '(gone)' ? n : '';
};

function roomRow(room, { current, onLeave }) {
  const people = Array.isArray(room.people) ? room.people.length : 0;
  const host = hostName(room.host);
  const who = host ? t('Hosted by {name}', { name: host }) : t('Nobody is hosting right now');
  const seat = room.pointer?.ep ? t('Episode {ep}', { ep: room.pointer.ep }) : t('Waiting for the host');
  return h(
    'div.room-row',
    {},
    h('div.room-line', {}, h('h3.room-title', {}, roomName(room)), h('p.room-sub.tnum', {}, `${who} · ${seat}`)),
    h('span.room-seats.tnum', { title: t('Seats taken of the room’s maximum') }, `${people}/${room.cap ?? '—'}`),
    h(
      'div.room-actions',
      {},
      h('a.btn.btn--primary.btn--sm', { href: `#${watchPath(room)}` }, icon('play'), h('span', {}, current ? t('Back to the room') : t('Join'))),
      /* Only this tab's own room can be left from here: the rest are re-joined and
         dropped from the player, which is where membership is actually held. */
      current ? h('button.btn.btn--ghost.btn--sm', { type: 'button', onclick: onLeave }, t('Leave')) : null,
    ),
  );
}

export function RoomsView({ onCleanup }) {
  const wrap = h('div.page-rooms');

  const head = h(
    'header.page-head',
    {},
    h('div.eyebrow', {}, t('ROOMS')),
    h('h1.display', {}, t('Watch together')),
    h('p', {}, t('Open a room on any episode, send the code, and everyone who joins rides the same episode, the same track and the same chat.')),
  );

  /* A room is kept by a server: a static folder with no backend cannot hold seats,
     so this page says so instead of drawing a field that could only fail. */
  if (!partyUsable()) {
    wrap.append(
      head,
      emptyState({
        iconName: 'users',
        heading: t('Rooms need a server'),
        body: t('A room keeps a roster, a countdown and a chat while people watch. This copy has no server behind it, so there is nothing to hold one.'),
      }),
    );
    onCleanup?.(() => {});
    return wrap;
  }

  if (!isSignedIn()) {
    wrap.append(
      head,
      emptyState({
        iconName: 'user',
        heading: t('Sign in to join a room'),
        body: t('A seat belongs to an account, so the roster can say who is watching and hand the host role to somebody when you leave.'),
        action: h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet() }, t('Sign in')),
      }),
    );
    onCleanup?.(() => {});
    return wrap;
  }

  const list = h('div.room-list');
  const codeInput = h('input', {
    type: 'text',
    id: 'room-code',
    placeholder: t('7K2M4Q'),
    'aria-label': t('Invite code'),
    autocomplete: 'off',
    spellcheck: false,
    maxlength: '24',
  });

  async function fill() {
    list.replaceChildren(h('p.muted', {}, t('Loading…')));
    const mine = partyState().code;
    try {
      const data = await roomList();
      const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
      list.replaceChildren(
        ...(rooms.length
          ? rooms.map((r) => roomRow(r, { current: r.id === mine, onLeave: leave }))
          : [
              emptyState({
                iconName: 'users',
                heading: t('No rooms hold your seat'),
                body: t('Start one from the player panel on any episode, or paste a code below when a friend sends one.'),
              }),
            ]),
      );
    } catch {
      list.replaceChildren(
        errorState(t('rooms'), () => fill(), {
          heading: t('The room list will not open'),
          body: t('The server that keeps rooms is not answering.'),
        }),
      );
    }
  }

  async function leave() {
    try {
      await leaveParty();
      toast(t('You left the room.'), { iconName: 'users' });
      fill();
    } catch {
      toast(t('The server would not take you out of the room. Try again?'), { tone: 'err', iconName: 'alert' });
    }
  }

  /* The code is the whole invitation: nothing here guesses at a room, and a
     mistyped one is refused by the server rather than opened into a wrong title. */
  async function join(event) {
    event.preventDefault();
    const wanted = parseCode(codeInput.value);
    if (!wanted) {
      codeInput.focus();
      return;
    }
    try {
      const room = await joinParty(wanted);
      if (!room) {
        toast(t('That code is empty.'), { tone: 'err', iconName: 'alert' });
        return;
      }
      codeInput.value = '';
      go(watchPath(room));
    } catch {
      toast(t('No room answers that code. Ask for a fresh one — they close when nobody watches.'), {
        tone: 'err',
        iconName: 'alert',
      });
    }
  }

  const form = h(
    'form.room-join',
    { onsubmit: join },
    h('label.room-join-label', { for: 'room-code' }, t('Join with a code')),
    h('div.room-join-row', {}, codeInput, h('button.btn.btn--primary', { type: 'submit' }, icon('check'), h('span', {}, t('Join')))),
    h('p.room-join-hint', {}, t('A room holds up to {cap} seats and closes when it stops being watched.', { cap: SEAT_HINT })),
  );

  const start = h(
    'div.room-start',
    {},
    h('h2.section-title', {}, t('Want your own room?')),
    h('p.party-note', {}, t('Rooms are started from a title: open any episode, then use Watch Together in the panel beside the player.')),
    h('a.btn.btn--ghost', { href: '#/discover' }, icon('compass'), h('span', {}, t('Find something'))),
  );

  wrap.append(head, h('h2.section-title', {}, t('Rooms holding your seat')), list, form, start);
  fill();
  onCleanup?.(() => {});
  return wrap;
}
