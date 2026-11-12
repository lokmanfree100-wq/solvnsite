/**
 * The one line a visitor needs before somebody else's player starts.
 *
 * Both watch pages mount a frame they do not control. One thing about it can
 * surprise a person: an advert painted inside the picture, in somebody else's
 * colours. What it cannot do is leave that box — `FRAME_SANDBOX` in
 * lib/sources.js omits `allow-popups`, every top-navigation token and
 * `allow-downloads`, so the browser refuses new tabs, movement of this page and
 * files on the device before the frame's own code ever runs. The note says the
 * one true thing (ads may appear in their box) and promises the containment.
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
      h('p.play-advisory-title', {}, t('Partner stream')),
      h(
        'p.play-advisory-body',
        {},
        t('An ad may appear inside the picture. The frame cannot open tabs, move this page or download files.'),
      ),
    ),
    h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: fade }, icon('play'), t('Agree and continue')),
  );

  mount.insertBefore(el, before);
  timer = setTimeout(fade, SHOW_MS);
}
