/**
 * Levels: the ladder under the badges.
 *
 * XP is the app's own arithmetic, not the server's. Every point here comes from a
 * thing this device can see for itself — a pack opened, a duel settled, a wheel
 * spun, a quest done — and the account record stores whatever this module pushes,
 * the same way it stores an estimate of hours watched. That is a deliberate
 * choice, not a gap: on a home network the ladder is a shared scoreboard, and the
 * one figure nobody can talk themselves into is a duel win, which is settled by
 * the server only after both line-ups are committed.
 *
 * The curve is steepest at the very bottom. Level 1 to level 2 costs about one
 * quest and a handful of packs, so a new member sees the bar move the first
 * evening; from there each step costs more than the last, and the top of the
 * ladder is a thing a season of showing up buys rather than a weekend. A fast
 * start is not a cheat — it is the difference between a bar that means something
 * and wallpaper.
 *
 * Every level pays out, and what it pays is on the screen before you get there:
 * packs into the bank (a real number in a real ledger, not a badge), and a badge
 * every tenth level — the same step `lib/ranks.js` mints its ids on. The
 * animated backgrounds are not in this table — they unlock from the level itself,
 * in `lib/ranks.js`, so a step up never hands over a cosmetic twice.
 */

import { storage } from './store.js';
import { bankPacks, cardDay } from './cards.js';
import { pushStats, isStaff } from './account.js';
import { t } from './i18n.js';
import { toast } from './ui.js';
import { sfx } from './sounds.js';

/** Same ceiling as `MAX_LEVEL` in account-api.js, where a record is clamped. */
export const MAX_LEVEL = 100;

/** XP needed to step *out of* `level`. Level 1 is cheap by design. */
export function xpForLevel(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
  if (l >= MAX_LEVEL) return 0;
  return Math.round(30 + 18 * Math.pow(l - 1, 1.45) + 9 * (l - 1));
}

/** Total XP at which `level` starts, so a stored sum can be read back as a level. */
export function xpAtLevel(level) {
  let sum = 0;
  for (let l = 1; l < Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1)); l += 1) sum += xpForLevel(l);
  return sum;
}

export function levelFromXp(total) {
  const xp = Math.max(0, Number(total) || 0);
  let level = 1;
  let spent = 0;
  while (level < MAX_LEVEL) {
    const need = xpForLevel(level);
    if (xp < spent + need) break;
    spent += need;
    level += 1;
  }
  const need = xpForLevel(level) || 1;
  const into = level >= MAX_LEVEL ? need : xp - spent;
  return {
    xp,
    level,
    need,
    into: Math.min(need, into),
    pct: level >= MAX_LEVEL ? 100 : Math.max(0, Math.min(100, Math.round((into / need) * 100))),
    left: level >= MAX_LEVEL ? 0 : Math.max(0, need - into),
  };
}

/* ---- the ledger ------------------------------------------------------- */
const key = () => 'level';
const blank = () => ({ xp: 0, level: 1, paid: [], awarded: {}, day: null });

function read() {
  const raw = storage.read(key(), null);
  if (!raw || typeof raw !== 'object') return blank();
  const out = {
    xp: Math.max(0, Number(raw.xp) || 0),
    level: Math.max(1, Number(raw.level) || 1),
    paid: Array.isArray(raw.paid) ? raw.paid.filter((n) => Number(n) > 0) : [],
    awarded: raw.awarded && typeof raw.awarded === 'object' ? raw.awarded : {},
    day: typeof raw.day === 'string' ? raw.day : null,
  };
  /* A record written by an older curve still has to read as one number, so the
     level is always re-derived from the sum rather than trusted. */
  const fresh = levelFromXp(out.xp);
  if (fresh.level !== out.level) {
    out.level = fresh.level;
    write(out);
  }
  return out;
}

function write(next) {
  storage.write(key(), next);
  return next;
}

/** Where this device stands, in the shape a bar and a chip both read. */
export function levelState() {
  const st = read();
  const base = { paid: st.paid, awarded: st.awarded, day: st.day };
  /* The master handle is pinned to the top of the ladder on the server, so the
     local bar is pinned with it — otherwise the admin's own profile would read
     level 1 next to a card record that says level 100. */
  if (isStaff()) return { ...levelFromXp(xpAtLevel(MAX_LEVEL)), ...base, staff: true };
  return { ...levelFromXp(st.xp), ...base };
}

/* ---- what a level pays ----------------------------------------------- */
/** Packs into the bank at `level`. Read it out loud: one, plus one per five. */
export const levelPacks = (level) => 1 + Math.floor(Math.max(1, Number(level) || 1) / 5);

/** The badge id a level earns, or null for a level that earns none.
    Ten to a badge — the same step `lib/ranks.js` mints its ids on, so a level
    that promises a badge names one that actually exists. */
export const levelBadge = (level) => (Number(level) > 0 && Number(level) % 10 === 0 ? `level-${Number(level)}` : null);

/**
 * The reward lines a level-up sheet prints, before anybody has earned them.
 * `badge` and `packs` are the two things a step actually hands over; the
 * background, when one arrives at this level, is named from `lib/ranks.js`.
 */
export function levelReward(level) {
  return { level, packs: levelPacks(level), badge: levelBadge(level) };
}

