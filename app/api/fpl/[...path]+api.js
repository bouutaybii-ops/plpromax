// Proxy l l'API dyal FPL: Safari w les navigateurs ma kaykhelliwch l-site yqra FPL direct (CORS).
// L-app web kat3ayet l /api/fpl/<chemin> w hna kanjibo mn fantasy.premierleague.com/api/<chemin>.
const FPL = 'https://fantasy.premierleague.com/api/';
// Ghir les chemins li kat-sta3mel l-app.
const ALLOWED = /^(bootstrap-static|fixtures|element-summary\/\d+|event\/\d+\/live|entry\/\d+\/(history|transfers|event\/\d+\/picks)|leagues-classic\/\d+\/standings)\/?$/;

export async function GET(request, { path }) {
  const rel = (Array.isArray(path) ? path.join('/') : String(path || '')).replace(/\/+$/, '');
  if (!ALLOWED.test(rel)) return Response.json({ error: 'not allowed' }, { status: 404 });
  const query = new URL(request.url).search;
  const r = await fetch(`${FPL}${rel}/${query}`, { headers: { 'User-Agent': 'PL PRO MAX (web)' } });
  // Live data: cache d9i9a. bootstrap kbir w ma kaytbeddelch bzzaf: 5 d9aye9.
  const maxAge = rel === 'bootstrap-static' ? 300 : 60;
  return new Response(r.body, {
    status: r.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}` },
  });
}
