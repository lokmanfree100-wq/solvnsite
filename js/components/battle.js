/**
 * The playable stage.
 *
 * The replay stage in `views/arena.js` plays a fight that has already happened.
 * This one is the fight itself: two lines of cards, a ninety-second clock, and
 * four buttons that are only live on your turn — a strike, a brace, and the two
 * moves of the card in front, whose names are written onto the buttons each time
 * a fighter steps forward. Every press is applied locally
 * and, in an online match, handed to `lib/live-arena.js`; the other screen applies
 * the same step to its own copy of the same seed. Nothing here decides a winner
 * on its own — `lib/battle.js` does, and `finish()` only prints the answer.
 *
 * The intro is the one moment before the clock that is pure set dressing: two
 * taunts picked from the seed, the ability each lead card fights with, and a
 * button. It lifts on its own at the shared start time, so a live match opens on
 * both screens together whether or not anyone taps.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { displayCard, rarityOf } from '../lib/cards.js';
import {
  MATCH_MS,
  IDLE_MS,
  act,
  activeOf,
  botAction,
  finishByTime,
  skillReady,
  skillWait,
  scoreOf,
  timeLeft,
} from '../lib/battle.js';
import { openMatch, peerId } from '../lib/live-arena.js';
import { gachaCard } from './gacha.js';
import { sfx } from '../lib/sounds.js';

const TAUNTS = [
  () => t('One strike is all this takes.'),
  () => t('You brought those two? Bold.'),
  () => t('The plate says a lot. The fight says the rest.'),
  () => t('I did not come here to bow.'),
  () => t('Try to keep up.'),
  () => t('Let us see what your binder is worth.'),
];

const ABILITY_LABEL = {
  overdrive: () => t('Overdrive'),
  blitz: () => t('Blitz'),
  focus: () => t('Focus'),
  guard: () => t('Guard'),
};
const ABILITY_ICON = { overdrive: 'flame', blitz: 'bolt', focus: 'sparkles', guard: 'star' };

/** The school move each build brings. These are the player's own buttons, so the
    label is the move, not the stat that chose it. */
const SKILL_LABEL = {
  quake: () => t('Ground Quake'),
  flurry: () => t('Gale Flurry'),
  spike: () => t('Piercing Spike'),
  mend: () => t('Vital Mend'),
};
const SKILL_ICON = { quake: 'flame', flurry: 'bolt', spike: 'sparkles', mend: 'star' };

/* Speed is a CPU-only convenience: a live match runs on a shared ninety-second
   clock, so one side cannot fast-forward the other. */
const SPEEDS = [1, 2, 4, 8];

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const modalRoot = () => document.querySelector('#modal-root');

