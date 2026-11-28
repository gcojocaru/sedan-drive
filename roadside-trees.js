// Static roadside vegetation. Scale and position are supplied by the map builder.
// The far textures are orthographic views of the same two meshes used up close.
import * as THREE from 'three';
import { mergeGeometries } from './vendor/three-0.184.0/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from './geom.js';

const up = new THREE.Vector3(0, 1, 0);
const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const offset = (p, angle, reach, rise) => p.clone().add(vec(reach * Math.cos(angle), rise, reach * Math.sin(angle)));
const species = ['broadleaf', 'fir'];
const tileSize = 96;
const extent = { broadleaf: [10, 9.5], fir: [7, 9.5] };

export function treeGeometry(kind) {
  const fir = kind === 'fir',
    rand = seeded(fir ? 9043 : 609);
  const limbs = [],
    pos = [],
    normals = [],
    uv = [],
    colors = [],
    indices = [];
  function limb(a, b, r0, r1, sides = 5) {
    const axis = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(r1, r0, axis.length(), sides, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    limbs.push(g);
  }
  // A bowed spray of leaves: each side turns away from its rib and the
  // leaf normals follow the crown volume so neighbouring sprays shade together.
  function spray(root, angle, length, width, rise, roll, bow = 0.18) {
    const forward = vec(Math.cos(angle), 0, Math.sin(angle));
    const side = vec(-forward.z * Math.cos(roll), Math.sin(roll), forward.x * Math.cos(roll));
    const first = pos.length / 3;
    for (const t of [0, 0.5, 1])
      for (const across of [-1, 0, 1]) {
        const p = root
          .clone()
          .addScaledVector(forward, t * length)
          .addScaledVector(side, (across * width) / 2);
        p.y += rise * t + Math.sin(Math.PI * t) * bow - Math.abs(across) * 0.2;
        pos.push(p.x, p.y, p.z);
        uv.push((across + 1) / 2, t);
        const normal = vec(p.x * 0.43, 0.85 + (p.y - 4.4) * 0.18, p.z * 0.43).normalize();
        normals.push(normal.x, normal.y, normal.z);
        const shade = THREE.MathUtils.clamp(0.6 + 0.045 * p.y + 0.032 * Math.hypot(p.x, p.z), 0.66, 1);
        colors.push(shade, shade, shade);
      }
    for (const j of [0, 1, 3, 4]) {
      const a = first + j;
      indices.push(a, a + 1, a + 3, a + 3, a + 1, a + 4);
    }
  }

  if (fir) {
    limb(vec(0, -0.08, 0), vec(0.06, 7.8, 0), 0.2, 0.025, 8);
    for (let tier = 0; tier < 8; tier++) {
      const y = 1.48 + tier * 0.8,
        radius = 2.26 - tier * 0.245;
      const count = tier < 5 ? 7 : 5;
      for (let i = 0; i < count; i++) {
        const a = tier * 2.4 + ((i + rand() * 0.33) * 2 * Math.PI) / count;
        const root = vec(0, y + (rand() - 0.5) * 0.63, 0),
          len = radius * (0.87 + rand() * 0.2);
        const fork = offset(root, a, len * 0.43, -0.17);
        limb(root, fork, 0.075 * (1 - tier * 0.095), 0.021);
        for (const s of [-1, 1]) spray(fork, a + s * 0.34, len * 0.76, len * 0.68, -0.18 + (rand() - 0.5) * 0.5, s * 0.72, 0.09);
        spray(root, a, len * 1.1, len * 0.91, -0.18, rand() - 0.5, 0.22);
      }
    }
    for (let i = 0; i < 6; i++) spray(vec(0.05, 7.18, 0), i * 2.4, 0.25, 0.47, 0.89, 0.7);
  } else {
    const foot = vec(0, -0.08, 0),
      fork = vec(0.07, 2.1, -0.09);
    limb(foot, fork, 0.225, 0.165, 9);
    const leader = vec(-0.17, 4.75, 0.26);
    limb(fork, leader, 0.155, 0.067, 8);
    // Unequal scaffold limbs leave openings through the middle of the tree.
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4 + rand() * 0.54,
        high = i >= 5;
      const root = fork.clone().lerp(leader, i / 8);
      const elbow = offset(root, a, high ? 0.34 : 0.77, 0.55 + rand() * 0.39);
      const joint = offset(elbow, a + 0.22, high ? 0.61 : 0.9, high ? 1.53 : 0.82);
      limb(root, elbow, high ? 0.082 : 0.106, 0.088, 7);
      limb(elbow, joint, 0.091, 0.054, 6);
      for (const s of [-1, 0, 1]) {
        const dir = a + s * (0.64 + rand() * 0.48),
          end = offset(joint, dir, 0.41 + rand() * 0.44, 0.34 + rand() * 0.62);
        limb(joint, end, 0.051, 0.018);
        for (const k of [-1, 0, 1]) {
          spray(
            end,
            dir + k * 0.92,
            0.94 + rand() * 0.67,
            1.42 + rand() * 0.7,
            0.16 + rand() * 0.88,
            (rand() - 0.5) * 1.92,
            0.35,
          );
        }
        spray(joint, dir, 1.22, 1.55, 0.72, (rand() - 0.5) * 1.5);
        spray(end, dir + 0.35, 1.1, 1.3, -0.24, -0.8, 0.25);
      }
    }
  }
  const bark = mergeGeometries(limbs);
  limbs.forEach((g) => g.dispose());
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setIndex(indices);
  return { bark, leaves };
}

