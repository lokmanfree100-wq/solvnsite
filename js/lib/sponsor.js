/**
 * The sponsor slot — one banner, sold by hand, shipped in a file.
 *
 * This site has no central settings store. `settings.set()` writes to the browser
 * it was pressed in, so an advert "saved" from the admin desk would never reach a
 * single visitor — it would be a private page. What every visitor already
 * downloads, with no server and no key, is `data/*.json`: that is how the film
 * shelves fill on GitHub Pages, so the advert travels the same road.
 * `data/sponsor.json` is the published truth; the admin desk composes it, checks
 * it and previews it locally until it is pushed.
 *
 * The point of the file being empty by default is the point of the whole design:
 * nothing here talks to an ad network, nothing rotates, nothing is fetched from a
 * third-party ad call, and no advert can appear on the page that whoever runs
 * Solvn did not write into that file.
 */

import { settings } from './store.js';

const SPONSOR_URL = new URL('data/sponsor.json', document.baseURI).href;

let loading = null;
let published = null;

/* ---- validation --------------------------------------------------------
   One https address, one image, one window of days. Anything looser is a
   field a paste can turn into a redirect, so the shape is checked before the
   value is allowed anywhere near the page. */

const text = (v, max = 120) => String(v == null ? '' : v).trim().slice(0, max);
const site = (v) => (/^https:\/\/\S+$/i.test(String(v || '').trim()) ? String(v).trim() : '');
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
const count = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** Normalise any object — a file, a draft, a hand-edit — into the one shape the
    rest of the site reads. Fields that fail the check come back empty, and an
    empty slot is what renders nothing. */
export function compose(input) {
  const src = input && typeof input === 'object' ? input : {};
  const s = src.slot && typeof src.slot === 'object' ? src.slot : {};
  const p = src.pitch && typeof src.pitch === 'object' ? src.pitch : {};
  const from = day(s.from);
  const until = day(s.until);
  return {
    updated: day(src.updated) || (from || until ? today() : ''),
    slot: {
      advertiser: text(s.advertiser),
      image: site(s.image),
      url: site(s.url),
      alt: text(s.alt),
      from,
      until,
    },
    pitch: {
      visitorsPerDay: count(p.visitorsPerDay),
      pagesPerVisit: count(p.pagesPerVisit),
      topCountries: Array.isArray(p.topCountries)
        ? p.topCountries.map((c) => text(c, 40)).filter(Boolean).slice(0, 6)
        : [],
      ratePerMonth: text(p.ratePerMonth, 24),
      currency: /^[A-Z]{3}$/.test(String(p.currency || '').toUpperCase().trim())
        ? String(p.currency).toUpperCase().trim()
        : 'USD',
      contactEmail: /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(p.contactEmail || '').trim())
        ? String(p.contactEmail).trim()
        : '',
    },
  };
}

/** Fetch the published file once and keep it; a visitor pressing through five
    pages should not download the same few hundred bytes five times. */
export function loadSponsor() {
  if (!loading) {
    loading = fetch(SPONSOR_URL, { cache: 'default' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        published = compose(j);
        return published;
      })
      .catch(() => {
        published = null;
        return null;
      });
  }
  return loading;
}

/* ---- the owner's draft ---------------------------------------------------
   Composed in the admin desk, kept in this browser, shown to this browser only.
   It exists so the person selling the slot can see the banner in the page before
   they publish it — and it is always labelled a preview when it appears. */

const EMPTY = compose({});
export const draft = () => compose(settings.get('sponsorDraft') || {});
export const setDraft = (obj) => settings.set('sponsorDraft', compose(obj));
export const clearDraft = () => settings.set('sponsorDraft', null);
/** Preview is a switch, not a side effect: a draft that nobody asked to look at
    must never dress up as a live advert. */
export const previewOn = () => settings.get('sponsorPreview') === true && !!settings.get('sponsorDraft');
export const setPreview = (on) => settings.set('sponsorPreview', on === true);

/* ---- what goes on the page ---------------------------------------------- */

/** True while a dated window covers today. An advert whose `until` has passed
    stops by itself; nobody has to remember to take it down. */
export function withinWindow(slot, at = today()) {
  if (slot.from && at < slot.from) return false;
  if (slot.until && at > slot.until) return false;
  return true;
}

/** The banner to draw, or null for nothing at all. Both an address and a
    picture are required: an image that goes nowhere and a link with no picture
    are each half an advert, and neither is put on a page. */
export function currentSlot() {
  const source = previewOn() ? draft() : published || EMPTY;
  const slot = source.slot;
  if (!slot.image || !slot.url) return null;
  if (!withinWindow(slot)) return null;
  return { ...slot, preview: previewOn(), alt: slot.alt || slot.advertiser };
}

/** The figures the pitch page quotes. They come from the same file, because an
    advertise page that measures its own audience differently from the advert is
    making two claims about one number. */
export function currentPitch() {
  return (previewOn() ? draft() : published || EMPTY).pitch;
}

/** What the published file says right now, for the desk to show beside the
    draft — the difference between those two is the work still to do. */
export const publishedSlot = () => published;

/** The exact text to paste over data/sponsor.json on GitHub. */
export const publishText = (obj) => `${JSON.stringify(compose(obj), null, 2)}\n`;

/** The one judgement the desk makes for the owner: is this draft publishable?
    Codes, not sentences — the view owns the wording, so the sentences are the
    ones the language files can see and translate. */
export function draftProblems(obj) {
  const d = compose(obj);
  const raw = obj && typeof obj === 'object' ? obj : {};
  const rawSlot = raw.slot || {};
  const filled = Object.values(rawSlot).some((v) => String(v == null ? '' : v).trim());
  if (!filled) return ['empty'];
  const out = [];
  if (String(rawSlot.image || '').trim() && !d.slot.image) out.push('image-https');
  if (String(rawSlot.url || '').trim() && !d.slot.url) out.push('url-https');
  if (!d.slot.image) out.push('no-image');
  if (!d.slot.url) out.push('no-url');
  if (d.slot.from && d.slot.until && d.slot.from > d.slot.until) out.push('window');
  if (!d.slot.advertiser) out.push('no-advertiser');
  return out;
}

export { EMPTY as emptySponsor };
