import test from 'node:test';
import assert from 'node:assert/strict';
import { drivingSide, laneLayout, laneSpawn, mappedStops, prepareRoads } from '../road-layout.js';
import { overpassQuery } from '../osm-query.js';

function street(g, opts = {}) {
  return { g, hw: 4, walk: true, name: 'Street', t: {}, ...opts };
}
function crossroads() {
  const main = street([[-40,0], [-13,0], [0,0], [40,0]], { nodes: [1,2,3,4] });
  const side = street([[0,-40], [0,0], [0,40]], { nodes: [5,3,6], hw: 5 });
  const layout = prepareRoads([main, side], 'right');
  return { main, side, layout };
}
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-8, a + ' differs from ' + b); }

test('travel lanes track the regional side, road override and reset heading', () => {
  for (const [country, sign] of [['RO', 1], ['GB', -1]]) {
    const side = drivingSide([{type:'area', tags:{'ISO3166-1':country}}]);
    const road = street([[-30,0],[30,0]]);
    const {spawnSegments} = prepareRoads([road], side);
    const forward = laneSpawn(spawnSegments, 0, 0, undefined, 500);
    const backward = laneSpawn(spawnSegments, 0, 0, Math.PI, 500);
    assert.equal(Math.sign(forward.z), sign);
    near(forward.z, -backward.z);
    near(Math.cos(backward.h), -1);
    assert.equal(laneLayout({...road, t:{driving_side:'left'}}, side).side, -1);
  }
});

test('one-way roads keep their legal heading and a one-lane road uses its centre', () => {
  for (const [tags, dir] of [[{oneway:'-1'},-1], [{oneway:'yes'},1], [{junction:'roundabout'},1]]) {
    const road = street([[-20,0],[20,0]], {t:tags});
    const {spawnSegments} = prepareRoads([road], 'right');
    const p = laneSpawn(spawnSegments, 0, 7, dir === 1 ? Math.PI : 0, 500);
    near(Math.cos(p.h), dir);
    near(p.z, 0);
  }
  assert.equal(laneLayout(street([], {t:{highway:'motorway',oneway:'no'}}), 'right').one, 0);
});

test('asymmetric lane counts put the direction divider and car in the correct lanes', () => {
  const road = street([[-20,0],[20,0]], {t:{lanes:'3','lanes:forward':'2','lanes:backward':'1'}});
  const {spawnSegments} = prepareRoads([road], 'right');
  const {dividers, width, edge} = road.lanes;
  near(dividers.find(line => line.boundary).offset, edge - 2 * width);
  near(laneSpawn(spawnSegments,0,0,0,500).z, edge-width/2);
  near(laneSpawn(spawnSegments,0,0,Math.PI,500).z, -edge+width/2);
});

test('junction corners, sidewalk and paint use the connected approaches and their widths', () => {
  const {main, side, layout} = crossroads();
  assert.equal(layout.junctions.length, 1);
  assert.equal(layout.corners.length, 4);
  assert.ok(layout.corners.every(c => c.poly.length > 4 && c.sidewalk?.length > 4));
  assert.equal(main.markSections.length, 2);
  assert.ok(main.markSections[0].at(-1)[0] < -side.hw);
  assert.ok(main.markSections[1][0][0] > side.hw);
  const p = laneSpawn(layout.spawnSegments, 0, 0, 0, 500);
  assert.ok(Math.hypot(p.x,p.z) > 9);
});

test('an overpass and split continuations retain their lane paint', () => {
  const lower = street([[-40,0],[0,0],[40,0]], {nodes:[1,2,3]});
  const bridge = street([[0,-40],[0,0],[0,40]], {nodes:[4,5,6],t:{bridge:'yes',layer:'1'}});
  const split = street([[40,0],[50,5]], {nodes:[3,7]});
  const layout=prepareRoads([lower,bridge,split], 'right');
  assert.equal(layout.junctions.length, 0);
  assert.deepEqual(lower.markSections, [lower.g]);
});

test('mapped stop bars cover only incoming lanes and all-way stops cover all four arms', () => {
  const {main,side,layout} = crossroads();
  const bars = tags => mappedStops([main,side], layout.junctions, tags);
  assert.equal(bars([]).length, 0);
  const [[a,b]] = bars([{id:2, p:[-13,0], tags:{highway:'stop'}}]);
  near(a[0], -13); near(b[0], -13); near(a[1], main.lanes.edge); near(b[1], 0);
  assert.equal(bars([{id:3,p:[0,0],tags:{highway:'stop',stop:'all'}}]).length, 4);
  assert.equal(bars([{id:3,p:[0,0],tags:{highway:'stop'}}]).length, 0);
  assert.ok(overpassQuery(44,26).includes('node["highway"="stop"]'));
});

test('spawn clips to the playable boundary and handles an empty road network', () => {
  const road = street([[0,0],[600,0]]);
  const {spawnSegments} = prepareRoads([road],'right');
  near(laneSpawn(spawnSegments,600,0,0,500).x, 497.5);
  assert.equal(laneSpawn([],0,0,0,500), null);
});
