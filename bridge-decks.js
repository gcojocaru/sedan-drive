// A sparse 4 m mesh aligned with the DEM triangles. Both render and tyre heights
// use this mesh, including the approaches at intersections beside a river.
import { cumLen, densify } from './geom.js';

function fade(distance, reach) {
  const t = Math.min(1, distance / reach);
  return (1-t)*(1-t)*(1+2*t);
}

export function bridgeDecks(ways, ground, waterAt, extent = 640) {
  const step = 4, stride = 2 * extent / step + 1;
  const lifts = new Map(), banks = new Map(), bounds = [], crossings = [];
  const key = (x,z) => (z + extent) / step * stride + (x + extent) / step;

  const wet = new Map();
  const isWet = (x,z) => {
    const k = key(x,z);
    if (!wet.has(k)) wet.set(k, Number.isFinite(waterAt(x,z)));
    return wet.get(k);
  };
  for (const road of ways) {
    if (!road.t.bridge || road.t.bridge === 'no' || road.g.length < 2) continue;
    const g = road.g, stations = cumLen(g), length = stations.at(-1);
    if (!length) continue;
    const samples = densify(g, 4);
    const levels = samples.map(([x,z]) => waterAt(x,z) ?? -Infinity);
    let water = -Infinity;
    for (const level of levels) water = Math.max(water,level);
    if (!Number.isFinite(water)) continue;
    crossings.push({road, samples, levels});
    const deck = water + 4;
    const start = Math.max(ground(...g[0]), deck), end = Math.max(ground(...g.at(-1)), deck);
    const width = road.hw + (road.walk ? 2.2 : 0) + step;
    // Give every bank connection enough run for a gradual change of grade.
    const rise = Math.max(start - ground(...g[0]), end - ground(...g.at(-1)));
    const reach = Math.max(40, Math.min(120, 12 * rise));
    for (let i = 1; i < g.length; i++) {
      const [ax,az] = g[i-1], [bx,bz] = g[i], len = stations[i]-stations[i-1];
      if (!len) continue;
      const dx = (bx-ax)/len, dz = (bz-az)/len, pad = width + reach;
      const minX = Math.max(-extent,step*Math.floor((Math.min(ax,bx)-pad)/step));
      const maxX = Math.min(extent,step*Math.ceil((Math.max(ax,bx)+pad)/step));
      const minZ = Math.max(-extent,step*Math.floor((Math.min(az,bz)-pad)/step));
      const maxZ = Math.min(extent,step*Math.ceil((Math.max(az,bz)+pad)/step));
      bounds.push([minX-step,maxX+step,minZ-step,maxZ+step]);
      for (let z=minZ; z<=maxZ; z+=step) for (let x=minX; x<=maxX; x+=step) {
        const along = (x-ax)*dx + (z-az)*dz;
        const across = Math.max(0, Math.abs((x-ax)*dz-(z-az)*dx)-width);
        const beyond = Math.max(0,-along,along-len);
        const distance = Math.hypot(across,beyond);
        if (distance >= reach) continue;
        const t = (stations[i-1]+Math.max(0,Math.min(len,along)))/length;
        const wetNode = isWet(x,z);
        const blend = wetNode ? fade(distance,step) : fade(distance,reach);
        const lift = (start+(end-start)*t-ground(x,z))*blend;
        const k = key(x,z);
        if (lift > (lifts.get(k) ?? 0)) lifts.set(k,lift);
      }
    }
  }
  // Carry the approaches into sidewalks, building foundations and verges.
  // Keep submerged ground below the span.
  for (const [k,lift] of lifts) {
    const x = k%stride*step-extent, z = Math.floor(k/stride)*step-extent;
    if (!isWet(x,z)) banks.set(k,lift);
  }
  function sampler(nodes) {
    return (x,z) => {
      const base = ground(x,z);
      if (Math.abs(x)>=extent || Math.abs(z)>=extent) return base;
      const gx = Math.floor(x/step)*step, gz = Math.floor(z/step)*step;
      const u=(x-gx)/step, v=(z-gz)/step, k=key(gx,gz);
      const a=nodes.get(k)??0, b=nodes.get(k+1)??0, c=nodes.get(k+stride)??0, d=nodes.get(k+stride+1)??0;
      return base + (u>=v ? a+(b-a)*u+(d-b)*v : a+(c-a)*v+(d-c)*u);
    };
  }
  function stepFor(poly) {
    const xs=poly.map(p=>p[0]), zs=poly.map(p=>p[1]);
    const x0=Math.min(...xs), x1=Math.max(...xs), z0=Math.min(...zs), z1=Math.max(...zs);
    return bounds.some(([a,b,c,d])=>x1>=a && x0<=b && z1>=c && z0<=d) ? step : 32;
  }
  const surface = {active:lifts.size>0, step, extent, stepFor};
  return {...surface, height:sampler(lifts), banks:{...surface,height:sampler(banks)}, crossings};
}
