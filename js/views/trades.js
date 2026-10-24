/**
 * Trades: two binders, one deal, two signatures.
 *
 * This page never moves a card. It writes a *proposal* — these copies for those
 * copies — and the deal completes only when both people in it have signed what
 * is written. That is the whole reason a trade here can be trusted: the offer is
 * visible to exactly two accounts, an edit wipes both approvals, and either end
 * can call it off while it stands.
 *
 * What a signature costs is on screen. Signing takes my side out of the binder
 * and holds it aside, so it cannot be fused away or offered twice while the deal
 * is open, and the copies come back the moment it is called off, lapses, or is
 * changed underneath me. A completion hands mine over and brings theirs in.
 *
 * One card is never on the table: the Lv 25 Solvn master. It is awarded to a
 * binder that holds the set, and a one-of-one that changes hands is not one, so
 * both pickers leave it out and the server refuses it.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { debounce, relativeTime } from '../lib/util.js';
import { currentUser, isSignedIn, searchMembers, shownName } from '../lib/account.js';
import { TOP_LV, displayCard, escrowedList, holdsSide, ownedEntries, tradeCard } from '../lib/cards.js';
import {
  callOff,
  changeSide,
  mySide,
  refreshTrades,
  sendOffer,
  signDeal,
  subscribeTrades,
  theirSide,
  tradeUsable,
  tradesState,
} from '../lib/trades.js';
import { gachaCard } from '../components/gacha.js';
import { avatar, authSheet, say, titleChip } from '../components/account.js';
import { emptyState } from '../components/media.js';

/* The two ceilings `account-api.js` keeps as well. A form that lets you add a
   fifth card, or type a longer note than the server stores, fails on submit. */
const SIDE_MAX = 4;
const NOTE_MAX = 140;
/** The most tiles a picker paints at once. A full binder runs into the hundreds,
    and a sheet is not a shelf: the name box above it is how you reach the rest. */
const PICK_ROWS = 80;

const STATE_LABEL = { done: 'Traded', cancelled: 'Called off', expired: 'Lapsed' };

/** `4d left` — a deal stands for a week, and the row says how much of that week
    is still there instead of a timestamp to work out by hand. */
function leftText(ms) {
  const hours = Math.floor(ms / 3600000);
  if (hours >= 24) return t('{n}d left', { n: Math.floor(hours / 24) });
  if (hours >= 1) return t('{n}h left', { n: hours });
  return t('{n}m left', { n: Math.max(1, Math.floor(ms / 60000)) });
}

/** A deal side is drawn the way the binder draws a tile: frame, tier, name. */
const dealTile = (card) => gachaCard(displayCard(card), { variant: 'tile', eager: false });

/** The same tile with a tick on it, which is the only state a picker needs. */
function pickTile({ card, count = 1, on, label, onToggle }) {
  return h(
    `button.tr-pick${on ? '.is-on' : ''}`,
    {
      type: 'button',
      'aria-pressed': String(on),
      'aria-label': on ? t('Take {name} out of this trade', { name: label }) : t('Put {name} into this trade', { name: label }),
      onclick: onToggle,
    },
    gachaCard(card, { variant: 'tile', count, eager: false }),
    h('span.tr-pick-mark', { 'aria-hidden': 'true' }, icon(on ? 'check' : 'plus')),
  );
}

