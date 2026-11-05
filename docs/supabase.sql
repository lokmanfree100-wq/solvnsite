-- ===========================================================================
-- Solvn — the central database.
--
-- Run this file in the Supabase dashboard of the project already compiled into
-- js/lib/cloud.js (BUILT_IN, js/lib/cloud.js:31):
--
--   Supabase dashboard → the Solvn project → SQL Editor → New query
--   → paste this whole file → Run
--
-- Safe to run twice: every object is `create ... if not exists` or
-- `create or replace`, and nothing here drops a table.
--
-- Until this runs, `rpc/kitsune_ready` answers 404, so cloud.js sets
-- schema.state = 'missing', `authReady()` is false, and every account call falls
-- back to localStorage: sign-up "works", the account exists only inside that one
-- browser, and the leaderboard can only ever count it. This file is the
-- difference between a private number and a community.
--
-- What is deliberately NOT in this schema: no country, region, city, timezone,
-- IP address, user-agent or fingerprint column, and no function that reads one.
-- A visitor's location is neither stored nor derivable. The traffic tables hold a
-- timestamp and which page of this site was open, and the list of who is here is
-- reachable only through kitsune_analytics(), which is gated in SQL itself.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. members
--
-- `id` IS the auth user id, not a surrogate: cloud.js addresses a row as
-- `/rest/v1/kitsune_profiles?id=eq.<uid>` and js/lib/device.js keeps the same
-- contract. `user_id` is the short number a profile is shared by — device.js
-- derives one locally, and `kitsune_join` hands out the real thing.
--
-- `is_staff` marks the people who may open the desk. Nothing a member can call
-- writes it: the signup trigger sets it from the verified owner address, and the
-- owner promotes anybody else by hand in the dashboard. It exists so the public
-- boards can hide staff rows, the way js/lib/device.js:1640 already does locally.
-- ---------------------------------------------------------------------------

create table if not exists public.kitsune_profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  user_id      bigint unique,
  username     text unique,
  display_name text,
  bio          text   default '',
  avatar       jsonb,
  banner       jsonb,
  favourite    jsonb,
  badges       jsonb  not null default '[]'::jsonb,
  cards        jsonb,
  duel         jsonb  not null default '{}'::jsonb,
  title        text,
  is_staff     boolean not null default false,
  hours        integer not null default 0,
  episodes     integer not null default 0,
  completed    integer not null default 0,
  titles       integer not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.kitsune_profiles is
  'One row per member. Public: the handle, the display name, the binder summary.';

-- The handle is chosen once and never changes, so it is the key people are found
-- by. Folded (lower + trimmed) so neither case nor padding can squat a name.
-- cloudMessage() turns a clash here into "That name is taken."
create unique index if not exists username_folded_key
  on public.kitsune_profiles (lower(btrim(username)));

create index if not exists kitsune_profiles_hours_idx
  on public.kitsune_profiles (hours desc nulls last, created_at desc);

-- The search-as-you-type filter in `members` is an ilike prefix match.
create index if not exists kitsune_profiles_username_lower_idx
  on public.kitsune_profiles (lower(username) text_pattern_ops);

-- ---------------------------------------------------------------------------
-- 2. the binder, the packs and the XP
--
-- A whole-record replace, last write wins on the member's own clock: toCore()
-- reads collection / packs / xp / client_at back and cloud.js compares client_at
-- before uploading, so a stale tab cannot resurrect a card just fused away.
-- ---------------------------------------------------------------------------

