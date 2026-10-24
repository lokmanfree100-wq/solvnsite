/**
 * The arena: two cards a side, and a fight both screens agree on.
 *
 * Two ways in. `Fight online` stands in a Supabase Realtime lobby until someone
 * near your Power answers, then both clients open the same board from the seed the
 * handshake agreed on; `Quick fight (CPU)` skips the lobby entirely, and is also
 * where an unreachable lobby lands after twelve seconds. The turns, the clock and
 * the damage live in `lib/battle.js`, and both ends hold the same cards and the
 * same seed, so neither screen is the referee.
 *
 * A replay of a server-run duel still lands here too: `lib/duels.js` decides that
 * one from the seed the server handed it, and this page plays it back one strike
 * at a time. That separation is what lets two phones report the same score, which
 * is the only way a win/loss row on a profile means anything.
 *
 * The match opens on a short exchange of taunts, which is set dressing rather than
 * a decision: the seed picks two lines, the same two lines on both screens, and
 * the first strike still belongs to the arithmetic.
 *
 * Matchmaking is deliberately narrow. The lobby pairs the closest peak Power it
 * can find and will not cross its band, so the honest outcome of an empty queue is
 * "still waiting", not a fight you were never going to win — and after a beat the
 * CPU steps in rather than leaving a spinner. An invite is the other door: you
 * choose the opponent, they choose their two, and neither line-up is committed
 * until both have picked.
 *
 * The animation is transform and opacity only, and the whole thing collapses to a
 * single final frame under `prefers-reduced-motion`. A page that costs frames is
 * the one thing a fight must never be.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { debounce, relativeTime } from '../lib/util.js';
import { currentUser, filePractice, isSignedIn, refresh, searchMembers, shownName } from '../lib/account.js';
import { TOP_LV, displayCard, ownedEntries, rarityOf } from '../lib/cards.js';
import {
  LINEUP,
  MATCH_MS,
  awaitingMe,
  callOff,
  challenge,
  commit as commitLineup,
  countToday,
  duelState,
  duelsAvailable,
  fight as runDuel,
  lineupOf,
  loadDuels,
  settle,
  subscribeDuels,
} from '../lib/duels.js';
import { cpuLineup, makeBattle, newSeed } from '../lib/battle.js';
import { FALLBACK_MS, onlineArenaReady, searchOnline } from '../lib/live-arena.js';
import { openBattle } from '../components/battle.js';
import { awardXp } from '../lib/level.js';
import { gachaCard } from '../components/gacha.js';
import { avatar, authSheet, divisionChip, duelRecord, say, titleChip } from '../components/account.js';
import { emptyState } from '../components/media.js';
import { storage } from '../lib/store.js';
import { sfx } from '../lib/sounds.js';

const NOTE_MAX = 140;
/** The most tiles a picker paints at once — a full binder runs into the hundreds. */
const PICK_ROWS = 80;

/** What a playable fight pays, the same figures a replayed duel does. */
const XP_WIN = 60;
const XP_LOSS = 15;

/* The pre-battle exchange. Four short lines, and the seed picks two of them, so
   two screens open on the same script. Each is a literal `t()` so the extractor
   sees it; the index comes from the duel, not from Math.random. */
const TAUNTS = [
  () => t('Say it with the cards, then.'),
  () => t('You are not walking out of this one.'),
  () => t('One clean strike is all I need.'),
  () => t('Show me what that plate can do.'),
];

const ABILITY_TEXT = {
  overdrive: () => t('Overdrive'),
  blitz: () => t('Blitz'),
  focus: () => t('Focus'),
  guard: () => t('Guard'),
};
const ABILITY_ICON = { overdrive: 'flame', blitz: 'bolt', focus: 'sparkles', guard: 'star' };

