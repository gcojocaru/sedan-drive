// The 3D world built from a place's OpenStreetMap elements: ground layers, sea, roads and markings, crossings, railways,
// walls and fences, buildings, trees and street lamps, plus the lookups the game drives on (roadAt, areaAt, inBuilding).
import * as THREE from 'three';
import { same, joinRings, inPoly, polyArea, bbox, seeded, newBuf, tri, quad, disc, ribbon, offsetLine, cumLen, densify, runs, openRing, signedArea, obb, clipHalf, tri3, quad3, wallStrip, fenceStrip, seaPolys, gkey, segDist } from './geom.js';
import { facadeWalls, onOutline, planFronts, shopBays, isRetail, facadeAtlas } from './building-fronts.js';
import { drivingSide, prepareRoads, mappedStops } from './road-layout.js';
import { HALF } from './osm-query.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function eachTri(outer, holes, cb) {
  const o = outer.map(p => new THREE.Vector2(p[0], p[1])), hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  let f; try { f = THREE.ShapeUtils.triangulateShape(o, hs); } catch { return; }
  const all = o.concat(...hs);
  for (const [i, j, k] of f) cb([all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]);
}
function fillPoly(B, outer, holes, y) { eachTri(outer, holes, (a, b, c) => tri(B, a, b, c, y)); }
function innerPt(r) { // a point inside the ring (centroid, or the middle of its largest triangle)
  let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } x /= r.length; z /= r.length;
  if (inPoly(x, z, r)) return [x, z];
  let best = r[0], ba = -1;
  eachTri(openRing(r), [], (a, b, c) => { const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])); if (ar > ba) { ba = ar; best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; } });
  return best;
}
function flatMesh(B, mat, uvScale) {
  const g = new THREE.BufferGeometry(), n = B.p.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  const nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; uv[i * 2] = B.p[i * 3] / uvScale; uv[i * 2 + 1] = B.p[i * 3 + 2] / uvScale; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
export function makeTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function speckle(x, w, h, n, amt, size = 2) {
  for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amt; x.fillStyle = v > 0 ? 'rgba(255,255,255,' + v + ')' : 'rgba(0,0,0,' + -v + ')'; x.fillRect(Math.random() * w, Math.random() * h, size, size); }
}

const LANDUSE = { residential: 'resid', religious: 'resid', commercial: 'urban', retail: 'urban', industrial: 'indus', railway: 'indus', military: 'indus', construction: 'bare', brownfield: 'bare', garages: 'parking' };
function areaKind(t) {
  if (t.building && t.building !== 'no') return 'building';
  if (t['building:part'] && t['building:part'] !== 'no') return 'part';
  if (t.highway) return t.area === 'yes' ? 'paving' : null;
  if (t.amenity === 'parking') return ['underground', 'multi-storey', 'rooftop'].includes(t.parking) ? null : 'parking';
  if (t.amenity === 'marketplace' || t.railway === 'platform' || t.man_made === 'pier') return 'paving';
  if (t.man_made === 'breakwater' || t.man_made === 'groyne' || t.natural === 'bare_rock' || t.natural === 'scree') return 'rock';
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) return 'water';
  if (t.natural === 'tree_row' || t.natural === 'coastline' || t.waterway || t.railway) return null;
  if (LANDUSE[t.landuse]) return LANDUSE[t.landuse];
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.leisure === 'pitch' || t.leisure === 'golf_course') return 'pitch';
  if (t.natural === 'beach' || t.natural === 'sand' || t.leisure === 'playground') return 'sand';
  if (['farmland', 'vineyard', 'allotments', 'orchard'].includes(t.landuse)) return 'farm';
  if (['scrub', 'heath', 'wetland'].includes(t.natural)) return 'scrub';
  if (t.leisure || t.landuse || t.natural) return 'park';
  return null;
}
const ROAD = { motorway: 15, trunk: 13, primary: 11, secondary: 10, tertiary: 9, unclassified: 7, residential: 7, living_street: 6, service: 4.6, road: 7, busway: 7, raceway: 10, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
const PATH = { footway: 2.4, cycleway: 2.2, pedestrian: 6, steps: 2, path: 1.8, track: 3.2, bridleway: 2 };
const DIRT = new Set(['path', 'track', 'bridleway']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const SIDEWALK = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'road', 'primary_link', 'secondary_link', 'tertiary_link']);
export const TYPE_LABEL = { motorway: 'Motorway', trunk: 'Main road', primary: 'Main road', secondary: 'Main road', tertiary: 'Road', unclassified: 'Road', residential: 'Residential street', living_street: 'Living street', service: 'Service road', footway: 'Footpath', cycleway: 'Cycle path', pedestrian: 'Pedestrian street', steps: 'Steps', path: 'Path', track: 'Track', bridleway: 'Bridleway', pier: 'Pier' };
const num = v => { const f = parseFloat(v); return f > 0 && f < 1000 ? f : 0; };
function bDefaultH(type, r) { // typical total height (m) when a building has no height or level tags
  const d = { house: 7, detached: 7.5, semidetached_house: 8, terrace: 9, residential: 10, apartments: 16, bungalow: 4.5, garage: 3, garages: 3, carport: 2.6, shed: 2.8, hut: 3, cabin: 3.5, commercial: 12, retail: 7, supermarket: 7, industrial: 9, warehouse: 9, office: 18, school: 10, university: 14, hospital: 18, church: 15, cathedral: 30, hotel: 20, train_station: 12, kiosk: 3, service: 3.5, static_caravan: 3, roof: 4, farm: 7, barn: 7, farm_auxiliary: 5 };
  return (d[type] || 8) * (0.85 + r() * 0.35);
}
// roof:shape → the shapes we can build; anything else falls back to the house/flat defaults
const ROOF_SHAPE = { flat: 'flat', gabled: 'gabled', gambrel: 'gabled', side_mansard: 'gabled', saltbox: 'gabled', round: 'gabled', hipped: 'hipped', 'half-hipped': 'hipped', side_hipped: 'hipped', mansard: 'hipped', quadruple_saltbox: 'hipped', pyramidal: 'pyramidal', cone: 'pyramidal', skillion: 'skillion', sloped: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'onion' };
const HOUSE_T = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'farm_auxiliary', 'barn', 'cabin', 'hut', 'villa', 'chapel', 'stable', 'cowshed', 'shed', 'static_caravan', 'allotment_house']);
const PLAIN_T = new Set(['garage', 'garages', 'shed', 'carport', 'hut', 'roof', 'service', 'storage_tank', 'silo', 'barn', 'farm_auxiliary', 'cowshed', 'stable', 'bunker', 'transformer_tower', 'greenhouse', 'ruins', 'column', 'steps']);
const WALLS = ['#e4ddd0', '#d8cfc0', '#cbbfae', '#b59c82', '#a9725c', '#c4b39b', '#ddd6cb', '#9f948a', '#e8e2d6', '#b8866a', '#d2c6b0'];
const ROOFS = ['#5f5c58', '#6e6a64', '#4f4d4b'], PITCHED = ['#9c4f34', '#8b5a44', '#a5603f', '#7a5040', '#55585d', '#45484d', '#8f4a36'], DOMES = ['#6f9a86', '#7d8287', '#a58a4e'];
const WALL_MAT = { brick: '#9c5a44', stone: '#b9ae9a', sandstone: '#c9a77e', concrete: '#bdbab2', glass: '#7f97a8', wood: '#9a7a55', timber_framing: '#e0d6c2', metal: '#a3a7aa', plaster: '#ddd5c6', limestone: '#d8d0bd' };
const ROOF_MAT = { roof_tiles: '#a0553a', tile: '#a0553a', tiles: '#a0553a', slate: '#4c5059', metal: '#7b8287', metal_sheet: '#7b8287', copper: '#6f9a86', concrete: '#8e8c87', tar_paper: '#3f3f42', asphalt: '#3f3f42', glass: '#8fa7b8', thatch: '#8a7448', grass: '#6f8d4a', gravel: '#9a958c', wood: '#6b5038', stone: '#8e877c', eternit: '#7d7d78' };
const matColor = (tab, v) => v && tab[v.toLowerCase()] ? new THREE.Color(tab[v.toLowerCase()]) : null;
const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
function tagColor(s) {
  if (!s) return null; s = s.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(s) || /^#?[0-9a-f]{3}$/.test(s)) return new THREE.Color(s[0] === '#' ? s : '#' + s);
  if (s in THREE.Color.NAMES) return new THREE.Color(THREE.Color.NAMES[s]);
  return null;
}

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

