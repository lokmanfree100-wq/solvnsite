/**
 * SOLVN CAT — a floating 3D mascot and the conversation panel.
 *
 * The cat is drawn, not pasted: a small Three.js bust built from the shapes in
 * the upload — black head, tall pointed ears, two huge white-blue eyes, a tiny
 * smile and a ruff of electric-blue energy below it. A rim shader paints the
 * neon outline, additive sprites light the eyes, and a points field supplies the
 * drifting sparks. It lives in its own fixed canvas above the page, not in a
 * button, so it can hover, turn its head, blink and react without moving the
 * navigation around.
 *
 * Cost is deliberately small: one canvas, ~5k triangles, no lights, no shadows,
 * no post-processing, capped pixel ratio, and rendering stops while the tab is
 * hidden. If WebGL is unavailable the mount falls back to the original artwork
 * rather than leaving the assistant unreachable.
 *
 * The panel half is unchanged in behaviour: it talks only to /api/chat, keeps
 * the conversation in memory, and survives navigation because it sits outside
 * the router's view.
 */

import { h, icon } from '../lib/dom.js';
import { askCat, catErrorMessage } from '../lib/assistant.js';

const STARTERS = [
  'Something like Attack on Titan',
  'A short, sad romance',
  'Best anime of 2026',
  'I want to laugh tonight',
  'A mystery with a time loop',
];

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.min.js';

let panel = null;
let log = null;
let form = null;
let input = null;
let sendBtn = null;
let chips = null;
let mountEl = null;
let busy = false;
let open = false;
let three3d = null;

/** Conversation in the shape the server expects. */
const history = [];
const GREETING =
  "I'm SOLVN CAT. Tell me a mood, a genre, or a show you loved — I'll find something real in the catalogue. I only talk anime.";

/* ------------------------------------------------------------------ panel */

function scrollLog() {
  requestAnimationFrame(() => {
    if (log) log.scrollTop = log.scrollHeight;
  });
}

function bubble(role, text) {
  return h(
    `div.cat-msg.cat-msg-${role}`,
    {},
    role === 'cat' ? h('span.cat-msg-face', {}, h('img', { src: 'assets/solvn-cat.jpg', alt: '', loading: 'lazy' })) : null,
    h('div.cat-bubble', {}, text),
  );
}

function pickCard(p) {
  const meta = [p.year, p.format ? String(p.format).replace(/_/g, ' ') : null, p.episodes ? `${p.episodes} ep` : null]
    .filter(Boolean)
    .join(' · ');
  return h(
    'a.cat-pick',
    { href: `#/anime/${p.id}`, onclick: () => closeCat() },
    h(
      'span.cat-pick-art',
      { style: p.color ? `--pick-tint:${p.color}` : null },
      h('img', { src: p.cover, alt: '', loading: 'lazy', decoding: 'async' }),
    ),
    h(
      'span.cat-pick-text',
      {},
      h('strong.cat-pick-title', {}, p.title),
      meta ? h('span.cat-pick-meta', {}, meta) : null,
      h('span.cat-pick-genres', {}, (p.genres || []).join(' · ')),
    ),
    h('span.cat-pick-go', {}, icon('chevronRight')),
  );
}

function typing() {
  return h(
    'div.cat-msg.cat-msg-cat.cat-typing',
    {},
    h('span.cat-msg-face', {}, h('img', { src: 'assets/solvn-cat.jpg', alt: '' })),
    h('div.cat-bubble', {}, h('span.cat-dot'), h('span.cat-dot'), h('span.cat-dot')),
  );
}

function addReply(reply, picks) {
  const node = bubble('cat', reply);
  if (picks?.length) node.querySelector('.cat-bubble').append(h('div.cat-picks', {}, ...picks.map(pickCard)));
  log.append(node);
  scrollLog();
}

function setBusy(next) {
  busy = next;
  if (sendBtn) sendBtn.disabled = next || !input.value.trim();
  if (input) input.setAttribute('aria-busy', String(next));
  panel?.classList.toggle('is-busy', next);
}

