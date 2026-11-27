import test from 'node:test';
import assert from 'node:assert/strict';
import { readKeys, step, speedHud, chaseCamera } from '../drive-core.js';

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
  const { x, z } = st.pos, h = st.h, seen = [], v = st.v;
  const r = step(st, { up: true }, 1 / 60, ROAD, TUNE, (nx, nz, nh) => { seen.push([nx, nz, nh]); return 'stop'; });
  assert.deepEqual([st.pos.x, st.pos.z, st.h], [x, z, h]);
  assert.ok(seen.length === 1 && seen[0][0] > x, 'collide sees the move ahead');
  assert.ok(r.blocked && Math.abs(r.impact - v) < 1e-9, 'blocked at full speed');
});

test('a wall at a shallow angle is glanced off: the car slides along it, keeping most of its speed', () => {
  const wall = (x, z) => z < 0.268 * (x - 5); // 15° across the path, from x = 5
  const st = { ...car(), v: 15 }; let impacts = 0, first = 0;
  for (let i = 0; i < 60; i++) { const r = step(st, { up: true }, 1 / 60, ROAD, TUNE, wall); if (r.impact) { impacts++; first ||= r.impact; } assert.ok(!r.blocked, 'never stopped dead'); }
  assert.ok(impacts > 0 && first < 15 * 0.5, 'hit glancingly: ' + first);
  assert.ok(st.v > 15 * 0.75, 'keeps its speed: ' + st.v);
  assert.ok(st.pos.z > 0.5 && !wall(st.pos.x, st.pos.z), 'moved along the wall, outside it');
});

