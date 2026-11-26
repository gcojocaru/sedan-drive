import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drivingAudio, engineTone, trafficVoices, tyreSound, impactSound } from '../driving-audio.js';

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
  first.update(8, false, true, { hb: true, steer: 0.3 });
  first.impact(12, 'car'); first.horn(true); first.horn(false);
  first.honkAt({ id: 1, x: 5, z: 0, h: 0, v: 0 }, { x: 0, z: 0, fx: 1, fz: 0, vx: 0, vz: 0 });
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

test('tyres squeal braking hard, on the handbrake, cornering at the limit and sliding, on hard ground only', () => {
  assert.equal(tyreSound(2, true, { hb: true }).squeal, 0, 'not at walking pace');
  assert.equal(tyreSound(15, false, { steer: 0.02 }).squeal, 0, 'not cruising');
  const braking = tyreSound(15, true).squeal, handbrake = tyreSound(15, false, { hb: true }).squeal;
  const cornering = tyreSound(14, false, { steer: 0.15 }).squeal, sliding = tyreSound(12, false, { slip: 0.4 }).squeal;
  assert.ok(braking > 0.3 && handbrake > 0.9 && cornering > 0.5 && sliding > 0.9, [braking, handbrake, cornering, sliding].join());
  assert.ok(tyreSound(25, true).squeal > braking, 'harder from higher up');
  assert.ok(tyreSound(14, false, { steer: 0.08, grip: 0.65 }).squeal > tyreSound(14, false, { steer: 0.08 }).squeal + 0.5, 'less grip, more squeal for the same turn');
  const grass = tyreSound(15, false, { hb: true, rough: true }), snow = tyreSound(15, false, { hb: true, snow: 1 }), wet = tyreSound(15, false, { hb: true, wet: 1 });
  assert.ok(grass.squeal === 0 && grass.rumble > 0.9 && snow.squeal === 0 && snow.rumble > 0);
  assert.ok(wet.squeal < handbrake && wet.swish > 0 && tyreSound(15, false).swish === 0);
});

test('crashes sound by how hard and into what', () => {
  assert.equal(impactSound(0.3, 'wall'), null);
  assert.equal(impactSound(1, 'car'), null, 'leaning on it makes no noise');
  const tap = impactSound(2, 'wall'), smash = impactSound(14, 'wall');
  assert.ok(smash.thump > tap.thump && smash.crunch > tap.crunch && smash.cutoff > tap.cutoff && smash.decay > tap.decay);
  assert.ok(smash.ring === 0 && smash.glass === 0, 'a wall neither rings nor breaks glass');
  assert.ok(impactSound(5, 'post').ring > impactSound(5, 'car').ring && impactSound(5, 'car').ring > 0);
  assert.ok(impactSound(5, 'car').glass === 0 && impactSound(14, 'car').glass > 0, 'glass only breaks in a hard hit');
  const thud = impactSound(8, 'person');
  assert.ok(thud.thump > 0 && !thud.crunch && !thud.ring && !thud.glass && thud.cutoff < impactSound(8, 'wall').cutoff, 'a person is a soft thud');
});

test('a traffic car braking hard screeches', () => {
  assert.ok(trafficVoices([car({ v: 12, brake: 8 })], ear())[0].screech);
  assert.ok(!trafficVoices([car({ v: 12, brake: 3 })], ear())[0].screech, 'not for an ordinary stop');
  assert.ok(!trafficVoices([car({ v: 2, brake: 8 })], ear())[0].screech, 'not at walking pace');
});
