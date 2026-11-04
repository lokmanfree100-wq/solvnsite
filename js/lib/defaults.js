/**
 * The sources every visitor gets.
 *
 * Settings ▸ Streaming servers writes to this browser's own storage, which is
 * right for a viewer choosing their own player and wrong for a site: whoever
 * deploys solvn.site can configure it here, and every member who has never
 * opened Settings then meets "No video source is configured yet" — the operator
 * configured their laptop, not the site.
 *
 * This file is the deploy-time half of that. Entries here are tried first-class
 * by the anime ladder and the movies page, they pass the same gate everything
 * else passes (`templateProblem`, so https-only and a blocked host stays blocked
 * even if it is typed in here), and a device that has added its own servers keeps
 * them ahead of these.
 *
 * It is empty, and that is the decision the site was asked to keep. Every address
 * in this list is somebody else's player or somebody else's file, so planting one
 * here would put whoever runs the site behind the ads, pop-unders and "download
 * our app" pages that host happens to serve that day — Solvn cannot read inside a
 * cross-origin frame to filter them. So the line is filled by the person who
 * accepts that trade, or stays empty and the player says so plainly.
 *
 * Two shapes work, and both are validated exactly like a Settings entry:
 *
 *   { name: 'My CDN', url: 'https://cdn.example.com/anime/{anilist}/ep-{episode}.m3u8', tracks: ['sub', 'dub'] }
 *   { name: 'My player', url: 'https://player.example.com/anime/{anilist}/{episode}?audio={audio}', tracks: ['sub'] }
 *
 * Placeholders: {anilist} {episode} {audio} {next} {accent} for anime, and
 * {tmdb} — which the movies page reads for itself. A file address (.m3u8/.mp4/
 * .webm) plays in Solvn's own player with no third-party page on the screen; an
 * embed page is framed, sandboxed so it cannot move the tab, and whatever it
 * paints inside its frame belongs to it.
 */

export const DEFAULT_SERVERS = [];