test('a wall square across the path stops the car: blocked, at full speed', () => {
  const st = { ...car(), v: 15 }, r = step(st, { up: true }, 1 / 60, ROAD, TUNE, x => x > 0.1);
  assert.ok(r.blocked && r.impact === 15 && st.pos.x === 0);
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

const WET = { ...ROAD, grip: 0.65 }, SNOW = { ...ROAD, grip: 0.45 };
function brakeFrom(v, surf) { const st = { ...car(), v }; let n = 0; while (st.v > 0 && n++ < 1000) step(st, { dn: true }, 1 / 60, surf, TUNE); return st.pos.x; }
function corner(kmh, surf) { // full lock from kmh until the car is moving at right angles to where it started
  const st = { ...car(), v: kmh / 3.6 }; let slip = 0, n = 0;
  while (Math.abs(st.h + (st.slip || 0)) < Math.PI / 2 && n++ < 900) { step(st, { lf: true }, 1 / 60, surf, TUNE); slip = Math.max(slip, Math.abs(st.slip)); }
  return { ahead: st.pos.x, slip, st };
}

test('dry ground is the same with or without a grip; held keys corner inside the grip and never slide', () => {
  const a = car(), b = car(), k = { up: true, lf: true };
  drive(a, k, 6); drive(b, k, 6, { ...ROAD, grip: 1 });
  assert.deepEqual(a, b); assert.equal(a.slip, 0);
  for (const kmh of [30, 50, 90]) {
    const st = { ...car(), v: kmh / 3.6 }; let worst = 0;
    for (let i = 0; i < 90; i++) { const h = st.h; step(st, { lf: true, up: true }, 1 / 60, ROAD, TUNE); worst = Math.max(worst, st.v * (st.h - h) * 60); }
    assert.ok(worst <= 15 && Math.abs(st.slip) < 1e-9, kmh + ' km/h: ' + worst.toFixed(1) + ' m/s² sideways, slip ' + st.slip);
  }
});

test('the handbrake throws the car into a slide; holding the throttle keeps it going; letting go catches it', () => {
  const st = { ...car(), v: 50 / 3.6, slip: 0 }; let t = 0;
  while (Math.abs(st.slip) < 0.4 && t < 0.7) { step(st, { lf: true, hb: true }, 1 / 60, ROAD, TUNE); t += 1 / 60; }
  assert.ok(Math.abs(st.slip) >= 0.4, 'slides within 0.7 s: ' + st.slip);
  const drift = { ...st, pos: { ...st.pos } }, v0 = drift.v; drive(drift, { up: true, lf: true }, 1);
  assert.ok(Math.abs(drift.slip) > 0.15 && drift.v > 0.7 * v0, 'power keeps the drift: slip ' + drift.slip + ', ' + drift.v + ' of ' + v0);
  drive(st, {}, 1.5); assert.ok(Math.abs(st.slip) < 0.02, 'caught: ' + st.slip);
});

test('the body rocks on springs: braking to a stop pitches forward, overshoots back, then settles', () => {
  const st = { ...car(), v: 50 / 3.6 }; let fwd = 0, back = 0;
  while (st.v > 0) { step(st, { dn: true }, 1 / 60, ROAD, TUNE); fwd = Math.min(fwd, st.pitch); }
  for (let i = 0; i < 72; i++) { step(st, {}, 1 / 60, ROAD, TUNE); back = Math.max(back, st.pitch); }
  assert.ok(fwd < -0.02 && back > 0.002, 'dives ' + fwd + ', rocks back ' + back);
  assert.ok(Math.abs(st.pitch) < 0.002, 'settles: ' + st.pitch);
});

test('less grip: longer braking, a slower start on snow', () => {
  const dry = brakeFrom(13.9, ROAD), wet = brakeFrom(13.9, WET), snow = brakeFrom(13.9, SNOW);
  assert.ok(dry > 4 && dry < 7, 'dry ' + dry);
  assert.ok(wet > dry * 1.35 && snow > dry * 1.9, 'wet ' + wet + ', snow ' + snow);
  const t = surf => { const st = car(); let n = 0; while (st.v < 13.9) { step(st, { up: true }, 1 / 60, surf, TUNE); n++; } return n / 60; };
  assert.ok(t(SNOW) > t(ROAD) * 1.3, 'snow pulls away slower');
});

test('wet corners hold at town speeds; faster, the car slides wide and recovers', () => {
  const slow = corner(25, WET), dry = corner(25, ROAD);
  assert.equal(slow.slip, 0); assert.ok(Math.abs(slow.ahead - dry.ahead) < 1e-6, 'same line as dry');
  const fast = corner(70, WET), dryFast = corner(70, ROAD);
  assert.ok(fast.slip > 0.2 && fast.slip <= 0.65 + 1e-9, 'slides, the body at most 0.65 rad ahead: ' + fast.slip);
  assert.ok(fast.ahead > dryFast.ahead + 2, 'runs wide');
  assert.ok(fast.st.v < dryFast.st.v, 'sliding scrubs speed');
  assert.ok(corner(40, SNOW).slip > corner(40, WET).slip + 0.2 && corner(30, WET).slip < 0.1, 'snow slides sooner; wet holds at 30');
  const st = fast.st; drive(st, {}, 2, WET);
  assert.ok(Math.abs(st.slip) < 0.02, 'lets go: moving where it points again: ' + st.slip);
});

test('a slide left over when the ground dries is caught quickly', () => {
  const st = corner(70, WET).st; assert.ok(st.slip);
  drive(st, {}, 0.5); assert.ok(Math.abs(st.slip) < 0.05, 'caught: ' + st.slip);
});

test('better brakes stop the car shorter', () => {
  const stopAt = brake => { const st = { ...car(), v: 13.9 }; let n = 0; while (st.v > 0 && n++ < 1000) step(st, { dn: true }, 1 / 60, ROAD, { ...TUNE, brake }); return st.pos.x; };
  assert.ok(stopAt(1.25) < stopAt(1) * 0.85 && stopAt(1.25) > stopAt(1) * 0.7, stopAt(1) + ' → ' + stopAt(1.25));
  assert.equal(stopAt(undefined), stopAt(1), 'stock brakes when the tune says nothing');
});

// ---- chase camera ----
function camRig() {
  const P = (x = 0, y = 0, z = 0) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, clone() { return P(this.x, this.y, this.z); }, copy(o) { return this.set(o.x, o.y, o.z); } });
  const camera = { position: P(), look: null, fov: 0, lookAt(x, y, z) { this.look = { x, y, z }; }, updateProjectionMatrix() { } };
  return { camera, cam: chaseCamera(camera, {}), back: st => Math.hypot(camera.position.x - st.pos.x, camera.position.z - st.pos.z),
    view: () => Math.atan2(-(camera.look.z - camera.position.z), camera.look.x - camera.position.x) };
}
function ride(cam, st, seconds, occluded) { for (let t = 0; t < seconds * 60; t++) { st.pos.x += Math.cos(st.h + st.slip) * st.v / 60; st.pos.z -= Math.sin(st.h + st.slip) * st.v / 60; cam.update(st, 0, 1 / 60, occluded); } }

test('the chase camera keeps its distance at speed instead of falling behind', () => {
  const { cam, back } = camRig(), st = { ...car(), slip: 0 };
  cam.reset(st); ride(cam, st, 1); const rest = back(st);
  st.v = 30; ride(cam, st, 2);
  assert.ok(rest > 7.5 && rest < 8.1, 'rest ' + rest);
  assert.ok(back(st) <= rest && back(st) > rest - 1.1, 'at 30 m/s ' + back(st)); // was about 16 m
});

test('in a slide the chase camera turns towards the path', () => {
  const { cam, view } = camRig(), st = { ...car(), v: 15, slip: 0.4 };
  cam.reset(st); ride(cam, st, 1);
  assert.ok(Math.abs(view() - 0.4) < 0.12 && view() > 0.25, 'view ' + view());
});

