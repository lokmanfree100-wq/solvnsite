/**
 * The card itself, and the two moments it arrives in.
 *
 * A card is a vertical trading card, not a poster with a border: the art sits
 * inside a frame that carries the tier's own gradient, the serial number is
 * printed where a real set prints it, and the stats plate is part of the card
 * rather than a tooltip. From Rainbow Holo upward a banner appears above the
 * stats plate — that banner is the thing a collector is actually hunting for, so
 * it is reserved for the tiers where the odds say it belongs, and it is printed
 * in that tier's own colours rather than a moving rainbow.
 *
 * The portrait itself changes form with the level band (see `formOf`): a tighter
 * crop, a mirrored pose and a hotter grade as the card climbs, so the same
 * character reads as an evolution across the set.
 *
 * A card whose Power reaches the live line is a different object again: its ring
 * carries the tier's colour further, a foil band crosses the art and the bevel
 * breathes. That is drawn from the number on the plate, never from the tier label,
 * so a fused mid-tier card that climbed over the line is as live as a Rainbow
 * Holo one — and a top-tier card that landed low on its band is not.
 *
 * The reference is a graded trading card, not a building block: narrow bevel,
 * hairline rule, one light source, and no fat outline font anywhere.
 *
 * Every animation here answers a press. The tear, the next card, the fuse — each
 * is a decision somebody made with a finger, so each gets its own cue and no cue
 * arrives on its own. Under `prefers-reduced-motion` the shake and the burst are
 * dropped, the card is still revealed, and nothing about the information
 * changes: an effect is an announcement, never the content.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sfx } from '../lib/sounds.js';
import { toast } from '../lib/ui.js';
import {
  ALL_RARITIES, BANNER_LV, TOP_LV, STAT_KEYS, STAT_LABELS,
  rarityOf, formOf, dropRate, dramaOf, mergeCost, serialText, isLive, starsFor, tierProgress,
} from '../lib/cards.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const modalRoot = () => document.querySelector('#modal-root');
const FORM_NUMERALS = ['I', 'II', 'III', 'IV', 'V'];

/**
 * The tier's own colours, and how hard its light falls, handed down as custom
 * properties the stylesheet reads.
 *
 * Every card in the set crosses its art with the same white band — that is what a
 * printed card does under a lamp. What changes with the tier is the angle the light
 * comes in at, how far it travels, how bright it lands and how fast it goes past:
 * a Basic card catches one slow, narrow gleam and the crowned tiers catch a wide,
 * quicker one. Both are derived here from the level in the drop table, so the
 * brightness of a card and the odds of a card can never disagree.
 */
function paint(el, r) {
  el.style.setProperty('--ga', r.a);
  el.style.setProperty('--gb', r.b);
  el.style.setProperty('--glow', r.glow);
  const span = Math.min(1, Math.max(0, (Number(r.lv) - 1) / (TOP_LV - 1)));
  el.style.setProperty('--sweep-angle', `${Math.round(96 + span * 36)}deg`);
  el.style.setProperty('--sweep-path', `${(62 + span * 30).toFixed(1)}%`);
  el.style.setProperty('--sweep-dur', `${(7.6 - span * 3.2).toFixed(2)}s`);
  el.style.setProperty('--sweep-wait', `${(-span * 3.4).toFixed(2)}s`);
  el.style.setProperty('--sweep-op', (0.34 + span * 0.36).toFixed(2));
  /* Below the holographic line the light in the room is white; from BANNER_LV up
     it picks up the tier's own colour, because those are the cards that have one. */
  el.style.setProperty('--sweep-tint', r.lv >= BANNER_LV ? r.glow : '#ffffff');
  return el;
}

/**
 * The printed banner the tiers from `BANNER_LV` up wear: character, title and
 * serial on a band in the tier's own gradient. Below it there is no band at all —
 * a rarity has to be worth something, and printing it on a Basic card would spend
 * the effect on nobody.
 */
const printedBanner = (card, r) =>
  r.lv < BANNER_LV
    ? null
    : h(
        'div.g-banner',
        { 'aria-hidden': 'true' },
        h('span.g-banner-name', {}, card.name),
        h('span.g-banner-meta', {}, `${card.mediaTitle || 'Solvn'} · ${serialText(card.serial)}`),
      );

