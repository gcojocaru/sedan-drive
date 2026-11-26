// In map coordinates +x points east and +z south, so (-dz, dx) is the right side of travel.
const LEFT_TRAFFIC = new Set('AG AI AU BB BD BM BN BS BT BW CC CK CX CY DM FJ FK GB GD GG GY HK ID IE IM IN IO JE JM JP KE KI KN KY LC LK LS MO MS MT MU MV MW MY MZ NA NF NP NR NU NZ PG PK PN SB SC SG SH SR SZ TC TH TK TL TO TT TV TZ UG VC VG VI WS ZA ZM ZW'.split(' '));

export function drivingSide(elements) {
  const areas = elements.filter(e => e.type === 'area' && e.tags?.['ISO3166-1'])
    .sort((a, b) => Number(b.tags.admin_level || 0) - Number(a.tags.admin_level || 0));
  const country = areas[0]?.tags;
  return country?.driving_side || (LEFT_TRAFFIC.has(country?.['ISO3166-1']) ? 'left' : 'right');
}

function count(tag) {
  const n = Number(tag);
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : 0;
}

export function laneLayout(road, regionalSide) {
  const t = road.t;
  const side = (t.driving_side || regionalSide) === 'left' ? -1 : 1;
  const implicit = t.junction === 'roundabout' || t.highway === 'motorway';
  let one = 0;
  if (t.oneway === '-1') one = -1;
  else if (/^(yes|1|true)$/.test(t.oneway) || (!t.oneway && implicit)) one = 1;

  const f = count(t['lanes:forward']), b = count(t['lanes:backward']);
  const shared = count(t['lanes:both_ways']);
  let total = count(t.lanes);
  if (!total) {
    if (one) total = f || b || 1;
    else if (f || b || shared) total = (f || 1) + (b || 1) + shared;
    else total = road.hw >= 2.6 ? 2 : 1;
  }
  const edge = Math.max(0, road.hw - 0.35), width = 2 * edge / total;
  // Untagged odd lanes split around a shared central lane. Single-lane streets share their centre.
  const available = Math.max(0, total - shared);
  const half = Math.floor(available / 2);
  let forward = Math.max(0, Math.min(available, f || (b ? available - b : half)));
  let backward = Math.max(0, Math.min(available - forward, b || (f ? available - forward : half)));
  if (one) {
    forward = one > 0 ? total : 0;
    backward = one < 0 ? total : 0;
  }
  const dividers = [];
  for (let i = 1; i < total; i++) {
    const boundary = !one && (i === forward || i === total - backward);
    dividers.push({ offset: side * (edge - i * width), boundary });
  }
  return { one, side, total, edge, width, forward, backward, dividers };
}

export function nodeKey(road, i) {
  if (road.nodes?.[i] != null) return road.nodes[i];
  return road.g[i].join(',') + '/' + (road.t.layer || 0) + '/' + (road.t.bridge || 'no');
}

function corner(a, b, extra) {
  const cross = a.dx * b.dz - a.dz * b.dx;
  if (cross < 0.35) return null; // reflex, near-parallel, or almost straight
  const aw = a.road.hw + extra, bw = b.road.hw + extra;
  const dot = a.dx * b.dx + a.dz * b.dz;
  // Intersect the offset road edges, then round that corner with a quadratic Bézier.
  const ta = (bw + aw * dot) / cross, tb = (aw + bw * dot) / cross;
  if (Math.min(ta, tb) < 0 || Math.max(ta, tb) > 22) return null;
  const bend = Math.min(4, a.available - ta, b.available - tb);
  if (bend < 0.25) return null;
  const p = a.road.g[a.i], x = p[0] + a.dx * ta - a.dz * aw, z = p[1] + a.dz * ta + a.dx * aw;
  const arc = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6, u = 1 - t;
    arc.push([x + bend * (u * u * a.dx + t * t * b.dx), z + bend * (u * u * a.dz + t * t * b.dz)]);
  }
  if (!extra) {
    a.clear = Math.max(a.clear, ta + bend);
    b.clear = Math.max(b.clear, tb + bend);
  }
  return [p, ...arc];
}