create table if not exists public.kitsune_cores (
  id         uuid primary key references public.kitsune_profiles (id) on delete cascade,
  collection jsonb not null default '{}'::jsonb,
  packs      jsonb not null default '{}'::jsonb,
  xp         jsonb not null default '{}'::jsonb,
  client_at  bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. playlists and their likes
--
-- `owner` defaults to auth.uid(): cloud.js posts {title, items, visibility} and
-- nothing else, so the column has to fill itself in.
-- ---------------------------------------------------------------------------

create table if not exists public.kitsune_playlists (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  items      jsonb not null default '[]'::jsonb,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  owner      uuid not null default auth.uid() references public.kitsune_profiles (id) on delete cascade,
  like_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists kitsune_playlists_owner_idx
  on public.kitsune_playlists (owner, created_at desc);
create index if not exists kitsune_playlists_public_idx
  on public.kitsune_playlists (like_count desc) where visibility = 'public';

create table if not exists public.kitsune_likes (
  usr        uuid not null references public.kitsune_profiles (id) on delete cascade,
  playlist   uuid not null references public.kitsune_playlists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usr, playlist)
);

create index if not exists kitsune_likes_playlist_idx on public.kitsune_likes (playlist);

-- ---------------------------------------------------------------------------
-- 4. traffic — the least personal tables in the site
--
-- kitsune_visits: one row per page load. A moment and a route. No member id, no
-- handle, nothing joinable back to a person. It answers "how many people came".
--
-- kitsune_presence: one row per SIGNED-IN member, kept alive by the heartbeat in
-- js/lib/presence.js. This is the "who is here" list, and the only way to read it
-- is kitsune_analytics(), which refuses anybody who is not the admin.
-- ---------------------------------------------------------------------------

create table if not exists public.kitsune_visits (
  n    bigint generated always as identity primary key,
  at   timestamptz not null default now(),
  path text,
  via  text
);

create index if not exists kitsune_visits_at_idx on public.kitsune_visits (at desc);

comment on column public.kitsune_visits.path is
  'The route that was opened, e.g. "#/watch/2120/4". A page name, not a person.';
comment on column public.kitsune_visits.via is
  'The path this site sent the visitor from, or the search engine that did.';

create table if not exists public.kitsune_presence (
  usr          uuid primary key references public.kitsune_profiles (id) on delete cascade,
  username     text,
  display_name text,
  path         text,
  at           timestamptz not null default now()
);

create index if not exists kitsune_presence_at_idx on public.kitsune_presence (at desc);

-- ---------------------------------------------------------------------------
-- 5. who may call the admin functions
--
-- js/lib/account.js hides the toolbar; this is the lock, because a publishable
-- key can reach any function in this schema. Two facts are trusted, and only
-- two: the address the account was made with — which Supabase owns and verifies,
-- so a member cannot claim it — and `is_staff`, a column no function in this
-- file will write, so the owner sets it by hand in the dashboard.
--
-- The handle is deliberately NOT a rule. Anyone can sign up as `solvn` while the
-- name is free, and a username is not a credential.
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return false;
  end if;
  return coalesce(
    (select bool_or(
        u.email = any (array['fakelokman36@gmail.com'])
        or p.is_staff
     )
       from auth.users u
       join public.kitsune_profiles p on p.id = u.id
      where u.id = auth.uid()),
    false
  );
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. a profile row the moment the account exists
--
-- This is the fix for the path js/lib/cloud.js:586 walks: with "confirm your
-- email" switched on, sign-up returns no access_token, the browser never reaches
-- kitsune_join, and the member comes back to a profile that does not exist. A
-- trigger on auth.users removes the ordering problem — the row is there before
-- the first read, whether or not a token ever arrives.
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_new_user()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  n         text;
  candidate text;
  tries     integer := 0;
begin
  n := lower(btrim(coalesce(
    new.raw_user_meta_data ->> 'username',
    split_part(coalesce(new.email, ''), '@', 1)
  )));
  n := left(regexp_replace(coalesce(n, ''), '[^a-z0-9._-]', '', 'g'), 24);
  if n = '' then
    n := 'member';
  end if;

  candidate := n;
  -- A taken handle gets a suffix instead of aborting the account: a signup that
  -- throws over a clash looks exactly like a dead button.
  while exists (select 1 from public.kitsune_profiles p where lower(btrim(p.username)) = candidate)
    and tries < 8
  loop
    tries := tries + 1;
    candidate := left(n, 18) || substr(replace(new.id::text, '-', ''), 1, 6);
    if tries > 1 then
      candidate := left(n, 16) || substr(md5(new.id::text || tries::text), 1, 8);
    end if;
  end loop;

  -- Eight suffixes all taken means somebody is squatting look-alike names in bulk.
  -- The account still gets made, just with no handle: the boards count members by
  -- a real username, so an empty one hides the row instead of colliding with
  -- somebody else's, and kitsune_join hands out a name the moment they sign in.
  if exists (select 1 from public.kitsune_profiles p where lower(btrim(p.username)) = candidate) then
    candidate := null;
  end if;

  insert into public.kitsune_profiles (id, username, display_name, is_staff)
  values (
    new.id,
    candidate,
    coalesce(
      nullif(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'member'
    ),
    new.email = any (array['fakelokman36@gmail.com'])
  )
  on conflict (id) do nothing;

  insert into public.kitsune_cores (id) values (new.id) on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists kitsune_on_new_user on auth.users;
create trigger kitsune_on_new_user
  after insert on auth.users
  for each row execute function public.kitsune_new_user();

-- The short number a profile is shared by. Sequential, starting where the local
-- device's derived numbers are unlikely to collide.
create or replace function public.kitsune_next_number()
returns bigint
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select coalesce(max(user_id), 100000) + 1 from public.kitsune_profiles;
$$;

-- ---------------------------------------------------------------------------
-- 7. the schema check the whole app gates itself on
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_ready()
returns boolean
language sql
stable
as $$
  select to_regclass('public.kitsune_profiles')  is not null
     and to_regclass('public.kitsune_cores')     is not null
     and to_regclass('public.kitsune_playlists') is not null
     and to_regclass('public.kitsune_likes')     is not null
     and to_regclass('public.kitsune_visits')    is not null
     and to_regclass('public.kitsune_presence')  is not null;
$$;

-- ---------------------------------------------------------------------------
-- 8. signup: claim the handle chosen in the form
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_join(p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  n   text := lower(btrim(coalesce(p_username, '')));
  row public.kitsune_profiles%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  if n !~ '^[a-z0-9._-]{2,24}$' then
    raise exception 'That name cannot be used.';
  end if;

  select * into row from public.kitsune_profiles where id = uid;
  if row.id is null then
    -- The trigger normally makes the row; this covers a project where it has not
    -- fired yet, so a first sign-in is never a 404 on a missing profile.
    insert into public.kitsune_profiles (id) values (uid) on conflict (id) do nothing;
    select * into row from public.kitsune_profiles where id = uid;
  end if;

  if row.username is not null and lower(btrim(row.username)) = n then
    return to_jsonb(row);
  end if;

  if exists (select 1 from public.kitsune_profiles p where lower(btrim(p.username)) = n) then
    raise exception 'duplicate key: username % is taken', n;
  end if;

  update public.kitsune_profiles
     set username = n,
         user_id  = coalesce(user_id, public.kitsune_next_number())
   where id = uid
  returning * into row;

  return to_jsonb(row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. reading one profile, with its public playlists attached
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_profile(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'user', to_jsonb(p) - 'is_staff',
    'playlists', coalesce((
      select jsonb_agg(to_jsonb(pl) order by pl.created_at desc)
        from public.kitsune_playlists pl
       where pl.owner = p.id and pl.visibility = 'public'
    ), '[]'::jsonb)
  )
  from public.kitsune_profiles p
  where p.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 10. the fields a member owns
--
-- toUser() reads ONE object back rather than an array, which is why every writer
-- here returns jsonb. p_duel defaults to null so a bundle that predates the
-- ranked board still calls the four-argument shape it knows.
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_profile_update(
  p_display_name text,
  p_bio          text,
  p_avatar       jsonb,
  p_banner       jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  row public.kitsune_profiles%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  update public.kitsune_profiles
     set display_name = left(coalesce(p_display_name, display_name), 48),
         bio          = left(coalesce(p_bio, bio), 500),
         avatar       = coalesce(p_avatar, avatar),
         banner       = coalesce(p_banner, banner)
   where id = uid
  returning * into row;
  return to_jsonb(row);
end;
$$;

create or replace function public.kitsune_stats(
  p_hours     integer,
  p_episodes  integer,
  p_completed integer,
  p_titles    integer,
  p_badges    jsonb,
  p_duel      jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  row public.kitsune_profiles%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  update public.kitsune_profiles
     set hours     = greatest(0, coalesce(p_hours, hours)),
         episodes  = greatest(0, coalesce(p_episodes, episodes)),
         completed = greatest(0, coalesce(p_completed, completed)),
         titles    = greatest(0, coalesce(p_titles, titles)),
         badges    = coalesce(p_badges, badges),
         duel      = coalesce(p_duel, duel)
   where id = uid
  returning * into row;
  return to_jsonb(row);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. the core: binder, packs, XP — last write wins on the member's own clock
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_core_get()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('core', to_jsonb(c))
    from public.kitsune_cores c
   where c.id = auth.uid();
$$;

create or replace function public.kitsune_core_put(
  p_collection jsonb,
  p_packs      jsonb,
  p_xp         jsonb,
  p_client_at  bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid  uuid := auth.uid();
  held public.kitsune_cores%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into held from public.kitsune_cores where id = uid for update;

  if held.id is null then
    insert into public.kitsune_cores (id, collection, packs, xp, client_at)
    values (uid, coalesce(p_collection, '{}'::jsonb), coalesce(p_packs, '{}'::jsonb),
            coalesce(p_xp, '{}'::jsonb), coalesce(p_client_at, 0));
  elsif coalesce(p_client_at, 0) >= coalesce(held.client_at, 0) then
    -- An equal clock lets the newer device win, so two tabs on one machine agree.
    update public.kitsune_cores
       set collection = coalesce(p_collection, collection),
           packs      = coalesce(p_packs, packs),
           xp         = coalesce(p_xp, xp),
           client_at  = coalesce(p_client_at, client_at),
           updated_at = now()
     where id = uid;
  end if;

  return jsonb_build_object('core', to_jsonb(c))
    from public.kitsune_cores c where c.id = uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. the boards
--
-- Both are readable by an anonymous visitor because the leaderboard is a public
-- page. What leaves these functions is a handle, a display name and a card
-- count — the same fields js/lib/device.js already prints. Staff rows are hidden
-- from the ranking exactly as the local board hides them; the totals still count
-- every member.
-- ---------------------------------------------------------------------------

-- js/lib/device.js:1640 orders collectors by cards.best, then topTier, then
-- unique, then the handle — and only members with at least one card appear.
create or replace function public.kitsune_collectors(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(x.o order by x.rnk)
        from (
          select row_number() over (
                   order by coalesce((p.cards ->> 'best')::int, 0) desc,
                            coalesce((p.cards ->> 'topTier')::int, 0) desc,
                            coalesce((p.cards ->> 'unique')::int, 0) desc,
                            lower(p.username) asc
                 ) as rnk,
                 to_jsonb(p) - 'is_staff'
                   || jsonb_build_object('place', row_number() over (
                       order by coalesce((p.cards ->> 'best')::int, 0) desc,
                                coalesce((p.cards ->> 'topTier')::int, 0) desc,
                                coalesce((p.cards ->> 'unique')::int, 0) desc,
                                lower(p.username) asc
                     )) as o
            from public.kitsune_profiles p
           where p.username is not null
             and not p.is_staff
             and coalesce((p.cards ->> 'best')::int, 0) > 0
        ) x
       order by x.rnk
       limit greatest(1, least(50, coalesce(p_limit, 20)))
    ), '[]'::jsonb),
    'me', (
      select y.o
        from (
          select p.id,
                 to_jsonb(p) || jsonb_build_object('place', row_number() over (
                   order by coalesce((p.cards ->> 'best')::int, 0) desc,
                            coalesce((p.cards ->> 'topTier')::int, 0) desc,
                            coalesce((p.cards ->> 'unique')::int, 0) desc,
                            lower(p.username) asc
                 )) as o
            from public.kitsune_profiles p
           where p.username is not null
             and coalesce((p.cards ->> 'best')::int, 0) > 0
        ) y
       where y.id = auth.uid()
    ),
    'totals', jsonb_build_object(
      'members',    (select count(*) from public.kitsune_profiles),
      'collectors', (select count(*) from public.kitsune_profiles
                      where coalesce((cards ->> 'best')::int, 0) > 0),
      'pulls',      (select coalesce(sum((cards ->> 'pulls')::int), 0) from public.kitsune_profiles
                      where cards is not null and cards ? 'pulls'),
      'highest',    (select coalesce(max((cards ->> 'best')::int), 0) from public.kitsune_profiles)
    )
  );
$$;

-- js/lib/device.js:1672 orders the hours board by hours, then episodes.
create or replace function public.kitsune_leaderboard(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.place)
        from (
          select p.*, row_number() over (
            order by p.hours desc, p.episodes desc, p.created_at asc
          ) as place
            from public.kitsune_profiles p
           where p.username is not null
           order by p.hours desc, p.episodes desc, p.created_at asc
           limit greatest(1, least(50, coalesce(p_limit, 20)))
        ) s
    ), '[]'::jsonb),
    'me', (
      select to_jsonb(y) from (
        select p.*, row_number() over (
          order by p.hours desc, p.episodes desc, p.created_at asc
        ) as place
          from public.kitsune_profiles p where p.username is not null
      ) y where y.id = auth.uid()
    ),
    'me_place', (
      select y.place from (
        select p.id, row_number() over (
          order by p.hours desc, p.episodes desc, p.created_at asc
        ) as place
          from public.kitsune_profiles p where p.username is not null
      ) y where y.id = auth.uid()
    ),
    'totals', jsonb_build_object(
      'members',   (select count(*) from public.kitsune_profiles),
      'hours',     (select coalesce(sum(hours), 0) from public.kitsune_profiles),
      'playlists', (select count(*) from public.kitsune_playlists where visibility = 'public')
    )
  );
$$;

-- The division ladder in js/lib/ranks.js:191, so a cloud board and a device
-- board call the same number of wins by the same name.
create or replace function public.kitsune_division(p_wins integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_wins, 0) >= 240 then 7
    when coalesce(p_wins, 0) >= 160 then 6
    when coalesce(p_wins, 0) >= 100 then 5
    when coalesce(p_wins, 0) >= 60  then 4
    when coalesce(p_wins, 0) >= 30  then 3
    when coalesce(p_wins, 0) >= 15  then 2
    when coalesce(p_wins, 0) >= 5   then 1
    when coalesce(p_wins, 0) >= 1   then 0
    else -1
  end;
$$;

-- js/lib/device.js:1670: division, then the best card, then wins, then win rate,
-- then the streak, then the handle. Only members who have fought appear.
create or replace function public.kitsune_ranked(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(x.o order by x.rnk)
        from (
          select row_number() over (
                   order by public.kitsune_division(coalesce((p.duel ->> 'wins')::int, 0)) desc,
                            coalesce((p.cards ->> 'best')::int, 0) desc,
                            coalesce((p.duel ->> 'wins')::int, 0) desc,
                            (coalesce((p.duel ->> 'wins')::int, 0))::numeric
                              / greatest(1, coalesce((p.duel ->> 'fought')::int, 0)) desc,
                            coalesce((p.duel ->> 'streak')::int, 0) desc,
                            lower(p.username)
                 ) as rnk,
                 to_jsonb(p) - 'is_staff' || jsonb_build_object(
                   'place', row_number() over (
                     order by public.kitsune_division(coalesce((p.duel ->> 'wins')::int, 0)) desc,
                              coalesce((p.cards ->> 'best')::int, 0) desc,
                              coalesce((p.duel ->> 'wins')::int, 0) desc,
                              (coalesce((p.duel ->> 'wins')::int, 0))::numeric
                                / greatest(1, coalesce((p.duel ->> 'fought')::int, 0)) desc,
                              coalesce((p.duel ->> 'streak')::int, 0) desc,
                              lower(p.username)
                   ),
                   'winRate', round(100.0 * coalesce((p.duel ->> 'wins')::int, 0)
                                    / greatest(1, coalesce((p.duel ->> 'fought')::int, 0)), 1)
                 ) as o
            from public.kitsune_profiles p
           where p.username is not null
             and not p.is_staff
             and coalesce((p.duel ->> 'fought')::int, 0) > 0
        ) x
       order by x.rnk
       limit greatest(1, least(50, coalesce(p_limit, 20)))
    ), '[]'::jsonb),
    'me', (
      select y.o
        from (
          select p.id,
                 to_jsonb(p) || jsonb_build_object(
                   'place', row_number() over (
                     order by public.kitsune_division(coalesce((p.duel ->> 'wins')::int, 0)) desc,
                              coalesce((p.cards ->> 'best')::int, 0) desc,
                              coalesce((p.duel ->> 'wins')::int, 0) desc,
                              (coalesce((p.duel ->> 'wins')::int, 0))::numeric
                                / greatest(1, coalesce((p.duel ->> 'fought')::int, 0)) desc,
                              coalesce((p.duel ->> 'streak')::int, 0) desc,
                              lower(p.username)
                   ),
                   'winRate', round(100.0 * coalesce((p.duel ->> 'wins')::int, 0)
                                    / greatest(1, coalesce((p.duel ->> 'fought')::int, 0)), 1)
                 ) as o
            from public.kitsune_profiles p
           where p.username is not null
             and coalesce((p.duel ->> 'fought')::int, 0) > 0
        ) y
       where y.id = auth.uid()
    ),
    'totals', jsonb_build_object(
      'members',   (select count(*) from public.kitsune_profiles),
      'duellists', (select count(*) from public.kitsune_profiles
                     where coalesce((duel ->> 'fought')::int, 0) > 0),
      'fights',    (select coalesce(sum((duel ->> 'fought')::int), 0) from public.kitsune_profiles),
      'runs',      (select coalesce(max((duel ->> 'best')::int), 0) from public.kitsune_profiles)
    )
  );
