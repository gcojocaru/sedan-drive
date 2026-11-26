import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeTile, fetchVectorArea } from '../vector-fallback.js';

// A minimal Mapbox Vector Tile encoder, so the test builds its own tile instead of downloading one.
const varint = n => { const o = []; while (n > 127) { o.push(n & 127 | 128); n = Math.floor(n / 128); } o.push(n); return o; };
const field = (f, wt) => varint(f * 8 + wt);
const bytes = (f, b) => [...field(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...new TextEncoder().encode(s)]);
const uint = (f, n) => [...field(f, 0), ...varint(n)];
const packed = (f, a) => bytes(f, a.flatMap(varint));
const zz = n => (n << 1) ^ (n >> 31);
function geom(rings, close) { // MoveTo, LineTo…, [ClosePath] per ring, deltas zigzag-encoded
  let x = 0, y = 0; const o = [];
  for (const r of rings) {
    r.forEach(([px, py], i) => { if (i === 0) o.push(9); else if (i === 1) o.push((r.length - 1) << 3 | 2); o.push(zz(px - x), zz(py - y)); x = px; y = py; });
    if (close) o.push(15);
  }
  return o;
}
function layer(name, feats) { // feats: [{ type, rings, props }]
  const keys = [], values = [], idx = (a, v) => { const i = a.indexOf(v); return i < 0 ? a.push(v) - 1 : i; };
  const fs = feats.map(f => [...uint(3, f.type), ...packed(2, Object.entries(f.props).flatMap(([k, v]) => [idx(keys, k), idx(values, v)])), ...packed(4, geom(f.rings, f.type === 3))]);
  const val = v => typeof v === 'string' ? str(1, v) : uint(5, v);
  return bytes(3, [...uint(15, 2), ...str(1, name), ...fs.flatMap(f => bytes(2, f)), ...keys.flatMap(k => str(3, k)), ...values.flatMap(v => bytes(4, val(v))), ...uint(5, 4096)]);
}
const square = (a, b) => [[a, a], [b, a], [b, b], [a, b]], reversed = r => r.slice().reverse();
const tile = new Uint8Array([
  ...layer('transportation', [{ type: 2, rings: [[[10, 50], [400, 50]]], props: { class: 'minor' } }]),
  ...layer('transportation_name', [{ type: 2, rings: [[[0, 52], [500, 52]]], props: { class: 'minor', name: 'Test Street' } }]),
  ...layer('building', [{ type: 3, rings: [square(100, 140)], props: { render_height: 20 } }]),
  ...layer('landuse', [{ type: 3, rings: [square(200, 400), reversed(square(250, 300))], props: { class: 'residential' } }]),
]).buffer;

test('decodeTile reads layers, keys, values and geometry', () => {
  const L = decodeTile(tile);
  assert.deepEqual(Object.keys(L), ['transportation', 'transportation_name', 'building', 'landuse']);
  assert.equal(L.building.extent, 4096);
  assert.deepEqual(L.transportation_name.keys, ['class', 'name']);
  assert.deepEqual(L.transportation_name.values, ['minor', 'Test Street']);
  assert.equal(L.building.values[0], 20);
  assert.equal(L.landuse.feats[0].type, 3);
  assert.deepEqual(decodeTile(new ArrayBuffer(0)), {});
});

