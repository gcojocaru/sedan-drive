import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoads } from '../road-layout.js';
import { laneGraph, createTraffic } from '../traffic.js';
import { walkGraph, createPedestrians, SIDEWALK, CROSSWALK, PEOPLE } from '../pedestrians.js';
import { seeded } from '../geom.js';

const street = (g, nodes, t = {}) => ({ g, nodes, hw: 3.5, walk: true, name: '', t: { highway: 'residential', ...t }, type: 'residential', drive: true });
// world.js's roadAt, for straight test roads: the nearest drivable segment and how far outside it (m)
const lookup = roads => (x, z) => {
  let drv = null, de = Infinity;
  for (const r of roads) for (let i = 1; i < r.g.length; i++) {
    const [ax, az] = r.g[i - 1], dx = r.g[i][0] - ax, dz = r.g[i][1] - az, l2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const e = Math.hypot(x - ax - dx * t, z - az - dz * t) - r.hw;
    if (e < de) { de = e; drv = { ax, az, dx, dz, l2, hw: r.hw, r }; }
  }
  return { drv, de, any: drv, ae: de };
};
// n × n streets `gap` m apart, with sidewalks; the traffic graph and the walk graph over them
function town(n = 3, gap = 100, extra = {}) {
  const id = (i, j) => i * 100 + j, at = k => (k - (n - 1) / 2) * gap, roads = [];
  for (let j = 0; j < n; j++) roads.push(street([...Array(n)].map((_, i) => [at(i), at(j)]), [...Array(n)].map((_, i) => id(i, j))));
  for (let i = 0; i < n; i++) roads.push(street([...Array(n)].map((_, j) => [at(i), at(j)]), [...Array(n)].map((_, j) => id(i, j))));
  const { junctions } = prepareRoads(roads, 'right'), graph = laneGraph(roads, junctions, 500, extra.signals ?? null), roadAt = lookup(roads);
  const walks = walkGraph(roads, extra.paths || [], junctions, { armBack: graph.armBack, roadAt, crossings: extra.crossings || [] });
  return { roads, junctions, graph, walks, roadAt };
}
const reach = (walks, from) => { const seen = new Set([from]), q = [from]; while (q.length) for (const e of q.pop().edges) for (const n of [e.a, e.b]) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen; };

test('sidewalks run along both kerbs, with a crosswalk over every arm and a way round every corner', () => {
  const { walks, graph } = town();
  const crossings = walks.edges.filter(e => e.cross), middle = crossings.filter(e => e.cross.at[0] === 0 && e.cross.at[1] === 0);
  assert.equal(middle.length, 4, 'four crosswalks at the crossroads');
  const east = middle.find(e => e.cross.dir[0] > 0.99), back = graph.armBack(east.cross.road, 1, 1);
  for (const p of east.pts) assert.ok(Math.abs(p[0] - (back + CROSSWALK)) < 1e-9, 'the crosswalk runs ' + (back + CROSSWALK) + ' m out, at ' + p[0]);
  assert.ok(Math.abs(Math.abs(east.pts[0][1]) - (3.5 + SIDEWALK)) < 1e-9, 'from sidewalk to sidewalk');
  const along = walks.edges.find(e => !e.cross && e.pts.every(p => p[1] > 0 && p[1] < 10 && p[0] > 5 && p[0] < 95));
  assert.ok(along && along.pts.every(p => Math.abs(p[1] - (3.5 + SIDEWALK)) < 1e-9), 'a sidewalk along the kerb of the road along z = 0');
  assert.equal(reach(walks, walks.nodes[0]).size, walks.nodes.length, 'every walkway connects');
});

test('a footway ending near a sidewalk is joined to it, not one that would need to cross the road; mapped crossings go kerb to kerb', () => {
  const near = { g: [[20, 30], [20, 6.8]], type: 'footway', t: {} }, across = { g: [[60, -30], [60, -7.4]], type: 'footway', t: {} };
  const { walks } = town(3, 100, { paths: [near, across], crossings: [[30, 0]] });
  const foot = walks.edges.find(e => e.pts[0][0] === 20 && e.pts[0][1] === 30), stub = walks.edges.find(e => e.pts[0][0] === 60);
  assert.ok(reach(walks, foot.a).size > 50, 'the footway reaches the sidewalks');
  const zebra = walks.edges.find(e => e.cross && !e.cross.at);
  assert.ok(zebra && Math.abs(zebra.pts[0][0] - 30) < 1e-9 && zebra.a.edges.length > 1 && zebra.b.edges.length > 1, 'the mapped crossing is joined at both kerbs');
  assert.ok(stub, 'the other footway is kept');
});

// how far into a carriageway (m) each person is, unless they are on a crossing
const stray = (people, roadAt) => people.filter(p => !p.edge.cross && roadAt(p.x, p.z).de < -0.3);

test('people walk the sidewalks and keep off the road except at crossings', () => {
  const { walks, roadAt } = town(3, 100, { crossings: [[30, 0]] }), sim = createPedestrians(walks, { rand: seeded(3) });
  sim.setLevel(3, 0, 0);
  assert.ok(sim.people.length > 30, sim.people.length + ' people');
  let crossed = 0, bad = 0;
  for (let t = 0; t < 30 * 90; t++) { sim.step(1 / 30, { x: 0, z: 0, h: 0, v: 0 }); bad += stray(sim.people, roadAt).length; crossed += sim.people.filter(p => p.edge.cross && p.state === 'walk').length; }
  assert.equal(bad, 0, 'nobody walked in the road');
  assert.ok(crossed > 0, 'and some crossed it');
});

