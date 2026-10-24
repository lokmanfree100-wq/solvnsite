/**
 * Episode lists. The watch page owns the player itself (see lib/sources.js);
 * this module only turns AniList's sparse, unnumbered episode data into the
 * rail and up-next rows the interface shows.
 */

/**
 * Build a displayable episode list. AniList's curated episode list is sparse,
 * carries no episode number field, and its streaming URLs are opaque hashes
 * (`/watch/GYK5PJV7R/enter-naruto-uzumaki`), so the number has to be read out of
 * the entry title. Anything not covered by that list becomes a numbered
 * placeholder derived from the title's episode count.
 */
export function buildEpisodes(media, streamed = []) {
  const list = (streamed || []).map((s) => ({ s, n: episodeNumber(s) }));
  // Position is only trustworthy as a number when nothing in the list is
  // numbered: AniList does return curated episodes out of order (One Piece's
  // capped list starts at "Episode 130"), so index must never override a read.
  const positional = list.length > 0 && list.every((e) => !e.n);

  const byNum = new Map();
  list.forEach(({ s, n }, i) => {
    const num = n || (positional ? i + 1 : 0);
    if (!num || byNum.has(num)) return;
    byNum.set(num, {
      number: num,
      title: episodeName(s.title, num),
      thumb: s.thumbnail || null,
      desc: null,
    });
  });

  const total = resolveEpisodeCount(media);
  const out = [];
  for (let n = 1; n <= total; n++) {
    out.push(byNum.get(n) || { number: n, title: null, thumb: null, desc: null });
  }
  // Surface curated episodes that fall outside the reported count.
  for (const [n, v] of byNum) if (n > total) out.push(v);
  return out.sort((a, b) => a.number - b.number);
}

/* Numbered phrases come first, then the URL shapes some sites use instead. */
const EP_NUMBER = [
  /(?:episode|ep\.?|no\.?|#)\s*[-–:.]*\s*(\d{1,4})/i,
  /^\s*(\d{1,4})\s*[).\]:-]\s+\S/,
  /[-_/ ]ep(?:isode)?[-_]?(\d{1,4})(?!\d)/i,
  /[?&](?:ep|episode|n)=(\d{1,4})/i,
  /\/(\d{1,4})(?:[/?#]|$)/,
];

function episodeNumber(entry) {
  for (const re of EP_NUMBER) {
    for (const hay of [entry?.title, entry?.url]) {
      const m = re.exec(String(hay || ''));
      if (m && Number(m[1]) > 0) return Number(m[1]);
    }
  }
  return 0;
}

/** Drop the "Episode 12 - " lead: the row already prints the number. */
function episodeName(raw, n) {
  const t = (raw || '').trim();
  if (!t) return null;
  const stripped = t
    .replace(/^\s*(?:episode|ep\.?|no\.?|#)\s*[-–:.]*\s*\d{1,4}\s*[-–:.]*\s*/i, '')
    .trim();
  if (!stripped || stripped === String(n)) return null;
  return stripped;
}

/**
 * AniList has no single "how many episodes exist" field, so take the strongest
 * signal per case. `streamingEpisodes` is a capped list (~69 entries) and must
 * never outrank a live count, otherwise long-running titles like One Piece get
 * a rail that stops at 69.
 */
export function resolveEpisodeCount(media) {
  if (!media) return 1;
  if (media.format === 'MOVIE' || media.status === 'NOT_YET_RELEASED') return 1;

  const planned = Number(media.episodes) || 0;
  const airing = Number(media.nextAiringEpisode?.episode) || 0;
  const streamed = Number(media.streamingEpisodes?.length) || 0;

  const total = Math.max(planned, airing ? airing - 1 : 0, streamed);
  if (total) return total;
  return 12;
}

/**
 * Whether `resolveEpisodeCount()` actually learned the number or only guessed a
 * floor. The retro shelves are full of long runners that AniList lists without
 * a count at all — Detective Conan, Crayon Shin-chan, the 2005 Doraemon — and
 * twelve is where their rail starts, not where the show ends. A caller that
 * would grey out "next" at the bottom of that guess uses this to stop treating
 * the floor as a fact.
 */
export function episodeCountIsGuess(media) {
  if (!media || media.format === 'MOVIE' || media.status === 'NOT_YET_RELEASED') return false;
  const signals =
    (Number(media.episodes) || 0) +
    (Number(media.nextAiringEpisode?.episode) || 0) +
    (Number(media.streamingEpisodes?.length) || 0);
  return signals === 0;
}