/**
 * One trading card.
 *
 * `variant` decides how much is drawn: `full` carries the stat plate, `tile` is
 * the binder grid and the showcase, `mini` is a sample row. A card is never a
 * link — the binder opens a sheet and the opening overlay owns its own moment —
 * so the click handler always comes from the caller.
 *
 * A `locked` card is a compendium tile for a character the binder does not hold.
 * It is drawn as the same object — same frame, same tier spectrum, same accent
 * light — so
 * the set still looks like a set worth finishing, but the numbers are withheld: a
 * star band stands where the Power is printed and the serial line says it is not
 * owned. What a pull has not decided, the page does not pretend to know.
 */
export function gachaCard(card, { variant = 'full', count = 1, onClick = null, eager = true } = {}) {
  const base = rarityOf(card.lv);
  /* A studio card keeps the tier's frame but wears the colours the studio
     picked, reads its own real numbers instead of the roll table's grade, and
     can never be mistaken for the one-of-one — a handmade Lv 16 is still
     handmade, so the ultimate's crown and INFINITY are not on it. */
  const r = card.custom
    ? {
        lv: Math.max(1, Math.min(16, Number(card.lv) || 1)),
        id: 'studio',
        label: 'Studio',
        a: card.a || base.a,
        b: card.b || base.b,
        glow: card.glow || base.glow,
      }
    : base;
  const custom = Boolean(card.custom);
  const form = formOf(r.lv);
  const live = isLive(card);
  const locked = Boolean(card.locked);
  /* The grade a locked tile shows: stars for a band, never the number itself. */
  const stars = starsFor(r.lv);
  const powerText = (key) => {
    if (r.ultimate && key === 'power') return t('INFINITY');
    if (locked) return key === 'power' ? '★'.repeat(stars) : '•••';
    return String(card.stats?.[key] ?? 0);
  };
  const fig = paint(
    h(
      'figure',
      {
        class: [
          'g-card',
          `g-${variant}`,
          `is-lv${r.lv}`,
          `is-form${form}`,
          r.holo && 'is-holo',
          r.cosmic && 'is-cosmic',
          r.crown && 'is-crown',
          r.ultimate && 'is-ultimate',
          card.evolved && 'is-evolved',
          locked && 'is-locked',
          live && 'is-live',
        ],
        role: onClick ? 'button' : null,
        tabindex: onClick ? '0' : null,
        'aria-label': onClick
          ? locked
            ? t('Locked card: {name} — not in your binder yet', { name: card.name })
            : t('Open card: {name}', { name: card.name })
          : null,
      },
      h(
        'div.g-frame',
        {},
        /* The shine layer: one white band crossing the plate, present on every tier
           from Lv 13 up and on the one-of-one. */
        r.holo || r.sheen ? h('div.g-spectrum', { 'aria-hidden': 'true' }) : null,
        h('div.g-bevel', { 'aria-hidden': 'true' }),
        h(
          'div.g-art',
          {},
          r.lv >= 9 ? h('div.g-burst', { 'aria-hidden': 'true' }) : null,
          h('img.g-portrait', {
            src: card.image,
            alt: card.name,
            loading: eager ? 'eager' : 'lazy',
            decoding: 'async',
            onError: (e) => {
              /* A portrait that will not load still leaves a card: the frame,
                 the name and the numbers are ours, only the art is borrowed. */
              e.target.closest('.g-art')?.classList.add('is-noart');
              e.target.remove();
            },
          }),
          /* The tier effect: from Scarce up every rung carries its own weather —
             motes, rays, embers, lightning, a prismatic ring, a celestial halo,
             fire. It sits over the portrait and under the printed plate, and it
             is three nodes at most, so a binder of a hundred cards stays a
             binder rather than a fireworks display. The one-of-one keeps its
             own aura and does not wear this layer. */
          variant !== 'mini' && r.lv >= 4 && r.lv <= TOP_LV
            ? h(
                'div.g-fx',
                { 'aria-hidden': 'true' },
                h('i.g-fx-a'),
                h('i.g-fx-b'),
                h('i.g-fx-c'),
              )
            : null,
          /* The foil lives inside the art, not over the whole frame: a real
             card's stamp catches the light on the picture, never across the
             printed name. */
          live ? h('div.g-foil', { 'aria-hidden': 'true' }) : null,
          /* The form is printed next to the level, because a collector reading a
             binder needs to know which reframing of the character this is — the
             numeral is drawn, not announced; the tier label below already says
             what the card is. */
          h(
            'span.g-lv',
            {},
            `Lv ${r.lv}`,
            h('span.g-form', { 'aria-hidden': 'true' }, FORM_NUMERALS[form - 1]),
          ),
          live ? h('span.g-live', {}, icon('bolt'), r.ultimate ? t('EXCLUSIVE') : t('LIVE')) : null,
          count > 1 ? h('span.g-copies', {}, `×${count}`) : null,
          card.evolved ? h('span.g-evolved', {}, icon('sparkles'), t('Evolved')) : null,
          /* The padlock sits over the art rather than replacing it: the face is
             the thing that makes somebody want the card, and hiding it would hide
             the wrong half of the set. */
          locked
            ? h('div.g-lock', { 'aria-hidden': 'true' }, icon('lock'), h('span', {}, t('Locked')))
            : null,
          card.raised && !locked
            ? h('span.g-raised', {}, icon('sparkles'), t('Streak floor'))
            : null,
        ),
        printedBanner(card, r),
        h(
          'figcaption.g-plate',
          {},
          h(
            'div.g-ident',
            {},
            h('span.g-name', {}, card.name),
            h('span.g-title', {}, card.mediaTitle || (r.ultimate ? t('The platform itself') : '')),
            r.lv < BANNER_LV
              ? h('span.g-serial', {}, locked ? t('Not owned') : serialText(card.serial))
              : null,
          ),
          variant === 'mini'
            ? null
            : h(
                'div.g-rar',
                {},
                h('span.g-rar-label', {}, t(r.label)),
                /* A studio plate has no drop rate to quote: it was not rolled. */
                variant === 'full' && !custom ? h('span.g-rar-rate.tnum', {}, dropRate(r.lv).label) : null,
              ),
          variant === 'full'
            ? h(
                'ul.g-stats',
                {},
                ...STAT_KEYS.map((k) =>
                  h(
                    k === 'power' ? 'li.is-power' : 'li',
                    {},
                    h('span', {}, t(STAT_LABELS[k])),
                    h('b.tnum', { class: locked && k === 'power' ? 'is-stars' : null }, powerText(k)),
                  ),
                ),
                h(
                  'li.g-overall',
                  {},
                  h('span', {}, t('Overall')),
                  h('b.tnum', {}, locked ? t('Hidden') : String(card.stats?.overall ?? 0)),
                ),
              )
            : null,
        ),
      ),
    ),
    r,
  );

  if (onClick) {
    const fire = () => onClick(card);
    fig.addEventListener('click', fire);
    fig.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fire();
      }
    });
  }
  return fig;
}