/* ---- one deal --------------------------------------------------------- */
function dealRow(deal, handlers) {
  const other = (deal.mine === 'give' ? deal.to : deal.from) || deal.from;
  const closed = deal.state !== 'awaiting';
  const mySignedAt = deal.iSigned ? (deal.mine === 'give' ? deal.signed.from : deal.signed.to) : null;
  const theirSignedAt = (deal.mine === 'give' ? deal.signed.to : deal.signed.from) || null;
  const otherName = shownName(other) || t('A member');

  const signMark = (label, at) =>
    h(
      `span.tr-sign${at ? '.is-on' : ''}`,
      {},
      icon(at ? 'check' : 'clock'),
      h('span', {}, at ? t('{name} signed', { name: label }) : t('Waiting for {name}', { name: label })),
    );

  const side = (label, cards) =>
    h(
      'div.tr-side',
      {},
      h('h4.tr-side-label', {}, label),
      h(
        'div.tr-side-cards',
        {},
        ...(cards.length ? cards.map(dealTile) : [h('p.faint', {}, t('Nothing on this side.'))]),
      ),
    );

  return h(
    `article.tr-card.is-${deal.state}${deal.iSigned ? '.is-signed' : ''}`,
    {},
    h(
      'header.tr-top',
      {},
      h(
        'a.tr-who',
        { href: `#/profile/${encodeURIComponent(other.id || '')}` },
        avatar(other, { size: 'sm' }),
        h(
          'span.tr-who-names',
          {},
          h('span.tr-who-top', {}, h('b', {}, otherName), titleChip(other)),
          h('span.faint', {}, other.username ? `@${other.username}` : t('This member is gone')),
        ),
      ),
      h(
        'span.tr-when',
        {},
        h(
          `span.tr-state.is-${deal.state}`,
          {},
          icon(closed ? (deal.state === 'done' ? 'check' : 'x') : 'swap'),
          h('span', {}, closed ? t(STATE_LABEL[deal.state]) : t('Open')),
          closed ? null : h('span.tnum', {}, `· ${leftText(deal.expiresIn)}`),
        ),
        h('span.faint.tnum', {}, relativeTime(deal.at)),
      ),
    ),
    deal.note ? h('p.tr-note', {}, deal.note) : null,
    h(
      'div.tr-body',
      {},
      side(t('You give'), mySide(deal)),
      h('span.tr-swap', { 'aria-hidden': 'true' }, icon('swap')),
      side(t('You get'), theirSide(deal)),
    ),
    /* The escrow is the part a member would otherwise never see: cards that are
       still theirs, but that this deal has already lifted out of the binder. So
       it appears on exactly the deals that are holding something — open, and
       signed by me. */
    !closed && deal.iSigned
      ? h('p.tr-escrow', {}, icon('lock'), h('span', {}, t('Held aside until this deal closes.')))
      : null,
    h('div.tr-foot', {}, signMark(t('You'), mySignedAt), signMark(otherName, theirSignedAt)),
    closed
      ? null
      : h(
          'div.tr-actions',
          {},
          deal.iSigned
            ? null
            : h(
                'button.btn.btn--primary.btn--sm',
                { type: 'button', onclick: () => handlers.sign(deal) },
                icon('check'),
                h('span', {}, t('Sign trade')),
              ),
          h(
            'button.btn.btn--sm',
            { type: 'button', onclick: () => handlers.edit(deal) },
            icon('edit'),
            h('span', {}, t('Change my cards')),
          ),
          h(
            'button.btn.btn--sm.btn--ghost',
            { type: 'button', onclick: () => handlers.cancel(deal) },
            icon('x'),
            h('span', {}, t('Call it off')),
          ),
        ),
  );
}

/* ---- write an offer ----------------------------------------------------
   One sheet for both directions. A new offer picks a member, a side each and a
   line of intent; an edit replaces only the caller's own side, because the other
   half of a deal belongs to the person standing on it — and takes back both
   signatures, which is what makes the second one worth having.
   ------------------------------------------------------------------------ */
