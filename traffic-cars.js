// The traffic cars (traffic.js) on screen: one simple car body drawn once per car (instanced), in a range of paint
// colours, with head and tail lamps that light up at night and brake lights that come on as each car slows.
import * as THREE from 'three';

const PAINT = ['#e9e9e6', '#e9e9e6', '#d3d5d6', '#b9bdc0', '#8b9094', '#5c6165', '#2c2f32', '#151618', '#151618', '#7c1514', '#a92b1f', '#1f3a66', '#2e5079', '#3f5e44', '#c9bb9c', '#6f5b49', '#d8c64a', '#e2e0d8'].map(c => new THREE.Color(c));
const HEAD_ON = new THREE.Color(4, 3.8, 3.3), HEAD_OFF = new THREE.Color('#c9ccce'), TAIL = new THREE.Color(1.6, 0.08, 0.05), TAIL_OFF = new THREE.Color('#5a1010'), BRAKE = new THREE.Color(5, 0.25, 0.15);
const HEADS = [[2.2, 0.7, 0.55], [2.2, 0.7, -0.55]], TAILS = [[-2.2, 0.8, 0.58], [-2.2, 0.8, -0.58]];

const shape = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); return s; };
const slab = (pts, width, bevel) => new THREE.ExtrudeGeometry(shape(pts), { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 }).translate(0, 0, bevel - width / 2);
function merge(geos) { // positions and normals of several geometries as one
  const pos = [], nor = [];
  for (let g of geos) { if (g.index) g = g.toNonIndexed(); const p = g.attributes.position.array, n = g.attributes.normal.array; for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); } }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
}
const at = (g, x, y, z) => g.translate(x, y, z);

// Car parts in car space: +x forward, y up, 4.4 × 1.7 m, wheels on the axles of the player's sedan.
function parts() {
  const body = merge([
    slab([[-2.14, 0.3], [-2.18, 0.62], [-2.06, 0.9], [-1.34, 0.96], [1.12, 0.96], [1.92, 0.8], [2.14, 0.58], [2.1, 0.3]], 1.7, 0.06),
    slab([[-0.84, 1.38], [0.42, 1.4], [0.38, 1.46], [-0.78, 1.45]], 1.42, 0.03) // roof
  ]);
  const glass = slab([[-1.32, 0.95], [-0.82, 1.4], [0.42, 1.42], [1.14, 0.95]], 1.48, 0);
  const trim = merge([
    at(new THREE.BoxGeometry(0.18, 0.18, 1.72), 2.11, 0.38, 0), at(new THREE.BoxGeometry(0.18, 0.18, 1.72), -2.11, 0.4, 0),
    ...[1.32, -1.31].flatMap(x => [0.77, -0.77].map(z => at(new THREE.CylinderGeometry(0.31, 0.31, 0.2, 14).rotateX(Math.PI / 2), x, 0.31, z)))
  ]);
  const lamp = (w, h, d, spots) => merge(spots.map(([x, y, z]) => at(new THREE.BoxGeometry(w, h, d), x * 0.97, y, z)));
  return { body, glass, trim, head: lamp(0.06, 0.12, 0.34, HEADS), tail: lamp(0.06, 0.15, 0.32, TAILS) };
}

export function trafficCars(scene, max, glowTex) {
  const G = parts(), meshes = [];
  const mk = (geo, mat, shadow, colored) => {
    const m = new THREE.InstancedMesh(geo, mat, max); m.count = 0; m.castShadow = m.receiveShadow = shadow; m.frustumCulled = false; // lamps neither cast nor take shadows
    if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(m); meshes.push(m); return m;
  };
  const body = mk(G.body, new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.35 }), true, true);
  mk(G.glass, new THREE.MeshStandardMaterial({ color: '#1b252d', roughness: 0.12, metalness: 0.6 }), true, false);
  mk(G.trim, new THREE.MeshStandardMaterial({ color: '#17181a', roughness: 0.85 }), true, false);
  const head = mk(G.head, new THREE.MeshBasicMaterial(), false, true), tail = mk(G.tail, new THREE.MeshBasicMaterial(), false, true);
  // night glows round the lamps: one point per lamp, brightness in its vertex colour
  const glows = [0xfff1dc, 0xff2a1a].map((color, i) => {
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3)).setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex, color, size: i ? 0.9 : 1.5, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    p.frustumCulled = false; scene.add(p); return p;
  });
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);

  // cars: traffic.js cars; lit: whether their lamps are on (dusk, night, murky weather)
  function sync(cars, lit) {
    const n = Math.min(cars.length, max), [hp, hc] = ['position', 'color'].map(a => glows[0].geometry.attributes[a]), [tp, tc] = ['position', 'color'].map(a => glows[1].geometry.attributes[a]);
    for (let i = 0; i < n; i++) {
      const c = cars[i], cs = Math.cos(c.h), sn = Math.sin(c.h);
      Q.setFromAxisAngle(Y, c.h); M.compose(P.set(c.x, 0, c.z), Q, ONE);
      for (const m of meshes) m.setMatrixAt(i, M);
      body.setColorAt(i, PAINT[c.paint % PAINT.length]);
      head.setColorAt(i, lit ? HEAD_ON : HEAD_OFF);
      tail.setColorAt(i, c.braking ? BRAKE : lit ? TAIL : TAIL_OFF);
      const tailGlow = c.braking ? (lit ? 1 : 0.35) : lit ? 0.45 : 0;
      for (let k = 0; k < 2; k++) {
        const [hx, hy, hz] = HEADS[k], [tx, ty, tz] = TAILS[k], j = i * 2 + k;
        hp.setXYZ(j, c.x + hx * cs + hz * sn, hy, c.z - hx * sn + hz * cs); hc.setXYZ(j, lit ? 0.8 : 0, lit ? 0.8 : 0, lit ? 0.8 : 0);
        tp.setXYZ(j, c.x + tx * cs + tz * sn, ty, c.z - tx * sn + tz * cs); tc.setXYZ(j, tailGlow, tailGlow, tailGlow);
      }
    }
    for (const m of meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const p of glows) { p.geometry.setDrawRange(0, n * 2); p.geometry.attributes.position.needsUpdate = p.geometry.attributes.color.needsUpdate = true; }
  }
  return { sync };
}
