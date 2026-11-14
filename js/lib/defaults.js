/**
 * The sources every visitor gets.
 *
 * Settings ▸ Streaming servers writes to one browser's own storage, which is
 * right for a viewer choosing their player and wrong for a site: the operator
 * would be configuring their laptop, not the deployment, and every member who
 * never opened Settings would meet "No video source is configured yet". Entries
 * here are the deploy-time half — tried first-class by the anime ladder, passed
 * through the same gate as a typed entry (`templateProblem`, so https-only and a
 * blocked host stays blocked even from inside the repo), and listed after
 * anything the device added itself.
 *
 * Every entry is framed under `FRAME_SANDBOX` in `lib/sources.js`: scripts, its
 * own origin and forms, and nothing else. The browser therefore refuses the
 * frame new tabs, navigation of this page and downloads, whatever its adverts
 * attempt. A cross-origin document cannot be read or rewritten from out here, so
 * that lock plus the choice of host are the only levers that actually hold.
 *
 * That second lever is why this list is short. MegaPlay and AniXo were tried and
 * removed: both paint "Sandbox Detected — remove the sandbox attribute" instead
 * of a picture, and the only way to satisfy them is an open frame, which is
 * exactly the pop-up and tab-hijack vector members reported. A source that
 * demands the lock be dropped is not a source this site ships.
 *
 * External embed hosts (AniGato, Megavid, etc.) are no longer shipped: they
 * carried redirects, adverts and watermarks that could not be filtered from
 * outside the frame. Solvn now plays direct media addresses (.m3u8/.mp4/.webm)
 * in its own <video>, with zero third-party page on screen. Operators add their
 * own direct or clean internal streaming URLs via Settings or this file.
 *
 * Placeholders: {anilist} {episode} {audio} {next} {accent} for anime, and
 * {tmdb} — which the movies page reads for itself and which `servers()` filters
 * out of the anime ladder, since an episode carries no TMDB id to fill it with.
 * {audio} only ever receives a track the entry declares below, so `ar` on a
 * sub-and-dub player falls back to `sub` instead of framing a black box.
 * {accent} is six hex digits with no `#`, hence the `%23` in front of it.
 *
 * A file address (.m3u8/.mp4/.webm) plays in Solvn's own player with no
 * third-party page on screen; anything else is framed.
 */

/* No third-party embeds or placeholder videos ship by default. Solvn plays
   only clean, direct media addresses (.m3u8/.mp4/.webm) in its own <video>;
   operators add their own ad-free direct or self-hosted streaming URLs here or
   via Settings. External embed hosts (AniGato, Megavid, AniXo, VidHawk, …) are
   intentionally omitted and blocked, since they carry redirects, ads and
   watermarks. Titles without a clean direct link are not linked to any player. */
export const DEFAULT_SERVERS = [];

/* Self-hosted direct media map: anime id -> { episode: direct .mp4/.m3u8 url }.
   Operators fill this (or use Settings ▸ Direct media links ▸ Bulk import) to
   play clean, ad-free episodes in Solvn's own <video>. Leave empty to use nothing.

   Bulk format (paste into DIRECT_MEDIA, or into Settings bulk import JSON):
     Object form:  { "16498": { "1": "https://cdn.example.com/aot-ep1.m3u8", "2": "https://cdn.example.com/aot-ep2.m3u8" } }
     Array form:   [ { "id": 16498, "episode": 1, "url": "https://cdn.example.com/aot-ep1.m3u8" }, ... ]
   Aliases: anilistId/animeId/anime_id, ep/episodeNumber/episode_number, link/src/stream/direct.
   Only https direct media files (.m3u8/.mp4/.webm/...) are accepted; blocked
   ad hosts are rejected. */
export const DIRECT_MEDIA = {};

/* Stremio-style clean add-on base URLs (https). A stream-capable add-on answers
   /stream/{type}/{id}.json with { streams: [{ url, title }] } where url is a
   direct .m3u8/.mp4/.webm file. Solvn fetches the add-on's /manifest.json first
   and only asks the ones that declare a `stream` resource, so a catalog add-on
   here is harmless (it is skipped for playback). Playback order on a watch page
   is: direct media (DIRECT_MEDIA/Settings) → any stream-capable add-on below →
   the template servers in Settings. Add your own clean stream add-on base URLs
   here (they must return direct file links; embeds and torrents are filtered). */
export const STREMIO_ADDONS = [
  // Live anime catalogue/metadata (real Kitsu data). Skipped for stream lookup.
  'https://anime-kitsu.strem.fun',
  // Real stream-capable add-ons. Add one per line, only if it returns direct
  // .m3u8/.mp4 URLs (embeds and torrents are filtered out). Public instances
  // that return direct streams do not exist without an account or a per-user
  // build, so these are enabled per deployment rather than hardcoded:
  //   PenguPlay      https://pengu.uk                    (needs its sign-in)
  //   Yukistreams    https://stremio.yukistreams.xyz/<build>/manifest.json
  // A base URL added here is asked for /manifest.json and then
  // /stream/{type}/{id}.json automatically for every episode.
  //
  // With no stream-capable add-on, the watch page still plays: it asks
  // Archive.org for a public-domain copy of the title and, when there is none,
  // falls back to an open-reel HLS. Nothing is pasted and nothing is required.
];