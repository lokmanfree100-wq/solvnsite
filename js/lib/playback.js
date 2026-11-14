/**
 * The two ways Solvn can put a picture on screen.
 *
 * A **media** source is a file address — `…/ep-04.m3u8` or `…/ep-04.mp4` — and
 * Solvn plays it itself in a `<video>` element it owns: our controls, our quality
 * menu, our caption switch, our brand, and no third party's player UI anywhere on
 * the screen. This is the path a source you host or license should be put on.
 *
 * An **embed** source is somebody else's player *page*, framed. Solvn cannot
 * restyle, re-skin or silence what is drawn inside a cross-origin frame, which
 * is why an embed always carries its own corner mark and its own quality guess.
 * The frame is locked to scripts, its own origin and forms: the browser refuses
 * it popups, top-navigation and downloads, so an advert can paint itself inside
 * the box but can neither open a tab, move this page nor touch the device.
 *
 * HLS is the awkward one: Safari plays an `.m3u8` natively and every other
 * browser needs MSE, so `hls.js` is vendored in `public/vendor/` and loaded only
 * when a manifest is actually asked for on a browser that cannot play one.
 */

import { h } from './dom.js';
import { FRAME_ALLOW, FRAME_SANDBOX, isHlsUrl, isMediaUrl } from './sources.js';

/* `isMediaUrl` lives in the registry: what a server *is* and how it gets mounted
   must be answered once, or a template and a stage can disagree about the same
   address. */
export { isMediaUrl };

/* The one subtitle id a caller may pass without having read it from the stage:
   captions on, then captions off again. */
export const TRACK_OFF = 'off';

/** Does this browser speak HLS without help? (Safari, and most TVs.) */
export function nativeHls() {
  const probe = document.createElement('video');
  return probe.canPlayType('application/vnd.apple.mpegurl') !== '';
}

let engine = null;
/** Resolved once, shared by every stage: one 560 KB module, never refetched. */
function hlsEngine() {
  if (engine) return engine;
  /* Two levels up: this module is `js/lib/playback.js` and the engine ships at
     the site root, `vendor/hls.mjs`. Written as one `../` the browser asks for
     `js/vendor/hls.mjs`, gets a 404, and every manifest on a browser without
     native HLS (Chrome, Firefox, Android) reports itself dead before it starts. */
  engine = import('../../vendor/hls.mjs')
    .then((mod) => mod.default)
    .catch(() => null);
  return engine;
}

/**
 * Mount a direct/HLS address on a plain `<video>` outside a stage (the movies
 * watch page). Native HLS wins where the browser has it; otherwise hls.js is
 * loaded once from the shared engine. Returns a teardown for the hls instance.
 */
export async function attachMedia(node, url) {
  if (!node || !url) return null;
  if (isHlsUrl(url) && !nativeHls()) {
    const Hls = await hlsEngine();
    if (Hls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
      hls.loadSource(url);
      hls.attachMedia(node);
      return () => hls.destroy();
    }
  }
  node.src = url;
  node.load();
  return null;
}

/**
 * The caption switch for a plain `<video>`: what tracks it can see, which one is
 * showing, and how to change that. A stage's own element uses this for its
 * single-file branch, and a watch page that plays a file outside a stage — the
 * clean room's own `<video>` — gets exactly the same answers from exactly the
 * same browser rules, so the two can never disagree about what a track is.
 *
 * `labels.track` names a track that arrived without a name of its own.
 */
export function captionControls(node, labels = {}) {
  const list = () => Array.from((node && node.textTracks) || []);
  return {
    subTracks: () => list().map((tr, i) => ({
      id: `n${i}`,
      label: tr.label || tr.language || `${labels.track || 'Track'} ${i + 1}`,
    })),
    setSubtitle: (id) => {
      const tracks = list();
      if (!tracks.length) return false;
      const wanted = id === TRACK_OFF ? -1 : Number(String(id).replace(/^n/, ''));
      tracks.forEach((tr, i) => {
        /* `hidden` keeps a track loaded but unwatched, which is what switching
           away from it means; `disabled` would tear it down and cost a refetch. */
        tr.mode = i === wanted ? 'showing' : 'hidden';
      });
      return true;
    },
    subtitle: () => {
      const shown = list().findIndex((tr) => tr.mode === 'showing');
      return shown < 0 ? TRACK_OFF : `n${shown}`;
    },
  };
}

/**
 * A stage is whatever holds the picture: an iframe or a video.
 *
 * Both answer the same questions, which is all the watch page needs to know:
 * point yourself at this address, tell me when something arrived, tell me when
 * nothing will, give the levels and the caption tracks back when asked, and say
 * when either of those lists turns out to have changed.
 */
