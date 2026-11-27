import * as THREE from 'three';
import { laneSpawn } from './road-layout.js';
import { deliveryHud } from './delivery-hud.js';
import { JOB_LEVELS, levelOf, levelText } from './delivery.js';
import { createMinimap } from './minimap.js';
import { drivingAudio } from './driving-audio.js';
import { crossedEdge, nextArea, cooldownSeconds, startCooldown, visitArea, cooldownButton, edgePrompt } from './area-travel.js';
import { buildCar } from './sedan-model.js';
import { readKeys, rigCar, repaint, step, syncCar, chaseCamera, speedHud } from './drive-core.js';
import { readGarage, readWallet, earn, buy, carTuning } from './garage.js';
import { garagePanel } from './garage-panel.js';
import { loadVaz } from './vaz-model.js';
import { HALF, snap } from './osm-query.js';
import { FALLBACK_CREDIT } from './vector-fallback.js';
import { loadArea } from './map-data.js';
import { buildWorld, TYPE_LABEL, HARD } from './world.js';
import { blobTex } from './world-kit.js';
import { pointGrid } from './geom.js';
import { radio, radioHud, stationsNear } from './radio.js';
import { touchControls } from './touch.js';
import { toasts } from './toast.js';
import { resultCard } from './result-card.js';
import { gamepad } from './gamepad.js';
import { createSky } from './sky.js';
import { WEATHERS, weatherNow, solarHour, groundOf } from './weather.js';
import { laneGraph, createTraffic, ranRed, LEVELS } from './traffic.js';
import { trafficCars } from './traffic-cars.js';
import { trafficLights } from './traffic-lights.js';
import { walkGraph, createPedestrians, PEOPLE } from './pedestrians.js';
import { pedestrianFigures } from './pedestrian-figures.js';
import { showAppVersion } from './app-version.js';
import { perfHud } from './perf-hud.js';
import { mergeStatic } from './car-merge.js';
import { postFx } from './post-fx.js';
import { carProbe } from './car-probe.js';
import { carFx } from './car-fx.js';
import { QUALITY, pickQuality, pixelRatio, dynamicRes } from './quality.js';

showAppVersion();

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = id => document.getElementById(id);
const LS_PLACE = 'sedan-map-last-place-v1';
const LS_CAR = 'sedan-map-car-v1'; // 'sedan' or 'vaz'
const LS_TRAFFIC = 'sedan-map-traffic-v1'; // index into LEVELS
const LS_PEOPLE = 'sedan-map-people-v1'; // index into PEOPLE (pedestrians.js)
const LS_PERF = 'sedan-perf-v1'; // performance stats shown (true / false); both drive pages
const LS_QUALITY = 'sedan-quality-v1'; // graphics: 'auto' or an index into QUALITY (quality.js); both drive pages
const LS_WALLET = 'sedan-map-wallet-v1'; // { cash, earned, jobs }: delivery money to spend, all earned, deliveries made
const LS_GARAGE = 'sedan-map-garage-v1'; // what the garage fitted: { levels, paints, paint } (garage.js)
const LS_EARNED = 'sedan-map-earnings-v1'; // before the garage: { total, jobs }, only read to start the wallet

function backToMap() { history.replaceState(null, '', location.pathname + location.search); location.reload(); }
$('retry').onclick = () => location.reload();
$('pickAgain').onclick = backToMap;

const hm = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\|(.*))?$/);
if (hm) startGame(snap(+hm[1]), snap(+hm[2]), hm[3] ? decodeURIComponent(hm[3]) : '');
else showPicker();

