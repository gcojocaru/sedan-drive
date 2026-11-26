import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivingAudio, engineTone, trafficVoices } from '../driving-audio.js';

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
  first.traffic([{ id: 1, x: 5, z: 0, h: 0, v: 10, braking: false, still: 0, paint: 3 }], { x: 0, z: 0, fx: 1, fz: 0, vx: 0, vz: 0 });
  assert.equal(first.toggleMute(), true);
  assert.equal(drivingAudio().toggleMute(), false);
  assert.equal(drivingAudio().toggleMute(), true);
});

// a listener at the origin facing east (+x), standing still
const ear = (extra = {}) => ({ x: 0, z: 0, fx: 1, fz: 0, vx: 0, vz: 0, wet: 0, ...extra });
const car = (extra = {}) => ({ id: 1, x: 30, z: 0, h: 0, v: 0, braking: false, still: 0, paint: 3, ...extra });

test('a passing car sounds higher coming and lower going', () => {
  const [coming] = trafficVoices([car({ h: Math.PI, v: 14 })], ear()), [going] = trafficVoices([car({ v: 14 })], ear());
  assert.ok(Math.abs(coming.frequency / going.frequency - (343 + 14) / (343 - 14)) < 1e-9);
  const [still] = trafficVoices([car()], ear()), [drivingAt] = trafficVoices([car()], ear({ vx: 14 })); // the listener moving towards a parked car
  assert.ok(drivingAt.frequency > still.frequency);
});

test('traffic is panned to its side of the listener and fades with distance', () => {
  const [north] = trafficVoices([car({ x: 0, z: -20 })], ear()), [south] = trafficVoices([car({ x: 0, z: 20 })], ear());
  assert.ok(north.pan < -0.7 && south.pan > 0.7, 'facing east, north is on the left');
  const [ahead] = trafficVoices([car()], ear());
  assert.ok(Math.abs(ahead.pan) < 1e-9);
  const voices = trafficVoices([5, 20, 60, 90, 40, 10].map((x, id) => car({ id, x, v: 8 })), ear(), 4);
  assert.deepEqual(voices.map(v => v.id), [0, 5, 1, 4], 'the four nearest, loudest first, none beyond 80 m');
  assert.ok(voices[0].gain > voices[1].gain && voices[1].gain > voices[3].gain);
});

test('tyres hiss with speed, more on a wet road, and cars honk at a player in their way', () => {
  const [parked] = trafficVoices([car()], ear()), [fast] = trafficVoices([car({ v: 16 })], ear()), [wet] = trafficVoices([car({ v: 16 })], ear({ wet: 1 }));
  assert.ok(parked.hiss === 0 && fast.hiss > 0 && wet.hiss > fast.hiss * 2);
  const me = {}, held = car({ ahead: me, still: 4 });
  assert.ok(trafficVoices([held], ear({ me }))[0].honk);
  assert.ok(!trafficVoices([{ ...held, still: 1 }], ear({ me }))[0].honk, 'not straight away');
  assert.ok(!trafficVoices([{ ...held, ahead: car() }], ear({ me }))[0].honk, 'not at another car');
});
