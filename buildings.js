// Buildings from OSM footprints. Walls and roofs are generated per footprint (no ExtrudeGeometry). A pitched roof
// (roof:shape, or the house default) is the lower envelope of a few planes over the footprint's oriented bounding box:
// walls rise to that roof line, which makes gable ends on their own, and each plane's roof face is the footprint
// clipped to where that plane is the lowest. Also building:part pieces, ground-floor shopfronts and entrances, lit
// windows, and inBuilding(x, z, y) for the car, camera, trees and lamps.
import * as THREE from 'three';
import { inPoly, bbox, seeded, openRing, signedArea, obb, clipHalf, tri3, quad3, gkey, segDist, offsetRing } from './geom.js';
import { eachTri, makeTex, num, tagColor, matColor, WALL_MAT } from './world-kit.js';
import { facadeWalls, onOutline, planFronts, shopBays, isRetail, facadeAtlas, HOUSE_T, PLAIN_T, FACADES, FACADE, facadeStyle, floorGrid, bayCoords, wallAtlas, ATLAS_CELL, SURFACES, WALL_SURFACES, levelPhoto } from './building-fronts.js';

function innerPt(r) { // a point inside the ring (centroid, or the middle of its largest triangle)
  let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } x /= r.length; z /= r.length;
  if (inPoly(x, z, r)) return [x, z];
  let best = r[0], ba = -1;
  eachTri(openRing(r), [], (a, b, c) => { const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])); if (ar > ba) { ba = ar; best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; } });
  return best;
}
function bDefaultH(type, r) { // typical total height (m) when a building has no height or level tags
  const d = { house: 7, detached: 7.5, semidetached_house: 8, terrace: 9, residential: 10, apartments: 16, bungalow: 4.5, garage: 3, garages: 3, carport: 2.6, shed: 2.8, hut: 3, cabin: 3.5, commercial: 12, retail: 7, supermarket: 7, industrial: 9, warehouse: 9, office: 18, school: 10, university: 14, hospital: 18, church: 15, cathedral: 30, hotel: 20, train_station: 12, kiosk: 3, service: 3.5, static_caravan: 3, roof: 4, farm: 7, barn: 7, farm_auxiliary: 5 };
  return (d[type] || 8) * (0.85 + r() * 0.35);
}
// roof:shape → the shapes we can build; anything else falls back to the house/flat defaults
const ROOF_SHAPE = { flat: 'flat', gabled: 'gabled', gambrel: 'gabled', side_mansard: 'gabled', saltbox: 'gabled', round: 'gabled', hipped: 'hipped', 'half-hipped': 'hipped', side_hipped: 'hipped', mansard: 'hipped', quadruple_saltbox: 'hipped', pyramidal: 'pyramidal', cone: 'pyramidal', skillion: 'skillion', sloped: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'onion' };
const WALLS = [ // wall colours per facade style (FACADES order) when the tags give none
  ['#e4ddd0', '#d8cfc0', '#cbbfae', '#b59c82', '#c4b39b', '#ddd6cb', '#e8e2d6', '#b8866a', '#d2c6b0', '#e6d3b3', '#cfd3c5'], // house
  ['#cfcac0', '#bdb8ae', '#d8d2c4', '#c2c6c4', '#e0d7c2', '#c9c0b0', '#d6cbb8'], // panel
  ['#e2d6bf', '#d9c4a0', '#e8dcc8', '#cbb595', '#e0cdb4', '#c9b8a6', '#d8b9a0', '#d6c7b0', '#a9725c'], // classic
  ['#c8c4bc', '#a9adb1', '#d6d0c4', '#8f9499', '#b7b2a8'], ['#9aa3a8'], // office, glass (only the frames take it)
  ['#c9ccce', '#9fb0bd', '#d9d6cf', '#7f8f84', '#b9a58a', '#a8aeb3'], // industrial
  ['#a0583f', '#8e4b37', '#b36b4f', '#7d4a3a', '#b98a68', '#9c6a52'], // brick
  ['#d8d1c4', '#c9c0b0', '#bdb6aa', '#ddd6cb', '#9f948a']]; // blank
