/**
 * Duels: two cards a side, one seed, and a server that keeps the score.
 *
 * The record is the server's — both line-ups, who committed, and the win/loss
 * tally a profile prints — because a streak a browser could edit is not a streak.
 * The *fight* is not. It runs on each device from the one `seed` the duel carries,
 * which is why no arena needs a socket: two clients holding the same seed, the
 * same two line-ups and the same arithmetic arrive at the same winner, and the
 * first one to file the answer settles it. The second reads back the same result
 * rather than an error, so a race is invisible instead of alarming.
 *
 * A fight is strictly turn by turn: one card steps forward, one strike lands, and
 * only then does the other side answer. The clock is not wall time — it is a turn
 * budget, ninety seconds' worth of strikes at the pace the arena animates them —
 * so two screens that start a second apart still end on the same score. When the
 * budget runs out the side with the most hit points left takes it, which is what a
 * clock decision means anyway.
 *
 * Each card also fights with one ability, and that ability is read off the plate
 * rather than stored: the stat a card is strongest in is the way it fights. A high
 * Power card opens with an overdrive strike, Speed strikes harder and crits more,
 * Technique crits for more, Aura soaks more. Nothing is a second source of truth.
 *
 * Matchmaking pairs on the *peak* Power in a line-up and will not cross its band.
 * That is what makes a queue fair rather than merely fast: waiting for a match
 * inside twenty percent is honest, and being thrown at somebody three times your
 * size is not.
 */

import {
  cancelDuel,
  commitDuel,
  duelList,
  duelsUsable,
  fileDuel,
  isSignedIn,
  leaveDuelQueue,
  offerDuel,
  queueDuel,
  refresh,
} from './account.js';
import { cardDay, findCard, tradeCard } from './cards.js';
import { awardXp } from './level.js';
import { subscribeInbox } from './dms.js';
import { storage } from './store.js';

export const LINEUP = 2;

/** The match clock. Turns, not milliseconds, so both screens agree on the end. */
export const MATCH_MS = 90 * 1000;
const TURN_MS = 900;
const MAX_TURNS = Math.floor(MATCH_MS / TURN_MS);

/** Each card fights the way its strongest stat does. */
export const ABILITIES = {
  overdrive: { label: 'Overdrive', icon: 'flame' },
  blitz: { label: 'Blitz', icon: 'bolt' },
  focus: { label: 'Focus', icon: 'sparkles' },
  guard: { label: 'Guard', icon: 'star' },
};

/** XP a settled fight pays: a win is worth more than showing up. */
const XP_WIN = 60;
const XP_LOSS = 15;

let list = [];
let open = 0;
let waiting = false;
let rivals = 0;
let loaded = false;
let failed = false;
let inflight = null;

export const duelsAvailable = () => duelsUsable() && isSignedIn();
export const duelState = () => ({ duels: list, open, waiting, rivals, loaded, failed });

/** Anything the page can do with a duel that is not in the list is nothing. */
export const duelById = (id) => list.find((d) => d.id === String(id)) || null;

export async function loadDuels() {
  if (!duelsAvailable()) return duelState();
  if (inflight) return inflight;
  inflight = duelList()
    .then((d) => {
      inflight = null;
      list = Array.isArray(d?.duels) ? d.duels : [];
      open = Number(d?.open) || 0;
      waiting = Boolean(d?.waiting);
      rivals = Number(d?.rivals) || 0;
      loaded = true;
      return duelState();
    })
    .catch(() => {
      inflight = null;
      failed = true;
      loaded = true;
      return duelState();
    });
  return inflight;
}

/* ---- the today tally ---------------------------------------------------
   The daily quests ask how many fights this device took part in and how many it
   won *today*, which the account record does not keep — it stores the lifetime
   figures. So the day is counted here, in the same 04:00 shape the packs and the
   wheel use, and it is written only when a result is actually filed. */
export function todayTally() {
  const day = cardDay().key;
  const raw = storage.read('duels:day', null);
  if (!raw || raw.day !== day) return { day, fought: 0, won: 0 };
  return { day, fought: Number(raw.fought) || 0, won: Number(raw.won) || 0 };
}

function tally(kind) {
  const t = todayTally();
  t[kind] += 1;
  t.fought = Math.max(t.fought, kind === 'won' ? 1 : 0);
  storage.write('duels:day', t);
  return t;
}

/** A finished fight — replayed or played — counts for the daily quests here. */
export function countToday(won) {
  tally('fought');
  if (won) tally('won');
}

