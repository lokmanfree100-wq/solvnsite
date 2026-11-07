/**
 * The one sponsored banner on the page, and the honesty around it.
 *
 * It is mounted above the footer, not beside the player: the watch page keeps its
 * viewport the way every other promise on this site says it should, and an advert
 * that competes with the picture is the mistake this site was built to avoid.
 *
 * The link opens a new tab because a banner that navigates the reader's own page
 * away is the behaviour the frame sandbox refuses from third-party players, and it
 * would be an odd thing to start doing ourselves. `rel="sponsored nofollow"` says
 * what it is to a search engine, `no-referrer` says as little as possible to the
 * advertiser, and the caption underneath is the same in every language: this
 * banner is paid, and Solvn does not vouch for where it goes.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { currentSlot, loadSponsor } from '../lib/sponsor.js';

/* The advert is not shown to the person administering the site or to whoever is
   changing their own settings — neither is an audience, and a banner that follows
   you into the desk makes a moderation screen harder to read. */
const PRIVATE = /^\/(admin|settings)(\?|$)/;

function cardOf(s) {
  /* A banner whose picture will not load is not half an advert: an empty frame
     that still clicks through to an unknown site is the worst version of this,
     so the whole slot comes off the page when the image fails. */
  const img = h('img.ad-img', {
    src: s.image,
    alt: s.alt || '',
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
    onerror: () => {
      const root = img.closest('.ad-slot');
      if (root) root.remove();
    },
  });
  return h(
    'aside.ad-slot',
    {},
    s.preview ? h('p.ad-preview-flag', {}, icon('eye'), t('Preview on this device only — not published yet.')) : null,
    h(
      'a.ad-card',
      {
        href: s.url,
        target: '_blank',
        rel: 'sponsored nofollow noopener',
        'aria-label': s.advertiser ? `${s.advertiser} — ${t('Advertisement')}` : t('Advertisement'),
      },
      img,
    ),
    h(
      'p.ad-caption',
      {},
      h('span.ad-caption-tag', {}, t('Advertisement')),
      s.advertiser ? h('span.ad-caption-who', {}, s.advertiser) : null,
      h('span.ad-caption-note', {}, t('Solvn chose nothing here and does not vouch for where it goes.')),
    ),
  );
}

/**
 * A box that fills itself with the banner once data/sponsor.json answers, and
 * stays gone when there is nothing to show. Painted again on every preview
 * switch and every language change, because the footer re-renders for both.
 */
export function adSlot() {
  const path = String(location.hash || '').replace(/^#/, '').split('?')[0];
  if (PRIVATE.test(path)) return null;
  const box = h('div.ad-mount');
  const paint = () => {
    const s = currentSlot();
    box.replaceChildren(...(s ? [cardOf(s)] : []));
  };
  paint();
  loadSponsor().then(paint);
  return box;
}
