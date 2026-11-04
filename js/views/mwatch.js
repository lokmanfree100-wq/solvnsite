/**
 * Movies & Series watch page (`/mwatch/:id?type=movie|tv&s=&e=`, nav:false).
 *
 * Three engines, switchable, ordered by how little of the page we hand over:
 *  - Direct stream (the default): the local /stream resolver asks an
 *    allowlisted provider ladder for the stream FILE behind a title, and that
 *    file plays in our own <video> through lib/playback.js — Solvn's controls,
 *    Solvn's brand, and no foreign document, script or frame on the page. It is
 *    the same path the anime side uses, so it carries the same absence of ads.
 *  - Clean room: a public-domain/CC file from the Internet Archive, also played
 *    in our own <video>. Nothing outside this site executes here either.
 *  - Embed pool: somebody else's player page (VidLink → Vidsrc SU → Vidsrc CC →
 *    MultiEmbed), health-checked through /health first, with automatic failover.
 *    The frame is sandboxed (scripts and its own storage only), so the embed
 *    cannot redirect the tab, open windows or start downloads. It is the last
 *    resort, for a title no provider in the ladder has a file for.
 *
 * The safety chip lists every outside host mounted on the page, live — and reads
 * zero while either file engine is playing.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { toast } from '../lib/ui.js';
import { errorState } from '../components/media.js';
import { api, nameOf, setMovieProgress, proxyNotice } from '../lib/tmdb.js';
import { findCleanSource, loadReport } from '../lib/cleanroom.js';
import { createStage } from '../lib/playback.js';
import { extraServers as allServers, serverKind, serverUrl, serverName } from '../lib/sources.js';

/* A whole https address that names a stream file: the only shape a video
   element may be pointed at, whether the address came from the operator's own
   server list or out of the provider ladder. */
const FILE_URL = /^https:\/\/\S+\.(?:m3u8|mp4)(?:[?#]|$)/i;

/* Clean, ad-filtered embed providers only — ordered safest-first. The frame is
   unsandboxed for the reason above; the guards are order, referrer policy and
   calm hosts. */
const SERVERS = {
  vidlink: {
    label: 'Server 1 · VidLink',
    ad: 'Cleanest embed — low ads, themed player',
    movie: (id) => `https://vidlink.pro/movie/${id}?primaryColor=e1e1e3&secondaryColor=32353b&iconColor=e1e1e3&backgroundColor=161618&playerLogo=https://img.icons8.com/small/64/ffffff/film.png`,
    tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}?primaryColor=e1e1e3&secondaryColor=32353b&iconColor=e1e1e3&backgroundColor=161618`,
  },
  'vidsrc-su': {
    label: 'Server 2 · Vidsrc SU',
    ad: 'Trusted Vidsrc successor domain (embed.su lineage)',
    movie: (id) => `https://vidsrc.su/embed/movie/${id}?autoPlay=true`,
    tv: (id, s, e) => `https://vidsrc.su/embed/tv/${id}/${s}/${e}?autoPlay=true`,
  },
  'vidsrc-cc': {
    label: 'Server 3 · Vidsrc CC',
    ad: 'Mainstream Vidsrc v2 embed',
    movie: (id) => `https://vidsrc.cc/v2/embed/movie/${id}?autoPlay=true`,
    tv: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}?autoPlay=true`,
  },
  multiembed: {
    label: 'Server 4 · MultiEmbed',
    ad: 'Aggregator with its own source ladder',
    movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`,
    tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}`,
  },
};
const SERVER_KEYS = Object.keys(SERVERS);

/* The watermark sits on our own player chrome over a file we licensed ourselves,
   so it is one string to change — it never covers anyone else's artwork. */
const PLAYER_BRAND = 'Solvn';

/* ---- health ----------------------------------------------------------------
   Per embed URL: the local /health proxy HEADs the real stream URL and reports
   status + latency, so we pick a server that can serve THIS title, not one whose
   homepage merely resolves. A no-cors favicon probe is the fallback. */
const healthCache = new Map();
const HEALTH_TTL = 5 * 60 * 1000;

async function checkHealth(url) {
  const hit = healthCache.get(url);
  if (hit && Date.now() - hit.at < HEALTH_TTL) return hit;
  let out;
  try {
    const r = await fetch(`/health?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
    const j = await r.json();
    out = { ok: !!j.ok, status: Number(j.status) || 0, ms: Number(j.ms) || 0, via: 'http' };
  } catch {
    out = { ok: await probeFavicon(url), status: 0, ms: 0, via: 'favicon' };
  }
  healthCache.set(url, { ...out, at: Date.now() });
  return out;
}

