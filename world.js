// The 3D world built from a place's OpenStreetMap elements: ground layers, sea, roads and markings, crossings, railways,
// walls and fences, buildings (buildings.js), trees and street lamps, plus the lookups the game drives on (roadAt,
// areaAt, inBuilding). buildWorld() runs one builder per feature, in an order that later ones depend on. The surfaces
// that face the sky can be made wet or snowy afterwards (setGround).
import * as THREE from 'three';
import { same, joinRings, inPoly, polyArea, bbox, newBuf, quad, disc, ribbon, offsetLine, cumLen, densify, runs, wallStrip, fenceStrip, seaPolys, gkey, segDist } from './geom.js';
import { fillPoly, makeTex, speckle, num, tagColor, matColor, WALL_MAT, weatherLook } from './world-kit.js';
import { buildBuildings } from './buildings.js';
import { landmarkName, planSigns } from './sign-layout.js';
import { furnitureKind, planFurniture } from './street-furniture.js';
import { addFurniture } from './furniture-mesh.js';
import { addSignMeshes } from './sign-mesh.js';
import { drivingSide, prepareRoads, mappedStops } from './road-layout.js';
import { addBridgeStructures } from './bridge-mesh.js';
import { levelWaters } from './water-levels.js';
import { bridgeDecks } from './bridge-decks.js';
import { drapeSurface } from './terrain-surface.js';
import { HALF } from './osm-query.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function flatMesh(B, mat, uvScale, terrain) {
  if (terrain?.active) B.p = drapeSurface(B.p, terrain);
  const g = new THREE.BufferGeometry(), n = B.p.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  const nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; uv[i * 2] = B.p[i * 3] / uvScale; uv[i * 2 + 1] = B.p[i * 3 + 2] / uvScale; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  // Sample the grade across each vertex. Neighbouring triangles then share
  // their light normal along a crease, including separate road/paint meshes.
  if (terrain?.active) {
    const height = terrain.height;
    for (let i = 0; i < B.p.length; i+=3) {
      const x=B.p[i], z=B.p[i+2];
      const nx=height(x-3,z)-height(x+3,z), nz=height(x,z-3)-height(x,z+3);
      const length=Math.hypot(nx,6,nz);
      nor[i]=nx/length; nor[i+1]=6/length; nor[i+2]=nz/length;
    }
  }
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
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
const NOTREE = ['parking', 'paving', 'water', 'pitch']; // trees keep off these
const isBridge = t => t.bridge && t.bridge !== 'no';

