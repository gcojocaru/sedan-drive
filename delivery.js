// Parcel jobs use the directed road graph already loaded for traffic. Distances are in metres.
export const STOP_RADIUS = 7;
const separation = (a,b) => Math.hypot(a.x-b.x, a.z-b.z);

// What's at stake once the parcel is aboard: the clock, the parcel's condition and the fines.
export const FINE = 10; // for running a red light
// Seconds allowed from pickup to drop-off `metres` apart: by road about 1.5 times as far, at 9 m/s (town driving,
// junctions and lights), plus 25 s to find the way.
export const allowedTime = metres => Math.round(25 + 1.5 * metres / 9);
// The parcel's condition (1 = perfect, 0 = ruined) after a crash at `speed` m/s: a knock under 1.5 m/s does nothing,
// one at 30 km/h takes about a third off, and a crash at 75 km/h ruins it. cushion: the share of that the padding lets
// through (garage.js).
export const afterCrash = (condition, speed, cushion = 1) => Math.max(0, condition - cushion * Math.max(0, Math.abs(speed) - 1.5) / 19.3);
// The pay for a delivery, in whole money: base for the distance, a bonus of up to 40% for arriving early, less for
// arriving late (down to a fifth of the base a minute late), less for the damage, minus the fines. Never below 0.
export function deliveryPay({ metres, allowed, taken, condition = 1, fines = 0 }) {
  const base = Math.round(5 + 0.03 * metres), spare = allowed - taken;
  const bonus = spare > 0 ? Math.round(0.4 * base * spare / allowed) : 0;
  const late = spare < 0 ? -Math.round(base * Math.min(0.8, -spare / 75)) : 0;
  const damage = -Math.round((base + bonus + late) * (1 - condition));
  return { base, bonus, late, damage, fines: -fines, total: Math.max(0, base + bonus + late + damage - fines) };
}

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

// Money and time as the HUD shows them: $12 or −$10; m:ss (of a duration either side of zero)
export const money = n => (n < 0 ? '−$' : '$') + Math.abs(n);
export const minutes = s => { s = Math.round(Math.abs(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// A delivery's receipt for the HUD: what it paid and how long it took, then the pay and each adjustment there was
export function receiptText(r) {
  const parts = [[r.base, 'pay'], [r.bonus, 'early'], [r.late, 'late'], [r.damage, 'damage'], [r.fines, r.fines === -FINE ? 'red light' : 'red lights']];
  return { title: 'Delivered in ' + minutes(r.taken) + ' · ' + money(r.total), detail: parts.filter(([n]) => n).map(([n, what], i) => (i && n > 0 ? '+' : '') + money(n) + ' ' + what).join(' · ') };
}

// A job: pick the parcel up, then drop it off. Once it's aboard (`load`: { metres, allowed, since, condition,
// fines }), crash() damages it and ranRed() fines the driver; delivering it leaves the pay in `receipt`. Times are
// in seconds of driving, passed in as t.
export function createDelivery(stops, random = Math.random) {
  let phase = 'idle', pickup, dropoff, load = null, receipt = null;
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
    get load() { return load; },
    get receipt() { return receipt; },
    cancel() { phase = 'idle'; pickup = dropoff = load = null; },
    crash(speed, cushion = 1) { if (load) load.condition = afterCrash(load.condition, speed, cushion); },
    ranRed() { if (load) load.fines += FINE; },
    arrive(x,z,speed,t = 0) {
      if (!this.target || Math.abs(speed) > 0.5 || separation(this.target,{x,z}) > STOP_RADIUS) return null;
      if (phase === 'pickup') {
        const metres = separation(pickup, dropoff);
        phase = 'dropoff'; load = { metres, allowed: allowedTime(metres), since: t, condition: 1, fines: 0 };
        return 'collected';
      }
      receipt = { ...deliveryPay({ ...load, taken: t - load.since }), taken: t - load.since, condition: load.condition };
      this.cancel();
      return 'delivered';
    }
  };
}