function offerSheet({ trade = null, onDone }) {
  const entries = ownedEntries().filter((e) => Number(e.lv) <= TOP_LV);
  const mineSide = trade ? trade.mine : 'give';
  /* Kept apart by whose cards they are: mine are binder records that still have
     to be reduced to a description, theirs already are one. */
  const mine = [];
  const theirs = [];
  let partner = trade ? (mineSide === 'give' ? trade.to : trade.from) : null;
  let busy = false;
  let handle = null;

  if (trade) {
    for (const card of mySide(trade)) {
      const entry = entries.find((e) => e.key === card.key);
      if (entry) mine.push(entry);
    }
  }

  const askRow = h('div.tr-ask');
  const findField = h('input.input.tr-find', {
    type: 'search',
    placeholder: t('Find a card in your binder…'),
    'aria-label': t('Find a card'),
    autocomplete: 'off',
    oninput: () => paintMine(findField.value),
  });
  const mineGrid = h('div.tr-picks');
  const theirsGrid = h('div.tr-picks');
  const note = h('textarea.input.tr-note-field', {
    rows: 2,
    maxlength: NOTE_MAX,
    placeholder: t('Say why, if you want to…'),
    'aria-label': t('Note'),
  });
  const submitLabel = h('span', {}, trade ? t('Save my side') : t('Send offer'));
  const submit = h('button.btn.btn--primary', { type: 'button' }, icon('swap'), submitLabel);
  const cols = h('div.tr-cols');

  /** What the other member has put on their profile to be asked for. */
  const shownCards = () => {
    if (!partner) return [];
    const pub = partner.cards || {};
    const rows = [...(pub.pinned || []), pub.top].filter((c) => c && c.key && Number(c.lv) <= TOP_LV);
    return rows.filter((c, i, all) => all.findIndex((x) => x.key === c.key) === i);
  };

  const has = (list, card) => list.some((c) => c.key === card.key);

  function toggle(list, card) {
    const at = list.findIndex((c) => c.key === card.key);
    if (at >= 0) list.splice(at, 1);
    else if (list.length >= SIDE_MAX) {
      toast(t('A side holds up to {n} cards.', { n: SIDE_MAX }), { tone: 'err', iconName: 'alert' });
      return;
    } else list.push(card);
    paint();
  }

  function paintMine(term = '') {
    const q = term.trim().toLowerCase();
    const rows = (q ? entries.filter((e) => `${e.name} ${e.mediaTitle}`.toLowerCase().includes(q)) : entries).slice(0, PICK_ROWS);
    const cut = rows.length === PICK_ROWS && (q ? entries.filter((e) => `${e.name} ${e.mediaTitle}`.toLowerCase().includes(q)) : entries).length > PICK_ROWS;
    mineGrid.replaceChildren(
      ...(rows.length
        ? [
            ...rows.map((e) => pickTile({ card: e, count: e.count, on: has(mine, e), label: e.name, onToggle: () => toggle(mine, e) })),
            cut ? h('p.faint.tr-pick-note', {}, t('Showing the strongest {n} — keep typing to narrow it down.', { n: PICK_ROWS })) : null,
          ].filter(Boolean)
        : [h('p.faint.tr-pick-empty', {}, entries.length ? t('Nothing in your binder by that name.') : t('Your binder is empty. Open a pack first.'))]),
    );
  }

  function paintTheirs() {
    if (trade) {
      /* Their half of an existing deal is theirs to write; it is shown so the
         edit is made with the whole trade in view, never as a pickable list. */
      theirsGrid.replaceChildren(
        ...(theirSide(trade).length
          ? theirSide(trade).map(dealTile)
          : [h('p.faint.tr-pick-empty', {}, t('Nothing on their side yet.'))]),
      );
      return;
    }
    const rows = shownCards();
    theirsGrid.replaceChildren(
      ...(partner
        ? rows.length
          ? rows.map((c) => pickTile({ card: displayCard(c), on: has(theirs, c), label: c.name, onToggle: () => toggle(theirs, c) }))
          : [h('p.faint.tr-pick-empty', {}, t('They have not shown any cards on their profile yet.'))]
        : [h('p.faint.tr-pick-empty', {}, t('Pick a member to see what they have shown.'))]),
    );
  }

  function paintAsk() {
    if (trade) {
      askRow.replaceChildren(
        h('p.tr-ask-note', {}, icon('lock'), h('span', {}, t('Changing your side takes back both signatures.'))),
      );
      return;
    }
    if (partner) {
      askRow.replaceChildren(
        h(
          'div.tr-ask-on',
          {},
          avatar(partner, { size: 'sm' }),
          h(
            'span.tr-who-names',
            {},
            h('b', {}, shownName(partner)),
            h('span.faint', {}, partner.username ? `@${partner.username}` : t('This member is gone')),
          ),
          h(
            'button.btn.btn--sm',
            {
              type: 'button',
              onclick: () => {
                partner = null;
                theirs.length = 0;
                paintAsk();
                paintTheirs();
                paint();
              },
            },
            icon('x'),
            h('span', {}, t('Change')),
          ),
        ),
      );
      return;
    }
    const field = h('input.input', {
      type: 'search',
      placeholder: t('Find a member by name…'),
      'aria-label': t('Find a member'),
      autocomplete: 'off',
    });
    const found = h('div.tr-found', { 'aria-live': 'polite' }, h('p.faint', {}, t('Type a name to find somebody.')));
    let term = 0;
    const search = debounce(async () => {
      const q = field.value.trim();
      if (q.length < 2) {
        found.replaceChildren(h('p.faint', {}, t('Type a name to find somebody.')));
        return;
      }
      const at = ++term;
      found.replaceChildren(h('p.faint', {}, t('Searching…')));
      try {
        const data = await searchMembers(q);
        if (at !== term) return;
        const people = (data.users || []).filter((u) => u.id && u.id !== currentUser()?.id);
        found.replaceChildren(
          ...(people.length
            ? people.map((u) =>
                h(
                  'button.tr-found-row',
                  {
                    type: 'button',
                    onclick: () => {
                      partner = u;
                      theirs.length = 0;
                      paintAsk();
                      paintTheirs();
                      paint();
                    },
                  },
                  avatar(u, { size: 'sm' }),
                  h(
                    'span.tr-who-names',
                    {},
                    h('b', {}, shownName(u)),
                    h('span.faint', {}, `@${u.username}`),
                  ),
                  titleChip(u),
                  h(
                    'span.faint',
                    {},
                    (u.cards?.pinned || []).length ? t('{n} shown', { n: u.cards.pinned.length }) : t('No cards shown'),
                  ),
                ),
              )
            : [h('p.faint', {}, t('Nobody by that name yet.'))]),
        );
      } catch {
        if (at !== term) return;
        found.replaceChildren(h('p.faint', {}, t('The member list is not answering right now.')));
      }
    }, 220);
    field.addEventListener('input', search);
    askRow.replaceChildren(h('div.stack', {}, field, found));
    requestAnimationFrame(() => field.focus());
  }

  function paint() {
    submit.disabled = !mine.length || busy || !partner || (!trade && !theirs.length);
    const myCol = h(
      'section.tr-col',
      {},
      h('h3.tr-col-head', {}, h('span', {}, t('You give')), h('span.tr-tally.tnum', {}, `${mine.length}/${SIDE_MAX}`)),
      h('div.stack.tr-col-picks', {}, findField, mineGrid),
    );
    const theirCol = h(
      'section.tr-col',
      {},
      h(
        'h3.tr-col-head',
        {},
        h('span', {}, trade ? t('They give') : t('You get')),
        trade ? null : h('span.tr-tally.tnum', {}, `${theirs.length}/${SIDE_MAX}`),
      ),
      theirsGrid,
    );
    cols.replaceChildren(myCol, theirCol);
  }

  async function commit() {
    if (busy || submit.disabled) return;
    busy = true;
    paint();
    const minePayload = mine.map(tradeCard);
    try {
      if (trade) await changeSide(trade.id, { [mineSide]: minePayload });
      else await sendOffer({ to: partner.id, give: minePayload, want: theirs.slice(), note: note.value.trim() });
      handle?.close();
      onDone?.();
    } catch (err) {
      busy = false;
      paint();
      toast(say(err, t('The offer did not go out.')), { tone: 'err', iconName: 'alert' });
    }
  }

  submit.addEventListener('click', commit);

  sheet({
    heading: trade ? t('Change your side') : t('New trade'),
    sub: trade
      ? t('The other member is asked to sign again, because what they agreed to has changed.')
      : t('Pick what you put up and what you are asking for. Nothing moves until you both sign.'),
    width: 820,
    footer: h('div.tr-sheet-foot', {}, submit),
    render: (opened) => {
      handle = opened;
      return h('div.tr-sheet', {}, askRow, cols, trade ? null : note);
    },
  });

  paintMine('');
  paintTheirs();
  paintAsk();
  paint();
}

