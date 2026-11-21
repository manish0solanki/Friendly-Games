-- =====================================================================
-- Friendly Games — database schema for Supabase (free tier).
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.
--
-- Design:
--   * All coin movements happen inside SECURITY DEFINER functions, so nobody
--     can edit balances or bets directly from the browser.
--   * Row-level security makes every group's data visible to its members only.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 40),
  invite_code text not null unique,
  starting_balance numeric(12,2) not null default 1000 check (starting_balance between 10 and 1000000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  balance numeric(12,2) not null check (balance >= 0),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.events (
  id text primary key,                               -- 'espn:<league>:<event>:<comp>' or 'custom:<uuid>'
  group_id uuid references public.groups on delete cascade, -- set only for custom (group-made) events
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
  settled_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.bets (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  event_id text not null references public.events on delete cascade,
  pick text not null check (pick in ('home','away','draw')),
  stake numeric(12,2) not null check (stake > 0),
  odds numeric(8,2) not null check (odds >= 1.01),
  status text not null default 'open' check (status in ('open','won','lost','void')),
  payout numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists bets_group_idx on public.bets (group_id, created_at desc);
create index if not exists bets_event_idx on public.bets (event_id) where status = 'open';

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups on delete cascade,
  event_id text not null references public.events on delete cascade,
  creator_id uuid not null references public.profiles on delete cascade,
  pick text not null check (pick in ('home','away','draw')),
  odds numeric(8,2) not null check (odds between 1.01 and 50),
  stake numeric(12,2) not null check (stake > 0),
  taker_stake numeric(12,2) not null check (taker_stake > 0),
  target_id uuid references public.profiles on delete cascade,
  taker_id uuid references public.profiles on delete set null,
  status text not null default 'open' check (status in ('open','matched','settled','void','cancelled')),
  winner_id uuid references public.profiles on delete set null,
  message text check (char_length(message) <= 140),
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  settled_at timestamptz
);
create index if not exists challenges_group_idx on public.challenges (group_id, created_at desc);
create index if not exists challenges_event_idx on public.challenges (event_id) where status in ('open','matched');

-- ---------------------------------------------------------------- helpers
create or replace function public.is_member(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid());
$$;

create or replace function public.is_admin(p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = p_group and user_id = auth.uid() and role = 'admin');
$$;

-- New sign-ups get a profile; the username comes from the sign-up metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Lets the sign-up form say "username taken" before creating an account.
create or replace function public.username_taken(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where username = lower(trim(p_username)));
$$;

-- The "house line": base probabilities, shifted by how the group has bet.
-- Mirrors computeLine() in src/lib/odds.ts.
create or replace function public.compute_line(p_event_id text, p_group uuid)
returns numeric[] language plpgsql stable security definer set search_path = public as $$
declare
  e events;
  b numeric[];
  bs numeric;
  s1 numeric; s2 numeric; s3 numeric;
  s numeric[];
  tot numeric;
  res numeric[] := array[0,0,0];
  n int;
  liquidity constant numeric := 1000;
begin
  select * into e from events where id = p_event_id;
  if not found then return null; end if;
  n := case when e.allow_draw then 3 else 2 end;
  b := array[greatest(e.base_probs[1], 0.01), greatest(e.base_probs[2], 0.01),
             case when e.allow_draw then greatest(coalesce(e.base_probs[3], 0), 0.01) else 0 end];
  bs := b[1] + b[2] + b[3];
  select coalesce(sum(stake) filter (where pick = 'home'), 0),
         coalesce(sum(stake) filter (where pick = 'away'), 0),
         coalesce(sum(stake) filter (where pick = 'draw'), 0)
    into s1, s2, s3
    from bets where event_id = p_event_id and group_id = p_group and status <> 'void';
  s := array[s1, s2, s3];
  tot := s[1] + s[2] + case when n = 3 then s[3] else 0 end;
  for i in 1..n loop
    res[i] := round(least(50, greatest(1.01, 1 / ((b[i] / bs * liquidity + s[i]) / (liquidity + tot)))), 2);
  end loop;
  return res;
end $$;

-- Store (or refresh) a real-world event snapshot sent by the app.
create or replace function public.ensure_event(p_event jsonb, p_group uuid)
returns events language plpgsql security definer set search_path = public as $$
declare
  e events;
  v_id text := p_event->>'id';
  v_probs numeric[];
  v_draw boolean := coalesce((p_event->>'allowDraw')::boolean, false);
begin
  if v_id like 'custom:%' then
    select * into e from events where id = v_id;
    if not found or e.group_id is distinct from p_group then raise exception 'Unknown event'; end if;
    return e;
  end if;
  if v_id is null or v_id not like 'espn:%' then raise exception 'Unknown event'; end if;

  select array_agg(least(1, greatest(0, x::numeric))) into v_probs
    from jsonb_array_elements_text(p_event->'baseProbs') x;
  if v_probs is null or array_length(v_probs, 1) <> 3 then v_probs := array[0.5, 0.5, 0]; end if;

  insert into events (id, sport, league_key, league, name, home, away, allow_draw, base_probs, start_time)
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
    where events.settled_at is null and excluded.start_time > now()
  returning * into e;
  if e.id is null then select * into e from events where id = v_id; end if;
  return e;
end $$;

-- ---------------------------------------------------------------- groups
create or replace function public.create_group(p_name text, p_starting_balance numeric default 1000)
returns groups language plpgsql security definer set search_path = public as $$
declare g groups; v_code text;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  loop
    v_code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when char_length(v_code) = 6 and not exists (select 1 from groups where invite_code = v_code);
  end loop;
  insert into groups (name, invite_code, starting_balance, created_by)
  values (trim(p_name), v_code, coalesce(p_starting_balance, 1000), auth.uid()) returning * into g;
  insert into group_members (group_id, user_id, role, balance) values (g.id, auth.uid(), 'admin', g.starting_balance);
  return g;
end $$;

create or replace function public.join_group(p_code text)
returns groups language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into g from groups where invite_code = upper(trim(p_code));
  if not found then raise exception 'No group found with that invite code'; end if;
  insert into group_members (group_id, user_id, role, balance)
  values (g.id, auth.uid(), 'member', g.starting_balance)
  on conflict do nothing;
  return g;
end $$;

-- ---------------------------------------------------------------- betting
create or replace function public.place_bet(p_group uuid, p_event jsonb, p_pick text, p_stake numeric)
returns bets language plpgsql security definer set search_path = public as $$
declare m group_members; e events; line numeric[]; b bets;
begin
  select * into m from group_members where group_id = p_group and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  p_stake := round(p_stake, 2);
  if p_stake is null or p_stake < 1 then raise exception 'Minimum stake is 1 coin'; end if;
  if m.balance < p_stake then raise exception 'Not enough coins — your balance is %', m.balance; end if;

  e := ensure_event(p_event, p_group);
  if e.settled_at is not null or e.start_time <= now() then raise exception 'Betting has closed for this event'; end if;
  if p_pick not in ('home', 'away') and not (p_pick = 'draw' and e.allow_draw) then raise exception 'Invalid selection'; end if;

  line := compute_line(e.id, p_group);
  insert into bets (group_id, user_id, event_id, pick, stake, odds)
  values (p_group, auth.uid(), e.id, p_pick, p_stake,
          line[case p_pick when 'home' then 1 when 'away' then 2 else 3 end])
  returning * into b;
  update group_members set balance = balance - p_stake where group_id = p_group and user_id = auth.uid();
  return b;
end $$;

create or replace function public.create_challenge(
  p_group uuid, p_event jsonb, p_pick text, p_odds numeric, p_stake numeric,
  p_target uuid default null, p_message text default null)
returns challenges language plpgsql security definer set search_path = public as $$
declare m group_members; e events; c challenges;
begin
  select * into m from group_members where group_id = p_group and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  p_stake := round(p_stake, 2);
  p_odds := round(p_odds, 2);
  if p_stake is null or p_stake < 1 then raise exception 'Minimum stake is 1 coin'; end if;
  if p_odds is null or p_odds < 1.01 or p_odds > 50 then raise exception 'Odds must be between 1.01 and 50'; end if;
  if m.balance < p_stake then raise exception 'Not enough coins — your balance is %', m.balance; end if;
  if p_target is not null and (p_target = auth.uid()
     or not exists (select 1 from group_members where group_id = p_group and user_id = p_target)) then
    raise exception 'You can only challenge another member of this group';
  end if;

  e := ensure_event(p_event, p_group);
  if e.settled_at is not null or e.start_time <= now() then raise exception 'Betting has closed for this event'; end if;
  if p_pick not in ('home', 'away') and not (p_pick = 'draw' and e.allow_draw) then raise exception 'Invalid selection'; end if;

  insert into challenges (group_id, event_id, creator_id, pick, odds, stake, taker_stake, target_id, message)
  values (p_group, e.id, auth.uid(), p_pick, p_odds, p_stake, greatest(0.01, round(p_stake * (p_odds - 1), 2)),
          p_target, nullif(left(trim(coalesce(p_message, '')), 140), ''))
  returning * into c;
  update group_members set balance = balance - p_stake where group_id = p_group and user_id = auth.uid();
  return c;
end $$;

create or replace function public.accept_challenge(p_id uuid)
returns challenges language plpgsql security definer set search_path = public as $$
declare c challenges; m group_members; e events;
begin
  select * into c from challenges where id = p_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.status <> 'open' then raise exception 'This challenge is no longer open'; end if;
  if c.creator_id = auth.uid() then raise exception 'You cannot accept your own challenge'; end if;
  if c.target_id is not null and c.target_id <> auth.uid() then raise exception 'This challenge was sent to someone else'; end if;
  select * into e from events where id = c.event_id;
  if e.settled_at is not null or e.start_time <= now() then raise exception 'Betting has closed for this event'; end if;
  select * into m from group_members where group_id = c.group_id and user_id = auth.uid() for update;
  if not found then raise exception 'You are not a member of this group'; end if;
  if m.balance < c.taker_stake then raise exception 'You need % coins to accept — your balance is %', c.taker_stake, m.balance; end if;

  update group_members set balance = balance - c.taker_stake where group_id = c.group_id and user_id = auth.uid();
  update challenges set taker_id = auth.uid(), status = 'matched', matched_at = now() where id = p_id returning * into c;
  return c;
end $$;

create or replace function public.cancel_challenge(p_id uuid)
returns challenges language plpgsql security definer set search_path = public as $$
declare c challenges;
begin
  select * into c from challenges where id = p_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.status <> 'open' then raise exception 'Only open challenges can be cancelled'; end if;
  if c.creator_id <> auth.uid() and not is_admin(c.group_id) then raise exception 'Only the creator can cancel this'; end if;
  update group_members set balance = balance + c.stake where group_id = c.group_id and user_id = c.creator_id;
  update challenges set status = 'cancelled', settled_at = now() where id = p_id returning * into c;
  return c;
end $$;

-- ---------------------------------------------------------------- settlement
-- Called by the app as soon as it sees a final result from the live feed.
-- Real events: any signed-in member can trigger it once the event has started.
-- Custom (group-made) events: group admins only.
create or replace function public.settle_event(p_event_id text, p_result text, p_home_score text default null, p_away_score text default null)
returns events language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_result not in ('home','away','draw','void') then raise exception 'Invalid result'; end if;
  select * into e from events where id = p_event_id for update;
  if not found then raise exception 'Event not found'; end if;
  if e.settled_at is not null then return e; end if;

  if e.group_id is not null then
    if not is_admin(e.group_id) then raise exception 'Only group admins can settle custom events'; end if;
  else
    if not exists (select 1 from group_members where user_id = auth.uid()) then raise exception 'Not allowed'; end if;
    if e.start_time > now() and p_result <> 'void' then raise exception 'This event has not started yet'; end if;
  end if;
  if p_result = 'draw' and not e.allow_draw then p_result := 'void'; end if;

  -- 1) straight bets against the group line
  update group_members gm set balance = gm.balance + x.amt
  from (
    select group_id, user_id,
           sum(case when p_result = 'void' then stake when pick = p_result then round(stake * odds, 2) else 0 end) amt
    from bets where event_id = p_event_id and status = 'open' group by group_id, user_id
  ) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id and x.amt > 0;

  update bets set
    status = case when p_result = 'void' then 'void' when pick = p_result then 'won' else 'lost' end,
    payout = case when p_result = 'void' then stake when pick = p_result then round(stake * odds, 2) else 0 end,
    settled_at = now()
  where event_id = p_event_id and status = 'open';

  -- 2) head-to-head challenges
  update group_members gm set balance = gm.balance + x.amt
  from (
    select group_id, user_id, sum(amt) amt from (
      -- unmatched challenges are refunded to the creator
      select group_id, creator_id user_id, stake amt from challenges where event_id = p_event_id and status = 'open'
      union all
      -- matched: creator collects everything if their pick wins
      select group_id, creator_id, case when p_result = 'void' then stake when pick = p_result then stake + taker_stake else 0 end
        from challenges where event_id = p_event_id and status = 'matched'
      union all
      -- matched: taker collects everything if the pick loses
      select group_id, taker_id, case when p_result = 'void' then taker_stake when pick <> p_result then stake + taker_stake else 0 end
        from challenges where event_id = p_event_id and status = 'matched'
    ) t group by group_id, user_id
  ) x
  where gm.group_id = x.group_id and gm.user_id = x.user_id and x.amt > 0;

  update challenges set status = 'cancelled', settled_at = now() where event_id = p_event_id and status = 'open';
  update challenges set
    status = case when p_result = 'void' then 'void' else 'settled' end,
    winner_id = case when p_result = 'void' then null when pick = p_result then creator_id else taker_id end,
    settled_at = now()
  where event_id = p_event_id and status = 'matched';

  update events set result = p_result, home_score = p_home_score, away_score = p_away_score,
                    settled_at = now(), settled_by = auth.uid()
  where id = p_event_id returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------- admin tools
