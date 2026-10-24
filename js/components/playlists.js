/**
 * Playlists people build themselves: the card the community page shows, the
 * like button, and the sheets that create, edit and fill a list.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast, confirmSheet } from '../lib/ui.js';
import { stillImage } from './media.js';
import {
  createPlaylist,
  patchPlaylist,
  deletePlaylist,
  likePlaylist,
  account,
  isSignedIn,
} from '../lib/account.js';
import { authSheet } from './account.js';
import { listEntries, favouriteEntries, continueWatching } from '../lib/store.js';

/* ---- the pool a picker draws from ----------------------------------- */
/** Everything this device already knows the name and art of — no API round trip. */
function pool() {
  const out = new Map();
  const add = (e) => {
    if (!e?.id || out.has(e.id)) return;
    out.set(e.id, {
      id: e.id,
      title: e.title || t('Untitled'),
      cover: e.cover || null,
      format: e.format || null,
      year: e.seasonYear || e.year || null,
    });
  };
  for (const key of ['watching', 'completed', 'onHold', 'dropped', 'planned']) listEntries(key).forEach(add);
  favouriteEntries().forEach(add);
  continueWatching(40).forEach(add);
  return [...out.values()];
}

const toApiItem = (media) => ({
  id: media.id,
  title: media.title?.english || media.title?.romaji || media.title?.native || t('Untitled'),
  cover: media.coverImage?.large || media.coverImage?.extraLarge || null,
  format: media.format || null,
  year: media.seasonYear || null,
});

const titleOf = (p) => p.title || t('Untitled');
const likeLabel = (p) => `${p.likedByMe ? t('Unlike') : t('Like')} — ${titleOf(p)}`;

/* ---- card + like ----------------------------------------------------- */
function coverStrip(items) {
  const art = items.slice(0, 3).map((it) => stillImage([it.cover], { alt: '' }));
  return h(
    'div.pl-strip',
    { 'aria-hidden': 'true' },
    ...(art.length ? art : [h('span.pl-strip-empty', {}, icon('list'))]),
    items.length > 3 ? h('span.pl-more.tnum', {}, `+${items.length - 3}`) : null,
  );
}

export function likeButton(p, { onChange } = {}) {
  let busy = false;
  const count = h('span.pl-likes-num.tnum', {}, String(p.likeCount || 0));
  const btn = h(
    `button.pl-like${p.likedByMe ? '.is-on' : ''}`,
    {
      type: 'button',
      'aria-pressed': String(!!p.likedByMe),
      'aria-label': likeLabel(p),
      title: t('Like this playlist'),
      onclick: async () => {
        if (busy) return;
        if (!isSignedIn()) {
          authSheet('login');
          return;
        }
        busy = true;
        btn.classList.add('is-busy');
        try {
          const next = await likePlaylist(p.id);
          Object.assign(p, next);
          btn.classList.toggle('is-on', p.likedByMe);
          btn.setAttribute('aria-pressed', String(p.likedByMe));
          count.textContent = String(p.likeCount || 0);
          onChange?.(p);
        } catch (err) {
          toast(t(err?.message || 'Could not save that.'), { tone: 'err', iconName: 'alert' });
        } finally {
          busy = false;
          btn.classList.remove('is-busy');
        }
      },
    },
    icon('heart'),
    count,
  );
  return btn;
}

export function playlistCard(p, { showOwner = true, action = null } = {}) {
  return h(
    'article.pl-card.glass',
    {},
    coverStrip(p.items || []),
    h(
      'div.pl-meta',
      {},
      h('h4.pl-title', {}, titleOf(p)),
      showOwner && typeof p.owner === 'string' && p.owner
        ? h('p.pl-owner', {}, h('a', { href: `#/profile/${encodeURIComponent(p.ownerId)}` }, p.owner))
        : null,
      h('p.pl-count.tnum', {}, t('{n} titles', { n: (p.items || []).length })),
    ),
    h(
      'div.pl-foot',
      {},
      likeButton(p),
      h('span.pl-foot-right', {}, p.visibility === 'private' ? h('span.pl-lock', { title: t('Private') }, icon('lock')) : null, action),
    ),
  );
}

/* ---- pick list ------------------------------------------------------- */
/**
 * The grid of everything this device knows the name and art of. The calling
 * sheet owns the chosen items; `getSelected` is read back on every `refresh`,
 * so removing a title from the list above also clears its tick here instead of
 * leaving two copies of the truth.
 */
