/** Settings: appearance, playback, content and local data controls. */

import { h, icon } from '../lib/dom.js';
import { settings, onSettings, ACCENTS, ACCENT_LABELS, CUSTOM_ACCENT, QUALITIES, qualityLabel, clearAll, continueWatching, totalListCount, recentSearches, clearQueries } from '../lib/store.js';
import { accentId, accentValue, paintAccent, previewAccent } from '../lib/accent.js';
import { parseHex, toHex } from '../lib/color.js';
import { clearCache, apiStatus, checkNow } from '../lib/anilist.js';
import { isSignedIn, tellDiscord, staticHost, logout } from '../lib/account.js';
import { FAILOVER_CHOICES, TEMPLATE_HINT, TRACKS, addServer, asTrack, extraServers, isSiteServer, removeServer, serverKind, serverName, serverTracks, tracksOffered, trackChip, trackName } from '../lib/sources.js';
import { addDirectMedia, removeDirectMedia, listDirectMedia, directMediaProblem, importDirectMediaBulk } from '../lib/directmedia.js';
import { storedStremioAddons, addStremioAddon, removeStremioAddon, stremioAddonProblem, clearStremioCache, testAddon } from '../lib/stremio.js';
import { toast, confirmSheet } from '../lib/ui.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { cloudConfig, cloudActive, clearCloudConfig, testCloudConnection, cloudSignOut } from '../lib/cloud.js';
import { syncMyData, captureDeviceData, backupBundle, restoreBundle } from '../lib/core.js';
import { authSheet, say, signOutButton } from '../components/account.js';
import { renderFooter } from '../components/footer.js';
import { logoMark } from '../lib/brand.js';

const rowOf = ({ iconName, label, hint, control }) =>
  h('div.set-row', {},
    h('div.ico', {}, icon(iconName)),
    h('div.txt', {}, h('b', {}, t(label)), hint ? h('span', {}, hint) : null),
    control,
  );

/* `Sound effects` has a handle in the header as well as here, so a switch that
   can be flipped by two owners carries the key it reads. One listener keeps
   every row on this page honest when a setting changes anywhere else — it walks
   the live DOM rather than holding on to nodes from a page already left. */
onSettings(() => {
  document
    .querySelectorAll('.page-settings .switch[data-setting]')
    .forEach((sw) => sw.setAttribute('aria-checked', String(Boolean(settings.get(sw.dataset.setting)))));
});

/* The accent row is repainted from the live DOM for the same reason the
   switches are: a preset chosen by the picker's own `change`, a reset, or a
   value restored from the cloud all have to move the ring and the hex readout,
   and neither node belongs to whoever changed the setting. */
function repaintAccentRow() {
  const box = document.querySelector('.swatches[data-accent-row]');
  if (!box) return;
  const id = accentId();
  box.querySelectorAll('[data-accent-id]').forEach((el) => {
    const on = el.dataset.accentId === id;
    el.classList.toggle('is-on', on);
    /* Only the preset circles are toggle buttons; the picker's ring is the
       whole state, since a colour input has no pressed state of its own. */
    if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(on));
  });
  const hex = box.querySelector('.accent-hex');
  /* The field is both readout and keyboard route into the palette, so a
     repaint never overwrites digits someone is halfway through typing. */
  if (hex && document.activeElement !== hex) hex.value = `#${accentValue().toUpperCase()}`;
  const input = box.querySelector('.swatch-input');
  /* Keep the panel starting at what is on screen — but never while it is the
     thing being dragged, or the wheel would jump back under the pointer. */
  if (input && document.activeElement !== input) input.value = `#${accentValue()}`;
}
onSettings((key) => {
  if (key === 'accent' || key === 'accentCustom' || key === '*') repaintAccentRow();
});

const accentName = (id) => t(ACCENT_LABELS[id] || id);

const toggle = (key, label) =>
  h('button.switch', {
    role: 'switch',
    'aria-checked': String(Boolean(settings.get(key))),
    'aria-label': t(label),
    dataset: { setting: key },
    onclick: (e) => {
      const next = e.currentTarget.getAttribute('aria-checked') !== 'true';
      e.currentTarget.setAttribute('aria-checked', String(next));
      settings.set(key, next);
      document.dispatchEvent(new CustomEvent('kitsune:setting', { detail: { key, value: next } }));
    },
  });

function cacheInfo() {
  let bytes = 0;
  let entries = 0;
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('kitsune:anilist:')) continue;
    bytes += (localStorage.getItem(k) || '').length;
    entries += 1;
  }
  return { kb: (bytes / 1024).toFixed(0), entries };
}

