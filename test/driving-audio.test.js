import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivingAudio, engineTone } from '../driving-audio.js';

test('the engine revs and opens up under load, then drops pitch on an upshift', () => {
  const idle = engineTone(0, false, false);
  const coasting = engineTone(6, false, false);
  const accelerating = engineTone(6, true, false);
  const upshifted = engineTone(8, true, false);
  assert.ok(idle.frequency > 20 && idle.frequency < 40);
  assert.ok(coasting.frequency > idle.frequency);
  assert.ok(accelerating.frequency > coasting.frequency);
  assert.ok(accelerating.gain > coasting.gain && accelerating.cutoff > coasting.cutoff);
  assert.ok(upshifted.frequency < accelerating.frequency);
});

test('braking unloads the engine and reverse throttle drives it in reverse gear', () => {
  assert.deepEqual(engineTone(5, false, true), engineTone(5, false, false));
  assert.deepEqual(engineTone(5, true, true), engineTone(5, false, false));
  assert.deepEqual(engineTone(-5, true, false), engineTone(-5, false, false));
  assert.ok(engineTone(-5, false, true).gain > engineTone(-5, false, false).gain);
  assert.ok(engineTone(-9, false, true).frequency > engineTone(-6, false, true).frequency);
});

test('toggling driving sounds survives a new area and works without Web Audio', t => {
  const items = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v),
  } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'sessionStorage', previous) : delete globalThis.sessionStorage);
  const first = drivingAudio();
  first.activate();
  first.update(8, true, false);
  first.tuningStatic();
  assert.equal(first.toggleMute(), true);
  assert.equal(drivingAudio().toggleMute(), false);
  assert.equal(drivingAudio().toggleMute(), true);
});
