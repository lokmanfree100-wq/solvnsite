/**
 * The fight you play, as opposed to the fight you watch.
 *
 * `lib/duels.js` runs a duel in one pass from a seed so two screens can replay the
 * same answer. A person pressing "strike" cannot be computed in advance, so this
 * engine is the other shape: every action is a small deterministic step, and the
 * same list of steps always lands on the same hit points. Two clients that hear
 * each other's steps in order therefore stay in step without a referee.
 *
 * The rules are the ones the arena already prints. Power is the hit and the
 * health, Speed opens the clash, Technique is the critical, Aura is the soak, and
 * a card fights the way its strongest stat does. On top of that each card carries
 * its own kit: a signature it may spend once, and a school move that runs on a
 * four-step cooldown. Overdrive is one heavy blow, Blitz strikes harder and crits
 * more often, Focus trades raw force for a critical that pierces a brace, and
 * Guard gives back health and a shield. Brace is the free move — it halves the
 * next hit and ends the turn, which is what makes a turn a decision rather than a
 * coin flip.
 *
 * The school move is read from the same dominant stat: Power gets Ground Quake
 * (the blow that breaks a brace), Speed gets Gale Flurry (two cuts in one turn),
 * Technique gets Piercing Spike (a critical that ignores a guard), and Aura gets
 * Vital Mend (health and a ward). Both clients run this same table, so a skill is
 * one step like any other and an online match never needs a referee for it.
 *
 * The clock is ninety seconds of real time, and it is the one thing that is not a
 * step: both screens read the same `at`, so both call time on the same state.
 * When the budget is spent the side with more hit points left takes it, and a
 * dead-level finish belongs to the side that opened the match. That side is known
 * to both clients, so the tie is the same answer on both screens.
 */

import { TOP_LV, findCard, ownedEntries, tradeCard } from './cards.js';

export const LINEUP = 2;
export const MATCH_MS = 90 * 1000;
/** How long the arena waits on your move before taking a plain strike for you. */
export const IDLE_MS = 12 * 1000;

export const ABILITIES = {
  overdrive: { label: 'Overdrive', icon: 'flame' },
  blitz: { label: 'Blitz', icon: 'bolt' },
  focus: { label: 'Focus', icon: 'sparkles' },
  guard: { label: 'Guard', icon: 'star' },
};

/**
 * The school move of each build. It is the second button a card brings to the
 * stage, and unlike the signature it comes back: `SKILL_COOLDOWN` steps (two of
 * that card's own turns) buys another use.
 */
export const SKILLS = {
  quake: { label: 'Ground Quake', icon: 'flame' },
  flurry: { label: 'Gale Flurry', icon: 'bolt' },
  spike: { label: 'Piercing Spike', icon: 'sparkles' },
  mend: { label: 'Vital Mend', icon: 'star' },
};

export const SKILL_COOLDOWN = 4;

export const ACTIONS = ['strike', 'brace', 'ability', 'skill'];

const num = (value) => Number(value) || 0;

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

/**
 * Which way a card fights, read from the stat it leans on hardest.
 *
 * The four stats are not graded equally, so each is divided by its own share
 * before they are compared. Without that, Technique would win almost every card
 * and the four abilities would be one ability with four names.
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

/** The school move that pairs with each signature. */
const KIT = { overdrive: 'quake', blitz: 'flurry', focus: 'spike', guard: 'mend' };

/** One card as the battle sees it: health, hit, and the kit it may spend. */
function fighter(card, side, slot) {
  const power = num(card?.power ?? card?.stats?.power);
  const speed = num(card?.speed ?? card?.stats?.speed);
  const technique = num(card?.technique ?? card?.stats?.technique);
  const aura = num(card?.aura ?? card?.stats?.aura);
  const maxHp = Math.round(140 + power * 0.55);
  const ability = abilityFor(power, speed, technique, aura);
  return {
    id: `${side}-${slot}`,
    key: card?.key || '',
    slot,
    name: card?.name || '',
    image: card?.image || null,
    lv: num(card?.lv) || 1,
    serial: card?.serial ?? 0,
    ultimate: Boolean(card?.ultimate),
    power,
    speed,
    technique,
    aura,
    maxHp,
    hp: maxHp,
    atk: 16 + power * 0.12,
    ability,
    skill: KIT[ability],
    skillReadyAt: 0,
    used: false,
    shield: false,
    struck: false,
  };
}