export async function SettingsView() {
  const wrap = h('div.page-settings');

  /* Every preset is a circle, and the last control is the colour wheel: a real
     `<input type="color">` wearing the swatch, so any colour at all can be
     chosen. The field after it prints the hex actually in force, and takes one
     back — a browser with no colour panel (mobile Safari among them) still
     gets the full choice, which is why the readout is an input and not a label. */
  const choose = (hex) => {
    settings.set('accentCustom', hex);
    settings.set('accent', CUSTOM_ACCENT);
    toast(t('Accent updated'), { tone: 'ok', iconName: 'palette' });
  };

  const hexField = h('input.input.accent-hex', {
    type: 'text',
    spellcheck: false,
    maxlength: 7,
    value: `#${accentValue().toUpperCase()}`,
    'aria-label': t('Accent colour as a hex code'),
    onchange: (e) => {
      const rgb = parseHex(e.currentTarget.value);
      if (!rgb) {
        e.currentTarget.value = `#${accentValue().toUpperCase()}`;
        toast(t('That is not a hex colour'), { tone: '', iconName: 'alert' });
        return;
      }
      choose(`#${toHex(rgb)}`);
    },
  });

  const swatches = h('div.swatches', {
    role: 'group',
    'aria-label': t('Accent colour'),
    dataset: { accentRow: 'true' },
  },
    ...Object.entries(ACCENTS).map(([id, hex]) =>
      h(`button.swatch${id === accentId() ? '.is-on' : ''}`, {
        type: 'button',
        dataset: { accentId: id },
        style: { background: `#${hex}` },
        title: accentName(id),
        'aria-label': accentName(id),
        'aria-pressed': String(id === accentId()),
        onclick: () => { settings.set('accent', id); },
      }),
    ),
    h(`label.swatch.swatch--pick${accentId() === CUSTOM_ACCENT ? '.is-on' : ''}`, {
      dataset: { accentId: CUSTOM_ACCENT },
      title: t('Pick any colour'),
    },
      h('input.swatch-input', {
        type: 'color',
        value: `#${accentValue()}`,
        'aria-label': t('Custom accent colour'),
        /* Dragging paints without writing: the choice is stored, toasted and
           marked as the active one only when the picker is closed. */
        oninput: (e) => previewAccent(e.currentTarget.value),
        onchange: (e) => choose(e.currentTarget.value),
      }),
    ),
    hexField,
  );

  /** Language names stay in their own language — that is how a viewer spots theirs. */
  const langSeg = h('div.seg', { role: 'group', 'aria-label': t('Language') },
    ...Object.entries(LANGS).map(([id, l]) =>
      h(`button${lang() === id ? '.is-active' : ''}`, {
        'aria-pressed': String(lang() === id),
        onclick: () => {
          // setLang re-mounts this view, so there is nothing to repaint here.
          if (!setLang(id)) return;
          toast(`${l.name} — ${l.dir === 'rtl' ? 'RTL' : 'LTR'}`, { tone: 'ok', iconName: 'globe' });
        },
      }, l.name),
    ),
  );

  /* Four audio languages, listed rather than squared off into buttons: the whole
     name is the point and four of them do not fit side by side on a phone.

     Only the tracks a configured server can actually answer are listed here. An
     Arabic default on a sub-and-dub-only player is not a preference, it is a
     black frame, so AR and FR join the list when a server that declares them is
     added further down this page. */
  const prefTracks = tracksOffered();
  const audioSeg = h(
    'select.select',
    {
      'aria-label': t('Default audio'),
      onchange: (e) => {
        settings.set('defaultAudio', e.currentTarget.value);
        toast(t('Saved as {label}', { label: trackName(e.currentTarget.value) }), { tone: 'ok', iconName: 'check' });
      },
    },
    ...prefTracks.map((v) =>
      h('option', { value: v, selected: asTrack(settings.get('defaultAudio')) === v }, trackName(v)),
    ),
  );

  /* Six tiers would not fit a segment control on a phone, and this is a
     preference the player reads once — a select is the honest shape. */
  const qualitySeg = h(
    'select.select',
    {
      'aria-label': t('Streaming quality'),
      onchange: (e) => {
        settings.set('quality', e.currentTarget.value);
        toast(t('Saved as {label}', { label: qualityLabel(e.currentTarget.value) }), { tone: 'ok', iconName: 'check' });
      },
    },
    ...QUALITIES.map((q) => h('option', { value: q.id, selected: q.id === settings.get('quality') }, q.label)),
  );

  /* ---- Discord status -------------------------------------------------- */
  /* A webhook address is a posting credential, so it stays on this device and
     only ever travels to server.js, which aims it at Discord's own hosts. */
  const discordBody = h('div');

  function paintDiscord() {
    const hook = settings.get('discordHook') || '';
    const signed = isSignedIn();

    const urlIn = h('input.input', {
      type: 'url',
      placeholder: 'https://discord.com/api/webhooks/…',
      autocomplete: 'off',
      spellcheck: 'false',
      value: hook,
      'aria-label': t('Webhook address'),
    });

    const save = h(
      'button.btn.btn--sm',
      {
        onclick: () => {
          settings.set('discordHook', urlIn.value.trim());
          toast(t('Webhook saved'), { tone: 'ok', iconName: 'check' });
          paintDiscord();
        },
      },
      icon('check'),
      t('Save'),
    );

    const test = h(
      'button.btn.btn--sm.btn--primary',
      {
        disabled: !hook || !signed,
        onclick: async () => {
          test.disabled = true;
          try {
            await tellDiscord({ url: hook, text: t('Solvn test — this is what a status line looks like.') });
            toast(t('Discord took the post.'), { tone: 'ok', iconName: 'check' });
          } catch (err) {
            toast(err?.message ? t(err.message) : t('Discord refused that post.'), { tone: 'err', iconName: 'alert' });
          } finally {
            test.disabled = !hook || !signed;
          }
        },
      },
      icon('share'),
      t('Test post'),
    );

    const clear = hook
      ? h(
          'button.btn.btn--sm',
          {
            onclick: () => {
              settings.set('discordHook', '');
              settings.set('discordShare', false);
              toast(t('Webhook cleared'), { tone: 'ok', iconName: 'check' });
              paintDiscord();
            },
          },
          icon('trash'),
          t('Clear'),
        )
      : null;

    discordBody.replaceChildren(
      ...[
        rowOf({
          iconName: 'share',
          label: 'Post what I watch',
          hint: signed
            ? t('One line per episode as it starts. Needs a member account because the post goes through Solvn.')
            : t('Sign in as a member to post — a guest session has no account to send from.'),
          control: toggle('discordShare', 'Post what I watch'),
        }),
        h('div.cloud-fields', {}, h('label.cloud-field', {}, t('Webhook address'), urlIn)),
        h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } }, save, test, clear),
      ],
    );
  }
  paintDiscord();

  /* ---- footer links ---------------------------------------------------- */
  /* The footer no longer links to any other site, so this card has exactly one
     field left: the address a rights holder writes to. It stays hidden from the
     page until somebody fills it in, so the footer is never a dead link. */
  const footerBody = h('div');

  function paintFooterLinks() {
    const fields = [{ key: 'contactEmail', label: t('Contact email'), type: 'email', ph: 'you@example.com' }];
    const inputs = fields.map((f) => ({
      ...f,
      input: h('input.input', {
        type: f.type,
        placeholder: f.ph,
        autocomplete: 'off',
        spellcheck: 'false',
        value: settings.get(f.key) || '',
        'aria-label': f.label,
      }),
    }));

    const save = h(
      'button.btn.btn--sm.btn--primary',
      {
        onclick: () => {
          for (const f of inputs) {
            const v = f.input.value.trim();
            if (!v) {
              settings.set(f.key, '');
              continue;
            }
            const ok =
              f.type === 'email'
                ? /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)
                : /^https?:\/\/\S+$/i.test(v);
            if (!ok) {
              toast(f.type === 'email' ? t('That is not an email address.') : t('That is not a web address.'), {
                tone: 'err',
                iconName: 'alert',
              });
              f.input.focus();
              return;
            }
            settings.set(f.key, v);
          }
          renderFooter();
          toast(t('Footer updated'), { tone: 'ok', iconName: 'check' });
          paintFooterLinks();
        },
      },
      icon('check'),
      t('Save'),
    );

    footerBody.replaceChildren(
      h('div.cloud-fields', {}, ...inputs.map((f) => h('label.cloud-field', {}, f.label, f.input))),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } }, save),
      h('p.faint.cloud-note', {}, t('Anything left empty is simply absent from the footer, so no button on the page goes nowhere.')),
    );
  }
  paintFooterLinks();

  const dataBody = h('div');  function paintData() {
    const c = cacheInfo();
    const s = apiStatus();
    dataBody.replaceChildren(
      /* The one place the outage is mentioned: a status line, not a bar across
         the page. "Check now" is why the banner could be removed safely. */
      rowOf({ iconName: s.tone === 'live' ? 'globe' : 'offline', label: s.label, hint: t(s.hint),
        control: h('button.btn.btn--sm', { onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          b.textContent = t('Checking…');
          const live = await checkNow();
          toast(live ? t('The catalogue is answering again') : t('The catalogue is still quiet — saved data keeps you going'),
            { tone: live ? 'ok' : '', iconName: live ? 'check' : 'offline' });
          paintData();
        }}, t('Check now')) }),
      rowOf({ iconName: 'history', label: 'Continue watching', hint: t('{n} titles in progress', { n: continueWatching(99).length }),
        control: h('button.btn.btn--sm', { disabled: !continueWatching(99).length, onclick: () => confirmSheet({
          heading: t('Clear all progress?'),
          body: t('Every “continue watching” entry is removed. Your saved lists stay untouched.'),
          confirmLabel: 'Clear progress',
          onConfirm: () => { Object.keys(localStorage).filter((k) => k.endsWith('progress')).forEach((k) => localStorage.removeItem(k)); toast(t('Progress cleared'), { tone: 'ok', iconName: 'check' }); paintData(); },
        }) }, t('Clear')) }),
      rowOf({ iconName: 'search', label: 'Search history', hint: t('{n} saved queries', { n: recentSearches(99).length }),
        control: h('button.btn.btn--sm', { disabled: !recentSearches(99).length, onclick: () => { clearQueries(); toast(t('Search history cleared'), { tone: 'ok', iconName: 'check' }); paintData(); } }, t('Clear')) }),
      rowOf({ iconName: 'library', label: 'Your library', hint: t('{n} saved titles', { n: totalListCount() }),
        control: h('button.btn.btn--sm', { disabled: !totalListCount(), onclick: () => confirmSheet({
          heading: t('Empty your library?'),
          body: t('Removes every title from Watching, Completed, On Hold, Dropped and Plan to Watch.'),
          confirmLabel: 'Empty library',
          onConfirm: () => {
            localStorage.removeItem('kitsune:lists');
            localStorage.removeItem('kitsune:favs');
            toast(t('Library cleared'), { tone: 'ok', iconName: 'check' });
            document.dispatchEvent(new CustomEvent('kitsune:nav'));
            paintData();
          },
        }) }, t('Clear')) }),
      rowOf({ iconName: 'refresh', label: 'Catalogue cache', hint: t('{entries} items · {kb} KB stored locally', { entries: c.entries, kb: c.kb }),
        control: h('button.btn.btn--sm', { onclick: () => {
          clearCache();
          toast(t('Cache cleared — data will refetch'), { tone: 'ok', iconName: 'refresh' });
          paintData();
        } }, t('Clear')) }),
      rowOf({ iconName: 'trash', label: 'Reset everything', hint: t('Wipes all Solvn data from this browser'),
        control: h('button.btn.btn--sm', { style: { color: 'var(--danger)' }, onclick: () => confirmSheet({
          heading: t('Reset Solvn?'),
          body: t('Lists, favourites, progress, search history, settings and cache are all deleted. This cannot be undone.'),
          confirmLabel: 'Delete everything',
          onConfirm: () => {
            clearAll();
            /* Wiping storage leaves the picker's inline properties on <html>, so
               the accent is repainted from the now-empty defaults. */
            paintAccent();
            toast(t('Everything reset'), { tone: 'ok', iconName: 'check' });
            document.dispatchEvent(new CustomEvent('kitsune:nav'));
            setTimeout(() => location.reload(), 700);
          },
        }) }, t('Reset')) }),
    );
  }
  paintData();

  /* ---- cloud sync ---------------------------------------------------- */
  /* On solvn.site the central cloud is built in and needs no keys: it is the
     one database behind every account. Everywhere else this section stays the
     old optional project, plus the same sync controls once it is live. */
  const cloudBody = h('div');

  function paintCloud() {
    const cfg = cloudConfig();
    const builtin = Boolean(cfg?.builtin);
    const live = Boolean(cloudActive());

    const sync = h(
      'button.btn.btn--sm.btn--primary',
      {
        onclick: async () => {
          /* A guest still owns a device binder. Capture it before the sheet
             swaps the identity, so the first sign-in carries it up. */
          if (!cloudActive() || !isSignedIn()) {
            captureDeviceData();
            authSheet('login');
            toast(t('Sign in and this device carries its binder and packs into the central cloud.'), { tone: 'ok', iconName: 'globe' });
            return;
          }
          sync.disabled = true;
          sync.classList.add('is-busy');
          sync.setAttribute('aria-busy', 'true');
          try {
            const res = await syncMyData();
            toast(
              res.direction === 'up'
                ? t('Your data now lives in the central cloud.')
                : t('This device caught up with the cloud.'),
              { tone: 'ok', iconName: 'check' },
            );
            paintCloud();
          } catch (err) {
            toast(say(err), { tone: 'err', iconName: 'alert' });
          } finally {
            sync.disabled = false;
            sync.classList.remove('is-busy');
            sync.removeAttribute('aria-busy');
          }
        },
      },
      icon('globe'),
      t('Sync my data'),
    );

    const backup = h(
      'button.btn.btn--sm',
      {
        onclick: () => {
          const stamp = new Date().toISOString().slice(0, 10);
          const blob = new Blob([JSON.stringify(backupBundle(), null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `solvn-backup-${stamp}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
          toast(t('Backup saved.'), { tone: 'ok', iconName: 'check' });
        },
      },
      icon('share'),
      t('Save a backup'),
    );

    const fileIn = h('input', {
      type: 'file',
      accept: 'application/json,.json',
      hidden: true,
      onchange: async () => {
        const file = fileIn.files?.[0];
        if (!file) return;
        try {
          restoreBundle(JSON.parse(await file.text()));
          toast(t('Backup restored.'), { tone: 'ok', iconName: 'check' });
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
        } finally {
          fileIn.value = '';
        }
      },
    });
    const restore = h('button.btn.btn--sm', { onclick: () => fileIn.click() }, icon('swap'), t('Restore a backup'));

    const syncRow = h(
      'div.rowline.wrap',
      { style: { gap: '8px', padding: '12px 0 0' } },
      sync,
      backup,
      restore,
      fileIn,
    );

    if (builtin) {
      const status = live
        ? t('Central cloud in use — every pull and pack syncs to solvn.site.')
        : t('solvn.site is wired to the central Solvn database automatically.');
      cloudBody.replaceChildren(
        h(
          'div.set-row',
          {},
          h('div.ico', {}, icon('globe')),
          h('div.txt', {}, h('b', {}, t('Central cloud')), h('span', {}, status)),
        ),
        syncRow,
      );
      return;
    }

    const status = live
      ? t('Cloud account in use. Your lists, ranks and playlists read from Supabase.')
      : cfg?.verified
        ? t('Verified. The sign-in sheet now offers Google.')
        : cfg
          ? t('Saved but untested — sign-in still uses this device.')
          : t('Off. Accounts, ranks and playlists live on this device only.');

    const urlIn = h('input.input', {
      type: 'url',
      placeholder: 'https://xxxx.supabase.co',
      autocomplete: 'off',
      spellcheck: 'false',
      value: cfg?.url || '',
    });
    const keyIn = h('input.input', {
      type: 'password',
      placeholder: t('Anon public key'),
      autocomplete: 'off',
      spellcheck: 'false',
      value: cfg?.key || '',
    });

    const test = h('button.btn.btn--sm.btn--primary', {
      onclick: async () => {
        test.disabled = true;
        test.classList.add('is-busy');
        test.setAttribute('aria-busy', 'true');
        const res = await testCloudConnection({ url: urlIn.value, key: keyIn.value });
        test.disabled = false;
        test.classList.remove('is-busy');
        test.removeAttribute('aria-busy');
        toast(t(res.message), { tone: res.ok ? 'ok' : 'err', iconName: res.ok ? 'check' : 'alert' });
        /* A project that just proved itself changes what the header can offer:
           on a static copy it is the difference between a dead "Profile" link
           and a real Sign in. Same event the session fires, same repaint. */
        if (res.ok) document.dispatchEvent(new CustomEvent('kitsune:account'));
        paintCloud();
      },
    }, icon('link'), t('Test connection'));

    cloudBody.replaceChildren(
      h(
        'div.set-row',
        {},
        h('div.ico', {}, icon(live || cfg?.verified ? 'globe' : 'offline')),
        h('div.txt', {}, h('b', {}, t('Cloud sync')), h('span', {}, status)),
      ),
      h(
        'div.cloud-fields',
        {},
        h('label.cloud-field', {}, t('Project URL'), urlIn),
        h('label.cloud-field', {}, t('Anon key'), keyIn),
      ),
      h(
        'div.rowline.wrap',
        { style: { gap: '8px', padding: '12px 0 0' } },
        test,
        cfg
          ? h(
              'button.btn.btn--sm',
              {
                onclick: () =>
                  confirmSheet({
                    heading: t('Disconnect the cloud project?'),
                    body: t('Sign-in goes back to this device. Nothing is deleted inside your project.'),
                    confirmLabel: 'Disconnect',
                    onConfirm: () => {
                      clearCloudConfig();
                      toast(t('Cloud sync cleared'), { tone: 'ok', iconName: 'check' });
                      document.dispatchEvent(new CustomEvent('kitsune:account'));
                      paintCloud();
                    },
                  }),
              },
              icon('trash'),
              t('Disconnect'),
            )
          : null,
      ),
      ...(live ? [syncRow] : []),
    );
  }
  paintCloud();

  /* ---- streaming servers ------------------------------------------------ */
  /* Solvn hosts no video of its own, so every source is one of two things: an
     address pointing at a file the watch page plays in its own player, or an
     address pointing at somebody else's player page, framed. What is drawn
     inside a framed page belongs to that page — its controls, its quality choice
     and its corner mark cannot be taken out from here. Nothing starts here on its
     own: what the site ships with lives in js/lib/defaults.js and reads as a
     locked row, and what is added below is stored in this browser only. */
  const serversBody = h('div');
  const directMediaBody = h('div');

  function paintDirectMedia() {
    const idIn = h('input.input', { type: 'number', min: '1', autocomplete: 'off', placeholder: '16498', 'aria-label': t('Anime id (AniList)') });
    const epIn = h('input.input', { type: 'number', min: '1', autocomplete: 'off', placeholder: '1', 'aria-label': t('Episode') });
    const urlIn = h('input.input', { type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://cdn.example.com/ep1.m3u8', 'aria-label': t('Direct media address') });

    const add = h('button.btn.btn--sm.btn--primary', {
      onclick: () => {
        const problem = addDirectMedia({ id: idIn.value, episode: epIn.value, url: urlIn.value });
        if (problem) { toast(problem, { tone: 'err', iconName: 'alert' }); urlIn.focus(); return; }
        toast(t('Direct link added'), { tone: 'ok', iconName: 'check' });
        idIn.value = ''; epIn.value = ''; urlIn.value = '';
        paintDirectMedia();
      },
    }, icon('plus'), t('Add link'));

    const rows = listDirectMedia().map((r) =>
      h('div.set-row', {},
        h('div.ico', {}, icon('play')),
        h('div.txt', {},
          h('b', {}, `#${r.id} · Ep ${r.episode}`),
          h('span', {}, r.url),
        ),
        h('button.btn.btn--sm.btn--ghost', {
          onclick: () => { removeDirectMedia(r.id, r.episode); toast(t('Removed'), { tone: 'ok', iconName: 'check' }); paintDirectMedia(); },
        }, icon('trash'), t('Remove')),
      ),
    );

    directMediaBody.replaceChildren(
      h('div.set-row', {},
        h('div.ico', {}, icon('link')),
        h('div.txt', {},
          h('b', {}, t('Add a clean direct link')),
          h('span', {}, t('Maps an AniList id + episode to a direct .m3u8/.mp4 URL. Stored in this browser only.')),
        ),
      ),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '8px 0' } }, idIn, epIn, urlIn, add),
      ...rows,
      ...(rows.length ? [] : [h('div.set-row', {}, h('div.txt', {}, h('span', {}, t('No direct links yet.'))))]),
    );
  }
  paintDirectMedia();
  const stremioBody = h('div');

  function paintStremio() {
    const urlIn = h('input.input', { type: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://your-clean-addon.example.com', 'aria-label': t('Add-on address') });
    const add = h('button.btn.btn--sm.btn--primary', {
      onclick: () => {
        const problem = addStremioAddon(urlIn.value);
        if (problem) { toast(problem, { tone: 'err', iconName: 'alert' }); urlIn.focus(); return; }
        toast(t('Add-on added'), { tone: 'ok', iconName: 'check' });
        urlIn.value = '';
        paintStremio();
      },
    }, icon('plus'), t('Add add-on'));
    const rows = storedStremioAddons().map((u) =>
      h('div.set-row', {},
        h('div.ico', {}, icon('globe')),
        h('div.txt', {}, h('b', {}, u)),
        h('button.btn.btn--sm.btn--ghost', {
          onclick: async () => {
            toast(t('Testing...'), { tone: 'info', iconName: 'globe' });
            const r = await testAddon(u);
            if (r.ok) toast(t('Addon OK: ') + (r.manifest?.name || u) + ' — ' + (r.streams?.length || 0) + ' streams', { tone: 'ok', iconName: 'check' });
            else toast(t('Addon failed: ') + (r.error || 'unknown'), { tone: 'err', iconName: 'alert' });
          },
        }, icon('globe'), t('Test')),
        h('button.btn.btn--sm.btn--ghost', {
          onclick: () => { removeStremioAddon(u); toast(t('Removed'), { tone: 'ok', iconName: 'check' }); paintStremio(); },
        }, icon('trash'), t('Remove')),
      ),
    );
    stremioBody.replaceChildren(
      h('div.set-row', {},
        h('div.ico', {}, icon('globe')),
        h('div.txt', {},
          h('b', {}, t('Stremio-style clean add-ons')),
          h('span', {}, t('Base URL of a clean add-on that answers /stream/{type}/{id}.json with direct .m3u8/.mp4 links. Queried automatically per episode; no ads, no redirects.')),
        ),
      ),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '8px 0' } }, urlIn, add),
      ...rows,
      ...(rows.length ? [] : [h('div.set-row', {}, h('div.txt', {}, h('span', {}, t('No add-ons configured.'))))]),
      h('div.set-row', {},
        h('div.ico', {}, icon('refresh')),
        h('div.txt', {}, h('b', {}, t('Stream cache')), h('span', {}, t('Cached direct streams per episode (12h TTL). Clear to force re-fetch.'))),
        h('button.btn.btn--sm.btn--ghost', {
          onclick: () => { clearStremioCache(); toast(t('Cache cleared'), { tone: 'ok', iconName: 'check' }); },
        }, icon('trash'), t('Clear cache')),
      ),
    );
  }
  paintStremio();
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return String(url).slice(0, 40);
    }
  };

  /* The languages a server said it has, shown on its own row so what the player
     will offer is readable without opening the watch page. */
  const trackMarks = (server) => serverTracks(server).map(trackChip).join(' · ');

  function paintServers() {
    const extra = extraServers();
    const nameIn = h('input.input', {
      type: 'text',
      maxlength: '28',
      autocomplete: 'off',
      placeholder: t('Optional'),
      'aria-label': t('Server name'),
    });
    const urlIn = h('input.input', {
      type: 'url',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: TEMPLATE_HINT,
      'aria-label': t('Player address'),
    });

    /* Which audio languages this server carries. This is the only way Solvn can
       know: AniList has no dub-availability field for a title, so nothing here
       inspects the catalogue — the viewer states what their source offers, and
       the player, the switcher and the card badges all follow that statement.
       Japanese subtitles and the English dub are on by default because that is
       what a template with {audio} in it almost always answers. */
    const carried = new Set(['sub', 'dub']);
    const trackPicker = h(
      'div.rowline.wrap',
      { style: { gap: '8px' }, role: 'group', 'aria-label': t('Audio languages this server carries') },
      ...TRACKS.map((tr) =>
        h(
          'button.chip.chip--xs.is-active',
          {
            type: 'button',
            'aria-pressed': 'true',
            onclick: (e) => {
              const on = !carried.has(tr.id);
              if (on) carried.add(tr.id);
              else carried.delete(tr.id);
              /* Refusing the last one off is refusing to have a server at all:
                 with no track the ladder can never pair it with a request. */
              if (!on && !carried.size) {
                carried.add(tr.id);
                toast(t('Keep at least one audio language.'), { tone: 'err', iconName: 'alert' });
                return;
              }
              e.currentTarget.classList.toggle('is-active', carried.has(tr.id));
              e.currentTarget.setAttribute('aria-pressed', String(carried.has(tr.id)));
            },
          },
          tr.chip,
        ),
      ),
    );

    const add = h(
      'button.btn.btn--sm.btn--primary',
      {
        onclick: () => {
          const problem = addServer({ name: nameIn.value, url: urlIn.value, tracks: [...carried] });
          if (problem) {
            toast(problem, { tone: 'err', iconName: 'alert' });
            urlIn.focus();
            return;
          }
          toast(t('Server added'), { tone: 'ok', iconName: 'check' });
          paintServers();
        },
      },
      icon('plus'),
      t('Add server'),
    );

    /* The same choice the player's own clock runs on, in seconds. A stored value
       that is no longer offered falls back to the default instead of leaving the
       control with nothing lit. */
    const choice = Number(settings.get('failover'));
    const now = FAILOVER_CHOICES.includes(choice) ? choice : 8;
    const failoverSeg = h(
      'div.seg',
      { role: 'group', 'aria-label': t('Switch servers after') },
      ...FAILOVER_CHOICES.map((sec) =>
        h(`button${sec === now ? '.is-active' : ''}`, {
          'aria-pressed': String(sec === now),
          onclick: (e) => {
            settings.set('failover', sec);
            [...e.currentTarget.parentElement.children].forEach((b) => {
              b.classList.remove('is-active');
              b.setAttribute('aria-pressed', 'false');
            });
            e.currentTarget.classList.add('is-active');
            e.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }, t('{n}s', { n: sec })),
      ),
    );

    serversBody.replaceChildren(
      ...(extra.length
        ? []
        : [
            h(
              'div.set-row',
              {},
              h('div.ico', {}, icon('alert')),
              h('div.txt', {}, h('b', {}, t('No source configured yet')), h('span', {}, t('The player has nothing to play until an address is added below, or in js/lib/defaults.js for every visitor.'))),
            ),
          ]),
      ...extra.map((s) =>
        h(
          'div.set-row',
          {},
          h('div.ico', {}, icon('cast')),
          h('div.txt', {}, h('b', {}, serverName(s)), h('span', {}, hostOf(s.url))),
          h('span.badge', {}, serverKind(s) === 'media' ? t('In-house player') : t('Framed page')),
          h('span.badge', {}, trackMarks(s)),
          /* A row that came with the deployment is not this browser's to delete —
             it lives in lib/defaults.js, and the button that would only look like
             it works is not drawn. */
          isSiteServer(s)
            ? h('span.badge', {}, icon('lock'), t('Site default'))
            : h(
                'button.btn.btn--sm',
                {
                  onclick: () =>
                    confirmSheet({
                      heading: t('Remove this server?'),
                      body: t('{name} leaves the failover ladder. Nothing else changes.', { name: serverName(s) }),
                      confirmLabel: t('Remove'),
                      onConfirm: () => {
                        removeServer(s.id);
                        toast(t('Server removed'), { tone: 'ok', iconName: 'check' });
                        paintServers();
                      },
                    }),
                },
                icon('trash'),
                t('Remove'),
              ),
        ),
      ),
      h(
        'div.cloud-fields',
        {},
        h('label.cloud-field', {}, t('Server name'), nameIn),
        h('label.cloud-field', {}, t('Player address'), urlIn),
      ),
      h(
        'div.cloud-fields',
        {},
        h('label.cloud-field', {}, t('Audio languages this server carries'), trackPicker),
      ),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } }, add),
      h(
        'div.rowline.wrap',
        { style: { gap: '12px', padding: '20px 0 0', alignItems: 'center' } },
        h('span.faint', {}, t('Switch servers after')),
        failoverSeg,
      ),
      h('p.faint.cloud-note', {}, t('Put {anilist}, {episode}, {audio}, {next} or {accent} in the address where the player expects them. Only https works, and the page stays inside Solvn: a server can never move you somewhere else.')),
    );
  }
  paintServers();

  /* ---- account ---------------------------------------------------------- */
  const accountBody = h('div');
  function paintAccount() {
    const signed = isSignedIn();
    accountBody.replaceChildren(
      rowOf({
        iconName: 'user',
        label: 'Account',
        hint: signed ? t('Signed in. Your local library stays on this device.') : t('Continue as a guest, or sign in to sync a library across devices.'),
        control: signed
          ? signOutButton()
          : h('button.btn.btn--sm.btn--primary', { onclick: () => authSheet('login') }, icon('user'), t('Sign in')),
      }),
      rowOf({
        iconName: 'trash',
        label: 'Delete account',
        hint: t('Signs out of the central cloud and wipes every Solvn preference from this browser. This cannot be undone.'),
        control: h(
          'button.btn.btn--sm',
          {
            style: { color: 'var(--danger)' },
            onclick: () =>
              confirmSheet({
                heading: t('Delete this account?'),
                body: t('This signs you out, removes the local profile, lists, progress and settings. A cloud account itself can only be removed by the service operator.'),
                confirmLabel: t('Delete account'),
                onConfirm: async () => {
                  try { await logout(); } catch { /* a static host has no account route */ }
                  cloudSignOut();
                  clearAll();
                  toast(t('Account data removed from this device'), { tone: 'ok', iconName: 'check' });
                  location.hash = '#/';
                  setTimeout(() => location.reload(), 450);
                },
              }),
          },
          icon('trash'),
          t('Delete'),
        ),
      }),
    );
  }
  paintAccount();

  /* ---- subtitles -------------------------------------------------------- */
  const subPreview = h('div.sub-preview', { 'aria-live': 'polite' });
  const subPreviewText = h('span.sub-preview-text', {}, t('The quick brown fox jumps over the lazy dog.'));
  const subPreviewCard = h('div.sub-preview-card', {}, subPreviewText);
  subPreview.append(subPreviewCard);

  const subtitleNumber = (key, { min, max, step = 1, label, unit = '' }) => {
    const read = () => {
      const n = Number(settings.get(key));
      return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
    };
    const out = h('output.sub-value', {}, `${read()}${unit}`);
    const input = h('input.sub-range', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(read()),
      'aria-label': t(label),
      oninput: (e) => {
        const n = Number(e.currentTarget.value);
        settings.set(key, n);
        out.textContent = `${n}${unit}`;
        paintSubtitlePreview();
      },
    });
    return h('div.sub-control', {}, h('label', {}, t(label), out), input);
  };

  const subtitleColor = (key, label) =>
    h(
      'label.sub-color',
      {},
      h('span', {}, t(label)),
      h('input', {
        type: 'color',
        value: settings.get(key) || '#ffffff',
        'aria-label': t(label),
        oninput: (e) => {
          settings.set(key, e.currentTarget.value);
          paintSubtitlePreview();
        },
      }),
    );

  const subtitleLang = h(
    'select.select',
    {
      'aria-label': t('Subtitle language'),
      onchange: (e) => settings.set('subtitleLang', e.currentTarget.value),
    },
    ...[['auto', t('Automatic')], ['en', 'English'], ['ar', 'العربية'], ['fr', 'Français']].map(([value, label]) =>
      h('option', { value, selected: settings.get('subtitleLang') === value }, label),
    ),
  );

  const subSize = subtitleNumber('subtitleSize', { min: 70, max: 160, label: 'Font size', unit: '%' });
  const subPosition = subtitleNumber('subtitlePosition', { min: 50, max: 96, label: 'Vertical position', unit: '%' });
  const subOpacity = subtitleNumber('subtitleBgOpacity', { min: 0, max: 100, step: 1, label: 'Background opacity', unit: '%' });

  function paintSubtitlePreview() {
    const size = Number(settings.get('subtitleSize')) || 100;
    const pos = Number(settings.get('subtitlePosition')) || 88;
    const opacity = Number(settings.get('subtitleBgOpacity'));
    const bgOpacity = Number.isFinite(opacity) ? opacity / 100 : 0.62;
    subPreviewCard.style.setProperty('--sub-size', `${size}%`);
    subPreviewCard.style.setProperty('--sub-bottom', `${Math.max(6, Math.min(94, pos))}%`);
    subPreviewCard.style.setProperty('--sub-color', settings.get('subtitleColor') || '#ffffff');
    subPreviewCard.style.setProperty('--sub-bg', settings.get('subtitleBg') || '#000000');
    subPreviewCard.style.setProperty('--sub-alpha', String(bgOpacity));
  }
  paintSubtitlePreview();

  const subtitlesBody = h(
    'div.sub-settings',
    {},
    h('div.sub-control-row', {}, h('label.sub-label', {}, t('Subtitle language')), subtitleLang),
    h('div.sub-control-row', {}, subSize, subPosition),
    h('div.sub-color-row', {}, subtitleColor('subtitleColor', 'Text colour'), subtitleColor('subtitleBg', 'Background colour')),
    subOpacity,
    subPreview,
    h('p.faint.cloud-note', {}, t('The preview updates immediately. A stream supplies its own caption tracks; this device applies the appearance where the player exposes styled captions.')),
  );

  const titleAlignSeg = h(
    'div.seg',
    { role: 'group', 'aria-label': t('Title position') },
    ...[['start', t('Start')], ['center', t('Centre')]].map(([value, label]) =>
      h(`button${settings.get('titleAlign') === value ? '.is-active' : ''}`, {
        type: 'button',
        'aria-pressed': String(settings.get('titleAlign') === value),
        onclick: (e) => {
          settings.set('titleAlign', value);
          [...e.currentTarget.parentElement.children].forEach((b) => {
            b.classList.remove('is-active');
            b.setAttribute('aria-pressed', 'false');
          });
          e.currentTarget.classList.add('is-active');
          e.currentTarget.setAttribute('aria-pressed', 'true');
        },
      }, label),
    ),
  );

  const statusBody = h('div');
  function paintStatus() {
    const api = apiStatus();
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    statusBody.replaceChildren(
      rowOf({
        iconName: online ? 'globe' : 'offline',
        label: 'Connection',
        hint: online ? t('This browser is online.') : t('This browser is offline; saved pages and local data still work.'),
        control: h('span.badge', {}, online ? t('Online') : t('Offline')),
      }),
      rowOf({
        iconName: api.tone === 'live' ? 'globe' : 'offline',
        label: 'Catalogue',
        hint: t(api.hint),
        control: h('span.badge', {}, t(api.label)),
      }),
      rowOf({
        iconName: 'swap',
        label: 'Cloud sync',
        hint: cloudActive() ? t('Connected to the central account service.') : t('Local only. No cloud account is active in this browser.'),
        control: h('span.badge', {}, cloudActive() ? t('Connected') : t('Local')),
      }),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } },
        h('button.btn.btn--sm', { onclick: async (e) => {
          const b = e.currentTarget;
          b.disabled = true;
          await checkNow();
          b.disabled = false;
          paintStatus();
        } }, icon('refresh'), t('Check now')),
      ),
    );
  }
  paintStatus();

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('SETTINGS')),
      h('h1.display', {}, t('Preferences')),
      h('p', {}, t('Everything is stored on this device. A cloud account is optional and only starts when you connect one below.')),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Account')),
      accountBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Interface')),
      rowOf({ iconName: 'globe', label: 'Language', hint: t('Interface text and reading direction. Titles keep their original names.'), control: langSeg }),
      rowOf({ iconName: 'palette', label: 'Accent colour', hint: t('Applies to buttons, highlights and the player'), control: swatches }),
      rowOf({ iconName: 'monitor', label: 'Dim hero artwork', hint: t('Skip the blurred banner behind detail pages'), control: toggle('reduceBackdrop', 'Dim hero artwork') }),
      rowOf({ iconName: 'eye', label: 'Blur watched episodes', hint: t('Dim an episode thumbnail once it is behind your current progress.'), control: toggle('blurWatched', 'Blur watched episodes') }),
      rowOf({ iconName: 'sliders', label: 'Title position', hint: t('Where the spotlight title sits over the artwork.'), control: titleAlignSeg }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Subtitles')),
      subtitlesBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Audio')),
      rowOf({ iconName: 'mic', label: 'Default audio', hint: t('Applies when you open a new episode'), control: audioSeg }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Playback')),
      rowOf({ iconName: 'next', label: 'Auto-play next episode', hint: t('The player rolls on to the next episode by itself'), control: toggle('autoplay', 'Auto-play next episode') }),
      rowOf({ iconName: 'sliders', label: 'Streaming quality', hint: t('What the player aims for. The source decides what actually plays.'), control: qualitySeg }),
      rowOf({ iconName: 'volume', label: 'Sound effects', hint: t('A chime on a choice, a sweep on a page, a tap on a control'), control: toggle('uiSound', 'Sound effects') }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Server status')),
      statusBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Streaming servers')),
      serversBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Direct media links')),
      directMediaBody,
      h('div.set-row', {},
        h('div.ico', {}, icon('list')),
        h('div.txt', {},
          h('b', {}, t('Bulk import (JSON)')),
          h('span', {}, t('Paste an object {id:{episode:url}} or an array [{id,episode,url}]. Validates every entry; invalid ones are skipped.')),
        ),
      ),
      (() => {
        const ta = h('textarea.input', { rows: '6', spellcheck: 'false', placeholder: '{ "16498": { "1": "https://cdn.example.com/ep1.m3u8" } }', 'aria-label': t('Bulk import JSON') });
        const btn = h('button.btn.btn--sm.btn--primary', {
          onclick: () => {
            const res = importDirectMediaBulk(ta.value);
            if (res.errors.length && !res.added) {
              toast(res.errors[0], { tone: 'err', iconName: 'alert' }); return;
            }
            const msg = res.added + ' link(s) imported' + (res.skipped ? ', ' + res.skipped + ' skipped' : '');
            toast(msg, { tone: res.added ? 'ok' : 'warn', iconName: res.added ? 'check' : 'alert' });
            if (res.errors.length) console.warn('Bulk import skipped:', res.errors);
            ta.value = '';
            paintDirectMedia();
          },
        }, icon('plus'), t('Import'));
        return h('div', { style: { padding: '8px 0' } }, ta, h('div.rowline', { style: { gap: '8px', marginTop: '8px' } }, btn));
      })(),
    ),

    /* Posting a status needs server.js: the address is a credential and the
       request is sent from there, not from the page. A static copy has no way
       to make it work, so the card is left out. */
    ...(staticHost()
      ? []
      : [h('section.set-group', {},
          h('h3', {}, t('Discord')),
          discordBody,
        )]),

    h('section.set-group', {},
      h('h3', {}, t('Stremio-style add-ons')),
      stremioBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Footer links')),
      footerBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Content')),
      rowOf({ iconName: 'eye', label: 'Show mature titles', hint: t('R+ 17+ entries stay hidden until enabled'), control: toggle('showNsfw', 'Show mature titles') }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Your data')),
      dataBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('Cloud sync')),
      cloudBody,
    ),

    h('section.set-group', {},
      h('h3', {}, t('About')),
      h('div.set-row', {},
        h('div.ico', {}, logoMark(38)),
        h('div.txt', {},
          h('b', {}, 'Solvn'),
          h('span', {}, t('Titles, artwork and episode lists come from a public anime catalogue. Episodes are played from third-party sources: Solvn hosts no video and stores nothing on its own servers.')),
        ),
      ),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '16px 0' } },
        h('button.btn.btn--sm', { onclick: () => toast(t('Press / anywhere to jump to search'), { iconName: 'info' }) }, icon('info'), t('Shortcuts')),
      ),
    ),
  );

  return wrap;
}
