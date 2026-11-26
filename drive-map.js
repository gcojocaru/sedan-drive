import * as THREE from 'three';
import { laneSpawn } from './road-layout.js';
import { createMinimap } from './minimap.js';
import { drivingAudio } from './driving-audio.js';
import { crossedEdge, nextArea, cooldownSeconds, startCooldown, visitArea, cooldownButton, edgePrompt } from './area-travel.js';
import { buildCar } from './sedan-model.js';
import { readKeys, rigCar, step, syncCar, chaseCamera, speedHud } from './drive-core.js';
import { loadVaz } from './vaz-model.js';
import { HALF, snap } from './osm-query.js';
import { FALLBACK_CREDIT } from './vector-fallback.js';
import { loadArea } from './map-data.js';
import { seeded } from './geom.js';
import { buildWorld, TYPE_LABEL, HARD } from './world.js';
import { makeTex } from './world-kit.js';
import { radio, radioHud, stationsNear } from './radio.js';
import { touchControls } from './touch.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = id => document.getElementById(id);
const LS_PLACE = 'sedan-map-last-place-v1';
const LS_CAR = 'sedan-map-car-v1'; // 'sedan' or 'vaz'

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

function createSkyReflections(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  // Keep fine detail in the visible sky. A smaller panorama is enough for lighting and car reflections.
  const reflectionCanvas = document.createElement('canvas');
  reflectionCanvas.width = 512;
  reflectionCanvas.height = 256;
  const reflectionContext = reflectionCanvas.getContext('2d');
  const reflectionSky = new THREE.CanvasTexture(reflectionCanvas);
  reflectionSky.colorSpace = THREE.SRGBColorSpace;
  reflectionSky.wrapS = THREE.RepeatWrapping;
  reflectionSky.generateMipmaps = false;
  reflectionSky.minFilter = THREE.LinearFilter;
  let target = null;
  return sky => {
    reflectionContext.drawImage(sky.image, 0, 0, reflectionCanvas.width, reflectionCanvas.height);
    reflectionSky.needsUpdate = true;
    target = pm.fromEquirectangular(reflectionSky, target);
    return target.texture;
  };
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
  await say('Checking for a saved map…');
  const { data, err, fallback } = await loadArea(lat0, lon0, say);
  if (!data) {
    showLoadError('The map servers could not load this area' + (err ? ' (' + err.message + ')' : '') + '.', visit);
    return;
  }

  // ---- renderer / scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

  // ---- sun, sky and time of day ----
  // The sun sits where it really is over this place on today's date at the chosen local solar time, and the sky is
  // redrawn around it, so the sun you see is the one casting the shadows. A cool moon takes over at night.
  const ss = THREE.MathUtils.smoothstep, now = new Date();
  const DOY = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5);
  const DEC = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + DOY) / 365), PHI = lat0 * Math.PI / 180;
  const sunAt = h => { const H = (h - 12) * Math.PI / 12, c = Math.cos(DEC); return V(-c * Math.sin(H), Math.sin(DEC) * Math.sin(PHI) + c * Math.cos(H) * Math.cos(PHI), c * Math.cos(H) * Math.sin(PHI) - Math.sin(DEC) * Math.cos(PHI)).normalize(); };
  const cH0 = -Math.tan(PHI) * Math.tan(DEC), SET = cH0 <= -1 ? 21 : cH0 >= 1 ? 12.5 : 12 + Math.acos(cH0) * 12 / Math.PI; // sunset (solar hours)
  const TIMES = [['Morning', 25.6 - SET], ['Midday', 12.6], ['Afternoon', 12 + (SET - 12) * 0.62], ['Golden hour', SET - 0.8], ['Dusk', SET + 0.45], ['Night', 23.6]];
  const NIGHT = 5, MOON = V(-0.45, 0.62, 0.64).normalize(), UPV = V(0, 1, 0);
  // sky colours by sun elevation (degrees): zenith, horizon, glow around the sun, ground haze
  const SKYK = [[-14, '#03050a', '#0e1420', '#0e1420', '#050605'], [-5, '#141f3d', '#363c5c', '#a0604c', '#16181a'], [-1, '#2a3f73', '#7c6f80', '#f08a54', '#2c2d2a'],
    [4, '#3d63a3', '#e6b590', '#ffae68', '#4d4f3f'], [12, '#3567ad', '#cfdbe4', '#ffdcae', '#6a6f52'], [35, '#2c5fa6', '#dfe9ef', '#fff4e0', '#737a58']];
  const skyCols = e => { let i = 0; while (i < SKYK.length - 2 && e > SKYK[i + 1][0]) i++; const a = SKYK[i], b = SKYK[i + 1], f = THREE.MathUtils.clamp((e - a[0]) / (b[0] - a[0]), 0, 1); return [1, 2, 3, 4].map(k => new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), f)); };
  const rgba = (c, a) => { const h = c.getHex(); return 'rgba(' + (h >> 16 & 255) + ',' + (h >> 8 & 255) + ',' + (h & 255) + ',' + a + ')'; };
  const SW = 2048, SH = 1024, dirPx = d => [(Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5) * SW, (0.5 - Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI) * SH]; // equirect pixel for a direction
  function drawSky(sd, e, dark) {
    const [zen, hor, glow, gnd] = skyCols(e), warm = 1 - ss(e, 2, 30);
    const t = makeTex(SW, SH, (x) => {
      let g = x.createLinearGradient(0, 0, 0, SH / 2); g.addColorStop(0, rgba(zen, 1)); g.addColorStop(0.62, rgba(zen.clone().lerp(hor, 0.45), 1)); g.addColorStop(1, rgba(hor, 1));
      x.fillStyle = g; x.fillRect(0, 0, SW, SH / 2);
      g = x.createLinearGradient(0, SH / 2, 0, SH); g.addColorStop(0, rgba(hor, 1)); g.addColorStop(0.05, rgba(hor.clone().lerp(gnd, 0.6), 1)); g.addColorStop(1, rgba(gnd, 1));
      x.fillStyle = g; x.fillRect(0, SH / 2, SW, SH / 2);
      const rs = seeded(11), sa = dark ? 1 : 1 - ss(e, -10, -3); // stars
      if (sa > 0.02) for (let i = 0; i < 1600; i++) { x.fillStyle = 'rgba(255,255,255,' + (rs() * 0.85 * sa).toFixed(3) + ')'; const z = rs() < 0.08 ? 2 : 1; x.fillRect(rs() * SW, rs() * SH * 0.46, z, z); }
      const [sx, sy] = dirPx(sd), ga = dark ? 0 : (1 - ss(e, 2, 25)) * ss(e, -7, -2);
      for (const ox of [-SW, 0, SW]) if (ga > 0.01) { // warm band on the horizon around the sun (drawn on both sides of the seam)
        x.save(); x.translate(sx + ox, SH / 2); x.scale(1, 0.28); const r = x.createRadialGradient(0, 0, 0, 0, 0, SW * 0.28);
        r.addColorStop(0, rgba(glow, 0.9 * ga)); r.addColorStop(1, rgba(glow, 0)); x.fillStyle = r; x.fillRect(-SW * 0.28, -SW * 0.28, SW * 0.56, SW * 0.56); x.restore();
      }
      const rc = seeded(7), cc = dark ? new THREE.Color('#2a3140') : new THREE.Color('#ffffff').lerp(glow, warm * 0.55).multiplyScalar(0.35 + 0.65 * ss(e, -6, 6));
      for (let i = 0; i < 46; i++) { // clouds
        const cx = rc() * SW, cy = SH * (0.29 + rc() * 0.16), n = 3 + Math.floor(rc() * 5); x.fillStyle = rgba(cc, ((0.18 + rc() * 0.2) * (dark ? 0.5 : 1)).toFixed(3));
        for (let k = 0; k < n; k++) { x.beginPath(); x.ellipse(cx + k * 26, cy + rc() * 12, 40 + rc() * 20, 12 + rc() * 5, 0, 0, Math.PI * 2); x.fill(); }
      }
      const disc = (d, core, halo, hr, cr) => { // sun or moon, stretched like everything else near the top of an equirect image
        const [px, py] = dirPx(d), st = 1 / Math.max(0.25, Math.sqrt(1 - d.y * d.y));
        for (const ox of [-SW, 0, SW]) {
          x.save(); x.translate(px + ox, py); x.scale(st, 1);
          let r = x.createRadialGradient(0, 0, 0, 0, 0, hr); r.addColorStop(0, halo); r.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = r; x.fillRect(-hr, -hr, hr * 2, hr * 2);
          r = x.createRadialGradient(0, 0, 0, 0, 0, cr); r.addColorStop(0, core); r.addColorStop(0.7, core); r.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = r; x.fillRect(-cr, -cr, cr * 2, cr * 2);
          x.restore();
        }
      };
      if (dark) disc(MOON, 'rgba(236,240,255,1)', 'rgba(150,170,220,.25)', 70, 10);
      else if (e > -3) disc(sd, 'rgba(255,253,244,1)', rgba(glow, 0.6), 120, 14);
    });
    t.mapping = THREE.EquirectangularReflectionMapping; t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }
  const reflectSky = createSkyReflections(renderer);
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5d6046, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
  // one shadow map over a box that reaches further ahead of the car than behind it (see placeShadow)
  const SH_R = 90, SH_MAP = renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
  sun.shadow.mapSize.set(SH_MAP, SH_MAP); Object.assign(sun.shadow.camera, { left: -SH_R, right: SH_R, top: SH_R, bottom: -SH_R, near: 1, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; scene.add(sun, sun.target);
  const lightDir = V(0, 1, 0); // towards the sun (or moon)
  scene.fog = new THREE.Fog(0xdfe9ef, 160, 950);

  const { roads, paths, rivers, polys, seas, blds, trees, nB, layout, roadAt, areaAt, inBuilding, frontMat, wallMat, setLamps, glowTex } = await buildWorld(data.elements, lat0, lon0, scene, say);

  // ---- car ----
  await say('Placing the car…');
  const CAR = localStorage.getItem(LS_CAR) === 'vaz' ? await loadVaz().catch(e => (console.warn('VAZ-2101 did not load, using the sedan', e), buildCar())) : buildCar(), car = CAR.car;
  const rig = rigCar(CAR);
  {
    const blob = (inner, a) => makeTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 64 * inner, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); });
    const mk = (tex, w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.07, z); m.renderOrder = 2; car.add(m); };
    mk(blob(0.35, 0.6), 5.0, 2.1, -0.05, 0); const tb = blob(0.1, 0.8); for (const x of [1.32, -1.31]) for (const z of [0.735, -0.735]) mk(tb, 0.55, 0.34, x, z);
  }
  scene.add(car);
  // glows on the head and tail lights while they are on
  const glowMat = c => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const headGlow = glowMat(0xfff1dc), tailGlow = glowMat(0xff2a1a), tails = [];
  for (const l of CAR.lights.low) { const s = new THREE.Sprite(headGlow); s.position.copy(l.position).add(V(0.12, 0, 0)); s.scale.setScalar(1.1); car.add(s); }
  car.updateMatrixWorld(true); car.traverse(o => { if (o.isMesh && o.name === 'tail_brake') tails.push(new THREE.Box3().setFromObject(o).getCenter(V())); });
  for (const c of tails) { const s = new THREE.Sprite(tailGlow); s.position.copy(car.worldToLocal(c)).add(V(-0.1, 0, 0)); s.scale.setScalar(0.6); car.add(s); }

  const st = { pos: V(), h: 0, v: 0, steer: 0, spin: 0, roll: 0, pitch: 0 };
  const cam = chaseCamera(camera, car);
  function place(x, z, h) {
    st.pos.set(x, 0, z); st.h = h; st.v = 0; st.steer = 0;
    cam.reset(st);
  }
  const corners = [[2.2, 0.86], [2.2, -0.86], [0, 0.88], [0, -0.88], [-2.18, 0.86], [-2.18, -0.86]];
  const start = laneSpawn(layout.spawnSegments, entry?.x ?? 0, entry?.z ?? 0, entry?.h, HALF);
  if (entry && !blocked(entry.x, entry.z, entry.h)) place(entry.x, entry.z, entry.h);
  else if (start) place(start.x, start.z, start.h);
  else place(0, 0, entry?.h ?? 0);

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
  const msgEl = $('msg'); let msgTimer;
  function flash(t) { msgEl.textContent = t; msgEl.style.opacity = 1; clearTimeout(msgTimer); msgTimer = setTimeout(() => msgEl.style.opacity = 0, 2200); }

  // ---- time of day ----
  let tIdx = 0, dayIdx = 0, lowLight = false, skyT = null;
  const clock = h => { const m = Math.round((((h % 24) + 24) % 24) * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  function applyTime(i, announce) {
    tIdx = i; if (i !== NIGHT) dayIdx = i;
    const [name, h] = TIMES[i], sd = sunAt(h); let e = Math.asin(sd.y) * 180 / Math.PI;
    night = i === NIGHT || e < -7; if (night) e = Math.min(e, -14);
    lowLight = night || e < -0.5;
    const [zen, hor, glow, gnd] = skyCols(e), warm = 1 - ss(e, 2, 30);
    // direct light: the sun by day, soft light from the whole sky at dusk, the moon at night
    if (night) { lightDir.copy(MOON); sun.color.set(0x9fb3ff); sun.intensity = 0.14; }
    else if (e < -1) { lightDir.set(0.25, 1, 0.3).normalize(); sun.color.copy(zen).lerp(new THREE.Color(0xffffff), 0.6); sun.intensity = 0.3; }
    else { lightDir.copy(sd); if (lightDir.y < 0.06) { lightDir.y = 0.06; lightDir.normalize(); } sun.color.set(0xfff3e4).lerp(glow, warm * 0.85); sun.intensity = 1 + 2.6 * ss(e, -1, 12); }
    if (night) {
      // Cool indirect light keeps the kerb and car silhouette legible between street lamps.
      hemi.color.set(0xa4b9d1);
      hemi.groundColor.set(0x5c6270);
      hemi.intensity = 0.24;
    } else {
      hemi.color.copy(hor).lerp(zen, 0.25);
      hemi.groundColor.copy(gnd);
      hemi.intensity = 0.22 + 0.33 * ss(e, -6, 15);
    }
    if (skyT) skyT.dispose();
    skyT = drawSky(sd, e, night);
    scene.background = skyT; scene.environment = reflectSky(skyT); scene.environmentIntensity = night ? 0.3 : 0.35 + 0.45 * ss(e, -6, 12);
    scene.fog.color.copy(hor); scene.fog.near = night ? 80 : 110 + 50 * ss(e, -3, 10); scene.fog.far = night ? 650 : 760 + 190 * ss(e, -3, 10);
    renderer.toneMappingExposure = night ? 1.1 : e < 0 ? 1.25 : 1 + 0.08 * warm;
    if (frontMat) frontMat.emissiveIntensity = night ? 0.60 : e < 0 ? 0.25 : 0;
    wallMat.emissiveIntensity = night ? 1.6 : e < 0 ? 0.9 : 0;
    setLamps(lowLight);
    if (lowLight) head = true;
    setLights();
    $('tod').textContent = name + ' · ' + clock(h);
    if (announce) flash(name + ' · ' + clock(h));
  }
  { // start in daylight: whichever of morning / midday / afternoon has the sun nearest 32° up (low winter sun, high summer sun)
    const el = i => Math.asin(sunAt(TIMES[i][1]).y) * 180 / Math.PI;
    dayIdx = entry?.day ?? dayIdx;
    applyTime(entry?.time ?? [2, 1, 0].reduce((b, i) => Math.abs(el(i) - 32) < Math.abs(el(b) - 32) ? i : b));
    if (entry) { head = entry.headlights; setLights(); }
  }
  function blocked(x, z, h) {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [lx, lz] of corners) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      const edge = crossedEdge(wx, wz);
      if (edge) return edge;
      if (inBuilding(wx, wz, 0.6)) return 'bld';
    }
    return null;
  }

  const TUNE = { power: 7.4, idle: 0.5, vtop: 50 };
  function update(dt) {
    const k = readKeys(keys), ra = roadAt(st.pos.x, st.pos.z), onRoad = ra.drv && ra.de < 0.6, onHard = onRoad || (ra.any && ra.ae < 2.4) || (ra.drv && ra.de < 2.4) || !!areaAt(st.pos.x, st.pos.z, HARD);
    const s = step(st, k, dt, { vmax: onRoad ? 42 : onHard ? 20 : 12, drag: onHard ? 0.02 : 0.7, rough: !onHard }, TUNE, (nx, nz, nh) => {
      const hit = blocked(nx, nz, nh);
      boundary.move(st.pos.x, st.pos.z);
      if (hit && hit !== 'bld') { st.v = 0; boundary.offer(hit); }
      else if (hit) { const imp = Math.abs(st.v); st.v = -st.v * 0.25; shake = Math.min(1, imp / 20); }
      return !!hit;
    });
    sound.update(st.v, !dialog.open && k.up, !dialog.open && k.dn);
    return s;
  }
  function glows(s) {
    headGlow.opacity = head ? (lowLight ? 0.85 : 0.25) : 0; tailGlow.opacity = s.braking ? (lowLight ? 0.9 : 0.4) : head && lowLight ? 0.35 : 0;
  }
  const shC = V(), lx = V(), ly = V();
  function placeShadow() { // centre the shadow box ahead of the car, snapped to whole shadow-map texels so edges don't crawl
    shC.set(st.pos.x + Math.cos(st.h) * 45, 0, st.pos.z - Math.sin(st.h) * 45);
    lx.crossVectors(UPV, lightDir); if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0); lx.normalize(); ly.crossVectors(lightDir, lx);
    const tx = 2 * SH_R / SH_MAP, a = Math.round(shC.dot(lx) / tx) * tx, b = Math.round(shC.dot(ly) / tx) * tx, c = shC.dot(lightDir);
    shC.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lightDir, c);
    sun.target.position.copy(shC); sun.position.copy(shC).addScaledVector(lightDir, 400);
  }
  function updateCam(dt) {
    cam.update(st, camMode, dt, inBuilding);
    if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.2; shake *= Math.exp(-dt * 7); }
    placeShadow();
  }

  // ---- HUD ----
  const drawMinimap = createMinimap($('minimap').querySelector('canvas'), document.createElement('canvas'), HALF,
    { polys, seas, rivers, buildings: blds, paths, roads });
  const kmh = $('kmh'), gear = $('gear'), streetEl = $('street');
  let streetT = 0, shownStreet = null;
  function hud(s, dt) {
    drawMinimap(st.pos.x, st.pos.z, st.h);
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

  const dialog = $('edgeDialog');
  const sound = drivingAudio();
  const clearKeys = () => { for (const k in keys) keys[k] = false; };
  const pose = () => ({ x: st.pos.x, z: st.pos.z, h: st.h, camera: camMode, day: dayIdx, time: tIdx, headlights: head });
  const boundary = edgePrompt({
    dialog, title: $('edgeTitle'), detail: $('edgeDetail'), proceed: $('edgeContinue'), stay: $('edgeStay'),
    destination(direction) {
      clearKeys();
      const next = nextArea(lat0, lon0, direction, pose());
      return next && { ...next, direction, from: { lat: lat0, lon: lon0, name: placeName, entry: pose() } };
    },
    depart: visitArea
  });
  if (visit?.from) history.replaceState({ ...history.state, visit: { lat: lat0, lon: lon0, entry } }, '');
  load.style.display = 'none';
  $('hud').style.display = 'block';
  const startEl = $('start'); startEl.style.display = started ? 'none' : 'flex';
  const touch = () => touchControls([['Lights', 'KeyH'], ['Time', 'KeyT'], ['Camera', 'KeyC'], ['Radio', 'KeyQ'], ['Sound', 'KeyV'], ['Reset', 'KeyR']]);
  if (started) { $('keys').style.opacity = 0; touch(); } // arrived from the next area: no start screen
  function begin() {
    sound.activate(); if (started) return; started = true; startEl.style.display = 'none'; setTimeout(() => $('keys').style.opacity = 0, 7000);
    touch();
  }
  startEl.addEventListener('click', begin);
  $('changePlace').addEventListener('click', backToMap);
  const tune = radio(radioHud(), () => stationsNear(lat0, lon0, fetch), sound.tuningStatic);
  addEventListener('keydown', e => {
    if (dialog.open) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') { backToMap(); return; }
    if (!e.repeat) begin();
    keys[e.code] = true; if (e.repeat) return;
    if (e.code === 'KeyH') { head = !head; setLights(); }
    if (e.code === 'KeyN') applyTime(tIdx === NIGHT ? dayIdx : NIGHT, true);
    if (e.code === 'KeyT') applyTime((tIdx + 1) % TIMES.length, true);
    if (e.code === 'KeyC') camMode = 1 - camMode;
    if (e.code === 'KeyV') flash(sound.toggleMute() ? 'Driving sounds off' : 'Driving sounds on');
    if (e.code === 'KeyQ') tune(e.shiftKey ? -1 : 1);
    if (e.code === 'KeyR') { const s = laneSpawn(layout.spawnSegments, st.pos.x, st.pos.z, st.h, HALF); if (s) place(s.x, s.z, s.h); }
  });
  addEventListener('keyup', e => keys[e.code] = false);
  addEventListener('blur', clearKeys);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  let last = performance.now(), lastS = { braking: false, reversing: false };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (started && !dialog.open) lastS = update(dt);
    syncCar(rig, st, lastS, head); glows(lastS); updateCam(dt); hud(lastS, dt);
    renderer.render(scene, camera);
  });
}
