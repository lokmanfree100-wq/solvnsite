/* What Solvn's own add-on is allowed to serve.

   This is the whole point of the worker: it answers for the titles listed here
   and for nothing else, so the site stops depending on third-party add-ons that
   vanish. Two kinds of source are allowed, and no others:

     1. ytId — a video its rights holder published on YouTube. YouTube's official
        IFrame player serves it inside Solvn's own player box. Nothing is ripped,
        re-hosted or proxied around their player or their adverts.
     2. url — a direct file whose rights make public playback lawful, with the
        licence and the page it came from recorded next to it.

   Never guess an address: every url here was read from the host's own metadata
   (the Internet Archive's metadata API, Wikimedia Commons' imageinfo API) or
   from the YouTube oEmbed API for the video id. A title with no lawful source
   simply does not belong in this list — an empty answer is better than a
   borrowed one.

   To point the add-on at something else, add an entry: `ids` are the external
   ids solvn.site asks about (IMDb `tt…`, or `kitsu:`, `anilist:`, `mal:` and
   `tmdb:` prefixes, optionally followed by a season/episode suffix). */

export const ADDON = {
  id: 'site.solvn.official',
  version: '1.0.0',
  name: 'Solvn Official',
  description:
    "Official-channel videos and public-domain films, curated for solvn.site. " +
    "YouTube's own player serves YouTube titles; everything else is a file " +
    "whose licence allows public playback.",
  tag: 'Solvn Official',
  /* `solvn:` ids belong to Solvn's own catalogue (the Internet Archive films),
     which has no IMDb entry to be asked about by. They are NOT queried by the
     client today (it only asks add-ons after ani.zip maps a title), so archive
     films are served through their direct_url in data/archive.json instead. */
  idPrefixes: ['tt', 'tmdb:', 'kitsu:', 'anilist:', 'mal:', 'solvn:'],
  types: ['movie', 'series'],
};

export const TITLES = [
  {
    ids: ['tt1254207'],
    type: 'movie',
    name: 'Big Buck Bunny',
    /* Blender's own upload. Verified through YouTube's oEmbed API. */
    ytId: 'YE7VzlLtp-4',
    credit: 'Blender Foundation · CC BY 3.0',
  },
  {
    ids: ['tt1254207'],
    type: 'movie',
    name: 'Big Buck Bunny (WebM, with captions)',
    /* Wikimedia Commons' copy, read from its imageinfo API. */
    url: 'https://upload.wikimedia.org/wikipedia/commons/3/37/Big_Buck_Bunny_with_VTT_acid_test.webm',
    credit: 'Blender Foundation · CC BY 3.0 · Wikimedia Commons',
    /* Served from this worker (see /vtt below) so the track is CORS-readable and
       labelled text/vtt; Commons answers text/x-wiki, which browsers refuse as
       a caption track. */
    subtitles: [
      {
        lang: 'en',
        label: 'English',
        url: 'https://commons.wikimedia.org/w/index.php?title=TimedText:Big_Buck_Bunny_with_VTT_acid_test.webm.en.vtt&action=raw',
      },
    ],
  },
  {
    ids: ['anilist:105333'],
    type: 'series',
    name: 'Dr. STONE — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll", title matches) and the watch page reports
       status OK with playableInEmbed=true, so it embeds on third-party sites. */
    ytId: 'SKfor6O-8hs',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:105333'],
    type: 'series',
    name: 'Dr. STONE — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Same verification as above. */
    ytId: '5ILlar1UJ88',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
  {
    ids: ['anilist:21507'],
    type: 'series',
    name: 'Mob Psycho 100 — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Verified through oEmbed
       (author "Crunchyroll") and the watch page reports status OK with
       playableInEmbed=true. */
    ytId: 'kG-BIWRAC6k',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
  {
    ids: ['anilist:98659'],
    type: 'series',
    name: 'Classroom of the Elite — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll") and the watch page reports status OK with
       playableInEmbed=true. */
    ytId: '269N6LtAyk4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98659'],
    type: 'series',
    name: 'Classroom of the Elite — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Verified through oEmbed
       (author "Crunchyroll") and the watch page reports status OK with
       playableInEmbed=true. */
    ytId: 'cqkn9-DjrY0',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
  {
    ids: ['anilist:120120'],
    type: 'series',
    name: 'Tokyo Revengers — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Verified through YouTube's
       oEmbed API (author "Crunchyroll") and the watch page reports
       playableInEmbed=true with no region restriction. */
    ytId: '8FiC6DLIzqQ',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
  {
    ids: ['anilist:164299'],
    type: 'series',
    name: 'The Do-Over Damsel Conquers the Dragon Emperor — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll") and the watch page reports
       playableInEmbed=true with no region restriction. */
    ytId: 'UsfU29Ih7JA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98514'],
    type: 'series',
    name: 'Umamusume: Pretty Derby — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll") and the watch page reports
       playableInEmbed=true with no region restriction. */
    ytId: 'PZIy0Ct6KLo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:165254'],
    type: 'series',
    name: 'BUCCHIGIRI?! — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll") and the watch page reports
       playableInEmbed=true with no region restriction. */
    ytId: 'ynA7tMN1qug',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:152137'],
    type: 'series',
    name: 'No Longer Allowed in Another World — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Verified through YouTube's
       oEmbed API (author "Crunchyroll") and the watch page reports
       playableInEmbed=true with no region restriction. */
    ytId: 'dFd2Bf4svNo',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
];