/** The chip a header or a row uses to name a tier. */
export function rarityChip(lv, { rate = false } = {}) {
  const r = rarityOf(lv);
  return paint(
    h(
      'span',
      { class: ['g-chip', `is-lv${r.lv}`, r.holo && 'is-holo'] },
      t(r.label),
      rate ? h('b.tnum', {}, dropRate(r.lv).label) : null,
    ),
    r,
  );
}

/* ---- the drop table --------------------------------------------------- */
/**
 * The odds, printed where they can be read before anybody spends a pack. A
 * gacha that hides its table is not a game — it is a slot machine with artwork.
 *
 * The last row is the one card with no weight at all, and it stays on the table
 * for exactly that reason: the set has sixteen plates, and a list that quietly
 * omits the one you cannot roll is a list with a hole in it. Rows are coloured
 * from the same table the roll reads, but they do not wear the tiers' rings — the
 * table is for reading, and sixteen animated rows is a fan.
 */
export function dropTable() {
  return h(
    'div.g-odds',
    {},
    h(
      'div.g-odds-head',
      { role: 'row' },
      h('span', {}, t('Level')),
      h('span', {}, t('Rarity')),
      h('span', {}, t('Drop rate')),
      h('span', {}, t('One in')),
    ),
    ...ALL_RARITIES.map((r) => {
      const d = dropRate(r.lv);
      return paint(
        h(
          'div',
          { class: ['g-odds-row', `is-lv${r.lv}`, r.holo && 'is-holo', r.ultimate && 'is-ultimate'] },
          h('span.g-odds-lv.tnum', {}, String(r.lv)),
          h('span.g-odds-label', {}, t(r.label)),
          h('span.g-odds-pct.tnum', {}, d.label),
          h('span.g-odds-one.tnum', {}, d.oneInLabel || d.oneIn.toLocaleString()),
        ),
        r,
      );
    }),
  );
}

/* ---- the flow ----------------------------------------------------------
   One press draws one card. That is not a restriction for its own sake: it is
   what stops five sounds arriving out of nowhere, and it is how a physical pack
   behaves — you look at the first card, then the next. `Reveal all` is the
   shortcut, and it answers with a single cue for the best tier in the hand
   rather than five in a row. */

