/**
 * The daily wheel: five spins, and the server decides where each one stops.
 *
 * This page cannot roll a prize. It draws the slices it was handed, turns the
 * wheel until the index the server named sits under the pointer, and then prints
 * what came up. That order is the entire honesty of the thing: a slice labelled
 * one in two thousand is only worth believing if the roll behind it happened
 * somewhere a re-load cannot reach.
 *
 * The counter under the wheel is the one written by `lib/fortune.js` under
 * `solvn_spins_YYYY-MM-DD`: the button locks at five before a sixth request is
 * sent, and the server keeps the same cap for the account. The screen says how
 * many are left, fills a pip for each spent spin, and turns into a limit card
 * with the midnight countdown when the fifth one lands.
 *
 * The odds table underneath is the same table the draw ran on — the weights come
 * back from `GET /api/fortune` as shares of exactly one hundred thousand, so the
 * percentages printed here are the percentages that were used, not a friendlier
 * retelling of them.
 *
 * A won face is a slot rather than a picture, because which portrait is worth
 * wearing is a thing only the member can say. The bank is shown beside the wheel
 * and spent from its own sheet.
 *
 * Every prize is also drawn, not only spelled: a card shows as a plate in its own
 * tier's two hues, a band shows as the animation itself, a face shows as faces.
 * Nothing is invented for the picture — a band chip only wears a theme this
 * account can still win, and a landing only wears the one the server named.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { isSignedIn, isStaff, currentUser, fortuneUsable, setAvatar } from '../lib/account.js';
import { rarityOf } from '../lib/cards.js';
import { loadFortune, pickFace, spin, spinInMs, fortuneState, DAILY_SPINS, spinsLeft, spinDayKey } from '../lib/fortune.js';
import { faces, matchFaces } from '../lib/faces.js';
import { bannerLabel, bannerRows } from '../lib/ranks.js';
import { loadingGrid, emptyState } from '../components/media.js';
import { authSheet, say } from '../components/account.js';
import { sfx } from '../lib/sounds.js';

/** How long the wheel turns, and how many full revolutions it makes first. */
const TURN_MS = 4600;
const TURN_ROUNDS = 5;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Two dark grounds, alternating, so neighbouring slices stay legible apart. */
const FILL = ['#1c2028', '#232833'];
const SPOT = { avatar: '#22333f', banner: '#2a2440' };

/* A card slice is painted in its own tier's colour — the same pair a binder tile
   is graded with — so the wheel and the shelf agree about what Lv 15 looks like. */
const sliceFill = (p, index) =>
  p.kind === 'card' ? rarityOf(p.amount).b : SPOT[p.kind] || FILL[index % 2];
const sliceDot = (p, index) => (p.kind === 'card' ? rarityOf(p.amount).a : SPOT[p.kind] || FILL[index % 2]);

/** The word on the slice, then on the odds row, then in the result. */
function prizeName(p) {
  if (p.kind === 'xp') return t('{n} XP', { n: p.amount });
  if (p.kind === 'pack') return p.amount === 1 ? t('1 pack') : t('{n} packs', { n: p.amount });
  if (p.kind === 'card') return t('Lv {n} card', { n: p.amount });
  if (p.kind === 'avatar') return t('An anime face');
  if (p.kind === 'banner') return t('An animated banner');
  return t('A prize');
}

/** Where a landed prize actually goes, so a win is never a mystery. */
function prizeWhere(p) {
  if (p.kind === 'xp') return t('Goes straight on the level ladder.');
  if (p.kind === 'pack') return t('Banked for the card binder.');
  if (p.kind === 'card') return t('Drawn at that tier and put in your binder.');
  if (p.kind === 'avatar') return t('A face to spend, from the button beside the wheel.');
  if (p.kind === 'banner') return t('Chosen from the themes still locked on your profile.');
  return '';
}

/** `{n} slots` — a bank of won-but-unspent faces. */
const faceCount = (n) => (n === 1 ? t('1 face to spend') : t('{n} faces to spend', { n }));

