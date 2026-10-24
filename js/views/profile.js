/**
 * Profile: who you are on Solvn. A picture, a name, the one title you would
 * pick if you could keep only one, and your own lists.
 *
 * Two names live here and only one of them is yours to change. The @handle was
 * picked at registration and stays picked — links, mentions and reports all
 * point at it — so it is shown behind a lock. The display name above it is the
 * one an account can rewrite as often as it likes.
 *
 * The four figures under the name count this device's own shelf: a favourite,
 * what is playing, what is saved, and a date. They are never compared with
 * anybody else's, and they are not drawn on somebody else's profile, where the
 * same numbers would be a lie.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { account, answerFriend, askFriend, authUsable, duelsUsable, fortuneUsable, isSignedIn, isStaff, publicProfile, patchMe, setAvatar, setBanner, setFavourite, setTitle, shownName, tradesUsable } from '../lib/account.js';
import { intlDate } from '../lib/util.js';
import { AVATAR_UPLOAD, BANNER_FREE, BANNER_KEYS, BANNER_UPLOAD, TITLES, avatarFromImageFile, bannerFromImageFile, bannerRows, titleUnlocked } from '../lib/ranks.js';
import { search } from '../lib/anilist.js';
import { PIN_MAX, displayCard, isPinned, ownedEntries, pins, publish, togglePin } from '../lib/cards.js';
import { faces, matchFaces } from '../lib/faces.js';
import { gachaCard } from '../components/gacha.js';
import { avatar, authSheet, divisionChip, duelRecord, signOutButton, statTile, say, titleChip } from '../components/account.js';
import { levelBar, levelSheet } from '../components/level.js';
import { playlistCard, newPlaylistSheet, editPlaylistSheet } from '../components/playlists.js';
import { reportAction } from '../components/report.js';
import { mediaCard, stillImage, emptyState, errorState, loadingGrid } from '../components/media.js';
import { favouriteEntries, listEntries, nowWatching } from '../lib/store.js';
import { inboxUsable } from '../lib/dms.js';

/* The private shelves, straight off this device's library. */
const TABS = [
  ['favourites', 'Favorites', () => favouriteEntries()],
  ['watching', 'Currently Watching', () => listEntries('watching')],
  ['completed', 'Completed', () => listEntries('completed')],
  ['onHold', 'On Hold', () => listEntries('onHold')],
  ['planned', 'Plan to Watch', () => listEntries('planned')],
];

const asMedia = (e) => ({
  id: e.id,
  title: { romaji: e.title },
  coverImage: { large: e.cover },
  format: e.format,
  episodes: e.episodes ?? e.total,
  seasonYear: e.seasonYear,
  status: 'FINISHED',
});

const nameOf = (media) => media?.title?.romaji || media?.title?.english || media?.title?.native || '';

/* ---- display name ---------------------------------------------------
   The only name an account can change — but once every fourteen days, so the
   change is inline and rare: an input that replaces the heading, Enter saves,
   Escape puts the old name back. The server's reply is what gets painted, so a
   name it refused never appears to have changed.

   Inside the cooldown the heading is not a button. A pencil that opened a field
   the server was going to refuse would be the one control this page is not
   allowed to have, and the line under the handle says when it comes back. */
const DAY_MS = 86400000;
const nameLeft = (user) => Math.max(0, (Number(user?.nameNextAt) || 0) - Date.now());
const inDays = (ms) => {
  const days = Math.ceil(ms / DAY_MS);
  return days <= 1 ? t('about a day') : t('{n} days', { n: days });
};

function nameBlock(user, onSaved) {
  let busy = false;
  const shown = shownName(user);
  const heading = h('h1.profile-name', {}, shown);

  const startEdit = () => {
    if (busy) return;
    const input = h('input.input.pf-name-input', {
      value: shown,
      maxlength: 24,
      'aria-label': t('Display name'),
      onclick: (e) => e.stopPropagation(),
      onkeydown: (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          stop();
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
      },
    });
    const save = h(
      'button.btn.btn--sm.btn--primary',
      { type: 'button', onclick: commit },
      icon('check'),
      h('span', {}, t('Save')),
    );
    const cancel = h('button.btn.btn--sm', { type: 'button', onclick: stop }, h('span', {}, t('Cancel')));
    const row = h('div.pf-name-edit', {}, input, save, cancel);
    heading.replaceChildren(row);
    input.focus();
    input.select();

    async function commit() {
      const value = input.value.trim();
      if (!value || value === shown) {
        stop();
        return;
      }
      busy = true;
      save.disabled = true;
      cancel.disabled = true;
      input.disabled = true;
      try {
        const next = await patchMe({ displayName: value });
        onSaved(next || { ...user, displayName: value });
      } catch (err) {
        input.disabled = false;
        save.disabled = false;
        cancel.disabled = false;
        busy = false;
        toast(say(err), { tone: 'err', iconName: 'alert' });
      }
    }

    function stop() {
      heading.replaceChildren(shown);
      busy = false;
    }
  };

  if (!user.canEdit) return heading;
  /* @solvn is exempt on the server, so it is exempt here as well: the name stays
     editable while the fourteen-day clock runs for everybody else. */
  if (nameLeft(user) > 0 && !isStaff(user)) return heading;
  return h(
    'button.profile-name.pf-name-editable',
    {
      type: 'button',
      title: t('Change your display name'),
      onclick: startEdit,
    },
    heading,
  );
}

/* ---- the handle ------------------------------------------------------
   Permanent, so it is never an editable field — but it is still text you can
   select and copy, which a greyed-out `disabled` box would not be. `readonly`
   keeps the lock and the copyability; the icon says why there is no pencil. */
function handleField(user) {
  if (!user.canEdit) return h('p.pf-handle', {}, '@', user.username);
  const input = h('input.pf-handle-input', {
    type: 'text',
    value: `@${user.username}`,
    readonly: true,
    'aria-label': t('Your @handle is permanent and cannot be changed.'),
    onclick: (e) => e.currentTarget.select(),
  });
  return h(
    'div.pf-handle-field',
    {},
    h('span.pf-handle-lock', { 'aria-hidden': 'true' }, icon('lock')),
    input,
    h('span.pf-handle-tip', {}, t('Permanent')),
  );
}

/* ---- the user ID --------------------------------------------------------
   The number people search by. It is short enough to read out loud and to type
   into a friend search, so the page offers it with one press — and on a plain
   http address, where the clipboard API is blocked, it opens a sheet with the
   number selected rather than a button that quietly does nothing. */
