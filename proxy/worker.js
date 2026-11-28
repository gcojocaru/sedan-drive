// Caching proxy for the game's map downloads (Cloudflare Worker).
//
//   GET /area?lat=44.4270&lon=26.1025  →  the Overpass JSON for that place
//
// Each place is downloaded from Overpass once and then served to every player from Workers KV (and Cloudflare's
// edge cache where available), so the public Overpass servers see one request per place instead of one per player.
// The proxy only ever runs the game's own query (osm-query.js) for a snapped start point: it is not an open relay.

import { overpassQuery, areaKey, onGrid, ENDPOINTS } from '../osm-query.js';

const rest = new Map(); // server host → time until which we leave it alone (after HTTP 429/406, as the Overpass policy asks)
const MAX_KV = 25 * 1024 * 1024; // KV value size limit

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
    const any = allowed.includes('*'), cors = { 'Access-Control-Allow-Origin': any ? '*' : allowed.includes(origin) ? origin : allowed[0], Vary: 'Origin' };
    const reply = (status, error, extra = {}) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...cors, ...extra } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (url.pathname !== '/area') return reply(404, 'Use /area?lat=…&lon=…');
    if (req.method !== 'GET') return reply(405, 'Use GET');
    if (!any && !allowed.includes(origin)) return reply(403, 'This proxy only serves the Sedan Drive site');

    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!onGrid(lat) || !onGrid(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return reply(400, 'lat and lon must be start points snapped to the game grid');

    const key = areaKey(lat, lon), headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', ...cors };
    const edge = globalThis.caches && caches.default, edgeKey = new Request('https://area-cache.invalid/' + encodeURIComponent(key));

    // 1. Cloudflare's edge cache (may be unavailable on workers.dev; then this is simply a miss)
    if (edge) { const hit = await edge.match(edgeKey).catch(() => null); if (hit) return new Response(hit.body, { headers: { ...headers, 'X-Area-Source': 'edge' } }); }
    // 2. Workers KV
    if (env.AREAS) {
      const stored = await env.AREAS.get(key, 'arrayBuffer').catch(() => null);
      if (stored) {
        if (edge) ctx.waitUntil(edge.put(edgeKey, new Response(stored.slice(0), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } })).catch(() => { }));
        return new Response(stored, { headers: { ...headers, 'X-Area-Source': 'kv' } });
      }
    }
    // 3. Overpass, one server at a time. The Origin header is easy to fake, so new downloads are capped (UPSTREAM in
    // wrangler.toml, counted per Cloudflare location): a script walking the grid can't make the public servers turn the
    // proxy away. Over the cap it answers 429, which the game takes as "ask Overpass yourself".
    if (env.UPSTREAM && !(await env.UPSTREAM.limit({ key: 'overpass' })).success) return reply(429, 'too many new places at once', { 'Retry-After': '60' });
    const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon)), ua = 'SedanDrive-map-proxy/1.0' + (env.APP_URL ? ' (+' + env.APP_URL + ')' : '');
    let last = 'no map server answered';
    for (const u of ENDPOINTS) {
      const host = new URL(u).host;
      if ((rest.get(host) || 0) > Date.now()) { last = host + ' asked us to wait'; continue; }
      try {
        const r = await fetch(u, { method: 'POST', body, signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': ua, ...(env.APP_URL ? { Referer: env.APP_URL } : {}) } });
        if (r.status === 429 || r.status === 406) { rest.set(host, Date.now() + 30000); last = host + ' asked us to wait'; continue; }
        if (!r.ok) { last = host + ' replied ' + r.status; continue; }
        const buf = await r.arrayBuffer();
        if (!looksComplete(buf)) { last = host + ' sent an incomplete answer'; continue; }
        const days = Math.max(1, Number(env.TTL_DAYS) || 30);
        if (env.AREAS && buf.byteLength <= MAX_KV) await env.AREAS.put(key, buf.slice(0), { expirationTtl: days * 86400 }).catch(() => { }); // storage full or quota hit: still serve it
        return new Response(buf, { headers: { ...headers, 'X-Area-Source': host } });
      } catch (e) { last = host + (e && e.name === 'TimeoutError' ? ' did not answer in time' : ' could not be reached'); }
    }
    return reply(503, last, { 'Retry-After': '30' });
  }
};

// Cheap sanity check without parsing megabytes of JSON (the free plan allows 10 ms of CPU per request): the reply must
// look like Overpass JSON with an elements list, and must not end with an error remark (timeouts, memory).
function looksComplete(buf) {
  if (buf.byteLength < 20) return false;
  const td = new TextDecoder(), head = td.decode(buf.slice(0, Math.min(4096, buf.byteLength))), tail = td.decode(buf.slice(Math.max(0, buf.byteLength - 2048)));
  return head.trimStart().startsWith('{') && head.includes('"elements"') && !/"remark"\s*:\s*"[^"]*error/i.test(tail) && tail.trimEnd().endsWith('}');
}
