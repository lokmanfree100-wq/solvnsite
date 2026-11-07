/**
 * Admin — the one page that is not for everybody.
 *
 * The server decides who is an admin by name (ADMIN_NAMES in account-api.js)
 * and repeats that verdict on every request; this file only draws the controls
 * that verdict unlocks. Hiding the menu item is courtesy, not security.
 */

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sheet, toast } from '../lib/ui.js';
import { account, isStaff, adminUsers, adminAnalytics, adminPatchUser, adminReports, adminPatchReport, adminComments, removeComment, adminGift } from '../lib/account.js';
import { cloudConfig, cloudActive, cloudApi, cloudDirectLogin, cloudSignOut } from '../lib/cloud.js';
import { BADGES, rankOf } from '../lib/ranks.js';
import { statsLocked, setStatsLock } from '../lib/store.js';
import { avatar, say, statTile } from '../components/account.js';
import { emptyState, errorState } from '../components/media.js';
import { intlDate, relativeTime } from '../lib/util.js';
import { presence, activity } from '../lib/presence.js';
import { gachaCard } from '../components/gacha.js';
import { draft, setDraft, clearDraft, previewOn, setPreview, draftProblems, publishText, publishedSlot, loadSponsor } from '../lib/sponsor.js';

const badgeNode = (b) =>
  h('span.badge', { title: `${t(b.label)} — ${t(b.hint)}` }, icon(b.icon), h('span.badge-name', {}, t(b.label)));

/* One decimal on hours, whole numbers everywhere else — the same rules the
   server uses, so a saved row never comes back as "out of range". */
const hoursOf = (v) => Math.max(0, Math.round(Number(v) * 10) / 10) || 0;
const wholeOf = (v) => Math.max(0, Math.round(Number(v) || 0));

const numberField = (label, step, value) =>
  h('label.ad-field', {}, h('span', {}, label), h('input.input.tnum', { type: 'number', min: '0', step, value: String(value) }));

/* ---- badges: switch them by hand to see the row light up ---------------- */
function badgeSheet(user, onSaved) {
  let dismiss = () => {};
  const chosen = new Set(user.badges || []);
  const preview = h('div.badge-row', { 'aria-label': t('Badges') });
  const paintPreview = () => preview.replaceChildren(...BADGES.filter((b) => chosen.has(b.id)).map(badgeNode));

  const chips = h(
    'div.badge-pick',
    { role: 'group', 'aria-label': t('Badges') },
    ...BADGES.map((b) =>
      h(
        `button.badge-chip${chosen.has(b.id) ? '.is-on' : ''}`,
        {
          type: 'button',
          'aria-pressed': String(chosen.has(b.id)),
          title: t(b.hint),
          onclick: (e) => {
            if (chosen.has(b.id)) chosen.delete(b.id);
            else chosen.add(b.id);
            e.currentTarget.classList.toggle('is-on', chosen.has(b.id));
            e.currentTarget.setAttribute('aria-pressed', String(chosen.has(b.id)));
            paintPreview();
          },
        },
        icon(b.icon),
        h('span', {}, t(b.label)),
      ),
    ),
  );

  const save = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: async () => {
        save.disabled = true;
        try {
          await adminPatchUser(user.id, { badges: [...chosen] });
          dismiss();
          toast(t('Badges saved.'), { tone: 'ok', iconName: 'check' });
          onSaved?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
        } finally {
          save.disabled = false;
        }
      },
    },
    t('Save'),
  );

  sheet({
    heading: `${t('Badges')} — ${user.username}`,
    sub: t('Switch one on to preview it on the profile.'),
    width: 520,
    render: (api) => {
      dismiss = api.close;
      return h('div.stack', {}, preview, chips, h('div.auth-foot', {}, save));
    },
  });
  paintPreview();
}

/* ---- the Card Studio ------------------------------------------------------
   The admin's workbench: name a recipient, draw a plate or pack a bundle, and
   the gift lands in their mailbox. Every field here matches the limits the
   backend enforces — the sheet refuses nothing the server would accept, and the
   server refuses nothing the sheet lets through. */
const STUDIO_SHAPES = ['portrait', 'rounded', 'hex', 'blade', 'ticket', 'capsule'];
const STUDIO_ANIMATIONS = ['none', 'pulse', 'float', 'drift', 'shine', 'flicker', 'aura', 'orbit'];

