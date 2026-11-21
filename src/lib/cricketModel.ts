/**
 * In-play cricket odds built from the scorecard (ESPN has no bookmaker odds for cricket).
 *
 *  - T20 / ODI: a Duckworth–Lewis-style "resources" model — runs still needed vs what the remaining
 *    overs and wickets can be expected to produce (or, batting first, projected total vs a par score).
 *  - Tests & other multi-day (first-class) matches: three outcomes incl. the draw. Weighs the lead,
 *    wickets in hand, innings still to bat and the time left in the match; a final-innings chase is
 *    modelled as "enough wickets?" × "enough time?".
 *
 * It's a deliberately simple, transparent model — good enough for friendly bragging-rights odds.
 */

export type CricketFormat = 't20' | 'odi' | 'test';

export interface Innings {
  runs: number;
  wkts: number;
  overs?: number; // balls as decimal overs (10.3 = 10.5)
  maxOvers?: number; // limited-overs innings length, e.g. 20 or 50
  declared: boolean;
  target?: number;
}

export interface CricketTeamState {
  innings: Innings[];
  order: number; // 1 = batted first
  batting: boolean;
}

export interface CricketState {
  format: CricketFormat;
  home: CricketTeamState;
  away: CricketTeamState;
  /** Multi-day only: scheduled days, current day, and whether play has stopped for the day. */
  days?: number;
  day?: number;
  stumps?: boolean;
}

// ---------------------------------------------------------------- parsing helpers

/** "309 & 109/2 (40 ov)", "62/2 (10.1/20 ov, target 175)", "392/9d & 5/0 (1.1 ov, target 2)" */
export function parseCricketScore(s: string | undefined): Innings[] {
  if (!s) return [];
  return s
    .split('&')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d+)(?:\/(\d+))?\s*(d)?/.exec(part);
      const inn: Innings = { runs: m ? +m[1] : 0, wkts: m?.[2] != null ? +m[2] : 10, declared: !!m?.[3] };
      const paren = /\(([^)]*)\)/.exec(part)?.[1] ?? '';
      const ov = /([\d.]+)(?:\/(\d+))?\s*ov/.exec(paren);
      if (ov) {
        const [whole, balls = '0'] = ov[1].split('.');
        inn.overs = +whole + +balls / 6;
        if (ov[2]) inn.maxOvers = +ov[2];
      }
      const t = /target\s+(\d+)/.exec(paren);
      if (t) inn.target = +t[1];
      // "56/0 (17 ov)" style innings without a slash count is still in progress; plain "245" is all out
      if (m?.[2] == null) inn.wkts = 10;
      return inn;
    });
}

