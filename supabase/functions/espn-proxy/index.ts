// Optional fallback: a tiny CORS proxy for ESPN's public sports API.
// The app calls ESPN directly first and only uses this if the browser blocks the request.
// Deploy (free): supabase functions deploy espn-proxy --no-verify-jwt
const ALLOWED = /^https:\/\/(site\.api\.espn\.com|site\.web\.api\.espn\.com)\/apis\//;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const target = new URL(req.url).searchParams.get('url') ?? '';
  if (!ALLOWED.test(target)) return new Response('Only ESPN API URLs are allowed', { status: 400, headers: cors });
  const r = await fetch(target, { headers: { 'User-Agent': 'friendly-games/1.0' } });
  return new Response(await r.text(), {
    status: r.status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
});