function studioSheet(members, onSent) {
  let dismiss = () => {};
  let portrait = null;

  const state = {
    to: members[0]?.id || '',
    name: '',
    lv: 15,
    power: 620,
    speed: 200,
    technique: 200,
    aura: 200,
    overall: 1220,
    shape: 'portrait',
    animation: 'shine',
    a: '#2f9cff',
    b: '#0a1f6b',
    glow: '#2f9cff',
    mediaTitle: 'Solvn Studio',
    packs: 5,
    note: '',
    withCard: true,
    withBundle: false,
  };

  const numOf = (v, fallback, max) => Math.max(0, Math.min(max, Math.round(Number(v) || fallback)));

  const preview = h('div.st-preview');

  const cardOf = () => ({
    name: state.name,
    lv: numOf(state.lv, 15, 16),
    shape: state.shape,
    animation: state.animation,
    a: state.a, b: state.b, glow: state.glow,
    image: portrait,
    mediaTitle: state.mediaTitle,
    stats: {
      power: numOf(state.power, 0, 99999),
      speed: numOf(state.speed, 0, 999),
      technique: numOf(state.technique, 0, 999),
      aura: numOf(state.aura, 0, 999),
      overall: numOf(state.overall, 0, 99999),
    },
    custom: true,
  });

  function paintPreview() {
    if (!state.withCard) {
      preview.replaceChildren(h('p.muted', {}, t('No card in this gift.')));
      return;
    }
    preview.replaceChildren(
      gachaCard({ ...cardOf(), serial: 'STUDIO' }, { variant: 'full', eager: true }),
    );
  }

  const field = (label, control, wide = false) =>
    h(`label.st-field${wide ? '.is-wide' : ''}`, {}, h('span', {}, label), control);

  const input = (value, oninput, attrs = {}) =>
    h('input.input', { type: 'text', value: String(value ?? ''), oninput: (e) => oninput(e.target.value), ...attrs });

  const num = (value, oninput, max, min = 0) =>
    h('input.input.tnum', {
      type: 'number', min: String(min), max: String(max), value: String(value ?? 0),
      oninput: (e) => oninput(e.target.value),
    });

  const select = (options, value, onchange) =>
    h(
      'select.input',
      { value: String(value), onchange: (e) => onchange(e.target.value) },
      ...options.map((o) => h('option', { value: o.value ?? o }, t(o.label ?? o))),
    );

  const colorInput = (value, oninput) =>
    h('div.st-color', {}, h('input', { type: 'color', value, oninput: (e) => oninput(e.target.value) }), h('code.tnum', {}, String(value).toUpperCase()));

  const picDrop = h(
    'div.st-pic-drop',
    { role: 'button', tabindex: '0', 'aria-label': t('Choose a portrait') },
    icon('user'),
    h('span', {}, t('Choose a portrait image — PNG, JPEG, WebP, GIF or AVIF, up to 120 KB')),
  );
  const pickFile = () => {
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif' });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > 120 * 1024) {
        toast(t('That picture is too large. Pick a smaller file.'), { tone: 'err', iconName: 'alert' });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        portrait = String(reader.result || '');
        picDrop.classList.add('has-art');
        picDrop.lastChild.textContent = t('Portrait chosen. Pick another to replace it.');
        paintPreview();
      };
      reader.readAsDataURL(f);
    });
    file.click();
  };
  picDrop.addEventListener('click', pickFile);
  picDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickFile();
    }
  });

  const cardBox = h('div.st-grid');
  const bundleBox = h('div.st-grid');

  function paintBoxes() {
    cardBox.hidden = !state.withCard;
    bundleBox.hidden = !state.withBundle;
  }

  const toggle = (label, key) =>
    h(
      'label.vis',
      {},
      h('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; paintBoxes(); paintPreview(); } }),
      h('span', {}, label),
    );

  function paintFields() {
    cardBox.replaceChildren(
      field(t('Card name'), input(state.name, (v) => { state.name = v; paintPreview(); }, { maxlength: '40' }), true),
      field(t('Level (1–16)'), num(state.lv, (v) => { state.lv = v; paintPreview(); }, 16, 1)),
      field(t('Power (0–99999)'), num(state.power, (v) => { state.power = v; paintPreview(); }, 99999)),
      field(t('Speed (0–999)'), num(state.speed, (v) => { state.speed = v; paintPreview(); }, 999)),
      field(t('Technique (0–999)'), num(state.technique, (v) => { state.technique = v; paintPreview(); }, 999)),
      field(t('Aura (0–999)'), num(state.aura, (v) => { state.aura = v; paintPreview(); }, 999)),
      field(t('Overall (0–99999)'), num(state.overall, (v) => { state.overall = v; paintPreview(); }, 99999)),
      field(t('Shape'), select(STUDIO_SHAPES, state.shape, (v) => { state.shape = v; })),
      field(t('Animation'), select(STUDIO_ANIMATIONS, state.animation, (v) => { state.animation = v; })),
      field(t('Frame colour'), colorInput(state.a, (v) => { state.a = v; paintPreview(); })),
      field(t('Frame shade'), colorInput(state.b, (v) => { state.b = v; paintPreview(); })),
      field(t('Glow'), colorInput(state.glow, (v) => { state.glow = v; paintPreview(); })),
      field(t('Plate title'), input(state.mediaTitle, (v) => { state.mediaTitle = v; paintPreview(); }, { maxlength: '60' }), true),
      field(t('Portrait'), picDrop, true),
    );
    bundleBox.replaceChildren(
      field(t('Packs (0–50)'), num(state.packs, (v) => { state.packs = v; }, 50)),
    );
  }

  const note = h('textarea.input', {
    rows: '3',
    maxlength: '180',
    placeholder: t('A note that arrives with the gift (up to 180 characters)'),
    oninput: (e) => { state.note = e.target.value; },
  });

  const send = h(
    'button.btn.btn--primary',
    {
      type: 'button',
      onclick: async () => {
        if (!state.to) {
          toast(t('Pick a member to send this to. Reload the list and try again.'), { tone: 'err', iconName: 'alert' });
          return;
        }
        if (!state.withCard && !state.withBundle) {
          toast(t('A gift needs a card, a bundle or both.'), { tone: 'err', iconName: 'alert' });
          return;
        }
        const card = state.withCard ? cardOf() : null;
        const bundle = state.withBundle
          ? { packs: numOf(state.packs, 0, 50) }
          : null;
        if (state.withCard && !state.name.trim()) {
          toast(t('A gift card needs a name and a portrait.'), { tone: 'err', iconName: 'alert' });
          return;
        }
        if (state.withBundle && !bundle.packs) {
          toast(t('A bundle needs at least one pack.'), { tone: 'err', iconName: 'alert' });
          return;
        }
        send.disabled = true;
        try {
          await adminGift({ to: state.to, card, bundle, note: state.note.trim() });
          toast(t('Sent to the mailbox.'), { tone: 'ok', iconName: 'gift' });
          dismiss();
          onSent?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
          send.disabled = false;
        }
      },
    },
    icon('gift'),
    h('span', {}, t('Send gift')),
  );

  sheet({
    heading: t('Card Studio'),
    sub: t('Draw a card or pack a bundle and send it to one member\'s mailbox.'),
    width: 640,
    render: (api) => {
      dismiss = api.close;
      return h(
        'div.st-sheet',
        {},
        field(
          t('Send to'),
          h(
            'select.input',
            { value: state.to, onchange: (e) => { state.to = e.target.value; } },
            ...members.map((m) => h('option', { value: m.id }, `${m.displayName || m.username}${m.id === account().user?.id ? ` (${t('you')})` : ''}`)),
          ),
          true,
        ),
        h('div.st-grid', {},
          toggle(t('Send a card'), 'withCard'),
          toggle(t('Send a bundle'), 'withBundle'),
        ),
        cardBox,
        bundleBox,
        field(t('Note'), note, true),
        h('p.st-note', {}, t('The card joins the receiver\'s binder when they claim it. A bundle hands over its packs the same way.')),
        preview,
        h('div.auth-foot', {}, h('button.btn.btn--ghost', { type: 'button', onclick: () => dismiss() }, t('Cancel')), send),
      );
    },
  });
  paintBoxes();
  paintFields();
  paintPreview();
}

