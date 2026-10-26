/**
 * The card binder — /packs.
 *
 * Three things happen here and nothing is hidden about any of them: a pack is
 * opened against a published drop table, a binder is a shelf of cards this
 * account owns, and a duplicate is not a wasted pull but the raw material for an
 * evolution. There is nothing to buy and no advertisement to watch, so the only
 * ways to pull are the packs the day hands you and — for the one account with a
 * tester's hand — the tools at the bottom of the page.
 *
 * Two views share this route. `?shelf=` is the binder: what you own. `?view=set`
 * is the compendium: the whole roster at one tier, unowned tiles locked behind a
 * padlock with their Power withheld, so a set you have not finished is something
 * you can see the shape of.
 *
 * The showcase above the grid is the 3D stage: the card you last chose is held
 * up, and on a machine with a cursor it tilts under the pointer the way a poster
 * does elsewhere on the site. On a phone it stands still, because nothing about
 * reading a card should need a hover.
 */

import { h, icon } from '../lib/dom.js';
import { go, parse } from '../lib/router.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { authSheet } from '../components/account.js';
import { isSignedIn, currentUser } from '../lib/account.js';
import {
  DAILY_PACKS, PACK_HOUR, PACK_CARDS, BANNER_LV, TOP_LV, LIVE_POWER, MAX_LUCK,
  STAT_KEYS, STAT_LABELS, ULTIMATE, ULTIMATE_KEY, STREAK_STEPS,
  rarityOf, dropRate, mergeCost, canMerge, packsLeft, quota, isLive,
  binderStats, ownedEntries, openPack, merge, grantCopies, forcePull,
  refillDaily, loadPool, poolSize, showcaseSet, isTester, serialText, luck, setLuck,
  resetText, streakNow, streakFloor, nextStreakStep, allowanceLeft, bankedPacks,
  compendium, tierProgress, ultimateState, awardUltimate, ultimateCard, publishSoon,
} from '../lib/cards.js';
import {
  gachaCard, rarityChip, dropTable, openPackFlow, evolveFlow, showcase,
  rarityLegend, tierStrip, closeGachaFlow,
} from '../components/gacha.js';

/* Seven shelves is enough to find a card in a binder that spans fifteen
   tiers; a chip per tier would be a colour test, not a filter. Live cards get
   their own shelf because the line that makes one is a Power number, not a
   tier. */
const FILTERS = [
  { id: '', label: () => t('Everything'), test: () => true },
  { id: 'live', label: () => t('Live cards'), test: (e) => isLive(e) },
  { id: 'holo', label: () => t('Holographic'), test: (e) => e.lv >= BANNER_LV },
  { id: 'high', label: () => t('Legendary and up'), test: (e) => e.lv >= 11 },
  { id: 'mid', label: () => t('Rare to Epic'), test: (e) => e.lv >= 6 && e.lv < 11 },
  { id: 'base', label: () => t('Common tiers'), test: (e) => e.lv < 6 },
  { id: 'fuse', label: () => t('Ready to fuse'), test: (e) => canMerge(e) },
];

const readShelf = () => {
  const f = parse().query.shelf || '';
  return FILTERS.some((x) => x.id === f) ? f : '';
};

const readTier = () => {
  const lv = Number(parse().query.tier) || 1;
  return lv >= 1 && lv <= ULTIMATE.lv ? lv : 1;
};

const writeShelf = (id) => go(`/packs${id ? `?shelf=${id}` : ''}`, { replace: true, keepScroll: true });
const writeSet = (lv) => go(`/packs?view=set&tier=${lv}`, { replace: true, keepScroll: true });

const notAnswering = () => t('The roster is not answering. Try again in a minute.');
const dayIsDone = () =>
  t('That is today over — {n} packs at {hour}:00 tomorrow, and the ones you did not open are in your bank.', {
    n: String(DAILY_PACKS),
    hour: String(PACK_HOUR),
  });

