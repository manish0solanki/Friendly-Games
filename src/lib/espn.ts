/* Live sports data from ESPN's public (free, key-less) JSON endpoints. */
import { findLeague } from './sports';
import { HEADER, SITE, dedupe, parseCricketHeader, parseEventId, parseScoreboard, parseSummary, ymd } from './espnParse';
import type { Match } from './types';

export { makeEventId, parseEventId } from './espnParse';

const cache = new Map<string, { at: number; data: unknown }>();

/** Our own relay (Vercel function at /api/espn) — avoids browser CORS blocks. Not available in `vite dev`. */
const RELAY = import.meta.env.DEV ? null : `${location.origin}/api/espn?url=`;
/** Set only when the relay is definitely not deployed (e.g. static hosting returns HTML), never on a network blip. */
let relayMissing = false;

// Phones choke on dozens of parallel requests, so keep at most 6 in flight and share duplicate requests.
const MAX_IN_FLIGHT = 6;
let inFlight = 0;
const waiting: (() => void)[] = [];
const pending = new Map<string, Promise<any>>();

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

class HttpError extends Error {}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new HttpError(`HTTP ${r.status}`);
  return r.json();
}

async function viaRelay(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(RELAY + encodeURIComponent(url));
      if (!(r.headers.get('content-type') ?? '').includes('json')) {
        relayMissing = true; // e.g. GitHub Pages serves index.html here
        return undefined;
      }
      if (!r.ok) throw new HttpError(`HTTP ${r.status}`); // ESPN answered with an error
      return await r.json();
    } catch (e) {
      if (e instanceof HttpError || attempt >= 2) throw e;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1))); // dropped connection: retry
    }
  }
}

/** Fetch ESPN JSON via our relay (falling back to a direct request only where no relay exists). */
async function getJson(url: string, ttlMs = 45_000): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const existing = pending.get(url);
  if (existing) return existing;
  const p = limited(async () => {
    let data = RELAY && !relayMissing ? await viaRelay(url) : undefined;
    if (data === undefined) data = await fetchJson(url);
    cache.set(url, { at: Date.now(), data });
    return data;
  }).finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

/** ESPN no longer accepts date ranges, so we ask for one day at a time. */
const DAYS_BACK = 1;
const DAYS_FORWARD = 6;

/** Fetch upcoming, live and recent matches for one league. */
/** `range`: 'live' = yesterday+today, 'short' = yesterday..+3 days, 'full' = yesterday..+6 days. */
export async function fetchLeague(leagueKey: string, range: 'live' | 'short' | 'full' = 'full'): Promise<Match[]> {
  if (leagueKey === 'cricket/all') return fetchCricket();
  const league = findLeague(leagueKey);
  const now = Date.now();
  const forward = range === 'live' ? 0 : range === 'short' ? 3 : DAYS_FORWARD;
  const days = Array.from({ length: DAYS_BACK + forward + 1 }, (_, i) => i - DAYS_BACK);
  const results = await Promise.allSettled(
    days.map((d) =>
      // today/yesterday refresh every 45s (live scores); future days change rarely
      getJson(`${SITE}/${leagueKey}/scoreboard?dates=${ymd(new Date(now + d * 864e5))}`, d <= 0 ? 45_000 : 10 * 60_000),
    ),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason;
  const leagueName = league?.name ?? ok[0].value?.leagues?.[0]?.name ?? leagueKey;
  return dedupe(ok.flatMap((r) => parseScoreboard(r.value, leagueKey, leagueName, league?.allowDraw ?? false)));
}

async function fetchCricket(): Promise<Match[]> {
  return parseCricketHeader(await getJson(`${HEADER}?sport=cricket&lang=en&region=in`));
}

/** Fetch a single event (for the event page when it isn't in a loaded list). */
export async function fetchMatch(id: string): Promise<Match | null> {
  const ids = parseEventId(id);
  if (!ids) return null;
  // The day's scoreboard carries the live clock and in-play odds; the summary is the fallback.
  if (!ids.leagueKey.startsWith('cricket/')) {
    try {
      const m = (await fetchLeague(ids.leagueKey, 'live')).find((x) => x.id === id);
      if (m) return m;
    } catch {
      /* fall through */
    }
  }
  try {
    const m = parseSummary(await getJson(`${SITE}/${ids.leagueKey}/summary?event=${ids.eventId}`), id);
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
