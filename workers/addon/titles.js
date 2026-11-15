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
    'Official-channel videos and public-domain films, curated for solvn.site. '
    + 'YouTube titles play in YouTube\'s own player; everything else is a file '
    + 'whose licence allows public playback.',
  tag: 'Solvn Official',
  /* `solvn:` ids belong to Solvn's own catalogue (the Internet Archive films),
     which has no IMDb entry to be asked about by. */
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
    ids: ['solvn:the-general'],
    type: 'movie',
    name: 'The General (1926)',
    /* File address read from archive.org/metadata/TheGeneral1926. */
    url: 'https://archive.org/download/TheGeneral1926/The_General_1926_720p_512kb.mp4',
    credit: 'Buster Keaton · public domain · Internet Archive',
  },
  {
    ids: ['solvn:the-inspector-general'],
    type: 'movie',
    name: 'The Inspector General (1949)',
    url: 'https://archive.org/download/inspector_general_ipod_version/inspector_general_512kb.mp4',
    credit: 'public domain · Internet Archive',
  },
];
