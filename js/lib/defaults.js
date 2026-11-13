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

/* One clean direct-media source ships by default so the player is never empty on a
   fresh install: a direct .mp4 that plays in Solvn's own <video> with zero ads,
   zero watermarks and no third-party page. Operators replace or extend it with
   their own direct/clean internal streaming URLs here or via Settings. External
   embed hosts such as AniGato/Megavid are intentionally omitted. */
export const DEFAULT_SERVERS = [
  { id: 'solvn-direct', name: 'Solvn Direct', url: 'https://www.w3schools.com/html/mov_bbb.mp4', tracks: ['sub'] },
];