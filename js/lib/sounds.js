/**
 * Interface sounds.
 *
 * Nothing is downloaded and nothing is stored: every effect is drawn from the
 * Web Audio API — a short oscillator envelope, or a band of filtered noise for
 * the page sweep — so the whole system costs no bytes, no requests and no
 * cache. A visitor's first press on the page unlocks audio — a browser refuses
 * to start a context before one, and a sound that fires on its own is the thing
 * people mute first — so nothing is even built until the interface has been
 * touched.
 *
 * Three rules decide every sound here, and they are the rules a console plays
 * by: a page you moved to sweeps, a title you chose chimes, a button you
 * pressed ticks. A cursor passing over the interface on its own way makes no
 * noise at all — the pointer is not a decision.
 *
 * Everything bows out on `Sound effects` in Settings, and a muted interface
 * never even opens the context.
 */

import { settings, onSettings } from './store.js';
import { onChange } from './router.js';

const MASTER = 0.05;
/** Two identical effects inside this window are one effect: a fast double tap
    should not sound like two. */
const REPEAT_MS = 60;

let ctx = null;
let master = null;
let muted = false;
let armed = false;
let last = 0;
let lastKind = '';

/* The setting is the whole input: reading it back after any change covers the
   switch, a reset to defaults and a setting changed on another row. */
function syncMute() {
  muted = settings.get('uiSound') === false;
}
syncMute();
onSettings(syncMute);

function audio() {
  if (muted || !armed) return null;
  if (ctx) {
    /* Chrome can park the context again when the tab is backgrounded; resuming
       inside the click that woke it is the only moment the browser allows. */
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** One tone: `freq` gliding to `to` over `ms`, with a soft attack and a tail. */
function tone({ freq, to = null, ms = 60, type = 'sine', delay = 0, peak = 1 }) {
  const ac = audio();
  if (!ac || !master) return;
  const t0 = ac.currentTime + delay;
  const end = t0 + ms / 1000;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, end);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.014, ms / 3000));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  env.connect(master);
  osc.start(t0);
  osc.stop(end + 0.02);
}

/** A band of noise sliding between two frequencies. An oscillator cannot make
    air, and a page transition is air: this is the whoosh, drawn from a quarter
    second of random samples generated once and reused for as long as the tab
    lives. */
let bed = null;
function sweep({ ms = 180, from = 380, to = 2100, peak = 1, delay = 0 }) {
  const ac = audio();
  if (!ac || !master) return;
  if (!bed) {
    bed = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.35), ac.sampleRate);
    const samples = bed.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  const t0 = ac.currentTime + delay;
  const end = t0 + ms / 1000;
  const src = ac.createBufferSource();
  src.buffer = bed;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(from, t0);
  band.frequency.exponentialRampToValueAtTime(to, end);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(peak, t0 + ms / 2600);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(band);
  band.connect(env);
  env.connect(master);
  src.start(t0);
  src.stop(end + 0.02);
}

/** Coalesce a repeat of the same effect so a fast tap stays one sound. */
function once(kind, draw) {
  const now = Date.now();
  if (kind === lastKind && now - last < REPEAT_MS) return;
  last = now;
  lastKind = kind;
  draw();
}

/* The card binder's ladder, one entry per drama stage (see lib/cards.js). Each
   note is [from, to, ms, delay, peak]; the sweep and the sub-thud only appear
   from stage 2 up, because a cue that celebrates a Common card teaches the
   visitor nothing about what they just rolled. */
const REVEALS = [
  { notes: [[523, 620, 90, 0, 0.3]], sweep: null, thud: false },
  { notes: [[494, 659, 100, 0, 0.32], [659, 784, 120, 0.07, 0.26]], sweep: null, thud: false },
  { notes: [[523, 659, 110, 0, 0.34], [659, 880, 130, 0.08, 0.28], [880, 1046, 170, 0.16, 0.22]], sweep: [620, 2400, 220], thud: false },
  { notes: [[523, 784, 140, 0, 0.38], [659, 988, 150, 0.09, 0.3], [988, 1319, 200, 0.18, 0.24], [1319, 1568, 260, 0.27, 0.18]], sweep: [420, 3200, 320], thud: false },
  { notes: [[392, 523, 200, 0, 0.42], [523, 659, 200, 0.1, 0.36], [659, 880, 220, 0.2, 0.3], [880, 1174, 260, 0.31, 0.26], [1174, 1568, 340, 0.44, 0.2]], sweep: [300, 4200, 420], thud: true },
];

