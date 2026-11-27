// Pedestrians on the real map. walkGraph() lays out where people walk: both sidewalks of every street that has them,
// cut back at each junction to a crosswalk over every arm and a curve round every corner (traffic.js keeps its stop
// lines 3 m behind the crosswalks), mapped footways, paths and pedestrian streets, and mapped crossings; a loose end
// within a few metres of a walkway is joined to it. createPedestrians() walks people along it around the player. They
// keep to one side of the walkway, cross a street only at a crossing (at a light in its walk phase, while every car
// there has red; elsewhere once no car is coming) and get out of the way of the player's car. Pure: no three.js, no DOM.
import { nodeKey } from './road-layout.js';
import { offsetLine, cumLen, trimLine, pointAt } from './geom.js';

export const SIDEWALK = 1.1; // from the kerb to the middle of the 2.2 m sidewalk world.js lays
export const CROSSWALK = 1.2; // how far beyond the junction (traffic.js armBack) a crosswalk runs
const WALKS = new Set(['footway', 'pedestrian', 'path', 'steps', 'track', 'pier']), SNAP = 3.5;
const KERB = 0.35; // how far outside every carriageway the middle of a sidewalk stays (people keep up to 0.65 m to one side of it)
// [label, m of walkway per person, most people]
export const PEOPLE = [['Off', 0, 0], ['Few', 60, 70], ['Normal', 28, 160], ['Busy', 15, 280]];

const unit = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
const toSegment = (x, z, a, b) => { // distance from (x, z) to segment ab, and how far along it (0–1) the nearest point is
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return [Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t), t];
};

