import { test } from 'node:test';
import assert from 'node:assert/strict';
import { radio, stationsNear } from '../radio.js';

// radio-browser.info station entries, only the fields stationsNear reads
const st = (name, url_resolved, clickcount, more = {}) => ({ name, url_resolved, clickcount, hls: 0, countrycode: 'RO', geo_distance: null, ...more });
const fakeFetch = (...replies) => { const asked = []; return [asked, async url => { asked.push(url); return replies.length ? { ok: true, json: async () => replies.shift() } : { ok: false, status: 503 }; }]; };

test('merges nearby and country stations, most listened-to first, only playable and unique ones', async () => {
  const [asked, fetchFn] = fakeFetch(
    [st('Local FM', 'https://a/local', 5, { geo_distance: 900 }), st('Border FM', 'https://a/border', 50, { geo_distance: 40000, countrycode: 'BG' }), st('Old FM', 'http://a/old', 99, { geo_distance: 10 })],
    [st('Kiss FM', 'https://a/kiss', 80), st(' local fm ', 'https://a/other', 1), st('Hls FM', 'https://a/h.m3u8', 70, { hls: 1 }), st('Same Stream', 'https://a/kiss', 2), st('  ', 'https://a/x', 3)],
  );
  assert.deepEqual(await stationsNear(44.4, 26.1, fetchFn), [['Kiss FM', 'https://a/kiss'], ['Border FM', 'https://a/border'], ['Local FM', 'https://a/local']]);
  assert.match(asked[0], /geo_lat=44\.4&geo_long=26\.1&geo_distance=200000/);
  assert.match(asked[1], /countrycode=RO$/); // the nearest station's country, even though its own stream is http
});

test('nothing nearby: no country lookup, empty list', async () => {
  const [asked, fetchFn] = fakeFetch([]);
  assert.deepEqual(await stationsNear(30, -40, fetchFn), []);
  assert.equal(asked.length, 1);
});

test('caps the list at 30 stations', async () => {
  const many = Array.from({ length: 40 }, (_, k) => st('S' + k, 'https://a/' + k, k, { geo_distance: k }));
  const [, fetchFn] = fakeFetch(many, []);
  assert.equal((await stationsNear(0, 0, fetchFn)).length, 30);
});

test('a failed request rejects', async () => {
  const [, fetchFn] = fakeFetch();
  await assert.rejects(stationsNear(0, 0, fetchFn), /HTTP 503/);
});

test('radio: tuning shows the station busy, then plain once it plays (only once), and off at the end', async () => {
  const shown = [], audios = [];
  globalThis.Audio = class { constructor() { audios.push(this); } play() { return Promise.resolve(); } pause() {} removeAttribute() {} load() {} };
  const tune = radio((...a) => shown.push(a), async () => [['A', 'https://a'], ['B', 'https://b']]);
  await tune(1); const a = audios[0];
  assert.equal(a.src, 'https://a');
  a.onplaying(); a.onplaying(); // a stall and resume must not show the name again
  await tune(1); a.onerror(); a.onerror(); a.onerror(); // two retries, then no signal
  await tune(1);
  assert.deepEqual(shown, [['Radio', 'Searching for stations…', true], ['A', 'Tuning…', true], ['A'], ['B', 'Tuning…', true], ['B', 'No signal'], ['Radio off']]);
  delete globalThis.Audio;
});

test('static starts on the tuning gesture, including a slow lookup, and stays silent on retries and off', async t => {
  let audio;
  globalThis.Audio = class {
    constructor() { audio = this; }
    play() { return Promise.resolve(); } pause() {} removeAttribute() {} load() {}
  };
  t.after(() => delete globalThis.Audio);
  let resolve, bursts = 0;
  const tune = radio(() => {}, () => new Promise(r => { resolve = r; }), () => { bursts++; });
  const first = tune(1);
  assert.equal(bursts, 1);
  resolve([['A', 'https://a'], ['B', 'https://b']]); await first;
  audio.onerror(); audio.onplaying();
  assert.equal(bursts, 1);
  await tune(1); assert.equal(bursts, 2);
  await tune(1); assert.equal(bursts, 2); // off
  await tune(-1); assert.equal(bursts, 3);
});
