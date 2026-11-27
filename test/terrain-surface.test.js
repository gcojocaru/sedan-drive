import test from 'node:test';
import assert from 'node:assert/strict';
import { drapeSurface } from '../terrain-surface.js';

test('long road triangles and paint follow the same grid facets even beyond the data edge', () => {
  const step = 32, extent = 64, vertex = (x,z) => Math.sin(x*3.4 + z)*20;
  function height(x,z) {
    x = Math.min(extent,Math.max(-extent,x))/step;
    z = Math.min(extent,Math.max(-extent,z))/step;
    const i = Math.floor(x), j = Math.floor(z), u = x-i, v = z-j;
    const a = vertex(i,j), d = vertex(i+1,j+1);
    return u > v ? a*(1-u)+vertex(i+1,j)*(u-v)+d*v : a*(1-v)+vertex(i,j+1)*(v-u)+d*u;
  }
  const points = [-150,0.05,-110, -35,0.05,131, 105,0.05,52];
  const mesh = drapeSurface(points,{height,step,extent});
  let area = 0;
  for (let i=0; i<mesh.length; i+=9) {
    const [x,y,z,a,b,c,d,e,f] = mesh.slice(i,i+9);
    assert.ok(Math.abs((y+b+e)/3 - height((x+a+d)/3,(z+c+f)/3) - 0.05) < 1e-7);
    area += Math.abs((a-x)*(f-z)-(c-z)*(d-x));
  }
  assert.ok(Math.abs(area - Math.abs(115*162-241*255)) < 1e-6);
});
