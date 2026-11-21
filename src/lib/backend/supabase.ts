import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { quoteArg, type Quote } from '../quote';
import type { AdminOverview, Bet, Challenge, Group, GroupData, HouseEntry, Member, StoredEvent } from '../types';
import { cleanUsername, matchToStored, validateUsername, type Backend } from './types';

// Players sign in with a username; Supabase Auth needs an email, so we derive a private one.
const EMAIL_DOMAIN = 'players.friendlygames.app';
const toEmail = (u: string) => `${cleanUsername(u)}@${EMAIL_DOMAIN}`;

function err(e: { message?: string } | null): never | void {
  if (e) throw new Error(friendly(e.message ?? 'Something went wrong'));
}

function friendly(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'Wrong username or password.';
  if (/already registered|already exists|Database error saving new user/i.test(msg)) return 'That username is taken.';
  if (/Email not confirmed/i.test(msg))
    return 'Account needs confirming. Ask your group admin to turn off "Confirm email" in Supabase (see README).';
  if (/Password should be/i.test(msg)) return 'Password must be at least 6 characters.';
  return msg;
}

const mapGroup = (g: any): Group => ({
  id: g.id,
  name: g.name,
  inviteCode: g.invite_code,
  startingBalance: Number(g.starting_balance),
  createdBy: g.created_by,
  liveBetting: g.live_betting !== false,
});

const mapBet = (x: any): Bet => ({
  id: x.id,
  groupId: x.group_id,
  userId: x.user_id,
  eventId: x.event_id,
  pick: x.pick,
  stake: Number(x.stake),
  odds: Number(x.odds),
  status: x.status,
  payout: Number(x.payout),
  createdAt: x.created_at,
  settledAt: x.settled_at,
  commissionRate: Number(x.commission_rate ?? 0),
  commission: Number(x.commission ?? 0),
  live: !!x.live,
  cashoutValue: x.cashout_value == null ? null : Number(x.cashout_value),
  cashoutRequestedAt: x.cashout_requested_at,
});

const mapChallenge = (x: any): Challenge => ({
  id: x.id,
  groupId: x.group_id,
  eventId: x.event_id,
  creatorId: x.creator_id,
  pick: x.pick,
  odds: Number(x.odds),
  stake: Number(x.stake),
  takerStake: Number(x.taker_stake),
  targetId: x.target_id,
  takerId: x.taker_id,
  status: x.status,
  winnerId: x.winner_id,
  message: x.message,
  createdAt: x.created_at,
  matchedAt: x.matched_at,
  settledAt: x.settled_at,
  commissionRate: Number(x.commission_rate ?? 0),
  commission: Number(x.commission ?? 0),
});

const mapHouse = (x: any): HouseEntry => ({
  id: x.id,
  groupId: x.group_id,
  userId: x.user_id,
  source: x.source,
  refId: x.ref_id,
  eventId: x.event_id,
  amount: Number(x.amount),
  createdAt: x.created_at,
});

const mapMember = (x: any): Member => ({
  userId: x.user_id,
  username: x.fg_profiles?.username ?? 'player',
  role: x.role,
  balance: Number(x.balance),
  joinedAt: x.joined_at,
});

const mapEvent = (e: any): StoredEvent => ({
  id: e.id,
  groupId: e.group_id,
  sport: e.sport,
  leagueKey: e.league_key,
  league: e.league,
  name: e.name,
  home: e.home,
  away: e.away,
  allowDraw: e.allow_draw,
  baseProbs: (e.base_probs ?? [0.5, 0.5, 0]).map(Number) as [number, number, number],
  startTime: e.start_time,
  result: e.result,
  settledAt: e.settled_at,
});

export class SupabaseBackend implements Backend {
  mode = 'online' as const;
  sb: SupabaseClient;

  constructor() {
    this.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const { data: p } = await this.sb.from('fg_profiles').select('id, username, is_super').eq('id', user.id).maybeSingle();
    return { id: user.id, username: p?.username ?? user.user_metadata?.fg_username ?? 'player', isSuper: !!p?.is_super };
  }

  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') cb();
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(username: string, password: string) {
    const u = cleanUsername(username);
    const v = validateUsername(u);
    if (v) throw new Error(v);
    const { error } = await this.sb.rpc('fg_sign_up', { p_username: u, p_password: password });
    err(error);
    await this.signIn(u, password);
  }

