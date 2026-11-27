import test from 'node:test';
import assert from 'node:assert/strict';
import { facadeWalls, isRetail, onOutline, planFronts, shopBays, FACADE, FACADES, facadeStyle, floorGrid, bayCoords, wallAtlas, ATLAS_CELL, SURFACES, WALL_SURFACES, levelPhoto, REGIONS, regionOf, mansardRoof } from '../building-fronts.js';
import { existsSync, readFileSync } from 'node:fs';
import { overpassQuery } from '../osm-query.js';

const ring = [[0,0], [3,0], [9,0], [12,0], [12,8], [0,8]];
const walls = () => facadeWalls(ring, 1).map(w => ({...w, infer: true, retail: true}));
const street = w => w.nx === 1 ? 4 : Infinity;

test('entrance nodes on one straight facade retain their positions and split display bays', () => {
  const front = planFronts(walls(), [[3,0], [9,0]], street);
  const mapped = front.find(f => f.doors.length);
  assert.deepEqual(mapped.doors, [3,9]);
  assert.equal(front.filter(f => f.doors.length).length, 1);
  assert.equal(mapped.wall.length, 12);
  const bays = shopBays(12, mapped.doors);
  assert.ok(bays.length >= 3);
  for (const [a,b] of bays) {
    assert.ok(b - a >= 1.2 && a >= 0 && b <= 12);
    for (const center of mapped.doors) assert.ok(b <= center - 0.58 || a >= center + 0.58);
  }
});

test('the fallback places exactly one door on the street-facing wall in either winding', () => {
  for (const faceList of [walls(), facadeWalls(ring.slice().reverse(), -1).map(w => ({...w, infer:true}))]) {
    const front = planFronts(faceList, [], street);
    assert.equal(front.length, 1);
    assert.equal(front[0].wall.nx, 1);
    assert.deepEqual(front[0].doors, [4]);
  }
  assert.deepEqual(planFronts(walls(), [], () => Infinity), []);
});

test('a mapped courtyard entrance takes precedence and receives no inferred display windows', () => {
  const courtyard = facadeWalls([[2,2],[4,2],[8,2],[8,6],[2,6]], -1, true);
  const front = planFronts([...walls(), ...courtyard.map(w => ({...w, infer:true, retail:true}))], [[4,2]], street);
  const [door] = front.filter(f => f.doors.length);
  assert.equal(door.wall.courtyard, true);
  assert.equal(door.shop, false);
  assert.deepEqual(door.doors, [2]);
});

test('the parent outline distinguishes external building part edges from internal seams', () => {
  const outline = facadeWalls(ring, 1);
  const part = facadeWalls([[0,0],[6,0],[6,8],[0,8]], 1);
  assert.equal(onOutline(part[0], outline), true);
  assert.equal(onOutline(part[1], outline), false);
});

test('shop tags distinguish retail from other occupied buildings', () => {
  assert.ok(isRetail({building:'retail'}));
  assert.ok(isRetail({building:'yes', shop:'bakery'}));
  assert.equal(isRetail({building:'commercial'}), false);
  assert.equal(isRetail({building:'apartments', shop:'vacant'}), false);
  assert.match(overpassQuery(44,26), /node\["entrance"\]/);
});

test('every straight run of a facade holds whole window bays, so corners never cut a window', () => {
  // the entrance nodes at (3,0) and (9,0) don't split the 12 m front; 8 m sides round to 3 bays of 2.67 m
  assert.deepEqual(bayCoords(ring, 3), [[0,1], [1,3], [3,4], [4,7], [7,11], [11,14]]);
  const notch = bayCoords([[0,0], [10,0], [10,1], [11,1], [11,9], [0,9]], 3); // a 1 m step gets no window
  assert.equal(notch[1][1] - notch[1][0], 0);
  assert.equal(notch[2][1] - notch[2][0], 0);
  for (const [a, b] of notch) assert.ok(Number.isInteger(a) && Number.isInteger(Math.round(b)));
  const round = Array.from({length: 24}, (_, i) => [10 * Math.cos(i * Math.PI / 12), 10 * Math.sin(i * Math.PI / 12)]);
  const tower = bayCoords(round, 3, 100); // no corners: the windows run on around a round tower
  assert.equal(tower[0][0], 100);
  assert.ok(Math.abs(tower[23][1] - 100 - Math.round(2 * Math.PI * 10 * Math.cos(Math.PI / 24) / 3)) < 1e-9);
  for (let i = 1; i < 24; i++) assert.equal(tower[i][0], tower[i - 1][1]);
});

test('storeys follow the tagged levels, otherwise the facade style', () => {
  assert.deepEqual(floorGrid(FACADE.panel, 24.5, 0, 8), {floors: 8, floorH: 24.5 / 8});
  assert.equal(floorGrid(FACADE.panel, 16.5, 0, 0).floors, 6);
  assert.equal(floorGrid(FACADE.office, 40, 30, 12).floors, 3, 'a part from 30 m counts only its own storeys');
  assert.equal(floorGrid(FACADE.house, 1.2, 0, 0).floors, 1);
});