function picker(getSelected, onToggle) {
  const list = pool();
  if (!list.length) {
    return {
      node: h('p.muted.pick-empty', {}, t('Add some anime to your library first, then build a list from it.')),
      refresh: () => {},
    };
  }
  const paint = (box, on) => {
    box.classList.toggle('is-on', on);
    box.setAttribute('aria-pressed', String(on));
  };
  const boxes = list.map((item) => {
    const box = h(
      'button.pick',
      {
        type: 'button',
        onclick: () => paint(box, onToggle(item)),
      },
      h('span.pick-art', {}, stillImage([item.cover], { alt: '' })),
      h('span.pick-name', {}, item.title),
      icon('check', { cls: 'pick-tick' }),
    );
    return { id: item.id, box };
  });
  return {
    node: h('div.pick-grid', { role: 'group', 'aria-label': t('Choose titles') }, ...boxes.map((b) => b.box)),
    refresh() {
      const ids = new Set(getSelected().map((i) => i.id));
      boxes.forEach((b) => paint(b.box, ids.has(b.id)));
    },
  };
}

/* ---- create / edit ---------------------------------------------------- */
function titleField(value = '', id = 'pl-title') {
  const input = h('input.input', {
    id,
    name: 'title',
    maxlength: 60,
    placeholder: t('Rainy night mecha'),
    value,
    required: true,
  });
  const err = h('span.field-err', { role: 'alert' });
  return {
    node: h('div.field', {}, h('label', { for: id }, t('Playlist name')), input, err),
    input,
    err,
    value: () => input.value.trim(),
  };
}

function visibilityToggle(initial = 'public') {
  let value = initial;
  const btn = h(
    `button.vis${value === 'public' ? '.is-on' : ''}`,
    {
      type: 'button',
      'aria-pressed': String(value === 'public'),
      onclick: () => {
        value = value === 'public' ? 'private' : 'public';
        btn.classList.toggle('is-on', value === 'public');
        btn.setAttribute('aria-pressed', String(value === 'public'));
        btn.replaceChildren(icon(value === 'public' ? 'globe' : 'lock'), h('span', {}, value === 'public' ? t('Public') : t('Private')));
      },
    },
    icon(value === 'public' ? 'globe' : 'lock'),
    h('span', {}, value === 'public' ? t('Public') : t('Private')),
  );
  return { node: btn, value: () => value };
}

export function newPlaylistSheet({ presetItem = null, onCreated } = {}) {
  const name = titleField('', 'pl-new-title');
  const vis = visibilityToggle();
  const picked = new Map();
  if (presetItem) picked.set(presetItem.id, presetItem);
  const count = h('span.pick-count.tnum', {}, String(picked.size));
  const grid = picker(
    () => [...picked.values()],
    (item) => {
      const on = !picked.has(item.id);
      if (on) picked.set(item.id, item);
      else picked.delete(item.id);
      count.textContent = String(picked.size);
      return on;
    },
  );
  grid.refresh();

  const opened = sheet({
    heading: t('New playlist'),
    sub: t('Give it a name, pick the titles, decide who sees it.'),
    width: 620,
    render: () =>
      h(
        'form.pl-form.stack',
        {
          novalidate: true,
          onsubmit: async (e) => {
            e.preventDefault();
            const title = name.value();
            if (title.length < 2) {
              name.err.textContent = t('Give the list a name first.');
              name.input.focus();
              return;
            }
            const submit = e.target.querySelector('button[type=submit]');
            submit.disabled = true;
            try {
              const p = await createPlaylist({ title, items: [...picked.values()], visibility: vis.value() });
              opened.close();
              toast(t('Playlist "{name}" saved.', { name: p.title }), { iconName: 'check' });
              onCreated?.(p);
            } catch (err) {
              toast(t(err?.message || 'Could not save that.'), { tone: 'err', iconName: 'alert' });
            } finally {
              submit.disabled = false;
            }
          },
        },
        name.node,
        h(
          'div.pl-row',
          {},
          vis.node,
          h('span.pick-count-wrap', {}, icon('film'), ' ', count, h('span.pick-count-label', {}, t('selected'))),
        ),
        grid.node,
        h('button.btn.btn--primary', { type: 'submit' }, icon('plus'), h('span', {}, t('Create playlist'))),
      ),
  });
  return opened;
}

