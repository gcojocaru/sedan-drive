import test from 'node:test';
import assert from 'node:assert/strict';
import { levelWaters } from '../water-levels.js';

test('water either side of a tile edge shares a level while a nearby pond keeps its own',()=>{
  const square=x=>({kind:'water',t:{},outer:[[x,0],[x+10,0],[x+10,10],[x,10]]});
  const polys=[square(0),square(10),square(22)];
  levelWaters(polys,x=>x/4);
  assert.equal(polys[0].waterLevel,polys[1].waterLevel);
  assert.ok(polys[2].waterLevel>polys[1].waterLevel);
});
