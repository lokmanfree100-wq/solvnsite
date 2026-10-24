/**
 * Two boards, one page.
 *
 * The collectors' board is bought with the single highest Power a member has
 * published, never with how many cards their binder holds. Counting copies would
 * rank the person who opened the most packs, not the person who pulled the rarest
 * card, and only one of those two is a thing anybody admires. The tier and the
 * number of distinct cards break ties, so two binders that peak at the same
 * figure still order the same way twice.
 *
 * The ranked board is a different question and cannot be answered with the same
 * column: it is settled by fights the server watched end. Both boards leave the
 * master handle off, because a rank bought by a grant is not a rank — and both
 * leave off a member with nothing to show, because not collecting and collecting
 * a little are not the same statement, and a zero on a duel record is not a low
 * place but no record.
 *
 * What either board shows is what a member chose to make public from a binder
 * that lives on their own device: the peak, and the one card behind it.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { collectors, rankedBoard, shownName } from '../lib/account.js';
import { displayCard, ULTIMATE_POWER } from '../lib/cards.js';
import { avatar, divisionChip, titleChip } from '../components/account.js';
import { gachaCard, rarityChip } from '../components/gacha.js';
import { emptyState, errorState } from '../components/media.js';
import { compactNumber } from '../lib/util.js';

/** The number a row prints: the master card is graded, not counted. */
const powerText = (pub) => ((pub?.top?.ultimate || (pub?.best ?? 0) >= ULTIMATE_POWER)
  ? t('INFINITY')
  : String(pub?.best ?? 0));

const TABS = [
  ['collectors', 'Collectors', 'Highest card Power'],
  ['ranked', 'Ranked', 'Duel record'],
];