export function editPlaylistSheet(p, { onSaved } = {}) {
  const name = titleField(p.title, 'pl-edit-title');
  const vis = visibilityToggle(p.visibility);
  const items = new Map((p.items || []).map((i) => [i.id, i]));
  const list = h('div.pl-items');
  const count = h('span.pick-count.tnum', {}, String(items.size));
  const grid = picker(
    () => [...items.values()],
    (item) => {
      const on = !items.has(item.id);
      if (on) items.set(item.id, item);
      else items.delete(item.id);
      paint();
      return on;
    },
  );
  const paint = () => {
    grid.refresh();
    count.textContent = String(items.size);
    list.replaceChildren(
      ...(items.size
        ? [...items.values()].map((it) =>
            h(
              'div.pl-item',
              {},
              stillImage([it.cover], { alt: '' }),
              h('span.pl-item-name', {}, it.title || t('Untitled')),
              h(
                'button.icon-btn',
                {
                  type: 'button',
                  'aria-label': `${t('Remove')} ${it.title || ''}`,
                  onclick: () => {
                    items.delete(it.id);
                    paint();
                  },
                },
                icon('x'),
              ),
            ),
          )
        : [h('p.muted', {}, t('Nothing in here yet.'))])
    );
  };
  paint();

  const opened = sheet({
    heading: t('Edit playlist'),
    sub: p.title,
    width: 620,
    render: () =>
      h(
        'div.pl-form.stack',
        {},
        name.node,
        h(
          'div.pl-row',
          {},
          vis.node,
          h('span.pick-count-wrap', {}, icon('film'), ' ', count, h('span.pick-count-label', {}, t('in this list'))),
        ),
        h('h5.pl-sub', {}, t('In this list')),
        list,
        h('h5.pl-sub', {}, t('Add from your library')),
        grid.node,
        h(
          'div.pl-actions',
          {},
          h(
            'button.btn.btn--primary.grow',
            {
              type: 'button',
              onclick: async (e) => {
                const btn = e.currentTarget;
                const title = name.value();
                if (title.length < 2) {
                  name.err.textContent = t('Give the list a name first.');
                  return;
                }
                btn.disabled = true;
                try {
                  const next = await patchPlaylist(p.id, { title, items: [...items.values()], visibility: vis.value() });
                  opened.close();
                  toast(t('Playlist "{name}" saved.', { name: next.title }), { iconName: 'check' });
                  onSaved?.(next);
                } catch (err) {
                  toast(t(err?.message || 'Could not save that.'), { tone: 'err', iconName: 'alert' });
                } finally {
                  btn.disabled = false;
                }
              },
            },
            t('Save changes'),
          ),
          h(
            'button.btn',
            {
              type: 'button',
              onclick: () =>
                confirmSheet({
                  heading: t('Delete this playlist?'),
                  body: t('"{name}" and its {n} titles go away for good.', { name: p.title, n: (p.items || []).length }),
                  confirmLabel: t('Delete'),
                  onConfirm: async () => {
                    try {
                      await deletePlaylist(p.id);
                      opened.close();
                      toast(t('Playlist deleted.'), { iconName: 'trash' });
                      onSaved?.(null);
                    } catch (err) {
                      toast(t(err?.message || 'Could not save that.'), { tone: 'err', iconName: 'alert' });
                    }
                  },
                }),
            },
            icon('trash'),
            h('span', {}, t('Delete')),
          ),
        ),
      ),
  });
  return opened;
}

/** The button every anime page carries — put this title into a list. */
export function addToPlaylistButton(media) {
  const item = toApiItem(media);
  return h(
    'button.btn',
    {
      type: 'button',
      onclick: () => {
        if (!isSignedIn()) {
          authSheet('login');
          return;
        }
        const mine = account().playlists;
        sheet({
          heading: t('Add to a playlist'),
          sub: media.title?.romaji || media.title?.english || '',
          width: 460,
          render: () =>
            h(
              'div.stack',
              {},
              ...mine.map((p) => {
                const count = h('span.pl-count.tnum', {}, String(p.items.length));
                const btn = h(
                  'button.pl-pick',
                  {
                    type: 'button',
                    'aria-pressed': String(p.items.some((i) => i.id === item.id)),
                    onclick: async () => {
                      const has = p.items.some((i) => i.id === item.id);
                      btn.disabled = true;
                      try {
                        const next = await patchPlaylist(p.id, {
                          items: has ? p.items.filter((i) => i.id !== item.id) : [...p.items, item],
                        });
                        p.items = next.items;
                        btn.classList.toggle('is-on', !has);
                        btn.setAttribute('aria-pressed', String(!has));
                        count.textContent = String(next.items.length);
                        toast(has ? t('Removed from "{name}".', { name: p.title }) : t('Added to "{name}".', { name: p.title }), { iconName: 'check' });
                      } catch (err) {
                        toast(t(err?.message || 'Could not save that.'), { tone: 'err', iconName: 'alert' });
                      } finally {
                        btn.disabled = false;
                      }
                    },
                  },
                  icon('list'),
                  h('span.grow', {}, p.title),
                  count,
                  h('span.pick-tick', {}, icon('check')),
                );
                if (btn.getAttribute('aria-pressed') === 'true') btn.classList.add('is-on');
                return btn;
              }),
              h(
                'button.btn.btn--primary',
                {
                  type: 'button',
                  onclick: () => newPlaylistSheet({ presetItem: item, onCreated: () => toast(t('Ready to share.'), { iconName: 'sparkles' }) }),
                },
                icon('plus'),
                h('span', {}, t('New playlist')),
              ),
            ),
        });
      },
    },
    icon('plus'),
    h('span', {}, t('Playlist')),
  );
}
