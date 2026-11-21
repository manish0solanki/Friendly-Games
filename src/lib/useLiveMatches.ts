import { useEffect, useState } from 'react';
import { fetchMatch } from './espn';
import { hasQuotes } from './quote';
import type { Match } from './types';

/**
 * Live score, clock and in-play odds for the given events, refreshed every 20s.
 * Only fetches events that have started (and are real ESPN matches).
 */
export function useLiveMatches(events: { id: string; startTime: string; settled?: boolean }[]): Record<string, Match> {
  const [live, setLive] = useState<Record<string, Match>>({});
  const key = events
    .filter((e) => !e.settled && hasQuotes(e.id) && Date.parse(e.startTime) <= Date.now() + 60_000)
    .map((e) => e.id)
    .sort()
    .join('|');

  useEffect(() => {
    if (!key) return;
    const ids = key.split('|');
    let alive = true;
    const load = async () => {
      const results = await Promise.all(ids.map((id) => fetchMatch(id).catch(() => null)));
      if (!alive) return;
      setLive((prev) => {
        const next = { ...prev };
        results.forEach((m, i) => {
          if (m) next[ids[i]] = m;
        });
        return next;
      });
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [key]);

  return live;
}

/** Fair cash-out value: stake × odds taken ÷ current odds for the same selection. */
export function cashOutValue(stake: number, odds: number, currentOdds: number | undefined): number | null {
  if (!currentOdds || currentOdds <= 1) return null;
  return Math.max(0.01, Math.round(((stake * odds) / currentOdds) * 100) / 100);
}