// The walk network: { nodes: [{ x, z, edges }], edges: [{ a, b, pts, cum, len, cross }] }; cross is set on an edge
// over a carriageway: { road, at (the junction's vertex, or null mid-block), dir (the road's direction) }.
// roads, paths: world.js's; junctions: prepareRoads().junctions; armBack(r, i, d): traffic.js laneGraph's; roadAt:
// world.js's lookup (to find crossings over roads); crossings: mapped crossing points [x, z].
export function walkGraph(roads, paths, junctions, { armBack = () => null, roadAt = null, crossings = [] } = {}) {
  const nodes = [], edges = [], endsOf = new Map(), armsAt = new Map();
  const node = p => { const n = { id: nodes.length, x: p[0], z: p[1], edges: [] }; nodes.push(n); return n; };
  const join = (a, b, pts, cross = null) => { const cum = cumLen(pts), e = { id: edges.length, a, b, pts, cum, len: cum.at(-1), cross }; edges.push(e); a.edges.push(e); b.edges.push(e); return e; };
  for (const arms of junctions) for (const a of arms) { if (!armsAt.has(a.road)) armsAt.set(a.road, new Map()); const m = armsAt.get(a.road); m.set(a.i, (m.get(a.i) || []).concat([a])); }
  const back = a => (armBack(a.road, a.i, a.direction) ?? a.clear + 1) + CROSSWALK; // where arm a's crosswalk runs
  const end = (a, side, n) => { if (!endsOf.has(a)) endsOf.set(a, {}); endsOf.get(a)[side] = n; };
  const angle = a => Math.atan2(a.dz, a.dx), byAngle = (a, b) => angle(a) - angle(b);

  // Where two streets meet end to end (a bend, not a junction) the sidewalks inside the bend stop where they meet (or,
  // beside a street without sidewalks, short of its kerb) and the ones outside are joined round it. An arm pointing
  // along u has its road's side `direction` on its right (-u_z, u_x), facing the next arm round (sorted by angle).
  const tipAt = new Map(), trims = new Map(), bends = [], tips = new Map();
  for (const r of roads) for (const i of [0, r.g.length - 1]) {
    if (armsAt.get(r)?.has(i)) continue;
    const [dx, dz] = unit(r.g[i], r.g[i ? i - 1 : 1]), a = { road: r, i, direction: i ? -1 : 1, dx, dz }, k = nodeKey(r, i);
    tips.set(k, (tips.get(k) || []).concat([a]));
  }
  for (const arms of tips.values()) if (arms.length === 2 && arms.some(a => a.road.walk)) {
    arms.sort(byAngle);
    for (const a of arms) { if (!tipAt.has(a.road)) tipAt.set(a.road, new Map()); tipAt.get(a.road).set(a.i, a); trims.set(a, {}); }
    for (let k = 0; k < 2; k++) {
      const a = arms[k], b = arms[1 - k], phi = (angle(b) - angle(a) + 4 * Math.PI) % (2 * Math.PI); // a's right faces b across phi
      if (phi > 2.6) continue; // the outside of the bend, or nearly straight on
      const w = r => r.hw + (r.walk ? SIDEWALK : 0.3), wa = w(a.road), wb = w(b.road), s = Math.sin(phi), c = Math.cos(phi);
      trims.get(a)[a.direction] = Math.min(20, Math.max(0, (wb + wa * c) / s - 0.4)); trims.get(b)[-b.direction] = Math.min(20, Math.max(0, (wa + wb * c) / s - 0.4));
    }
    if (arms.every(a => a.road.walk)) bends.push(arms);
  }
  const cut = (a, side) => !a ? 0 : trims.has(a) ? trims.get(a)[side] || 0 : back(a);
  // the carriageway (roadAt's segment) a point is on, or within m of
  const onRoad = (x, z, m) => { const h = roadAt?.(x, z); return h?.drv && h.de < m ? h.drv : null; };
  const clearOf = (pts, ok = []) => { const ps = pieces(pts, (x, z) => { const s = onRoad(x, z, KERB); return s && !ok.includes(s.r) ? s : null; }); return ps.length === 1 && !ps[0].road; };

  // sidewalks: both sides (side 1 right of the way's direction, -1 left) of each stretch between junctions, leaving
  // out any piece that runs onto another carriageway (streets that cross without meeting, bridges, odd mapping)
  for (const r of roads) if (r.walk) {
    const at = armsAt.get(r), cuts = [0, ...[...(at?.keys() || [])].filter(i => i > 0 && i < r.g.length - 1).sort((a, b) => a - b), r.g.length - 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const i0 = cuts[k], i1 = cuts[k + 1];
      const a0 = at?.get(i0)?.find(a => a.direction > 0) ?? tipAt.get(r)?.get(i0), a1 = at?.get(i1)?.find(a => a.direction < 0) ?? tipAt.get(r)?.get(i1);
      for (const side of [1, -1]) {
        const line = offsetLine(r.g.slice(i0, i1 + 1), side * (r.hw + SIDEWALK)), b0 = cut(a0, side), b1 = cut(a1, side);
        if (b0 + b1 > cumLen(line).at(-1) - 2) continue; // no room to walk between the two crosswalks
        const parts = pieces(trimLine(line, b0, b1), (x, z) => onRoad(x, z, KERB));
        for (const c of parts) if (!c.road && c.len > 2) {
          const A = node(c.pts[0]), B = node(c.pts.at(-1));
          join(A, B, c.pts);
          if (a0 && c === parts[0]) end(a0, side, A); if (a1 && c === parts.at(-1)) end(a1, side, B);
        }
      }
    }
  }
  // the way round every corner of a junction or bend, from one arm's right-hand sidewalk to the next arm's left; past
  // the mouth of a street without sidewalks, that's a crossing over it
  const corners = arms => arms.forEach((a, k) => {
    const p = endsOf.get(a)?.[a.direction]; if (!p) return;
    let j = 1; while (j < arms.length && !endsOf.get(arms[(k + j) % arms.length])?.[-arms[(k + j) % arms.length].direction]) j++;
    const b = arms[(k + j) % arms.length], q = endsOf.get(b)?.[-b.direction], over = arms[(k + 1) % arms.length];
    if (!q || q === p || b === a) return;
    if (j === 1) { const pts = corner([p.x, p.z], [q.x, q.z], [-a.dx, -a.dz], [-b.dx, -b.dz]); if (clearOf(pts)) join(p, q, pts); return; }
    const skipped = [], pts = [[p.x, p.z], [q.x, q.z]];
    for (let i = 1; i < j; i++) skipped.push(arms[(k + i) % arms.length].road);
    if (clearOf(pts, skipped)) join(p, q, pts, { road: over.road, at: over.road.g[over.i], dir: [over.dx, over.dz] });
  });
  // at each junction, a crosswalk over every arm too
  for (const arms of junctions) {
    for (const a of arms) { const ea = endsOf.get(a); if (ea?.[1] && ea[-1]) join(ea[1], ea[-1], [[ea[1].x, ea[1].z], [ea[-1].x, ea[-1].z]], { road: a.road, at: a.road.g[a.i], dir: [a.dx, a.dz] }); }
    corners(arms);
  }
  bends.forEach(corners);
  // mapped crossings in the middle of a street with sidewalks: straight across, kerb to kerb (joined up below)
  for (const [x, z] of crossings) {
    const hit = roadAt?.(x, z), s = hit?.drv;
    if (!s || hit.de > -0.5 || !s.r.walk || edges.some(e => e.cross?.at && Math.hypot(e.pts[0][0] - x, e.pts[0][1] - z) < 15)) continue;
    const L = Math.sqrt(s.l2), ux = s.dx / L, uz = s.dz / L, t = (x - s.ax) * ux + (z - s.az) * uz, cx = s.ax + ux * t, cz = s.az + uz * t, w = s.hw + SIDEWALK;
    join(node([cx - uz * w, cz + ux * w]), node([cx + uz * w, cz - ux * w]), [[cx - uz * w, cz + ux * w], [cx + uz * w, cz - ux * w]], { road: s.r, at: null, dir: [ux, uz] });
  }
  // footways, paths and pedestrian streets, split where they share a node with another; where one runs across a
  // carriageway, that piece is a crossing
  const walks = paths.filter(p => WALKS.has(p.type)), shared = new Map(), at = new Map();
  const key = (p, i) => p.nodes?.[i] != null ? p.nodes[i] : p.g[i].join();
  for (const p of walks) p.g.forEach((q, i) => shared.set(key(p, i), (shared.get(key(p, i)) || 0) + 1));
  const vertex = (p, i) => { const k = key(p, i); if (shared.get(k) < 2) return node(p.g[i]); if (!at.has(k)) at.set(k, node(p.g[i])); return at.get(k); };
  for (const p of walks) for (let i0 = 0, i = 1; i < p.g.length; i++) {
    if (i < p.g.length - 1 && shared.get(key(p, i)) < 2) continue;
    const parts = pieces(p.g.slice(i0, i + 1), (x, z) => onRoad(x, z, -0.3)), last = parts.length - 1;
    const tip = k => (k === 0 && i0 === 0 && shared.get(key(p, 0)) < 2) || (k === last && i === p.g.length - 1 && shared.get(key(p, i)) < 2);
    let prev = null;
    parts.forEach((c, k) => {
      const s = c.road, across = s && Math.abs((c.pts.at(-1)[0] - c.pts[0][0]) * s.dz - (c.pts.at(-1)[1] - c.pts[0][1]) * s.dx) > 0.5 * c.len * Math.sqrt(s.l2);
      if (s && !across && (tip(k) || c.len > 6)) { prev = null; return; } // a dead end poking into the road, or a way along it: left out
      const A = k ? prev ?? node(c.pts[0]) : vertex(p, i0), B = k === last ? vertex(p, i) : node(c.pts.at(-1));
      join(A, B, c.pts, s ? { road: s.r, at: null, dir: unit([0, 0], [s.dx, s.dz]) } : null); prev = B;
    });
    i0 = i;
  }
  joinLooseEnds(nodes, edges, node, join, onRoad);
  return { nodes: nodes.filter(n => n.edges.length), edges: edges.filter(e => !e.dead) };
}

