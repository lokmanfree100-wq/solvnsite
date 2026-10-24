/**
 * The ladder, on screen.
 *
 * One number, two places it can come from. On your own profile it is read from
 * the ledger this device keeps — the same file that paid out the packs and wrote
 * down the quest — so a bar never lags the thing that moved it. On anybody else's
 * it is read from the XP that member's device published, which is the only figure
 * a stranger has any way to hand over. Both go through one curve, so the two
 * readings cannot disagree about what 1.400 XP means.
 *
 * The sheet is a ledger, not a promise: every row on it is a row that already
 * happened somewhere else in the app — packs counted by the binder, a spin
 * counted by the wheel, a fight counted by the arena — and the collect button
 * pays what those figures earned rather than what a timer decided.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { duelsUsable, fortuneUsable } from '../lib/account.js';
import { MAX_LEVEL, collectQuests, levelFromXp, levelReward, levelState, questRows, xpAtLevel } from '../lib/level.js';
import { BANNER_FREE, BANNER_THEMES, badgeById, bannerLevel } from '../lib/ranks.js';
import { nextResetAt, quota } from '../lib/cards.js';
import { todayTally } from '../lib/duels.js';
import { fortuneState } from '../lib/fortune.js';
import { viewLog } from '../lib/store.js';

const DAY_MS = 86400000;

/** The 04:00 that started today — one day boundary for the whole app. */
const dayStart = () => nextResetAt() - DAY_MS;

/**
 * The five figures a quest reads, each taken from the page that owns it.
 *
 * Nothing is counted twice: the binder knows how many packs this day opened, the
 * wheel knows whether today's spin is gone, the arena keeps a day tally, and the
 * view log has the hour every episode was started. A quest that kept its own
 * counter would be a second number free to fall out of step with the first.
 */
export function questFigures() {
  const from = dayStart();
  const tally = todayTally();
  return {
    packs: Number(quota().used) || 0,
    watch: viewLog().filter((e) => Number(e.at) >= from).length,
    spin: fortuneState().spun ? 1 : 0,
    duel: tally.fought,
    win: tally.won,
  };
}

/**
 * Where a member stands, in the shape a bar reads.
 *
 * `mine` is the only branch: your own level comes off this device's ledger,
 * somebody else's comes off the sum they published. The master handle is pinned
 * to the top on both sides of that branch, because the rule that pins it is the
 * one that gives it the dashboard.
 */
export function levelOf(user, { mine = false } = {}) {
  if (mine) return levelState();
  if (user?.isAdmin) return { ...levelFromXp(xpAtLevel(MAX_LEVEL)), staff: true };
  return levelFromXp(Number(user?.stats?.xp) || 0);
}

/** The short form: a chip beside a name, wherever a row is too tight for a bar. */
export function levelChip(user, { mine = false } = {}) {
  const st = levelOf(user, { mine });
  const label = t('Level {n}', { n: st.level });
  return h(
    'span.lv-chip',
    { title: label, 'aria-label': label },
    icon('bolt'),
    h('b.tnum', {}, String(st.level)),
  );
}

/**
 * Level, bar, and what is left to climb.
 *
 * The fill is a `scaleX` on a fixed block, so a bar that grows does not ask the
 * layout for a new row of pixels, and in RTL it flips by itself once the
 * transform origin moves.
 */
export function levelBar(user, { mine = false, figures = true } = {}) {
  const st = levelOf(user, { mine });
  const fill = h('i.lv-fill');
  fill.style.transform = `scaleX(${Math.max(0.015, st.pct / 100)})`;
  const next = st.level >= MAX_LEVEL ? null : st.level + 1;
  const track = h(
    'div.lv-track',
    {
      role: 'progressbar',
      'aria-label': next ? t('Progress to level {n}', { n: next }) : t('Top of the ladder'),
      'aria-valuenow': String(st.pct),
      'aria-valuemin': '0',
      'aria-valuemax': '100',
    },
    fill,
  );
  const copy = h(
    'div.lv-copy',
    {},
    h('div.lv-trackrow', {}, track),
    figures
      ? h(
          'p.lv-fig',
          {},
          st.staff || !next
            ? t('Level {n} — the top of the ladder', { n: MAX_LEVEL })
            : t('{left} XP to level {n} · {into} of {need}', { left: st.left, n: next, into: st.into, need: st.need }),
        )
      : null,
  );
  return h(
    'div.lv-row',
    {},
    h('span.lv-badge', {}, h('span.lv-badge-label', {}, t('LV')), h('b.tnum.lv-badge-n', {}, String(st.level))),
    copy,
  );
}

/* ---- what a level pays ------------------------------------------------
   The two things a step hands over are on the sheet before it is reached, so a
   member can see what they are climbing toward. Bands are listed here too,
   because a banner that only ever appears in the picker is a reward nobody
   knows exists until they are standing in the picker. */
