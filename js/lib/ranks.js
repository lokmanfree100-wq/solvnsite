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

import { viewLog, listCount, favouriteEntries } from './store.js';

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

const SITTING = 3 * 3600 * 1000;

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
function fillBackdrop(ctx, size) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
}

/**
 * Square crop, centred — horizontal panoramas keep the middle, portraits crop
 * toward the top because that is where a face is.
 */
async function squareFromImage(img, size) {
  const w = img.naturalWidth || img.width || size;
  const h = img.naturalHeight || img.height || size;
  if (w * h > AVATAR_UPLOAD.maxPixels) throw new Error('That image is far too large. Try a smaller one.');
  const [sx, sy, sw, sh] = cropBox(w, h, 1);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw the image.');
  fillBackdrop(ctx, size);
  /* createImageBitmap resizes with a high-quality filter, which is worth having
     when a phone photo is four thousand pixels across and the avatar is two
     hundred and fifty-six. Safari has not always accepted the crop-and-resize
     options, and a slightly softer picture beats one that cannot upload, so the
     direct draw is the fallback rather than the error path. */
  let crop = null;
  try {
    crop = await createImageBitmap(img, {
      resizeWidth: size,
      resizeHeight: size,
      resizeQuality: 'high',
      sourceX: sx,
      sourceY: sy,
      sourceWidth: sw,
      sourceHeight: sh,
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
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
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
    const canvas = await squareFromImage(bitmap, AVATAR_UPLOAD.size);
    let out = encode(canvas);
    /* A photo that still cannot fit the budget is re-cropped half size and
       squeezed harder: the cost is almost always one busy region. */
    if (out.length > AVATAR_UPLOAD.maxDataUrl) {
      const retry = await squareFromImage(bitmap, Math.floor(AVATAR_UPLOAD.size / 2) * 2);
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
