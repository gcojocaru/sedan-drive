// Traffic on the real map. laneGraph() turns the prepared roads (road-layout.js) into lanes that meet at nodes, and
// puts traffic lights on the junctions that have them; createTraffic() runs cars along the lanes around the player.
// Cars keep their lane, slow for bends, keep their distance from whatever is ahead in their path (another car or the
// player), stop at red lights and take junctions in turn: a car enters only when no car already in the junction, or
// waiting there longer, has a path that crosses its own, and when there is room for it beyond. Pure: no three.js, no
// DOM, so it runs in the Node tests.
import { nodeKey } from './road-layout.js';
import { offsetLine, cumLen } from './geom.js';

// m/s by highway type when maxspeed isn't tagged; service roads, busways and raceways get no traffic
const SPEED = { motorway: 30, trunk: 22, primary: 14, secondary: 14, tertiary: 13, unclassified: 11, residential: 9, living_street: 5, road: 9, motorway_link: 17, trunk_link: 14, primary_link: 12, secondary_link: 11, tertiary_link: 11 };
const BARRED = /^(no|private|agricultural|forestry|emergency|military)$/;
const LAT = 2.6, BRAKE = 3.2, AHEAD = 120, R = 1.85, LEN = 2.2; // bend acceleration, easy braking (m/s²), route planned ahead, path clearance, half length (m)
const CIRCLES = [-1.45, 0, 1.45]; // a car's body as three circles along its axis
// [label, m of lane per car, most cars]
export const LEVELS = [['Off', 0, 0], ['Light', 170, 30], ['Normal', 95, 60], ['Heavy', 55, 100]];
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary']); // where lights go when none are mapped
const GREEN = 18, AMBER = 3, CLEAR = 2, PHASE = GREEN + AMBER + CLEAR; // traffic light timing (s); CLEAR: all red

const unit = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1], cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function speedOf(r) {
  const m = /^(\d+(?:\.\d+)?)\s*(mph)?$/.exec(r.t.maxspeed || ''), v = m ? m[1] * (m[2] ? 0.447 : 1 / 3.6) : 0;
  return v >= 2 && v <= 40 ? v : SPEED[r.type];
}

// the part of polyline g from a m along it to b m before its end
function slice(g, a, b) {
  const c = cumLen(g), hi = Math.max(a, c.at(-1) - b);
  const at = s => { let i = 1; while (i < g.length - 1 && c[i] < s) i++; const t = Math.min(1, (s - c[i - 1]) / (c[i] - c[i - 1] || 1)); return [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t]; };
  const out = [at(a)];
  for (let i = 1; i < g.length - 1; i++) if (c[i] > a + 0.01 && c[i] < hi - 0.01) out.push(g[i]);
  out.push(at(hi));
  return out;
}

// sharp vertices get a curve of up to r m radius, so cars turn instead of snapping round
function rounded(g, r = 7) {
  if (g.length < 3) return g;
  const out = [g[0]];
  for (let i = 1; i < g.length - 1; i++) {
    const a = g[i - 1], b = g[i], c = g[i + 1], u = unit(a, b), w = unit(b, c), ang = Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
    if (ang < 0.12) { out.push(b); continue; }
    const t = Math.min(r * Math.tan(ang / 2), Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.45, Math.hypot(c[0] - b[0], c[1] - b[1]) * 0.45);
    const p = [b[0] - u[0] * t, b[1] - u[1] * t], q = [b[0] + w[0] * t, b[1] + w[1] * t];
    for (let k = 0; k <= 4; k++) { const s = k / 4, m = 1 - s; out.push([m * m * p[0] + 2 * m * s * b[0] + s * s * q[0], m * m * p[1] + 2 * m * s * b[1] + s * s * q[1]]); }
  }
  out.push(g.at(-1));
  return out;
}

// a piece of road a car follows: its points, distance along it, and the speed it can take at each point
function track(pts, lim, floor) {
  const cum = cumLen(pts), cap = pts.map(() => lim);
  for (let i = 1; i < pts.length - 1; i++) {
    const u = unit(pts[i - 1], pts[i]), w = unit(pts[i], pts[i + 1]), ang = Math.abs(Math.atan2(cross(u, w), dot(u, w)));
    if (ang > 0.02) cap[i] = Math.min(lim, Math.max(floor, Math.sqrt(LAT * Math.min(cum[i] - cum[i - 1], cum[i + 1] - cum[i]) / ang)));
  }
  return { pts, cum, cap, len: cum.at(-1), lim };
}