// elements: an Overpass reply's elements; (lat0, lon0) becomes the origin. say(text) shows progress and waits for a repaint.
// setGround(wet, snow) (0–1 each, from weather.js groundOf) wets roads, roofs and ground or lays snow on them;
// reflectLamps(x, z), called as the camera moves, lets the lit street lamps nearest it glint in wet roads.
export async function buildWorld(elements, lat0, lon0, scene, say, terrain, finishCorner) {
  const height = terrain?.height ?? (() => 0);
  await say('Building the streets…');
  const { lines, polys, treePts, crossPts, stopNodes, entranceNodes, signalPts, landmarks, furniture, addressPoints } = parseElements(elements, lat0, lon0);
  const wx = weatherLook(), { wear } = wx;
  const G = groundLayers(scene, wear, terrain), { LAYERS, BUF } = G;
  if (terrain?.active) levelWaters(polys,height);
  for (const p of polys) {
    if (!LAYERS[p.kind]) continue;
    if (Number.isFinite(p.waterLevel)) {
      fillPoly(G.levelWater, p.outer, p.holes, p.waterLevel + LAYERS.water[1]);
    } else fillPoly(BUF[p.kind], p.outer, p.holes, LAYERS[p.kind][1]);
  }
  const { roads, paths, rivers, rows, rails, barriers, seas, layout } = layRoads(lines, elements, stopNodes, G);
  const waters = polys.filter(p => p.kind === 'water').concat(seas.map(p => ({...p, waterLevel: terrain?.seaLevel ?? 0})));
  const riverSegments = rivers.flatMap(r => r.g.slice(1).map(([x,z],i) => {
    const [ax,az] = r.g[i], dx=x-ax, dz=z-az;
    return {ax,az,dx,dz,l2:dx*dx+dz*dz || 1, hw:r.hw};
  }));
  const shoreBounds = waters.map(p => ({p, bounds:bbox(p.outer)}));
  function polygonWaterAt(x,z) {
    let level = -Infinity;
    for (const {p,bounds:b} of shoreBounds) {
      if (x<b.x0 || x>b.x1 || z<b.z0 || z>b.z1) continue;
      if (inPoly(x,z,p.outer) && !p.holes.some(h=>inPoly(x,z,h))) level = Math.max(level,p.waterLevel ?? height(x,z));
    }
    return level;
  }
  function waterAt(x,z) {
    const level = polygonWaterAt(x,z);
    if (Number.isFinite(level)) return level;
    if (riverSegments.some(s=>Math.abs(x-s.ax)<=Math.abs(s.dx)+s.hw && Math.abs(z-s.az)<=Math.abs(s.dz)+s.hw && segDist(x,z,s)[0]<=s.hw)) return height(x,z);
    return level;
  }
  for (const river of rivers) {
    for (const part of runs(densify(river.g, 6), (x,z)=>!Number.isFinite(polygonWaterAt(x,z)))) {
      ribbon(BUF.water,part,river.hw,LAYERS.water[1],true);
    }
  }
  const decks = bridgeDecks([...roads,...paths], height, waterAt);
  const roadSurface = decks.active ? decks : terrain;
  const driveHeight = roadSurface?.height ?? height;
  const land = decks.active ? decks.banks : terrain;
  const landHeight = land?.height ?? height;
  const base = newBuf();
  const edges = [-4000, ...Array.from({length:21},(_,i)=>64*(i-10)),4000];
  for (let i=1;i<edges.length;i++) for (let j=1;j<edges.length;j++) {
    const [a,b,c,d]=[edges[i-1],edges[i],edges[j-1],edges[j]];
    quad(base,[a,c],[b,c],[b,d],[a,d],-0.03);
  }
  scene.add(flatMesh(base, wear(new THREE.MeshStandardMaterial({map:G.noise,color:'#8a9468',roughness:1}), 'ground'), 5, land));
  addBridgeStructures(scene,decks.crossings,driveHeight);
  const look = roadLookup(roads, paths, rails, layout), { roadAt } = look;
  paintCrossings(paths, crossPts, look, G);
  layRailways(rails, look, G);
  if (G.levelWater.p.length) scene.add(flatMesh(G.levelWater, LAYERS.water[0], 20));
  for (const k in LAYERS) if (BUF[k].p.length) scene.add(flatMesh(BUF[k], LAYERS[k][0], k === 'road' || k === 'parking' ? 7 : k === 'water' ? 20 : 5, ['road','sidewalk','marks','dirt','paved'].includes(k) ? roadSurface : k === 'water' ? terrain : land));
  const mkMesh = (B, mat, uv, shadow = true) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  };
  buildWalls(barriers, roads, paths, look, G.noise, mkMesh, wear, driveHeight, waterAt);
  const areaAt = areaLookup(polys, seas);
  const nB = polys.filter(p => p.kind === 'building').length;
  await say('Raising ' + nB.toLocaleString() + ' buildings…');
  const { blds, inBuilding, frontMat, wallMat } = buildBuildings(polys, entranceNodes, roadAt, mkMesh, wear, landHeight);
  await say('Planting trees…');
  const trees = plantTrees(scene, treePts, rows, polys, G.noise, look, areaAt, inBuilding, wear, landHeight);
  const { setLamps, glowTex, lamps } = streetLamps(scene, roads, look, areaAt, inBuilding, wx, driveHeight);
  const clear = signClearance(trees, lamps, look, areaAt, inBuilding);
  const { objects, hit } = planFurniture(furniture, polys, roadAt, clear);
  const parkedPaint = addFurniture(scene, objects, landHeight);
  const signFree = (x,z) => clear(x,z) && !hit(x,z,0,0.35,0.35);
  const signs = planSigns(layout.junctions, landmarks, roadAt, signFree);
  addSignMeshes(scene, signs, landHeight);
  const lightFront = await finishCorner?.({ scene, road: LAYERS.road[0], markings: LAYERS.marks[0], wear, height: landHeight, buildings: polys });
  return { driveHeight, roads, paths, rivers, polys, seas, blds, trees, addressPoints, nB, layout, signalPts, crossPts, roadAt, areaAt, inBuilding, furnitureHit: hit, frontMat, wallMat, setLamps: on => { setLamps(on); lightFront?.(on); }, setGround: wx.set, reflectLamps: wx.follow, glowTex, parkedPaint, posts: camPosts(trees, lamps, signs) };
}