export function createStage({ kind = 'embed', title = '', onReady = () => {}, onDead = () => {}, labels = {} } = {}) {
  const media = kind === 'media';
  const node = media
    ? h('video.player-video', {
        controls: true,
        playsinline: true,
        preload: 'auto',
        title,
      })
    : h('iframe', {
        title,
        sandbox: FRAME_SANDBOX,
        allow: FRAME_ALLOW,
        referrerpolicy: 'strict-origin-when-cross-origin',
        loading: 'eager',
      });

  let hls = null;
  let current = '';
  /* Once a stage has been taken down it stops talking. Clearing a video's `src`
     can make it report a failure a moment later, and news about a source the
     ladder already left must not blame the server now on screen. */
  let gone = false;
  const dead = () => {
    if (!gone) onDead();
  };

  /* The menus a watch page paints are built from lists this stage does not know
     yet — a manifest is parsed a second later, a file's tracks arrive with its
     metadata. So whoever shows a quality or subtitle menu subscribes here and
     repaints when the answer turns up, instead of reading once and freezing. */
  const listeners = [];
  const emit = () => {
    if (gone) return;
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* a repaint must never break playback */
      }
    });
  };
  function onChange(fn) {
    listeners.push(fn);
    return () => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  if (media) {
    node.addEventListener('loadeddata', () => onReady());
    node.addEventListener('playing', () => onReady());
    /* A video element that cannot fetch or decode says so, which is one signal an
       iframe never gets to send: use it instead of waiting out the failover
       clock on a source that is already known dead. */
    node.addEventListener('error', dead);
    /* The menus are painted from lists the file has not announced yet, so every
       moment one can change is a reason to repaint: the metadata arriving, and a
       track being added to or taken out of the video's own list. */
    node.addEventListener('loadedmetadata', emit);
    node.textTracks?.addEventListener('addtrack', emit);
    node.textTracks?.addEventListener('removetrack', emit);
  } else {
    node.addEventListener('load', () => onReady());
  }

  /** The renditions this stream really has — empty for an embed, by design. */
  function levels() {
    if (!hls) {
      /* Safari's own HLS has no level list a page may read, so an auto-played
         manifest reports what it is playing and nothing else. Saying "auto"
         alone is the honest answer rather than a menu of heights we invented. */
      return [];
    }
    return (hls.levels || [])
      .map((l, i) => ({ id: String(i), height: l.height || 0, label: l.height ? `${l.height}p` : labels.auto || 'Auto' }))
      .reverse();
  }

  /** -1 hands the choice back to the engine. */
  function setLevel(id) {
    if (!hls) return false;
    hls.currentLevel = id === 'auto' || id === null || id === undefined ? -1 : Number(id);
    return true;
  }

  const level = () => (hls ? (hls.currentLevel < 0 ? 'auto' : String(hls.currentLevel)) : null);

  /* ---- subtitles ------------------------------------------------------
     Two things can carry the words and both are reachable from here: a manifest
     declares subtitle renditions, which hls.js lists on `subtitleTracks` and
     paints into the video's own track list, and a single file (`.mp4`, `.webm`)
     can hold text tracks the browser exposes directly. A framed player page keeps
     its captions inside its own document, which a cross-origin frame never shows
     to us, so an embed answers nothing at all here and the watch page hides the
     control rather than opening an empty menu. That is the honest ceiling, not a
     missing feature.

     The ids are opaque to whoever draws the menu: they came out of `subTracks()`
     a moment ago, and `off` is the only one they may invent. */
  const nativeSubs = captionControls(node, labels);

  function subTracks() {
    if (!media) return [];
    if (hls && (hls.subtitleTracks || []).length) {
      return hls.subtitleTracks.map((tr, i) => ({
        id: String(i),
        label: tr.name || tr.lang || `${labels.track || 'Track'} ${i + 1}`,
      }));
    }
    return nativeSubs.subTracks();
  }

  /** `off` mutes the captions; anything else is one of the ids above. */
  function setSubtitle(id) {
    if (!media) return false;
    if (hls && (hls.subtitleTracks || []).length) {
      hls.subtitleTrack = id === TRACK_OFF ? -1 : Number(id);
      hls.subtitleDisplay = id !== TRACK_OFF;
      return true;
    }
    return nativeSubs.setSubtitle(id);
  }

  const subtitle = () => {
    if (!media) return null;
    if (hls && (hls.subtitleTracks || []).length) {
      return hls.subtitleTrack === undefined || hls.subtitleTrack < 0 ? TRACK_OFF : String(hls.subtitleTrack);
    }
    return nativeSubs.subtitle();
  };

  /* The lists a menu is drawn from are not known at the moment the stage is
     built, so `onChange` above is how a watch page learns they have arrived. */
  async function src(url) {
    current = url;
    if (!media) {
      node.src = url;
      return;
    }
    if (!isHlsUrl(url)) {
      if (hls) {
        hls.destroy();
        hls = null;
      }
      node.src = url;
      node.load();
      /* A direct file (.mp4/.webm) loads paused; start it like a manifest does
         once parsed, or "Play now" would leave the viewer on a still frame.
         Autoplay may be refused by the browser, so a failure is harmless. */
      node.play().catch(() => {});
      return;
    }
    if (nativeHls()) {
      node.src = url;
      return;
    }
    const Hls = await hlsEngine();
    /* The engine is the only way to play a manifest on Chrome, Firefox or
       Android. When it is absent — a device without MSE, a module that did not
       load — the honest move is to say so and let the ladder move on, not to
       point a `<video>` at a manifest it will never decode and watch the
       viewer wait for a black screen. */
    if (!Hls || !Hls.isSupported()) {
      dead();
      return;
    }
    if (!hls) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
      hls.attachMedia(node);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onReady();
        node.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else dead();
      });
      /* Levels and subtitle renditions are named by the manifest, which is only
         read once the engine has it: both menus have to be repainted when the
         answer arrives, not left showing the empty state they were built with. */
      [Hls.Events.MANIFEST_PARSED, Hls.Events.LEVELS_UPDATED, Hls.Events.SUBTRACKS_LOADED]
        .forEach((ev) => hls.on(ev, emit));
    }
    hls.loadSource(url);
  }

  const heldSrc = () => current;

  function destroy() {
    gone = true;
    listeners.length = 0;
    if (hls) hls.destroy();
    hls = null;
    try {
      node.pause?.();
    } catch {
      /* a video that never started has nothing to stop */
    }
    node.removeAttribute('src');
    if (typeof node.load === 'function') node.load();
  }

  return {
    node,
    kind: media ? 'media' : 'embed',
    src,
    heldSrc,
    levels,
    setLevel,
    level,
    subTracks,
    setSubtitle,
    subtitle,
    onChange,
    destroy,
  };
}
