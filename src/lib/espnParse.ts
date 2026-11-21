/* Pure ESPN parsing — shared by the browser app and the server-side quote function (api/quote.ts). */
import { findLeague } from './sports';
import { defaultProbs, moneylineToProb } from './odds';
import type { Match, MatchState, Result, Team } from './types';

export const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
export const HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header';

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function makeEventId(leagueKey: string, eventId: string, compId: string): string {
  return `espn:${leagueKey}:${eventId}:${compId}`;
}

export function parseEventId(id: string): { leagueKey: string; eventId: string; compId: string } | null {
  const m = /^espn:(.+):([^:]+):([^:]+)$/.exec(id);
  return m ? { leagueKey: m[1], eventId: m[2], compId: m[3] } : null;
}

export function parseScoreboard(data: any, leagueKey: string, leagueName: string, allowDraw: boolean): Match[] {
  const out: Match[] = [];
  for (const ev of data?.events ?? []) {
    const comps: any[] = [...(ev.competitions ?? [])];
    for (const g of ev.groupings ?? []) comps.push(...(g.competitions ?? []));
    for (const comp of comps) {
      const m = parseCompetition(leagueKey, leagueName, ev, comp, allowDraw);
      if (m) out.push(m);
    }
  }
  return dedupe(out);
}

export function parseCricketHeader(data: any): Match[] {
  const out: Match[] = [];
  for (const sport of data?.sports ?? []) {
    for (const lg of sport.leagues ?? []) {
      const leagueKey = `cricket/${lg.id ?? lg.slug ?? 'all'}`;
      const leagueName = lg.name ?? lg.shortName ?? 'Cricket';
      for (const ev of lg.events ?? []) {
        const m = parseCompetition(leagueKey, leagueName, ev, ev, false);
        if (m) out.push(m);
      }
    }
  }
  return dedupe(out);
}

/** Parse the `header.competitions` block of an ESPN match summary. */
export function parseSummary(data: any, id: string, leagueName?: string): Match | null {
  const ids = parseEventId(id);
  if (!ids) return null;
  const league = findLeague(ids.leagueKey);
  const comps: any[] = data?.header?.competitions ?? [];
  const comp = comps.find((c) => String(c.id) === ids.compId) ?? (comps.length === 1 ? comps[0] : undefined);
  if (!comp) return null;
  const name = leagueName ?? league?.name ?? data?.header?.league?.name ?? ids.leagueKey;
  return parseCompetition(ids.leagueKey, name, { id: ids.eventId }, comp, allowDrawFor(ids.leagueKey));
}

export function allowDrawFor(leagueKey: string): boolean {
  return findLeague(leagueKey)?.allowDraw ?? leagueKey.startsWith('soccer/');
}

