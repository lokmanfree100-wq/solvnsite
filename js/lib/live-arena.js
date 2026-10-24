/**
 * The other player.
 *
 * The site already keeps profiles on Supabase over REST, but a fight cannot wait
 * for a poll: two people pressing "strike" have to see the answer land. Supabase
 * Realtime is a set of public channels, and a public channel is enough here
 * because nothing is at stake beyond a locally kept streak — no card moves, no
 * profile field is written by the match itself. Presence is the lobby, a
 * broadcast is a move, and when nobody is standing in the lobby the caller falls
 * back to the CPU rather than leaving a spinner on the screen.
 *
 * Pairing is by peak Power inside a band, the same rule the server lobby uses, and
 * the handshake is deterministic on peer ids so two people cannot both open a
 * match for each other. The lower id offers; the higher id accepts. A backup offer
 * after a beat covers the case where the lower one is leaving the tab.
 *
 * A match channel is deliberately short-lived and does not retry. A fight with a
 * hole in its move list is not a fight, and reconnecting in the middle of one
 * would silently move a turn from one player to nobody.
 */

import { currentUser, shownName } from './account.js';
import { RealtimeChannel } from './realtime.js';
import { newSeed } from './battle.js';

export { onlineArenaReady } from './realtime.js';

export const LOBBY_TOPIC = 'solvn-arena-lobby';
/** How far apart two line-ups may peak and still be paired. */
export const POWER_BAND = 0.3;
/** How long the search screen offers the lobby before the CPU steps in. */
export const FALLBACK_MS = 12 * 1000;

const HANDSHAKE_MS = 2800;
const ACCEPT_MS = 4500;
const MATCH_JOIN_MS = 12000;

/** One id per open tab, so two tabs on one browser can meet each other. */
export function peerId() {
  try {
    let id = sessionStorage.getItem('kitsune:arena-peer');
    if (!id) {
      id = `p-${newSeed()}`;
      sessionStorage.setItem('kitsune:arena-peer', id);
    }
    return id;
  } catch {
    return `p-${newSeed()}`;
  }
}

const powerOfCards = (cards) =>
  (cards || []).reduce((n, c) => Math.max(n, Number(c?.power) || 0), 0);

/** What a peer publishes to the lobby, and nothing more than a match needs. */
export function lobbyCard(cards) {
  return {
    peer: peerId(),
    name: shownName(currentUser()) || 'A member',
    handle: currentUser()?.username ? `@${currentUser().username}` : '',
    avatar: currentUser()?.avatar || null,
    power: powerOfCards(cards),
    cards,
    seeking: true,
    at: Date.now(),
  };
}

const validCards = (cards) =>
  Array.isArray(cards) &&
  cards.length === 2 &&
  cards.every((c) => c && typeof c.key === 'string' && c.key && typeof c.name === 'string');

/**
 * Stand in the lobby until somebody answers, or until the caller gives up.
 *
 * `onLobby({ peers, best })` is called after every presence change so the search
 * screen can print a real number. `onMatch(match)` is called once and the lobby
 * is closed immediately afterwards. `onError` is the socket refusing to open; the
 * caller turns that into a CPU fight, because an arena that cannot reach the
 * lobby is still an arena.
 */
