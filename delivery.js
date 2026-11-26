// Parcel jobs use the directed road graph already loaded for traffic. Distances are in metres.
export const STOP_RADIUS = 7;
const separation = (a,b) => Math.hypot(a.x-b.x, a.z-b.z);

// Clip a segment before sampling. A road can leave the playable square and come back.
function clip(ax, az, dx, dz, bound) {
  let lo = 0, hi = 1;
  for (const [a,d] of [[ax,dx],[az,dz]]) {
    if (!d) { if (Math.abs(a) > bound) return null; continue; }
    const s = (-bound-a)/d, t = (bound-a)/d;
    lo = Math.max(lo, Math.min(s,t)); hi = Math.min(hi, Math.max(s,t));
  }
  return lo < hi ? [lo,hi] : null;
}

export function deliveryNetwork({edges, half}, occupied = () => false) {
  const stops = [], junctions = new Map();
  function junction(key) {
    if (!junctions.has(key)) junctions.set(key, { next: [] });
    return junctions.get(key);
  }
  for (const edge of edges) {
    const {r, g} = edge, offset = edge.offs[0], bound = half - Math.abs(offset) - STOP_RADIUS;
    const local = !/^(motorway|trunk)/.test(r.type) && !['yes','viaduct'].includes(r.t.bridge) && r.t.tunnel !== 'yes';
    let prev = junction(edge.from);
    for (let i = 1; i < g.length; i++) {
      const [ax,az] = g[i-1], dx = g[i][0]-ax, dz = g[i][1]-az, len = Math.hypot(dx,dz);
      if (!len) continue;
      const range = clip(ax,az,dx,dz,bound);
      if (!range) { prev = null; continue; }
      const [lo,hi] = range;
      if (lo > 0) prev = null;
      const count = Math.ceil(len*(hi-lo)/30);
      for (let j = 0; j < count; j++) {
        const t = lo + (hi-lo)*(j+0.5)/count;
        const point = { x:ax+t*dx-offset*dz/len, z:az+t*dz+offset*dx/len, name:r.name, next:[] };
        prev?.next.push(point);
        prev = point;
        if (local && !occupied(point.x,point.z,Math.atan2(-dz,dx))) {
          point.stop = true;
          stops.push(point);
        }
      }
      if (hi < 1) prev = null;
    }
    prev?.next.push(junction(edge.to));
  }
  return stops;
}

function reachable(start) {
  const seen = new Set([start]), queue = [start], stops = [];
  for (let i = 0; i < queue.length; i++) {
    const point = queue[i];
    if (point.stop) stops.push(point);
    for (const next of point.next) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return stops;
}

export function createDelivery(stops, random = Math.random) {
  let phase = 'idle', pickup, dropoff;
  const pick = list => list[Math.floor(random()*list.length)];
  function start(x,z) {
    if (phase !== 'idle' || !stops.length) return false;
    const car = {x,z};
    const nearest = stops.reduce((a,b) => separation(a,car) <= separation(b,car) ? a : b);
    const options = reachable(nearest);
    const nearby = options.filter(p => separation(p,car) >= 20 && separation(p,car) <= 90);
    // A nearby one-way dead end may have no onward delivery. The starting lane is also a valid pickup.
    for (const origin of nearby.length ? [pick(nearby), nearest] : [nearest]) {
      const destinations = (origin === nearest ? options : reachable(origin)).filter(p => separation(p,origin) >= 60);
      if (!destinations.length) continue;
      const short = destinations.filter(p => separation(p,origin) <= 400);
      pickup = origin; dropoff = pick(short.length ? short : destinations);
      phase = 'pickup';
      return true;
    }
    return false;
  }
  return {
    start,
    get phase() { return phase; },
    get target() { return phase === 'pickup' ? pickup : phase === 'dropoff' ? dropoff : null; },
    cancel() { phase = 'idle'; pickup = dropoff = null; },
    arrive(x,z,speed) {
      if (!this.target || Math.abs(speed) > 0.5 || separation(this.target,{x,z}) > STOP_RADIUS) return null;
      if (phase === 'pickup') { phase = 'dropoff'; return 'collected'; }
      this.cancel();
      return 'delivered';
    }
  };
}
