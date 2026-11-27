// Driving shared by both drive pages: controls, the physics step, posing the car, the chase camera and the speed HUD.
import { groundPose, roadGrade } from './car-ground.js';

// held keys (by KeyboardEvent.code) → controls; pad (gamepad.js poll(), optional) adds analogue steer (left 1 … right -1),
// thr and brk (0–1), which held keys override at full
export function readKeys(k, pad) {
  const c = { up: k.KeyW || k.ArrowUp, dn: k.KeyS || k.ArrowDown, lf: k.KeyA || k.ArrowLeft, rt: k.KeyD || k.ArrowRight, hb: k.Space };
  if (!pad) return c;
  return { up: c.up || pad.thr > 0, dn: c.dn || pad.brk > 0, lf: c.lf, rt: c.rt, hb: c.hb || pad.hb,
    steer: c.lf || c.rt ? undefined : pad.steer, thr: c.up ? 1 : pad.thr, brk: c.dn ? 1 : pad.brk };
}

// Set up a buildCar()-shaped car for driving: lamps off, shadows only from the body, wheels found by name.
export function rigCar(C) {
  const car = C.car; car.rotation.order = 'YXZ';
  C.lights.low.concat(C.lights.high, C.lights.fog, C.extraLights).forEach(l => { l.visible = false; l.intensity = 0; });
  car.traverse(o => { if (o.isMesh) { o.castShadow = o.material !== C.glass && o.material !== C.lensClear; o.receiveShadow = false; } });
  C.IN.traverse(o => { if (o.isMesh) o.castShadow = false; });
  car.getObjectByName('underbody')?.traverse(o => { if (o.isMesh) o.castShadow = false; });
  const wheels = ['front_R', 'front_L', 'rear_R', 'rear_L'].map(k => { const w = car.getObjectByName('wheel_' + k); return w && { w, front: k.startsWith('front'), side: k.endsWith('R') ? 1 : -1, base: w.rotation.y }; }).filter(Boolean);
  return { C, car, wheels, swFace: car.getObjectByName('steering_wheel_face') };
}