const clockText = (ms) => {
  const total = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** A stable number from the seed, for picking the two taunts. */
const seedNumber = (text) => {
  let n = 0;
  for (const ch of String(text || '')) n = (Math.imul(n, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(n);
};

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const modalRoot = () => document.querySelector('#modal-root');

/** The two keys this device brings to a fight, kept between visits. */
const readLineup = () => (storage.read('duel:lineup', []) || []).filter((k) => typeof k === 'string').slice(0, LINEUP);
const writeLineup = (keys) => storage.write('duel:lineup', keys.slice(0, LINEUP));

const cardsOf = (keys) => lineupOf(keys);
const peak = (cards) => cards.reduce((n, c) => Math.max(n, Number(c.power) || 0), 0);

/**
 * Who took a finished duel.
 *
 * `result.winner` is an account id and `mine` is a side name, so the two are only
 * comparable through the person record the duel carries. Reading `winner === mine`
 * would congratulate the loser whenever the guest side won — the one mistake a
 * fight page cannot make, and it returns null rather than a guess when the field
 * is missing.
 */
function iWon(duel) {
  if (duel?.state !== 'done' || !duel.result || !duel.mine) return null;
  const myId = duel[duel.mine]?.id;
  if (myId == null) return null;
  return String(duel.result.winner) === String(myId);
}

const STATE_TEXT = {
  awaiting: () => t('Waiting'),
  ready: () => t('Ready to fight'),
  done: () => t('Fought'),
  cancelled: () => t('Called off'),
  expired: () => t('Lapsed'),
};

/** `{n}m left` on an invite — the same shape the trade rows use. */
function leftText(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours >= 24) return t('{n}d left', { n: Math.floor(hours / 24) });
  if (hours >= 1) return t('{n}h left', { n: hours });
  return t('{n}m left', { n: Math.max(1, Math.floor(ms / 60000)) });
}

/* ---- the line-up picker ------------------------------------------------ */
function lineupSheet(onDone) {
  const chosen = readLineup();
  /* The master cannot fight: it is awarded for holding the set, and a card that
     walks into an arena would end every arena it walks into. */
  const entries = ownedEntries().filter((e) => Number(e.lv) <= TOP_LV);
  const grid = h('div.ar-picks');
  const tally = h('span.ar-tally.tnum', {}, `${chosen.length}/${LINEUP}`);
  const find = h('input.input', {
    type: 'search',
    placeholder: t('Find a card in your binder…'),
    'aria-label': t('Find a card'),
    autocomplete: 'off',
  });
  let handle = null;

  const paint = (term = '') => {
    const q = term.trim().toLowerCase();
    const all = q ? entries.filter((e) => `${e.name} ${e.mediaTitle}`.toLowerCase().includes(q)) : entries;
    const rows = all.slice(0, PICK_ROWS);
    tally.textContent = `${chosen.length}/${LINEUP}`;
    submit.disabled = chosen.length !== LINEUP;
    grid.replaceChildren(
      ...(rows.length
        ? [
            ...rows.map((e) => {
              const on = chosen.includes(e.key);
              return h(
                `button.ar-pick${on ? '.is-on' : ''}`,
                {
                  type: 'button',
                  'aria-pressed': String(on),
                  'aria-label': on ? t('Send {name} to the bench', { name: e.name }) : t('Put {name} in the line-up', { name: e.name }),
                  onclick: () => {
                    const at = chosen.indexOf(e.key);
                    if (at >= 0) chosen.splice(at, 1);
                    else if (chosen.length >= LINEUP) {
                      toast(t('A line-up is {n} cards.', { n: LINEUP }), { tone: 'err', iconName: 'alert' });
                      return;
                    } else chosen.push(e.key);
                    sfx.select();
                    paint(find.value);
                  },
                },
                gachaCard(e, { variant: 'tile', count: e.count, eager: false }),
                h('span.ar-pick-mark', { 'aria-hidden': 'true' }, icon(on ? 'check' : 'plus')),
              );
            }),
            rows.length === PICK_ROWS && all.length > PICK_ROWS
              ? h('p.faint.ar-pick-note', {}, t('Showing the strongest {n} — keep typing to narrow it down.', { n: PICK_ROWS }))
              : null,
          ].filter(Boolean)
        : [h('p.faint.ar-pick-empty', {}, entries.length ? t('Nothing in your binder by that name.') : t('Your binder is empty. Open a pack first.'))]),
    );
  };

  const submit = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: () => {
        if (chosen.length !== LINEUP) return;
        writeLineup(chosen);
        handle?.close();
        sfx.select();
        onDone?.(chosen.slice());
      },
    },
    icon('bolt'),
    h('span', {}, t('Bring these two')),
  );

  find.addEventListener('input', () => paint(find.value));

  sheet({
    heading: t('Choose your line-up'),
    sub: t('Two cards. The first one still standing steps forward, its strongest stat decides how it fights, and the turns alternate from there.'),
    width: 760,
    footer: h('div.ar-sheet-foot', {}, tally, submit),
    render: (opened) => {
      handle = opened;
      return h('div.ar-sheet', {}, find, grid);
    },
  });
  paint('');
}

