/**
 * UI-only localization: English, French, Arabic (RTL).
 *
 * Keys are the English source strings, so a phrase that never made it into a
 * table still renders as readable English instead of a blank hole. Anime
 * titles are never passed through here — they stay in romaji/english so they
 * remain searchable.
 */

import { settings } from './store.js';
import fr, { genres as FR_GENRES } from '../locales/fr.js';
import ar, { genres as AR_GENRES } from '../locales/ar.js';

export const LANGS = {
  en: { name: 'English', code: 'EN', dir: 'ltr' },
  fr: { name: 'Français', code: 'FR', dir: 'ltr' },
  ar: { name: 'العربية', code: 'AR', dir: 'rtl' },
};

const DEFAULT_LANG = 'en';
const TABLES = { fr, ar };
const GENRE_TABLES = { fr: FR_GENRES, ar: AR_GENRES };

export function lang() {
  const id = settings.get('lang');
  return LANGS[id] ? id : DEFAULT_LANG;
}

export const dir = () => LANGS[lang()].dir;
export const isRtl = () => dir() === 'rtl';

/** Arabic month/day names, but Western figures — scores and episode numbers stay latin. */
export const intlLocale = () => (lang() === 'ar' ? 'ar-u-nu-latn' : lang());

export function t(key, vars) {
  if (typeof key !== 'string' || !key) return '';
  const out = (TABLES[lang()] || {})[key] || key;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])));
}

export function genre(name) {
  if (!name) return '';
  return (GENRE_TABLES[lang()] || {})[name] || name;
}

/** Reflect the active language on the document before anything renders. */
export function applyLang() {
  const id = lang();
  const root = document.documentElement;
  root.lang = id;
  root.dir = LANGS[id].dir;
  root.dataset.lang = id;
}

export function setLang(id) {
  if (!LANGS[id] || id === lang()) return false;
  settings.set('lang', id);
  applyLang();
  document.dispatchEvent(new CustomEvent('kitsune:lang', { detail: { lang: id, dir: LANGS[id].dir } }));
  return true;
}

applyLang();
