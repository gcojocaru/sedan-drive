import * as THREE from 'three';
import { seeded } from './geom.js';
import { makeTex } from './world-kit.js';

// One repeat along the street is a concrete panel. Four atlas rows keep the
// panel joints, curb stone, drainage channel and tactile dots in one draw call.
function concreteAtlas() {
  const rand = seeded(807);
  const map = makeTex(512, 256, (ctx) => {
    ['#bab4aa', '#a59f94', '#89867e', '#b49a64'].forEach((color, row) => {
      const y = row * 64;
      ctx.fillStyle = color;
      ctx.fillRect(0, y, 512, 64);
      for (let i = 0; i < 3400; i++) {
        ctx.fillStyle = rand() < 0.55 ? 'rgba(58,48,38,.13)' : 'rgba(255,250,236,.22)';
        ctx.fillRect(rand() * 512, y + rand() * 62, 1 + rand() * 1.4, 1 + rand());
      }
      ctx.fillStyle = 'rgba(59,52,44,.42)';
      ctx.fillRect(0, y, 3, 64);
      ctx.fillStyle = 'rgba(245,237,219,.38)';
      ctx.fillRect(3, y, 2, 64);
    });
    for (let x = 4; x < 512; x += 16)
      for (let y = 196; y < 256; y += 8) {
        ctx.fillStyle = '#8c784f';
        ctx.beginPath();
        ctx.ellipse(x, y, 3, 1.6, 0, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#c5ae7a';
        ctx.beginPath();
        ctx.ellipse(x - 0.7, y - 0.7, 2, 1.1, 0, 0, 2 * Math.PI);
        ctx.fill();
      }
  });
  map.anisotropy = 4;
  return map;
}

export function addCurbBlock(scene, block, height, wear) {
  const pos = [],
    uv = [];
  for (const { sections, cuts, side } of block.strips) {
    function row(section) {
      const { x, z, nx, nz, rise, width } = section;
      const at = (offset, y) => {
        const px = x + nx * offset,
          pz = z + nz * offset;
        return [px, height(px, pz) + y, pz];
      };
      const tie = Math.min(1, section.s - block.start, block.end - section.s);
      const gutter = 0.05 + 0.005 * tie,
        top = 0.05 + 0.005 * tie + rise;
      // Match both original layers at the ends of the block, including the
      // centimetre by which the existing sidewalk sits below the asphalt.
      const slab = (crossfall) => 0.04 + (0.015 + crossfall) * tie + rise;
      return [
        at(-0.32, gutter),
        at(0, gutter),
        at(0, top),
        at(Math.min(width, 0.024), top + 0.003 * tie),
        at(Math.min(width, 0.18), slab(0.003)),
        at(Math.min(width, 0.72), slab(0.006)),
        at(width, slab(0.013)),
        at(width, 0.04),
      ];
    }
    let previous = row(sections[0]);
    for (let j = 1; j < sections.length; j++) {
      const a = sections[j - 1],
        b = sections[j],
        next = row(b);
      if (!a.width && !b.width) {
        previous = next;
        continue;
      }
      const tactile = cuts.some((c) => Math.abs((a.s + b.s) / 2 - c) < 1.5);
      const rows = [2, 1, 1, 1, tactile ? 3 : 0, 0, 1];
      for (let i = 0; i < rows.length; i++) {
        const band = rows[i],
          u0 = a.s / 1.8,
          u1 = b.s / 1.8;
        // Canvas row zero maps to the top of the texture. Inset the sampling
        // rectangle to leave a mipmap gutter between neighboring finishes.
        const v0 = 1 - (band * 64 + 3) / 256,
          v1 = 1 - (band * 64 + 61) / 256;
        const points = [previous[i], previous[i + 1], next[i + 1], next[i]];
        const coords = [
          [u0, v0],
          [u0, v1],
          [u1, v1],
          [u1, v0],
        ];
        for (const n of side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) {
          pos.push(...points[n]);
          uv.push(...coords[n]);
        }
      }
      previous = next;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = wear(new THREE.MeshStandardMaterial({ map: concreteAtlas(), roughness: 0.87 }), 'pave');
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mapped_block_curbs';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}