/* ---- invite ------------------------------------------------------------ */
function inviteSheet(onDone) {
  const askRow = h('div.ar-ask');
  let partner = null;
  let handle = null;

  const send = async () => {
    const keys = readLineup();
    if (keys.length !== LINEUP || !partner) return;
    const note = askRow.querySelector('.ar-note-field')?.value?.trim() || '';
    try {
      const d = await challenge(partner.id, keys, note);
      if (d.error) {
        toast(t(d.error), { tone: 'err', iconName: 'alert' });
        return;
      }
      handle?.close();
      toast(t('Challenge sent. They pick two cards and the fight is on.'), { iconName: 'sparkles' });
      onDone?.();
    } catch (err) {
      toast(say(err, t('The challenge did not go out.')), { tone: 'err', iconName: 'alert' });
    }
  };

  /** No line-up saved yet means there is nothing to challenge with, so pick one
      first and carry straight on rather than losing the member just found. */
  const commitPick = () => {
    if (readLineup().length !== LINEUP) {
      lineupSheet(send);
      return;
    }
    send();
  };

  function paintAsk() {
    if (partner) {
      askRow.replaceChildren(
        h(
          'div.ar-ask-on',
          {},
          avatar(partner, { size: 'sm' }),
          h(
            'span.ar-who-names',
            {},
            h('b', {}, shownName(partner)),
            h('span.faint', {}, partner.username ? `@${partner.username}` : t('This member is gone')),
          ),
          h(
            'button.btn.btn--sm',
            {
              type: 'button',
              onclick: () => {
                partner = null;
                paintAsk();
              },
            },
            icon('x'),
            h('span', {}, t('Change')),
          ),
        ),
        h('textarea.input.ar-note-field', {
          rows: 2,
          maxlength: NOTE_MAX,
          placeholder: t('Say something, if you want to…'),
          'aria-label': t('Note'),
        }),
        h('button.btn.btn--primary', { type: 'button', onclick: commitPick }, icon('bolt'), h('span', {}, t('Send challenge'))),
      );
      return;
    }
    const field = h('input.input', {
      type: 'search',
      placeholder: t('Find a member by name…'),
      'aria-label': t('Find a member'),
      autocomplete: 'off',
    });
    const found = h('div.ar-found', { 'aria-live': 'polite' }, h('p.faint', {}, t('Type a name to find somebody.')));
    let term = 0;
    const search = debounce(async () => {
      const q = field.value.trim();
      if (q.length < 2) {
        found.replaceChildren(h('p.faint', {}, t('Type a name to find somebody.')));
        return;
      }
      const at = ++term;
      found.replaceChildren(h('p.faint', {}, t('Searching…')));
      try {
        const data = await searchMembers(q);
        if (at !== term) return;
        const people = (data.users || []).filter((u) => u.id && u.id !== currentUser()?.id);
        found.replaceChildren(
          ...(people.length
            ? people.map((u) =>
                h(
                  'button.ar-found-row',
                  {
                    type: 'button',
                    onclick: () => {
                      partner = u;
                      paintAsk();
                    },
                  },
                  avatar(u, { size: 'sm' }),
                  h('span.ar-who-names', {}, h('b', {}, shownName(u)), h('span.faint', {}, `@${u.username}`)),
                  titleChip(u),
                ),
              )
            : [h('p.faint', {}, t('Nobody by that name yet.'))]),
        );
      } catch {
        if (at !== term) return;
        found.replaceChildren(h('p.faint', {}, t('The member list is not answering right now.')));
      }
    }, 220);
    field.addEventListener('input', search);
    askRow.replaceChildren(h('div.stack', {}, field, found));
    requestAnimationFrame(() => field.focus());
  }

  sheet({
    heading: t('Challenge a member'),
    sub: t('They choose their own two, and the duel starts once both line-ups are committed.'),
    width: 620,
    render: (opened) => {
      handle = opened;
      return h('div.ar-sheet', {}, askRow);
    },
  });
  paintAsk();
}

/* ---- the fight ---------------------------------------------------------
   The engine has already run; this plays it back. It keeps its own hit points so
   the bars can climb down one clash at a time — `run.from` and `run.to` hold the
   *final* numbers, because the fight was computed in one pass — and every frame
   uses the `left` the engine recorded, which is why a skipped match, an animated
   one and your opponent's screen all end on the same figures.
   ------------------------------------------------------------------------ */
let stage = null;
let stageKey = null;

function closeStage() {
  stage?.remove();
  stage = null;
  if (stageKey) {
    document.removeEventListener('keydown', stageKey);
    stageKey = null;
  }
  if (!modalRoot()?.childElementCount) document.body.style.removeProperty('overflow');
}

/** A short-lived spark burst at one tile — transform and opacity, nothing else. */
function sparks(layer, x, y, strong) {
  if (reduced()) return;
  const bits = h('div.ar-sparks');
  bits.style.left = `${x}%`;
  bits.style.top = `${y}%`;
  for (let i = 0; i < (strong ? 10 : 6); i += 1) {
    const bit = h('i.ar-spark');
    bit.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
    bit.style.setProperty('--dy', `${Math.round((Math.random() - 0.5) * 120)}px`);
    bit.style.animationDelay = `${Math.round(Math.random() * 90)}ms`;
    bits.append(bit);
  }
  layer.append(bits);
  setTimeout(() => bits.remove(), 640);
}

function fighterTile(card) {
  const shown = displayCard(card);
  const r = rarityOf(shown.lv);
  const bar = h('i.ar-hp-fill');
  const num = h('span.ar-hp-num.tnum', {}, String(card.maxHp));
  const tile = h(
    'div.ar-fighter',
    { 'data-key': card.key },
    h('div.ar-fighter-card', {}, gachaCard(shown, { variant: 'tile', eager: false })),
    /* The bar under a fighter is lamped in the card's own tier colour rather than
       a generic green: a duel is a table of cards, and the health of a card is
       part of what that card is. The number stays the readable figure. */
    h('div.ar-hp', { role: 'presentation' }, bar),
    num,
  );
  tile.style.setProperty('--ga', r.a);
  tile.style.setProperty('--gb', r.b);
  tile.style.setProperty('--glow', r.glow);
  tile.__bar = bar;
  tile.__num = num;
  return tile;
}

/**
 * Play a settled duel.
 *
 * `outcome.won` is the server's answer, not this page's arithmetic: `null` means
 * the result never filed, so the frame is presented as finished rather than as a
 * win somebody could claim.
 */