/** Is a card's school move off cooldown at step `n`? Both screens count the same
    `n`, so neither can press a skill the other believes is still cooling. */
export const skillReady = (f, n) => Boolean(f) && (f.skillReadyAt || 0) <= Number(n || 0);

/** Turns left on a school move, one per own turn — what the button prints. */
export const skillWait = (f, n) =>
  Math.max(0, Math.ceil(((f?.skillReadyAt || 0) - Number(n || 0)) / 2));

const sideOf = (state, side) => state.sides[side];
const other = (side) => (side === 'mine' ? 'rival' : 'mine');

/** The card in front of a side: the first one still standing. */
export function activeOf(state, side) {
  return sideOf(state, side).cards.find((f) => f.hp > 0) || null;
}

export const totalHp = (state, side) =>
  sideOf(state, side).cards.reduce((n, f) => n + Math.max(0, f.hp), 0);

export const scoreOf = (state) => [totalHp(state, 'mine'), totalHp(state, 'rival')];

export const timeLeft = (state, now = Date.now()) => Math.max(0, MATCH_MS - (now - state.at));

/** Which side this client calls the opener; the other client calls it the rival. */
export const openedBy = (state) => state.opener;

/**
 * Build a fresh fight.
 *
 * `mine` and `rival` are `{ name, handle, cards }` where each card is the
 * published shape the server and the other player exchange. `opener` is written
 * from this client's point of view, so a seed tie resolves the same way on both
 * ends.
 */
export function makeBattle({ seed, at = Date.now(), mine, rival, opener = 'mine' }) {
  const rand = prng(seed);
  const state = {
    seed: String(seed || ''),
    at: Number(at) || Date.now(),
    rand,
    opener: opener === 'rival' ? 'rival' : 'mine',
    n: 0,
    over: false,
    winner: null,
    reason: null,
    log: [],
    sides: {
      mine: {
        name: mine?.name || '',
        handle: mine?.handle || '',
        avatar: mine?.avatar || null,
        cpu: Boolean(mine?.cpu),
        cards: (mine?.cards || []).slice(0, LINEUP).map((c, i) => fighter(c, 'mine', i)),
      },
      rival: {
        name: rival?.name || '',
        handle: rival?.handle || '',
        avatar: rival?.avatar || null,
        cpu: Boolean(rival?.cpu),
        cards: (rival?.cards || []).slice(0, LINEUP).map((c, i) => fighter(c, 'rival', i)),
      },
    },
  };
  if (!state.sides.mine.cards.length || !state.sides.rival.cards.length) return null;

  /**
   * Who opens.
   *
   * Speed decides it. An exact tie is settled on the card itself — its key, then
   * its serial — because the same two cards must produce the same answer on both
   * screens, and "mine" means the opposite card on the other screen. Only two
   * identical cards fall through to `opener`, which the caller sets to the side
   * that opened the match on each screen.
   */
  const a = state.sides.mine.cards[0];
  const b = state.sides.rival.cards[0];
  let mineFirst;
  if (a.speed !== b.speed) mineFirst = a.speed > b.speed;
  else if (a.key !== b.key) mineFirst = a.key < b.key;
  else if (String(a.serial) !== String(b.serial)) mineFirst = String(a.serial) < String(b.serial);
  else mineFirst = opener === 'mine';
  state.turn = mineFirst ? 'mine' : 'rival';
  state.opener = state.turn;
  state.log.push({ kind: 'start', side: state.turn, at: state.at });
  return state;
}

/* How each move lands. The signature and the school move share one table so the
   engine has a single place to read a blow from; `strike` is the plain one. */
const PROFILES = {
  strike: { boost: 1, critMul: 1.6, chance: 0, hits: 1 },
  overdrive: { boost: 1.75, critMul: 1.6, chance: 0, hits: 1 },
  blitz: { boost: 1.25, critMul: 1.6, chance: 0.12, hits: 1 },
  focus: { boost: 1.55, critMul: 1.9, chance: 0, hits: 1, pierce: true },
  quake: { boost: 1.45, critMul: 1.7, chance: 0.05, hits: 1, breakShield: true },
  flurry: { boost: 0.72, critMul: 1.5, chance: 0.14, hits: 2 },
  spike: { boost: 1.5, critMul: 2, chance: 0.08, hits: 1, pierce: true },
};