/* ---- what a prize looks like ------------------------------------------
   Three shapes, all of them borrowed from somewhere that already draws the real
   thing: the tier plate wears the same pair of hues a binder tile is graded with,
   the band is the profile's own animation, and the portraits are the face
   library's own addresses. `level` prints the tier number, which only belongs on
   an upright chip — a slice turns, and a number on a turned plate reads upside
   down. `many` is how many of a pile to show, because a slice is not wide enough
   for three.
   ------------------------------------------------------------------------ */
function tierPlate(n, { level = false } = {}) {
  const r = rarityOf(n);
  return h(
    'span.fw-tier',
    {
      'aria-hidden': 'true',
      style: { background: `linear-gradient(150deg, ${r.a}, ${r.b})`, borderColor: r.glow },
    },
    level ? h('b.tnum', {}, String(n)) : null,
  );
}

const bandPlate = (theme) => h('span.fw-band', { 'aria-hidden': 'true' }, h('span.bk', { dataset: { theme } }));

/* The bands still shut on this account, which is exactly what the slice pays out.
   A member who can already wear nearly all of them gets the shelf's front three
   instead: an empty chip would read as a broken wheel, and the row's own caption
   already says how many are still locked. */
function bandSample(count) {
  const rows = bannerRows(currentUser(), isStaff());
  const shut = rows.filter((row) => !row.open);
  return (shut.length >= count ? shut : rows).slice(0, count).map((row) => bandPlate(row.key));
}

function faceChips({ library, count }) {
  const shown = library.slice(0, count);
  return h(
    'span.fw-portraits',
    { 'aria-hidden': 'true' },
    ...(shown.length
      ? shown.map((f) => h('img.fw-portrait', { src: f.image, alt: '', loading: 'lazy', decoding: 'async' }))
      : Array.from({ length: count }, () => h('span.fw-portrait.is-empty', {}, icon('user')))),
  );
}

/** The picture for one prize, as the wheel, the table or the result asked for it. */
function prizeArt(p, { level = false, many = 3, library = [] } = {}) {
  if (p.kind === 'card') return tierPlate(p.amount, { level });
  if (p.kind === 'banner') {
    /* A landing knows the theme the server wrote; a slice only knows that one of
       the locked bands is coming. */
    return p.theme ? bandPlate(p.theme) : h('span.fw-pile', { 'aria-hidden': 'true' }, ...bandSample(many));
  }
  if (p.kind === 'avatar') return faceChips({ library, count: many });
  return h(
    'span.fw-glyph',
    { 'aria-hidden': 'true' },
    icon(p.kind === 'pack' ? 'sparkles' : 'star'),
  );
}

/** `04:12:33` until the next spin, which is the only clock on this page. */
function clockText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, '0');
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/* ---- spend a won face ---------------------------------------------------
   The slot is the prize; the choice is the member's. The library is the same one
   the profile gallery browses, so a face won here is a face that can be worn,
   changed and worn again from the account page without a second rulebook.
   ------------------------------------------------------------------------ */
function faceSheet(onDone) {
  const box = h('input.input', {
    type: 'search',
    placeholder: t('Find a face…'),
    'aria-label': t('Find a face'),
    autocomplete: 'off',
  });
  const grid = h('div.fw-faces');
  const status = h('p.fw-face-note.muted', {}, t('Loading the face library…'));
  let library = null;
  let busy = false;
  let handle = null;

  const draw = () => {
    if (!library) return;
    if (!library.length) {
      status.textContent = t('The face library is not answering right now.');
      grid.replaceChildren();
      return;
    }
    const shown = matchFaces(library, box.value.trim()).slice(0, 60);
    status.textContent = shown.length ? t('{n} faces', { n: shown.length }) : t('Nothing matched that.');
    grid.replaceChildren(
      ...shown.map((f) =>
        h(
          'button.fw-face',
          {
            type: 'button',
            'aria-label': t('Spend a face on {name}', { name: f.name }),
            disabled: busy,
            onclick: () => spend(f),
          },
          h('img.fw-face-art', { src: f.image, alt: '', loading: 'lazy', decoding: 'async' }),
          h('span.fw-face-name', {}, f.name),
        ),
      ),
    );
  };

  async function spend(f) {
    if (busy) return;
    busy = true;
    draw();
    try {
      const user = await pickFace(f.id);
      /* Unlocked first, worn second: a face that cannot be drawn into an avatar is
         still a face the account owns, and the gallery can put it on later. */
      await setAvatar(f.image).catch(() => null);
      handle?.close();
      toast(
        user ? t('{name} is yours.', { name: f.name }) : t('That face is unlocked on your account.'),
        { iconName: 'check' },
      );
      onDone?.();
    } catch (err) {
      busy = false;
      draw();
      toast(say(err, t('That face could not be claimed.')), { tone: 'err', iconName: 'alert' });
    }
  }

  let timer = 0;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 140);
  });

  sheet({
    heading: t('Spend a won face'),
    sub: t('The wheel hands you the right to choose. Which portrait is worth wearing is your call.'),
    width: 720,
    render: (opened) => {
      handle = opened;
      return h('div.fw-face-sheet', {}, box, status, grid);
    },
  });

  grid.replaceChildren(loadingGrid(12));
  faces()
    .then((list) => {
      library = list;
    })
    .catch(() => {
      library = [];
    })
    .finally(draw);
}

