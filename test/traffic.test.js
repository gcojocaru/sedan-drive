import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoads } from '../road-layout.js';
import { laneGraph, createTraffic, lightAt, walkLeft, ranRed, roadLights, routeTo, LEVELS } from '../traffic.js';
import { seeded } from '../geom.js';

const LEN_ = 2.2; // a car's half length
const street = (g, nodes, t = {}) => ({ g, nodes, hw: 3.5, walk: true, name: '', t: { highway: 'residential', ...t }, type: t.highway || 'residential', drive: true });

// n × n two-way streets `gap` m apart; crossing vertices share their node ids
function grid(n = 3, gap = 100, side = 'right', signals = null, t = {}) {
  const id = (i, j) => i * 100 + j, at = k => (k - (n - 1) / 2) * gap, roads = [];
  for (let j = 0; j < n; j++) roads.push(street([...Array(n)].map((_, i) => [at(i), at(j)]), [...Array(n)].map((_, i) => id(i, j)), t));
  for (let i = 0; i < n; i++) roads.push(street([...Array(n)].map((_, j) => [at(i), at(j)]), [...Array(n)].map((_, j) => id(i, j)), t));
  const { junctions } = prepareRoads(roads, side);
  return { roads, graph: laneGraph(roads, junctions, 500, signals) };
}

// do two cars' bodies (4.4 × 1.75 m) overlap? separating axis test on their boxes
function overlap(a, b) {
  const box = c => { const f = [Math.cos(c.h), -Math.sin(c.h)], s = [Math.sin(c.h), Math.cos(c.h)]; return { c: [c.x, c.z], axes: [f, s], ext: [2.2, 0.875] }; };
  const A = box(a), B = box(b), d = [B.c[0] - A.c[0], B.c[1] - A.c[1]];
  for (const ax of [...A.axes, ...B.axes]) {
    const r = X => X.ext[0] * Math.abs(X.axes[0][0] * ax[0] + X.axes[0][1] * ax[1]) + X.ext[1] * Math.abs(X.axes[1][0] * ax[0] + X.axes[1][1] * ax[1]);
    if (Math.abs(d[0] * ax[0] + d[1] * ax[1]) > r(A) + r(B)) return false;
  }
  return true;
}

test('lanes keep to the driving side and stop short of junctions', () => {
  for (const [side, sign] of [['right', 1], ['left', -1]]) {
    const { graph } = grid(3, 100, side);
    assert.equal(graph.edges.length, 6 * 2 * 2); // 6 streets, each split once at the middle crossing, both ways
    assert.equal(graph.nodes.filter(n => n.junction).length, 5); // the middle crossing and the four T-junctions
    const east = graph.edges.find(e => e.g[0][1] === 0 && e.dirA[0] > 0.99 && e.g[0][0] === -100);
    for (const p of east.lanes[0].pts) assert.ok(Math.sign(p[1]) === sign && Math.abs(Math.abs(p[1]) - 1.575) < 1e-6, 'lane at z ' + p[1]);
    assert.ok(east.lanes[0].pts.at(-1)[0] < -3.5, 'the lane stops before the crossing street');
  }
});

test('one-way streets only carry traffic their way, and service roads none', () => {
  const roads = [street([[-50, 0], [50, 0]], [1, 2], { oneway: 'yes' }), street([[0, -50], [0, 50]], [3, 4], { highway: 'service' })];
  const g = laneGraph(roads, prepareRoads(roads, 'right').junctions, 500);
  assert.equal(g.edges.length, 1);
  assert.ok(g.edges[0].dirA[0] > 0.99);
  assert.equal(g.edges[0].lanes.length, 1);
});

test('cars rarely turn into a one-way street that leads nowhere', () => {
  const roads = [street([[-100, 0], [0, 0], [100, 0]], [1, 2, 3]), street([[100, -50], [100, 0], [100, 50]], [5, 3, 6]), street([[0, 0], [0, -60]], [2, 4], { oneway: 'yes' })];
  const g = laneGraph(roads, prepareRoads(roads, 'right').junctions, 500), sim = createTraffic(g, { rand: seeded(9) });
  const east = g.edges.find(e => e.g[0][0] === -100 && e.dirA[0] > 0), stub = g.edges.find(e => e.dirA[1] < -0.99 && e.g[0][0] === 0);
  let into = 0;
  for (let i = 0; i < 300; i++) if (sim.add(east, 0, 20).next === stub) into++;
  assert.ok(into < 10, into + ' of 300 turned into the dead end');
});