async function probeFavicon(url) {
  const origin = new URL(url).origin;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    await fetch(`${origin}/favicon.ico`, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function MovieWatchView(ctx) {
  const { query } = ctx.route;
  const isTv = query.type === 'tv';
  const id = Number(ctx.params.id);
  const season = isTv ? Number(query.s) || 1 : 1;
  const episode = isTv ? Number(query.e) || 1 : 1;
  const type = isTv ? 'tv' : 'movie';

  const shell = h('div.mwatch-shell');

  let d;
  try {
    d = await api.details(type, id);
  } catch (err) {
    const notice = proxyNotice(err);
    return errorState(t('That title'), notice ? null : () => ctx.go(ctx.route.raw), notice || {});
  }
  d.media_type = type;
  const title = nameOf(d);

  /* ---------- top bar ---------- */
  const serversBox = h('div.mwatch-servers', { role: 'group', 'aria-label': t('Player server') });
  const top = h(
    'div.mwatch-top',
    {},
    h('a.icon-btn', { href: `#/movie/${id}?type=${type}`, 'aria-label': t('Back to details') }, icon('chevronLeft', { cls: 'flip' })),
    h(
      'div',
      { style: { minWidth: 0 } },
      h('h1', {}, title),
      h(
        'div.mwatch-ep',
        {},
        isTv
          ? `${t('Season')} ${season} · ${t('Episode')} ${episode}`
          : `${(d.release_date || '').slice(0, 4)}${d.runtime ? ` · ${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m` : ''}`,
      ),
    ),
    h('span.spacer'),
    serversBox,
  );
  shell.append(top);

  /* ---------- engines switch + safety ---------- */
  /* Ordered by how little of the page leaves our control, and the viewer can
     always pick another: a title with no direct file is not a reason to hide
     the pool, and a pool that serves ads on a good day is not a reason to hide
     the file engines. */
  const MODES = [
    { id: 'direct', key: 'Direct stream' },
    { id: 'pool', key: 'Third-party pool' },
    { id: 'clean', key: 'Clean room' },
  ];
  let mode = 'direct';
  const modeRow = h(
    'div.m-mode-row',
    {},
    h(
      'div.m-seg',
      { role: 'group', 'aria-label': t('Playback engine'), style: { margin: 0 } },
      ...MODES.map((m, i) => h('button.m-seg-btn', {
        type: 'button',
        'data-m': m.id,
        class: i === 0 ? 'is-active' : '',
        'aria-pressed': String(i === 0),
        onclick: () => setMode(m.id),
      }, t(m.key))),
    ),
    h('span.m-safety', { role: 'status' }),
  );
  shell.append(modeRow);
  const chip = modeRow.querySelector('.m-safety');

  /* ---------- player ---------- */
  const loadingText = h('span');
  const brandSub = h('span.pb-sub', {}, t('clean room'));
  const player = h(
    'div.m-player',
    {},
    h('div.m-player-loading', { role: 'status' }, h('span.m-spinner', { 'aria-hidden': 'true' }), loadingText),
    h('video', { controls: true, playsinline: true, preload: 'metadata', hidden: true }),
    h('div.player-brand', { hidden: true }, h('span.pb-name', {}, PLAYER_BRAND), brandSub),
  );
  shell.append(player);
  const video = player.querySelector('video');
  const brand = player.querySelector('.player-brand');
  const loading = player.querySelector('.m-player-loading');
  const loadLabel = () => loadingText;

  const metaRow = h('div.m-clean-meta');
  shell.append(metaRow);
  const safetyPanel = h('div.m-safety-panel');
  shell.append(safetyPanel);

  /* ---------- safety readout ---------- */
  function paintSafety() {
    const { hosts, liveCount, liveHosts } = loadReport();
    chip.replaceChildren(
      icon('shield'),
      h('span', {}, liveCount
        ? `${liveCount} ${t('outside host(s) mounted as our player')}`
        : t('no outside player mounted')),
    );
    chip.classList.toggle('is-clean', liveCount === 0);
    chip.title = liveCount
      ? t('Live player code from: ') + liveHosts.join(', ')
      : t('Nothing outside this site is executing on the page right now.');

    const list = hosts.length
      ? hosts.flatMap((r) => [h('span.m-safety-origin', {}, r.host, h('b', {}, r.label))])
      : [h('span.m-safety-origin', {}, t('nothing outside this site'), h('b', {}, t('none')))];
    const about = mode === 'direct'
      ? t('Direct stream: this site read the file address from a provider list it controls, and the video bytes go straight into our own <video>. None of their page loads — no document, no script, no frame — so there is no third-party player here to put an ad, a pop-up or a download in front of you. When the ladder names no file for a title, the page says which provider failed and why, and hands you the other two engines.')
      : mode === 'clean'
        ? t('Clean room: only Archive items carrying an explicit public-domain or Creative-Commons statement are eligible, obvious screen recordings are refused, the title and runtime must match, and the file plays in our own <video> element. No third-party document, script or frame loads — the only outside bytes are the media file and its artwork, and every control you can click belongs to us.')
        : t('Embed pool: the player is a page owned by the server you picked, but it runs sandboxed — it cannot redirect this tab, open windows or download files, no matter what it asks for. We also choose calm hosts first and send them only our referrer. The browser hides that frame\'s internal requests from us, so this list under-reports — it never over-reports.');
    safetyPanel.replaceChildren(
      h('p.m-safety-about', {}, about),
      h('div.m-safety-list', {}, ...list),
    );
  }
  const safetyPoll = setInterval(() => {
    if (!shell.isConnected) {
      clearInterval(safetyPoll);
      return;
    }
    paintSafety();
  }, 4000);
  ctx.onCleanup(() => clearInterval(safetyPoll));

  /* ---------- engine 1: direct stream (a file in our own <video>) ----------
     This is the anime architecture pointed at films: a stream address is found
     away from the browser (the local /stream route, because a page cannot read
     a cross-origin response), and the picture is decoded by our own player with
     the vendored HLS engine. Nothing of the provider is on this page — no
     document, no script, no frame — which is why nothing of theirs can be drawn
     over the video either.

     The resolver hands back several addresses because a single CDN dying is
     normal, not exceptional: each one gets DIRECT_WAIT to produce a frame, then
     the next is tried, and only after the last does the page admit the title has
     no direct file. The stage is built once per lookup and its callbacks read
     the counters below rather than capturing an index, so switching mid-ladder
     cannot make an abandoned source blame the one now on screen. */
  const DIRECT_WAIT = 14000;
  let directSeq = 0;
  let stage = null;
  let directTimer = null;
  let directList = [];
  let directTried = [];
  let directAt = 0;
  let directProvider = '';
  let directUp = false;
  /* One automatic hand-over per title: if the ladder is empty and the viewer
     lands on the pool, pressing Direct stream afterwards must show them the
     report rather than bounce them straight back again. */
  let pooledOnce = false;

  const alive = (seq) => seq === directSeq && mode === 'direct';

  function dropStage() {
    clearTimeout(directTimer);
    directTimer = null;
    directSeq++; // anything still in flight belongs to a stage that no longer exists
    if (stage) {
      stage.destroy();
      stage.node.remove();
      stage = null;
    }
    brand.hidden = true;
  }

  function paintDirectMeta() {
    const src = directList[directAt];
    metaRow.replaceChildren(
      h(
        'div.m-panel',
        {},
        h('h3', {}, t('Playing in Solvn’s own player')),
        h('div.m-fact', {}, h('b', {}, t('Provider')), h('span', {}, directProvider || t('unknown'))),
        h('div.m-fact', {}, h('b', {}, t('Format')), h('span', {}, src?.hls ? t('Adaptive (HLS)') : t('Single file'))),
        h('div.m-fact', {}, h('b', {}, t('Ads')), h('span', {}, t('None — no third-party page is on this site'))),
      ),
    );
  }

  function noDirect() {
    clearFailBox();
    loadLabel().textContent = '';
    const notes = directTried.map((r) => `${r.label}: ${r.note}`).join(' · ');
    loading.append(
      h(
        'div.m-fail',
        {},
        h('h3', {}, t('No direct stream for this title')),
        h('p', {}, t('None of the providers in the ladder named a playable file just now — availability changes by region and by hour. Their answers are listed below. The embed pool plays most titles the ladder misses, and the clean room plays the public-domain catalogue.')),
        h('p', { style: { color: 'var(--text-faint)', fontSize: '12px' } }, notes || t('The resolver did not answer.')),
        h(
          'div.m-fail-actions',
          {},
          h('button.btn.btn--primary.btn--sm', {
            type: 'button',
            onclick: () => loadDirect(false),
          }, icon('refresh'), t('Re-check & retry')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('pool') }, t('Use the embed pool')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('clean') }, icon('shield'), t('Try the clean room')),
        ),
      ),
    );
  }

  function directReady(seq) {
    if (!alive(seq) || directUp) return; // loadeddata and playing both answer ready
    directUp = true;
    clearTimeout(directTimer);
    directTimer = null;
    brandSub.textContent = t('own player');
    brand.hidden = false;
    loading.classList.add('hide');
    clearFailBox();
    paintDirectMeta();
    const secs = Math.round(stage?.node?.duration || 0);
    setMovieProgress({
      type, id, title, posterPath: d.poster_path, season, episode,
      seconds: secs ? Math.min(secs, Math.round(secs * 0.02)) : 0,
      duration: secs,
    });
    toast(`${t('Direct stream ready')} — ${t('zero third-party code')}`, { iconName: 'shield' });
    stage?.node?.play?.().catch(() => {}); // autoplay can be refused; the controls stay ours
  }

  /** The address on screen is dead or silent — move to the next, or say so. */
  function nextDirect(seq) {
    if (!alive(seq)) return;
    if (directAt + 1 < directList.length) playDirect(seq, directAt + 1);
    else noDirect();
  }

  function playDirect(seq, i) {
    if (!alive(seq)) return;
    directAt = i;
    directUp = false;
    if (directList[i].label) directProvider = directList[i].label;
    loadLabel().textContent = i === 0
      ? t('Buffering the stream…')
      : t('That address did not answer — trying the next one…');
    loading.classList.remove('hide');
    clearTimeout(directTimer);
    directTimer = setTimeout(() => nextDirect(seq), DIRECT_WAIT);
    stage.src(directList[i].url);
  }

  /* Your own servers come first. Settings ▸ Streaming servers is where whoever
     runs this install names the addresses Solvn may play, and a template that
     carries `{tmdb}` and ends in a file is a film address: the same list that
     makes anime clean makes movies clean, and an address the operator typed
     beats anything this page could guess about a stranger. */
  function configuredDirect() {
    return allServers()
      .filter((s) => String(s.url).includes('{tmdb}') && serverKind(s) === 'media')
      .map((s) => {
        const url = serverUrl(s, { id: '', tmdb: id, episode, audio: 'sub' });
        return FILE_URL.test(url) ? { url, hls: /\.m3u8(?:[?#]|$)/i.test(url), label: serverName(s) } : null;
      })
      .filter(Boolean);
  }

  async function loadDirect(auto = true) {
    dropStage();
    const seq = ++directSeq;
    loading.classList.remove('hide');
    clearFailBox();
    metaRow.replaceChildren();
    const own = configuredDirect();
    if (own.length) {
      directTried = [{ label: t('Your own servers'), note: `${own.length} ${t('server(s)')}` }];
      directProvider = own[0].label;
      directList = own;
    } else {
      loadLabel().textContent = t('Asking the providers for a direct stream…');
      const q = new URLSearchParams({ type, tmdb: String(id) });
      if (isTv) {
        q.set('s', String(season));
        q.set('e', String(episode));
      }
      let r = null;
      try {
        const resp = await fetch(`/stream?${q}`, { cache: 'no-store' });
        r = await resp.json();
      } catch {
        r = null; // the route itself is unreachable; the box below says so
      }
      if (!alive(seq)) return;
      directTried = Array.isArray(r?.tried) ? r.tried : [];
      directProvider = String(r?.provider || '');
      /* Re-checked on this side of the wire: the address must be a whole https
         stream file before a video element is pointed at it, whatever the
         provider claimed. */
      directList = (Array.isArray(r?.sources) ? r.sources : [])
        .map((s) => (s && typeof s.url === 'string' ? s : null))
        .filter((s) => s && FILE_URL.test(s.url))
        .slice(0, 8)
        .map((s) => ({ ...s, hls: /\.m3u8(?:[?#]|$)/i.test(s.url) }));
    }
    if (!directList.length) {
      /* Silence from the ladder is no reason to park someone on a dead end: the
         pool plays most of these titles, so the page moves there and says why in
         one line. Pressing Direct stream yourself keeps the report on screen —
         that is where each provider's answer is written out. */
      if (auto && !pooledOnce) {
        pooledOnce = true;
        toast(t('No direct file for this title — using the embed pool'), { tone: 'alert', iconName: 'alert' });
        setMode('pool');
      } else {
        noDirect();
      }
      return;
    }
    stage = createStage({
      kind: 'media',
      title,
      labels: { auto: t('Auto') },
      onReady: () => directReady(seq),
      onDead: () => nextDirect(seq),
    });
    player.appendChild(stage.node);
    playDirect(seq, 0);
  }

  /* ---------- engine 2: third-party embed pool ---------- */
  let frame = null;
  let server = SERVER_KEYS[0];
  let loadTimer = null;
  let srcSetAt = 0;
  let advances = 0;
  let succeeded = false;
  const MAX_ADV = SERVER_KEYS.length * 2;
  const srcFor = (key) => (isTv ? SERVERS[key].tv(id, season, episode) : SERVERS[key].movie(id));
  const health = (key) => healthCache.get(srcFor(key));

  function buildServers() {
    serversBox.replaceChildren();
    for (const key of SERVER_KEYS) {
      const s = SERVERS[key];
      const st = health(key);
      const down = st && st.ok === false;
      const detail = !st
        ? t('Not checked yet')
        : down
          ? `${st.status ? `HTTP ${st.status}` : t('Blocked on your network')} — ${t('will be skipped')}`
          : `${s.ad} · ${st.ms} ms`;
      serversBox.append(
        h(
          `button.m-server${key === server ? '.is-active' : ''}${down ? '.is-down' : ''}${st && st.ok ? '.is-ok' : ''}`,
          {
            type: 'button',
            'aria-label': t('Use {label}', { label: s.label }),
            title: `${s.label} — ${detail}`,
            onclick: () => useServer(key),
          },
          s.label,
        ),
      );
    }
  }

  function clearFailBox() {
    loading.querySelector('.m-fail')?.remove();
  }

  /* The chip is a claim about what is executing right now, so it repaints the
     instant a frame is mounted or removed — waiting for the poll would show
     "no outside player" during their load. */
  function setSrc(key) {
    srcSetAt = Date.now();
    ensureFrame().src = srcFor(key);
    paintSafety();
  }

  function startLoad(key, fromUser) {
    if (mode !== 'pool') return;
    loading.classList.remove('hide');
    clearFailBox();
    clearTimeout(loadTimer);
    advances = 0;
    succeeded = false;
    loadLabel().textContent = fromUser ? `${t('Loading')} ${SERVERS[key].label}…` : t('Loading player…');
    setSrc(key);
    loadTimer = setTimeout(() => advance('slow'), fromUser ? 16000 : 11000);
  }

  async function advance(reason) {
    if (mode !== 'pool') return;
    if (advances >= MAX_ADV) return failAll();
    advances++;
    succeeded = false;
    clearTimeout(loadTimer);
    loadLabel().textContent = reason === 'fast'
      ? t('Player did not start — trying another server…')
      : t('Looking for a healthy server…');
    const startIdx = SERVER_KEYS.indexOf(server);
    let next = null;
    for (let i = 1; i < SERVER_KEYS.length; i++) {
      const k = SERVER_KEYS[(startIdx + i) % SERVER_KEYS.length];
      if ((await checkHealth(srcFor(k))).ok) {
        next = k;
        break;
      }
    }
    if (!next) {
      // A "fast" load usually means the embed answered with an error page, not
      // a player. With no healthy alternative, hiding our overlay would leave
      // the viewer staring at the third-party error UI with no way out, so our
      // own box takes over instead. The frame stays mounted: if the player did
      // start after all, one press on the dismiss button reveals it.
      if (reason === 'fast' && health(server)?.ok === true) {
        warnNoSources();
        return;
      }
      return failAll();
    }
    server = next;
    buildServers();
    loadLabel().textContent = `${t('Switched to')} ${SERVERS[next].label}…`;
    setSrc(next);
    loadTimer = setTimeout(() => advance('slow'), 11000);
  }

  function warnNoSources() {
    clearFailBox();
    loadLabel().textContent = '';
    loading.append(
      h(
        'div.m-fail',
        {},
        h('h3', {}, t('This server has no sources for this title')),
        h('p', {}, t('Its player opened, but it reports nothing available right now — this changes by region and hour. Try the direct stream, another server, retry, or play a public-domain copy in the clean room.')),
        h(
          'div.m-fail-actions',
          {},
          h('button.btn.btn--primary.btn--sm', {
            type: 'button',
            onclick: () => {
              healthCache.clear();
              loadLabel().textContent = t('Re-checking all servers…');
              boot();
            },
          }, icon('refresh'), t('Re-check & retry')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('direct') }, icon('shield'), t('Try the direct stream')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('clean') }, icon('shield'), t('Try the clean room')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => loading.classList.add('hide') }, t('Player is working — hide this')),
        ),
      ),
    );
  }

  function failAll() {
    clearFailBox();
    const results = SERVER_KEYS.map((k) => ({ k, h: health(k) }));
    const allDown = results.every((r) => r.h && r.h.ok === false);
    const summary = results
      .map((r) => `${SERVERS[r.k].label}: ${!r.h ? t('not checked') : r.h.ok ? `OK ${r.h.ms} ms` : r.h.status ? `HTTP ${r.h.status}` : t('unreachable')}`)
      .join(' · ');
    const box = h(
      'div.m-fail',
      {},
      h('h3', {}, t('No healthy server for this title')),
      h(
        'p',
        {},
        allDown
          ? t('Every stream server failed its health check from your network (DNS blocked or offline). A VPN or Cloudflare DNS (1.1.1.1) will unblock them.')
          : t('Servers answered but none plays this title — it may not be hosted yet. Try another server, retry, or switch to the clean-room engine if this title is in the public-domain catalogue.'),
      ),
      h('p', { style: { color: 'var(--text-faint)', fontSize: '12px' } }, summary),
      h(
        'div.m-fail-actions',
        {},
        h('button.btn.btn--primary.btn--sm', {
          type: 'button',
          onclick: () => {
            healthCache.clear();
            loadLabel().textContent = t('Re-checking all servers…');
            boot();
          },
        }, icon('refresh'), t('Re-check & retry')),
        h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('direct') }, icon('shield'), t('Try the direct stream')),
        h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('clean') }, icon('shield'), t('Try the clean room')),
        ...SERVER_KEYS.map((key) =>
          h(`button.btn.btn--glass.btn--sm${health(key)?.ok === false ? '.is-muted' : ''}`, {
            type: 'button',
            onclick: () => useServer(key),
          }, SERVERS[key].label),
        ),
      ),
    );
    loadLabel().textContent = '';
    loading.append(box);
  }

  function ensureFrame() {
    if (frame) return frame;
    frame = h('iframe', {
      /* The sandbox is the real ad/pop-up guard: the embed cannot navigate this
         tab, open windows or download files, no matter what its page asks for.
         Scripts and its own-origin storage still work, so the player runs. */
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-presentation',
      allow: 'fullscreen; autoplay; encrypted-media; picture-in-picture',
      referrerpolicy: 'origin',
      title: `${title} player`,
    });
    frame.addEventListener('error', () => advance('fast'));
    frame.addEventListener('load', () => {
      clearTimeout(loadTimer);
      if (!srcSetAt || succeeded) return; // initial empty-iframe event / nav inside a working player
      const elapsed = Date.now() - srcSetAt;
      if (health(server)?.ok === false || elapsed < 600) {
        advance('fast');
        return;
      }
      succeeded = true;
      setMovieProgress({ type, id, title, posterPath: d.poster_path, season, episode });
      setTimeout(() => {
        loading.classList.add('hide');
        clearFailBox();
      }, 300);
    });
    player.appendChild(frame);
    return frame;
  }

  /* Removing the node destroys the third-party document outright — hiding it
     would leave their scripts and audio running behind our UI. */
  function dropFrame() {
    clearTimeout(loadTimer);
    loadTimer = null;
    srcSetAt = 0;
    succeeded = false;
    if (frame) {
      frame.remove();
      frame = null;
    }
  }

  async function boot() {
    if (mode !== 'pool') return;
    buildServers();
    loading.classList.remove('hide');
    loadLabel().textContent = t('Checking stream server health for this title…');
    const results = await Promise.all(SERVER_KEYS.map((k) => checkHealth(srcFor(k))));
    if (mode !== 'pool') return;
    buildServers();
    const healthy = SERVER_KEYS.filter((k, i) => results[i].ok);
    if (!healthy.length) {
      failAll();
      return;
    }
    const pick = healthy.includes(server) ? server : healthy[0];
    server = pick;
    buildServers();
    if (healthy.length < SERVER_KEYS.length) {
      const skipped = SERVER_KEYS.filter((k) => !healthy.includes(k)).map((k) => SERVERS[k].label).join(', ');
      toast(`${skipped} ${t('failed health — using')} ${SERVERS[pick].label}`, { tone: 'alert', iconName: 'alert' });
    }
    startLoad(server, false);
  }

  function useServer(key) {
    if (mode !== 'pool') setMode('pool');
    server = key;
    startLoad(key, true);
  }

  /* ---------- engine 3: clean room (public-domain file in our own <video>) --- */
  let cleanSrc = null;
  let cleanSeq = 0;

  /* Both file engines get taken down together: a stage is ours, so leaving its
     HLS engine attached behind the pool would keep fetching segments of a
     picture nobody is watching. */
  function stopVideo() {
    dropStage();
    try {
      video.pause();
    } catch { /* not attached */ }
    if (video.src) {
      video.removeAttribute('src');
      video.load();
    }
    video.hidden = true;
    brand.hidden = true;
  }

  function paintCleanMeta() {
    if (!cleanSrc) {
      metaRow.replaceChildren();
      return;
    }
    metaRow.replaceChildren(
      h(
        'div.m-panel',
        {},
        h('h3', {}, cleanSrc.iaTitle),
        h('div.m-fact', {}, h('b', {}, t('Source')), h('span', {}, 'Internet Archive')),
        h('div.m-fact', {}, h('b', {}, t('Rights')), h('span', {}, cleanSrc.rights)),
        h(
          'div.m-fact',
          {},
          h('b', {}, t('Licence')),
          h('span', {}, h('a', { href: cleanSrc.license, target: '_blank', rel: 'noopener' }, cleanSrc.rights)),
        ),
        h('div.m-fact', {}, h('b', {}, t('File')), h('span', {}, `${cleanSrc.format} · ${Math.round(cleanSrc.bytes / 1048576)} MB`)),
      ),
    );
  }

  async function loadClean() {
    const seq = ++cleanSeq;
    loading.classList.remove('hide');
    clearFailBox();
    cleanSrc = null;
    paintCleanMeta();
    loadLabel().textContent = t('Searching the public-domain catalogue…');
    let runtimeMin = isTv ? 0 : d.runtime;
    if (isTv) {
      // an episode is ~30 min, a feature ~100 — without this gate a film of the
      // same series name wins
      const sd = await api.season(id, season).catch(() => null);
      runtimeMin = sd?.episodes?.find((e2) => e2.episode_number === episode)?.runtime || 0;
      if (seq !== cleanSeq || mode !== 'clean') return;
    }
    const year = String(d.release_date || d.first_air_date || '').slice(0, 4);
    const src = await findCleanSource(title, year, runtimeMin);
    if (seq !== cleanSeq || mode !== 'clean') return;
    if (!src) {
      loadLabel().textContent = '';
      const box = h(
        'div.m-fail',
        {},
        h('h3', {}, t('No licensed copy in the catalogue')),
        h(
          'p',
          {},
          isTv
            ? t('Nothing on Archive carries an explicit public-domain or Creative-Commons statement for this episode. Almost no TV episodes have had their rights expire or been gifted — which is exactly why the clean room stays ad-free. Use the embed pool for this one.')
            : t('This title has no copy on Archive with an explicit public-domain mark or CC licence. The clean room refuses anything else, including fan uploads of the real film, because that is the only way it can stay legal and ad-free.'),
        ),
        h(
          'div.m-fail-actions',
          {},
          h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => setMode('direct') }, t('Try the direct stream')),
          h('button.btn.btn--glass.btn--sm', { type: 'button', onclick: () => setMode('pool') }, t('Use the embed pool')),
          h('a.btn.btn--glass.btn--sm', { href: `#/movies?type=${type}` }, t('Find similar titles')),
        ),
      );
      loading.append(box);
      return;
    }
    cleanSrc = src;
    video.poster = src.thumb;
    video.src = src.url;
    video.hidden = false;
    brand.hidden = false;
    loadLabel().textContent = t('Buffering from archive.org…');
    paintCleanMeta();
  }

  video.addEventListener('loadedmetadata', () => {
    if (mode !== 'clean') return;
    loading.classList.add('hide');
    clearFailBox();
    const secs = Math.round(video.duration || 0);
    setMovieProgress({
      type, id, title, posterPath: d.poster_path, season, episode,
      seconds: secs ? Math.min(secs, Math.round(secs * 0.02)) : 0,
      duration: secs,
    });
    const mb = cleanSrc ? Math.round(cleanSrc.bytes / 1048576) : 0;
    toast(`${t('Clean room ready')} — ${mb} MB ${cleanSrc ? cleanSrc.format : t('file')}, ${t('zero third-party code')}`, { iconName: 'shield' });
  });

  video.addEventListener('error', () => {
    if (mode !== 'clean' || !video.src) return;
    loadLabel().textContent = '';
    clearFailBox();
    loading.append(
      h(
        'div.m-fail',
        {},
        h('h3', {}, t('The licensed file will not play here')),
        h('p', {}, t('Archive.org refused the stream for this browser. Try the embed pool instead.')),
        h(
          'div.m-fail-actions',
          {},
          h('button.btn.btn--primary.btn--sm', { type: 'button', onclick: () => setMode('pool') }, t('Use the embed pool')),
        ),
      ),
    );
  });

  /* ---------- engine switch ---------- */
  function setMode(next) {
    if (next === mode) return;
    mode = next;
    dropFrame();
    stopVideo();
    clearFailBox();
    modeRow.querySelectorAll('.m-seg-btn').forEach((b) => {
      const on = b.dataset.m === next;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    paintSafety();
    if (next === 'pool') boot();
    else if (next === 'clean') loadClean();
    else loadDirect(false);
  }

  /* ---------- episode nav (TV) ---------- */
  if (isTv) {
    const nav = h(
      'div.m-fail-actions',
      { style: { justifyContent: 'flex-start', margin: 0 } },
      h('a.btn.btn--glass.btn--sm', {
        href: `#/mwatch/${id}?type=tv&s=${season}&e=${Math.max(1, episode - 1)}`,
      }, icon('prev'), t('Prev episode')),
      h('a.btn.btn--glass.btn--sm', { href: `#/mwatch/${id}?type=tv&s=${season}&e=${episode + 1}` }, t('Next episode'), icon('next')),
    );
    shell.insertBefore(nav, modeRow);
  }

  /* ---------- go ---------- */
  paintSafety();
  loadDirect();
  return shell;
}
