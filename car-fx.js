// What the driven car leaves behind, on both drive pages: tyre smoke and black skid marks when the tyres squeal on hard
// ground, spray on wet roads, dirt or snow puffs off the road, and sparks from crashes and from scraping along a wall.
// The tyres complain by the same rule the player hears (driving-audio.js tyreSound), so sound and sight agree.
// carFx(scene, { particles, marks }) → { frame(dt, st, wheels, ride, braking, scraping), spark(st, impact) }:
// particles: the most at once (each kind has its own pool), marks: skid-mark quads kept (a ring: the oldest fade out).
import * as THREE from 'three';
import { tyreSound } from './driving-audio.js';

const soft = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.5, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); return t; })();

// A pool of n points (size in metres, colour with alpha that fades over each one's life), moved on the CPU.
function pool(scene, n, blending) {
  const P = new Float32Array(n * 3), C = new Float32Array(n * 4), S = new Float32Array(n), vel = new Float32Array(n * 3), life = new Float32Array(n), age = new Float32Array(n).fill(1), grow = new Float32Array(n), base = new Float32Array(n * 4), fall = new Float32Array(n);
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)).setAttribute('color', new THREE.BufferAttribute(C, 4).setUsage(THREE.DynamicDrawUsage)).setAttribute('aSize', new THREE.BufferAttribute(S, 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.PointsMaterial({ size: 1, map: soft, vertexColors: true, transparent: true, depthWrite: false, blending, sizeAttenuation: true });
  m.onBeforeCompile = sh => { sh.vertexShader = 'attribute float aSize;\n' + sh.vertexShader.replace('gl_PointSize = size;', 'gl_PointSize = min(size * aSize, 150.0);'); }; // a size per point
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
  let next = 0, live = 0;
  return {
    emit(x, y, z, vx, vy, vz, t, s0, s1, [r, gr, b, a], gravity = 0) {
      const i = next; next = (next + 1) % n; live = Math.min(n, live + 1);
      P.set([x, y, z], i * 3); vel.set([vx, vy, vz], i * 3); life[i] = t; age[i] = 0; S[i] = s0; grow[i] = (s1 - s0) / t; base.set([r, gr, b, a], i * 4); fall[i] = gravity;
    },
    update(dt) {
      if (!live) return;
      for (let i = 0; i < n; i++) {
        if (age[i] >= 1) { C[i * 4 + 3] = 0; continue; }
        age[i] = Math.min(1, age[i] + dt / life[i]); vel[i * 3 + 1] -= fall[i] * dt;
        for (let k = 0; k < 3; k++) P[i * 3 + k] += vel[i * 3 + k] * dt;
        if (P[i * 3 + 1] < 0.05) { P[i * 3 + 1] = 0.05; vel[i * 3 + 1] *= -0.3; }
        S[i] += grow[i] * dt; const f = (1 - age[i]) ** 2;
        C.set([base[i * 4], base[i * 4 + 1], base[i * 4 + 2], base[i * 4 + 3] * f], i * 4);
      }
      for (const a of ['position', 'color', 'aSize']) g.attributes[a].needsUpdate = true;
    }
  };
}

// Skid marks: a ring of dark quads lying on the road, one strip per wheel, the oldest fading out.
function skids(scene, n) {
  const P = new Float32Array(n * 18), C = new Float32Array(n * 24), keep = new Float32Array(n * 4);
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage)).setAttribute('color', new THREE.BufferAttribute(C, 4).setUsage(THREE.DynamicDrawUsage));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  mesh.name = 'skid_marks'; mesh.frustumCulled = false; mesh.renderOrder = 2; scene.add(mesh);
  let next = 0;
  return function add(ax, az, bx, bz, [r, gr, b, a]) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, ox = -dz / L * 0.095, oz = dx / L * 0.095, y = 0.03, i = next; next = (next + 1) % n;
    P.set([ax - ox, y, az - oz, ax + ox, y, az + oz, bx + ox, y, bz + oz, ax - ox, y, az - oz, bx + ox, y, bz + oz, bx - ox, y, bz - oz], i * 18);
    keep.set([r, gr, b, a], i * 4);
    for (let q = 0; q < n; q++) { // the oldest 15% fade away before they are written over
      const rank = (q - next + n) % n / n, f = Math.min(1, rank / 0.15), k = keep.subarray(q * 4, q * 4 + 4);
      for (let v = 0; v < 6; v++) C.set([k[0], k[1], k[2], k[3] * f], (q * 6 + v) * 4);
    }
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  };
}