export const sfx = {
  /** A control was pressed: a dry blip, up two semitones so it reads as a tap. */
  click() {
    once('click', () => tone({ freq: 560, to: 720, ms: 42, type: 'triangle', peak: 0.55 }));
  },
  /** A page gave way to another: a breath of air upward with a soft note under
      it, so the move lands as travel rather than as a click. */
  nav() {
    once('nav', () => {
      sweep({ ms: 190, from: 340, to: 2200, peak: 0.62 });
      tone({ freq: 294, to: 494, ms: 150, type: 'sine', peak: 0.3 });
    });
  },
  /** A title was chosen: three notes of one chord, each softer than the last,
      so it lands as "opened" rather than as a fanfare. */
  select() {
    once('select', () => {
      tone({ freq: 659, ms: 70, peak: 0.3 });
      tone({ freq: 988, ms: 90, delay: 0.045, peak: 0.26 });
      tone({ freq: 1319, ms: 150, delay: 0.09, peak: 0.18 });
    });
  },
  /** A sheet arrived: two notes rising, quiet enough to sit under the click. */
  open() {
    once('sheet', () => {
      tone({ freq: 430, to: 560, ms: 120, peak: 0.4 });
      tone({ freq: 645, to: 830, ms: 150, delay: 0.05, peak: 0.32 });
    });
  },
  /** A sheet left: the same shape, pointed the other way. */
  close() {
    once('sheet', () => {
      tone({ freq: 645, to: 500, ms: 110, peak: 0.34 });
      tone({ freq: 400, to: 300, ms: 130, delay: 0.04, peak: 0.26 });
    });
  },
  /** The spotlight moved on its own or by an arrow: one soft sweep. */
  slide() {
    once('slide', () => tone({ freq: 300, to: 470, ms: 170, type: 'sine', peak: 0.42 }));
  },
  /** The visitor chose to stay unheard: the toggle itself answers once. */
  toggle(on) {
    once('toggle', () =>
      on
        ? tone({ freq: 520, to: 780, ms: 90, type: 'triangle', peak: 0.5 })
        : tone({ freq: 520, to: 330, ms: 90, type: 'triangle', peak: 0.5 }),
    );
  },
  /** A pack gives way: air first, then the box. Pressed, never automatic. */
  pack() {
    once('pack', () => {
      sweep({ ms: 230, from: 900, to: 5200, peak: 0.66 });
      tone({ freq: 190, to: 92, ms: 190, type: 'triangle', peak: 0.5 });
    });
  },
  /** A card lands. The stage comes from the tier that was actually rolled, so
      the cue never promises more than the drop table delivered: a Basic card is
      one soft note, a GODLIKE is a fanfare over a sub-thud. */
  reveal(stage = 0) {
    const draw = REVEALS[Math.max(0, Math.min(REVEALS.length - 1, stage))];
    once(`reveal${stage}`, () => {
      for (const [from, to, ms, delay, peak] of draw.notes) {
        tone({ freq: from, to, ms, delay, peak, type: 'sine' });
      }
      if (draw.sweep) sweep({ ms: draw.sweep[2], from: draw.sweep[0], to: draw.sweep[1], peak: 0.55, delay: 0.02 });
      if (draw.thud) tone({ freq: 96, to: 54, ms: 260, type: 'triangle', peak: 0.62 });
    });
  },
  /** Duplicates fuse: the note climbs the whole way up and bursts at the top. */
  evolve(stage = 2) {
    once('evolve', () => {
      tone({ freq: 262, to: 1046, ms: 340 + stage * 60, type: 'sine', peak: 0.34 });
      tone({ freq: 392, to: 1568, ms: 300 + stage * 60, type: 'sine', delay: 0.12, peak: 0.26 });
      if (stage >= 2) sweep({ ms: 320, from: 500, to: 3600, peak: 0.6, delay: 0.18 });
      if (stage >= 3) tone({ freq: 90, to: 52, ms: 300, type: 'triangle', peak: 0.6, delay: 0.2 });
    });
  },
};

