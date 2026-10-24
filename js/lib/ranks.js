/**
 * Ranks and badges. Every label lives here, never on the server: a tier name
 * shipped from the API could not be translated into French or Arabic, and the
 * hour thresholds are the four numbers both sides agree on.
 *
 * The profile page no longer measures anybody — this module is kept because the
 * gated /admin dashboard still previews tiers and badge rows. The picture
 * pipeline at the bottom lives here for the same reason the nav chip needs it:
 * it is the one shared account utility with no store dependency.
 */

import { storage, viewLog, listCount, favouriteEntries } from './store.js';

/* Same thresholds as TIERS in account-api.js. */
export const TIERS = [
  { id: 'bronze', min: 0 },
  { id: 'silver', min: 1.5 },
  { id: 'gold', min: 30 },
  { id: 'platinum', min: 60 },
];

export const TIER_LABELS = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Otaku Master',
};

/* Avatar glyphs the server will accept — keep in step with GLYPHS in account-api.js. */
export const GLYPH_CHOICES = ['fox', 'moon', 'star', 'flame', 'ghost', 'bolt'];

/** The tier reached at `hours`, and what is still needed for the next one. */
export function rankOf(hours) {
  const h = Number(hours) || 0;
  let index = 0;
  for (let i = 0; i < TIERS.length; i += 1) if (h >= TIERS[i].min) index = i;
  const tier = TIERS[index];
  const next = TIERS[index + 1] || null;
  return {
    tier: tier.id,
    label: TIER_LABELS[tier.id],
    isTop: !next,
    nextTier: next?.id || null,
    nextLabel: next ? TIER_LABELS[next.id] : null,
    nextAtHours: next?.min ?? null,
    hoursToNext: next ? Math.max(0, Math.round((next.min - h) * 10) / 10) : 0,
    // how far along the current band, for the progress rail
    bandPct: next
      ? clampPct(((h - tier.min) / (next.min - tier.min)) * 100)
      : 100,
  };
}

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));

/* ---- badges --------------------------------------------------------- */
/**
 * Unlock rules are pure functions of what this device has watched plus the
 * library counts, so they run offline, and the ids that pass are the ids sent
 * to the server. `label` is the English source string used as the i18n key.
 */
export const BADGES = [
  {
    id: 'first-light',
    label: 'First Light',
    icon: 'sparkles',
    hint: 'Watched your very first episode.',
    test: (s) => s.episodes >= 1,
  },
  {
    id: 'warming-up',
    label: 'Warming Up',
    icon: 'flame',
    hint: 'Three episodes watched.',
    test: (s) => s.episodes >= 3,
  },
  {
    id: 'ten-deep',
    label: 'Ten Deep',
    icon: 'film',
    hint: 'Ten episodes watched.',
    test: (s) => s.episodes >= 10,
  },
  {
    id: 'devoted',
    label: 'Devoted',
    icon: 'trophy',
    hint: 'Twenty-five episodes and counting.',
    test: (s) => s.episodes >= 25,
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    icon: 'moon',
    hint: 'Five episodes after midnight.',
    test: (s) => s.lateNight >= 5,
  },
  {
    id: 'binge',
    label: 'Binge Watcher',
    icon: 'popcorn',
    hint: 'Six episodes in a single day.',
    test: (s) => s.bestDay >= 6,
  },
  {
    id: 'marathon',
    label: 'Marathon Master',
    icon: 'bolt',
    hint: 'Ten episodes inside three hours.',
    test: (s) => s.bestSitting >= 10,
  },
  {
    id: 'explorer',
    label: 'Explorer',
    icon: 'compass',
    hint: 'Opened ten different shows.',
    test: (s) => s.titles >= 10,
  },
  {
    id: 'finisher',
    label: 'Finisher',
    icon: 'check',
    hint: 'Five series marked completed.',
    test: (s) => s.completed >= 5,
  },
  {
    id: 'collector',
    label: 'Collector',
    icon: 'heart',
    hint: 'Fifteen titles favourited.',
    test: (s) => s.favourites >= 15,
  },
  {
    id: 'curator',
    label: 'Curator',
    icon: 'list',
    hint: 'Three public playlists shared.',
    test: (s) => s.playlists >= 3,
  },
];

