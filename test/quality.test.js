import test from 'node:test';
import assert from 'node:assert/strict';
import { QUALITY, autoQuality, pickQuality, pixelRatio, dynamicRes } from '../quality.js';
import { percentile } from '../perf-hud.js';

test('auto quality: desktops High, small ones Medium, phones Medium, small phones Low', () => {
  assert.equal(autoQuality({}), 2);
  assert.equal(autoQuality({ cores: 4 }), 1);
  assert.equal(autoQuality({ coarse: true, cores: 8, memory: 8 }), 1);
  assert.equal(autoQuality({ coarse: true, cores: 4 }), 0);
  assert.equal(autoQuality({ coarse: true, memory: 2 }), 0);
});

test('a stored tier wins over auto; anything else is auto', () => {
  assert.equal(pickQuality(0, {}), 0);
  for (const bad of ['auto', null, 7, -1, 1.5, '1']) assert.equal(pickQuality(bad, { coarse: true }), 1, String(bad));
});

test('pixel ratio: the screen up to 1.5 within the budget, never below 0.6, times the dynamic scale', () => {
  const [low, , high] = QUALITY;
  assert.equal(pixelRatio(high, 2, 1024, 768), 1.5); // today's value on a laptop
  assert.equal(pixelRatio(high, 1, 1920, 1080), 1);
  assert.ok(Math.abs(pixelRatio(high, 2, 2560, 1440) ** 2 * 2560 * 1440 - high.pixels) < 1); // a big screen fills the budget
  assert.ok(pixelRatio(low, 3, 390, 844) ** 2 * 390 * 844 <= low.pixels + 1); // a phone stays inside Low
  assert.equal(pixelRatio(low, 1, 3840, 2160), 0.6);
  assert.ok(Math.abs(pixelRatio(high, 2, 1024, 768, 0.8) - 1.2) < 1e-9);
});

test('percentile of frame times', () => {
  assert.equal(percentile([], 0.5), 0);
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
});

test('dynamic resolution: slow windows cost a tenth (down to 0.7), patient good ones win it back, flip-flops back off', () => {
  const got = [], tick = dynamicRes(s => got.push(s), 60, 2), run = (ms, windows = 1) => { for (let i = 0; i < 60 * windows; i++) tick(ms); };
  run(30, 1); assert.deepEqual(got, [0.9]);
  run(30, 4); assert.deepEqual(got, [0.9, 0.8, 0.7]); // floor
  run(16.7, 1); assert.deepEqual(got.length, 3); // one good window isn't enough
  run(16.7, 1); assert.deepEqual(got.at(-1), 0.8); // 60 Hz vsync counts as good
  run(30, 1); assert.deepEqual(got.at(-1), 0.7); // the step up was too much: patience doubles to 4
  run(16.7, 3); assert.equal(got.at(-1), 0.7);
  run(16.7, 1); assert.equal(got.at(-1), 0.8);
  run(18.5, 10); assert.equal(got.at(-1), 0.8); // 54 fps: neither
});