function idField(user) {
  const id = Number(user.userId) || 0;
  if (!id) return null;
  const copy = h(
    'button.pf-id-copy',
    {
      type: 'button',
      'aria-label': t('Copy user ID'),
      title: t('Copy user ID'),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(String(id));
          toast(t('User ID copied.'), { tone: 'ok', iconName: 'check' });
        } catch {
          const field = h('input.input', {
            value: String(id),
            readonly: true,
            'aria-label': t('User ID'),
            onclick: (e) => e.currentTarget.select(),
          });
          sheet({
            heading: t('User ID'),
            sub: t('This browser blocks the clipboard, so select the number and copy it yourself.'),
            width: 380,
            render: () => h('div.stack', {}, field),
          });
        }
      },
    },
    icon('share'),
  );
  return h(
    'div.pf-id',
    {},
    h('span.pf-id-label', {}, t('User ID')),
    h('span.pf-id-value.tnum', {}, String(id)),
    copy,
  );
}


/* ---- add friend --------------------------------------------------------
   One control, four states, all read from the profile request. A request already
   waiting is a status rather than a press, so it is drawn as a chip; an offer
   from the other side is answered right here; and the press that changes any of
   it redraws the hero instead of trusting its own guess. */
function friendAction(user, state, repaint) {
  const now = state || 'none';
  if (now === 'friend') return h('span.pf-friend.is-friend', {}, icon('check'), t('Friends'));
  if (now === 'out') return h('span.pf-friend', {}, icon('clock'), t('Requested'));
  const label = now === 'in' ? t('Accept request') : t('Add friend');
  return h(
    'button.btn.btn--sm',
    {
      type: 'button',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (now === 'in') await answerFriend(user.id, true);
          else await askFriend(user.id);
          toast(now === 'in' ? t('You are now friends.') : t('Friend request sent.'), { tone: 'ok', iconName: 'check' });
          repaint();
        } catch (err) {
          btn.disabled = false;
          toast(say(err), { tone: 'err', iconName: 'alert' });
        }
      },
    },
    icon(now === 'in' ? 'check' : 'plus'),
    h('span', {}, label),
  );
}

/* ---- the bio --------------------------------------------------------
   One line, 140 characters, written by its owner and read by everybody. It lives
   on the account rather than on this device, so the sentence under your name on
   your phone is the sentence a visitor sees on theirs. */
const BIO_MAX = 140;

function bioSheet(user, onDone) {
  let busy = false;
  let handle = null;
  const field = h('textarea.input.pf-bio-field', {
    rows: 3,
    maxlength: BIO_MAX,
    placeholder: t('A line about what you watch, or nothing at all…'),
    'aria-label': t('About you'),
  });
  field.value = String(user?.bio || '');
  const count = h('span.pf-bio-count.tnum', {}, String(BIO_MAX - field.value.length));
  const save = h(
    'button.btn.btn--primary',
    { type: 'button', onclick: commit },
    icon('check'),
    h('span', {}, t('Save bio')),
  );

  field.addEventListener('input', () => {
    count.textContent = String(BIO_MAX - field.value.length);
  });

  async function commit() {
    if (busy) return;
    busy = true;
    save.disabled = true;
    try {
      const next = await patchMe({ bio: field.value.trim() });
      handle?.close();
      toast(next ? t('Bio saved.') : t('Saved.'), { iconName: 'check' });
      onDone?.();
    } catch (err) {
      busy = false;
      save.disabled = false;
      toast(say(err), { tone: 'err', iconName: 'alert' });
    }
  }

  sheet({
    heading: t('About you'),
    sub: t('Shown under your name on every profile. Yours to rewrite as often as you like.'),
    width: 520,
    footer: h('div.pf-bio-foot', {}, count, save),
    render: (opened) => {
      handle = opened;
      return field;
    },
  });
  requestAnimationFrame(() => field.focus());
}

function bioBlock(user, { canEdit = false, onChanged = null } = {}) {
  const text = String(user?.bio || '').trim();
  if (!text) {
    /* An empty bio is still an editable thing on your own profile — a button that
       opens the field, which is how it gets filled in the first place. */
    return canEdit
      ? h(
          'button.pf-bio.pf-bio-empty',
          { type: 'button', onclick: () => bioSheet(user, onChanged) },
          icon('edit'),
          h('span', {}, t('Add a line about yourself')),
        )
      : null;
  }
  return h(
    'div.pf-bio-row',
    {},
    h('p.pf-bio', {}, text),
    canEdit
      ? h('button.pf-bio-edit', { type: 'button', 'aria-label': t('Edit your bio'), onclick: () => bioSheet(user, onChanged) }, icon('edit'))
      : null,
  );
}

/* ---- picture --------------------------------------------------------
   Three ways to wear a face: the official library, a file of your own, or a
   link to a picture that lives somewhere else.
   * The file never becomes the account's picture until the server has taken it.
     A read failure, a wrong type or a refused upload leaves the old avatar on
     screen and the sheet open to try again.
   * A library pick applies on the tap. The point of a shelf of faces is that
     trying one costs nothing, and the record that travels is the address. */
const AV_TABS = [
  ['gallery', 'Gallery'],
  ['upload', 'Upload'],
  ['link', 'Link'],
];