export const badgeById = (id) => BADGES.find((b) => b.id === id) || null;

/* ---- the ladder -------------------------------------------------------
 * The curve itself lives in `lib/level.js`, which owns the storage key. All this
 * module needs is the two numbers a badge rule reads, so it takes them straight
 * out of that key rather than importing the ladder and pointing it back at the
 * account record. The level is always re-derived from the XP before it is written
 * there, so the pair can never drift apart.
 *
 * Ten levels to a badge, not five: the server stores at most thirty-two ids, and
 * the watch badges already take eleven. Packs pay at every level — that is the
 * reward you can spend — a badge is the one that has to leave room.
 */
export const LEVEL_STEP = 10;
export const MAX_LEVEL = 100;

export function levelNumbers() {
  const raw = storage.read('level', null);
  if (!raw || typeof raw !== 'object') return { xp: 0, level: 1 };
  return {
    xp: Math.max(0, Number(raw.xp) || 0),
    level: Math.max(1, Math.min(MAX_LEVEL, Number(raw.level) || 1)),
  };
}

for (let l = LEVEL_STEP; l <= MAX_LEVEL; l += LEVEL_STEP) {
  BADGES.push({
    id: `level-${l}`,
    label: `Level ${l}`,
    icon: l >= 70 ? 'crown' : 'bolt',
    hint: `Reached level ${l}.`,
    test: (s) => s.level >= l,
  });
}

const SITTING = 3 * 3600 * 1000;

/* ---- the duel divisions ----------------------------------------------
   A rank badge has to be earned at the table, so every threshold is a count of
   settled fights — the one figure this server writes and no browser can. Wins
   alone would put somebody who fought twice above somebody who fought two
   hundred, so the ladder steps on wins and only opens a division once a member
   has fought enough times for the rate to mean anything.

   Labels are English source strings, like every other label in this module, so
   they can be translated. */
export const DIVISIONS = [
  { id: 'rookie', wins: 1, label: 'Rookie Duelist', icon: 'bolt' },
  { id: 'contender', wins: 5, label: 'Contender', icon: 'flame' },
  { id: 'challenger', wins: 15, label: 'Challenger', icon: 'trending' },
  { id: 'elite', wins: 30, label: 'Elite', icon: 'star' },
  { id: 'champion', wins: 60, label: 'Champion', icon: 'trophy' },
  { id: 'legend', wins: 120, label: 'Legend of the Arena', icon: 'crown' },
];

/** The division a duel record has reached, or null for a member who has never fought. */
export function divisionOf(user) {
  const wins = Number(user?.duel?.wins) || 0;
  let hit = null;
  for (const d of DIVISIONS) if (wins >= d.wins) hit = d;
  return hit;
}

