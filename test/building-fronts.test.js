import test from 'node:test';
import assert from 'node:assert/strict';
import { facadeWalls, isRetail, onOutline, planFronts, shopBays } from '../building-fronts.js';
import { overpassQuery } from '../osm-query.js';

const ring = [[0,0], [3,0], [9,0], [12,0], [12,8], [0,8]];
const walls = () => facadeWalls(ring, 1).map(w => ({...w, infer: true, retail: true}));
const street = w => w.nx === 1 ? 4 : Infinity;

test('entrance nodes on one straight facade retain their positions and split display bays', () => {
  const front = planFronts(walls(), [[3,0], [9,0]], street);
  const mapped = front.find(f => f.doors.length);
  assert.deepEqual(mapped.doors, [3,9]);
  assert.equal(front.filter(f => f.doors.length).length, 1);
  assert.equal(mapped.wall.length, 12);
  const bays = shopBays(12, mapped.doors);
  assert.ok(bays.length >= 3);
  for (const [a,b] of bays) {
    assert.ok(b - a >= 1.2 && a >= 0 && b <= 12);
    for (const center of mapped.doors) assert.ok(b <= center - 0.58 || a >= center + 0.58);
  }
});

test('the fallback places exactly one door on the street-facing wall in either winding', () => {
  for (const faceList of [walls(), facadeWalls(ring.slice().reverse(), -1).map(w => ({...w, infer:true}))]) {
    const front = planFronts(faceList, [], street);
    assert.equal(front.length, 1);
    assert.equal(front[0].wall.nx, 1);
    assert.deepEqual(front[0].doors, [4]);
  }
  assert.deepEqual(planFronts(walls(), [], () => Infinity), []);
});

test('a mapped courtyard entrance takes precedence and receives no inferred display windows', () => {
  const courtyard = facadeWalls([[2,2],[4,2],[8,2],[8,6],[2,6]], -1, true);
  const front = planFronts([...walls(), ...courtyard.map(w => ({...w, infer:true, retail:true}))], [[4,2]], street);
  const [door] = front.filter(f => f.doors.length);
  assert.equal(door.wall.courtyard, true);
  assert.equal(door.shop, false);
  assert.deepEqual(door.doors, [2]);
});

test('the parent outline distinguishes external building part edges from internal seams', () => {
  const outline = facadeWalls(ring, 1);
  const part = facadeWalls([[0,0],[6,0],[6,8],[0,8]], 1);
  assert.equal(onOutline(part[0], outline), true);
  assert.equal(onOutline(part[1], outline), false);
});

test('shop tags distinguish retail from other occupied buildings', () => {
  assert.ok(isRetail({building:'retail'}));
  assert.ok(isRetail({building:'yes', shop:'bakery'}));
  assert.equal(isRetail({building:'commercial'}), false);
  assert.equal(isRetail({building:'apartments', shop:'vacant'}), false);
  assert.match(overpassQuery(44,26), /node\["entrance"\]/);
});
