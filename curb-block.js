// A prototype block uses both existing sidewalk ribbons on one complete stretch between junctions.
import { bbox, cumLen, inPoly, offsetLine, pointAt } from './geom.js';
import { prepareRoads } from './road-layout.js';

const WALK = 2.2,
  LIP = 0.15,
  FLARE = 1.8;
const clamp = (n) => Math.min(1, Math.max(0, n));

function hasBothWalks(road) {
  const t = road.t;
  if (
    !road.walk ||
    (t.bridge && t.bridge !== 'no') ||
    (t.tunnel && t.tunnel !== 'no') ||
    Number(t.layer || 0) !== 0 ||
    t.junction ||
    ['left', 'right'].includes(t.sidewalk)
  )
    return false;
  return ['sidewalk', 'sidewalk:both', 'sidewalk:left', 'sidewalk:right'].every(
    (key) => !['no', 'none', 'separate'].includes(t[key]),
  );
}

function chooseBlock(junctions, half, selectedRoad) {
  const byRoad = new Map();
  for (const arms of junctions)
    for (const arm of arms) {
      if ((selectedRoad && arm.road !== selectedRoad) || !hasBothWalks(arm.road)) continue;
      if (!byRoad.has(arm.road)) byRoad.set(arm.road, new Map());
      const ends = byRoad.get(arm.road);
      if (!ends.has(arm.i)) ends.set(arm.i, {});
      ends.get(arm.i)[arm.direction] = arm.clear;
    }
  let best,
    nearest = Infinity;
  for (const [road, ends] of byRoad) {
    const indices = [...ends.keys()].sort((a, b) => a - b);
    for (let j = 1; j < indices.length; j++) {
      const a = indices[j - 1],
        b = indices[j];
      const start = ends.get(a)[1],
        setback = ends.get(b)[-1];
      const length = road.distances[b] - road.distances[a];
      // Leave enough straight-through walking surface between the two corner transitions.
      if (!(length - start - setback >= 55) || length > 250) continue;
      const line = road.g.slice(a, b + 1);
      if (line.some((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])) + road.hw + WALK >= half)) continue;
      const distances = cumLen(line),
        [x, z] = pointAt(line, distances, length / 2);
      const distance = Math.hypot(x, z);
      if (distance >= nearest) continue;
      best = { road, first: a, last: b, line, distances, start, end: length - setback };
      nearest = distance;
    }
  }
  return best;
}

// Stations are measured on the centreline. The curb uses the same mitres as the road mesh.
function crossingStations(block, edge, paths, nodes) {
  const { line, distances, start, end } = block,
    cuts = [];
  function add(s) {
    if (s >= start - 3 && s <= end + 3 && !cuts.some((v) => Math.abs(v - s) < 0.1)) cuts.push(s);
  }
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1],
      dx = edge[i][0] - a[0],
      dz = edge[i][1] - a[1];
    const span = distances[i] - distances[i - 1];
    if (!span) continue;
    for (const path of paths) {
      for (let j = 1; j < path.g.length; j++) {
        const p = path.g[j - 1],
          ex = path.g[j][0] - p[0],
          ez = path.g[j][1] - p[1];
        const det = dx * ez - dz * ex;
        if (Math.abs(det) < 1e-8) continue;
        const x = p[0] - a[0],
          z = p[1] - a[1];
        const u = (x * ez - z * ex) / det,
          v = (x * dz - z * dx) / det;
        // Surveyed entrances can end just inside our estimated carriageway.
        const reach = 1.5 / Math.hypot(ex, ez);
        if (u >= 0 && u <= 1 && v >= (j === 1 ? -reach : 0) && v <= (j === path.g.length - 1 ? 1 + reach : 1))
          add(distances[i - 1] + u * span);
      }
    }
    // A crossing way sets the angle. Only use its centre node as a fallback when no way covers it.
    const [cx, cz] = line[i - 1],
      ux = (line[i][0] - cx) / span,
      uz = (line[i][1] - cz) / span;
    for (const [x, z] of nodes) {
      const along = (x - cx) * ux + (z - cz) * uz;
      if (along >= -0.01 && along <= span + 0.01 && Math.abs((x - cx) * uz - (z - cz) * ux) < 0.25)
        add(distances[i - 1] + along);
    }
  }
  return cuts;
}