export function carFx(scene, { particles = 480, marks = 900 } = {}) {
  const smoke = pool(scene, particles, THREE.NormalBlending), sparks = pool(scene, Math.ceil(particles / 3), THREE.AdditiveBlending), mark = skids(scene, marks);
  const last = new Map(), wp = new THREE.Vector3(), owed = new Map();
  const due = (key, rate, dt) => { const n = (owed.get(key) || 0) + rate * dt, whole = Math.floor(n); owed.set(key, n - whole); return whole; }; // emit `rate` a second, steadily
  const R = () => Math.random() - 0.5;
  return {
    // each frame: st the car's state, wheels rig.wheels, ride as for tyreSound, braking, scraping (sliding along a wall)
    frame(dt, st, wheels, ride, braking, scraping) {
      const v = Math.abs(st.v), tyre = tyreSound(st.v, braking, ride), fx = Math.cos(st.h), fz = -Math.sin(st.h);
      const marking = (tyre.squeal > 0.35 || Math.abs(st.slip || 0) > 0.12) && v > 2, hardBrake = braking && !ride.hb && v > 8;
      const tint = ride.snow > 0.5 ? [0.55, 0.57, 0.6, 0.45] : ride.rough ? [0.25, 0.18, 0.1, 0.4] : [0.03, 0.03, 0.03, 0.42];
      for (const w of wheels) {
        w.w.getWorldPosition(wp); const key = w.w.uuid, prev = last.get(key);
        if (marking && (!w.front || hardBrake)) { // a mark every 0.3 m the wheel slides
          if (!prev) last.set(key, [wp.x, wp.z]);
          else if (Math.hypot(wp.x - prev[0], wp.z - prev[1]) > 0.3) { mark(prev[0], prev[1], wp.x, wp.z, tint); last.set(key, [wp.x, wp.z]); }
        } else last.delete(key);
        if (w.front) continue;
        const cx = fx * st.v, cz = fz * st.v; // the car's velocity: smoke keeps a little of it, spray and dirt more
        for (let i = due(key + 's', 45 * tyre.squeal * (1 - (ride.wet || 0)), dt); i-- > 0;) smoke.emit(wp.x + R() * 0.3, 0.25, wp.z + R() * 0.3, 0.3 * cx + R(), 0.5 + Math.random() * 0.4, 0.3 * cz + R(), 1.6, 0.6, 3.2, [0.78, 0.78, 0.78, 0.28]);
        for (let i = due(key + 'w', (ride.wet || 0) >= 0.3 && v > 6 ? 40 * ride.wet * Math.min(1, v / 20) : 0, dt); i-- > 0;) smoke.emit(wp.x, 0.15, wp.z, 0.5 * cx + R() * 1.5, 0.8 + Math.random() * 1.2, 0.5 * cz + R() * 1.5, 0.45, 0.25, 1.0, [0.78, 0.82, 0.86, 0.35], 6);
        for (let i = due(key + 'd', tyre.rumble > 0.3 && v > 4 ? 18 * tyre.rumble : 0, dt); i-- > 0;) smoke.emit(wp.x, 0.2, wp.z, 0.5 * cx + R(), 0.6 + Math.random() * 0.6, 0.5 * cz + R(), 0.9, 0.4, 1.6, ride.snow > 0.5 ? [0.95, 0.96, 0.98, 0.45] : [0.45, 0.37, 0.27, 0.35], 2);
      }
      if (scraping) for (let i = due('scrape', 30, dt); i-- > 0;) this.spark(st, 0, 1);
      smoke.update(dt); sparks.update(dt);
    },
    // a burst of sparks at the front corners for a crash at `impact` m/s (or n of them while scraping)
    spark(st, impact, n = impact > 4 ? Math.round(12 + impact) : 0) {
      const fx = Math.cos(st.h), fz = -Math.sin(st.h);
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? 1 : -1, x = st.pos.x + fx * 2.1 + fz * side * 0.8, z = st.pos.z + fz * 2.1 - fx * side * 0.8, s = 3 + Math.random() * 5;
        sparks.emit(x, 0.4 + Math.random() * 0.4, z, R() * s - fx * s * 0.5, Math.random() * s * 0.6, R() * s - fz * s * 0.5, 0.3 + Math.random() * 0.2, 0.12, 0.05, [1, 0.7, 0.28, 1], 9.8);
      }
    }
  };
}