/* ---- earning --------------------------------------------------------- */
/**
 * Add XP, and pay out whatever levels it crosses.
 *
 * The whole run is settled in one write: a hundred points gained at once is one
 * record, not one hundred, and every level between the old one and the new one
 * is paid. The bank is where packs land — the same bank a streak milestone uses,
 * so a reward cannot be lost to a day rollover nobody warned about.
 */
export function awardXp(amount, reason = 'xp') {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  if (!gain) return { gained: 0, levels: [], state: levelState(), reason };
  if (isStaff()) {
    /* The master handle sits at the ceiling by rule, so a point cannot raise it.
       The XP is still kept — the ledger is a record, not a scoreboard — but no
       level is paid and no toast claims a step nobody took. */
    const st = read();
    write({ ...st, xp: st.xp + gain, level: MAX_LEVEL });
    return { gained: 0, levels: [], state: levelState(), reason };
  }
  const before = read();
  const state = levelFromXp(before.xp + gain);
  const gained = state.level - before.level;
  const levels = [];
  for (let l = before.level + 1; l <= state.level; l += 1) if (!before.paid.includes(l)) levels.push(l);

  const next = { ...before, xp: before.xp + gain, level: state.level };
  for (const l of levels) {
    next.paid = [...next.paid, l].slice(-MAX_LEVEL);
    next.awarded = { ...next.awarded, [`lv${l}`]: (Number(next.awarded[`lv${l}`]) || 0) + 1 };
  }
  write(next);
  if (levels.length) {
    const packs = levels.reduce((n, l) => n + levelPacks(l), 0);
    bankPacks(packs);
    sfx.evolve();
    toast(
      levels.length === 1
        ? t('Level {n} — {packs} packs banked', { n: levels.at(-1), packs })
        : t('Level {n} — {levels} levels up, {packs} packs banked', { n: levels.at(-1), levels: levels.length, packs }),
      { tone: 'ok', iconName: 'sparkles' },
    );
    pushStats();
  }
  return { gained, levels, state: levelFromXp(next.xp), reason };
}

/** Every XP row this device has earned, newest first — the ladder's own history. */
export function xpLedger() {
  const st = read();
  return { xp: st.xp, level: st.level, paid: st.paid, awarded: st.awarded };
}

/* ---- the daily quests --------------------------------------------------
   A quest reads a figure that already exists somewhere else — packs spent
   today, a title opened, a duel settled, a wheel spun — rather than keeping its
   own counter. That is what makes the progress bar on the page the truth: there
   is no second number to fall out of step with.
   `count` is filled in by the view that owns the figure, because `lib/duels.js`
   and `lib/fortune.js` import this file for `awardXp` and a cycle would be the
   price of a convenience. */
export const QUESTS = [
  { id: 'packs', label: 'Open 5 packs', icon: 'grid', need: 5, xp: 30, stat: 'packs' },
  { id: 'watch', label: 'Watch an episode', icon: 'play', need: 1, xp: 25, stat: 'watch' },
  { id: 'spin', label: 'Spin the fortune wheel', icon: 'star', need: 1, xp: 20, stat: 'spin' },
  { id: 'duel', label: 'Fight a duel', icon: 'bolt', need: 1, xp: 35, stat: 'duel' },
  { id: 'win', label: 'Win a duel', icon: 'trophy', need: 1, xp: 40, stat: 'win' },
];

/** The day a quest set belongs to, in the same 04:00 shape the packs use. */
export const questDay = () => cardDay().key;

/** What has been paid out today, so a quest cannot be farmed twice in a day. */
function paidToday(st, day) {
  if (st.day !== day) return {};
  return st.awarded && typeof st.awarded === 'object' ? st.awarded : {};
}

/**
 * The five rows, with progress, XP and whether they are already banked today.
 * `figures` is the counts this view can read: `{ packs, watch, spin, duel, win }`.
 */
export function questRows(figures = {}) {
  const st = read();
  const day = questDay();
  const paid = paidToday(st, day);
  return QUESTS.map((q) => {
    const at = Math.max(0, Number(figures[q.stat]) || 0);
    const done = at >= q.need;
    return {
      ...q,
      at: Math.min(q.need, at),
      done,
      claimed: Boolean(paid[`quest:${q.id}`]),
      pct: Math.max(0, Math.min(100, Math.round((at / q.need) * 100))),
    };
  });
}

/**
 * Pay every quest that reached its number and has not been paid this day.
 *
 * Called when a page paints, not on a timer: the moment a bar fills is the
 * moment it should be collectable, and a row that silently paid itself while
 * nobody was looking is a reward nobody saw.
 */
export function collectQuests(figures = {}) {
  const st = read();
  const day = questDay();
  const paid = paidToday(st, day);
  const rows = questRows(figures);
  const earned = rows.filter((r) => r.done && !r.claimed);
  if (!earned.length) return { rows, claimed: [] };
  const next = {
    ...st,
    day,
    awarded: { ...(st.awarded && st.day === day ? st.awarded : {}), ...Object.fromEntries(earned.map((r) => [`quest:${r.id}`, 1])) },
  };
  write(next);
  const xp = earned.reduce((n, r) => n + r.xp, 0);
  /* The ledger is written before the XP lands, so a level-up in the middle of a
     payout cannot re-pay the same quest on the way back through. */
  awardXp(xp, 'quests');
  return { rows: questRows(figures), claimed: earned, xp };
}

/** A fresh day: the quest rows read empty, and nothing is paid yet. */
export function questState() {
  const st = read();
  return { day: st.day, paid: Object.keys(paidToday(st, questDay())).length };
}