/* ---- the presses -------------------------------------------------------
   One delegated listener rather than a call in every view: any control built
   with the interface's own classes answers, including rows and sheets painted
   later, and a view cannot forget to wire it up. */

const TAPPABLE = [
  '.btn',
  '.chip',
  '.tab',
  '.side-link',
  '.icon-btn',
  '.seg button',
  '.switch',
  '.genre-pill',
  '.hero-nav',
  '.hero-dots button',
  '.check',
].join(', ');

/* The tiles that open something: a poster, an episode row, an up-next card, a
   binder card with a sheet behind it. They get the chime rather than the tap,
   because choosing a title is the one decision on this site worth sounding like
   a decision. A card inside the opening stage is not in that set — it carries no
   role, and its own cue is the reveal it is part of. */
const SELECTABLE = 'a.card, a.ep, a.up-next, .g-card[role="button"]';

/* Anything whose whole job is to move the page. Its sound is the sweep the
   router plays when the page actually turns, so the press stays quiet — a nav
   link that ticked and then swept answered one move twice. */
const NAVLINK = 'a[href^="#/"]';

const inert = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('is-disabled');

/* When the last press spoke, so the route change it caused knows there is
   nothing left to say. A button that turns the page later — the random pick,
   which waits on the network — still gets its sweep when the page arrives. */
let pressedAt = 0;
const HELD_MS = 180;

/** The chime for a tile, the tap for a control — one press, one sound. */
function press(e) {
  if (muted || (e.button !== undefined && e.button > 0)) return;
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return;
  const tile = el.closest(SELECTABLE);
  if (tile) {
    if (!inert(tile)) {
      sfx.select();
      pressedAt = Date.now();
    }
    return;
  }
  if (el.closest(NAVLINK)) return;
  const ctl = el.closest(TAPPABLE);
  if (ctl && !inert(ctl)) {
    sfx.click();
    pressedAt = Date.now();
  }
}

export function installInterfaceSounds() {
  /* A context built outside a gesture is born suspended and stays silent, so the
     first touch, key or click on the page is what unlocks audio — and because
     this listener is registered first, the very press that unlocks it still
     gets its own sound. Nothing before that — an auto-rotating spotlight, a
     toast — makes a context at all. */
  const arm = () => {
    armed = true;
  };
  document.addEventListener('pointerdown', arm, { capture: true, passive: true });
  document.addEventListener('keydown', arm, { capture: true });

  document.addEventListener(
    'pointerdown',
    press,
    /* Capture, because a control that calls preventDefault still deserves its
       sound; passive, because nothing here touches scrolling. */
    { capture: true, passive: true },
  );

  /* The keyboard gets the same language as the pointer: Enter on a tile chimes,
     Enter on a control ticks, and the ring moving about stays silent — reaching
     a button is not the same as deciding to press it. */
  document.addEventListener('keydown', (e) => {
    if (muted || (e.key !== 'Enter' && e.key !== ' ')) return;
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    const tile = el.closest(SELECTABLE);
    if (tile) {
      if (!inert(tile)) {
        sfx.select();
        pressedAt = Date.now();
      }
      return;
    }
    if (el.closest(NAVLINK)) return;
    const ctl = el.closest(TAPPABLE);
    if (ctl && !inert(ctl)) {
      sfx.click();
      pressedAt = Date.now();
    }
  }, { capture: true });

  /* The page answers for itself when it turns — by a link, by the back button
     or by a view calling go() — because all three are the same move to whoever
     is holding the phone, and a sweep drawn from the route is the only way to
     catch all three. */
  onChange(() => {
    if (muted || Date.now() - pressedAt < HELD_MS) return;
    sfx.nav();
  });
}