function indexCorners(corners, RG) {
  const cornerGrid = new Map();
  for (const {poly} of corners) {
    const bounds = bbox(poly);
    for (let i = Math.floor(bounds.x0/RG); i <= Math.floor(bounds.x1/RG); i++) {
      for (let j = Math.floor(bounds.z0/RG); j <= Math.floor(bounds.z1/RG); j++) {
        const key = gkey(i,j);
        if (!cornerGrid.has(key)) cornerGrid.set(key, []);
        cornerGrid.get(key).push(poly);
      }
    }
  }
  return cornerGrid;
}

function drawLaneMarkings(roads, dashLine) {
  // lane markings: centre line (solid double on 4+ lanes), edge lines on main roads, lane dividers from lanes=*
  for (const r of roads) {
    if (r.hw * 2 < 6.4 || r.type === 'service' || r.type === 'living_street') continue;
    const { edge, total, dividers } = r.lanes;
    for (const line of r.markSections) {
      const cum = cumLen(line);
      const paint = (off, solid, width) => dashLine(line, cum, off, solid ? 4 : 3, solid ? 0 : 6, width, () => true);
      if (MAJOR.has(r.type)) { paint(edge, true, 0.14); paint(-edge, true, 0.14); }
      for (const {offset, boundary} of dividers) {
        if (boundary && total >= 4) {
          paint(offset - 0.12, true, 0.12);
          paint(offset + 0.12, true, 0.12);
        } else paint(offset, false, boundary ? 0.14 : 0.12);
      }
    }
  }
}

export const HARD = ['parking', 'paving']; // ground the car keeps its road speed on