let flow = null;
let flowKey = null;

function teardown() {
  flow?.remove();
  flow = null;
  if (flowKey) {
    document.removeEventListener('keydown', flowKey);
    flowKey = null;
  }
  document.body.classList.remove('g-dim', 'g-shake');
  if (!modalRoot().childElementCount) document.body.style.removeProperty('overflow');
}

/** Drop the flow from outside — a route change must not leave a stage behind. */
export const closeGachaFlow = teardown;

/** The screen goes down and the frame shakes, in proportion to the tier. */
function land(drama) {
  if (reduced()) return;
  document.body.classList.add('g-dim');
  if (drama.shake > 0) {
    document.body.classList.add('g-shake');
    setTimeout(() => document.body.classList.remove('g-shake'), 240 + drama.shake * 14);
  }
}

function armEscape(onEscape) {
  flowKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    /* Escape leaves the same way the button does, so a hand drawn before it is
       still banked and the binder still repaints. */
    onEscape?.();
    teardown();
  };
  document.addEventListener('keydown', flowKey);
}

function shell(panel, onEscape) {
  flow = h('div.modal-backdrop.is-gacha', {}, panel);
  document.body.style.overflow = 'hidden';
  modalRoot().appendChild(flow);
  armEscape(onEscape);
  return flow;
}

/**
 * Stage a hand. `cards` has already been drawn and banked in the binder — this
 * is the reveal, and it never rolls anything of its own. A tester's preview hands
 * are not banked, so the stage says so instead of promising a card that is not
 * in the collection.
 */
export function openPackFlow(cards, { onDone, preview = false } = {}) {
  let index = -1;
  let torn = false;
  const best = cards.reduce((lv, c) => Math.max(lv, c.lv), 0);

  const tray = h('div.g-tray');
  const counter = h('span.g-flow-count.tnum', {}, `0 / ${cards.length}`);
  const hint = h('p.g-flow-hint', {}, t('Tap the pack to tear it open.'));

  const revealAll = h(
    'button.btn.btn--ghost',
    {
      type: 'button',
      onclick: () => {
        index = cards.length - 1;
        torn = true;
        stage.classList.remove('is-tearing');
        stage.classList.add('is-open');
        tray.replaceChildren(...cards.map((c, i) => drawnCard(c, i, false)));
        counter.textContent = `${cards.length} / ${cards.length}`;
        /* One press, one cue — and it is the cue of the best card in the hand,
           which is the only honest thing left to say about five at once. */
        sfx.reveal(dramaOf(best).stage);
        finish();
      },
    },
    t('Reveal all'),
  );

  const doneBtn = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: () => {
        teardown();
        onDone?.(cards);
      },
    },
    preview ? t('Close') : t('Keep them'),
  );
  doneBtn.hidden = true;

  /* The pack itself: a pastel foil envelope with a seam across its throat. It
     is a real object in the scene — the pointer tips it, the tear opens the top
     strip, and only then does the first card come out. */
  const booster = h(
    'div.g-booster',
    { 'aria-hidden': 'true' },
    h('div.g-booster-halo'),
    h(
      'div.g-booster-body',
      {},
      h('div.g-booster-foil'),
      h('div.g-booster-seam'),
      h('div.g-booster-flap'),
      h(
        'div.g-booster-crest',
        {},
        icon('sparkles', { cls: 'g-booster-glyph' }),
        h('b', {}, t('Solvn booster')),
        h('span', {}, t('{n} cards', { n: String(cards.length) })),
      ),
    ),
  );

  if (!reduced()) {
    booster.addEventListener('pointermove', (e) => {
      const rect = booster.getBoundingClientRect();
      const dx = (e.clientX - rect.left) / rect.width - 0.5;
      const dy = (e.clientY - rect.top) / rect.height - 0.5;
      booster.style.setProperty('--ry', `${(dx * 18).toFixed(1)}deg`);
      booster.style.setProperty('--rx', `${(-dy * 14).toFixed(1)}deg`);
    });
    booster.addEventListener('pointerleave', () => {
      booster.style.setProperty('--ry', '0deg');
      booster.style.setProperty('--rx', '0deg');
    });
  }

  const stage = h(
    'div.g-stage',
    {
      role: 'button',
      tabindex: '0',
      'aria-label': t('Open the pack'),
      onclick: (e) => {
        if (e.target.closest('button')) return;
        next();
      },
      onkeydown: (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        next();
      },
    },
    h(
      'div.g-node.is-booster',
      {},
      booster,
      h('h3', {}, t('Your pack is sealed')),
      hint,
    ),
    tray,
  );

  const panel = h(
    'div.g-flow',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Pack opening') },
    h('div.g-flow-head', {}, h('h2', {}, t('New pack')), counter, h('div.grow'), revealAll, doneBtn),
    stage,
  );

  shell(panel, () => onDone?.(cards));
  sfx.pack();

  /* The tear: the strip lifts, the seam parts, light comes out of the throat.
     The first card follows once the pack has actually opened, never on top of
     it. Under reduced motion the tear is instant and the card is simply there. */
  function tear() {
    if (torn) return;
    torn = true;
    stage.classList.add('is-tearing');
    window.setTimeout(() => {
      /* The flow can be closed mid-tear (Escape, a route change): a stage that
         has left the document must not draw a card or cue anything. */
      if (!stage.isConnected) return;
      stage.classList.remove('is-tearing');
      stage.classList.add('is-open');
      if (index < 0) next();
    }, reduced() ? 0 : 640);
  }

  function next() {
    if (stage.classList.contains('is-tearing')) return;
    if (!torn) {
      tear();
      return;
    }
    if (index >= cards.length) return;
    index += 1;
    if (index >= cards.length) {
      finish();
      return;
    }
    const card = cards[index];
    const r = rarityOf(card.lv);
    const drama = dramaOf(card.lv);
    land(drama);
    sfx.reveal(drama.stage);
    tray.append(drawnCard(card, index, true));
    counter.textContent = `${index + 1} / ${cards.length}`;
    stage.classList.add('is-open');
    stage.setAttribute('aria-label', t('Tap to draw the next card.'));
    hint.textContent = index === cards.length - 1 ? t('That is the whole pack.') : t('Tap to draw the next card.');
    if (r.holo) toast(t('{rarity}! {name}', { rarity: t(r.label), name: card.name }), { iconName: 'sparkles', timeout: 3600 });
    if (index === cards.length - 1) finish();
  }

  function finish() {
    stage.classList.add('is-open', 'is-settled');
    stage.removeAttribute('role');
    stage.tabIndex = -1;
    revealAll.hidden = true;
    doneBtn.hidden = false;
    doneBtn.focus?.({ preventScroll: true });
    hint.textContent = preview ? t('A preview: nothing was rolled and nothing was banked.') : t('Every card is already in your binder.');
  }

  return { close: teardown };
}