// Lanes of the roads that take traffic, split where roads meet. An edge is one direction of travel between two
// nodes, with one lane piece per lane (k = 0 is the kerbside lane), cut back clear of the junctions at both ends.
// junctions: prepareRoads().junctions, whose arm.clear says how far a road's markings stay out of a junction.
// signals: mapped traffic_signals points, [x, z] ([] puts lights where main roads cross; null: no lights).
export function laneGraph(roads, junctions, half = Infinity, signals = null) {
  const use = roads.filter(r => SPEED[r.type] && r.t.area !== 'yes' && !BARRED.test(r.t.motorcar || r.t.motor_vehicle || r.t.vehicle || r.t.access || '') && (r.lanes.one || r.lanes.total > 1 || r.lanes.edge >= 2.3)); // a two-way road needs room for two cars to pass
  const uses = new Map(), clear = new Map(), nodes = new Map(), edges = [];
  for (const r of use) r.g.forEach((p, i) => { const k = nodeKey(r, i); uses.set(k, (uses.get(k) || 0) + 1); });
  for (const arms of junctions) for (const a of arms) { if (!clear.has(a.road)) clear.set(a.road, new Map()); clear.get(a.road).set(a.i * 2 + (a.direction > 0), a.clear); }
  const node = (r, i) => {
    const k = nodeKey(r, i), p = r.g[i];
    if (!nodes.has(k)) nodes.set(k, { id: nodes.size, p, arms: [], ins: [], outs: [], holders: new Map(), queue: new Map(), inside: Math.abs(p[0]) < half && Math.abs(p[1]) < half });
    return nodes.get(k);
  };
  for (const r of use) {
    const L = r.lanes, sp = speedOf(r), nF = L.one ? L.total : Math.max(1, L.forward), nB = L.one ? L.total : Math.max(1, L.backward);
    const w = L.one || nF + nB <= L.total ? L.width : 2 * L.edge / (nF + nB);
    for (let i0 = 0, i = 1; i < r.g.length; i++) {
      if (i < r.g.length - 1 && uses.get(nodeKey(r, i)) < 2) continue;
      const A = node(r, i0), B = node(r, i), g = r.g.slice(i0, i + 1), pair = [];
      A.arms.push({ r, u: unit(g[0], g[1]) }); B.arms.push({ r, u: unit(g.at(-1), g.at(-2)) }); // the way each road leaves the node
      for (const dir of [1, -1]) {
        if (L.one && L.one !== dir) continue;
        const e = { id: edges.length, r, g: dir > 0 ? g : g.slice().reverse(), from: dir > 0 ? A : B, to: dir > 0 ? B : A, ends: dir > 0 ? [i0, 1, i, -1] : [i, -1, i0, 1], side: L.side, speed: sp,
          offs: Array.from({ length: dir > 0 ? nF : nB }, (_, k) => L.side * (L.edge - w * (k + 0.5))) }; // right of travel, kerbside first
        e.from.outs.push(e); e.to.ins.push(e); edges.push(e); pair.push(e);
      }
      if (pair.length === 2) { pair[0].twin = pair[1]; pair[1].twin = pair[0]; }
      i0 = i;
    }
  }
  const grid = new Map(), G = 30, cell = (i, j) => i * 65536 + j;
  for (const n of nodes.values()) if ((n.junction = n.arms.length > 2)) { const k = cell(Math.floor(n.p[0] / G), Math.floor(n.p[1] / G)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); }
  for (const n of nodes.values()) if (n.junction) { // junctions mapped as several nodes close together are claimed against each other too
    const i = Math.floor(n.p[0] / G), j = Math.floor(n.p[1] / G); n.near = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of grid.get(cell(i + a, j + b)) || []) if (Math.hypot(m.p[0] - n.p[0], m.p[1] - n.p[1]) < G) n.near.push(m);
  }
  const back = (n, r, i, d, u) => { // how far a lane leaving node n along u stops short of it
    if (n.arms.length < 2) return 0;
    if (!n.junction) { // one road running on into the next: room for the bend between them
      const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, dot(n.arms[0].u, n.arms[1].u))));
      return Math.min(14, 1.5 + Math.max(n.arms[0].r.hw, n.arms[1].r.hw) * Math.tan(Math.min(1.3, bend / 2)));
    }
    // clear of every other road there: along u, this road's near edge only clears road o's after (hw_o + hw cos θ) / sin θ
    let b = (clear.get(r)?.get(i * 2 + (d > 0)) || 0) + 1;
    for (const o of n.arms) if (o.r !== r) { const sn = Math.abs(cross(u, o.u)), cs = dot(u, o.u); if (sn > 0.17 || cs > 0) b = Math.max(b, (o.r.hw + r.hw * cs) / Math.max(sn, 0.04) + 0.8); } // roads forking almost side by side: as far as it goes
    return Math.min(25, b);
  };
  for (const e of edges) {
    e.dirA = unit(e.g[0], e.g[1]); e.dirB = unit(e.g.at(-2), e.g.at(-1)); e.mid = e.g[e.g.length >> 1]; e.len = cumLen(e.g).at(-1);
    const [i0, d0, i1, d1] = e.ends, a0 = back(e.from, e.r, i0, d0, e.dirA), b0 = back(e.to, e.r, i1, d1, [-e.dirB[0], -e.dirB[1]]);
    e.lanes = e.offs.map((off, k) => {
      const line = offsetLine(e.g, off), L = cumLen(line).at(-1); let a = a0, b = b0;
      if (a + b > L - 1) { const f = Math.max(0, L - 1) / (a + b || 1); a *= f; b *= f; }
      return Object.assign(track(rounded(slice(line, a, b)), e.speed, 3), { edge: e, k, node: null });
    });
  }
  const list = [...nodes.values()];
  return { nodes: list, edges, half, signals: trafficLights(list, signals) };
}