  async signIn(username: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email: toEmail(username), password });
    err(error);
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async myGroups() {
    const { data: s } = await this.sb.auth.getSession();
    const uid = s.session?.user.id;
    if (!uid) return [];
    const { data: me } = await this.sb.from('fg_profiles').select('is_super').eq('id', uid).maybeSingle();
    if (me?.is_super) {
      // site admin: every group is visible
      const { data, error } = await this.sb.from('fg_groups').select('*').order('created_at');
      err(error);
      return (data ?? []).map(mapGroup);
    }
    const { data, error } = await this.sb.from('fg_members').select('fg_groups(*)').eq('user_id', uid);
    err(error);
    return (data ?? []).map((r: any) => mapGroup(r.fg_groups)).filter(Boolean);
  }

  async createGroup(name: string, startingBalance: number) {
    const { data, error } = await this.sb.rpc('fg_create_group', { p_name: name, p_starting_balance: startingBalance });
    err(error);
    return mapGroup(data);
  }

  async joinGroup(code: string) {
    const { data, error } = await this.sb.rpc('fg_join_group', { p_code: code });
    err(error);
    return mapGroup(data);
  }

  async groupData(groupId: string): Promise<GroupData> {
    const [g, m, b, c, ce, h] = await Promise.all([
      this.sb.from('fg_groups').select('*').eq('id', groupId).single(),
      this.sb.from('fg_members').select('*, fg_profiles(username)').eq('group_id', groupId),
      this.sb.from('fg_bets').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(2000),
      this.sb.from('fg_challenges').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(1000),
      this.sb.from('fg_events').select('*').eq('group_id', groupId),
      this.sb.from('fg_house_ledger').select('*').eq('group_id', groupId).order('created_at', { ascending: false }).limit(1000),
    ]);
    for (const r of [g, m, b, c, ce, h]) err(r.error);

    const bets: Bet[] = (b.data ?? []).map(mapBet);
    const challenges: Challenge[] = (c.data ?? []).map(mapChallenge);
    const members: Member[] = (m.data ?? []).map(mapMember);

    const events: Record<string, StoredEvent> = {};
    for (const e of ce.data ?? []) events[e.id] = mapEvent(e);
    await this.loadEvents(events, [...bets.map((x) => x.eventId), ...challenges.map((x) => x.eventId)]);
    return { group: mapGroup(g.data), members, bets, challenges, events, house: (h.data ?? []).map(mapHouse) };
  }

  private async loadEvents(into: Record<string, StoredEvent>, ids: string[]) {
    const need = [...new Set(ids)].filter((id) => !into[id]);
    for (let i = 0; i < need.length; i += 80) {
      const r = await this.sb.from('fg_events').select('*').in('id', need.slice(i, i + 80));
      err(r.error);
      for (const e of r.data ?? []) into[e.id] = mapEvent(e);
    }
  }

  /** Site admins only (row-level security returns everything for them, and only their own groups for others). */
  async adminOverview(): Promise<AdminOverview> {
    const [p, g, m, b, c, h] = await Promise.all([
      this.sb.from('fg_profiles').select('id, username, created_at, is_super').order('created_at'),
      this.sb.from('fg_groups').select('*').order('created_at'),
      this.sb.from('fg_members').select('*, fg_profiles(username)'),
      this.sb.from('fg_bets').select('*').order('created_at', { ascending: false }).limit(1000),
      this.sb.from('fg_challenges').select('*').order('created_at', { ascending: false }).limit(500),
      this.sb.from('fg_house_ledger').select('*').order('created_at', { ascending: false }).limit(2000),
    ]);
    for (const r of [p, g, m, b, c, h]) err(r.error);
    const bets = (b.data ?? []).map(mapBet);
    const challenges = (c.data ?? []).map(mapChallenge);
    const events: Record<string, StoredEvent> = {};
    await this.loadEvents(events, [...bets.map((x) => x.eventId), ...challenges.map((x) => x.eventId)]);
    return {
      players: (p.data ?? []).map((x: any) => ({ id: x.id, username: x.username, createdAt: x.created_at, isSuper: !!x.is_super })),
      groups: (g.data ?? []).map(mapGroup),
      members: (m.data ?? []).map((x: any) => ({ ...mapMember(x), groupId: x.group_id })),
      bets,
      challenges,
      events,
      house: (h.data ?? []).map(mapHouse),
    };
  }

  async commissionRate() {
    const { data } = await this.sb.from('fg_settings').select('commission_rate').maybeSingle();
    return data ? Number(data.commission_rate) : 0.05;
  }

  async setCommissionRate(rate: number) {
    const { data, error } = await this.sb.rpc('fg_set_commission_rate', { p_rate: rate });
    err(error);
    return Number(data);
  }

  async placeBet(groupId: string, match: any, pick: any, stake: number, quote?: Quote) {
    const { data, error } = await this.sb.rpc('fg_place_bet', {
      p_group: groupId,
      p_event: matchToStored(match),
      p_pick: pick,
      p_stake: stake,
      p_quote: quote ? quoteArg(quote) : null,
    });
    err(error);
    return { odds: Number(data?.odds), pending: data?.status === 'pending' };
  }

  async createChallenge(groupId: string, match: any, pick: any, odds: number, stake: number, targetId: string | null, message: string, quote?: Quote) {
    const { error } = await this.sb.rpc('fg_create_challenge', {
      p_group: groupId,
      p_event: matchToStored(match),
      p_pick: pick,
      p_odds: odds,
      p_stake: stake,
      p_target: targetId,
      p_message: message,
      p_quote: quote ? quoteArg(quote) : null,
    });
    err(error);
  }

  async acceptChallenge(id: string, quote?: Quote) {
    const { error } = await this.sb.rpc('fg_accept_challenge', { p_id: id, p_quote: quote ? quoteArg(quote) : null });
    err(error);
  }

  async cancelChallenge(id: string) {
    const { error } = await this.sb.rpc('fg_cancel_challenge', { p_id: id });
    err(error);
  }

  async settleEvent(eventId: string, result: any, homeScore?: string, awayScore?: string, quote?: Quote) {
    const { error } = await this.sb.rpc('fg_settle_event', {
      p_event_id: eventId,
      p_result: result,
      p_home_score: homeScore ?? null,
      p_away_score: awayScore ?? null,
      p_quote: quote ? quoteArg(quote) : null,
    });
    err(error);
  }

  async requestCashout(betId: string, quote: Quote) {
    const { data, error } = await this.sb.rpc('fg_request_cashout', { p_bet: betId, p_quote: quoteArg(quote) });
    err(error);
    return Number(data?.cashout_value);
  }

  async confirmPending(eventId: string, quote: Quote) {
    const { error } = await this.sb.rpc('fg_confirm_pending', { p_event_id: eventId, p_quote: quoteArg(quote) });
    err(error);
  }

  async setLiveBetting(groupId: string, on: boolean) {
    const { error } = await this.sb.rpc('fg_set_live_betting', { p_group: groupId, p_on: on });
    err(error);
  }

  async createCustomEvent(groupId: string, i: any) {
    const { data, error } = await this.sb.rpc('fg_create_custom_event', {
      p_group: groupId,
      p_title: i.title,
      p_home: i.home,
      p_away: i.away,
      p_allow_draw: i.allowDraw,
      p_start: new Date(i.startTime).toISOString(),
      p_league: i.league,
    });
    err(error);
    return mapEvent(data);
  }

  async adjustBalance(groupId: string, userId: string, amount: number) {
    const { error } = await this.sb.rpc('fg_adjust_balance', { p_group: groupId, p_user: userId, p_amount: amount });
    err(error);
  }

  async setRole(groupId: string, userId: string, role: 'admin' | 'member') {
    const { error } = await this.sb.rpc('fg_set_member_role', { p_group: groupId, p_user: userId, p_role: role });
    err(error);
  }
}
