/**
 * The rewarded break, and the one place a paid ad slot would ever attach.
 *
 * Solvn cannot sell a real rewarded video today. Every network that serves one —
 * AdMob, AppLovin, Unity — approves a property before it pays out, and a site that
 * streams shows it does not licence is never approved. The networks that will take
 * such a site hand over pop-unders and redirect scripts, which is the worst possible
 * neighbour for a player the app goes out of its way to lock.
 *
 * So the break is told straight: thirty seconds in front of Solvn's own spot, and a
 * pack at the end. Nothing here pretends to be money that has not been earned.
 *
 * When an approved account does arrive, one thing changes — a new provider in
 * PROVIDERS below and the three-word answer of `adProvider()`. The sheet, the
 * countdown, the cancel path and the reward all talk to `requestRewardedAd()` and
 * nothing else, so no view ever needs to know who paid for the pack.
 */

import { h, icon } from './dom.js';
import { t } from './i18n.js';
import { sheet } from './ui.js';
import { LOGO_SRC } from './brand.js';

/** The watch a viewer agrees to, in seconds. */
export const BREAK_SECONDS = 30;

/* The spot's own links — the only advertising allowed on this site, because it is
   Solvn's own and it points somewhere legal. A donation or affiliate address goes
   here once the owner has one; an entry with no address is left out rather than
   rendered as a dead button. */
const SPOT_LINKS = [{ label: 'Watch legally on Crunchyroll', href: 'https://www.crunchyroll.com/' }];

/**
 * A provider is `{ id, paid, run }`. `paid` is what the sheet prints in its own
 * corner, so a viewer is never told a sponsor paid for a break that paid nothing,
 * and never told nothing was paid once one is.
 *
 * `run({ seconds, onTick, onComplete })` owns the watching and calls `onComplete()`
 * once the viewer has genuinely seen the whole thing. It returns the function that
 * stops it.
 */
const PROVIDERS = {
  spot: {
    id: 'spot',
    paid: false,
    label: 'Solvn spot',
    run: ({ seconds, onTick, onComplete }) => {
      let done = false;
      let until = Date.now() + seconds * 1000;
      const tick = () => {
        if (done) return;
        /* Time only counts while the spot is on screen. A hidden tab throttles this
           timer to a crawl, so the clock is pushed forward instead — which is what
           keeps "thirty seconds of watching" true rather than nominal. */
        if (document.hidden) {
          until += 1000;
          return;
        }
        const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
        onTick(left);
        if (left > 0) return;
        done = true;
        clearInterval(loop);
        onComplete();
      };
      const loop = setInterval(tick, 250);
      tick();
      return () => clearInterval(loop);
    },
  },
};

/** The provider in play — one line, and the only one a real account would move. */
const adProvider = () => PROVIDERS.spot;

/** Whether somebody is paying for these breaks yet. The copy reads this, never guesses. */
export const isPaidAd = () => adProvider().paid;

/**
 * Ask for one watched break. Resolves `true` when the viewer sat through the whole
 * thing and `false` when they left early or closed the sheet — and `false` grants
 * nothing, which is the entire difference between this and a free pack.
 */
export function requestRewardedAd({ seconds = BREAK_SECONDS } = {}) {
  return new Promise((resolve) => {
    const source = adProvider();
    let settled = false;
    let stop = null;
    let api = null;

    const finish = (reward) => {
      if (settled) return;
      settled = true;
      stop?.();
      api?.close();
      resolve(reward);
    };

    const meter = h('b.ad-count.tnum', {}, `${seconds}s`);
    const ring = h('div.ad-ring');
    const note = h('p.ad-note', {}, t('Stay on this page for the whole break.'));
    const claim = h(
      'button.btn.btn--primary',
      { type: 'button', disabled: true, onclick: () => finish(true) },
      icon('gift'),
      h('span', {}, t('Claim the reward')),
    );

    const body = h(
      'div.ad-break',
      {},
      h('div.ad-stage', {}, h('img.ad-art', { src: LOGO_SRC, alt: '' }), ring, meter),
      h('p.ad-tag', {}, icon('sparkles'), t(source.label)),
      h(
        'p.muted',
        {},
        isPaidAd()
          ? t('One pack and a step of luck, paid for by the break you are watching.')
          : t('Solvn is not big enough for an ad network to pay for it yet, so this break shows you Solvn. Finish it and the pack is yours.'),
      ),
      h(
        'div.ad-links',
        {},
        ...SPOT_LINKS.filter((l) => l.href).map((l) =>
          h('a.ad-link', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), h('span', {}, t(l.label))),
        ),
      ),
      note,
    );

    api = sheet({
      heading: t('Luck break'),
      sub: t('One pack and a luck step for {n} seconds of watching.', { n: String(seconds) }),
      width: 520,
      render: () => body,
      footer: [claim, h('button.btn', { type: 'button', onclick: () => finish(false) }, h('span', {}, t('End break early')))],
    });
    api.onClose(() => finish(false));

    stop = source.run({
      seconds,
      onTick: (left) => {
        meter.textContent = `${left}s`;
        ring.style.setProperty('--ad-fill', String(1 - left / seconds));
      },
      onComplete: () => {
        meter.textContent = t('Done');
        ring.style.setProperty('--ad-fill', '1');
        note.textContent = t('Break watched. Claim it before you leave.');
        claim.disabled = false;
        claim.focus();
      },
    });
  });
}
