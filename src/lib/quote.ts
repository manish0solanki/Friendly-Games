/** Client for the signed match-state endpoint (api/quote.ts). */
export interface QuotePayload {
  v: number;
  id: string;
  state: 'pre' | 'in' | 'post';
  period: number;
  clock: number | null;
  status: string;
  score: string;
  homeScore: string | null;
  awayScore: string | null;
  result: 'home' | 'away' | 'draw' | 'void' | null;
  odds: [number, number, number] | null;
  liveOpen: boolean;
  challengeOpen: boolean;
  at: number;
}

export interface Quote {
  p: string;
  sig: string;
  payload: QuotePayload;
}

/** How long a live bet / cash out waits before its score check (must match fg_confirm_pending in SQL). */
export const CONFIRM_SECONDS = 30;

/** Only real ESPN events (not group-made specials) have quotes. */
export const hasQuotes = (eventId: string) => eventId.startsWith('espn:');

export async function fetchQuote(eventId: string, startTime: string): Promise<Quote> {
  let r: Response;
  try {
    r = await fetch(`${location.origin}/api/quote?id=${encodeURIComponent(eventId)}&start=${encodeURIComponent(startTime)}`, { cache: 'no-store' });
  } catch {
    throw new Error('Could not reach the live price server');
  }
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('json')) throw new Error('Live betting is only available on the online version of the site');
  const body = await r.json();
  if (!r.ok) throw new Error(body?.error ?? `Live price server error (${r.status})`);
  return body as Quote;
}

/** Wire format sent to the database (the payload is re-read from the signed string). */
export const quoteArg = (q: Quote) => ({ p: q.p, sig: q.sig });