/* ---- one member row ------------------------------------------------------ */
function memberRow(member, isMe, onSaved) {
  const hours = numberField(t('Hours'), '0.1', member.stats.hours);
  const episodes = numberField(t('Episodes'), '1', member.stats.episodes);
  const completed = numberField(t('Completed'), '1', member.stats.completed);
  const titles = numberField(t('Titles'), '1', member.stats.titles);

  const save = h(
    'button.btn.btn--sm',
    {
      type: 'button',
      onclick: async () => {
        save.disabled = true;
        try {
          await adminPatchUser(member.id, {
            hours: hoursOf(hours.querySelector('input').value),
            episodes: wholeOf(episodes.querySelector('input').value),
            completed: wholeOf(completed.querySelector('input').value),
            titles: wholeOf(titles.querySelector('input').value),
          });
          toast(t('Numbers saved.'), { tone: 'ok', iconName: 'check' });
          onSaved?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
        } finally {
          save.disabled = false;
        }
      },
    },
    icon('check'),
    h('span', {}, t('Save')),
  );

  const rank = rankOf(member.stats.hours);

  /* Muting lives on the account, so it survives the thread they posted in. */
  const muted = Boolean(member.muted);
  const muteBtn = h(
    'button.btn.btn--sm',
    {
      type: 'button',
      'aria-pressed': String(muted),
      style: muted ? { color: 'var(--danger)' } : null,
      title: t('Stops this member from posting episode comments.'),
      onclick: async () => {
        muteBtn.disabled = true;
        try {
          await adminPatchUser(member.id, { muted: !muted });
          toast(muted ? t('Unmuted.') : t('Muted.'), { tone: muted ? 'ok' : '', iconName: muted ? 'check' : 'lock' });
          onSaved?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
          muteBtn.disabled = false;
        }
      },
    },
    icon(muted ? 'lock' : 'mic'),
    h('span', {}, muted ? t('Unmute') : t('Mute')),
  );

  return h(
    'div.ad-row.glass',
    {},
    h(
      'div.ad-who',
      {},
      avatar(member, { size: 'sm' }),
      h('a.ad-name', { href: `#/profile/${encodeURIComponent(member.id)}` }, member.username),
      h('span.ad-rank', {}, t(rank.label)),
      isMe ? h('span.ad-tag', {}, t('you')) : null,
    ),
    h('div.ad-fields', {}, hours, episodes, completed, titles),
    h(
      'div.ad-acts',
      {},
      h(
        'button.btn.btn--sm',
        { type: 'button', onclick: () => badgeSheet(member, onSaved) },
        icon('trophy'),
        h('span', {}, `${t('Badges')} ${String(member.badges?.length || 0)}`),
      ),
      isMe ? null : muteBtn,
      save,
    ),
    h(
      'p.ad-meta.faint',
      {},
      t('{n} playlists', { n: member.playlists || 0 }),
      member.visits != null ? ` · ${t('{n} visits', { n: member.visits })}` : '',
      member.online ? ` · ${t('online now')}` : member.lastSeen ? ` · ${t('seen {when}', { when: relativeTime(member.lastSeen) })}` : '',
      ' · ',
      intlDate(member.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }),
    ),
  );
}

