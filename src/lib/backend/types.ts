import type { Quote } from '../quote';
import type { AdminOverview, CustomEventInput, Group, GroupData, Match, Outcome, Profile, Result, StoredEvent } from '../types';

export interface Backend {
  mode: 'demo' | 'online';
  currentUser(): Promise<Profile | null>;
  onAuthChange(cb: () => void): () => void;
  signUp(username: string, password: string): Promise<void>;
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  myGroups(): Promise<Group[]>;
  createGroup(name: string, startingBalance: number): Promise<Group>;
  joinGroup(code: string): Promise<Group>;
  groupData(groupId: string): Promise<GroupData>;

  /** In-play bets need a signed live quote. Returns the odds the bet was taken at. */
  placeBet(groupId: string, match: Match, pick: Outcome, stake: number, quote?: Quote): Promise<{ odds: number; pending: boolean }>;
  createChallenge(
    groupId: string,
    match: Match,
    pick: Outcome,
    odds: number,
    stake: number,
    targetId: string | null,
    message: string,
    quote?: Quote,
  ): Promise<void>;
  acceptChallenge(id: string, quote?: Quote): Promise<void>;
  cancelChallenge(id: string): Promise<void>;

  /** Settle every bet & challenge on an event. Idempotent. */
  settleEvent(eventId: string, result: Result | null, homeScore?: string, awayScore?: string, quote?: Quote): Promise<void>;
  /** Cash out an open bet at the current live price (confirmed after 30s). Returns the value. */
  requestCashout(betId: string, quote: Quote): Promise<number>;
  /** Confirm/reject live bets & cash outs that have waited 30s. */
  confirmPending(eventId: string, quote: Quote): Promise<void>;
  setLiveBetting(groupId: string, on: boolean): Promise<void>;
  createCustomEvent(groupId: string, input: CustomEventInput): Promise<StoredEvent>;
  adjustBalance(groupId: string, userId: string, amount: number): Promise<void>;
  setRole(groupId: string, userId: string, role: 'admin' | 'member'): Promise<void>;
  /** Everything across all groups — only returns full data for site admins. */
  adminOverview(): Promise<AdminOverview>;
}

export function matchToStored(m: Match): StoredEvent {
  return {
    id: m.id,
    sport: m.sport,
    leagueKey: m.leagueKey,
    league: m.league,
    name: m.name,
    home: { name: m.home.name, short: m.home.short, logo: m.home.logo },
    away: { name: m.away.name, short: m.away.short, logo: m.away.logo },
    allowDraw: m.allowDraw,
    baseProbs: m.baseProbs,
    startTime: m.startTime,
  };
}

export function cleanUsername(u: string): string {
  return u.trim().toLowerCase();
}

export function validateUsername(u: string): string | null {
  if (!/^[a-z0-9_.]{3,20}$/.test(u)) return 'Username must be 3–20 characters: letters, numbers, _ or .';
  return null;
}
