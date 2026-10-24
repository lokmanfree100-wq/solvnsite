/** Detail: full metadata, episode browser, cast, relations, recommendations. */

import { h, icon, qs } from '../lib/dom.js';
import { detail, episodes as fetchEpisodes } from '../lib/anilist.js';
import {
  settings,
  getProgress,
  setProgress,
  inList,
  toggleList,
  removeFromLists,
  LISTS,
  isFavourite,
  toggleFavourite,
  pushHistory,
} from '../lib/store.js';
import { title, titleAlt, formatLabel, seasonLabel, statusLabel, listLabel, STATUS_TONE, runtime, plainDescription, countdown, compactNumber, scoreLabel } from '../lib/util.js';
import { mediaCard, mediaRow, emptyState, errorState, stillImage, episodeArt } from '../components/media.js';
import { titleDiscussion } from '../components/discussion.js';
import { addToPlaylistButton } from '../components/playlists.js';
import { sheet, toast } from '../lib/ui.js';
import { buildEpisodes, episodeCountIsGuess, resolveEpisodeCount } from '../lib/embed.js';
import { t, genre } from '../lib/i18n.js';

const CHUNK = 60;

export async function DetailView({ params, onCleanup }) {
  const id = params.id;
  let media;
  try {
    media = await detail(id);
  } catch {
    return errorState(t('This page'), () => location.reload());
  }
  if (!media) {
    return emptyState({ heading: t('Title not found'), body: t('The catalogue has no entry for that ID.'), action: h('a.btn.btn--primary', { href: '#/' }, t('Back home')) });
  }
  // Browsing never surfaces these, but a hand-typed /anime/:id can point at a manga.
  if (media.type && media.type !== 'ANIME') {
    return emptyState({
      iconName: 'ghost',
      heading: t('{format} can’t be streamed', { format: formatLabel(media.format) }),
      body: t('Solvn plays anime only, and this entry is a printed title.'),
      action: h('a.btn.btn--primary', { href: '#/discover' }, t('Find something to watch')),
    });
  }

  pushHistory(media);

  const wrap = h('div.detail');
  const total = resolveEpisodeCount(media);
  const prog = getProgress(media.id);
  const resumeEp = prog?.episode || (media.format === 'MOVIE' ? 1 : 1);
  const airingLocked = (n) => media.status === 'RELEASING' && media.nextAiringEpisode && n >= media.nextAiringEpisode.episode;

  /* ---------- backdrop ---------- */
  if (media.bannerImage && !settings.get('reduceBackdrop')) {
    wrap.append(h('div.detail-backdrop', {}, h('img', { src: media.bannerImage, alt: '', 'aria-hidden': 'true' })));
  }

  /* ---------- header ---------- */
  const listState = inList(media.id);
  const fav = isFavourite(media.id) || media.isFavourite;

  const listButton = h('button.btn', { onclick: () => openListSheet(media, listState) },
    icon(listState ? 'check' : 'bookmark'), listState ? listLabel(listState) : t('Add to list'));

  const heartBtn = h('button.btn.btn--icon', {
    'aria-label': fav ? t('Remove from favourites') : t('Add to favourites'),
    'aria-pressed': String(fav),
    class: fav ? 'is-on' : '',
    style: fav ? { color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 40%, transparent)' } : null,
    onclick: () => {
      const now = toggleFavourite(media);
      heartBtn.replaceChildren(icon('heart'));
      heartBtn.setAttribute('aria-pressed', String(now));
      heartBtn.setAttribute('aria-label', now ? t('Remove from favourites') : t('Add to favourites'));
      heartBtn.style.color = now ? 'var(--danger)' : '';
      heartBtn.style.borderColor = now ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : '';
      toast(now ? t('Added to favourites') : t('Removed from favourites'), { tone: now ? 'ok' : '', iconName: 'heart' });
    },
  }, icon('heart'));

  const shareBtn = h('button.btn.btn--icon', { 'aria-label': t('Copy link'), onclick: async () => {
    const url = `${location.origin}${location.pathname}#/anime/${media.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('Link copied to clipboard'), { tone: 'ok', iconName: 'check' });
    } catch {
      toast(t('Copy failed — long-press the address bar instead'), { tone: 'err', iconName: 'alert' });
    }
  } }, icon('link'));

  const score = media.averageScore;
  const facts = [
    ['Format', formatLabel(media.format)],
    ['Status', statusLabel(media.status)],
    ['Episodes', media.format === 'MOVIE' ? t('Film') : episodeCountIsGuess(media) ? t('Not listed') : String(media.episodes || total)],
    ['Runtime', runtime(media) || '—'],
    ['Season', seasonLabel(media) || '—'],
    ['Studio', media.studios?.nodes?.[0]?.name || '—'],
    ['Score', score ? t('{score}/10', { score: scoreLabel(score) }) : t('Not rated')],
    ['Popularity', media.popularity ? `#${compactNumber(media.popularity)}` : '—'],
    ['Favourites', media.favourites ? compactNumber(media.favourites) : '—'],
  ].filter(([, v]) => v && v !== '—');

  const synopsis = plainDescription(media.description, 900) || t('No synopsis has been added for this title yet.');
  const synEl = h('p.synopsis.is-collapsed', {}, synopsis);

  const header = h(
    'header.detail-top',
    {},
    h('div.detail-poster', {}, mediaCard(media, { to: null, showTitle: false, meta: false, eager: true })),
    h(
      'div',
      {},
      h('div.detail-badges', {},
        h('span.badge', {}, formatLabel(media.format)),
        h('span.badge', { class: STATUS_TONE[media.status] ? `badge--${STATUS_TONE[media.status]}` : null }, statusLabel(media.status)),
        media.seasonYear ? h('span.badge', {}, String(media.seasonYear)) : null,
        media.isAdult ? h('span.badge', { style: { color: 'var(--danger)' } }, t('R+ 17+')) : null,
      ),
      h('h1.detail-title.display', {}, title(media)),
      titleAlt(media) ? h('p.detail-alt', {}, titleAlt(media)) : null,
      (media.synonyms || []).length ? h('p.detail-alt.clamp-1', { style: { fontStyle: 'italic' } }, media.synonyms.slice(0, 3).join(' · ')) : null,
      h('div.hero-genres', { style: { marginTop: '14px' } }, ...(media.genres || []).map((g) =>
        h('a.hero-chip', { href: `#/discover?genre=${encodeURIComponent(g)}`, style: { background: 'var(--surface-2)', color: 'var(--text-dim)', borderColor: 'var(--line)' } }, genre(g)))),
      synEl,
      h('button.read-more', { onclick: () => {
        const open = synEl.classList.toggle('is-collapsed');
        qs('.read-more', header).textContent = open ? t('Read more') : t('Read less');
      } }, t('Read more')),
      h('div.detail-actions', {},
        h('a.btn.btn--primary.btn--lg', { href: `#/watch/${media.id}/${resumeEp}` }, icon('play'),
          prog ? t('Resume ep {n}', { n: prog.episode }) : media.format === 'MOVIE' ? t('Watch film') : t('Watch episode 1')),
        listButton,
        addToPlaylistButton(media),
        heartBtn,
        shareBtn,
      ),
      media.status === 'RELEASING' && media.nextAiringEpisode
        ? h('p', { style: { marginTop: '14px', fontSize: '13px', color: 'var(--text-dim)' } },
            h('span', { style: { color: 'var(--accent-text)', fontFamily: 'var(--font-display)', fontWeight: 700 } }, `${t('Ep {n}', { n: media.nextAiringEpisode.episode })} `),
            t('airs {when}', { when: countdown(media.nextAiringEpisode.airingAt) }))
        : null,
      h('dl.detail-facts', {}, ...facts.map(([k, v]) => h('div.fact', {}, h('dt', {}, t(k)), h('dd', {}, v)))),
    ),
  );
  wrap.append(header);

  /* ---------- tabs ---------- */
  const panel = h('div.tab-panel');
  const tabsEl = h('div.tabs', { role: 'tablist' });
  const TABS = [
    ['episodes', 'Episodes', media.format === 'MOVIE' ? null : String(total)],
    ['characters', 'Characters', media.characters?.nodes?.length ? String(media.characters.nodes.length) : null],
    ['relations', 'Related', String((media.relations?.edges || []).filter((e) => e.node?.format !== 'MUSIC').length || '')],
    ['recs', 'Recommendations', String(media.recommendations?.nodes?.length || '')],
  ];
  let currentTab = 'episodes';

  const renderers = {
    episodes: () => episodesPanel(),
    characters: () => charactersPanel(media),
    relations: () => relationsPanel(media),
    recs: () => recsPanel(media),
  };

  function selectTab(key) {
    currentTab = key;
    [...tabsEl.children].forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    panel.replaceChildren(renderers[key]());
  }

  TABS.forEach(([key, label, n]) => {
    if (key === 'relations' && !(media.relations?.edges || []).filter((e) => e.node?.format !== 'MUSIC').length) return;
    if (key === 'recs' && !media.recommendations?.nodes?.length) return;
    if (key === 'characters' && !media.characters?.nodes?.length) return;
    tabsEl.append(h(`button.tab-btn${key === currentTab ? '.is-active' : ''}`, {
      role: 'tab', 'aria-selected': String(key === currentTab), dataset: { key },
      onclick: () => selectTab(key),
    }, t(label), n ? h('span.n', {}, n) : null));
  });

  wrap.append(tabsEl, panel);
  if (tabsEl.children.length) selectTab('episodes');
  else panel.replaceChildren(renderers.episodes());

  /* The room for this title comes after the episode list and the synopsis, so a
     viewer reads what the show is before reading what people said about it.
     Signed-out visitors get the same thread, read-only, with a way in. */
  const talk = titleDiscussion(media, { onCleanup });
  if (talk) wrap.append(talk);

  return wrap;

  /* ---------- episodes ---------- */
  function episodesPanel() {
    const host = h('div');
    const list = h('div.ep-list');
    const note = h('p.muted', { style: { fontSize: '13px', marginTop: '10px' } });
    const more = h('button.chip.btn--sm.hide', { style: { marginTop: '12px' }, onclick: () => appendUpTo(shown + CHUNK) }, t('Show more'));

    let all = [];
    let shown = 0;

    const build = (eps) => {
      list.replaceChildren();
      shown = 0;
      all = eps;
      if (media.format === 'MOVIE') {
        list.append(episodeRow({ number: 1, title: title(media) }, 1));
        note.textContent = t('This is a film — one continuous runtime.');
        more.classList.add('hide');
        return;
      }
      // Long-running titles reach 1000+ rows; rendering them all at once makes the
      // page heavy, so the rail is chunked and grows on demand.
      const resume = prog?.episode ? Math.ceil(prog.episode / CHUNK) * CHUNK : 0;
      appendUpTo(Math.min(all.length, Math.max(CHUNK, resume)));
      note.textContent = all.length === 1
        ? t('{n} episode listed, with titles where the source has them.', { n: all.length })
        : t('{n} episodes listed, with titles where the source has them.', { n: all.length });
    };

    function appendUpTo(to) {
      const frag = document.createDocumentFragment();
      for (let i = shown; i < to; i++) frag.append(episodeRow(all[i], prog?.episode));
      list.append(frag);
      shown = to;
      const left = all.length - shown;
      more.classList.toggle('hide', left <= 0);
      if (left > 0) {
        more.textContent = left > CHUNK
          ? t('Show next {n} · {left} more', { n: CHUNK, left })
          : t('Show {n} more', { n: left });
      }
    }

    const controls = h('div.rowline.wrap', { style: { gap: '8px', marginTop: 'var(--sp-5)' } },
      h('button.chip.btn--sm', { onclick: () => { setProgress(media, 0); toast(t('Progress cleared'), { tone: 'ok', iconName: 'check' }); selectTab('episodes'); } }, icon('refresh'), t('Reset progress')),
    );

    host.append(controls, list, more, note);
    if (media.format === 'MOVIE') build([]);
    else {
      list.replaceChildren(h('p.muted', { style: { padding: '20px 0' } }, h('span.spinner.inline'), ` ${t('Loading episodes…')}`));
      fetchEpisodes(media.id)
        // The detail payload already carries the curated list; the per-episode
        // query can answer with an empty one, and that must not throw the stills away.
        .then((m) => build(buildEpisodes(
          { ...media, ...(m || {}) },
          m?.streamingEpisodes?.length ? m.streamingEpisodes : media.streamingEpisodes || [],
        )))
        .catch(() => build(buildEpisodes(media, media.streamingEpisodes || [])));
    }
    return host;
  }

  function episodeRow(ep, currentEp) {
    const locked = airingLocked(ep.number);
    const watched = prog?.episode && ep.number < prog.episode;
    const isCurrent = prog?.episode === ep.number;
    return h(
      `a.ep${watched ? '.is-watched' : ''}${isCurrent ? '.is-current' : ''}${locked ? '.is-locked' : ''}`,
      { href: locked ? null : `#/watch/${media.id}/${ep.number}`, 'aria-disabled': String(locked) },
      h('div.ep-num.tnum', {}, locked ? icon('clock') : String(ep.number)),
      h('div.ep-thumb', {},
        h('span.art-ph', {}, icon('film')),
        episodeArt(media, ep),
        locked ? null : h('span.play', {}, icon('play')),
      ),
      h('div.ep-body', {},
        h('div.ep-title.clamp-2', {}, ep.title || t('Episode {n}', { n: ep.number })),
        h('div.ep-sub.clamp-1', {}, locked
          ? t('Airing {when}', { when: media.nextAiringEpisode ? countdown(media.nextAiringEpisode.airingAt) : t('soon') })
          : ep.desc ? plainDescription(ep.desc, 90) : media.duration ? t('{n} min', { n: media.duration }) : ' '),
      ),
      h('div.ep-state', {},
        watched ? h('span.badge.badge--live', {}, icon('check'), t('Watched')) : null,
        isCurrent ? h('span.badge.badge--accent', {}, icon('play'), t('Watching')) : null,
      ),
    );
  }
}

/* ---------- panels ---------- */
function charactersPanel(media) {
  const nodes = media.characters?.nodes || [];
  if (!nodes.length) return emptyState({ iconName: 'ghost', heading: t('No characters listed'), body: t('The cast is not listed for this title yet.') });
  return h('div', {},
    h('p.muted', { style: { fontSize: '13px', marginTop: 'var(--sp-5)' } }, t('Main cast, as credited by the source.')),
    h('div.cast-grid', {}, ...nodes.map((c) =>
      h('div.person', {},
        h('div.person-art', {},
          h('span.art-ph', {}, icon('ghost')),
          stillImage([c.image?.large, c.image?.medium], { alt: '' }),
        ),
        h('div.n', {}, c.name?.full || t('Unknown')),
        h('div.r', {}, roleLabel(c.role)),
      ),
    )));
}

function roleLabel(role) {
  if (!role) return '';
  if (role === 'MAIN') return t('Main');
  if (role === 'SUPPORTING') return t('Supporting');
  return t(role.replace(/_/g, ' ').toLowerCase());
}

function relationsPanel(media) {
  const edges = (media.relations?.edges || []).filter((e) => e.node?.format !== 'MUSIC' && e.node);
  if (!edges.length) return emptyState({ iconName: 'link', heading: t('No related titles'), body: t('Nothing is linked to this title yet.') });
  const groups = new Map();
  for (const e of edges) {
    const key = prettifyRelation(e.relationType);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e.node);
  }
  return h('div', { style: { marginTop: 'var(--sp-5)' } }, ...[...groups].map(([label, nodes]) =>
    mediaRow({
      heading: t(label),
      items: nodes,
      sub: nodes.length === 1 ? t('{n} title', { n: nodes.length }) : t('{n} titles', { n: nodes.length }),
    }),
  ));
}

function recsPanel(media) {
  const nodes = (media.recommendations?.nodes || []).map((n) => n.mediaRecommendation).filter(Boolean);
  if (!nodes.length) return emptyState({ iconName: 'sparkles', heading: t('No recommendations'), body: t('Viewers have not suggested anything for this title yet.') });
  return h('div', { style: { marginTop: 'var(--sp-5)' } },
    h('p.muted', { style: { fontSize: '13px', marginBottom: 'var(--sp-4)' } }, t('Chosen by other viewers of this title.')),
    h('div.grid', {}, ...nodes.map((m, i) => mediaCard(m, { eager: i < 6 }))),
  );
}

function prettifyRelation(r) {
  const map = {
    PREQUEL: 'Prequel', SEQUEL: 'Sequel', ALTERNATIVE_SETTING: 'Alternative setting',
    ADAPTATION: 'Source material', SIDE_STORY: 'Side story', SUMMARY: 'Summary',
    CHARACTER: 'Shares characters', SPIN_OFF: 'Spin-off', OTHER: 'Also mentioned',
    SOURCE: 'Adapted from',
  };
  return map[r] || r?.toLowerCase().replace(/_/g, ' ') || 'Related';
}

/* ---------- list sheet ---------- */
function openListSheet(media, currentState) {
  const api = sheet({
    heading: t('Add to your library'),
    sub: title(media),
    render: () =>
      h('div.stack', {},
        ...LISTS.map((k) =>
          h(`button.check${currentState === k ? '.is-on' : ''}`, {
            style: { height: '46px', padding: '0 14px', fontSize: '14px', justifyContent: 'space-between' },
            onclick: (e) => {
              const added = toggleList(media, k);
              [...e.currentTarget.parentElement.children].forEach((c) => {
                c.classList.remove('is-on');
                c.replaceChildren(c.textContent);
              });
              e.currentTarget.classList.add('is-on');
              e.currentTarget.prepend(icon('check'));
              toast(added ? t('Saved to {list}', { list: listLabel(k) }) : t('Removed from list'), { tone: added ? 'ok' : '', iconName: added ? 'check' : 'bookmark' });
              document.dispatchEvent(new CustomEvent('kitsune:nav'));
              setTimeout(() => api.close(), 420);
            },
          }, currentState === k ? icon('check') : null, listLabel(k)),
        ),
        currentState
          ? h('button.btn', { style: { marginTop: '4px' }, onclick: () => {
              removeFromLists(media.id);
              toast(t('Removed from your library'), { iconName: 'bookmark' });
              document.dispatchEvent(new CustomEvent('kitsune:nav'));
              api.close();
            } }, icon('trash'), t('Remove from all lists'))
          : null,
      ),
  });
}