$$;

-- Trending playlists. toPlaylist() reads row.kitsune_profiles.display_name, so
-- the owner rides along inside each object under exactly that key.
create or replace function public.kitsune_trending()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    to_jsonb(pl) || jsonb_build_object(
      'kitsune_profiles', jsonb_build_object('display_name', o.display_name, 'username', o.username)
    ) order by pl.like_count desc, pl.created_at desc
  ), '[]'::jsonb)
    from public.kitsune_playlists pl
    join public.kitsune_profiles o on o.id = pl.owner
   where pl.visibility = 'public';
$$;

create or replace function public.kitsune_my_likes()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('playlist', l.playlist)), '[]'::jsonb)
    from public.kitsune_likes l
   where l.usr = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 13. playlist writes — the owner only, and a private list stays invisible
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_playlist_update(
  p_playlist   uuid,
  p_title      text,
  p_items      jsonb,
  p_visibility text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  row public.kitsune_playlists%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into row from public.kitsune_playlists where id = p_playlist;
  if row.id is null then
    raise exception 'playlist is gone';
  end if;
  if row.owner <> uid then
    raise exception 'not authorized: that playlist belongs to somebody else';
  end if;

  update public.kitsune_playlists
     set title      = left(coalesce(p_title, title), 80),
         items      = coalesce(p_items, items),
         visibility = case when p_visibility in ('public', 'private') then p_visibility
                           else visibility end
   where id = p_playlist
  returning * into row;

  return to_jsonb(row);
end;
$$;

create or replace function public.kitsune_toggle_like(p_playlist uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  pl  public.kitsune_playlists%rowtype;
begin
  if uid is null then
    raise exception 'Please sign in first.';
  end if;
  select * into pl from public.kitsune_playlists where id = p_playlist;
  if pl.id is null then
    raise exception 'playlist is gone';
  end if;
  if pl.visibility = 'private' and pl.owner <> uid then
    raise exception 'playlist is private';
  end if;

  if exists (select 1 from public.kitsune_likes where usr = uid and playlist = p_playlist) then
    delete from public.kitsune_likes where usr = uid and playlist = p_playlist;
    update public.kitsune_playlists set like_count = greatest(0, like_count - 1)
     where id = p_playlist returning * into pl;
  else
    insert into public.kitsune_likes (usr, playlist) values (uid, p_playlist) on conflict do nothing;
    update public.kitsune_playlists set like_count = like_count + 1
     where id = p_playlist returning * into pl;
  end if;

  return to_jsonb(pl);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. traffic: one anonymous beat per page view, one named beat per member
--
-- kitsune_visit() takes a path and nothing that identifies anyone. An anonymous
-- visitor may call it, because a first-time visitor is exactly who is being
-- counted; the function is security definer so the table keeps no anon insert
-- policy and stays closed.
--
-- kitsune_online() requires a session, so an anonymous visitor can never put a
-- name on the presence table.
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_visit(p_path text, p_via text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.kitsune_visits (path, via)
  values (left(coalesce(p_path, ''), 120), left(coalesce(p_via, ''), 120));
  return true;
end;
$$;

create or replace function public.kitsune_online(p_path text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return false;
  end if;
  insert into public.kitsune_presence (usr, username, display_name, path, at)
  select uid, p.username, p.display_name, left(coalesce(p_path, ''), 120), now()
    from public.kitsune_profiles p where p.id = uid
  on conflict (usr) do update
     set username     = excluded.username,
         display_name = excluded.display_name,
         path         = excluded.path,
         at           = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. the admin desk, in one call — the only function that answers "who is here"
--
-- It refuses before it reads anything, so a stranger holding the publishable key
-- gets an empty object rather than a member list. Every number comes from the two
-- traffic tables rather than from the browser asking. No geography anywhere in it:
-- a handle, a page and a time, which is all "who is watching" needs to be.
--
-- Volatile because it also trims: rows older than 90 days (visits) and 7 days
-- (presence) are dropped in the same call, so the tables stay small without a
-- scheduled job.
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_analytics()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  out jsonb;
begin
  if not public.kitsune_is_admin() then
    return jsonb_build_object('ok', false, 'error', 'Please sign in first.');
  end if;

  delete from public.kitsune_visits   where at < now() - interval '90 days';
  delete from public.kitsune_presence where at < now() - interval '7 days';

  select jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'visits',   (select count(*) from public.kitsune_visits),
      'day',      (select count(*) from public.kitsune_visits where at >= now() - interval '24 hours'),
      'week',     (select count(*) from public.kitsune_visits where at >= now() - interval '7 days'),
      'month',    (select count(*) from public.kitsune_visits where at >= now() - interval '30 days'),
      'members',  (select count(*) from public.kitsune_profiles where username is not null),
      'new_week', (select count(*) from public.kitsune_profiles
                    where created_at >= now() - interval '7 days'),
      'online',   (select count(*) from public.kitsune_presence
                    where at >= now() - interval '5 minutes')
    ),
    -- Who is here right now. Signed-in members only.
    'online_list', coalesce((
      select jsonb_agg(jsonb_build_object(
               'username',    pr.username,
               'displayName', pr.display_name,
               'path',        pr.path,
               'at',          extract(epoch from pr.at) * 1000
             ) order by pr.at desc)
        from public.kitsune_presence pr
       where pr.at >= now() - interval '5 minutes'
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'username',    pr.username,
               'displayName', pr.display_name,
               'path',        pr.path,
               'at',          extract(epoch from pr.at) * 1000
             ) order by pr.at desc)
        from (select * from public.kitsune_presence order by at desc limit 60) pr
    ), '[]'::jsonb),
    -- Visits per day for the traffic strip, and which pages carried them.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('d', to_char(x.d, 'MM-DD'), 'n', x.n) order by x.d)
        from (
          select date_trunc('day', at) as d, count(*) as n
            from public.kitsune_visits
           where at >= now() - interval '7 days'
           group by 1
        ) x
    ), '[]'::jsonb),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', v.path, 'n', v.n) order by v.n desc)
        from (
          select coalesce(nullif(path, ''), '/') as path, count(*) as n
            from public.kitsune_visits
           where at >= now() - interval '7 days'
           group by 1
           order by 2 desc
           limit 12
        ) v
    ), '[]'::jsonb)
  ) into out;

  return out;
