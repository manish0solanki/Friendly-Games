/* Live sports data from ESPN's public (free, key-less) JSON endpoints. */
import { findLeague } from './sports';
import { defaultProbs, moneylineToProb } from './odds';
import { SUPABASE_URL } from './config';
import type { Match, MatchState, Result, StoredEvent, Team } from './types';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HEADER = 'https://site.web.api.espn.com/apis/v2/scoreboard/header';

const cache = new Map<string, { at: number; data: unknown }>();
let useProxy = false;

/** Fetch JSON directly from ESPN; if the browser blocks it, fall back to our tiny Supabase proxy. */
async function getJson(url: string, ttlMs = 45_000): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  let data: unknown;
  const proxied = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/espn-proxy?url=${encodeURIComponent(url)}` : null;
  if (!useProxy) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      if (!proxied) throw e;
      useProxy = true;
    }
  }
  if (data === undefined && proxied) {
    const r = await fetch(proxied);
    if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
    data = await r.json();
  }
  cache.set(url, { at: Date.now(), data });
  return data;
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

function dateRange(daysBack: number, daysForward: number): string {
  const now = Date.now();
  return `${ymd(new Date(now - daysBack * 864e5))}-${ymd(new Date(now + daysForward * 864e5))}`;
}

export function makeEventId(leagueKey: string, eventId: string, compId: string): string {
  return `espn:${leagueKey}:${eventId}:${compId}`;
}

export function parseEventId(id: string): { leagueKey: string; eventId: string; compId: string } | null {
  const m = /^espn:(.+):([^:]+):([^:]+)$/.exec(id);
  return m ? { leagueKey: m[1], eventId: m[2], compId: m[3] } : null;
}

/** Fetch upcoming, live and recent matches for one league. */
export async function fetchLeague(leagueKey: string): Promise<Match[]> {
  if (leagueKey === 'cricket/all') return fetchCricket();
  const league = findLeague(leagueKey);
  const url = `${SITE}/${leagueKey}/scoreboard?dates=${dateRange(1, 7)}&limit=300`;
  const data = await getJson(url);
  const leagueName = league?.name ?? data?.leagues?.[0]?.name ?? leagueKey;
  return parseScoreboard(data, leagueKey, leagueName, league?.allowDraw ?? false);
}

function parseScoreboard(data: any, leagueKey: string, leagueName: string, allowDraw: boolean): Match[] {
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

async function fetchCricket(): Promise<Match[]> {
  const data = await getJson(`${HEADER}?sport=cricket&lang=en&region=in`);
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

function dedupe(ms: Match[]): Match[] {
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
  };
}

function decideWinner(homeC: any, awayC: any, home: Team, away: Team, allowDraw: boolean): Result {
  const hs = parseFloat(home.score ?? '');
  const as = parseFloat(away.score ?? '');
  // For football (soccer) & rugby, the scoreline decides — a cup tie won on penalties is a draw.
  if (allowDraw && isFinite(hs) && isFinite(as)) return hs > as ? 'home' : as > hs ? 'away' : 'draw';
  if (homeC?.winner === true) return 'home';
  if (awayC?.winner === true) return 'away';
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
    const h = moneylineToProb(ml(o.homeTeamOdds?.moneyLine ?? o.moneyline?.home?.close?.odds ?? o.moneyline?.home?.open?.odds));
    const a = moneylineToProb(ml(o.awayTeamOdds?.moneyLine ?? o.moneyline?.away?.close?.odds ?? o.moneyline?.away?.open?.odds));
    const d = allowDraw ? moneylineToProb(ml(o.drawOdds?.moneyLine ?? o.moneyline?.draw?.close?.odds)) : 0;
    if (isFinite(h) && isFinite(a) && (!allowDraw || isFinite(d))) {
      const s = h + a + d;
      return [h / s, a / s, d / s];
    }
  }
  return defaultProbs(allowDraw);
}

/** Look up the final result of a stored event (used to auto-settle bets). */
export async function fetchResult(ev: StoredEvent): Promise<{ result: Result; homeScore?: string; awayScore?: string } | null> {
  const ids = parseEventId(ev.id);
  if (!ids) return null;
  const { leagueKey, eventId, compId } = ids;
  let match: Match | undefined;
  try {
    const data = await getJson(`${SITE}/${leagueKey}/summary?event=${eventId}`, 120_000);
    const comps: any[] = data?.header?.competitions ?? [];
    const comp = comps.find((c) => String(c.id) === compId) ?? (comps.length === 1 ? comps[0] : undefined);
    if (comp) match = parseCompetition(leagueKey, ev.league, { id: eventId }, comp, ev.allowDraw) ?? undefined;
  } catch {
    /* fall through to scoreboard lookup */
  }
  if (!match) {
    try {
      const day = ymd(new Date(ev.startTime));
      const data = await getJson(`${SITE}/${leagueKey}/scoreboard?dates=${day}&limit=300`, 120_000);
      match = parseScoreboard(data, leagueKey, ev.league, ev.allowDraw).find((m) => m.id === ev.id);
    } catch {
      return null;
    }
  }
  if (!match?.result) return null;
  return { result: match.result, homeScore: match.home.score, awayScore: match.away.score };
}

/** Fetch a single event (for the event page when it isn't in a loaded list). */
export async function fetchMatch(id: string): Promise<Match | null> {
  const ids = parseEventId(id);
  if (!ids) return null;
  const league = findLeague(ids.leagueKey);
  try {
    const data = await getJson(`${SITE}/${ids.leagueKey}/summary?event=${ids.eventId}`);
    const comps: any[] = data?.header?.competitions ?? [];
    const comp = comps.find((c) => String(c.id) === ids.compId) ?? comps[0];
    const leagueName = league?.name ?? data?.header?.league?.name ?? data?.leagues?.[0]?.name ?? ids.leagueKey;
    const allowDraw = league?.allowDraw ?? ids.leagueKey.startsWith('soccer/');
    const m = comp ? parseCompetition(ids.leagueKey, leagueName, { id: ids.eventId }, comp, allowDraw) : null;
    if (m) return m;
  } catch {
    /* fall back to the league scoreboard */
  }
  try {
    const key = ids.leagueKey.startsWith('cricket/') ? 'cricket/all' : ids.leagueKey;
    return (await fetchLeague(key)).find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}
