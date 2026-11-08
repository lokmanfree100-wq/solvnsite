/**
 * The one line a visitor needs before somebody else's player starts.
 *
 * Both watch pages mount a frame they do not control, and two things about it can
 * surprise a person: an advert appearing in a new tab, and a press inside the
 * player taking this tab to the host's own page. The sandbox allows the second
 * only on a real press (`allow-top-navigation-by-user-activation` in
 * lib/sources.js), so it is a choice the viewer made and can undo with Back.
 * Say both, then get out of the way: the note fades by itself after three
 * seconds, because a warning still on screen during the good part has become the
 * thing in the way of the film. The full account — what the frame can reach and
 * what it cannot — lives in the safety panel under the player, where nobody is
 * being hurried.
 *
 * "Once" is remembered by the element it was mounted into rather than by a flag
 * each view has to keep: a silent server makes the ladder re-point the same
 * player, and the viewer should not be told twice about the same tab.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';

const SHOW_MS = 3000;
const FADE_MS = 320;

const told = new WeakSet();

export function showPlayAdvisory(mount, before = null) {
  if (!mount || told.has(mount)) return;
  told.add(mount);

  let timer = null;
  let gone = false;
  const fade = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add('is-gone');
    setTimeout(() => el.remove(), FADE_MS);
  };

  const el = h(
    'div.play-advisory',
    { role: 'note' },
    icon('info'),
    h(
      'div.play-advisory-copy',
      {},
      h('p.play-advisory-title', {}, t('This player belongs to another site')),
      h(
        'p.play-advisory-body',
        {},
        t('External redirects may occur. If redirected to another page, simply go back one step and the movie will play.'),
      ),
    ),
    h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: fade }, icon('play'), t('Agree and continue')),
  );

  mount.insertBefore(el, before);
  timer = setTimeout(fade, SHOW_MS);
}
