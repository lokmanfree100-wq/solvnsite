/** Settings: appearance, playback, content and local data controls. */

import { h, icon } from '../lib/dom.js';
import { settings, onSettings, ACCENTS, ACCENT_LABELS, CUSTOM_ACCENT, QUALITIES, qualityLabel, clearAll, continueWatching, totalListCount, recentSearches, clearQueries } from '../lib/store.js';
import { accentId, accentValue, paintAccent, previewAccent } from '../lib/accent.js';
import { parseHex, toHex } from '../lib/color.js';
import { clearCache, apiStatus, checkNow } from '../lib/anilist.js';
import { isSignedIn, tellDiscord, staticHost } from '../lib/account.js';
import { FAILOVER_CHOICES, MAIN_SERVER, TEMPLATE_HINT, TRACKS, addServer, asTrack, extraServers, removeServer, serverName, serverTracks, tracksOffered, trackChip, trackName } from '../lib/sources.js';
import { toast, confirmSheet } from '../lib/ui.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { cloudConfig, cloudActive, clearCloudConfig, testCloudConnection } from '../lib/cloud.js';
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
        h('p.faint.cloud-note', {}, t('Anyone holding this address can post in that channel, so it is kept in this browser and sent only to this Solvn server.')),
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
  /* Optional and strictly additive: without a verified project every account
     call still goes to server.js, and nothing here runs. */
  const cloudBody = h('div');

  function paintCloud() {
    const cfg = cloudConfig();
    const live = Boolean(cloudActive());
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
      h('p.faint.cloud-note', {}, t('Run the SQL in docs/supabase.sql in the project first, then test. Your local hours upload on the first sign-in.')),
    );
  }
  paintCloud();

  /* ---- streaming servers ------------------------------------------------ */
  /* Solvn hosts no video, so a server here is another player page that the
     watch frame loads *inside* Solvn. The built-in one always goes first;
     anything added below joins the same failover ladder, in this order. */
  const serversBody = h('div');
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
      h(
        'div.set-row',
        {},
        h('div.ico', {}, icon('cast')),
        h('div.txt', {}, h('b', {}, t('Solvn Stream')), h('span', {}, t('Always tried first. Part of Solvn.'))),
        h('span.badge', {}, icon('check'), t('Built in')),
        h('span.badge', {}, trackMarks(MAIN_SERVER)),
      ),
      ...extra.map((s) =>
        h(
          'div.set-row',
          {},
          h('div.ico', {}, icon('cast')),
          h('div.txt', {}, h('b', {}, serverName(s)), h('span', {}, hostOf(s.url))),
          h('span.badge', {}, trackMarks(s)),
          h(
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
      h('p.faint.cloud-note', {}, t('Those languages are what the player switcher, the badges on the cards and the failover ladder will offer. Solvn cannot read from the catalogue which titles were re-voiced — it asks its servers instead, and never promises a track they have not declared.')),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } }, add),
      h(
        'div.rowline.wrap',
        { style: { gap: '12px', padding: '20px 0 0', alignItems: 'center' } },
        h('span.faint', {}, t('Switch servers after')),
        failoverSeg,
      ),
      h('p.faint.cloud-note', {}, t('How long the player waits for a server to show its page before moving to the next one. Three seconds gives up fastest, which suits a quick connection; fifteen is for a slow line where a player page simply takes its time to arrive.')),
      h('p.faint.cloud-note', {}, t('Put {anilist}, {episode}, {audio}, {next} or {accent} in the address where the player expects them. Only https works, and the page stays inside Solvn: a server can never move you somewhere else.')),
    );
  }
  paintServers();

  wrap.append(
    h('header.page-head', {},
      h('div.eyebrow', {}, t('SETTINGS')),
      h('h1.display', {}, t('Preferences')),
      h('p', {}, t('Everything is stored on this device. A cloud account is optional and only starts when you connect one below.')),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Appearance')),
      rowOf({ iconName: 'globe', label: 'Language', hint: t('Interface text and reading direction. Titles keep their original names.'), control: langSeg }),
      rowOf({ iconName: 'palette', label: 'Accent colour', hint: t('Applies to buttons, highlights and the player'), control: swatches }),
      rowOf({ iconName: 'monitor', label: 'Dim hero artwork', hint: t('Skip the blurred banner behind detail pages'), control: toggle('reduceBackdrop', 'Dim hero artwork') }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Playback')),
      rowOf({ iconName: 'mic', label: 'Default audio', hint: t('Applies when you open a new episode'), control: audioSeg }),
      rowOf({ iconName: 'next', label: 'Auto-play next episode', hint: t('The player rolls on to the next episode by itself'), control: toggle('autoplay', 'Auto-play next episode') }),
      rowOf({ iconName: 'sliders', label: 'Streaming quality', hint: t('What the player aims for. The source decides what actually plays.'), control: qualitySeg }),
      rowOf({ iconName: 'volume', label: 'Sound effects', hint: t('A chime on a choice, a sweep on a page, a tap on a control'), control: toggle('uiSound', 'Sound effects') }),
    ),

    h('section.set-group', {},
      h('h3', {}, t('Streaming servers')),
      serversBody,
    ),

    /* Posting a status needs server.js: the address is a credential and the
       request is sent from there, not from the page. A static copy has no way
       to make it work, so the card is left out. */
    staticHost()
      ? null
      : h('section.set-group', {},
          h('h3', {}, t('Discord')),
          discordBody,
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
