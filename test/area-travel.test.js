import test from 'node:test';
import assert from 'node:assert/strict';
import { nextArea, crossedEdge, edgePrompt, travelDelay } from '../area-travel.js';
import { onGrid } from '../osm-query.js';

test('a collision reports the crossed side, including reverse travel and corners', () => {
  assert.equal(crossedEdge(500, -500), null);
  assert.deepEqual([[501, 0], [0, -501], [-501, 0], [0, 501], [-501, -502]].map(([x,z]) => crossedEdge(x,z)),
    ['east', 'north', 'west', 'south', 'north']);
});

test('all four crossings remain on the download grid and preserve the geographic point and heading', () => {
  for (const lat of [-68, 0, 44.427, 84]) {
    const lon = 26.1;
    const scale = l => 111320 * Math.cos(l * Math.PI / 180);
    for (const [direction, x, z] of [['west',-498,87],['east',498,87],['north',-17,-498],['south',-17,498]]) {
      const result = nextArea(lat, lon, direction, { x, z, h: 1.1 });
      assert.ok(onGrid(result.lat) && onGrid(result.lon));
      assert.ok(Math.abs(result.entry.x) < 460 && Math.abs(result.entry.z) < 460);
      assert.ok(Math.abs(result.lat - result.entry.z / 110574 - (lat - z / 110574)) < 1e-9);
      assert.ok(Math.abs(result.lon + result.entry.x / scale(result.lat) - (lon + x / scale(lat))) < 1e-9);
      assert.equal(result.entry.h, 1.1);
    }
  }
});

test('crossings stop at the map providers’ latitude and longitude limits', () => {
  assert.equal(nextArea(85,0,'north',{x:0,z:-498}), null);
  assert.equal(nextArea(0,179.995,'east',{x:498,z:0}), null);
});

test('the cooldown counts down in whole seconds and expires at the deadline', () => {
  assert.equal(travelDelay(40_000,10_000),30);
  assert.equal(travelDelay(40_000,39_999),1);
  assert.equal(travelDelay(40_000,40_000),0);
  assert.equal(travelDelay(undefined,40_000),0);
});

test('staying suppresses repeat prompts at that edge until the car moves back inside', t => {
  const history = Object.getOwnPropertyDescriptor(globalThis, 'history');
  Object.defineProperty(globalThis, 'history', { configurable: true, value: { state: null } });
  t.after(() => history ? Object.defineProperty(globalThis, 'history', history) : delete globalThis.history);
  const dialog = new EventTarget();
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  const stay = { focus() {} }, proceed = {};
  const trips = [];
  const prompt = edgePrompt({ dialog, title: {}, detail: {}, proceed, stay,
    destination: side => ({ side }), depart: trip => trips.push(trip.side) });
  t.after(() => dialog.close());
  prompt.offer('east');
  assert.ok(dialog.open);
  stay.onclick();
  prompt.move(495, 0);
  prompt.offer('east');
  assert.equal(dialog.open, false);
  prompt.move(475, 0);
  prompt.offer('east');
  assert.ok(dialog.open);
  proceed.onclick();
  proceed.onclick();
  assert.deepEqual(trips, ['east']);
});