// Traffic lights. Junction nodes with a mapped signal within 30 m (or, with none mapped, where main roads cross) are
// controlled; nodes linked by a short edge share a controller. Each road coming in gets a light, in one of two phases
// by its direction (the widest road's axis first), and a signal head at the kerb where its cars stop: [{ e, x, z, h }].
function trafficLights(nodes, signals) {
  if (!signals) return [];
  const junctions = nodes.filter(n => n.junction), on = new Set();
  if (signals.length) for (const [x, z] of signals) {
    let best = null, bd = 30;
    for (const n of junctions) { const d = Math.hypot(n.p[0] - x, n.p[1] - z); if (d < bd) { bd = d; best = n; } }
    if (best) on.add(best);
  } else for (const n of junctions) {
    const main = n.arms.filter(a => MAIN.has(a.r.type));
    if (n.arms.length > 3 && !n.arms.some(a => a.r.t.junction === 'roundabout') && main.some(a => main.some(b => Math.abs(cross(a.u, b.u)) > 0.5))) on.add(n);
  }
  const heads = [], ctrls = new Map();
  for (const n of on) {
    if (ctrls.has(n)) continue;
    const ctrl = { nodes: new Set(), offset: (ctrls.size * 17.3) % (2 * PHASE) }; // lights out of step with each other
    for (const stack = [n]; stack.length;) {
      const m = stack.pop(); if (ctrls.has(m)) continue;
      ctrls.set(m, ctrl); ctrl.nodes.add(m);
      for (const e of m.outs.concat(m.ins)) { const o = e.from === m ? e.to : e.from; if (on.has(o) && e.len < 40) stack.push(o); }
    }
    const ins = [...ctrl.nodes].flatMap(m => m.ins.filter(e => !ctrl.nodes.has(e.from) && e.lanes.length));
    if (!ins.length) continue;
    const axis = ins.reduce((a, b) => b.r.hw > a.r.hw ? b : a).dirB;
    for (const e of ins) {
      e.signal = { ctrl, phase: Math.abs(cross(axis, e.dirB)) > 0.7 ? 1 : 0 };
      const L = e.lanes[0], P = L.pts.at(-1), u = L.len > 0.5 ? unit(L.pts.at(-2), P) : e.dirB, o = e.side * (e.r.hw + 0.6) - e.offs[0]; // from the kerbside lane to the kerb
      // the stop line across this road's lanes in: its middle (cx, cz), the way in (ux, uz) and half its width
      const ends = e.lanes.map(l => l.pts.at(-1)), cx = ends.reduce((a, p) => a + p[0], 0) / ends.length, cz = ends.reduce((a, p) => a + p[1], 0) / ends.length;
      const half = Math.max(...ends.map(p => Math.abs((p[0] - cx) * -u[1] + (p[1] - cz) * u[0]))) + 1.9;
      heads.push({ e, x: P[0] - u[1] * o, z: P[1] + u[0] * o, h: Math.atan2(u[1], -u[0]), state: 'red', cx, cz, ux: u[0], uz: u[1], half }); // facing the cars coming in
    }
    ctrl.phases = [...new Set(ins.map(e => e.signal.phase))].sort();
  }
  return heads;
}