create or replace function public.create_custom_event(
  p_group uuid, p_title text, p_home text, p_away text, p_allow_draw boolean, p_start timestamptz, p_league text default null)
returns events language plpgsql security definer set search_path = public as $$
declare e events;
begin
  if not is_admin(p_group) then raise exception 'Only group admins can create events'; end if;
  if coalesce(trim(p_home), '') = '' or coalesce(trim(p_away), '') = '' then raise exception 'Both sides need a name'; end if;
  if p_start <= now() then raise exception 'Start time must be in the future'; end if;
  insert into events (id, group_id, sport, league_key, league, name, home, away, allow_draw, base_probs, start_time)
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

create or replace function public.adjust_balance(p_group uuid, p_user uuid, p_amount numeric)
returns group_members language plpgsql security definer set search_path = public as $$
declare m group_members;
begin
  if not is_admin(p_group) then raise exception 'Only group admins can adjust balances'; end if;
  update group_members set balance = balance + round(p_amount, 2)
  where group_id = p_group and user_id = p_user returning * into m;
  if not found then raise exception 'Member not found'; end if;
  return m;
exception when check_violation then
  raise exception 'Balance cannot go below zero';
end $$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text)
returns group_members language plpgsql security definer set search_path = public as $$
declare m group_members;
begin
  if not is_admin(p_group) then raise exception 'Only group admins can change roles'; end if;
  if p_role not in ('admin', 'member') then raise exception 'Invalid role'; end if;
  if p_role = 'member' and p_user = auth.uid()
     and (select count(*) from group_members where group_id = p_group and role = 'admin') <= 1 then
    raise exception 'A group needs at least one admin';
  end if;
  update group_members set role = p_role where group_id = p_group and user_id = p_user returning * into m;
  return m;
