-- =====================================================================
-- Friendly Games — database schema for Supabase (free tier).
-- Every object is prefixed fg_ so it can live safely inside a Supabase
-- project that already hosts another app.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- Design:
--   * All coin movements happen inside SECURITY DEFINER functions, so nobody
--     can edit balances or bets directly from the browser.
--   * Row-level security makes every group's data visible to its members only.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables
create table if not exists public.fg_profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  created_at timestamptz not null default now()
);
alter table public.fg_profiles add column if not exists is_super boolean not null default false;

create table if not exists public.fg_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  starting_balance numeric(12,2) not null default 1000 check (starting_balance between 10 and 1000000),
  created_by uuid not null references public.fg_profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.fg_members (
  group_id uuid not null references public.fg_groups on delete cascade,
  user_id uuid not null references public.fg_profiles on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  balance numeric(12,2) not null check (balance >= 0),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.fg_events (
  id text primary key,                               -- 'espn:<league>:<event>:<comp>' or 'custom:<uuid>'
  group_id uuid references public.fg_groups on delete cascade, -- set only for custom (group-made) events
  sport text not null,
  league_key text not null,
  league text not null,
  name text not null,
  home jsonb not null,                               -- {name, short, logo}
  away jsonb not null,
  allow_draw boolean not null default false,
  base_probs numeric[] not null,                     -- [home, away, draw]
  start_time timestamptz not null,
  result text check (result in ('home','away','draw','void')),
  home_score text,
  away_score text,
  settled_at timestamptz,
  settled_by uuid references public.fg_profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.fg_bets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.fg_groups on delete cascade,
  user_id uuid not null references public.fg_profiles on delete cascade,
  event_id text not null references public.fg_events on delete cascade,
  pick text not null check (pick in ('home','away','draw')),
  stake numeric(12,2) not null check (stake > 0),
  odds numeric(8,2) not null check (odds >= 1.01),
  status text not null default 'open' check (status in ('open','won','lost','void')),
  payout numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists fg_bets_group_idx on public.fg_bets (group_id, created_at desc);
create index if not exists fg_bets_event_idx on public.fg_bets (event_id) where status = 'open';

create table if not exists public.fg_challenges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.fg_groups on delete cascade,
  event_id text not null references public.fg_events on delete cascade,
  creator_id uuid not null references public.fg_profiles on delete cascade,
  pick text not null check (pick in ('home','away','draw')),
  odds numeric(8,2) not null check (odds between 1.01 and 50),
  stake numeric(12,2) not null check (stake > 0),
  taker_stake numeric(12,2) not null check (taker_stake > 0),
  target_id uuid references public.fg_profiles on delete cascade,
  taker_id uuid references public.fg_profiles on delete set null,
  status text not null default 'open' check (status in ('open','matched','settled','void','cancelled')),
  winner_id uuid references public.fg_profiles on delete set null,
  message text check (char_length(message) <= 140),
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  settled_at timestamptz
);
-- live betting & cash out
create table if not exists public.fg_secrets (key text primary key, value text not null);
alter table public.fg_secrets enable row level security;
revoke all on public.fg_secrets from anon, authenticated;
alter table public.fg_groups add column if not exists live_betting boolean not null default true;
alter table public.fg_events add column if not exists live_score text;
alter table public.fg_events add column if not exists live_score_at timestamptz;
alter table public.fg_bets add column if not exists live boolean not null default false;
alter table public.fg_bets add column if not exists quote_score text;
alter table public.fg_bets add column if not exists cashout_value numeric(12,2);
alter table public.fg_bets add column if not exists cashout_requested_at timestamptz;
alter table public.fg_bets add column if not exists cashout_score text;
alter table public.fg_bets drop constraint if exists fg_bets_status_check;
alter table public.fg_bets add constraint fg_bets_status_check check (status in ('pending','open','won','lost','void','cashed'));
create index if not exists fg_bets_pending_idx on public.fg_bets (event_id) where status = 'pending' or cashout_requested_at is not null;

create index if not exists fg_challenges_group_idx on public.fg_challenges (group_id, created_at desc);
create index if not exists fg_challenges_event_idx on public.fg_challenges (event_id) where status in ('open','matched');

-- ---------------------------------------------------------------- helpers
-- Older function signatures replaced by versions that accept a signed live quote.
drop function if exists public.fg_place_bet(uuid, jsonb, text, numeric);
drop function if exists public.fg_create_challenge(uuid, jsonb, text, numeric, numeric, uuid, text);
drop function if exists public.fg_accept_challenge(uuid);
drop function if exists public.fg_settle_event(text, text, text, text);

-- Site admins (fg_profiles.is_super) see every group, player and bet, and have admin rights in every group.
-- Promote someone with:  update public.fg_profiles set is_super = true where username = '<name>';
create or replace function public.fg_is_super()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super from fg_profiles where id = auth.uid()), false);
$$;

