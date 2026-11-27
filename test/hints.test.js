import test from 'node:test';
import assert from 'node:assert/strict';
import { HINTS, nextHint, readShown } from '../hints.js';

const base = { t: 10, dark: false, headlights: false, stuck: 0, offRoad: 0, job: false, jobs: 0, idle: 0, cash: 0, cheapest: 40, garageSeen: false, touch: false };

test('a hint comes when its moment does, once, and not right after another', () => {
  assert.equal(nextHint(base, [], 99), null, 'nothing to say yet');
  assert.equal(nextHint({ ...base, dark: true }, [], 99).id, 'lights');
  assert.equal(nextHint({ ...base, dark: true, headlights: true }, [], 99), null);
  assert.equal(nextHint({ ...base, dark: true }, ['lights'], 99), null, 'once');
  assert.equal(nextHint({ ...base, dark: true }, [], 10), null, 'not within 30 s of the last');
});

test('stuck, idle without a job, and able to afford an upgrade each have their hint; touch words them for the buttons', () => {
  assert.equal(nextHint({ ...base, stuck: 5 }, [], 99).id, 'reset');
  assert.equal(nextHint({ ...base, idle: 30 }, [], 99).id, 'delivery');
  assert.equal(nextHint({ ...base, idle: 30, jobs: 3 }, [], 99), null, 'experienced: no delivery hint');
  assert.equal(nextHint({ ...base, cash: 40 }, [], 99).id, 'garage');
  assert.equal(nextHint({ ...base, cash: 40, garageSeen: true }, [], 99), null);
  assert.match(nextHint({ ...base, stuck: 5, touch: true }, [], 99).text, /•••/);
  assert.match(nextHint({ ...base, t: 100 }, [], 99).text, /^C /);
});

test('stored ids are filtered to known hints', () => {
  assert.deepEqual(readShown(['lights', 'nope', 3]), ['lights']); assert.deepEqual(readShown('x'), []);
  assert.equal(new Set(HINTS.map(h => h.id)).size, HINTS.length);
});