end;
$$;

-- ---------------------------------------------------------------------------
-- 16. the Super Admin roster — gated by the same function as everything else
-- ---------------------------------------------------------------------------

create or replace function public.kitsune_core_roster()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when public.kitsune_is_admin() then
    jsonb_build_object('users', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          p.id,
               'username',    p.username,
               'displayName', coalesce(p.display_name, p.username),
               'email',       u.email,
               'level',       coalesce((c.xp ->> 'level')::int, 1),
               'xp',          coalesce((c.xp ->> 'xp')::int, 0),
               'cards',       coalesce((p.cards ->> 'best')::int, 0),
               'packs',       coalesce((select count(*) from jsonb_object_keys(coalesce(c.packs, '{}'::jsonb))), 0),
               'pulls',       coalesce((p.cards ->> 'pulls')::int, 0),
               'updatedAt',   extract(epoch from coalesce(c.updated_at, p.created_at)) * 1000,
               'createdAt',   extract(epoch from p.created_at) * 1000
             ) order by p.created_at desc)
        from public.kitsune_profiles p
        left join public.kitsune_cores c on c.id = p.id
        left join auth.users u           on u.id = p.id
    ), '[]'::jsonb))
  else jsonb_build_object('users', '[]'::jsonb) end;
$$;

-- ---------------------------------------------------------------------------
-- 17. row-level security
--
-- Off by default, then opened one read at a time. A member writes their own row;
-- an anonymous visitor reads what the site already shows them; the two traffic
-- tables grant nothing at all and are reachable only through the functions above.
-- ---------------------------------------------------------------------------