// polyline pts cut where onRoad(x, z) (a road segment, or null) starts or stops giving one, to within 0.25 m:
// [{ pts, len, road }], in order
function pieces(pts, onRoad) {
  let cur; const out = [], open = (p, s) => out.push(cur = { pts: [p], road: s });
  open(pts[0], onRoad(pts[0][0], pts[0][1]));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)), at = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let k = 1; k <= n; k++) { const q = at(k / n), s = onRoad(q[0], q[1]); if (!s !== !cur.road) { const m = at((k - 0.5) / n); cur.pts.push(m); open(m, s); } }
    cur.pts.push(b);
  }
  for (const c of out) c.len = cumLen(c.pts).at(-1);
  return out;
}

// round a corner from p (heading along u) to q (coming from along v): a curve through where the two would meet
function corner(p, q, u, v) {
  const det = u[0] * -v[1] + u[1] * v[0], dx = q[0] - p[0], dz = q[1] - p[1];
  let c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (Math.abs(det) > 0.05) { const t = (dx * -v[1] + dz * v[0]) / det, s = (u[0] * dz - u[1] * dx) / det; if (t > 0 && s > 0 && t < 30 && s < 30) c = [p[0] + u[0] * t, p[1] + u[1] * t]; }
  return [0, 1, 2, 3, 4, 5, 6].map(k => { const t = k / 6, m = 1 - t; return [m * m * p[0] + 2 * m * t * c[0] + t * t * q[0], m * m * p[1] + 2 * m * t * c[1] + t * t * q[1]]; });
}

