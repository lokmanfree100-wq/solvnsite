/**
 * Watch Together: the room card beside the player.
 *
 * A room shares what a watch page can genuinely control from outside a third-party
 * frame — the episode, the track, and the instant both ends reload their player —
 * plus who is in it and a chat. It does not pretend to move a playhead: the picture
 * streams from a server Solvn does not host, inside a frame that reports nothing
 * back, so no button here claims to park two videos on the same second. Saying that
 * out loud is part of the card, because a synced player people trust has to be a
 * synced player that tells the truth about itself.
 *
 * One hand on the room: the host writes, everybody else follows. That is why a
 * guest's own rail links are offered but never auto-applied — they get a "catch up"
 * instead of a fight over the pointer.
 *
 * The room itself lives in `lib/rooms.js`, so this card can be rebuilt on every
 * episode hop without dropping the socket or losing the party.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast, confirmSheet } from '../lib/ui.js';
import { isSignedIn, shownName } from '../lib/account.js';
import { relativeTime } from '../lib/util.js';
import { trackChip } from '../lib/sources.js';
import { avatar, authSheet, say } from './account.js';
import {
  callStart,
  closeParty,
  hostParty,
  isFollowing,
  joinParty,
  leaveParty,
  partyState,
  partyUsable,
  restoreParty,
  sayInParty,
  setFollowing,
  subscribeParty,
  takeTarget,
} from '../lib/rooms.js';

const MAX = 240;
/* The two countdowns on offer. Long enough to shout "get in!", short enough that
   nobody has to wait out a break. */
const START_STEPS = [10, 30];

/**
 * An invite is a code, a word or a whole link, and all three mean the same seat.
 * Uppercased because that is how the server writes them, and because a code typed
 * on a phone comes back in whatever case the keyboard was in.
 */