async function send(text) {
  const clean = String(text || '').trim();
  if (!clean || busy) return;

  if (chips) {
    chips.remove();
    chips = null;
  }

  log.append(bubble('user', clean));
  history.push({ role: 'user', content: clean });
  input.value = '';
  input.style.height = '';
  setBusy(true);
  scrollLog();

  const wait = typing();
  log.append(wait);
  scrollLog();

  try {
    const answer = await askCat(history.slice(-10));
    wait.remove();
    history.push({ role: 'assistant', content: answer.reply });
    addReply(answer.reply, answer.picks);
  } catch (err) {
    wait.remove();
    const code = err?.code || 'model';
    const node = bubble('cat', catErrorMessage(code));
    node.classList.add('is-error');
    log.append(node);
    scrollLog();
    /* The failed turn is not part of the conversation the model sees next time. */
    history.pop();
  } finally {
    setBusy(false);
    if (!open) return;
    input.focus();
  }
}

function onKey(e) {
  if (e.key === 'Escape' && open) closeCat();
}

export function openCat() {
  ensurePanel();
  three3d?.wake();
  if (open) return;
  open = true;
  panel.hidden = false;
  panel.classList.add('is-open');
  mountEl?.setAttribute('aria-expanded', 'true');
  mountEl?.classList.add('is-open');
  document.addEventListener('keydown', onKey);
  setTimeout(() => input?.focus(), 160);
  scrollLog();
}

export function closeCat() {
  if (!panel || !open) return;
  open = false;
  panel.classList.remove('is-open');
  panel.hidden = true;
  mountEl?.setAttribute('aria-expanded', 'false');
  mountEl?.classList.remove('is-open');
  document.removeEventListener('keydown', onKey);
  mountEl?.focus({ preventScroll: true });
}

function ensurePanel() {
  if (panel) return;

  input = h('textarea.cat-input', {
    rows: 1,
    maxlength: 700,
    placeholder: 'Ask for an anime…',
    'aria-label': 'Message SOLVN CAT',
  });
  sendBtn = h('button.cat-send', { type: 'submit', 'aria-label': 'Send', disabled: true }, icon('arrowUpRight'));
  chips = h(
    'div.cat-chips',
    {},
    ...STARTERS.map((s) => h('button.cat-chip', { type: 'button', onclick: () => send(s) }, s)),
  );

  log = h(
    'div.cat-log',
    { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' },
    h(
      'div.cat-msg.cat-msg-cat',
      {},
      h('span.cat-msg-face', {}, h('img', { src: 'assets/solvn-cat.jpg', alt: '' })),
      h('div.cat-bubble', {}, GREETING),
    ),
    chips,
  );

  form = h(
    'form.cat-form',
    {
      onsubmit: (e) => {
        e.preventDefault();
        send(input.value);
      },
    },
    input,
    sendBtn,
  );

  panel = h(
    'section.cat-panel#cat-panel',
    { role: 'dialog', 'aria-label': 'SOLVN CAT, the anime assistant', hidden: true },
    h(
      'header.cat-head',
      {},
      h(
        'span.cat-face',
        {},
        h('img', { src: 'assets/solvn-cat.jpg', alt: '', width: 736, height: 736, decoding: 'async' }),
        h('span.cat-face-glow', { 'aria-hidden': 'true' }),
      ),
      h(
        'span.cat-id',
        {},
        h('strong', {}, 'SOLVN CAT'),
        h('span.cat-sub', {}, 'Anime guide · replies in your language'),
      ),
      h('button.cat-close', { type: 'button', 'aria-label': 'Close assistant', onclick: closeCat }, icon('x')),
    ),
    log,
    form,
    h('p.cat-note', {}, 'Anime only. Every title comes from the real SOLVN catalogue.'),
  );

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
    sendBtn.disabled = busy || !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });

  document.body.append(panel);
}

/* --------------------------------------------------------------- mascot */

function placeCat() {
  if (!mountEl) return;
  const bar = document.getElementById('topbar');
  if (!bar || bar.hidden) {
    mountEl.style.top = '24px';
    return;
  }
  const r = bar.getBoundingClientRect();
  /* The one banner on the site has a dismiss button in the same corner. Park
     the cat below it while it is on screen so a floating pet never sits on an
     interactive control. */
  const banner = document.querySelector('.welcome:not([hidden])');
  const b = banner ? banner.getBoundingClientRect() : null;
  const floor = b && b.height > 0 && b.bottom > r.bottom ? b.bottom : r.bottom;
  mountEl.style.top = `${Math.max(24, Math.round(floor + 12))}px`;
}

