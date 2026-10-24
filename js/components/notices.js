/**
 * The notice bell in the header.
 *
 * A bell is a handle, not a page: it opens a short list of what landed on the
 * titles this member follows, and every line in it is a link to the episode it
 * came to announce. The state lives in `lib/notices.js` — the same store the
 * header paints its count from — so a line that arrives over the inbox pipe shows
 * up here whether or not anybody is looking at it.
 *
 * Nothing here makes a sound when a notice lands. An arrival is something you go
 * and read; the count on the handle is the alert, and a bell that rang on its own
 * every ten minutes would only teach people to mute the tab.
 */

import { h, icon } from '../lib/dom.js';
import { relativeTime } from '../lib/util.js';
import { sfx } from '../lib/sounds.js';
import { t } from '../lib/i18n.js';
import { isSignedIn } from '../lib/account.js';
import {
  markNoticeRead,
  noticesState,
  noticesUsable,
  openNotices,
  subscribeNotices,
  wipeNotices,
} from '../lib/notices.js';

/* The handle only exists where a notice can be stored: a static export has no
   schedule to read, and a signed-out visitor has no list to follow. */
const bellWanted = () => noticesUsable() && isSignedIn();

const noteHref = (n) => (n.kind === 'aired' && Number(n.ep) > 0 ? `#/watch/${n.media}/${n.ep}` : `#/anime/${n.media}`);

const noteLine = (n) =>
  n.kind === 'finished'
    ? t('Finished airing')
    : Number(n.count) > 1
      ? t('{n} new episodes aired', { n: n.count })
      : t('Episode {n} aired', { n: n.ep });

let bellBtn = null;
let bellDot = null;
let panel = null;
let shut = null;

function paintBell() {
  if (!bellBtn) return;
  const wanted = bellWanted();
  bellBtn.hidden = !wanted;
  if (!wanted) {
    if (shut) shut();
    return;
  }
  const s = noticesState();
  bellDot.textContent = s.unread > 99 ? '99+' : String(s.unread);
  bellDot.hidden = !s.unread;
  bellBtn.classList.toggle('is-new', s.unread > 0);
  bellBtn.setAttribute('aria-label', s.unread ? t('{n} unread notices', { n: s.unread }) : t('Notifications'));
  if (panel?.isConnected) paintPanel();
}

/* The bell number is the whole reason the store exists: one text node, repainted
   on every emit, rather than a rebuilt header that would throw away the search box
   mid-type. */
subscribeNotices(() => paintBell());

function rowOf(n) {
  return h(
    `a.note-row${n.read ? '' : '.is-new'}`,
    { href: noteHref(n), onclick: () => markNoticeRead(n.id) },
    icon(n.kind === 'finished' ? 'crown' : 'bolt', { cls: 'note-mark' }),
    h(
      'span.note-text',
      {},
      h('span.note-title', {}, n.title || t('A saved title')),
      h('span.note-line', {}, noteLine(n)),
    ),
    h('span.note-when.tnum', {}, relativeTime(n.at)),
  );
}

function paintPanel() {
  if (!panel?.isConnected) return;
  const s = noticesState();
  const body = h('div.note-list', { role: 'list' });
  if (!s.loaded) {
    body.append(h('p.note-hint', {}, t('Checking the schedule…')));
  } else if (s.failed && !s.notes.length) {
    body.append(h('p.note-hint', {}, t('The bell could not reach the schedule just now.')));
  } else if (!s.notes.length) {
    body.append(
      h('p.note-hint', {}, t('No notices yet.')),
      h('p.note-sub', {}, t('New episodes of the titles you save show up here.')),
    );
  } else {
    for (const n of s.notes) body.append(rowOf(n));
    if (s.failed) body.append(h('p.note-sub', {}, t('This list may be a little behind.')));
  }

  const foot = h('div.note-foot', {});
  if (s.unread) {
    foot.append(
      h(
        'button.btn.btn--ghost',
        {
          type: 'button',
          onclick: () => {
            sfx.click();
            markNoticeRead(null);
          },
        },
        icon('check'),
        t('Mark all read'),
      ),
    );
  }
  if (s.notes.length) {
    foot.append(
      h(
        'button.btn.btn--ghost',
        {
          type: 'button',
          onclick: () => {
            sfx.click();
            wipeNotices();
          },
        },
        icon('trash'),
        t('Clear'),
      ),
    );
  }

  panel.replaceChildren(
    ...[
      h(
        'div.note-head',
        {},
        h('span.note-title-site', {}, t('Notifications')),
        h('span.note-count.tnum', { hidden: !s.unread }, String(s.unread)),
      ),
      body,
      foot.childElementCount ? foot : null,
    ].filter(Boolean),
  );
}

export function noticeBell() {
  const wrap = h('div.bell-wrap', {});
  bellBtn = h(
    'button.icon-btn.btn--bell',
    {
      type: 'button',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      hidden: !bellWanted(),
      title: t('Notifications'),
      onclick: () => (shut ? shut() : openBell()),
    },
    icon('bell'),
    h('span.note-dot.tnum', { hidden: true }, ''),
  );
  bellDot = bellBtn.querySelector('.note-dot');

  const open = () => {
    panel = h('div.bell-menu', { role: 'dialog', 'aria-label': t('Notifications') });
    const outside = (e) => {
      if (!wrap.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    function close() {
      panel?.remove();
      panel = null;
      shut = null;
      bellBtn?.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', onKey);
    }
    wrap.append(panel);
    bellBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', onKey);
    shut = close;
    paintPanel();
    /* Opening the bell is the intent, so this is the one moment the app asks the
       server what it noticed — and hands up the list again so a title saved since
       the last jump is followed too. */
    openNotices().then(paintBell);
  };

  paintBell();
  wrap.append(bellBtn);
  return wrap;
}

/** The header is thrown away on every route change, so the menu goes with it. */
export function disposeBell() {
  shut?.();
  bellBtn = null;
  bellDot = null;
}
