/**
 * The daily wheel: five spins, and the server decides where each one stops.
 *
 * The roll cannot happen in the browser. A wheel a page can re-run until it likes
 * the answer is a slot machine with a reset button on the back, and the whole
 * promise of this one is that a Legendary at fifty in a hundred thousand means
 * fifty in a hundred thousand. So `POST /api/fortune/spin` draws the slice, writes
 * it onto the account, and hands the index back — and the page's only job is to
 * turn the wheel until that index is under the pointer. What you watch is the
 * animation, not the decision.
 *
 * The prize is then *applied* here, because the things it grants live on this
 * device: packs go into the bank `lib/cards.js` keeps, a card is written into the
 * binder, XP lands on the ladder in `lib/level.js`. A background is the exception —
 * the server has already put it on the account, since that is where the shelf of
 * unlocked themes is kept.
 *
 * Five spins a day, counted in this browser under `solvn_spins_YYYY-MM-DD` so the
 * button knows the cap before any request goes out. The server keeps the same cap
 * per account and hands back its count with every read, because a cleared key must
 * not become a sixth spin — the local counter is the display, not the permission.
 * The day turns at local midnight, which is the same edge the key is named after.
 */

import { fortuneRead, fortuneSpin, fortuneUsable, fortuneFace, isSignedIn, refresh } from './account.js';
import { bankPacks, grantTier } from './cards.js';
import { awardXp } from './level.js';

/** The cap the wheel enforces, client and server. */
export const DAILY_SPINS = 5;

const KEY_PREFIX = 'solvn_spins_';
const pad = (n) => String(n).padStart(2, '0');

/** The key the day is counted under: local date, so midnight is the reset. */
export function spinDayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight after `at`, the moment a fresh set of spins opens. */
export function nextSpinAt(at = Date.now()) {
  const d = new Date(at);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/* localStorage can refuse to write in a private window. A refused write leaves
   the counter at zero, which is the safe direction: the server still caps the
   account and answers 409, and the next read mirrors that count back in. */
function readSpins() {
  try {
    const n = Number(localStorage.getItem(KEY_PREFIX + spinDayKey())) || 0;
    return Math.max(0, Math.min(DAILY_SPINS, Math.floor(n)));
  } catch {
    return 0;
  }
}

function writeSpins(n) {
  try {
    localStorage.setItem(KEY_PREFIX + spinDayKey(), String(Math.max(0, Math.min(DAILY_SPINS, Math.floor(n)))));
  } catch {
    /* nothing to do; see readSpins */
  }
}

/** Drop yesterday's counters so the key set never grows beyond one entry. */
function pruneDays() {
  try {
    const keep = KEY_PREFIX + spinDayKey();
    const stale = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(KEY_PREFIX) && key !== keep) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    /* storage is optional here */
  }
}

export const spinsToday = () => readSpins();
export const spinsLeft = () => DAILY_SPINS - readSpins();
const atLimit = () => spinsLeft() <= 0;

let state = { prizes: [], held: [], level: 1, spinsToday: 0, prize: null, faces: 0, spins: 0, nextAt: 0, at: 0, loaded: false, failed: false };
let busy = null;

export const fortuneState = () => state;
export const fortuneAvailable = () => fortuneUsable() && isSignedIn();

/** The slices, what I hold and whether today's spin is gone. */
export async function loadFortune() {
  if (!fortuneAvailable()) return { ...state, loaded: false };
  if (busy) return busy;
  busy = fortuneRead()
    .then((d) => {
      busy = null;
      /* The server's count wins when it is ahead of this browser: a cleared key
         or a second tab must not buy another spin. A count that is behind is
         left alone, because the local day is the one the button is counting. */
      const server = Math.max(0, Math.min(DAILY_SPINS, Number(d.spinsToday) || 0));
      if (server > readSpins()) writeSpins(server);
      pruneDays();
      state = { ...state, ...d, spinsToday: readSpins(), nextAt: Number(d.nextAt) || nextSpinAt(), loaded: true, failed: false };
      return state;
    })
    .catch(() => {
      busy = null;
      state = { ...state, spinsToday: readSpins(), nextAt: state.nextAt || nextSpinAt(), loaded: true, failed: true };
      return state;
    });
  return busy;
}

/**
 * Spin. Resolves with the prize the server drew and the index to stop on.
 *
 * The cap is checked twice on purpose — once here before a request is sent, and
 * once on the server, which is the only copy that counts across devices. A
 * refused spin leaves the wheel exactly where it was. A 409 from the server means
 * this browser's key was behind (another tab, or a cleared store), so the local
 * counter is raised to the cap rather than let the page offer a sixth spin.
 */
export async function spin() {
  if (!fortuneAvailable()) return { blocked: 'signedout' };
  if (atLimit()) return { blocked: 'limit' };
  try {
    const d = await fortuneSpin();
    const prize = d.prize || null;
    const server = Number(d.spinsToday);
    writeSpins(Math.max(readSpins() + 1, Number.isFinite(server) ? server : 0));
    state = {
      ...state,
      prize,
      faces: d.faces ?? state.faces,
      spins: (Number(state.spins) || 0) + 1,
      spinsToday: readSpins(),
      nextAt: Number(d.nextAt) || nextSpinAt(),
    };
    await apply(prize);
    return { prize, index: Number(d.index) || 0, prizes: state.prizes, left: spinsLeft() };
  } catch (err) {
    if (err?.status === 409) {
      writeSpins(DAILY_SPINS);
      state = { ...state, spinsToday: DAILY_SPINS, nextAt: nextSpinAt() };
      return { blocked: 'limit' };
    }
    return { blocked: 'failed', message: err?.message || '' };
  }
}

/**
 * Hand the prize over. Each kind has one owner, and this is the only place that
 * knows all three: the bank, the binder and the ladder.
 *
 * A card is drawn at the tier the wheel promised — the same `build` a pack runs, so
 * the numbers on it are the numbers that tier rolls. XP goes through `awardXp`, so
 * a 120-XP consolation can level you up on the way. A background needs nothing
 * here; the account record already wears it, so this only pulls the fresh copy.
 */
async function apply(prize) {
  if (!prize) return;
  if (prize.kind === 'xp') awardXp(prize.amount, 'fortune');
  if (prize.kind === 'pack') bankPacks(prize.amount);
  if (prize.kind === 'card') await grantTier(prize.amount).catch(() => null);
  if (prize.kind === 'banner' || prize.kind === 'avatar') await refresh().catch(() => null);
}

/* ---- spending a won face ---------------------------------------------
   A portrait prize is a slot, not a picture: which character is worth wearing is
   a thing only the member can say, so the server hands out the right to choose
   and the choice is made here, against the roster the binder already pulls from.
   The list of ids the account has unlocked is what the profile gallery reads. */
export async function pickFace(id) {
  if (!fortuneAvailable()) return null;
  const d = await fortuneFace(Number(id) || 0);
  state = { ...state, faces: Number(d?.faces) || 0 };
  return d?.user || null;
}

/** Milliseconds until the next set of spins, for the countdown under the wheel. */
export const spinInMs = (at = Date.now()) => Math.max(0, (Number(state.nextAt) || nextSpinAt(at)) - at);