create or replace function public.fg_is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select fg_is_super() or exists (select 1 from fg_members where group_id = p_group and user_id = auth.uid());
$$;

create or replace function public.fg_is_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select fg_is_super() or exists (select 1 from fg_members where group_id = p_group and user_id = auth.uid() and role = 'admin');
$$;

-- Creates a Friendly Games login (username + password) that is ready to use
-- immediately — no confirmation email, and no project-wide auth setting to change.
create or replace function public.fg_sign_up(p_username text, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_u text := lower(trim(p_username));
  v_id uuid := gen_random_uuid();
  v_email text;
begin
  if v_u is null or v_u !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Username must be 3–20 characters: letters, numbers, _ or .';
  end if;
  if char_length(coalesce(p_password, '')) < 6 then raise exception 'Password must be at least 6 characters.'; end if;
  v_email := v_u || '@players.friendlygames.app';
  if exists (select 1 from fg_profiles where username = v_u) or exists (select 1 from auth.users where email = v_email) then
    raise exception 'That username is taken.';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('fg_username', v_u), now(), now(),
          '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into fg_profiles (id, username) values (v_id, v_u);
end $$;

-- Lets the sign-up form say "username taken" before creating an account.
create or replace function public.fg_username_taken(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fg_profiles where username = lower(trim(p_username)));
$$;

-- The "house line": base probabilities, shifted by how the group has bet.
-- Mirrors computeLine() in src/lib/odds.ts.
create or replace function public.fg_compute_line(p_event_id text, p_group uuid)
returns numeric[] language plpgsql stable security definer set search_path = public as $$
declare
  e fg_events;
  b numeric[];
  bs numeric;
  s1 numeric; s2 numeric; s3 numeric;
  s numeric[];
  tot numeric;
  res numeric[] := array[0,0,0];
  n int;
  liquidity constant numeric := 1000;
begin
  select * into e from fg_events where id = p_event_id;
  if not found then return null; end if;
  n := case when e.allow_draw then 3 else 2 end;
  b := array[greatest(e.base_probs[1], 0.01), greatest(e.base_probs[2], 0.01),
             case when e.allow_draw then greatest(coalesce(e.base_probs[3], 0), 0.01) else 0 end];
  bs := b[1] + b[2] + b[3];
  select coalesce(sum(stake) filter (where pick = 'home'), 0),
         coalesce(sum(stake) filter (where pick = 'away'), 0),
         coalesce(sum(stake) filter (where pick = 'draw'), 0)
    into s1, s2, s3
    from fg_bets where event_id = p_event_id and group_id = p_group and status <> 'void';
  s := array[s1, s2, s3];
  tot := s[1] + s[2] + case when n = 3 then s[3] else 0 end;
  for i in 1..n loop
    res[i] := round(least(50, greatest(1.01, 1 / ((b[i] / bs * liquidity + s[i]) / (liquidity + tot)))), 2);
  end loop;
  return res;
end $$;

-- Store (or refresh) a real-world event snapshot sent by the app.
create or replace function public.fg_ensure_event(p_event jsonb, p_group uuid)
returns fg_events language plpgsql security definer set search_path = public as $$
declare
  e fg_events;
  v_id text := p_event->>'id';
  v_probs numeric[];
  v_draw boolean := coalesce((p_event->>'allowDraw')::boolean, false);
begin
  if v_id like 'custom:%' then
    select * into e from fg_events where id = v_id;
    if not found or e.group_id is distinct from p_group then raise exception 'Unknown event'; end if;
    return e;
  end if;
  if v_id is null or v_id not like 'espn:%' then raise exception 'Unknown event'; end if;
  if p_event->>'startTime' is null then
    select * into e from fg_events where id = v_id;
    if not found then raise exception 'Unknown event'; end if;
    return e;
  end if;

  select array_agg(least(1, greatest(0, x::numeric))) into v_probs
    from jsonb_array_elements_text(p_event->'baseProbs') x;
  if v_probs is null or array_length(v_probs, 1) <> 3 then v_probs := array[0.5, 0.5, 0]; end if;

  insert into fg_events (id, sport, league_key, league, name, home, away, allow_draw, base_probs, start_time)
  values (v_id,
          left(coalesce(p_event->>'sport', 'other'), 40),
          left(coalesce(p_event->>'leagueKey', ''), 80),
          left(coalesce(p_event->>'league', ''), 80),
          left(coalesce(p_event->>'name', ''), 160),
          coalesce(p_event->'home', '{}'::jsonb),
          coalesce(p_event->'away', '{}'::jsonb),
          v_draw, v_probs,
          (p_event->>'startTime')::timestamptz)
  on conflict (id) do update
    -- keep kick-off time fresh if a fixture is rescheduled (only while unsettled)
    set start_time = excluded.start_time
    where fg_events.settled_at is null and excluded.start_time > now()
  returning * into e;
  if e.id is null then select * into e from fg_events where id = v_id; end if;
  return e;
end $$;

-- ---------------------------------------------------------------- groups
create or replace function public.fg_create_group(p_name text, p_starting_balance numeric default 1000)
returns fg_groups language plpgsql security definer set search_path = public as $$
declare g fg_groups; v_code text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  loop
    v_code := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when char_length(v_code) = 6 and not exists (select 1 from fg_groups where invite_code = v_code);
  end loop;
  insert into fg_groups (name, invite_code, starting_balance, created_by)
  values (trim(p_name), v_code, coalesce(p_starting_balance, 1000), auth.uid()) returning * into g;
  insert into fg_members (group_id, user_id, role, balance) values (g.id, auth.uid(), 'admin', g.starting_balance);
  return g;
end $$;

create or replace function public.fg_join_group(p_code text)
returns fg_groups language plpgsql security definer set search_path = public as $$
declare g fg_groups;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into g from fg_groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'No group found with that invite code'; end if;
  insert into fg_members (group_id, user_id, role, balance)
  values (g.id, auth.uid(), 'member', g.starting_balance)
  on conflict do nothing;
  return g;
end $$;

-- ---------------------------------------------------------------- betting
create or replace function public.fg_place_bet(p_group uuid, p_event jsonb, p_pick text, p_stake numeric, p_quote jsonb default null)
returns fg_bets language plpgsql security definer set search_path = public as $$
declare m fg_members; e fg_events; line numeric[]; b fg_bets; v jsonb; v_odds numeric; v_idx int;
begin
  select * into m from fg_members where group_id = p_group and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  p_stake := round(p_stake, 2);
  if p_stake is null or p_stake < 1 then raise exception 'Minimum stake is 1 coin'; end if;
  if m.balance < p_stake then raise exception 'Not enough coins — your balance is %', m.balance; end if;

  e := fg_ensure_event(p_event, p_group);
  if e.settled_at is not null then raise exception 'Betting has closed for this event'; end if;
  if p_pick not in ('home', 'away') and not (p_pick = 'draw' and e.allow_draw) then raise exception 'Invalid selection'; end if;
  v_idx := case p_pick when 'home' then 1 when 'away' then 2 else 3 end;

  if e.start_time > now() then
    -- pre-match: the group line, locked in now
    line := fg_compute_line(e.id, p_group);
    insert into fg_bets (group_id, user_id, event_id, pick, stake, odds)
    values (p_group, auth.uid(), e.id, p_pick, p_stake, line[v_idx])
    returning * into b;
  else
    -- in-play: the live bookmaker price from a signed quote; confirmed after 30s if the score holds
    if e.group_id is not null then raise exception 'Betting has closed for this event'; end if;
    if not exists (select 1 from fg_groups where id = p_group and live_betting) then
      raise exception 'Live betting is turned off in this group';
    end if;
    v := fg_verify_quote(p_quote, e.id, 20);
    if v->>'state' <> 'in' or not coalesce((v->>'liveOpen')::boolean, false) then
      raise exception 'Live betting is closed for this match';
    end if;
    v_odds := (v->'odds'->>(v_idx - 1))::numeric;
    if v_odds is null or v_odds < 1.01 then raise exception 'No live price for that selection right now'; end if;
    if fg_apply_quote(e.id, v) then raise exception 'The score just changed — live betting reopens in a minute'; end if;
    insert into fg_bets (group_id, user_id, event_id, pick, stake, odds, status, live, quote_score)
    values (p_group, auth.uid(), e.id, p_pick, p_stake, round(least(v_odds, 1000), 2), 'pending', true, v->>'score')
    returning * into b;
  end if;
  update fg_members set balance = balance - p_stake where group_id = p_group and user_id = auth.uid();
  return b;
end $$;

-- Checks that an event is still open for challenges: before the start, or in-play with a fresh signed quote.
create or replace function public.fg_challenge_window(e fg_events, p_group uuid, p_quote jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if e.settled_at is not null then raise exception 'Betting has closed for this event'; end if;
  if e.start_time > now() then return; end if;
  if e.group_id is not null then raise exception 'Betting has closed for this event'; end if;
  if not exists (select 1 from fg_groups where id = p_group and live_betting) then
    raise exception 'Betting has closed for this event (live betting is off in this group)';
  end if;
  v := fg_verify_quote(p_quote, e.id, 20);
  if v->>'state' <> 'in' or not coalesce((v->>'challengeOpen')::boolean, false) then
    raise exception 'In-play challenges are closed for this match';
  end if;
  if fg_apply_quote(e.id, v) then raise exception 'The score just changed — try again in a minute'; end if;
end $$;

create or replace function public.fg_create_challenge(
  p_group uuid, p_event jsonb, p_pick text, p_odds numeric, p_stake numeric,
  p_target uuid default null, p_message text default null, p_quote jsonb default null)
returns fg_challenges language plpgsql security definer set search_path = public as $$
declare m fg_members; e fg_events; c fg_challenges;
begin
  select * into m from fg_members where group_id = p_group and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  p_stake := round(p_stake, 2);
  p_odds := round(p_odds, 2);
  if p_stake is null or p_stake < 1 then raise exception 'Minimum stake is 1 coin'; end if;
  if p_odds is null or p_odds < 1.01 or p_odds > 50 then raise exception 'Odds must be between 1.01 and 50'; end if;
  if m.balance < p_stake then raise exception 'Not enough coins — your balance is %', m.balance; end if;
  if p_target is not null and (p_target = auth.uid()
     or not exists (select 1 from fg_members where group_id = p_group and user_id = p_target)) then
    raise exception 'You can only challenge another member of this group';
  end if;

  e := fg_ensure_event(p_event, p_group);
  perform fg_challenge_window(e, p_group, p_quote);
  if p_pick not in ('home', 'away') and not (p_pick = 'draw' and e.allow_draw) then raise exception 'Invalid selection'; end if;

  insert into fg_challenges (group_id, event_id, creator_id, pick, odds, stake, taker_stake, target_id, message)
  values (p_group, e.id, auth.uid(), p_pick, p_odds, p_stake, greatest(0.01, round(p_stake * (p_odds - 1), 2)),
          p_target, nullif(left(trim(coalesce(p_message, '')), 140), ''))
  returning * into c;
  update fg_members set balance = balance - p_stake where group_id = p_group and user_id = auth.uid();
  return c;
end $$;

create or replace function public.fg_accept_challenge(p_id uuid, p_quote jsonb default null)
returns fg_challenges language plpgsql security definer set search_path = public as $$
declare c fg_challenges; m fg_members; e fg_events;
begin
  select * into c from fg_challenges where id = p_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.status <> 'open' then raise exception 'This challenge is no longer open'; end if;
  if c.creator_id = auth.uid() then raise exception 'You cannot accept your own challenge'; end if;
  if c.target_id is not null and c.target_id <> auth.uid() then raise exception 'This challenge was sent to someone else'; end if;
  select * into e from fg_events where id = c.event_id;
  perform fg_challenge_window(e, c.group_id, p_quote);
  select * into m from fg_members where group_id = c.group_id and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  if m.balance < c.taker_stake then raise exception 'You need % coins to accept — your balance is %', c.taker_stake, m.balance; end if;

  update fg_members set balance = balance - c.taker_stake where group_id = c.group_id and user_id = auth.uid();
  update fg_challenges set taker_id = auth.uid(), status = 'matched', matched_at = now() where id = p_id returning * into c;
  return c;
end $$;

create or replace function public.fg_cancel_challenge(p_id uuid)
returns fg_challenges language plpgsql security definer set search_path = public as $$
declare c fg_challenges;
begin
  select * into c from fg_challenges where id = p_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.status <> 'open' then raise exception 'Only open challenges can be cancelled'; end if;
  if c.creator_id <> auth.uid() and not fg_is_admin(c.group_id) then raise exception 'Only the creator can cancel this'; end if;
  update fg_members set balance = balance + c.stake where group_id = c.group_id and user_id = c.creator_id;
  update fg_challenges set status = 'cancelled', settled_at = now() where id = p_id returning * into c;
  return c;
end $$;

-- ---------------------------------------------------------------- settlement
-- Called by the app as soon as it sees a final result from the live feed.
-- Real events: any signed-in member can trigger it once the event has started.
-- Custom (group-made) events: group admins only.
create or replace function public.fg_settle_event(p_event_id text, p_result text default null, p_home_score text default null, p_away_score text default null, p_quote jsonb default null)
returns fg_events language plpgsql security definer set search_path = public as $$
declare e fg_events; v jsonb;
begin
  select * into e from fg_events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if e.settled_at is not null then return e; end if;

  if e.group_id is not null then
    if auth.uid() is null or not fg_is_admin(e.group_id) then raise exception 'Only group admins can settle custom events'; end if;
  else
    -- real matches settle only on a server-signed final result (from the app or the every-minute job)
    v := fg_verify_quote(p_quote, p_event_id, 300);
    p_result := v->>'result';
    if p_result is null then raise exception 'This match has not finished yet'; end if;
    p_home_score := v->>'homeScore';
    p_away_score := v->>'awayScore';
  end if;
  if p_result is null or p_result not in ('home','away','draw','void') then raise exception 'Invalid result'; end if;
  if p_result = 'draw' and not e.allow_draw then p_result := 'void'; end if;

  -- 1) straight bets against the group line
  update fg_members gm set balance = gm.balance + x.amt
  from (
    select group_id, user_id,
           sum(case when status = 'pending' or p_result = 'void' then stake when pick = p_result then round(stake * odds, 2) else 0 end) amt
    from fg_bets where event_id = p_event_id and status in ('open', 'pending') group by group_id, user_id
  ) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id and x.amt > 0;

  update fg_bets set
    status = case when status = 'pending' or p_result = 'void' then 'void' when pick = p_result then 'won' else 'lost' end,
    payout = case when status = 'pending' or p_result = 'void' then stake when pick = p_result then round(stake * odds, 2) else 0 end,
    cashout_value = null, cashout_requested_at = null, cashout_score = null,
    settled_at = now()
  where event_id = p_event_id and status in ('open', 'pending');

  -- 2) head-to-head challenges
  update fg_members gm set balance = gm.balance + x.amt
  from (
    select group_id, user_id, sum(amt) amt from (
      -- unmatched challenges are refunded to the creator
      select group_id, creator_id user_id, stake amt from fg_challenges where event_id = p_event_id and status = 'open'
      union all
      -- matched: creator collects everything if their pick wins
      select group_id, creator_id, case when p_result = 'void' then stake when pick = p_result then stake + taker_stake else 0 end
        from fg_challenges where event_id = p_event_id and status = 'matched'
      union all
      -- matched: taker collects everything if the pick loses
      select group_id, taker_id, case when p_result = 'void' then taker_stake when pick <> p_result then stake + taker_stake else 0 end
        from fg_challenges where event_id = p_event_id and status = 'matched'
    ) t group by group_id, user_id
  ) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id and x.amt > 0;

  update fg_challenges set status = 'cancelled', settled_at = now() where event_id = p_event_id and status = 'open';
  update fg_challenges set
    status = case when p_result = 'void' then 'void' else 'settled' end,
    winner_id = case when p_result = 'void' then null when pick = p_result then creator_id else taker_id end,
    settled_at = now()
  where event_id = p_event_id and status = 'matched';

  update fg_events set result = p_result, home_score = p_home_score, away_score = p_away_score,
                    settled_at = now(), settled_by = auth.uid()
  where id = p_event_id returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------- live betting & signed quotes
