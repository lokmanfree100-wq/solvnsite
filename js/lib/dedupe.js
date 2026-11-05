/**
 * One title, once per page.
 *
 * TMDB's own shelves overlap: a film can genuinely be in "Now Playing" and
 * "Upcoming" at the same moment, "Popular" and "Top Rated" share half their
 * list, and a genre query returns the same blockbusters any other query would.
 * An offline snapshot carries that overlap straight through — which is how the
 * same two posters ended up leading three rows on one page.
 *
 * So de-duplicating is the page's job, not the API's. Rails answer in whatever
 * order the network replies, so each claim queues behind the section above it:
 * the order a viewer reads the page is the order titles get taken, and an id
 * claimed by one shelf can never surface in another, however many queries ask
 * for it. A row that loses titles to the section above it still has the rest of
 * its page to fill from.
 *
 * `keyOf` decides what makes two entries the same title. TMDB keeps separate
 * number sequences for films and series, so an id alone can name a movie and a
 * show at once — a page that mixes both halves stamps the type on the key.
 */
export function makeDeduper(keyOf = (m) => m.id) {
  const taken = new Set();
  let turn = Promise.resolve();

  const take = (items) => {
    const fresh = [];
    for (const m of items || []) {
      const key = m ? keyOf(m) : null;
      if (!key || taken.has(key)) continue;
      taken.add(key);
      fresh.push(m);
    }
    return fresh;
  };

  return {
    /** `after` is a claim that must be honoured first even if it answers later,
        e.g. the spotlight, which is still fetching while the rails below it are
        already asking. Without it the section that wins is whoever's CDN was
        quickest, and the hero ends up repeating a poster the viewer just saw. */
    claim(items, { after } = {}) {
      const mine = turn
        .then(() => (after ? after.catch(() => {}) : undefined))
        .then(() => take(items));
      turn = mine.then(
        () => {},
        () => {},
      );
      return mine;
    },
    /** For rows painted straight from local data, before anything resolves. */
    claimSync: take,
  };
}