export function searchOnline({ cards, onLobby, onMatch, onError, onStatus }) {
  const peer = peerId();
  const me = lobbyCard(cards);
  let closed = false;
  let busy = false;
  let pending = null;
  let timer = 0;
  let retry = 0;
  let expiry = 0;

  const channel = new RealtimeChannel(LOBBY_TOPIC, {
    key: peer,
    retry: true,
    onStatus: (state) => {
      onStatus?.(state);
      if (state === 'error' && !busy) onError?.(new Error('The lobby refused the connection.'));
    },
    onEvent: (event, payload) => {
      if (closed) return;
      if (event === 'seek') receiveSeek(payload);
      else if (event === 'accept') receiveAccept(payload);
      else if (event === 'busy') {
        if (pending && payload?.match === pending.match) {
          clearPending();
          onLobby?.({ peers: [], best: null, retry: true });
        }
      }
    },
    onPresence: (rows) => {
      if (closed || busy) return;
      const rivals = [...rows.values()].filter(
        (row) => row && row.key !== peer && row.seeking && validCards(row.cards),
      );
      rivals.sort((a, b) => Math.abs(Number(a.power) - me.power) - Math.abs(Number(b.power) - me.power));
      const limit = Math.max(150, me.power * POWER_BAND);
      const best = rivals.find((row) => Math.abs(Number(row.power) - me.power) <= limit) || null;
      onLobby?.({ peers: rivals.length, best });
      if (best && !pending && !busy) arm(best);
    },
  });

  function arm(best) {
    clearTimeout(timer);
    /* The lower peer id offers. The higher one waits a beat, then offers too, so a
       tab that is closing cannot strand the only other person in the lobby. */
    const wait = peer < best.key ? 0 : HANDSHAKE_MS;
    timer = setTimeout(() => {
      if (closed || busy || pending) return;
      offer(best);
    }, wait);
  }

  function offer(rival) {
    const match = `m-${newSeed()}`;
    const seed = newSeed();
    const at = Date.now() + 4500;
    pending = { match, seed, at, to: rival.key };
    retry = 0;
    send('seek', { to: rival.key, match, seed, at, cards, peer, name: me.name, handle: me.handle, avatar: me.avatar, power: me.power });
    clearTimeout(expiry);
    expiry = setTimeout(() => {
      if (!pending) return;
      if (retry < 2) {
        retry += 1;
        send('seek', { ...pending, cards, peer, name: me.name, handle: me.handle, avatar: me.avatar, power: me.power });
        expiry = setTimeout(() => clearPending(), HANDSHAKE_MS);
      } else clearPending();
    }, HANDSHAKE_MS);
  }

  function clearPending() {
    pending = null;
    clearTimeout(expiry);
    expiry = 0;
    retry = 0;
  }

  function receiveSeek(msg) {
    if (!msg || msg.to !== peer || busy || closed) return;
    if (!validCards(msg.cards) || typeof msg.match !== 'string' || typeof msg.seed !== 'string') return;
    /* Both sides can offer at once when the lower one's seek was slow to arrive.
       The lower peer's offer wins, so two screens cannot accept each other into
       two different matches and then sit in both. */
    if (pending && peer < msg.peer) return;
    const at = Number(msg.at) || Date.now() + 3000;
    busy = true;
    clearPending();
    send('accept', {
      to: msg.peer,
      match: msg.match,
      seed: msg.seed,
      at,
      cards,
      peer,
      name: me.name,
      handle: me.handle,
      avatar: me.avatar,
      power: me.power,
    });
    finish({
      id: msg.match,
      seed: msg.seed,
      at,
      role: 'responder',
      rival: {
        peer: msg.peer,
        name: String(msg.name || 'A member').slice(0, 60),
        handle: String(msg.handle || '').slice(0, 40),
        avatar: msg.avatar || null,
        power: Number(msg.power) || 0,
        cards: msg.cards,
      },
    });
  }

  function receiveAccept(msg) {
    if (!msg || !pending || msg.to !== peer || msg.match !== pending.match) return;
    if (!validCards(msg.cards)) return;
    const { match, seed, at } = pending;
    busy = true;
    clearPending();
    finish({
      id: match,
      seed,
      at,
      role: 'initiator',
      rival: {
        peer: msg.peer,
        name: String(msg.name || 'A member').slice(0, 60),
        handle: String(msg.handle || '').slice(0, 40),
        avatar: msg.avatar || null,
        power: Number(msg.power) || 0,
        cards: msg.cards,
      },
    });
  }

  function send(event, payload) {
    channel.send(event, payload);
  }

  function finish(match) {
    closed = true;
    clearTimeout(timer);
    clearTimeout(expiry);
    /* Let the accept frame leave before the socket goes with it. */
    setTimeout(() => channel.close(), 160);
    onMatch?.(match);
  }

  const ready = channel
    .open()
    .then(() => {
      if (closed) return;
      channel.track(me);
    })
    .catch((err) => {
      if (closed) return;
      onError?.(err);
    });

  return {
    peer,
    ready,
    cancel() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(expiry);
      if (pending?.match) channel.send('cancel', { peer, match: pending.match });
      channel.close();
      pending = null;
    },
  };
}

/**
 * One live match.
 *
 * The channel only carries what a match needs: a numbered move, an ending, and a
 * leave. The rules live in `lib/battle.js`, and both ends hold the same seed, the
 * same two line-ups apiece and the same starting time, so neither is the referee.
 * `sendEnd(winnerPeer)` names the *peer* that won rather than a side, because
 * "mine" means the opposite person on the other screen.
 */
export function openMatch({ id, rival, onMove, onEnd, onLeave, onStatus }) {
  const peer = peerId();
  let closed = false;
  let seenRival = false;
  let watchdog = 0;

  const channel = new RealtimeChannel(`solvn-arena-${id}`, {
    key: peer,
    retry: false,
    onStatus: (state) => {
      onStatus?.(state);
      if (state === 'closed' && !closed) {
        closed = true;
        clearTimeout(watchdog);
        onLeave?.('closed');
      }
    },
    onPresence: (rows) => {
      if (closed) return;
      const here = [...rows.values()].some((row) => row?.key === rival.peer || row?.peer === rival.peer);
      if (here && !seenRival) {
        seenRival = true;
        clearTimeout(watchdog);
        onStatus?.('ready');
      } else if (!here && seenRival) {
        seenRival = false;
        closed = true;
        onLeave?.('left');
      }
    },
    onEvent: (event, payload) => {
      if (closed || !payload || payload.peer !== rival.peer) return;
      if (event === 'move') onMove?.({ n: Number(payload.n) || 0, kind: String(payload.kind || '') });
      else if (event === 'end') onEnd?.({ winnerPeer: String(payload.winnerPeer || ''), cause: String(payload.cause || '') });
      else if (event === 'left') {
        closed = true;
        onLeave?.('left');
      }
    },
  });

  channel
    .open()
    .then(() => {
      if (closed) return;
      channel.track({ peer, role: 'fighter' });
      watchdog = setTimeout(() => {
        if (closed || seenRival) return;
        closed = true;
        onLeave?.('missing');
      }, MATCH_JOIN_MS);
    })
    .catch(() => {
      if (closed) return;
      onStatus?.('error');
    });

  return {
    peer,
    sendMove(kind, n) {
      if (!closed) channel.send('move', { peer, kind, n });
    },
    sendEnd(winnerPeer, cause) {
      if (!closed) channel.send('end', { peer, winnerPeer, cause });
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(watchdog);
      channel.send('left', { peer });
      setTimeout(() => channel.close(), 120);
    },
  };
}
