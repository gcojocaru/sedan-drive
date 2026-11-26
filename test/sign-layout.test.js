import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoads } from '../road-layout.js';
import { landmarkName, planSigns } from '../sign-layout.js';

function street(name, g, tags = {}) {
  return { type: 'residential', g, hw: 3.5, t: { name, ...tags } };
}
const open = () => true, noRoad = () => ({ drv: null });
const square = (x,z,w,h) => [[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]];

test('connected named streets get one aligned blade each, even along densely sampled ways', () => {
  const a = street('Oak Street', [[-30,0],[-2,0],[0,0],[2,0],[30,0]]);
  const b = street('Strada Școlii', [[0,0],[0,2],[0,30]]);
  const { junctions } = prepareRoads([a,b],'right');
  const signs = planSigns(junctions, [], noRoad, open);
  assert.deepEqual(signs.map(s=>s.label).sort(), ['Oak Street','Strada Școlii']);
  assert.ok(signs.every(s=>s.kind==='street' && Math.abs(s.x)>3.5 && Math.abs(s.z)>3.5));
  assert.equal(Math.abs(signs.find(s=>s.label===a.t.name).dx),1);
  assert.equal(Math.abs(signs.find(s=>s.label===b.t.name).dz),1);
  assert.deepEqual(planSigns(junctions, [], noRoad, () => false), []);
});

test('a grade-separated crossing or a same-name continuation has no junction labels', () => {
  const a=street('Bridge Street',[[-50,0],[0,0],[50,0]],{bridge:'yes',layer:'1'});
  const b=street('Station Road',[[0,-50],[0,0],[0,50]]);
  assert.deepEqual(planSigns(prepareRoads([a,b],'right').junctions, [], noRoad, open), []);
  a.t={name:b.t.name};
  assert.deepEqual(planSigns(prepareRoads([a,b],'right').junctions, [], noRoad, open), []);
});

test('landmarks need a mapped name and a supported place tag', () => {
  for (const tags of [{leisure:'park'},{shop:'bakery'},{railway:'halt'},{amenity:'bus_station'},{building:'train_station'}]) {
    assert.equal(landmarkName({...tags,name:'  Piața   Mare  '}),'Piața Mare');
    assert.equal(landmarkName(tags),'');
  }
  assert.equal(landmarkName({building:'apartments',name:'Block 6'}),'');
  assert.equal(landmarkName({shop:'vacant',name:'Old Shop'}),'');
});

test('a named outline is signed on its street-facing side; duplicate nodes, far and obstructed places are skipped', () => {
  const s = { ax:-100,az:0,dx:200,dz:0,l2:40000,hw:3.5,r:street('Oak Street',[[-100,0],[100,0]]) };
  const roadAt = (x,z) => ({ drv:s, de:Math.abs(z)-s.hw });
  const places = [{label:'City Park', points:square(-10,9,35,130)}, {label:'City Park', points:[[8,13]]},
    {label:'Distant',points:[[0,-85]]}, {label:'Station',points:[[60,-12]]}];
  const signs = planSigns([], places, roadAt, (x,z)=>x<45 && Math.abs(z)>s.hw);
  assert.equal(signs.length,1);
  assert.equal(signs[0].label,'City Park');
  assert.ok(signs[0].z > s.hw && signs[0].z < 9);
  assert.deepEqual(planSigns([], places, noRoad, open), []);
});
