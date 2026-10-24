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
import { account, adminUsers, adminPatchUser, adminReports, adminPatchReport, adminComments, removeComment } from '../lib/account.js';
import { BADGES, rankOf } from '../lib/ranks.js';
import { statsLocked, setStatsLock } from '../lib/store.js';
import { avatar, say, statTile } from '../components/account.js';
import { emptyState, errorState } from '../components/media.js';
import { intlDate, relativeTime } from '../lib/util.js';

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

/* ---- the page ------------------------------------------------------------ */
export async function AdminView() {
  const wrap = h('div.page-admin');
  const me = account().user;

  if (!me?.isAdmin) {
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
    h('p', {}, t('Every number here is the server copy. Preview a badge on your own row and hold this device from overwriting it.')),
  );

  const totals = h('div.metric-grid');
  const hold = h('div.ad-hold');
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

  let data = null;

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
  }

  wrap.append(head, totals, hold, roster, reportBox, commentBox);
  paintHold();
  await fill();
  return wrap;
}
