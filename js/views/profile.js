/**
 * Profile: who you are on Solvn. A picture, a name, the one title you would
 * pick if you could keep only one, and your own lists.
 *
 * Nothing here measures the person. No rank, no badges, no hours logged, no
 * grid of counts compared with anybody else's — those were removed, and the
 * markup deliberately does not leave empty slots where they used to sit. The
 * three private lists stay because they are the viewer's own shelf, not a
 * scoreboard.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { account, isSignedIn, publicProfile, patchMe, setAvatar, setFavourite, staticHost } from '../lib/account.js';
import { AVATAR_UPLOAD, avatarFromImageFile } from '../lib/ranks.js';
import { search } from '../lib/anilist.js';
import { avatar, authSheet, signOutButton, say } from '../components/account.js';
import { playlistCard, newPlaylistSheet, editPlaylistSheet } from '../components/playlists.js';
import { reportAction } from '../components/report.js';
import { mediaCard, stillImage, emptyState, errorState, loadingGrid } from '../components/media.js';
import { favouriteEntries, listEntries, nowWatching } from '../lib/store.js';

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
   Inline, because it is one field: an input that replaces the heading, Enter
   saves, Escape puts the old name back. The server's reply is what gets
   painted, so a name it refused never appears to have changed. */
function nameBlock(user, onSaved) {
  let busy = false;
  const heading = h('h1.profile-name', {}, user.username);

  const startEdit = () => {
    if (busy) return;
    const input = h('input.input.pf-name-input', {
      value: user.username,
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
      if (!value || value === user.username) {
        stop();
        return;
      }
      busy = true;
      save.disabled = true;
      cancel.disabled = true;
      input.disabled = true;
      try {
        const next = await patchMe({ username: value });
        onSaved(next || { ...user, username: value });
      } catch (err) {
        input.disabled = false;
        save.disabled = false;
        cancel.disabled = false;
        busy = false;
        toast(say(err), { tone: 'err', iconName: 'alert' });
      }
    }

    function stop() {
      heading.replaceChildren(user.username);
      busy = false;
    }
  };

  if (!user.canEdit) return heading;
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

/* ---- picture --------------------------------------------------------
   The file never becomes the account's picture until the server has taken it.
   A read failure, a wrong type or a refused upload leaves the old avatar on
   screen and the sheet open to try again. */
function avatarSheet(user, onDone) {
  let pending = null;
  let busy = false;

  const face = h('div.av-preview');
  const note = h('p.av-note.muted', {}, t('Square, at least 256 pixels. A PNG, JPEG, WebP, GIF or AVIF file.'));
  const error = h('p.av-error', { role: 'alert', hidden: true });

  const file = h('input', {
    type: 'file',
    class: 'hide',
    accept: AVATAR_UPLOAD.accept,
    onchange: () => choose(file.files?.[0]),
  });

  function paintFace() {
    face.replaceChildren(
      ...[
        avatar(pending ? { ...user, avatar: { ...user.avatar, photo: pending.dataUrl } } : user, { size: 'lg' }),
        h('span.av-frame', { 'aria-hidden': 'true' }),
      ],
    );
  }

  function flag(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  function setBusy(on) {
    busy = on;
    for (const node of buttons) {
      node.disabled = on;
      node.classList.toggle('is-busy', on);
      if (on) node.setAttribute('aria-busy', 'true');
      else node.removeAttribute('aria-busy');
    }
    /* The picker is a file input inside a label, so it needs its own lock. */
    file.disabled = on;
    sync();
  }

  /* Save only unlocks once a candidate has actually re-encoded. */
  function sync() {
    if (saveBtn) saveBtn.disabled = busy || !pending;
  }

  async function choose(picked) {
    flag('');
    if (!picked) return;
    setBusy(true);
    try {
      pending = await avatarFromImageFile(picked);
      paintFace();
    } catch (err) {
      pending = null;
      flag(say(err));
    } finally {
      setBusy(false);
      file.value = '';
    }
  }

  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    flag('');
    try {
      await setAvatar(pending);
      opened.close();
      toast(t('Picture updated.'), { iconName: 'check' });
      onDone?.();
    } catch (err) {
      /* The stored picture is untouched, so the page still shows the old one. */
      flag(say(err));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    flag('');
    try {
      await setAvatar(null);
      opened.close();
      toast(t('Picture removed.'), { iconName: 'check' });
      onDone?.();
    } catch (err) {
      flag(say(err));
    } finally {
      setBusy(false);
    }
  }

  let saveBtn = null;
  const buttons = [
    h('label.btn.btn--primary', {}, icon('share'), h('span', {}, t('Choose a picture')), file),
    h('button.btn', { type: 'button', onclick: save, disabled: true, ref: (n) => (saveBtn = n) }, icon('check'), h('span', {}, t('Save picture'))),
    user?.avatar?.photo ? h('button.btn', { type: 'button', onclick: clear }, icon('x'), h('span', {}, t('Remove picture'))) : null,
    h('button.btn', { type: 'button', onclick: () => opened.close() }, h('span', {}, t('Cancel'))),
  ].filter(Boolean);

  paintFace();

  const opened = sheet({
    heading: t('Profile picture'),
    width: 420,
    render: () =>
      h(
        'div.stack',
        {},
        face,
        h('div.pf-actions', {}, ...buttons),
        note,
        error,
      ),
  });

  sync();
  return opened;
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

/* ---- the page ------------------------------------------------------- */
export async function ProfileView(ctx) {
  const wanted = ctx.params.id ? String(ctx.params.id) : null;
  const wrap = h('div.page-profile');
  const body = h('div.pf-inner');
  wrap.append(body);

  let tab = TABS[0][0];

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

  function identity(data) {
    const user = { ...data.user, canEdit: data.isMe };
    const repaint = () => paint();
    return h(
      'header.profile-card.glass',
      {},
      h(
        'div.profile-id',
        {},
        avatar(user, {
          size: 'lg',
          extra: data.isMe
            ? h('button.pf-avatar-edit', { type: 'button', onclick: () => avatarSheet(user, repaint), 'aria-label': t('Change profile picture') }, icon('edit'))
            : null,
        }),
        h(
          'div.profile-names',
          {},
          nameBlock(user, (next) => {
            if (next?.username) data.user = next;
            repaint();
            toast(t('Name saved.'), { iconName: 'check' });
          }),
          data.isMe
            ? h('p.pf-handle', {}, '@', user.username.toLowerCase().replace(/\s+/g, ''))
            : null,
        ),
      ),
      h(
        'div.profile-side',
        {},
        h('div.profile-actions', {}, data.isMe ? signOutButton() : reportAction({ kind: 'user', id: user.id, label: t('Report member') })),
      ),
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
      body.replaceChildren(
        /* An account is a server feature: on a static copy there is nothing to
           sign into, so the page is only the device history. */
        staticHost()
          ? null
          : h(
              'section.join-card.glass',
              {},
              h('div.join-art', {}, icon('ghost')),
              h(
                'div.join-copy',
                {},
                h('h2', {}, t('Your profile starts here')),
                h('p', {}, t('An account keeps your name, your picture, your favourite anime and your lists in one place.')),
              ),
              h('button.btn.btn--primary', { type: 'button', onclick: () => authSheet('signup') }, t('Create account')),
              h('button.btn', { type: 'button', onclick: () => authSheet('login') }, t('Sign in')),
            ),
        h('h2.section-title', {}, t('What you have watched on this device')),
        h('p.muted.join-note', {}, staticHost() ? t('Everything on this page is stored on this device.') : t('These lists stay on this device until you sign in.')),
        listPanel(TABS[0][2]()),
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
      identity(data),
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
          h('h2.section-title', {}, data.isMe ? t('Your playlists') : t('{name}’s playlists', { name: user.username })),
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
            'nav.more-links',
            {},
            h('a.more-link', { href: '#/updates' }, icon('calendarStar'), h('span', {}, t('Airing schedule'))),
            h('a.more-link', { href: '#/settings' }, icon('settings'), h('span', {}, t('Settings'))),
          )
        : null,
    ].filter(Boolean);

    body.replaceChildren(...sections);
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
