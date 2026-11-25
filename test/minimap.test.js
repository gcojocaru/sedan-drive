import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapView } from '../minimap.js';

test('the car stays at the centre as the north-up view moves east and south', () => {
  const origin = minimapView(0, 0, 0, 500);
  const moved = minimapView(40, 60, 0, 500);
  assert.equal(origin.left + origin.span / 2, 500);
  assert.equal(origin.top + origin.span / 2, 500);
  assert.equal(moved.left - origin.left, 40);
  assert.equal(moved.top - origin.top, 60);
});

test('at the playable boundary the view includes the space beyond the map', () => {
  const northwest = minimapView(-500, -500, 0, 500);
  const southeast = minimapView(500, 500, 0, 500);
  assert.equal(northwest.left, -northwest.span / 2);
  assert.equal(northwest.top, -northwest.span / 2);
  assert.equal(southeast.left + southeast.span / 2, 1000);
  assert.equal(southeast.top + southeast.span / 2, 1000);
});

test('the arrow follows car heading on a canvas with north at the top', () => {
  for (const [heading, dx, dy] of [[0, 1, 0], [Math.PI / 2, 0, -1], [Math.PI, -1, 0], [-Math.PI / 2, 0, 1]]) {
    const { rotation } = minimapView(0, 0, heading, 500);
    assert.ok(Math.abs(Math.sin(rotation) - dx) < 1e-10);
    assert.ok(Math.abs(-Math.cos(rotation) - dy) < 1e-10);
  }
});