/* ---- the page ---------------------------------------------------------- */
export function SpinView({ onCleanup }) {
  if (!fortuneUsable()) {
    return h(
      'div.spin',
      {},
      emptyState({
        iconName: 'offline',
        heading: t('The wheel needs a Solvn server'),
        body: t('A spin is drawn by the server that runs this site, which this copy does not have.'),
        action: h('a.btn.btn--primary', { href: '#/' }, icon('home'), h('span', {}, t('Back to home'))),
      }),
    );
  }

  const wrap = h('div.spin');
  if (!isSignedIn()) {
    wrap.replaceChildren(
      emptyState({
        iconName: 'star',
        heading: t('Sign in to spin'),
        body: t('Free spins are a thing an account keeps, so there has to be an account to keep them for.'),
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

  const timers = [];
  const later = (fn, ms) => {
    const id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  };

  const aura = h('span.fw-aura', { 'aria-hidden': 'true' });
  const rim = h('span.fw-rim', { 'aria-hidden': 'true' });
  const ticks = h('span.fw-ticks', { 'aria-hidden': 'true' });
  const wheel = h('div.fw-wheel');
  const pointer = h('span.fw-pointer', { 'aria-hidden': 'true' }, icon('chevronDown'));
  const hub = h('div.fw-hub', { 'aria-hidden': 'true' }, icon('star'));
  const board = h('div.fw-board', {}, aura, rim, ticks, wheel, pointer, hub);
  /* The arena's atmosphere: light motes that never reach the wheel, a shadow it
     sits on, and the tilt that makes the disc a coin rather than a sticker. */
  const sparks = h(
    'span.fw-sparks',
    { 'aria-hidden': 'true' },
    ...Array.from({ length: 9 }, (_, i) =>
      h('i.fw-spark', {
        style: {
          left: `${7 + i * 10.3}%`,
          top: `${16 + ((i * 37) % 62)}%`,
          animationDelay: `${-i * 1.7}s`,
          animationDuration: `${6 + (i % 4) * 1.5}s`,
        },
      }),
    ),
  );
  const floor = h('span.fw-floor', { 'aria-hidden': 'true' });
  const tilt = h('div.fw-tilt', {}, floor, board);
  const pips = h('div.fw-pips', { 'aria-hidden': 'true' });
  const spinsText = h('p.fw-spins-left.tnum', { 'aria-live': 'polite' }, '');
  const limitBody = h('p.fw-limit-body', {}, '');
  const limit = h(
    'div.fw-limit',
    { hidden: true, role: 'status' },
    h('span.fw-limit-badge', { 'aria-hidden': 'true' }, icon('clock')),
    h('div.fw-limit-copy', {}, h('b', {}, t('Daily Limit Reached')), limitBody),
  );
  const spinBtn = h(
    'button.btn.btn--primary.fw-go',
    { type: 'button', 'data-sfx': 'none', onclick: () => take() },
    icon('refresh'),
    h('span', {}, t('Spin the wheel')),
  );
  const stage = h(
    'div.fw-stage',
    {},
    h('span.fw-arena-glow', { 'aria-hidden': 'true' }),
    h('span.fw-arena-grid', { 'aria-hidden': 'true' }),
    sparks,
    tilt,
    h('div.fw-controls', {}, pips, spinsText, spinBtn, limit),
  );
  const faceBtn = h('div.fw-bank');
  const result = h('div.fw-result', { 'aria-live': 'polite' });
  const odds = h('div.fw-odds', { 'aria-live': 'polite' });
  let angle = 0;
  let turning = false;
  /* Portraits are the one piece of art this page cannot invent, and the library
     is a catalogue call. So the wheel is drawn first and the faces land into it
     a moment later — a disc should never wait on a roster to start turning. */
  let library = [];

  /* The gradient and the labels are painted from the server's own weights, so a
     slice's width on screen is its width in the draw. Nothing here is rounded up
     to look generous. */
  function paintWheel(prizes) {
    const total = prizes.reduce((n, p) => n + (Number(p.weight) || 0), 0) || 1;
    const stops = [];
    const tags = [];
    let acc = 0;
    prizes.forEach((p, i) => {
      const from = (acc / total) * 360;
      acc += Number(p.weight) || 0;
      const to = (acc / total) * 360;
      const mid = (from + to) / 2;
      stops.push(`${sliceFill(p, i)} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`);
      /* A slice that is worth one in two thousand is under one degree of wheel — a
         word printed inside it would only collide with its neighbours. Those prizes
         are named in the table below, where they have a whole row. */
      if (to - from < 11) return;
      const tag = h(
        'div.fw-tag',
        {},
        h('span.fw-tag-text', {}, prizeName(p)),
        h('span.fw-tag-art', {}, prizeArt(p, { many: 1, library })),
      );
      tag.style.transform = `rotate(${mid.toFixed(2)}deg)`;
      tags.push(tag);
    });
    wheel.replaceChildren(...tags);
    wheel.style.background = `conic-gradient(${stops.join(', ')})`;
  }

  function paintOdds(prizes) {
    odds.replaceChildren(
      h('h2.fw-h2', {}, t('What the slices pay')),
      h(
        'div.fw-odds-rows',
        {},
        ...prizes.map((p, i) =>
          h(
            'div.fw-odds-row',
            {},
            h(
              'span.fw-odds-name',
              {},
              h('i.fw-dot', { 'aria-hidden': 'true', style: { background: sliceDot(p, i) } }),
              prizeArt(p, { library }),
              h('b', {}, prizeName(p)),
            ),
            h('span.fw-odds-where', {}, p.kind === 'banner' && p.lockedOnly ? t('{n} themes still locked', { n: p.lockedOnly }) : prizeWhere(p)),
            h(
              'span.fw-odds-rate.tnum',
              {},
              h('b', {}, `${p.pct < 1 ? p.pct.toFixed(2) : p.pct.toFixed(1)}%`),
              h('span', {}, t('1 in {n}', { n: p.oneIn })),
            ),
          ),
        ),
      ),
    );
  }

  let lastPrizeKey = '';
  function showPrize(p) {
    if (!p) {
      result.replaceChildren();
      lastPrizeKey = '';
      return;
    }
    /* A refresh after the landing repaints the same stored prize; replacing the
       card would replay its deal animation a second time. */
    const key = JSON.stringify(p);
    if (key === lastPrizeKey && result.firstChild) return;
    lastPrizeKey = key;
    const name = p.kind === 'banner' && p.theme ? t('{name} banner', { name: t(bannerLabel(p.theme)) }) : prizeName(p);
    result.replaceChildren(
      h(
        'div.fw-prize',
        {},
        /* The landing wears the real thing: the band the server named, the tier it
           promised, the faces it just unlocked. The icon is only what is left for
           XP and packs, which are numbers rather than pictures. */
        prizeArt(p, { level: true, library }),
        h(
          'div.fw-prize-copy',
          {},
          h('h3', {}, t('You won {name}', { name })),
          h('p.faint', {}, p.kind === 'banner' && p.theme ? t('Wear it from Settings, or leave the shelf empty.') : prizeWhere(p)),
        ),
      ),
    );
  }

  /** How much the landing is allowed to shout: the same ladder the reveal cue
      uses, so the picture and the sound agree about the size of the win. */
  const drama = (p) => {
    if (!p) return 0;
    if (p.kind === 'card') return p.amount >= 20 ? 4 : p.amount >= 12 ? 3 : 2;
    if (p.kind === 'banner' || p.kind === 'avatar') return 3;
    return 1;
  };

  /* A burst is eighteen paper chips thrown from the hub, painted in the tier's
     own two hues when a card landed. Nothing is fetched; the threads are spans
     and the flight is one transform per chip. */
  let burstEl = null;
  function burst(p) {
    burstEl?.remove();
    const r = p?.kind === 'card' ? rarityOf(p.amount) : null;
    const colors = r
      ? [r.a, r.b, '#f4f7ff']
      : ['var(--accent)', 'var(--accent-bright)', 'var(--gold)', '#f4f7ff'];
    burstEl = h('span.fw-burst', { 'aria-hidden': 'true' });
    for (let i = 0; i < 18; i += 1) {
      const piece = h('i.fw-confetti');
      const angle = ((i / 18) * 360 + Math.random() * 12) * (Math.PI / 180);
      const dist = 96 + Math.random() * 132;
      piece.style.setProperty('--x', `${Math.cos(angle) * dist}px`);
      piece.style.setProperty('--y', `${Math.sin(angle) * dist - 34}px`);
      piece.style.setProperty('--r', `${Math.round(Math.random() * 680 - 340)}deg`);
      piece.style.setProperty('--d', `${Math.round(Math.random() * 130)}ms`);
      piece.style.setProperty('--c', colors[i % colors.length]);
      burstEl.append(piece);
    }
    board.append(burstEl);
    later(() => {
      burstEl?.remove();
      burstEl = null;
    }, 1900);
  }

  /** What happens the moment the disc stops: the card, the cue, the burst. */
  function celebrate(prize) {
    showPrize(prize);
    sfx.land(drama(prize), prize?.kind || '');
    if (reduced()) return;
    burst(prize);
    stage.classList.add('is-win');
    later(() => stage.classList.remove('is-win'), 1500);
  }

  function paintBank(st) {
    const n = Number(st.faces) || 0;
    faceBtn.replaceChildren(
      n
        ? h(
            'button.btn.btn--sm',
            { type: 'button', onclick: () => faceSheet(() => refresh()) },
            icon('user'),
            h('span', {}, faceCount(n)),
          )
        : null,
    );
  }

  /** The cap, the pips and the lock card all read the same stored count. */
  function paintSpins(st) {
    const left = spinsLeft();
    const used = DAILY_SPINS - left;
    const exhausted = left <= 0;
    pips.replaceChildren(
      ...Array.from({ length: DAILY_SPINS }, (_, i) => {
        const pip = h('span.fw-pip', { 'aria-hidden': 'true' });
        if (i < used) pip.classList.add('is-used');
        return pip;
      }),
    );
    spinsText.textContent = exhausted
      ? t('Fresh spins in {time}', { time: clockText(spinInMs()) })
      : t('{left} of {n} spins left today', { left, n: DAILY_SPINS });
    limit.hidden = !exhausted;
    if (exhausted) limitBody.textContent = t('Come back in {time} for five new spins.', { time: clockText(spinInMs()) });
    spinBtn.disabled = turning || exhausted || !st.loaded || st.failed;
    spinBtn.querySelector('span').textContent = exhausted ? t('Daily Limit Reached') : t('Spin the wheel');
    spinBtn.classList.toggle('is-locked', exhausted);
    stage.classList.toggle('is-exhausted', exhausted);
  }

  function paint(st) {
    const prizes = st.prizes || [];
    if (prizes.length) paintWheel(prizes);
    paintOdds(prizes);
    paintBank(st);
    if (!turning) showPrize(st.prize);
    paintSpins(st);
    if (st.failed && st.loaded) {
      wheel.replaceChildren(h('p.fw-faint', {}, t('The wheel is not answering right now.')));
      wheel.style.background = '';
    }
  }

  async function take() {
    if (turning) return;
    if (spinsLeft() <= 0) {
      sfx.toggle(false);
      toast(t('Daily limit reached. Try again tomorrow.'), { tone: 'err', iconName: 'alert' });
      paintSpins(fortuneState());
      return;
    }
    turning = true;
    stage.classList.add('is-spinning');
    /* The press answers at once; the server's draw arrives while the rim is
       already building speed, so a slow reply costs animation, never feedback. */
    sfx.wheel();
    paint(fortuneState());
    const d = await spin();
    if (d.blocked) {
      turning = false;
      stage.classList.remove('is-spinning');
      sfx.toggle(false);
      toast(
        d.blocked === 'limit'
          ? t('Daily limit reached. Try again tomorrow.')
          : d.blocked === 'signedout'
            ? t('Sign in to spin the wheel.')
            : say({ message: d.message }, t('The wheel did not answer.')),
        { tone: 'err', iconName: 'alert' },
      );
      refresh();
      return;
    }
    const prizes = d.prizes || [];
    const total = prizes.reduce((n, p) => n + (Number(p.weight) || 0), 0) || 1;
    let mid = 0;
    let acc = 0;
    prizes.some((p, i) => {
      const from = (acc / total) * 360;
      acc += Number(p.weight) || 0;
      if (i === d.index) {
        mid = (from + (acc / total) * 360) / 2;
        return true;
      }
      return false;
    });
    /* Land the drawn slice under the pointer, having gone round five times first,
       so the stop is a finish rather than a jump. */
    angle += 360 * TURN_ROUNDS + ((360 - ((angle + mid) % 360)) % 360);

    if (reduced()) {
      turning = false;
      stage.classList.remove('is-spinning');
      wheel.style.transform = `rotate(${(360 - mid) % 360}deg)`;
      celebrate(d.prize);
      refresh();
      return;
    }
    wheel.style.transition = `transform ${TURN_MS}ms cubic-bezier(.12,.78,.18,1)`;
    wheel.style.transform = `rotate(${angle}deg)`;
    later(() => {
      turning = false;
      stage.classList.remove('is-spinning');
      celebrate(d.prize);
      refresh();
    }, TURN_MS + 60);
  }

  function refresh() {
    loadFortune().then(paint);
  }

  paint(fortuneState());
  refresh();
  faces()
    .then((list) => {
      if (!list.length) return;
      library = list;
      /* Only the art changes, and only between turns — a disc that grew a
         portrait mid-spin would look like the prize had moved. */
      if (!turning) paint(fortuneState());
    })
    .catch(() => null);
  /* One tick a second for a clock nobody can settle by eye, and it only rewrites
     two short strings — no layout, no fetch. At midnight the key under the button
     changes; the page refetches once so the fresh five appear without a reload. */
  let dayKey = spinDayKey();
  const tick = setInterval(() => {
    if (spinDayKey() !== dayKey) {
      dayKey = spinDayKey();
      refresh();
      return;
    }
    if (spinsLeft() <= 0) {
      const time = clockText(spinInMs());
      spinsText.textContent = t('Fresh spins in {time}', { time });
      limitBody.textContent = t('Come back in {time} for five new spins.', { time });
    }
  }, 1000);
  const onAccount = () => refresh();
  document.addEventListener('kitsune:account', onAccount);
  onCleanup(() => {
    clearInterval(tick);
    for (const id of timers) clearTimeout(id);
    document.removeEventListener('kitsune:account', onAccount);
  });

  const head = h(
    'div.fw-head',
    {},
    h(
      'div',
      {},
      h('h1.display', {}, t('Fortune wheel')),
      h('p.muted.fw-sub', {}, t('Five free spins a day, drawn by the server. The odds printed under the wheel are the odds the draw ran on.')),
      h('p.fw-tally.tnum', {}, t('{n} spins taken', { n: Number(fortuneState().spins) || 0 })),
    ),
    faceBtn,
  );

  wrap.replaceChildren(head, stage, result, odds);
  return wrap;
}
