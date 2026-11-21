// Runs every 10 seconds (scheduled from Supabase with pg_cron + pg_net), so nothing depends on
// someone's phone being open:
//   * confirms or rejects live bets and cash outs that have waited 30 seconds
//   * settles finished matches that still have open bets or challenges
// Each action carries a freshly signed quote, so this endpoint can't be used to fake anything.
import { buildQuote, serverEnv } from '../src/lib/quoteServer';

export const config = { runtime: 'edge' };

interface Due {
  id: string;
  start_time: string;
  needs_confirm: boolean;
  needs_settle: boolean;
}

export default async function handler(): Promise<Response> {
  const url = serverEnv('VITE_SUPABASE_URL')?.replace(/\/$/, '');
  const key = serverEnv('VITE_SUPABASE_ANON_KEY');
  const secret = serverEnv('QUOTE_SECRET');
  const json = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (!url || !key || !secret) return new Response(JSON.stringify({ error: 'not configured' }), { status: 500, headers: json });

  const rpc = async (fn: string, body: unknown) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };

  const log: string[] = [];
  let due: Due[] = [];
  try {
    due = (await rpc('fg_due_events', {})) ?? [];
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: json });
  }
  // confirmations every run (every 10s); settlement checks once a minute is plenty
  const settleRound = new Date().getUTCSeconds() < 10;
  for (const d of due.filter((x) => x.needs_confirm || settleRound).slice(0, 25)) {
    try {
      const q = await buildQuote(d.id, Date.parse(d.start_time), secret);
      const arg = { p: q.p, sig: q.sig };
      if (d.needs_confirm) {
        const n = await rpc('fg_confirm_pending', { p_event_id: d.id, p_quote: arg });
        log.push(`${d.id}: confirmed ${n} (score ${q.payload.score})`);
      }
      if (d.needs_settle && settleRound && q.payload.result) {
        await rpc('fg_settle_event', { p_event_id: d.id, p_quote: arg });
        log.push(`${d.id}: settled ${q.payload.result}`);
      }
    } catch (e) {
      log.push(`${d.id}: ${String(e)}`);
    }
  }
  return new Response(JSON.stringify({ checked: due.length, log }), { status: 200, headers: json });
}
