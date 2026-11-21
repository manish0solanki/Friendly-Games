/**
 * Demo backend — everything lives in this browser's localStorage.
 * Same rules as the Supabase SQL functions, so you can try the app (and pass-and-play
 * on one device by switching players) before setting up the free online database.
 */
import { computeLine, OUTCOME_INDEX, stakesFor, takerStake } from '../odds';
import type { AdminOverview, Bet, Challenge, CustomEventInput, Group, GroupData, Match, Member, Outcome, Profile, Result, StoredEvent } from '../types';
import type { Quote } from '../quote';
import { cleanUsername, matchToStored, validateUsername, type Backend } from './types';

interface DB {
  users: Profile[];
  currentUserId: string | null;
  groups: Group[];
  members: (Member & { groupId: string })[];
  events: Record<string, StoredEvent>;
  bets: Bet[];
  challenges: Challenge[];
}

const KEY = 'friendly-games-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const r2 = (n: number) => Math.round(n * 100) / 100;

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { users: [], currentUserId: null, groups: [], members: [], events: {}, bets: [], challenges: [] };
}

export class LocalBackend implements Backend {
  mode = 'demo' as const;
  private db: DB = load();
  private listeners = new Set<() => void>();

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.db));
    } catch {
      /* storage full or blocked */
    }
  }
  private me(): Profile {
    const u = this.db.users.find((x) => x.id === this.db.currentUserId);
    if (!u) throw new Error('Please sign in');
    return u;
  }
  private member(groupId: string, userId: string) {
    return this.db.members.find((m) => m.groupId === groupId && m.userId === userId);
  }
  private isAdmin(groupId: string) {
    return this.member(groupId, this.me().id)?.role === 'admin';
  }
  private ensureEvent(match: Match, groupId: string): StoredEvent {
    if (match.id.startsWith('custom:')) {
      const e = this.db.events[match.id];
      if (!e || e.groupId !== groupId) throw new Error('Unknown event');
      return e;
    }
    const existing = this.db.events[match.id];
    if (existing) {
      if (!existing.settledAt && new Date(match.startTime) > new Date()) existing.startTime = match.startTime;
      return existing;
    }
    const e = matchToStored(match);
    this.db.events[e.id] = e;
    return e;
  }
  private checkOpen(e: StoredEvent, pick: Outcome) {
    if (e.settledAt || new Date(e.startTime) <= new Date()) throw new Error('Betting has closed for this event');
    if (pick === 'draw' && !e.allowDraw) throw new Error('Invalid selection');
  }

  async currentUser() {
    return this.db.users.find((x) => x.id === this.db.currentUserId) ?? null;
  }
  onAuthChange(cb: () => void) {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }
  async signUp(username: string) {
    const u = cleanUsername(username);
    const v = validateUsername(u);
    if (v) throw new Error(v);
    if (this.db.users.some((x) => x.username === u)) throw new Error('That username is taken.');
    const p = { id: uid(), username: u };
    this.db.users.push(p);
    this.db.currentUserId = p.id;
    this.save();
    this.emit();
  }
  async signIn(username: string) {
    const u = this.db.users.find((x) => x.username === cleanUsername(username));
    if (!u) throw new Error('No player with that name on this device. Create one instead.');
    this.db.currentUserId = u.id;
    this.save();
    this.emit();
  }
  async signOut() {
    this.db.currentUserId = null;
    this.save();
    this.emit();
  }

  async myGroups() {
    const me = await this.currentUser();
    if (!me) return [];
    const ids = new Set(this.db.members.filter((m) => m.userId === me.id).map((m) => m.groupId));
    return this.db.groups.filter((g) => ids.has(g.id));
  }
  async createGroup(name: string, startingBalance: number) {
    const me = this.me();
    if (name.trim().length < 2) throw new Error('Group name is too short');
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    const g: Group = { id: uid(), name: name.trim(), inviteCode: code, startingBalance, createdBy: me.id, liveBetting: true };
    this.db.groups.push(g);
    this.db.members.push({ groupId: g.id, userId: me.id, username: me.username, role: 'admin', balance: startingBalance, joinedAt: new Date().toISOString() });
    this.save();
    return g;
  }
  async joinGroup(code: string) {
    const me = this.me();
    const g = this.db.groups.find((x) => x.inviteCode === code.trim().toUpperCase());
    if (!g) throw new Error('No group found with that invite code');
    if (!this.member(g.id, me.id))
      this.db.members.push({ groupId: g.id, userId: me.id, username: me.username, role: 'member', balance: g.startingBalance, joinedAt: new Date().toISOString() });
    this.save();
    return g;
  }
  async groupData(groupId: string): Promise<GroupData> {
    const group = this.db.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Group not found');
    const bets = this.db.bets.filter((b) => b.groupId === groupId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const challenges = this.db.challenges.filter((c) => c.groupId === groupId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const events: Record<string, StoredEvent> = {};
    for (const e of Object.values(this.db.events)) if (e.groupId === groupId) events[e.id] = e;
    for (const x of [...bets, ...challenges]) if (this.db.events[x.eventId]) events[x.eventId] = this.db.events[x.eventId];
    const members = this.db.members.filter((m) => m.groupId === groupId).map(({ groupId: _g, ...m }) => m);
    return structuredClone({ group, members, bets, challenges, events });
  }

  async placeBet(groupId: string, match: Match, pick: Outcome, stake: number): Promise<{ odds: number; pending: boolean }> {
    const me = this.me();
    const m = this.member(groupId, me.id);
    if (!m) throw new Error('You are not a member of this group');
    stake = r2(stake);
    if (!(stake >= 1)) throw new Error('Minimum stake is 1 coin');
    if (m.balance < stake) throw new Error(`Not enough coins — your balance is ${m.balance}`);
    const e = this.ensureEvent(match, groupId);
    this.checkOpen(e, pick);
    const line = computeLine(e.baseProbs, e.allowDraw, stakesFor(this.db.bets.filter((b) => b.groupId === groupId), e.id));
    this.db.bets.push({
      id: uid(), groupId, userId: me.id, eventId: e.id, pick, stake, odds: line[OUTCOME_INDEX[pick]],
      status: 'open', payout: 0, createdAt: new Date().toISOString(),
    });
    m.balance = r2(m.balance - stake);
    this.save();
    return { odds: line[OUTCOME_INDEX[pick]], pending: false };
  }

  async createChallenge(groupId: string, match: Match, pick: Outcome, odds: number, stake: number, targetId: string | null, message: string) {
    const me = this.me();
    const m = this.member(groupId, me.id);
    if (!m) throw new Error('You are not a member of this group');
    stake = r2(stake);
    odds = r2(odds);
    if (!(stake >= 1)) throw new Error('Minimum stake is 1 coin');
    if (!(odds >= 1.01 && odds <= 50)) throw new Error('Odds must be between 1.01 and 50');
    if (m.balance < stake) throw new Error(`Not enough coins — your balance is ${m.balance}`);
    if (targetId && (targetId === me.id || !this.member(groupId, targetId))) throw new Error('You can only challenge another member of this group');
    const e = this.ensureEvent(match, groupId);
    this.checkOpen(e, pick);
    this.db.challenges.push({
      id: uid(), groupId, eventId: e.id, creatorId: me.id, pick, odds, stake, takerStake: Math.max(0.01, takerStake(stake, odds)),
      targetId, takerId: null, status: 'open', message: message.trim().slice(0, 140) || null, createdAt: new Date().toISOString(),
    });
    m.balance = r2(m.balance - stake);
    this.save();
  }

  async acceptChallenge(id: string) {
    const me = this.me();
    const c = this.db.challenges.find((x) => x.id === id);
    if (!c) throw new Error('Challenge not found');
    if (c.status !== 'open') throw new Error('This challenge is no longer open');
    if (c.creatorId === me.id) throw new Error('You cannot accept your own challenge');
    if (c.targetId && c.targetId !== me.id) throw new Error('This challenge was sent to someone else');
    const e = this.db.events[c.eventId];
    if (e.settledAt || new Date(e.startTime) <= new Date()) throw new Error('Betting has closed for this event');
    const m = this.member(c.groupId, me.id);
    if (!m) throw new Error('You are not a member of this group');
    if (m.balance < c.takerStake) throw new Error(`You need ${c.takerStake} coins to accept — your balance is ${m.balance}`);
    m.balance = r2(m.balance - c.takerStake);
    Object.assign(c, { takerId: me.id, status: 'matched', matchedAt: new Date().toISOString() });
    this.save();
  }

  async cancelChallenge(id: string) {
    const me = this.me();
    const c = this.db.challenges.find((x) => x.id === id);
    if (!c) throw new Error('Challenge not found');
    if (c.status !== 'open') throw new Error('Only open challenges can be cancelled');
    if (c.creatorId !== me.id && !this.isAdmin(c.groupId)) throw new Error('Only the creator can cancel this');
    const m = this.member(c.groupId, c.creatorId);
    if (m) m.balance = r2(m.balance + c.stake);
    Object.assign(c, { status: 'cancelled', settledAt: new Date().toISOString() });
    this.save();
  }

  async requestCashout(): Promise<number> {
    throw new Error('Cash out needs the online version (live prices come from the server)');
  }
  async confirmPending() {}
  async setLiveBetting(groupId: string, on: boolean) {
    if (!this.isAdmin(groupId)) throw new Error('Only group admins can change this');
    const g = this.db.groups.find((x) => x.id === groupId);
    if (g) g.liveBetting = on;
    this.save();
  }

  async settleEvent(eventId: string, maybeResult: Result | null, homeScore?: string, awayScore?: string, quote?: Quote) {
    let result = (quote?.payload.result ?? maybeResult) as Result;
    if (!result) throw new Error('This match has not finished yet');
    const e = this.db.events[eventId];
    if (!e) throw new Error('Event not found');
    if (e.settledAt) return;
    if (e.groupId) {
      if (!this.isAdmin(e.groupId)) throw new Error('Only group admins can settle custom events');
    } else if (new Date(e.startTime) > new Date() && result !== 'void') throw new Error('This event has not started yet');
    if (result === 'draw' && !e.allowDraw) result = 'void';
    const now = new Date().toISOString();
    const credit = (groupId: string, userId: string | null | undefined, amt: number) => {
      const m = userId ? this.member(groupId, userId) : undefined;
      if (m && amt > 0) m.balance = r2(m.balance + amt);
    };
    for (const b of this.db.bets) {
      if (b.eventId !== eventId || b.status !== 'open') continue;
      if (result === 'void') Object.assign(b, { status: 'void', payout: b.stake });
      else if (b.pick === result) Object.assign(b, { status: 'won', payout: r2(b.stake * b.odds) });
      else Object.assign(b, { status: 'lost', payout: 0 });
      b.settledAt = now;
      credit(b.groupId, b.userId, b.payout);
    }
    for (const c of this.db.challenges) {
      if (c.eventId !== eventId) continue;
      if (c.status === 'open') {
        credit(c.groupId, c.creatorId, c.stake);
        Object.assign(c, { status: 'cancelled', settledAt: now });
      } else if (c.status === 'matched') {
        if (result === 'void') {
          credit(c.groupId, c.creatorId, c.stake);
          credit(c.groupId, c.takerId, c.takerStake);
          Object.assign(c, { status: 'void', settledAt: now });
        } else {
          const winner = c.pick === result ? c.creatorId : c.takerId;
          credit(c.groupId, winner, r2(c.stake + c.takerStake));
          Object.assign(c, { status: 'settled', winnerId: winner, settledAt: now });
        }
      }
    }
    Object.assign(e, { result, settledAt: now, home: { ...e.home, score: homeScore }, away: { ...e.away, score: awayScore } });
    this.save();
  }

  async createCustomEvent(groupId: string, i: CustomEventInput) {
    if (!this.isAdmin(groupId)) throw new Error('Only group admins can create events');
    if (!i.home.trim() || !i.away.trim()) throw new Error('Both sides need a name');
    if (new Date(i.startTime) <= new Date()) throw new Error('Start time must be in the future');
    const e: StoredEvent = {
      id: `custom:${uid()}`,
      groupId,
      sport: 'custom',
      leagueKey: 'custom',
      league: i.league.trim() || 'Group specials',
      name: i.title.trim() || `${i.home.trim()} vs ${i.away.trim()}`,
      home: { name: i.home.trim(), short: i.home.trim().slice(0, 3).toUpperCase() },
      away: { name: i.away.trim(), short: i.away.trim().slice(0, 3).toUpperCase() },
      allowDraw: i.allowDraw,
      baseProbs: i.allowDraw ? [0.37, 0.37, 0.26] : [0.5, 0.5, 0],
      startTime: new Date(i.startTime).toISOString(),
    };
    this.db.events[e.id] = e;
    this.save();
    return e;
  }

  async adjustBalance(groupId: string, userId: string, amount: number) {
    if (!this.isAdmin(groupId)) throw new Error('Only group admins can adjust balances');
    const m = this.member(groupId, userId);
    if (!m) throw new Error('Member not found');
    if (m.balance + amount < 0) throw new Error('Balance cannot go below zero');
    m.balance = r2(m.balance + amount);
    this.save();
  }

  async setRole(groupId: string, userId: string, role: 'admin' | 'member') {
    if (!this.isAdmin(groupId)) throw new Error('Only group admins can change roles');
    const admins = this.db.members.filter((m) => m.groupId === groupId && m.role === 'admin');
    if (role === 'member' && userId === this.me().id && admins.length <= 1) throw new Error('A group needs at least one admin');
    const m = this.member(groupId, userId);
    if (m) m.role = role;
    this.save();
  }

  async adminOverview(): Promise<AdminOverview> {
    return structuredClone({
      players: this.db.users.map((u) => ({ id: u.id, username: u.username, createdAt: '', isSuper: false })),
      groups: this.db.groups,
      members: this.db.members,
      bets: this.db.bets,
      challenges: this.db.challenges,
      events: this.db.events,
    });
  }

  /** Demo helper: list players on this device for quick switching. */
  players(): Profile[] {
    return this.db.users;
  }
}