test('a car stops behind the player in its lane, and drives on when the player moves away', () => {
  const roads = [street([[-200, 0], [200, 0]], [1, 2])], g = laneGraph(roads, prepareRoads(roads, 'right').junctions, 500);
  const sim = createTraffic(g, { rand: seeded(3) }), east = g.edges.find(e => e.dirA[0] > 0);
  const car = sim.add(east, 0, 10), player = { x: 0, z: 1.575, h: 0, v: 0 };
  let hardest = 0;
  for (let t = 0; t < 1200; t++) { sim.step(1 / 30, player); hardest = Math.max(hardest, car.brake); }
  assert.ok(hardest > 1 && hardest < 9, 'it braked (' + hardest + ' m/s²)');
  assert.ok(car.v < 0.05, 'stopped, at ' + car.v + ' m/s');
  const bumperGap = player.x - car.x - 4.4;
  assert.ok(bumperGap > 0.8 && bumperGap < 4, 'gap ' + bumperGap);
  player.z = 20;
  for (let t = 0; t < 300; t++) sim.step(1 / 30, player);
  assert.ok(car.x > 10 && car.v > 5);
});

test('cars follow each other without touching', () => {
  const roads = [street([[-300, 0], [300, 0]], [1, 2])], g = laneGraph(roads, prepareRoads(roads, 'right').junctions, 500);
  const sim = createTraffic(g, { rand: seeded(5) }), east = g.edges.find(e => e.dirA[0] > 0);
  const slow = sim.add(east, 0, 60), fast = sim.add(east, 0, 10);
  slow.temper = 0.5; fast.temper = 1.1;
  let closest = Infinity;
  for (let t = 0; t < 900; t++) { sim.step(1 / 30, null); closest = Math.min(closest, slow.x - fast.x); }
  assert.ok(closest > 5.5, 'came within ' + closest + ' m');
  assert.ok(Math.abs(fast.v - slow.v) < 0.5, 'the faster car keeps the slower one\'s pace');
});

test('at a crossroads one car waits while the other crosses', () => {
  const { graph } = grid(3, 100), sim = createTraffic(graph, { rand: seeded(1) });
  const east = graph.edges.find(e => e.g[0][0] === -100 && e.g[0][1] === 0 && e.dirA[0] > 0), north = graph.edges.find(e => e.g[0][0] === 0 && e.g[0][1] === 100 && e.dirA[1] < 0);
  const a = sim.add(east, 0, east.lanes[0].len - 30), b = sim.add(north, 0, north.lanes[0].len - 30);
  // both go straight on: replan their routes from their first lane with that choice
  a.next = graph.edges.find(e => e.from === east.to && e.dirA[0] > 0.99); b.next = graph.edges.find(e => e.from === north.to && e.dirA[1] < -0.99);
  for (const c of [a, b]) c.route.length = 1;
  let together = 0, crossed = 0;
  const inside = c => Math.abs(c.x) < 6 && Math.abs(c.z) < 6;
  for (let t = 0; t < 30 * 30; t++) { sim.step(1 / 30, null); if (inside(a) && inside(b)) together++; if (a.x > 10 && b.z < -10) crossed++; }
  assert.equal(together, 0, 'both were in the crossing at once');
  assert.ok(crossed > 0, 'both got across');
});

test('a busy street grid keeps moving without collisions', () => {
  for (const side of ['right', 'left']) {
    const { graph } = grid(4, 90, side), sim = createTraffic(graph, { rand: seeded(11) });
    const lanes = graph.edges.flatMap(e => e.lanes);
    for (let i = 0; i < 40; i++) { const L = lanes[i % lanes.length]; sim.add(L.edge, L.k, 6 + (i * 13) % Math.max(1, L.len - 12)); }
    const start = sim.cars.map(c => c.s);
    let hits = 0;
    for (let t = 0; t < 30 * 120; t++) {
      sim.step(1 / 30, null);
      if (t % 5) continue;
      for (let i = 0; i < sim.cars.length; i++) for (let j = i + 1; j < sim.cars.length; j++) if (overlap(sim.cars[i], sim.cars[j])) hits++;
    }
    assert.equal(hits, 0, side + ': cars overlapped');
    const moved = sim.cars.map((c, i) => c.s - start[i]);
    assert.ok(moved.filter(m => m > 200).length >= sim.cars.length * 0.8, side + ': most cars got through junctions, moved ' + moved.map(Math.round));
    assert.ok(sim.cars.every(c => Number.isFinite(c.x + c.z + c.h)));
  }
});