// A walkway that stops within SNAP m of another is joined to it (the other split there); not across a carriageway.
function joinLooseEnds(nodes, edges, node, join, onRoad) {
  const G = 8, grid = new Map(), cell = (i, j) => i * 65536 + j;
  for (const e of edges) for (let k = 1; k < e.pts.length; k++) {
    const a = e.pts[k - 1], b = e.pts[k];
    for (let i = Math.floor((Math.min(a[0], b[0]) - SNAP) / G); i <= Math.floor((Math.max(a[0], b[0]) + SNAP) / G); i++)
      for (let j = Math.floor((Math.min(a[1], b[1]) - SNAP) / G); j <= Math.floor((Math.max(a[1], b[1]) + SNAP) / G); j++) { const c = cell(i, j); if (!grid.has(c)) grid.set(c, []); grid.get(c).push([e, k]); }
  }
  const want = new Map(); // edge → [{ s, n }]
  for (const n of nodes) if (n.edges.length === 1) {
    let best = null;
    for (const [e, k] of grid.get(cell(Math.floor(n.x / G), Math.floor(n.z / G))) || []) {
      if (e === n.edges[0]) continue;
      const [d, t] = toSegment(n.x, n.z, e.pts[k - 1], e.pts[k]);
      if (d < SNAP && (!best || d < best.d)) best = { e, d, s: e.cum[k - 1] + t * (e.cum[k] - e.cum[k - 1]) };
    }
    if (!best) continue;
    const [x, z] = pointAt(best.e.pts, best.e.cum, best.s);
    if (!n.edges[0].cross && !best.e.cross && pieces([[n.x, n.z], [x, z]], (x, z) => onRoad(x, z, -0.3)).some(c => c.road)) continue; // that would be walking in the road
    if (!want.has(best.e)) want.set(best.e, []);
    want.get(best.e).push({ s: best.s, n });
  }
  for (const [e, list] of want) { // split e at each point asked for, in order along it, and join the loose ends there
    list.sort((p, q) => p.s - q.s);
    e.dead = true; e.a.edges.splice(e.a.edges.indexOf(e), 1); e.b.edges.splice(e.b.edges.indexOf(e), 1);
    let prev = e.a, s0 = 0;
    for (const { s, n } of list) {
      let m = prev;
      if (s - s0 > 0.3 && e.len - s > 0.3) { const pts = trimLine(e.pts, s0, e.len - s); m = node(pts.at(-1)); join(prev, m, pts, e.cross); prev = m; s0 = s; }
      else if (e.len - s <= 0.3) m = e.b;
      if (m !== n) join(n, m, [[n.x, n.z], [m.x, m.z]]);
    }
    join(prev, e.b, trimLine(e.pts, s0, 0), e.cross);
  }
}

