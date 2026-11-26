// Place physical signs in local map metres. A sign's (dx,dz) runs along its text baseline.
import { segDist } from './geom.js';
import { HALF } from './osm-query.js';

const nameOf = t => typeof t.name === 'string' ? t.name.trim().replace(/\s+/gu, ' ') : '';

export function landmarkName(t) {
  const shop = t.shop && !['no', 'vacant', 'closed', 'disused'].includes(t.shop);
  const station = ['station', 'halt'].includes(t.railway) || t.public_transport === 'station' || t.amenity === 'bus_station';
  if (shop || station || ['train_station', 'retail', 'supermarket'].includes(t.building) ||
      ['park', 'garden'].includes(t.leisure) || t.amenity === 'marketplace') return nameOf(t);
  return '';
}

function roadside(road) {
  return !/^(motorway|trunk)(_|$)/.test(road.type) && (!road.t.bridge || road.t.bridge === 'no') &&
    (!road.t.tunnel || road.t.tunnel === 'no');
}

// A way can have several short segments between the junction and its kerb.
function alongArm(arm, distance) {
  const g = arm.road.g;
  for (let i = arm.i; g[i + arm.direction]; i += arm.direction) {
    const p = g[i], q = g[i + arm.direction], dx = q[0]-p[0], dz = q[1]-p[1];
    const length = Math.hypot(dx, dz);
    if (length && distance <= length) {
      const ux = dx / length, uz = dz / length;
      return { x: p[0] + distance * ux, z: p[1] + distance * uz, ux, uz };
    }
    distance -= length;
  }
  return null;
}

function streetSigns(junctions, put) {
  const distance = arms => { const a = arms[0], [x,z] = a.road.g[a.i]; return x*x + z*z; };
  let count = 0;
  for (const arms of [...junctions].sort((a, b) => distance(a) - distance(b))) {
    const names = new Set(arms.map(a => nameOf(a.road.t)));
    if (names.size < 2) continue; // a divided continuation of the same named road
    for (const a of arms) {
      const label = nameOf(a.road.t);
      if (!label || !names.has(label) || !roadside(a.road)) continue;
      const kerb = alongArm(a, a.clear + 2.1);
      if (!kerb) continue;
      for (const side of [a.road.lanes.side, -a.road.lanes.side]) {
        const offset = side * (a.road.hw + 1.3);
        const x = kerb.x - offset * kerb.uz, z = kerb.z + offset * kerb.ux;
        if (put('street', label, x, z, kerb.ux, kerb.uz)) {
          names.delete(label);
          if (++count === 96) return;
          break;
        }
      }
    }
  }
}

// Try the roadside nearest the feature's boundary. Sampling edges as well as vertices
// lets a large park have a sign on its street frontage even when its centre is far away.
function frontages(points, roadAt) {
  const candidates = [];
  function consider(x, z) {
    if (Math.abs(x) > HALF + 40 || Math.abs(z) > HALF + 40) return;
    const { drv: s, de } = roadAt(x, z);
    if (!s || de > 32 || !roadside(s.r)) return;
    const [distance, t] = segDist(x, z, s), len = Math.hypot(s.dx, s.dz);
    if (!len) return;
    const dx = s.dx / len, dz = s.dz / len;
    const rx = s.ax + t * s.dx, rz = s.az + t * s.dz;
    const side = (x - rx) * -dz + (z - rz) * dx < 0 ? -1 : 1;
    const travel = s.r.lanes?.one || side * (s.r.lanes?.side ?? 1);
    candidates.push({ rx, rz, dx, dz, side, travel, hw: s.hw, distance });
  }
  if (points.length === 1) consider(...points[0]);
  else {
    const stride = Math.max(1, Math.ceil((points.length - 1) / 24));
    for (let i = 0; i < points.length - 1; i += stride) {
      const a = points[i], b = points[i + 1];
      consider((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      consider(a[0], a[1]);
    }
  }
  return candidates.sort((a,b) => a.distance - b.distance);
}

function placeLandmark(feature, roadAt, put) {
  for (const { rx, rz, dx, dz, side, travel, hw } of frontages(feature.points, roadAt)) {
    const nx = -dz * side, nz = dx * side;
    // A board angled towards traffic is easier to read on approach. On a narrow
    // frontage keep it parallel to the kerb so the ends clear the wall and street.
    for (const angle of [Math.PI/4, Math.PI/9, 0]) {
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const inset = hw + 0.8 + 1.8 * sin;
      const ux = dx * cos - travel * nx * sin, uz = dz * cos - travel * nz * sin;
      for (const shift of [0, 3, -3]) {
        if (put('landmark', feature.label, rx + nx * inset + dx * shift, rz + nz * inset + dz * shift, ux, uz)) return true;
      }
    }
  }
  return false;
}

export function planSigns(junctions, landmarks, roadAt, clear) {
  const signs = [];
  function put(kind, label, x, z, dx, dz) {
    for (const s of signs) {
      const gap = s.label === label && s.kind === kind ? 28 : 4;
      if ((x-s.x)**2 + (z-s.z)**2 < gap*gap) return false;
    }
    for (const offset of [0, -1.8, 1.8]) {
      const px = x + dx * offset, pz = z + dz * offset;
      if (Math.abs(px) > HALF || Math.abs(pz) > HALF || !clear(px, pz)) return false;
    }
    signs.push({ kind, label, x, z, dx, dz });
    return true;
  }
  streetSigns(junctions, put);
  let placed = 0;
  for (const feature of landmarks) if (placeLandmark(feature, roadAt, put) && ++placed === 48) break;
  return signs;
}
