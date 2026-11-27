import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURED, RECENT_MAX, readRecent, addRecent, surprise } from '../places.js';

test('featured places are real coordinates with names', () => {
  assert.ok(FEATURED.length >= 6);
  for (const [name, lat, lon] of FEATURED) assert.ok(name && Math.abs(lat) < 70 && Math.abs(lon) <= 180, name);
});

test('recent places: newest first, the same spot once, at most six, junk dropped', () => {
  let list = readRecent(null);
  for (let i = 0; i < 8; i++) list = addRecent(list, { lat: 40 + i, lon: 20, name: 'P' + i });
  assert.equal(list.length, RECENT_MAX); assert.equal(list[0].name, 'P7');
  list = addRecent(list, { lat: 45.0004, lon: 20.0004, name: 'P5 again' });
  assert.equal(list[0].name, 'P5 again'); assert.equal(list.filter(p => Math.abs(p.lat - 45) < 0.01).length, 1);
  assert.deepEqual(readRecent([{ lat: 'x', lon: 1 }, { lat: 91, lon: 0 }, { lat: 1, lon: 2, name: 5 }, 7]), [{ lat: 1, lon: 2, name: '' }]);
});

test('surprise picks a featured place, never the last one', () => {
  const [, lat, lon] = FEATURED[0];
  for (const r of [0, 0.3, 0.6, 0.999]) assert.notEqual(surprise(r, { lat, lon })[0], FEATURED[0][0]);
  assert.equal(surprise(0, null)[0], FEATURED[0][0]);
});
