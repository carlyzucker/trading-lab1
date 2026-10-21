// OPTIONAL – nur nötig, falls dein Handy-Browser direkte Abfragen an Bybit blockiert (CORS).
// Kostenloser Cloudflare Worker (Free-Plan: 100'000 Anfragen/Tag). Leitet NUR lesende GET-Anfragen
// an die öffentlichen Marktdaten weiter. Keine Schlüssel, kein Handel möglich.
const ALLOWED = [
  'https://api.bybit.com/v5/market/',
  'https://data-api.binance.vision/api/v3/',
  'https://api.frankfurter.dev/v1/',
];

export default {
  async fetch(request) {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Nur GET', { status: 405, headers: cors });
    const target = new URL(request.url).searchParams.get('u') || '';
    if (!ALLOWED.some((p) => target.startsWith(p))) return new Response('Ziel nicht erlaubt', { status: 403, headers: cors });
    const res = await fetch(target, { headers: { Accept: 'application/json' } });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