export function LeaderboardView() {
  const wrap = h('div.page-board');
  const tabs = h('div.list-tabs', { role: 'tablist', 'aria-label': t('Boards') });
  const head = h('header.page-head');
  const strip = h('div.board-strip');
  const list = h('ol.board-list');
  const foot = h('div.board-foot');

  let tab = 'collectors';

  const skeleton = () => h('li', {}, h('div.skel-row'));

  function paintHead() {
    const ranked = tab === 'ranked';
    head.replaceChildren(
      h('div.eyebrow', {}, ranked ? t('RANKED') : t('LEADERBOARD')),
      h('h1.display', {}, ranked ? t('Top Duelists') : t('Top Collectors')),
      h('p', {}, ranked
        ? t('Wins over settled duels first, then win rate, then the run you are on.')
        : t('Ranked by the highest card Power each member owns — not by how many cards their binder holds.')),
      ranked
        ? h('div.rowline', { style: { marginTop: 'var(--sp-4)' } },
            h('a.btn.btn--sm', { href: '#/arena' }, icon('bolt'), h('span', {}, t('Enter the arena'))))
        : h('div.rowline', { style: { marginTop: 'var(--sp-4)' } },
            h('a.btn.btn--sm', { href: '#/packs' }, icon('sparkles'), h('span', {}, t('Card binder')))),
    );
    tabs.replaceChildren(...TABS.map(([key, label, hint]) =>
      h(
        `button.chip${tab === key ? '.is-active' : ''}`,
        {
          role: 'tab',
          'aria-selected': String(tab === key),
          type: 'button',
          title: t(label),
          'aria-label': t(label),
          onclick: () => {
            if (tab === key) return;
            tab = key;
            paintHead();
            load();
          },
        },
        h('span', {}, t(label)),
        h('span.faint', {}, t(hint)),
      )));
  }

  /* ---- collectors ---------------------------------------------------- */
  function paintTotals(totals) {
    const tiles = [
      { value: String(totals.collectors ?? 0), label: t('Collectors ranked') },
      { value: compactNumber(totals.pulls ?? 0), label: t('Packs opened') },
      { value: totals.highest ? (totals.highest >= ULTIMATE_POWER ? t('INFINITY') : compactNumber(totals.highest)) : '—', label: t('Highest Power') },
    ];
    strip.replaceChildren(...tiles.map((tile) => h('div.board-tile', {},
      h('b.tnum', {}, tile.value),
      h('span', {}, tile.label),
    )));
  }

  function row(u, i) {
    const pub = u.cards || {};
    const rarest = pub.top ? displayCard(pub.top) : null;
    /* The place is the server's number, never the row's index: the row under the
       board is the viewer's own, and it can sit anywhere. A rank nobody printed
       shows as a dash rather than as `NaN`. */
    const place = Number(u.place) > 0 ? Number(u.place) : i + 1;
    return h('li', {},
      h(
        `a.board-row${place <= 3 ? `.is-top${place}` : ''}`,
        {
          href: `#/profile/${encodeURIComponent(u.id)}`,
          'aria-label': t('Open {name}', { name: shownName(u) }),
        },
        h('span.board-pos.tnum', {}, place > 0 ? String(place) : '—'),
        h('span.board-who', {},
          avatar(u, { size: 'sm' }),
          h('span.board-names', {},
            h('b', {}, shownName(u)),
            h('span.faint', {}, `@${u.username}`),
            titleChip(u),
          ),
        ),
        h('span.board-art', {},
          rarest
            ? gachaCard(rarest, { variant: 'mini', eager: place <= 10 })
            : h('span.board-noart', {}, icon('sparkles'), h('span', {}, t('No card published'))),
        ),
        h('span.board-figs', {},
          h('b.board-power.tnum', {}, powerText(pub)),
          h('span.board-cap', {}, t('best Power')),
          h('span.board-meta', {},
            rarityChip(pub.top?.lv ?? pub.topTier ?? 1),
            h('span.faint.tnum', {}, t('{n} cards', { n: pub.unique ?? 0 })),
          ),
        ),
      ),
    );
  }

  /* The viewer's own place, printed under the board when it is not on it. A
     member in the top twenty already sees their row; a second copy of the same
     name would only ask whether the list has a bug. */
  function paintMine(me, make) {
    if (!me) {
      foot.replaceChildren(
        h('div.board-note', {},
          tab === 'ranked'
            ? h('p', {}, t('You have not settled a duel yet — the arena files a record after both line-ups are committed.'))
            : h('p', {}, t('Your binder is not on the board yet — it starts the moment you open your first pack.')),
          h('a.btn.btn--primary.btn--sm', { href: tab === 'ranked' ? '#/arena' : '#/packs' },
            icon(tab === 'ranked' ? 'bolt' : 'sparkles'),
            h('span', {}, tab === 'ranked' ? t('Fight a duel') : t('Open the card binder'))),
        ),
      );
      return;
    }
    foot.replaceChildren(h('div.board-mine', {}, h('span.board-mine-label', {}, t('Your place')), make(me, Number(me.place) - 1)));
  }

  /* ---- ranked --------------------------------------------------------
     A duel row prints the four numbers the server wrote and nothing else: the
     wins, the losses they cost, the live run, and the peak Power that splits a
     tie. The division is the same chip a profile wears, so the board cannot say
     one thing about a member and the profile another. */
  function paintRankedTotals(totals) {
    const tiles = [
      { value: String(totals.duellists ?? 0), label: t('Duelists ranked') },
      { value: compactNumber(totals.fights ?? 0), label: t('Duels settled') },
      { value: String(totals.runs ?? 0), label: t('Longest run') },
    ];
    strip.replaceChildren(...tiles.map((tile) => h('div.board-tile', {},
      h('b.tnum', {}, tile.value),
      h('span', {}, tile.label),
    )));
  }

  function rankedRow(u, i) {
    const d = u.duel || {};
    const place = Number(u.place) > 0 ? Number(u.place) : i + 1;
    return h('li', {},
      h(
        `a.board-row.rk-row${place <= 3 ? `.is-top${place}` : ''}`,
        {
          href: `#/profile/${encodeURIComponent(u.id)}`,
          'aria-label': t('Open {name}', { name: shownName(u) }),
        },
        h('span.board-pos.tnum', {}, String(place)),
        h('span.board-who', {},
          avatar(u, { size: 'sm' }),
          h('span.board-names', {},
            h('b', {}, shownName(u)),
            h('span.faint', {}, `@${u.username}`),
            divisionChip(u),
          ),
        ),
        h('span.rk-figs', {},
          h('b.rk-wins.tnum', {}, `${Number(d.wins) || 0}–${Number(d.losses) || 0}`),
          h('span.rk-cap', {}, t('wins–losses')),
          h('span.rk-meta', {},
            h('span.rk-rate.tnum', {}, icon('trending'), `${Number(u.winRate) || 0}%`),
            Number(d.streak) > 0 ? h('span.rk-streak.tnum', {}, icon('flame'), String(d.streak)) : null,
            h('span.faint.tnum', {}, powerText(u.cards || {})),
          ),
        ),
      ),
    );
  }

  async function loadRanked() {
    strip.replaceChildren(...Array.from({ length: 3 }, () => h('div.board-tile', {}, h('div.skel-row'))));
    list.replaceChildren(...Array.from({ length: 8 }, skeleton));
    foot.replaceChildren();
    let data;
    try {
      data = await rankedBoard();
    } catch {
      strip.replaceChildren();
      list.replaceChildren(errorState(t('The ranked board'), loadRanked));
      return;
    }
    const users = data?.users || [];
    paintRankedTotals(data?.totals || {});
    if (!users.length) {
      list.replaceChildren(emptyState({
        iconName: 'bolt',
        heading: t('Nobody has settled a duel yet'),
        body: t('Pick three cards, commit them, and the arena files the first row on this board.'),
        action: h('a.btn.btn--primary', { href: '#/arena' }, icon('bolt'), h('span', {}, t('Enter the arena'))),
      }));
      return;
    }
    list.replaceChildren(...users.map(rankedRow));
    paintMine(data.me, rankedRow);
  }

  async function loadCollectors() {
    strip.replaceChildren();
    list.replaceChildren(...Array.from({ length: 8 }, skeleton));
    let data;
    try {
      data = await collectors(20);
    } catch {
      strip.replaceChildren();
      foot.replaceChildren();
      list.replaceChildren(errorState(t('The board'), loadCollectors));
      return;
    }
    const users = data?.users || [];
    paintTotals(data?.totals || {});
    if (!users.length) {
      list.replaceChildren(emptyState({
        iconName: 'sparkles',
        heading: t('Nobody has published a binder yet'),
        body: t('Open a pack, then pin your strongest card from the binder to appear here.'),
        action: h('a.btn.btn--primary', { href: '#/packs' }, icon('sparkles'), h('span', {}, t('Open the card binder'))),
      }));
      foot.replaceChildren();
      return;
    }
    list.replaceChildren(...users.map(row));
    paintMine(data.me, row);
  }

  function load() {
    if (tab === 'ranked') loadRanked();
    else loadCollectors();
  }

  wrap.append(head, tabs, strip, list, foot);
  paintHead();
  load();
  return wrap;
}
