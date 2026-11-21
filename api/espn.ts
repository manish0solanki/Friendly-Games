// Same-origin relay for ESPN's free public sports API (avoids browser CORS blocks).
// Runs as a Vercel Edge Function (free tier). Responses are cached at the edge for 30s.
export const config = { runtime: 'edge' };

const ALLOWED = /^https:\/\/(site\.api\.espn\.com|site\.web\.api\.espn\.com)\/apis\//;

export default async function handler(req: Request): Promise<Response> {
  const target = new URL(req.url).searchParams.get('url') ?? '';
  const json = { 'content-type': 'application/json; charset=utf-8' };
  if (!ALLOWED.test(target)) {
    return new Response(JSON.stringify({ error: 'Only ESPN API URLs are allowed' }), { status: 400, headers: json });
  }
  try {
    const r = await fetch(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; FriendlyGames/1.0)' },
    });
    const body = await r.text();
    return new Response(body, {
      status: r.status,
      headers: { ...json, 'cache-control': r.ok ? 'public, s-maxage=30, stale-while-revalidate=120' : 'no-store' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...json, 'cache-control': 'no-store' } });
  }
}
