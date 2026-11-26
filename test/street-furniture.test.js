import test from 'node:test';
import assert from 'node:assert/strict';
import { furnitureKind, planFurniture } from '../street-furniture.js';
import { overpassQuery } from '../osm-query.js';

const rect = (x,z,w,d) => [[x,z],[x+w,z],[x+w,z+d],[x,z+d],[x,z]];
const lot = {kind:'parking',t:{amenity:'parking'},outer:rect(0,0,60,40),holes:[rect(15,10,15,15)]};
const away = () => ({drv:null,de:Infinity});
const open = () => true;

test('parked cars stay within the lot, clear of islands and mapped aisles on every visit', () => {
  const clear = x => x < 35 || x > 41;
  const plan = () => planFurniture([], [lot], away, clear);
  const {objects,hit} = plan();
  assert.ok(objects.length > 5);
  assert.deepEqual(objects,plan().objects);
  for (const car of objects) {
    assert.equal(hit(car.x,car.z,car.h), 'car');
    for (const l of [-2.2,0,2.2]) for (const w of [-0.9,0.9]) {
      const x = car.x + l*Math.cos(car.h) + w*Math.sin(car.h);
      const z = car.z - l*Math.sin(car.h) + w*Math.cos(car.h);
      assert.ok(x>0 && x<60 && z>0 && z<40 && clear(x));
      assert.ok(x<15 || x>30 || z<10 || z>25);
    }
  }
  assert.equal(hit(22,18),null);
});

test('mapped capacity limits parking and only outdoor parking outlines receive cars', () => {
  const count = tags => planFurniture([], [{...lot,t:tags}], away, open).objects.length;
  assert.equal(count({amenity:'parking',capacity:'2'}),2);
  for (const tags of [{landuse:'garages'}, {amenity:'parking',capacity:'0'}, {amenity:'parking',parking:'multi-storey'},
    {amenity:'parking',parking:'underground'},{amenity:'parking',level:'1'}]) assert.equal(count(tags),0);
});

test('furniture follows mapped tags, and a bus pole on the centreline moves to the driving-side kerb', () => {
  const road = () => ({drv:{ax:0,az:0,dx:10,dz:0,l2:100,r:{lanes:{side:-1}}},de:-3});
  const tags = [{amenity:'bench',direction:'90'},{barrier:'bollard'},{highway:'bus_stop'},{public_transport:'platform',bus:'yes'}];
  assert.equal(furnitureKind({public_transport:'stop_position',bus:'yes'}),null);
  assert.equal(furnitureKind({amenity:'bench',indoor:'yes'}),null);
  const nodes = tags.map((t,i)=>({t,kind:furnitureKind(t),point:[Math.min(i,2)*8,0]}));
  const {objects,hit} = planFurniture(nodes, [], road, open);
  assert.deepEqual(objects.map(o=>o.kind),['bench','bollard','bus_stop']);
  assert.equal(objects[0].h,-Math.PI/2);
  assert.equal(hit(8,0),'bollard');
  assert.equal(hit(8,3),null);
  assert.equal(objects[2].z,-3.7);
  for (const selector of ['node["amenity"="bench"]','node["highway"="bus_stop"]','node["barrier"="bollard"]',
    'way["public_transport"="platform"]["bus"="yes"]']) assert.ok(overpassQuery(0,0).includes(selector));
});