/* ---- reports ------------------------------------------------------------- */
function reportRow(rec, onDone) {
  const act = (status, label, iconName) =>
    h(
      'button.btn.btn--sm',
      {
        type: 'button',
        onclick: async () => {
          try {
            await adminPatchReport(rec.id, status);
            toast(t('Report updated.'), { tone: 'ok', iconName: 'check' });
            onDone?.();
          } catch (err) {
            toast(say(err), { tone: 'err', iconName: 'alert' });
          }
        },
      },
      icon(iconName),
      h('span', {}, label),
    );

  return h(
    'div.rp-row',
    {},
    h(
      'div.rp-head',
      {},
      h('b.rp-target', {}, rec.targetName || t('Untitled')),
      h(
        `span.rp-state.is-${rec.status}`,
        {},
        rec.status === 'resolved' ? t('Resolved') : rec.status === 'dismissed' ? t('Dismissed') : t('Open'),
      ),
    ),
    h('p.rp-why', {}, rec.reason),
    h(
      'p.rp-meta.faint',
      {},
      rec.kind === 'user' ? t('a member') : t('a playlist'),
      ' · ',
      t('by {name}', { name: rec.reporter }),
      ' · ',
      intlDate(rec.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      rec.targetOwner ? ` · ${rec.targetOwner}` : '',
    ),
    rec.status === 'open'
      ? h('div.rp-acts', {}, act('resolved', t('Mark resolved'), 'check'), act('dismissed', t('Dismiss'), 'x'))
      : null,
  );
}

/* ---- comments ---------------------------------------------------------- */
function commentRow(c, onDone) {
  const del = h(
    'button.btn.btn--sm',
    {
      type: 'button',
      onclick: async () => {
        del.disabled = true;
        try {
          await removeComment(c.id);
          toast(t('Removed.'), { tone: 'ok', iconName: 'check' });
          onDone?.();
        } catch (err) {
          toast(say(err), { tone: 'err', iconName: 'alert' });
          del.disabled = false;
        }
      },
    },
    icon('trash'),
    h('span', {}, t('Delete')),
  );

  return h(
    'div.cm-row',
    {},
    h(
      'div.cm-head',
      {},
      avatar(c.author || {}, { size: 'sm' }),
      c.author?.id
        ? h('a.cm-name', { href: `#/profile/${encodeURIComponent(c.author.id)}` }, c.author.username)
        : h('span.cm-name', {}, c.author?.username || t('Guest')),
      h('span.cm-when.faint.tnum', {}, relativeTime(c.at)),
      h('a.cm-thread', { href: `#/watch/${c.media}/${c.ep}` }, icon('play'), h('span', {}, t('Ep {n}', { n: c.ep }))),
    ),
    h('p.cm-text', {}, c.text),
    del,
  );
}

/* ---- the site pulse ------------------------------------------------------
   A folder of files cannot see other browsers, and even the dev server has no
   presence table. So the pulse is built from the heartbeat in `lib/presence.js`
   — the tabs in *this* browser — and the copy above the table says so. The
   roster beside it is the real account list, whichever backend answered. */
const feedIcon = (kind) => (kind === 'join' ? 'user' : kind === 'leave' ? 'offline' : 'eye');
const feedLabel = (kind) => (kind === 'join' ? t('Signed in') : kind === 'leave' ? t('Signed out') : t('Visited'));

function pulseTable(members) {
  const rows = presence();
  const seen = new Map(rows.map((row) => [String(row.id), row]));
  const listed = members.slice();
  const known = new Set(listed.map((u) => String(u.id)));
  for (const row of rows) {
    if (!known.has(String(row.id))) listed.push({ id: row.id, userId: row.userId, username: row.username });
  }
  if (!listed.length) return h('p.muted', {}, t('No one has checked in yet.'));

  return h(
    'div.ad-table',
    { role: 'table', 'aria-label': t('Registered users') },
    h(
      'div.ad-tr.is-head',
      { role: 'row' },
      h('span', { role: 'columnheader' }, t('User ID')),
      h('span', { role: 'columnheader' }, t('Handle')),
      h('span', { role: 'columnheader' }, t('Status')),
      h('span', { role: 'columnheader' }, t('Last seen')),
      h('span', { role: 'columnheader' }, t('Page')),
    ),
    ...listed.map((u) => {
      const row = seen.get(String(u.id));
      return h(
        'div.ad-tr',
        { role: 'row' },
        h('span.ad-id.tnum', { role: 'cell' }, u.userId ? `#${u.userId}` : '—'),
        h('span.ad-handle', { role: 'cell' }, u.username ? `@${u.username}` : '—'),
        h(
          `span.ad-state${row?.online ? '.is-on' : ''}`,
          { role: 'cell' },
          h('i'),
          row?.online ? t('Online') : t('Offline'),
        ),
        h('span.ad-when.tnum', { role: 'cell' }, row ? relativeTime(row.at) : '—'),
        h('span.ad-page', { role: 'cell', title: row?.path || '' }, row?.path || '—'),
      );
    }),
  );
}

function pulseFeed() {
  const rows = activity(24);
  if (!rows.length) return h('p.muted', {}, t('Nothing has happened here yet.'));
  return h(
    'div.ad-feed',
    { role: 'list', 'aria-label': t('Recent activity') },
    ...rows.map((row) =>
      h(
        'div.ad-event',
        { role: 'listitem' },
        h('span.ad-event-ico', {}, icon(feedIcon(row.kind))),
        h(
          'div.ad-event-body',
          {},
          h('p.ad-event-head', {}, h('b', {}, row.displayName || row.username || t('Guest')), ' ', feedLabel(row.kind)),
          h('p.ad-event-meta.faint', {}, row.text ? `${row.text} · ` : '', relativeTime(row.at)),
        ),
      ),
    ),
  );
}

/* ---- central cloud ---------------------------------------------------- */
/* One Supabase project holds every account, binder and pack. This panel is
   the Super Admin's window into it: owner sign-in, then the full roster.
   The server-side RPC is the actual gate — it only answers the owner. */
function centralPanel() {
  const box = h('section.ad-central.glass');
  const cfg = cloudConfig();

  function paint() {
    if (!cfg) {
      box.replaceChildren(
        h('h2.panel-title', {}, icon('globe'), t('Central cloud')),
        h('p.muted', {}, t('No central cloud is configured — accounts and cards live on this device. On solvn.site the central database is built in.')),
      );
      return;
    }

    if (!cloudActive()) {
      const emailIn = h('input.input', { type: 'email', placeholder: t('Admin email'), autocomplete: 'email' });
      const passIn = h('input.input', { type: 'password', placeholder: t('Password'), autocomplete: 'current-password' });
      const connect = h(
        'button.btn.btn--sm.btn--primary',
        {
          onclick: async () => {
            if (!emailIn.value.trim() || !passIn.value) {
              toast(t('Enter the owner email and password.'), { tone: 'err', iconName: 'alert' });
              return;
            }
            connect.disabled = true;
            connect.classList.add('is-busy');
            connect.setAttribute('aria-busy', 'true');
            try {
              await cloudDirectLogin(emailIn.value.trim(), passIn.value);
              toast(t('Connected to the central cloud.'), { tone: 'ok', iconName: 'check' });
              paint();
            } catch (err) {
              toast(say(err), { tone: 'err', iconName: 'alert' });
            } finally {
              connect.disabled = false;
              connect.classList.remove('is-busy');
              connect.removeAttribute('aria-busy');
            }
          },
        },
        icon('globe'),
        t('Connect'),
      );
      box.replaceChildren(
        h('h2.panel-title', {}, icon('globe'), t('Central cloud')),
        h('p.muted', {}, t('Sign in as the owner to see every member, binder and pack in the one Solvn database.')),
        h('div.cloud-fields', {}, h('label.cloud-field', {}, t('Email'), emailIn), h('label.cloud-field', {}, t('Password'), passIn)),
        h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0 0' } }, connect),
      );
      return;
    }

    const body = h('div');
    const refresh = h('button.btn.btn--sm.btn--primary', { onclick: load }, icon('refresh'), t('Refresh'));
    const signout = h(
      'button.btn.btn--sm',
      {
        onclick: () => {
          cloudSignOut();
          toast(t('Signed out of the central cloud.'), { tone: 'ok', iconName: 'check' });
          paint();
        },
      },
      icon('offline'),
      t('Sign out'),
    );

    const rowOf = (u) =>
      h(
        'div.ad-c-row',
        { role: 'row' },
        h('span.ad-handle', { role: 'cell' }, u.username ? `@${u.username}` : u.displayName || '—'),
        h('span.ad-c-mail', { role: 'cell' }, u.email || '—'),
        h('span.tnum', { role: 'cell' }, String(u.cards)),
        h('span.tnum', { role: 'cell' }, String(u.packs)),
        h('span.ad-c-last.tnum', { role: 'cell' }, u.updatedAt ? intlDate(u.updatedAt) : '—'),
      );

    const head = h(
      'div.ad-c-row.is-head',
      { role: 'row' },
      h('span', { role: 'columnheader' }, t('Member')),
      h('span', { role: 'columnheader' }, t('Email')),
      h('span', { role: 'columnheader' }, t('Cards')),
      h('span', { role: 'columnheader' }, t('Packs')),
      h('span', { role: 'columnheader' }, t('Last sync')),
    );

    async function load() {
      refresh.disabled = true;
      refresh.classList.add('is-busy');
      body.replaceChildren(h('p.muted', {}, t('Loading…')));
      try {
        const res = await cloudApi('admin/core-roster');
        const users = res?.users || [];
        body.replaceChildren(
          head,
          ...(users.length ? users.map(rowOf) : [h('p.muted', {}, t('No members have synced yet.'))]),
        );
      } catch (err) {
        body.replaceChildren(head, h('p.muted', {}, say(err)));
      } finally {
        refresh.disabled = false;
        refresh.classList.remove('is-busy');
      }
    }

    box.replaceChildren(
      h('h2.panel-title', {}, icon('globe'), t('Central cloud')),
      h('div.rowline.wrap', { style: { gap: '8px' } }, refresh, signout),
      body,
    );
    load();
  }

  paint();
  return box;
}

/* ---- the sponsor banner -------------------------------------------------
   Sold by hand, published as a file. This desk cannot write the advert onto the
   site — settings live in the browser they are typed in, so a banner "saved" here
   would be a private page — and there is no storage bucket to upload a picture
   to. What it does instead is compose data/sponsor.json, check it, let the owner
   preview it on their own device, and print the exact text to paste over the file
   on GitHub. The publish step stays a human step on purpose: one person decides
   what their visitors are shown. */

const PROBLEM = {
  empty: () => t('Nothing is filled in yet, so every visitor sees no banner.'),
  'image-https': () => t('The image address has to start with https://'),
  'url-https': () => t('The click address has to start with https://'),
  'no-image': () => t('An advert needs a picture of its own.'),
  'no-url': () => t('An advert needs somewhere to go when it is clicked.'),
  window: () => t('The last day comes before the first day.'),
  'no-advertiser': () => t('Say whose advert it is — the caption under the banner names them.'),
};

function adPanel() {
  const box = h('section.ad-sponsor.glass');

  function paint() {
    const d = draft();
    const pub = publishedSlot();
    const valueAt = (key) => String(key.split('.').reduce((o, k) => (o == null ? '' : o[k]), d) ?? '');
    const txt = (key, label, ph) =>
      h(
        'label.ad-field',
        {},
        h('span', {}, label),
        h('input.input', {
          type: 'text',
          value: valueAt(key),
          placeholder: ph || '',
          spellcheck: 'false',
          autocomplete: 'off',
          dataset: { path: key },
        }),
      );
    const num = (key, label) =>
      h(
        'label.ad-field',
        {},
        h('span', {}, label),
        h('input.input.tnum', { type: 'number', min: '0', step: '1', value: valueAt(key), dataset: { path: key } }),
      );
    const day = (key, label) =>
      h(
        'label.ad-field',
        {},
        h('span', {}, label),
        h('input.input', { type: 'date', value: valueAt(key), dataset: { path: key } }),
      );

    const fields = [
      txt('slot.advertiser', t('Who is advertising'), t('Business name')),
      txt('slot.image', t('Banner image address'), 'https://…/banner.jpg'),
      txt('slot.url', t('Where the click goes'), 'https://…'),
      txt('slot.alt', t('Text for the picture'), t('Describe the banner for a screen reader')),
      day('slot.from', t('First day')),
      day('slot.until', t('Last day')),
      num('pitch.visitorsPerDay', t('Visitors a day to publish')),
      num('pitch.pagesPerVisit', t('Pages per visit')),
      txt('pitch.topCountries', t('Top countries, comma separated'), t('Morocco, Algeria, France')),
      txt('pitch.ratePerMonth', t('Price per month'), t('40')),
      txt('pitch.currency', t('Currency'), t('USD')),
      txt('pitch.contactEmail', t('Contact address shown to advertisers'), 'you@example.com'),
    ];

    const readBack = () => {
      const out = { slot: {}, pitch: {} };
      for (const el of box.querySelectorAll('[data-path]')) {
        const [group, key] = el.dataset.path.split('.');
        out[group][key] = el.value;
      }
      out.pitch.topCountries = String(out.pitch.topCountries || '')
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      return out;
    };

    const save = h(
      'button.btn.btn--sm.btn--primary',
      {
        onclick: () => {
          const obj = readBack();
          const bad = draftProblems(obj);
          setDraft(obj);
          toast(bad.length ? (PROBLEM[bad[0]] || PROBLEM.empty)() : t('Draft saved on this device.'), {
            tone: bad.length ? 'err' : 'ok',
            iconName: bad.length ? 'alert' : 'check',
          });
          paint();
        },
      },
      icon('check'),
      t('Save'),
    );

    const preview = h('label.ad-check', {},
      h('input', { type: 'checkbox', checked: previewOn(), onchange: (e) => { setPreview(e.target.checked); paint(); } }),
      h('span', {}, t('Show the draft at the bottom of my own pages')),
    );

    /* Checked and printed from the fields as they stand once they are on screen,
       so an address pasted in but not yet saved is reported on rather than
       quietly normalised away by the next paint. */
    const src = box.querySelector('[data-path]') ? readBack() : d;
    const problems = draftProblems(src);
    const problemList = h(
      'ul.ad-problems',
      {},
      ...problems.map((code) => h('li', {}, icon('alert'), (PROBLEM[code] || PROBLEM.empty)())),
    );

    const json = publishText(src);
    const code = h('pre.ad-json.tnum', { tabindex: '0' }, json);
    const copyJson = h(
      'button.btn.btn--sm',
      {
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(json);
            toast(t('Copied — paste it over data/sponsor.json'), { tone: 'ok', iconName: 'check' });
          } catch {
            toast(t('Select the text and copy it by hand.'), { tone: 'err', iconName: 'alert' });
          }
        },
      },
      icon('edit'),
      t('Copy the file'),
    );

    const clear = h(
      'button.btn.btn--sm',
      {
        onclick: () => {
          clearDraft();
          toast(t('Draft cleared'), { tone: 'ok', iconName: 'check' });
          paint();
        },
      },
      icon('trash'),
      t('Clear draft'),
    );

    box.replaceChildren(
      h('h2.panel-title', {}, icon('sparkles'), t('Sponsor banner')),
      h(
        'p.muted',
        {},
        pub && pub.slot.image && pub.slot.url
          ? t('Published right now: {who}, until {day}.', { who: pub.slot.advertiser || t('unnamed'), day: pub.slot.until || t('no end date') })
          : t('Nothing is published, so visitors see no banner at all.'),
      ),
      h('div.cloud-fields', {}, ...fields),
      h('div.rowline.wrap', { style: { gap: '8px', padding: '12px 0' } }, save, preview, clear),
      problemList,
      h('p.faint', {}, t('Publishing is three clicks and cannot be undone by the site itself: open the repository on GitHub, edit data/sponsor.json, paste what is below, commit.')),
      h('div.rowline.wrap', { style: { gap: '8px' } }, copyJson),
      code,
    );
  }

  paint();
  /* The published half of the picture arrives with the file, so the desk can
     answer "what is live right now" instead of only "what have I typed". */
  loadSponsor().then(paint);
  return box;
}

