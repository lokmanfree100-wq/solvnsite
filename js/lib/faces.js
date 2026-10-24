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

/* ---- the face ladder -------------------------------------------------
   Every portrait starts shut. A member opens three at a time by finishing a
   plain task — an episode, a favourite, a pack, a duel — so the shelf is
   earned rather than handed over on the first visit. The figures a task reads
   are the ones the account already publishes, which means the lock is the
   same on every device and a visitor could work it out from the profile.
   A face won on the wheel is open on its own, and the portrait already worn
   stays open for good: locking a member out of their own picture would be a
   bug dressed as a rule. */
export const FACES_PER_QUEST = 3;

const stat = (user) => (user && user.stats) || {};
const binder = (user) => (user && user.cards) || {};
const duel = (user) => (user && user.duel) || {};

export const FACE_QUESTS = [
  {
    id: 'first-episode',
    label: 'Watch an episode',
    icon: 'play',
    need: 1,
    have: (u) => Number(stat(u).episodes) || 0,
  },
  {
    id: 'five-episodes',
    label: 'Watch {n} episodes',
    icon: 'film',
    need: 3,
    have: (u) => Number(stat(u).episodes) || 0,
  },
  {
    id: 'ten-episodes',
    label: 'Watch {n} episodes',
    icon: 'clock',
    need: 10,
    have: (u) => Number(stat(u).episodes) || 0,
  },
  {
    id: 'ten-hours',
    label: 'Watch {n} hours',
    icon: 'moon',
    need: 10,
    have: (u) => Number(stat(u).hours) || 0,
  },
  {
    id: 'favourites',
    label: 'Favourite {n} titles',
    icon: 'heart',
    need: 3,
    have: (u) => Number(stat(u).favourites) || 0,
  },
  {
    id: 'finisher',
    label: 'Finish {n} series',
    icon: 'check',
    need: 2,
    have: (u) => Number(stat(u).completed) || 0,
  },
  {
    id: 'binder',
    label: 'Own {n} different cards',
    icon: 'grid',
    need: 5,
    have: (u) => Number(binder(u).unique) || 0,
  },
  {
    id: 'first-duel',
    label: 'Fight a duel',
    icon: 'bolt',
    need: 1,
    have: (u) => Number(duel(u).fought) || Number(duel(u).wins) + Number(duel(u).losses) || 0,
  },
  {
    id: 'first-win',
    label: 'Win a duel',
    icon: 'trophy',
    need: 1,
    have: (u) => Number(duel(u).wins) || 0,
  },
  {
    id: 'level-five',
    label: 'Reach level {n}',
    icon: 'sparkles',
    need: 5,
    have: (u) => Number(stat(u).level) || 1,
  },
  {
    id: 'chaser',
    label: 'Pull a card worth {n} Power',
    icon: 'star',
    need: 500,
    have: (u) => Number(binder(u).best) || 0,
  },
  {
    id: 'duelist',
    label: 'Win {n} duels',
    icon: 'crown',
    need: 5,
    have: (u) => Number(duel(u).wins) || 0,
  },
];

/** How many quests this record has finished. */
export const faceQuestsDone = (user) =>
  FACE_QUESTS.filter((quest) => Number(quest.have(user)) >= quest.need).length;

/** The faces a member has earned: three for every finished task. */
export const faceSlots = (user) => faceQuestsDone(user) * FACES_PER_QUEST;

/** Faces the wheel handed over, kept by character id. */
const wonFaces = (user) =>
  new Set(
    (Array.isArray(user?.unlocks?.avatars) ? user.unlocks.avatars : [])
      .map((id) => Number(id))
      .filter((id) => id > 0),
  );

/** Every task with its progress, ready for the gallery's ladder. */
export function faceQuestRows(user) {
  return FACE_QUESTS.map((quest) => {
    const have = Math.max(0, Number(quest.have(user)) || 0);
    const need = Number(quest.need) || 1;
    return {
      id: quest.id,
      label: quest.label,
      icon: quest.icon,
      need,
      have: Math.min(have, need),
      done: have >= need,
      faces: FACES_PER_QUEST,
    };
  });
}

/** A stable order for the shelf, so the same three faces open for everybody. */
const faceRank = (face) => {
  let x = 2166136261;
  const text = `solvn-face|${face?.id}`;
  for (let i = 0; i < text.length; i += 1) {
    x ^= text.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
};

const byRank = (a, b) => faceRank(a) - faceRank(b) || String(a.id).localeCompare(String(b.id));

/**
 * The shelf as one member sees it: which portraits are open, where each one
 * sits in the ladder and which task opens the next band. `all` is the tester's
 * key — the one account that can browse the whole shelf without grinding.
 */
export function faceAccess(user, list = [], { all = false } = {}) {
  const ranked = [...list].sort(byRank);
  const slots = faceSlots(user);
  const openIds = new Set();
  if (all) ranked.forEach((face) => openIds.add(Number(face.id)));
  else ranked.slice(0, slots).forEach((face) => openIds.add(Number(face.id)));
  for (const id of wonFaces(user)) openIds.add(id);
  /* Wearing is ownership: the portrait a member already chose stays open. */
  const worn = String(user?.avatar?.face || '');
  for (const face of ranked) if (worn && face.image === worn) openIds.add(Number(face.id));

  const rank = new Map(ranked.map((face, index) => [Number(face.id), index]));
  const openCount = ranked.filter((face) => openIds.has(Number(face.id))).length;
  return { ranked, rank, slots, openIds, openCount, total: ranked.length };
}

/** The task that opens the band a face at `index` sits in, or null past the ladder. */
export const faceQuestAt = (index) => {
  const quest = FACE_QUESTS[Math.floor(Math.max(0, Number(index) || 0) / FACES_PER_QUEST)];
  return quest || null;
};
