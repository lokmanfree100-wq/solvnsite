/**
 * SOLVN CAT — the mascot in the top bar and the conversation panel.
 *
 * The button is the same artwork the splash and the tab icon use, so the
 * assistant is the site's cat rather than a second character. The eyes in that
 * drawing already glow; the CSS adds a slow pulse over them and a small 3D
 * float, and respects reduced-motion.
 *
 * The panel is created once and lives outside the router's view, so a reply is
 * not lost when the viewer follows a recommendation to another page. Only the
 * conversation (plain text) is kept in memory — nothing is persisted, and the
 * server never sees an account.
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

let panel = null;
let log = null;
let form = null;
let input = null;
let sendBtn = null;
let chips = null;
let launcher = null;
let busy = false;
let open = false;

/** Conversation in the shape the server expects. */
const history = [];
const GREETING =
  "I'm SOLVN CAT. Tell me a mood, a genre, or a show you loved — I'll find something real in the catalogue. I only talk anime.";

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
    input.focus();
  }
}

function onKey(e) {
  if (e.key === 'Escape' && open) {
    closeCat();
    return;
  }
}

export function openCat() {
  ensurePanel();
  if (open) return;
  open = true;
  panel.hidden = false;
  panel.classList.add('is-open');
  launcher?.setAttribute('aria-expanded', 'true');
  launcher?.classList.add('is-open');
  document.addEventListener('keydown', onKey);
  setTimeout(() => input?.focus(), 160);
  scrollLog();
}

export function closeCat() {
  if (!panel || !open) return;
  open = false;
  panel.classList.remove('is-open');
  panel.hidden = true;
  launcher?.setAttribute('aria-expanded', 'false');
  launcher?.classList.remove('is-open');
  document.removeEventListener('keydown', onKey);
  launcher?.focus({ preventScroll: true });
}

function ensurePanel() {
  if (panel) return;

  input = h('textarea.cat-input', {
    rows: 1,
    maxlength: 700,
    placeholder: 'Ask for an anime…',
    'aria-label': 'Message SOLVN CAT',
  });
  sendBtn = h(
    'button.cat-send',
    { type: 'submit', 'aria-label': 'Send', disabled: true },
    icon('arrowUpRight'),
  );
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

/** The mascot button the top bar mounts beside the account tools. */
export function catButton() {
  ensurePanel();
  const btn = h(
    'button.cat-launch',
    {
      type: 'button',
      'aria-label': 'Ask SOLVN CAT, the anime assistant',
      'aria-expanded': String(open),
      'aria-controls': 'cat-panel',
      title: 'Ask SOLVN CAT',
      onclick: () => (open ? closeCat() : openCat()),
    },
    h(
      'span.cat-launch-art',
      {},
      h('img', { src: 'assets/solvn-cat.jpg', alt: '', width: 736, height: 736, decoding: 'async' }),
      h('span.cat-launch-eyes', { 'aria-hidden': 'true' }),
    ),
    h('span.cat-launch-ring', { 'aria-hidden': 'true' }),
    h('span.cat-launch-spark', { 'aria-hidden': 'true' }, icon('sparkles')),
  );
  btn.classList.toggle('is-open', open);
  launcher = btn;
  return btn;
}
