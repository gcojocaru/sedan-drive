// Traffic lights on screen (traffic.js decides where they are and what they show): a pole and a signal head at the
// kerb of every road into a controlled junction, facing the cars coming in. The lamp that's on is bright, and glows
// at night. Lower on each pole, a pedestrian signal facing across the road and along the kerb: red, or green in the
// walk phase (flashing in its last seconds).
import * as THREE from 'three';

const LAMPS = [['red', 3.3, '#ff2a12', '#3c0c08'], ['amber', 3.02, '#ffab1a', '#3a2808'], ['green', 2.74, '#2dff7a', '#0a2c16']];
const ON = LAMPS.map(([, , c]) => new THREE.Color(c).multiplyScalar(4)), OFF = LAMPS.map(([, , , c]) => new THREE.Color(c)), GLOW = LAMPS.map(([, , c]) => new THREE.Color(c));
const WALKERS = [['stop', 2.27, '#ff3a20', '#3a0c08'], ['walk', 2.03, '#3dff9a', '#0b2a18']].map(([name, y, on, off]) => ({ name, y, on: new THREE.Color(on).multiplyScalar(3), off: new THREE.Color(off) }));
const walking = s => s.walk > 5 || (s.walk > 0 && Math.floor(s.walk * 2.5) % 2 === 0); // (green flashes in the last 5 s)

function mergeTwo([a, b]) { // two non-indexed copies of a lamp disc as one geometry
  const [p, q] = [a, b].map(g => g.index ? g.toNonIndexed() : g), cat = k => new THREE.Float32BufferAttribute([...p.attributes[k].array, ...q.attributes[k].array], 3);
  return new THREE.BufferGeometry().setAttribute('position', cat('position')).setAttribute('normal', cat('normal'));
}

// signals: traffic.js graph.signals ([{ x, z, h, state, walk, cx, cz }]); sync(lit) shows each one's state (lit: dusk or night)
export function trafficLights(scene, signals, glowTex, height = () => 0) {
  const n = signals.length;
  if (!n) return { sync() { } };
  const metal = new THREE.MeshStandardMaterial({ color: '#2a2d2f', roughness: 0.55, metalness: 0.5 });
  const housing = new THREE.MeshStandardMaterial({ color: '#1c1e1f', roughness: 0.7 });
  const parts = [
    [new THREE.CylinderGeometry(0.06, 0.08, 3.6, 8).translate(0, 1.8, 0), metal, true],
    [new THREE.BoxGeometry(0.3, 0.92, 0.36).translate(0, 3.02, 0), housing, true],
    ...LAMPS.map(([, y]) => [new THREE.CircleGeometry(0.115, 16).rotateY(Math.PI / 2).translate(0.155, y, 0), new THREE.MeshBasicMaterial(), false])
  ].map(([g, m, shadow]) => { const im = new THREE.InstancedMesh(g, m, n); im.castShadow = im.receiveShadow = shadow; scene.add(im); return im; });
  const lamps = parts.slice(2);
  // the pedestrian signal: a small box with a lamp on each face, turned to face across the road (towards the stop line)
  const two = y => { const a = new THREE.CircleGeometry(0.075, 12).rotateY(Math.PI / 2).translate(0.106, y, 0), b = a.clone().rotateY(Math.PI); return [a, b]; };
  const walkers = [[new THREE.BoxGeometry(0.2, 0.5, 0.2).translate(0, 2.15, 0), housing, true], ...WALKERS.map(w => [two(w.y), new THREE.MeshBasicMaterial(), false])]
    .map(([g, m, shadow]) => { if (Array.isArray(g)) g = mergeTwo(g); const im = new THREE.InstancedMesh(g, m, n); im.castShadow = im.receiveShadow = shadow; scene.add(im); return im; });
  const walkLamps = walkers.slice(1);
  for (const im of lamps.concat(walkLamps)) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
  const heights = signals.map(s => height(s.x, s.z));
  signals.forEach((s, i) => {
    Q.setFromAxisAngle(Y, s.h); M.compose(new THREE.Vector3(s.x, heights[i], s.z), Q, ONE); for (const im of parts) im.setMatrixAt(i, M);
    Q.setFromAxisAngle(Y, Math.atan2(-(s.cz - s.z), s.cx - s.x)); M.compose(new THREE.Vector3(s.x, heights[i], s.z), Q, ONE); for (const im of walkers) im.setMatrixAt(i, M);
  });
  // one glow per head, in front of the lamp that's on
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const glow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)).setAttribute('color', new THREE.BufferAttribute(col, 3)),
    new THREE.PointsMaterial({ map: glowTex, size: 1.3, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.frustumCulled = false; scene.add(glow);
  let shown = '';
  return {
    sync(lit) {
      const key = signals.map(s => s.state[0] + (walking(s) ? 'w' : '')).join('') + lit; // redraw only when a light changes
      if (key === shown) return; shown = key;
      signals.forEach((s, i) => {
        const on = LAMPS.findIndex(([name]) => name === s.state), cs = Math.cos(s.h), sn = Math.sin(s.h);
        lamps.forEach((im, k) => im.setColorAt(i, k === on ? ON[k] : OFF[k]));
        const go = walking(s); walkLamps.forEach((im, k) => im.setColorAt(i, (k === 1) === go ? WALKERS[k].on : WALKERS[k].off));
        pos.set([s.x + 0.25 * cs, heights[i] + LAMPS[on][1], s.z - 0.25 * sn], i * 3);
        col.set(GLOW[on].toArray().map(v => v * (lit ? 0.9 : 0)), i * 3);
      });
      for (const im of lamps.concat(walkLamps)) im.instanceColor.needsUpdate = true;
      glow.geometry.attributes.position.needsUpdate = glow.geometry.attributes.color.needsUpdate = true;
    }
  };
}
