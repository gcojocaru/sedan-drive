import test from 'node:test';
import assert from 'node:assert/strict';
import { padControls, gamepad } from '../gamepad.js';

const btn = n => Array.from({ length: n }, () => ({ pressed: false, value: 0 }));
const std = (axis, set = {}) => { const buttons = btn(17); for (const i in set) buttons[i] = { pressed: set[i] > 0.5, value: set[i] }; return { mapping: 'standard', axes: [axis, 0, 0, 0], buttons }; };

test('standard pad: stick left steers left with a deadzone, triggers are gas and brake, buttons press their keys', () => {
  assert.ok(!padControls(std(0.1)).steer, 'deadzone');
  const c = padControls(std(-0.5, { 7: 0.5, 6: 1, 0: 1, 1: 1, 4: 1 }));
  assert.ok(c.steer > 0.2 && c.steer < 0.35, 'finer near the middle: ' + c.steer);
  assert.equal(padControls(std(1)).steer, -1);
  assert.ok(Math.abs(c.thr - 0.47) < 0.01 && c.brk === 1 && c.hb);
  assert.deepEqual(c.keys, [[1, 'KeyB'], [4, 'KeyQ', true]]);
  assert.equal(padControls(std(0, { 7: 0.03 })).thr, 0);
});

test('any other pad: axis 0 and buttons 0–3', () => {
  const buttons = btn(4); buttons[0] = { pressed: true, value: 1 }; buttons[3] = { pressed: true, value: 1 };
  const c = padControls({ mapping: '', axes: [0.8], buttons });
  assert.ok(c.steer < 0 && c.thr === 1 && c.brk === 0 && !c.hb); assert.deepEqual(c.keys, [[3, 'KeyC']]);
});

test('without the Gamepad API nothing happens and nothing throws', () => {
  const pad = gamepad(); assert.equal(pad.poll(), null);
  pad.feel(20, true, { hb: true }); // no pad: no rumble
});
