import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTerrain } from '../terrain.js';

const plane = async (zoom, tx, ty) => {
  const rgba = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const origin = 2 ** (zoom-1) * 256;
    const raw = 32768 + 100 + (tx*256 + x-origin)/2 + (ty*256 + y-origin)/4;
    const i = 4*(y*256 + x);
    rgba[i] = Math.floor(raw/256); rgba[i+1] = Math.floor(raw)%256;
    rgba[i+2] = (raw%1)*256; rgba[i+3] = 255;
  }
  return rgba;
};

test('real-scale sampling across four tiles, area overlap and edge clamping', async () => {
  const terrain = await loadTerrain(0, 0, plane);
  assert.equal(terrain.active,true);
  assert.equal(terrain.height(0,0),0);
  const east = terrain.height(320,0), south = terrain.height(0,320);
  assert.ok(east > 8 && east < 9 && south > 4 && south < 4.5);
  assert.equal(terrain.height(700,1100),terrain.height(640,640));
  const next = await loadTerrain(0, 900/111320, plane);
  const absolute = (t,x,z) => t.height(x,z) - t.seaLevel;
  assert.ok(Math.abs(absolute(terrain,475,10) - absolute(next,-425,10)) < 1e-6);
});

test('missing, invalid, or stalled coverage yields a usable flat surface', async () => {
  const dead = () => new Promise(() => {});
  for (const t of [await loadTerrain(86,0,dead), await loadTerrain(0,0,async () => []),
    await loadTerrain(0,0,async () => {throw Error('offline');}), await loadTerrain(0,0,dead,5)]) {
    assert.equal(t.active,false);
    assert.equal(t.height(13,-9),0);
  }
});

test('an isolated elevation spike is softened while the underlying hill keeps its grade', async () => {
  const base = await loadTerrain(0,0,plane);
  const peak = await loadTerrain(0,0,async (zoom,x,y)=>{
    const rgba = await plane(zoom,x,y);
    const centre = 2 ** (zoom-1) * 256;
    for(let j=0;j<256;j++) for(let i=0;i<256;i++) {
      if(Math.abs(x*256+i-centre)<2 && Math.abs(y*256+j-centre)<2) rgba[(j*256+i)*4+1]+=18;
    }
    return rgba;
  });
  const rise = base.seaLevel - peak.seaLevel;
  assert.ok(rise > 0 && rise < 8);
  assert.ok(Math.abs((peak.height(384,0)-peak.height(256,0))-(base.height(384,0)-base.height(256,0)))<0.01);
});
