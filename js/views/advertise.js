/**
 * Advertise on Solvn — the pitch page, written for whoever might buy the banner.
 *
 * Everything on it is read from data/sponsor.json, the same file the banner
 * itself comes from, so the page cannot quote an audience the advert is not
 * standing in front of. Where the owner has not published a number yet the page
 * says that out loud instead of inventing one, and where there is no contact
 * address it offers no button, because a dead one is worse than none.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { compactNumber } from '../lib/util.js';
import { currentPitch, currentSlot, loadSponsor } from '../lib/sponsor.js';
import { adSlot } from '../components/sponsor.js';

const panel = (iconName, heading, ...kids) =>
  h('section.ad-panel.glass', {}, h('h2.panel-title', {}, icon(iconName), heading), ...kids);

const line = (label, value) =>
  h('div.ad-line', {}, h('span.ad-line-k', {}, label), h('span.ad-line-v', {}, String(value)));

/* ---- what the buyer is paying for -------------------------------------- */
function theSlot() {
  const spec = [
    line(t('Position'), t('One banner above the footer, on every browsing page')),
    line(t('Image'), t('One JPG, PNG or WebP, 970 × 160 at most, hosted by you')),
    line(t('Reach'), t('The picture links out in a new tab — your landing page never moves the viewer')),
    line(t('Term'), t('Sold by the month, and it stops on the last day by itself')),
    line(t('Exclusivity'), t('One advertiser at a time — nothing rotates, nothing shares the slot')),
  ];
  const live = currentSlot();
  const showing = live
    ? h('div.ad-running', {}, h('p.faint', {}, t('What a visitor sees today:')), adSlot())
    : h('p.muted', {}, t('No banner is running right now — which is what an unclaimed slot looks like.'));
  return panel('monitor', t('The slot'), ...spec, showing);
}

/* ---- who comes here ---------------------------------------------------- */
function audience(p) {
  if (!p.visitorsPerDay) {
    return panel(
      'users',
      t('The audience'),
      h(
        'p.muted',
        {},
        t(
          'The traffic figures have not been published yet, so this page is not going to guess at them. Ask for them and they will be sent from the site’s own counter.',
        ),
      ),
    );
  }
  const rows = [
    line(t('Visitors a day'), compactNumber(p.visitorsPerDay)),
    p.pagesPerVisit ? line(t('Pages per visit'), String(p.pagesPerVisit)) : null,
    p.topCountries.length ? line(t('Where they come from'), p.topCountries.join(' · ')) : null,
  ].filter(Boolean);
  return panel('users', t('The audience'), ...rows);
}

/* ---- the rules, said before the money changes hands -------------------- */
function rules() {
  const items = [
    t('No pop-unders, and nothing that opens a tab the viewer did not click'),
    t('No download prompts, no “update your player”, no install requests'),
    t('No betting, no crypto signals, no adult material'),
    t('No tracking pixels fired on our page — the banner is an image and a link'),
    t('The click is labelled “Advertisement”, so the viewer knows what they are taking'),
  ];
  return panel(
    'shield',
    t('What we will not carry'),
    h('p.muted', {}, t('These are not preferences. A site that interrupts a person watching something is a site people leave, and the slot is worth nothing to you if they do.')),
    h('ul.ad-rules', {}, ...items.map((s) => h('li', {}, icon('check'), s))),
  );
}

/* ---- price and contact ------------------------------------------------- */
function terms(p) {
  const rate = p.ratePerMonth
    ? h('p.ad-rate', {}, h('span.ad-rate-n.tnum', {}, `${p.ratePerMonth} ${p.currency}`), h('span.faint', {}, t('per month')))
    : h('p.muted', {}, t('No price is published on this page — say what you want the slot for and ask.'));

  const copy = h(
    'button.btn.btn--sm',
    {
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(p.contactEmail);
          toast(t('Address copied'), { tone: 'ok', iconName: 'check' });
        } catch {
          toast(t('Copy it from the line above.'), { tone: 'err', iconName: 'alert' });
        }
      },
    },
    icon('edit'),
    t('Copy'),
  );

  const contact = p.contactEmail
    ? h(
        'div.rowline.wrap',
        { style: { gap: '8px' } },
        h('a.btn.btn--sm.btn--primary', { href: `mailto:${p.contactEmail}` }, icon('chat'), t('Write to us')),
        h('span.ad-contact-plain', {}, p.contactEmail),
        copy,
      )
    : h('p.muted', {}, t('No contact address has been published on this page yet.'));

  return panel('crown', t('Terms'), rate, contact);
}

/* ---- the page ----------------------------------------------------------- */
export async function AdvertiseView() {
  const wrap = h('div.page-advertise');
  const body = h('div.ad-panels');

  wrap.append(
    h(
      'header.ad-lead',
      {},
      h('h1', {}, t('Advertise on Solvn')),
      h('p', {}, t('Solvn is an anime, film and series catalogue read by people who came to watch something. One banner, one advertiser at a time, sold directly — no ad network, no rotation, no script of yours runs on this page.')),
    ),
  );
  wrap.append(body);

  const paint = () => {
    const p = currentPitch();
    body.replaceChildren(audience(p), theSlot(), rules(), terms(p));
  };

  paint();
  await loadSponsor();
  paint();
  return wrap;
}