end $$;

-- ---------------------------------------------------------------- security
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.events enable row level security;
alter table public.bets enable row level security;
alter table public.challenges enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select to authenticated using (true);

drop policy if exists "groups for members" on public.groups;
create policy "groups for members" on public.groups for select to authenticated using (public.is_member(id));

drop policy if exists "members for members" on public.group_members;
create policy "members for members" on public.group_members for select to authenticated using (public.is_member(group_id));

drop policy if exists "events readable" on public.events;
create policy "events readable" on public.events for select to authenticated
  using (group_id is null or public.is_member(group_id));

drop policy if exists "bets for members" on public.bets;
create policy "bets for members" on public.bets for select to authenticated using (public.is_member(group_id));

drop policy if exists "challenges for members" on public.challenges;
create policy "challenges for members" on public.challenges for select to authenticated using (public.is_member(group_id));

-- No insert/update/delete policies: every write goes through the functions above.
revoke all on function public.is_member(uuid), public.is_admin(uuid), public.compute_line(text, uuid),
  public.ensure_event(jsonb, uuid), public.handle_new_user() from public, anon;
revoke all on function public.ensure_event(jsonb, uuid), public.handle_new_user() from authenticated;
revoke all on function public.create_group(text, numeric), public.join_group(text),
  public.place_bet(uuid, jsonb, text, numeric),
  public.create_challenge(uuid, jsonb, text, numeric, numeric, uuid, text),
  public.accept_challenge(uuid), public.cancel_challenge(uuid), public.settle_event(text, text, text, text),
  public.create_custom_event(uuid, text, text, text, boolean, timestamptz, text),
  public.adjust_balance(uuid, uuid, numeric), public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.is_member(uuid), public.is_admin(uuid), public.compute_line(text, uuid),
  public.create_group(text, numeric), public.join_group(text),
  public.place_bet(uuid, jsonb, text, numeric),
  public.create_challenge(uuid, jsonb, text, numeric, numeric, uuid, text),
  public.accept_challenge(uuid), public.cancel_challenge(uuid), public.settle_event(text, text, text, text),
  public.create_custom_event(uuid, text, text, text, boolean, timestamptz, text),
  public.adjust_balance(uuid, uuid, numeric), public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.username_taken(text) to anon, authenticated;