const ROOFS = ['#5f5c58', '#6e6a64', '#4f4d4b', '#77736c'], TILES = ['#9c4f34', '#8b5a44', '#a5603f', '#7a5040', '#8f4a36', '#6d4c41', '#55585d'], DOMES = ['#6f9a86', '#7d8287', '#a58a4e'];
const METALS = ['#7b8287', '#5d6a72', '#8a3b2e', '#4e5d4f', '#6c6f73', '#9a9c9a'], METAL_R = new Set(['metal', 'metal_sheet', 'copper', 'tin', 'zinc', 'steel', 'aluminium']);
const CAP = new THREE.Color('#c9c5bd'); // parapet coping
const ROOF_MAT = { roof_tiles: '#a0553a', tile: '#a0553a', tiles: '#a0553a', slate: '#4c5059', metal: '#7b8287', metal_sheet: '#7b8287', copper: '#6f9a86', concrete: '#8e8c87', tar_paper: '#3f3f42', asphalt: '#3f3f42', glass: '#8fa7b8', thatch: '#8a7448', grass: '#6f8d4a', gravel: '#9a958c', wood: '#6b5038', stone: '#8e877c', eternit: '#7d7d78' };
const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };

function findBuildingParts(bPolys) {
  const PG = 20, pgrid = new Map(), hidden = new Set(), parentOutline = new Map();
  for (const part of bPolys) if (part.kind === 'part') {
    const p = innerPt(part.outer), key = gkey(Math.floor(p[0] / PG), Math.floor(p[1] / PG));
    if (!pgrid.has(key)) pgrid.set(key, []);
    pgrid.get(key).push({p, part});
  }
  if (pgrid.size) for (const b of bPolys) if (b.kind === 'building') {
    const B = bbox(b.outer);
    for (let ix = Math.floor(B.x0 / PG); ix <= Math.floor(B.x1 / PG); ix++) for (let iz = Math.floor(B.z0 / PG); iz <= Math.floor(B.z1 / PG); iz++) {
      for (const {p, part} of pgrid.get(gkey(ix, iz)) || []) {
        if (inPoly(p[0], p[1], b.outer) && !b.holes.some(h => inPoly(p[0], p[1], h))) {
          hidden.add(b);
          parentOutline.set(part, b);
        }
      }
    }
  }
  return {hidden, parentOutline};
}