test('a crooked city with one-way streets and wide avenues at sharp angles never jams or touches', () => {
  const R = seeded(6), n = 5, P = {}, at = k => (k - 2) * 80, roads = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) P[i * 10 + j] = [at(i) + (R() - 0.5) * 14, at(j) + (R() - 0.5) * 14];
  const way = (ids, t, hw) => ({ ...street(ids.map(k => P[k]), ids, t), hw, type: t.highway || 'residential' });
  for (let j = 0; j < n; j++) roads.push(way([...Array(n)].map((_, i) => i * 10 + j), j % 2 ? { oneway: 'yes' } : {}, 3.5));
  for (let i = 0; i < n; i++) roads.push(way([...Array(n)].map((_, j) => i * 10 + j), i === 2 ? { highway: 'primary', lanes: '4' } : i % 2 ? { oneway: '-1' } : {}, i === 2 ? 7 : 3.5));
  const diag = [];
  for (let k = 0; k < n; k++) { diag.push(k * 11); if (k < n - 1) { P[100 + k] = [(P[k * 11][0] + P[k * 11 + 11][0]) / 2 + 3, (P[k * 11][1] + P[k * 11 + 11][1]) / 2 - 3]; diag.push(100 + k); } }
  roads.push(way(diag, { highway: 'secondary', lanes: '4' }, 7)); // crosses the grid diagonally, at about 45°
  const graph = laneGraph(roads, prepareRoads(roads, 'right').junctions, 500), sim = createTraffic(graph, { rand: seeded(42) });
  const lanes = graph.edges.flatMap(e => e.lanes).filter(L => L.len > 14);
  for (let i = 0; i < 60; i++) { const L = lanes[(i * 7) % lanes.length], s = 4 + (i * 29) % Math.floor(L.len - 8); if (!sim.cars.some(c => c.route[0].p === L && Math.abs(c.s - s) < 9)) sim.add(L.edge, L.k, s); }
  let hits = 0, mid;
  for (let t = 0; t < 30 * 150; t++) {
    sim.step(1 / 30, null);
    if (t === 30 * 90) mid = new Map(sim.cars.map(c => [c, c.s]));
    if (t % 6) continue;
    for (let i = 0; i < sim.cars.length; i++) for (let j = i + 1; j < sim.cars.length; j++) if (overlap(sim.cars[i], sim.cars[j])) hits++;
  }
  assert.equal(hits, 0, 'cars overlapped');
  const parked = sim.cars.filter(c => c.s - mid.get(c) < 5).map(c => c.id);
  assert.deepEqual(parked, [], 'cars that did not move for the last minute');
});

test('a mapped signal puts a light on every road into its junction, in two phases that never show green together', () => {
  for (const [side, kerb] of [['right', 1], ['left', -1]]) {
    const { graph } = grid(3, 100, side, [[3, -4]]); // mapped a few metres off the middle crossing
    assert.equal(graph.signals.length, 4);
    const east = graph.signals.find(s => s.e.dirA[0] > 0.99), north = graph.signals.find(s => s.e.dirA[1] < -0.99);
    assert.ok(east.x < -3.5 && Math.abs(east.z - kerb * 4.1) < 1e-6, 'the head stands at the kerb before the crossing: ' + [east.x, east.z]);
    assert.ok(Math.abs(Math.cos(east.h) + 1) < 1e-9, 'and faces the cars coming in');
    const west = graph.signals.find(s => s.e.dirA[0] < -0.99);
    assert.equal(east.e.signal.phase, west.e.signal.phase);
    assert.notEqual(east.e.signal.phase, north.e.signal.phase);
    const seen = { green: 0, amber: 0, red: 0 };
    for (let t = 0; t < 200; t += 0.25) {
      const a = lightAt(east.e.signal, t), b = lightAt(north.e.signal, t);
      seen[a]++;
      assert.ok(a === 'red' || b === 'red', 'both axes had ' + a + '/' + b + ' at ' + t + ' s');
    }
    assert.ok(seen.green && seen.amber && seen.red);
  }
});

test('where the streets have sidewalks, each cycle ends with a walk phase: every light red, long enough to cross', () => {
  const { graph } = grid(3, 100, 'right', [[0, 0]]), ctrl = graph.signals[0].e.signal.ctrl;
  assert.ok(graph.signals.every(s => s.junction.some(p => p[0] === 0 && p[1] === 0)), 'each head knows its junction');
  assert.ok(ctrl.walk >= 6 + 2 * (3.5 + 1.1) / 1.25 - 0.5, 'time for the slowest walkers to cross: ' + ctrl.walk);
  let walking = 0, last = 0;
  for (let t = 0; t < 120; t += 0.25) {
    const w = walkLeft(ctrl, t);
    if (w > 0) { walking += 0.25; assert.ok(graph.signals.every(s => lightAt(s.e.signal, t) === 'red'), 'a car had a light other than red in the walk phase at ' + t); }
    if (w > 0 && last === 0) assert.ok(w > ctrl.walk - 0.3, 'it starts with all its time');
    last = w;
  }
  assert.ok(walking >= ctrl.walk, 'and comes round every cycle');
  // without sidewalks anywhere there, there's no walk phase
  const bare = grid(3, 100, 'right', [[0, 0]]), roads = bare.roads.map(r => ({ ...r, walk: false })), { junctions } = prepareRoads(roads, 'right');
  assert.equal(laneGraph(roads, junctions, 500, [[0, 0]]).signals[0].e.signal.ctrl.walk, 0);
});