/**
 * One card as it comes out of the pack. Every fresh card is a two-faced object:
 * a pastel foil back turns over in 3D to the card itself, then one white band
 * crosses the plate. The tier's own shine, ring and weather are already on the
 * card, so the flip only has to hand over to them.
 */
function drawnCard(card, i, fresh) {
  const el = gachaCard(card, { variant: 'full' });
  const r = rarityOf(card.lv);
  const flip = h(
    'div.g-flip',
    {
      class: [r.holo && 'is-holo', r.ultimate && 'is-ultimate'],
    },
    h(
      'div.g-flip-inner',
      {},
      h(
        'div.g-flip-back',
        { 'aria-hidden': 'true' },
        h('div.g-flip-emblem', {}, icon('sparkles', { cls: 'g-flip-glyph' })),
        h('span.g-flip-mark', {}, t('Solvn')),
      ),
      el,
    ),
  );
  if (fresh && !reduced()) {
    flip.classList.add('is-drawing');
    flip.style.setProperty('--d', `${Math.min(i, 4) * 70}ms`);
  }
  return flip;
}

/* ---- evolution --------------------------------------------------------- */
/**
 * The fuse. Copies go in, one card a tier higher comes out. The effect scales
 * with what was spent: ten Basics is a flash, ten Celestials is a detonation.
 */
