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

   The Crunchyroll full-episode entries below come from that channel's playlist
   "Full Anime Episodes (English Subbed)" (PLRe9ARNnYSY4XwQgADMP47QQ4jw8yDuEl).
   Each one was checked one by one before it was written down:

     - oEmbed answered 200 with author_name "Crunchyroll" for the id;
     - the watch page reported playabilityStatus.status "OK",
       playableInEmbed true, and no regionRestriction block;
     - the show it belongs to was looked up on AniList and the id recorded.

   Trailers, recaps and previews in that playlist ("Special Feature",
   "Sneak Peek", the Kaina special) are not full episodes and are left out, and
   two uploads whose watch page demanded a sign-in were dropped as well.

   To point the add-on at something else, add an entry: `ids` are the external
   ids solvn.site asks about (IMDb `tt…`, or `kitsu:`, `anilist:`, `mal:` and
   `tmdb:` prefixes, optionally followed by a season/episode suffix). */

export const ADDON = {
  id: 'site.solvn.official',
  version: '1.1.0',
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
    ids: ['anilist:113415'],
    type: 'series',
    name: 'JUJUTSU KAISEN — Episode 1 (English Sub)',
    /* Crunchyroll's official channel upload. Verified through YouTube's oEmbed
       API (author "Crunchyroll", title "JUJUTSU KAISEN Episode 1 Full English
       Sub | Ryomen Sukuna") and the watch page reports status OK with
       playableInEmbed=true and no region restriction. */
    ytId: 'iGWyN2Lq36M',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:113415'],
    type: 'series',
    name: 'JUJUTSU KAISEN — Episode 1 (English Dub)',
    /* Crunchyroll's official channel upload (dubbed). Verified through YouTube's
       oEmbed API (author "Crunchyroll", title "JUJUTSU KAISEN Episode 1 Full
       English Dub | Ryomen Sukuna") and the watch page reports status OK with
       playableInEmbed=true and no region restriction. */
    ytId: 'LTjH5JdxtOA',
    credit: 'Crunchyroll · official channel upload (English dub)',
  },
  {
    ids: ['anilist:132052'],
    type: 'series',
    name: 'A Couple of Cuckoos — Episode 1 (English Sub)',
    ytId: 'jIwN-DtOldQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99426'],
    type: 'series',
    name: 'A Place Further Than the Universe — Episode 1 (English Sub)',
    ytId: 'nt573QIevIM',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:162804'],
    type: 'series',
    name: 'Alya Sometimes Hides Her Feelings in Russian — Episode 1 (English Sub)',
    ytId: 'bt4Uq6HMPrU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:126047'],
    type: 'series',
    name: 'Battle Game in 5 Seconds — Episode 1 (English Sub)',
    ytId: 'u1We8OrEUoQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:105931'],
    type: 'series',
    name: 'Blade Runner: Black Lotus — Episode 1 (English Sub)',
    ytId: 'abYm6aYno60',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:137822'],
    type: 'series',
    name: 'BLUE LOCK — Episode 1 (English Sub)',
    ytId: 'HQlxni75_p4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:157371'],
    type: 'series',
    name: 'Bye Bye, Earth — Episode 1 (English Sub)',
    ytId: 'En2C2u0EPuM',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:145545'],
    type: 'series',
    name: 'Classroom of the Elite Season 2 — Episode 1 (English Sub)',
    ytId: 'j-ucSgRpedU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101002'],
    type: 'series',
    name: 'Crossing Time — Episode 1 (English Sub)',
    ytId: 'T8bj1miCEhM',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99423'],
    type: 'series',
    name: 'DARLING in the FRANXX — Episode 1 (English Sub)',
    ytId: 'UA-WsGa8TmQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:116605'],
    type: 'series',
    name: 'Date A Live IV — Episode 1 (English Sub)',
    ytId: 'N9w8TEq-Vek',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:97907'],
    type: 'series',
    name: 'Death March to the Parallel World Rhapsody — Episode 1 (English Sub)',
    ytId: 'EzkJPJ5Ohss',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:132351'],
    type: 'series',
    name: 'Don\'t Hurt Me, My Healer! — Episode 1 (English Sub)',
    ytId: 'Awm9wHWT-i0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:120697'],
    type: 'series',
    name: 'DON\'T TOY WITH ME, MISS NAGATORO — Episode 1 (English Sub)',
    ytId: 'ygX-z5jrxMc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:124641'],
    type: 'series',
    name: 'Dropkick on My Devil!!! X — Episode 1 (English Sub)',
    ytId: 'ZZfjZYO66-k',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:114302'],
    type: 'series',
    name: 'Drug Store in Another World - The Slow Life of a Cheat Pharmacist — Episode 1 (English Sub)',
    ytId: 'me8AdgsT2x4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:178548'],
    type: 'series',
    name: 'Even Given the Worthless "Appraiser" Class, I\'m Actually the Strongest — Episode 1 (English Sub)',
    ytId: 'gOmdXj5Z7nc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:122052'],
    type: 'series',
    name: 'Fena: Pirate Princess — Episode 1 (English Sub)',
    ytId: 'ueE_lcJOUnw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:126192'],
    type: 'series',
    name: 'Girlfriend, Girlfriend — Episode 1 (English Sub)',
    ytId: 'KWgng5npDrM',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101930'],
    type: 'series',
    name: 'Girly Air Force — Episode 1 (English Sub)',
    ytId: 'JctYmFtjT80',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:108241'],
    type: 'series',
    name: 'Gleipnir — Episode 1 (English Sub)',
    ytId: '6J5frcleBhY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:128369'],
    type: 'series',
    name: 'GLOOMY THE NAUGHTY GRIZZLY — Episode 1 (English Sub)',
    ytId: 'T-MStCfNEVQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:144176'],
    type: 'series',
    name: 'Gods\' Games We Play — Episode 1 (English Sub)',
    ytId: '_NL0aPq_N5k',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101292'],
    type: 'series',
    name: 'Holmes of Kyoto — Episode 1 (English Sub)',
    ytId: 'gDCKw33LDR0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99390'],
    type: 'series',
    name: 'How to Keep a Mummy — Episode 1 (English Sub)',
    ytId: '8TTyh3e3fsY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:180812'],
    type: 'series',
    name: 'I Left my A-Rank Party to Help My Former Students Reach the Dungeon Depths! — Episode 1 (English Sub)',
    ytId: 'jAJn6m7UCUE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:168139'],
    type: 'series',
    name: 'I\'ll Become a Villainess Who Goes Down in History — Episode 1 (English Sub)',
    ytId: 'w3r2Mvc1wk4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:112608'],
    type: 'series',
    name: 'I\'ve Been Killing Slimes for 300 Years and Maxed Out My Level — Episode 1 (English Sub)',
    ytId: 'GsOZ6AgeDjk',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:130166'],
    type: 'series',
    name: 'In the Land of Leadale — Episode 1 (English Sub)',
    ytId: 'SwE0B4pEwiQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:107201'],
    type: 'series',
    name: 'In/Spectre — Episode 1 (English Sub)',
    ytId: 'KcsB28xoWNI',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21712'],
    type: 'series',
    name: 'ISLAND — Episode 1 (English Sub)',
    ytId: 'xK6wfC7rQ7g',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99940'],
    type: 'series',
    name: 'Junji Ito Collection — Episode 1 (English Sub)',
    ytId: '9CSlGzwRfak',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98747'],
    type: 'series',
    name: 'Katana Maidens ~Toji No Miko~ — Episode 1 (English Sub)',
    ytId: '9lpx_LmkWrg',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98747'],
    type: 'series',
    name: 'Katana Maidens ~Toji No Miko~ — Episode 12.5 (English Sub)',
    ytId: 'NoHyU1Zm2yo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:87496'],
    type: 'series',
    name: 'Kemono Friends — Episode 1 (English Sub)',
    ytId: '_EQFAVlBl1E',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98448'],
    type: 'series',
    name: 'Kino\'s Journey -the Beautiful World- the Animated Series — Episode 1 (English Sub)',
    ytId: 'I-b5qEUEeUk',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98444'],
    type: 'series',
    name: 'Laid-Back Camp — Episode 1 (English Sub)',
    ytId: 's8vwDxMIlss',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 1 (English Sub)',
    ytId: 'hbgDq3-NYug',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:169911'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Special 1 (English Sub)',
    ytId: '40YHw5nTQIo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 2 (English Sub)',
    ytId: 'xWPcVfuLlqU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:169911'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Special 2 (English Sub)',
    ytId: 'v9P6jyhFpHw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 3 (English Sub)',
    ytId: 'kytgTOFuAUc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 4 (English Sub)',
    ytId: 'Orh7x37DGts',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 5 (English Sub)',
    ytId: 'dAEHFHxz9YY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140665'],
    type: 'series',
    name: 'Lee\'s Detective Agency — Episode 6 (English Sub)',
    ytId: 'HWMkzpgcTtY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:167144'],
    type: 'series',
    name: 'Love Is Indivisible by Twins — Episode 1 (English Sub)',
    ytId: 'Uj2XncV30A4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:127050'],
    type: 'series',
    name: 'Love of Kill — Episode 1 (English Sub)',
    ytId: 'wB1t62nUi64',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21517'],
    type: 'series',
    name: 'Love Tyrant — Episode 1 (English Sub)',
    ytId: 'LvDerx2i1Uw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21517'],
    type: 'series',
    name: 'Love Tyrant — Episode 2 (English Sub)',
    ytId: 'XH55ihaHWhs',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21517'],
    type: 'series',
    name: 'Love Tyrant — Episode 3 (English Sub)',
    ytId: '3ikPBy3yRG4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:100715'],
    type: 'series',
    name: 'Magical Girl Ore — Episode 1 (English Sub)',
    ytId: '46s5GbpELXc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21857'],
    type: 'series',
    name: 'Masamune-kun\'s Revenge — Episode 1 (English Sub)',
    ytId: 'GnQnNCoMnEo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:174044'],
    type: 'series',
    name: 'MAYONAKA PUNCH — Episode 1 (English Sub)',
    ytId: 'wKJN6Cw_OM0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:177552'],
    type: 'series',
    name: 'Medaka Kuroiwa Is Impervious to My Charms — Episode 1 (English Sub)',
    ytId: 'JzttM2BtWao',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:171144'],
    type: 'series',
    name: 'Meiji Gekken: 1874 — Episode 1 (English Sub)',
    ytId: 'Y9gBGIX1rOE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:171144'],
    type: 'series',
    name: 'Meiji Gekken: 1874 — Episode 2 (English Sub)',
    ytId: 'L1Ac0tw2N90',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:171144'],
    type: 'series',
    name: 'Meiji Gekken: 1874 — Episode 3 (English Sub)',
    ytId: 'FgSevFLEXok',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21776'],
    type: 'series',
    name: 'Miss Kobayashi\'s Dragon Maid — Episode 1 (English Sub)',
    ytId: 'OMa9PoX9CUg',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:100849'],
    type: 'series',
    name: 'Mitchiri Neko — Episode 1 (English Sub)',
    ytId: 'IFyAcbDRUUg',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:100849'],
    type: 'series',
    name: 'Mitchiri Neko — Episode 2 (English Sub)',
    ytId: 'HUje-xJ1w8Y',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:100849'],
    type: 'series',
    name: 'Mitchiri Neko — Episode 3 (English Sub)',
    ytId: 'CF3G-jITxBA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21507'],
    type: 'series',
    name: 'Mob Psycho 100 — Episode 1 (English Sub)',
    ytId: 'ctDEMnLhuto',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:139274'],
    type: 'series',
    name: 'Mobile Suit Gundam: The Witch from Mercury — Episode 1 (English Sub)',
    ytId: 'tZnwyLc7c30',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98529'],
    type: 'series',
    name: 'Ms. Koizumi Loves Ramen Noodles — Episode 1 (English Sub)',
    ytId: 'W2R-sGTq9mA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:112716'],
    type: 'series',
    name: 'Muv-Luv Alternative — Episode 1 (English Sub)',
    ytId: '5eiO9uNOFGc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:104647'],
    type: 'series',
    name: 'My Next Life as a Villainess: All Routes Lead to Doom! — Episode 1 (English Sub)',
    ytId: 'e98HyLl1pqE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:136934'],
    type: 'series',
    name: 'My Stepmom\'s Daughter Is My Ex — Episode 1 (English Sub)',
    ytId: 'F_QcedF5-rU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21051'],
    type: 'series',
    name: 'NANBAKA — Episode 1 (English Sub)',
    ytId: 'x2kkwlai9Pg',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21051'],
    type: 'series',
    name: 'NANBAKA — Episode 2 (English Sub)',
    ytId: 'y9S2-TLLKUw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21051'],
    type: 'series',
    name: 'NANBAKA — Episode 3 (English Sub)',
    ytId: 'BrESaolhqpU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:116005'],
    type: 'series',
    name: 'Noblesse — Episode 1 (English Sub)',
    ytId: 'YcyONLSOXNQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:128547'],
    type: 'series',
    name: 'ODDTAXI — Episode 1 (English Sub)',
    ytId: '6kdvfKp1EG0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:128034'],
    type: 'series',
    name: 'ORIENT — Episode 1 (English Sub)',
    ytId: 'h2N3OqGRBNc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:142701'],
    type: 'series',
    name: 'Raven of the Inner Palace — Episode 1 (English Sub)',
    ytId: 'U-s8XdkKWII',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21355'],
    type: 'series',
    name: 'Re:ZERO -Starting Life in Another World- Director\'s Cut — Episode 1 (English Sub)',
    ytId: 'fvzfxQWjXDw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:142193'],
    type: 'series',
    name: 'Reborn to Master the Blade — Episode 1 (English Sub)',
    ytId: 'VfBv4YRWMQY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99726'],
    type: 'series',
    name: 'Recovery of an MMO Junkie — Episode 1 (English Sub)',
    ytId: 'sKX79I39hVw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:113813'],
    type: 'series',
    name: 'Rent-a-Girlfriend — Episode 1 (English Sub)',
    ytId: '0VgbPXuDULk',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:124060'],
    type: 'series',
    name: 'Requiem of the Rose King — Episode 1 (English Sub)',
    ytId: 'toz5GRjfyKo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:130591'],
    type: 'series',
    name: 'SABIKUI BISCO — Episode 1 (English Sub)',
    ytId: 'bNBxxdrKAYY',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:108987'],
    type: 'series',
    name: 'SAKUGAN — Episode 1 (English Sub)',
    ytId: '6kIkMOcpURc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:140502'],
    type: 'series',
    name: 'Salaryman\'s Club — Episode 1 (English Sub)',
    ytId: 'UfC24i9KVvo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:126546'],
    type: 'series',
    name: 'Seirei Gensouki: Spirit Chronicles — Episode 1 (English Sub)',
    ytId: '-_9ptxR5zAc',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:151970'],
    type: 'series',
    name: 'Shangri-la Frontier — Episode 1 (English Sub)',
    ytId: 'oTqDiGvfv7Q',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:127911'],
    type: 'series',
    name: 'Shikimori\'s Not Just a Cutie — Episode 1 (English Sub)',
    ytId: '2-o63aU2NYA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:131565'],
    type: 'series',
    name: 'takt op.Destiny — Episode 1 (English Sub)',
    ytId: 'XHGwTBVOWL8',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101280'],
    type: 'series',
    name: 'That Time I Got Reincarnated as a Slime — Episode 1 (English Sub)',
    ytId: 'LyIiHsqq-FQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98436'],
    type: 'series',
    name: 'The Ancient Magus\' Bride — Episode 1 (English Sub)',
    ytId: 'QbO-HPpIDU4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:128545'],
    type: 'series',
    name: 'The aquatope on white sand — Episode 1 (English Sub)',
    ytId: 'DQl59Q8l3ss',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:116006'],
    type: 'series',
    name: 'The God of High School — Episode 1 (English Sub)',
    ytId: 'FvFJiNwZCrM',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:132456'],
    type: 'series',
    name: 'The Great Jahy Will Not Be Defeated! — Episode 1 (English Sub)',
    ytId: 'ypaW4f4NdUQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:130586'],
    type: 'series',
    name: 'The Greatest Demon Lord is Reborn as a Typical Nobody — Episode 1 (English Sub)',
    ytId: 'X2ISk3ufjW0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101289'],
    type: 'series',
    name: 'The Master of Ragnarok & Blesser of Einherjar — Episode 1 (English Sub)',
    ytId: '4WRfqBP560U',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:126897'],
    type: 'series',
    name: 'The Night Beyond the Tricornered Window — Episode 1 (English Sub)',
    ytId: 'ROT9SsCLvK8',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:103572'],
    type: 'series',
    name: 'The Quintessential Quintuplets — Episode 1 (English Sub)',
    ytId: 'IJ6gOKkgXX4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:99263'],
    type: 'series',
    name: 'The Rising of the Shield Hero — Episode 1 (English Sub)',
    ytId: 'jF2A7sRQoew',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:111321'],
    type: 'series',
    name: 'The Rising of the Shield Hero Season 2 — Episode 1 (English Sub)',
    ytId: 'CdaXwocRLQo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:129191'],
    type: 'series',
    name: 'The Strongest Sage with the Weakest Crest — Episode 1 (English Sub)',
    ytId: 'oFp7rMoOl58',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:129898'],
    type: 'series',
    name: 'The World\'s Finest Assassin Gets Reincarnated in Another World as an Aristocrat — Episode 1 (English Sub)',
    ytId: 'dbiVlRcqVYE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:138882'],
    type: 'series',
    name: 'The Yakuza\'s Guide to Babysitting — Episode 1 (English Sub)',
    ytId: '2HM7QDMTjqI',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:114535'],
    type: 'series',
    name: 'To Your Eternity — Episode 1 (English Sub)',
    ytId: 'n6_80A9W7pk',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:108463'],
    type: 'series',
    name: 'Toilet-bound Hanako-kun — Episode 1 (English Sub)',
    ytId: 'kP3Y7o3E1Fo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:120120'],
    type: 'series',
    name: 'Tokyo Revengers — Episode 1 (English Sub)',
    ytId: 'lHnl7r0HbEQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:141014'],
    type: 'series',
    name: 'Tomodachi Game — Episode 1 (English Sub)',
    ytId: 'nyj0A32b278',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:125206'],
    type: 'series',
    name: 'TSUKIMICHI -Moonlit Fantasy- — Episode 1 (English Sub)',
    ytId: 'L9J7i0cIBzA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:162785'],
    type: 'series',
    name: 'TsumaSho — Episode 1 (English Sub)',
    ytId: 'ReOPx8o1dwQ',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:166700'],
    type: 'series',
    name: 'Twilight Out of Focus — Episode 1 (English Sub)',
    ytId: '6TEgHy9IuY4',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98514'],
    type: 'series',
    name: 'Umamusume: Pretty Derby — Episode 2 (English Sub)',
    ytId: 'RJ8gqVIiTVA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:98514'],
    type: 'series',
    name: 'Umamusume: Pretty Derby — Episode 3 (English Sub)',
    ytId: '1enPJIOyguw',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:101348'],
    type: 'series',
    name: 'VINLAND SAGA — Episode 1 (English Sub)',
    ytId: 'HBtJOzcVUMI',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:160488'],
    type: 'series',
    name: 'VTuber Legend: How I Went Viral after Forgetting to Turn Off My Stream — Episode 1 (English Sub)',
    ytId: 'IEcopBUw7YE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:174576'],
    type: 'series',
    name: 'Wistoria: Wand and Sword — Episode 1 (English Sub)',
    ytId: 'EzgSuKy27aE',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:170468'],
    type: 'series',
    name: 'Yakuza Fiancé — Episode 1 (English Sub)',
    ytId: 'FVDITyS-HNo',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:20966'],
    type: 'series',
    name: 'Yamada-kun and the Seven Witches — Episode 1 (English Sub)',
    ytId: 'GSU82iAwXI0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:145468'],
    type: 'series',
    name: 'YUREI DECO — Episode 1 (English Sub)',
    ytId: 'xVjenf0w0sA',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21709'],
    type: 'series',
    name: 'Yuri!!! on ICE — Episode 1 (English Sub)',
    ytId: 'R6zoUVx6uiU',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21709'],
    type: 'series',
    name: 'Yuri!!! on ICE — Episode 2 (English Sub)',
    ytId: 'ebAfIvtAqO0',
    credit: 'Crunchyroll · official channel upload',
  },
  {
    ids: ['anilist:21709'],
    type: 'series',
    name: 'Yuri!!! on ICE — Episode 3 (English Sub)',
    ytId: 'eeaXugs8s-8',
    credit: 'Crunchyroll · official channel upload',
  },
];