/** Most episodes inside any window of `span`, sliding over an ordered log. */
function bestWindow(times, span) {
  let best = 0;
  let left = 0;
  for (let right = 0; right < times.length; right += 1) {
    while (times[right] - times[left] > span) left += 1;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

/** Counters every badge rule reads, built from this device's own records. */
export function measure(log = viewLog(), extra = {}) {
  const ordered = [...log].sort((a, b) => a.at - b.at);
  const times = ordered.map((e) => e.at).filter(Boolean);
  const byDay = new Map();
  let lateNight = 0;
  for (const e of ordered) {
    if (!e.at) continue;
    const d = new Date(e.at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    byDay.set(key, (byDay.get(key) || 0) + 1);
    const hour = d.getHours();
    if (hour < 5) lateNight += 1;
  }
  /* One bad record must never drag the scoreboard below zero. */
  const minutes = ordered.reduce((n, e) => n + (Number(e.mins) > 0 ? Number(e.mins) : 0), 0);
  const ladder = levelNumbers();
  return {
    minutes,
    hours: Math.max(0, Math.round(minutes / 6) / 10),
    episodes: ordered.length,
    titles: new Set(ordered.map((e) => String(e.id))).size,
    lateNight,
    bestDay: byDay.size ? Math.max(...byDay.values()) : 0,
    bestSitting: bestWindow(times, SITTING),
    completed: extra.completed ?? listCount('completed'),
    favourites: extra.favourites ?? favouriteEntries().length,
    playlists: extra.playlists ?? 0,
    xp: ladder.xp,
    level: ladder.level,
  };
}

/** Every badge `m` earns — the ids the server stores. */
export function earnedBadges(m) {
  return BADGES.filter((b) => b.test(m)).map((b) => b.id);
}

/** The full local picture: stats + rank + badges, ready to render or upload. */
export function localStats(extra = {}) {
  const m = measure(viewLog(), extra);
  return {
    hours: m.hours,
    episodes: m.episodes,
    completed: m.completed,
    titles: m.titles,
    favourites: m.favourites,
    playlists: m.playlists,
    xp: m.xp,
    level: m.level,
    badges: earnedBadges(m),
    rank: rankOf(m.hours),
    measure: m,
  };
}

/* ---- profile picture -----------------------------------------------
   The browser does the resizing: a phone photo must never turn into a
   multi-megabyte request, and a picture the server accepts has to survive the
   round trip through JSON. */

const MEGABYTE = 1024 * 1024;

export const AVATAR_UPLOAD = {
  /** The stored square. Anything bigger is wasted on a 44px chip. */
  size: 256,
  /** Everything a browser can decode into a canvas. HEIC and TIFF are left out:
      Safari may read them, but no other engine can, so they would upload a
      picture nobody else could see. */
  accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif',
  /** A picker reports bytes before a decoder reports pixels, so an absurd file
      is refused without being read at all. */
  maxBytes: 12 * MEGABYTE,
  /** A pathologically tall or wide file costs memory just to decode. */
  maxPixels: 40 * MEGABYTE,
  /** Ceilings on the stored string, matched to `picture()` in account-api.js
      with room for the rest of the body inside MAX_BODY. */
  maxDataUrl: 96 * 1024,
  maxStored: 72 * 1024,
  mime: 'image/jpeg',
  quality: 0.86,
};

/**
 * The longest side we ever decode. A 100-megapixel panorama is only ever going
 * to become a 256px square, so the browser is not asked to hold the full frame.
 */
async function loadImage(url) {
  if ('decode' in Image.prototype) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read.'));
    img.src = url;
  });
}

/** The source rectangle that crops an image to `ratio`, centred. */
function cropBox(w, h, ratio) {
  if (w / h > ratio) {
    const cw = h * ratio;
    return [(w - cw) / 2, 0, cw, h];
  }
  const ch = w / ratio;
  return [0, (h - ch) / 2, w, ch];
}

/** White under a format that can carry transparency, so no photo goes black. */
function fillBackdrop(ctx, w, h) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
}

/**
 * Crop the source to `ratio` around its centre and draw it into a w x h canvas
 * with a high quality resize. A phone panorama keeps its middle; a portrait
 * crops toward the top, because that is where a face is.
 *
 * `createImageBitmap` gives the good resample, but Safari has not always
 * accepted the crop-and-resize options, so the direct draw is the fallback
 * rather than the error path — a slightly softer picture beats one that cannot
 * upload.
 */
async function frameFromImage(img, w, h, ratio) {
  const sw = img.naturalWidth || img.width || w;
  const sh = img.naturalHeight || img.height || h;
  if (sw * sh > AVATAR_UPLOAD.maxPixels) throw new Error('That image is far too large. Try a smaller one.');
  const [sx, sy, cropW, cropH] = cropBox(sw, sh, ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  fillBackdrop(ctx, w, h);
  let crop = null;
  try {
    crop = await createImageBitmap(img, {
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
      sourceX: sx,
      sourceY: sy,
      sourceWidth: cropW,
      sourceHeight: cropH,
    });
  } catch {
    crop = null;
  }
  if (crop) {
    ctx.drawImage(crop, 0, 0);
    crop.close?.();
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, w, h);
  }
  return canvas;
}

