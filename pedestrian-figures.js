// The pedestrians (pedestrians.js) on screen: a simple figure drawn once per person (instanced), part by part: body,
// head, hair, two arms and two legs, in their own clothes, skin and hair colours, legs and arms swinging as they walk,
// and a soft contact shadow at their feet.
import * as THREE from 'three';
import { blobTex } from './world-kit.js';

const pal = list => list.map(c => new THREE.Color(c));
const SKIN = pal(['#f1d1b5', '#e8bd98', '#d9a77f', '#c68a62', '#a86f4c', '#8a5638', '#6b3f28', '#4e2d1d']);
const HAIR = pal(['#1b1612', '#2a1d14', '#3d2a1c', '#5a3d25', '#8a6a42', '#c9a96b', '#9a9690', '#d9d5cf', '#6b2e1a']);
const SHIRT = pal(['#e8e6e1', '#2b2d31', '#1f3a66', '#7c1d1d', '#3f5e44', '#c9a227', '#8a8f94', '#5b3b6e', '#d76a2a', '#26667a', '#b8b2a5', '#141518', '#a33b52', '#6f8fb0']);
const PANTS = pal(['#2c3e5c', '#1e2c44', '#151618', '#3b3d40', '#6b6458', '#8b7d62', '#4a3b2e', '#22262b', '#5b6670']);
const HIP = 0.9, SHOULDER = 1.47, CYCLE = 0.5; // m above the ground; leg swing (rad) at a walk

// Figure parts in person space: +x forward, y up, about 1.72 m tall. Legs and arms hang from a pivot at the origin.
function parts() {
  const leg = new THREE.CapsuleGeometry(0.07, 0.76, 3, 8).translate(0, -0.45, 0), foot = new THREE.BoxGeometry(0.24, 0.08, 0.1).translate(0.05, -0.86, 0);
  return {
    body: new THREE.CapsuleGeometry(0.17, 0.36, 4, 10).scale(0.78, 1, 1.22).translate(0, 1.2, 0),
    head: new THREE.SphereGeometry(0.105, 12, 9).translate(0.01, 1.62, 0),
    hair: new THREE.SphereGeometry(0.113, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(-0.005, 1.635, 0),
    arm: new THREE.CapsuleGeometry(0.045, 0.5, 3, 6).translate(0, -0.3, 0),
    leg: merge([leg, foot])
  };
}
function merge(geos) { // positions and normals of several geometries as one
  const pos = [], nor = [];
  for (let g of geos) { if (g.index) g = g.toNonIndexed(); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
}

// scene: where to draw; max: the most people shown. → { sync(people) }: poses them (pedestrians.js people).
export function pedestrianFigures(scene, max) {
  const G = parts(), group = new THREE.Group(), meshes = {};
  group.name = 'pedestrians'; scene.add(group);
  const mk = (name, geo, n, roughness) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness }), n); m.name = 'pedestrian_' + name;
    m.count = 0; m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    group.add(m); return (meshes[name] = m);
  };
  const blob = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex(0.25, 0.55), transparent: true, depthWrite: false }), max);
  blob.name = 'pedestrian_shadow'; blob.count = 0; blob.renderOrder = 2; blob.frustumCulled = false; group.add(blob);
  mk('body', G.body, max, 0.9); mk('head', G.head, max, 0.7); mk('hair', G.hair, max, 0.95); mk('arm', G.arm, max * 2, 0.9); mk('leg', G.leg, max * 2, 0.85);
  const M = new THREE.Matrix4(), L = new THREE.Matrix4(), R = new THREE.Matrix4(), Q = new THREE.Quaternion(), T = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const limb = (mesh, i, y, z, swing) => { L.makeTranslation(0, y, z).multiply(R.makeRotationZ(swing)); mesh.setMatrixAt(i, L.premultiply(M)); };

  function sync(people) {
    const n = Math.min(people.length, max);
    for (let i = 0; i < n; i++) {
      const p = people[i], k = p.look, stride = Math.min(1, p.v / 1.3) * CYCLE, sw = Math.sin(p.phase) * stride, lean = p.state === 'stagger' ? 0.18 : 0; // knocked: leaning back, arms out
      Q.setFromAxisAngle(Y, p.h).multiply(T.setFromAxisAngle(Z, lean));
      M.compose(P.set(p.x, Math.abs(Math.cos(p.phase)) * stride * 0.06, p.z), Q, S.setScalar(k.scale));
      for (const part of ['body', 'head', 'hair']) meshes[part].setMatrixAt(i, M);
      blob.setMatrixAt(i, L.makeTranslation(p.x, 0.065, p.z));
      limb(meshes.leg, 2 * i, HIP, 0.095, sw); limb(meshes.leg, 2 * i + 1, HIP, -0.095, -sw);
      limb(meshes.arm, 2 * i, SHOULDER, 0.235, -sw * 0.8 + (lean ? 0.6 : 0)); limb(meshes.arm, 2 * i + 1, SHOULDER, -0.235, sw * 0.8 + (lean ? 0.6 : 0));
      const shirt = SHIRT[k.shirt % SHIRT.length], pants = PANTS[k.pants % PANTS.length];
      meshes.body.setColorAt(i, shirt); meshes.head.setColorAt(i, SKIN[k.skin % SKIN.length]); meshes.hair.setColorAt(i, HAIR[k.hair % HAIR.length]);
      for (const j of [2 * i, 2 * i + 1]) { meshes.arm.setColorAt(j, shirt); meshes.leg.setColorAt(j, pants); }
    }
    for (const [name, m] of Object.entries(meshes)) { m.count = name === 'arm' || name === 'leg' ? 2 * n : n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    blob.count = n; blob.instanceMatrix.needsUpdate = true;
  }
  return { sync };
}