function avatarSheet(user, onDone) {
  let pending = null;
  let busy = false;
  let tab = AV_TABS[0][0];
  let library = null;
  let fetching = false;

  const hadPicture = Boolean(user?.avatar?.photo || user?.avatar?.file || user?.avatar?.face);

  const face = h('div.av-preview');
  const tabs = h('div.list-tabs.av-tabs', { role: 'tablist', 'aria-label': t('Profile picture') });
  const panel = h('div.av-panel');
  const actions = h('div.pf-actions');
  const error = h('p.av-error', { role: 'alert', hidden: true });

  const file = h('input', {
    type: 'file',
    class: 'hide',
    accept: AVATAR_UPLOAD.accept,
    onchange: () => choose(file.files?.[0]),
  });

  const url = h('input.input', {
    type: 'url',
    placeholder: 'https://…',
    'aria-label': t('Picture address'),
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: 500,
  });

  function paintFace() {
    const preview = pending ? { ...user, avatar: { ...user.avatar, photo: pending.dataUrl, file: null, face: null } } : user;
    face.replaceChildren(
      ...[
        avatar(preview, { size: 'lg' }),
        h('span.av-frame', { 'aria-hidden': 'true' }),
      ],
    );
  }

  function flag(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  /* Every control in the sheet is locked while a request is in flight, so one
     picture cannot be saved twice by an impatient thumb. */
  function setBusy(on) {
    busy = on;
    for (const node of [...panel.querySelectorAll('button'), ...actions.querySelectorAll('button')]) {
      node.disabled = on;
      node.classList.toggle('is-busy', on);
      if (on) node.setAttribute('aria-busy', 'true');
      else node.removeAttribute('aria-busy');
    }
    file.disabled = on;
  }

  async function apply(source, message) {
    if (busy) return false;
    setBusy(true);
    flag('');
    try {
      await setAvatar(source);
      opened.close();
      toast(message, { iconName: 'check' });
      onDone?.();
      return true;
    } catch (err) {
      /* The stored picture is untouched, so the page still shows the old one. */
      flag(say(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function choose(picked) {
    flag('');
    if (!picked) return;
    setBusy(true);
    try {
      pending = await avatarFromImageFile(picked);
      paintFace();
      paintActions();
    } catch (err) {
      pending = null;
      flag(say(err));
      paintActions();
    } finally {
      setBusy(false);
      file.value = '';
    }
  }

  /* ---- the gallery -------------------------------------------------- */
  const tile = (f) =>
    h(
      'button.av-tile',
      {
        type: 'button',
        title: f.name,
        'aria-label': t('Use {name}', { name: f.name }),
        onclick: () => apply(f.image, t('Picture updated.')),
      },
      h('img', { src: f.image, alt: '', loading: 'lazy', decoding: 'async' }),
      h('span.av-tile-name.clamp-1', {}, f.name),
    );

  function galleryPanel() {
    const box = h('input.input', {
      type: 'search',
      placeholder: t('Search the face library…'),
      'aria-label': t('Search faces'),
      autocomplete: 'off',
      maxlength: 60,
    });
    const grid = h('div.av-grid');
    const status = h('p.av-count.muted', {});

    const draw = () => {
      if (!library) return;
      if (!library.length) {
        status.textContent = '';
        grid.replaceChildren(h('p.av-count.muted', {}, t('The face library is not answering right now.')));
        return;
      }
      const shown = matchFaces(library, box.value.trim());
      status.textContent = shown.length
        ? t('{n} faces', { n: shown.length })
        : t('Nothing matched that.');
      grid.replaceChildren(...shown.map(tile));
    };

    let timer = 0;
    box.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 140);
    });

    if (library === null && !fetching) {
      fetching = true;
      grid.replaceChildren(loadingGrid(12));
      faces()
        .then((list) => {
          library = list;
        })
        .catch(() => {
          library = [];
        })
        .finally(() => {
          fetching = false;
          if (tab === 'gallery') draw();
        });
    } else {
      draw();
    }

    return h('div.stack', {}, box, status, grid);
  }

  /* ---- the other two ------------------------------------------------ */
  function uploadPanel() {
    return h(
      'div.stack',
      {},
      h(
        'label.btn.btn--primary.av-pick',
        {},
        icon('share'),
        h('span', {}, t('Choose a picture')),
        file,
      ),
      h('p.av-note.muted', {}, t('Square, at least 256 pixels. A PNG, JPEG, WebP, GIF or AVIF file.')),
    );
  }

  function linkPanel() {
    return h(
      'div.stack',
      {},
      url,
      h('p.av-note.muted', {}, t('An https picture address. Solvn keeps the address, not the file.')),
    );
  }

  function paintActions() {
    const list = [];
    if (tab === 'upload') {
      list.push(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            /* A disabled button is not a guard: without a re-encoded square this
               call would clear the member's picture instead of saving one. */
            onclick: () => {
              if (pending) apply(pending, t('Picture updated.'));
            },
            disabled: !pending || busy,
          },
          icon('check'),
          h('span', {}, t('Save picture')),
        ),
      );
    }
    if (tab === 'link') {
      list.push(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            onclick: async () => {
              const value = url.value.trim();
              if (!value) {
                flag(t('Paste an address first.'));
                return;
              }
              if (await apply(value, t('Picture updated.'))) url.value = '';
            },
          },
          icon('check'),
          h('span', {}, t('Use this address')),
        ),
      );
    }
    if (hadPicture) {
      list.push(
        h(
          'button.btn',
          { type: 'button', onclick: () => apply(null, t('Picture removed.')) },
          icon('x'),
          h('span', {}, t('Remove picture')),
        ),
      );
    }
    actions.replaceChildren(...list);
  }

  function syncTabs() {
    tabs.replaceChildren(
      ...AV_TABS.map(([key, label]) =>
        h(
          `button.chip${tab === key ? '.is-active' : ''}`,
          {
            role: 'tab',
            'aria-selected': String(tab === key),
            type: 'button',
            onclick: () => {
              if (tab === key) return;
              tab = key;
              paintPanel();
            },
          },
          t(label),
        ),
      ),
    );
  }

  function paintPanel() {
    flag('');
    paintFace();
    syncTabs();
    panel.replaceChildren(tab === 'gallery' ? galleryPanel() : tab === 'upload' ? uploadPanel() : linkPanel());
    paintActions();
  }

  paintPanel();

  const opened = sheet({
    heading: t('Profile picture'),
    sub: t('Pick a face from the library, upload one of your own, or point at a picture you keep elsewhere.'),
    width: 720,
    render: () => h('div.stack', {}, face, tabs, panel, actions, error),
  });

  return opened;
}

/* ---- background -----------------------------------------------------
   The band behind a profile wears one of three things: an animation from the
   gallery, a picture this browser produced, or an address that stays elsewhere.
   Applying any of them clears the other two, so exactly one source is ever
   live — and an animated GIF keeps its motion by riding along as its own bytes
   instead of being flattened to its first frame. */
const BK_TABS = [
  ['theme', 'Themes'],
  ['upload', 'Upload'],
  ['link', 'Link'],
];

/** One animated band: the theme key is the only thing CSS needs to draw it. */
const bkNode = (theme) => h('span.bk', { dataset: { theme } });

/** What the band shows: a picture beats a theme, and the newest picture wins. */
const bandSource = (b) => b?.url || b?.file || b?.photo || null;

const bkFrame = () => h('span.bk-preview-frame', { 'aria-hidden': 'true' });

