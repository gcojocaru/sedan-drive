// The surveyed road and parcel outlines use the real-map origin at 37.802, -122.422.
// Architectural finishes are an artist's interpretation for this single junction.
import * as THREE from 'three';
import { mergeGeometries } from './vendor/three-0.184.0/examples/jsm/utils/BufferGeometryUtils.js';
import { terrainGrid } from './terrain.js';
import { makeTex } from './world-kit.js';

export const origin = [37.802, -122.422];
export const parkApproach = { x: 105, z: 14, h: -2.80 };
export const approach = { x: 67.6, z: 22.1, h: -2.54 };
async function asset(file) {
  const response = await fetch(new URL('./prototype/' + file, import.meta.url));
  if (!response.ok) throw Error('Could not load the Russian Hill preview.');
  return response;
}
export async function loadCorner() {
  const [map, heights] = await Promise.all([asset('russian-hill.json.gz'), asset('elevation.json')]);
  const bytes = new Uint8Array(await map.arrayBuffer());
  // Some static hosts transparently inflate .gz files through Content-Encoding.
  const blob = new Blob([bytes]);
  const json = bytes[0] === 0x1f ? new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))) : blob;
  const elements = JSON.parse(await json.text());
  for (const way of elements) if (way.geometry) way.geometry = way.geometry.map(([lat, lon]) => ({ lat, lon }));
  return { data: { elements }, terrain: terrainGrid(await heights.json()) };
}

