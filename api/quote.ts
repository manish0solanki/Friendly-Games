// Signed match state ("quote") for live betting, cash out and settlement.
// The database only accepts live prices and final results that carry this
// server's HMAC signature, so nobody can fake odds or results from the browser.
import { QuoteError, buildQuote, serverEnv } from '../src/lib/quoteServer';

export const config = { runtime: 'edge' };

const json = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export default async function handler(req: Request): Promise<Response> {
  const secret = serverEnv('QUOTE_SECRET');
  if (!secret) return new Response(JSON.stringify({ error: 'Live betting is not configured on this server' }), { status: 500, headers: json });
  const params = new URL(req.url).searchParams;
  try {
    const q = await buildQuote(params.get('id') ?? '', Date.parse(params.get('start') ?? ''), secret);
    return new Response(JSON.stringify(q), { status: 200, headers: json });
  } catch (e) {
    const status = e instanceof QuoteError ? e.status : 500;
    return new Response(JSON.stringify({ error: (e as Error).message }), { status, headers: json });
  }
}