function syncCatVisibility() {
  if (!mountEl) return;
  const path = location.hash.replace(/^#/, '');
  /* The player owns its own top-right corner (the watermark), and a floating
     mascot there covers video controls. Every other page keeps the cat. */
  const watching = /^\/(watch|mwatch)\//.test(path);
  mountEl.hidden = watching;
  if (watching && open) closeCat();
  /* A new route may add or remove the welcome banner above the page; re-seat
     the cat once the view has settled. */
  [0, 260, 900].forEach((ms) => setTimeout(placeCat, ms));
}

export function mountCat() {
  if (mountEl) return;

  mountEl = h(
    'div.cat-float#cat-float',
    {
      role: 'button',
      tabindex: '0',
      'aria-label': 'SOLVN CAT — open the anime assistant',
      'aria-expanded': String(open),
      'aria-controls': 'cat-panel',
      title: 'Ask SOLVN CAT',
      onclick: () => {
        three3d?.poke();
        open ? closeCat() : openCat();
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          three3d?.poke();
          open ? closeCat() : openCat();
        }
      },
      onpointerenter: () => three3d?.hover(true),
      onpointerleave: () => three3d?.hover(false),
    },
    h('canvas.cat-canvas', { 'aria-hidden': 'true' }),
    h('img.cat-fallback', { src: 'assets/solvn-cat.jpg', alt: '', width: 736, height: 736, 'aria-hidden': 'true' }),
    h('span.cat-float-halo', { 'aria-hidden': 'true' }),
    h('span.cat-float-tip', {}, 'Ask SOLVN CAT'),
  );

  document.body.append(mountEl);
  ensurePanel();
  placeCat();
  syncCatVisibility();
  window.addEventListener('resize', placeCat, { passive: true });
  window.addEventListener('hashchange', syncCatVisibility);
  document.addEventListener('kitsune:nav', placeCat);

  /* The first nav is built a tick after this mount, and the bar changes height
     when the search field wraps. Watching it keeps the cat under the chrome
     instead of guessing a top offset. */
  const watchBar = () => {
    const bar = document.getElementById('topbar');
    if (!bar) {
      setTimeout(watchBar, 120);
      return;
    }

    /* Dismissing the welcome banner frees the corner above the cat; catch the
       change so the mascot rises back under the navigation instead of keeping
       the banner's old height as a gap. */
    let bannerWas = Boolean(document.querySelector('.welcome'));
    const view = document.getElementById('view');
    if (view) {
      new MutationObserver(() => {
        const has = Boolean(document.querySelector('.welcome'));
        if (has === bannerWas) return;
        bannerWas = has;
        placeCat();
      }).observe(view, { childList: true, subtree: true });
    }
    new ResizeObserver(() => placeCat()).observe(bar);
    /* The bar is hidden on some routes and re-shown on others; neither changes
       its measured size, so watch the attribute as well. */
    new MutationObserver(() => requestAnimationFrame(placeCat)).observe(bar, {
      attributes: true,
      attributeFilter: ['hidden', 'class', 'style'],
    });
    placeCat();
    [0, 260, 1100].forEach((ms) => setTimeout(placeCat, ms));
  };
  watchBar();

  import(THREE_URL)
    .then((THREE) => {
      try {
        three3d = initScene(THREE);
      } catch {
        three3d = null;
      }
      if (!three3d) {
        mountEl.classList.add('is-flat');
        mountEl.querySelector('canvas')?.remove();
      }
    })
    .catch(() => {
      mountEl.classList.add('is-flat');
      mountEl.querySelector('canvas')?.remove();
    });
}

/* ------------------------------------------------------------ three scene */

