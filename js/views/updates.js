/** Updates: the airing schedule as a week list or a month calendar. */

import { h, icon } from '../lib/dom.js';
import { scheduleRange } from '../lib/anilist.js';
import { settings } from '../lib/store.js';
import { title, formatLabel, yearOf, countdown, intlDate, intlTime, dayName } from '../lib/util.js';
import { emptyState, errorState } from '../components/media.js';
import { sheet, toast } from '../lib/ui.js';
import { t } from '../lib/i18n.js';

const DAY = 86400;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function spinner() {
  return h('div', { style: { padding: '60px 0', display: 'grid', placeItems: 'center' } }, h('div.spinner', { style: { width: '26px', height: '26px' } }));
}

/** Monday-first grid that covers the whole month, including the bleed days. */
function monthWindow(at) {
  const first = new Date(at.getFullYear(), at.getMonth(), 1);
  const last = new Date(at.getFullYear(), at.getMonth() + 1, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const end = new Date(last);
  end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7)));
  return { start, end, first, last };
}

export async function UpdatesView() {
  const wrap = h('div.page-updates');
  const body = h('div');
  const heading = h('h1.display', {}, t('Airing this week'));
  const blurb = h('p', {}, t('Every episode scheduled over the next seven days, in your local time.'));

  let mode = settings.get('scheduleView') === 'calendar' ? 'calendar' : 'list';
  let cursor = new Date();
  /* Each view asks for a different window, so keep the last answer per view
     instead of re-fetching a month the viewer has already looked at. */
  const cache = new Map();

  const now = Math.floor(Date.now() / 1000);
  const allowNsfw = settings.get('showNsfw');

  const seg = h('div.seg', { role: 'group', 'aria-label': t('Schedule view') },
    ...['list', 'calendar'].map((k) =>
      h(`button${mode === k ? '.is-active' : ''}`, {
        type: 'button',
        'aria-pressed': String(mode === k),
        onclick: (e) => {
          if (mode === k) return;
          mode = k;
          settings.set('scheduleView', k);
          [...e.currentTarget.parentElement.children].forEach((b, i) => {
            const on = ['list', 'calendar'][i] === mode;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', String(on));
          });
          paintHead();
          load();
        },
      }, k === 'list' ? t('List') : t('Calendar')),
    ),
  );

  const reloadBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => { cache.clear(); load(); } }, icon('refresh'), t('Refresh'));
  const tzBtn = h('button.btn.btn--sm', { type: 'button', onclick: () => toast(t('Times shown in your device timezone'), { iconName: 'clock' }) }, icon('clock'), intlTime(Date.now(), { timeZoneName: 'short' }));

  const monthPrev = h('button.icon-btn', { type: 'button', 'aria-label': t('Previous month'), onclick: () => shift(-1) }, icon('chevronLeft', { cls: 'flip' }));
  const monthNext = h('button.icon-btn', { type: 'button', 'aria-label': t('Next month'), onclick: () => shift(1) }, icon('chevronRight', { cls: 'flip' }));
  const monthName = h('span.badge');
  const monthRow = h('div.rowline', { style: { gap: '8px' } }, monthPrev, monthName, monthNext);

  function shift(delta) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    paintHead();
    load();
  }

  function paintHead() {
    const cal = mode === 'calendar';
    heading.textContent = cal ? intlDate(cursor.getTime(), { month: 'long', year: 'numeric' }) : t('Airing this week');
    blurb.textContent = cal
      ? t('A month of airings. Pick a day to read the whole line-up.')
      : t('Every episode scheduled over the next seven days, in your local time.');
    monthRow.replaceChildren(...(cal ? [monthPrev, monthName, monthNext] : []));
    if (cal) monthName.textContent = intlDate(cursor.getTime(), { month: 'long' });
  }

  async function load() {
    const key = mode === 'calendar' ? `cal:${cursor.getFullYear()}-${cursor.getMonth()}` : 'week';
    body.replaceChildren(spinner());
    if (cache.has(key)) return paint(cache.get(key));
    const win = mode === 'calendar' ? monthWindow(cursor) : null;
    const from = Math.floor(dayStart(win ? win.start : new Date()) / 1000);
    const to = win ? Math.floor(dayStart(win.end) / 1000) : from + 7 * DAY;
    try {
      const slots = (await scheduleRange(from, to)).filter((s) => (allowNsfw ? true : !s.media?.isAdult));
      cache.set(key, slots);
      paint(slots);
    } catch {
      body.replaceChildren(errorState(t('The schedule'), load));
    }
  }

  function paint(slots) {
    if (!slots.length) {
      body.replaceChildren(
        emptyState({
          iconName: 'calendar',
          heading: t('Nothing scheduled'),
          body: t('Nothing is airing in this window for this filter.'),
        }),
      );
      return;
    }
    body.replaceChildren(mode === 'calendar' ? calendar(slots) : weekList(slots));
  }

  /* ---- list ---- */
  function weekList(slots) {
    const groups = new Map();
    for (const s of slots) {
      const key = new Date(s.airingAt * 1000).toDateString();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const ordered = [...groups.entries()].sort((a, b) => a[1][0].airingAt - b[1][0].airingAt);
    return h(
      'div.stack',
      { style: { gap: 'var(--sp-6)' } },
      ...ordered.map(([day, list]) =>
        h('section.day-group', {},
          h('div.day-head', {},
            h('h3', {}, dayName(list[0].airingAt)),
            h('span.date', {}, intlDate(list[0].airingAt * 1000, { month: 'short', day: 'numeric' })),
            h('span.line'),
            h('span.badge', {}, String(list.length)),
          ),
          h('div.stack', { style: { gap: '8px' } }, ...list.map(airItem)),
        ),
      ),
    );
  }

  /* ---- calendar ---- */
  function calendar(slots) {
    const byDay = new Map();
    for (const s of slots) {
      const key = new Date(s.airingAt * 1000).toDateString();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(s);
    }
    const { start, end } = monthWindow(cursor);
    const cells = [];
    for (let d = new Date(start); d < end && cells.length < 42; d.setDate(d.getDate() + 1)) cells.push(new Date(d));
    const todayKey = new Date().toDateString();
    const weekdays = cells.slice(0, 7).map((d) => intlDate(d.getTime(), { weekday: 'short' }));

    return h('div.cal', {},
      h('div.cal-week', {}, ...weekdays.map((w) => h('span.cal-wd', {}, w))),
      h('div.cal-grid', {}, ...cells.map((d) => {
        const list = byDay.get(d.toDateString()) || [];
        const cls = `cal-cell${d.getMonth() !== cursor.getMonth() ? '.is-bleed' : ''}${d.toDateString() === todayKey ? '.is-today' : ''}${list.length ? '.is-live' : ''}`;
        const kids = [
          h('span.cal-n.tnum', {}, String(d.getDate())),
          ...list.slice(0, 3).map((s) =>
            h('span.cal-item.clamp-1', {},
              h('b.tnum', {}, intlTime(s.airingAt * 1000, { hour: 'numeric', minute: '2-digit' })),
              ` ${title(s.media)}`,
            ),
          ),
          list.length > 3 ? h('span.cal-more', {}, t('+{n} more', { n: list.length - 3 })) : null,
        ];
        /* Only a day with something airing becomes a button, so no cell is a
           dead control wearing a hover state. */
        return h(list.length ? `button.${cls}` : `div.${cls}`, list.length ? { type: 'button', onclick: () => openDay(d, list) } : null, ...kids);
      })),
    );
  }

  function openDay(d, list) {
    sheet({
      heading: dayName(Math.floor(d.getTime() / 1000)),
      sub: intlDate(d.getTime(), { month: 'long', day: 'numeric', year: 'numeric' }),
      width: 620,
      render: () => h('div.stack', { style: { gap: '8px' } }, ...list.map(airItem)),
    });
  }

  function airItem(s) {
    const m = s.media;
    const past = s.airingAt * 1000 < Date.now();
    return h(
      'a.air-item',
      // An episode that has not aired yet has nothing to play, so send people to
      // the series page instead of a dead player.
      { href: past ? `#/watch/${m.id}/${s.episode}` : `#/anime/${m.id}` },
      m.coverImage?.large ? h('img', { src: m.coverImage.large, alt: '', loading: 'lazy' }) : h('div', { style: { width: '46px', aspectRatio: '2/3', borderRadius: 'var(--r-xs)', background: 'var(--surface-3)' } }),
      h('div.grow', {},
        h('div', { style: { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: '14px' }, class: 'clamp-1' }, title(m)),
        h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } },
          `${formatLabel(m.format)}${yearOf(m) ? ` · ${yearOf(m)}` : ''} · ${t('Ep {n}', { n: s.episode })}`),
      ),
      h('div.air-when', {},
        past ? t('Aired') : countdown(s.airingAt),
        h('span', {}, intlTime(s.airingAt * 1000, { hour: 'numeric', minute: '2-digit' })),
      ),
    );
  }

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('UPDATES')),
      heading,
      blurb,
      h('div.rowline.wrap', { style: { marginTop: 'var(--sp-4)', gap: '8px' } }, seg, monthRow, reloadBtn, tzBtn),
    ),
    body,
  );
  paintHead();
  load();
  return wrap;
}
