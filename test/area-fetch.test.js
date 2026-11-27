import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchArea } from '../area-fetch.js';

const ok = (elements = [{ type: 'way', id: 1 }]) => ({ ok: true, status: 200, json: async () => ({ elements }) });
const status = code => ({ ok: false, status: code, json: async () => ({}) });
const SERVERS = ['https://a.test/api', 'https://b.test/api', 'https://c.test/api'];
// a fake fetch: answers[host] is [ms, reply] (no reply: hangs until aborted); it records what was asked and when
function fakeFetch(answers) {
  const asked = [], t0 = Date.now();
  const fetch = (url, opts = {}) => { const host = new URL(url).host; asked.push([host, Date.now() - t0]); const [ms, reply] = answers[host] || [1e9];
    return new Promise((res, rej) => { const t = setTimeout(() => reply ? res(reply) : rej(new Error('down')), ms); opts.signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }); };
  return { fetch, asked };
}
const quick = { stagger: 40, patience: 150, vectorAfter: 60, wait: 1000, proxy: '', endpoints: SERVERS };

test('a fast server wins at once: first and full are the same full map, nothing else is asked', async () => {
  const { fetch, asked } = fakeFetch({ 'a.test': [10, ok()] }); let vec = 0;
  const { first, full } = fetchArea(45, 26, { ...quick, fetch, vector: async () => (vec++, { elements: [] }) });
  const f = await first; assert.ok(f.data && !f.fallback); assert.equal((await full).data, f.data);
  assert.deepEqual(asked.map(a => a[0]), ['a.test']); assert.equal(vec, 0);
});

test('a silent server gets company after the stagger; a failure starts the next at once; two at a time at most', async () => {
  const { fetch, asked } = fakeFetch({ 'a.test': [500, null], 'b.test': [5, status(502)], 'c.test': [20, ok()] });
  const f = await fetchArea(45, 26, { ...quick, fetch, vector: async () => null }).first;
  assert.ok(f.data && !f.fallback);
  assert.deepEqual(asked.map(a => a[0]), ['a.test', 'b.test', 'c.test']);
  assert.ok(asked[1][1] >= 35, 'b only after the stagger: ' + asked[1][1]); assert.ok(asked[2][1] - asked[1][1] < 30, 'c straight after b failed');
});

test('slow Overpass: drive on the simplified map after the patience; the full map still lands later', async () => {
  const { fetch } = fakeFetch({ 'a.test': [300, ok([{ type: 'way', id: 9 }])] });
  const simple = { elements: [{ type: 'way', id: 'v' }] };
  const { first, full } = fetchArea(45, 26, { ...quick, endpoints: ['https://a.test/api'], fetch, vector: async () => simple });
  const f = await first; assert.equal(f.data, simple); assert.ok(f.fallback);
  const g = await full; assert.equal(g.data.elements[0].id, 9);
});

test('every server fails: the simplified map, or the error when that fails too', async () => {
  const down = fakeFetch({ 'a.test': [5, status(500)], 'b.test': [5, status(504)], 'c.test': [5, status(502)] });
  const f = await fetchArea(45, 26, { ...quick, fetch: down.fetch, vector: async () => ({ elements: [] }) }).first;
  assert.ok(f.fallback && Array.isArray(f.data.elements));
  const e = await fetchArea(45, 26, { ...quick, fetch: down.fetch, vector: async () => { throw new Error('no tiles'); } }).first;
  assert.match(e.err.message, /502|504|500/);
});

test('429 rests the host; rested hosts are skipped; a busy proxy (503) stops asking Overpass', async () => {
  const rested = [], { fetch, asked } = fakeFetch({ 'a.test': [5, status(429)], 'c.test': [5, ok()] });
  const f = await fetchArea(45, 26, { ...quick, fetch, rested: h => h === 'b.test', rest: h => rested.push(h), vector: async () => null }).first;
  assert.ok(f.data); assert.deepEqual(rested, ['a.test']); assert.ok(!asked.some(a => a[0] === 'b.test'));
  const busy = fakeFetch({ 'proxy.test': [5, { ok: false, status: 503, json: async () => ({ error: 'all busy' }) }] });
  const g = await fetchArea(45, 26, { ...quick, proxy: 'https://proxy.test', fetch: busy.fetch, vector: async () => null }).full;
  assert.match(g.err.message, /all busy/); assert.deepEqual(busy.asked.map(a => a[0]), ['proxy.test']);
});
