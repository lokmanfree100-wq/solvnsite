/**
 * The mailbox: what the Card Studio sent, waiting to be opened.
 *
 * A gift is a record the backend keeps; it carries a card or a bundle, and the
 * binder is this device's. So claiming is the hand-over: the envelope is marked
 * open on the backend, the card joins the local collection (or the packs land
 * in the bank and the XP on the ladder), and the row keeps the stamp. The same
 * envelope claimed twice is the same plate once — the gift's id is the card's
 * whole identity in the binder.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { sfx } from '../lib/sounds.js';
import { intlDate } from '../lib/util.js';
import { isSignedIn, mailbox, claimGift } from '../lib/account.js';
import { importGiftCard, bankPacks } from '../lib/cards.js';
import { awardXp } from '../lib/level.js';
import { gachaCard } from '../components/gacha.js';
import { authSheet, say } from '../components/account.js';
import { emptyState, errorState } from '../components/media.js';

const KIND_LABEL = { card: 'Studio card', bundle: 'Packs & XP', both: 'Studio card + bonus' };

/* The bundle's tile: a wrapped box that says what is inside without opening. */
function bundleTile(bundle, onClick) {
  const tile = h(
    'div.mb-bundle',
    { 'aria-hidden': 'true' },
    icon('gift', { cls: 'mb-bundle-ico' }),
    bundle.packs ? h('span.mb-bundle-line', {}, h('b.tnum', {}, String(bundle.packs)), h('span', {}, t('packs'))) : null,
    bundle.xp ? h('span.mb-bundle-line', {}, h('b.tnum', {}, String(bundle.xp)), h('span', {}, t('XP'))) : null,
  );
  if (onClick) {
    tile.setAttribute('role', 'button');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-label', t('Preview this gift'));
    tile.addEventListener('click', onClick);
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    });
  }
  return tile;
}

/* One envelope. A claimed one is a receipt; an unclaimed one carries the button
   that hands its contents over. */
function giftRow(gift, onDone) {
  const fresh = !gift.claimedAt;
  const row = h(`div.mb-row.glass${fresh ? '.is-new' : ''}`);
  const from = gift.from ? gift.from.displayName || gift.from.username : t('Solvn');

  const kind = h(
    'span.mb-kind',
    {},
    icon(gift.kind === 'bundle' ? 'gift' : 'sparkles'),
    h('span', {}, t(KIND_LABEL[gift.kind] || KIND_LABEL.card)),
  );

  const note = gift.note
    ? h('p.mb-note', {}, gift.note)
    : null;

  const meta = h(
    'p.mb-meta.faint',
    {},
    t('From {name}', { name: from }),
    ' · ',
    intlDate(gift.at, { year: 'numeric', month: 'short', day: 'numeric' }),
  );

  const tile = gift.card
    ? gachaCard({ ...gift.card, serial: 'STUDIO', custom: true }, { variant: 'tile', eager: false, onClick: () => openGift(gift) })
    : bundleTile(gift.bundle, () => openGift(gift));

  const claim = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: async () => {
        claim.disabled = true;
        const wasNew = !gift.claimedAt;
        try {
          const res = await claimGift(gift.id);
          if (wasNew && res.gift.claimedAt) {
            if (res.gift.card) importGiftCard(res.gift.id, res.gift.card);
            if (res.gift.bundle) {
              if (res.gift.bundle.packs) bankPacks(res.gift.bundle.packs);
              if (res.gift.bundle.xp) awardXp(res.gift.bundle.xp, 'gift');
            }
            /* The card arriving is its own little reveal; a bundle that levels
               plays its own cue, and a flat bundle is quiet — one sound per
               move, never two. */
            if (res.gift.card) sfx.reveal(0);
          }
          const bundle = res.gift.bundle;
          toast(
            res.gift.card
              ? t('{name} is in your binder.', { name: res.gift.card.name })
              : t('{packs} packs and {xp} XP claimed.', { packs: bundle?.packs || 0, xp: bundle?.xp || 0 }),
            { tone: 'ok', iconName: 'check' },
          );
          onDone?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
          claim.disabled = false;
        }
      },
    },
    icon('gift'),
    h('span', {}, t('Claim')),
  );

  const stamp = h(
    'span.mb-stamp',
    {},
    icon('check'),
    h('span', {}, t('Claimed')),
  );

  row.append(
    tile,
    h(
      'div.mb-body',
      {},
      kind,
      note,
      meta,
    ),
    h('div.mb-acts', {}, fresh ? claim : stamp),
  );
  return row;
}

/* A studio card opened full-size: the same plate the binder will hold, shown
   before the claim so what is claimed is seen first. */
function openGift(gift) {
  sheet({
    heading: gift.card?.name || t('Gift'),
    sub: gift.card?.mediaTitle || t('From the Solvn Card Studio'),
    width: 420,
    render: (api) =>
      h(
        'div.mb-sheet',
        {},
        gift.card ? gachaCard({ ...gift.card, serial: 'STUDIO', custom: true }, { variant: 'full', eager: true }) : bundleTile(gift.bundle),
        gift.note ? h('p.mb-note', {}, gift.note) : null,
        h('div.auth-foot', {}, h('button.btn.btn--ghost', { type: 'button', onclick: () => api.close() }, t('Close'))),
      ),
  });
}

export async function MailboxView({ onCleanup } = {}) {
  const wrap = h('div.page-mailbox');

  if (!isSignedIn()) {
    wrap.append(
      emptyState({
        iconName: 'gift',
        heading: t('Sign in to open your mailbox'),
        body: t('Gifts are addressed to an account, so the box opens once you are signed in.'),
        action: h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet() }, t('Sign in')),
      }),
    );
    return wrap;
  }

  const head = h(
    'header.page-head',
    {},
    h('div.eyebrow', {}, t('MAILBOX')),
    h('h1.display', {}, t('Gifts')),
    h('p', {}, t('Cards and bonuses sent from the Solvn Card Studio. Claim one and it joins your binder.')),
  );

  const list = h('div.mb-list');
  const unread = h('span.mb-count', { hidden: true });

  async function fill() {
    list.replaceChildren(h('p.muted', {}, t('Loading…')));
    try {
      const box = await mailbox();
      unread.hidden = !box.unread;
      unread.textContent = t('{n} new', { n: box.unread });
      list.replaceChildren(
        ...(box.gifts.length
          ? box.gifts.map((g) => giftRow(g, fill))
          : [
              emptyState({
                iconName: 'gift',
                heading: t('Nothing here yet'),
                body: t('When the studio sends a card or a bundle, it lands in this box.'),
              }),
            ]),
      );
    } catch {
      list.replaceChildren(
        errorState(t('your mailbox'), () => fill(), {
          heading: 'The mailbox will not open',
          body: 'The server that keeps gifts is not answering.',
        }),
      );
    }
  }

  wrap.append(head, unread, list);
  await fill();
  onCleanup?.(() => {});
  return wrap;
}