test('running a red light is crossing a stop line into the junction while it shows red', () => {
  const { graph } = grid(3, 100, 'right', [[0, 0]]), east = graph.signals.find(s => s.e.dirA[0] > 0.99);
  const others = graph.signals.filter(s => s !== east);
  for (const s of graph.signals) s.state = 'green';
  const line = east.cx, lane = east.cz; // eastbound: the stop line runs north–south at x = line, its lane at z = lane
  assert.equal(ranRed(graph.signals, line - 2, lane, line + 1, lane), null, 'green');
  east.state = 'amber';
  assert.equal(ranRed(graph.signals, line - 2, lane, line + 1, lane), null, 'amber is allowed');
  east.state = 'red';
  assert.equal(ranRed(graph.signals, line - 2, lane, line + 1, lane), east);
  assert.equal(ranRed(graph.signals, line - 2, lane, line - 0.5, lane), null, 'stopping short');
  assert.equal(ranRed(graph.signals, line + 1, lane, line - 2, lane), null, 'leaving the junction the other way');
  assert.equal(ranRed(graph.signals, line - 2, lane - 8, line + 1, lane - 8), null, 'in the lanes going the other way');
  assert.ok(Math.abs(lane - 1.575) < 1e-6 && others.every(s => s.state === 'green'));
});

test('with no signals mapped, lights go where main roads cross, never at roundabouts or on side streets', () => {
  assert.equal(grid(3, 100, 'right', []).graph.signals.length, 0);
  assert.equal(grid(3, 100, 'right', [], { highway: 'secondary' }).graph.signals.length, 4); // only the middle crossing has four arms
  assert.equal(grid(3, 100, 'right', [], { highway: 'secondary', junction: 'roundabout' }).graph.signals.length, 0);
  assert.equal(grid(3, 100, 'right', null, { highway: 'secondary' }).graph.signals.length, 0);
});

test('cars stop at red and go on green, and never cross the stop line on red', () => {
  const { graph } = grid(3, 100, 'right', [[0, 0]]), sim = createTraffic(graph, { rand: seeded(4) });
  const ins = graph.signals.map(s => s.e);
  for (let i = 0; i < 16; i++) { const e = ins[i % 4]; sim.add(e, 0, Math.max(2, e.lanes[0].len - 12 - 9 * Math.floor(i / 4))); }
  const nose = new Map(), entered = { red: 0, amber: 0, green: 0 }; // what the light showed as each nose crossed a stop line
  let t = 0, hits = 0, waited = 0;
  for (let k = 0; k < 30 * 150; k++) {
    sim.step(1 / 30, null); t += 1 / 30;
    waited += sim.cars.filter(c => c.atLight && c.v < 0.1).length;
    for (const c of sim.cars) {
      const was = nose.get(c), now = c.s + LEN_;
      if (was !== undefined) for (const e of c.route) if (e.p.node && e.p.from.signal && was < e.at && now >= e.at) entered[lightAt(e.p.from.signal, t)]++;
      nose.set(c, now);
    }
    for (let i = 0; i < sim.cars.length; i++) for (let j = i + 1; j < sim.cars.length; j++) if (overlap(sim.cars[i], sim.cars[j])) hits++;
  }
  assert.equal(hits, 0, 'cars overlapped');
  assert.equal(entered.red, 0, 'a car entered on red');
  assert.ok(entered.green > 10, 'cars went through on green: ' + JSON.stringify(entered));
  assert.ok(waited > 30 * 20, 'and cars waited at red lights');
});

