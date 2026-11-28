import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareRoads } from '../road-layout.js';
import { planCurbBlock, prepareCurbBlock, curbRiseAt } from '../curb-block.js';
import { walkGraph } from '../pedestrians.js';

function street(g, tags = {}) {
  return { g, hw: 3.5, walk: true, t: { highway: 'residential', ...tags }, name: 'Example Street' };
}

function plan({
  g = [
    [0, 0],
    [100, 0],
  ],
  tags = {},
  paths = [],
  nodes = [],
  half = 500,
} = {}) {
  const road = street(g, tags);
  const crossStreets = [g[0], g.at(-1)].map(([x, z]) =>
    street([
      [x, z - 30],
      [x, z],
      [x, z + 30],
    ]),
  );
  const { junctions } = prepareRoads([road, ...crossStreets], 'right');
  return planCurbBlock(junctions, paths, nodes, half);
}

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, `expected ${expected}, got ${actual}`);

test('a slanted unmarked crossing cuts each curb at its own entrance', () => {
  const crossing = {
    g: [
      [45, -10],
      [50, 0],
      [55, 10],
    ],
    t: { footway: 'crossing', crossing: 'unmarked' },
  };
  const block = plan({ paths: [crossing], nodes: [[50, 0]] });
  const [left, right] = block.strips;
  assert.equal(left.cuts.length, 1);
  assert.equal(right.cuts.length, 1);
  close(left.cuts[0], 48.25);
  close(right.cuts[0], 51.75);
  for (const strip of block.strips) {
    const s = strip.cuts[0],
      z = strip.side * 4;
    close(curbRiseAt(block, s, z), 0);
    close(curbRiseAt(block, s + 1.5, z), 0);
    close(curbRiseAt(block, s + 2.4, z), 0.075);
    close(curbRiseAt(block, s + 3.3, z), 0.15);
  }
});

test('a node-only crossing lowers both sides and both block ends tie into the flat corners', () => {
  const block = plan({
    nodes: [
      [37, 0],
      [41, 7],
    ],
  });
  for (const { cuts, sections, side } of block.strips) {
    assert.deepEqual(cuts, [37]);
    assert.equal(sections[0].rise, 0);
    assert.equal(sections.at(-1).rise, 0);
    close(curbRiseAt(block, block.start + 0.9, side * 4.5), 0.075);
    close(curbRiseAt(block, block.end - 0.9, side * 4.5), 0.075);
    close(curbRiseAt(block, 50, side * 3), 0);
    close(curbRiseAt(block, 50, side * 6), 0);
  }
});

test('the slab follows a bent street and reaches crossings ending just short of the curb', () => {
  const crossing = {
    g: [
      [25, -3],
      [25, 3],
    ],
    t: { footway: 'crossing' },
  };
  const block = plan({
    g: [
      [0, 0],
      [40, 0],
      [95, 8],
    ],
    paths: [crossing],
  });
  for (const { sections, cuts } of block.strips) {
    assert.equal(cuts.length, 1);
    const tip = sections.find((section) => Math.abs(section.s - (cuts[0] + 1.5)) < 1e-8);
    assert.ok(tip && Math.abs(tip.x - 26.5) < 0.03);
    close(curbRiseAt(block, 25, sections[0].z + sections[0].nz * 0.2), 0);
    for (const section of sections.filter((s) => s.s > 35 && s.s < 60))
      close(curbRiseAt(block, section.x + section.nx, section.z + section.nz), 0.15);
  }
});

test('requires two existing walks, an at-grade block, and two playable junctions', () => {
  for (const tags of [
    { sidewalk: 'left' },
    { 'sidewalk:both': 'separate' },
    { 'sidewalk:right': 'no' },
    { bridge: 'yes' },
    { tunnel: 'yes' },
    { layer: '1' },
  ])
    assert.equal(plan({ tags }), null);
  assert.equal(plan({ half: 60 }), null);
  const { junctions } = prepareRoads(
    [
      street([
        [0, 0],
        [100, 0],
      ]),
    ],
    'right',
  );
  assert.equal(planCurbBlock(junctions, [], [], 500), null);
});

test('overhead crossings do not cut the walkway and the preview respects reverse one-way traffic', () => {
  const block = plan({
    tags: { oneway: '-1' },
    paths: [
      {
        g: [
          [40, -8],
          [40, 8],
        ],
        t: { footway: 'crossing', bridge: 'yes' },
      },
    ],
  });
  assert.deepEqual(
    block.strips.map((s) => s.cuts),
    [[], []],
  );
  close(Math.cos(block.approach.h), -1);
});

const facade = (x0, z0, x1, z1) => ({
  outer: [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ],
  holes: [],
});

test('a tight frontage gives pavement space back on only the selected block', () => {
  // Only the 0..100 block has both ends in this playable area.
  const road = street([
    [-600, 0],
    [0, 0],
    [100, 0],
    [600, 0],
  ]);
  const roads = [
    road,
    ...[-600, 0, 100, 600].map((x) =>
      street([
        [x, -20],
        [x, 0],
        [x, 20],
      ]),
    ),
  ];
  const { block, layout } = prepareCurbBlock(roads, 'right', [], [], 500, [facade(10, 3.85, 90, 12)]);
  assert.deepEqual(
    roads.slice(0, 3).map((r) => r.hw),
    [3.5, 2.8, 3.5],
  );
  assert.equal(block.road.lanes.total, 2);
  assert.ok(layout.spawnSegments.some((s) => s.road === block.road));
  const strip = block.strips.find((strip) => strip.side === 1);
  close(strip.sections.find((q) => q.s > 45).width, 1.05);
  close(curbRiseAt(block, 50, 3.8), 0.15);
  close(curbRiseAt(block, 50, 3.9), 0);
  const graph = walkGraph(roads, [], layout.junctions, { curbBlock: block });
  assert.ok(
    graph.edges.some(
      (e) => e.pts.some(([x, z]) => x > 35 && x < 65 && Math.abs(z - 3.325) < 0.01) && e.maxOffset < 0.24,
    ),
  );
});

test('tagged carriageways keep their dimensions while the pavement fits a recessed wall', () => {
  const road = street(
    [
      [0, 0],
      [100, 0],
    ],
    { width: '7' },
  );
  const roads = [
    road,
    ...[0, 100].map((x) =>
      street([
        [x, -20],
        [x, 0],
        [x, 20],
      ]),
    ),
  ];
  const { block } = prepareCurbBlock(roads, 'right', [], [], 500, [
    facade(10, 6.3, 90, 20),
    facade(50, -12, 70, -3.95),
  ]);
  assert.equal(block.road, road);
  close(curbRiseAt(block, 40, 6.2), 0.15);
  close(curbRiseAt(block, 40, 6.4), 0);
  close(curbRiseAt(block, 60, -4), 0);
  close(curbRiseAt(block, 60, -3.85), 0.15);
});