// The light whose stop line a move from (ax, az) to (bx, bz) crossed on its way into the junction while it showed red
// (signals: graph.signals, their state kept up to date by step()), or null.
export function ranRed(signals, ax, az, bx, bz) {
  for (const s of signals) {
    if (s.state !== 'red') continue;
    const da = (ax - s.cx) * s.ux + (az - s.cz) * s.uz, db = (bx - s.cx) * s.ux + (bz - s.cz) * s.uz;
    if (da >= 0 || db < 0) continue; // it didn't go over the line, or went over it the other way
    const t = da / (da - db), lx = ax + (bx - ax) * t - s.cx, lz = az + (bz - az) * t - s.cz;
    if (Math.abs(lz * s.ux - lx * s.uz) <= s.half) return s;
  }
  return null;
}

// The colour of light `signal` (an edge's { ctrl, phase }) at time t (s): its phase gets green, then amber, then all
// stand at red a moment before the next phase's green.
export function lightAt(signal, t) {
  const { ctrl, phase } = signal, n = ctrl.phases.length;
  let s = ((t + ctrl.offset) % (n * PHASE) + n * PHASE) % (n * PHASE);
  const i = Math.floor(s / PHASE); s -= i * PHASE;
  return ctrl.phases[i] !== phase ? 'red' : s < GREEN ? 'green' : s < GREEN + AMBER ? 'amber' : 'red';
}

// The curve from lane k of E into lane kF of F (a U-turn when F is E's twin). Made once and kept on E.
let turnIds = 0;
function turn(E, k, F, kF) {
  const key = k + ':' + F.id + ':' + kF; E.turns ||= new Map();
  if (E.turns.has(key)) return E.turns.get(key);
  const a = E.lanes[k], b = F.lanes[kF], P = a.pts.at(-1), Q = b.pts[0];
  const u = a.len > 0.5 ? unit(a.pts.at(-2), P) : E.dirB, w = b.len > 0.5 ? unit(Q, b.pts[1]) : F.dirA;
  const dist = Math.hypot(Q[0] - P[0], Q[1] - P[1]), c = Math.max(0.6, dist * (dot(u, w) < -0.7 ? 1.1 : 0.42)), pts = [P];
  if (dist > 0.05) {
    const A = [P[0] + u[0] * c, P[1] + u[1] * c], B = [Q[0] - w[0] * c, Q[1] - w[1] * c], n = Math.max(3, Math.min(48, Math.ceil((2 * c + dist) / 1.0))); // about a metre apart
    for (let i = 1; i < n; i++) { const t = i / n, m = 1 - t; pts.push([0, 1].map(j => m * m * m * P[j] + 3 * m * m * t * A[j] + 3 * m * t * t * B[j] + t * t * t * Q[j])); }
  }
  pts.push(Q);
  const p = Object.assign(track(pts, Math.min(E.speed, F.speed), 2.5), { id: turnIds++, from: E, k, to: F, kF, node: E.to.junction ? E.to : null, compat: new Map() });
  E.turns.set(key, p);
  return p;
}