export async function finishCorner({ scene, road, markings, wear, height, buildings }) {
  const loader = new THREE.TextureLoader();
  const [color, normal, roughness] = await Promise.all(
    ['diff', 'nor_gl', 'rough'].map(async (key) => {
      const map = await loader.loadAsync(new URL('./prototype/asphalt-' + key + '.jpg', import.meta.url).href);
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(2.4, 2.4);
      map.anisotropy = 8;
      return map;
    }),
  );
  color.colorSpace = THREE.SRGBColorSpace;
  road.map = color;
  road.normalMap = normal;
  road.roughnessMap = roughness;
  road.normalScale.set(0.33, 0.33);
  road.needsUpdate = true;
  markings.map = color;
  markings.color.setScalar(2.7); // Aggregate shows through worn paint.
  markings.normalMap = normal;
  markings.normalScale.set(0.16, 0.16);
  markings.roughnessMap = roughness;
  markings.needsUpdate = true;

  const batches = new Map();
  function material(color, wet, props = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.82, ...props });
    batches.set(mat, []);
    return wet ? wear(mat, wet) : mat;
  }
  function box(mat, x, y, z, width, tall, depth, yaw = 0) {
    const g = new THREE.BoxGeometry(width, tall, depth);
    g.rotateY(yaw);
    g.translate(x, y, z);
    batches.get(mat).push(g);
  }
  const paving = material('#b3aba0', 'pave'),
    granite = material('#998f81', 'pave');
  const gutter = material('#827d73', 'road'),
    iron = material('#323638', null, { metalness: 0.55, roughness: 0.54 });
  const warning = material('#b49a54', 'pave');
  const joints = material('#605c54', 'pave');

  // Surveyed southwest corner. Follow both bent road edges, with a rounded
  // return tangent to each approach. Positive lateral distance is the sidewalk.
  const path = [];
  function line(a, b) {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.42);
    for (let i = 0; i < steps; i++) path.push(a.map((v, k) => v + ((b[k] - v) * i) / steps));
  }
  const first = [30, 36.6],
    a = [54, 32.8],
    control = [60.6, 30.7],
    b = [61.7, 37.4],
    end = [64.6, 56];
  line(first, a);
  for (let k = 0; k < 24; k++) {
    const t = k / 24,
      u = 1 - t;
    path.push(a.map((v, i) => u * u * v + 2 * u * t * control[i] + t * t * b[i]));
  }
  line(b, end);
  path.push(end);
  const rows = path.map(([x, z], i) => {
    const prev = path[Math.max(0, i - 1)],
      next = path[Math.min(i + 1, path.length - 1)];
    const dx = next[0] - prev[0],
      dz = next[1] - prev[1],
      len = Math.hypot(dx, dz);
    const ramp = Math.min(1, Math.max(0, (Math.hypot(x - 56.5, z - 32.3) - 0.85) / 1.0));
    const fade = Math.min(1, Math.hypot(x - first[0], z - first[1]) / 2, Math.hypot(x - end[0], z - end[1]) / 2);
    return (d, h) => {
      const px = x - (dz / len) * d,
        pz = z + (dx / len) * d;
      return [px, height(px, pz) + h(ramp, fade), pz];
    };
  });
  const roadY = () => 0.066,
    lip = (r, f) => 0.07 + 0.135 * r * f,
    rear = (r, f) => 0.076 + 0.145 * f;
  function strip(i, mat, d0, h0, d1, h1) {
    const p = rows[i],
      q = rows[i + 1];
    const positions = [p(d0, h0), p(d1, h1), q(d0, h0), q(d0, h0), p(d1, h1), q(d1, h1)].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 1, 2, 3, 4, 5]);
    batches.get(mat).push(g);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    strip(i, gutter, -0.34, roadY, 0, roadY);
    strip(i, granite, 0, roadY, 0, lip);
    strip(i, granite, 0, lip, 0.24, lip);
    strip(i, paving, 0.24, lip, 2.1, rear);
    strip(i, paving, 2.1, rear, 2.2, roadY);
    if (i % 4 === 0) {
      const p = rows[i](1.13, rear),
        q = rows[i](0, lip);
      const yaw = -Math.atan2(p[2] - q[2], p[0] - q[0]);
      const mid = rows[i](1.13, (r, f) => (lip(r, f) + rear(r, f)) / 2);
      box(joints, ...mid, 1.68, 0.006, 0.011, yaw);
    }
  }
  // Cast-iron grate sits in the gutter. Tiles of raised domes mark the curb cut.
  const grateAngle = 0.155;
  box(iron, 46, height(46, 33.7) + 0.081, 33.7, 0.82, 0.028, 0.31, grateAngle);
  for (let k = -5; k <= 5; k++) {
    const x = 46 + 0.065 * k,
      z = 33.7 - 0.01 * k;
    box(gutter, x, height(x, z) + 0.099, z, 0.025, 0.01, 0.25, grateAngle);
  }
  for (let i = 0; i < rows.length; i++) {
    if (Math.hypot(path[i][0] - 56.5, path[i][1] - 32.3) > 0.65) continue;
    if (i + 1 < rows.length)
      strip(
        i,
        warning,
        0.28,
        (r, f) => lip(r, f) + 0.012,
        0.82,
        (r, f) => lip(r, f) + 0.052,
      );
    for (let d = 0.35; d < 0.8; d += 0.1) {
      const p = rows[i](d, (r, f) => lip(r, f) + 0.016 + 0.075 * (d - 0.28));
      box(warning, ...p, 0.041, 0.026, 0.041);
    }
  }

  // Dress the north face of the mapped three-storey house at 2565 Larkin.
  const parcel = buildings.find((b) => b.id === 262722466);
  let lightFront;
  if (parcel) {
    const start = parcel.outer[6],
      end = parcel.outer[7];
    const dx = end[0] - start[0],
      dz = end[1] - start[1],
      width = Math.hypot(dx, dz);
    const ux = dx / width,
      uz = dz / width,
      yaw = -Math.atan2(uz, ux);
    const base = parcel.outer.reduce((v, [x, z]) => v + height(x, z), 0) / parcel.outer.length;
    const place = (u, d) => [start[0] + ux * u + uz * d, start[1] + uz * u - ux * d];
    function trim(mat, u, y, d, w, h, depth) {
      const [x, z] = place(u, d);
      box(mat, x, base + y, z, w, h, depth, yaw);
    }
    const wall = material('#b2a898'),
      cream = material('#e3d9c5'),
      sill = material('#aa9b88');
    const frame = material('#38413f'),
      door = material('#553b2a');
    const pane = material('#657e84', null, { metalness: 0.3, roughness: 0.16, emissive: 0xffbd78, emissiveIntensity: 0 });
    const glow = material('#c8b497', null, { emissive: 0xffc483, emissiveIntensity: 0 });
    const lamp = material('#d7c9b3', null, { emissive: 0xffce8e, emissiveIntensity: 0 });
    const glazing = makeTex(192, 192, (ctx) => {
      const sky = ctx.createLinearGradient(0, 0, 35, 192);
      sky.addColorStop(0, '#c1d6dd');
      sky.addColorStop(0.56, '#899fa2');
      sky.addColorStop(1, '#455357');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 192, 192);
      for (let x = 0; x < 34; x++) {
        ctx.fillStyle = 'rgba(244,236,217,' + (0.22 + 0.12 * Math.cos(x * 0.6)) + ')';
        const offset = 5 * Math.sin((x / 34) * Math.PI);
        ctx.fillRect(x, 0, 1, 192 - offset);
        ctx.fillRect(191 - x, 0, 1, 192 - offset);
      }
      for (let y = 0; y < 56; y += 6) {
        ctx.fillStyle = '#b9b6a9';
        ctx.fillRect(32, y, 128, 3);
      }
    });
    pane.map = glazing;
    pane.color.set('#b8c3c5');
    glow.map = glazing;
    glow.emissiveMap = glazing;
    // The sidewalk widens into the house lot here. Pave the short gap between
    // the rear of the curb ramp and the door landing on the surveyed grade.
    for (let i = 0; i < rows.length - 1; i++) {
      if (path[i][0] < start[0] || path[i + 1][0] > end[0] || path[i][1] > 37) continue;
      const landing = (j) => {
        const [x, , z] = rows[j](2.1, rear);
        const along = Math.max(0, Math.min(width, (x - start[0]) * ux + (z - start[1]) * uz));
        const [px, pz] = place(along, 0.03);
        return [px, height(px, pz) + 0.15, pz];
      };
      const a = rows[i](2.1, rear),
        b = rows[i + 1](2.1, rear);
      const g = new THREE.BufferGeometry();
      g.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([a, landing(i), b, b, landing(i), landing(i + 1)].flat(), 3),
      );
      g.computeVertexNormals();
      g.setIndex([0, 1, 2, 3, 4, 5]);
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1], 2));
      batches.get(paving).push(g);
    }
    const numberPlate = material('#ffffff');
    numberPlate.map = makeTex(256, 96, (ctx) => {
      ctx.fillStyle = '#293431';
      ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = '#dfd3b8';
      ctx.font = '60px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('2565', 128, 69);
    });
    const panel = makeTex(128, 128, (ctx) => {
      ctx.fillStyle = '#efeae1';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#beb9ae';
      ctx.fillRect(0, 123, 128, 3);
      ctx.fillStyle = '#fffaf1';
      ctx.fillRect(0, 126, 128, 2);
    });
    panel.repeat.set(1, 46);
    wall.map = panel;
    trim(wall, width / 2, 4, 0.06, width, 12, 0.16);
    for (const y of [3.33, 9.55, 9.9]) trim(sill, width / 2, y, 0.2, width + 0.15, 0.055, 0.43);
    for (const [y, h, d] of [
      [3.25, 0.18, 0.43],
      [9.62, 0.23, 0.38],
      [9.85, 0.19, 0.52],
    ])
      trim(cream, width / 2, y, d / 2, width + 0.16, h, d);
    for (let level = 0; level < 3; level++)
      for (let bay = 0; bay < 6; bay++) {
        const u = ((bay + 0.5) * width) / 6,
          floor = level * 3.12;
        const [x, z] = place(u, 0.6);
        if (level === 0 && bay === 4) {
          const threshold = height(x, z) - base + 0.49;
          trim(cream, u, threshold + 1.16, 0.23, 1.56, 2.36, 0.27);
          trim(door, u, threshold + 1.1, 0.38, 1.22, 2.2, 0.06);
          trim(pane, u, threshold + 1.63, 0.42, 0.83, 0.68, 0.03);
          for (let j = 0; j < 3; j++) trim(sill, u, threshold - j * 0.15 - 0.12, 0.48 + j * 0.28, 1.62, 0.24, 0.32);
          trim(numberPlate, u - 0.96, threshold + 1.65, 0.22, 0.45, 0.17, 0.045);
          trim(lamp, u + 0.99, threshold + 1.85, 0.3, 0.17, 0.33, 0.22);
          continue;
        }
        const y = level === 0 ? Math.max(1.58, height(x, z) - base + 1.6) : floor + 1.58;
        trim(cream, u, y, 0.21, 1.82, 2.04, 0.23);
        trim(frame, u, y, 0.34, 1.64, 1.84, 0.055);
        trim((bay + level) % 4 === 0 ? glow : pane, u, y, 0.375, 1.5, 1.69, 0.025);
        trim(cream, u, y + 0.1, 0.405, 1.53, 0.065, 0.055);
        trim(cream, u, y, 0.405, 0.053, 1.72, 0.055);
        trim(sill, u, y - 1.02, 0.28, 2.02, 0.13, 0.5);
      }
    lightFront = (on) => {
      glow.emissiveIntensity = on ? 0.92 : 0;
      lamp.emissiveIntensity = on ? 1.8 : 0;
    };
  }
  for (const [mat, parts] of batches) {
    if (!parts.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(parts), mat);
    mesh.name = 'Russian Hill corner';
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    parts.forEach((g) => g.dispose());
  }
  return lightFront;
}