/* ---- the engine ---------------------------------------------------------
   A card is four numbers, and every one of them has a job in a fight: Power is
   how hard it hits and how much it can take, Speed decides who strikes first in a
   clash, Technique is the chance of a critical, Aura is how much of the incoming
   hit it shrugs off. Nothing else enters — no tier bonus, no level bonus, no
   house edge — so the plate on the card is the whole story of the card.
   */
function prng(seedText) {
  let h = 2166136261;
  const s = String(seedText || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stat = (card, key) => Number(card?.stats?.[key]) || Number(card?.[key]) || 0;

/**
 * Which way a card fights, read from the stat it leans on hardest.
 *
 * The shares in `statsFor` are not equal — Speed is graded at .86, Technique at
 * .92 and Aura at .8 of Power — so each figure is divided by its own share first.
 * Otherwise Technique would win almost every card and the four abilities would be
 * one ability with four names.
 */
function abilityFor(power, speed, technique, aura) {
  const marks = [
    ['overdrive', power],
    ['blitz', speed / 0.86],
    ['focus', technique / 0.92],
    ['guard', aura / 0.8],
  ];
  return marks.reduce((best, row) => (row[1] > best[1] ? row : best))[0];
}

/** The four combat figures, derived from the published card. */
function fighter(card) {
  const power = stat(card, 'power');
  const speed = stat(card, 'speed');
  const technique = stat(card, 'technique');
  const aura = stat(card, 'aura');
  const maxHp = Math.round(140 + power * 0.55);
  return {
    key: card?.key || '',
    name: card?.name || '',
    image: card?.image || null,
    lv: Number(card?.lv) || 1,
    serial: card?.serial ?? 0,
    ultimate: Boolean(card?.ultimate),
    power,
    speed,
    technique,
    aura,
    maxHp,
    hp: maxHp,
    atk: 16 + power * 0.12,
    ability: abilityFor(power, speed, technique, aura),
    struck: false,
  };
}

const sideOf = (duel, who) => (duel?.lineups?.[who] || []).map(fighter);

/**
 * One strike: what the striker lands, and what the target is left standing on.
 *
 * `struck` is why Overdrive is a moment rather than a bonus: the first strike a
 * card makes after stepping in is the one that gets it, so the ability belongs to
 * the entrance instead of to every swing.
 */
function clash(a, b, rand) {
  const chance = Math.min(0.6, a.technique / Math.max(1, a.technique + b.technique) + (a.ability === 'blitz' ? 0.1 : 0));
  const crit = rand() < chance;
  const roll = 0.9 + rand() * 0.2;
  const soak = Math.min(b.ability === 'guard' ? 0.45 : 0.3, b.aura / (b.aura + 700));
  const boost = a.ability === 'overdrive' && !a.struck ? 1.35 : a.ability === 'blitz' ? 1.12 : 1;
  const critMul = a.ability === 'focus' ? 1.9 : 1.6;
  const dmg = Math.max(1, Math.round(a.atk * roll * boost * (crit ? critMul : 1) * (1 - soak)));
  a.struck = true;
  b.hp = Math.max(0, b.hp - dmg);
  return { dmg, crit, left: b.hp, boost: boost > 1 };
}

const TOTAL_HP = (rows) => rows.reduce((n, f) => n + f.hp, 0);
const alive = (rows) => rows.filter((f) => f.hp > 0);
const front = (rows) => rows.find((f) => f.hp > 0) || null;

/**
 * Run a duel to the end, one strike at a time.
 *
 * The quicker card opens the round and the slower one answers; a card that falls
 * to the opening blow does not get its answer. Each turn carries the clock it
 * leaves behind, so the arena can print a countdown that matches the arithmetic
 * rather than a wall clock that started when somebody pressed a button.
 *
 * When the turn budget is spent the fight is called on remaining hit points, the
 * same decision a time limit produces in any other game. The budget is a constant,
 * not a timestamp, so both screens still land on the same winner.
 */
export function fight(duel) {
  const from = sideOf(duel, 'from');
  const to = sideOf(duel, 'to');
  if (!from.length || !to.length) return null;
  const rand = prng(duel.seed);
  const turns = [];
  let n = 0;
  while (n < MAX_TURNS && alive(from).length && alive(to).length) {
    const a = front(from);
    const b = front(to);
    /* The quicker card opens the clash; equal speed is settled by the seed rather
       than by array order, so a mirror match still has a real first blow. */
    const first = a.speed === b.speed ? rand() < 0.5 : a.speed > b.speed;
    const order = first
      ? [['from', a, 'to', b], ['to', b, 'from', a]]
      : [['to', b, 'from', a], ['from', a, 'to', b]];
    for (const [side, x, other, y] of order) {
      if (n >= MAX_TURNS || x.hp <= 0 || y.hp <= 0) continue;
      n += 1;
      const hit = clash(x, y, rand);
      turns.push({
        n,
        side,
        to: other,
        by: x.key,
        byName: x.name,
        byLv: x.lv,
        toName: y.name,
        ability: x.ability,
        boosted: hit.boost,
        dmg: hit.dmg,
        crit: hit.crit,
        left: hit.left,
        down: y.hp <= 0,
        clock: Math.max(0, MATCH_MS - n * TURN_MS),
      });
    }
  }
  const score = [TOTAL_HP(from), TOTAL_HP(to)];
  const winner = score[0] === score[1] ? (rand() < 0.5 ? 'from' : 'to') : score[0] > score[1] ? 'from' : 'to';
  return {
    turns,
    score,
    winner,
    from,
    to,
    capped: n >= MAX_TURNS,
    clock: Math.max(0, MATCH_MS - n * TURN_MS),
    turnMs: TURN_MS,
  };
}

/* ---- the actions -------------------------------------------------------- */
/** Two binder keys, in the shape the server validates and both ends can draw. */
export function lineupOf(keys) {
  return (keys || []).slice(0, LINEUP).map((k) => tradeCard(findCard(k))).filter(Boolean);
}

/** Challenge one member by hand. */
export async function challenge(to, keys, note = '') {
  const cards = lineupOf(keys);
  if (cards.length !== LINEUP) return { error: 'Pick two cards first.' };
  const d = await offerDuel({ to, cards, note });
  await loadDuels();
  return { duel: d?.duel || null };
}

/** Step into the lobby — or meet whoever is already standing in it. */
export async function queueUp(keys) {
  const cards = lineupOf(keys);
  if (cards.length !== LINEUP) return { error: 'Pick two cards first.' };
  const d = await queueDuel(cards);
  await loadDuels();
  return d;
}

export async function leaveQueue() {
  const d = await leaveDuelQueue();
  await loadDuels();
  return d;
}

/** Accept a challenge and commit my two. */
export async function commit(id, keys) {
  const cards = lineupOf(keys);
  if (cards.length !== LINEUP) return { error: 'Pick two cards first.' };
  const d = await commitDuel(id, cards);
  await loadDuels();
  return { duel: d?.duel || null };
}

export async function callOff(id) {
  const d = await cancelDuel(id);
  await loadDuels();
  return { duel: d?.duel || null };
}

/**
 * Settle a ready duel. The fight is computed here so the arena can animate it,
 * then filed — and the answer the server gives back is what the page paints, not
 * the answer this device reached. A disagreement is therefore visible rather than
 * silently believed, and the win/loss row both profiles show is the server's.
 */
export async function settle(duel) {
  const run = fight(duel);
  if (!run) return { error: 'That duel is not ready yet.' };
  const me = duel.mine;
  const d = await fileDuel(duel.id, { winner: run.winner, score: run.score });
  const settled = d?.duel || null;
  await loadDuels();
  if (settled?.result) {
    /* The winner the server stored is an account id, and `mine` is a side name, so
       the two are only comparable through the person record the duel carries.
       Getting this wrong would congratulate the loser, which is the one mistake a
       duel page cannot make. */
    const myId = settled.mine ? settled[settled.mine]?.id : null;
    const won = myId != null && String(settled.result.winner) === String(myId);
    const lost = myId != null && !won;
    tally('fought');
    if (won) tally('won');
    awardXp(won ? XP_WIN : XP_LOSS, won ? 'duel-win' : 'duel-loss');
    /* The win, the loss and the streak are all the server's numbers, so the
       account record is pulled again before the page paints them. */
    await refresh().catch(() => null);
    return { run, duel: settled, won, lost, side: me };
  }
  return { run, duel: settled };
}

/* ---- the live pipe ------------------------------------------------------
   One socket serves the whole inbox, so a duel arrival is a filtered event on it
   rather than a second connection per feature. Pages subscribe for as long as
   they are mounted and the closer runs with the view. */
export function subscribeDuels(fn) {
  return subscribeInbox((state, event) => {
    if (!event || event.kind !== 'duel' || !event.duel) return;
    const next = event.duel;
    const at = list.findIndex((d) => d.id === next.id);
    list = at >= 0 ? list.map((d, i) => (i === at ? next : d)) : [next, ...list];
    open = list.filter((d) => d.state === 'awaiting' || d.state === 'ready').length;
    fn(next);
  });
}

/** A duel both ends have committed to — the only kind an arena can run. */
export const isReady = (duel) => duel?.state === 'ready';
export const awaitingMe = (duel) => duel?.state === 'awaiting' && duel?.mine === 'to';
