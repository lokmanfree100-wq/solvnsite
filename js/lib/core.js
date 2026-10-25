/**
 * The central-cloud sync: the one database behind solvn.site.
 *
 * On the permanent domain the Supabase project is built in (see lib/cloud.js),
 * and this module is what keeps a member's whole game record — the binder, the
 * pack allowance and bank, and the XP ledger — moving between their device and
 * that database. The device copy is always the one the pages read, so cards
 * still open offline; the cloud copy is the one the Super Admin's desk reads,
 * and the one that follows a member onto their next device.
 *
 * Two sides can disagree, so the settle rule is simple: whichever side's stamp
 * is newer wins. Every local write schedules a push a few seconds later, a
 * fresh browser pulls the cloud copy down, and the Settings button settles the
 * two by hand — including the one-time move of a legacy device account's data
 * onto the cloud account the member signs into.
 */

import { storage } from './store.js';
import { cloudActive, cloudApi, homeCloud } from './cloud.js';
import { isSignedIn, currentUser, onAccount, patchMe, pushStats } from './account.js';
import { collectionFor, importCollection, publish, quota } from './cards.js';
import { levelLedger, importLedger } from './level.js';
import { toast } from './ui.js';
import { t } from './i18n.js';

/* The stamp of the cloud row this device last agreed with: { uid, at }. A
   different uid means the identity changed since, and the two sides have not
   settled yet. */
const MARK = 'kitsune:core:mark';

const uidOf = () => (currentUser()?.id != null ? String(currentUser().id) : '');

const mark = () => {
  const raw = storage.read(MARK, null);
  if (!raw || typeof raw !== 'object') return { uid: '', at: 0 };
  return { uid: typeof raw.uid === 'string' ? raw.uid : '', at: Number(raw.at) || 0 };
};

const setMark = (uid, at) => storage.write(MARK, { uid, at: Number(at) || 0 });

/* The bundle this device can send: the live binder of the signed-in member,
   the device's pack record and the XP ledger, stamped with this device's
   clock. The stamp is how the two sides agree which one is newer. */
function localBundle(uid) {
  return {
    collection: collectionFor(uid || uidOf() || 'device'),
    packs: quota(),
    xp: levelLedger(),
    client_at: Date.now(),
  };
}

async function putBundle(uid, bundle) {
  const { core } = await cloudApi('account/core', { method: 'PUT', body: bundle });
  const at = Number(core?.clientAt) || Number(bundle.client_at) || Date.now();
  setMark(uid, at);
  return at;
}

/* ---- the one-time move --------------------------------------------------
   A member who ran the old site still has their account, binder and XP in this
   browser under a *device* id. The moment they sign into the central cloud the
   account id changes, and the legacy keys would otherwise go unread — so the
   Settings button captures them first, and this lands them under the cloud id
   once the sign-in lands. It lives in memory only: a reload cancels the move,
   and nothing was harmed because nothing was touched. */
let pending = null;

export function captureDeviceData() {
  const uid = uidOf() || 'device';
  const user = currentUser();
  pending = {
    uid,
    bundle: localBundle(uid),
    profile: user
      ? {
          displayName: user.displayName,
          bio: user.bio,
          avatar: user.avatar,
          banner: user.banner,
          title: user.title,
        }
      : null,
  };
  return pending;
}

async function landPending(uid) {
  const p = pending;
  pending = null;
  if (p?.profile) {
    /* Each patch is its own best effort: a picture too big for the cloud must
       not take the name and bio down with it — they stay on this device
       whatever the cloud accepts. */
    try {
      await patchMe({ displayName: p.profile.displayName, bio: p.profile.bio, title: p.profile.title });
    } catch { /* the cloud refused one field; the rest still land */ }
    try {
      await patchMe({ avatar: p.profile.avatar, banner: p.profile.banner });
    } catch { /* same */ }
  }
  importCollection(uid, p.bundle.collection);
  try {
    await pushStats(true);
  } catch { /* the watched figures ride again on the next sign-in */ }
  try {
    await publish();
  } catch { /* same */ }
  return putBundle(uid, p.bundle);
}