function openArena(duel, run, outcome) {
  closeStage();
  const mine = duel.mine;
  const hp = new Map();
  for (const who of ['from', 'to']) for (const f of run[who]) hp.set(f.key, f.maxHp);

  const sides = ['from', 'to'].map((who) => {
    const person = duel[who];
    const tiles = run[who].map(fighterTile);
    return {
      who,
      tiles,
      byKey: new Map(tiles.map((el) => [el.dataset.key, el])),
      row: h(`div.ar-line${mine === who ? '.is-mine' : ''}`, {}, ...tiles),
      name: shownName(person) || t('A member'),
      handle: person?.username ? `@${person.username}` : '',
    };
  });
  const sideOf = (who) => sides.find((s) => s.who === who);

  const log = h('div.ar-log', { 'aria-live': 'polite' });
  const hint = h('p.ar-hint', {}, icon('bolt'), h('span', {}, t('To the first strike.')));
  const clock = h('span.ar-clock.tnum', {}, clockText(MATCH_MS));
  const skip = h(
    'button.btn.btn--sm',
    { type: 'button', onclick: () => finish(true) },
    icon('next'),
    h('span', {}, t('Skip')),
  );
  const leave = h(
    'button.btn.btn--primary',
    { type: 'button', onclick: () => closeStage(), hidden: true },
    icon('check'),
    h('span', {}, t('Done')),
  );

  const layer = h('div.ar-spark-layer');

  /* The intro is set from the same seed as the fight, so the opponent's screen
     opens on the same two lines. It is dressing, not a decision: no line changes a
     number, and the engine has already run by the time it is printed. */
  const taunt = seedNumber(duel.seed);
  const introSide = (side, index) => {
    const card = duel.lineups?.[side.who]?.[0];
    const lead = run[side.who]?.[0];
    const line = (taunt + (index ? 1 + (taunt % 3) : 0)) % TAUNTS.length;
    return h(
      `div.ar-intro-side${index ? '.is-right' : ''}`,
      {},
      card ? h('div.ar-intro-card', {}, gachaCard(displayCard(card), { variant: 'tile', eager: true })) : null,
      h('div.ar-intro-names', {}, h('b', {}, side.name), h('span.faint', {}, side.handle)),
      lead
        ? h('span.ar-ability', {}, icon(ABILITY_ICON[lead.ability]), h('span', {}, ABILITY_TEXT[lead.ability]()))
        : null,
      h('p.ar-taunt', {}, `“${TAUNTS[line]()}”`),
    );
  };
  const intro = h(
    'div.ar-intro',
    { role: 'group', 'aria-label': t('Before the first strike') },
    h('p.ar-intro-kicker', {}, t('Before the first strike')),
    h(
      'div.ar-intro-body',
      {},
      introSide(sides[0], 0),
      h('span.ar-intro-vs', { 'aria-hidden': 'true' }, icon('bolt')),
      introSide(sides[1], 1),
    ),
    h(
      'button.btn.btn--primary.ar-intro-go',
      { type: 'button', onclick: () => begin() },
      icon('play'),
      h('span', {}, t('Begin the duel')),
    ),
  );

  const panel = h(
    'div.ar-stage',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('The duel') },
    h(
      'header.ar-stage-head',
      {},
      h('div.ar-stage-side', {}, h('b', {}, sides[0].name), h('span.faint', {}, sides[0].handle)),
      h('span.ar-vs', { 'aria-hidden': 'true' }, icon('bolt')),
      h('div.ar-stage-side.is-right', {}, h('b', {}, sides[1].name), h('span.faint', {}, sides[1].handle)),
      clock,
    ),
    h('div.ar-board', {}, sides[0].row, layer, sides[1].row),
    log,
    hint,
    h('div.ar-stage-foot', {}, skip, leave),
  );
  panel.append(intro);

  /* Not `.modal-backdrop`: the shell's global Escape handler removes the first
     backdrop it finds, and a fight that vanishes mid-playback without running the
     cleanup here would leave the page unable to scroll. */
  stage = h('div.ar-scrim', {}, panel);
  document.body.style.overflow = 'hidden';
  modalRoot().appendChild(stage);

  const paintTile = (who, f) => {
    const el = sideOf(who).byKey.get(f.key);
    if (!el) return;
    const at = Math.max(0, hp.get(f.key) ?? f.hp);
    el.__bar.style.transform = `scaleX(${at / Math.max(1, f.maxHp)})`;
    el.__num.textContent = String(Math.round(at));
    el.classList.toggle('is-down', at <= 0);
    el.classList.toggle('is-low', at > 0 && at < f.maxHp * 0.35);
  };
  const paintSide = (who) => {
    for (const f of run[who]) paintTile(who, f);
  };

  let timer = 0;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = 0;
  };
  let done = false;
  let started = false;

  function finish(jumped) {
    if (done) return;
    done = true;
    clear();
    intro.remove();
    if (jumped) {
      for (const who of ['from', 'to']) for (const f of run[who]) hp.set(f.key, f.hp);
      paintSide('from');
      paintSide('to');
    }
    clock.textContent = clockText(jumped ? 0 : run.clock);
    clock.classList.toggle('is-out', Number(run.clock) <= 0 || jumped);
    skip.hidden = true;
    leave.hidden = false;
    const won = outcome?.won;
    hint.classList.add('is-done');
    if (won !== null && won !== undefined) {
      hint.classList.add(won ? 'is-win' : 'is-loss');
      panel.classList.add(won ? 'is-win' : 'is-loss');
    }
    hint.replaceChildren(
      icon(won === true ? 'trophy' : won === false ? 'x' : 'clock'),
      h(
        'span',
        {},
        won === true
          ? t('You took it.')
          : won === false
            ? t('You lost — your streak is back to zero.')
            : t('The fight is over, but the result did not reach the server.'),
      ),
    );
    if (won === true && !reduced()) sfx.evolve(3);
    if (won === false && !reduced()) sfx.evolve(1);
    if (outcome?.streak != null) {
      log.prepend(h('p.ar-call', {}, icon('flame'), h('span', {}, t('Win streak: {n}', { n: outcome.streak }))));
    }
    if (run.capped) {
      log.prepend(h('p.ar-call', {}, icon('clock'), h('span', {}, t('Called on the clock.'))));
    }
  }

  stageKey = (e) => {
    if (e.key !== 'Escape') return;
    if (done) closeStage();
    else finish(true);
  };
  document.addEventListener('keydown', stageKey);
  /* Walking away costs nothing: the result was filed before this frame opened, so
     closing early cannot lose a win — it only skips the replay. */
  stage.addEventListener('click', (e) => {
    if (e.target === stage) closeStage();
  });

  const turns = run.turns;
  let at = 0;

  function tick() {
    const ev = turns[at];
    if (!ev) {
      finish(false);
      return;
    }
    at += 1;
    const target = ev.side === 'from' ? 'to' : 'from';
    const striker = sideOf(ev.side).byKey.get(ev.by);
    hp.set(ev.to, ev.left);
    clock.textContent = clockText(ev.clock);

    striker?.classList.add('is-lunge');
    setTimeout(() => striker?.classList.remove('is-lunge'), 260);

    const victim = sideOf(target).byKey.get(ev.to);
    if (victim) {
      const box = layer.getBoundingClientRect();
      const rect = victim.getBoundingClientRect();
      if (box.width && box.height) {
        sparks(
          layer,
          ((rect.left + rect.width / 2 - box.left) / box.width) * 100,
          ((rect.top + rect.height / 2 - box.top) / box.height) * 100,
          ev.crit || ev.boosted,
        );
      }
      victim.classList.add('is-hit');
      setTimeout(() => victim.classList.remove('is-hit'), 260);
    }
    paintSide(target);
    if (!reduced()) {
      if (ev.crit) sfx.reveal(1);
      else sfx.click();
    }

    if (ev.boosted) {
      log.prepend(
        h('p.ar-call.is-ability', {}, icon(ABILITY_ICON[ev.ability]), h('span', {}, t('{ability} — {name} opens with {dmg}.', { ability: ABILITY_TEXT[ev.ability](), name: ev.byName, dmg: ev.dmg }))),
      );
    } else if (ev.crit) {
      log.prepend(h('p.ar-call.is-crit', {}, icon('sparkles'), h('span', {}, t('Critical — {dmg}', { dmg: ev.dmg }))));
    } else {
      log.prepend(h('p.ar-call', {}, h('span', {}, t('{name} hits for {dmg}.', { name: ev.byName, dmg: ev.dmg }))));
    }
    if (ev.down) {
      log.prepend(h('p.ar-call.is-down', {}, icon('x'), h('span', {}, t('{name} is out.', { name: ev.toName }))));
      if (!reduced()) sfx.evolve(1);
    }
    while (log.childElementCount > 6) log.lastElementChild.remove();

    timer = setTimeout(tick, run.turnMs || 900);
  }

  /** Lift the intro and start the turns. The only control here that starts a
      fight, so it is also the only place a sound plays without a turn. */
  function begin() {
    if (started || done) return;
    started = true;
    intro.remove();
    hint.replaceChildren(icon('bolt'), h('span', {}, t('Fighting…')));
    if (!reduced()) sfx.reveal(2);
    if (reduced()) finish(true);
    else timer = setTimeout(tick, 320);
  }

  if (reduced()) finish(true);
  else {
    /* The taunts read themselves after a beat even if nobody presses the button;
       a dialog that waits on a tap is a dialog people leave. */
    timer = setTimeout(() => begin(), 2600);
  }

  return closeStage;
}

