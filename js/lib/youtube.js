/**
 * The official YouTube embedded player, driven through its IFrame Player API.
 *
 * This is the only way Solvn plays a YouTube video, and the only honest one: the
 * player stays YouTube's own — its branding, captions, quality menu and adverts
 * are untouched — and our page only decides *where* it sits. Wrapping it in our
 * chrome is fine; covering its controls, blocking its ads or stripping its mark
 * is a policy violation, so nothing here does that.
 *
 * The API script is loaded once per page and shared by every caller: the film
 * watch page mounts one player, and a second one arriving later waits on the
 * same promise instead of injecting the script again.
 */

const API_SRC = 'https://www.youtube.com/iframe_api';

/** A real YouTube video id: exactly the eleven URL-safe characters. */
export const isYtId = (value) => /^[A-Za-z0-9_-]{11}$/.test(String(value || ''));

/** The id inside a youtube/youtube-nocookie embed or watch address, or ''. */
export function ytIdFromUrl(url) {
  const raw = String(url || '');
  if (isYtId(raw)) return raw;
  const m = raw.match(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?(?:.*&)?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

/**
 * The shareable player address for a video. `origin` is what the player checks
 * before it will talk back to this page, so it is always our own origin — never
 * a value read from a request, and never omitted.
 */
export function ytEmbedUrl(ytId, origin = location.origin) {
  const id = ytIdFromUrl(ytId);
  if (!id) return '';
  const q = new URLSearchParams({ enablejsapi: 1, playsinline: 1, rel: 0, origin });
  return `https://www.youtube.com/embed/${id}?${q.toString()}`;
}

let apiPromise = null;

/** Resolve with the global `YT` namespace, loading the API at most once. */
export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const done = () => (window.YT && window.YT.Player ? resolve(window.YT) : reject(new Error('YouTube API unavailable')));
    /* The API calls this global when it finishes loading, and only then. It is
       restored afterwards so a second script load cannot break it. */
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try { previous && previous(); } catch { /* a previous handler must not stop ours */ }
      done();
    };
    const already = document.querySelector(`script[src="${API_SRC}"]`);
    if (!already) {
      const script = document.createElement('script');
      script.src = API_SRC;
      script.async = true;
      script.onerror = () => reject(new Error('YouTube API script failed'));
      document.head.append(script);
    }
    /* A script that was already loading will fire the global; if it finished
       before this call, the poll below catches it. */
    setTimeout(done, 8000);
  }).catch(() => null);
  return apiPromise;
}

/**
 * Put a YouTube player in `host` and report what it is doing.
 *
 * `onReady` fires when the player can accept commands; `onError` fires for a
 * video that cannot be played (private, removed, region-locked, embed-denied),
 * which is an answer worth passing to the caller's ladder rather than a spinner
 * that never ends.
 */
export async function mountYouTubePlayer({ host, ytId, title = '', onReady = () => {}, onError = () => {} }) {
  const id = ytIdFromUrl(ytId);
  if (!host || !id) throw new Error('no video id');
  const YT = await loadYouTubeApi();
  if (!YT) throw new Error('YouTube API unavailable');

  const mount = document.createElement('div');
  mount.className = 'yt-mount';
  host.append(mount);

  let player = null;
  player = new YT.Player(mount, {
    videoId: id,
    host: 'https://www.youtube.com',
    playerVars: {
      /* The player is sized by the box it is put in; these keep it inside the
         frame and out of the way rather than taking over the page. */
      playsinline: 1,
      rel: 0,
      origin: location.origin,
    },
    events: {
      onReady: () => onReady(player),
      onError: (e) => onError(e),
      onStateChange: (e) => {
        /* 1 is PLAYING: the picture is up, which is what the watch page waits
           for before it hides its own loading overlay. */
        if (e && e.data === 1) onReady(player);
      },
    },
  });

  return {
    player,
    destroy() {
      try { player && player.destroy && player.destroy(); } catch { /* already gone */ }
      try { mount.remove(); } catch { /* already gone */ }
    },
    get title() { return title; },
  };
}