const BANDS_BY_LEVEL = BANNER_THEMES.reduce((map, [key, label], index) => {
  if (index < BANNER_FREE) return map;
  const at = bannerLevel(index);
  return { ...map, [at]: [...(map[at] || []), label] };
}, {});

function payRow(level) {
  const r = levelReward(level);
  const badge = r.badge ? badgeById(r.badge) : null;
  const bands = BANDS_BY_LEVEL[level] || [];
  return h(
    'div.lv-pay',
    {},
    h('b.lv-pay-lv.tnum', {}, String(level)),
    h('span.lv-pay-copy', {},
      h('span', {}, icon('grid'), t('{n} packs', { n: r.packs })),
      badge ? h('span', {}, icon(badge.icon), t(badge.label)) : null,
      ...bands.map((name) => h('span', {}, icon('palette'), t(name))),
    ),
  );
}

/** The next steps, so the ladder shows its rungs rather than one bar. */
function payLadder(level) {
  const from = Math.min(MAX_LEVEL, level + 1);
  const rows = [];
  for (let l = from; l <= Math.min(MAX_LEVEL, from + 4); l += 1) rows.push(payRow(l));
  if (level >= MAX_LEVEL) {
    return h('div.lv-pays', {}, h('p.lv-note', {}, t('You are at the top of the ladder — nothing left to climb.')));
  }
  return h(
    'div.lv-pays',
    {},
    rows,
    h('p.lv-note', {}, t('Every level pays packs into your bank, a badge every tenth, and the bands appear as they come due.')),
  );
}

/* ---- the sheet --------------------------------------------------------
   The quests read the figures the moment the sheet opens and pay what is owed —
   a row that filled while you were watching something else should be collectable
   the second you look at it, and a reward that pays itself in the background is
   one nobody saw. */

/* A quest can only read a page this copy actually has. The wheel and the arena
   are settled by the Node server, so on a static deploy their rows would sit at
   0 of 1 forever; they are left off the list rather than shown as an unreachable
   promise. The ledger is untouched — a row that comes back has its old day. */
const questHere = (r) =>
  r.stat === 'spin' ? fortuneUsable() : r.stat === 'duel' || r.stat === 'win' ? duelsUsable() : true;

function questRow(r) {
  return h(
    `div.lv-quest${r.claimed ? '.is-banked' : r.done ? '.is-ready' : ''}`,
    {},
    h('span.lv-quest-icon', {}, icon(r.icon)),
    h('span.lv-quest-copy', {},
      h('b', {}, t(r.label)),
      h('span.lv-quest-fig', {}, r.done ? t('Done') : t('{a} of {b}', { a: r.at, b: r.need })),
      h('i.lv-quest-track', {}, (() => {
        const q = h('i');
        q.style.transform = `scaleX(${Math.max(0.015, r.pct / 100)})`;
        return q;
      })()),
    ),
    h('span.lv-quest-xp.tnum', {}, `+${r.xp}`),
    r.claimed ? h('span.lv-quest-flag', { 'aria-hidden': 'true' }, icon('check')) : null,
  );
}

export function levelSheet({ onDone = null } = {}) {
  const body = h('div.lv-sheet');

  function paint() {
    const figures = questFigures();
    const rows = questRows(figures).filter(questHere);
    const ready = rows.filter((r) => r.done && !r.claimed);
    const st = levelState();

    const collect = ready.length
      ? h(
          'button.btn.btn--primary.lv-collect',
          {
            type: 'button',
            onclick: () => {
              const out = collectQuests(questFigures());
              const xp = out.xp || 0;
              toast(
                xp
                  ? t('Quests banked — {n} XP added', { n: xp })
                  : t('Nothing to collect.'),
                { tone: xp ? 'ok' : undefined, iconName: 'check' },
              );
              last = out.rows;
              paint();
              onDone?.();
            },
          },
          icon('sparkles'),
          h('span', {}, t('Collect {n} XP', { n: ready.reduce((sum, r) => sum + r.xp, 0) })),
        )
      : null;

    body.replaceChildren(
      levelBar(null, { mine: true }),
      h('p.lv-total', {}, t('{n} XP earned on this device', { n: st.xp })),

      h('h3.lv-h2', {}, icon('list'), t('Today')),
      h('div.lv-quests', {}, ...rows.map(questRow)),
      h('div.lv-questfoot', {},
        collect,
        h('p.lv-note', {}, duelsUsable()
          ? t('The day turns at 04:00, the same hour the packs and the wheel use.')
          : t('The day turns at 04:00, the same hour the packs use.')),
      ),

      h('h3.lv-h2', {}, icon('trending'), t('What the next levels pay')),
      payLadder(st.level),
    );
  }

  paint();
  return sheet({
    heading: t('Level ladder'),
    sub: duelsUsable()
      ? t('XP comes from packs, quests, the wheel and duels — and every level pays out.')
      : t('XP comes from packs and quests — and every level pays out.'),
    width: 540,
    render: () => body,
  });
}