test('levels set how many cars live around the player, and hit() finds them', () => {
  const { graph } = grid(5, 80), sim = createTraffic(graph, { rand: seeded(2) });
  sim.setLevel(2, 0, 0);
  assert.ok(sim.target > 20 && sim.cars.length > sim.target * 0.8 && sim.cars.length <= sim.target, sim.cars.length + ' of ' + sim.target);
  assert.ok(sim.cars.every(c => Math.hypot(c.x, c.z) >= 25), 'none start on top of the player');
  const c = sim.cars[0];
  assert.equal(sim.hit(c.x + Math.cos(c.h) * 2, c.z - Math.sin(c.h) * 2), c);
  assert.ok(!sim.hit(c.x + Math.sin(c.h) * 1.2, c.z + Math.cos(c.h) * 1.2));
  sim.setLevel(1, 0, 0);
  assert.ok(sim.cars.length <= sim.target);
  sim.setLevel(0, 0, 0);
  assert.equal(sim.cars.length, 0);
  assert.equal(LEVELS[0][0], 'Off');
});

test('wet roads reflect headlights coming, tail lights going, and signals facing the eye', () => {
  const ahead = { x: 20, z: 0, h: Math.PI, braking: false }, away = { x: -20, z: 0, h: Math.PI, braking: true }; // both drive towards -x
  const [head, tail] = roadLights([ahead, away], [], 0, 0, 8, () => 5);
  assert.deepEqual(head.slice(4), [1, 0.92, 0.8], 'a car coming shows white headlights');
  assert.ok(Math.abs(head[0] - (20 - 2.2)) < 1e-9 && head[1] === 5.7 && head[3] > 0.99, 'at its nose, above the ground');
  assert.deepEqual(tail.slice(4), [1, 0.08, 0.04], 'a car going away shows red tail lights');
  assert.ok(tail[0] > -20 && tail[3] > 0.99, 'at its tail, bright while it brakes');
  assert.ok(roadLights([{ ...away, braking: false }], [], 0, 0, 8)[0][3] < 0.4, 'dim when it does not');
  const facing = { x: 10, z: 0, h: Math.PI, state: 'green' }, turned = { x: -10, z: 0, h: Math.PI, state: 'red' };
  const sig = roadLights([], [facing, turned], 0, 0, 8);
  assert.equal(sig.length, 1, 'a signal facing away shows nothing');
  assert.deepEqual(sig[0].slice(4), [0.15, 1, 0.45]); assert.equal(sig[0][1], 2.74);
  const many = Array.from({ length: 20 }, (_, i) => ({ x: 5 + i * 10, z: 0, h: Math.PI, braking: false }));
  const near = roadLights(many, [], 0, 0, 3);
  assert.deepEqual(near.map(l => Math.round(l[0])), [3, 13, 23], 'the n nearest');
});

test('the route goes by road the way traffic drives, from the car to the stop', () => {
  const { graph } = grid(3, 100);
  const near = (p, x, z, m) => Math.hypot(p[0] - x, p[1] - z) < m;
  const r = routeTo(graph, -60, 1.6, 0, 98.4, 50); // eastbound on z = 0, to a stop on the x = 100 street's southbound lane
  assert.ok(r && near(r.pts[0], -60, 1.6, 2) && near(r.pts.at(-1), 98.4, 50, 2), 'from the car to the stop');
  assert.ok(r.len > 200 && r.len < 240, 'about 160 m east, then 50 m south: ' + Math.round(r.len));
  const onStreet = ([x, z]) => Math.min(...[-100, 0, 100].flatMap(c => [Math.abs(x - c), Math.abs(z - c)])) < 8;
  assert.ok(r.pts.every((p, i) => onStreet(p) && (!i || onStreet([(p[0] + r.pts[i - 1][0]) / 2, (p[1] + r.pts[i - 1][1]) / 2]))), 'every point and every stretch between is on a street, none across a block');
  const ahead = routeTo(graph, -60, 1.6, 0, -20, 1.6);
  assert.ok(ahead && Math.abs(ahead.len - 40) < 1, 'a stop ahead on the same street: straight there');
  const turned = routeTo(graph, -60, 1.6, Math.PI, -20, 1.6);
  assert.ok(turned && turned.len >= ahead.len, 'facing the wrong way still finds it, and it is never shorter');
  assert.equal(routeTo(graph, -60, 1.6, 0, 400, 400), null, 'no road near the stop');
});

test('one-way streets are only routed their own way', () => {
  const { graph } = grid(3, 100, 'right', null, { oneway: 'yes' }); // every street one-way: east along x, south along z
  const r = routeTo(graph, -60, 0, 0, 0, 60);
  assert.ok(r, 'east then south is allowed');
  for (let i = 1; i < r.pts.length; i++) assert.ok(r.pts[i][0] >= r.pts[i - 1][0] - 1e-6 && r.pts[i][1] >= r.pts[i - 1][1] - 2, 'never back west or north');
  assert.equal(routeTo(graph, -60, 0, 0, -90, 0), null, 'a stop behind on a one-way grid with no way back');
});
