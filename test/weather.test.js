import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHERS, weatherOf, weatherNow, solarHour, groundOf } from '../weather.js';

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
  assert.match(asked[0][0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=44\.436&longitude=26\.102&current=weather_code,temperature_2m,snow_depth&hourly=precipitation&past_hours=3&forecast_hours=1&timezone=auto$/);
  assert.ok(asked[0][1].signal);
});

test('weatherNow reads the snow depth and adds up the last hours of rain', async () => {
  const [, fetchFn] = reply(200, { current: { weather_code: 3, temperature_2m: 6, snow_depth: 0.12 }, hourly: { time: [], precipitation: [0.4, null, 1.1, 0] } });
  const w = await weatherNow(0, 0, fetchFn);
  assert.equal(w.snowDepth, 0.12); assert.ok(Math.abs(w.recent - 1.5) < 1e-9);
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

test('the ground: rain wets the roads, snow lies white, and both cost grip', () => {
  assert.deepEqual(groundOf({ kind: 'clear' }), { wet: 0, snow: 0, grip: 1 });
  assert.deepEqual(groundOf({ kind: 'fog' }), { wet: 0, snow: 0, grip: 1 });
  const rain = groundOf(WEATHERS.find(w => w.kind === 'rain')), storm = groundOf(WEATHERS.find(w => w.kind === 'storm'));
  assert.ok(rain.wet > 0.8 && rain.snow === 0 && rain.grip < 0.8, JSON.stringify(rain));
  assert.deepEqual(storm, { wet: 1, snow: 0, grip: 0.65 });
  const snow = groundOf(WEATHERS.find(w => w.kind === 'snow'));
  assert.ok(snow.snow > 0.7 && snow.wet > 0.3 && snow.grip < rain.grip, JSON.stringify(snow)); // slushy roads
  assert.ok(groundOf(weatherOf(51)).wet < groundOf(weatherOf(65)).wet, 'drizzle is less wet than heavy rain');
});

test('live ground: snow lies on after it stops, roads stay wet after the rain, not when it froze', () => {
  const clear = { ...weatherOf(0), temp: -4 };
  assert.equal(groundOf({ ...clear, snowDepth: 0.2 }).snow, 1);
  assert.ok(Math.abs(groundOf({ ...clear, snowDepth: 0.01 }).snow - 0.2) < 1e-9, 'a dusting');
  assert.equal(groundOf({ ...weatherOf(71), temp: 2, snowDepth: 0 }).snow, 0, 'snow that melts as it lands');
  assert.equal(groundOf({ ...weatherOf(3), temp: 9, recent: 3 }).wet, 1);
  assert.ok(groundOf({ ...weatherOf(3), temp: 9, recent: 0.3 }).wet < 0.3, 'a few drops dry off');
  assert.equal(groundOf({ ...weatherOf(3), temp: -2, recent: 3 }).wet, 0);
  assert.ok(Math.abs(groundOf({ ...weatherOf(3), temp: -2, recent: 3, snowDepth: 0.05 }).grip - 0.45) < 1e-9, 'grip under full snow');
});
