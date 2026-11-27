// The driven car drawn in a few dozen draw calls instead of hundreds: the parts that never move on their own are baked
// into one mesh per material (and per shadow setting), in the car's own space, so the car still moves, rolls and
// repaints as one. Parts that turn (the wheels, the steering wheel) or that other code looks up by name (`keep`) stay
// as they are, and materials are shared, so lamps that light up through their material still do.
// Call it on a car rigged for driving (rigCar), after anything that looks parts up by name.
import * as THREE from 'three';

const MOVING = /^(wheel_|steering_wheel)/;
export function mergeStatic(car, keep = ['tail_brake']) {
  car.updateMatrixWorld(true);
  const inv = car.matrixWorld.clone().invert(), groups = new Map(), M = new THREE.Matrix4();
  const moving = o => { for (let p = o; p && p !== car; p = p.parent) if (MOVING.test(p.name)) return true; return false; };
  car.traverseVisible(o => { // (transparent parts keep their own sorting, so the glass stays separate)
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.material.transparent || Object.keys(o.geometry.morphAttributes).length || moving(o) || keep.includes(o.name)) return;
    const attrs = Object.entries(o.geometry.attributes).map(([k, a]) => k + a.itemSize + a.array.constructor.name + a.normalized).sort().join(), key = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, attrs].join('|');
    let g = groups.get(key); if (!g) groups.set(key, g = []); g.push(o);
  });
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map(o => { const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()); g.applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld)); return g; });
    const merged = new THREE.BufferGeometry();
    for (const name of Object.keys(geos[0].attributes)) {
      const a = geos[0].attributes[name], out = new a.array.constructor(geos.reduce((n, g) => n + g.attributes[name].count, 0) * a.itemSize); let at = 0;
      for (const g of geos) { const b = g.attributes[name]; for (let i = 0; i < b.count; i++) for (let k = 0; k < a.itemSize; k++) out[at++] = b.getComponent(i, k); }
      merged.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
    }
    const first = list[0], m = new THREE.Mesh(merged, first.material);
    Object.assign(m, { name: 'merged_' + (first.material.name || 'part'), castShadow: first.castShadow, receiveShadow: first.receiveShadow, renderOrder: first.renderOrder });
    car.add(m);
    for (const o of list) o.parent.remove(o); // (their geometries may be shared with parts that stay)
    removed += list.length - 1;
    geos.forEach(g => g.dispose());
  }
  return removed; // meshes saved
}