// One physics step of st = { pos, h, v, steer, spin, roll, pitch, slip } (m, rad, m/s; heading 0 = +x; slip: the angle
// from the heading to the way the car is actually moving, 0 unless it slides; rw, pw: the body's roll and pitch rates).
// k: controls from readKeys (steer, thr and brk, when there, set the steering lock and scale the engine and brakes).
// surf: the ground under the car, { vmax, drag, rough, grip }. tune: the page's car, { power, idle, vtop, brake } (brake: how much harder than stock the brakes bite, default 1).
// grip (default 1, dry) is the share of dry tyre grip left on wet or snowy ground: brakes and handbrake bite by that share,
// and the engine can't pull harder than 10 * grip m/s². Sideways the tyres hold the car's path to DRY * grip m/s²; the
// steering lock is kept just inside that, so held keys never slide on dry ground, but the handbrake (rear wheels locked:
// a third of the grip), hard braking and too much speed on wet or snowy ground do: the body then runs ahead of its path
// (at most 0.65 rad), scrubbing speed. Holding the throttle in a slide keeps it going; let go of the steering and the car
// counter-steers and catches it.
// collide(nx, nz, nh), if given, sees each move first: falsy lets it, 'stop' refuses it, anything else is a solid the car
// may glance off: it slides along with the speed along it, turning towards it. The result says { blocked } when the move
// was refused, and impact: the speed into the obstacle (m/s; the whole speed when blocked, a share of it when glancing).
export const DRY = 15;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function step(st, k, dt, surf, tune, collide) {
  const g = clamp(surf.grip ?? 1, 0.05, 1), slip = st.slip || 0, sliding = Math.abs(slip) > 0.15;
  let a = 0;
  if (k.up) a = (st.v < -0.2 ? 18 * g : Math.min(tune.power * Math.max(0, 1 - Math.max(0, st.v) / surf.vmax) + tune.idle, 10 * g)) * (k.thr ?? 1);
  if (k.dn) a = (st.v > 0.2 ? -17 * g * (tune.brake ?? 1) : -Math.min(5, 10 * g)) * (k.brk ?? 1);
  a -= 0.0011 * st.v * Math.abs(st.v) + surf.drag * st.v + Math.sign(st.v) * 0.3;
  if (surf.height) {
    const grade = roadGrade(surf.height, st.pos.x, st.pos.z, st.h + slip);
    a -= 9.81 * grade / Math.hypot(1, grade);
  }
  if (k.hb) a -= Math.sign(st.v) * 9 * g;
  const v = Math.abs(st.v), hold = DRY * g * (k.hb && v > 4 ? 0.3 : 1) * (1 - 0.25 * clamp(-a * Math.sign(st.v || 1) / 17, 0, 1)) * (sliding && k.up ? 0.75 : 1);
  if (slip) a -= Math.sign(st.v) * Math.min(hold, 12) * Math.abs(Math.sin(slip)) * (k.up ? 0.5 : 1); // sliding sideways scrubs speed
  st.v += a * dt;
  if (!k.up && !k.dn && Math.abs(st.v) < 0.4) st.v = 0;
  st.v = clamp(st.v, -9, tune.vtop);
  const lock = Math.min(0.62 / (1 + v / 14), sliding ? 1 : Math.atan(0.85 * DRY * 2.63 / Math.max(1, v * v))); // just inside the grip
  let target = k.steer ?? (k.lf ? 1 : 0) - (k.rt ? 1 : 0);
  if (!target && k.steer === undefined && sliding) target = clamp(1.6 * slip / lock, -1, 1) * Math.sign(st.v || 1); // counter-steer
  const sp = clamp((v - 8) / 32, 0, 1) ** 2 * (3 - 2 * clamp((v - 8) / 32, 0, 1));
  st.steer += (target * lock - st.steer) * Math.min(1, dt * (target ? 7 - 3 * sp : 10));
  const yaw = st.v * Math.tan(st.steer) / 2.63 * (k.hb && v > 4 ? 1.5 : 1);
  // the path follows the body only as fast as the tyres hold it
  const most = hold / Math.max(0.5, v) * dt;
  const path = st.h + slip + clamp(yaw * dt - slip, -most, most), nh = path + clamp(st.h + yaw * dt - path, -0.65, 0.65), turn = (path - st.h - slip) / dt;
  const res = { braking: (k.dn && st.v > 0.2) || k.hb, reversing: st.v < -0.2, blocked: false, impact: 0 };
  const move = (p, h, speed) => { const x = st.pos.x + Math.cos(p) * speed * dt, z = st.pos.z - Math.sin(p) * speed * dt; return [x, z, h]; };
  const [nx, nz] = move(path, nh, st.v), hit = collide?.(nx, nz, nh);
  if (!hit) { st.h = nh; st.pos.x = nx; st.pos.z = nz; st.slip = path - nh; }
  else {
    let glanced = false;
    if (hit !== 'stop' && v > 1) for (const d of [0.15, 0.3, 0.5]) { // glance: slide along it, losing the speed into it
      for (const sg of [1, -1]) {
        const p = path + sg * d, h = st.h + sg * d * 0.5, speed = st.v * Math.cos(d), [x, z] = move(p, h, speed);
        if (!collide(x, z, h)) { st.h = h; st.pos.x = x; st.pos.z = z; st.slip = 0; st.v = speed - Math.sign(speed) * Math.min(Math.abs(speed), 6 * dt); res.impact = v * Math.sin(d); glanced = true; break; }
      }
      if (glanced) break;
    }
    if (!glanced) { res.blocked = true; res.impact = v; }
  }
  // the body on springs: it leans into turns and pitches under braking and acceleration, overshoots a little and settles
  const rollTo = clamp(st.v * turn * 0.0045, -0.06, 0.06), pitchTo = clamp(a * 0.0018, -0.045, 0.03);
  st.rw = (st.rw || 0) + (49 * (rollTo - st.roll) - 6.3 * (st.rw || 0)) * dt; st.roll = clamp(st.roll + st.rw * dt, -0.08, 0.08);
  st.pw = (st.pw || 0) + (81 * (pitchTo - st.pitch) - 7.2 * (st.pw || 0)) * dt; st.pitch = clamp(st.pitch + st.pw * dt, -0.06, 0.045);
  if (surf.rough && v > 3) st.pw += (Math.random() - 0.5) * 0.25;
  st.spin += st.v * dt / 0.308;
  return res;
}

// Paint a buildCar()-shaped car (its `paint` material) in colour `hex`, or back in its own colours with null.
export function repaint(C, hex) {
  const m = C.paint; if (!m) return;
  C.factoryPaint ||= { color: m.color.clone(), map: m.map };
  if (hex) { m.color.set(hex); m.map = null; } else { m.color.copy(C.factoryPaint.color); m.map = C.factoryPaint.map; } // (the VAZ's own paint is a texture)
  m.needsUpdate = true;
}

