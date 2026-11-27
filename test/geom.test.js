import test from 'node:test';
import assert from 'node:assert/strict';
import { joinRings, inPoly, polyArea, signedArea, bbox, openRing, obb, clipHalf, ribbon, newBuf, tri3, seeded, segDist, seaPolys, offsetRing, trimLine, pointAt, pointGrid } from '../geom.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, a + ' is not ' + b);
const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];

test('joinRings closes a ring from pieces in any direction', () => {
  const rings = joinRings([[[0, 0], [10, 0], [10, 10]], [[0, 0], [0, 10], [10, 10]]]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  near(polyArea(rings[0]), 100);
  assert.deepEqual(joinRings([[[0, 0], [1, 0], [1, 1]]]), [], 'an open chain is dropped');
});

test('point in polygon, areas, winding, bounds', () => {
  assert.ok(inPoly(5, 5, square) && !inPoly(15, 5, square) && !inPoly(-1, 5, square));
  near(polyArea(square), 100);
  assert.equal(Math.sign(signedArea(square)), -Math.sign(signedArea(square.slice().reverse())));
  assert.deepEqual(bbox(square), { x0: 0, z0: 0, x1: 10, z1: 10 });
  assert.deepEqual(openRing(square), square.slice(0, 4));
});

test('obb finds a rotated rectangle and its long axis', () => {
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a), R = ([x, z]) => [3 + x * c - z * s, 4 + x * s + z * c];
  const o = obb([[-5, -2], [5, -2], [5, 2], [-5, 2]].map(R));
  near(o.cx, 3, 1e-6); near(o.cz, 4, 1e-6); near(o.hl, 5, 1e-6); near(o.hw, 2, 1e-6); near(o.ar, 40, 1e-6);
  near(Math.abs(o.ux * c + o.uz * s), 1, 1e-6);
});

test('clipHalf keeps the side where a + b*x + c*z <= 0', () => {
  const half = clipHalf(openRing(square), -4, 1, 0); // x <= 4
  near(polyArea(half), 40);
  assert.ok(half.every(p => p[0] <= 4 + 1e-9));
  assert.deepEqual(clipHalf(openRing(square), 1, 0, 0), []);
});

test('ribbon lays a flat strip of the given half width at height y', () => {
  const B = newBuf(); ribbon(B, [[0, 0], [10, 0]], 1, 0.05, false);
  assert.equal(B.p.length, 2 * 3 * 3);
  for (let i = 0; i < B.p.length; i += 3) { near(B.p[i + 1], 0.05); near(Math.abs(B.p[i + 2]), 1); }
});

test('tri3 winds triangles to face the given normal', () => {
  const B = { p: [], n: [], c: [] }, col = { r: 1, g: 1, b: 1 };
  tri3(B, [0, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0], col); // given clockwise seen from above
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = B.p, ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  assert.ok(ny > 0, 'faces up');
  tri3(B, [0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], col);
  assert.equal(B.p.length, 9, 'degenerate triangles are skipped');
});

test('seeded random is repeatable and in [0, 1)', () => {
  const a = seeded(42), b = seeded(42), xs = Array.from({ length: 1000 }, a);
  assert.deepEqual(xs.slice(0, 5), Array.from({ length: 5 }, b));
  assert.ok(xs.every(x => x >= 0 && x < 1));
});

test('segDist gives the distance to a segment and where along it', () => {
  const s = { ax: 0, az: 0, dx: 10, dz: 0, l2: 100 };
  assert.deepEqual(segDist(5, 3, s), [3, 0.5]);
  assert.deepEqual(segDist(-4, 3, s), [5, 0]);
});