const clockText = (ms) => {
  const total = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const seedNumber = (text) => {
  let n = 0;
  for (const ch of String(text || '')) n = (Math.imul(n, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(n);
};

/** A spark burst. `scale` is 1 / match speed, so a fast CPU fight throws fewer
    dots and clears them sooner — the phone never holds a pile of dead nodes. */
function sparks(layer, x, y, strong, scale = 1) {
  if (reduced()) return;
  const count = scale < 0.4 ? 4 : strong ? 9 : 6;
  const bits = h('div.ar-sparks');
  bits.style.left = `${x}%`;
  bits.style.top = `${y}%`;
  for (let i = 0; i < count; i += 1) {
    const bit = h('i.ar-spark');
    bit.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 120)}px`);
    bit.style.setProperty('--dy', `${Math.round((Math.random() - 0.5) * 120)}px`);
    bit.style.animationDelay = `${Math.round(Math.random() * 90 * scale)}ms`;
    bits.append(bit);
  }
  layer.append(bits);
  setTimeout(() => bits.remove(), Math.round(640 * Math.max(0.35, scale)));
}

/** Where a tile sits inside the spark field, as a percentage pair. */
function pointIn(layer, el) {
  if (!el) return null;
  const box = layer.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    x: ((rect.left + rect.width / 2 - box.left) / box.width) * 100,
    y: ((rect.top + rect.height / 2 - box.top) / box.height) * 100,
  };
}

/** The number a hit prints: it lifts off the card and fades, so a glance at the
    board carries the damage without reading the call sheet. `aria-hidden`
    because the same figure is already in the log for a screen reader. */
function damagePop(layer, at, text, { strong = false, heal = false, scale = 1 } = {}) {
  if (reduced() || !at) return;
  const tag = h(`span.bt-dmg${strong ? '.is-strong' : ''}${heal ? '.is-heal' : ''}`, { 'aria-hidden': 'true' }, text);
  tag.style.left = `${at.x}%`;
  tag.style.top = `${at.y}%`;
  layer.append(tag);
  setTimeout(() => tag.remove(), Math.round(900 * Math.max(0.35, scale)));
}

/** The crossing slash where the blade met the card. */
function clashBurst(layer, at, strong, scale = 1) {
  if (reduced() || !at) return;
  const burst = h(`span.bt-clash${strong ? '.is-strong' : ''}`, { 'aria-hidden': 'true' });
  burst.style.left = `${at.x}%`;
  burst.style.top = `${at.y}%`;
  layer.append(burst);
  setTimeout(() => burst.remove(), Math.round(520 * Math.max(0.35, scale)));
}

let liveStage = null;

/**
 * Open a fight. Returns a closer, which the arena view keeps so a route change
 * cannot leave a hidden board holding the scroll lock.
 */
export function openBattle({ battle, mode, rival, online = null, onClose, onRematch, onSettle }) {
  liveStage?.close();
  if (!battle) return () => {};

  const layer = h('div.ar-spark-layer');
  const log = h('div.ar-log.bt-log', { 'aria-live': 'polite' });
  const clock = h('span.ar-clock.tnum', {}, clockText(MATCH_MS));
  const turnLine = h('p.bt-turn', { 'aria-live': 'polite' });
  const conn = h('span.bt-conn', { hidden: mode !== 'online' }, icon('globe'), h('span', {}, t('Connecting…')));
  const result = h('div.bt-result', { hidden: true });

  const tiles = new Map();
  function fighterTile(f, side) {
    const shown = displayCard(f);
    const r = rarityOf(shown.lv);
    const ghost = h('i.bt-hp-ghost');
    const bar = h('i.ar-hp-fill');
    const num = h('span.ar-hp-num.tnum', {}, String(f.hp));
    const shield = h('span.bt-shield', { hidden: true }, icon('shield'), h('span', {}, t('Braced')));
    const tile = h(
      'div.ar-fighter.bt-fighter',
      { 'data-id': f.id },
      h('div.bt-body', {}, h('div.ar-fighter-card', {}, gachaCard(shown, { variant: 'tile', eager: false }))),
      shield,
      h('div.ar-hp', { role: 'presentation' }, ghost, bar),
      num,
    );
    tile.style.setProperty('--ga', r.a);
    tile.style.setProperty('--gb', r.b);
    tile.style.setProperty('--glow', r.glow);
    tile.__bar = bar;
    tile.__ghost = ghost;
    tile.__num = num;
    tile.__shield = shield;
    tile.__fighter = f;
    tiles.set(f.id, tile);
    return tile;
  }

  const line = (side) =>
    h(
      `div.ar-line.bt-line.${side === 'mine' ? 'is-mine' : 'is-theirs'}`,
      {},
      ...battle.sides[side].cards.map((f) => fighterTile(f, side)),
    );

  const closeBtn = h(
    'button.icon-btn.bt-close',
    { type: 'button', 'aria-label': t('Leave the fight'), onclick: () => close() },
    icon('x'),
  );

  const mineLine = line('mine');
  const rivalLine = line('rival');
  const board = h('div.ar-board.bt-board', {}, h('div.bt-floor', { 'aria-hidden': 'true' }), mineLine, layer, rivalLine);

  const panel = h(
    'div.ar-stage.bt-stage',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('The fight') },
    h(
      'header.ar-stage-head.bt-head',
      {},
      h(
        'div.ar-stage-side',
        {},
        h('b', {}, battle.sides.mine.name),
        h('span.faint', {}, battle.sides.mine.handle || t('You')),
      ),
      h('span.ar-vs', { 'aria-hidden': 'true' }, icon('bolt')),
      h(
        'div.ar-stage-side.is-right',
        {},
        h('b', {}, battle.sides.rival.name),
        h('span.faint.bt-sub', {}, battle.sides.rival.handle || (mode === 'cpu' ? t('Arena CPU') : t('A member'))),
        conn,
      ),
      h('div.bt-head-end', {}, clock, closeBtn),
    ),
    board,
    h('div.bt-feed', {}, log, turnLine),
    result,
  );

  /* ---- the kit bar ------------------------------------------------------ */
  /* Every move is a card of its own: icon, name, one line of state, and the
     number key that presses it. The two character moves are repainted from the
     card in front, so the bar always reads as that fighter's kit rather than a
     generic menu. */
  let speed = 1;
  const animScale = () => Math.max(0.14, 1 / speed);

  function actionBtn(iconName, cls, label, press) {
    const iconBox = h('span.bt-action-icon', {}, icon(iconName));
    const name = h('b', {}, label);
    const note = h('em');
    const key = h('span.bt-action-key', { 'aria-hidden': 'true' });
    const btn = h(
      `button.btn.bt-action${cls}`,
      { type: 'button', 'data-sfx': 'none', onclick: () => press() },
      iconBox,
      h('span.bt-action-txt', {}, name, note),
      key,
    );
    return { btn, iconBox, iconName, name, note, key };
  }

  const strikeA = actionBtn('sword', '.is-strike', t('Strike'), () => doAct('mine', 'strike'));
  const braceA = actionBtn('shield', '.is-brace', t('Brace'), () => doAct('mine', 'brace'));
  const skillA = actionBtn('bolt', '.is-skill', t('Skill'), () => doAct('mine', 'skill'));
  const sigA = actionBtn('flame', '.is-sig', t('Signature'), () => doAct('mine', 'ability'));
  strikeA.key.textContent = '1';
  braceA.key.textContent = '2';
  skillA.key.textContent = '3';
  sigA.key.textContent = '4';
  strikeA.note.textContent = t('Basic');
  braceA.note.textContent = t('Halves the next hit');
  const strikeBtn = strikeA.btn;
  const braceBtn = braceA.btn;
  const skillBtn = skillA.btn;
  const sigBtn = sigA.btn;
  const actions = h('div.bt-actions', {}, strikeBtn, braceBtn, skillBtn, sigBtn);

  const kitName = h('b');
  const kitMeta = h('span');
  const kitLine = h(
    'p.bt-kit',
    {},
    icon('sparkles'),
    h('span.bt-kit-txt', {}, kitName, kitMeta),
  );

  const speedChips = SPEEDS.map((n) =>
    h(
      'button.bt-speed-chip',
      { type: 'button', 'aria-pressed': n === 1 ? 'true' : 'false', 'aria-label': t('Match speed: {n}×', { n }), onclick: () => setSpeed(n) },
      `${n}×`,
    ),
  );
  const speedRow = h(
    'div.bt-speed',
    { hidden: mode !== 'cpu' },
    h('span.bt-speed-label', {}, icon('bolt'), h('span', {}, t('Speed'))),
    h('div.bt-speed-chips', {}, ...speedChips),
  );
  const kitRow = h('div.bt-kitrow', {}, kitLine, speedRow);

  panel.insertBefore(kitRow, result);
  panel.insertBefore(actions, result);
  panel.style.setProperty('--bt-anim', '1');

  const taunt = seedNumber(battle.seed);
  const introSide = (side, index) => {
    const card = battle.sides[side].cards[0];
    const lineText = TAUNTS[(taunt + (index ? 1 + (taunt % (TAUNTS.length - 1)) : 0)) % TAUNTS.length]();
    return h(
      `div.ar-intro-side${index ? '.is-right' : ''}`,
      {},
      card ? h('div.ar-intro-card', {}, gachaCard(displayCard(card), { variant: 'tile', eager: true })) : null,
      h(
        'div.ar-intro-names',
        {},
        h('b', {}, battle.sides[side].name),
        h('span.faint', {}, battle.sides[side].handle || (side === 'rival' && mode === 'cpu' ? t('Arena CPU') : '')),
      ),
      card
        ? h(
            'div.ar-kit-chips',
            {},
            h('span.ar-ability', {}, icon(ABILITY_ICON[card.ability]), h('span', {}, ABILITY_LABEL[card.ability]())),
            h('span.ar-ability.is-skill', {}, icon(SKILL_ICON[card.skill]), h('span', {}, SKILL_LABEL[card.skill]())),
          )
        : null,
      h('div.bt-bubble', {}, h('p.ar-taunt', {}, lineText)),
    );
  };

  const beginBtn = h(
    'button.btn.btn--primary.ar-intro-go',
    { type: 'button', onclick: () => begin() },
    icon('play'),
    h('span', {}, t('Begin the duel')),
  );
  const waitLine = h('p.bt-wait', { hidden: mode === 'cpu' });

  const intro = h(
    'div.ar-intro.bt-intro',
    { role: 'group', 'aria-label': t('Before the first strike') },
    h('p.ar-intro-kicker', {}, mode === 'online' ? t('Live match') : t('Quick fight — CPU')),
    h(
      'div.ar-intro-body',
      {},
      introSide('mine', 0),
      h('span.ar-intro-vs', { 'aria-hidden': 'true' }, icon('bolt')),
      introSide('rival', 1),
    ),
    beginBtn,
    waitLine,
  );
  panel.append(intro);

  if (mode === 'online') {
    beginBtn.disabled = true;
    beginBtn.replaceChildren(icon('globe'), h('span', {}, t('Both sides start together')));
  }

  const stage = h('div.ar-scrim.bt-scrim', {}, panel);
  liveStage = { close };
  document.body.style.overflow = 'hidden';
  modalRoot().appendChild(stage);

  /* ---- state ------------------------------------------------------------ */
  let ended = false;
  let started = false;
  let live = false;
  let closed = false;
  let ticker = 0;
  let idle = 0;
  let bot = 0;
  let introTick = 0;
  let pendingMoves = [];
  let match = null;

  const clearTimers = () => {
    clearInterval(ticker);
    clearInterval(introTick);
    clearTimeout(idle);
    clearTimeout(bot);
    ticker = 0;
    introTick = 0;
    idle = 0;
    bot = 0;
  };

  function close() {
    if (closed) return;
    closed = true;
    clearTimers();
    match?.close();
    document.removeEventListener('keydown', onKey);
    stage.remove();
    if (liveStage?.close === close) liveStage = null;
    if (!modalRoot()?.childElementCount) document.body.style.removeProperty('overflow');
    onClose?.();
  }

  /** CPU-only pace. `--bt-anim` is the one multiplier the stylesheet reads, and
      the script's own holds divide by the same number. */
  function setSpeed(next) {
    speed = SPEEDS.includes(next) ? next : 1;
    panel.style.setProperty('--bt-anim', String(Math.max(0.14, 1 / speed)));
    for (const [i, chip] of speedChips.entries()) {
      chip.setAttribute('aria-pressed', SPEEDS[i] === speed ? 'true' : 'false');
    }
  }

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    const slot = Number(e.key) - 1;
    const btns = [strikeBtn, braceBtn, skillBtn, sigBtn];
    if (Number.isInteger(slot) && slot >= 0 && slot < btns.length && !btns[slot].disabled) {
      e.preventDefault();
      btns[slot].click();
    }
  };
  document.addEventListener('keydown', onKey);
  stage.addEventListener('click', (e) => {
    if (e.target === stage) close();
  });

  /* ---- painting --------------------------------------------------------- */
  const activeId = (side) => activeOf(battle, side)?.id || null;

  /* A blade landing moves the whole board, not just the card. Web Animations
     keeps this out of the stage's CSS entrance, so a hit can never replay the
     pop-in that belongs to opening the stage. */
  function shakeStage(strong) {
    if (reduced() || !panel.animate) return;
    const d = strong ? 9 : 5;
    panel.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${-d}px, ${d / 2}px)` },
        { transform: `translate(${d}px, ${-d / 2}px)` },
        { transform: `translate(${-Math.round(d / 2)}px, 0)` },
        { transform: 'translate(0, 0)' },
      ],
      { duration: Math.round((strong ? 320 : 220) * Math.max(0.4, animScale())), easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
  }

  function paintFighters() {
    for (const side of ['mine', 'rival']) {
      for (const f of battle.sides[side].cards) {
        const tile = tiles.get(f.id);
        if (!tile) continue;
        const share = Math.max(0, f.hp) / Math.max(1, f.maxHp);
        tile.__bar.style.transform = `scaleX(${share})`;
        tile.__ghost.style.transform = `scaleX(${share})`;
        tile.__num.textContent = String(Math.round(f.hp));
        tile.classList.toggle('is-down', f.hp <= 0);
        tile.classList.toggle('is-low', f.hp > 0 && f.hp < f.maxHp * 0.35);
        tile.classList.toggle('is-active', f.hp > 0 && f.id === activeId(side));
        tile.__shield.hidden = !f.shield;
        tile.setAttribute(
          'aria-label',
          t('{name}, {hp} of {max} hit points', { name: f.name, hp: Math.round(f.hp), max: f.maxHp }),
        );
      }
    }
  }

  function setIcon(a, name) {
    if (a.iconName === name) return;
    a.iconName = name;
    a.iconBox.replaceChildren(icon(name));
  }

  /** The bar belongs to the card in front. Its two character moves, their state
      and the name above them are rewritten on every turn, so a knock-out that
      brings the reserve forward changes the whole kit in the same frame. */
  function paintActions() {
    const active = activeOf(battle, 'mine');
    const mine = started && !ended && live && battle.turn === 'mine';
    strikeBtn.disabled = !mine;
    braceBtn.disabled = !mine;
    if (!active) {
      kitName.textContent = '';
      kitMeta.textContent = '';
      skillBtn.disabled = true;
      sigBtn.disabled = true;
      return;
    }
    kitName.textContent = active.name;
    kitMeta.textContent = `${ABILITY_LABEL[active.ability]()} · ${SKILL_LABEL[active.skill]()}`;

    setIcon(sigA, ABILITY_ICON[active.ability]);
    sigA.name.textContent = ABILITY_LABEL[active.ability]();
    sigA.note.textContent = active.used ? t('Ability spent') : t('Once a match');
    sigBtn.disabled = !mine || active.used;

    setIcon(skillA, SKILL_ICON[active.skill]);
    skillA.name.textContent = SKILL_LABEL[active.skill]();
    const ready = skillReady(active, battle.n);
    skillA.note.textContent = ready ? t('Ready') : t('Cooling — {n}', { n: skillWait(active, battle.n) });
    skillBtn.disabled = !mine || !ready;
    skillBtn.classList.toggle('is-cooling', !ready);
  }

  function paintTurn() {
    const active = activeOf(battle, 'mine');
    const mine = started && !ended && live && battle.turn === 'mine';
    paintActions();
    mineLine.classList.toggle('is-turn', mine);
    rivalLine.classList.toggle('is-turn', started && !ended && live && battle.turn === 'rival');

    if (ended) return;
    if (!started) {
      turnLine.replaceChildren(h('span', {}, mode === 'online' ? t('The match starts both sides together.') : t('Two cards, one clock. Press begin.')));
      return;
    }
    if (!live) {
      turnLine.replaceChildren(icon('clock'), h('span', {}, t('The clock has not started yet.')));
      return;
    }
    if (battle.turn === 'mine') {
      turnLine.replaceChildren(icon('bolt'), h('span', {}, t('Your turn.')));
    } else if (mode === 'cpu') {
      turnLine.replaceChildren(h('i.ar-spinner', { 'aria-hidden': 'true' }), h('span', {}, t('The CPU is choosing…')));
    } else {
      turnLine.replaceChildren(icon('clock'), h('span', {}, t('Their turn.')));
    }
  }

  function writeLog(parts, className = '') {
    log.prepend(h(`p.ar-call${className ? `.${className}` : ''}`, {}, ...parts));
    while (log.childElementCount > 5) log.lastElementChild.remove();
  }

  /* ---- the cinematic layer ----------------------------------------------
     A signature or school move does not just land: the screen cuts to the move.
     Each of these is one element that adds and removes itself, transform and
     opacity only, so the cheapest phone can carry the spectacle. */

  /** The anime cut-in: the fighter's name and the move, slammed across the board
      over diagonal speed lines. */
  function cutIn(byName, moveLabel, school = 'ability') {
    if (reduced()) return;
    const banner = h(
      `div.bt-cutin.is-${school}`,
      { 'aria-hidden': 'true' },
      h('span.bt-cutin-side', {}, byName),
      h('strong', {}, moveLabel),
    );
    board.append(banner);
    setTimeout(() => banner.remove(), Math.round(820 * animScale()));
  }

  /** One white frame over the whole stage, like the shutter of a camera. */
  function impactFlash(strong) {
    if (reduced()) return;
    const flash = h(`span.bt-flash${strong ? '.is-strong' : ''}`, { 'aria-hidden': 'true' });
    board.append(flash);
    setTimeout(() => flash.remove(), Math.round(300 * animScale()));
  }

  /** The K.O. stamp that ends the match — the only text on the board that is not
      a log line. */
  function koBurst() {
    if (reduced()) return;
    const ko = h('span.bt-ko', { 'aria-hidden': 'true' }, 'K.O.');
    board.append(ko);
    setTimeout(() => ko.remove(), Math.round(900 * animScale()));
  }

  function paintEvent(ev, auto = false) {
    if (!ev || ev.kind === 'end') return;
    if (ev.kind === 'brace') {
      const actor = tiles.get(ev.by);
      if (actor) {
        actor.classList.add('is-bracing');
        setTimeout(() => actor.classList.remove('is-bracing'), Math.round(460 * animScale()));
      }
      if (!auto && !reduced()) sfx.brace();
      writeLog([icon('shield'), h('span', {}, t('{name} braces for the next hit.', { name: ev.byName }))]);
      return;
    }
    if (ev.kind === 'guard') {
      const actor = tiles.get(ev.by);
      if (actor) {
        actor.classList.add('is-healing');
        setTimeout(() => actor.classList.remove('is-healing'), Math.round(560 * animScale()));
      }
      if (ev.healed > 0) damagePop(layer, pointIn(layer, actor), `+${ev.healed}`, { heal: true, scale: animScale() });
      if (!auto && !reduced()) sfx.guard();
      writeLog(
        [icon(ABILITY_ICON.guard), h('span', {}, t('Guard — {name} recovers {n}.', { name: ev.byName, n: ev.healed }))],
        'is-ability',
      );
      return;
    }
    if (ev.kind === 'mend') {
      const actor = tiles.get(ev.by);
      if (actor) {
        actor.classList.add('is-healing');
        setTimeout(() => actor.classList.remove('is-healing'), Math.round(560 * animScale()));
      }
      if (ev.healed > 0) damagePop(layer, pointIn(layer, actor), `+${ev.healed}`, { heal: true, scale: animScale() });
      if (!auto && !reduced()) sfx.guard();
      cutIn(ev.byName, SKILL_LABEL[ev.skill](), 'skill');
      writeLog(
        [icon(SKILL_ICON[ev.skill]), h('span', {}, t('{skill} — {name} recovers {n}.', { skill: SKILL_LABEL[ev.skill](), name: ev.byName, n: ev.healed }))],
        'is-ability',
      );
      return;
    }
    const heavy = ev.kind === 'ability' || ev.kind === 'skill';
    const strong = Boolean(ev.crit || heavy);
    const actor = tiles.get(ev.by);
    actor?.classList.add('is-lunge');
    setTimeout(() => actor?.classList.remove('is-lunge'), Math.round(260 * animScale()));
    if (heavy) {
      actor?.classList.add('is-channeling');
      setTimeout(() => actor?.classList.remove('is-channeling'), Math.round(380 * animScale()));
    }

    const victim = tiles.get(ev.to);
    const at = pointIn(layer, victim);
    if (victim) {
      if (at) {
        sparks(layer, at.x, at.y, strong, animScale());
        clashBurst(layer, at, strong, animScale());
      }
      victim.classList.add('is-hit');
      setTimeout(() => victim.classList.remove('is-hit'), Math.round(300 * animScale()));
    }
    damagePop(layer, at, `-${ev.dmg}`, { strong, scale: animScale() });
    shakeStage(strong);
    if (strong) impactFlash(strong);
    if (heavy) {
      cutIn(ev.byName, ev.kind === 'ability' ? ABILITY_LABEL[ev.ability]() : SKILL_LABEL[ev.skill](), ev.kind);
    }

    if (!auto && !reduced()) {
      if (ev.kind === 'ability') sfx.ability();
      else if (ev.kind === 'skill') sfx.strike(true);
      else sfx.strike(strong);
    }
    if (ev.kind === 'ability') {
      writeLog(
        [
          icon(ABILITY_ICON[ev.ability]),
          h('span', {}, t('{ability} — {name} lands {n}.', { ability: ABILITY_LABEL[ev.ability](), name: ev.byName, n: ev.dmg })),
        ],
        'is-ability',
      );
    } else if (ev.kind === 'skill') {
      writeLog(
        [
          icon(SKILL_ICON[ev.skill]),
          h(
            'span',
            {},
            ev.hits > 1
              ? t('{skill} — {name} lands {n} in {hits} cuts.', { skill: SKILL_LABEL[ev.skill](), name: ev.byName, n: ev.dmg, hits: ev.hits })
              : t('{skill} — {name} lands {n}.', { skill: SKILL_LABEL[ev.skill](), name: ev.byName, n: ev.dmg }),
          ),
        ],
        'is-ability',
      );
    } else if (ev.crit) {
      writeLog([icon('sparkles'), h('span', {}, t('Critical — {name} lands {n}.', { name: ev.byName, n: ev.dmg }))], 'is-crit');
    } else {
      writeLog([h('span', {}, t('{name} strikes for {n}.', { name: ev.byName, n: ev.dmg }))]);
    }
    if (ev.broken) {
      writeLog([icon('shield'), h('span', {}, t('{name} breaks the brace.', { name: ev.byName }))], 'is-crit');
    }
    if (ev.down) {
      writeLog([icon('x'), h('span', {}, t('{name} is out.', { name: ev.toName }))], 'is-down');
    }
    if (ev.end) koBurst();
  }

  /* ---- turn order ------------------------------------------------------- */
  function onTurn() {
    clearTimeout(idle);
    clearTimeout(bot);
    paintTurn();
    if (!started || ended || !live) return;
    if (battle.turn === 'mine') {
      idle = setTimeout(() => {
        if (ended || battle.turn !== 'mine') return;
        doAct('mine', 'strike', { auto: true });
      }, IDLE_MS);
    } else if (mode === 'cpu') {
      bot = setTimeout(() => {
        if (ended || battle.turn !== 'rival') return;
        const kind = botAction(battle);
        if (kind) doAct('rival', kind);
        else onTurn();
      }, Math.max(130, Math.round((850 + Math.round(Math.random() * 450)) / speed)));
    }
  }

  function doAct(side, kind, { auto = false } = {}) {
    if (ended || !started || !live) return;
    if (side !== battle.turn) return;
    const ev = act(battle, kind, side, Date.now());
    if (!ev || ev.error) return;
    if (side === 'mine' && match) match.sendMove(kind, battle.n);
    paintFighters();
    if (auto) writeLog([icon('clock'), h('span', {}, t('The clock took your strike.'))]);
    paintEvent(ev, auto);
    const hold = reduced() ? 0 : Math.max(90, Math.round(520 / speed));
    if (ev.kind === 'end') {
      setTimeout(() => finish(ev.winner, ev.reason, { broadcast: side === 'mine' }), hold);
      return;
    }
    if (ev.end) {
      setTimeout(() => finish(ev.end.winner, ev.end.reason, { broadcast: side === 'mine' }), hold);
      return;
    }
    onTurn();
  }

  /* ---- opening and clock ------------------------------------------------ */
  function begin() {
    if (started || ended) return;
    started = true;
    intro.remove();
    if (mode === 'cpu' && battle.at > Date.now()) battle.at = Date.now();
    live = Date.now() >= battle.at;
    paintTurn();
    ticker = setInterval(tick, 200);
    tick();
    for (const move of pendingMoves) applyRemote(move);
    pendingMoves = [];
    onTurn();
  }

  function tick() {
    if (ended) return;
    const now = Date.now();
    clock.textContent = clockText(Math.min(MATCH_MS, timeLeft(battle, now)));
    clock.classList.toggle('is-out', timeLeft(battle, now) <= 10_000);
    const nowLive = now >= battle.at;
    if (nowLive !== live) {
      live = nowLive;
      paintTurn();
      if (live) onTurn();
    }
    if (!live) {
      const secs = Math.max(1, Math.ceil((battle.at - now) / 1000));
      waitLine.textContent = t('The fight starts in {n}.', { n: secs });
      waitLine.hidden = false;
      return;
    }
    waitLine.hidden = true;
    if (timeLeft(battle, now) <= 0) {
      const ev = finishByTime(battle, now);
      if (ev) {
        paintFighters();
        finish(ev.winner, 'time', { broadcast: true });
      }
    }
  }

  /* ---- the result ------------------------------------------------------- */
  async function finish(winner, cause, { broadcast = false } = {}) {
    if (ended) return;
    ended = true;
    clearTimers();
    const won = winner === 'mine';
    battle.winner = winner;
    panel.classList.add(won ? 'is-win' : 'is-loss');
    strikeBtn.disabled = true;
    braceBtn.disabled = true;
    skillBtn.disabled = true;
    sigBtn.disabled = true;
    intro.remove();

    if (broadcast && match) {
      match.sendEnd(won ? peerId() : online?.rival?.peer, cause);
    }
    setTimeout(() => match?.close(), 400);

    const head = won ? t('Victory') : t('Defeat');
    const why =
      cause === 'time'
        ? t('Called on the clock.')
        : cause === 'left'
          ? t('Your opponent left the fight.')
          : won
            ? t('You took it.')
            : t('Your line-up fell.');
    const streak = h('span.bt-streak.tnum', { hidden: true });
    const back = h(
      'button.btn.btn--primary',
      { type: 'button', onclick: () => close() },
      icon('check'),
      h('span', {}, t('Back to the arena')),
    );
    const again =
      mode === 'cpu' && onRematch
        ? h(
            'button.btn',
            {
              type: 'button',
              onclick: () => {
                close();
                onRematch();
              },
            },
            icon('refresh'),
            h('span', {}, t('Rematch')),
          )
        : null;
    result.replaceChildren(
      h('div.bt-result-head', {}, icon(won ? 'trophy' : 'x'), h('b', {}, head), h('span', {}, why)),
      streak,
      h('div.bt-result-foot', {}, again, back),
    );
    result.hidden = false;

    turnLine.replaceChildren(icon(won ? 'trophy' : 'x'), h('span', {}, won ? t('The record is yours.') : t('No streak survives a loss.')));
    if (!reduced()) {
      if (won) sfx.victory();
      else sfx.defeat();
    }

    if (onSettle) {
      try {
        const info = await onSettle({ won, cause, mode, score: scoreOf(battle), winner });
        if (info?.streak != null) {
          streak.textContent = t('Win streak: {n}', { n: info.streak });
          streak.hidden = false;
        }
      } catch {
        /* The fight is already printed; a record that failed to file is not a
           reason to take the result off the screen. */
      }
    }
  }

  function neverArrived() {
    if (ended) return;
    ended = true;
    clearTimers();
    match?.close();
    intro.remove();
    result.replaceChildren(
      h('div.bt-result-head', {}, icon('offline'), h('b', {}, t('Nobody arrived')), h('span', {}, t('The other side never joined this match.'))),
      h('div.bt-result-foot', {}, h('button.btn.btn--primary', { type: 'button', onclick: () => close() }, h('span', {}, t('Back to the arena')))),
    );
    result.hidden = false;
    turnLine.replaceChildren(icon('offline'), h('span', {}, t('The match never started.')));
    strikeBtn.disabled = true;
    braceBtn.disabled = true;
    skillBtn.disabled = true;
    sigBtn.disabled = true;
  }

  /**
   * The line went down mid-match. The fight is not awarded to either side: a
   * dropped socket is not a win, and a record filed on one would be a lie.
   */
  function cutOff() {
    if (ended) return;
    ended = true;
    clearTimers();
    match?.close();
    intro.remove();
    result.replaceChildren(
      h('div.bt-result-head', {}, icon('offline'), h('b', {}, t('Connection lost')), h('span', {}, t('The match was cut off.'))),
      h('div.bt-result-foot', {}, h('button.btn.btn--primary', { type: 'button', onclick: () => close() }, h('span', {}, t('Back to the arena')))),
    );
    result.hidden = false;
    turnLine.replaceChildren(icon('offline'), h('span', {}, t('The match was cut off.')));
    strikeBtn.disabled = true;
    braceBtn.disabled = true;
    skillBtn.disabled = true;
    sigBtn.disabled = true;
  }

  function applyRemote(move) {
    if (ended || !started) return;
    if (battle.turn !== 'rival') return;
    doAct('rival', move.kind);
  }

  /* ---- the other end ---------------------------------------------------- */
  if (mode === 'online' && online?.id) {
    match = openMatch({
      id: online.id,
      rival: online.rival,
      onMove: (move) => {
        if (!started) pendingMoves.push(move);
        else applyRemote(move);
      },
      onEnd: ({ winnerPeer, cause }) => {
        if (ended) return;
        const winner = online?.rival?.peer === winnerPeer ? 'rival' : 'mine';
        finish(winner, cause || 'down', { broadcast: false });
      },
      onLeave: (why) => {
        if (ended) return;
        if (why === 'missing') {
          neverArrived();
          return;
        }
        if (why === 'closed') {
          cutOff();
          return;
        }
        finish('mine', 'left', { broadcast: false });
      },
      onStatus: (state) => {
        if (state === 'ready') {
          conn.replaceChildren(icon('bolt'), h('span', {}, t('Live')));
          conn.classList.add('is-live');
        } else if (state === 'closed' || state === 'error') {
          conn.replaceChildren(icon('offline'), h('span', {}, t('Connection lost')));
          conn.classList.remove('is-live');
          if (!ended) cutOff();
        }
      },
    });
  }

  /* ---- the buttons ------------------------------------------------------ */
  /* Each button carries its own press in its props; the keyboard numbers call
     `.click()` on the same element, so there is exactly one path into doAct. */

  paintFighters();
  paintTurn();

  const delay = Math.max(0, battle.at - Date.now());
  /* A live match opens on both screens at the shared time, so the introduction
     counts it down rather than looking frozen. A CPU fight lifts its introduction
     after a beat so the taunts are readable even if nobody taps, and the Begin
     button is there for anyone who does not want to wait. */
  if (mode === 'online') {
    const paintWait = () => {
      waitLine.textContent = t('The fight starts in {n}.', { n: Math.max(1, Math.ceil((battle.at - Date.now()) / 1000)) });
    };
    waitLine.hidden = false;
    paintWait();
    introTick = setInterval(paintWait, 500);
  }
  setTimeout(() => {
    clearInterval(introTick);
    introTick = 0;
    if (closed || ended) return;
    begin();
  }, mode === 'online' ? delay + 60 : 2400);

  return close;
}
