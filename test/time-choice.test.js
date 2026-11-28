import test from 'node:test';
import assert from 'node:assert/strict';
import { nextChoice, hourIn, weatherIn, clock, timeText, minuteTick } from '../time-choice.js';

const TIMES = [['Morning', 8], ['Night', 23.6]], WEATHERS = [{ kind: 'clear', label: 'Clear' }, { kind: 'rain', label: 'Rain', amount: 0.7 }];

test('T and E go live, each preset, then live again', () => {
  const seen = []; let i = 'live';
  for (let k = 0; k < 4; k++) seen.push(i = nextChoice(i, 2));
  assert.deepEqual(seen, [0, 1, 'live', 0]);
});

test('the hour and weather to show', () => {
  assert.equal(hourIn(1, TIMES, 0, 0), 23.6);
  assert.equal(hourIn('live', TIMES, 15, 0), 1, 'live: the solar time there (15° east, midnight UTC)');
  assert.equal(weatherIn(1, WEATHERS, null).label, 'Rain');
  assert.equal(weatherIn('live', WEATHERS, null).label, 'Weather unavailable');
});

test('the status line: preset, local clock, weather, and what lies on the ground', () => {
  assert.equal(clock(23.999), '00:00'); assert.equal(clock(-1.5), '22:30');
  assert.equal(timeText({ tSel: 0, wSel: 1, times: TIMES, hour: 8, lon: 30, weather: WEATHERS[1], live: null }), 'Morning · 08:00 · Rain', 'no live data: the offset is guessed from the longitude');
  const live = { kind: 'clear', label: 'Clear', temp: -2.4, offset: 3 * 3600, snowDepth: 0.12 };
  assert.equal(timeText({ tSel: 'live', wSel: 'live', times: TIMES, hour: 12, lon: 30, weather: live, live }), '13:00 · Clear, -2°C, 12 cm on the ground', 'solar noon at 30° E, in UTC+3');
  const wet = { kind: 'overcast', label: 'Overcast', temp: 9, offset: 0, recent: 3 };
  assert.match(timeText({ tSel: 'live', wSel: 'live', times: TIMES, hour: 12, lon: 0, weather: wet, live: wet }), /wet roads$/);
});

test('the minute tick asks for weather every 15 minutes and moves the sun every 5', () => {
  assert.equal(minuteTick(15, 'live', 'live'), 'weather');
  assert.equal(minuteTick(15, 'live', 2), 'sun');
  assert.equal(minuteTick(10, 'live', 'live'), 'sun');
  assert.equal(minuteTick(10, 0, 'live'), 'clock');
  assert.equal(minuteTick(7, 'live', 'live'), 'clock');
});