/* ---- the page ------------------------------------------------------------ */
export async function AdminView({ onCleanup } = {}) {
  const wrap = h('div.page-admin');
  const me = account().user;

  /* The same key the binder's toolbar turns on, read from the account record.
     A backend that does not ship an `isAdmin` field still gets in on the handle
     alone — and still gets a 403 from every route here if it is not staff. */
  if (!isStaff(me)) {
    wrap.append(
      emptyState({
        iconName: 'lock',
        heading: t('Admins only'),
        body: t('This page is not in the menu, and it does not open for anybody else.'),
        action: h('a.btn.btn--primary', { href: '#/' }, t('Back to home')),
      }),
    );
    return wrap;
  }

  const head = h(
    'header.page-head',
    {},
    h('div.eyebrow', {}, t('ADMIN')),
    h('h1.display', {}, t('God mode')),
    h('p', {}, t('Every number here is the copy this site holds. Preview a badge on your own row and hold this device from overwriting it.')),
  );

  const totals = h('div.metric-grid');
  const analyticsBox = h('section.ad-analytics.glass');
  const centralBox = h('section.ad-central-stats.glass');
  const studio = h('section.ad-studio.glass');
  const pulseBox = h('section.ad-pulse.glass');
  const hold = h('div.ad-hold');
  const central = centralPanel();
  const roster = h('div.ad-roster');
  const reportBox = h('div.ad-reports');
  const commentBox = h('div.ad-comments');

  function paintHold() {
    const on = statsLocked();
    hold.replaceChildren(
      h(
        `button.vis${on ? '.is-on' : ''}`,
        {
          type: 'button',
          'aria-pressed': String(on),
          title: t('Stops this device from uploading its own watch estimate over the numbers you edit here.'),
          onclick: () => {
            setStatsLock(!on);
            paintHold();
          },
        },
        icon(on ? 'lock' : 'ghost'),
        h('span', {}, t('Hold my numbers on this device')),
      ),
    );
  }

  function paintAnalytics(users) {
    const a = users.analytics;
    if (!a) {
      analyticsBox.replaceChildren();
      return;
    }
    const max = Math.max(1, ...(a.days || []).map((d) => Number(d.visits) || 0));
    analyticsBox.replaceChildren(
      h('h2.panel-title', {}, icon('trending'), t('Traffic')),
      h(
        'div.metric-grid',
        {},
        statTile({ iconName: 'eye', value: String(a.visits), label: t('Visits') }),
        statTile({ iconName: 'users', value: String(a.unique), label: t('Unique visitors') }),
        statTile({ iconName: 'clock', value: String(a.today), label: t('Today') }),
        statTile({ iconName: 'globe', value: String(a.browsers), label: t('Browsers now') }),
      ),
      h(
        'div.an-days',
        { role: 'img', 'aria-label': t('Visits over the last 14 days') },
        ...(a.days || []).map((d) =>
          h(
            'div.an-day',
            { title: `${d.day}: ${d.visits}` },
            h('b.tnum', {}, String(d.visits)),
            h('div.an-bar', { style: { height: `${Math.max(3, Math.round((Number(d.visits) / max) * 64))}px` } }),
            h('span.tnum', {}, String(d.day).slice(5)),
          ),
        ),
      ),
      h(
        'p.ad-pulse-note.faint',
        {},
        t('Counted on this device, by this browser, from the visits it has itself seen. The panel below is the one that counts everybody.'),
      ),
    );
  }

  /* ---- the numbers that are not this browser's --------------------------------
     Everything above this line is what one device remembers, and it says so.
     This panel is the real one: page views counted in the central database, and
     the members whose heartbeat is current there. It is the same desk's own
     account that reads it — the answer is built by kitsune_analytics(), which
     refuses in SQL before it selects anything for anybody the database does not
     know as staff, so a visitor holding the publishable key gets nothing.
     What it shows about a person is a handle, a route and a moment. No country,
     no city, no address: nothing here can say where anybody is. */
  async function paintCentral() {
    centralBox.replaceChildren(
      h('h2.panel-title', {}, icon('globe'), t('Real site numbers')),
      h('p.muted', {}, t('Asking the central database…')),
    );
    let a;
    try {
      a = (await adminAnalytics())?.analytics;
    } catch (err) {
      centralBox.replaceChildren(
        h('h2.panel-title', {}, icon('globe'), t('Real site numbers')),
        h('p.muted', {}, say(err)),
        h(
          'p.ad-pulse-note.faint',
          {},
          t('These figures can only come from the central database. Until its tables exist — the SQL file in docs/supabase.sql — no visitor is counted anywhere but this browser, and the Traffic panel above is one device remembering itself.'),
        ),
      );
      return;
    }
    const T = a.totals || {};
    const online = Array.isArray(a.online_list) ? a.online_list : [];
    const recent = Array.isArray(a.recent) ? a.recent : [];
    const pages = Array.isArray(a.pages) ? a.pages : [];
    const days = Array.isArray(a.days) ? a.days : [];
    const max = Math.max(1, ...days.map((d) => Number(d.n) || 0));
    /* The same table the pulse panel uses, with the same four columns: a handle,
       a page, a moment. There is no fifth column because there is nothing to put
       in one — the database holds no place anybody is. */
    const cell = (text, cls) => h(`span${cls ? `.${cls}` : ''}`, { role: 'cell' }, text);
    const personTable = (rows, head) =>
      h(
        'div.ad-table',
        { role: 'table', 'aria-label': head },
        h(
          'div.ad-tr.is-head',
          { role: 'row' },
          h('span', { role: 'columnheader' }, t('Member')),
          h('span', { role: 'columnheader' }, t('Handle')),
          h('span', { role: 'columnheader' }, t('Page')),
          h('span', { role: 'columnheader' }, t('Last seen')),
        ),
        ...rows.map((r) =>
          h(
            'div.ad-tr',
            { role: 'row' },
            cell(r.displayName || r.username || '—'),
            cell(r.username ? `@${r.username}` : '—', 'ad-handle'),
            h('span.ad-page', { role: 'cell', title: r.path || '/' }, r.path || '/'),
            cell(relativeTime(Number(r.at) || 0), 'ad-when tnum'),
          ),
        ),
      );

    centralBox.replaceChildren(
      h('h2.panel-title', {}, icon('globe'), t('Real site numbers')),
      h(
        'div.metric-grid',
        {},
        statTile({ iconName: 'eye', value: String(Number(T.visits) || 0), label: t('Page views') }),
        statTile({ iconName: 'clock', value: String(Number(T.day) || 0), label: t('Last 24 hours') }),
        statTile({ iconName: 'trending', value: String(Number(T.week) || 0), label: t('Last 7 days') }),
        statTile({ iconName: 'globe', value: String(Number(T.month) || 0), label: t('Last 30 days') }),
        statTile({ iconName: 'users', value: String(Number(T.members) || 0), label: t('Members') }),
        statTile({ iconName: 'sparkles', value: String(Number(T.new_week) || 0), label: t('New this week') }),
        statTile({ iconName: 'bolt', value: String(Number(T.online) || 0), label: t('Online now') }),
      ),
      days.length
        ? h(
            'div.an-days',
            { role: 'img', 'aria-label': t('Page views over the last 7 days') },
            ...days.map((d) =>
              h(
                'div.an-day',
                { title: `${d.d}: ${d.n}` },
                h('b.tnum', {}, String(d.n)),
                h('div.an-bar', { style: { height: `${Math.max(3, Math.round((Number(d.n) / max) * 64))}px` } }),
                h('span.tnum', {}, String(d.d)),
              ),
            ),
          )
        : h('p.ad-pulse-note.faint', {}, t('No page view has reached the database yet.')),
      h('h3.ad-sub', {}, icon('bolt'), t('Signed in right now')),
      online.length
        ? personTable(online, t('Signed in right now'))
        : h('p.ad-pulse-note.faint', {}, t('Nobody is signed in on another device at this moment.')),
      h('h3.ad-sub', {}, icon('history'), t('Members, most recent first')),
      recent.length
        ? personTable(recent, t('Members, most recent first'))
        : h('p.ad-pulse-note.faint', {}, t('No member has checked in yet. A stamp appears when somebody signs in and opens a page.')),
      h('h3.ad-sub', {}, icon('eye'), t('Most-opened pages')),
      pages.length
        ? h(
            'div.ad-table',
            { role: 'table', 'aria-label': t('Most-opened pages') },
            h(
              'div.ad-tr.is-head',
              { role: 'row' },
              h('span', { role: 'columnheader' }, t('Page')),
              h('span', { role: 'columnheader' }, t('Views')),
            ),
            ...pages.map((p) =>
              h(
                'div.ad-tr',
                { role: 'row' },
                h('span.ad-page', { role: 'cell', title: p.path || '/' }, p.path || '/'),
                cell(String(Number(p.n) || 0), 'tnum'),
              ),
            ),
          )
        : null,
      h(
        'p.ad-pulse-note.faint',
        {},
        t('A handle, a page and a time — that is all this stores about a person. Nothing here records where anybody is: there is no country, no city and no address in the database, and the count of visits is kept without a name attached to it.'),
      ),
    );
  }

  function paintStudio(users) {
    studio.replaceChildren(
      h('h2.panel-title', {}, icon('sparkles'), t('Card Studio')),
      h(
        'p.ad-pulse-note.faint',
        {},
        t('Draw a card or pack a bundle and send it to one member — it lands in their mailbox.'),
      ),
      h(
        'div.ad-studio-bar',
        {},
        h(
          'button.btn.btn--primary',
          { type: 'button', onclick: () => studioSheet(users.members, fill) },
          icon('gift'),
          h('span', {}, t('Open the studio')),
        ),
      ),
    );
  }

  let data = null;

  function paintPulse() {
    if (!data) return;
    const [users] = data;
    const online = presence().filter((row) => row.online).length;
    pulseBox.replaceChildren(
      h(
        'div.ad-pulse-head',
        {},
        h('h2.panel-title', {}, icon('trending'), t('Site pulse')),
        h('span.ad-live-pill', {}, h('i'), t('{n} online', { n: online })),
      ),
      h(
        'p.ad-pulse-note.faint',
        {},
        t('This browser is the source: each signed-in tab checks in, and a tab idle for five minutes drops off.'),
      ),
      h('h3.ad-sub', {}, icon('users'), t('Registered users')),
      pulseTable(users.members),
      h('h3.ad-sub', {}, icon('history'), t('Recent activity')),
      pulseFeed(),
    );
  }

  async function fill() {
    roster.replaceChildren(h('p.muted', {}, t('Loading…')));
    try {
      data = await Promise.all([adminUsers(), adminReports(), adminComments()]);
    } catch {
      wrap.replaceChildren(head, errorState(null, () => fill(), {
        heading: 'Could not reach Solvn',
        body: 'The admin figures live on this server, and it is not answering.',
      }));
      return;
    }
    paint();
  }

  function paint() {
    const [users, reports, threads] = data;
    totals.replaceChildren(
      statTile({ iconName: 'users', value: String(users.totals.members), label: t('Members') }),
      statTile({ iconName: 'clock', value: String(users.totals.hours), label: t('Hours watched') }),
      statTile({ iconName: 'library', value: String(users.totals.playlists), label: t('Playlists') }),
      statTile({ iconName: 'alert', value: String(users.totals.open), label: t('Open reports') }),
      statTile({ iconName: 'users', value: String(users.totals.comments ?? 0), label: t('Comments') }),
    );

    /* Editing your own row is how a badge gets previewed — but leaving the page
       makes this device upload its own estimate again, so offer the switch that
       stops that push. */
    paintHold();

    paintAnalytics(users);
    paintStudio(users);

    roster.replaceChildren(
      h('h2.panel-title', {}, icon('users'), t('Members')),
      ...(users.members.length
        ? users.members.map((m) => memberRow(m, m.id === me.id, fill))
        : [h('p.muted', {}, t('No members yet.'))]),
    );

    const list = reports.reports || [];
    reportBox.replaceChildren(
      h('h2.panel-title', {}, icon('alert'), t('Reports')),
      ...(list.length
        ? list.map((r) => reportRow(r, fill))
        : [h('p.muted', {}, t('Nothing has been reported yet.'))]),
    );

    const threadList = threads.comments || [];
    commentBox.replaceChildren(
      h('h2.panel-title', {}, icon('caption'), t('Recent comments')),
      ...(threadList.length
        ? threadList.map((c) => commentRow(c, fill))
        : [h('p.muted', {}, t('No one has commented yet.'))]),
    );

    paintPulse();
    paintCentral();
  }

  wrap.append(head, totals, analyticsBox, centralBox, studio, pulseBox, hold, central, roster, adPanel(), reportBox, commentBox);
  paintHold();
  await fill();
  const pulseTimer = setInterval(paintPulse, 15_000);
  onCleanup?.(() => clearInterval(pulseTimer));
  return wrap;
}