-- api/quote.ts signs match state (live odds, score, final result) with a secret shared only with this table.
create or replace function public.fg_verify_quote(p_quote jsonb, p_event_id text, p_max_age_s int)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare v_secret text; v_p text := p_quote->>'p'; v jsonb; v_at timestamptz;
begin
  if v_p is null or p_quote->>'sig' is null then raise exception 'A live price is needed for this — please try again'; end if;
  select value into v_secret from fg_secrets where key = 'quote';
  if v_secret is null then raise exception 'Live betting is not configured on this server'; end if;
  if encode(hmac(v_p, v_secret, 'sha256'), 'hex') <> (p_quote->>'sig') then raise exception 'Invalid live price signature'; end if;
  v := v_p::jsonb;
  if v->>'id' is distinct from p_event_id then raise exception 'That live price is for a different match'; end if;
  v_at := to_timestamp((v->>'at')::double precision / 1000);
  if v_at < now() - make_interval(secs => p_max_age_s) or v_at > now() + interval '30 seconds' then
    raise exception 'The live price expired — please try again';
  end if;
  return v;
end $$;

-- Tracks the live score; returns true while betting is paused (60s after a score change).
create or replace function public.fg_apply_quote(p_event_id text, v jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare e fg_events;
begin
  select * into e from fg_events where id = p_event_id for update;
  if not found then return false; end if;
  if v->>'state' = 'in' and e.live_score is distinct from v->>'score' then
    -- first sighting just records the score; a real change starts the pause
    update fg_events set live_score = v->>'score',
      live_score_at = case when e.live_score is null then now() - interval '1 hour' else now() end
    where id = p_event_id;
    return e.live_score is not null;
  end if;
  return coalesce(e.live_score_at > now() - interval '60 seconds', false);
end $$;

create or replace function public.fg_set_live_betting(p_group uuid, p_on boolean)
returns fg_groups language plpgsql security definer set search_path = public as $$
declare g fg_groups;
begin
  if not fg_is_admin(p_group) then raise exception 'Only group admins can change this'; end if;
  update fg_groups set live_betting = coalesce(p_on, true) where id = p_group returning * into g;
  return g;
end $$;

-- Ask to cash out an open bet at the current live price. Confirmed after 30s if the score hasn't changed.
create or replace function public.fg_request_cashout(p_bet uuid, p_quote jsonb)
returns fg_bets language plpgsql security definer set search_path = public as $$
declare b fg_bets; v jsonb; v_odds numeric;
begin
  select * into b from fg_bets where id = p_bet for update;
  if not found or b.user_id <> auth.uid() then raise exception 'Bet not found'; end if;
  if b.status <> 'open' then raise exception 'Only open bets can be cashed out'; end if;
  if b.cashout_requested_at is not null then raise exception 'Cash out already requested — it confirms within a minute'; end if;
  if not exists (select 1 from fg_groups where id = b.group_id and live_betting) then
    raise exception 'Live betting and cash out are turned off in this group';
  end if;
  v := fg_verify_quote(p_quote, b.event_id, 20);
  if v->>'state' <> 'in' then raise exception 'Cash out is only available while the match is live'; end if;
  v_odds := (v->'odds'->>(case b.pick when 'home' then 0 when 'away' then 1 else 2 end))::numeric;
  if v_odds is null or v_odds < 1.01 then raise exception 'No live price right now — try again shortly'; end if;
  if fg_apply_quote(b.event_id, v) then raise exception 'The score just changed — cash out reopens in a minute'; end if;
  update fg_bets set cashout_value = greatest(0.01, round(stake * odds / v_odds, 2)),
                     cashout_requested_at = now(), cashout_score = v->>'score'
  where id = p_bet returning * into b;
  return b;
end $$;

-- Confirms (or rejects) live bets and cash outs that have waited 30s, using a fresh signed quote.
-- Accepted only if the score is unchanged since the request — protects against delayed feeds.
create or replace function public.fg_confirm_pending(p_event_id text, p_quote jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v jsonb; v_cut timestamptz; v_live boolean; n int;
begin
  -- no sign-in needed: only our server can produce the signed quote (api/tick.ts runs this every minute)
  v := fg_verify_quote(p_quote, p_event_id, 30);
  v_cut := to_timestamp((v->>'at')::double precision / 1000) - interval '30 seconds';
  v_live := v->>'state' = 'in';
  perform fg_apply_quote(p_event_id, v);

  update fg_bets set status = 'open'
  where event_id = p_event_id and status = 'pending' and created_at <= v_cut and v_live and quote_score = v->>'score';
  get diagnostics n = row_count;

  update fg_members gm set balance = gm.balance + x.amt
  from (select group_id, user_id, sum(stake) amt from fg_bets
        where event_id = p_event_id and status = 'pending' and created_at <= v_cut group by group_id, user_id) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id;
  update fg_bets set status = 'void', payout = stake, settled_at = now()
  where event_id = p_event_id and status = 'pending' and created_at <= v_cut;

  update fg_members gm set balance = gm.balance + x.amt
  from (select group_id, user_id, sum(cashout_value) amt from fg_bets
        where event_id = p_event_id and status = 'open' and cashout_requested_at <= v_cut and v_live and cashout_score = v->>'score'
        group by group_id, user_id) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id;
  update fg_bets set status = 'cashed', payout = cashout_value, settled_at = now()
  where event_id = p_event_id and status = 'open' and cashout_requested_at <= v_cut and v_live and cashout_score = v->>'score';
  update fg_bets set cashout_value = null, cashout_requested_at = null, cashout_score = null
  where event_id = p_event_id and status = 'open' and cashout_requested_at <= v_cut;
  return n;
end $$;

-- What the every-minute job (api/tick.ts) should look at: live bets/cash outs past their 30s wait,
-- and started real matches that still have open bets or challenges.
create or replace function public.fg_due_events()
returns table (id text, start_time timestamptz, needs_confirm boolean, needs_settle boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.start_time,
    exists (select 1 from fg_bets b where b.event_id = e.id
            and ((b.status = 'pending' and b.created_at <= now() - interval '30 seconds')
              or (b.status = 'open' and b.cashout_requested_at <= now() - interval '30 seconds'))) as needs_confirm,
    e.start_time <= now() - interval '80 minutes'
      and (exists (select 1 from fg_bets b where b.event_id = e.id and b.status in ('open', 'pending'))
        or exists (select 1 from fg_challenges c where c.event_id = e.id and c.status in ('open', 'matched'))) as needs_settle
  from fg_events e
  where e.group_id is null and e.settled_at is null and e.start_time <= now()
    and exists (select 1 from fg_bets b where b.event_id = e.id and (b.status = 'pending' or b.cashout_requested_at is not null)
                union all
                select 1 from fg_bets b where b.event_id = e.id and b.status = 'open' and e.start_time <= now() - interval '80 minutes'
                union all
                select 1 from fg_challenges c where c.event_id = e.id and c.status in ('open', 'matched') and e.start_time <= now() - interval '80 minutes')
  order by e.start_time
  limit 50;
$$;

-- ---------------------------------------------------------------- admin tools
create or replace function public.fg_create_custom_event(
  p_group uuid, p_title text, p_home text, p_away text, p_allow_draw boolean, p_start timestamptz, p_league text default null)
returns fg_events language plpgsql security definer set search_path = public as $$
declare e fg_events;
begin
  if not fg_is_admin(p_group) then raise exception 'Only group admins can create events'; end if;
  if coalesce(trim(p_home), '') = '' or coalesce(trim(p_away), '') = '' then raise exception 'Both sides need a name'; end if;
  if p_start <= now() then raise exception 'Start time must be in the future'; end if;
  insert into fg_events (id, group_id, sport, league_key, league, name, home, away, allow_draw, base_probs, start_time)
  values ('custom:' || gen_random_uuid(), p_group, 'custom', 'custom', left(coalesce(nullif(trim(p_league), ''), 'Group specials'), 80),
          left(coalesce(nullif(trim(p_title), ''), trim(p_home) || ' vs ' || trim(p_away)), 160),
          jsonb_build_object('name', left(trim(p_home), 60), 'short', upper(left(trim(p_home), 3))),
          jsonb_build_object('name', left(trim(p_away), 60), 'short', upper(left(trim(p_away), 3))),
          coalesce(p_allow_draw, false),
          case when p_allow_draw then array[0.37, 0.37, 0.26] else array[0.5, 0.5, 0] end,
          p_start)
  returning * into e;
  return e;
end $$;

create or replace function public.fg_adjust_balance(p_group uuid, p_user uuid, p_amount numeric)
returns fg_members language plpgsql security definer set search_path = public as $$
declare m fg_members;
begin
  if not fg_is_admin(p_group) then raise exception 'Only group admins can adjust balances'; end if;
  update fg_members set balance = balance + round(p_amount, 2)
  where group_id = p_group and user_id = p_user returning * into m;
  if not found then raise exception 'Member not found'; end if;
  return m;
exception when check_violation then
  raise exception 'Balance cannot go below zero';
end $$;

create or replace function public.fg_set_member_role(p_group uuid, p_user uuid, p_role text)
returns fg_members language plpgsql security definer set search_path = public as $$
declare m fg_members;
begin
  if not fg_is_admin(p_group) then raise exception 'Only group admins can change roles'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  if p_role = 'member' and p_user = auth.uid()
     and (select count(*) from fg_members where group_id = p_group and role = 'admin') <= 1 then
    raise exception 'A group needs at least one admin';
  end if;
  update fg_members set role = p_role where group_id = p_group and user_id = p_user returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------- security
alter table public.fg_profiles enable row level security;
alter table public.fg_groups enable row level security;
alter table public.fg_members enable row level security;
alter table public.fg_events enable row level security;
alter table public.fg_bets enable row level security;
alter table public.fg_challenges enable row level security;

drop policy if exists "fg_profiles readable" on public.fg_profiles;
create policy "fg_profiles readable" on public.fg_profiles for select to authenticated using (true);

drop policy if exists "fg_groups for members" on public.fg_groups;
create policy "fg_groups for members" on public.fg_groups for select to authenticated using (public.fg_is_member(id));

drop policy if exists "members for members" on public.fg_members;
create policy "members for members" on public.fg_members for select to authenticated using (public.fg_is_member(group_id));

drop policy if exists "fg_events readable" on public.fg_events;
create policy "fg_events readable" on public.fg_events for select to authenticated
  using (group_id is null or public.fg_is_member(group_id));

drop policy if exists "fg_bets for members" on public.fg_bets;
create policy "fg_bets for members" on public.fg_bets for select to authenticated using (public.fg_is_member(group_id));

drop policy if exists "fg_challenges for members" on public.fg_challenges;
create policy "fg_challenges for members" on public.fg_challenges for select to authenticated using (public.fg_is_member(group_id));

-- No insert/update/delete policies: every write goes through the functions above.
revoke all on function public.fg_is_super(), public.fg_is_member(uuid), public.fg_is_admin(uuid), public.fg_compute_line(text, uuid),
  public.fg_ensure_event(jsonb, uuid), public.fg_verify_quote(jsonb, text, int), public.fg_apply_quote(text, jsonb),
  public.fg_challenge_window(fg_events, uuid, jsonb) from public, anon;
revoke all on function public.fg_ensure_event(jsonb, uuid), public.fg_verify_quote(jsonb, text, int), public.fg_apply_quote(text, jsonb),
  public.fg_challenge_window(fg_events, uuid, jsonb) from authenticated;
revoke all on function public.fg_create_group(text, numeric), public.fg_join_group(text),
  public.fg_place_bet(uuid, jsonb, text, numeric, jsonb),
  public.fg_create_challenge(uuid, jsonb, text, numeric, numeric, uuid, text, jsonb),
  public.fg_accept_challenge(uuid, jsonb), public.fg_cancel_challenge(uuid), public.fg_settle_event(text, text, text, text, jsonb),
  public.fg_create_custom_event(uuid, text, text, text, boolean, timestamptz, text),
  public.fg_adjust_balance(uuid, uuid, numeric), public.fg_set_member_role(uuid, uuid, text),
  public.fg_set_live_betting(uuid, boolean), public.fg_request_cashout(uuid, jsonb), public.fg_confirm_pending(text, jsonb) from public, anon;
grant execute on function public.fg_is_super(), public.fg_is_member(uuid), public.fg_is_admin(uuid), public.fg_compute_line(text, uuid),
  public.fg_create_group(text, numeric), public.fg_join_group(text),
  public.fg_place_bet(uuid, jsonb, text, numeric, jsonb),
  public.fg_create_challenge(uuid, jsonb, text, numeric, numeric, uuid, text, jsonb),
  public.fg_accept_challenge(uuid, jsonb), public.fg_cancel_challenge(uuid), public.fg_settle_event(text, text, text, text, jsonb),
  public.fg_create_custom_event(uuid, text, text, text, boolean, timestamptz, text),
  public.fg_adjust_balance(uuid, uuid, numeric), public.fg_set_member_role(uuid, uuid, text),
  public.fg_set_live_betting(uuid, boolean), public.fg_request_cashout(uuid, jsonb), public.fg_confirm_pending(text, jsonb) to authenticated;
grant execute on function public.fg_username_taken(text) to anon, authenticated;
-- the every-minute job calls these without signing in; each requires a server-signed quote
grant execute on function public.fg_due_events(), public.fg_confirm_pending(text, jsonb), public.fg_settle_event(text, text, text, text, jsonb) to anon;
revoke all on function public.fg_sign_up(text, text) from public;
grant execute on function public.fg_sign_up(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- every-minute job
-- Every 10 seconds: confirms live bets/cash outs and settles finished matches even when nobody has the app open.
-- Replace the URL with your own deployment, then run once:
--   create extension if not exists pg_net;
--   create extension if not exists pg_cron;
--   select cron.schedule('friendly-games-tick', '10 seconds',
--     $job$ select net.http_get(url := 'https://YOUR-SITE.vercel.app/api/tick', timeout_milliseconds := 25000) $job$);