alter table public.kitsune_profiles  enable row level security;
alter table public.kitsune_cores     enable row level security;
alter table public.kitsune_playlists enable row level security;
alter table public.kitsune_likes     enable row level security;
alter table public.kitsune_visits    enable row level security;
alter table public.kitsune_presence  enable row level security;

drop policy if exists kitsune_profiles_read on public.kitsune_profiles;
create policy kitsune_profiles_read
  on public.kitsune_profiles for select
  to anon, authenticated
  using (true);

drop policy if exists kitsune_profiles_write_own on public.kitsune_profiles;
create policy kitsune_profiles_write_own
  on public.kitsune_profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists kitsune_cores_read_own on public.kitsune_cores;
create policy kitsune_cores_read_own
  on public.kitsune_cores for select
  to authenticated
  using (id = auth.uid());

drop policy if exists kitsune_cores_write_own on public.kitsune_cores;
create policy kitsune_cores_write_own
  on public.kitsune_cores for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists kitsune_cores_update_own on public.kitsune_cores;
create policy kitsune_cores_update_own
  on public.kitsune_cores for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists kitsune_playlists_read_public on public.kitsune_playlists;
create policy kitsune_playlists_read_public
  on public.kitsune_playlists for select
  to anon, authenticated
  using (visibility = 'public' or owner = auth.uid());