test('seaPolys puts the sea on the right of the coastline and leaves islands dry', () => {
  // x east, z south: a coast running east has land to the north (z < 0) and sea to the south
  const sea = seaPolys([[[-800, 0], [800, 0]]], 550, 3000);
  assert.equal(sea.length, 1);
  assert.ok(inPoly(0, 100, sea[0].outer) && !inPoly(0, -100, sea[0].outer));
  // an island: a closed coastline ring, anticlockwise in (east, north)
  const island = [[0, 0], [0, -100], [-100, -100], [-100, 0], [0, 0]];
  const open = seaPolys([island], 550, 3000);
  assert.equal(open.length, 1);
  assert.equal(open[0].holes.length, 1);
  assert.ok(inPoly(200, 200, open[0].outer) && inPoly(-50, -50, open[0].holes[0]));
});

test('offsetRing moves edges out (or in) by d whichever way the ring winds', () => {
  const sq = openRing(square);
  assert.deepEqual(offsetRing(sq, 1), [[-1, -1], [11, -1], [11, 11], [-1, 11]]);
  assert.deepEqual(offsetRing([...sq].reverse(), -0.5), [[0.5, 9.5], [9.5, 9.5], [9.5, 0.5], [0.5, 0.5]]);
  const spike = offsetRing([[0, 0], [10, 0], [0, 1]], 1); // a sharp corner's mitre is capped at 2d
  assert.ok(Math.hypot(spike[1][0] - 10, spike[1][1]) <= 2 + 1e-9);
});

test('a polyline trimmed at both ends, and points along it', () => {
  const g = [[0, 0], [10, 0], [10, 10]], cum = [0, 10, 20];
  assert.deepEqual(trimLine(g, 2, 3), [[2, 0], [10, 0], [10, 7]]);
  assert.deepEqual(trimLine(g, 12, 0), [[10, 2], [10, 10]]);
  assert.deepEqual(pointAt(g, cum, 5), [5, 0, 1, 0]);
  assert.deepEqual(pointAt(g, cum, 15), [10, 5, 0, 1]);
  assert.deepEqual(pointAt(g, cum, 99), [10, 10, 0, 1], 'clamped to the end');
});

test('pointGrid finds round obstacles by distance, pad and height, across cell edges', () => {
  const g = pointGrid([[3.9, 0, 0.2, 0, 3], [-10, -10, 0.5, 2, 3]]);
  assert.ok(g.near(4.05, 0, 1)); // the next cell over
  assert.ok(!g.near(4.5, 0, 1)); assert.ok(g.near(4.5, 0, 1, 0.5));
  assert.ok(!g.near(3.9, 0, 3.5)); // above it
  assert.ok(g.near(-10.3, -9.8, 2.5) && !g.near(-10.3, -9.8, 1.5));
  assert.ok(!pointGrid([]).near(0, 0, 0, 1));
});

test('splitByTile puts each triangle, with all its attributes, in the tile of its centre', async () => {
  const { splitByTile, gkey } = await import('../geom.js');
  const tri = (x, z) => [x, 0, z, x + 1, 0, z, x, 1, z + 1]; // centre ≈ (x + 1/3, z + 1/3)
  const B = { p: [...tri(1, 1), ...tri(10, 1), ...tri(-5, 2)], n: Array(27).fill(0), c: [...Array(9).fill(1), ...Array(9).fill(2), ...Array(9).fill(3)], f: [...Array(6).fill(7), ...Array(6).fill(8), ...Array(6).fill(9)] };
  const T = splitByTile(B, 8);
  assert.deepEqual([...T.keys()].sort((a, b) => a - b), [gkey(-1, 0), gkey(0, 0), gkey(1, 0)].sort((a, b) => a - b));
  assert.deepEqual(T.get(gkey(1, 0)).p, tri(10, 1)); assert.deepEqual(T.get(gkey(1, 0)).c, Array(9).fill(2)); assert.deepEqual(T.get(gkey(1, 0)).f, Array(6).fill(8));
  assert.equal(T.get(gkey(0, 0)).uv, undefined); // attributes it hasn't stay out
  const all = [...T.values()]; assert.equal(all.reduce((s, t) => s + t.p.length, 0), B.p.length); assert.equal(all.reduce((s, t) => s + t.f.length, 0), B.f.length);
});