/**
 * One blow.
 *
 * `shield` is the reason a brace is worth a turn: it halves one incoming hit and
 * then is spent. Focus and Piercing Spike ignore it, Ground Quake breaks it, and
 * Gale Flurry spends it on its first cut — that is the trade that keeps Brace
 * from being an automatic answer to everything.
 */
function hit(state, actor, target, kind) {
  const prof = PROFILES[kind === 'ability' ? actor.ability : kind === 'skill' ? actor.skill : 'strike'];
  const rand = state.rand;
  const chance = Math.min(
    0.7,
    actor.technique / Math.max(1, actor.technique + target.technique) + (prof.chance || 0),
  );
  const hadShield = target.shield;
  const parts = [];
  let crit = false;
  let through = false;
  for (let i = 0; i < (prof.hits || 1); i += 1) {
    const rolled = rand() < chance;
    const roll = 0.9 + rand() * 0.2;
    const soak = Math.min(target.ability === 'guard' ? 0.45 : 0.3, target.aura / (target.aura + 700));
    let dmg = Math.max(1, Math.round(actor.atk * roll * prof.boost * (rolled ? prof.critMul : 1) * (1 - soak)));
    const braced = target.shield && !prof.pierce && !prof.breakShield;
    if (braced) {
      dmg = Math.max(1, Math.round(dmg * 0.45));
      through = true;
    }
    target.shield = false;
    target.hp = Math.max(0, target.hp - dmg);
    parts.push(dmg);
    crit = crit || rolled;
  }
  actor.struck = true;
  return {
    dmg: parts.reduce((n, v) => n + v, 0),
    crit,
    through,
    broken: Boolean(prof.breakShield && hadShield),
    boost: kind !== 'strike',
    ability: kind === 'ability' ? actor.ability : null,
    skill: kind === 'skill' ? actor.skill : null,
    hits: prof.hits || 1,
    parts,
  };
}

function pushLog(state, event) {
  state.log.push(event);
  if (state.log.length > 30) state.log.shift();
}

function finish(state, winner, reason) {
  if (state.over) return null;
  state.over = true;
  state.winner = winner;
  state.reason = reason;
  const event = {
    kind: 'end',
    side: winner,
    reason,
    score: scoreOf(state),
    winner,
    n: state.n,
  };
  pushLog(state, event);
  return event;
}

/**
 * Take one action for the side whose turn it is.
 *
 * Returns the event the log prints, `{ kind: 'end' }` when the last card fell, or
 * `null` when the action is not this side's to take. Callers apply their own
 * action locally and broadcast the same `kind` so the other engine can apply it
 * as the rival's turn.
 */
export function act(state, kind, side = state.turn, now = Date.now()) {
  if (!state || state.over) return null;
  if (side !== state.turn) return { error: 'turn' };
  if (!ACTIONS.includes(kind)) return { error: 'kind' };
  if (now - state.at >= MATCH_MS) return finishByTime(state, now);

  const actor = activeOf(state, side);
  const foeSide = other(side);
  const target = activeOf(state, foeSide);
  if (!actor || !target) return finish(state, actor ? side : foeSide, 'down');
  if (kind === 'ability' && actor.used) return { error: 'used' };
  if (kind === 'skill' && !skillReady(actor, state.n)) return { error: 'cooldown' };

  state.n += 1;
  const base = {
    kind,
    side,
    n: state.n,
    at: now,
    by: actor.id,
    byName: actor.name,
    byLv: actor.lv,
    to: target.id,
    toName: target.name,
    ability: actor.ability,
    skill: actor.skill,
  };

  if (kind === 'brace') {
    actor.shield = true;
    const event = { ...base, kind: 'brace' };
    pushLog(state, event);
    state.turn = foeSide;
    return event;
  }

  if (kind === 'ability') {
    actor.used = true;
    if (actor.ability === 'guard') {
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.round(actor.maxHp * 0.18));
      actor.shield = true;
      const event = { ...base, kind: 'guard', healed: actor.hp - before, left: actor.hp };
      pushLog(state, event);
      state.turn = foeSide;
      return event;
    }
  }

  if (kind === 'skill') {
    actor.skillReadyAt = state.n + SKILL_COOLDOWN;
    if (actor.skill === 'mend') {
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + Math.round(actor.maxHp * 0.14));
      actor.shield = true;
      const event = { ...base, kind: 'mend', healed: actor.hp - before, left: actor.hp };
      pushLog(state, event);
      state.turn = foeSide;
      return event;
    }
  }

  const shot = hit(state, actor, target, kind);
  const event = {
    ...base,
    kind: kind === 'ability' ? 'ability' : kind === 'skill' ? 'skill' : 'strike',
    dmg: shot.dmg,
    crit: shot.crit,
    through: shot.through,
    broken: shot.broken,
    hits: shot.hits,
    skill: shot.skill,
    left: target.hp,
    down: target.hp <= 0,
  };
  pushLog(state, event);

  if (target.hp <= 0) {
    const standing = activeOf(state, foeSide);
    event.down = true;
    if (!standing) {
      const end = finish(state, side, 'down');
      event.end = { winner: end.winner, reason: end.reason };
    }
  }
  state.turn = foeSide;
  return event;
}

