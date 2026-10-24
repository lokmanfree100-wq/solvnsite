/**
 * The account face: the avatar, the sheet that signs people in, the chip in the
 * top bar, and the two lines a record can be worn as — a division and a duel
 * tally. Both are drawn from numbers this server writes, so nothing printed here
 * is a claim; everything else about a profile is who you are rather than where
 * you sit next to other people.
 */

import { h, icon, ICONS } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { go } from '../lib/router.js';
import {
  account,
  forgotPassword,
  isSignedIn,
  login,
  logout,
  setNewPassword,
  shownName,
  signup,
  staticHost,
} from '../lib/account.js';
import { authReady, googleReady, googleSignInUrl } from '../lib/cloud.js';
import { divisionOf, titleById, titleUnlocked } from '../lib/ranks.js';
import { inboxState, inboxUsable } from '../lib/dms.js';
import { isGuest, markAsked, setGuest, wasAsked } from '../lib/store.js';

/**
 * A server message is English; run it through t() so locales can cover it.
 * `fallback` is for the reads whose generic answer tells you nothing — a failed
 * trade signature should say which trade did not take it.
 */
export const say = (err, fallback) => t(err?.message || fallback || 'Something went wrong. Try again.');

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
     the blob address that came out of the upload, or the `face` address a
     gallery portrait or a pasted link left behind. */
  const photo = user?.avatar?.photo || user?.avatar?.face || user?.avatarUrl || null;
  const initials = initialsOf(shownName(user));
  const glyph = () =>
    initials ? h('span.avatar-initials', { 'aria-hidden': 'true' }, initials) : icon(ICONS[stored] ? stored : FALLBACK_GLYPH);
  const face = photo
    ? h('img.avatar-photo', {
        src: photo,
        alt: '',
        decoding: 'async',
        /* A picture that no longer exists is not worth an empty circle: the
           member's own initials stand in until they choose another one. */
        onError: (e) => {
          const chipEl = e.target.closest('.avatar');
          if (!chipEl) return;
          chipEl.classList.remove('is-filled');
          chipEl.replaceChildren(glyph());
        },
      })
    : glyph();
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
 * The title a member chose to wear, drawn next to their name wherever the name
 * appears. Nothing is decided here: the account stores one id and `TITLES` says
 * whether the figures on this record earn it — so a profile shows the same
 * answer to its owner and to a stranger, and a title that was revoked upstream
 * quietly stops being drawn instead of lying there.
 */
export function titleChip(user) {
  const title = titleById(user?.title);
  if (!title || !titleUnlocked(title, user)) return null;
  return h(
    'span.user-title',
    {
      dataset: { title: title.id },
      title: t(title.label),
      style: {
        color: tone(title.hue, 1),
        borderColor: tone(title.hue, 0.42),
        background: `linear-gradient(150deg, ${tone(title.hue, 0.2)}, hsl(${(title.hue + 58) % 360} 96% 60% / 0.1))`,
      },
    },
    icon(title.icon),
    t(title.label),
  );
}

/**
 * One metric tile. It is a neutral block of type, so it reads as a figure
 * wherever it is used — the four under a profile name and the admin totals
 * share it.
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

/**
 * The division a duel record has reached, worn next to the name.
 *
 * It is drawn from `user.duel`, which only this server writes — a win is filed
 * when both line-ups have settled — so a badge here cannot be talked into. A
 * member who has never fought gets nothing rather than a badge for nothing, for
 * the same reason the ranked board does not list a zero.
 */
export function divisionChip(user) {
  const d = divisionOf(user);
  if (!d) return null;
  const label = t(d.label);
  return h('span.div-chip', { title: label, 'aria-label': label }, icon(d.icon), h('span', {}, label));
}

/**
 * The record the arena keeps: two columns, a rate, and the run a member is on.
 *
 * Printed on a profile as well as above the queue, because a win/loss line is
 * the shortest true thing about how somebody fights. The live run is the one
 * figure given a light — it is the number that can still be lost, and it is the
 * one the server resets to zero the moment a duel goes against you.
 */