test('the chase camera pulls in at once in front of an occluder and eases back out', () => {
  const { cam, back } = camRig(), st = { ...car(), slip: 0 };
  cam.reset(st); ride(cam, st, 1);
  const pole = (x, z) => Math.hypot(x + 5, z) < 0.5;
  ride(cam, st, 1 / 60, pole); assert.ok(back(st) < 4.7, 'first frame ' + back(st));
  ride(cam, st, 0.3, pole); assert.ok(Math.abs(back(st) - 4.2) < 0.1, 'settled ' + back(st));
  ride(cam, st, 0.1); assert.ok(back(st) < 5.2, 'still close after 0.1 s ' + back(st));
  ride(cam, st, 3); assert.ok(back(st) > 7.5, 'back out ' + back(st));
});

// ---- gamepad: analogue steer, throttle and brake (gamepad.js → readKeys(keys, pad)) ----
const PAD = { steer: 0, thr: 0, brk: 0, hb: false };
test('readKeys merges a pad; held keys override it at full; no pad gives the keys alone', () => {
  assert.deepEqual(readKeys({ ArrowUp: true }), readKeys({ ArrowUp: true }, null));
  const k = readKeys({}, { ...PAD, steer: -0.4, thr: 0.6, hb: true });
  assert.deepEqual([k.up, k.dn, k.hb, k.steer, k.thr, k.brk], [true, false, true, -0.4, 0.6, 0]);
  const both = readKeys({ ArrowUp: true, ArrowLeft: true, ArrowDown: true }, { ...PAD, steer: -0.4, thr: 0.3, brk: 0.2 });
  assert.deepEqual([both.steer, both.thr, both.brk, both.lf], [undefined, 1, 1, true]);
});

test('a full pad drives exactly like the keys; an idle one is like no keys', () => {
  const a = car(), b = car(), c = car(), d = car();
  drive(a, readKeys({ ArrowUp: true, ArrowLeft: true }), 4); drive(b, readKeys({}, { ...PAD, steer: 1, thr: 1 }), 4);
  assert.deepEqual(a, b);
  c.v = d.v = 10; drive(c, readKeys({}), 3); drive(d, readKeys({}, PAD), 3);
  assert.deepEqual(c, d);
});

test('half stick turns about half as fast; half throttle and brake pull about half as hard', () => {
  const yaw = steer => { const st = { ...car(), v: 10 }; drive(st, { steer }, 1); const h = st.h; step(st, { steer }, 1 / 60, ROAD, TUNE); return st.h - h; };
  const r = yaw(0.5) / yaw(1); assert.ok(r > 0.42 && r < 0.58, 'yaw ratio ' + r);
  const dv = k => { const st = { ...car(), v: 10 }; step(st, k, 1 / 60, ROAD, TUNE); return st.v - 10; }, coast = dv({});
  const gas = (dv({ up: true, thr: 0.5 }) - coast) / (dv({ up: true }) - coast), brake = (dv({ dn: true, brk: 0.5 }) - coast) / (dv({ dn: true }) - coast);
  assert.ok(Math.abs(gas - 0.5) < 0.05 && Math.abs(brake - 0.5) < 0.05, 'gas ' + gas + ', brake ' + brake);
});

test('before the start the camera orbits the car, 7 to 11 m out and 1.6 to 4.5 m up, looking at it', () => {
  const { camera, cam, back } = camRig(), st = { ...car(), pos: { x: 5, z: -3 } };
  for (let t = 0; t < 60; t += 0.7) {
    cam.orbit(st, t); const d = back(st);
    assert.ok(d >= 7 - 1e-9 && d <= 11 + 1e-9 && camera.position.y >= 1.6 - 1e-9 && camera.position.y <= 4.5 + 1e-9, t + ': ' + d + ', ' + camera.position.y);
    assert.deepEqual([camera.look.x, camera.look.z], [5, -3]);
  }
});

test('opposite headings on the same hill change coasting speed in opposite directions', () => {
  const hill = { ...ROAD, height: x => 50 + 0.15 * x };
  const uphill = { ...car(), v: 12 }, downhill = { ...car(), v: 12, h: Math.PI };
  drive(uphill, {}, 2, hill);
  drive(downhill, {}, 2, hill);
  assert.ok(uphill.v < 10 && downhill.v > 13);
  assert.equal(drive(car(), { hb: true }, 2, hill).reversing, false);
});

test('a sedan facing across the slope banks toward the low side', async () => {
  const { groundPose } = await import('../car-ground.js');
  const height = (x, z) => 41 + x * 0.2 - z * 0.12;
  for (const h of [0, Math.PI / 2, Math.PI, 1.213]) {
    const p = groundPose(height, -20, 35, h);
    assert.equal(p.y, height(-20, 35));
    const forward = Math.tan(p.pitch) / Math.cos(p.roll);
    const sideways = -Math.tan(p.roll);
    assert.ok(Math.abs(forward - (0.2 * Math.cos(h) + 0.12 * Math.sin(h))) < 1e-10);
    assert.ok(Math.abs(sideways - (0.2 * Math.sin(h) - 0.12 * Math.cos(h))) < 1e-10);
  }
});