function rampFactor(s, start, end, cuts) {
  let clearance = Math.min(s - start, end - s);
  for (const cut of cuts) clearance = Math.min(clearance, Math.abs(s - cut) - 1.5);
  return clamp(clearance / FLARE);
}

export function planCurbBlock(junctions, paths, crossingNodes, half, selectedRoad) {
  const block = chooseBlock(junctions, half, selectedRoad);
  if (!block) return null;
  const { road, line, distances, start, end } = block;
  const crossingWays = paths.filter(
    (p) =>
      (p.t.footway === 'crossing' || p.t.crossing) &&
      p.t.crossing !== 'no' &&
      !(p.t.bridge && p.t.bridge !== 'no') &&
      !(p.t.tunnel && p.t.tunnel !== 'no') &&
      !Number(p.t.layer || 0),
  );
  const bounds = bbox(line),
    margin = road.hw + 8;
  const nearby = ([x, z]) =>
    x >= bounds.x0 - margin && x <= bounds.x1 + margin && z >= bounds.z0 - margin && z <= bounds.z1 + margin;
  const nodes = crossingNodes
    .filter(nearby)
    .filter(([x, z]) => !crossingWays.some((p) => p.g.some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.5)));
  const strips = [-1, 1].map((side) => {
    const edge = offsetLine(line, side * road.hw);
    const cuts = crossingStations(block, edge, crossingWays, nodes);
    const stations = new Set([start, end, ...distances.filter((s) => s > start && s < end)]);
    for (const transition of [
      start + FLARE,
      end - FLARE,
      ...cuts.flatMap((c) => [c - 3.3, c - 1.5, c + 1.5, c + 3.3]),
    ])
      if (transition > start && transition < end) stations.add(transition);
    for (let s = start + 0.5; s < end; s += 0.5) stations.add(s);
    const sections = [...stations]
      .sort((a, b) => a - b)
      .map((s) => {
        const [x, z] = pointAt(line, distances, s),
          [ex, ez] = pointAt(edge, distances, s);
        return {
          s,
          x: ex,
          z: ez,
          nx: (ex - x) / road.hw,
          nz: (ez - z) / road.hw,
          width: WALK,
          rise: LIP * rampFactor(s, start, end, cuts),
        };
      });
    return { side, cuts, sections };
  });
  // Face the first crossing ahead from the legal outside lane, close enough to see the curb face.
  const firstCut = strips.flatMap((strip) => strip.cuts).sort((a, b) => a - b)[0];
  const dir = road.lanes.one || (firstCut < (start + end) / 2 ? -1 : 1),
    side = road.lanes.side * dir;
  const cuts = strips.find((strip) => strip.side === side).cuts;
  const target = cuts.length ? (dir > 0 ? Math.max(...cuts) : Math.min(...cuts)) : dir > 0 ? end : start;
  const station = Math.max(start + 4, Math.min(end - 4, target - dir * 13));
  const [x, z, ux, uz] = pointAt(line, distances, station),
    off = side * (road.lanes.edge - road.lanes.width / 2);
  const approach = { x: x - uz * off, z: z + ux * off, h: Math.atan2(-dir * uz, dir * ux) };
  return {
    strips,
    approach,
    name: road.name,
    road,
    first: block.first,
    last: block.last,
    start,
    end,
    bounds,
    margin,
  };
}

// Intersect an outward cross-section with the actual walls, including courtyard walls.
function frontageWidth({ x, z, nx, nz }, nearby) {
  let nearest = Infinity;
  for (const { outer, holes, bounds } of nearby) {
    const reach = 3.2 * Math.hypot(nx, nz);
    if (x < bounds.x0 - reach || x > bounds.x1 + reach || z < bounds.z0 - reach || z > bounds.z1 + reach) continue;
    if (inPoly(x, z, outer) && !holes.some((ring) => inPoly(x, z, ring))) return 0;
    for (const ring of [outer, ...holes])
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j],
          dx = ring[i][0] - ax,
          dz = ring[i][1] - az;
        const det = nx * dz - nz * dx;
        if (Math.abs(det) < 1e-9) continue;
        const d = ((ax - x) * dz - (az - z) * dx) / det,
          along = ((ax - x) * nz - (az - z) * nx) / det;
        if (d >= 0 && along >= 0 && along <= 1) nearest = Math.min(nearest, d);
      }
  }
  // A nearby front can define the back of the pavement. Keep the normal
  // sidewalk width at an open yard or a deeply set-back house.
  return nearest <= 3.2 ? nearest : WALK;
}

