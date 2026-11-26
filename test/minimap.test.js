import test from 'node:test';
import assert from 'node:assert/strict';
import { addressAnchor } from '../minimap-labels.js';
import { createMinimap, minimapView, minimapPoint } from '../minimap.js';

test('the car stays at the centre as the north-up view moves east and south', () => {
  const origin = minimapView(0, 0, 0, 500);
  const moved = minimapView(40, 60, 0, 500);
  assert.equal(origin.left + origin.span / 2, 500);
  assert.equal(origin.top + origin.span / 2, 500);
  assert.equal(moved.left - origin.left, 40);
  assert.equal(moved.top - origin.top, 60);
});

test('at the playable boundary the view includes the space beyond the map', () => {
  const northwest = minimapView(-500, -500, 0, 500);
  const southeast = minimapView(500, 500, 0, 500);
  assert.equal(northwest.left, -northwest.span / 2);
  assert.equal(northwest.top, -northwest.span / 2);
  assert.equal(southeast.left + southeast.span / 2, 1000);
  assert.equal(southeast.top + southeast.span / 2, 1000);
});

test('the arrow follows car heading on a canvas with north at the top', () => {
  for (const [heading, dx, dy] of [[0, 1, 0], [Math.PI / 2, 0, -1], [Math.PI, -1, 0], [-Math.PI / 2, 0, 1]]) {
    const { rotation } = minimapView(0, 0, heading, 500);
    assert.ok(Math.abs(Math.sin(rotation) - dx) < 1e-10);
    assert.ok(Math.abs(-Math.cos(rotation) - dy) < 1e-10);
  }
});

test('a stationary car sees the marker update, point off-map and clear when the job ends', () => {
  const calls = [];
  const context = new Proxy({}, { get: (_,method) => (...args) => calls.push([method,...args]) });
  const canvas = { width:360, height:360, getContext:()=>context };
  const draw = createMinimap(canvas, {...canvas}, 500, {polys:[],seas:[],rivers:[],buildings:[],paths:[],roads:[]});
  const near = {x:45,z:0}, far = {x:350,z:0};
  draw(0,0,0,near);
  assert.ok(calls.some(([name])=>name==='arc'));
  calls.length=0;
  draw(0,0,0,near);
  assert.equal(calls.length,0);
  draw(0,0,0,far);
  assert.ok(calls.some(([name,x,y])=>name==='translate' && x===167 && y===90));
  calls.length=0;
  draw(0,0,0);
  assert.ok(calls.some(([name])=>name==='drawImage'));
  assert.ok(!calls.some(([name])=>name==='arc'));
});

test('the minimap labels the current street once and preserves mapped address suffixes', () => {
  const labels=[];
  const ctx=new Proxy({}, {get:(_,key)=>{
    if (key==='measureText') return value=>({width:value.length*7});
    if (key==='fillText') return value=>labels.push(value);
    return ()=>{};
  }});
  const canvas={width:360,height:360,getContext:()=>ctx};
  const road={name:'Market Street',hw:3.5,g:[[-480,0],[480,0]]};
  const building={kind:'building',t:{'addr:housenumber':'12B'},holes:[],outer:[[30,50],[50,50],[50,65],[30,65],[30,50]]};
  const draw=createMinimap(canvas,{...canvas},500,{polys:[building],buildings:[],roads:[road,road],seas:[],paths:[],rivers:[],
    addressPoints:[{point:[-60,-65],text:'4–6'},{point:[400,400],text:'88'}]});
  draw(0,0,0,{x:100,z:0});
  assert.equal(labels.filter(x=>x==='Market Street').length,1);
  assert.ok(labels.includes('12B') && labels.includes('4–6') && !labels.includes('88'));
});

test('the close goal arrow stays clear of the car and becomes an arrival ring inside the stop', () => {
  const calls=[];
  const ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args])});
  const canvas={width:360,height:360,getContext:()=>ctx};
  const draw=createMinimap(canvas,{...canvas},500,{polys:[],buildings:[],roads:[],seas:[],paths:[],rivers:[]});
  draw(0,0,0,{x:-9,z:0});
  assert.ok(calls.some(([key,x,y])=>key==='translate' && x===70 && y===90));
  calls.length=0;
  draw(0,0,0,{x:-2,z:0});
  assert.ok(calls.some(([key,x,y,r])=>key==='arc' && r===15));
});

test('an address on a building with a courtyard stays inside the occupied footprint', () => {
  const rect=(a,b)=>[[a,a],[b,a],[b,b],[a,b],[a,a]];
  const [x,z]=addressAnchor({outer:rect(-20,20),holes:[rect(-10,10)]});
  assert.equal(z,0);
  assert.ok(Math.abs(x)>10 && Math.abs(x)<20);
});

test('other cars land where they are relative to the player, north up', () => {
  const view = minimapView(100, -40, 1.2, 500), at = (x, z) => minimapPoint(x, z, view, 500, 180);
  assert.deepEqual(at(100, -40), [90, 90]); // the player is at the centre, whatever the heading
  const [ex, ey] = at(130, -40), [sx, sy] = at(100, -10); // 30 m east, 30 m south
  assert.ok(Math.abs(ex - 90 - 30 * 180 / view.span) < 1e-9 && ey === 90);
  assert.ok(sx === 90 && Math.abs(sy - 90 - 30 * 180 / view.span) < 1e-9);
});