function farGeometry(kind) {
  const [width, height] = extent[kind];
  const planes = [0, Math.PI / 2].map((angle, i) => {
    const g = new THREE.PlaneGeometry(width, height, 2, 2).translate(0, height / 2, 0);
    const uv = g.attributes.uv,
      n = g.attributes.normal,
      p = g.attributes.position;
    for (let k = 0; k < uv.count; k++) {
      uv.setX(k, (uv.getX(k) + i) * 0.5);
      const v = vec(p.getX(k) / width, 0.82, 0.4).normalize();
      n.setXYZ(k, v.x, v.y, v.z);
    }
    return g.rotateY(angle);
  });
  return mergeGeometries(planes);
}

export function treeTexture(file) {
  const texture = new THREE.TextureLoader().load(new URL('./textures/' + file, import.meta.url).href);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function renderRoadsideTrees(scene, trees, height, wear, detailDistance) {
  if (!trees.length) return () => {};
  const bark = new THREE.MeshStandardMaterial({ map: treeTexture('tree-bark.jpg'), roughness: 0.97 });
  function foliage(file, vertexColors, cutoff) {
    const mat = wear(
      new THREE.MeshStandardMaterial({
        map: treeTexture(file),
        vertexColors,
        side: THREE.DoubleSide,
        roughness: 0.9,
        alphaTest: cutoff,
      }),
      'tree',
    );
    // The normals describe the volume of a leaf cluster. Keep them facing
    // outwards on both sides as the camera moves around an individual spray.
    const weatherShader = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      weatherShader(shader);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\nnormal *= faceDirection;',
      );
    };
    return mat;
  }
  const models = species.map((kind) => ({
    ...treeGeometry(kind),
    far: farGeometry(kind),
    leafMaterial: foliage(kind + '-bough.webp', true, 0.26),
    farMaterial: foliage(kind + '-distant.webp', false, 0.23),
  }));
  const cells = new Map();
  for (const t of trees) {
    const ix = Math.floor(t[0] / tileSize),
      iz = Math.floor(t[1] / tileSize),
      key = ix + ',' + iz;
    if (!cells.has(key))
      cells.set(key, { x: ix * tileSize, z: iz * tileSize, sets: [[], []], near: new THREE.Group(), far: new THREE.Group() });
    cells.get(key).sets[t[3]].push(t);
  }
  const matrix = new THREE.Matrix4(),
    quat = new THREE.Quaternion(),
    scale = vec(1, 1, 1),
    p = vec(0, 0, 0),
    tint = new THREE.Color();
  for (const cell of cells.values()) {
    cell.near.name = 'roadside_tree_branches';
    cell.far.name = 'roadside_tree_silhouettes';
    scene.add(cell.near, cell.far);
    cell.sets.forEach((list, k) => {
      if (!list.length) return;
      const m = models[k];
      function batch(group, g, mat) {
        const mesh = new THREE.InstancedMesh(g, mat, list.length);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      }
      const wood = batch(cell.near, m.bark, bark),
        leaves = batch(cell.near, m.leaves, m.leafMaterial),
        far = batch(cell.far, m.far, m.farMaterial);
      // All three batches use one immutable placement buffer.
      leaves.instanceMatrix = far.instanceMatrix = wood.instanceMatrix;
      list.forEach(([x, z, size], i) => {
        const rand = seeded(Math.floor(x * 97) * 7001 + Math.floor(z * 149));
        quat.setFromAxisAngle(up, rand() * Math.PI * 2);
        scale.set(size * (0.86 + 0.25 * rand()), size * (0.88 + 0.27 * rand()), size);
        wood.setMatrixAt(i, matrix.compose(p.set(x, height(x, z), z), quat, scale));
        tint.setRGB(0.76 + rand() * 0.24, 0.82 + rand() * 0.16, 0.66 + rand() * 0.31);
        leaves.setColorAt(i, tint);
      });
      far.instanceColor = leaves.instanceColor;
      for (const batch of [wood, leaves, far]) batch.computeBoundingSphere();
    });
  }
  let lastX = Infinity,
    lastZ = Infinity;
  function update(x, z) {
    if (Math.abs(x - lastX) < 6 && Math.abs(z - lastZ) < 6) return;
    lastX = x;
    lastZ = z;
    for (const cell of cells.values()) {
      const dx = Math.max(cell.x - x, 0, x - cell.x - tileSize),
        dz = Math.max(cell.z - z, 0, z - cell.z - tileSize);
      const range = detailDistance + (cell.near.visible ? 12 : 0);
      cell.near.visible = dx * dx + dz * dz < range * range;
      cell.far.visible = !cell.near.visible;
    }
  }
  update(0, 0);
  return update;
}