async function fetchAtOrigin(tiles, urls = []) {
  return fetchVectorArea(0, 0, async url => {
    urls.push(url);
    if (!url.endsWith('.pbf')) return { ok: true, json: async () => ({ tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'], maxzoom: 14 }) };
    return { ok: true, arrayBuffer: async () => tiles[new URL(url).pathname] || new ArrayBuffer(0) };
  });
}

test('fetchVectorArea turns tiles into Overpass-shaped elements', async () => {
  const urls = [];
  const { elements, fallback } = await fetchAtOrigin({ '/14/8192/8192.pbf': tile }, urls);
  assert.equal(fallback, true);
  assert.equal(urls.length, 1 + 4, 'TileJSON plus the 2×2 tiles around the equator/meridian');

  const road = elements.find(e => e.tags.highway);
  assert.equal(road.type, 'way');
  assert.deepEqual(road.tags, { highway: 'residential', name: 'Test Street' });
  assert.equal(road.geometry.length, 2);
  for (const p of road.geometry) assert.ok(p.lat < 0 && p.lat > -0.01 && p.lon > 0 && p.lon < 0.01, JSON.stringify(p));

  const house = elements.find(e => e.tags.building);
  assert.equal(house.type, 'way');
  assert.deepEqual(house.tags, { building: 'yes', height: '20' });
  assert.deepEqual(house.geometry[0], house.geometry[house.geometry.length - 1], 'polygon rings are closed');

  const land = elements.find(e => e.tags.landuse);
  assert.equal(land.type, 'relation');
  assert.deepEqual(land.members.map(m => m.role), ['outer', 'inner']);
});

test('fallback keeps names attached to roads, buildings and park polygons', async () => {
  const fixture = new Uint8Array([
    ...layer('transportation', [{ type: 2, rings: [[[10, 50], [400, 50]]], props: { class: 'minor', name: 'Oak Lane' } }]),
    ...layer('transportation_name', [{ type: 2, rings: [[[10, 52], [400, 52]]], props: { class: 'minor', name: 'Nearby Lane' } }]),
    ...layer('building', [{ type: 3, rings: [square(80, 110)], props: { name: 'Old Mill' } }]),
    ...layer('landuse', [
      { type: 3, rings: [square(150, 250)], props: { class: 'park', name: 'Parcul Mic' } },
      { type: 3, rings: [square(300, 400)], props: { class: 'park' } }
    ]),
  ]).buffer;
  const { elements } = await fetchAtOrigin({ '/14/8192/8192.pbf': fixture });
  assert.equal(elements.find(e => e.tags.highway).tags.name, 'Oak Lane');
  assert.equal(elements.find(e => e.tags.building).tags.name, 'Old Mill');
  assert.deepEqual(elements.filter(e => e.tags.leisure === 'park').map(e => e.tags.name), ['Parcul Mic', undefined]);
});

test('fallback emits named, classified POI points once at their mapped location', async () => {
  const point = (props, x = 50) => ({ type: 1, rings: [[[x, 50]]], props });
  const store = { class: 'shop', subclass: 'florist', name: 'Flori' };
  const fixture = new Uint8Array(layer('poi', [
    point(store),
    point({ class: 'grocery', subclass: 'supermarket', name: 'Co-op' }),
    point({ class: 'railway', subclass: 'station', name: 'Gara Nord' }),
    point({ class: 'railway', subclass: 'halt', name: 'Brook' }),
    point({ class: 'railway', subclass: 'subway', name: '地下鉄' }),
    point({ class: 'bus', subclass: 'bus_station', name: 'Terminal' }),
    point({ class: 'park', subclass: 'park', name: 'Parcul Mare' }),
    point({ class: 'garden', subclass: 'garden', name: 'Rose Garden' }),
    point({ class: 'shop', subclass: 'convenience' }),
    point({ name: 'Label only' }),
    point({ class: 'bus', subclass: 'bus_stop', name: 'Request stop' }),
    point({ class: 'bench' }),
    point({ class: 'bollard' }),
    point({ class: 'grocery', subclass: 'marketplace', name: 'Market' }),
    point({ class: 'park', subclass: 'bbq', name: 'Picnic spot' }),
    point({ class: 'shop', name: 'Beyond the area' }, 3500),
  ])).buffer;
  const west = new Uint8Array(layer('poi', [point(store, 4096 + 50)])).buffer;
  const { elements } = await fetchAtOrigin({ '/14/8192/8192.pbf': fixture, '/14/8191/8192.pbf': west });
  assert.deepEqual(elements.map(e => e.tags), [
    { name: 'Flori', shop: 'florist' },
    { name: 'Co-op', shop: 'supermarket' },
    { name: 'Gara Nord', railway: 'station' },
    { name: 'Brook', railway: 'halt' },
    { name: '地下鉄', railway: 'station', station: 'subway' },
    { name: 'Terminal', amenity: 'bus_station' },
    { name: 'Parcul Mare', leisure: 'park' },
    { name: 'Rose Garden', leisure: 'garden' },
    { name: 'Request stop', highway: 'bus_stop' },
    { amenity: 'bench' },
    { barrier: 'bollard' },
  ]);
  for (const node of elements) {
    assert.equal(node.type, 'node');
    assert.ok(node.lat < -0.00026 && node.lat > -0.00027);
    assert.ok(node.lon > 0.00026 && node.lon < 0.00027);
  }
});

test('fallback keeps house-number point labels and ignores the adjacent tile buffer', async () => {
  const feature=(x,number)=>({type:1,rings:[[[x,50]]],props:{housenumber:number}});
  const tile=new Uint8Array(layer('housenumber',[feature(50,'12B'),feature(70,14),feature(-1,'outside')])).buffer;
  const {elements}=await fetchAtOrigin({'/14/8192/8192.pbf':tile});
  assert.deepEqual(elements.map(e=>e.tags['addr:housenumber']),['12B','14']);
});
