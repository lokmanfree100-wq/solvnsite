/**
 * The account face: the avatar, the sheet that signs people in, the chip in the
 * top bar. Nothing here measures a person any more — no rank pill, no badge
 * row, no scoreboard of hours — because the profile is about who you are, not
 * where you sit next to other people.
 */

import { h, icon, ICONS } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { go } from '../lib/router.js';
import { account, login, signup, logout, staticHost } from '../lib/account.js';
import { googleReady, googleSignInUrl } from '../lib/cloud.js';
import { isGuest, setGuest } from '../lib/store.js';

/** A server message is English; run it through t() so locales can cover it. */
export const say = (err) => t(err?.message || 'Something went wrong. Try again.');

const FALLBACK_GLYPH = 'ghost';

/* Google's mark is a four-colour brand asset, so it is inlined rather than
   folded into the single-tone icon set. Static string — nothing interpolates. */
const GOOGLE_MARK =
  '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.26-.17-1.86H9v3.6h4.86a4.17 4.17 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.66-3.89 2.66-6.72z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.98-2.18l-2.92-2.26c-.8.55-1.85.87-3.06.87-2.36 0-4.36-1.58-5.08-3.72H.93v2.34A8.99 8.99 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.92 10.7a5.4 5.4 0 0 1 0-3.4V4.96H.93a8.99 8.99 0 0 0 0 8.08l2.99-2.34z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.43 1.35l2.57-2.57A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .93 4.96l2.99 2.34C4.64 5.16 6.64 3.58 9 3.58z"/>' +
  '</svg>';

function googleMark() {
  return h('span.g-icon', { html: GOOGLE_MARK });
}

/** The hue a glyph was minted with, turned into a two-stop glass gradient. */
function tone(hue, alpha = 1) {
  const h1 = Number(hue) || 0;
  return `hsl(${h1} 92% 68% / ${alpha})`;
}

/* ---- the fallback when there is no picture ---------------------------
   A name beats a stock icon: it is the member's own, it is the same thing the
   row beside it says, and no two of them look alike. The script is left to the
   browser — a Latin name gets a Latin letter, a Japanese one a kana, an Arabic
   one an Arabic letter, and nothing is sliced out of a surrogate pair. */