function fitWidths(block, nearby) {
  for (const { sections } of block.strips) {
    for (const section of sections) section.width = frontageWidth(section, nearby);
    // Ease the back edge into recesses from both directions. At a protruding
    // corner the measured wall distance is always the upper bound.
    for (const dir of [1, -1]) {
      for (let i = dir === 1 ? 1 : sections.length - 2; i >= 0 && i < sections.length; i += dir) {
        const current = sections[i],
          previous = sections[i - dir];
        current.width = Math.min(current.width, previous.width + Math.abs(current.s - previous.s));
      }
    }
    for (const section of sections) section.rise *= Math.min(1, section.width / 0.4);
  }
}

export function prepareCurbBlock(roads, regionalSide, paths, crossings, half, footprints) {
  let layout = prepareRoads(roads, regionalSide);
  let block = planCurbBlock(layout.junctions, paths, crossings, half);
  if (!block) return { layout, block };
  const bounds = block.bounds,
    margin = block.margin;
  const nearby = footprints
    .map((p) => ({ outer: p.outer, holes: p.holes, bounds: bbox(p.outer) }))
    .filter(
      ({ bounds: b }) =>
        b.x1 >= bounds.x0 - margin &&
        b.x0 <= bounds.x1 + margin &&
        b.z1 >= bounds.z0 - margin &&
        b.z0 <= bounds.z1 + margin,
    );
  if (!nearby.length) return { layout, block };
  fitWidths(block, nearby);
  const { road, first, last } = block;
  // Only an inferred residential carriageway can give back space. Keep at
  // least 2.8 m per lane, and keep tagged dimensions and adjoining blocks.
  if (road.t.highway === 'residential' && !road.t.width && !road.t.lanes) {
    const narrowest = Math.min(...block.strips.flatMap((strip) => strip.sections.map((q) => q.width)));
    const reclaim = Math.min(0.7, road.hw - 1.4 * road.lanes.total, 1.5 - narrowest);
    if (reclaim > 0.02) {
      const part = (a, b) => ({ ...road, g: road.g.slice(a, b + 1), nodes: road.nodes?.slice(a, b + 1) });
      const fitted = part(first, last);
      fitted.hw -= reclaim;
      const parts = [fitted];
      if (first > 0) parts.unshift(part(0, first));
      if (last < road.g.length - 1) parts.push(part(last, road.g.length - 1));
      roads.splice(roads.indexOf(road), 1, ...parts);
      layout = prepareRoads(roads, regionalSide);
      block = planCurbBlock(layout.junctions, paths, crossings, half, fitted);
      if (block) fitWidths(block, nearby);
    }
  }
  return { layout, block };
}

// The same rise used by the visible surface also lifts wheels, pedestrians and street props.
export function curbRiseAt(block, x, z) {
  const b = block.bounds,
    m = block.margin;
  if (x < b.x0 - m || x > b.x1 + m || z < b.z0 - m || z > b.z1 + m) return 0;
  for (const { sections } of block.strips)
    for (let i = 1; i < sections.length; i++) {
      const a = sections[i - 1],
        c = sections[i];
      // The maximum pavement width is 3.2 m and offsetLine limits mitres to 2.5 times width.
      if (
        x < Math.min(a.x, c.x) - 8 ||
        x > Math.max(a.x, c.x) + 8 ||
        z < Math.min(a.z, c.z) - 8 ||
        z > Math.max(a.z, c.z) + 8
      )
        continue;
      // Intersect the query with the two transverse section lines, including at a bend.
      const cross = (u, v) => (x - u.x) * v.nz - (z - u.z) * v.nx;
      const f = cross(a, a),
        g = cross(c, c);
      if (f * g > 0 || Math.abs(f - g) < 1e-9) continue;
      const t = f / (f - g),
        nx = a.nx + (c.nx - a.nx) * t,
        nz = a.nz + (c.nz - a.nz) * t;
      const lateral = ((x - a.x - (c.x - a.x) * t) * nx + (z - a.z - (c.z - a.z) * t) * nz) / (nx * nx + nz * nz);
      if (lateral >= 0 && lateral <= a.width + t * (c.width - a.width)) return a.rise + t * (c.rise - a.rise);
    }
  return 0;
}
