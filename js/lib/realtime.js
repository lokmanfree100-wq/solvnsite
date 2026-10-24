/**
 * The small slice of Supabase Realtime an arena needs: a public channel, a
 * broadcast, and the presence map a lobby reads.
 *
 * The rest of the site talks to Supabase over REST, which is enough for a
 * profile and a playlist. A duel is not: two people pressing a button have to
 * hear each other in well under a second, and a table polled every two seconds
 * would make the arena feel like a message board. Realtime is a WebSocket built
 * on the Phoenix channel protocol, and the protocol is small enough to speak
 * directly instead of shipping a client library for it.
 *
 * The project here is the public one the site already uses. A publishable key is
 * meant to be in a browser — it can only do what row-level security allows — and
 * the secret key is never part of this file or any request from it. A configured
 * cloud project in Settings wins over this default, so the owner can move the
 * arena to another project without a build.
 *
 * Nothing in this module retries a match forever: the lobby reconnects, a match
 * does not, because a fight with a hole in its move list cannot be resumed by
 * joining again.
 */

import { cloudConfig } from './cloud.js';

const DEFAULT_PROJECT = {
  url: 'https://omefwehdgfifeoibisth.supabase.co',
  /* Publishable, by design public. Row-level security is the door. */
  key: 'sb_publishable_YKm0-DevDi__Ua5xH9T6Ig_t_Vbze4p',
};

const BACKOFF_MS = [600, 1500, 3000, 6000];
const HEARTBEAT_MS = 25000;
const JOIN_TIMEOUT_MS = 9000;

/** The project the arena speaks to: a configured cloud project, else the public one. */
export function arenaProject() {
  const cloud = cloudConfig();
  if (cloud) return { url: cloud.url, key: cloud.key };
  return { ...DEFAULT_PROJECT };
}

/** A browser without WebSocket can still fight the CPU; it cannot fight a person. */
export const onlineArenaReady = () => typeof WebSocket === 'function' && Boolean(arenaProject()?.url);

function socketUrl({ url, key }) {
  const base = String(url || '').replace(/^http/, 'ws').replace(/\/+$/, '');
  /* `vsn=2.0.0` is the array frame the documentation shows; the `/realtime/v1`
     path is the one the hosted project answers on. */
  return `${base}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=2.0.0`;
}

/**
 * One joined channel.
 *
 * `onEvent(event, payload)` hears broadcasts, `onPresence(map)` hears the whole
 * presence snapshot after every change (the protocol hands diffs, and every
 * caller here wants "who is standing in the lobby now"), and `onStatus(state)`
 * says `open`, `closed` or `error`.
 */
export class RealtimeChannel {
  constructor(name, { key, onEvent, onPresence, onStatus, retry = false } = {}) {
    this.topic = `realtime:${name}`;
    this.key = key || name;
    this.onEvent = onEvent || (() => {});
    this.onPresence = onPresence || (() => {});
    this.onStatus = onStatus || (() => {});
    this.retry = retry;
    this.socket = null;
    this.joinRef = null;
    this.ref = 0;
    this.heartbeat = 0;
    this.backoff = 0;
    this.wanted = false;
    this.meta = null;
    this.presence = new Map();
    this.joined = null;
    this.resolve = null;
    this.reject = null;
  }