// Do two car bodies [x, z, ux, uz] (facing ux, uz) touch? Separating axes, with a little room to spare.
function touch(a, b, hl = 2.3, hw = 0.95) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  if (dx * dx + dz * dz > 4 * (hl * hl + hw * hw)) return false;
  const r = (c, ax, az) => hl * Math.abs(c[2] * ax + c[3] * az) + hw * Math.abs(c[2] * az - c[3] * ax);
  for (const [ax, az] of [[a[2], a[3]], [-a[3], a[2]], [b[2], b[3]], [-b[3], b[2]]]) if (Math.abs(dx * ax + dz * az) > r(a, ax, az) + r(b, ax, az)) return false;
  return true;
}
// A car's body every metre through turn p, from its nose entering to its tail leaving.
function sweep(p) {
  if (p.sweep) return p.sweep;
  const u = p.len > 0.3 ? unit(p.pts[0], p.pts[1]) : p.from.dirB, w = p.len > 0.3 ? unit(p.pts.at(-2), p.pts.at(-1)) : p.to.dirA, P = p.pts[0], Q = p.pts.at(-1), out = [];
  for (let d = -LEN; d <= p.len + LEN; d += 1) {
    if (d < 0) out.push([P[0] + u[0] * d, P[1] + u[1] * d, u[0], u[1]]);
    else if (d > p.len) out.push([Q[0] + w[0] * (d - p.len), Q[1] + w[1] * (d - p.len), w[0], w[1]]);
    else { const [[x, z, , ux, uz]] = along([{ p, at: 0 }], d, d, 1), l = Math.hypot(ux, uz) || 1; out.push([x, z, ux / l, uz / l]); }
  }
  return p.sweep = out;
}
// Two turns through a junction can be driven at once unless cars on them could touch. Turns out of the same lane
// are fine (the cars follow each other); turns into the same lane are not.
function compatible(p, q) {
  if (p === q || (p.from === q.from && p.k === q.k)) return true;
  if (p.to === q.to && p.kF === q.kF) return false;
  let ok = p.compat.get(q.id);
  if (ok === undefined) {
    const B = sweep(q);
    ok = !sweep(p).some(a => B.some(b => touch(a, b)));
    p.compat.set(q.id, ok); q.compat.set(p.id, ok);
  }
  return ok;
}

// How far short of the end of lane L a car waits for its junction so that no other turn through it, and no car
// leaving it, comes within a car's width of its body (wide junctions at sharp angles swing turns past the waiting
// cars; a short turn can end where another starts). Worked out once per lane.
function waitBack(L) {
  if (L.wait !== undefined) return L.wait;
  const E = L.edge, end = L.pts.at(-1), u = L.len > 0.5 ? unit(L.pts.at(-2), end) : E.dirB, pts = [];
  for (const m of E.to.near || []) for (const B of m.outs) {
    for (const O of B.lanes) pts.push(...along([{ p: O, at: 0 }], 0, Math.min(6, O.len), 1)); // cars leaving the junction
    for (const A of m.ins) if (B !== A.twin) for (let k = 0; k < A.lanes.length; k++) for (let kB = 0; kB < B.lanes.length; kB++) if (A !== E || k !== L.k) pts.push(...turn(A, k, B, kB).pts);
  }
  const clear = f => pts.every(P => { // a body from f to f + 4.4 m back from the lane end
    const dx = P[0] - end[0], dz = P[1] - end[1], a = -(dx * u[0] + dz * u[1]), dl = Math.max(0, Math.abs(dx * u[1] - dz * u[0]) - 0.875);
    return dl >= 1.2 || Math.hypot(dl, a < f ? f - a : a > f + 4.4 ? a - f - 4.4 : 0) >= 1.2;
  });
  let f = 0; while (f < 15 && !clear(f)) f += 0.25;
  return L.wait = f;
}

// Points every `step` m from d0 to d1 along a route (clamped to it): [x, z, d, ux, uz].
function along(route, d0, d1, step) {
  const out = []; let i = 0, j = 1;
  for (let d = d0; d <= d1 + 1e-9; d += step) {
    while (i < route.length - 1 && route[i].at + route[i].p.len < d) { i++; j = 1; }
    const { p, at } = route[i], s = Math.max(0, Math.min(p.len, d - at));
    while (j < p.pts.length - 1 && p.cum[j] < s) j++;
    const A = p.pts[j - 1], B = p.pts[j], L = p.cum[j] - p.cum[j - 1] || 1e-9, t = Math.min(1, (s - p.cum[j - 1]) / L);
    out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, d, (B[0] - A[0]) / L, (B[1] - A[1]) / L]);
  }
  return out;
}