// Split at exact distances along the original way so short segments inside a junction stay unpainted.
function outsideJunctions(road, margin) {
  const sections = [];
  const { g, distances, gaps } = road;
  let index = 0;
  function point(s) {
    while (index < g.length - 2 && distances[index + 1] <= s) index++;
    const t = (s - distances[index]) / (distances[index + 1] - distances[index] || 1);
    return g[index].map((v, axis) => v + t * (g[index + 1][axis] - v));
  }
  function append(lo, hi) {
    if (hi <= lo) return;
    const line = [point(lo)];
    while (index < g.length - 2 && distances[index + 1] < hi) line.push(g[++index]);
    line.push(point(hi));
    sections.push(line);
  }
  let start = 0;
  const end = distances.at(-1);
  for (const [lo, hi] of gaps) {
    append(start, Math.min(end, lo - margin));
    start = Math.max(start, hi + margin);
  }
  append(start, end);
  return sections;
}

export function prepareRoads(roads, regionalSide) {
  const vertices = new Map(), junctions = [], corners = [];
  for (const road of roads) {
    road.lanes = laneLayout(road, regionalSide);
    road.distances = [0];
    road.gaps = [];
    for (let i = 0; i < road.g.length; i++) {
      const p = road.g[i], key = nodeKey(road, i);
      if (i) road.distances.push(road.distances[i - 1] + Math.hypot(p[0] - road.g[i - 1][0], p[1] - road.g[i - 1][1]));
      if (!vertices.has(key)) vertices.set(key, []);
      for (const direction of [-1, 1]) {
        const q = road.g[i + direction];
        if (!q) continue;
        const dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
        if (length) vertices.get(key).push({ road, i, direction, dx: dx / length, dz: dz / length, available: length, clear: 0 });
      }
    }
  }
  for (const arms of vertices.values()) {
    if (arms.length < 3) continue;
    junctions.push(arms);
    arms.sort((a, b) => Math.atan2(a.dz, a.dx) - Math.atan2(b.dz, b.dx));
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i], b = arms[(i + 1) % arms.length];
      const poly = corner(a, b, 0);
      if (poly) corners.push({ poly, sidewalk: a.road.walk && b.road.walk ? corner(a, b, 2.2) : null });
      // Keep markings clear of the adjacent carriageway even where a tight bend has no fillet.
      const sin = Math.abs(a.dx * b.dz - a.dz * b.dx);
      if (sin > 0.25) {
        a.clear = Math.max(a.clear, Math.min(22, b.road.hw / sin));
        b.clear = Math.max(b.clear, Math.min(22, a.road.hw / sin));
      }
    }
    for (const a of arms) {
      const s = a.road.distances[a.i], limit = s + a.direction * (a.clear + 0.6);
      a.road.gaps.push([Math.min(s, limit), Math.max(s, limit)]);
    }
  }
  const spawnSegments = [];
  for (const road of roads) {
    road.gaps.sort((a, b) => a[0] - b[0]);
    road.markSections = outsideJunctions(road, 0);
    for (const line of outsideJunctions(road, 2.4)) for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], dx = line[i][0] - a[0], dz = line[i][1] - a[1], length = Math.hypot(dx, dz);
      if (length) spawnSegments.push({ road, a, dx: dx / length, dz: dz / length, length });
    }
  }
  return { junctions, corners, spawnSegments };
}

