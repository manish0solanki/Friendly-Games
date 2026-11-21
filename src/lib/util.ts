import { computeLine, stakesFor } from './odds';
import type { Group, GroupData, Match, Outcome, StoredEvent } from './types';

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#0ea5e9'];
export function colorFor(s: string): string {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export function kickoff(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const day = same(d, now)
    ? 'Today'
    : same(d, tomorrow)
      ? 'Tomorrow'
      : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return { day, time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) };
}

export function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function pickLabel(ev: { home: { name: string }; away: { name: string } }, pick: Outcome): string {
  return pick === 'home' ? ev.home.name : pick === 'away' ? ev.away.name : 'Draw';
}

export function isBettable(m: Match, stored?: StoredEvent): boolean {
  if (stored?.settledAt) return false;
  return m.state === 'pre' && !m.result && new Date(m.startTime).getTime() > Date.now();
}

/** In-play: live window open, live prices available, and the group allows live betting. */
export function isLiveBettable(m: Match, stored: StoredEvent | undefined, group: Group | null): boolean {
  return !!group?.liveBetting && !stored?.settledAt && m.state === 'in' && !m.result && !!m.liveOpen && !!m.liveOdds && !m.custom;
}

/** Current group line for a match (uses the stored base line once anyone has bet, like the server does). */
export function lineFor(m: Match, data: GroupData | null): [number, number, number] {
  if (m.state === 'in' && m.liveOdds) return m.liveOdds; // in-play: live bookmaker prices
  const stored = data?.events[m.id];
  const base = stored?.baseProbs ?? m.baseProbs;
  return computeLine(base, m.allowDraw, data ? stakesFor(data.bets, m.id) : [0, 0, 0]);
}

/** Turn a stored event (e.g. a custom group event) into a Match for display. */
export function storedToMatch(e: StoredEvent): Match {
  const started = new Date(e.startTime).getTime() <= Date.now();
  return {
    id: e.id,
    sport: e.sport,
    leagueKey: e.leagueKey,
    league: e.league,
    name: e.name,
    home: e.home,
    away: e.away,
    allowDraw: e.allowDraw,
    startTime: e.startTime,
    state: e.settledAt ? 'post' : started ? 'in' : 'pre',
    statusText: e.settledAt ? (e.result === 'void' ? 'Void' : 'Settled') : started ? 'In play' : '',
    baseProbs: e.baseProbs,
    result: e.result ?? undefined,
    custom: e.sport === 'custom',
  };
}

export function eventPath(id: string): string {
  return `/event/${encodeURIComponent(id)}`;
}
