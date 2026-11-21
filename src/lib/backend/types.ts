import type { CustomEventInput, Group, GroupData, Match, Outcome, Profile, Result, StoredEvent } from '../types';

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

  placeBet(groupId: string, match: Match, pick: Outcome, stake: number): Promise<void>;
  createChallenge(
    groupId: string,
    match: Match,
    pick: Outcome,
    odds: number,
    stake: number,
    targetId: string | null,
    message: string,
  ): Promise<void>;
  acceptChallenge(id: string): Promise<void>;
  cancelChallenge(id: string): Promise<void>;

  /** Settle every bet & challenge on an event. Idempotent. */
  settleEvent(eventId: string, result: Result, homeScore?: string, awayScore?: string): Promise<void>;
  createCustomEvent(groupId: string, input: CustomEventInput): Promise<StoredEvent>;
  adjustBalance(groupId: string, userId: string, amount: number): Promise<void>;
  setRole(groupId: string, userId: string, role: 'admin' | 'member'): Promise<void>;
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