function createFrontages(entranceNodes, hidden, parentOutline, roadAt) {
  const fronts = new Map(), panels = { p: [], n: [], c: [], uv: [] };
  function footprintWalls(outer, holes) {
    return [outer, ...holes].flatMap((ring, i) =>
      facadeWalls(ring, Math.sign(signedArea(ring)) * (i ? -1 : 1), i > 0));
  }
  function collectEntrances(doors, rings) {
    for (const ring of rings) for (const p of ring) {
      const key = p.join(',');
      if (entranceNodes.has(key)) doors.set(key, p);
    }
  }
  function collectFronts(b, outer, holes, eave, type, wc) {
    const owner = parentOutline.get(b) || b;
    let group = fronts.get(owner);
    if (!group) {
      group = { walls: [], doors: new Map(), outline: null };
      if (hidden.has(owner)) {
        group.outline = footprintWalls(openRing(owner.outer), owner.holes.map(openRing));
        collectEntrances(group.doors, [owner.outer, ...owner.holes]);
      }
      fronts.set(owner, group);
    }
    collectEntrances(group.doors, [outer, ...holes]);
    for (const wall of footprintWalls(outer, holes)) {
      const exterior = !group.outline || onOutline(wall, group.outline);
      wall.infer = exterior && !PLAIN_T.has(type);
      wall.retail = exterior && (isRetail(b.t) || isRetail(owner.t));
      wall.height = eave;
      wall.color = wc;
      group.walls.push(wall);
    }
  }
  function streetScore(wall) {
    const x = (wall.a[0] + wall.b[0]) / 2, z = (wall.a[1] + wall.b[1]) / 2;
    const hit = roadAt(x,z);
    let best = Infinity;
    for (const seg of [hit.drv, hit.any]) {
      if (!seg) continue;
      const [distance, t] = segDist(x,z,seg);
      const facing = ((seg.ax + t * seg.dx - x) * wall.nx + (seg.az + t * seg.dz - z) * wall.nz) / (distance || 1);
      if (facing > 0.45) best = Math.min(best, distance / facing);
    }
    return best;
  }
  function render(PB, mkMesh) {
    const white = new THREE.Color(0xffffff);
    const awningColors = ['#286b64', '#924b3d', '#455d79', '#886b3e'].map(c => new THREE.Color(c));
    for (const [building, group] of fronts) {
      const faces = planFronts(group.walls, [...group.doors.values()], streetScore);
      for (const {wall, doors, shop} of faces) {
        const n = [wall.nx, 0, wall.nz];
        const at = (u, y, depth) => [wall.a[0] + wall.dx*u + wall.nx*depth, y, wall.a[1] + wall.dz*u + wall.nz*depth];
        const height = Math.min(3.0, wall.height - 0.03);
        function panel(lo, hi, bottom, top, tile) {
          // Half-texel inset keeps the other atlas tiles out of the window frames.
          const u0 = (tile*128 + 1)/512, u1 = ((tile+1)*128 - 1)/512;
          quad3(panels, at(lo,bottom,0.038), at(hi,bottom,0.038), at(hi,top,0.038), at(lo,top,0.038),
            n, white, false, [[u0,0.01],[u1,0.01],[u1,0.99],[u0,0.99]]);
        }
        if (shop) {
          quad3(PB, at(0,0.02,0.02), at(wall.length,0.02,0.02), at(wall.length,height,0.02), at(0,height,0.02), n, wall.color);
          const bays = shopBays(wall.length, doors);
          if (bays.length) {
            const litBay = Math.abs(building.id || 0) % Math.min(3, bays.length);
            bays.forEach(([lo, hi], i) => panel(lo, hi, 0.25, height - 0.26, i % 3 === litBay ? 3 : 2));
          }
          const color = awningColors[Math.abs(building.id || 0) % awningColors.length];
          const w = wall.length;
          quad3(PB, at(0,height,0.02), at(w,height,0.02), at(w,height-0.12,0.6), at(0,height-0.12,0.6), [0,1,0], color);
          quad3(PB, at(0,height-0.25,0.6), at(w,height-0.25,0.6), at(w,height-0.12,0.6), at(0,height-0.12,0.6), n, color);
        }
        for (const door of doors) panel(door-0.55, door+0.55, 0.03, Math.min(2.3, shop ? height-0.26 : height), shop ? 1 : 0);
      }
    }
    let frontMat;
    if (panels.p.length) {
      const atlas = emission => makeTex(512, 128, ctx => facadeAtlas(ctx, emission));
      frontMat = new THREE.MeshStandardMaterial({ map: atlas(false), emissiveMap: atlas(true), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55 });
      mkMesh(panels, frontMat, true, false).name = 'ground_floor_frontages';
    }
    return frontMat;
  }
  return { collect: collectFronts, render };
}

// Photo surfaces from textures/, loaded once each: a 512 px canvas levelled to an average of 0.8 (see levelPhoto).
const photos = new Map();
function photo(key) {
  if (!photos.has(key)) photos.set(key, new Promise((ok, no) => {
    const [file, , contrast] = SURFACES[key], img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 512, 512); const im = x.getImageData(0, 0, 512, 512); levelPhoto(im.data, 0.8, contrast); x.putImageData(im, 0, 0); ok(c); };
    img.onerror = no; img.src = new URL('./textures/' + file + '.jpg', import.meta.url).href;
  }));
  return photos.get(key);
}
const mipmapped = t => { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; };