// what the chase camera keeps out of, as geom.js pointGrid points [x, z, r, y0, y1]: tree trunks (not the crowns, which
// overhang the lanes), lamp posts, and sign posts and boards (sign-mesh.js: boards up to 3.6 m wide, about 2.6 m up)
function camPosts(trees, lamps, signs) {
  const o = trees.map(t => [t[0], t[1], 0.24 * t[2], 0, 3.2 * t[2]]).concat(lamps.map(l => [l[0], l[1], 0.12, 0, 7.4]));
  for (const { x, z, dx, dz } of signs) { o.push([x, z, 0.08, 0, 2.6]); for (let a = -1.6; a < 1.7; a += 0.4) o.push([x + dx * a, z + dz * a, 0.25, 2.1, 3.1]); }
  return o;
}

// OSM elements → local metres: lines (ways), polys (closed areas and multipolygons), and the point features we use.
function parseElements(elements, lat0, lon0) {
  const cosL = Math.cos(lat0 * Math.PI / 180), KX = 111320 * cosL, KZ = 110574;
  const P = (lat, lon) => [(lon - lon0) * KX, -(lat - lat0) * KZ];
  const lines = [], polys = [], treePts = [], crossPts = [], stopNodes = [], signalPts = [];
  const entranceNodes = new Set(), landmarks = [], furniture = [], addressPoints = [];
  function area(kind, outer, holes, t, id, label) {
    if (kind) polys.push({ kind, outer, holes, t, id });
    if (label) landmarks.push({ label, points: outer });
  }
  for (const el of elements) {
    if (el.type === 'node') {
      const tags = el.tags || {}, p = P(el.lat, el.lon);
      if (tags['addr:housenumber']) addressPoints.push({text:tags['addr:housenumber'],point:p});
      const kind = furnitureKind(tags);
      if (kind) furniture.push({ kind, t: tags, point: p });
      const label = landmarkName(tags);
      if (label) landmarks.push({ label, points: [p] });
      const entrance = tags.entrance || (tags.building === 'entrance' ? 'yes' : '');
      if (entrance && entrance !== 'no' && (!tags.level || tags.level.split(';').some(level => Number(level) === 0))) {
        entranceNodes.add(p.join(','));
      }
      if (tags.highway === 'stop') stopNodes.push({ id: el.id, p, tags });
      else if (tags.highway === 'traffic_signals') signalPts.push(p);
      else if (tags.highway === 'crossing' && tags['crossing:markings'] !== 'no') crossPts.push(p);
      else if (tags.natural === 'tree') treePts.push(p);
      continue;
    }
    const t = el.tags || {}, kind = areaKind(t), label = landmarkName(t);
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 2) continue;
      const g = el.geometry.map(p => P(p.lat, p.lon)), closed = g.length > 3 && same(g[0], g[g.length - 1]);
      const item = furnitureKind(t);
      if (item) {
        const middle = Math.floor((g.length-1)/2), a = g[middle], b = g[middle+1];
        furniture.push({ kind: item, t, point: [(a[0]+b[0])/2, (a[1]+b[1])/2] });
      }
      if ((kind || label) && closed) area(kind, g, [], t, el.id, label);
      else lines.push({ t, g, nodes: el.nodes });
    } else if (el.type === 'relation' && (kind || label)) {
      const outs = [], ins = [];
      for (const m of el.members || []) { if (m.type !== 'way' || !m.geometry) continue; const g = m.geometry.filter(Boolean).map(p => P(p.lat, p.lon)); if (g.length > 1) (m.role === 'inner' ? ins : outs).push(g); }
      const I = joinRings(ins);
      for (const o of joinRings(outs)) area(kind, o, I.filter(h => inPoly(h[0][0], h[0][1], o)), t, el.id, label);
    }
  }
  return { lines, polys, treePts, crossPts, stopNodes, entranceNodes, signalPts, landmarks, furniture, addressPoints };
}

// Textures, the flat ground layers (each with its own buffer, filled by the builders below) and the base ground plane.
// wear(material, kind) lets rain and snow onto them (world-kit.js weatherLook).
const WORN = { road: 'road', parking: 'road', marks: 'mark', sidewalk: 'pave', paving: 'pave', paved: 'pave', water: null, rail: null }; // the rest: 'ground'
function groundLayers(scene, wear, terrain) {
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
  for (const k in LAYERS) { const kind = k in WORN ? WORN[k] : 'ground'; if (kind) wear(LAYERS[k][0], kind); }
  const BUF = Object.fromEntries(Object.keys(LAYERS).map(k => [k, newBuf()]));
  // the base ground sits a few cm below the flat layers and is tiled, so it can't win the depth test against them far away
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
  return { noise, LAYERS, BUF, dashLine, levelWater: newBuf(), terrain };
}