test('at a light people cross in its walk phase, never while a car there has green, and are over before it ends', () => {
  const { walks, graph } = town(3, 100, { signals: [[0, 0]] }), traffic = createTraffic(graph, { rand: seeded(8) }), sim = createPedestrians(walks, { rand: seeded(9) });
  const lit = walks.edges.filter(e => e.cross?.at && e.cross.at[0] === 0 && e.cross.at[1] === 0);
  for (const e of lit) for (const k of [0, 1, 2]) { const p = sim.add(e, 0, 1); p.state = 'kerb'; p.speed = 1.1 + k * 0.1; }
  for (let i = 0; i < 12; i++) { const e = graph.signals[i % 4].e; traffic.add(e, 0, Math.max(2, e.lanes[0].len - 15 - 9 * Math.floor(i / 4))); }
  let started = 0, wrong = 0, caught = 0;
  const was = new Map(sim.people.map(p => [p, p.state]));
  for (let t = 0; t < 30 * 150; t++) {
    traffic.step(1 / 30, null, sim.crossing); sim.step(1 / 30, null, traffic.cars, graph.signals);
    for (const p of sim.people) {
      if (was.get(p) === 'kerb' && p.state === 'walk' && p.edge.cross?.heads?.length) { started++; if (graph.signals.some(h => h.state !== 'red' || !(h.walk > 0))) wrong++; }
      if (p.edge.cross?.heads?.length && p.state === 'walk' && graph.signals.some(h => h.state === 'green')) caught++;
      was.set(p, p.state);
    }
  }
  assert.ok(started >= 12, started + ' crossings started');
  assert.equal(wrong, 0, 'nobody stepped out unless every light at the junction was red, in the walk phase');
  assert.equal(caught, 0, 'and nobody was still crossing when cars got green');
  assert.ok(lit.every(e => e.cross.heads.length === 4), 'every light at the junction counts, not only the crossed road\'s');
});

test('away from lights people wait for a gap, and cars stop for people on a crossing', () => {
  const roads = [street([[-200, 0], [200, 0]], [1, 2])], { junctions } = prepareRoads(roads, 'right'), graph = laneGraph(roads, junctions, 500);
  const walks = walkGraph(roads, [], junctions, { armBack: graph.armBack, roadAt: lookup(roads), crossings: [[0, 0]] });
  const zebra = walks.edges.find(e => e.cross), sim = createPedestrians(walks, { rand: seeded(1) }), traffic = createTraffic(graph, { rand: seeded(2) });
  const p = sim.add(zebra, zebra.a.z > 0 ? 0 : zebra.len, zebra.a.z > 0 ? 1 : -1); p.state = 'kerb';
  const car = traffic.add(graph.edges.find(e => e.dirA[0] > 0), 0, 170); car.v = 9; // coming from the west, 30 m from the crossing at x = 0
  let left = null;
  for (let t = 0; t < 30 * 40 && !left; t++) { traffic.step(1 / 30, null, sim.crossing); sim.step(1 / 30, null, traffic.cars, []); if (p.state === 'walk') left = { x: car.x }; }
  assert.ok(left && left.x > 2.5, 'they waited for the car to pass the crossing (it was at ' + left?.x + ')');
  // and the other way round: a person already on the crossing stops the next car
  const next = traffic.add(graph.edges.find(e => e.dirA[0] > 0), 0, 150); next.v = 9;
  sim.people.length = 0; const q = sim.add(zebra, zebra.len / 2, 1); q.speed = 0; // stood still in the middle of it
  for (let t = 0; t < 30 * 30; t++) { traffic.step(1 / 30, null, sim.people); sim.step(1 / 30, null, traffic.cars, []); }
  assert.ok(next.x < -2 && next.v < 0.1, 'the car waits before the crossing, at ' + next.x);
});

test('people get out of the way of the player, and a car can tell who it would touch', () => {
  const { walks } = town(), sim = createPedestrians(walks, { rand: seeded(4) });
  const e = walks.edges.find(e => !e.cross && e.pts.every(p => p[1] > 0 && p[1] < 10 && p[0] > 5 && p[0] < 95)), p = sim.add(e, e.len / 2, 1);
  const player = { x: p.x - 25, z: p.z, h: 0, v: 10 };
  let touched = 0;
  for (let t = 0; t < 30 * 4; t++) { player.x += player.v / 30; sim.step(1 / 30, player); if (sim.hit(player.x, player.z, player.h)) touched++; }
  assert.equal(touched, 0, 'they stepped aside');
  const q = sim.add(e, e.len / 2, 1);
  assert.equal(sim.hit(q.x + 1, q.z, 0)?.id, q.id);
  assert.equal(sim.hit(q.x + 1, q.z - 2, 0)?.id ?? null, null);
  sim.bump(q, q.x - 1, q.z);
  assert.equal(q.state, 'stagger');
  sim.setLevel(0, 0, 0);
  assert.equal(sim.people.length, 0);
  assert.equal(PEOPLE[0][0], 'Off');
});
