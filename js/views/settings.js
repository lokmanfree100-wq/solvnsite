/** Settings: appearance, playback, content and local data controls. */

import { h, icon, qs } from '../lib/dom.js';
import { settings, ACCENTS, DEFAULT_ACCENT, QUALITIES, qualityLabel, clearAll, continueWatching, totalListCount, recentSearches, clearQueries } from '../lib/store.js';
import { clearCache, apiStatus, checkNow } from '../lib/anilist.js';
import { isSignedIn, tellDiscord, staticHost } from '../lib/account.js';
import { FAILOVER_CHOICES, TEMPLATE_HINT, addServer, extraServers, removeServer, serverName } from '../lib/sources.js';
import { toast, confirmSheet } from '../lib/ui.js';
import { t, lang, setLang, LANGS } from '../lib/i18n.js';
import { cloudConfig, cloudActive, clearCloudConfig, testCloudConnection } from '../lib/cloud.js';
import { renderFooter } from '../components/footer.js';

const rowOf = ({ iconName, label, hint, control }) =>
  h('div.set-row', {},
    h('div.ico', {}, icon(iconName)),
    h('div.txt', {}, h('b', {}, t(label)), hint ? h('span', {}, hint) : null),
    control,
  );

const toggle = (key, label) =>
  h('button.switch', {
    role: 'switch',
    'aria-checked': String(Boolean(settings.get(key))),
    'aria-label': t(label),
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

  const currentAccent = ACCENTS[settings.get('accent')] ? settings.get('accent') : DEFAULT_ACCENT;
  const swatches = h('div.swatches', {}, ...Object.entries(ACCENTS).map(([id, hex]) =>
    h(`button.swatch${id === currentAccent ? '.is-on' : ''}`, {
      style: { background: `#${hex}` },
      'aria-label': `${id} accent`,
      'aria-pressed': String(id === currentAccent),
      onclick: (e) => {
        settings.set('accent', id);
        document.documentElement.dataset.accent = id;
        qs('.swatches', wrap).querySelectorAll('.swatch').forEach((s) => {
          s.classList.remove('is-on');
          s.setAttribute('aria-pressed', 'false');
        });
        e.currentTarget.classList.add('is-on');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        toast(t('Accent updated'), { tone: 'ok', iconName: 'palette' });
      },
    }),
  ));

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

  const audioSeg = h('div.seg', { role: 'group', 'aria-label': t('Default audio') },
    ...['sub', 'dub'].map((v) =>
      h(`button${settings.get('defaultAudio') === v ? '.is-active' : ''}`, {
        onclick: (e) => {
          settings.set('defaultAudio', v);
          [...e.currentTarget.parentElement.children].forEach((b) => b.classList.remove('is-active'));
          e.currentTarget.classList.add('is-active');
        },
      }, v === 'sub' ? t('Subbed') : t('Dubbed')),
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
            document.documentElement.dataset.accent = DEFAULT_ACCENT;
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

    const add = h(
      'button.btn.btn--sm.btn--primary',
      {
        onclick: () => {
          const problem = addServer({ name: nameIn.value, url: urlIn.value });
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
        h('div.txt', {}, h('b', {}, t('Main server')), h('span', {}, t('Always tried first. Part of Solvn.'))),
        h('span.badge', {}, icon('check'), t('Built in')),
      ),
      ...extra.map((s) =>
        h(
          'div.set-row',
          {},
          h('div.ico', {}, icon('cast')),
          h('div.txt', {}, h('b', {}, serverName(s)), h('span', {}, hostOf(s.url))),
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
        h('div.ico', {}, icon('cat')),
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