function bannerSheet(user, onDone) {
  let pending = null;
  let busy = false;
  let tab = BK_TABS[0][0];

  const held = user?.banner || {};
  const hadBackdrop = Boolean(bandSource(held) || held.theme);

  const preview = h('div.bk-preview');
  const tabs = h('div.list-tabs.av-tabs', { role: 'tablist', 'aria-label': t('Profile background') });
  const panel = h('div.av-panel');
  const actions = h('div.pf-actions');
  const error = h('p.av-error', { role: 'alert', hidden: true });

  const file = h('input', {
    type: 'file',
    class: 'hide',
    accept: BANNER_UPLOAD.accept,
    onchange: () => choose(file.files?.[0]),
  });

  const url = h('input.input', {
    type: 'url',
    placeholder: 'https://…',
    'aria-label': t('Background address'),
    autocomplete: 'off',
    spellcheck: 'false',
    maxlength: 500,
  });

  function paintPreview() {
    const src = pending ? pending.dataUrl : bandSource(held);
    if (src) {
      preview.replaceChildren(h('img.bk-preview-img', { src, alt: '', decoding: 'async' }), bkFrame());
      return;
    }
    if (held.theme) {
      preview.replaceChildren(bkNode(held.theme), bkFrame());
      return;
    }
    preview.replaceChildren(h('span.bk-preview-empty', {}, t('Nothing chosen yet')), bkFrame());
  }

  function flag(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  /* Locked while a request is in flight, so one band cannot be saved twice. */
  function setBusy(on) {
    busy = on;
    for (const node of [...panel.querySelectorAll('button'), ...actions.querySelectorAll('button')]) {
      node.disabled = on;
      node.classList.toggle('is-busy', on);
      if (on) node.setAttribute('aria-busy', 'true');
      else node.removeAttribute('aria-busy');
    }
    file.disabled = on;
  }

  async function apply(source, message) {
    if (busy) return false;
    setBusy(true);
    flag('');
    try {
      await setBanner(source);
      opened.close();
      toast(message, { iconName: 'check' });
      onDone?.();
      return true;
    } catch (err) {
      /* The stored band is untouched, so the profile still shows the old one. */
      flag(say(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function choose(picked) {
    flag('');
    if (!picked) return;
    setBusy(true);
    try {
      pending = await bannerFromImageFile(picked);
      paintPreview();
      paintActions();
    } catch (err) {
      pending = null;
      flag(say(err));
      paintActions();
    } finally {
      setBusy(false);
      file.value = '';
    }
  }

  /* ---- the gallery --------------------------------------------------
     Three bands are free, the rest are lifted by the level ladder or by a spin
     that landed on one, and @solvn wears the whole shelf. `bannerRows` is the
     same reading the ladder prints, so a band cannot be open here and shut
     there. A locked band is not a button: it has nothing to do but say what
     would unlock it.
     ------------------------------------------------------------------------ */
  function themePanel() {
    const staff = isStaff(user);
    return h(
      'div.stack',
      {},
      h('p.av-count.muted', {}, t('Animated bands, drawn by Solvn itself. Tap one to wear it.')),
      h(
        'p.av-note.muted',
        {},
        staff
          ? t('Every band is open on this account.')
          : t('The first {n} are free. The rest come with your level, or from the fortune wheel.', { n: BANNER_FREE }),
      ),
      h(
        'div.bk-grid',
        {},
        ...bannerRows(user, staff).map((row) => {
          const worn = !bandSource(held) && held.theme === row.key;
          if (!row.open) {
            return h(
              'div.bk-tile.is-locked',
              { 'aria-label': t('{name} — unlocks at level {n}', { name: t(row.label), n: row.need }) },
              bkNode(row.key),
              h('span.bk-tile-name', {}, t(row.label)),
              h('span.bk-tile-lock', {}, icon('lock'), h('b.tnum', {}, String(row.need))),
            );
          }
          return h(
            'button.bk-tile',
            {
              type: 'button',
              /* Worn is marked with a check as well as a ring, so the state does
                 not live on colour alone. */
              'aria-pressed': String(worn),
              'aria-label': t('Wear {name}', { name: t(row.label) }),
              onclick: () => apply({ theme: row.key }, t('Background updated.')),
            },
            bkNode(row.key),
            bkFrame(),
            worn ? h('span.bk-tile-worn', { 'aria-hidden': 'true' }, icon('check')) : null,
            row.won ? h('span.bk-tile-mark', { 'aria-hidden': 'true' }, icon('sparkles')) : null,
            h('span.bk-tile-name', {}, t(row.label)),
          );
        }),
      ),
    );
  }

  /* ---- the other two ------------------------------------------------ */
  function uploadPanel() {
    return h(
      'div.stack',
      {},
      h('label.btn.btn--primary.av-pick', {}, icon('share'), h('span', {}, t('Choose a picture')), file),
      h('p.av-note.muted', {}, t('A wide picture, at least 1200 pixels across. A PNG, JPEG, WebP, GIF or AVIF file.')),
    );
  }

  function linkPanel() {
    return h(
      'div.stack',
      {},
      url,
      h('p.av-note.muted', {}, t('An https picture address. Solvn keeps the address, not the file.')),
    );
  }

  function paintActions() {
    const list = [];
    if (tab === 'upload') {
      list.push(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            /* A disabled button is not a guard: without a re-encoded band this
               call would clear the member's background instead of saving one. */
            onclick: () => {
              if (pending) apply(pending, t('Background updated.'));
            },
            disabled: !pending || busy,
          },
          icon('check'),
          h('span', {}, t('Save background')),
        ),
      );
    }
    if (tab === 'link') {
      list.push(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            onclick: async () => {
              const value = url.value.trim();
              if (!value) {
                flag(t('Paste an address first.'));
                return;
              }
              if (await apply(value, t('Background updated.'))) url.value = '';
            },
          },
          icon('check'),
          h('span', {}, t('Use this address')),
        ),
      );
    }
    if (hadBackdrop) {
      list.push(
        h(
          'button.btn',
          { type: 'button', onclick: () => apply(null, t('Background removed.')) },
          icon('x'),
          h('span', {}, t('Remove background')),
        ),
      );
    }
    actions.replaceChildren(...list);
  }

  function syncTabs() {
    tabs.replaceChildren(
      ...BK_TABS.map(([key, label]) =>
        h(
          `button.chip${tab === key ? '.is-active' : ''}`,
          {
            role: 'tab',
            'aria-selected': String(tab === key),
            type: 'button',
            onclick: () => {
              if (tab === key) return;
              tab = key;
              paintPanel();
            },
          },
          t(label),
        ),
      ),
    );
  }

  function paintPanel() {
    flag('');
    paintPreview();
    syncTabs();
    panel.replaceChildren(tab === 'theme' ? themePanel() : tab === 'upload' ? uploadPanel() : linkPanel());
    paintActions();
  }

  paintPanel();

  const opened = sheet({
    heading: t('Profile background'),
    sub: t('Wear an animated band, put up a wallpaper of your own, or point at a picture you keep elsewhere.'),
    width: 720,
    render: () => h('div.stack', {}, preview, tabs, panel, actions, error),
  });

  return opened;
}

/* ---- titles ---------------------------------------------------------
   Twelve lines a member can wear, each unlocked by a figure the account
   publishes: hours, episodes, series finished, titles opened, packs pulled and
   the peak Power in the binder. Locked rows stay in the list and say what they
   still need — a ladder you cannot see is a ladder you cannot climb. */
function titlesSheet(user, onDone) {
  let busy = false;
  const list = h('div.tl-list');
  const error = h('p.av-error', { hidden: true, role: 'alert' });
  const count = TITLES.filter((title) => titleUnlocked(title, user)).length;

  const flag = (message) => {
    error.textContent = message;
    error.hidden = !message;
  };

  async function wear(id, message) {
    if (busy) return;
    busy = true;
    flag('');
    try {
      await setTitle(id);
      opened.close();
      toast(message, { iconName: 'check' });
      onDone?.();
    } catch (err) {
      /* Nothing was stored, so the profile keeps showing the title it had. */
      flag(say(err));
    } finally {
      busy = false;
    }
  }

  const rows = TITLES.map((title) => {
    const earned = titleUnlocked(title, user);
    const wornHere = title.id === (user?.title || null);
    const mark = h(
      'span.tl-mark',
      earned
        ? {
            style: {
              color: `hsl(${title.hue} 96% 68%)`,
              borderColor: `hsl(${title.hue} 90% 60% / 0.4)`,
              background: `linear-gradient(150deg, hsl(${title.hue} 96% 60% / 0.22), transparent)`,
            },
          }
        : {},
      icon(earned ? title.icon : 'lock'),
    );
    const text = h(
      'span.tl-text',
      {},
      h('b.tl-name', {}, t(title.label)),
      h('span.tl-hint', {}, t(title.hint, { n: title.need })),
    );
    if (!earned) return h('div.tl-row.is-locked', { 'aria-disabled': 'true' }, mark, text);
    return h(
      'button.tl-row',
      {
        type: 'button',
        'aria-pressed': String(wornHere),
        onclick: () => wear(wornHere ? null : title.id, wornHere ? t('Title removed.') : t('Title equipped.')),
      },
      mark,
      text,
      wornHere ? h('span.tl-worn', {}, icon('check'), t('Worn')) : null,
    );
  });

  list.replaceChildren(...rows);

  const opened = sheet({
    heading: t('Wearable titles'),
    sub: t('{n} of {total} unlocked. Equip one to show it next to your name.', { n: count, total: TITLES.length }),
    width: 620,
    render: () =>
      h(
        'div.stack',
        {},
        list,
        user?.title
          ? h(
              'div.pf-actions',
              {},
              h(
                'button.btn',
                { type: 'button', onclick: () => wear(null, t('Title removed.')) },
                icon('x'),
                h('span', {}, t('Wear no title')),
              ),
            )
          : null,
        error,
      ),
  });

  return opened;
}

/**
 * The hero's own band. A picture whose address fails falls back to the theme it
 * was worn under, so a dead host never leaves the profile with an empty strip —
 * and the owner gets one button in the corner to change the whole thing.
 */
function paintBand(band, banner) {
  band.replaceChildren();
  const src = bandSource(banner);
  /* Whatever goes on the band gets a veil with it: the member's name is printed
     over it, and the veil keeps that readable on somebody's white wallpaper as
     surely as on the brightest theme in the gallery. With nothing chosen the
     house gradient shows as it was drawn, undimmed. */
  if (src) {
    const img = h('img.pf-banner-img', { src, alt: '', decoding: 'async', loading: 'lazy' });
    img.addEventListener('error', () => paintBand(band, { theme: banner?.theme }));
    band.append(img, h('span.pf-banner-veil'));
    return;
  }
  if (BANNER_KEYS.includes(banner?.theme)) {
    band.append(bkNode(banner.theme), h('span.pf-banner-veil'));
  }
}

function heroBackdrop(user, { canEdit = false, onChanged = null } = {}) {
  const band = h('span.pf-banner', { 'aria-hidden': 'true' });
  paintBand(band, user?.banner);
  if (!canEdit) return [band];
  return [
    band,
    h(
      'button.pf-banner-edit',
      { type: 'button', onclick: () => bannerSheet(user, onChanged), 'aria-label': t('Change background') },
      icon('palette'),
    ),
  ];
}

/* ---- favourite anime -------------------------------------------------
   AniList answers with the title and its art, and the account keeps the three
   fields the card needs. It is a server field, so the choice follows the
   member onto another device. */
async function favouriteSheet(onDone) {
  const box = h('input.input', {
    type: 'search',
    placeholder: t('Search the catalogue…'),
    'aria-label': t('Search anime'),
    autocomplete: 'off',
    maxlength: 80,
  });
  const results = h('div.fav-results', { role: 'list' });
  const status = h('p.muted.fav-status', {}, t('Type a title to find it.'));
  let token = 0;

  async function run(term) {
    const mine = ++token;
    if (term.length < 2) {
      status.textContent = t('Type a title to find it.');
      results.replaceChildren();
      return;
    }
    status.textContent = t('Searching…');
    results.replaceChildren(loadingGrid(4));
    try {
      const { items } = await search(term, { perPage: 12 });
      if (mine !== token) return;
      status.textContent = items.length ? t('Pick the one you mean.') : t('Nothing matched that.');
      results.replaceChildren(
        ...items.map((m) =>
          h(
            'button.fav-pick',
            {
              type: 'button',
              role: 'listitem',
              onclick: () => choose(m),
            },
            stillImage([m.coverImage?.large, m.coverImage?.extraLarge], { alt: '' }) || h('span.fav-ph', {}, icon('film')),
            h('span.fav-pick-name.clamp-2', {}, nameOf(m)),
            h('span.fav-pick-year.tnum', {}, m.seasonYear ? String(m.seasonYear) : ''),
          ),
        ),
      );
    } catch {
      if (mine !== token) return;
      status.textContent = t('The catalogue is not answering right now.');
      results.replaceChildren();
    }
  }

  async function choose(media) {
    try {
      await setFavourite(media);
      close();
      toast(t('Favourite set.'), { iconName: 'star' });
      onDone?.();
    } catch (err) {
      toast(say(err), { tone: 'err', iconName: 'alert' });
    }
  }

  let timer = 0;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    const value = box.value.trim();
    timer = setTimeout(() => run(value), 320);
  });

  const opened = sheet({
    heading: t('Favourite anime'),
    sub: t('It stays on your account, so it is here on any device.'),
    width: 520,
    render: () => h('div.stack', {}, box, status, results),
  });
  close = opened.close;
  setTimeout(() => box.focus(), 0);
  return opened;
}
let close = () => {};

