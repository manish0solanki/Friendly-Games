/* Server-only: build and sign a match "quote" (score, clock, live odds, result). Used by api/quote.ts and api/tick.ts. */
import { SITE, allowDrawFor, parseEventId, parseScoreboard, parseSummary, ymd } from './espnParse';
import { findLeague } from './sports';
import type { Match } from './types';
import type { Quote, QuotePayload } from './quote';

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; FriendlyGames/1.0)' } });
  if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
  return r.json();
}

export async function hmacHex(secret: string, message: string): Promise<string> {
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

export class QuoteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function buildQuote(id: string, start: number, secret: string): Promise<Quote> {
  if (!parseEventId(id)) throw new QuoteError(400, 'Unknown event');
  let m: Match | null;
  try {
    m = await findMatch(id, isFinite(start) ? start : Date.now());
  } catch (e) {
    throw new QuoteError(502, `Could not reach the live feed (${String(e)})`);
  }
  if (!m) throw new QuoteError(404, 'Match not found in the live feed');
  const payload: QuotePayload = {
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
  return { p, sig: await hmacHex(secret, p), payload };
}

export const serverEnv = (k: string): string | undefined => (globalThis as any).process?.env?.[k];