/**
 * Call the match on hit points.
 *
 * The score is compared first, then the opener takes a dead level. Both clients
 * hold the same totals and the same opener, so this is one answer rather than
 * two guesses.
 */
export function finishByTime(state, now = Date.now()) {
  if (!state || state.over) return null;
  if (timeLeft(state, now) > 0) return null;
  const [a, b] = scoreOf(state);
  const winner = a === b ? state.opener : a > b ? 'mine' : 'rival';
  return finish(state, winner, 'time');
}

/* ---- the other player, when there is nobody on the line ------------------ */

/**
 * What a CPU does with its turn.
 *
 * It is not a random button: it spends its signature on a kill or on a losing
 * board, spends its school move when that move would finish the front card or
 * keep it standing, braces when it is one hit from falling, and otherwise
 * strikes. The `rand` it uses belongs to the match, so the same seed and the same
 * board produce the same CPU — a demo that differs each replay cannot be reasoned
 * about.
 */
export function botAction(state) {
  if (!state || state.over) return null;
  const actor = activeOf(state, 'rival');
  const target = activeOf(state, 'mine');
  if (!actor || !target) return null;

  const incoming = Math.round(target.atk * 1.1);
  const canKill = actor.atk * (actor.ability === 'overdrive' ? 1.75 : 1.25) >= target.hp;
  const skillMul = actor.skill === 'flurry' ? 1.44 : actor.skill === 'quake' ? 1.45 : 1.5;
  const ready = skillReady(actor, state.n);
  const canSkillKill = ready && actor.skill !== 'mend' && actor.atk * skillMul >= target.hp;
  const endangered = actor.hp <= incoming * 1.15;
  const behind = totalHp(state, 'rival') < totalHp(state, 'mine');
  const roll = state.rand();

  if (canSkillKill) return 'skill';
  if (ready && endangered && actor.skill === 'mend') return 'skill';
  if (!actor.used && (canKill || (endangered && actor.ability === 'guard') || (behind && roll < 0.55))) {
    return 'ability';
  }
  if (endangered && roll < 0.6) return 'brace';
  if (ready && behind && roll < 0.32) return 'skill';
  if (!actor.used && roll < 0.18) return 'ability';
  return 'strike';
}

/**
 * The CPU's two cards.
 *
 * It draws from the binder around the player's own peak so a first fight is not
 * a wall, and falls back to mirroring the player's picks when the binder holds
 * nothing else. Cards are the same published shape a person sends, which is what
 * keeps the engine one engine.
 */
export function cpuLineup(keys = []) {
  const mine = keys.map((k) => findCard(k)).filter(Boolean).slice(0, LINEUP);
  const target = mine.length ? mine.reduce((n, c) => n + num(c.stats?.power), 0) / mine.length : 0;
  const pool = ownedEntries()
    .filter((e) => Number(e.lv) <= TOP_LV && !keys.includes(e.key))
    .sort((a, b) => Math.abs(num(a.stats?.power) - target) - Math.abs(num(b.stats?.power) - target));
  const picks = pool.slice(0, LINEUP);
  let at = 0;
  while (picks.length < LINEUP && mine.length) {
    picks.push(mine[at % mine.length]);
    at += 1;
    if (at > LINEUP * 4) break;
  }
  return picks.slice(0, LINEUP).map((c) => tradeCard(c));
}

/** A seed two clients can agree on without asking a server. */
export function newSeed() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