function favouriteCard(user, { canEdit, onChanged }) {
  const fav = user.favourite;
  if (!fav) {
    if (!canEdit) return null;
    return emptyState({
      iconName: 'star',
      heading: t('No favourite yet'),
      body: t('Name the one title you would keep.'),
      action: h(
        'button.btn.btn--primary',
        { type: 'button', onclick: () => favouriteSheet(onChanged) },
        icon('plus'),
        h('span', {}, t('Choose a favourite')),
      ),
    });
  }
  return h(
    'section.fav-card.glass',
    {},
    h('div.fav-head', {}, icon('star'), h('h2', {}, t('Favourite anime'))),
    h(
      'a.fav-body',
      { href: `#/anime/${fav.id}`, 'aria-label': fav.title },
      h('span.fav-art', {}, stillImage([fav.image], { alt: '' }) || h('span.fav-ph', {}, icon('film'))),
      h('span.fav-copy', {}, h('span.fav-title.clamp-2', {}, fav.title), h('span.fav-open', {}, icon('arrowUpRight'), h('span', {}, t('Open')))),
    ),
    canEdit
      ? h(
          'div.fav-actions',
          {},
          h('button.btn.btn--sm', { type: 'button', onclick: () => favouriteSheet(onChanged) }, icon('edit'), h('span', {}, t('Change'))),
          h(
            'button.btn.btn--sm',
            {
              type: 'button',
              onclick: async () => {
                try {
                  await setFavourite(null);
                  onChanged?.();
                } catch (err) {
                  toast(say(err), { tone: 'err', iconName: 'alert' });
                }
              },
            },
            icon('x'),
            h('span', {}, t('Remove')),
          ),
        )
      : null,
  );
}

