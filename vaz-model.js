import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// VAZ-2101 from models/vaz-2101.glb, returned in the same shape as buildCar() so the drive code can use either car:
// +X forward, +Z right, axles centred on the origin, wheels as groups named wheel_front_R … that spin about their Z.
export async function loadVaz(url = './models/vaz-2101.glb') {
  const m = (await new GLTFLoader().loadAsync(url)).scene;
  const car = new THREE.Group(); car.name = 'vaz2101';
  m.rotation.y = Math.PI / 2; car.add(m); car.updateMatrixWorld(true); // the file's front is +Z

  // the file has all four wheels in one mesh (plus caps and nuts): cut them apart by quadrant
  const parts = []; for (const n of ['Wheel001', 'Wheel_cap', 'Wheel_screw']) m.getObjectByName(n).traverse(o => o.isMesh && parts.push(o));
  const mid = new THREE.Box3(); parts.forEach(o => mid.expandByObject(o)); const c0 = mid.getCenter(new THREE.Vector3());
  const quads = {}, v = new THREE.Vector3();
  for (const o of parts) {
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld), p = g.attributes.position, idx = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i), sub = {};
    for (let i = 0; i < idx.length; i += 3) {
      const cx = p.getX(idx[i]) + p.getX(idx[i + 1]) + p.getX(idx[i + 2]), cz = p.getZ(idx[i]) + p.getZ(idx[i + 1]) + p.getZ(idx[i + 2]);
      const k = (cx > 3 * c0.x ? 'front_' : 'rear_') + (cz > 3 * c0.z ? 'R' : 'L');
      (sub[k] ||= []).push(idx[i], idx[i + 1], idx[i + 2]);
    }
    for (const k in sub) { const q = quads[k] ||= { box: new THREE.Box3(), pieces: [] }; for (const i of sub[k]) q.box.expandByPoint(v.fromBufferAttribute(p, i)); q.pieces.push([g.clone().setIndex(sub[k]), o.material]); }
    o.removeFromParent();
  }
  const hub = {}; for (const k in quads) hub[k] = quads[k].box.getCenter(new THREE.Vector3());
  const shift = -(hub.front_R.x + hub.rear_R.x) / 2; m.position.x = shift;
  for (const k in quads) { // left wheels are turned half round like the sedan's, so the game's spin signs work unchanged
    const c = hub[k], L = k.endsWith('L'), w = new THREE.Group(); w.name = 'wheel_' + k; w.position.set(c.x + shift, c.y, c.z); if (L) w.rotation.y = Math.PI; car.add(w);
    for (const [g, mat] of quads[k].pieces) { g.translate(-c.x, -c.y, -c.z); if (L) g.rotateY(Math.PI); w.add(new THREE.Mesh(g, mat)); }
  }

  // lamps: front and rear clusters share one material in the file; give each its own so they light separately
  const glow = (node, color) => { let mat; m.getObjectByName(node).traverse(o => { if (o.material?.name === 'Light') o.material = mat ||= Object.assign(o.material.clone(), { emissive: new THREE.Color(color), emissiveMap: o.material.map, emissiveIntensity: 0 }); }); return mat; };
  const headMat = glow('Light', 0xfff1d6), tailMat = glow('Light001', 0xff3020);
  let glass; m.traverse(o => { if (o.material?.name === 'Windows glass') glass = o.material; });
  Object.assign(glass, { transmission: 0, transparent: true, opacity: 0.45 }); // transmission re-renders the whole city every frame

  const lights = { low: [], high: [], fog: [] };
  const spot = (pos, tgt, angle, pen) => { const l = new THREE.SpotLight(0xfff2dc, 0, 0, angle, pen, 2); l.position.copy(pos); l.target.position.copy(tgt); car.add(l, l.target); return l; };
  for (const s of [1, -1]) { // headlamp centres measured on the model
    lights.low.push(spot(new THREE.Vector3(1.86, 0.64, s * 0.6), new THREE.Vector3(9, 0, s * 0.9), 0.5, 0.75));
    lights.high.push(spot(new THREE.Vector3(1.86, 0.66, s * 0.6), new THREE.Vector3(20, 0.4, s * 0.5), 0.3, 0.6));
  }
  // no centre brake light or separate reverse lens on this car: the game's writes to those land in plain objects
  return { car, headMat, tailMat, cbrakeMat: {}, revMat: {}, lights, extraLights: [], IN: new THREE.Group(), glass, lensClear: null };
}