function initScene(THREE) {
  const canvas = mountEl.querySelector('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
  } catch {
    mountEl.classList.add('is-flat');
    return null;
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = window.matchMedia('(hover: none)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 0.05, 5.5);
  camera.lookAt(0, -0.05, 0);

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));

  /* -- shared glow sprite -------------------------------------------------- */
  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(235,250,255,1)');
    g.addColorStop(0.28, 'rgba(150,215,255,0.65)');
    g.addColorStop(0.62, 'rgba(70,135,255,0.2)');
    g.addColorStop(1, 'rgba(30,70,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const glow = glowTexture();

  /* -- fur: near-black with a fresnel rim so the volume reads -------------- */
  const fur = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color('#04060b') },
      uRim: { value: new THREE.Color('#3f7dff') },
      uEdge: { value: new THREE.Color('#9fd4ff') },
    },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vN;
      varying vec3 vV;
      uniform vec3 uBase;
      uniform vec3 uRim;
      uniform vec3 uEdge;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
        float hot = pow(f, 5.0);
        vec3 col = mix(uBase, uRim, f * 0.9);
        col = mix(col, uEdge, hot * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  const cat = new THREE.Group();
  scene.add(cat);

  /* -- head --------------------------------------------------------------- */
  const head = new THREE.Group();
  head.position.y = 0.12;
  cat.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), fur);
  skull.scale.set(1.02, 0.92, 0.94);
  head.add(skull);

  /* cheeks/muzzle volume, so the face is not a flat sphere */
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 18), fur);
  muzzle.scale.set(1.05, 0.66, 0.62);
  muzzle.position.set(0, -0.26, 0.8);
  head.add(muzzle);

  /* -- ears --------------------------------------------------------------- */
  const earGeo = new THREE.ConeGeometry(0.38, 1.02, 4, 1);
  earGeo.rotateY(Math.PI / 4);
  const innerGeo = new THREE.ConeGeometry(0.17, 0.58, 4, 1);
  innerGeo.rotateY(Math.PI / 4);
  const innerMat = new THREE.MeshBasicMaterial({ color: 0x1b3f8f });
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, fur);
    ear.position.set(side * 0.58, 1.02, -0.03);
    ear.rotation.z = side * -0.14;
    ear.scale.z = 0.58;
    head.add(ear);
    ears.push(ear);

    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.set(side * 0.58, 0.99, 0.1);
    inner.rotation.z = side * -0.14;
    inner.scale.z = 0.3;
    head.add(inner);
  }

  /* -- eyes: the one bright thing in the drawing -------------------------- */
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xeaf8ff, toneMapped: false });
  const eyeGlowMat = new THREE.SpriteMaterial({
    map: glow,
    color: 0xbfe8ff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const eyes = new THREE.Group();
  head.add(eyes);
  const eyeParts = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.25, 22, 18), eyeMat);
    eye.position.set(side * 0.38, 0.2, 0.8);
    eye.scale.set(0.9, 1.24, 0.5);
    eyes.add(eye);

    const halo = new THREE.Sprite(eyeGlowMat);
    halo.position.set(side * 0.38, 0.2, 0.94);
    halo.scale.set(0.95, 1.1, 1);
    eyes.add(halo);
    eyeParts.push({ eye, halo });
  }

  /* nose + smile, small enough to keep the face gentle */
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x8fc8ff, transparent: true, opacity: 0.8 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), faceMat);
  nose.scale.set(1.4, 0.8, 0.7);
  nose.position.set(0, -0.11, 1.11);
  head.add(nose);

  const smileGeo = new THREE.TorusGeometry(0.085, 0.011, 6, 18, Math.PI);
  for (const side of [-1, 1]) {
    const arc = new THREE.Mesh(smileGeo, faceMat);
    arc.position.set(side * 0.075, -0.2, 1.1);
    arc.rotation.z = side === 1 ? Math.PI * 0.15 : Math.PI * 0.85;
    arc.rotation.x = -0.1;
    arc.scale.set(1, 0.8, 1);
    head.add(arc);
  }

  /* whiskers: six thin neon strokes */
  const whiskerGeo = new THREE.BufferGeometry();
  const w = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      w.push(side * 0.5, -0.16 + i * 0.11, 0.97, side * (1.05 + i * 0.04), -0.08 + i * 0.16, 0.66);
    }
  }
  whiskerGeo.setAttribute('position', new THREE.Float32BufferAttribute(w, 3));
  const whiskers = new THREE.LineSegments(
    whiskerGeo,
    new THREE.LineBasicMaterial({ color: 0x6fb0ff, transparent: true, opacity: 0.38 }),
  );
  head.add(whiskers);

  /* -- energy body -------------------------------------------------------- */
  const energy = new THREE.Group();
  energy.position.y = -1.12;
  cat.add(energy);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x3d86ff,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46 + i * 0.12, 0.032, 8, 42), ringMat);
    ring.rotation.x = 1.15 + i * 0.18;
    ring.rotation.z = i * 0.7;
    energy.add(ring);
    rings.push(ring);
  }

  /* The wispy tail from the drawing: one tube on a soft S-curve, additive, so
     the head sits on a body of light instead of floating as a mask. */
  const wispCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, -0.42, -0.1),
    new THREE.Vector3(0.52, -0.9, -0.18),
    new THREE.Vector3(-0.34, -1.22, 0.02),
    new THREE.Vector3(0.18, -1.5, -0.08),
  ]);
  const wispMat = new THREE.MeshBasicMaterial({
    color: 0x4f9dff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const wisp = new THREE.Mesh(new THREE.TubeGeometry(wispCurve, 40, 0.034, 6, false), wispMat);
  cat.add(wisp);

  /* trailing sparks that lag behind the bob, like the aura being left behind */
  const trails = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glow,
        color: 0x5aa8ff,
        transparent: true,
        opacity: 0.32 - i * 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    s.position.set(0.12, -0.95 - i * 0.25, -0.4);
    s.scale.setScalar(0.62 - i * 0.1);
    cat.add(s);
    trails.push(s);
  }

  /* -- aura + particles --------------------------------------------------- */
  const auraMat = new THREE.SpriteMaterial({
    map: glow,
    color: 0x3a7dff,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const aura = new THREE.Sprite(auraMat);
  aura.scale.set(3.3, 3.3, 1);
  aura.position.set(0, -0.25, -0.75);
  cat.add(aura);

  const count = coarse ? 54 : 84;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = 0.5 + Math.random() * 1.05;
    pos[i * 3] = Math.cos(a) * rad;
    pos[i * 3 + 1] = -1.7 + Math.random() * 2.9;
    pos[i * 3 + 2] = Math.sin(a) * rad * 0.6 - 0.15;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0x7fc0ff,
    size: 0.105,
    map: glow,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  cat.add(sparks);

  let refresh = 0;
  let aspect = 1;

  function resize() {
    const box = mountEl.getBoundingClientRect();
    const width = Math.max(1, Math.round(box.width));
    const height = Math.max(1, Math.round(box.height));
    renderer.setSize(width, height, false);
    aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(mountEl);

  /* -- interaction state --------------------------------------------------- */
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let hovered = false;
  let pop = 0;
  let nextBlink = 2.2 + Math.random() * 2.4;
  let blinkAt = -1;
  let earFlick = 0;
  let nextFlick = 4 + Math.random() * 5;

  function onMove(e) {
    if (coarse) return;
    look.tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
    look.ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', () => {
    look.tx = 0;
    look.ty = 0;
  });

  let started = performance.now();
  const introMs = reduce ? 320 : 1650;

  /* The first visit is covered by the splash for 3.6s. Starting the flight
     behind it would waste the one welcome the visitor sees, so the intro waits
     for the splash node to leave. */
  if (document.getElementById('splash')) {
    const gate = new MutationObserver(() => {
      if (document.getElementById('splash')) return;
      gate.disconnect();
      started = performance.now();
    });
    gate.observe(document.body, { childList: true });
  }
  const clock = new THREE.Clock();

  let visible = !document.hidden;
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    if (visible) clock.start();
    else clock.stop();
  });

  function frame() {
    if (!visible) return;
    const elapsed = performance.now() - started;
    const t = clock.getElapsedTime();

    /* welcome: drop in from above, overshoot slightly, scatter sparks */
    const intro = Math.max(0, Math.min(1, elapsed / introMs));
    const ease = 1 - Math.pow(1 - intro, 3);
    const overshoot = Math.sin(intro * Math.PI) * (reduce ? 0 : 0.06);
    const baseScale = 0.9 + overshoot;

    /* idle hover */
    const bob = reduce ? 0 : Math.sin(t * 1.65) * 0.07;
    const sway = reduce ? 0 : Math.sin(t * 0.85) * 0.045;

    cat.position.y = bob + (1 - ease) * 2.3;
    cat.rotation.z = sway * 0.5;
    cat.rotation.y = (1 - ease) * 0.7;

    /* pointer / idle scanning */
    if (coarse) {
      look.tx = Math.sin(t * 0.34) * 0.3;
      look.ty = Math.sin(t * 0.23) * 0.12;
    }
    look.x += (look.tx - look.x) * 0.06;
    look.y += (look.ty - look.y) * 0.06;
    head.rotation.y = look.x * 0.4;
    head.rotation.x = look.y * 0.16 + Math.sin(t * 0.9) * 0.015;

    /* blink, and the occasional ear flick */
    if (t > nextBlink && blinkAt < 0) {
      blinkAt = t;
      nextBlink = t + 2.6 + Math.random() * 3.2;
    }
    let lid = 1;
    if (blinkAt >= 0) {
      const d = t - blinkAt;
      if (d < 0.17) lid = 1 - Math.sin((d / 0.17) * Math.PI) * 0.93;
      else blinkAt = -1;
    }
    for (const { eye, halo } of eyeParts) {
      eye.scale.y = 1.24 * lid;
      halo.scale.y = 1.1 * (0.35 + lid * 0.65);
      halo.material.opacity = 0.75 + Math.sin(t * 2.4) * 0.12;
    }

    if (t > nextFlick && !reduce) {
      earFlick = 1;
      nextFlick = t + 4 + Math.random() * 6;
    }
    if (earFlick > 0) {
      earFlick = Math.max(0, earFlick - 0.05);
      ears[0].rotation.x = Math.sin(earFlick * Math.PI) * 0.22;
      ears[1].rotation.x = Math.sin(earFlick * Math.PI + 0.4) * 0.18;
    } else {
      ears[0].rotation.x += (0 - ears[0].rotation.x) * 0.15;
      ears[1].rotation.x += (0 - ears[1].rotation.x) * 0.15;
    }

    /* hover + click reactions */
    pop = Math.max(0, pop - 0.045);
    const target = (hovered ? 1.07 : 1) + pop * 0.16;
    cat.scale.x += (baseScale * target - cat.scale.x) * 0.14;
    cat.scale.y = cat.scale.x;
    cat.scale.z = cat.scale.x;

    if (reduce) {
      cat.position.y = 0;
      cat.rotation.z = 0;
    }

    energy.rotation.y = t * (reduce ? 0.05 : 0.4);
    rings[0].rotation.z = t * 0.5;
    rings[1].rotation.z = -t * 0.36;
    ringMat.opacity = 0.35 + Math.sin(t * 1.7) * 0.12;
    wisp.rotation.z = Math.sin(t * 0.7) * 0.08;
    wispMat.opacity = 0.4 + Math.sin(t * 1.5 + 0.6) * 0.12;
    trails.forEach((s, i) => {
      s.position.x = Math.sin(t * 1.1 + i * 0.9) * 0.16;
      s.material.opacity = 0.22 + Math.sin(t * 1.9 + i) * 0.1;
    });

    sparks.rotation.y = t * 0.12;
    sparks.position.y = Math.sin(t * 0.6) * 0.08;
    sparkMat.opacity = (0.35 + Math.sin(t * 1.3) * 0.12) * (0.4 + intro * 0.6);

    auraMat.opacity = 0.16 + intro * 0.22 + Math.sin(t * 1.1) * 0.03;
    aura.scale.setScalar(3.1 + intro * 0.3 + Math.sin(t * 0.8) * 0.08);

    refresh += 1;
    if (refresh % 2 === 0 || !coarse) renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(frame);

  return {
    wake() {
      nextBlink = Math.min(nextBlink, clock.getElapsedTime() + 0.15);
      pop = Math.max(pop, 0.45);
    },
    hover(on) {
      hovered = on;
    },
    poke() {
      pop = 1;
      earFlick = 1;
    },
  };
}
