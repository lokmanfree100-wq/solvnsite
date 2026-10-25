/**
 * The two ways Solvn can put a picture on screen.
 *
 * A **media** source is a file address — `…/ep-04.m3u8` or `…/ep-04.mp4` — and
 * Solvn plays it itself in a `<video>` element it owns: our controls, our
 * quality menu, our brand, and no third party's player UI anywhere on the
 * screen. This is the path a source you host or license should be put on.
 *
 * An **embed** source is somebody else's player *page*, framed. Solvn cannot
 * restyle, re-skin or silence what is drawn inside a cross-origin frame, which
 * is why an embed always carries its own corner mark and its own quality guess.
 * The frame stays sandboxed without top-navigation or popups, so it can move
 * nothing but its own picture.
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

/** Does this browser speak HLS without help? (Safari, and most TVs.) */
export function nativeHls() {
  const probe = document.createElement('video');
  return probe.canPlayType('application/vnd.apple.mpegurl') !== '';
}

let engine = null;
/** Resolved once, shared by every stage: one 560 KB module, never refetched. */
function hlsEngine() {
  if (engine) return engine;
  engine = import('../vendor/hls.mjs')
    .then((mod) => mod.default)
    .catch(() => null);
  return engine;
}

/**
 * A stage is whatever holds the picture: an iframe or a video.
 *
 * Both answer the same four questions, which is all the watch page needs to
 * know: point yourself at this address, tell me when something arrived, tell me
 * when nothing will, and give the levels back when you chose them yourself.
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

  if (media) {
    node.addEventListener('loadeddata', () => onReady());
    node.addEventListener('playing', () => onReady());
    /* A video element that cannot fetch or decode says so, which is one signal an
       iframe never gets to send: use it instead of waiting out the failover
       clock on a source that is already known dead. */
    node.addEventListener('error', dead);
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
    }
    hls.loadSource(url);
  }

  const heldSrc = () => current;

  function destroy() {
    gone = true;
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

  return { node, kind: media ? 'media' : 'embed', src, heldSrc, levels, setLevel, level, destroy };
}