drop policy if exists kitsune_playlists_own on public.kitsune_playlists;
create policy kitsune_playlists_own
  on public.kitsune_playlists for all
  to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

-- A like is between the member and the site: the count is public, the list is not.
drop policy if exists kitsune_likes_own on public.kitsune_likes;
create policy kitsune_likes_own
  on public.kitsune_likes for all
  to authenticated
  using (usr = auth.uid())
  with check (usr = auth.uid());

-- No policy on kitsune_visits or kitsune_presence at all: security definer
-- functions are the only way in, and kitsune_analytics() is the only way out.

-- ---------------------------------------------------------------------------
-- 18. who may execute what
--
-- The publishable key ships inside a public bundle, so this grant list is the
-- second lock. The boards, the schema check and the visit beat stay open to anon
-- on purpose; every writer is authenticated only, and the two desk functions are
-- gated again inside SQL.
-- ---------------------------------------------------------------------------

grant execute on function public.kitsune_ready()                to anon, authenticated;
grant execute on function public.kitsune_visit(text, text)       to anon, authenticated;
grant execute on function public.kitsune_collectors(integer)     to anon, authenticated;
grant execute on function public.kitsune_leaderboard(integer)    to anon, authenticated;
grant execute on function public.kitsune_ranked(integer)         to anon, authenticated;
grant execute on function public.kitsune_trending()              to anon, authenticated;
grant execute on function public.kitsune_profile(uuid)           to anon, authenticated;

