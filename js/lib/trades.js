/**
 * The trade desk.
 *
 * A deal lives on the server; the cards live in this browser's binder. Nothing
 * here can move a card across the wire — an offer carries a *description* of the
 * copies each end is putting up, and the two people in it sign that description.
 * This file is what keeps those two halves honest: every time the ledger is read
 * or a deal moves on the socket, the binder is reconciled against it.
 *
 * The reconciliation is the entire safety of the thing.
 * Signing puts my side into escrow, out of the binder and out of the fusable
 * pile, so a card cannot be spent twice or fused away mid-deal. A deal called
 * off, lapsed or edited after I signed takes the escrow back — an edit wipes both
 * signatures on purpose, so an approval never points at cards that changed
 * underneath it. A completed deal drops my escrow for good and adds what the
 * other end put up, rebuilt from the serial stamped on it so the numbers are the
 * ones its owner was shown. And `granted` in the binder remembers which completed
 * deals were already applied, because the ledger is re-read on every visit.
 *
 * One more rule, and it is the reason this store exists rather than a couple of
 * fetch calls in a page: a card only ever leaves a member who pressed sign.
 */

import {
  amendTrade,
  cancelTrade,
  currentUser,
  isSignedIn,
  onAccount,
  offerTrade,
  signTrade,
  tradeList,
  tradesUsable,
} from './account.js';
import {
  escrowOf,
  escrowReturn,
  escrowSettle,
  escrowTake,
  grantTraded,
  markGranted,
  wasGranted,
} from './cards.js';
import { subscribeInbox } from './dms.js';

const listeners = new Set();

let trades = [];
let open = 0;
let loaded = false;
let failed = false;

const emit = () => {
  const state = { trades, open, loaded, failed };
  for (const fn of listeners) {
    try {
      fn(state);
    } catch { /* one deaf listener must not mute the others */ }
  }
};

export const tradeUsable = () => tradesUsable();
export const tradesState = () => ({ trades, open, loaded, failed });

/** `fn(state)` — called once on subscribe, so a page paints without waiting. */
export function subscribeTrades(fn) {
  listeners.add(fn);
  fn(tradesState());
  return () => listeners.delete(fn);
}

/** Which end of the deal the viewer stands on, in cards. */
export const mySide = (t) => (t.mine === 'want' ? t.want : t.give);
export const theirSide = (t) => (t.mine === 'want' ? t.give : t.want);

/**
 * One deal, one binder answer: what should this device be holding right now?
 * Everything below is a rule about that, never about the request that told us.
 */
function reconcile(t) {
  if (!currentUser() || !t.mine) return;
  const held = escrowOf(t.id).length > 0;

  if (t.state === 'awaiting') {
    /* Signed and holding nothing → the escrow was never taken (or the binder was
       cleared since). Unsigned and holding something → the other side edited the
       deal out from under my signature, so my copies come home. */
    if (t.iSigned && !held) escrowTake(t.id, mySide(t));
    else if (!t.iSigned && held) escrowReturn(t.id);
    return;
  }

  if (t.state === 'done') {
    if (held) escrowSettle(t.id);
    if (!wasGranted(t.id)) {
      grantTraded(theirSide(t));
      markGranted(t.id);
    }
    return;
  }

  /* cancelled / expired: the only debt left is an escrow that owes its cards back. */
  if (held) escrowReturn(t.id);
}

function store(list) {
  trades = [...(list || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  open = trades.filter((t) => t.state === 'awaiting').length;
  for (const t of trades) reconcile(t);
}

/** Put one deal in the list, or replace the copy already there. */
function upsert(t) {
  if (!t) return;
  const at = trades.findIndex((row) => row.id === t.id);
  if (at >= 0) trades[at] = t;
  else trades = [t, ...trades];
  open = trades.filter((row) => row.state === 'awaiting').length;
  reconcile(t);
  emit();
}

export async function refreshTrades() {
  if (!tradesUsable() || !isSignedIn()) return tradesState();
  try {
    const data = await tradeList();
    store(data.trades);
    loaded = true;
    failed = false;
  } catch {
    /* A ledger that will not answer is not a ledger of empty deals: the escrow
       stays exactly as it was, because a card taken back on a bad read would be
       a card that can be spent twice. */
    failed = true;
    loaded = true;
  }
  emit();
  return tradesState();
}

/* ---- the four writes -------------------------------------------------- */
export async function sendOffer({ to, give, want, note }) {
  const data = await offerTrade({ to, give, want, note });
  upsert(data.trade);
  return data.trade;
}

export async function signDeal(id) {
  const data = await signTrade(id);
  upsert(data.trade);
  return data.trade;
}

export async function changeSide(id, side) {
  const data = await amendTrade(id, side);
  upsert(data.trade);
  return data.trade;
}

export async function callOff(id) {
  const data = await cancelTrade(id);
  upsert(data.trade);
  return data.trade;
}

/* A deal that moved is told to both ends on the inbox pipe, and reconciling it
   here is the whole of the live behaviour: a partner's signature takes my cards
   aside, a call-off hands them back, a completion pays mine over and brings
   theirs in — with no reload and no page looking at it. */
subscribeInbox((state, event) => {
  if (event?.kind === 'trade') upsert(event.trade);
});

/* The session is the only moment this is worth asking unprompted: a session that
   was restored after a night away is when a deal has most often lapsed, and the
   account that just changed is the one whose binder the escrow lives in. Every
   other read comes from the page looking at the list. */
onAccount(() => {
  if (isSignedIn()) refreshTrades();
});