/* ---- the page --------------------------------------------------------- */
export function TradesView({ onCleanup }) {
  /* A folder copy on a plain host, or a Supabase project, has nowhere to write a
     deal. Say so where the list would have been. */
  if (!tradeUsable()) {
    return h(
      'div.trades',
      {},
      emptyState({
        iconName: 'offline',
        heading: t('Trades need a Solvn server'),
        body: t('A deal is stored by the server that runs this site, which this copy does not have.'),
        action: h('a.btn.btn--primary', { href: '#/' }, icon('home'), h('span', {}, t('Back to home'))),
      }),
    );
  }

  const wrap = h('div.trades');
  if (!isSignedIn()) {
    wrap.replaceChildren(
      emptyState({
        iconName: 'swap',
        heading: t('Sign in to trade cards'),
        body: t('A trade is an agreement between two accounts, so it cannot be made with nobody.'),
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

  let filter = 'open';
  const committed = h('p.tr-committed', { hidden: true });
  const pills = h('div.tr-filters', { role: 'group', 'aria-label': t('Filter deals') });
  const list = h('div.tr-list', { 'aria-live': 'polite' });

  const newBtn = h(
    'button.btn.btn--primary',
    { type: 'button', onclick: () => openNew() },
    icon('plus'),
    h('span', {}, t('New trade')),
  );

  const head = h(
    'div.tr-head',
    {},
    h(
      'div',
      {},
      h('h1.display', {}, t('Trades')),
      h(
        'p.muted.tr-sub',
        {},
        t('An offer completes only when both members sign it. Signing holds your cards aside, and an edit takes both signatures back.'),
      ),
    ),
    newBtn,
  );

  const handlers = {
    async sign(deal) {
      /* The binder is the authority on whether these copies are still here: a
         card fused or spent since the offer went out cannot be handed over, and
         signing would only put the deal into a state neither end can settle. */
      if (!holdsSide(mySide(deal))) {
        toast(t('Your binder no longer holds those cards. Change your side first.'), { tone: 'err', iconName: 'alert' });
        return;
      }
      try {
        const next = await signDeal(deal.id);
        toast(
          next.state === 'done' ? t('Traded. Their cards are in your binder.') : t('Signed. Your cards are held aside until they sign.'),
          { iconName: 'sparkles' },
        );
      } catch (err) {
        toast(say(err, t('That trade did not take your signature.')), { tone: 'err', iconName: 'alert' });
      }
      refreshTrades();
    },
    edit(deal) {
      offerSheet({ trade: deal, onDone: () => refreshTrades() });
    },
    async cancel(deal) {
      try {
        await callOff(deal.id);
        toast(t('Called off. Your cards are back.'), { iconName: 'check' });
      } catch (err) {
        toast(say(err, t('That trade could not be called off.')), { tone: 'err', iconName: 'alert' });
      }
      refreshTrades();
    },
  };

  function openNew() {
    if (!ownedEntries().some((e) => Number(e.lv) <= TOP_LV)) {
      toast(t('Your binder has nothing to trade yet.'), { tone: 'err', iconName: 'alert' });
      return;
    }
    offerSheet({ onDone: () => refreshTrades() });
  }

  function paintFilters(counts) {
    const rows = [
      ['open', t('Open'), counts.open],
      ['closed', t('Closed'), counts.closed],
      ['all', t('All'), counts.all],
    ];
    pills.replaceChildren(
      ...rows.map(([id, label, n]) =>
        h(
          `button.chip${filter === id ? '.is-active' : ''}`,
          {
            type: 'button',
            'aria-pressed': String(filter === id),
            onclick: () => {
              filter = id;
              paint();
            },
          },
          h('span', {}, label),
          h('b.tnum', {}, String(n)),
        ),
      ),
    );
  }

  function paint() {
    const { trades, loaded, failed } = tradesState();
    paintFilters({
      all: trades.length,
      open: trades.filter((d) => d.state === 'awaiting').length,
      closed: trades.filter((d) => d.state !== 'awaiting').length,
    });

    const held = escrowedList().reduce((n, row) => n + row.cards.length, 0);
    committed.hidden = !held;
    if (held) committed.replaceChildren(icon('lock'), h('span', {}, t('{n} of your cards are held aside in open deals.', { n: held })));

    if (!loaded) {
      list.replaceChildren(h('p.faint', {}, t('Loading…')));
      return;
    }
    const rows = trades.filter((d) =>
      (filter === 'open' && d.state === 'awaiting') || (filter === 'closed' && d.state !== 'awaiting') || filter === 'all');
    if (!rows.length) {
      list.replaceChildren(
        emptyState({
          iconName: 'swap',
          heading: filter === 'open' ? t('No open trades') : t('Nothing here yet'),
          body:
            filter === 'open'
              ? failed
                ? t('The trade list is not answering right now.')
                : t('Open an offer and it appears here for both of you.')
              : t('Traded, called-off and lapsed deals stay on this list.'),
          action: newBtn,
        }),
      );
      return;
    }
    list.replaceChildren(...rows.map((d) => dealRow(d, handlers)));
  }

  wrap.append(head, committed, pills, list);
  paint();
  refreshTrades();

  const unsubscribe = subscribeTrades(paint);
  const onAccount = () => paint();
  document.addEventListener('kitsune:account', onAccount);
  onCleanup(() => {
    unsubscribe();
    document.removeEventListener('kitsune:account', onAccount);
  });
  return wrap;
}
