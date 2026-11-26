// Driving shared by both drive pages: controls, the physics step, posing the car, the chase camera and the speed HUD.
// It only works on the three.js objects it is given (no import), so the physics can be tested in Node.

// held keys (by KeyboardEvent.code) → controls
export const readKeys = k => ({ up: k.KeyW || k.ArrowUp, dn: k.KeyS || k.ArrowDown, lf: k.KeyA || k.ArrowLeft, rt: k.KeyD || k.ArrowRight, hb: k.Space });

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

// One physics step of st = { pos, h, v, steer, spin, roll, pitch } (m, rad, m/s; heading 0 = +x).
// k: controls from readKeys. surf: the ground under the car, { vmax, drag, rough }. tune: the page's car, { power, idle, vtop }.
// collide(nx, nz, nh), if given, sees the move first; returning true refuses it (the callback handles the hit itself).
export function step(st, k, dt, surf, tune, collide) {
  let a = 0;
  if (k.up) a = st.v < -0.2 ? 18 : tune.power * Math.max(0, 1 - Math.max(0, st.v) / surf.vmax) + tune.idle;
  if (k.dn) a = st.v > 0.2 ? -17 : -5;
  a -= 0.0011 * st.v * Math.abs(st.v) + surf.drag * st.v + Math.sign(st.v) * 0.3;
  if (k.hb) a -= Math.sign(st.v) * 9;
  st.v += a * dt;
  if (!k.up && !k.dn && Math.abs(st.v) < 0.4) st.v = 0;
  st.v = Math.max(-9, Math.min(tune.vtop, st.v)); st.a = a;
  const target = (k.lf ? 1 : 0) - (k.rt ? 1 : 0), ms = 0.62 / (1 + Math.abs(st.v) / 14);
  st.steer += (target * ms - st.steer) * Math.min(1, dt * (target ? 5 : 8));
  const yaw = st.v * Math.tan(st.steer) / 2.63 * (k.hb && Math.abs(st.v) > 4 ? 1.5 : 1);
  const nh = st.h + yaw * dt, nx = st.pos.x + Math.cos(nh) * st.v * dt, nz = st.pos.z - Math.sin(nh) * st.v * dt;
  if (!collide?.(nx, nz, nh)) { st.h = nh; st.pos.x = nx; st.pos.z = nz; }
  st.roll += (Math.max(-0.045, Math.min(0.045, st.v * yaw * 0.0045)) - st.roll) * Math.min(1, dt * 6);
  st.pitch += (Math.max(-0.03, Math.min(0.02, a * 0.0018)) - st.pitch) * Math.min(1, dt * 5);
  if (surf.rough && Math.abs(st.v) > 3) st.pitch += (Math.random() - 0.5) * 0.004;
  st.spin += st.v * dt / 0.308;
  return { braking: (k.dn && st.v > 0.2) || k.hb, reversing: st.v < -0.2 };
}

// Pose the car, its wheels and steering wheel, and light the brake, tail and reverse lamps.
export function syncCar({ C, car, wheels, swFace }, st, s, head) {
  car.position.set(st.pos.x, 0, st.pos.z); car.rotation.set(st.roll, st.h, st.pitch);
  for (const w of wheels) w.w.rotation.set(0, w.base + (w.front ? st.steer : 0), w.side > 0 ? -st.spin : st.spin);
  if (swFace) swFace.rotation.z = st.steer * 4;
  C.tailMat.emissiveIntensity = s.braking ? 7 : head ? 1.8 : 0; C.cbrakeMat.emissiveIntensity = s.braking ? 7 : 0;
  C.revMat.emissiveIntensity = s.reversing ? 5 : 0;
}

// Chase camera (mode 0) that eases in behind the car, or the driver's view (mode 1).
// occluded(x, z, y), if given, pulls the chase camera in front of whatever it would sit inside.
export function chaseCamera(camera, car) {
  const pos = camera.position.clone(), want = pos.clone(), look = pos.clone();
  return {
    reset(st) { pos.set(st.pos.x - Math.cos(st.h) * 9, 3.2, st.pos.z + Math.sin(st.h) * 9); },
    update(st, mode, dt, occluded) {
      const fx = Math.cos(st.h), fz = -Math.sin(st.h);
      if (mode === 0) {
        let back = 8.5 + Math.max(0, st.v) * 0.04, camY = 3.0;
        if (occluded) for (let s = 2; s < back; s += 0.6) if (occluded(st.pos.x - fx * s, st.pos.z - fz * s, camY)) { back = Math.max(2.5, s - 0.8); camY = 2.2 + back * 0.12; break; }
        want.set(st.pos.x - fx * back, camY, st.pos.z - fz * back);
        pos.lerp(want, 1 - Math.exp(-dt * 4.5)); camera.position.copy(pos);
        camera.lookAt(look.set(st.pos.x + fx * 4, 1.1, st.pos.z + fz * 4));
        camera.fov = 58 + Math.max(0, st.v) * 0.18; camera.near = 0.1;
      } else {
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