// ---------------- Map picker ----------------
// Nominatim's usage policy: at most one request a second for the whole site, cache the results, no search-as-you-type.
// So searches run on submit and are remembered, and a clicked spot is named once, when you press Drive.
const GEO_KEY = 'sedan-geocode-cache-v1'; let nomLast = 0;
async function nominatim(path) {
  let cache = {}; try { cache = JSON.parse(localStorage.getItem(GEO_KEY) || '{}'); } catch { }
  if (cache[path]) return cache[path].v;
  const wait = nomLast + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  nomLast = Date.now();
  const r = await fetch('https://nominatim.openstreetmap.org/' + path, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error('place search replied ' + r.status);
  const v = await r.json();
  cache[path] = { v, t: Date.now() }; const ks = Object.keys(cache); if (ks.length > 60) ks.sort((a, b) => cache[a].t - cache[b].t).slice(0, ks.length - 60).forEach(k => delete cache[k]);
  try { localStorage.setItem(GEO_KEY, JSON.stringify(cache)); } catch { }
  return v;
}
async function reverseName(lat, lon) {
  try {
    const a = (await nominatim('reverse?format=json&zoom=17&lat=' + lat.toFixed(4) + '&lon=' + lon.toFixed(4))).address || {};
    return [a.road || a.pedestrian || a.neighbourhood || a.suburb, a.city || a.town || a.village || a.county, a.country].filter(Boolean).join(', ');
  } catch { return ''; }
}
function showPicker() {
  $('picker').style.display = 'block';
  const last = JSON.parse(localStorage.getItem(LS_PLACE) || 'null');
  const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView(last ? [last.lat, last.lon] : [30, 0], last ? 15 : 2);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
  L.control.layers({ Street: street, Satellite: sat }, null, { position: 'topright' }).addTo(map);
  let marker = null, rect = null, chosen = null;
  const go = $('go'), info = $('placeInfo');
  const carSel = $('car'); carSel.value = localStorage.getItem(LS_CAR) || 'sedan'; carSel.onchange = () => localStorage.setItem(LS_CAR, carSel.value);
  function choose(lat, lon, name) {
    lon = snap(((lon + 540) % 360) - 180); lat = snap(lat); // the grid the map downloads are cached on
    chosen = { lat, lon, name: name || '' };
    const dLat = HALF / 110574, dLon = HALF / (111320 * Math.cos(lat * Math.PI / 180));
    const bounds = [[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]];
    if (!marker) {
      rect = L.rectangle(bounds, { color: '#c8102e', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
      marker = L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#c8102e', fillOpacity: 1, interactive: false }).addTo(map);
    }
    marker.setLatLng([lat, lon]); rect.setBounds(bounds);
    go.disabled = false;
    info.textContent = name || lat.toFixed(4) + ', ' + lon.toFixed(4);
  }
  map.on('click', e => { choose(e.latlng.lat, e.latlng.lng); if (map.getZoom() < 14) map.setView(e.latlng, 15); });
  if (last) choose(last.lat, last.lon, last.name);
  $('searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('q').value.trim(); if (!q) return;
    const msg = $('searchMsg'); msg.textContent = 'Searching…';
    try {
      const j = await nominatim('search?format=json&limit=1&q=' + encodeURIComponent(q.toLowerCase()));
      if (!j.length) { msg.textContent = 'No match. Try another search or click the map.'; return; }
      msg.textContent = '';
      const lat = +j[0].lat, lon = +j[0].lon;
      map.setView([lat, lon], 15);
      choose(lat, lon, j[0].display_name.split(',').slice(0, 3).join(',').trim());
    } catch { msg.textContent = 'Search failed. Click the map instead.'; }
  });
  go.addEventListener('click', async () => {
    if (!chosen || go.disabled) return;
    go.disabled = true;
    if (!chosen.name) { go.textContent = 'Finding the address…'; chosen.name = await reverseName(chosen.lat, chosen.lon); }
    localStorage.setItem(LS_PLACE, JSON.stringify(chosen));
    location.hash = chosen.lat.toFixed(4) + ',' + chosen.lon.toFixed(4) + '|' + encodeURIComponent(chosen.name);
    location.reload();
  });
}

// ---------------- Game ----------------
function showLoadError(message, visit) {
  $('loadTitle').textContent = 'Area unavailable';
  $('loadMsg').textContent = message;
  $('spin').style.display = 'none';
  $('loadBtns').style.display = 'flex';
  if (visit?.from) {
    cooldownButton($('retry'), 'Try again');
    $('pickAgain').textContent = 'Return to your drive';
    $('pickAgain').onclick = () => visitArea(visit.from);
  }
}

async function startGame(lat0, lon0, placeName) {
  const saved = history.state?.visit;
  const visit = saved?.lat === lat0 && saved?.lon === lon0 ? saved : null;
  const entry = visit?.entry;
  const load = $('loading'), say = t => { $('loadMsg').textContent = t; return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };
  load.style.display = 'flex';
  if (visit?.direction) $('loadTitle').textContent = 'Continuing ' + visit.direction;
  $('loadPlace').textContent = placeName || lat0.toFixed(4) + ', ' + lon0.toFixed(4);
  if (visit?.from) {
    if (cooldownSeconds()) {
      showLoadError('Please wait before loading this area again.', visit);
      return;
    }
    startCooldown();
  }
  const liveReq = weatherNow(lat0, lon0, fetch).catch(e => (console.warn('No live weather', e), null)); // while the map loads
  await say('Checking for a saved map…');
  const { data, err, fallback } = await loadArea(lat0, lon0, say);
  if (!data) {
    showLoadError('The map servers could not load this area' + (err ? ' (' + err.message + ')' : '') + '.', visit);
    return;
  }

  // ---- renderer / scene ----
  let qPick = 'auto'; try { qPick = JSON.parse(localStorage.getItem(LS_QUALITY)) ?? 'auto'; } catch { }
  const coarse = matchMedia('(pointer: coarse)').matches, Q = QUALITY[pickQuality(qPick, { coarse, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory })];
  const renderer = new THREE.WebGLRenderer({ antialias: Q.msaa && !Q.post, logarithmicDepthBuffer: true }); // (with post-processing the HDR target antialiases)
  let resScale = 1, fx = null; const fit = () => { renderer.setPixelRatio(pixelRatio(Q, devicePixelRatio, innerWidth, innerHeight, resScale)); renderer.setSize(innerWidth, innerHeight); fx?.setSize(); };
  fit(); const resTick = dynamicRes(s => { resScale = s; fit(); }); // slow frames lower the resolution a little, smooth ones win it back
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
  fx = postFx(renderer, scene, camera, Q); const draw = () => fx ? fx.render() : renderer.render(scene, camera); // glow and colour grade (post-fx.js), or straight to the screen on Low

  const sky = createSky(renderer, scene, lat0, Q), { TIMES, NIGHT } = sky;

  const { roads, paths, rivers, polys, seas, blds, trees, addressPoints, nB, layout, signalPts, crossPts, roadAt, areaAt, inBuilding, furnitureHit, frontMat, wallMat, setLamps, setGround, reflectLamps, glowTex, posts, parkedPaint, lampLight } = await buildWorld(data.elements, lat0, lon0, scene, say, Q);

  // ---- car ----
  await say('Placing the car…');
  const CAR = localStorage.getItem(LS_CAR) === 'vaz' ? await loadVaz().catch(e => (console.warn('VAZ-2101 did not load, using the sedan', e), buildCar())) : buildCar(), car = CAR.car;
  const rig = rigCar(CAR);
  const stored = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
  let wallet = readWallet(stored(LS_WALLET), stored(LS_EARNED)), garage = readGarage(stored(LS_GARAGE)), tuning = carTuning(garage); // delivery money, and what it bought
  repaint(CAR, tuning.paint);
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), probe = new THREE.Sphere(V(), 3); // what the camera sees: traffic comes and goes out of sight
  const graph = laneGraph(roads, layout.junctions, HALF, signalPts), lightsView = trafficLights(scene, graph.signals, glowTex);
  const props = pointGrid(posts.concat(graph.signals.map(s => [s.x, s.z, 0.25, 0, 3.6]))), occluded = (x, z, y) => inBuilding(x, z, y) || props.near(x, z, y, 0.4); // what the chase camera pulls in front of
  const seen = (x, z) => frustum.intersectsSphere((probe.center.set(x, 1, z), probe));
  const traffic = createTraffic(graph, { max: Q.cars, seen });
  const trafficView = trafficCars(scene, 100, glowTex), me = { x: 0, z: 0, h: 0, v: 0 }; // me: the player, as traffic sees it
  // shortcut: the VAZ's factory paint is a texture, so it isn't avoided; sample its colour if traffic copies it
  const avoidMine = () => { const c = CAR.paint && !CAR.paint.map ? CAR.paint.color : null; trafficView.avoid(c); parkedPaint(c); }; avoidMine(); // no other car wears the player's paint
  const walks = walkGraph(roads, paths, layout.junctions, { armBack: graph.armBack, roadAt, crossings: crossPts }); // sidewalks, crossings, footways
  const people = createPedestrians(walks, { max: Q.people, half: HALF, seen }), figures = pedestrianFigures(scene, Q.people);
  const ear = { x: 0, z: 0, fx: 1, fz: 0, vx: 0, vz: 0, wet: 0, snow: 0, me }, look = V(0, 0, 0); // the camera, listening to the traffic
  const SOLID = { bld: 'wall', car: 'car', traffic: 'car', post: 'post' }; // what blocked() hits → its crash sound
  let hitCar = null, hitPerson = null; // the traffic car and the pedestrian blocked() last found
  {
    const mk = (tex, w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.07, z); m.renderOrder = 2; car.add(m); };
    mk(blobTex(0.35, 0.6), 5.0, 2.1, -0.05, 0); const tb = blobTex(0.1, 0.8); for (const x of [1.32, -1.31]) for (const z of [0.735, -0.735]) mk(tb, 0.55, 0.34, x, z);
  }
  scene.add(car);
  // glows on the head and tail lights while they are on
  const glowMat = c => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const headGlow = glowMat(0xfff1dc), tailGlow = glowMat(0xff2a1a), tails = [];
  for (const l of CAR.lights.low) { const s = new THREE.Sprite(headGlow); s.position.copy(l.position).add(V(0.12, 0, 0)); s.scale.setScalar(1.1); car.add(s); }
  car.updateMatrixWorld(true); car.traverse(o => { if (o.isMesh && o.name === 'tail_brake') tails.push(new THREE.Box3().setFromObject(o).getCenter(V())); });
  mergeStatic(car); // the car's still parts in a few draw calls (after the lookups above)
  const reflect = carProbe(renderer, scene, car, Q.probe); // the car reflects the street around it
  const carfx = carFx(scene, Q); // tyre smoke, skid marks, spray and sparks
  for (const c of tails) { const s = new THREE.Sprite(tailGlow); s.position.copy(car.worldToLocal(c)).add(V(-0.1, 0, 0)); s.scale.setScalar(0.6); car.add(s); }

  const st = { pos: V(), h: 0, v: 0, steer: 0, spin: 0, roll: 0, pitch: 0, slip: 0 };
  const cam = chaseCamera(camera, car);
  function place(x, z, h) {
    st.pos.set(x, 0, z); st.h = h; st.v = 0; st.steer = 0; st.slip = 0;
    cam.reset(st);
  }
  const corners = [[2.2, 0.86], [2.2, -0.86], [0, 0.88], [0, -0.88], [-2.18, 0.86], [-2.18, -0.86]];
  const start = laneSpawn(layout.spawnSegments, entry?.x ?? 0, entry?.z ?? 0, entry?.h, HALF, furnitureHit);
  if (entry && !blocked(entry.x, entry.z, entry.h)) place(entry.x, entry.z, entry.h);
  else if (start) place(start.x, start.z, start.h);
  else {
    // On a car park with no mapped lanes the origin can be an occupied bay.
    const h = entry?.h ?? 0;
    let x = 0;
    while (x < HALF-6 && blocked(x,0,h)) x += 5;
    place(x,0,h);
  }

  // ---- state / lights ----
  const keys = {}; let started = !!entry, camMode = entry?.camera ?? 0, head = false, night = false, shake = 0;
  const lowBeams = CAR.lights.low.map(light => ({
    light, angle: light.angle, targetZ: light.target.position.z
  }));
  function setLights() {
    CAR.headMat.emissiveIntensity = head ? 6 : 0;
    for (const { light, angle, targetZ } of lowBeams) {
      // Spread the low beams toward both road edges. The high beams cover the lane ahead.
      light.angle = night ? 0.65 : angle;
      light.target.position.z = night ? 2.3 * Math.sign(light.position.z) : targetZ;
      light.intensity = head ? 260 : 0;
      light.visible = head;
    }
    CAR.lights.high.forEach(l => { l.intensity = head && night ? 900 : 0; l.visible = head && night; });
  }
  const flash = toasts(); // flash(text, tone, key)

  // ---- time of day and weather ----
  // 'live' follows the clock and the weather at this place right now; otherwise an index into TIMES / WEATHERS.
  let live = await liveReq, tSel = entry?.time ?? 'live', dayIdx = entry?.day ?? 'live', wSel = entry?.weather ?? 'live', lowLight = false, dim = false, grip = 1;
  const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const offset = () => live ? live.offset : Math.round(lon0 / 15) * 3600; // the place's UTC offset (s), guessed from its longitude without live data
  const hourOf = () => tSel === 'live' ? solarHour(Date.now(), lon0) : TIMES[tSel][1];
  const weatherOf = () => wSel !== 'live' ? WEATHERS[wSel] : live || { kind: 'clear', label: 'Weather unavailable' };
  const timeSel = $('timeSel'), wxSel = $('wxSel'), pick = v => v === 'live' ? v : +v;
  timeSel.append(new Option('Live time', 'live'), ...TIMES.map(([name], i) => new Option(name, i)));
  wxSel.append(new Option('Live weather', 'live'), ...WEATHERS.map((w, i) => new Option(w.label, i)));
  timeSel.onchange = () => { tSel = pick(timeSel.value); applyTime(); };
  wxSel.onchange = () => { wSel = pick(wxSel.value); applyTime(); };
  const trafficSel = $('trafficSel'), storedLevel = Number(localStorage.getItem(LS_TRAFFIC) ?? 2);
  trafficSel.append(...LEVELS.map(([name], i) => new Option(name, i)));
  trafficSel.value = LEVELS[storedLevel] ? storedLevel : 2;
  trafficSel.onchange = () => { localStorage.setItem(LS_TRAFFIC, trafficSel.value); traffic.setLevel(+trafficSel.value, st.pos.x, st.pos.z); };
  traffic.setLevel(+trafficSel.value, st.pos.x, st.pos.z);
  const peopleSel = $('peopleSel'), storedPeople = Number(localStorage.getItem(LS_PEOPLE) ?? 2);
  peopleSel.append(...PEOPLE.map(([name], i) => new Option(name, i)));
  peopleSel.value = PEOPLE[storedPeople] ? storedPeople : 2;
  const gfxSel = $('gfxSel'); gfxSel.append(new Option('Auto (' + QUALITY[pickQuality('auto', { coarse, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory })].name + ')', 'auto'), ...QUALITY.map((q, i) => new Option(q.name, i)));
  gfxSel.value = String(qPick); gfxSel.onchange = () => { localStorage.setItem(LS_QUALITY, JSON.stringify(gfxSel.value === 'auto' ? 'auto' : +gfxSel.value)); visitArea({ lat: lat0, lon: lon0, name: placeName, entry: pose() }); }; // (antialias is fixed when the renderer is made: reload here)
  peopleSel.onchange = () => { localStorage.setItem(LS_PEOPLE, peopleSel.value); people.setLevel(+peopleSel.value, st.pos.x, st.pos.z); };
  people.setLevel(+peopleSel.value, st.pos.x, st.pos.z);
  function showTime(announce) { // local clock time, also for the presets (they are set in solar time)
    const w = weatherOf(), real = wSel === 'live' && live, lying = !real ? '' : live.snowDepth >= 0.01 ? ', ' + Math.round(live.snowDepth * 100) + ' cm on the ground' : groundOf(w).wet > 0.3 && !['rain', 'storm', 'snow'].includes(w.kind) ? ', wet roads' : '';
    const text = (tSel === 'live' ? '' : TIMES[tSel][0] + ' · ') + clock(hourOf() - lon0 / 15 + offset() / 3600) + ' · ' + w.label + (real ? ', ' + Math.round(live.temp) + '°C' : '') + lying;
    $('tod').textContent = text; if (announce) flash(text, '', 'time');
  }
  function applyTime(announce) {
    if (tSel !== NIGHT) dayIdx = tSel;
    const w = weatherOf(), ground = groundOf(w); // wet roads, snow on the ground and roofs, and how well the tyres grip
    let e, murky, post; ({ night, e, lowLight, murky, post } = sky.set(hourOf(), tSel === NIGHT, w, ground.snow)); fx?.look(post);
    camera.far = scene.fog.far + 30; // nothing past the fog shows, so nothing past it is drawn
    setGround(ground.wet, ground.snow); grip = tuning.grip(ground.grip); ear.wet = ground.wet; ear.snow = ground.snow;
    if (frontMat) frontMat.emissiveIntensity = night ? 0.60 : e < 0 ? 0.25 : 0;
    wallMat.emissiveIntensity = night ? 1.6 : e < 0 ? 0.9 : 0;
    setLamps(lowLight);
    if ((lowLight || murky) && !dim) head = true; // headlights come on when it gets dark or murky, and stay off if you switch them off
    dim = lowLight || murky;
    setLights();
    timeSel.value = tSel; wxSel.value = wSel; $('wxCredit').hidden = !(wSel === 'live' && live);
    showTime(announce);
  }
  applyTime();
  if (entry) { head = entry.headlights; setLights(); }
  let minutes = 0;
  setInterval(() => { // live: the sun moves every 5 minutes, the weather is asked again every 15 (Open-Meteo updates every 15)
    minutes++;
    if (wSel === 'live' && minutes % 15 === 0) weatherNow(lat0, lon0, fetch).then(w => { live = w; applyTime(); }, () => { });
    else if (tSel === 'live' && minutes % 5 === 0) applyTime();
    else showTime();
  }, 60000);
  function blocked(x, z, h) {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [lx, lz] of corners) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const edge = crossedEdge(wx, wz);
      if (edge) return edge;
      if (inBuilding(wx, wz, 0.6)) return 'bld';
      if ((hitCar = traffic.hit(wx, wz))) return 'traffic';
    }
    if ((hitPerson = people.hit(x, z, h))) return 'person';
    const object = furnitureHit(x,z,h);
    return object === 'car' ? 'car' : object ? 'post' : null;
  }

  const showWallet = () => { // cash, deliveries and the level they reached (and how many more to the next)
    const i = levelOf(wallet.jobs), up = JOB_LEVELS[i + 1];
    $('wallet').hidden = !wallet.jobs && !wallet.cash;
    $('wallet').textContent = '$' + wallet.cash + ' · ' + wallet.jobs + (wallet.jobs === 1 ? ' delivery' : ' deliveries') + ' · ' + JOB_LEVELS[i].name + (up ? ' (' + (up.from - wallet.jobs) + ' to level ' + (i + 2) + ')' : '');
  };
  showWallet();
  const results = resultCard((kind, i) => sound.chime(kind, i));
  const delivery = deliveryHud(scene, graph, furnitureHit, $('jobButton'), $('jobStage'), $('jobDistance'), flash, receipt => {
    const was = levelOf(wallet.jobs); wallet = earn(wallet, receipt.total); keep(LS_WALLET, wallet); showWallet();
    const now = levelOf(wallet.jobs), up = now > was ? 'Level ' + (now + 1) + ' · ' + JOB_LEVELS[now].name + ': ' + levelText(now) : '';
    results.show(receipt, wallet.jobs, up); if (up) flash(up, 'gold'); // (toasts show below the card)
  }, () => levelOf(wallet.jobs));
  function toggleDelivery() {
    if (started && !paused()) delivery.toggle(st.pos.x,st.pos.z);
  }
  $('jobButton').onclick = () => { toggleDelivery(); $('jobButton').blur(); };
  const TUNE = { power: 7.4 * tuning.power, idle: 0.5, vtop: 50, brake: tuning.brake };
  // ---- garage: delivery money buys upgrades and paint (G) ----
  const garageEl = $('garage'), shop = garagePanel($('garageItems'), item => {
    const bought = buy(garage, wallet, item); if (!bought) return;
    ({ garage, wallet } = bought); tuning = carTuning(garage); keep(LS_GARAGE, garage); keep(LS_WALLET, wallet);
    repaint(CAR, tuning.paint); avoidMine(); applyTime(); // (engine and brakes: TUNE, each frame; tyres: the grip)
    showWallet(); shop.draw(garage, wallet);
  });
  function openGarage() { if (paused()) return; clearKeys(); shop.draw(garage, wallet); garageEl.showModal(); }
  $('garageButton').onclick = () => { openGarage(); $('garageButton').blur(); };
  let scraping = false; // sliding along something solid (car-fx sparks it)
  function update(dt, p) {
    const k = readKeys(keys, p), was = [st.pos.x, st.pos.z], ra = roadAt(st.pos.x, st.pos.z), onRoad = ra.drv && ra.de < 0.6, onHard = onRoad || (ra.any && ra.ae < 2.4) || (ra.drv && ra.de < 2.4) || !!areaAt(st.pos.x, st.pos.z, HARD);
    const cargo = delivery.cargo; // a heavy load takes some of the engine and the brakes
    TUNE.power = 7.4 * tuning.power * (cargo?.power ?? 1); TUNE.brake = tuning.brake * (cargo?.brake ?? 1);
    let contact = null; // what the move ran into first (blocked() also sets hitCar / hitPerson)
    const s = step(st, k, dt, { vmax: onRoad ? 42 : onHard ? 20 : 12, drag: onHard ? 0.02 : 0.7, rough: !onHard, grip }, TUNE, (nx, nz, nh) => {
      const hit = blocked(nx, nz, nh);
      if (hit && !contact) contact = { hit, other: hitCar, person: hitPerson };
      return !hit ? false : SOLID[hit] ? true : 'stop'; // solids can be glanced off; people and the area's edge stop the car
    });
    boundary.move(st.pos.x, st.pos.z);
    if (contact?.hit === 'person') { // they stumble out of the way; the car pulls up
      const { person } = contact, fresh = person.state !== 'stagger';
      people.bump(person, st.pos.x, st.pos.z); st.v *= 0.2; sound.impact(s.impact, 'person');
      if (fresh && s.impact > 2 && !delivery.knocked()) flash('Watch out!', 'bad');
    }
    else if (SOLID[contact?.hit]) {
      const imp = s.impact; if (s.blocked) st.v = -st.v * 0.25; // head-on: bounce back; glancing: the car slides along
      if (s.blocked || !scraping) { // a new hit (sliding along a wall doesn't count again every frame)
        shake = Math.min(1, imp / 20); sound.impact(imp, SOLID[contact.hit]); pad.crash(imp); carfx.spark(st, imp);
        if (contact.hit === 'traffic' && imp > 2) sound.honkAt(contact.other, ear); // and the other driver lets you know
        delivery.crash(imp, tuning.cushion);
      }
    }
    else if (contact) { st.v = 0; boundary.offer(contact.hit); } // the edge of the area
    scraping = !!contact && !s.blocked && SOLID[contact.hit] && Math.abs(st.v) > 1;
    if (ranRed(graph.signals, was[0], was[1], st.pos.x, st.pos.z)) delivery.ranRed();
    if (!paused()) delivery.update(st.pos.x, st.pos.z, st.v, dt, dim);
    const ride = { hb: !paused() && k.hb, steer: st.steer, slip: st.slip, rough: !onHard, wet: ear.wet, snow: ear.snow, grip };
    sound.update(st.v, !paused() && k.up, !paused() && k.dn, ride); pad.feel(st.v, s.braking, ride); carfx.frame(dt, st, rig.wheels, ride, s.braking, scraping);
    return s;
  }
  function glows(s) {
    headGlow.opacity = head ? (lowLight ? 0.85 : 0.25) : 0; tailGlow.opacity = s.braking ? (lowLight ? 0.9 : 0.4) : head && lowLight ? 0.35 : 0;
  }
  function updateCam(dt) {
    if (started) cam.update(st, camMode, dt, occluded); else cam.orbit(st, performance.now() / 1000); // before the start: show the place round the car
    if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.2; shake *= Math.exp(-dt * 7); }
    sky.placeShadow(st.pos.x + Math.cos(st.h) * 45, st.pos.z - Math.sin(st.h) * 45); // the shadow box reaches further ahead of the car
    sky.update(dt, camera.position); reflectLamps(camera.position.x, camera.position.z); lampLight(st.pos.x, st.pos.z, dt); reflect();
  }

  // ---- HUD ----
  const drawMinimap = createMinimap($('minimap').querySelector('canvas'), document.createElement('canvas'), HALF,
    { polys, seas, rivers, buildings: blds, paths, roads, addressPoints });
  const kmh = $('kmh'), gear = $('gear'), streetEl = $('street');
  let streetT = 0, shownStreet = null;
  function hud(s, dt) {
    drawMinimap(st.pos.x, st.pos.z, st.h, delivery.target, traffic.cars);
    speedHud(kmh, gear, st, s);
    if ((streetT -= dt) > 0) return; streetT = 0.25;
    const r = roadAt(st.pos.x, st.pos.z); let label = '';
    const seg = r.drv && r.de < 3 ? r.drv : r.any && r.ae < 1 ? r.any : null;
    if (seg) label = seg.r.name || TYPE_LABEL[seg.r.type] || 'Road';
    if (label !== shownStreet) { shownStreet = label; streetEl.style.opacity = 0; setTimeout(() => { streetEl.textContent = label; streetEl.style.opacity = label ? 1 : 0; }, 180); }
  }
  const shownName = placeName || (start && start.name) || lat0.toFixed(4) + ', ' + lon0.toFixed(4); // no address found: the street you start on
  $('place').textContent = shownName;
  $('stats').textContent = roads.length.toLocaleString() + ' streets · ' + nB.toLocaleString() + ' buildings · ' + trees.length.toLocaleString() + ' trees';
  $('startPlace').textContent = shownName;
  if (!start) $('startNote').textContent = 'No drivable roads were found here. You can still drive on the ground, or press M to pick another place.';
  if (fallback) {
    $('startNote').textContent = ($('startNote').textContent + ' The OpenStreetMap servers are busy, so this is a simplified map from OpenFreeMap: no roof shapes, walls, crossings or single trees. Pick the place again later for full detail.').trim();
    $('stats').textContent += ' · simplified map'; $('attrib').textContent += ' · ' + FALLBACK_CREDIT;
  }

  const dialog = $('edgeDialog'), settings = $('settings'), paused = () => dialog.open || settings.open || garageEl.open;
  const sound = drivingAudio(), pad = gamepad();
  const clearKeys = () => { for (const k in keys) keys[k] = false; };
  const pose = () => ({ x: st.pos.x, z: st.pos.z, h: st.h, camera: camMode, day: dayIdx, time: tSel, weather: wSel, headlights: head });
  const boundary = edgePrompt({
    dialog, title: $('edgeTitle'), detail: $('edgeDetail'), proceed: $('edgeContinue'), stay: $('edgeStay'),
    destination(direction) {
      clearKeys();
      const next = nextArea(lat0, lon0, direction, pose());
      return next && { ...next, direction, from: { lat: lat0, lon: lon0, name: placeName, entry: pose() } };
    },
    departureNote: () => delivery.target ? ' Leaving this area ends your delivery.' : '',
    depart: visitArea
  });
  if (visit?.from) history.replaceState({ ...history.state, visit: { lat: lat0, lon: lon0, entry } }, '');
  // The car's lamps change which shader programs every lit material needs (three.js counts only visible lights), so
  // compile them for each lamp state now: H and N then switch programs instead of stalling a drive to compile them.
  await say('Warming up…');
  { const was = [head, night]; for (const [h, n] of [[false, false], [true, false], [true, true]]) { head = h; night = n; setLights(); renderer.setRenderTarget(fx?.target ?? null); await renderer.compileAsync(scene, camera).catch(() => {}); renderer.setRenderTarget(null); draw(); } /* (a render too: shadow-map programs are only made by drawing) */ [head, night] = was; setLights(); }
  load.style.display = 'none';
  $('hud').style.display = 'block';
  const startEl = $('start'); startEl.style.display = started ? 'none' : 'flex';
  const touch = () => touchControls([['Lights', 'KeyH'], ['Time', 'KeyT'], ['Weather', 'KeyE'], ['Settings', 'Escape'], ['Garage', 'KeyG'], ['Camera', 'KeyC'], ['Horn', 'KeyB'], ['Radio', 'KeyQ'], ['Sound', 'KeyV'], ['Reset', 'KeyR']]);
  if (started) { $('keys').style.opacity = 0; touch(); } // arrived from the next area: no start screen
  function begin() {
    sound.activate(); if (started) return; started = true; startEl.style.display = 'none'; setTimeout(() => $('keys').style.opacity = 0, 7000);
    touch();
  }
  startEl.addEventListener('click', begin);
  $('changePlace').addEventListener('click', backToMap);
  const tune = radio(radioHud(), () => stationsNear(lat0, lon0, fetch), sound.tuningStatic);
  addEventListener('keydown', e => {
    if (e.isTrusted) sound.activate(); // (a pad-only start can't turn the sound on: the first real key does)
    if (paused()) return; // a dialog has the keys (Esc closes the settings again)
    if (e.code === 'Escape') { e.preventDefault(); clearKeys(); settings.showModal(); return; } // preventDefault: the same press would close it again
    if (e.code === 'KeyG' && !e.repeat) { e.preventDefault(); openGarage(); return; }
    if (e.target === $('jobButton') && ['Space','Enter'].includes(e.code)) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') { backToMap(); return; }
    if (!e.repeat) begin();
    if (e.code === 'KeyB') sound.horn(true);
    keys[e.code] = true; if (e.repeat) return;
    if (e.code === 'KeyJ') toggleDelivery();
    if (e.code === 'KeyH') { head = !head; setLights(); }
    const next = (i, n) => i === 'live' ? 0 : i + 1 < n ? i + 1 : 'live'; // live, then each preset in turn
    if (e.code === 'KeyN') { tSel = tSel === NIGHT ? dayIdx : NIGHT; applyTime(true); }
    if (e.code === 'KeyT') { tSel = next(tSel, TIMES.length); applyTime(true); }
    if (e.code === 'KeyE') { wSel = next(wSel, WEATHERS.length); applyTime(true); }
    if (e.code === 'KeyC') camMode = 1 - camMode;
    if (e.code === 'KeyV') flash(sound.toggleMute() ? 'Driving sounds off' : 'Driving sounds on', '', 'sound');
    if (e.code === 'KeyQ') tune(e.shiftKey ? -1 : 1);
    if (e.code === 'KeyR') { const s = laneSpawn(layout.spawnSegments, st.pos.x, st.pos.z, st.h, HALF, furnitureHit); if (s) { traffic.clear(s.x, s.z, 8); people.clear(s.x, s.z, 6); place(s.x, s.z, s.h); } }
  });
  addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyB') sound.horn(false); });
  addEventListener('blur', () => { clearKeys(); sound.horn(false); });
  addEventListener('resize', () => { fit(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  let last = performance.now(), lastS = { braking: false, reversing: false };
  const perf = perfHud(renderer, () => Q.name + ' · pixel ratio ' + renderer.getPixelRatio().toFixed(2), localStorage.getItem(LS_PERF) === 'true');
  const perfChk = $('perfChk'), keepPerf = on => { perfChk.checked = on; localStorage.setItem(LS_PERF, on); };
  perfChk.checked = perf.isOn(); perfChk.onchange = () => { perf.show(perfChk.checked); keepPerf(perfChk.checked); }; perf.onToggle(keepPerf);
  renderer.setAnimationLoop(now => {
    const t0 = performance.now(), lap = perf.lap; perf.begin();
    if (document.hasFocus()) resTick(now - last); /* (an unfocused window may be held at 30 fps: not a slow GPU) */ const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const p = pad.poll(); if (p?.thr && !started && !paused()) begin(); // (its buttons start the game through their keys)
    if (started && !paused()) lastS = update(dt, p);
    lap('drive');
    if (!paused()) {
      frustum.setFromProjectionMatrix(view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      Object.assign(me, { x: st.pos.x, z: st.pos.z, h: st.h, v: st.v });
      people.step(dt, me, traffic.cars, graph.signals); lap('people'); traffic.step(dt, me, people.crossing); lap('traffic'); // (traffic keeps from the people in the road)
    }
    trafficView.sync(traffic.cars, dim); lightsView.sync(dim); figures.sync(people.people); lap('sync');
    camera.getWorldDirection(look); const flat = Math.hypot(look.x, look.z) || 1;
    Object.assign(ear, { x: camera.position.x, z: camera.position.z, fx: look.x / flat, fz: look.z / flat, vx: Math.cos(st.h) * st.v, vz: -Math.sin(st.h) * st.v });
    sound.traffic(traffic.cars, ear); lap('sound');
    syncCar(rig, st, lastS, head); glows(lastS); updateCam(dt); lap('camera'); hud(lastS, dt); lap('hud');
    draw(); lap('render'); perf(t0);
  });
}