export function laneSpawn(segments, x, z, heading, half, occupied) {
  let best = null, bestDist = Infinity;
  const fx = heading == null ? 0 : Math.cos(heading);
  const fz = heading == null ? 0 : -Math.sin(heading);
  for (const { road, a, dx, dz, length } of segments) {
    const lanes = road.lanes;
    const dir = lanes.one || (dx * fx + dz * fz < 0 ? -1 : 1);
    const offset = dir * lanes.side * (lanes.edge - lanes.width / 2);
    const ax = a[0] - dz * offset, az = a[1] + dx * offset;
    let lo = 0, hi = length;
    // Clip the lane centre to the playable square, leaving room for the car body.
    for (const [v, d] of [[ax, dx], [az, dz]]) {
      const bound = half - 2.5;
      if (Math.abs(d) < 1e-9) { if (Math.abs(v) > bound) hi = -1; continue; }
      const s = (-bound - v) / d, t = (bound - v) / d;
      lo = Math.max(lo, Math.min(s, t)); hi = Math.min(hi, Math.max(s, t));
    }
    if (lo > hi) continue;
    const along = Math.max(lo, Math.min(hi, (x - ax) * dx + (z - az) * dz));
    const h = Math.atan2(-dir * dz, dir * dx);
    function consider(s) {
      const px = ax + s * dx, pz = az + s * dz, d = (px - x)**2 + (pz - z)**2;
      if (d >= bestDist) return true;
      if (occupied?.(px, pz, h)) return false;
      bestDist = d;
      best = { x: px, z: pz, h, name: road.name };
      return true;
    }
    if (!consider(along)) {
      // A mapped bollard can sit on the lane itself. Search outwards in both directions.
      for (const end of [lo, hi]) {
        const distance = Math.abs(end - along);
        for (let offset = 0; offset < distance;) {
          offset = Math.min(distance, offset + 4);
          if (consider(along + Math.sign(end - along) * offset)) break;
        }
      }
    }
  }
  return best;
}

// A mapped stop belongs to its way. An undirected approach stop faces the nearest junction
// on that way; a stop on the shared vertex itself needs an explicit all-way designation.
export function mappedStops(roads, junctions, stops) {
  if (!stops.length) return [];
  const byId = new Map(stops.map(s => [s.id, s]));
  const byPosition = new Map(stops.map(s => [s.p.join(','), s]));
  const junctionAt = new Map();
  for (const arms of junctions) for (const arm of arms) {
    if (!junctionAt.has(arm.road)) junctionAt.set(arm.road, new Map());
    junctionAt.get(arm.road).set(arm.i, arms);
  }
  const bars = [];
  function bar(road, p, dx, dz, dir) {
    const lanes = road.lanes;
    if (lanes.one && lanes.one !== dir) return;
    const start = lanes.edge * dir * lanes.side;
    const count = dir === 1 ? lanes.forward : lanes.backward;
    const end = start - dir * lanes.side * lanes.width * (count || 1);
    bars.push([start, end].map(off => [p[0] - dz * off, p[1] + dx * off]));
  }
  for (const road of roads) {
    const junctionsOnWay = junctionAt.get(road);
    for (let i = 0; i < road.g.length; i++) {
      const p = road.g[i];
      const stop = road.nodes?.[i] != null ? byId.get(road.nodes[i]) : byPosition.get(p.join(','));
      if (!stop) continue;
      const arms = junctionsOnWay?.get(i);
      if (arms) {
        if (stop.tags.stop !== 'all') continue;
        for (const a of arms) if (a.road === road && a.i === i) {
          const setback = a.clear + 1;
          if (setback > a.available) continue;
          bar(road, [p[0] + setback * a.dx, p[1] + setback * a.dz], a.direction * a.dx, a.direction * a.dz, -a.direction);
        }
        continue;
      }
      let dir = { forward: 1, backward: -1 }[stop.tags.direction] || road.lanes.one;
      if (!dir && junctionsOnWay) {
        let nearest = Infinity;
        for (const j of junctionsOnWay.keys()) {
          const delta = road.distances[j] - road.distances[i];
          if (Math.abs(delta) < nearest && Math.abs(delta) <= 40) { nearest = Math.abs(delta); dir = Math.sign(delta); }
        }
      }
      if (!dir) continue;
      const j = i + dir >= 0 && i + dir < road.g.length ? i + dir : i - dir;
      const q = road.g[j], sign = Math.sign(j - i);
      const dx = (q[0] - p[0]) * sign, dz = (q[1] - p[1]) * sign, length = Math.hypot(dx,dz);
      if (length) bar(road, p, dx / length, dz / length, dir);
    }
  }
  return bars;
}
