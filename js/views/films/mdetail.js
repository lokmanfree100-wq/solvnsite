/**
 * Movie / Series detail page (`/movie/:id?type=movie|tv`).
 *
 * TMDB details through the /tmdb proxy: backdrop hero, poster, meta, trailer,
 * watchlist, and — for series — the season tabs with the episode list. Cast,
 * similar and recommendations come from the same details call
 * (append_to_response), so the page costs exactly one request.
 */

import { h, icon } from '../../lib/dom.js';
import { t } from '../../lib/i18n.js';
import { toast } from '../../lib/ui.js';
import { errorState, stillImage } from '../../components/media.js';
import { mCard, mRail, openTrailer } from './movies.js';
import {
  api, poster, backdrop, img, nameOf, yearOf, rating, runtimeText, seasonsLabel, fmtDate,
  firstTrailer, toggleMovieWatchlist, inMovieWatchlist,
} from '../../lib/tmdb.js';

const watchHref = (type, id, s = 1, e = 1) =>
  type === 'tv' ? `#/mwatch/${id}?type=tv&s=${s}&e=${e}` : `#/mwatch/${id}?type=movie`;

const money = (v) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${Math.round(v / 1e6)}M`;

/* The frame a slot shows when TMDB has no art for it — or the CDN refused every
   size we asked for. Each of these has its own background and border, so an
   empty one reads as a broken tile rather than a missing picture. */
const slotPh = () => h('span.art-ph', {}, icon('film'));

function factsPanel(d, type) {
  const facts = [];
  if (d.status) facts.push([t('Status'), d.status]);
  facts.push([type === 'tv' ? t('First aired') : t('Released'), fmtDate(d.release_date || d.first_air_date)]);
  if (type === 'tv' && d.last_air_date) facts.push([t('Last aired'), fmtDate(d.last_air_date)]);
  if (d.original_language) facts.push([t('Language'), d.original_language.toUpperCase()]);
  if (d.budget) facts.push([t('Budget'), money(d.budget)]);
  if (d.revenue) facts.push([t('Revenue'), money(d.revenue)]);
  if ((d.production_companies || []).length) facts.push([t('Studio'), d.production_companies[0].name]);
  return h(
    'div.m-panel',
    {},
    h('h3', {}, t('Facts')),
    ...facts.map(([k, v]) => h('div.m-fact', {}, h('b', {}, k), h('span', {}, v))),
  );
}

function crewPanel(d, type) {
  const directors = ((d.credits || {}).crew || [])
    .filter((c) => c.job === 'Director')
    .slice(0, 2)
    .map((c) => c.name);
  const writers = [...new Set(
    type === 'tv'
      ? (d.created_by || []).map((p) => p.name)
      : ((d.credits || {}).crew || [])
          .filter((c) => ['Writer', 'Screenplay', 'Story'].includes(c.job))
          .slice(0, 4)
          .map((c) => c.name),
  )].slice(0, 2);
  if (!directors.length && !writers.length) return null;
  return h(
    'div.m-panel',
    {},
    h('h3', {}, t('Key crew')),
    ...(directors.length
      ? [h('div.m-fact', {}, h('b', {}, type === 'tv' ? t('Created by') : t('Director')), h('span', {}, directors.join(', ')))]
      : []),
    ...(writers.length
      ? [h('div.m-fact', {}, h('b', {}, t('Writer')), h('span', {}, writers.join(', ')))]
      : []),
  );
}

export async function MovieDetailView(ctx) {
  const { query } = ctx.route;
  const type = query.type === 'tv' ? 'tv' : 'movie';
  const id = Number(ctx.params.id);

  let d;
  try {
    d = await api.details(type, id);
  } catch {
    return errorState(t('That title'), () => ctx.go(ctx.route.raw));
  }
  d.media_type = type;
  const title = nameOf(d);
  const trailer = firstTrailer((d.videos || {}).results);

  const wrap = h('div.page-mdetail');

  /* ---------- hero ---------- */
  /* w780 is not a size TMDB serves for posters, only for backdrops, so the old
     one-shot URL 404'd for every title that has no backdrop. Ask for the crops
     that exist, in order, and let the frame keep its own surface colour if none
     of them arrives — a hero with no art still reads as a hero. */
  const bg =
    backdrop(d.backdrop_path, 'w1280') ||
    backdrop(d.backdrop_path, 'w780') ||
    poster(d.poster_path, 'w500') ||
    poster(d.poster_path, 'original');
  const hero = h(
    'div.m-detail-hero',
    {},
    h(
      'div.m-detail-bg',
      {},
      stillImage(bg ? [bg] : [], { eager: true, fallback: () => null }),
    ),
    h('div.m-detail-scrim'),
    h(
      'div.m-detail-inner',
      {},
      h(
        'div.m-detail-poster',
        {},
        stillImage([poster(d.poster_path, 'w500'), poster(d.poster_path, 'w342')], {
          eager: true,
          alt: `${title} poster`,
          fallback: () => h('span.art-ph', {}, icon('film')),
        }),
      ),
      h(
        'div.m-detail-head',
        {},
        h(
          'div.m-detail-tags',
          {},
          h('span.m-chip.is-type', {}, type === 'tv' ? t('Series') : t('Movie')),
          ...(d.genres || []).slice(0, 3).map((g) => h('span.m-chip', {}, t(g.name))),
        ),
        h('h1', {}, title),
        h(
          'div.m-detail-sub',
          {},
          h('span.star.tnum', {}, icon('star'), rating(d.vote_average)),
          yearOf(d) ? h('span.sep', {}, '·') : null,
          yearOf(d) ? h('span.tnum', {}, String(yearOf(d))) : null,
          type === 'movie' && d.runtime ? h('span.sep', {}, '·') : null,
          type === 'movie' && d.runtime ? h('span', {}, runtimeText(d.runtime)) : null,
          type === 'tv' && d.number_of_seasons ? h('span.sep', {}, '·') : null,
          type === 'tv' && d.number_of_seasons ? h('span', {}, seasonsLabel(d.number_of_seasons)) : null,
          d.status && d.status !== 'Released' ? h('span.sep', {}, '·') : null,
          d.status && d.status !== 'Released' ? h('span', {}, d.status) : null,
        ),
        h(
          'div.m-detail-actions',
          {},
          h('a.btn.btn--primary.btn--lg', { href: watchHref(type, id) }, icon('play'), type === 'tv' ? t('Play S1:E1') : t('Start watching')),
          trailer
            ? h('button.btn.btn--glass.btn--lg', { type: 'button', onclick: () => openTrailer(trailer.key, title) }, icon('play'), t('Trailer'))
            : null,
          h(
            'button.btn.btn--glass.btn--lg',
            {
              type: 'button',
              onclick: () => {
                const on = toggleMovieWatchlist({ type, id, title, posterPath: d.poster_path });
                paintSave();
                toast(on ? t('Added “{title}” to watchlist', { title }) : t('Removed “{title}” from watchlist', { title }), { iconName: 'bookmark' });
              },
            },
            icon('bookmark'),
            h('span', {}, t('Watchlist')),
          ),
        ),
      ),
    ),
  );
  wrap.append(hero);
  const saveBtn = hero.querySelector('.m-detail-actions .btn:last-child');
  const paintSave = () => {
    const on = inMovieWatchlist(type, id);
    saveBtn.replaceChildren(icon('bookmark'), h('span', {}, on ? t('On watchlist') : t('Watchlist')));
  };
  paintSave();

  /* ---------- body ---------- */
  const layout = h('div.m-layout', {}, h('div.m-main'), h('div.m-side'));
  wrap.append(layout);
  const mcol = layout.querySelector('.m-main');
  const scol = layout.querySelector('.m-side');

  mcol.append(
    h(
      'div.m-panel',
      {},
      h('h3', {}, t('Overview')),
      h('p.m-overview', {}, d.overview || t('No overview available for this title yet.')),
    ),
  );

  /* series: season tabs + episodes */
  if (type === 'tv' && (d.seasons || []).length) {
    const seasons = d.seasons.filter((s) => s.season_number > 0);
    const panel = h('div.m-panel', {}, h('h3', {}, t('Episodes')), h('div.m-season-tabs'), h('div.m-ep-list'));
    const tabs = panel.querySelector('.m-season-tabs');
    const list = panel.querySelector('.m-ep-list');

    const loadSeason = async (sn) => {
      tabs.querySelectorAll('.m-season-tab').forEach((b) => b.classList.toggle('is-active', Number(b.dataset.s) === sn));
      list.replaceChildren(h('div.sk', { style: { height: '96px' } }), h('div.sk', { style: { height: '96px' } }));
      let s;
      try {
        s = await api.season(id, sn);
      } catch {
        list.replaceChildren(errorState(t('This season'), () => loadSeason(sn)));
        return;
      }
      list.replaceChildren();
      for (const ep of s.episodes || []) {
        list.append(
          h(
            'a.m-ep',
            { href: watchHref('tv', id, sn, ep.episode_number) },
            h(
              'span.m-ep-thumb',
              {},
              stillImage([img(ep.still_path, 'w300'), img(ep.still_path, 'w780')], {
                fallback: slotPh,
              }) || slotPh(),
              h('span.m-ep-play', {}, h('span', {}, icon('play'))),
            ),
            h(
              'span.m-ep-info',
              {},
              h('span.m-ep-name', {}, `${ep.episode_number}. ${ep.name || t('Untitled episode')}`),
              h('span.m-ep-date', {}, `${fmtDate(ep.air_date)}${ep.runtime ? ` · ${ep.runtime}m` : ''}`),
              h('span.m-ep-overview', {}, ep.overview || t('No description available.')),
            ),
            h('span.m-ep-score.tnum', {}, icon('star'), ` ${rating(ep.vote_average)}`),
          ),
        );
      }
      if (!list.children.length) {
        list.append(h('p.muted', {}, t('No episodes listed for this season yet.')));
      }
    };

    for (const s of seasons) {
      tabs.append(
        h('button.m-season-tab', {
          type: 'button',
          dataset: { s: s.season_number },
          onclick: () => loadSeason(s.season_number),
        }, s.name || `${t('Season')} ${s.season_number}`),
      );
    }
    mcol.append(panel);
    loadSeason(1);
  }

  /* cast */
  const cast = ((d.credits || {}).cast || []).slice(0, 14);
  if (cast.length) {
    mcol.append(
      h(
        'div.m-panel',
        {},
        h('h3', {}, t('Top billed')),
        h(
          'div.m-cast',
          {},
          ...cast.map((c) =>
            h(
              'div.m-cast-item',
              {},
              stillImage([img(c.profile_path, 'w185'), img(c.profile_path, 'w45')], {
                alt: c.name,
                fallback: () => h('span.m-cast-ph'),
              }) || h('span.m-cast-ph'),
              h('div.m-c-name', {}, c.name),
              h('div.m-c-char', {}, c.character || ''),
            ),
          ),
        ),
      ),
    );
  }

  /* similar + recommendations */
  for (const [label, items] of [
    [t('More like this'), ((d.similar || {}).results || [])],
    [t('Recommendations'), ((d.recommendations || {}).results || [])],
  ]) {
    const list = items.filter((x) => x.poster_path).slice(0, 16);
    if (!list.length) continue;
    mcol.append(mRail({
      heading: label,
      fetcher: async () => list.map((x) => ({ ...x, media_type: type })),
    }));
  }

  /* side */
  scol.append(factsPanel(d, type));
  const crew = crewPanel(d, type);
  if (crew) scol.append(crew);

  return wrap;
}
