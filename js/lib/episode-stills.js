/**
 * Per-episode artwork, keyed by the episode number AniList uses.
 *
 * AniList's `streamingEpisodes` only carries the latest slice of a long show,
 * and returns nothing for many finished titles, so using it alone made old
 * episodes fall back to the title banner. AniZip maps the same AniList id to
 * TVDB episode records, which carry one still per episode and the episode title
 * and summary. The endpoint is public and CORS-enabled; a failed call is cached
 * as an empty map so a missing provider never holds a rail hostage.
 */

const cache = new Map();
const TIMEOUT = 5000;

export function episodeStills(anilistId) {
  const id = Number(anilistId);
  if (!id) return Promise.resolve(new Map());
  if (cache.has(id)) return cache.get(id);

  const job = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${id}`, {
        signal: ctrl.signal,
        cache: 'default',
      });
      if (!res.ok) return new Map();
      const data = await res.json();
      const out = new Map();
      for (const [key, ep] of Object.entries(data?.episodes || {})) {
        /* `S1` / `O1` are specials, not season episodes. */
        if (!/^\d+$/.test(key) || !ep?.image) continue;
        const n = Number(ep.episodeNumber) || Number(key);
        if (!n) continue;
        out.set(n, {
          thumb: ep.image,
          title: ep.title?.en || ep.title?.['x-jat'] || ep.title?.ja || null,
          desc: ep.overview || ep.summary || null,
          duration: Number(ep.runtime) || null,
        });
      }
      return out;
    } catch {
      return new Map();
    } finally {
      clearTimeout(timer);
    }
  })();

  cache.set(id, job);
  return job;
}