// Sorts the lines into roads, paths, rivers, rails, barriers and coast; lays sea, rivers, paths, roads and junction
// corners into the ground layers; paints lane markings and stop lines.
function layRoads(lines, elements, stopNodes, { LAYERS, BUF, dashLine, levelWater, terrain }) {
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
  for (const s of seas) fillPoly(terrain?.active ? levelWater : BUF.water, s.outer, s.holes, LAYERS.water[1] + (terrain?.seaLevel || 0));
  const layout = prepareRoads(roads, drivingSide(elements));
  for (const {poly, sidewalk} of layout.corners) {
    fillPoly(BUF.road, poly, [], LAYERS.road[1]);
    if (sidewalk) fillPoly(BUF.sidewalk, sidewalk, [], LAYERS.sidewalk[1]);
  }
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
  drawLaneMarkings(roads, dashLine);
  for (const [a,b] of mappedStops(roads, layout.junctions, stopNodes)) {
    ribbon(BUF.marks, [a,b], 0.20, LAYERS.marks[1], false);
  }
  return { roads, paths, rivers, rows, rails, barriers, seas, layout };
}

// Grid of road/path segments: roadAt(x, z) gives the nearest street and drivable street and how far outside them (m).
function roadLookup(roads, paths, rails, layout) {
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
  return { roadAt, onDrive, onOther, nearRail };
}

// zebra crossings: crossing footways, plus crossing nodes that have no such way
function paintCrossings(paths, crossPts, { roadAt, onDrive }, { LAYERS, BUF, dashLine }) {
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
}

// railways: ballast, sleepers and rails (trams: rails only); rail bridges are left out where they pass over a street
function layRailways(rails, { onDrive }, { LAYERS, BUF, dashLine }) {
  for (const r of rails) {
    const bridge = isBridge(r.t);
    for (const part of bridge ? runs(densify(r.g, 2), (x, z) => !onDrive(x, z, -0.5)) : [r.g]) {
      if (!r.tram) { ribbon(BUF.ballast, part, 1.7, LAYERS.ballast[1], false); dashLine(part, cumLen(part), 0, 0.26, 0.39, 2.6, () => true, BUF.sleeper, LAYERS.sleeper[1]); }
      for (const o of [0.72, -0.72]) ribbon(BUF.rail, offsetLine(part, o), 0.04, LAYERS.rail[1], false);
    }
  }
}

// walls, fences, hedges, guard rails, and railings along bridges (snow settles on the tops of walls and hedges)
function buildWalls(barriers, roads, paths, { onDrive, onOther, nearRail }, noise, mkMesh, wear, height, waterAt) {
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
    for (const sg of [1, -1]) for (const part of runs(densify(offsetLine(r.g, sg * off), 2), (x, z) => !Number.isFinite(waterAt(x,z)) && !onOther(x, z, r) && !nearRail(x, z))) fenceStrip(FB, part, 0, 1.1, railCol);
  }
  const fenceTex = makeTex(64, 64, (x) => { x.clearRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 6); x.fillRect(0, 52, 64, 5); for (let i = 0; i < 64; i += 8) x.fillRect(i + 3, 0, 2, 64); });
  for (const {p} of [SB,FB]) for (let i=0; i<p.length; i+=3) p[i+1] += height(p[i],p[i+2]);
  if (SB.p.length) mkMesh(SB, wear(new THREE.MeshStandardMaterial({ map: noise, vertexColors: true, roughness: 0.95 }), 'roof'), true);
  if (FB.p.length) mkMesh(FB, new THREE.MeshStandardMaterial({ map: fenceTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }), true);
}