// Pose the car, its wheels and steering wheel, and light the brake, tail and reverse lamps.
export function syncCar({ C, car, wheels, swFace }, st, s, head, height) {
  const ground = height && groundPose(height, st.pos.x, st.pos.z, st.h);
  car.position.set(st.pos.x, ground?.y ?? 0, st.pos.z);
  car.rotation.set(st.roll + (ground?.roll ?? 0), st.h, st.pitch + (ground?.pitch ?? 0));
  for (const w of wheels) w.w.rotation.set(0, w.base + (w.front ? st.steer : 0), w.side > 0 ? -st.spin : st.spin);
  if (swFace) swFace.rotation.z = st.steer * 4;
  C.tailMat.emissiveIntensity = s.braking ? 7 : head ? 1.8 : 0; C.cbrakeMat.emissiveIntensity = s.braking ? 7 : 0;
  C.revMat.emissiveIntensity = s.reversing ? 5 : 0;
}

// Chase camera (mode 0) that rides behind the car, or the driver's view (mode 1). The chase camera sits in the car's
// frame at a yaw that eases towards the way the car travels (most of a slide's angle shows); only the yaw lags, so its
// distance holds at any speed. Faster, it sits a little closer and lower, looks further ahead and widens its view.
// occluded(x, z, y), if given, says whether a point of the sightline is inside something: the camera pulls in fast in
// front of the nearest one (never staying behind it) and eases back out slowly.
export function chaseCamera(camera, car, height = () => 0) {
  const look = camera.position.clone(), REST = 7.8; let yaw = 0, dist = REST;
  return {
    reset(st) { yaw = st.h; dist = REST; },
    // before the drive starts: a slow orbit round the car (once in 40 s), swinging between 7 and 11 m out and 1.6 and 4.5 m up
    orbit(st, t) {
      const a = st.h + Math.PI + t * 2 * Math.PI / 40, r = 9 + 2 * Math.sin(t * 0.37), y = 3.05 + 1.45 * Math.sin(t * 0.23);
      const x = st.pos.x + Math.cos(a) * r, z = st.pos.z - Math.sin(a) * r; // (above the ground, on hills too)
      camera.position.set(x, y + Math.max(height(x, z), height(st.pos.x, st.pos.z)), z); camera.lookAt(st.pos.x, height(st.pos.x, st.pos.z) + 0.9, st.pos.z);
      camera.fov = 50; camera.near = 0.1; camera.updateProjectionMatrix(); yaw = st.h; dist = REST;
    },
    update(st, mode, dt, occluded) {
      if (mode === 0) {
        const t = Math.min(1, Math.max(0, (st.v - 8) / 37)), sp = t * t * (3 - 2 * t); // 0 up to 8 m/s, 1 from 45 m/s
        const want = REST - sp, high = 2.9 - 0.45 * sp, ahead = 5 + 4 * sp;
        let turn = st.h + 0.75 * (st.slip || 0) - yaw; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
        yaw += turn * (1 - Math.exp(-5 * dt));
        const fx = Math.cos(yaw), fz = -Math.sin(yaw);
        let free = Infinity; // along the boom, from 2 m out, with the sightline sloping from the roof up to the camera
        if (occluded) for (let b = 2; ; b = Math.min(want, b + 0.5)) { if (occluded(st.pos.x - fx * b, st.pos.z - fz * b, 1.3 + (high - 1.3) * b / want)) { free = b; break; } if (b >= want) break; }
        const target = free < Infinity ? Math.max(2.5, free - 0.8) : want;
        dist += (target - dist) * (1 - Math.exp(-(target < dist ? 25 : 2.5) * dt));
        if (free < Infinity) dist = Math.min(dist, Math.max(2.5, free - 0.6)); // (the boom is sampled every 0.5 m)
        camera.position.set(st.pos.x - fx * dist, Math.min(high, 2.2 + 0.12 * dist), st.pos.z - fz * dist);
        camera.position.y += height(camera.position.x, camera.position.z);
        camera.lookAt(st.pos.x + fx * ahead, height(st.pos.x + fx * ahead, st.pos.z + fz * ahead) + 1, st.pos.z + fz * ahead);
        camera.fov = 58 + 14 * sp; camera.near = 0.1;
      } else {
        yaw = st.h; dist = REST; // back to the chase view from behind the car
        car.updateMatrixWorld(true);
        camera.position.copy(car.localToWorld(look.set(-0.18, 1.2, -0.37)));
        camera.lookAt(car.localToWorld(look.set(20, 0.75, -0.37)));
        camera.fov = 68; camera.near = 0.02;
      }
      camera.updateProjectionMatrix();
    }
  };
}

export function speedHud(kmh, gear, st, s) {
  kmh.textContent = Math.round(Math.abs(st.v) * 3.6);
  gear.textContent = s.reversing && st.v < 0 ? 'R' : st.v === 0 ? 'N' : 'D';
}