/* ---- card showcase ---------------------------------------------------
   The cards a member chose to put on their profile — not the binder, which
   never leaves their device. Two sources feed one row: your own profile reads
   the live binder, so a pin you make is on the page the moment you make it,
   and anybody else's reads the published summary the board sorts on. A member
   who pins nothing shows nothing, because an empty frame where somebody's
   pride should be is worse than no frame at all. */

/** Pinning is a binder act, and the binder is one device's `storage` key. */
const canPin = () => isSignedIn();

function showcaseRow(user, editable) {
  if (editable) {
    const byKey = new Map(ownedEntries().map((e) => [e.key, e]));
    const live = pins().map((k) => byKey.get(k)).filter(Boolean);
    /* The binder wins while it holds a choice. Fall through to the published
       row only when this device pins nothing, which is how a second laptop
       still shows the showcase made on the first one. */
    if (live.length) return { cards: live, fromBinder: true };
  }
  const pub = Array.isArray(user.cards?.pinned) ? user.cards.pinned : [];
  return { cards: pub.map(displayCard).filter(Boolean), fromBinder: false };
}

const showcaseGrid = (cards) =>
  h('div.g-grid', {}, ...cards.map((c) => gachaCard(c, { variant: 'tile', eager: false })));

/**
 * The picker. A press writes the binder, then ships the whole published record,
 * so two presses in a row cannot leave the account holding half a choice — the
 * second write carries the first one with it.
 */
function showcaseSheet(onDone) {
  const entries = ownedEntries();
  const grid = h('div.g-grid');
  const count = h('p.muted.pf-pin-count', {});

  function paintGrid() {
    count.textContent = t('{n} of {max} pinned', { n: pins().length, max: PIN_MAX });
    grid.replaceChildren(
      ...entries.map((e) => {
        const on = isPinned(e.key);
        return h(
          `div.pf-pin-cell${on ? '.is-pinned' : ''}`,
          {},
          gachaCard(e, { variant: 'tile', eager: false }),
          h(
            `button.btn.btn--sm.pf-pin-btn${on ? '.is-on' : ''}`,
            {
              type: 'button',
              'aria-pressed': String(on),
              'aria-label': on ? t('Unpin {name}', { name: e.name }) : t('Pin {name}', { name: e.name }),
              onclick: () => choose(e, on),
            },
            icon(on ? 'check' : 'plus'),
            h('span', {}, on ? t('Pinned') : t('Pin')),
          ),
        );
      }),
    );
  }

  async function choose(entry, wasPinned) {
    const r = togglePin(entry.key);
    if (!r.ok && !wasPinned) {
      toast(t('You can pin up to {n} cards.', { n: PIN_MAX }), { tone: 'err', iconName: 'alert' });
      return;
    }
    paintGrid();
    onDone?.();
    try {
      await publish();
    } catch (err) {
      toast(say(err), { tone: 'err', iconName: 'alert' });
    }
  }

  paintGrid();
  return sheet({
    heading: t('Card showcase'),
    sub: t('Pin up to {n} cards for your profile. Visitors see them; the rest of your binder stays yours.', { n: PIN_MAX }),
    width: 760,
    render: () => h('div.stack', {}, count, grid),
  });
}

function cardShowcase(user, { canEdit, onChanged }) {
  const editable = canEdit && canPin();
  const { cards, fromBinder } = showcaseRow(user, editable);
  if (!cards.length && !editable) return null;

  const pick = h(
    'button.btn.btn--sm',
    { type: 'button', onclick: () => showcaseSheet(onChanged) },
    icon('edit'),
    h('span', {}, t('Choose cards')),
  );

  return h(
    'section.fav-card.glass.pf-showcase',
    {},
    h(
      'div.fav-head',
      {},
      icon('sparkles'),
      h('h2', {}, t('Card showcase')),
      /* The budget rides beside the heading only where a press can spend it —
         which needs this device to hold the binder. */
      editable && ownedEntries().length ? h('span.pf-pin-tally.tnum', {}, `${pins().length}/${PIN_MAX}`) : null,
    ),
    cards.length
      ? showcaseGrid(cards)
      : emptyState({
          iconName: 'sparkles',
          heading: t('No cards pinned yet'),
          body: t('Pin the pulls you want people to see first.'),
          action: ownedEntries().length
            ? pick
            : h('a.btn.btn--primary', { href: '#/packs' }, icon('sparkles'), h('span', {}, t('Open the card binder'))),
        }),
    cards.length && editable ? h('div.fav-actions', {}, pick) : null,
    !fromBinder && cards.length ? h('p.muted.pf-show-note', {}, t('Chosen by {name} from their own binder.', { name: shownName(user) })) : null,
  );
}

