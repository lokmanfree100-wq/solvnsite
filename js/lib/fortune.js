/**
 * The daily wheel: one spin, and the server decides where it stops.
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
 * The day turns at 04:00, the same hour the packs use, so one countdown on the
 * page means one reset and nobody has to work out which of two midnights a prize
 * followed.
 */

import { fortuneRead, fortuneSpin, fortuneUsable, fortuneFace, isSignedIn, refresh } from './account.js';
import { bankPacks, grantTier, nextResetAt } from './cards.js';
import { awardXp } from './level.js';

let state = { prizes: [], held: [], level: 1, spun: false, prize: null, faces: 0, spins: 0, nextAt: 0, at: 0, loaded: false, failed: false };
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
      state = { ...state, ...d, loaded: true, failed: false };
      return state;
    })
    .catch(() => {
      busy = null;
      state = { ...state, loaded: true, failed: true };
      return state;
    });
  return busy;
}

/**
 * Spin. Resolves with the prize the server drew and the index to stop on.
 *
 * The block is checked twice on purpose — once here so a double-tap cannot send
 * two posts, and once on the server, which is the only copy that counts. A
 * refused spin leaves the wheel exactly where it was.
 */
export async function spin() {
  if (!fortuneAvailable()) return { blocked: 'signedout' };
  if (state.spun) return { blocked: 'used' };
  try {
    const d = await fortuneSpin();
    const prize = d.prize || null;
    state = { ...state, spun: true, prize, faces: d.faces ?? state.faces, spins: (Number(state.spins) || 0) + 1, nextAt: d.nextAt || nextResetAt() };
    await apply(prize);
    return { prize, index: Number(d.index) || 0, prizes: state.prizes };
  } catch (err) {
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

/** Milliseconds until the next spin, for the countdown under the wheel. */
export const spinInMs = (at = Date.now()) => Math.max(0, (Number(state.nextAt) || nextResetAt(at)) - at);
