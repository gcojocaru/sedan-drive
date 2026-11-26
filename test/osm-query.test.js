import test from 'node:test';
import assert from 'node:assert/strict';
import { HALF, MARGIN, CACHE_V, SNAP, snap, onGrid, areaKey, overpassQuery, overpassError } from '../osm-query.js';

test('start points snap to the grid and stay on it', () => {
  assert.equal(snap(44.42712), 44.427);
  assert.equal(snap(26.10274), 26.1025);
  assert.equal(snap(-0.00026), -0.0005);
  for (const v of [44.42712, 26.10274, -33.86881, 151.20929, 0]) assert.ok(onGrid(snap(v)), v + ' snapped off the grid');
  assert.ok(!onGrid(44.4271) && !onGrid(NaN) && !onGrid(Infinity));
  assert.ok(Math.abs(SNAP * 111320 - 55) < 1, 'grid is about 55 m');
});

test('cache key names the version, the snapped point and the area size', () => {
  assert.equal(areaKey(44.427, 26.1025), CACHE_V + '44.4270,26.1025:' + HALF);
  assert.notEqual(areaKey(44.427, 26.1025), areaKey(44.4275, 26.1025));
});

test('the query covers the playable area plus the margin', () => {
  const q = overpassQuery(0, 0), d = (HALF + MARGIN) / 110574;
  assert.match(q, /^\[out:json\]/);
  assert.ok(q.includes('(' + [-d, -(HALF + MARGIN) / 111320, d, (HALF + MARGIN) / 111320].map(v => v.toFixed(6)).join(',') + ')'));
  assert.match(q, /out geom qt;$/);
});

test('the area query includes named landmarks and limits new relation searches to multipolygons', () => {
  const q = overpassQuery(0, 0);
  for (const tags of ['["shop"]', '["railway"~"^(station|halt)$"]', '["public_transport"="station"]', '["amenity"="bus_station"]']) {
    for (const type of ['node', 'way', 'relation["type"="multipolygon"]']) {
      assert.ok(q.includes(type + tags + '["name"]('), type + tags);
    }
    assert.ok(!q.includes('relation' + tags), tags + ' must exclude route and stop-area relations');
  }
  assert.ok(q.includes('node["leisure"~"^(park|garden)$"]["name"]('));
  assert.ok(!areaKey(0, 0).startsWith('osm5:'), 'old cached areas have no landmark nodes');
});

test('only error remarks count as failures', () => {
  assert.equal(overpassError('runtime error: Query timed out'), 'runtime error: Query timed out');
  assert.equal(overpassError('some note'), null);
  assert.equal(overpassError(undefined), null);
});

test('area requests include standalone house numbers and invalidate pre-address downloads', () => {
  assert.ok(overpassQuery(0,0).includes('node["addr:housenumber"]('));
  assert.ok(!areaKey(0,0).startsWith('osm7:'));
});