/* ---- the settle --------------------------------------------------------- */

/** Does the cloud hold anything worth pulling down? */
const coreHasData = (core) =>
  Boolean(
    core &&
      (Number(core.clientAt) > 0 ||
        Object.keys(core.collection?.owned || {}).length ||
        Number(core.xp?.xp) > 0 ||
        Number(core.packs?.bank) > 0),
  );

/**
 * The button's job: make this device and the cloud agree. Cloud newer → the
 * device catches up; local newer → the local record goes up; a captured legacy
 * move → it lands under the account just signed into. Returns the direction so
 * the UI can say which one happened.
 */
export async function syncMyData() {
  if (!cloudActive() || !isSignedIn()) {
    throw Object.assign(new Error(t('Sign in to the central cloud first.')), { code: 'no-cloud-session' });
  }
  const uid = uidOf();
  const mine = mark();
  if (pending && pending.uid !== uid) {
    const at = await landPending(uid);
    return { direction: 'up', at, migrated: true };
  }
  if (pending) pending = null;
  const { core } = await cloudApi('account/core', { method: 'GET' });
  if (coreHasData(core) && (mine.uid !== uid || Number(core.clientAt) > mine.at)) {
    importCollection(uid, core.collection);
    if (core.packs && typeof core.packs === 'object') storage.write('packs', core.packs);
    if (core.xp && typeof core.xp === 'object') importLedger(core.xp);
    setMark(uid, Number(core.clientAt) || 0);
    return { direction: 'down', at: Number(core.clientAt) || 0 };
  }
  const at = await putBundle(uid, localBundle(uid));
  return { direction: 'up', at };
}

/* ---- the quiet background sync ------------------------------------------
   Every account event may mean the session changed or the binder moved; the
   work is debounced so a burst of repaints is still one request. Same-identity
   writes push up silently; a changed identity settles once, and a migration
   that just landed is the one case worth saying out loud. */
let autoTimer = null;

onAccount((st) => {
  if (st.status !== 'signedin' || !cloudActive()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    autoSettle().catch(() => {});
  }, 2500);
});

async function autoSettle() {
  if (!cloudActive() || !isSignedIn()) return;
  const uid = uidOf();
  const mine = mark();
  if (pending && pending.uid !== uid) {
    await landPending(uid);
    toast(t('Your data now lives in the central cloud.'), { tone: 'ok', iconName: 'check' });
    return;
  }
  if (pending) pending = null;
  if (mine.uid !== uid) {
    await syncMyData().catch(() => {});
    return;
  }
  await putBundle(uid, localBundle(uid)).catch(() => {});
}

/* ---- backup and restore ---------------------------------------------------
   The safety net for data that predates the cloud on some *other* address: the
   old copy exports this file, the new address imports it, and the Sync button
   carries it the rest of the way. */

export function backupBundle() {
  return {
    solvn: 1,
    at: Date.now(),
    uid: uidOf() || 'device',
    collection: collectionFor(uidOf() || 'device'),
    packs: quota(),
    xp: levelLedger(),
  };
}

export function restoreBundle(data) {
  if (!data || typeof data !== 'object' || data.solvn !== 1) {
    throw Object.assign(new Error(t('That file is not a Solvn backup.')), { code: 'bad-backup' });
  }
  const uid = uidOf() || (typeof data.uid === 'string' && data.uid ? data.uid : 'device');
  if (data.collection && typeof data.collection === 'object') importCollection(uid, data.collection);
  if (data.packs && typeof data.packs === 'object') storage.write('packs', data.packs);
  if (data.xp && typeof data.xp === 'object') importLedger(data.xp);
  return true;
}

/** What the Settings row paints: where this copy stands with the cloud. */
export function syncState() {
  return {
    builtin: homeCloud(),
    active: Boolean(cloudActive()),
    signedIn: isSignedIn(),
    mark: mark(),
    pending: Boolean(pending),
  };
}