/* ---- one duel row ------------------------------------------------------ */
function duelRow(duel, actions) {
  const other = duel.mine === 'from' ? duel.to : duel.from;
  const closed = duel.state !== 'awaiting' && duel.state !== 'ready';
  const won = iWon(duel);
  const side = (who) => {
    const cards = duel.lineups?.[who] || [];
    return h(
      'div.ar-side-cards',
      {},
      ...(cards.length
        ? cards.map((c) => gachaCard(displayCard(c), { variant: 'tile', eager: false }))
        : [h('span.ar-empty', {}, icon('lock'), h('span', {}, t('Not committed')))]),
    );
  };

  return h(
    `article.ar-duel.is-${duel.state}${won === true ? '.is-won' : won === false ? '.is-lost' : ''}`,
    {},
    h(
      'header.ar-top',
      {},
      h(
        'a.ar-who',
        { href: `#/profile/${encodeURIComponent(other?.id || '')}` },
        avatar(other, { size: 'sm' }),
        h(
          'span.ar-who-names',
          {},
          h('span.ar-who-top', {}, h('b', {}, shownName(other) || t('A member')), titleChip(other)),
          h('span.faint', {}, other?.username ? `@${other.username}` : t('This member is gone')),
        ),
      ),
      h(
        'span.ar-when',
        {},
        h(
          `span.ar-state.is-${duel.state}`,
          {},
          icon(closed ? (duel.state === 'done' ? 'check' : 'x') : 'bolt'),
          h('span', {}, (STATE_TEXT[duel.state] || STATE_TEXT.awaiting)()),
          duel.state === 'awaiting' ? h('span.tnum', {}, `· ${leftText(duel.expiresIn || 0)}`) : null,
        ),
        h('span.faint.tnum', {}, relativeTime(duel.at)),
      ),
    ),
    duel.note ? h('p.ar-note', {}, duel.note) : null,
    h(
      'div.ar-body',
      {},
      h(
        'div.ar-side-block',
        {},
        h('h4.ar-side-label', {}, duel.mine === 'from' ? t('You') : t('Them')),
        side('from'),
        h('span.ar-power.tnum', {}, t('Peak {n}', { n: Number(duel.power?.from) || 0 })),
      ),
      h('span.ar-clash', { 'aria-hidden': 'true' }, icon('swap')),
      h(
        'div.ar-side-block',
        {},
        h('h4.ar-side-label', {}, duel.mine === 'to' ? t('You') : t('Them')),
        side('to'),
        h('span.ar-power.tnum', {}, t('Peak {n}', { n: Number(duel.power?.to) || 0 })),
      ),
    ),
    won === null
      ? null
      : h('p.ar-result', {}, icon(won ? 'trophy' : 'x'), h('span', {}, won ? t('You won this one.') : t('You lost this one.'))),
    closed
      ? null
      : h(
          'div.ar-actions',
          {},
          duel.state === 'ready'
            ? h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => actions.fight(duel) }, icon('bolt'), h('span', {}, t('Fight')))
            : !duel.iSigned
              ? h(
                  'button.btn.btn--primary.btn--sm',
                  { type: 'button', onclick: () => actions.commit(duel) },
                  icon(awaitingMe(duel) ? 'check' : 'edit'),
                  h('span', {}, awaitingMe(duel) ? t('Accept and pick two') : t('Commit my line-up')),
                )
              : null,
          h('button.btn.btn--sm.btn--ghost', { type: 'button', onclick: () => actions.cancel(duel) }, icon('x'), h('span', {}, t('Call it off'))),
        ),
  );
}

