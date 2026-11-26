import test from 'node:test';
import assert from 'node:assert/strict';
import { readKeys, step, speedHud } from '../drive-core.js';

const ROAD = { vmax: 42, drag: 0.02, rough: false }, GRASS = { vmax: 12, drag: 0.7, rough: true }, TUNE = { power: 7.4, idle: 0.5, vtop: 50 };
const car = () => ({ pos: { x: 0, z: 0 }, h: 0, v: 0, steer: 0, spin: 0, roll: 0, pitch: 0 });
function drive(st, k, seconds, surf = ROAD, collide) { let s; for (let t = 0; t < seconds * 60; t++) s = step(st, k, 1 / 60, surf, TUNE, collide); return s; }

test('keys map to controls', () => {
  assert.deepEqual(readKeys({ ArrowUp: true, KeyA: true, Space: true }), { up: true, dn: undefined, lf: true, rt: undefined, hb: true });
});

test('accelerates on the road, slower and lower off it, and never past the top speed', () => {
  const road = car(), grass = car();
  drive(road, { up: true }, 10); drive(grass, { up: true }, 10, GRASS);
  assert.ok(road.v > 25 && road.v <= TUNE.vtop, 'road ' + road.v);
  assert.ok(grass.v > 5 && grass.v < 12, 'grass ' + grass.v);
  assert.ok(road.pos.x > 100 && Math.abs(road.pos.z) < 1e-9, 'drives straight along +x');
  const fast = { ...car(), v: 80 }; step(fast, {}, 1 / 60, ROAD, TUNE);
  assert.equal(fast.v, TUNE.vtop);
});

test('brakes, stops dead when coasting slowly, then reverses up to 9 m/s', () => {
  const st = car(); drive(st, { up: true }, 5);
  let s = step(st, { dn: true }, 1 / 60, ROAD, TUNE);
  assert.ok(s.braking && !s.reversing);
  drive(st, {}, 120); assert.equal(st.v, 0, 'coasts to a stop');
  s = drive(st, { dn: true }, 10);
  assert.equal(st.v, -9); assert.ok(s.reversing && !s.braking);
});

test('steering left turns the heading up, and the car leans into the turn', () => {
  const st = car(); drive(st, { up: true }, 3); drive(st, { up: true, lf: true }, 1);
  assert.ok(st.h > 0.3 && st.steer > 0, 'heading ' + st.h);
  assert.ok(st.pos.z < 0, 'heading > 0 moves toward -z');
  assert.ok(st.roll > 0);
});

test('a refused move leaves the car where it was', () => {
  const st = car(); drive(st, { up: true }, 2);
  const { x, z } = st.pos, h = st.h, seen = [];
  step(st, { up: true }, 1 / 60, ROAD, TUNE, (nx, nz, nh) => { seen.push([nx, nz, nh]); return true; });
  assert.deepEqual([st.pos.x, st.pos.z, st.h], [x, z, h]);
  assert.ok(seen.length === 1 && seen[0][0] > x, 'collide sees the move ahead');
});

test('smooth ground gives the same result every time; rough ground shakes the pitch', () => {
  const a = car(), b = car(); drive(a, { up: true, rt: true }, 4); drive(b, { up: true, rt: true }, 4);
  assert.deepEqual(a, b);
  const r = Math.random; let calls = 0; Math.random = () => (calls++, 0.9);
  try { drive(car(), { up: true }, 4, GRASS); } finally { Math.random = r; }
  assert.ok(calls > 0);
});

test('gear shows R only when actually rolling backwards', () => {
  const kmh = {}, gear = {};
  speedHud(kmh, gear, { v: -3 }, { reversing: true }); assert.deepEqual([kmh.textContent, gear.textContent], [11, 'R']);
  speedHud(kmh, gear, { v: 0 }, { reversing: true }); assert.equal(gear.textContent, 'N');
  speedHud(kmh, gear, { v: 12 }, { reversing: false }); assert.deepEqual([kmh.textContent, gear.textContent], [43, 'D']);
});