test('facade styles come from material, type and height tags', () => {
  const r = () => 0.1;
  assert.equal(facadeStyle({}, 'garage', 3, r), FACADE.blank);
  assert.equal(facadeStyle({'building:material': 'glass'}, 'yes', 12, r), FACADE.glass);
  assert.equal(facadeStyle({}, 'office', 80, r), FACADE.glass);
  assert.equal(facadeStyle({}, 'warehouse', 9, r), FACADE.industrial);
  assert.equal(facadeStyle({'building:material': 'brick'}, 'apartments', 20, r), FACADE.brick);
  assert.equal(facadeStyle({}, 'house', 7, r), FACADE.house);
  assert.equal(facadeStyle({}, 'office', 18, r), FACADE.office);
  assert.equal(facadeStyle({heritage: '2'}, 'yes', 18, r), FACADE.classic);
  assert.equal(facadeStyle({}, 'apartments', 30, r), FACADE.panel);
  for (const [, storey, bay, lit, layer] of FACADES) assert.ok(storey > 2 && bay > 1 && lit >= 0 && lit <= 1 && WALL_SURFACES[layer]);
});

test('the region sets the mix for untagged buildings, and French blocks get mansards', () => {
  const fr = regionOf('FR'), r = () => 0.5;
  assert.equal(facadeStyle({}, 'apartments', 25, r, fr), FACADE.classic);
  assert.equal(facadeStyle({}, 'apartments', 25, r, fr, false), FACADE.panel, 'a free-standing block is a modern one');
  assert.equal(facadeStyle({}, 'apartments', 25, r), FACADE.panel, 'the generic mix builds panel blocks');
  assert.equal(facadeStyle({}, 'apartments', 25, r, regionOf('US')), FACADE.brick);
  assert.equal(facadeStyle({ 'building:material': 'concrete' }, 'yes', 25, r, fr), FACADE.panel, 'tags still decide first');
  assert.equal(regionOf('RO'), regionOf(''), 'unlisted countries keep the generic mix');
  for (const g of [...REGIONS, regionOf('')]) {
    for (const k of ['low', 'mid', 'tall', 'free'].filter(k => g[k])) {
      assert.ok(Math.abs(Object.values(g[k]).reduce((a, b) => a + b) - 1) < 1e-9, g.name + ' ' + k);
      for (const s in g[k]) assert.ok(s in FACADE, s);
    }
    for (const s in g.walls || {}) assert.ok(s in FACADE && g.walls[s].every(c => /^#[0-9a-f]{6}$/.test(c)), s);
    assert.ok(g.metal >= 0 && g.metal <= 1);
  }
  assert.ok(mansardRoof({}, 'apartments', 7, 0, fr));
  assert.ok(mansardRoof({}, 'yes', 0, 20, fr), 'a tagged height counts when the levels are missing');
  assert.ok(!mansardRoof({}, 'apartments', 7, 0, regionOf('RO')), 'only where the region builds them');
  assert.ok(!mansardRoof({}, 'apartments', 7, 0, fr, false), 'only in a terrace');
  for (const [t, type, lv] of [[{}, 'house', 5], [{}, 'office', 6], [{}, 'church', 6], [{}, 'apartments', 2], [{}, 'apartments', 14],
    [{ 'roof:levels': '0' }, 'apartments', 6], [{ 'building:material': 'glass' }, 'apartments', 6], [{}, 'yes', 0]]) assert.ok(!mansardRoof(t, type, lv, 0, fr), type + ' ' + lv);
});

test('the wall atlas paints every cell in both layers inside its bounds', () => {
  for (const layer of ['color', 'mask']) {
    const fills = []; let t = [0, 0];
    const ctx = { save() {}, restore() { t = [0, 0]; }, translate(x, y) { t = [t[0] + x, t[1] + y]; }, fillRect(x, y, w, h) { fills.push([x + t[0], y + t[1], w, h, this.fillStyle]); },
      createLinearGradient: () => ({ addColorStop() {} }), beginPath() {}, fill() {} };
    wallAtlas(ctx, layer);
    const S = ATLAS_CELL;
    for (let c = 0; c < FACADES.length; c++) for (const row of [0, S]) assert.ok(fills.some(([x, y]) => x === c * S && y === row), 'cell ' + c + ',' + row);
    if (layer === 'mask') {
      assert.ok(fills.every(f => /^rgb\((0|255),(0|255),\d+\)$/.test(f[4])));
      assert.ok(fills.some(f => f[4].startsWith('rgb(255,255,')), 'glass is marked');
    }
  }
});

test('photo levelling keeps the surface and drops the photo\'s own colour', () => {
  const px = new Uint8Array([200, 100, 50, 255, 100, 50, 25, 255]); // two reddish pixels, one twice as bright
  levelPhoto(px, 0.8);
  assert.deepEqual([...px.slice(0, 3)], [272, 272, 272].map(v => Math.min(255, v))); // 255 * 0.8 * 4/3, clamped
  assert.deepEqual([...px.slice(4, 7)], [136, 136, 136]);
  assert.equal(px[3], 255, 'alpha is left alone');
  const flat = levelPhoto(new Uint8Array([90, 90, 90, 255, 110, 110, 110, 255]), 0.5, 2);
  assert.deepEqual([flat[0], flat[4]], [102, 153], 'contrast doubles the spread around the target');
});

test('every photo surface is in textures/ and credited there', () => {
  const credits = readFileSync(new URL('../textures/README.md', import.meta.url), 'utf8');
  for (const [file, metres, contrast] of Object.values(SURFACES)) {
    assert.ok(existsSync(new URL('../textures/' + file + '.jpg', import.meta.url)), file);
    assert.ok(credits.includes(file) && metres > 1 && contrast > 0, file);
  }
  for (const k of WALL_SURFACES) assert.ok(SURFACES[k], k);
});