revoke all on function public.kitsune_join(text)                                          from public;
grant  execute on function public.kitsune_join(text)                                       to authenticated;
revoke all on function public.kitsune_profile_update(text, text, jsonb, jsonb)            from public;
grant  execute on function public.kitsune_profile_update(text, text, jsonb, jsonb)         to authenticated;
revoke all on function public.kitsune_stats(integer, integer, integer, integer, jsonb, jsonb) from public;
grant  execute on function public.kitsune_stats(integer, integer, integer, integer, jsonb, jsonb) to authenticated;
grant  execute on function public.kitsune_core_get()                                       to authenticated;
grant  execute on function public.kitsune_core_put(jsonb, jsonb, jsonb, bigint)             to authenticated;
grant  execute on function public.kitsune_my_likes()                                       to authenticated;
grant  execute on function public.kitsune_toggle_like(uuid)                                to authenticated;
grant  execute on function public.kitsune_playlist_update(uuid, text, jsonb, text)          to authenticated;
grant  execute on function public.kitsune_online(text)                                     to authenticated;
revoke all on function public.kitsune_analytics()                                          from public;
grant  execute on function public.kitsune_analytics()                                       to authenticated;
revoke all on function public.kitsune_core_roster()                                        from public;
grant  execute on function public.kitsune_core_roster()                                     to authenticated;

-- ---------------------------------------------------------------------------
-- 19. done — the two checks the site itself will make for you
--
--   * Settings ▸ Cloud answers "Connected" — that is kitsune_ready() returning
--     true, and it is what moves sign-up from localStorage to a real account.
--   * Open the leaderboard in a second browser (or a phone) and the same member
--     is on it. That is the board being real.
--
-- If the run stops on `auth.users`, the project was created without Auth: switch
-- it on in the dashboard and run the file again from section 1.
-- ===========================================================================