export function evolveFlow(entry, result, { onDone } = {}) {
  const to = rarityOf(result.lv);
  const drama = dramaOf(result.lv);
  const cost = mergeCost(entry.lv);

  const stage = h(
    'div.g-stage.is-evolve',
    {},
    h(
      'div.g-fuse',
      {},
      h('div.g-fuse-in', {}, gachaCard({ ...entry, evolved: false }, { variant: 'tile' })),
      h('div.g-fuse-arrow', {}, icon('chevronRight')),
      h('div.g-fuse-out', {}, gachaCard(result, { variant: 'full' })),
    ),
    h('p.g-fuse-note', {}, t('{n} copies of {name} fused into one {rarity} card.', { n: cost, name: entry.name, rarity: t(to.label) })),
  );

  const doneBtn = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: () => {
        teardown();
        onDone?.(result);
      },
    },
    t('Add to binder'),
  );

  const panel = h(
    'div.g-flow',
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': t('Card evolution') },
    h('div.g-flow-head', {}, h('h2', {}, t('Evolution')), h('div.grow'), doneBtn),
    stage,
  );

  shell(panel, () => onDone?.(result));
  /* The blast answers the press that opened this sheet, so it fires once here
     and nothing after it moves on its own. */
  land(drama);
  sfx.evolve(drama.stage);
  if (drama.stage >= 3 && !reduced()) panel.classList.add('is-burst');
  doneBtn.focus?.({ preventScroll: true });
  return { close: teardown };
}

/* ---- the showcase ------------------------------------------------------- */
/**
 * The 3D binder stage: one card, held up. The pointer moves the light and the
 * tilt, exactly the way a poster card does elsewhere on the site (see
 * lib/tilt.js), and a device with a finger instead of a cursor simply gets the
 * card standing still — the effect is a look, not a control, so nothing is
 * missing when it is off.
 */
export function showcase(card) {
  const el = gachaCard(card, { variant: 'full' });
  el.classList.add('g-showcase');
  if (reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return el;

  let frame = 0;
  let queued = null;
  const MAX = 9;

  const paint2 = () => {
    frame = 0;
    if (!queued || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (queued.x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (queued.y - r.top) / r.height));
    el.style.setProperty('--tilt-y', `${((px - 0.5) * MAX * 2).toFixed(2)}deg`);
    el.style.setProperty('--tilt-x', `${((0.5 - py) * MAX).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
    queued = null;
  };

  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return;
    queued = { x: e.clientX, y: e.clientY };
    if (!frame) frame = requestAnimationFrame(paint2);
  };
  const onLeave = () => {
    queued = null;
    ['--tilt-x', '--tilt-y', '--mx', '--my'].forEach((p) => el.style.removeProperty(p));
  };

  el.addEventListener('pointermove', onMove, { passive: true });
  el.addEventListener('pointerleave', onLeave, { passive: true });
  return el;
}

/** The full-set strip, sixteen plates: the binder's legend, and the tester's preview row. */
export function rarityLegend(onPick) {
  return h(
    'div.g-legend',
    {},
    ...ALL_RARITIES.map((r) =>
      paint(
        h(
          'button',
          {
            class: ['g-legend-item', `is-lv${r.lv}`, r.holo && 'is-holo', r.ultimate && 'is-ultimate'],
            type: 'button',
            onclick: () => onPick?.(r.lv),
            'aria-label': t('Preview {rarity}', { rarity: t(r.label) }),
          },
          h('span.g-legend-lv.tnum', {}, String(r.lv)),
          h('span.g-legend-label', {}, t(r.label)),
          h('span.g-legend-rate.tnum', {}, dropRate(r.lv).label),
        ),
        r,
      ),
    ),
  );
}

/**
 * The same strip read as a checklist instead of a price list: one button per
 * tier, and under each the number of those tiles the binder holds. This is what
 * the compendium navigates by, and it is the only place a set can be finished —
 * the counts come from the binder, so a tier reads complete when it is.
 */
export function tierStrip(current, onPick) {
  return h(
    'div.g-legend.is-progress',
    { role: 'group', 'aria-label': t('Choose a tier') },
    ...ALL_RARITIES.map((r) => {
      const p = tierProgress(r.lv);
      return paint(
        h(
          'button',
          {
            class: [
              'g-legend-item',
              `is-lv${r.lv}`,
              r.holo && 'is-holo',
              r.ultimate && 'is-ultimate',
              r.lv === current && 'is-active',
              p.done && 'is-complete',
            ],
            type: 'button',
            'aria-pressed': String(r.lv === current),
            onclick: () => onPick?.(r.lv),
            'aria-label': t('{rarity}: {have} of {total} owned', {
              rarity: t(r.label),
              have: String(p.have),
              total: String(p.total),
            }),
          },
          h('span.g-legend-lv.tnum', {}, String(r.lv)),
          h('span.g-legend-label', {}, t(r.label)),
          h('span.g-legend-count.tnum', {}, p.done ? icon('check') : `${p.have}/${p.total}`),
        ),
        r,
      );
    }),
  );
}
