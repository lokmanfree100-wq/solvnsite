/**
 * The official face library.
 *
 * These are the same AniList character portraits the card binder pulls its art
 * from, in a bigger slice: a gallery is only worth browsing if it holds enough
 * faces to argue over, so it asks for six pages and keeps whatever answers. A
 * page that comes back empty is dropped rather than allowed to sink the others,
 * and when nothing answers at all the bundled snapshot in `data/packs.json`
 * fills the shelf — the same offline rule the rest of the app keeps, so a
 * plain static host still has faces to offer.
 *
 * A face is only ever an address. Choosing one writes `avatar.face`, a https URL
 * the server checks and never fetches, so the account record stays a few hundred
 * bytes however many portraits get tried on.
 */

import { roster } from './anilist.js';

const SEED_URL = new URL('data/packs.json', document.baseURI).href;
const PAGES = 6;
const PER_PAGE = 50;

let cache = null;
let loading = null;

/** A tile needs a portrait and something to print under it. */
const usable = (f) => Boolean(f && f.image && /^https:\/\//i.test(f.image) && f.name);

async function bundled() {
  const res = await fetch(SEED_URL).catch(() => null);
  const doc = res && res.ok ? await res.json().catch(() => null) : null;
  return Array.isArray(doc?.characters) ? doc.characters : [];
}

export function faces() {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = (async () => {
      const settled = await Promise.allSettled(
        Array.from({ length: PAGES }, (_, i) => roster(i + 1, PER_PAGE)),
      );
      const seen = new Set();
      const found = [];
      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const f of r.value) {
          if (!usable(f) || seen.has(f.id)) continue;
          seen.add(f.id);
          found.push(f);
        }
      }
      if (!found.length) found.push(...(await bundled()).filter(usable));
      cache = found;
      return found;
    })().catch(() => {
      cache = cache || [];
      return cache;
    });
  }
  return loading;
}

/** Case- and width-insensitive enough for a name typed in any locale. */
const fold = (s) => String(s || '').toLowerCase().trim();

/** Filter the library by name or by the anime a face comes from. */
export function matchFaces(list, term) {
  const q = fold(term);
  if (!q) return list;
  return list.filter(
    (f) =>
      fold(f.name).includes(q) ||
      fold(f.native).includes(q) ||
      (f.media || []).some((m) => fold(m.title).includes(q)),
  );
}