// People around the player: people[i] = { x, z, h, v, r, phase, look, … } (heading as in drive-core.js: 0 = +x).
// step(dt, player, cars, signals) walks them; player ({ x, z, h, v }) is who they dodge and where they live (within
// `radius` m; new ones start out of sight); cars (traffic.js) are what they wait for at a crossing, and signals
// (traffic.js graph.signals) the lights there. crossing: the people traffic has to keep from (for traffic.step's
// others). hit(x, z, h): who a car there would touch; bump(person, x, z) sends them staggering away.
export function createPedestrians(walks, { rand = Math.random, max = Infinity, radius = 180, half = Infinity, seen = () => false } = {}) {
  const people = [], crossing = [], spots = walks.edges.filter(e => !e.cross && e.len > 3); // where people start
  let level = 0, target = 0, retune = 0, spawnT = 0, ids = 0;

  function place(p) { // on the walkway, keeping to its right, plus any step aside; r: how far traffic keeps from them
    p.r = p.edge.cross && p.state !== 'kerb' ? 1.5 : 0.3; // (on a crossing, out of the whole lane)
    const e = p.edge, [x, z, ux, uz] = pointAt(e.pts, e.cum, p.s), tx = ux * p.dir, tz = uz * p.dir;
    p.x = x - tz * p.off + p.dx; p.z = z + tx * p.off + p.dz;
    if (p.state !== 'stagger') p.h = Math.atan2(-tz, tx);
  }
  function add(e, s, dir) {
    const p = { id: ids++, edge: e, s, dir, speed: 1.1 + rand() * 0.45, v: 0, r: 0.3, off: 0.35 + rand() * 0.3, dx: 0, dz: 0, dvx: 0, dvz: 0, dodge: 0, state: 'walk', wait: 0, phase: rand() * 6.3,
      look: { shirt: Math.floor(rand() * 1e6), pants: Math.floor(rand() * 1e6), skin: Math.floor(rand() * 1e6), hair: Math.floor(rand() * 1e6), scale: 0.92 + rand() * 0.16 }, x: 0, z: 0, h: 0 };
    place(p); people.push(p); return p;
  }
  const drop = p => people.splice(people.indexOf(p), 1);
  function onward(p, n) { // the walkway to take on from node n: not straight back unless it's a dead end; crossings less often
    const opts = n.edges.filter(f => f !== p.edge);
    if (!opts.length) return p.edge;
    const w = opts.map(f => f.cross ? 0.5 : 1);
    let r = rand() * w.reduce((a, b) => a + b);
    for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return opts[i];
    return opts.at(-1);
  }
  function enter(p, f, n) { p.edge = f; p.dir = f.a === n ? 1 : -1; p.s = p.dir > 0 ? 0 : f.len; p.state = f.cross ? 'kerb' : 'walk'; p.wait = 0; }
  // May p cross over crossing e now? At a junction with lights (or a crossing within 25 m of one): only in its walk
  // phase, when every light there is red, and with time left to get across; never while any car there has green.
  // Elsewhere: once no car (or the player) is on it or coming within about 4 s.
  function mayCross(p, e, bodies, signals) {
    const c = e.cross, a = e.pts[0], b = e.pts.at(-1), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!c.heads) c.heads = signals.filter(s => s.junction?.some(q => c.at ? Math.hypot(q[0] - c.at[0], q[1] - c.at[1]) < 0.5 : Math.hypot(q[0] - mx, q[1] - mz) < 25));
    if (c.heads.length && !c.heads.every(s => s.state === 'red' && s.walk >= e.len / (p.speed * 1.15) + 1)) return false;
    for (const o of bodies) {
      if (toSegment(o.x, o.z, a, b)[0] < 3.2) return false;
      if (c.heads.length) continue;
      const dx = mx - o.x, dz = mz - o.z, d = Math.hypot(dx, dz) || 1, closing = (Math.cos(o.h) * o.v * dx - Math.sin(o.h) * o.v * dz) / d;
      if (closing > 0.5 && d < 6 + closing * 4) return false;
    }
    return true;
  }

  function step(dt, player, cars = [], signals = []) {
    const bodies = player ? cars.concat([player]) : cars;
    for (const p of people) {
      // out of the way of the player's car: a step aside, away from its path
      if (player) {
        const sg = Math.sign(player.v) || 1, fx = Math.cos(player.h) * sg, fz = -Math.sin(player.h) * sg, rx = p.x - player.x, rz = p.z - player.z;
        const ahead = rx * fx + rz * fz, side = rz * fx - rx * fz, away = side >= 0 ? 1 : -1; // side: + to the car's right (-fz, fx)
        if (Math.abs(player.v) > 1.5 && ahead > -1 && ahead < 3 + Math.abs(player.v) * 1.1 && Math.abs(side) < 1.9) { p.dvx = -fz * away * 3.2; p.dvz = fx * away * 3.2; p.dodge = 0.6; p.around = false; }
        else if (p.state === 'walk' && hit(player.x, player.z, player.h, [{ x: p.x + Math.cos(p.h) * 0.7, z: p.z - Math.sin(p.h) * 0.7 }])) { p.dvx = -fz * away * 1.6; p.dvz = fx * away * 1.6; p.dodge = 0.3; p.around = true; } // a parked car in the way: round it
      }
      if (p.dodge > 0) { p.dodge -= dt; p.dx += p.dvx * dt; p.dz += p.dvz * dt; const d = Math.hypot(p.dx, p.dz); if (d > 3) { p.dx *= 3 / d; p.dz *= 3 / d; } }
      else { const d = Math.hypot(p.dx, p.dz); if (d) { const k = Math.max(0, d - 0.8 * dt) / d; p.dx *= k; p.dz *= k; } } // back onto the walkway
      if (p.state === 'stagger') { p.v = 0; if ((p.wait -= dt) <= 0) p.state = 'walk'; place(p); continue; }
      if (p.state === 'kerb') { // at a crossing, waiting
        p.v = 0; p.wait += dt;
        if (mayCross(p, p.edge, bodies, signals)) p.state = 'walk';
        else if (p.wait > (p.edge.cross.heads?.length ? 120 : 45)) { const n = p.dir > 0 ? p.edge.a : p.edge.b, f = n.edges.find(f => f !== p.edge && !f.cross); if (f) enter(p, f, n); } // gave up
        place(p); continue;
      }
      p.v = p.dodge > 0 && !p.around ? 0 : p.speed * (p.edge.cross ? 1.15 : 1); // (a dodge stops them; stepping round a car doesn't)
      p.s += p.dir * p.v * dt; p.phase += p.v * dt * 5.4;
      if (p.s < 0 || p.s > p.edge.len) {
        const n = p.dir > 0 ? p.edge.b : p.edge.a, over = p.dir > 0 ? p.s - p.edge.len : -p.s;
        enter(p, onward(p, n), n);
        if (p.state === 'walk') p.s = Math.max(0, Math.min(p.edge.len, p.s + p.dir * over));
      }
      place(p);
    }
    crossing.length = 0; // who traffic has to mind: people on a crossing, off their walkway or staggering
    for (const p of people) if ((p.edge.cross && p.state !== 'kerb') || p.state === 'stagger' || p.dx * p.dx + p.dz * p.dz > 0.04) crossing.push(p);
    if (!player) return;
    if ((retune -= dt) <= 0) { retune = 5; retarget(player.x, player.z); }
    for (const p of people.slice()) if (Math.hypot(p.x - player.x, p.z - player.z) > radius + 40 && !seen(p.x, p.z)) drop(p);
    if (people.length < target && (spawnT -= dt) <= 0) { spawnT = 0.08; fill(player.x, player.z, 50, 1); }
  }
  function fill(x, z, r0, n) { // start up to n people on walkways r0 to radius m from (x, z), out of sight unless close in
    const near = spots.filter(e => Math.hypot(e.pts[0][0] - x, e.pts[0][1] - z) < radius + e.len), total = near.reduce((t, e) => t + e.len, 0);
    for (let tries = 0; n > 0 && total > 0 && tries < n * 10; tries++) {
      let r = rand() * total, e = near[0];
      for (const f of near) if ((r -= f.len) <= 0) { e = f; break; }
      const s = rand() * e.len, [px, pz] = pointAt(e.pts, e.cum, s), d = Math.hypot(px - x, pz - z);
      if (d < r0 || d > radius || Math.abs(px) > half || Math.abs(pz) > half || (r0 > 20 && seen(px, pz))) continue;
      add(e, s, rand() < 0.5 ? 1 : -1); n--;
    }
  }
  function retarget(x, z) {
    const [, per, most] = PEOPLE[level]; let len = 0;
    if (per) for (const e of spots) if (Math.hypot(e.pts[0][0] - x, e.pts[0][1] - z) < radius) len += e.len;
    target = per ? Math.min(most, max, Math.round(len / per)) : 0;
  }
  function setLevel(l, x, z) {
    level = l; retarget(x, z);
    const far = p => (p.x - x) ** 2 + (p.z - z) ** 2;
    people.sort((a, b) => far(a) - far(b));
    while (people.length > target) drop(people.at(-1));
    if (!people.length) fill(x, z, 12, target);
  }
  function hit(x, z, h, among = people) { // who a car (4.4 × 1.8 m) at (x, z) facing h would touch (people are 0.6 m across)
    const cs = Math.cos(h), sn = Math.sin(h);
    for (const p of among) {
      const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz > 9) continue;
      if (Math.abs(dx * cs - dz * sn) < 2.55 && Math.abs(dx * sn + dz * cs) < 1.2) return p;
    }
    return null;
  }
  function bump(p, x, z) { // knocked: stumbles back away from the car and stands a moment
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz) || 1;
    p.state = 'stagger'; p.wait = 2.5; p.dodge = 0.35; p.dvx = dx / d * 2.5; p.dvz = dz / d * 2.5;
  }
  const clear = (x, z, r) => { for (const p of people.slice()) if (Math.hypot(p.x - x, p.z - z) < r) drop(p); };
  return { people, crossing, step, setLevel, hit, bump, clear, add, get target() { return target; } };
}