const encode = (canvas, quality = AVATAR_UPLOAD.quality) => canvas.toDataURL(AVATAR_UPLOAD.mime, quality);

const dataUrlOf = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });

/** Round-trip a candidate data URL through the decoder before it is uploaded. */
async function verify(dataUrl) {
  const img = await loadImage(dataUrl);
  return img.naturalWidth > 0 && img.naturalHeight > 0;
}

/**
 * Turn a picked file into a picture the server will accept and that renders:
 * decoded, cropped to a centred square, downscaled to 256px with a high quality
 * resize and re-encoded as a data URL. Every failure is a plain-language
 * message, and nothing here can leave a half-written avatar behind.
 */
export async function avatarFromImageFile(file) {
  if (!file) throw new Error('Choose a picture first.');
  const type = String(file.type || '');
  if (!type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(String(file.name || ''))) {
    throw new Error('That file is not an image.');
  }
  if (file.size > AVATAR_UPLOAD.maxBytes) throw new Error('That picture is too large. Choose a smaller file.');

  const url = URL.createObjectURL(file);
  try {
    const bitmap = await loadImage(url);
    const canvas = await frameFromImage(bitmap, AVATAR_UPLOAD.size, AVATAR_UPLOAD.size, 1);
    let out = encode(canvas);
    /* A photo that still cannot fit the budget is re-cropped half size and
       squeezed harder: the cost is almost always one busy region. */
    if (out.length > AVATAR_UPLOAD.maxDataUrl) {
      const half = Math.floor(AVATAR_UPLOAD.size / 2) * 2;
      const retry = await frameFromImage(bitmap, half, half, 1);
      out = encode(retry, 0.6);
    }
    if (out.length > AVATAR_UPLOAD.maxDataUrl) throw new Error('That picture is too detailed to store. Try another one.');
    if (!(await verify(out))) throw new Error('That image could not be read.');

    /* An animated GIF flattened to its first frame keeps its motion by riding
       along as the original bytes, as long as it already fits the smaller cap. */
    const animated = type === 'image/gif' && file.size <= AVATAR_UPLOAD.maxStored ? await dataUrlOf(file) : null;
    const animatedOk = animated && animated.startsWith('data:image/gif') && (await verify(animated));
    return { dataUrl: out, fileUrl: animatedOk ? animated : null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---- profile background --------------------------------------------
   The band behind a profile is about four times as wide as it is tall, so the
   same browser-side ladder applies: crop to the band's shape, resize it down to
   what the hero actually draws, and re-encode until it fits the request. */

export const BANNER_UPLOAD = {
  /** The stored band. Anything wider is wasted on a hero a few hundred pixels
      tall. */
  width: 1440,
  height: 360,
  accept: AVATAR_UPLOAD.accept,
  /** A wallpaper file can be far bigger than the square it becomes. */
  maxBytes: 20 * MEGABYTE,
  /** Matched to `BANNER_MAX` and `BANNER_FILE_MAX` in account-api.js, with the
      base64 inflation of a GIF counted in. */
  maxDataUrl: 120 * 1024,
  maxStored: 76 * 1024,
  quality: 0.72,
};

/**
 * Turn a picked file into a background the server will accept: cropped to the
 * band's own shape, downscaled, re-encoded, and — for an animated GIF — carried
 * along as its original bytes so the motion survives.
 */
export async function bannerFromImageFile(file) {
  if (!file) throw new Error('Choose a picture first.');
  const type = String(file.type || '');
  if (!type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(String(file.name || ''))) {
    throw new Error('That file is not an image.');
  }
  if (file.size > BANNER_UPLOAD.maxBytes) throw new Error('That picture is too large. Choose a smaller file.');

  const url = URL.createObjectURL(file);
  try {
    const bitmap = await loadImage(url);
    const { width, height } = BANNER_UPLOAD;
    const canvas = await frameFromImage(bitmap, width, height, width / height);
    let out = encode(canvas, BANNER_UPLOAD.quality);
    if (out.length > BANNER_UPLOAD.maxDataUrl) {
      const retry = await frameFromImage(bitmap, Math.floor(width * 0.7), Math.floor(height * 0.7), width / height);
      out = encode(retry, 0.58);
    }
    if (out.length > BANNER_UPLOAD.maxDataUrl) throw new Error('That picture is too detailed to store. Try another one.');
    if (!(await verify(out))) throw new Error('That image could not be read.');

    const animated = type === 'image/gif' && file.size <= BANNER_UPLOAD.maxStored ? await dataUrlOf(file) : null;
    const animatedOk = animated && animated.startsWith('data:image/gif') && (await verify(animated));
    return { dataUrl: out, fileUrl: animatedOk ? animated : null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* The animated bands a profile can wear. These keys are the contract with
   `BANNER_THEMES` in account-api.js — each one is drawn in CSS by `.bk` in
   profile.css, so a name outside the list renders nothing and the server
   refuses it. Labels reach t() through the extractor's indirect list.
   The order is the server's order as well, because `BANNER_FREE` is the front of
   this shelf: the first three are what every account starts with, and everything
   behind them is earned by level or won on the wheel. Forty-two of them, in the
   order the shelf shows them: the founding twenty-four, then the eighteen soft
   neon bands that fill the second half. */
export const BANNER_THEMES = [
  ['aurora', 'Aurora'],
  ['neon', 'Neon grid'],
  ['ocean', 'Deep sea'],
  ['ember', 'Ember'],
  ['matrix', 'Code rain'],
  ['violet', 'Nebula'],
  ['spectrum', 'Spectrum'],
  ['gold', 'Gold leaf'],
  ['sakura', 'Cherry blossom'],
  ['storm', 'Storm front'],
  ['sunset', 'Sunset'],
  ['glacier', 'Glacier'],
  ['lava', 'Lava field'],
  ['forest', 'Deep forest'],
  ['retro', 'Retro sun'],
  ['glitch', 'Glitch'],
  ['cyber', 'Cyber line'],
  ['toxic', 'Toxic'],
  ['ink', 'Ink wash'],
  ['chrome', 'Chrome'],
  ['cosmos', 'Cosmos'],
  ['eclipse', 'Eclipse'],
  ['fireworks', 'Fireworks'],
  ['bubbles', 'Bubbles'],
  ['mint', 'Mint mist'],
  ['lilac', 'Lilac haze'],
  ['peach', 'Peach glow'],
  ['ice', 'Ice bloom'],
  ['mango', 'Mango tide'],
  ['lotus', 'Lotus pink'],
  ['polar', 'Polar night'],
  ['siren', 'Siren teal'],
  ['dusk', 'Dusk violet'],
  ['cotton', 'Cotton candy'],
  ['honey', 'Honeycomb'],
  ['ripple', 'Neon ripple'],
  ['pulse', 'Heartbeat'],
  ['veil', 'Silk veil'],
  ['beam', 'Light beam'],
  ['horizon', 'Neon horizon'],
  ['koi', 'Koi pond'],
  ['crystal', 'Crystal grid'],
];

export const BANNER_KEYS = BANNER_THEMES.map(([key]) => key);

/** What every account wears without earning it — the front of the shelf. */
export const BANNER_FREE = 3;

/**
 * The level a band needs.
 *
 * A step of about two levels a theme, starting after the free three: the fourth
 * band is a weekend of showing up and the last of the forty-two is a long season,
 * Lv 76 of a hundred. That spread is the point — a shelf where everything unlocks
 * by level 6 is a shelf with no bottom. The wheel can hand one over early, which
 * is why `held` is checked as well.
 */
export function bannerLevel(index) {
  if (index < BANNER_FREE) return 1;
  return Math.max(2, Math.round((index - 1) * 1.9));
}

/**
 * The shelf, with what this member may wear.
 *
 * Two halves read together: the list the server wrote (`unlocks.banners`, which is
 * the wheel's output and nothing else) and the level the device published. Only
 * the first is the server's to vouch for, and only the second can be checked
 * against a number nobody can talk themselves into wearing twice.
 */
export function bannerRows(user, staff = false) {
  const level = Math.max(1, Number(user?.stats?.level) || 1);
  const won = Array.isArray(user?.unlocks?.banners) ? user.unlocks.banners : [];
  return BANNER_THEMES.map(([key, label], index) => {
    const need = bannerLevel(index);
    return {
      key,
      label,
      index,
      need,
      won: won.includes(key),
      open: staff || index < BANNER_FREE || won.includes(key) || level >= need,
    };
  });
}

/** The name a wheel result or a profile prints for one theme key. */
export const bannerLabel = (key) => BANNER_THEMES.find(([k]) => k === key)?.[1] || '';

/* ---- titles ---------------------------------------------------------- */
/**
 * A title is a sentence you wear next to your name. Each one unlocks from a
 * figure the account already publishes — hours, episodes, series finished,
 * titles opened, packs pulled and the peak Power in the binder — so a visitor
 * can work out whether any profile has earned what it wears, and the server
 * only has to check that the id exists. `hint` is the i18n key of the line
 * under the name and `{n}` is filled with `need`.
 */
const stat = (user) => (user && user.stats) || {};
const cards = (user) => (user && user.cards) || {};

export const TITLES = [
  { id: 'newcomer', label: 'Newcomer', icon: 'sparkles', hue: 195, hint: 'Watch {n} episodes', need: 1, test: (u) => stat(u).episodes >= 1 },
  { id: 'watcher', label: 'Watcher', icon: 'clock', hue: 218, hint: 'Watch {n} hours', need: 10, test: (u) => stat(u).hours >= 10 },
  { id: 'devotee', label: 'Devotee', icon: 'heart', hue: 268, hint: 'Watch {n} hours', need: 50, test: (u) => stat(u).hours >= 50 },
  { id: 'marathoner', label: 'Marathoner', icon: 'flame', hue: 14, hint: 'Watch {n} hours', need: 150, test: (u) => stat(u).hours >= 150 },
  { id: 'otaku', label: 'Otaku', icon: 'moon', hue: 240, hint: 'Watch {n} hours', need: 400, test: (u) => stat(u).hours >= 400 },
  { id: 'completionist', label: 'Completionist', icon: 'check', hue: 138, hint: 'Finish {n} series', need: 5, test: (u) => stat(u).completed >= 5 },
  { id: 'pathfinder', label: 'Pathfinder', icon: 'compass', hue: 96, hint: 'Open {n} titles', need: 25, test: (u) => stat(u).titles >= 25 },
  { id: 'opener', label: 'Pack Opener', icon: 'grid', hue: 305, hint: 'Open {n} packs', need: 50, test: (u) => cards(u).pulls >= 50 },
  { id: 'binder', label: 'Binder', icon: 'library', hue: 168, hint: 'Own {n} different cards', need: 25, test: (u) => cards(u).unique >= 25 },
  { id: 'chaser', label: 'Card Chaser', icon: 'star', hue: 62, hint: 'Pull a card worth {n} Power', need: 500, test: (u) => cards(u).best >= 500 },
  { id: 'elite', label: 'Elite Collector', icon: 'crown', hue: 335, hint: 'Pull a card worth {n} Power', need: 700, test: (u) => cards(u).best >= 700 },
  { id: 'master', label: 'Solvn Master', icon: 'bolt', hue: 44, hint: 'Own the Solvn master card', need: 0, test: (u) => cards(u).topTier >= 25 },
];

export const titleById = (id) => TITLES.find((entry) => entry.id === id) || null;

/** Whether the figures on this record earn the title. Safe on a partial user. */
export const titleUnlocked = (title, user) => Boolean(title) && title.test(user || {});

export const unlockedTitles = (user) => TITLES.filter((entry) => entry.test(user || {}));
