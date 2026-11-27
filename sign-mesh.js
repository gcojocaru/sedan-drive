// Static curbside signs. Repeated names share one atlas tile, including both sides of a plate.
import * as THREE from 'three';
import { makeTex } from './world-kit.js';

const CELL_W = 384, CELL_H = 104, COLUMNS = 5, PAGE_SIZE = COLUMNS * 18;
const PX_PER_METRE = 100, CENTRE_Y = 2.62;
const signFont = px => `bold ${px}px Roboto, Arial, sans-serif`;

function splitLabel(ctx, label) {
  const words = label.split(/\s+/u);
  if (words.length > 1) {
    let best = Infinity, lines;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const width = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
      if (width < best) { best = width; lines = [a, b]; }
    }
    return lines;
  }
  // Keep emoji, combining marks and other grapheme clusters together on unspaced names.
  const chars = typeof Intl.Segmenter === 'function'
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(label), s => s.segment)
    : Array.from(label);
  const mid = Math.ceil(chars.length / 2);
  return [chars.slice(0, mid).join(''), chars.slice(mid).join('')];
}

function paintTile(ctx, { kind, label }, left, top) {
  const street = kind === 'street', margin = 35, maxWidth = 360;
  ctx.font = signFont(street ? 43 : 46);
  ctx.direction = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(label.match(/\p{L}/u)?.[0] || '') ? 'rtl' : 'ltr';
  const full = ctx.measureText(label).width;
  const width = Math.round(THREE.MathUtils.clamp(full + margin, street ? 260 : 300, maxWidth));
  const lines = full > (width - margin) * 1.35 ? splitLabel(ctx, label) : [label];
  const two = lines.length > 1, height = street ? (two ? 70 : 62) : (two ? 90 : 77);
  const x = left + (CELL_W - width) / 2, y = top + (CELL_H - height) / 2;
  ctx.fillStyle = street ? '#145c58' : '#804627';
  ctx.fillRect(left, top, CELL_W, CELL_H); // Solid gutter for linear filtering and mipmaps.
  ctx.beginPath();
  ctx.roundRect(x + 4, y + 4, width - 8, height - 8, 5);
  ctx.strokeStyle = street ? '#d8eee5' : '#f3dfb9'; ctx.lineWidth = 2;
  ctx.stroke();
  for (const bx of [x + 10, x + width - 10]) {
    ctx.beginPath(); ctx.arc(bx, y + height / 2, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = '#bbc2ba'; ctx.fill();
  }
  const lineHeight = two ? (street ? 26 : 34) : 0;
  if (two) ctx.font = signFont(street ? 28 : 36);
  ctx.fillStyle = '#fffdf1'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => ctx.fillText(line, x + width / 2, y + height / 2 + (i - (lines.length - 1) / 2) * lineHeight, width - margin));
  return {
    width: width / PX_PER_METRE, height: height / PX_PER_METRE,
    u0: x / ctx.canvas.width, u1: (x + width) / ctx.canvas.width,
    v0: 1 - (y + height) / ctx.canvas.height, v1: 1 - y / ctx.canvas.height,
  };
}

function addPlate({ positions, uvs, indices }, { x, z, dx, dz }, tile, ground) {
  const w = tile.width / 2, h = tile.height / 2, cut = 0.045, depth = 0.026;
  const corners = [[-w + cut, -h], [w - cut, -h], [w, -h + cut], [w, h - cut],
    [w - cut, h], [-w + cut, h], [-w, h - cut], [-w, -h + cut]];
  function vertex([a, b], offset, u, v) {
    positions.push(x + a * dx - offset * dz, ground + CENTRE_Y + b, z + a * dz + offset * dx);
    uvs.push(u, v);
  }
  for (const side of [1, -1]) {
    const start = positions.length / 3;
    for (const p of corners) {
      const u = THREE.MathUtils.lerp(tile.u0, tile.u1, 0.5 + side * p[0] / tile.width);
      const v = THREE.MathUtils.lerp(tile.v0, tile.v1, 0.5 + p[1] / tile.height);
      vertex(p, side * depth, u, v);
    }
    for (let i = 1; i < corners.length - 1; i++) {
      if (side === 1) indices.push(start, start + i, start + i + 1);
      else indices.push(start, start + i + 1, start + i);
    }
  }
  // Close the thin enamelled edges. The corner texel holds the enamel colour.
  for (let i = 0; i < corners.length; i++) {
    const start = positions.length / 3, a = corners[i], b = corners[(i + 1) % corners.length];
    vertex(a, -depth, tile.u0, tile.v0); vertex(b, -depth, tile.u0, tile.v0);
    vertex(b, depth, tile.u0, tile.v0); vertex(a, depth, tile.u0, tile.v0);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
}

export function addSignMeshes(scene, signs, height = () => 0) {
  if (!signs.length) return;
  const group = new THREE.Group(); group.name = 'map_signs';
  const metal = new THREE.MeshStandardMaterial({ color: 0x899997, roughness: 0.55, metalness: 0.55 });
  const pole = new THREE.CylinderGeometry(0.043, 0.052, 1, 8).translate(0, 0.5, 0);
  const posts = new THREE.InstancedMesh(pole, metal, signs.length);
  posts.name = 'map_sign_posts'; posts.castShadow = true; posts.receiveShadow = true;
  group.add(posts);

  const byLabel = new Map();
  for (const sign of signs) {
    const key = sign.kind + '/' + sign.label;
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key).push(sign);
  }
  const entries = Array.from(byLabel.values()), matrix = new THREE.Matrix4();
  let postIndex = 0;
  for (let start = 0; start < entries.length; start += PAGE_SIZE) {
    const page = entries.slice(start, start + PAGE_SIZE), columns = Math.min(page.length, COLUMNS);
    const buffers = { positions: [], uvs: [], indices: [] };
    const atlas = makeTex(columns * CELL_W, Math.ceil(page.length / columns) * CELL_H, ctx => {
      page.forEach((copies, i) => {
        const tile = paintTile(ctx, copies[0], (i % columns) * CELL_W, Math.floor(i / columns) * CELL_H);
        for (const sign of copies) {
          const ground = height(sign.x, sign.z);
          addPlate(buffers, sign, tile, ground);
          matrix.makeScale(1, CENTRE_Y - tile.height / 2 + 0.012, 1).setPosition(sign.x, ground, sign.z);
          posts.setMatrixAt(postIndex++, matrix);
        }
      });
    });
    atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
    const enamel = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.67, metalness: 0.04 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
    geo.setIndex(buffers.indices); geo.computeVertexNormals();
    const plates = new THREE.Mesh(geo, enamel);
    plates.name = 'map_sign_plates_' + (start / PAGE_SIZE + 1);
    plates.castShadow = true; plates.receiveShadow = true; group.add(plates);
  }
  scene.add(group);
}
