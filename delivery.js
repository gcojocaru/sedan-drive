// Parcel jobs use the directed road graph already loaded for traffic. Distances are in metres.
export const STOP_RADIUS = 7;
const separation = (a,b) => Math.hypot(a.x-b.x, a.z-b.z);

// What's at stake once the parcel is aboard: the clock, the parcel's condition and the fines.
export const FINE = 10; // for running a red light
export const KNOCK_FINE = 25; // for knocking into a pedestrian
// Seconds allowed for a round `metres` long (pickup to the last drop-off, stop to stop): by road about 1.5 times as
// far, at 9 m/s (town driving, junctions and lights), plus 25 s to find the way and 15 s for each further drop-off.
export const allowedTime = (metres, drops = 1) => Math.round(25 + 1.5 * metres / 9 + 15 * (drops - 1));

// Delivery levels, reached by deliveries made. The first jobs are easy: one parcel, a short way, time to spare. Each
// level on carries a bigger group of parcels to more drop-offs, farther apart, with harder cargo, for more pay.
// from: deliveries made; drops: drop-offs a job; reach: m from one stop to the next, at most (when there's a choice);
// cargo: what it may carry; ease: the clock's factor; pay: the pay's factor.
export const JOB_LEVELS = [
  { name: 'Trainee', from: 0, drops: 1, reach: 250, cargo: ['parcel'], ease: 1.3, pay: 1 },
  { name: 'Courier', from: 3, drops: 1, reach: 400, cargo: ['parcel', 'fragile'], ease: 1.1, pay: 1.1 },
  { name: 'Round driver', from: 7, drops: 2, reach: 350, cargo: ['parcel', 'fragile'], ease: 1, pay: 1.25 },
  { name: 'Senior courier', from: 12, drops: 3, reach: 350, cargo: ['parcel', 'fragile', 'heavy'], ease: 1, pay: 1.4 },
  { name: 'Express courier', from: 18, drops: 4, reach: 400, cargo: ['fragile', 'heavy', 'express'], ease: 1, pay: 1.6 },
  { name: 'Logistics ace', from: 26, drops: 5, reach: 450, cargo: ['fragile', 'heavy', 'express'], ease: 0.95, pay: 1.85 }
];
export const levelOf = jobs => JOB_LEVELS.findLastIndex(l => jobs >= l.from);
// What a job carries: its name for one and for many, a word of advice, and what it does while aboard: damage (how much harder a crash
// hits it), time (the clock's factor), pay (the pay's factor), power and brake (the car's, loaded).
export const CARGO = {
  parcel: { one: 'parcel', many: 'parcels', tip: '', damage: 1, time: 1, pay: 1, power: 1, brake: 1 },
  fragile: { one: 'fragile parcel', many: 'fragile parcels', tip: 'handle with care', damage: 2, time: 1, pay: 1.3, power: 1, brake: 1 },
  heavy: { one: 'heavy crate', many: 'heavy crates', tip: 'the car is slower loaded', damage: 1, time: 1.15, pay: 1.35, power: 0.72, brake: 0.85 },
  express: { one: 'express letter', many: 'express letters', tip: 'tight clock', damage: 0.5, time: 0.7, pay: 1.5, power: 1, brake: 1 }
};
// What reaching level i brings, for the level-up note
export function levelText(i) {
  const L = JOB_LEVELS[i], before = JOB_LEVELS[i - 1], fresh = L.cargo.filter(k => !before?.cargo.includes(k)).map(k => CARGO[k].many);
  return [L.drops > (before?.drops ?? 0) ? (L.drops > 1 ? L.drops + ' drop-offs a job' : 'one drop-off a job') : 'farther drop-offs', ...fresh, 'better pay'].join(', ');
}
// The parcel's condition (1 = perfect, 0 = ruined) after a crash at `speed` m/s: a knock under 1.5 m/s does nothing,
// one at 30 km/h takes about a third off, and a crash at 75 km/h ruins it. cushion: the share of that the padding lets
// through (garage.js).
export const afterCrash = (condition, speed, cushion = 1) => Math.max(0, condition - cushion * Math.max(0, Math.abs(speed) - 1.5) / 19.3);
// The pay for a delivery, in whole money: base for the drop-offs and the distance (times the level's and cargo's rate),
// a bonus of up to 40% for arriving early, less for arriving late (down to a fifth of the base a minute late), less
// for the damage, minus the fines. Never below 0.
export function deliveryPay({ metres, allowed, taken, condition = 1, fines = 0, drops = 1, rate = 1 }) {
  const base = Math.round((5 * drops + 0.03 * metres) * rate), spare = allowed - taken;
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
// (fined: what each fine was for, 'red light' or 'pedestrian'; red lights when not known; drops and kind: how many of
// what, one parcel when not known)
export function receiptText(r) {
  const why = r.fined || [], reds = why.every(f => f === 'red light'), n = r.drops || 1;
  const parts = [[r.base, 'pay'], [r.bonus, 'early'], [r.late, 'late'], [r.damage, 'damage'], [r.fines, !reds ? (why.length > 1 ? 'fines' : 'pedestrian hit') : r.fines === -FINE ? 'red light' : 'red lights']];
  const what = n > 1 ? n + ' ' + CARGO[r.kind || 'parcel'].many + ' ' : r.kind && r.kind !== 'parcel' ? 'the ' + CARGO[r.kind].one + ' ' : '';
  return { title: 'Delivered ' + what + 'in ' + minutes(r.taken) + ' · ' + money(r.total), detail: parts.filter(([n]) => n).map(([n, what], i) => (i && n > 0 ? '+' : '') + money(n) + ' ' + what).join(' · ') };
}

// A job: pick the load up, then drop it off, a parcel at each drop-off in turn. start(x, z, level, kind) plans it for
// a JOB_LEVELS level (kind: the cargo, else one the level carries at random). Once it's aboard (`load`: { metres,
// drops, allowed, since, condition, fines, fined, rate }), crash() damages it, and ranRed() and knocked() (into a
// pedestrian) fine the driver; delivering the last parcel leaves the pay in `receipt`. Times are in seconds of
// driving, passed in as t.
export function createDelivery(stops, random = Math.random) {
  let phase = 'idle', pickup, drops = [], next = 0, kind = 'parcel', level = 0, load = null, receipt = null;
  const pick = list => list[Math.floor(random()*list.length)];
  function start(x, z, lvl = 0, want = null) {
    if (phase !== 'idle' || !stops.length) return false;
    const car = {x,z}, L = JOB_LEVELS[Math.max(0, Math.min(lvl, JOB_LEVELS.length - 1))];
    const nearest = stops.reduce((a,b) => separation(a,car) <= separation(b,car) ? a : b);
    const options = reachable(nearest);
    const nearby = options.filter(p => separation(p,car) >= 20 && separation(p,car) <= 90);
    // A nearby one-way dead end may have no onward delivery. The starting lane is also a valid pickup.
    for (const origin of nearby.length ? [pick(nearby), nearest] : [nearest]) {
      // the round: each drop-off reachable from the stop before, 60 m on from it and clear of every other stop. A drop-off
      // can lead somewhere with no way on (a one-way dead end), so it's planned a few times for the whole group.
      let round = [origin];
      for (let tries = 0; tries < 6 && round.length <= L.drops; tries++) {
        const plan = [origin];
        while (plan.length <= L.drops) {
          const from = plan.at(-1), far = (from === nearest ? options : reachable(from)).filter(p => separation(p,from) >= 60 && plan.every(q => separation(p,q) >= 40));
          if (!far.length) break; // (fewer drop-offs where the streets run out)
          const near = far.filter(p => separation(p,from) <= L.reach);
          plan.push(pick(near.length ? near : far));
        }
        if (plan.length > round.length) round = plan;
      }
      if (round.length < 2) continue;
      pickup = origin; drops = round.slice(1); next = 0; level = L; kind = want || pick(L.cargo);
      phase = 'pickup';
      return true;
    }
    return false;
  }
  return {
    start,
    get phase() { return phase; },
    get target() { return phase === 'pickup' ? pickup : phase === 'dropoff' ? drops[next] : null; },
    get load() { return load; },
    get receipt() { return receipt; },
    // the job in hand: its cargo kind, how many parcels and how many delivered so far (null with no job)
    get job() { return phase === 'idle' ? null : { kind, cargo: CARGO[kind], parcels: drops.length, delivered: next, level }; },
    cancel() { phase = 'idle'; pickup = load = null; drops = []; next = 0; },
    crash(speed, cushion = 1) { if (load) load.condition = afterCrash(load.condition, speed, cushion * CARGO[kind].damage); },
    ranRed() { if (load) { load.fines += FINE; load.fined.push('red light'); } },
    knocked() { if (load) { load.fines += KNOCK_FINE; load.fined.push('pedestrian'); } },
    // at the stop the job is waiting for, stopped: 'collected', 'dropped' (a parcel, more to go) or 'delivered'
    arrive(x,z,speed,t = 0) {
      if (!this.target || Math.abs(speed) > 0.5 || separation(this.target,{x,z}) > STOP_RADIUS) return null;
      if (phase === 'pickup') {
        const metres = drops.reduce((m, p, i) => m + separation(i ? drops[i - 1] : pickup, p), 0), n = drops.length;
        phase = 'dropoff'; load = { metres, drops: n, allowed: Math.round(allowedTime(metres, n) * level.ease * CARGO[kind].time), since: t, condition: 1, fines: 0, fined: [], rate: level.pay * CARGO[kind].pay };
        return 'collected';
      }
      if (next < drops.length - 1) { next++; return 'dropped'; }
      receipt = { ...deliveryPay({ ...load, taken: t - load.since }), taken: t - load.since, condition: load.condition, fined: load.fined, drops: load.drops, kind };
      this.cancel();
      return 'delivered';
    }
  };
}