  #next() {
    this.ref += 1;
    return String(this.ref);
  }

  #push(event, payload) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify([this.joinRef, this.#next(), this.topic, event, payload]));
    return true;
  }

  /** Join the channel. Resolves once the socket has said yes. */
  open() {
    if (this.joined) return this.joined;
    this.wanted = true;
    this.joined = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.#connect();
    return this.joined;
  }

  #connect() {
    let socket;
    try {
      socket = new WebSocket(socketUrl(arenaProject()));
    } catch {
      this.onStatus('error');
      this.#fail(new Error('The arena socket could not open.'));
      return;
    }
    this.socket = socket;
    const timer = setTimeout(() => {
      if (socket.readyState !== 1) {
        try { socket.close(); } catch { /* already gone */ }
      }
    }, JOIN_TIMEOUT_MS);

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      this.joinRef = this.#next();
      socket.send(JSON.stringify([this.joinRef, this.joinRef, this.topic, 'phx_join', {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: this.key },
          postgres_changes: [],
        },
      }]));
      this.heartbeat = setInterval(() => {
        const socketNow = this.socket;
        if (socketNow?.readyState === 1) {
          socketNow.send(JSON.stringify([null, this.#next(), 'phoenix', 'heartbeat', {}]));
        }
      }, HEARTBEAT_MS);
    });

    socket.addEventListener('message', (event) => this.#hear(event.data));
    socket.addEventListener('error', () => this.onStatus('error'));
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      clearInterval(this.heartbeat);
      this.heartbeat = 0;
      this.socket = null;
      this.joinRef = null;
      this.presence.clear();
      this.onStatus('closed');
      if (!this.wanted) return;
      if (!this.retry) {
        this.#fail(new Error('The match connection closed.'));
        return;
      }
      const wait = BACKOFF_MS[Math.min(this.backoff, BACKOFF_MS.length - 1)];
      this.backoff += 1;
      setTimeout(() => {
        if (this.wanted && !this.socket) {
          this.joinRef = null;
          this.#connect();
        }
      }, wait);
    });
  }

  #fail(err) {
    this.joined = null;
    const reject = this.reject;
    this.reject = null;
    this.resolve = null;
    reject?.(err);
  }

  #hear(raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(frame) || frame.length < 5) return;
    const [, ref, topic, event, payload] = frame;
    if (topic !== this.topic) return;

    if (event === 'phx_reply' && ref === this.joinRef) {
      if (payload?.status === 'ok') {
        this.backoff = 0;
        this.onStatus('open');
        if (this.meta) this.track(this.meta);
        this.resolve?.();
        this.resolve = null;
        this.reject = null;
      } else {
        this.onStatus('error');
        this.#fail(new Error(payload?.response?.reason || 'The arena channel refused the join.'));
      }
      return;
    }
    if (event === 'presence_state') {
      this.presence = new Map(
        Object.entries(payload || {}).map(([key, box]) => [key, { ...(box?.metas?.[0] || {}) }]),
      );
      this.onPresence(this.snapshot());
      return;
    }
    if (event === 'presence_diff') {
      for (const [key, box] of Object.entries(payload?.joins || {})) {
        this.presence.set(key, { ...(box?.metas?.[0] || {}) });
      }
      for (const key of Object.keys(payload?.leaves || {})) this.presence.delete(key);
      this.onPresence(this.snapshot());
      return;
    }
    if (event === 'broadcast') {
      this.onEvent(String(payload?.event || ''), payload?.payload || {});
      return;
    }
    if (event === 'phx_error' || event === 'phx_close') {
      try { this.socket?.close(); } catch { /* already gone */ }
    }
  }

  snapshot() {
    const rows = new Map();
    for (const [key, meta] of this.presence) {
      const { phx_ref, phx_ref_prev, ...rest } = meta || {};
      rows.set(key, { key, ...rest });
    }
    return rows;
  }

  send(event, payload) {
    return this.#push('broadcast', { type: 'broadcast', event, payload });
  }

  track(meta) {
    this.meta = meta;
    this.presence.set(this.key, { ...meta });
    return this.#push('presence', { type: 'presence', event: 'track', payload: meta });
  }

  close() {
    this.wanted = false;
    clearInterval(this.heartbeat);
    this.heartbeat = 0;
    try {
      this.socket?.close();
    } catch { /* already gone */ }
    this.socket = null;
    this.joined = null;
    this.resolve = null;
    this.reject = null;
    this.presence.clear();
    this.onStatus('closed');
  }
}