// One material for every wall. uv = (window bays, storeys), attribute facade = [style, storey above the top one]. The shader
// draws the style's atlas cell (ground floor or upper) in every bay and storey; the atlas alpha says what is wall (1), trim
// (½) and glass (0). Wall areas take the building colour and the style's photo surface, laid in metres along the wall;
// glass reflects and, by emissiveIntensity (set by the time of day), a random share of the windows lights up.
function facadeMaterial() {
  const C = FACADES.length, W = C * ATLAS_CELL, H = 2 * ATLAS_CELL, S = 512, L = WALL_SURFACES.length;
  const paint = layer => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); wallAtlas(x, layer); return x.getImageData(0, 0, W, H).data; };
  const col = paint('color'), mask = paint('mask'), px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // data row 0 is v = 0, the canvas bottom
    const i = (y * W + x) * 4, o = ((H - 1 - y) * W + x) * 4;
    px[o] = col[i]; px[o + 1] = col[i + 1]; px[o + 2] = col[i + 2]; px[o + 3] = 255 - (mask[i] + mask[i + 1]) / 2;
  }
  const atlas = mipmapped(new THREE.DataTexture(px, W, H));
  const surf = mipmapped(new THREE.DataArrayTexture(new Uint8Array(S * S * 4 * L).fill(204), S, S, L)); // plain grey until the photos arrive
  surf.wrapS = surf.wrapT = THREE.RepeatWrapping;
  WALL_SURFACES.forEach((key, i) => photo(key).then(c => { surf.image.data.set(c.getContext('2d').getImageData(0, 0, S, S).data, i * S * S * 4); surf.needsUpdate = true; }, () => { }));
  const list = a => 'float[](' + a.map(v => v.toFixed(3)).join(', ') + ')';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, emissive: 0xffffff, emissiveIntensity: 0 });
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, { facadeAtlas: { value: atlas }, facadeSurf: { value: surf } });
    const tables = `const float fLit[${C}] = ${list(FACADES.map(f => f[3]))}, fLayer[${C}] = ${list(FACADES.map(f => f[4]))}, fMetres[${L}] = ${list(WALL_SURFACES.map(k => SURFACES[k][1]))};`;
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\nattribute vec2 facade;\nvarying vec2 vFacUv, vFac;\nvarying vec3 vSurf;\nvarying float vLit;\n${tables}`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
vFacUv = uv; vFac = facade; int fStyle = int(facade.x + 0.5); float fL = fLayer[fStyle]; vLit = fLit[fStyle];
vSurf = vec3(vec2(dot(position.xz, vec2(-normal.z, normal.x)), position.y) / fMetres[int(fL)], fL); // metres along the wall and up`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D facadeAtlas;
uniform highp sampler2DArray facadeSurf;
varying vec2 vFacUv, vFac;
varying vec3 vSurf;
varying float vLit;
float fHash(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`)
      .replace('#include <map_fragment>', `
float fStorey = floor(vFacUv.y), fCol = fStorey > vFac.y - 0.5 ? ${FACADE.blank}.0 : vFac.x; // above the top storey: parapet or gable
vec2 fScale = vec2(${1 / C}, 0.5), fUv = (vec2(fCol, fStorey < 0.5 ? 0.0 : 1.0) + clamp(fract(vFacUv), 0.002, 0.998)) * fScale;
vec4 fTex = textureGrad(facadeAtlas, fUv, dFdx(vFacUv) * fScale, dFdy(vFacUv) * fScale); // mip level from the unwrapped uv, so cell edges don't flicker
float fWall = clamp(2.0 * fTex.a - 1.0, 0.0, 1.0), fGlass = clamp(1.0 - 2.0 * fTex.a, 0.0, 1.0);
float fWin = fHash(floor(vFacUv) + vec2(vFac.x * 31.0, 7.0)); // one random number per window
vec3 fSurf = texture(facadeSurf, vSurf).rgb * 1.6; // the photos average 0.8, about 0.62 linear
diffuseColor.rgb *= fTex.rgb * mix(vec3(1.0 + (fWin - 0.5) * 0.6 * fGlass), fSurf, fWall); // curtains behind some windows`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, fWall);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, fGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.25, fGlass);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= step(fWin, vLit) * fGlass * mix(vec3(1.0, 0.68, 0.38), vec3(0.72, 0.84, 1.0), step(0.82, fract(fWin * 7.31))) * (0.35 + 0.4 * fract(fWin * 3.17)) * (0.75 + 0.35 * fract(vFacUv.y));');
  };
  return mat;
}
// a roof texture (uv in metres), plain grey until its photo arrives
function roofTex(key) {
  const t = makeTex(512, 512, x => { x.fillStyle = '#ccc'; x.fillRect(0, 0, 512, 512); }), m = SURFACES[key][1];
  t.repeat.set(1 / m, 1 / m); t.anisotropy = 4; photo(key).then(c => { t.image = c; t.needsUpdate = true; }, () => { });
  return t;
}

