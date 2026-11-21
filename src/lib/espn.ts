/* Live sports data from ESPN's public (free, key-less) JSON endpoints. */
import { findLeague } from './sports';
import { HEADER, SITE, dedupe, parseCricketHeader, parseEventId, parseScoreboard, parseSummary, ymd } from './espnParse';
import type { Match } from './types';

export { makeEventId, parseEventId } from './espnParse';

const cache = new Map<string, { at: number; data: unknown }>();

/** Our own relay (Vercel function at /api/espn) — avoids browser CORS blocks. Not available in `vite dev`. */
const RELAY = import.meta.env.DEV ? null : `${location.origin}/api/espn?url=`;
let relayBroken = false;

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Fetch ESPN JSON via our relay first, falling back to a direct request. */
async function getJson(url: string, ttlMs = 45_000): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  let data: unknown;
  if (RELAY && !relayBroken) {
    try {
      const r = await fetch(RELAY + encodeURIComponent(url));
      if ((r.headers.get('content-type') ?? '').includes('json')) {
        if (!r.ok) throw new Error(`HTTP ${r.status}`); // ESPN answered with an error — report it
        data = await r.json();
      } else relayBroken = true; // relay not deployed here (e.g. static hosting) — go direct
    } catch (e) {
      if (/HTTP \d/.test(String(e))) throw e;
      relayBroken = true;
    }
  }
  if (data === undefined) data = await fetchJson(url);
  cache.set(url, { at: Date.now(), data });
  return data;
}

/** ESPN no longer accepts date ranges, so we ask for one day at a time. */
const DAYS_BACK = 1;
const DAYS_FORWARD = 6;

/** Fetch upcoming, live and recent matches for one league. */
export async function fetchLeague(leagueKey: string, liveOnly = false): Promise<Match[]> {
  if (leagueKey === 'cricket/all') return fetchCricket();
  const league = findLeague(leagueKey);
  const now = Date.now();
  const days = liveOnly ? [-1, 0] : Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => i - DAYS_BACK);
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
      const m = (await fetchLeague(ids.leagueKey, true)).find((x) => x.id === id);
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