const initialsOf = (name) => {
  const clean = String(name ?? '').replace(/[#@_[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const parts = clean.split(' ');
  const letters = (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2))
    .replace(/[^\p{L}\p{N}]/gu, '');
  return letters ? [...letters].slice(0, 2).join('').toLocaleUpperCase() : null;
};

/**
 * A member's picture, or their name's first letter on the colour their account
 * was minted with. The bytes come from the server, so the same avatar renders
 * on the profile, in the chip and beside every comment.
 */
export function avatar(user, { size = 'md', extra = null } = {}) {
  const stored = user?.avatar?.glyph || FALLBACK_GLYPH;
  /* An older record still holding a raw data URL renders; a fresh one carries
     the blob address that came out of the upload. */
  const photo = user?.avatar?.photo || user?.avatarUrl || null;
  const initials = initialsOf(user?.username ?? user?.displayName);
  const face = photo
    ? h('img.avatar-photo', { src: photo, alt: '', decoding: 'async' })
    : initials
      ? h('span.avatar-initials', { 'aria-hidden': 'true' }, initials)
      : icon(ICONS[stored] ? stored : FALLBACK_GLYPH);
  const chip = h(
    `span.avatar.avatar--${size}${photo || initials ? '.is-filled' : ''}`,
    { 'aria-hidden': 'true' },
    face,
  );
  const hue = user?.avatar?.hue ?? 0;
  chip.style.background = `linear-gradient(150deg, ${tone(hue, 0.3)}, hsl(${(hue + 58) % 360} 96% 60% / 0.14))`;
  chip.style.borderColor = tone(hue, 0.46);
  chip.style.color = tone(hue, 1);
  chip.style.boxShadow = photo ? 'none' : `0 0 24px -8px ${tone(hue, 0.75)}`;
  if (!extra) return chip;
  return h('span.avatar-wrap', {}, chip, extra);
}

/**
 * One metric tile. It is a neutral block of type, so it reads as a figure
 * wherever it is used — the admin totals use it, and nothing on a profile does.
 */
export function statTile({ iconName, value, label, hint }) {
  return h(
    'div.metric',
    hint ? { title: t(hint) } : {},
    icon(iconName),
    h('b.metric-val.tnum', {}, value),
    h('span.metric-label', {}, t(label)),
  );
}

/* ---- sign in / sign up ---------------------------------------------- */
function field(key, props) {
  const id = `auth-${props.type}-${key}`;
  const err = h('span.field-err', { role: 'alert' });
  const input = h('input.input', { id, ...props, oninput: () => (err.textContent = '') });
  const wrap = h(
    'div.field',
    {},
    h('label', { for: id }, t(key)),
    input,
    err,
  );
  return { node: wrap, input, err, set: (m) => (err.textContent = m) };
}

/**
 * One sheet, three ways in: Google (only when a verified cloud project exists
 * in Settings — an OAuth button with no keys behind it is a dead control),
 * email, or no account at all. "Continue as Guest" closes the sheet and is
 * remembered, so nothing on this device prompts again.
 */
export function authSheet(mode = 'login') {
  let current = mode;
  const api = { close: () => {} };

  const googleButton = () => {
    const btn = h(
      'button.btn.btn--google.grow',
      {
        type: 'button',
        onclick: () => {
          btn.disabled = true;
          location.assign(googleSignInUrl());
        },
      },
      googleMark(),
      h('span', {}, t('Continue with Google')),
    );
    return btn;
  };

  const build = () => {
    const isSignup = current === 'signup';
    const name = isSignup ? field('Username', { name: 'username', autocomplete: 'username', maxlength: 24, placeholder: 'SolvnFox' }) : null;
    const email = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
    const pass = field('Password', { type: 'password', name: 'password', autocomplete: isSignup ? 'new-password' : 'current-password', required: true, minlength: 8 });
    const submit = h('button.btn.btn--primary.grow', { type: 'submit' }, isSignup ? t('Create account') : t('Sign in'));

    const form = h(
      'form.auth-form.stack',
      {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const body = { email: email.input.value.trim(), password: pass.input.value };
          if (isSignup) body.username = name.input.value.trim();

          if (isSignup && !/^[\p{L}\p{N}][\p{L}\p{N} _.'-]{1,23}$/u.test(body.username)) {
            name.set(t('Use 2-24 letters, numbers, spaces or . _ - for your name.'));
            name.input.focus();
            return;
          }
          if (!body.email || !body.password) {
            email.set(t('Fill in both fields.'));
            (body.email ? pass : email).input.focus();
            return;
          }
          if (body.password.length < 8) {
            pass.set(t('Use 8 to 200 characters for your password.'));
            pass.input.focus();
            return;
          }

          submit.disabled = true;
          submit.classList.add('is-busy');
          submit.setAttribute('aria-busy', 'true');
          try {
            const user = isSignup ? await signup(body) : await login(body.email, body.password);
            setGuest(false);
            api.close();
            toast(t('Welcome, {name}', { name: user.username }), { iconName: 'sparkles' });
            go('/profile');
          } catch (err) {
            const msg = say(err);
            pass.set(msg);
            email.set('');
            name?.set('');
            (err.status === 401 || err.status === 429 ? pass : email).input.focus();
          } finally {
            submit.disabled = false;
            submit.classList.remove('is-busy');
            submit.removeAttribute('aria-busy');
          }
        },
      },
      name?.node || null,
      email.node,
      pass.node,
      h('div.auth-foot', {}, submit),
      h(
        'button.linkish',
        {
          type: 'button',
          onclick: () => {
            current = isSignup ? 'login' : 'signup';
            render();
          },
        },
        isSignup ? t('I already have an account') : t('Create one instead'),
      ),
    );

    return h(
      'div.auth-inner',
      {},
      googleReady()
        ? h(
            'div.auth-oauth',
            {},
            googleButton(),
            h('div.auth-or', { 'aria-hidden': 'true' }, h('span', {}, t('or use email'))),
          )
        : null,
      form,
      h('div.auth-or', { 'aria-hidden': 'true' }, h('span', {}, t('or'))),
      h(
        'button.btn.btn--guest',
        {
          type: 'button',
          onclick: () => {
            setGuest(true);
            api.close();
            toast(t('Browsing as a guest. Your history stays on this device.'), { iconName: 'ghost' });
          },
        },
        icon('ghost'),
        h('span', {}, t('Continue as Guest')),
      ),
    );
  };

  const body = h('div.auth-body', {}, build());
  const render = () => {
    body.replaceChildren(build());
    const first = body.querySelector('input');
    first?.focus({ preventScroll: true });
  };

  const opened = sheet({
    heading: current === 'signup' ? t('Create your account') : t('Sign in'),
    sub: t('An account keeps your name, your picture, your favourite anime and your lists in one place.'),
    render: () => body,
    width: 420,
  });
  api.close = opened.close;
  return opened;
}

/* ---- the thing in the top bar --------------------------------------- */
export function accountChip() {
  const { status, user } = account();
  /* Without a server there is no session to show or create, and a "Sign in"
     button that can only fail is worse than no button: the chip links to the
     history this device keeps instead. */
  if (staticHost()) {
    return h(
      'button.btn.btn--account',
      { type: 'button', title: t('Profile'), 'aria-label': t('Profile'), onclick: () => go('/profile') },
      icon('user'),
      h('span.account-name', {}, t('Profile')),
    );
  }
  if (status === 'signedin' && user) {    return h(
      'button.btn.btn--account',
      {
        type: 'button',
        title: t('Your profile'),
        'aria-label': t('Your profile'),
        onclick: () => go('/profile'),
      },
      avatar(user, { size: 'sm' }),
      h('span.account-name', {}, user.username),
    );
  }
  const guest = isGuest();
  return h(
    'button.btn.btn--account.is-out',
    {
      type: 'button',
      title: guest ? t('Signed in as guest') : t('Sign in'),
      'aria-label': guest ? t('Signed in as guest') : t('Sign in'),
      onclick: () => authSheet('login'),
    },
    icon(guest ? 'ghost' : 'user'),
    h('span.account-name', {}, guest ? t('Guest') : t('Sign in')),
  );
}

export function signOutButton() {
  return h(
    'button.btn',
    {
      type: 'button',
      onclick: async () => {
        await logout();
        toast(t('Signed out. Your local history stays on this device.'), { iconName: 'check' });
        go('/');
      },
    },
    icon('arrowLeft'),
    h('span', {}, t('Sign out')),
  );
}