// polys: parsed OSM areas (buildings and building:parts are used); entranceNodes: 'x,z' keys of mapped entrances.
// roadAt finds the street a wall faces; mkMesh(buffer, material, uv, castShadow) adds a mesh to the scene.
export function buildBuildings(polys, entranceNodes, roadAt, mkMesh) {
  const bPolys = polys.filter(p => p.kind === 'building' || p.kind === 'part');
  // outlines with building:part pieces inside are drawn as those parts only (OSM simple 3D buildings)
  const {hidden, parentOutline} = findBuildingParts(bPolys);
  // how mappers here tag roofs decides whether untagged houses get pitched or flat roofs
  let nFlat = 0, nPitch = 0; for (const b of bPolys) { const s = b.t['roof:shape']; if (s) s === 'flat' ? nFlat++ : nPitch++; }
  const flatShare = (nFlat + 1) / (nFlat + nPitch + 2), UP = [0, 1, 0];
  const WB = { p: [], n: [], uv: [], c: [], f: [] }, PB = { p: [], n: [], c: [] }, blds = [];
  const RF = { p: [], n: [], uv: [], c: [] }, RT = { p: [], n: [], uv: [], c: [] }, RM = { p: [], n: [], uv: [], c: [] }; // flat, tiled and metal roofs
  const roofF = (pl, p) => { let m = 1e9; for (const P of pl) { const f = P[0] + P[1] * p[0] + P[2] * p[1]; if (f < m) m = f; } return Math.max(0, m); };
  const flatTri = (B, A, Bv, C, y, col) => tri3(B, [A[0], y, A[1]], [Bv[0], y, Bv[1]], [C[0], y, C[1]], UP, col, false, [A, Bv, C]);
  // walls carry uv = (window bays, storeys) and facade = [style, top storey]; see facadeMaterial
  function wallRing(r, k, y0, eave, pl, col, fac) { // k = ±1 so that k*(dz, -dx) points out of the building
    const U = bayCoords(r, FACADES[fac.style][2], fac.u), v = y => (y - y0) / fac.floorH + fac.v0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-3) continue;
      const n = [k * dz / L, 0, -k * dx / L], ts = [0, 1], [ua, ub] = U[i];
      const wallQuad = (p, q, ya0, yb0, ya1, yb1, u0, u1) => {
        const c = WB.p.length; quad3(WB, [p[0], ya0, p[1]], [q[0], yb0, q[1]], [q[0], yb1, q[1]], [p[0], ya1, p[1]], n, col, true, [[u0, v(ya0)], [u1, v(yb0)], [u1, v(yb1)], [u0, v(ya1)]]);
        for (let j = c; j < WB.p.length; j += 3) WB.f.push(fac.style, fac.top);
      };
      if (pl) for (let p = 0; p < pl.length; p++) for (let q = p + 1; q < pl.length; q++) { // where the roof line along this wall bends
        const A = pl[p], C = pl[q], ga = A[0] - C[0] + (A[1] - C[1]) * a[0] + (A[2] - C[2]) * a[1], gb = A[0] - C[0] + (A[1] - C[1]) * b[0] + (A[2] - C[2]) * b[1];
        if ((ga > 0) !== (gb > 0)) ts.push(ga / (ga - gb));
      }
      ts.sort((x, y) => x - y);
      for (let j = 0; j < ts.length - 1; j++) {
        if (ts[j + 1] - ts[j] < 1e-6) continue;
        const p0 = [a[0] + dx * ts[j], a[1] + dz * ts[j]], p1 = [a[0] + dx * ts[j + 1], a[1] + dz * ts[j + 1]], u0 = ua + (ub - ua) * ts[j], u1 = ua + (ub - ua) * ts[j + 1];
        if (eave > y0 + 0.01) wallQuad(p0, p1, y0, y0, eave, eave, u0, u1);
        if (pl) { const h0 = eave + roofF(pl, p0), h1 = eave + roofF(pl, p1); if (h0 > eave + 0.01 || h1 > eave + 0.01) wallQuad(p0, p1, eave, eave, h0, h1, u0, u1); }
      }
    }
  }
  function parapet(r, out, y0, y1, col) { // r: an outline (out = 1) or a courtyard (out = -1); the coping overhangs the wall a little
    const lip = offsetRing(r, out * 0.05), inn = offsetRing(r, -out * 0.28), cap = col.clone().lerp(CAP, 0.6), side = col.clone().multiplyScalar(0.78);
    for (let i = 0; i < r.length; i++) {
      const j = (i + 1) % r.length, a = inn[i], b = inn[j], c = lip[i], d = lip[j], ox = c[0] + d[0] - a[0] - b[0], oz = c[1] + d[1] - a[1] - b[1], l = Math.hypot(ox, oz);
      if (l < 1e-6 || Math.hypot(r[j][0] - r[i][0], r[j][1] - r[i][1]) < 1e-3) continue;
      const o = [ox / l, 0, oz / l];
      quad3(PB, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [-o[0], 0, -o[2]], side);
      quad3(PB, [a[0], y1, a[1]], [b[0], y1, b[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], UP, cap);
      quad3(PB, [c[0], y1 - 0.12, c[1]], [d[0], y1 - 0.12, d[1]], [d[0], y1, d[1]], [c[0], y1, c[1]], o, cap);
    }
  }
  function roofPlanes(o, shape, H, dir, rnd) { // planes [a, b, c]: roof height above the eaves = min(a + b*x + c*z)
    const { cx, cz, ux, uz, hl, hw } = o, vx = -uz, vz = ux;
    const pl = (nx, nz, half, k) => [k * (nx * cx + nz * cz + half), -k * nx, -k * nz]; // rises with slope k from the box side facing (nx, nz)
    if (shape === 'gabled') return o.across ? [pl(ux, uz, hl, H / hl), pl(-ux, -uz, hl, H / hl)] : [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw)];
    if (shape === 'hipped') return [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw), pl(ux, uz, hl, H / hw), pl(-ux, -uz, hl, H / hw)];
    if (shape === 'pyramidal') return [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw), pl(ux, uz, hl, H / hl), pl(-ux, -uz, hl, H / hl)];
    const S = [[vx, vz, hw], [-vx, -vz, hw], [ux, uz, hl], [-ux, -uz, hl]]; // skillion: low edge on the side roof:direction faces
    let s = S[rnd() < 0.5 ? 0 : 1]; const a = COMPASS[String(dir || '').toUpperCase()] ?? parseFloat(dir);
    if (isFinite(a)) { const dx = Math.sin(a * Math.PI / 180), dz = -Math.cos(a * Math.PI / 180); s = S.reduce((m, q) => q[0] * dx + q[1] * dz > m[0] * dx + m[1] * dz ? q : m); }
    return [pl(s[0], s[1], s[2], H / (2 * s[2]))];
  }
  function dome(o, eave, H, onion, col) {
    const { cx, cz, ux, uz, hl, hw } = o, N = 20, R = onion ? 9 : 7, ring = [];
    for (let r = 0; r <= R; r++) {
      const h = r / R, rho = Math.sqrt(Math.max(0, 1 - h * h)) * (onion ? 1 + 1.4 * h * (1 - h) : 1), pts = [];
      for (let s = 0; s < N; s++) { const a = s / N * Math.PI * 2, lu = Math.cos(a) * hl * rho, lv = Math.sin(a) * hw * rho; pts.push([cx + lu * ux - lv * uz, eave + h * H, cz + lu * uz + lv * ux]); }
      ring.push(pts);
    }
    for (let r = 0; r < R; r++) for (let s = 0; s < N; s++) {
      const a = ring[r][s], b = ring[r][(s + 1) % N], c = ring[r + 1][(s + 1) % N], d = ring[r + 1][s];
      const e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], f = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      let n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]]; const l = Math.hypot(...n); if (l < 1e-9) continue;
      const out = (a[0] - cx) * n[0] + (a[1] - eave) * n[1] + (a[2] - cz) * n[2] < 0 ? -1 : 1; n = n.map(v => v * out / l);
      quad3(RF, a, b, c, d, n, col);
    }
  }
  const frontages = createFrontages(entranceNodes, hidden, parentOutline, roadAt);
  for (const b of bPolys) {
    if (hidden.has(b)) continue;
    const t = b.t, rnd = seeded(b.id || b.outer[0][0] * 1000 + b.outer[0][1]), pick = a => a[Math.floor(rnd() * a.length)];
    const outer = openRing(b.outer), holes = b.holes.map(openRing).filter(h => h.length >= 3);
    if (outer.length < 3) continue;
    const area = Math.abs(signedArea(outer)); if (area < 1) continue;
    const bp = t['building:part'], type = t.building && t.building !== 'yes' ? t.building : bp && bp !== 'yes' ? bp : b.kind === 'part' ? 'part' : 'yes';
    const lv = num(t['building:levels']), H = num(t.height), minH = num(t.min_height) || num(t['building:min_level']) * 3.1 || (type === 'roof' ? 3 : 0);
    let shape = ROOF_SHAPE[t['roof:shape']] || 'auto', o = null, roofH = 0;
    const tagged = shape !== 'auto';
    if (!tagged) shape = b.kind === 'building' && !H && lv <= 4 && area < 600 && ((HOUSE_T.has(type) && flatShare < 0.75) || (['yes', 'residential'].includes(type) && area < 220 && lv <= 3 && flatShare < 0.55)) ? (rnd() < 0.55 ? 'gabled' : 'hipped') : 'flat';
    if (shape !== 'flat') {
      o = holes.length || outer.length > 80 ? null : obb(outer);
      if (!o || area / o.ar < (tagged ? 0.62 : 0.78) || o.hw < 1 || (!tagged && o.hw > 9)) shape = 'flat';
    }
    if (shape !== 'flat') {
      o.across = shape === 'gabled' && t['roof:orientation'] === 'across';
      const span = o.across ? o.hl : o.hw, ang = num(t['roof:angle']) || (span > 9 ? 18 + rnd() * 8 : 30 + rnd() * 12);
      roofH = num(t['roof:height']) || num(t['roof:levels']) * 2.6 || (shape === 'skillion' ? span * 0.4 : shape === 'dome' ? span : shape === 'onion' ? span * 1.9 : span * Math.tan(ang * Math.PI / 180));
      roofH = Math.min(roofH, shape === 'dome' || shape === 'onion' ? 60 : 16);
    }
    let eave;
    if (H) { eave = H - roofH; if (eave < minH + 1.5) { roofH = Math.max(0, H - minH - 1.5); eave = H - roofH; } }
    else if (lv) eave = lv * 3.1 + (minH ? 0 : 0.5) + (shape === 'flat' ? num(t['roof:levels']) * 1.6 : 0);
    else eave = bDefaultH(type, rnd) * (shape === 'flat' ? 1 : 0.72);
    eave = Math.max(eave, minH + (shape === 'flat' ? 0.5 : 1.5));
    if (roofH < 0.3) shape = 'flat';
    const style = area < 12 ? FACADE.blank : facadeStyle(t, type, eave + roofH, rnd), rm = String(t['roof:material'] || '').toLowerCase(), metal = METAL_R.has(rm) || (!rm && rnd() < 0.3);
    const wc = tagColor(t['building:colour']) || matColor(WALL_MAT, t['building:material']) || new THREE.Color(pick(WALLS[style]));
    const rc = tagColor(t['roof:colour']) || matColor(ROOF_MAT, rm) || new THREE.Color(pick(shape === 'dome' || shape === 'onion' ? DOMES : shape === 'flat' ? ROOFS : metal ? METALS : TILES));
    const para = shape !== 'flat' ? 0 : eave - minH < 4 ? 0.2 : style === FACADE.glass ? 1.1 : 0.45 + rnd() * 0.5; // parapet, inside the building's height
    const v0 = minH > 0 ? 1 : 0, { floors, floorH } = floorGrid(style, eave - para, minH, lv), k = signedArea(outer) > 0 ? 1 : -1;
    const fac = { style, floorH, v0, top: v0 + floors, u: Math.floor(rnd() * 400) }; // u: a different run of lit windows per building
    if (shape === 'flat') {
      wallRing(outer, k, minH, eave, null, wc, fac);
      for (const h of holes) wallRing(h, signedArea(h) > 0 ? -1 : 1, minH, eave, null, wc, fac);
      eachTri(outer, holes, (A, B, C) => flatTri(RF, A, B, C, eave - para, rc));
      parapet(outer, 1, eave - para, eave, wc); for (const h of holes) parapet(h, -1, eave - para, eave, wc);
    } else if (shape === 'dome' || shape === 'onion') {
      wallRing(outer, k, minH, eave, null, wc, fac);
      eachTri(outer, [], (A, B, C) => flatTri(RF, A, B, C, eave, rc));
      dome(o, eave, roofH, shape === 'onion', rc);
    } else {
      const pl = roofPlanes(o, shape, roofH, t['roof:direction'], rnd), RB = metal ? RM : RT, under = rc.clone().multiplyScalar(0.35), wide = offsetRing(outer, 0.45); // eaves and verges overhang the walls
      wallRing(outer, k, minH, eave, pl, wc, fac);
      for (let i = 0; i < pl.length; i++) {
        let poly = wide;
        for (let j = 0; j < pl.length && poly.length >= 3; j++) if (j !== i) poly = clipHalf(poly, pl[i][0] - pl[j][0], pl[i][1] - pl[j][1], pl[i][2] - pl[j][2]);
        if (poly.length < 3) continue;
        // uv in metres: u along the eaves, v up the slope
        const P = pl[i], l = Math.hypot(P[1], 1, P[2]), n = [-P[1] / l, 1 / l, -P[2] / l], down = n.map(x => -x), g = Math.hypot(P[1], P[2]) || 1, s = Math.hypot(1, g);
        const lift = p => [p[0], eave + P[0] + P[1] * p[0] + P[2] * p[1], p[1]], uv = p => [(P[1] * p[1] - P[2] * p[0]) / g, (P[1] * p[0] + P[2] * p[1]) / g * s];
        eachTri(poly, [], (A, B, C) => tri3(RB, lift(A), lift(B), lift(C), n, rc, false, [uv(A), uv(B), uv(C)]));
        for (let e = 0; e < outer.length; e++) { // the underside only where it overhangs, beyond each wall: the rest is never seen
          const a = outer[e], b = outer[(e + 1) % outer.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-3) continue;
          const nx = k * dz / L, nz = -k * dx / L, strip = clipHalf(poly, a[0] * nx + a[1] * nz, -nx, -nz);
          if (strip.length >= 3) eachTri(strip, [], (A, B, C) => tri3(RB, lift(A), lift(B), lift(C), down, under));
        }
      }
    }
    if (minH === 0 && eave >= 2.15 && type !== 'roof' && t.location !== 'underground') {
      frontages.collect(b, outer, holes, eave, type, wc);
    }
    blds.push({ outer: b.outer, holes: b.holes, h: eave + roofH, minH, ...bbox(b.outer) });
  }
  const frontMat = frontages.render(PB, mkMesh);
  const wallMat = facadeMaterial();
  if (WB.p.length) mkMesh(WB, wallMat, true).geometry.setAttribute('facade', new THREE.Float32BufferAttribute(WB.f, 2));
  if (PB.p.length) mkMesh(PB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), false);
  for (const [B, key] of [[RF, 'gravel'], [RT, 'tiles'], [RM, 'metal']]) if (B.p.length) mkMesh(B, new THREE.MeshStandardMaterial({ map: roofTex(key), vertexColors: true, roughness: B === RM ? 0.55 : 0.9, metalness: B === RM ? 0.35 : 0 }), true);
  const BG = 20, bgrid = new Map();
  blds.forEach((b, i) => { for (let ix = Math.floor(b.x0 / BG); ix <= Math.floor(b.x1 / BG); ix++) for (let iz = Math.floor(b.z0 / BG); iz <= Math.floor(b.z1 / BG); iz++) { const k = gkey(ix, iz); let L = bgrid.get(k); if (!L) bgrid.set(k, L = []); L.push(i); } });
  function inBuilding(x, z, y) {
    const L = bgrid.get(gkey(Math.floor(x / BG), Math.floor(z / BG))); if (!L) return false;
    for (const i of L) { const b = blds[i]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || b.h < y || b.minH > y) continue; if (inPoly(x, z, b.outer) && !b.holes.some(h => inPoly(x, z, h))) return true; }
    return false;
  }
  return { blds, inBuilding, frontMat, wallMat };
}