export function detectFormat(cls: any, limitedOvers: unknown, scores: string[]): CricketFormat {
  const text = `${cls?.eventType ?? ''} ${cls?.generalClassCard ?? ''} ${cls?.name ?? ''}`.toLowerCase();
  if (/t20|twenty20/.test(text)) return 't20';
  if (/test|first-class/.test(text)) return 'test';
  if (/odi|list a|one-day|\bod\b/.test(text)) return 'odi';
  const max = scores.map((s) => /\/(\d+) ov/.exec(s ?? '')?.[1]).find(Boolean);
  if (max) return +max <= 20 ? 't20' : 'odi';
  return limitedOvers === false ? 'test' : 'odi';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "1st Test, India tour of New Zealand at Wellington, Nov 19-23 2026" → 5 */
export function scheduledDays(description: string | undefined, fallback: number): number {
  const m = /([A-Z][a-z]{2}) (\d{1,2})-(?:([A-Z][a-z]{2}) )?(\d{1,2}) (\d{4})/.exec(description ?? '');
  if (!m) return fallback;
  const y = +m[5];
  const start = Date.UTC(y, MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  const end = Date.UTC(y, MONTHS.indexOf((m[3] ?? m[1]).toLowerCase()), +m[4]);
  const days = Math.round((end - start) / 864e5) + 1;
  return days >= 1 && days <= 6 ? days : fallback;
}

// ---------------------------------------------------------------- maths

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Share of a 50-over innings' resources left with u overs remaining (0 wickets down) — fits the D/L table well.
const overRes = (u: number) => (1 - Math.exp(-Math.max(0, u) / 36)) / (1 - Math.exp(-50 / 36));
// Max resources left once w wickets have fallen (from the D/L table at 50 overs).
const WICKET_CAP = [1, 0.934, 0.851, 0.749, 0.627, 0.49, 0.349, 0.22, 0.119, 0.047, 0];

/** Fraction of a full innings' batting resources still available. */
export function resourcesLeft(oversLeft: number, wktsLost: number, maxOvers: number): number {
  const w = Math.min(10, Math.max(0, Math.round(wktsLost)));
  return Math.max(0, Math.min(overRes(oversLeft), WICKET_CAP[w] * overRes(50)) / overRes(maxOvers));
}

const PAR: Record<'t20' | 'odi', number> = { t20: 165, odi: 275 };

// Typical first-class runs added per wicket, top order first (sums to ~266, a typical innings).
const WICKET_RUNS = [40, 38, 36, 34, 32, 28, 22, 16, 12, 8];
/** Runs a side can still be expected to add with `wktsDown` wickets already gone. */
const runsInHand = (wktsDown: number) => WICKET_RUNS.slice(Math.min(10, Math.max(0, wktsDown))).reduce((a, x) => a + x, 0);
const FULL_INNINGS = runsInHand(0);

// ---------------------------------------------------------------- models

/** Probability that the side batting first wins a limited-overs match. */
function limitedOvers(format: 't20' | 'odi', first: CricketTeamState, second: CricketTeamState): number | null {
  const maxOvers = first.innings[0]?.maxOvers ?? second.innings[0]?.maxOvers ?? (format === 't20' ? 20 : 50);
  const i1 = first.innings[0];
  const i2 = second.innings[0];
  if (!i1) return null;
  const par = PAR[format];

  if (i2 && (i2.target || second.batting || i2.overs != null)) {
    // the chase
    const target = i2.target ?? i1.runs + 1;
    const needed = target - i2.runs;
    if (needed <= 0) return 0.01;
    const oversLeft = maxOvers - (i2.overs ?? 0);
    if (i2.wkts >= 10 || oversLeft <= 0) return 0.99;
    const expected = resourcesLeft(oversLeft, i2.wkts, maxOvers) * Math.max(target - 1, par * 0.6);
    const pChase = sigmoid((expected - needed) / (0.08 * (target - 1) + 6));
    return 1 - pChase;
  }

  // first innings in progress (or innings break): project the total and compare with par
  const overs = i1.overs ?? maxOvers;
  const done = i1.wkts >= 10 || overs >= maxOvers || (!first.batting && i1.overs == null);
  let projected = i1.runs;
  if (!done) {
    const rate = overs >= 3 ? i1.runs / overs / (par / maxOvers) : 1;
    projected += resourcesLeft(maxOvers - overs, i1.wkts, maxOvers) * par * Math.sqrt(Math.min(1.4, Math.max(0.6, rate)));
  }
  return sigmoid((projected - par) / (0.11 * par));
}

/** [home, away, draw] for a Test / first-class match. */
function multiDay(s: CricketState): [number, number, number] | null {
  const days = s.days ?? 5;
  const day = Math.min(days, Math.max(1, s.day ?? 1));
  const oversLeft = Math.max(0, (days - day) * 90 + (s.stumps ? 0 : 45));
  const sides = [s.home, s.away];
  const runs = sides.map((t) => t.innings.reduce((a, i) => a + i.runs, 0));
  const batIdx = sides.findIndex((t) => t.batting);
  const cur = batIdx >= 0 ? sides[batIdx].innings[sides[batIdx].innings.length - 1] : undefined;
  const wktsLeft = cur ? Math.max(0, 10 - cur.wkts) : 0;

  // final-innings chase
  if (batIdx >= 0 && cur?.target) {
    const needed = cur.target - cur.runs;
    if (needed <= 0) return batIdx === 0 ? [0.98, 0.01, 0.01] : [0.01, 0.98, 0.01];
    const scale = 0.15 * needed + 20;
    const pReach = sigmoid((runsInHand(10 - wktsLeft) - needed) / scale); // enough batting left to get there
    const pTime = sigmoid((oversLeft * 3.2 - needed) / scale); // enough time to get there
    const pAllOut = sigmoid((oversLeft - wktsLeft * 10) / 25); // time for the bowlers to finish the job
    const win = pReach * pTime;
    const lose = (1 - pReach) * pAllOut;
    const draw = Math.max(0, 1 - win - lose);
    return batIdx === 0 ? [win, lose, draw] : [lose, win, draw];
  }

  // otherwise: lead + what each side can still add, and whether there's time for a result
  const toBat = sides.map((t) => Math.max(0, 2 - t.innings.length));
  const future = sides.map((_, i) => (i === batIdx ? runsInHand(10 - wktsLeft) : 0) + toBat[i] * FULL_INNINGS);
  let oversNeeded = (batIdx >= 0 ? wktsLeft * 8 : 0);
  sides.forEach((_t, i) => {
    if (!toBat[i]) return;
    const opp = 1 - i;
    if (toBat[i] === 1 && sides[opp].innings.length === 2) {
      // this side bats last: it only needs to chase whatever lead the other side ends up with
      const target = runs[opp] + future[opp] - runs[i] + 1;
      oversNeeded += target <= 0 ? 0 : Math.min(95, target / 3.2);
    } else oversNeeded += toBat[i] * 95;
  });
  const pResult = sigmoid((oversLeft - 0.75 * oversNeeded) / 60);
  const adv = runs[0] + future[0] - (runs[1] + future[1]);
  const pHome = sigmoid(adv / 100);
  return [pResult * pHome, pResult * (1 - pHome), 1 - pResult];
}

/**
 * Win probabilities [home, away, draw]. Draw is 0 for limited-overs matches.
 * Returns null if the scorecard can't be read.
 */
export function cricketWinProbabilities(s: CricketState): [number, number, number] | null {
  let p: [number, number, number] | null;
  if (s.format === 'test') p = multiDay(s);
  else {
    const homeFirst = s.home.order === 1 || (s.home.order !== 2 && s.away.order === 2);
    const first = homeFirst ? s.home : s.away;
    const second = homeFirst ? s.away : s.home;
    const pFirst = limitedOvers(s.format, first, second);
    p = pFirst == null ? null : homeFirst ? [pFirst, 1 - pFirst, 0] : [1 - pFirst, pFirst, 0];
  }
  if (!p || p.some((x) => !isFinite(x))) return null;
  // keep every live outcome between 2% and 97%, then renormalise
  const n = s.format === 'test' ? 3 : 2;
  const c = p.map((x, i) => (i < n ? Math.min(0.97, Math.max(0.02, x)) : 0)) as [number, number, number];
  const sum = c[0] + c[1] + c[2];
  return [c[0] / sum, c[1] / sum, c[2] / sum];
}

/** A compact "material state" used to detect big events (wickets, new innings) for the betting pause. */
export function cricketStateKey(s: CricketState): string {
  const k = (t: CricketTeamState) => t.innings.map((i) => `${i.wkts}${i.declared ? 'd' : ''}`).join('&');
  return `w:${k(s.home)}|${k(s.away)}`;
}