export async function CollectionView(ctx) {
  const wrap = h('div.page-packs');
  await loadPool().catch(() => []);

  /* Opening the binder is also how the board stays honest. The published summary
     is derived from this device's shelf, so a member who pulled cards on another
     day — or whose first publish never landed — is refreshed the moment they look
     at their own binder. Debounced, and silent if it fails: the binder works the
     same either way. */
  if (isSignedIn()) publishSoon();

  /* A sample of each tier, so the stage and the preview row have something to
     hold up before a binder exists. Samples are marked: they are not owned, they
     cannot be fused, and they never enter the grid. */
  let samples = (await showcaseSet().catch(() => [])).map((s) => ({ ...s, sample: true }));
  const sampleAt = (lv) => samples.find((s) => s.lv === lv) || null;

  /* Samples are rolled, not read off a table, so a change to a tester's luck has
     to re-roll them — otherwise the page keeps holding up cards from the band
     that luck is supposed to have replaced. */
  async function rerollSamples() {
    const fresh = await showcaseSet().catch(() => []);
    if (!fresh.length) return;
    samples = fresh.map((s) => ({ ...s, sample: true }));
    if (selected?.sample) selected = sampleAt(selected.lv) || samples[0] || selected;
  }

  /* The card on the stage: the best one owned, or the bottom tier to look at. */
  let selected = ownedEntries()[0] || sampleAt(1) || samples[0] || null;

  const head = h('div.g-head');
  /* Two views sit above one shelf rail, so the mode switch is not sticky — two
     sticky bars would stack on the same pixel and hide whichever came first. */
  const modeBar = h('div.rowline.wrap.g-modebar', { role: 'group', 'aria-label': t('Binder views') });
  const stage = h('div.g-stage-wrap');
  const shelfBar = h('div.filter-bar', { role: 'group', 'aria-label': t('Binder shelves') });
  /* The compendium navigates by a checklist rather than a filter rail: sixteen
     rows with a count each do not fit a sticky strip, and a tier is a page of
     tiles rather than a filter over one. */
  const setBar = h('div.g-setbar');
  const gridWrap = h('div.g-grid-wrap');
  const prize = h('div.g-prize-wrap');
  const odds = h('div.g-odds-wrap');
  const tools = h('div.g-tools');
  let shelf = readShelf();
  let tier = readTier();
  let mode = parse().query.view === 'set' ? 'set' : 'binder';
  let oddsOpen = false;

  /* ---- the clock --------------------------------------------------------
   * The countdown is a promise with a number attached, so the number moves on
   * its own. One node is kept for the whole visit — a repaint of the header
   * reattaches the same element rather than minting a stale one — and the same
   * tick reads the day: at 04:00 the allowance in the store rolls itself over,
   * and the page follows it without anybody reloading.
   */
  const clock = h('b.tnum.g-clock', {}, resetText());
  let seenDay = quota().day;
  const timer = setInterval(() => {
    clock.textContent = resetText();
    const day = quota().day;
    if (day === seenDay) return;
    seenDay = day;
    repaintAll();
  }, 1000);
  ctx?.onCleanup?.(() => clearInterval(timer));

  /* ---- the header ------------------------------------------------------ */
  /** The run read as a rule rather than a badge: what it is worth today, and
      what one more day of it is worth tomorrow. Nothing here is hidden — a floor
      is printed the same way the odds are. */
  function streakText(run, floor, step) {
    if (!run) {
      return t('No streak yet. Open a pack today and the count starts: {n} days in a row raises the floor under every pack.', { n: String(STREAK_STEPS[0].days) });
    }
    const head = floor
      ? t('{n}-day streak: no card in any pack prints below Lv {floor}.', { n: String(run), floor: String(floor) })
      : t('{n}-day streak. Keep it going.', { n: String(run) });
    if (!step) return `${head} ${t('That is the top of the ladder.')}`;
    const bonus = step.bonus ? ` ${t('{n} packs land in your bank.', { n: String(step.bonus) })}` : '';
    return `${head} ${t('{left} more days for Lv {floor}.', {
      left: String(step.days - run),
      floor: String(step.floor),
    })}${bonus}`;
  }

  function repaintHead() {
    const stats = binderStats();
    const q = quota();
    const signed = isSignedIn();
    const left = packsLeft();
    const today = allowanceLeft();
    const bank = bankedPacks();
    const run = streakNow(q);
    const held = ultimateState();

    const packBtn = h(
      'button.btn.btn--primary.btn--pack',
      { type: 'button', onclick: () => runPack(packBtn) },
      icon('sparkles'),
      h('span', {}, signed ? t('Open a pack') : t('Sign in to open packs')),
      signed ? h('span.g-pack-count.tnum', {}, left === Infinity ? '∞' : String(left)) : null,
    );

    head.replaceChildren(
      h(
        'header.page-head',
        {},
        h('div.eyebrow', {}, t('CARD BINDER')),
        h('h1.display', {}, t('Twenty-five tiers, one roll')),
        h(
          'p',
          {},
          signed
            ? t('Every pull is a roll against the published table: nothing for sale, nothing handed out by an advertisement.')
            : t('Packs are a member habit — {n} a day, free, and no advertisement doubles them.', { n: String(DAILY_PACKS) }),
        ),
        h('div.rowline.g-headline', {}, packBtn, rarityChip(stats.best || 1),
          /* The board is the one thing a binder is for besides finishing it, and
             on a phone the side rail is gone — so the way in lives here too. */
          h('a.btn.btn--sm', { href: '#/leaderboard' }, icon('crown'), h('span', {}, t('Leaderboard')))),
        h(
          'p.g-daily',
          {},
          !signed
            ? t('Sign in and the day starts counting: {n} free packs, and a fresh {n} at {hour}:00 every morning.', {
                n: String(DAILY_PACKS),
                hour: String(PACK_HOUR),
              })
            : left === Infinity
              ? t('Unlimited packs while this account is signed in.')
              : t('{today} left today, {bank} saved in your bank.', {
                  today: String(today),
                  bank: String(bank),
                }),
          signed && left !== Infinity ? h('span.g-daily-used.tnum', {}, ` ${q.used} / ${DAILY_PACKS}`) : null,
        ),
        signed && left !== Infinity
          ? h('p.g-clockline', {}, icon('clock'), t('Resets at {hour}:00', { hour: String(PACK_HOUR) }), clock)
          : null,
        signed && left !== Infinity
          ? h('p.g-streakline', {}, icon('flame'), streakText(run, streakFloor(run), nextStreakStep(run)))
          : null,
        h(
          'div.g-facts',
          {},
          fact(stats.unique, t('Cards')),
          fact(stats.copies, t('Copies')),
          fact(stats.packs, t('Packs opened')),
          fact(stats.holo, t('Holographic')),
          fact(held.held, t('Tiers held')),
        ),
        !poolSize()
          ? h('p.g-note', {}, icon('offline'), t('The character roster is not answering, so there is nothing to draw yet. Try again in a few minutes.'))
          : null,
      ),
    );
  }

  const fact = (value, label) => h('div.g-fact', {}, h('b.tnum', {}, String(value)), h('span', {}, label));

  function runPack(btn) {
    if (!isSignedIn()) {
      toast(t('{n} packs a day, once you have an account.', { n: String(DAILY_PACKS) }), { iconName: 'user' });
      authSheet('login');
      return;
    }
    if (packsLeft() <= 0) {
      toast(dayIsDone(), { tone: 'err', iconName: 'clock' });
      return;
    }
    if (!poolSize()) {
      toast(notAnswering(), { tone: 'err', iconName: 'offline' });
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    openPack()
      .then((res) => {
        if (res.blocked === 'nopool') toast(notAnswering(), { tone: 'err', iconName: 'offline' });
        else if (res.blocked === 'empty') toast(dayIsDone(), { tone: 'err', iconName: 'clock' });
        else {
          openPackFlow(res.cards, {
            onDone: () => {
              repaintAll();
              select(res.cards.reduce((c, x) => (x.lv > c.lv ? x : c), res.cards[0]));
              /* The day's news comes after the hand, not over it: the reveal owns
                 the moment, and a streak announcement is a thing to read once the
                 cards are put away. */
              if (res.bonus) {
                toast(t('{n}-day streak: {bonus} bonus packs are in your bank.', { n: String(res.run), bonus: String(res.bonus) }), {
                  tone: 'ok',
                  iconName: 'flame',
                });
              } else if (res.floor && res.cards.some((c) => c.raised)) {
                toast(t('Your {n}-day streak lifted this pack: nothing in it printed below Lv {floor}.', { n: String(res.run), floor: String(res.floor) }), {
                  tone: 'ok',
                  iconName: 'flame',
                });
              }
            },
          });
        }
      })
      .catch(() => toast(t('The roll did not land. Nothing was spent — try again.'), { tone: 'err', iconName: 'alert' }))
      .finally(() => {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      });
  }

  /* ---- the showcase ---------------------------------------------------- */
  function select(card) {
    selected = card;
    paintStage();
    stage.scrollIntoView({ block: 'nearest' });
  }

  function paintStage() {
    const card = selected || sampleAt(1);
    const owned = card && !card.sample ? ownedEntries().find((e) => e.key === card.key) : null;
    stage.replaceChildren(
      h(
        'section.panel-card.g-showcase',
        {},
        h(
          'div.panel-head',
          {},
          icon('grid'),
          h('h3', {}, t('Showcase')),
          h('div.grow'),
          owned ? rarityChip(owned.lv) : h('span.badge', {}, t('Sample card')),
        ),
        h(
          'div.panel-body',
          {},
          card
            ? h('div.g-show-row', {}, showcase(card), stageSide(card, owned))
            : h('p.muted', {}, t('Nothing to hold up yet — open a pack and the first card lands here.')),
        ),
      ),
    );
  }

  /** The side of the stage: what the card is, and what can be done with it. */
  function stageSide(card, owned) {
    const r = rarityOf(card.lv);
    const cost = mergeCost(card.lv);
    const isTop = card.lv >= TOP_LV;
    const have = owned?.count || 0;
    const actions = [];
    const d = dropRate(r.lv);
    /* The one-of-one is graded outside the bands, so the stage that would print
       its Power prints what the card is instead. */
    const power = card.ultimate ? t('INFINITY') : String(card.stats?.power ?? 0);

    if (!isTop) {
      actions.push(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            'aria-disabled': String(have < cost),
            onclick: () => {
              if (!owned) {
                toast(t('Only cards you own can fuse.'), { tone: 'err', iconName: 'info' });
                return;
              }
              if (have < cost) {
                toast(t('You need {n} copies — you have {have}. Duplicates collect in the binder.', { n: cost, have }), {
                  tone: 'err',
                  iconName: 'info',
                });
                return;
              }
              fuse(owned);
            },
          },
          icon('sparkles'),
          h('span', {}, t('Fuse {n} copies', { n: cost })),
        ),
      );
    }
    if (card.mediaId) {
      actions.push(h('a.btn', { href: `#/anime/${card.mediaId}` }, icon('play'), h('span', {}, t('Open the anime'))));
    }

    return h(
      'div.g-show-side',
      {},
      h('h4', {}, card.name),
      card.native ? h('p.muted', { style: { fontSize: '13px' } }, card.native) : null,
      h('p.g-show-line', {}, `${t(r.label)} · Lv ${r.lv}`),
      h('p.g-show-rate', {}, d.oneInLabel ? t('Awarded, never rolled') : `${d.label} · ${t('One in {n}', { n: d.oneIn.toLocaleString() })}`),
      /* The line that makes a card move is the Power number, so the stage says
         which way that number reads — otherwise "why is this one animated" has
         no answer on the page. */
      isLive(card)
        ? h(
            'p.g-show-live',
            {},
            icon('bolt'),
            card.ultimate
              ? t('The one-of-one: Power is INFINITY, and it is the only card printed in black and electric blue with a light that breathes.')
              : t('Live card: Power {n} clears the {min} line, so the ring, the rim and the foil all light up.', {
                  n: power,
                  min: String(LIVE_POWER),
                }),
          )
        : h(
            'p.muted.g-show-dull',
            {},
            t('Power {n} — a card goes live at {min}, so this one stands still.', {
              n: power,
              min: String(LIVE_POWER),
            }),
          ),
      card.mediaTitle
        ? h('p.muted', {}, `${card.mediaTitle}${card.mediaYear ? ` (${card.mediaYear})` : ''}`)
        : card.ultimate
          ? h('p.muted', {}, t('The platform itself — held by every binder that has finished all fifteen tiers.'))
          : null,
      h(
        'p.g-show-serial',
        {},
        `${t('Serial')} ${serialText(card.serial)}`,
        owned ? ` · ${t('Copies')}: ${owned.count}` : null,
      ),
      h(
        'ul.g-show-stats',
        {},
        ...STAT_KEYS.map((k) =>
          h(
            k === 'power' ? 'li.is-power' : 'li',
            {},
            h('span', {}, t(STAT_LABELS[k])),
            h('b.tnum', {}, k === 'power' ? power : String(card.stats?.[k] ?? 0)),
          ),
        ),
        h('li.is-overall', {}, h('span', {}, t('Overall')), h('b.tnum', {}, String(card.stats?.overall ?? 0))),
      ),
      card.ultimate
        ? h('p.muted.g-show-top', {}, icon('crown'), t('Exclusive: nothing fuses into this and nothing fuses it away.'))
        : isTop
          ? h('p.muted.g-show-top', {}, t('This is the top rollable tier — nothing fuses past it, and one card sits above it.'))
          : null,
      owned && canMerge(owned) ? h('p.g-show-ready', {}, icon('sparkles'), t('Ready to fuse.')) : null,
      h('div.rowline.g-show-actions', {}, ...actions),
    );
  }

  function fuse(entry) {
    const before = { ...entry };
    const result = merge(entry.key);
    if (!result) {
      toast(t('That fuse did not go — the copies are still in the binder.'), { tone: 'err', iconName: 'alert' });
      repaintAll();
      return;
    }
    const fresh = ownedEntries().find((e) => e.key === result.card.key) || result.card;
    evolveFlow(before, fresh, {
      onDone: () => {
        repaintAll();
        select(fresh);
        toast(t('{name} is now a {rarity} card.', { name: fresh.name, rarity: t(rarityOf(fresh.lv).label) }), {
          iconName: 'sparkles',
        });
      },
    });
  }

  /* ---- the two views ----------------------------------------------------
     The binder is what you own; the compendium is what there is to own. They
     share a route because they share a stage — a tile you are missing is only
     worth missing if you can see it next to the card you already have. */
  const VIEWS = [
    { id: 'binder', label: () => t('My binder'), iconName: 'library' },
    { id: 'set', label: () => t('The full set'), iconName: 'grid' },
  ];

  function paintModeBar() {
    modeBar.replaceChildren(
      ...VIEWS.map((v) =>
        h(
          `button.chip${v.id === mode ? '.is-active' : ''}`,
          {
            type: 'button',
            'aria-pressed': String(v.id === mode),
            onclick: () => {
              if (v.id === mode) return;
              mode = v.id;
              if (v.id === 'set') writeSet(tier);
              else writeShelf(shelf);
              paintModeBar();
              paintShelf();
              paintGrid();
            },
          },
          icon(v.iconName),
          v.label(),
        ),
      ),
      h('div.grow'),
      h('span.g-view-hint.faint', {}, mode === 'set' ? t('Locked tiles keep their tier colours and hide their numbers.') : t('Everything this account has pulled.')),
    );
  }

  /* ---- the grid -------------------------------------------------------- */
  function paintShelf() {
    if (mode === 'set') {
      shelfBar.hidden = true;
      setBar.hidden = false;
      setBar.replaceChildren(
        h('p.g-setbar-hint.faint', {}, icon('grid'), t('Pick a tier: the tiles below show the whole roster at that level, and a locked one is a card this binder does not hold.')),
        tierStrip(tier, (lv) => {
          if (lv === tier) return;
          tier = lv;
          writeSet(tier);
          paintShelf();
          paintGrid();
        }),
      );
      return;
    }
    setBar.hidden = true;
    shelfBar.hidden = false;
    shelfBar.replaceChildren(
      h('span.badge', {}, icon('library'), t('Shelves')),
      ...FILTERS.map((f) =>
        h(
          `button.chip${f.id === shelf ? '.is-active' : ''}`,
          {
            type: 'button',
            'aria-pressed': String(f.id === shelf),
            onclick: () => {
              if (f.id === shelf) return;
              shelf = f.id;
              writeShelf(shelf);
              paintShelf();
              paintGrid();
            },
          },
          f.label(),
        ),
      ),
    );
  }

  function paintGrid() {
    if (mode === 'set') {
      paintSet();
      return;
    }
    const active = FILTERS.find((f) => f.id === shelf);
    const entries = ownedEntries().filter(active.test);
    if (!entries.length) {
      gridWrap.replaceChildren(
        h(
          'div.g-empty',
          {},
          h('h3', {}, shelf ? t('Nothing on this shelf yet.') : t('The binder is empty.')),
          h('p.muted', {}, shelf ? t('Try another shelf, or open a pack.') : t('Your first pack is free, and there are {n} of them a day.', { n: String(DAILY_PACKS) })),
          !isSignedIn() ? h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet('login') }, icon('user'), t('Sign in')) : null,
        ),
      );
      return;
    }
    gridWrap.replaceChildren(
      h('p.g-grid-note.muted', {}, t('{n} cards on this shelf.', { n: String(entries.length) })),
      h(
        'div.g-grid',
        {},
        ...entries.map((e, i) => gachaCard(e, { variant: 'tile', count: e.count, eager: i < 8, onClick: () => select(e) })),
      ),
    );
  }

  /**
   * One tier of the whole set. A tile the binder holds is the real card, count
   * and all; a tile it does not keeps its frame and its tier colours
   * and gives up its numbers. The compendium is a map of what is missing, not a
   * spoiler for what a roll has not decided yet.
   */
  function paintSet() {
    const tiles = compendium(tier);
    const p = tierProgress(tier);
    if (!tiles.length) {
      gridWrap.replaceChildren(
        h('div.g-empty', {}, h('h3', {}, t('The roster is not answering.')), h('p.muted', {}, notAnswering())),
      );
      return;
    }
    const r = rarityOf(tier);
    gridWrap.replaceChildren(
      h(
        'div.g-set-head',
        {},
        r.ultimate
          ? h('p.g-grid-note.muted', {}, t('The one-of-one: awarded to a binder that holds all {n} tiers, never rolled.', { n: String(TOP_LV) }))
          : h('p.g-grid-note.muted', {}, t('{have} of {total} owned at {rarity}.', {
              have: String(p.have),
              total: String(p.total),
              rarity: t(r.label),
            })),
        p.done ? h('span.badge.badge--live', {}, icon('check'), t('Tier complete')) : null,
      ),
      h(
        'div.g-grid',
        {},
        ...tiles.map((c, i) =>
          gachaCard(c, { variant: 'tile', count: Number(c.count) || 1, eager: i < 8, onClick: () => tapTile(c) }),
        ),
      ),
    );
  }

  /** A locked tile still answers a press — with the reason and the way to fix it. */
  function tapTile(card) {
    if (card.locked && card.ultimate) {
      toast(t('No pack holds this card. Finish all {n} tiers and the binder hands it over.', { n: String(TOP_LV) }), {
        tone: 'info',
        iconName: 'crown',
      });
      return;
    }
    if (card.locked) {
      toast(t('{name} at Lv {lv} is still sealed in a pack. Open one and this tile lights up.', {
        name: card.name,
        lv: String(card.lv),
      }), { tone: 'info', iconName: 'sparkles' });
      return;
    }
    select(card);
  }

  /* ---- the one-of-one --------------------------------------------------- */
  function paintPrize() {
    const st = ultimateState();
    let body;

    if (st.have) {
      body = h(
        'div.stack',
        {},
        h('p.muted', {}, t('In your binder: the card no pack holds, granted for finishing all {n} tiers.', { n: String(TOP_LV) })),
        h(
          'button.btn.btn--sm',
          {
            type: 'button',
            onclick: () => {
              const owned = ownedEntries().find((e) => e.key === ULTIMATE_KEY);
              if (owned) select(owned);
            },
          },
          icon('grid'),
          t('Hold it up'),
        ),
      );
    } else if (st.ready) {
      body = h(
        'div.stack',
        {},
        h('p.muted', {}, t('All fifteen tiers are in the binder, which is the only way in. This is what that earns.') ),
        h(
          'button.btn.btn--primary',
          { type: 'button', onclick: () => claimPrize() },
          icon('crown'),
          t('Claim the Solvn card'),
        ),
      );
    } else {
      body = h(
        'div.stack',
        {},
        h('p.muted', {}, t('{held} of {need} tiers held. This card is not rolled: a binder gets it by holding at least one copy of every tier in the set.', {
          held: String(st.held),
          need: String(TOP_LV),
        })),
        h(
          'div.rowline.wrap',
          {},
          ...st.missing.map((lv) =>
            h(
              'button.chip.chip--xs',
              {
                type: 'button',
                title: t('Open the compendium at this tier'),
                onclick: () => {
                  mode = 'set';
                  tier = lv;
                  writeSet(lv);
                  paintModeBar();
                  paintShelf();
                  paintGrid();
                  gridWrap.scrollIntoView({ block: 'start' });
                },
              },
              `Lv ${lv}`,
            ),
          ),
        ),
        h('p.faint', {}, t('Tap a tier to see exactly which characters are still missing at it.')),
        /* The staff handle can put this card in its own binder without finishing
           the set. Nothing else about it changes — one copy, still unrollable —
           and neither of these two nodes renders for any other account. */
        isTester()
          ? h(
              'button.btn.btn--sm',
              { type: 'button', onclick: () => claimPrize(true) },
              icon('crown'),
              t('Grant the Solvn card'),
            )
          : null,
        isTester() ? h('p.faint', {}, t('Only this handle can grant it, and only to its own binder.')) : null,
      );
    }

    prize.replaceChildren(
      h(
        'section.panel-card.g-prize',
        {},
        h(
          'div.panel-head',
          {},
          icon('crown'),
          h('h3', {}, t('The one-of-one')),
          h('div.grow'),
          h('span.badge', {}, `Lv ${ULTIMATE.lv}`),
        ),
        h('div.panel-body', {}, body),
      ),
    );
  }

  function claimPrize(staff = false) {
    const res = awardUltimate({ staff });
    if (!res.granted) {
      toast(
        res.have ? t('It is already in your binder.') : t('The set is not finished yet — {held} of {need} tiers held.', { held: String(res.held), need: String(res.need) }),
        { tone: res.have ? 'info' : 'err', iconName: 'info' },
      );
      return;
    }
    const owned = ownedEntries().find((e) => e.key === ULTIMATE_KEY);
    selected = owned || ultimateCard();
    repaintAll();
    openPackFlow([{ ...ultimateCard(), rarity: ULTIMATE }], { onDone: repaintAll });
  }

  /* ---- the odds and the rules ------------------------------------------ */
  const rule = (label, value) => h('div.g-rule', {}, h('span', {}, label), h('b', {}, value));

  /**
   * The economy printed in one place: what a pack holds, what a day hands out,
   * when the day turns, where unopened packs go, and what a streak is worth at
   * every rung. A collector is entitled to read all of it before spending a pack,
   * and a floor that is not on the screen is indistinguishable from a rig.
   */
  function rulesBlock() {
    const run = streakNow();
    return h(
      'div.g-rules',
      {},
      h(
        'div.g-rule-grid',
        {},
        rule(t('A pack holds'), t('{n} cards', { n: String(PACK_CARDS) })),
        rule(t('A day hands you'), t('{n} packs, free', { n: String(DAILY_PACKS) })),
        rule(t('The day turns at'), t('{hour}:00, your time', { hour: String(PACK_HOUR) })),
        rule(t('Packs you leave'), t('They wait in your bank. Nothing expires.')),
        rule(t('A streak is'), t('a day you open at least one pack')),
      ),
      h('h4.g-rules-sub', {}, t('The streak ladder')),
      h(
        'p.faint',
        {},
        t('Days spent pulling in a row raise a floor under every pack. The odds above do not change: a floor only lifts the cards that would have landed below it, and it is printed here so you can see the whole deal.'),
      ),
      h(
        'ul.g-steps',
        {},
        ...STREAK_STEPS.map((s) =>
          h(
            `li.g-step${run >= s.days ? '.is-on' : ''}`,
            {},
            h('b.tnum.g-step-days', {}, t('{n} days', { n: String(s.days) })),
            h('span.g-step-floor', {}, t('Nothing below Lv {floor}', { floor: String(s.floor) })),
            s.bonus ? h('span.g-step-bonus.tnum', {}, `+${s.bonus} ${t('packs')}`) : null,
            run >= s.days ? h('span.g-step-now', {}, icon('check'), t('Yours')) : null,
          ),
        ),
      ),
      h(
        'p.faint.g-rules-foot',
        {},
        t('One row of the table has no weight at all: Lv {lv}, the Solvn card. It is granted to a binder that holds every tier, never rolled, and it cannot be fused away.', {
          lv: String(ULTIMATE.lv),
        }),
      ),
    );
  }

  function paintOdds() {
    const toggle = h(
      'button.btn.btn--sm',
      {
        type: 'button',
        'aria-expanded': String(oddsOpen),
        onclick: () => {
          oddsOpen = !oddsOpen;
          paintOdds();
        },
      },
      icon(oddsOpen ? 'chevronUp' : 'chevronDown'),
      h('span', {}, oddsOpen ? t('Hide the table') : t('Show every tier')),
    );
    odds.replaceChildren(
      h(
        'section.panel-card.g-odds-card',
        {},
        h('div.panel-head', {}, icon('info'), h('h3', {}, t('The drop table')), h('div.grow'), toggle),
        h(
          'div.panel-body',
          {},
          h(
            'p.muted.g-odds-lead',
            {},
            t('Rolls come from the browser’s own entropy, with rejection sampling, so a tier is never over-favoured by the arithmetic. These are the odds every pack runs on — for every member, including a tester.'),
          ),
          oddsOpen
            ? h('div.stack', {}, dropTable(), rulesBlock())
            : h(
                'div.g-odds-brief',
                {},
                ...[1, 4, 7, 10, 13, 15].map((lv) => rarityChip(lv, { rate: true })),
              ),
        ),
      ),
    );
  }

  /* ---- tester tools ---------------------------------------------------- */
  function paintTools() {
    if (!isTester()) {
      tools.replaceChildren();
      return;
    }
    const pick = selected;
    const maxed = luck() >= MAX_LUCK;
    tools.replaceChildren(
      h(
        'section.panel-card.g-tester',
        {},
        h(
          'div.panel-head',
          {},
          icon('crown'),
          h('h3', {}, t('Tester tools')),
          h('div.grow'),
          h('span.badge', {}, maxed ? t('Max luck on') : t('Max luck off')),
          h('span.badge', {}, t('Only {name} sees this', { name: currentUser()?.username || 'solvn' })),
        ),
        h(
          'div.panel-body',
          {},
          h(
            'p.muted',
            {},
            t('Unlimited packs, one card of every tier to look at, and copies enough to fuse — the whole point being to see an animation before a member would roll it. Nothing here touches the drop table.'),
          ),
          h(
            'p.muted',
            {},
            t('Luck is a squeeze on the same roll, for this account only: at max every pack lands the top tiers and the high end of every stat band, which is what clears the {min} Power line a live card needs. Turn it off and the published odds run again, unchanged.', { min: String(LIVE_POWER) }),
          ),
          h(
            'div.rowline.g-tool-row',
            {},
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                class: maxed ? 'is-on' : null,
                'aria-pressed': String(maxed),
                onclick: () => {
                  const now = setLuck(maxed ? 0 : MAX_LUCK) >= MAX_LUCK;
                  rerollSamples().then(() => {
                    repaintAll();
                    toast(now ? t('Max luck on: every roll takes the top of its band.') : t('Max luck off: the published odds run again.'), {
                      iconName: 'bolt',
                    });
                  });
                },
              },
              icon('bolt'),
              h('span', {}, maxed ? t('Turn off max luck') : t('Turn on max luck')),
            ),
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  if (!pick) {
                    toast(t('Nothing selected yet.'), { tone: 'err', iconName: 'info' });
                    return;
                  }
                  if (pick.ultimate) {
                    toast(t('The one-of-one cannot be forced into a hand. Finish the set and claim it.'), {
                      tone: 'err',
                      iconName: 'crown',
                    });
                    return;
                  }
                  const hand = forcePull(pick.lv);
                  if (!hand.length) {
                    toast(notAnswering(), { tone: 'err', iconName: 'offline' });
                    return;
                  }
                  openPackFlow(hand, {
                    onDone: () => {
                      repaintAll();
                      select(hand.reduce((c, x) => (x.lv > c.lv ? x : c), hand[0]));
                    },
                  });
                },
              },
              icon('crown'),
              t('Force a hand of this tier'),
            ),
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  const top = sampleAt(TOP_LV);
                  if (!top) {
                    toast(notAnswering(), { tone: 'err', iconName: 'offline' });
                    return;
                  }
                  openPackFlow([top], { preview: true, onDone: repaintAll });
                },
              },
              icon('sparkles'),
              t('Preview a Rainbow Holo reveal'),
            ),
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  select(sampleAt(TOP_LV) || samples.at(-1));
                  toast(t('A sample of every tier is on the stage.'), { iconName: 'grid' });
                },
              },
              icon('grid'),
              t('Show every tier'),
            ),
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  if (!pick) {
                    toast(t('Nothing selected yet.'), { tone: 'err', iconName: 'info' });
                    return;
                  }
                  if (pick.ultimate) {
                    toast(t('There are no copies of the one-of-one to grant — it is a single card.'), {
                      tone: 'err',
                      iconName: 'crown',
                    });
                    return;
                  }
                  const cost = mergeCost(pick.lv);
                  const given = grantCopies(pick.cid, pick.lv, cost);
                  if (!given) {
                    toast(notAnswering(), { tone: 'err', iconName: 'offline' });
                    return;
                  }
                  repaintAll();
                  const owned = ownedEntries().find((e) => e.key === pick.key);
                  if (owned) select(owned);
                  toast(t('{n} copies granted to fuse a {rarity}.', { n: String(cost), rarity: t(rarityOf(Math.min(TOP_LV, pick.lv + 1)).label) }), {
                    iconName: 'check',
                  });
                },
              },
              icon('plus'),
              t('Grant copies for this card'),
            ),
            h(
              'button.btn.btn--sm',
              {
                type: 'button',
                onclick: () => {
                  if (!refillDaily()) {
                    toast(t('Only the tester account can refill the day.'), { tone: 'err', iconName: 'lock' });
                    return;
                  }
                  repaintAll();
                  toast(t('Today’s packs are full again.'), { iconName: 'refresh' });
                },
              },
              icon('refresh'),
              t('Refill daily packs'),
            ),
          ),
          h('h4.g-tool-sub', {}, t('Preview any rarity')),
          rarityLegend((lv) => {
            /* The legend has a row for the one-of-one too, and there is no
               sample of it: hold up the real card instead, which is a drawing
               any account could look at and never a pull. */
            const s = lv === ULTIMATE.lv ? ultimateCard() : sampleAt(lv);
            if (s) select(s);
          }),
          h(
            'p.muted.g-tool-foot',
            {},
            t('A sample is a drawing, not a pull: previewing it rolls nothing and banks nothing. Force a hand instead when you want the cards in the binder.'),
          ),
        ),
      ),
    );
  }

  function repaintAll() {
    repaintHead();
    paintStage();
    paintModeBar();
    paintShelf();
    paintGrid();
    paintPrize();
    paintTools();
  }

  repaintAll();
  paintOdds();
  wrap.append(head, stage, modeBar, shelfBar, setBar, gridWrap, prize, odds, tools);

  /* A stage left open over the next route would trap the page behind a dim
     overlay nobody can dismiss on a phone. */
  ctx?.onCleanup?.(closeGachaFlow);
  return wrap;
}