// elements: an Overpass reply's elements; (lat0, lon0) becomes the origin. say(text) shows progress and waits for a repaint.
export async function buildWorld(elements, lat0, lon0, scene, say) {
  const cosL = Math.cos(lat0 * Math.PI / 180), KX = 111320 * cosL, KZ = 110574;
  const P = (lat, lon) => [(lon - lon0) * KX, -(lat - lat0) * KZ];
  await say('Building the streets…');
  const lines = [], polys = [], treePts = [], crossPts = [], stopNodes = [];
  const entranceNodes = new Set();
  for (const el of elements) {
    if (el.type === 'node') {
      const tags = el.tags || {}, p = P(el.lat, el.lon);
      const entrance = tags.entrance || (tags.building === 'entrance' ? 'yes' : '');
      if (entrance && entrance !== 'no' && (!tags.level || tags.level.split(';').some(level => Number(level) === 0))) {
        entranceNodes.add(p.join(','));
      }
      if (tags.highway === 'stop') stopNodes.push({ id: el.id, p, tags });
      else if (tags.highway === 'crossing' && tags['crossing:markings'] !== 'no') crossPts.push(p);
      else if (tags.natural === 'tree') treePts.push(p);
      continue;
    }
    const t = el.tags || {}, kind = areaKind(t);
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 2) continue;
      const g = el.geometry.map(p => P(p.lat, p.lon)), closed = g.length > 3 && same(g[0], g[g.length - 1]);
      if (kind && closed) polys.push({ kind, outer: g, holes: [], t, id: el.id });
      else lines.push({ t, g, nodes: el.nodes });
    } else if (el.type === 'relation' && kind) {
      const outs = [], ins = [];
      for (const m of el.members || []) { if (m.type !== 'way' || !m.geometry) continue; const g = m.geometry.filter(Boolean).map(p => P(p.lat, p.lon)); if (g.length > 1) (m.role === 'inner' ? ins : outs).push(g); }
      const I = joinRings(ins);
      for (const o of joinRings(outs)) polys.push({ kind, outer: o, holes: I.filter(h => inPoly(h[0][0], h[0][1], o)), t, id: el.id });
    }
  }

  // ---- textures & materials ----
  const noise = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#dcdcdc'; x.fillRect(0, 0, w, h); speckle(x, w, h, 40000, 0.3); });
  const asphalt = makeTex(512, 512, (x, w, h) => { x.fillStyle = '#4b4c4f'; x.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,' + (0.04 + Math.random() * 0.06) + ')'; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 20 + Math.random() * 50, Math.random() * 3, 0, Math.PI * 2); x.fill(); } speckle(x, w, h, 80000, 0.24); });
  const slabs = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#bdbab2'; x.fillRect(0, 0, w, h); speckle(x, w, h, 16000, 0.14); x.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < w; i += 64) { x.fillRect(i, 0, 2, h); x.fillRect(0, i, w, 2); } });
  const layer = (map, color, y, extra = {}) => new THREE.MeshStandardMaterial({ map, color, roughness: 1, side: THREE.DoubleSide, ...extra });
  // [material, height]: flat layers are stacked a couple of millimetres apart so later ones win where they overlap
  const LAYERS = {
    resid: [layer(noise, '#8b9d63'), 0.004], urban: [layer(noise, '#b3afa6'), 0.005], indus: [layer(noise, '#aaa79f'), 0.006], bare: [layer(noise, '#ad9f84'), 0.008],
    farm: [layer(noise, '#b3a774'), 0.01], sand: [layer(noise, '#d8c99c'), 0.012], park: [layer(noise, '#6f9448'), 0.014],
    scrub: [layer(noise, '#7d8d52'), 0.016], forest: [layer(noise, '#55763a'), 0.018], pitch: [layer(noise, '#5e9a4c'), 0.02],
    water: [new THREE.MeshStandardMaterial({ color: '#33607a', roughness: 0.06, metalness: 0.15, side: THREE.DoubleSide }), 0.024],
    rock: [layer(noise, '#9a958c'), 0.028], paving: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.03], parking: [layer(asphalt, '#dcdcda', 0, { roughness: 0.9 }), 0.032],
    dirt: [layer(noise, '#b5a586'), 0.034], paved: [layer(slabs, '#f2f0ea', 0, { roughness: 0.95 }), 0.036],
    ballast: [layer(noise, '#968e83'), 0.038], sleeper: [layer(null, '#6e665d', 0, { roughness: 0.9 }), 0.039],
    sidewalk: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.04], road: [layer(asphalt, '#ffffff', 0, { roughness: 0.88 }), 0.05],
    marks: [new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.55, side: THREE.DoubleSide }), 0.058],
    rail: [new THREE.MeshStandardMaterial({ color: '#a4a7ad', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }), 0.062]
  };
  const BUF = Object.fromEntries(Object.keys(LAYERS).map(k => [k, newBuf()]));
  // the base ground sits a few cm below the flat layers and is tiled, so it can't win the depth test against them far away
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 50, 50), new THREE.MeshStandardMaterial({ map: noise, color: '#8a9468', roughness: 1 }));
  ground.material.map = noise.clone(); ground.material.map.repeat.set(1600, 1600); ground.material.map.needsUpdate = true;
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);

  // ---- area fills ----
  for (const p of polys) if (LAYERS[p.kind]) fillPoly(BUF[p.kind], p.outer, p.holes, LAYERS[p.kind][1]);

  // ---- roads ----
  const roads = [], paths = [], rivers = [], rows = [], rails = [], barriers = [], coast = [];
  for (const { t, g, nodes } of lines) {
    if (t.railway && t.railway !== 'platform' && !(t.tunnel && t.tunnel !== 'no')) rails.push({ g, t, tram: t.railway === 'tram' });
    if (t.barrier) barriers.push({ g, t });
    else if (t.natural === 'coastline') coast.push(g);
    else if (t.man_made === 'pier') paths.push({ g, hw: (num(t.width) || 3) / 2, t, type: 'pier', name: t.name || '', drive: false });
    else if (t.man_made === 'breakwater' || t.man_made === 'groyne') ribbon(BUF.rock, g, (num(t.width) || 4) / 2, LAYERS.rock[1], true);
    else if (t.highway) {
      if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
      let w = ROAD[t.highway], drive = true;
      if (!w) { w = PATH[t.highway]; drive = false; }
      if (!w) continue;
      const tw = parseFloat(t.width), ln = parseInt(t.lanes);
      if (drive && ln > 0) w = Math.max(w * 0.7, ln * 3.3 + 0.8);
      if (tw > 1 && tw < 40) w = tw;
      if (t.highway === 'service' && (t.service === 'driveway' || t.service === 'parking_aisle')) w = 3.6;
      (drive ? roads : paths).push({ g, nodes, walk: drive && SIDEWALK.has(t.highway) && !['no', 'none', 'separate'].includes(t.sidewalk), hw: w / 2, t, type: t.highway, name: t.name || t.ref || '', drive });
    } else if (t.waterway) {
      const ww = { river: 12, canal: 10, stream: 2.5, ditch: 1.2, drain: 1.2 }[t.waterway]; const tw = parseFloat(t.width);
      if (ww) rivers.push({ g, hw: (tw > 0 && tw < 300 ? tw : ww) / 2 });
    } else if (t.natural === 'tree_row') rows.push(g);
  }
  const seas = seaPolys(coast, HALF + 50, 3000);
  for (const s of seas) fillPoly(BUF.water, s.outer, s.holes, LAYERS.water[1]);
  const layout = prepareRoads(roads, drivingSide(elements));
  for (const {poly, sidewalk} of layout.corners) {
    fillPoly(BUF.road, poly, [], LAYERS.road[1]);
    if (sidewalk) fillPoly(BUF.sidewalk, sidewalk, [], LAYERS.sidewalk[1]);
  }
  for (const r of rivers) ribbon(BUF.water, r.g, r.hw, LAYERS.water[1], true);
  for (const r of paths) ribbon(DIRT.has(r.type) ? BUF.dirt : BUF.paved, r.g, r.hw, DIRT.has(r.type) ? LAYERS.dirt[1] : LAYERS.paved[1], true);
  for (const r of roads) {
    const yR = LAYERS.road[1], walk = r.walk;
    ribbon(BUF.road, r.g, r.hw, yR, false);
    if (walk) ribbon(BUF.sidewalk, r.g, r.hw + 2.2, LAYERS.sidewalk[1], false);
    for (const p of [r.g[0], r.g.at(-1)]) {
      disc(BUF.road, p, r.hw, yR, 20);
      if (walk) disc(BUF.sidewalk, p, r.hw + 2.2, LAYERS.sidewalk[1], 20);
    }
  }
  // Dashes along a polyline: pieces `on` m long every `on + gap` m, `w` wide, centred `off` m left of the line.
  // ok(s, p) can veto a piece (p = [x, z, nx, nz]); gap 0 draws a continuous line made of pieces.
  function dashLine(g, cum, off, on, gap, w, ok, B = BUF.marks, y = LAYERS.marks[1]) {
    const total = cum[cum.length - 1], hw = w / 2; let seg = 0;
    const at = s => { while (seg < cum.length - 2 && cum[seg + 1] < s) seg++; const a = g[seg], b = g[seg + 1], L = (cum[seg + 1] - cum[seg]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, f = s - cum[seg]; return [a[0] + dx * f, a[1] + dz * f, -dz, dx]; };
    for (let s = gap ? 1.5 : 0; s < total - 0.05; s += on + gap) {
      const e = Math.min(total, s + on); if (gap && e < s + on) break;
      const p = at(s), q = at(e);
      if (!ok(s, p) || !ok(e, q)) continue;
      quad(B, [p[0] + p[2] * (off + hw), p[1] + p[3] * (off + hw)], [p[0] + p[2] * (off - hw), p[1] + p[3] * (off - hw)], [q[0] + q[2] * (off - hw), q[1] + q[3] * (off - hw)], [q[0] + q[2] * (off + hw), q[1] + q[3] * (off + hw)], y);
    }
  }
  drawLaneMarkings(roads, dashLine);
  for (const [a,b] of mappedStops(roads, layout.junctions, stopNodes)) {
    ribbon(BUF.marks, [a,b], 0.20, LAYERS.marks[1], false);
  }

  // road lookup grid
  const RG = 25, rgrid = new Map();
  for (const r of roads.concat(paths)) for (let i = 0; i < r.g.length - 1; i++) {
    const a = r.g[i], b = r.g[i + 1], s = { ax: a[0], az: a[1], dx: b[0] - a[0], dz: b[1] - a[1], hw: r.hw, r };
    s.l2 = s.dx * s.dx + s.dz * s.dz || 1e-9;
    const x0 = Math.floor((Math.min(a[0], b[0]) - s.hw) / RG), x1 = Math.floor((Math.max(a[0], b[0]) + s.hw) / RG), z0 = Math.floor((Math.min(a[1], b[1]) - s.hw) / RG), z1 = Math.floor((Math.max(a[1], b[1]) + s.hw) / RG);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = gkey(ix, iz); let L = rgrid.get(k); if (!L) rgrid.set(k, L = []); L.push(s); }
  }
  const cornerGrid = indexCorners(layout.corners, RG);
  function roadAt(x, z) {
    const i0 = Math.floor(x / RG), j0 = Math.floor(z / RG); let any = null, ae = 1e9, drv = null, de = 1e9;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const L = rgrid.get(gkey(i, j)); if (!L) continue;
      for (const s of L) { const e = segDist(x, z, s)[0] - s.hw; if (e < ae) { ae = e; any = s; } if (s.r.drive && e < de) { de = e; drv = s; } }
    }
    if (drv && de > 0 && cornerGrid.get(gkey(i0,j0))?.some(poly => inPoly(x,z,poly))) {
      de = -0.01; // The rounded apron beyond the two road ribbons is also asphalt.
      if (de < ae) { any = drv; ae = de; }
    }
    return { any, ae, drv, de };
  }
  const onDrive = (x, z, m = 0) => { const r = roadAt(x, z); return !!r.drv && r.de < -m; };
  const isBridge = t => t.bridge && t.bridge !== 'no';
  const ends = r => [r.g[0], r.g[r.g.length - 1]];
  function onOther(x, z, self) { // on another street/path: one passing under the bridge, or a bridge running alongside it
    const L = rgrid.get(gkey(Math.floor(x / RG), Math.floor(z / RG))); if (!L) return false;
    for (const s of L) {
      if (s.r === self) continue;
      const side = isBridge(s.r.t) && !ends(s.r).some(p => ends(self).some(q => same(p, q))); // parallel deck, not this bridge's continuation
      if (segDist(x, z, s)[0] < s.hw + (side ? 0.8 : 0)) return true;
    }
    return false;
  }
  const railSegs = rails.flatMap(r => r.g.slice(1).map((b, i) => ({ ax: r.g[i][0], az: r.g[i][1], dx: b[0] - r.g[i][0], dz: b[1] - r.g[i][1], l2: (b[0] - r.g[i][0]) ** 2 + (b[1] - r.g[i][1]) ** 2 || 1e-9, bridge: isBridge(r.t) })));
  const nearRail = (x, z) => railSegs.some(s => !s.bridge && Math.abs(x - s.ax) < 60 + Math.abs(s.dx) && Math.abs(z - s.az) < 60 + Math.abs(s.dz) && segDist(x, z, s)[0] < 2);

  // zebra crossings: crossing footways, plus crossing nodes that have no such way
  const crossWays = paths.filter(r => (r.type === 'footway' || r.type === 'path') && (r.t.footway === 'crossing' || r.t.crossing) && !/^(unmarked|no)$/.test(r.t.crossing || '') && r.t['crossing:markings'] !== 'no');
  for (const r of crossWays) dashLine(r.g, cumLen(r.g), 0, 0.5, 0.55, 3, (s, p) => onDrive(p[0], p[1], 0.2));
  const cwPts = crossWays.flatMap(r => r.g);
  for (const c of crossPts) {
    if (cwPts.some(p => Math.abs(p[0] - c[0]) < 4 && Math.abs(p[1] - c[1]) < 4)) continue;
    const r = roadAt(c[0], c[1]); if (!r.drv || r.de > -0.5) continue;
    const L = Math.sqrt(r.drv.l2), ux = r.drv.dx / L, uz = r.drv.dz / L, hw = r.drv.hw - 0.5;
    for (let a = -hw; a + 0.5 <= hw; a += 1.05) {
      const b = a + 0.5, P = (o, l) => [c[0] - uz * o + ux * l, c[1] + ux * o + uz * l];
      quad(BUF.marks, P(a, -1.5), P(b, -1.5), P(b, 1.5), P(a, 1.5), LAYERS.marks[1]);
    }
  }
  // railways: ballast, sleepers and rails (trams: rails only); rail bridges are left out where they pass over a street
  for (const r of rails) {
    const bridge = isBridge(r.t);
    for (const part of bridge ? runs(densify(r.g, 2), (x, z) => !onDrive(x, z, -0.5)) : [r.g]) {
      if (!r.tram) { ribbon(BUF.ballast, part, 1.7, LAYERS.ballast[1], false); dashLine(part, cumLen(part), 0, 0.26, 0.39, 2.6, () => true, BUF.sleeper, LAYERS.sleeper[1]); }
      for (const o of [0.72, -0.72]) ribbon(BUF.rail, offsetLine(part, o), 0.04, LAYERS.rail[1], false);
    }
  }
  for (const k in LAYERS) if (BUF[k].p.length) scene.add(flatMesh(BUF[k], LAYERS[k][0], k === 'road' || k === 'parking' ? 7 : k === 'water' ? 20 : 5));

  const mkMesh = (B, mat, uv, shadow = true) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  };
  // ---- walls, fences, hedges, bridge railings ----
  {
    const SB = { p: [], n: [], c: [], uv: [] }, FB = { p: [], n: [], c: [], uv: [] };
    const BAR = { wall: [1.8, 0.3, '#b9ae9c'], retaining_wall: [1.1, 0.4, '#a29e95'], city_wall: [5, 1.6, '#a99f8c'], hedge: [1.4, 0.9, '#4f6b33'], guard_rail: [0.75, 0.06, '#a8acb0'], fence: [1.5, 0, '#5d6160'] };
    for (const { g, t } of barriers) {
      const d = BAR[t.barrier]; if (!d) continue;
      const h = Math.min(num(t.height) || d[0], 12), c = tagColor(t.colour) || matColor(WALL_MAT, t.material) || new THREE.Color(/wood/.test((t.fence_type || '') + (t.material || '')) ? '#7a5c40' : d[2]);
      for (const part of runs(densify(g, 3), (x, z) => !onDrive(x, z, -0.3))) { // gates and mapping slips stay off the roads
        if (t.barrier === 'fence') fenceStrip(FB, part, 0, h, c);
        else if (t.barrier === 'guard_rail') wallStrip(SB, part, d[1], 0.45, 0.75, c);
        else wallStrip(SB, part, d[1], 0, h, c);
      }
    }
    const railCol = new THREE.Color('#6b6f72');
    for (const r of roads.concat(paths)) if (isBridge(r.t) && r.type !== 'pier') {
      const off = r.hw + (r.walk ? 2.2 : 0) + 0.1;
      for (const sg of [1, -1]) for (const part of runs(densify(offsetLine(r.g, sg * off), 2), (x, z) => !onOther(x, z, r) && !nearRail(x, z))) fenceStrip(FB, part, 0, 1.1, railCol);
    }
    const fenceTex = makeTex(64, 64, (x) => { x.clearRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 6); x.fillRect(0, 52, 64, 5); for (let i = 0; i < 64; i += 8) x.fillRect(i + 3, 0, 2, 64); });
    if (SB.p.length) mkMesh(SB, new THREE.MeshStandardMaterial({ map: noise, vertexColors: true, roughness: 0.95 }), true);
    if (FB.p.length) mkMesh(FB, new THREE.MeshStandardMaterial({ map: fenceTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }), true);
  }
  // area lookup grid: parking/paving count as hard ground for the car; trees keep off these, water and pitches
  const AG = 25, agrid = new Map(), LIM2 = HALF + 80, aPolys = polys.filter(p => ['parking', 'paving', 'water', 'pitch'].includes(p.kind)).concat(seas.map(s => ({ kind: 'water', ...s })));
  aPolys.forEach((p, i) => { const b = p.bb = bbox(p.outer); for (let ix = Math.floor(Math.max(b.x0, -LIM2) / AG); ix <= Math.floor(Math.min(b.x1, LIM2) / AG); ix++) for (let iz = Math.floor(Math.max(b.z0, -LIM2) / AG); iz <= Math.floor(Math.min(b.z1, LIM2) / AG); iz++) { const k = gkey(ix, iz); let L = agrid.get(k); if (!L) agrid.set(k, L = []); L.push(i); } });
  function areaAt(x, z, kinds) {
    const L = agrid.get(gkey(Math.floor(x / AG), Math.floor(z / AG))); if (!L) return null;
    for (const i of L) { const p = aPolys[i], b = p.bb; if (!kinds.includes(p.kind) || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; if (inPoly(x, z, p.outer) && !p.holes.some(h => inPoly(x, z, h))) return p.kind; }
    return null;
  }
  const NOTREE = ['parking', 'paving', 'water', 'pitch'];

  // ---- buildings ----
  // Walls and roofs are generated per footprint. A pitched roof (roof:shape, or the house default) is the lower
  // envelope of a few planes over the footprint's oriented bounding box: walls rise to that roof line, which makes
  // gable ends on their own, and each plane's roof face is the footprint clipped to where that plane is the lowest.
  const nB = polys.filter(p => p.kind === 'building').length;
  await say('Raising ' + nB.toLocaleString() + ' buildings…');
  const bPolys = polys.filter(p => p.kind === 'building' || p.kind === 'part');
  // outlines with building:part pieces inside are drawn as those parts only (OSM simple 3D buildings)
  const {hidden, parentOutline} = findBuildingParts(bPolys);
  // how mappers here tag roofs decides whether untagged houses get pitched or flat roofs
  let nFlat = 0, nPitch = 0; for (const b of bPolys) { const s = b.t['roof:shape']; if (s) s === 'flat' ? nFlat++ : nPitch++; }
  const flatShare = (nFlat + 1) / (nFlat + nPitch + 2), UP = [0, 1, 0];
  const WB = { p: [], n: [], uv: [], c: [] }, PB = { p: [], n: [], c: [] }, RB = { p: [], n: [], c: [] }, blds = [];
  const roofF = (pl, p) => { let m = 1e9; for (const P of pl) { const f = P[0] + P[1] * p[0] + P[2] * p[1]; if (f < m) m = f; } return Math.max(0, m); };
  const wallQuad = (B, p, q, ya0, yb0, ya1, yb1, n, col, u0, u1) => quad3(B, [p[0], ya0, p[1]], [q[0], yb0, q[1]], [q[0], yb1, q[1]], [p[0], ya1, p[1]], n, col, true, [[u0, 1 - ya0], [u1, 1 - yb0], [u1, 1 - yb1], [u0, 1 - ya1]]);
  function wallRing(r, k, y0, eave, pl, low, col) { // k = ±1 so that k*(dz, -dx) points out of the building
    let u = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-3) continue;
      const n = [k * dz / L, 0, -k * dx / L], ts = [0, 1];
      if (pl) for (let p = 0; p < pl.length; p++) for (let q = p + 1; q < pl.length; q++) { // where the roof line along this wall bends
        const A = pl[p], C = pl[q], ga = A[0] - C[0] + (A[1] - C[1]) * a[0] + (A[2] - C[2]) * a[1], gb = A[0] - C[0] + (A[1] - C[1]) * b[0] + (A[2] - C[2]) * b[1];
        if ((ga > 0) !== (gb > 0)) ts.push(ga / (ga - gb));
      }
      ts.sort((x, y) => x - y);
      for (let j = 0; j < ts.length - 1; j++) {
        if (ts[j + 1] - ts[j] < 1e-6) continue;
        const p0 = [a[0] + dx * ts[j], a[1] + dz * ts[j]], p1 = [a[0] + dx * ts[j + 1], a[1] + dz * ts[j + 1]], u0 = u + L * ts[j], u1 = u + L * ts[j + 1];
        if (eave > y0 + 0.01) wallQuad(low, p0, p1, y0, y0, eave, eave, n, col, u0, u1);
        if (pl) { const h0 = eave + roofF(pl, p0), h1 = eave + roofF(pl, p1); if (h0 > eave + 0.01 || h1 > eave + 0.01) wallQuad(PB, p0, p1, eave, eave, h0, h1, n, col, u0, u1); }
      }
      u += L;
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
      quad3(RB, a, b, c, d, n, col);
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
    const wc = tagColor(t['building:colour']) || matColor(WALL_MAT, t['building:material']) || new THREE.Color(pick(WALLS));
    const rc = tagColor(t['roof:colour']) || matColor(ROOF_MAT, t['roof:material']) || new THREE.Color(pick(shape === 'dome' || shape === 'onion' ? DOMES : shape === 'flat' ? ROOFS : PITCHED));
    const low = PLAIN_T.has(type) || area < 12 ? PB : WB, k = signedArea(outer) > 0 ? 1 : -1;
    if (shape === 'flat') {
      wallRing(outer, k, minH, eave, null, low, wc);
      for (const h of holes) wallRing(h, signedArea(h) > 0 ? -1 : 1, minH, eave, null, low, wc);
      eachTri(outer, holes, (A, B, C) => tri3(RB, [A[0], eave, A[1]], [B[0], eave, B[1]], [C[0], eave, C[1]], UP, rc));
    } else if (shape === 'dome' || shape === 'onion') {
      wallRing(outer, k, minH, eave, null, low, wc);
      eachTri(outer, [], (A, B, C) => tri3(RB, [A[0], eave, A[1]], [B[0], eave, B[1]], [C[0], eave, C[1]], UP, rc));
      dome(o, eave, roofH, shape === 'onion', rc);
    } else {
      const pl = roofPlanes(o, shape, roofH, t['roof:direction'], rnd);
      wallRing(outer, k, minH, eave, pl, low, wc);
      for (let i = 0; i < pl.length; i++) {
        let poly = outer;
        for (let j = 0; j < pl.length && poly.length >= 3; j++) if (j !== i) poly = clipHalf(poly, pl[i][0] - pl[j][0], pl[i][1] - pl[j][1], pl[i][2] - pl[j][2]);
        if (poly.length < 3) continue;
        const P = pl[i], l = Math.hypot(P[1], 1, P[2]), n = [-P[1] / l, 1 / l, -P[2] / l], lift = p => [p[0], eave + roofF([P], p), p[1]];
        eachTri(poly, [], (A, B, C) => tri3(RB, lift(A), lift(B), lift(C), n, rc));
      }
    }
    if (minH === 0 && eave >= 2.15 && type !== 'roof' && t.location !== 'underground') {
      frontages.collect(b, outer, holes, eave, type, wc);
    }
    blds.push({ outer: b.outer, holes: b.holes, h: eave + roofH, minH, ...bbox(b.outer) });
  }
  const frontMat = frontages.render(PB, mkMesh);
  const winDay = makeTex(512, 512, (x) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 512); speckle(x, 512, 512, 14000, 0.1); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = '#7c8996'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 9); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(i * 64 + 31, j * 64 + 16, 2, 28); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 64 + 18, j * 64 + 44, 28, 3); } });
  const winNight = makeTex(512, 512, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (Math.random() < 0.32) { x.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#cfe0ff'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); } });
  for (const t of [winDay, winNight]) { t.repeat.set(1 / 24, 1 / 24.8); t.offset.set(0, -1 / 24.8); }
  const wallMat = new THREE.MeshStandardMaterial({ map: winDay, vertexColors: true, roughness: 0.85, emissiveMap: winNight, emissive: 0xffffff, emissiveIntensity: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  if (WB.p.length) mkMesh(WB, wallMat, true);
  if (PB.p.length) mkMesh(PB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), false);
  if (RB.p.length) mkMesh(RB, roofMat, false);
  const BG = 20, bgrid = new Map();
  blds.forEach((b, i) => { for (let ix = Math.floor(b.x0 / BG); ix <= Math.floor(b.x1 / BG); ix++) for (let iz = Math.floor(b.z0 / BG); iz <= Math.floor(b.z1 / BG); iz++) { const k = gkey(ix, iz); let L = bgrid.get(k); if (!L) bgrid.set(k, L = []); L.push(i); } });
  function inBuilding(x, z, y) {
    const L = bgrid.get(gkey(Math.floor(x / BG), Math.floor(z / BG))); if (!L) return false;
    for (const i of L) { const b = blds[i]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || b.h < y || b.minH > y) continue; if (inPoly(x, z, b.outer) && !b.holes.some(h => inPoly(x, z, h))) return true; }
    return false;
  }

  // ---- trees ----
  await say('Planting trees…');
  const trees = [], LIM = HALF + 60, within = (x, z) => Math.abs(x) < LIM && Math.abs(z) < LIM;
  const clear = (x, z) => { const r = roadAt(x, z); return !(r.any && r.ae < 1.2) && !inBuilding(x, z, 1) && !areaAt(x, z, NOTREE) && !nearRail(x, z); };
  const roomy = (x, z) => !inBuilding(x + 3, z, 1) && !inBuilding(x - 3, z, 1) && !inBuilding(x, z + 3, 1) && !inBuilding(x, z - 3, 1) && !(roadAt(x, z).ae < 2.5);
  for (const p of treePts) if (within(p[0], p[1])) trees.push([p[0], p[1], 0.8 + Math.random() * 0.5, 0]);
  for (const g of rows) for (let i = 0; i < g.length - 1; i++) { const a = g[i], b = g[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += 8) { const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L; if (within(x, z)) trees.push([x, z, 0.8 + Math.random() * 0.4, 0]); } }
  const DENS = { forest: 45, scrub: 300, park: 220, resid: 650 }; // m² per tree; residential land gets scattered garden trees
  for (const p of polys.filter(p => DENS[p.kind]).sort((a, b) => (a.kind === 'resid') - (b.kind === 'resid'))) {
    if (trees.length > 7000) break;
    const B = bbox(p.outer), x0 = Math.max(B.x0, -LIM), x1 = Math.min(B.x1, LIM), z0 = Math.max(B.z0, -LIM), z1 = Math.min(B.z1, LIM);
    if (x1 <= x0 || z1 <= z0) continue;
    const fill = polyArea(p.outer) / Math.max(1, (B.x1 - B.x0) * (B.z1 - B.z0)), resid = p.kind === 'resid';
    const n = Math.min(2500, Math.round((x1 - x0) * (z1 - z0) * fill / DENS[p.kind]));
    for (let i = 0; i < n * 1.5 && trees.length < 7500; i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
      if (!inPoly(x, z, p.outer) || p.holes.some(h => inPoly(x, z, h)) || !clear(x, z) || (resid && !roomy(x, z))) continue;
      trees.push([x, z, resid ? 0.6 + Math.random() * 0.5 : 0.7 + Math.random() * 0.7, (p.kind === 'forest' ? 0.45 : resid ? 0.15 : 0) > Math.random() ? 1 : 0]);
    }
  }
  {
    const crownG = new THREE.SphereGeometry(1, 14, 10), cp = crownG.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), f = 1 + 0.13 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 - y * 2.1); cp.setXYZ(i, x * f * 2.4, y * f * 2.1 + 4.6, z * f * 2.4); }
    crownG.computeVertexNormals();
    const coneG = new THREE.ConeGeometry(2.0, 5.5, 9).translate(0, 4.6, 0), cone2 = new THREE.ConeGeometry(1.4, 3.6, 9).translate(0, 6.6, 0);
    const trunkG = new THREE.CylinderGeometry(0.14, 0.24, 3.2, 7).translate(0, 1.6, 0);
    const leaf = new THREE.MeshStandardMaterial({ map: noise, roughness: 0.85 }), bark = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 });
    const nR = trees.filter(t => !t[3]).length, nC = trees.length - nR;
    const T = new THREE.InstancedMesh(trunkG, bark, Math.max(1, trees.length)), R = new THREE.InstancedMesh(crownG, leaf, Math.max(1, nR)), C1 = new THREE.InstancedMesh(coneG, leaf, Math.max(1, nC)), C2 = new THREE.InstancedMesh(cone2, leaf, Math.max(1, nC));
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(1, 1, 1), c = new THREE.Color(); let r = 0, k = 0;
    trees.forEach((t, i) => {
      Q.setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28); S.set(t[2], t[2] * (0.9 + Math.random() * 0.3), t[2]); M.compose(V(t[0], 0, t[1]), Q, S); T.setMatrixAt(i, M);
      c.setHSL(0.22 + Math.random() * 0.08, 0.35 + Math.random() * 0.2, 0.22 + Math.random() * 0.1);
      if (t[3]) { c.offsetHSL(0.04, 0, -0.06); C1.setMatrixAt(k, M); C2.setMatrixAt(k, M); C1.setColorAt(k, c); C2.setColorAt(k, c); k++; } else { R.setMatrixAt(r, M); R.setColorAt(r, c); r++; }
    });
    T.count = trees.length; R.count = nR; C1.count = C2.count = nC;
    for (const m of [T, R, C1, C2]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }

  // ---- street lamps: posts along the streets; from dusk their heads glow and they throw pools of light ----
  const glowTex = makeTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
  const lamps = [], LG = 12, lgrid = new Map();
  const lampFree = (x, z) => { const i = Math.floor(x / LG), j = Math.floor(z / LG); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of lgrid.get(gkey(i + a, j + b)) || []) if (Math.hypot(p[0] - x, p[1] - z) < 12) return false; return true; };
  for (const r of roads) {
    if (['service', 'track', 'raceway', 'busway'].includes(r.type) || r.hw < 2.6) continue;
    const cum = cumLen(r.g), total = cum[cum.length - 1], wide = r.hw >= 4.5; let seg = 0, k = 0;
    for (let s = 10; s < total - 4 && lamps.length < 2500; s += wide ? 26 : 34, k++) {
      while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
      const a = r.g[seg], b = r.g[seg + 1], L = cum[seg + 1] - cum[seg] || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, f = s - cum[seg];
      const side = wide && k % 2 ? -1 : 1, nx = -dz * side, nz = dx * side, off = r.hw + (r.walk ? 0.9 : 0.45); // wide streets: staggered on both sides
      const x = a[0] + dx * f + nx * off, z = a[1] + dz * f + nz * off;
      if (Math.abs(x) > HALF + 40 || Math.abs(z) > HALF + 40 || onDrive(x, z, -0.4) || inBuilding(x, z, 1) || (!isBridge(r.t) && areaAt(x, z, ['water'])) || !lampFree(x, z)) continue;
      lamps.push([x, z, -nx, -nz]); const kk2 = gkey(Math.floor(x / LG), Math.floor(z / LG)); let Lc = lgrid.get(kk2); if (!Lc) lgrid.set(kk2, Lc = []); Lc.push([x, z]);
    }
  }
  let setLamps = () => { };
  if (lamps.length) {
    const nL = lamps.length, metal = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.5, metalness: 0.6 });
    const lampHead = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0 });
    const parts = [[new THREE.CylinderGeometry(0.06, 0.1, 7.4, 6).translate(0, 3.7, 0), metal], [new THREE.BoxGeometry(1.6, 0.09, 0.09).translate(0.8, 7.3, 0), metal], [new THREE.BoxGeometry(0.6, 0.13, 0.28).translate(1.5, 7.22, 0), lampHead]].map(([g, m]) => new THREE.InstancedMesh(g, m, nL));
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffaa4c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), nL);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), one = V(1, 1, 1), pool = V(15, 1, 15), Y = V(0, 1, 0), I = new THREE.Quaternion(), gp = new Float32Array(nL * 3);
    lamps.forEach(([x, z, ax, az], i) => {
      Q.setFromAxisAngle(Y, Math.atan2(-az, ax)); M.compose(V(x, 0, z), Q, one); for (const m of parts) m.setMatrixAt(i, M); // arm points along (ax, az), over the road
      const hx = x + ax * 1.5, hz = z + az * 1.5; M.compose(V(hx, 0.075, hz), I, pool); pools.setMatrixAt(i, M); gp.set([hx, 7.08, hz], i * 3);
    });
    parts.forEach((m, i) => { m.castShadow = i < 2; m.receiveShadow = true; scene.add(m); });
    const glows = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(gp, 3)), new THREE.PointsMaterial({ map: glowTex, color: 0xffd39a, size: 2.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pools.renderOrder = 1; scene.add(pools, glows);
    setLamps = on => { lampHead.emissiveIntensity = on ? 3.5 : 0; pools.visible = glows.visible = on; };
  }
  return { roads, paths, rivers, polys, seas, blds, trees, nB, layout, roadAt, areaAt, inBuilding, frontMat, wallMat, setLamps, glowTex };
}