export function dedupe(ms: Match[]): Match[] {
  const seen = new Set<string>();
  return ms.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

const VOID_STATUS = /POSTPONED|CANCEL|ABANDON|NO_RESULT|FORFEIT|DELAYED_INDEF/i;

function parseTeam(c: any): Team {
  const name = c?.team?.displayName ?? c?.athlete?.displayName ?? c?.displayName ?? c?.name ?? c?.team?.name ?? 'TBD';
  const short =
    c?.team?.abbreviation ?? c?.athlete?.shortName ?? c?.abbreviation ?? c?.shortDisplayName ?? String(name).slice(0, 3).toUpperCase();
  const logo = c?.team?.logo ?? c?.team?.logos?.[0]?.href ?? c?.logo ?? c?.athlete?.flag?.href ?? c?.flag?.href;
  let score: string | undefined;
  if (c?.score != null) score = typeof c.score === 'object' ? c.score.displayValue ?? String(c.score.value ?? '') : String(c.score);
  if (score === '') score = undefined;
  return { name, short, logo, score };
}

function parseCompetition(leagueKey: string, leagueName: string, ev: any, comp: any, allowDraw: boolean): Match | null {
  const cs: any[] = comp?.competitors ?? ev?.competitors ?? [];
  if (cs.length !== 2) return null;
  const homeC = cs.find((c) => c.homeAway === 'home') ?? cs[0];
  const awayC = cs.find((c) => c !== homeC) ?? cs[1];
  const home = parseTeam(homeC);
  const away = parseTeam(awayC);
  if (home.name === 'TBD' && away.name === 'TBD') return null;

  const status = comp?.status ?? ev?.status ?? {};
  const type = (typeof status === 'object' ? status.type : undefined) ?? ev?.fullStatus?.type ?? {};
  const state: MatchState = (type.state ?? (typeof ev?.status === 'string' ? ev.status : 'pre')) as MatchState;
  const startTime = comp?.date ?? comp?.startDate ?? ev?.date ?? new Date().toISOString();
  const statusText = state === 'pre' ? '' : type.shortDetail ?? type.detail ?? ev?.summary ?? (state === 'post' ? 'FT' : 'Live');

  let result: Result | undefined;
  const typeName = String(type.name ?? '');
  if (VOID_STATUS.test(typeName) || VOID_STATUS.test(String(type.description ?? ''))) result = 'void';
  else if (state === 'post') {
    if (type.completed === false) result = 'void';
    else result = decideWinner(homeC, awayC, home, away, allowDraw);
  }

  const sport = leagueKey.split('/')[0];
  const period = typeof status === 'object' ? Number(status.period ?? comp?.status?.period ?? 0) || 0 : 0;
  const clock = typeof status === 'object' && status.clock != null ? Number(status.clock) : undefined;
  const live = state === 'in' && !result;
  const liveOdds = live ? parseLiveOdds(comp, allowDraw) : undefined;
  return {
    id: makeEventId(leagueKey, String(ev?.id ?? comp?.id), String(comp?.id ?? ev?.id)),
    sport,
    leagueKey,
    league: leagueName,
    name: `${home.name} vs ${away.name}`,
    home,
    away,
    allowDraw,
    startTime,
    state: ['pre', 'in', 'post'].includes(state) ? state : 'pre',
    statusText,
    baseProbs: parseOdds(comp, allowDraw),
    result,
    venue: comp?.venue?.fullName ?? ev?.location,
    period,
    clock,
    liveOdds,
    liveOpen: live && !!liveOdds && liveWindowOpen(sport, period, clock, typeName),
    challengeOpen: live && (hasLiveRules(sport) ? liveWindowOpen(sport, period, clock, typeName) : true),
  };
}

/**
 * When in-play betting closes, per sport (defaults agreed with the group):
 * football before the 80th minute, NBA/NFL before the 4th quarter, NHL before the 3rd period, MLB through the 6th inning.
 */
const LIVE_RULES: Record<string, (period: number, clock?: number, typeName?: string) => boolean> = {
  soccer: (p, c, t) => p >= 1 && p <= 2 && (c ?? 0) < 80 * 60 && !/EXTRA|SHOOTOUT|PENALT/i.test(t ?? ''),
  basketball: (p) => p >= 1 && p <= 3,
  football: (p) => p >= 1 && p <= 3,
  hockey: (p) => p >= 1 && p <= 2,
  baseball: (p) => p >= 1 && p <= 6,
};

export function hasLiveRules(sport: string): boolean {
  return sport in LIVE_RULES;
}

export function liveWindowOpen(sport: string, period: number, clock?: number, typeName?: string): boolean {
  const rule = LIVE_RULES[sport];
  return !!rule && rule(period, clock, typeName);
}

export function americanToDecimal(ml: number): number {
  if (!isFinite(ml) || ml === 0) return NaN;
  return Math.round((ml > 0 ? 1 + ml / 100 : 1 + 100 / -ml) * 100) / 100;
}

/** Current in-play bookmaker prices as decimal odds [home, away, draw] (draw is 0 when not offered). */
export function parseLiveOdds(comp: any, allowDraw: boolean): [number, number, number] | undefined {
  const m = comp?.odds?.[0]?.moneyline;
  if (!m) return undefined;
  const d = (x: any) => americanToDecimal(parseFloat(String(x?.current?.odds ?? '')));
  const h = d(m.home);
  const a = d(m.away);
  const dr = allowDraw ? d(m.draw) : 0;
  if (!(h > 1 && a > 1) || (allowDraw && !(dr > 1))) return undefined;
  return [h, a, dr];
}

// ESPN sends `winner` as a boolean in most feeds but as the string "true" in some (e.g. cricket summaries).
const isWinner = (c: any) => c?.winner === true || c?.winner === 'true';

function decideWinner(homeC: any, awayC: any, home: Team, away: Team, allowDraw: boolean): Result {
  const hs = parseFloat(home.score ?? '');
  const as = parseFloat(away.score ?? '');
  // For football (soccer) & rugby, the scoreline decides — a cup tie won on penalties is a draw.
  if (allowDraw && isFinite(hs) && isFinite(as)) return hs > as ? 'home' : as > hs ? 'away' : 'draw';
  if (isWinner(homeC)) return 'home';
  if (isWinner(awayC)) return 'away';
  if (isFinite(hs) && isFinite(as) && !/[/(]/.test(`${home.score}${away.score}`)) {
    if (hs > as) return 'home';
    if (as > hs) return 'away';
  }
  return allowDraw ? 'draw' : 'void'; // e.g. a drawn Test match or "no result"
}

function parseOdds(comp: any, allowDraw: boolean): [number, number, number] {
  const o = comp?.odds?.[0];
  if (o) {
    const ml = (x: any) => (x == null ? NaN : parseFloat(String(x)));
    const h = moneylineToProb(ml(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.current?.odds ?? o.moneyline?.home?.open?.odds));
    const a = moneylineToProb(ml(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.current?.odds ?? o.moneyline?.away?.open?.odds));
    const d = allowDraw ? moneylineToProb(ml(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds ?? o.moneyline?.draw?.current?.odds)) : 0;
    if (isFinite(h) && isFinite(a) && (!allowDraw || isFinite(d))) {
      const s = h + a + d;
      return [h / s, a / s, d / s];
    }
  }
  return defaultProbs(allowDraw);
}

