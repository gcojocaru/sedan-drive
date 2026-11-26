import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERS, weatherOf, weatherNow, solarHour } from '../weather.js';

const reply = (status, body) => { const asked = []; return [asked, async (url, opts) => { asked.push([url, opts]); return { ok: status === 200, status, json: async () => body }; }]; };

test('WMO codes map to how the weather looks and how heavy it is', () => {
  assert.deepEqual(weatherOf(0), { kind: 'clear', label: 'Clear', amount: 0 });
  assert.deepEqual(weatherOf(3), { kind: 'overcast', label: 'Overcast', amount: 0 });
  assert.equal(weatherOf(48).kind, 'fog');
  assert.deepEqual(weatherOf(65), { kind: 'rain', label: 'Heavy rain', amount: 1 });
  assert.equal(weatherOf(53).kind, 'rain');
  assert.equal(weatherOf(85).kind, 'snow');
  assert.equal(weatherOf(99).kind, 'storm');
  assert.deepEqual(weatherOf(42), weatherOf(0)); // codes Open-Meteo never sends read as clear
});

test('every preset is a kind the codes use', () => {
  const kinds = new Set([0, 2, 3, 45, 63, 73, 95].map(c => weatherOf(c).kind));
  for (const w of WEATHERS) assert.ok(kinds.has(w.kind), w.kind);
});

test('weatherNow asks for the current weather at the place and reads its clock offset', async () => {
  const [asked, fetchFn] = reply(200, { utc_offset_seconds: 7200, current: { weather_code: 71, temperature_2m: -1.4 } });
  assert.deepEqual(await weatherNow(44.43551, 26.10249, fetchFn), { kind: 'snow', label: 'Light snow', amount: 0.4, temp: -1.4, offset: 7200 });
  assert.match(asked[0][0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=44\.436&longitude=26\.102&current=weather_code,temperature_2m&timezone=auto$/);
  assert.ok(asked[0][1].signal);
});

test('weatherNow rejects a failed or empty reply', async () => {
  await assert.rejects(weatherNow(0, 0, reply(429, {})[1]), /HTTP 429/);
  await assert.rejects(weatherNow(0, 0, reply(200, { error: true })[1]), /no current weather/);
});

test('solar time runs with longitude, an hour per 15°', () => {
  const noonUTC = Date.UTC(2026, 5, 21, 12);
  assert.equal(solarHour(noonUTC, 0), 12);
  assert.equal(solarHour(noonUTC, 90), 18);
  assert.equal(solarHour(noonUTC, -150), 2);
  assert.equal(solarHour(noonUTC + 13 * 3.6e6, 0), 1); // wraps past midnight
});