// area lookup grid: parking/paving count as hard ground for the car; trees keep off these, water and pitches
function areaLookup(polys, seas) {
  const AG = 25, agrid = new Map(), LIM2 = HALF + 80, aPolys = polys.filter(p => ['parking', 'paving', 'water', 'pitch'].includes(p.kind)).concat(seas.map(s => ({ kind: 'water', ...s })));
  aPolys.forEach((p, i) => { const b = p.bb = bbox(p.outer); for (let ix = Math.floor(Math.max(b.x0, -LIM2) / AG); ix <= Math.floor(Math.min(b.x1, LIM2) / AG); ix++) for (let iz = Math.floor(Math.max(b.z0, -LIM2) / AG); iz <= Math.floor(Math.min(b.z1, LIM2) / AG); iz++) { const k = gkey(ix, iz); let L = agrid.get(k); if (!L) agrid.set(k, L = []); L.push(i); } });
  function areaAt(x, z, kinds) {
    const L = agrid.get(gkey(Math.floor(x / AG), Math.floor(z / AG))); if (!L) return null;
    for (const i of L) { const p = aPolys[i], b = p.bb; if (!kinds.includes(p.kind) || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; if (inPoly(x, z, p.outer) && !p.holes.some(h => inPoly(x, z, h))) return p.kind; }
    return null;
  }
  return areaAt;
}

// mapped trees, tree rows, and trees scattered over forests, scrub, parks and gardens (snow settles on the crowns)
function plantTrees(scene, treePts, rows, polys, noise, { roadAt, nearRail }, areaAt, inBuilding, wear, height) {
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
    const leaf = wear(new THREE.MeshStandardMaterial({ map: noise, roughness: 0.85 }), 'tree'), bark = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 });
    const nR = trees.filter(t => !t[3]).length, nC = trees.length - nR;
    const T = new THREE.InstancedMesh(trunkG, bark, Math.max(1, trees.length)), R = new THREE.InstancedMesh(crownG, leaf, Math.max(1, nR)), C1 = new THREE.InstancedMesh(coneG, leaf, Math.max(1, nC)), C2 = new THREE.InstancedMesh(cone2, leaf, Math.max(1, nC));
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(1, 1, 1), c = new THREE.Color(); let r = 0, k = 0;
    trees.forEach((t, i) => {
      Q.setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28); S.set(t[2], t[2] * (0.9 + Math.random() * 0.3), t[2]); M.compose(V(t[0], height(t[0],t[1]), t[1]), Q, S); T.setMatrixAt(i, M);
      c.setHSL(0.22 + Math.random() * 0.08, 0.35 + Math.random() * 0.2, 0.22 + Math.random() * 0.1);
      if (t[3]) { c.offsetHSL(0.04, 0, -0.06); C1.setMatrixAt(k, M); C2.setMatrixAt(k, M); C1.setColorAt(k, c); C2.setColorAt(k, c); k++; } else { R.setMatrixAt(r, M); R.setColorAt(r, c); r++; }
    });
    T.count = trees.length; R.count = nR; C1.count = C2.count = nC;
    for (const m of [T, R, C1, C2]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }
  return trees;
}

// street lamps: posts along the streets; from dusk their heads glow and they throw pools of light (setLamps), and wet
// roads reflect them (wx: world-kit.js weatherLook)
function streetLamps(scene, roads, { onDrive }, areaAt, inBuilding, wx, height) {
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
      Q.setFromAxisAngle(Y, Math.atan2(-az, ax)); M.compose(V(x, height(x,z), z), Q, one); for (const m of parts) m.setMatrixAt(i, M); // arm points along (ax, az), over the road
      const hx = x + ax * 1.5, hz = z + az * 1.5; I.setFromUnitVectors(Y, V(height(hx-0.5,hz)-height(hx+0.5,hz), 1, height(hx,hz-0.5)-height(hx,hz+0.5)).normalize()); M.compose(V(hx, height(hx,hz)+0.075, hz), I, pool); pools.setMatrixAt(i, M); gp.set([hx, height(x,z)+7.08, hz], i * 3);
    });
    parts.forEach((m, i) => { m.castShadow = i < 2; m.receiveShadow = true; scene.add(m); });
    const glows = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(gp, 3)), new THREE.PointsMaterial({ map: glowTex, color: 0xffd39a, size: 2.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pools.renderOrder = 1; scene.add(pools, glows);
    setLamps = on => { lampHead.emissiveIntensity = on ? 3.5 : 0; pools.visible = glows.visible = on; wx.lit(on); };
    wx.lamps(gp);
  }
  return { setLamps, glowTex, lamps };
}


// Test a proposed sign against nearby tree trunks and lamp posts as well as the terrain.
function signClearance(trees, lamps, { roadAt, nearRail }, areaAt, inBuilding) {
  const grid = new Map(), cell = 5;
  for (const p of [...trees, ...lamps]) {
    const key = gkey(Math.floor(p[0] / cell), Math.floor(p[1] / cell));
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }
  return (x, z) => {
    if (roadAt(x, z).ae < 0.3 || inBuilding(x, z, 1) || inBuilding(x, z, 2.6) ||
        areaAt(x, z, ['water']) || nearRail(x, z)) return false;
    const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
    for (let i = ix-1; i <= ix+1; i++) for (let j = iz-1; j <= iz+1; j++) {
      for (const p of grid.get(gkey(i,j)) || []) if ((p[0]-x)**2 + (p[1]-z)**2 < 1.5**2) return false;
    }
    return true;
  };
}
