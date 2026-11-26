// Static objects on the real map. Headings use the same convention as the driving code (+X forward).
import { bbox, gkey, inPoly, seeded, segDist } from './geom.js';
import { HALF } from './osm-query.js';

export function furnitureKind(t) {
  if (t.indoor === 'yes' || t.location === 'underground' || Number(t.layer) < 0 || (t.level && Number(t.level) !== 0)) return null;
  if (t.amenity === 'bench') return 'bench';
  if (t.barrier === 'bollard' && t.bollard !== 'lowered') return 'bollard';
  if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && t.bus === 'yes')) return 'bus_stop';
  return null;
}

function mappedObject({ kind, t, point: [x,z] }, roadAt) {
  const { drv, de } = roadAt(x, z);
  let h = 0;
  if (drv && de < 25) {
    const len = Math.sqrt(drv.l2), dx = drv.dx / len, dz = drv.dz / len;
    const side = (x - drv.ax) * -dz + (z - drv.az) * dx;
    const dir = Math.abs(side) > 0.1 ? Math.sign(side) : drv.r.lanes.side;
    h = Math.atan2(-dz, dx) + (dir < 0 ? Math.PI : 0);
    // Legacy bus_stop nodes sometimes sit on the vehicle centreline. Put their pole on the kerb.
    if (kind === 'bus_stop' && de < 0.55) {
      const shift = (0.7 - de) * dir;
      x -= dz * shift;
      z += dx * shift;
    }
  }
  if (kind === 'bench' && typeof t.direction === 'string' && /^\d+(\.\d+)?$/.test(t.direction)) {
    // A bench faces local -Z; OSM bearings are clockwise from north.
    h = -Number(t.direction) * Math.PI / 180;
  }
  return { kind, x, z, h };
}

const sizes = { car: [2.22, 0.9], bench: [0.95, 0.34], bollard: [0.11, 0.11], bus_stop: [0.09, 0.09] };

// Separating-axis test between two oriented footprints.
function overlaps(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  for (const [u,v] of [[a.c,a.s],[-a.s,a.c],[b.c,b.s],[-b.s,b.c]]) {
    const reach = o => o.l * Math.abs(o.c*u + o.s*v) + o.w * Math.abs(o.c*v - o.s*u);
    if (Math.abs(dx*u + dz*v) > reach(a) + reach(b)) return false;
  }
  return true;
}

function footprint(x,z,h,l,w) { return { x,z,c:Math.cos(h),s:-Math.sin(h),l,w }; }

function lotRows(lot, remaining, clear, add) {
  const { outer, holes, t } = lot;
  if (lot.kind !== 'parking' || t.amenity !== 'parking' || t.indoor === 'yes' ||
      (t.location && t.location !== 'surface') || Number(t.layer) < 0 || (t.level && Number(t.level) !== 0) ||
      (t.parking && !['surface','street_side','layby'].includes(t.parking))) return;
  const budget = Math.min(remaining, 36, /^\d+$/.test(t.capacity) ? Number(t.capacity) : Infinity);
  if (!budget) return;
  const edges = [];
  let longest = 0, ux = 1, uz = 0;
  for (const ring of [outer, ...holes]) for (let i = 1; i < ring.length; i++) {
    const [ax,az] = ring[i-1], dx = ring[i][0]-ax, dz = ring[i][1]-az, l2 = dx*dx + dz*dz;
    if (!l2) continue;
    edges.push({ ax,az,dx,dz,l2 });
    if (ring === outer && l2 > longest) { longest = l2; ux = dx/Math.sqrt(l2); uz = dz/Math.sqrt(l2); }
  }
  if (!longest) return;
  const local = ([x,z]) => [x*ux + z*uz, z*ux - x*uz];
  const b = bbox(outer.map(local)), limit = HALF * (Math.abs(ux) + Math.abs(uz));
  const random = seeded(Math.round(outer[0][0]*17 + outer[0][1]*31));
  // Short, narrow lots fit a parallel row. Other lots get rows of perpendicular bays with a driving aisle.
  const parallel = b.z1-b.z0 < 6, along = parallel ? 6 : 3.1, across = parallel ? 5 : 10;
  const rows = Math.max(1, Math.floor((b.z1-b.z0) / across));
  const first = (b.z0+b.z1 - (rows-1)*across)/2;
  let count = 0;
  for (let j = Math.max(0, Math.ceil((-limit-first)/across)); j < rows && first+j*across <= limit; j++) {
    const v = first+j*across;
    for (let u = b.x0+along/2 + Math.max(0, Math.ceil((-limit-b.x0)/along))*along; u < Math.min(limit,b.x1); u += along) {
      if (random() > 0.64) continue;
      const x = u*ux-v*uz, z = u*uz+v*ux;
      if (Math.max(Math.abs(x),Math.abs(z)) > HALF-3 || !inPoly(x,z,outer) || holes.some(r=>inPoly(x,z,r))) continue;
      const h = Math.atan2(-uz,ux) + (parallel ? 0 : Math.PI/2) + (random()<0.5 ? Math.PI : 0);
      const c = Math.cos(h), s = -Math.sin(h);
      // A capsule slightly larger than the sedan encloses its footprint, including bumpers.
      let fits = true;
      for (const d of [-2.2,-1.1,0,1.1,2.2]) {
        const px=x+c*d, pz=z+s*d;
        if (edges.some(edge=>segDist(px,pz,edge)[0] < 1.1) ||
            [-0.95,0,0.95].some(w=>!clear(px-s*w,pz+c*w))) { fits=false; break; }
      }
      if (fits && add({kind:'car',x,z,h,paint:Math.floor(random()*18)}) && ++count >= budget) return;
    }
  }
}

export function planFurniture(nodes, polys, roadAt, clear) {
  const objects = [], grid = new Map();
  function hit(x,z,h=0,l=2.2,w=0.88) {
    const box = footprint(x,z,h,l,w), ix=Math.floor(x/8), iz=Math.floor(z/8);
    for (let i=ix-1; i<=ix+1; i++) for (let j=iz-1; j<=iz+1; j++) {
      for (const o of grid.get(gkey(i,j)) || []) if (overlaps(box,o)) return o.kind;
    }
    return null;
  }
  function add(o) {
    const [l,w] = sizes[o.kind];
    if (Math.max(Math.abs(o.x),Math.abs(o.z)) > HALF || hit(o.x,o.z,o.h,l,w)) return false;
    // A boarding platform and a legacy pole can describe the same stop.
    if (o.kind === 'bus_stop' && hit(o.x,o.z,o.h,2,1) === 'bus_stop') return false;
    const key = gkey(Math.floor(o.x/8),Math.floor(o.z/8));
    if (!grid.has(key)) grid.set(key,[]);
    grid.get(key).push({ ...footprint(o.x,o.z,o.h,l,w), kind:o.kind });
    objects.push(o);
    return true;
  }
  for (const node of nodes) add(mappedObject(node, roadAt));
  let parked = 0;
  for (const lot of polys) {
    if (parked >= 160) break;
    lotRows(lot, 160-parked, clear, car => {
      if (!add(car)) return false;
      parked++;
      return true;
    });
  }
  return { objects, hit };
}
