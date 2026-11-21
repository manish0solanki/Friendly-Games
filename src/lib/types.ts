export type Outcome = 'home' | 'away' | 'draw';
export type Result = Outcome | 'void';
export type MatchState = 'pre' | 'in' | 'post';

/** A bettable match, normalised from ESPN (or a custom event created by the group). */
export interface Match {
  id: string;
  sport: string; // sport key, e.g. 'soccer', 'cricket', 'custom'
  leagueKey: string; // e.g. 'soccer/eng.1'
  league: string; // display name
  name: string;
  home: Team;
  away: Team;
  allowDraw: boolean;
  startTime: string; // ISO
  state: MatchState;
  statusText: string; // e.g. "FT", "45'", "Sat 8:00 PM"
  /** Implied probabilities [home, away, draw] used as the starting line. */
  baseProbs: [number, number, number];
  /** Final result, if the match has finished (or was called off). */
  result?: Result;
  venue?: string;
  custom?: boolean;
  /** In-play details (ESPN scoreboard). */
  period?: number;
  clock?: number;
  /** Current bookmaker prices while live, decimal [home, away, draw]. */
  liveOdds?: [number, number, number];
  /** Live betting window open (sport rules + live odds available). */
  liveOpen?: boolean;
  /** In-play head-to-head challenges allowed. */
  challengeOpen?: boolean;
}

export interface Team {
  name: string;
  short: string;
  logo?: string;
  score?: string;
}

export interface Profile {
  id: string;
  username: string;
  /** Site admin: sees every group, player and bet. */
  isSuper?: boolean;
}

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  startingBalance: number;
  createdBy: string;
  /** In-play betting, in-play challenges and cash out allowed. */
  liveBetting: boolean;
}

export interface Member {
  userId: string;
  username: string;
  role: 'admin' | 'member';
  balance: number;
  joinedAt: string;
}

/** pending = live bet waiting 30s for confirmation; cashed = settled early via cash out. */
export type BetStatus = 'pending' | 'open' | 'won' | 'lost' | 'void' | 'cashed';

export interface Bet {
  id: string;
  groupId: string;
  userId: string;
  eventId: string;
  pick: Outcome;
  stake: number;
  odds: number;
  status: BetStatus;
  payout: number;
  createdAt: string;
  settledAt?: string | null;
  /** Placed in-play at a live bookmaker price. */
  live?: boolean;
  /** A cash out waiting for its 30s confirmation. */
  cashoutValue?: number | null;
  cashoutRequestedAt?: string | null;
}

export type ChallengeStatus = 'open' | 'matched' | 'settled' | 'void' | 'cancelled';

export interface Challenge {
  id: string;
  groupId: string;
  eventId: string;
  creatorId: string;
  pick: Outcome;
  odds: number;
  stake: number; // creator stake
  takerStake: number; // what the friend who accepts puts up
  targetId?: string | null;
  takerId?: string | null;
  status: ChallengeStatus;
  winnerId?: string | null;
  message?: string | null;
  createdAt: string;
  matchedAt?: string | null;
  settledAt?: string | null;
}

/** Snapshot of an event as stored in the database (what bets reference). */
export interface StoredEvent {
  id: string;
  groupId?: string | null;
  sport: string;
  leagueKey: string;
  league: string;
  name: string;
  home: Team;
  away: Team;
  allowDraw: boolean;
  baseProbs: [number, number, number];
  startTime: string;
  result?: Result | null;
  settledAt?: string | null;
}

export interface GroupData {
  group: Group;
  members: Member[];
  bets: Bet[];
  challenges: Challenge[];
  events: Record<string, StoredEvent>;
}

export interface CustomEventInput {
  title: string;
  home: string;
  away: string;
  allowDraw: boolean;
  startTime: string;
  league: string;
}

export interface AdminOverview {
  players: { id: string; username: string; createdAt: string; isSuper: boolean }[];
  groups: Group[];
  members: (Member & { groupId: string })[];
  bets: Bet[];
  challenges: Challenge[];
  events: Record<string, StoredEvent>;
}