export function duelRecord(user, { hideEmpty = false } = {}) {
  const d = user?.duel || {};
  const wins = Number(d.wins) || 0;
  const losses = Number(d.losses) || 0;
  const fought = wins + losses;
  if (!fought && hideEmpty) return null;
  const rate = fought ? Math.round((wins / fought) * 100) : 0;
  const rows = [
    [t('Wins'), wins, 'trophy', ''],
    [t('Losses'), losses, 'x', ''],
    [t('Win rate'), `${rate}%`, 'trending', ''],
    [t('Win streak'), Number(d.streak) || 0, 'flame', Number(d.streak) > 0 ? 'is-streak' : ''],
    [t('Best run'), Number(d.best) || 0, 'crown', ''],
  ];
  return h(
    'div.duel-record',
    { 'aria-label': t('Duel record') },
    ...rows.map(([label, value, iconName, cls]) =>
      h(`span.duel-chip${cls ? `.${cls}` : ''}`, {}, icon(iconName), h('b.tnum', {}, String(value)), h('span', {}, label)),
    ),
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

/* ---- arriving --------------------------------------------------------
   Two moments deserve more than a toast: the minute an account is created, and
   the minute a person finds out their address is now confirmed. */

/** The first thing a new member sees — the site speaking to them by name. */
export function welcomeSheet(user) {
  const name = shownName(user) || t('friend');
  const localOnly = staticHost() && !authReady();
  const api = sheet({
    heading: t('Welcome to Solvn'),
    width: 460,
    render: () =>
      h(
        'div.welcome',
        {},
        avatar(user, { size: 'lg' }),
        h('h3.welcome-title', {}, t('Welcome to Solvn, {name}! Enjoy streaming.', { name })),
        h('p.faint', {}, localOnly
          ? t('Your name, your picture and your lists are saved on this browser.')
          : t('Your name, your picture and your lists now follow your account.')),
        h(
          'div.auth-foot',
          {},
          h(
            'button.btn.btn--primary.grow',
            { type: 'button', onclick: () => { api.close(); go('/discover'); } },
            icon('play'),
            t('Start watching'),
          ),
          h(
            'button.btn.grow',
            { type: 'button', onclick: () => { api.close(); go('/profile'); } },
            icon('user'),
            t('My profile'),
          ),
        ),
      ),
  });
  return api;
}

/**
 * Shown when the project insists on a confirmed address first: the account is
 * real, this browser holds no session, and only the inbox can finish the job.
 */
export function verifySheet(email) {
  return sheet({
    heading: t('Check your email'),
    sub: t('We sent a confirmation link to {email}. Open it to finish creating your account.', { email }),
    width: 420,
    render: (api) =>
      h(
        'div.welcome',
        {},
        h('span.verify-art', {}, icon('check')),
        h('button.btn.btn--primary.grow', { type: 'button', onclick: () => api.close() }, t('Got it')),
      ),
  });
}

/* ---- a new password --------------------------------------------------
   The reset link has already proved who the person is — Supabase handed this
   browser a session for it. All that is left is to write the new password onto
   that session, which is the last thing the link can be used for. */
export function resetSheet() {
  const pass = field('Password', { type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: 8 });
  const again = field('Confirm password', { type: 'password', name: 'confirm-password', autocomplete: 'new-password', required: true, minlength: 8 });
  const submit = h('button.btn.btn--primary.grow', { type: 'submit' }, t('Save new password'));

  const form = h(
    'form.auth-form.stack',
    {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const value = pass.input.value;
        if (value.length < 8) {
          pass.set(t('Use 8 to 200 characters for your password.'));
          pass.input.focus();
          return;
        }
        if (value !== again.input.value) {
          again.set(t('The two passwords do not match.'));
          again.input.focus();
          return;
        }
        submit.disabled = true;
        submit.classList.add('is-busy');
        submit.setAttribute('aria-busy', 'true');
        try {
          await setNewPassword(value);
          api.close();
          toast(t('Password updated. You are signed in.'), { tone: 'ok', iconName: 'check' });
          go('/profile');
        } catch (err) {
          pass.set(say(err));
        } finally {
          submit.disabled = false;
          submit.classList.remove('is-busy');
          submit.removeAttribute('aria-busy');
        }
      },
    },
    pass.node,
    again.node,
    h('div.auth-foot', {}, submit),
  );

  const api = sheet({
    heading: t('Choose a new password'),
    sub: t('Your reset link worked. Pick a password and Solvn signs you straight back in.'),
    width: 420,
    render: () => form,
  });
  return api;
}

/**
 * One sheet, four ways in: Google (only when a verified cloud project exists in
 * Settings — an OAuth button with no keys behind it is a dead control), email,
 * a reset link by email, or no account at all. "Continue as Guest" closes the
 * sheet and is remembered, so nothing on this device prompts again.
 *
 * Changing mode opens a new sheet rather than swapping the body: the heading
 * has to say what is on screen, and a sheet is cheap to rebuild.
 */
export function authSheet(mode = 'login', { welcome = false } = {}) {
  const current = mode === 'signup' || mode === 'forgot' ? mode : 'login';
  const isSignup = current === 'signup';
  const isForgot = current === 'forgot';
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

  /* "Did that address get an account?" must never be answerable from here, so
     the sheet says the same thing whatever Supabase did with the request. */
  const buildForgot = () => {
    const email = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
    const submit = h('button.btn.btn--primary.grow', { type: 'submit' }, t('Send reset link'));
    const form = h(
      'form.auth-form.stack',
      {
        novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          const value = email.input.value.trim();
          if (!value) {
            email.set(t('Enter the email your account uses.'));
            email.input.focus();
            return;
          }
          submit.disabled = true;
          submit.classList.add('is-busy');
          submit.setAttribute('aria-busy', 'true');
          try {
            await forgotPassword(value);
            body.replaceChildren(
              h(
                'div.welcome',
                {},
                h('span.verify-art', {}, icon('check')),
                h('p.faint', {}, t('If that address has an account, a reset link is on its way. Follow it to choose a new password.')),
                h('button.btn.btn--primary.grow', { type: 'button', onclick: () => authSheet('login') }, t('Back to sign in')),
              ),
            );
          } catch (err) {
            email.set(say(err));
            email.input.focus();
          } finally {
            submit.disabled = false;
            submit.classList.remove('is-busy');
            submit.removeAttribute('aria-busy');
          }
        },
      },
      email.node,
      h('div.auth-foot', {}, submit),
    );
    const body = h(
      'div.auth-inner',
      {},
      form,
      h('button.linkish', { type: 'button', onclick: () => authSheet('login') }, t('Back to sign in')),
    );
    return body;
  };

  const buildForm = () => {
    const name = isSignup ? field('Username', { name: 'username', autocomplete: 'username', maxlength: 24, placeholder: 'SolvnFox' }) : null;
    const email = field('Email', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'you@example.com' });
    const pass = field('Password', { type: 'password', name: 'password', autocomplete: isSignup ? 'new-password' : 'current-password', required: true, minlength: 8 });
    const submit = h('button.btn.btn--primary.grow', { type: 'submit' }, isSignup ? t('Create account') : t('Sign in'));

    return h(
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
            if (isSignup) {
              const { user, needsVerify } = await signup(body);
              setGuest(false);
              api.close();
              /* No session means the project wants the address confirmed first;
                 welcoming somebody who is not in would be a lie about the state. */
              if (needsVerify || !user) verifySheet(body.email);
              else welcomeSheet(user);
              return;
            }
            const user = await login(body.email, body.password);
            setGuest(false);
            api.close();
            toast(t('Welcome back, {name}', { name: shownName(user) || t('friend') }), { iconName: 'sparkles' });
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
        'div.auth-links',
        {},
        h(
          'button.linkish',
          { type: 'button', onclick: () => authSheet(isSignup ? 'login' : 'signup') },
          isSignup ? t('I already have an account') : t('Create one instead'),
        ),
        !isSignup && authReady()
          ? h('button.linkish', { type: 'button', onclick: () => authSheet('forgot') }, t('Forgot password?'))
          : null,
      ),
    );
  };

  const build = () =>
    isForgot
      ? buildForgot()
      : h(
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
          buildForm(),
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

  const headings = {
    login: t('Sign in'),
    signup: welcome ? t('Welcome to Solvn') : t('Create your account'),
    forgot: t('Reset your password'),
  };
  /* Without a cloud project the account lives in this browser, and the sheet
     says so rather than promising it will follow the member to another device. */
  const localOnly = staticHost() && !authReady();
  const subs = {
    login: localOnly
      ? t('This copy keeps accounts in this browser — signing in brings back the name, picture and lists saved here.')
      : t('An account keeps your name, your picture, your favourite anime and your lists in one place.'),
    signup: welcome
      ? localOnly
        ? t('You can watch without one — but an account keeps your name, your picture and your lists on this browser.')
        : t('You can watch without one — but signing up keeps your name, your picture and your lists waiting for you on any device.')
      : localOnly
        ? t('This copy keeps accounts in this browser, so your name, picture and lists stay on this device.')
        : t('An account keeps your name, your picture, your favourite anime and your lists in one place.'),
    forgot: t('Tell us the email you signed up with and we send a link that lets you choose a new password.'),
  };

  const opened = sheet({
    heading: headings[current],
    sub: subs[current],
    render: () => build(),
    width: 420,
  });
  api.close = opened.close;
  return opened;
}

