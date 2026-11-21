// Signed match state ("quote") for live betting, cash out and settlement.
// The database only accepts live prices and final results that carry this
// server's HMAC signature, so nobody can fake odds or results from the browser.
import { SITE, allowDrawFor, parseEventId, parseScoreboard, parseSummary, ymd } from '../src/lib/espnParse';
import { findLeague } from '../src/lib/sports';
import type { Match } from '../src/lib/types';

export const config = { runtime: 'edge' };

const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: json });

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; FriendlyGames/1.0)' } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return r.json();
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function findMatch(id: string, start: number): Promise<Match | null> {
  const ids = parseEventId(id)!;
  // The day's scoreboard has the live clock and in-play odds. ESPN dates are US-based, so try neighbouring days too.
  if (!ids.leagueKey.startsWith('cricket/')) {
    const league = findLeague(ids.leagueKey);
    for (const offset of [0, -1, 1]) {
      try {
        const data = await getJson(`${SITE}/${ids.leagueKey}/scoreboard?dates=${ymd(new Date(start + offset * 864e5))}`);
        const m = parseScoreboard(data, ids.leagueKey, league?.name ?? ids.leagueKey, allowDrawFor(ids.leagueKey)).find((x) => x.id === id);
        if (m) return m;
      } catch {
        /* try the next day / the summary */
      }
    }
  }
  return parseSummary(await getJson(`${SITE}/${ids.leagueKey}/summary?event=${ids.eventId}`), id);
}

export default async function handler(req: Request): Promise<Response> {
  const secret = (globalThis as any).process?.env?.QUOTE_SECRET as string | undefined;
  if (!secret) return fail(500, 'Live betting is not configured on this server');
  const params = new URL(req.url).searchParams;
  const id = params.get('id') ?? '';
  const start = Date.parse(params.get('start') ?? '');
  if (!parseEventId(id)) return fail(400, 'Unknown event');
  let m: Match | null;
  try {
    m = await findMatch(id, isFinite(start) ? start : Date.now());
  } catch (e) {
    return fail(502, `Could not reach the live feed (${String(e)})`);
  }
  if (!m) return fail(404, 'Match not found in the live feed');

  const payload = {
    v: 1,
    id,
    state: m.state,
    period: m.period ?? 0,
    clock: m.clock ?? null,
    status: m.statusText,
    score: `${m.home.score ?? ''}-${m.away.score ?? ''}`,
    homeScore: m.home.score ?? null,
    awayScore: m.away.score ?? null,
    result: m.result ?? null,
    odds: m.liveOdds ?? null,
    liveOpen: !!m.liveOpen,
    challengeOpen: !!m.challengeOpen,
    at: Date.now(),
  };
  const p = JSON.stringify(payload);
  return new Response(JSON.stringify({ p, sig: await hmacHex(secret, p), payload }), { status: 200, headers: json });
}
