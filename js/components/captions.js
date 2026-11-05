/**
 * The caption switch both watch pages share.
 *
 * Captions are a property of the file, not of the site: an HLS manifest declares
 * subtitle renditions and a single `.mp4` can carry text tracks of its own, and
 * those are the only two cases anything here can switch. A framed player page
 * keeps its captions inside its own document, which a cross-origin frame never
 * shows to us, so on an embed this control has nothing to say and stays hidden.
 * A chip that opens an empty menu would be a button lying about the source —
 * worse than no button at all.
 *
 * The page keeps ownership of *what is playing* and hands it over through
 * `getOwner`, which returns anything shaped like the caption half of a stage
 * (`subTracks`, `subtitle`, `setSubtitle`): the anime stage, the film's direct
 * stream stage, or the clean room's plain `<video>` wrapped by
 * `captionControls()`. When that answer is empty, the chip removes itself.
 * `getSub` is the line under the sheet's heading, read when the sheet opens —
 * an episode title can change while the same chip is on screen.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast, sheet } from '../lib/ui.js';
import { TRACK_OFF } from '../lib/playback.js';

export function createCaptionControl({ getOwner, getSub }) {
  const owner = () => getOwner() || null;
  const tracks = () => {
    const o = owner();
    return o ? o.subTracks() : [];
  };

  const text = () => {
    const list = tracks();
    if (!list.length) return t('Off');
    const o = owner();
    const now = o.subtitle();
    if (now === TRACK_OFF) return t('Off');
    return list.find((s) => s.id === now)?.label || t('On');
  };

  function paint() {
    const has = tracks().length > 0;
    chip.classList.toggle('hide', !has);
    chip.replaceChildren(icon('caption'), h('span', {}, text()));
  }

  function open() {
    const o = owner();
    const list = tracks();
    if (!o || !list.length) return;
    const rows = [{ id: TRACK_OFF, label: t('Off') }, ...list];
    const grid = h('div.q-grid');
    const draw = () => {
      const cur = o.subtitle();
      grid.replaceChildren(
        ...rows.map((s) =>
          h(`button.check${s.id === cur ? '.is-on' : ''}`, {
            type: 'button',
            'aria-pressed': String(s.id === cur),
            onclick: () => {
              o.setSubtitle(s.id);
              draw();
              paint();
              toast(s.id === TRACK_OFF ? t('Subtitles off') : t('Subtitles: {label}', { label: s.label }), { tone: 'ok', iconName: 'check' });
            },
          }, s.id === cur ? icon('check') : null, h('span', {}, s.label)),
        ),
      );
    };
    draw();
    sheet({
      heading: t('Subtitles'),
      sub: getSub(),
      width: 430,
      render: () => h('div.stack', {},
        h('p', { style: { fontSize: '13.5px', color: 'var(--text-dim)', lineHeight: '1.6' } },
          t('These are the caption tracks this file actually carries. Picking one turns them on right away; Off turns them back off.')),
        grid,
      ),
    });
  }

  const chip = h('button.btn.btn--sm.btn--glass.q-chip.hide', {
    type: 'button',
    'aria-label': t('Subtitles'),
    onclick: open,
  }, icon('caption'), h('span', {}, t('Off')));

  return { node: chip, paint, has: () => tracks().length > 0 };
}