export function parseCode(raw) {
  const s = String(raw || '').trim();
  const hit = /room=([\w-]+)/i.exec(s);
  return (hit ? hit[1] : s).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

/**
 * `where()` reads what is actually on screen — a watch page repaints its own
 * episode, so the card asks rather than being told once. `moveTo` and `restart` are the
 * two moves only the view can make, and `onCode` puts or clears the invite in the
 * address bar so the link a viewer copies is the link they are on.
 */
export function partyPanel({ code = null, where, moveTo, restart, onCode, onCleanup = () => {} }) {
  /* A Supabase project has no room table and a static folder has no server, so a
     card that could only ever fail stays off the page. */
  if (!partyUsable()) return h('div');

  const body = h('div.party-body');
  const dot = h('span.chat-live', { 'aria-live': 'polite' });
  const panel = h('section.party.panel-card', {},
    h('div.panel-head', {}, icon('users'), h('h3.grow', {}, t('Watch together')), dot),
    body,
  );

  let state = partyState();
  /* Which room this DOM was built for — 'off' when there is none, 'auth' while
     nobody is signed in. Changing it is the only time the tree is replaced, so a
     line typed into the chat survives every event that comes after it. */
  let built = null;
  let parts = null;
  let items = [];
  let tick = null;
  let fired = 0;
  let torn = false;

  const nearBottom = () => parts && parts.list.scrollHeight - parts.list.scrollTop - parts.list.clientHeight < 90;
  const stick = () => {
    if (parts) parts.list.scrollTop = parts.list.scrollHeight;
  };

  /* The invite carries the room and the track it is on, because a friend who
     lands on Ep 7 subtitled when the party is on the dubbed run would have to be
     told twice. The episode comes from the room when there is one, and from the
     screen when there is not. */
  const inviteUrl = (r = state.room) => {
    const at = r ? { media: r.media, ep: r.pointer.ep } : where();
    const id = r?.id || state.code;
    const track = r?.pointer?.audio || where().audio;
    const q = track && track !== 'sub' ? `audio=${track}&room=${id}` : `room=${id}`;
    return `${location.origin}${location.pathname}#/watch/${at.media}/${at.ep}?${q}`;
  };

  function paintDot() {
    const live = state.live;
    dot.replaceChildren(
      h(`i.dot${live ? '.is-live' : ''}`),
      h('span', {}, live ? t('Live') : t('Not live — refresh')),
      live ? null : h('button.btn.btn--sm.btn--icon', { 'aria-label': t('Refresh the room'), onclick: () => reload() }, icon('refresh')),
    );
  }

  /* ---------------- the three trees ---------------- */
  function introTree() {
    if (!isSignedIn()) {
      return h('div.stack', {},
        h('p.party-hint', {}, t('A room keeps everyone on the same episode and starts it together. It needs a Solvn account, because the party is made of members.')),
        h('button.btn.btn--sm.btn--primary', { onclick: () => authSheet('signup') }, icon('user'), t('Sign in to start one')),
      );
    }
    return h('div.stack', {},
      h('p.party-hint', {}, t('A room keeps everyone on the same episode, on the same track, and starts it at the same moment.')),
      h('p.party-note', {}, t('The picture streams from the video server, so Solvn moves the episode, the track and the start — not the pause bar inside the player.')),
      h('div.party-row', {},
        h('button.btn.btn--sm.btn--primary', { onclick: hostNow }, icon('users'), t('Start a room')),
        h('button.btn.btn--sm.btn--glass', { onclick: joinSheet }, icon('link'), t('Join with a code')),
      ),
    );
  }

  /* A room write that failed because the room is gone puts the address back the way
     it was; anything else leaves the link intact so the viewer can try once more. */
  function loseRoom(err) {
    const gone = err?.status === 404 || err?.status === 410;
    if (gone) {
      onCode(null);
      update(null);
    }
    return gone;
  }

  async function hostNow() {
    const at = where();
    try {
      const room = await hostParty({ media: at.media, title: at.label, ep: at.ep, audio: at.audio });
      onCode(room.id);
      update(room);
      toast(t('Room {code} is open. Send the invite to anyone watching with you.', { code: room.id }), { tone: 'ok', iconName: 'users' });
    } catch (err) {
      toast(say(err, t('The room could not be started.')), { tone: 'err', iconName: 'alert' });
    }
  }

  function joinSheet() {
    const field = h('input.input.party-field', {
      'aria-label': t('Invite code'),
      placeholder: t('Code or link'),
      maxlength: 60,
      autocomplete: 'off',
      onclick: (e) => e.currentTarget.select(),
    });
    const api = sheet({
      heading: t('Join a room'),
      sub: t('Paste the code your friend sent, or the whole link — either one opens the same room.'),
      width: 380,
      render: () => h('div.stack', {}, field, h('p.faint.party-note', {}, t('You will land on whatever episode the host is on.'))),
      footer: h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => submit() }, icon('users'), t('Join')),
    });
    field.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
    field.focus?.();

    async function submit() {
      const wanted = parseCode(field.value);
      if (!wanted) {
        toast(t('That is not a room code yet.'), { tone: 'err', iconName: 'alert' });
        return;
      }
      try {
        const room = await joinParty(wanted);
        if (!room) return;
        api.close();
        onCode(room.id);
        update(room);
      } catch (err) {
        /* The four answers a join can have are all different, and each one tells the
           viewer something they can act on. */
        toast(say(err, t('That room could not be joined.')), { tone: 'err', iconName: 'alert' });
        if (err?.status === 409) api.close();
      }
    }
  }

  function roomTree(r) {
    const copy = h('button.btn.btn--sm.btn--glass', { onclick: shareInvite }, icon('link'), t('Copy invite'));
    const roster = h('div.party-people');
    const line = h('div.party-line');
    const sync = h('div.party-sync.hide');
    const cd = h('div.party-countdown.hide');
    const hostRow = h('div.party-row.hide');
    const follow = h('button.switch', {
      role: 'switch',
      'aria-checked': String(isFollowing()),
      'aria-label': t('Follow the host'),
      onclick: () => {
        const next = !isFollowing();
        setFollowing(next);
        follow.setAttribute('aria-checked', String(next));
        toast(next ? t('You will move with the host from here on') : t('The room will stop moving your player'), { iconName: 'users' });
      },
    });
    const list = h('ul.chat-list.party-list', { role: 'log', 'aria-label': t('Room chat'), tabindex: '0' });
    const field = h('textarea.input.chat-box', {
      rows: 2,
      maxlength: MAX,
      placeholder: t('Say something to the room…'),
      'aria-label': t('Room message'),
    });
    const send = h('button.btn.btn--primary.btn--sm', { type: 'button', disabled: true }, icon('share'), h('span', {}, t('Send')));
    const seat = h('p.party-seat-count');

    for (const n of START_STEPS) {
      hostRow.append(h('button.btn.btn--sm.btn--glass', {
        onclick: () => arm(n),
      }, icon('clock'), t('Start in {n}s', { n })));
    }
    hostRow.append(h('button.btn.btn--sm.btn--glass', { onclick: () => arm(0) }, icon('play'), t('Start now')));

    const foot = h('div.party-row', {},
      h('button.btn.btn--sm.btn--glass', { onclick: quit }, icon('arrowLeft'), t('Leave room')),
      r.mine.isHost
        ? h('button.btn.btn--sm.btn--glass.party-close', { onclick: endRoom }, icon('x'), t('Close room'))
        : null,
    );

    send.addEventListener('click', submit);
    field.addEventListener('input', () => (send.disabled = !field.value.trim()));
    field.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    async function submit() {
      const text = field.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const m = await sayInParty(text);
        field.value = '';
        if (m) add(m);
      } catch (err) {
        send.disabled = false;
        if (loseRoom(err)) return;
        toast(say(err, t('That line did not reach the room.')), { tone: 'err', iconName: 'alert' });
      } finally {
        send.disabled = !field.value.trim();
      }
    }

    async function arm(delay) {
      try {
        const room = await callStart(delay * 1000);
        if (room) update(room);
        toast(delay ? t('Starting in {n} seconds.', { n: delay }) : t('Starting now.'), { tone: 'ok', iconName: 'clock' });
      } catch (err) {
        if (loseRoom(err)) return;
        toast(say(err, t('The countdown did not reach the room.')), { tone: 'err', iconName: 'alert' });
      }
    }

    async function quit() {
      await leaveParty();
      onCode(null);
      update(null);
      toast(t('You left the room.'), { iconName: 'users' });
    }

    /* Closing a room takes everybody's player back to their own, so it is the one
       action here that asks first. */
    function endRoom() {
      confirmSheet({
        heading: t('Close this room?'),
        body: t('Everyone watching with you goes back to their own player, and the invite stops working.'),
        confirmLabel: 'Close room',
        onConfirm: async () => {
          await closeParty();
          onCode(null);
          update(null);
          toast(t('The room is closed.'), { iconName: 'users' });
        },
      });
    }

    return {
      node: h('div.stack', {},
        h('div.party-top', {}, h('span.party-code.tnum', {}, r.id), copy),
        line,
        roster,
        seat,
        cd,
        sync,
        r.mine.isHost ? hostRow : h('div.party-follow', {}, icon('eye'), h('span', {}, t('Follow the host')), follow),
        list,
        r.member ? h('div.chat-form', {}, field, h('div.chat-foot', {}, send)) : h('p.party-note', {}, t('Join this room to write in it.')),
        foot,
      ),
      parts: { roster, line, sync, cd, hostRow, follow, list, seat },
    };
  }

  /* ---------------- patches ---------------- */
  function mount(r) {
    clearInterval(tick);
    tick = null;
    parts = null;
    built = !isSignedIn() ? 'auth' : r ? r.id : 'off';
    if (built === 'auth') {
      body.replaceChildren(introTree());
      return;
    }
    if (!r) {
      body.replaceChildren(introTree());
      return;
    }
    const tree = roomTree(r);
    parts = tree.parts;
    body.replaceChildren(tree.node);
    items = (r.chat || []).slice();
    paintChat();
    paint(r);
  }

  function paint(r) {
    if (!r || !parts) return;
    parts.roster.replaceChildren(
      ...(r.people.length
        ? r.people.slice(0, 8).map((p) => h('span.party-seat', { title: shownName(p) }, avatar(p, { size: 'sm' }), p.id === r.host?.id ? icon('crown') : null))
        : [h('span.faint', {}, t('Just you for now.'))]),
      r.people.length > 8 ? h('span.party-seat.more.faint.tnum', {}, `+${r.people.length - 8}`) : null,
    );
    parts.seat.textContent = t('{n} watching', { n: Math.max(1, r.people.length) }) + (r.cap ? ` · ${t('up to {n}', { n: r.cap })}` : '');
    parts.line.replaceChildren(
      h('span.party-who', {}, icon(r.mine.isHost ? 'crown' : 'user'), r.mine.isHost ? t('You are hosting') : t('{name} is hosting', { name: shownName(r.host) || t('Guest') })),
      h('span.party-at.tnum', {}, `${t('Ep {n}', { n: r.pointer.ep })} · ${trackChip(r.pointer.audio)}`),
    );
    if (r.mine.isHost) parts.hostRow.classList.toggle('hide', false);
    else parts.follow.setAttribute('aria-checked', String(isFollowing()));
    paintSync(r);
    arm(r);
  }

  function paintSync(r) {
    const here = where();
    const off = !r.mine.isHost && (r.media !== here.media || r.pointer.ep !== here.ep || r.pointer.audio !== here.audio);
    parts.sync.classList.toggle('hide', !off);
    if (!off) return;
    parts.sync.replaceChildren(
      icon('shuffle'),
      h('span.grow', {}, t('You are on {here} — the room is on {there}.', {
        here: `${t('Ep {n}', { n: here.ep })}`,
        there: `${t('Ep {n}', { n: r.pointer.ep })}`,
      })),
      h('button.btn.btn--sm.btn--glass', {
        onclick: () => moveTo({ media: r.media, ep: r.pointer.ep, audio: r.pointer.audio }),
      }, icon('play'), t('Catch up')),
    );
  }

  /** The countdown is the one thing both ends do on their own clocks. */
  function arm(r) {
    clearInterval(tick);
    tick = null;
    const at = r.start?.at;
    if (!at) {
      parts.cd.classList.add('hide');
      return;
    }
    const show = () => {
      const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
      if (left <= 0) {
        clearInterval(tick);
        tick = null;
        parts.cd.classList.add('hide');
        if (fired !== at) {
          fired = at;
          restart();
        }
        return;
      }
      parts.cd.classList.remove('hide');
      parts.cd.replaceChildren(icon('clock'), h('span.tnum', {}, t('Starts in {n}s', { n: left })));
    };
    show();
    tick = setInterval(show, 1000);
  }

  function message(m) {
    const who = m.author || {};
    return h('li.chat-msg', { 'data-id': m.id },
      h('div.chat-who', {},
        avatar(who, { size: 'sm' }),
        who.id
          ? h('a.chat-name', { href: `#/profile/${encodeURIComponent(who.id)}` }, shownName(who))
          : h('span.chat-name', {}, shownName(who) || t('Guest')),
        h('span.chat-when.faint.tnum', {}, relativeTime(m.at)),
      ),
      h('p.chat-text', {}, m.text),
    );
  }

  function paintChat() {
    if (!parts) return;
    parts.list.replaceChildren(
      ...(items.length ? items.map(message) : [h('li.chat-none', {}, h('p.muted', {}, t('Nothing said in the room yet.')))]),
    );
    stick();
  }

  function add(m) {
    if (!m || items.some((x) => x.id === m.id)) return;
    const keep = nearBottom();
    items = [...items, m].sort((a, b) => a.at - b.at).slice(-60);
    paintChat();
    if (keep) stick();
  }

  /* ---------------- follow ----------------
     The room moved, so the viewer moves — unless they are the one who wrote the
     move, or they said they would rather sit where they are. `takeTarget` is what
     stops a clamped episode from being asked for again on every repaint. */
  function follow(r) {
    if (!r || r.mine.isHost || !isFollowing()) return;
    const here = where();
    const target = `${r.media}/${r.pointer.ep}/${r.pointer.audio}`;
    if (`${here.media}/${here.ep}/${here.audio}` === target) return;
    if (!takeTarget(target)) return;
    moveTo({ media: r.media, ep: r.pointer.ep, audio: r.pointer.audio });
  }

  /** One entry point for every change: patch what is on screen, follow if told. */
  function update(r, event) {
    if (torn) return;
    state = partyState();
    paintDot();
    const mode = !isSignedIn() ? 'auth' : r ? r.id : 'off';
    if (mode !== built) {
      mount(r);
      return;
    }
    if (!r || !parts) return;
    if (r.member) items = (r.chat || []).slice();
    paint(r);
    paintChat();
    if (event?.kind === 'msg') add(event.message);
    if (event?.kind === 'sync') follow(r);
    else paintSync(r);
  }

  async function shareInvite() {
    const url = inviteUrl();
    try {
      await navigator.clipboard.writeText(url);
      toast(t('Invite copied — anyone who opens it lands in this room.'), { tone: 'ok', iconName: 'check' });
    } catch {
      /* A plain-http address has no clipboard API. The link goes on screen as text
         instead, selected ready to copy, rather than a button that does nothing. */
      inviteSheet(url);
    }
  }

  function inviteSheet(url) {
    const field = h('input.input.party-field', {
      value: url,
      readonly: true,
      'aria-label': t('Invite link'),
      onclick: (e) => e.currentTarget.select(),
    });
    sheet({
      heading: t('Invite link'),
      sub: t('This browser blocks the clipboard, so select the link and copy it yourself.'),
      width: 420,
      render: () => h('div.stack', {}, field, h('p.faint.party-note', {}, t('Anyone who opens it joins on the episode the room is on.'))),
    });
  }

  /* Only a room this tab is standing in can be refreshed. After leaving, the code
     that came in on the address is somebody else's past, and pressing refresh must
     not put the viewer back into a party they closed the door on. */
  function reload() {
    const wanted = state.code;
    if (!wanted) {
      update(state.room);
      return;
    }
    joinParty(wanted)
      .then((room) => update(room))
      .catch((err) => {
        if (!loseRoom(err)) toast(say(err, t('That room is not answering.')), { tone: 'err', iconName: 'alert' });
      });
  }

  /* ---------------- wiring ---------------- */
  const unsubscribe = subscribeParty((next, event) => {
    update(next.room, event);
  });

  /* Someone who followed an invite while signed out has been shown the sign-in
     door, not the room. When they come back through it, the code is still sitting
     in the address, so this takes the seat they came for instead of making them
     paste it a second time. */
  const onAccount = () => {
    update(state.room);
    if (isSignedIn() && !state.code && code) enter();
  };
  document.addEventListener('kitsune:account', onAccount);

  /* An invite in the address is a seat. Joining is idempotent on the server, so a
     page that rebuilds for the next episode re-takes the same seat rather than
     asking for a new one — and when there is no code, a room this member is still
     standing in on this title is found again. */
  async function enter() {
    if (!isSignedIn()) return;
    const wanted = code || state.code;
    if (wanted) {
      if (state.code === wanted) return;
      try {
        const room = await joinParty(wanted);
        if (room) update(room, { kind: 'enter' });
      } catch (err) {
        if (loseRoom(err)) return;
        toast(say(err, t('That room could not be joined.')), { tone: 'err', iconName: 'alert' });
      }
      return;
    }
    if (state.code) return;
    const room = await restoreParty(where().media);
    if (room && !torn) {
      onCode(room.id);
      update(room, { kind: 'enter' });
    }
  }
  enter();

  onCleanup(() => {
    torn = true;
    clearInterval(tick);
    unsubscribe();
    document.removeEventListener('kitsune:account', onAccount);
  });

  return panel;
}