/* ---- the page ---------------------------------------------------------- */
export function ArenaView({ onCleanup }) {
  if (!duelsAvailable()) {
    return h(
      'div.arena',
      {},
      emptyState({
        iconName: 'offline',
        heading: t('Duels need a Solvn server'),
        body: t('A fight is settled by the server that runs this site, which this copy does not have.'),
        action: h('a.btn.btn--primary', { href: '#/' }, icon('home'), h('span', {}, t('Back to home'))),
      }),
    );
  }

  const wrap = h('div.arena');
  if (!isSignedIn()) {
    wrap.replaceChildren(
      emptyState({
        iconName: 'bolt',
        heading: t('Sign in to duel'),
        body: t('A win is a record on an account, so it cannot be kept for nobody.'),
        action: h(
          'button.btn.btn--primary',
          { type: 'button', onclick: () => authSheet('login') },
          icon('user'),
          h('span', {}, t('Sign in')),
        ),
      }),
    );
    return wrap;
  }

  const lineupRow = h('div.ar-lineup');
  const list = h('div.ar-list', { 'aria-live': 'polite' });
  /** The closer for a playable fight, so a route change cannot leave it running. */
  let battleClose = null;
  /** Duel ids already on screen, so a lobby match can be announced once. */
  const seen = new Set();

  const paintLineup = () => {
    const keys = readLineup();
    const cards = cardsOf(keys);
    lineupRow.replaceChildren(
      h('h2.ar-h2', {}, t('Your line-up')),
      h(
        'div.ar-lineup-row',
        {},
        ...(cards.length
          ? cards.map((c) => gachaCard(displayCard(c), { variant: 'tile', eager: false }))
          : Array.from({ length: LINEUP - cards.length }, () => h('span.ar-slot', {}, icon('plus')))),
      ),
      h(
        'div.ar-lineup-foot',
        {},
        h('span.faint.tnum', {}, cards.length ? t('Peak Power {n}', { n: peak(cards) }) : t('No cards picked yet.')),
        h(
          'button.btn.btn--sm',
          { type: 'button', onclick: () => lineupSheet(paintLineup) },
          icon('edit'),
          h('span', {}, t('Choose cards')),
        ),
      ),
    );
  };

  /**
   * File one finished fight on this member's record.
   *
   * Both modes land here: a CPU match writes one half, and a live match writes
   * each player's own half on their own device. The streak returned by the server
   * is what the result card prints, so the number under a win is the record the
   * profile and the ranked board read, not a local counter that drifted.
   */
  async function settleBattle({ won }) {
    countToday(won);
    awardXp(won ? XP_WIN : XP_LOSS, won ? 'duel-win' : 'duel-loss');
    let streak = null;
    try {
      const res = await filePractice(won);
      if (res?.record) streak = Number(res.record.streak) || 0;
      await refresh().catch(() => null);
    } catch {
      /* The fight already printed its answer; a record that failed to file does
         not un-fight it. The badge simply has no new streak to show. */
    }
    paint();
    return { streak };
  }

  function mySide(cards) {
    return {
      name: shownName(currentUser()) || t('You'),
      handle: currentUser()?.username ? `@${currentUser().username}` : '',
      avatar: currentUser()?.avatar || null,
      cards,
    };
  }

  /** Fight the CPU from the cards already on the bench. */
  function startCpu(keys = readLineup()) {
    if (keys.length !== LINEUP) {
      lineupSheet(() => startCpu());
      return;
    }
    const mine = cardsOf(keys);
    const rivalCards = cpuLineup(keys);
    if (mine.length !== LINEUP || rivalCards.length !== LINEUP) {
      toast(t('Pick two cards first.'), { tone: 'err', iconName: 'alert' });
      return;
    }
    const rival = { name: t('Arena CPU'), handle: t('Quick fight'), cpu: true };
    const battle = makeBattle({
      seed: newSeed(),
      at: Date.now() + 2600,
      mine: mySide(mine),
      rival: { ...rival, cards: rivalCards },
    });
    if (!battle) {
      toast(t('That fight could not start.'), { tone: 'err', iconName: 'alert' });
      return;
    }
    sfx.pack();
    battleClose = openBattle({
      battle,
      mode: 'cpu',
      rival,
      onSettle: settleBattle,
      onRematch: () => startCpu(keys),
    });
  }

  /** Open the board a live handshake produced. */
  function openOnlineMatch(match, keys) {
    const mine = cardsOf(keys);
    const battle = makeBattle({
      seed: match.seed,
      at: match.at,
      mine: mySide(mine),
      rival: {
        name: match.rival.name,
        handle: match.rival.handle,
        avatar: match.rival.avatar,
        cards: match.rival.cards,
      },
      opener: match.role === 'initiator' ? 'mine' : 'rival',
    });
    if (!battle) {
      toast(t('That match could not start.'), { tone: 'err', iconName: 'alert' });
      return;
    }
    sfx.pack();
    battleClose = openBattle({
      battle,
      mode: 'online',
      rival: match.rival,
      online: match,
      onSettle: settleBattle,
    });
    paint();
  }

  /**
   * The live search screen.
   *
   * It counts the lobby, counts down to the CPU, and leaves both exits visible:
   * a person can take the CPU now or stop looking. When the handshake lands the
   * sheet closes and the board opens on the seed both sides already hold.
   */
  function fightOnline(keys = readLineup()) {
    if (keys.length !== LINEUP) {
      lineupSheet(() => fightOnline());
      return;
    }
    if (!onlineArenaReady()) {
      toast(t('This browser cannot carry a live match. The CPU will take the fight.'), { iconName: 'offline' });
      startCpu(keys);
      return;
    }
    const cards = cardsOf(keys);
    if (cards.length !== LINEUP) return;

    let search = null;
    let done = false;
    let left = Math.round(FALLBACK_MS / 1000);
    const status = h('p.bt-search-status', { 'aria-live': 'polite' }, icon('globe'), h('span', {}, t('Connecting to the lobby…')));
    const count = h('p.faint.bt-search-count', {}, t('Nobody in the lobby yet.'));
    const countdown = h('p.faint.bt-search-count.tnum', {}, t('If nobody turns up, the CPU steps in in {n}s.', { n: left }));

    const api = sheet({
      heading: t('Fight online'),
      sub: t('Two cards, one clock, and a real person on the other side when one is waiting near your Power.'),
      width: 560,
      render: () =>
        h(
          'div.bt-search',
          {},
          h('div.bt-search-mode', {}, icon('globe'), h('span', {}, t('Live matchmaking'))),
          status,
          count,
          countdown,
        ),
      footer: [
        h('button.btn', { type: 'button', onclick: () => cpuNow() }, icon('bolt'), h('span', {}, t('Fight the CPU now'))),
        h('button.btn.btn--ghost', { type: 'button', onclick: () => api.close() }, icon('x'), h('span', {}, t('Stop searching'))),
      ],
    });

    const ticker = setInterval(() => {
      if (done) return;
      left -= 1;
      if (left <= 0) {
        countdown.textContent = t('The CPU takes the fight.');
        cpuNow();
        return;
      }
      countdown.textContent = t('If nobody turns up, the CPU steps in in {n}s.', { n: left });
    }, 1000);

    function cpuNow() {
      if (done) return;
      done = true;
      clearInterval(ticker);
      search?.cancel();
      api.close();
      startCpu(keys);
    }

    api.onClose(() => {
      clearInterval(ticker);
      if (!done) {
        done = true;
        search?.cancel();
      }
    });

    search = searchOnline({
      cards,
      onStatus: (state) => {
        if (done) return;
        if (state === 'open') status.replaceChildren(icon('globe'), h('span', {}, t('Lobby connected. Looking for a match near your Power…')));
      },
      onLobby: ({ peers, best }) => {
        if (done) return;
        count.textContent = peers ? t('{n} waiting in the lobby.', { n: peers }) : t('Nobody in the lobby yet.');
        status.replaceChildren(
          icon(best ? 'bolt' : 'globe'),
          h('span', {}, best ? t('Found someone near your Power. Opening the match…') : t('Looking for an opponent near your Power…')),
        );
      },
      onError: () => {
        if (done) return;
        done = true;
        clearInterval(ticker);
        api.close();
        toast(t('The lobby is not answering. The CPU will take the fight.'), { tone: 'err', iconName: 'offline' });
        startCpu(keys);
      },
      onMatch: (match) => {
        if (done) return;
        done = true;
        clearInterval(ticker);
        api.close();
        openOnlineMatch(match, keys);
      },
    });
  }

  const actions = {
    async commit(duel) {
      const keys = readLineup();
      if (keys.length !== LINEUP) {
        lineupSheet(() => actions.commit(duel));
        return;
      }
      try {
        const d = await commitLineup(duel.id, keys);
        if (d.error) toast(t(d.error), { tone: 'err', iconName: 'alert' });
        else if (d?.duel?.state === 'ready') toast(t('Both line-ups are in. Fight it.'), { iconName: 'sparkles' });
        else toast(t('Committed. Waiting for the other side.'), { iconName: 'check' });
      } catch (err) {
        toast(say(err, t('That line-up did not commit.')), { tone: 'err', iconName: 'alert' });
      }
      paint();
    },
    async cancel(duel) {
      try {
        await callOff(duel.id);
        toast(t('Called off.'), { iconName: 'check' });
      } catch (err) {
        toast(say(err, t('That duel could not be called off.')), { tone: 'err', iconName: 'alert' });
      }
      paint();
    },
    /**
     * Fight. The result is filed *before* the playback runs: whoever presses first
     * settles it, and the second screen plays back the same answer instead of
     * starting a race between two clients.
     */
    async fight(duel) {
      const run = runDuel(duel);
      if (!run) {
        toast(t('That duel is not ready yet.'), { tone: 'err', iconName: 'alert' });
        return;
      }
      sfx.pack();
      let outcome = { won: null, streak: null };
      try {
        const d = await settle(duel);
        if (d.error) toast(t(d.error), { tone: 'err', iconName: 'alert' });
        else if (d.duel?.result) {
          outcome = { won: d.won, streak: Number(currentUser()?.duel?.streak) || 0 };
          if (d.won) toast(t('Victory. Your streak is {n}.', { n: outcome.streak }), { iconName: 'trophy' });
        }
      } catch (err) {
        toast(say(err, t('The result did not file.')), { tone: 'err', iconName: 'alert' });
      }
      openArena(duel, run, outcome);
      paint();
    },
  };

  const head = h(
    'div.ar-head-row',
    {},
    h(
      'div',
      {},
      h('h1.display', {}, t('Arena')),
      h('p.muted', {}, t('Two cards a side, one strike at a time. Fight a real opponent online, or take on the CPU in a quick match.')),
      h('div.ar-record-line', {}, divisionChip(currentUser()), duelRecord(currentUser())),
    ),
    h(
      'div.ar-modes',
      {},
      h('button.btn.btn--primary', { type: 'button', onclick: () => fightOnline() }, icon('globe'), h('span', {}, t('Fight online'))),
      h('button.btn', { type: 'button', onclick: () => startCpu() }, icon('cpu'), h('span', {}, t('Quick fight (CPU)'))),
      h('button.btn.btn--ghost', { type: 'button', onclick: () => inviteSheet(paint) }, icon('users'), h('span', {}, t('Challenge a member'))),
      h('a.btn.btn--ghost', { href: '#/leaderboard' }, icon('trophy'), h('span', {}, t('Ranked board'))),
    ),
  );

  function paint() {
    const s = duelState();
    paintLineup();

    const openRows = s.duels.filter((d) => d.state === 'awaiting' || d.state === 'ready');
    const past = s.duels.filter((d) => d.state !== 'awaiting' && d.state !== 'ready');
    list.replaceChildren(
      ...(openRows.length ? [h('h2.ar-h2', {}, t('Open duels')), ...openRows.map((d) => duelRow(d, actions))] : []),
      ...(past.length ? [h('h2.ar-h2', {}, t('Recent fights')), ...past.map((d) => duelRow(d, actions))] : []),
      ...(!s.loaded ? [h('p.faint', {}, t('Loading…'))] : []),
      ...(!openRows.length && !past.length && s.loaded
        ? [
            emptyState({
              iconName: 'bolt',
              heading: t('No duels yet'),
              body: s.failed
                ? t('The duel list is not answering right now.')
                : t('Pick two cards and either fight online or start a quick match against the CPU.'),
            }),
          ]
        : []),
    );
    for (const d of s.duels) seen.add(d.id);
  }

  paintLineup();
  paint();
  loadDuels().then(paint);

  /* An arrival on the shared inbox is a line-up committed, a match made or a
     result filed — all three change the row, and none of them should wait for the
     next poll. */
  const unsubscribe = subscribeDuels((duel) => {
    if (duel?.mode === 'queue' && duel.state === 'ready' && !seen.has(duel.id)) {
      toast(t('A duel just opened. Pick your two.'), { iconName: 'bolt' });
    }
    loadDuels().then(paint);
  });
  const onAccount = () => paint();
  document.addEventListener('kitsune:account', onAccount);
  onCleanup(() => {
    battleClose?.();
    unsubscribe();
    closeStage();
    document.removeEventListener('kitsune:account', onAccount);
  });
  return wrap;
}
