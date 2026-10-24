/** Formatting + small pure helpers shared by every view. */

import { pickTitle, LIST_LABELS } from './store.js';
import { t, intlLocale } from './i18n.js';

/** Titles are never translated — only the literal 'Untitled' placeholder. */
export const title = (media) => {
  const value = pickTitle(media);
  return value === 'Untitled' ? t('Untitled') : value;
};

export function titleAlt(media) {
  const t = media?.title || {};
  const main = title(media);
  const alt = [t.romaji, t.english].find((x) => x && x !== main);
  return alt || '';
}

const FORMAT_LABEL = {
  TV: 'TV',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
  MANGA: 'Manga',
  NOVEL: 'Novel',
  ONE_SHOT: 'One shot',
};
export const formatLabel = (f) => t(FORMAT_LABEL[f] || f || 'TV');

const STATUS_LABEL = {
  FINISHED: 'Aired',
  RELEASING: 'Airing',
  NOT_YET_RELEASED: 'Upcoming',
  CANCELLED: 'Cancelled',
  HIATUS: 'Hiatus',
};
export const statusLabel = (s) => (s ? t(STATUS_LABEL[s] || s) : '');

/** Which list a title is in, as a label. */
export const listLabel = (key) => t(LIST_LABELS[key] || key);

export const STATUS_TONE = {
  RELEASING: 'live',
  NOT_YET_RELEASED: 'accent',
  HIATUS: 'gold',
  CANCELLED: 'danger',
};

export function yearOf(media) {
  return media?.seasonYear || (media?.nextAiringEpisode ? new Date().getFullYear() : null);
}

export function runtime(media) {
  const d = media?.duration;
  if (!d) return '';
  if (d < 60) return t('{m}m', { m: d });
  const h = Math.floor(d / 60);
  const m = d % 60;
  return m ? t('{h}h {m}m', { h, m }) : t('{h}h', { h });
}

export function episodeCount(media) {
  if (media?.format === 'MOVIE') return t('Film');
  const n = media?.episodes;
  if (n) return t('{n} Ep', { n });
  if (media?.status === 'RELEASING') return t('Airing');
  return '';
}

export const SEASON_NAMES = { WINTER: 'Winter', SPRING: 'Spring', SUMMER: 'Summer', FALL: 'Fall' };

/** 'Winter 2026' — the season word carries the locale, the year follows it. */
export const seasonName = (season, year) => (year ? `${t(SEASON_NAMES[season] || season)} ${year}` : t(SEASON_NAMES[season] || season || ''));

export function seasonLabel(media) {
  if (!media?.season) return '';
  return seasonName(media.season, media.seasonYear) || media.season;
}

/** AniList descriptions arrive with <br> and occasional markup. */
export function plainDescription(html, limit = 420) {
  if (!html) return '';
  const text = String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit).replace(/\s+\S*$/, '')}…` : text;
}

export function relativeTime(ms) {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n}m ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n}h ago', { n: Math.floor(s / 3600) });
  if (s < 604800) return t('{n}d ago', { n: Math.floor(s / 86400) });
  return new Date(ms).toLocaleDateString(intlLocale(), { month: 'short', day: 'numeric' });
}

export function countdown(airingAtUnix) {
  const diff = airingAtUnix * 1000 - Date.now();
  if (diff <= 0) return t('now');
  const d = Math.floor(diff / 864e5);
  const h = Math.floor((diff % 864e5) / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  if (d > 1) return t('in {n}d', { n: d });
  if (d === 1) return h > 0 ? t('in {d}d {h}h', { d, h }) : t('in {n}d', { n: 1 });
  if (h > 0) return t('in {n}h', { n: h });
  return t('in {n}m', { n: Math.max(m, 1) });
}

export function dayName(airingAtUnix) {
  const date = new Date(airingAtUnix * 1000);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const delta = Math.round((startOf(date) - startOf(today)) / 864e5);
  if (delta === 0) return t('Today');
  if (delta === 1) return t('Tomorrow');
  if (delta === -1) return t('Yesterday');
  return date.toLocaleDateString(intlLocale(), { weekday: 'long' });
}

/** 'Monday 12 Oct' style heading for the airing schedule. */
export function fullDay(airingAtUnix) {
  return new Date(airingAtUnix * 1000).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Date/time formatters that follow the active language. */
export const intlDate = (when, opts) => new Date(when).toLocaleDateString(intlLocale(), opts);
export const intlTime = (when, opts) => new Date(when).toLocaleTimeString(intlLocale(), opts);

export const scoreTone = (score) =>
  !score ? 'muted' : score >= 75 ? 'gold' : score >= 60 ? '' : 'low';

/** AniList stores scores out of 100; present them out of 10. */
export const scoreLabel = (score) => (score ? (Math.round(score) / 10).toFixed(1) : null);

/** 5000 is where AniList stops counting, so treat it as a floor, not a total. */
export function totalLabel(total, shown) {
  const count = total >= 5000 ? '5,000+' : compactNumber(total) || String(shown);
  return t('{count} titles · showing {shown}', { count, shown });
}

export function compactNumber(n) {
  if (n == null) return '';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

export function debounce(fn, ms = 220) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, ms = 120) {
  let last = 0;
  let timer;
  return (...args) => {
    const now = Date.now();
    const remain = ms - (now - last);
    if (remain <= 0) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn(...args);
      }, remain);
    }
  };
}

/**
 * Stop waiting for a promise that has stopped answering.
 *
 * A skeleton is a promise to paint something, and a request that hangs at the
 * far end never pays it: the page keeps the placeholder, keeps `busy` latched,
 * and the viewer is left on "Loading…" with no route out. Racing a clock turns
 * silence into an ordinary failure, which every caller here already knows how
 * to draw — an error state with a retry, a rail that bows out, a grid that
 * falls back to the snapshot. `timed out` is the message the data layer reads as
 * "use what we saved".
 *
 * The figure has to sit *outside* the request budget in `lib/anilist.js` (six
 * seconds in the queue plus twelve once sent): a placeholder that gives up first
 * throws away a shelf the data layer was about to fill from the saved copy, so
 * the clock here is deliberately the slower of the two.
 */
export function watched(promise, ms = 20000) {
  let timer = 0;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

export const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

export const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

export function currentSeason() {
  const now = new Date();
  const m = now.getMonth();
  const season = m <= 2 ? 'WINTER' : m <= 5 ? 'SPRING' : m <= 8 ? 'SUMMER' : 'FALL';
  return { season, year: now.getFullYear() };
}

export function recentSeasons(count = 8) {
  const { season, year } = currentSeason();
  const order = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  let i = order.indexOf(season);
  let y = year;
  const out = [];
  for (let n = 0; n < count; n++) {
    out.push({ season: order[i], year: y, label: seasonName(order[i], y) });
    i -= 1;
    if (i < 0) {
      i = 3;
      y -= 1;
    }
  }
  return out;
}

export const SORTS = [
  { id: 'POPULARITY_DESC', label: 'Most popular' },
  { id: 'TRENDING_DESC', label: 'Trending' },
  { id: 'SCORE_DESC', label: 'Highest rated' },
  { id: 'FAVOURITES_DESC', label: 'Most favourited' },
  { id: 'EPISODES_DESC', label: 'Longest' },
  { id: 'RELEASE_DATE_DESC', label: 'Newest first' },
  { id: 'START_DATE_DESC', label: 'Recently started' },
  { id: 'TITLE_ROMAJI', label: 'Title (A–Z)' },
];