/* ---- the page ------------------------------------------------------- */
export async function ProfileView(ctx) {
  const wanted = ctx.params.id ? String(ctx.params.id) : null;
  const wrap = h('div.page-profile');
  const body = h('div.pf-inner');
  wrap.append(body);

  let tab = TABS[0][0];
  /* A tab click re-paints the whole page, hero included. The intro belongs to
     arriving, not to scrolling your own lists, so it runs once. */
  let introDone = false;

  async function load() {
    const me = isSignedIn() ? account().user : null;
    if (wanted && (!me || me.id !== wanted)) return { ...(await publicProfile(wanted)), isMe: false };
    if (!me) return { signedOut: true };
    return { user: me, playlists: account().playlists, isMe: true };
  }

  function listPanel(entries) {
    if (!entries.length) {
      return emptyState({
        iconName: 'bookmark',
        heading: t('Nothing here yet'),
        body: t('Use the button on any anime to add it to this list.'),
        action: h('a.btn.btn--primary', { href: '#/discover' }, t('Find something')),
      });
    }
    return h('div.grid', {}, ...entries.map((e) => mediaCard(asMedia(e))));
  }

  /* The four figures under the name. Every one is read off this device's own
     shelf or off the account, never off another member, so `identity` only
     draws them when the profile being looked at is the one you are signed in
     to. */
  function statRow(user, playlists) {
    const since = user.createdAt ? intlDate(user.createdAt, { month: 'short', year: 'numeric' }) : '—';
    return h(
      'div.pf-stats',
      {},
      statTile({ iconName: 'calendar', value: since, label: t('Member since') }),
      statTile({ iconName: 'star', value: String(favouriteEntries().length), label: t('Favorites') }),
      statTile({ iconName: 'play', value: String(listEntries('watching').length), label: t('Watching') }),
      statTile({ iconName: 'list', value: String(playlists.length), label: t('Playlists') }),
    );
  }

  /**
   * Arriving without an account still gets the redesigned page: the same hero
   * shell, banner and glowing frame, holding the ghost instead of a picture and
   * the two ways in beside it. It says what the page is for rather than
   * pretending to be a profile somebody already made.
   */
  function arrivingHero() {
    return h(
      'header.profile-hero.glass',
      {},
      ...heroBackdrop(null),
      h(
        'div.pf-hero-row',
        {},
        h('div.pf-face', {}, avatar({ avatar: { glyph: 'ghost', hue: 265 } }, { size: 'lg' })),
        h(
          'div.pf-who',
          {},
          h('h1.profile-name', {}, t('Your profile starts here')),
          h('p.pf-tip', {}, t('An account keeps your name, your picture, your favourite anime and your lists in one place.')),
        ),
        h(
          'div.profile-side',
          {},
          h(
            'div.profile-actions',
            {},
            h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet('signup') }, t('Create account')),
            h('button.btn', { type: 'button', onclick: () => authSheet('login') }, t('Sign in')),
          ),
        ),
      ),
    );
  }

  function identity(data, { intro = false } = {}) {
    const user = { ...data.user, canEdit: data.isMe };
    const repaint = () => paint();
    const playlists = data.playlists || [];
    return h(
      `header.profile-hero.glass${intro ? '.is-intro' : ''}`,
      {},
      ...heroBackdrop(user, { canEdit: data.isMe, onChanged: repaint }),
      h(
        'div.pf-hero-row',
        {},
        h(
          'div.pf-face',
          {},
          avatar(user, {
            size: 'lg',
            extra: data.isMe
              ? h('button.pf-avatar-edit', { type: 'button', onclick: () => avatarSheet(user, repaint), 'aria-label': t('Change profile picture') }, icon('edit'))
              : null,
          }),
        ),
        h(
          'div.pf-who',
          {},
          h(
            'div.pf-name-row',
            {},
            nameBlock(user, (next) => {
              if (next) data.user = next;
              repaint();
              toast(t('Name saved.'), { iconName: 'check' });
            }),
            titleChip(user),
            /* The division is the rank half of a duel record: it is named from
               the wins this server filed, so a stranger's profile shows exactly
               what the arena's own board would say about them. */
            divisionChip(user),
            /* The title is worn, not printed: one small control next to the name
               opens the ladder, and a visitor sees the same chip with no way to
               press it. */
            data.isMe
              ? h(
                  'button.pf-title-edit',
                  { type: 'button', onclick: () => titlesSheet(user, repaint), 'aria-label': t('Change title') },
                  icon(user?.title ? 'edit' : 'plus'),
                )
              : null,
          ),
          handleField(user),
          idField(user),
          bioBlock(user, { canEdit: data.isMe, onChanged: repaint }),
          /* The ladder sits under the name and above the lists: it is the one
             figure on this page that says what a member has *done* rather than
             what they own, and it reads from their own record when it is not
             yours. */
          h('div.pf-level', {}, levelBar(user, { mine: data.isMe, figures: data.isMe })),
          duelRecord(user, { hideEmpty: true }),
          data.isMe
            ? h(
                'p.pf-tip',
                {},
                nameLeft(user) > 0 && !isStaff(user)
                  ? t('Your next display-name change unlocks in {when}. Your @handle never changes.', { when: inDays(nameLeft(user)) })
                  : t('Your display name can change once every 14 days. Your @handle stays yours forever.'),
              )
            : null,
        ),
        h(
          'div.profile-side',
          {},
          h(
            'div.profile-actions',
            {},
            /* A chat is an entry point, not a decoration: it appears where a
               message could actually be filed, which means a server that stores
               them. On your own profile it is the way back to your inbox. */
            data.isMe
              ? h(
                  'button.btn.btn--sm',
                  { type: 'button', onclick: () => levelSheet({ onDone: repaint }) },
                  icon('trending'),
                  h('span', {}, t('Level ladder')),
                )
              : null,
            data.isMe
              ? inboxUsable()
                ? h('a.btn.btn--sm', { href: '#/messages' }, icon('chat'), h('span', {}, t('Messages')))
                : null
              : inboxUsable()
                ? h(
                    'a.btn.btn--sm',
                    { href: `#/messages?with=${encodeURIComponent(user.id)}` },
                    icon('chat'),
                    h('span', {}, t('Message')),
                  )
                : null,
            /* The button says where the two of them stand rather than asking the
               same question twice: a request already sent is a label, and one
               already received is answered right here. */
            data.isMe || !inboxUsable() ? null : friendAction(user, data.friend, repaint),
            data.isMe
              ? signOutButton()
              : reportAction({ kind: 'user', id: user.id, label: t('Report member') }),
          ),
        ),
      ),
      data.isMe ? statRow(user, playlists) : null,
    );
  }

  async function paint() {
    body.replaceChildren(loadingGrid(3));
    let data;
    try {
      data = await load();
    } catch {
      body.replaceChildren(
        errorState(null, () => paint(), {
          heading: 'Could not reach Solvn',
          body: 'That profile and its lists live on this server, and it is not answering.',
        }),
      );
      return;
    }

    if (data.signedOut) {
      /* `replaceChildren` turns a `null` argument into the word "null", so the
         sign-in hero joins a list the same way the signed-in branch builds it:
         present when an account can answer, absent otherwise. With no server
         and no connected Supabase project this page is only the device history,
         and a "Create account" button that could only fail would not be drawn. */
      body.replaceChildren(
        ...[
          authUsable() ? arrivingHero() : null,
          h('h2.section-title', {}, t('What you have watched on this device')),
          h('p.muted.join-note', {}, !authUsable() ? t('Everything on this page is stored on this device.') : t('These lists stay on this device until you sign in.')),
          listPanel(TABS[0][2]()),
        ].filter(Boolean),
      );
      return;
    }

    const user = data.user;
    const playlists = data.playlists || [];
    const active = TABS.find(([key]) => key === tab) || TABS[0];

    const tabs = h(
      'div.list-tabs',
      { role: 'tablist', 'aria-label': t('Watchlists') },
      ...TABS.map(([key, label, get]) =>
        h(
          `button.chip${tab === key ? '.is-active' : ''}`,
          {
            role: 'tab',
            'aria-selected': String(tab === key),
            type: 'button',
            onclick: () => {
              tab = key;
              paint();
            },
          },
          t(label),
          get().length ? h('span.pf-tab-n.tnum', {}, String(get().length)) : null,
        ),
      ),
    );

    const create = h(
      'button.btn.btn--primary',
      { type: 'button', onclick: () => newPlaylistSheet({ onCreated: () => paint() }) },
      icon('plus'),
      h('span', {}, t('New playlist')),
    );

    const sections = [
      identity(data, { intro: !introDone }),
      /* The shelf of cards comes first: it is the thing a visitor came to look at,
         and it sits directly under the identity it belongs to. */
      cardShowcase(user, { canEdit: data.isMe, onChanged: () => paint() }),
      favouriteCard(user, { canEdit: data.isMe, onChanged: () => paint() }),
      data.isMe ? tabs : null,
      data.isMe ? listPanel(active[2]()) : null,
      data.isMe ? nowCard() : null,
      h(
        'section.pl-section',
        {},
        h(
          'div.section-head',
          {},
          h('h2.section-title', {}, data.isMe ? t('Your playlists') : t('{name}’s playlists', { name: shownName(user) })),
          data.isMe ? create : null,
        ),
        playlists.length
          ? h(
              'div.pl-grid',
              {},
              ...playlists.map((p) =>
                playlistCard(
                  p,
                  data.isMe
                    ? {
                        action: h(
                          'button.icon-btn.pl-edit',
                          {
                            type: 'button',
                            'aria-label': `${t('Edit')} ${p.title}`,
                            title: t('Edit playlist'),
                            onclick: () => editPlaylistSheet(p, { onSaved: () => paint() }),
                          },
                          icon('edit'),
                        ),
                      }
                    : null,
                ),
              ),
            )
          : emptyState({
              iconName: 'list',
              heading: t('No playlists yet'),
              body: data.isMe ? t('Group what you love into a list.') : t('This member has not shared a list yet.'),
              action: data.isMe ? create : null,
            }),
      ),
      data.isMe
        ? h(
            /* The rail only exists from 1000px up, and the tab bar is capped at
               five stops, so everything the rail carries past those five lives
               here too: a phone reaches the arena, the wheel and a trade by
               tapping Profile, the same page that already says who you are.
               Each link appears only where its own feature is written down. */
            'nav.more-links',
            {},
            h('a.more-link', { href: '#/packs' }, icon('sparkles'), h('span', {}, t('Card binder'))),
            fortuneUsable() ? h('a.more-link', { href: '#/spin' }, icon('star'), h('span', {}, t('Fortune wheel'))) : null,
            duelsUsable() ? h('a.more-link', { href: '#/arena' }, icon('bolt'), h('span', {}, t('Arena'))) : null,
            tradesUsable() ? h('a.more-link', { href: '#/trades' }, icon('swap'), h('span', {}, t('Trades'))) : null,
            h('a.more-link', { href: '#/leaderboard' }, icon('crown'), h('span', {}, t('Leaderboard'))),
            h('a.more-link', { href: '#/updates' }, icon('calendarStar'), h('span', {}, t('Airing schedule'))),
            h('a.more-link', { href: '#/settings' }, icon('settings'), h('span', {}, t('Settings'))),
          )
        : null,
    ].filter(Boolean);

    body.replaceChildren(...sections);
    introDone = true;
  }

  await paint();
  return wrap;
}

/**
 * What this device has playing right now. It expires by itself after 40
 * minutes, so it never turns into a stale claim about the present.
 */
function nowCard() {
  const n = nowWatching();
  if (!n) return null;
  return h('div.now-strip', {},
    h('div.now-art', {}, n.cover ? h('img', { src: n.cover, alt: '', loading: 'lazy', decoding: 'async' }) : icon('film')),
    h('div.grow', {},
      h('div.now-1', {}, icon('play'), h('span', {}, t('Now watching'))),
      h('div.now-2.clamp-1', {}, n.title),
    ),
    h('a.btn.btn--sm', { href: `#/watch/${n.id}/${n.ep}` }, icon('next', { cls: 'flip' }), h('span', {}, t('Ep {n}', { n: n.ep }))),
  );
}
