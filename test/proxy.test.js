import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy/worker.js';
import { areaKey } from '../osm-query.js';

// The Worker with a fake KV, a fake rate limit and fake Overpass servers (answer(url) → Response).
const ORIGIN = 'https://gcojocaru.github.io';
async function call(path, { answer = () => new Response('{}'), kv = new Map(), allow = true, origin = ORIGIN } = {}) {
  const asked = [], realFetch = globalThis.fetch;
  globalThis.fetch = async u => { asked.push(u); return answer(u); };
  const env = { ALLOWED_ORIGINS: ORIGIN, AREAS: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, UPSTREAM: { limit: async () => ({ success: allow }) } };
  try {
    const r = await worker.fetch(new Request('https://proxy.test' + path, { headers: { Origin: origin } }), env, { waitUntil() { } });
    return { r, asked, kv };
  } finally { globalThis.fetch = realFetch; }
}
const enc = s => new TextEncoder().encode(s).buffer;

test('the proxy only serves the game, on its grid', async () => {
  assert.equal((await call('/area?lat=44.4271&lon=26.1025')).r.status, 400, 'off the grid');
  assert.equal((await call('/area?lat=44.4270&lon=26.1025', { origin: 'https://elsewhere.example' })).r.status, 403);
  assert.equal((await call('/nope')).r.status, 404);
});

test('a stored place is served from KV without asking Overpass', async () => {
  const kv = new Map([[areaKey(44.427, 26.1025), enc('{"elements":[]}')]]);
  const { r, asked } = await call('/area?lat=44.4270&lon=26.1025', { kv });
  assert.equal(r.status, 200); assert.equal(r.headers.get('X-Area-Source'), 'kv'); assert.equal(asked.length, 0);
});

test('a complete answer is stored; an Overpass error is never stored for everyone', async () => {
  const good = await call('/area?lat=44.4270&lon=26.1025', { answer: () => new Response('{"version":0.6,"elements":[{"type":"node"}]}') });
  assert.equal(good.r.status, 200); assert.ok(good.kv.has(areaKey(44.427, 26.1025)));
  const broken = await call('/area?lat=44.4275&lon=26.1025', { answer: () => new Response('{"version":0.6,"elements":[],"remark":"runtime error: Query timed out"}') });
  assert.equal(broken.r.status, 503, 'every server sent an incomplete answer');
  assert.equal(broken.asked.length, 4, 'each server was tried once');
  assert.equal(broken.kv.size, 0, 'nothing broken is cached');
});

test('over the download cap it answers 429 without asking Overpass', async () => {
  const { r, asked } = await call('/area?lat=44.4280&lon=26.1025', { allow: false });
  assert.equal(r.status, 429); assert.equal(asked.length, 0);
});