// Cars around the player: cars[i] = { x, z, h, v, braking, paint, … } (heading as in drive-core.js: 0 = +x).
// step(dt, player) moves them; player = { x, z, h, v } (or null) is an obstacle they stop for, and where they live:
// cars more than `radius` + 70 m away go, and new ones start 150 m to `radius` away. seen(x, z) says whether a spot
// is on screen: cars appear only where they aren't (or far off), and a car stuck in a jam or at a dead end goes once
// it is out of sight. hit(x, z) is the car at that spot, if any.
export function createTraffic(graph, { rand = Math.random, max = Infinity, radius = 260, seen = () => false } = {}) {
  const { edges, half } = graph, cars = [];
  let time = 0, level = 0, target = 0, retune = 0, spawnT = 0, ids = 0;

  // where a car goes after E: mostly straight on, rarely out of the area or into a dead end, back only from a dead end
  const onward = F => F.to.outs.some(G => G !== F.twin && G.lanes.length);
  function choose(E) {
    const opts = E.to.outs.filter(F => F !== E.twin && F.lanes.length);
    if (!opts.length) return E.twin || null;
    const w = opts.map(F => (dot(E.dirB, F.dirA) > 0.7 ? 3 : 1) * (F.to.inside ? 1 : 0.25) * (onward(F) ? 1 : F.twin ? 0.2 : 0.02));
    let r = rand() * w.reduce((a, b) => a + b);
    for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return opts[i];
    return opts.at(-1);
  }
  // the lane to take on F: kerbside before a kerbside turn, the inner lane before turning across, else the driver's own
  const laneFor = (F, F2, pref) => { const n = F.lanes.length, t = F2 ? cross(F.dirB, F2.dirA) * F.side : 0; return n < 2 ? 0 : t > 0.35 ? 0 : t < -0.35 ? n - 1 : Math.min(pref, n - 1); };
  function extend(c) { // plan the route AHEAD m on: route = [{ p: piece, at: its start along the route }]
    for (let n = 0, last = c.route.at(-1); !c.dead && n < 40 && last.at + last.p.len - c.s < AHEAD; n++, last = c.route.at(-1)) {
      const E = last.p.edge, F = c.next; if (!F) { c.dead = true; break; }
      const F2 = choose(F), kF = laneFor(F, F2, c.pref), t = turn(E, last.p.k, F, kF), at = last.at + last.p.len;
      c.route.push({ p: t, at }, { p: F.lanes[kF], at: at + t.len });
      c.next = F2;
    }
  }
  function pose(c) {
    const [A, M, B] = along(c.route, c.s - 1.3, c.s + 1.3, 1.3);
    c.x = M[0]; c.z = M[1];
    if (Math.hypot(B[0] - A[0], B[1] - A[1]) > 0.2) c.h = Math.atan2(A[1] - B[1], B[0] - A[0]);
  }
  function add(e, k, s) {
    const L = e.lanes[k], c = { id: ids++, route: [{ p: L, at: 0 }], s, v: 0, x: 0, z: 0, h: 0, braking: false, paint: Math.floor(rand() * 1e6), temper: 0.88 + rand() * 0.22, pref: Math.floor(rand() * 3), claimed: new Set(), still: 0, next: choose(e), dead: false };
    extend(c); pose(c); c.v = Math.min(L.lim * c.temper, 9) * 0.7;
    cars.push(c);
    return c;
  }
  function drop(c) {
    for (const e of c.claimed) e.p.node.holders.delete(c);
    for (const e of c.route) e.p.node?.queue.delete(c);
    cars.splice(cars.indexOf(c), 1);
  }
  function fill(x, z, r0, n) { // start up to n cars on lanes r0 to radius m from (x, z), 20 m clear of other cars
    const near = edges.filter(e => e.lanes.length && Math.hypot(e.mid[0] - x, e.mid[1] - z) < radius + e.len / 2);
    const total = near.reduce((t, e) => t + e.len * e.lanes.length, 0);
    for (let tries = 0; n > 0 && total > 0 && tries < n * 12; tries++) {
      let r = rand() * total, e = near[0];
      for (const f of near) if ((r -= f.len * f.lanes.length) <= 0) { e = f; break; }
      const k = Math.floor(rand() * e.lanes.length), L = e.lanes[k]; if (L.len < 6) continue;
      const s = 2 + rand() * (L.len - 4), [[px, pz]] = along([{ p: L, at: 0 }], s, s, 1), d = Math.hypot(px - x, pz - z);
      if (d < r0 || d > radius || Math.abs(px) > half - 5 || Math.abs(pz) > half - 5 || (r0 > 100 && d < 200 && seen(px, pz)) || cars.some(c => (c.x - px) ** 2 + (c.z - pz) ** 2 < 400)) continue;
      add(e, k, s); n--;
    }
  }
  function retarget(x, z) {
    const [, per, most] = LEVELS[level]; let len = 0;
    if (per) for (const e of edges) if (Math.hypot(e.mid[0] - x, e.mid[1] - z) < radius) len += e.len * e.lanes.length;
    target = per ? Math.min(most, max, Math.round(len / per)) : 0;
  }
  function setLevel(l, x, z) {
    level = l; retarget(x, z);
    const far = c => (c.x - x) ** 2 + (c.z - z) ** 2;
    cars.sort((a, b) => far(a) - far(b));
    while (cars.length > target) drop(cars.at(-1));
    if (!cars.length) fill(x, z, 25, target);
  }

  function drive(c, dt, bodies) {
    extend(c);
    const v = c.v, reach = 14 + v * v / (2 * BRAKE) + v;
    // limit(u, d): be at most u m/s in d m. vt is the speed to aim for; need is the braking it takes to keep every limit.
    let vt = Infinity, need = 0;
    const limit = (u, d) => { const t = Math.sqrt(u * u + 2 * BRAKE * Math.max(0, d)); if (t < vt) vt = t; if (d > 0 && v > t) need = Math.max(need, (v * v - u * u) / (2 * Math.max(d, 0.05))); };
    for (const { p, at } of c.route) { // the speed limit of each piece from its start, and slowing for bends
      if (at - c.s > reach) break;
      if (at + p.len < c.s) continue;
      const lim = p.edge ? p.lim * c.temper : p.lim;
      limit(lim, at - c.s);
      for (let i = 0; i < p.pts.length; i++) { const d = at + p.cum[i] - c.s; if (d > 0 && d < reach && p.cap[i] < lim) limit(p.cap[i], d - 1); }
    }
    const end = c.route.at(-1);
    if (c.dead) limit(0, end.at + end.p.len - c.s - 1);
    // the next junction whose turn isn't claimed yet, taken together with any after it that a car can't wait before
    // without its tail still in the one behind
    let group = null;
    const gi = c.route.findIndex(e => e.p.node && !c.claimed.has(e) && e.at + e.p.len > c.s - LEN);
    if (gi >= 0 && c.route[gi].at - c.s < reach + 6) {
      group = [c.route[gi]];
      for (let i = gi + 1, space = 0; i < c.route.length && group.length < 8; i++) {
        const e = c.route[i];
        if (!e.p.node) { space += e.p.len; continue; }
        if (space - waitBack(c.route[i - 1].p) >= 2 * LEN + 0.6) break;
        group.push(e); space = 0;
      }
    }
    const gEnd = group ? group.at(-1).at + group.at(-1).p.len : 0, range = Math.max(reach, group ? gEnd - c.s + 8 : 0);
    // the nearest body in the path ahead: the gap to it (m, bumper to bumper for a car in line) and its speed along the path
    const S = along(c.route, c.s + 1.5, c.s + range, 1);
    let gap = Infinity, lead = 0, ahead = null;
    for (const b of bodies) {
      if (b === c || Math.abs(b.x - c.x) > range + 4 || Math.abs(b.z - c.z) > range + 4) continue;
      const fx = Math.cos(b.h), fz = -Math.sin(b.h);
      for (const [x, z, d, ux, uz] of S) {
        if (d - c.s - R - LEN - 0.75 >= gap) break;
        let hit = false;
        for (const o of CIRCLES) {
          const cx = b.x + fx * o, cz = b.z + fz * o;
          if ((x - cx) ** 2 + (z - cz) ** 2 >= R * R) continue;
          const g = d - c.s + (cx - x) * ux + (cz - z) * uz - LEN - 0.75; // its circle's centre is 0.75 m inside its bumper
          if (g < gap) { gap = g; lead = Math.max(0, b.v * (fx * ux + fz * uz)); ahead = b; }
          hit = true;
        }
        if (hit) break;
      }
    }
    c.ahead = ahead;
    const hold = group ? waitBack(group[0].p.from.lanes[group[0].p.k]) : 0;
    let wait = !!group;
    // a light on the way in: stop at red, and at amber if it can do so comfortably; wait for green, not for its turn
    const light = group?.[0].p.from.signal ? lightAt(group[0].p.from.signal, time) : 'green', toStop = group ? group[0].at - 2.5 - hold - c.s : 0;
    c.atLight = light !== 'green' && toStop > v * v / (2 * (light === 'red' ? 6 : 3.5)) - 0.5;
    if (c.atLight) for (const { p } of group) p.node.queue.delete(c);
    else if (group && gap > group[0].at - c.s - LEN - 1 - hold) { // first in line: may it go?
      // room for the whole car beyond (before a dead end too), or a car ahead going the same way through all of it, moving freely
      const first = group[0], since = n => n.queue.get(c)?.t ?? time;
      const room = (gap > gEnd - c.s + 3.7 || (lead > 3 && gap > 6 && group.every(({ p }) => p.node.holders.get(ahead)?.to === p.to))) && (!c.dead || end.at + end.p.len - gEnd > 2 * LEN + 1);
      const ready = room || lead > 0.5; // or it soon will be: the car ahead is moving
      const ok = room && group.every(({ p }) => {
        const n = p.node, t = since(n);
        // (a car held up by this one is never in its way)
        for (const m of n.near) for (const [h, q] of m.holders) if (h !== c && h.ahead !== c && !compatible(p, q)) return false;
        // first come, first served among cars that could go; one that can't yet keeps its place from 4 s (so a stream
        // of cars can't starve another approach) to 20 s (so no circle of cars waiting on each other lasts)
        for (const [o, q] of n.queue) if (o !== c && o.ahead !== c && q.t < t && (q.ready || (time - q.t > 4 && time - q.t < 20)) && !compatible(p, q.p)) return false;
        return true;
      });
      if (ok || c.s > first.at - 1.5) { for (const e of group) { e.p.node.holders.set(c, e.p); e.p.node.queue.delete(c); c.claimed.add(e); } wait = false; } // granted, or already nosing in
      else for (const { p } of group) { const q = p.node.queue.get(c); if (q) q.ready = ready; else p.node.queue.set(c, { t: time, p, ready }); } // waiting its turn
    }
    if (wait) { // until it may go: stop short of the junction, but clear of the one behind
      const lane = c.route[c.route.indexOf(group[0]) - 1];
      limit(0, Math.max(group[0].at - 2.5 - hold, lane ? lane.at + LEN + 0.3 : -Infinity) - c.s);
    }
    if (gap < Infinity) { limit(lead, gap - 2); limit(lead * Math.min(1, Math.max(0, gap - 0.5) / 1.5) + Math.max(0, gap - 2) / 1.1, 0); } // 2 m behind, and dropping back when closer
    const a = v < vt ? Math.min(1.8, (vt - v) * 1.2 + 0.2) : -Math.min(9, Math.max(need, (v - vt) * 3));
    c.v = v < vt ? Math.min(vt, v + a * dt) : Math.max(0, v + a * dt);
    c.braking = a < -1.2 || (c.v < 0.3 && vt < 0.5); c.brake = Math.max(0, -a); // (m/s², for the screech of a hard stop)
  }
  function move(c, dt) {
    c.s += c.v * dt;
    while (c.route.length > 1 && c.s > c.route[0].at + c.route[0].p.len + LEN + 0.2) { // its tail is clear of the first piece
      const e = c.route.shift();
      if (c.claimed.delete(e)) e.p.node.holders.delete(c);
    }
    pose(c);
    c.still = c.v < 0.2 ? c.still + (c.atLight ? 0 : dt) : 0; // (waiting at a red light isn't being stuck)
  }

  function step(dt, player) {
    time += dt;
    for (const s of graph.signals || []) s.state = lightAt(s.e.signal, time);
    const bodies = player ? cars.concat([player]) : cars;
    for (const c of cars) drive(c, dt, bodies);
    for (const c of cars) move(c, dt);
    if (!player) return;
    if ((retune -= dt) <= 0) { retune = 5; retarget(player.x, player.z); }
    for (const c of cars.slice()) {
      const d = Math.hypot(c.x - player.x, c.z - player.z), end = c.route.at(-1);
      if (d > radius + 70 || ((c.still > (c.dead ? 8 : 45) || (c.dead && c.s > end.at + end.p.len - 3)) && !seen(c.x, c.z))) drop(c);
    }
    if (cars.length < target && (spawnT -= dt) <= 0) { spawnT = 0.25; fill(player.x, player.z, 150, 1); }
  }
  function hit(x, z) {
    for (const c of cars) {
      const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > 7) continue;
      const cs = Math.cos(c.h), sn = Math.sin(c.h);
      if (Math.abs(dx * cs - dz * sn) < 2.25 && Math.abs(dx * sn + dz * cs) < 0.9) return c;
    }
    return null;
  }
  const clear = (x, z, r) => { for (const c of cars.slice()) if (Math.hypot(c.x - x, c.z - z) < r) drop(c); };
  return { cars, step, hit, clear, setLevel, add, get target() { return target; } };
}
