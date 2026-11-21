import type { Bet, Outcome } from './types';

/**
 * The group "house line".
 *
 * Every match starts from a base line (real bookmaker odds when ESPN publishes them,
 * otherwise a sensible default). As friends put coins on an outcome, its price shortens
 * and the others drift — just like a real book. Odds are locked in at the moment a bet is placed.
 *
 * This exact formula is mirrored in SQL (`public.compute_odds`) so the server is the source of truth.
 */
export const LIQUIDITY = 1000;
export const MIN_ODDS = 1.01;
export const MAX_ODDS = 50;

export const OUTCOME_INDEX: Record<Outcome, number> = { home: 0, away: 1, draw: 2 };

export function computeLine(
  baseProbs: [number, number, number],
  allowDraw: boolean,
  stakes: [number, number, number],
): [number, number, number] {
  const n = allowDraw ? 3 : 2;
  const b = normalise(baseProbs, allowDraw);
  const total = stakes.slice(0, n).reduce((a, x) => a + x, 0);
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = (b[i] * LIQUIDITY + stakes[i]) / (LIQUIDITY + total);
    out[i] = clampOdds(1 / p);
  }
  return out;
}

export function normalise(p: [number, number, number], allowDraw: boolean): [number, number, number] {
  const v: [number, number, number] = [Math.max(p[0], 0.01), Math.max(p[1], 0.01), allowDraw ? Math.max(p[2], 0.01) : 0];
  const s = v[0] + v[1] + v[2];
  return [v[0] / s, v[1] / s, v[2] / s];
}

export function clampOdds(o: number): number {
  if (!isFinite(o)) return MAX_ODDS;
  return Math.round(Math.min(MAX_ODDS, Math.max(MIN_ODDS, o)) * 100) / 100;
}

export function stakesFor(bets: Bet[], eventId: string): [number, number, number] {
  const s: [number, number, number] = [0, 0, 0];
  for (const b of bets) {
    if (b.eventId !== eventId || b.status === 'void') continue;
    s[OUTCOME_INDEX[b.pick]] += b.stake;
  }
  return s;
}

/** Default starting line when no bookmaker odds are available. */
export function defaultProbs(allowDraw: boolean): [number, number, number] {
  return allowDraw ? [0.42, 0.31, 0.27] : [0.52, 0.48, 0];
}

/** American moneyline (e.g. -150 / +130) → implied probability. */
export function moneylineToProb(ml: number): number {
  if (!ml || !isFinite(ml)) return NaN;
  return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100);
}

export type OddsFormat = 'decimal' | 'fractional' | 'american';

export function formatOdds(decimal: number, fmt: OddsFormat): string {
  if (!decimal || decimal <= 1) return '—';
  if (fmt === 'decimal') return decimal.toFixed(2);
  if (fmt === 'american') {
    return decimal >= 2 ? `+${Math.round((decimal - 1) * 100)}` : `${Math.round(-100 / (decimal - 1))}`;
  }
  // fractional: find a tidy fraction
  const v = decimal - 1;
  let best = { n: Math.round(v), d: 1, err: Math.abs(v - Math.round(v)) };
  for (let d = 1; d <= 20; d++) {
    const n = Math.round(v * d);
    const err = Math.abs(v - n / d);
    if (err < best.err - 1e-9) best = { n, d, err };
  }
  const g = gcd(best.n, best.d) || 1;
  return `${best.n / g}/${best.d / g}`;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}

/** For a head-to-head challenge: what the friend accepting must risk. */
export function takerStake(stake: number, odds: number): number {
  return Math.round(stake * (odds - 1) * 100) / 100;
}

export function fmtCoins(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
