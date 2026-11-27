// Split map triangles at each crease in the height field. Using the same planes for
// ground, asphalt and paint preserves their millimetre offsets, even on long ways.
import { clipHalf } from './geom.js';

function split(poly, a, b, c) {
  let low = false, high = false;
  for (const [x,z] of poly) {
    const d = a + b*x + c*z;
    if (d < -1e-8) low = true;
    if (d > 1e-8) high = true;
  }
  if (!low || !high) return [poly];
  return [clipHalf(poly,a,b,c), clipHalf(poly,-a,-b,-c)];
}

function strips(poly, axis, step, half) {
  const coords = poly.map(p => p[axis]);
  const first = Math.max(-half, (Math.floor(Math.min(...coords)/step)+1)*step);
  const last = Math.min(half, Math.max(...coords));
  const result = [];
  let rest = poly;
  for (let cut = first; cut <= last; cut += step) {
    const parts = split(rest, -cut, axis === 0 ? 1 : 0, axis === 1 ? 1 : 0);
    if (parts.length === 2) { result.push(parts[0]); rest = parts[1]; }
  }
  result.push(rest);
  return result;
}

export function drapeSurface(positions, {height, step: spacing, stepFor, extent: half = 640}) {
  const out = [];
  for (let i = 0; i < positions.length; i += 9) {
    const poly = [0,3,6].map(k => [positions[i+k], positions[i+k+2]]);
    const offset = positions[i+1], step = stepFor?.(poly) ?? spacing;
    for (const column of strips(poly,0,step,half)) {
      for (const cell of strips(column,1,step,half)) {
        const x = cell.reduce((s,p)=>s+p[0],0)/cell.length;
        const z = cell.reduce((s,p)=>s+p[1],0)/cell.length;
        const diagonal = (Math.floor(z/step)-Math.floor(x/step))*step;
        const faces = Math.abs(x) < half && Math.abs(z) < half ? split(cell, diagonal,1,-1) : [cell];
        for (const face of faces) {
          for (let j = 2; j < face.length; j++) {
            const [a,b,c] = [face[0],face[j-1],face[j]];
            if (Math.abs((a[0]-c[0])*(b[1]-c[1])-(a[1]-c[1])*(b[0]-c[0])) < 1e-10) continue;
            for (const [vx,vz] of [a,b,c]) out.push(vx,height(vx,vz)+offset,vz);
          }
        }
      }
    }
  }
  return out;
}