/* ---- the first visit --------------------------------------------------
   One automatic ask per device, after the startup intro has lifted. Every
   condition is a reason not to interrupt: an account already held, a "Continue
   as Guest" already chosen, or an ask already made. The sheet can always create
   one — `lib/device.js` answers when there is no server to ask. */
export function askAboutAccount() {
  if (wasAsked() || isGuest() || isSignedIn()) return;
  markAsked();
  authSheet('signup', { welcome: true });
}

/* ---- the signed-in menu ----------------------------------------------
   The chip opens a menu instead of jumping straight to the profile: a member
   wants to see whose account this browser is holding and find the way out, and
   both belong one tap apart. */
function accountMenu(user) {
  const api = sheet({
    heading: t('Account'),
    width: 340,
    render: () =>
      h(
        'div.acct-menu',
        {},
        h(
          'div.acct-id',
          {},
          avatar(user, { size: 'md' }),
          h('div.acct-who', {}, h('b', {}, shownName(user)), user.email ? h('span.faint', {}, user.email) : null),
        ),
        h(
          'button.btn.acct-item',
          { type: 'button', onclick: () => { api.close(); go('/profile'); } },
          icon('user'),
          t('My profile'),
        ),
        h(
          'button.btn.acct-item',
          { type: 'button', onclick: () => { api.close(); go('/library'); } },
          icon('bookmark'),
          t('My list'),
        ),
        /* The way into an inbox on a phone, where the side rail is folded away.
           It is only offered when this copy has a server to file a message on. */
        inboxUsable()
          ? h(
              'button.btn.acct-item',
              { type: 'button', onclick: () => { api.close(); go('/messages'); } },
              icon('chat'),
              t('Messages'),
              inboxState().unread ? h('span.count.tnum', {}, String(inboxState().unread)) : null,
            )
          : null,
        signOutButton(() => api.close()),
      ),
  });
  return api;
}

/* ---- the thing in the top bar --------------------------------------- */
export function accountChip() {
  const { status, user } = account();
  if (status === 'signedin' && user) {
    return h(
      'button.btn.btn--account',
      {
        type: 'button',
        title: t('Account menu'),
        'aria-label': t('Account menu'),
        'aria-haspopup': 'dialog',
        onclick: () => accountMenu(user),
      },
      avatar(user, { size: 'sm' }),
      h('span.account-name', {}, shownName(user)),
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

export function signOutButton(onDone) {
  return h(
    'button.btn',
    {
      type: 'button',
      onclick: async () => {
        await logout();
        onDone?.();
        toast(t('Signed out. Your local history stays on this device.'), { iconName: 'check' });
        go('/');
      },
    },
    icon('arrowLeft'),
    h('span', {}, t('Sign out')),
  );
}
