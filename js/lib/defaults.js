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
 * AniGato ships here under that same lock. Its page is the one that served the
 * pop-unders members reported, so it is framed with nothing but scripts, its own
 * origin and forms: the browser refuses its window.open and its top-level anchors
 * before they run, so the pop-under cannot leave the box. What the lock cannot do
 * is repaint the inside of somebody else's player — an advert drawn inside their
 * box is still drawn there, and AniGato's run adult. The advisory above the
 * picture says so in one line before playback and the viewer chooses to continue.
 * Megavid stays as the ladder's second turn: it plays inside the lock too and
 * carries the episode when AniGato is silent. Zero adverts of any kind would mean
 * playing a file in Solvn's own <video>, which needs a stream address the site
 * controls — the shape `views/mwatch.js` uses for its direct engine.
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

export const DEFAULT_SERVERS = [
  { name: 'AniGato', url: 'https://anigato.lol/embed/anime/{anilist}/{episode}?audio={audio}&next={next}&accent={accent}', tracks: ['sub', 'dub'] },
  { name: 'Megavid', url: 'https://megavid.buzz/ani/{anilist}/{episode}/{audio}?color=%23{accent}&autoplay=true', tracks: ['sub', 'dub'] },
];