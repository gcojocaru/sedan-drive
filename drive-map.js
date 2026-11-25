import * as THREE from 'three';
import { buildCar } from './sedan-model.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const $ = id => document.getElementById(id);
const HALF = 500; // metres each side of the start point (1 km square)
const LS_PLACE = 'sedan-map-last-place-v1';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function backToMap() { history.replaceState(null, '', location.pathname + location.search); location.reload(); }
$('retry').onclick = () => location.reload();
$('pickAgain').onclick = backToMap;

const hm = location.hash.match(/^#(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\|(.*))?$/);
if (hm) startGame(+hm[1], +hm[2], hm[3] ? decodeURIComponent(hm[3]) : '');
else showPicker();

// ---------------- Map picker ----------------
async function reverseName(lat, lon) {
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=' + lat + '&lon=' + lon);
    const a = (await r.json()).address || {};
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
  function choose(lat, lon, name) {
    lon = ((lon + 540) % 360) - 180;
    chosen = { lat, lon, name: name || '' };
    const dLat = HALF / 110574, dLon = HALF / (111320 * Math.cos(lat * Math.PI / 180));
    const bounds = [[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]];
    if (!marker) {
      rect = L.rectangle(bounds, { color: '#c8102e', weight: 2, fillOpacity: 0.08, interactive: false }).addTo(map);
      marker = L.circleMarker([lat, lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#c8102e', fillOpacity: 1, interactive: false }).addTo(map);
    }
    marker.setLatLng([lat, lon]); rect.setBounds(bounds);
    go.disabled = false;
    info.textContent = name || lat.toFixed(5) + ', ' + lon.toFixed(5);
    if (!name) reverseName(lat, lon).then(n => { if (n && chosen && chosen.lat === lat && chosen.lon === lon) { chosen.name = n; info.textContent = n; } });
  }
  map.on('click', e => { choose(e.latlng.lat, e.latlng.lng); if (map.getZoom() < 14) map.setView(e.latlng, 15); });
  if (last) choose(last.lat, last.lon, last.name);
  $('searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('q').value.trim(); if (!q) return;
    const msg = $('searchMsg'); msg.textContent = 'Searching…';
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q));
      const j = await r.json();
      if (!j.length) { msg.textContent = 'No match. Try another search or click the map.'; return; }
      msg.textContent = '';
      const lat = +j[0].lat, lon = +j[0].lon;
      map.setView([lat, lon], 15);
      choose(lat, lon, j[0].display_name.split(',').slice(0, 3).join(',').trim());
    } catch { msg.textContent = 'Search failed. Click the map instead.'; }
  });
  go.addEventListener('click', () => {
    if (!chosen) return;
    localStorage.setItem(LS_PLACE, JSON.stringify(chosen));
    location.hash = chosen.lat.toFixed(6) + ',' + chosen.lon.toFixed(6) + '|' + encodeURIComponent(chosen.name);
    location.reload();
  });
}

// ---------------- Cache (IndexedDB) ----------------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('sedan-map-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('osm'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('osm').objectStore('osm').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const db = await idb(); db.transaction('osm', 'readwrite').objectStore('osm').put(v, k); } catch { } }

// ---------------- Geometry helpers ----------------
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
function joinRings(parts) {
  const pool = parts.map(p => p.slice()), rings = [];
  while (pool.length) {
    let r = pool.shift();
    for (let guard = 0; !same(r[0], r[r.length - 1]) && guard < 2000; guard++) {
      let hit = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], e = r[r.length - 1];
        if (same(e, w[0])) r = r.concat(w.slice(1));
        else if (same(e, w[w.length - 1])) r = r.concat(w.slice(0, -1).reverse());
        else if (same(r[0], w[w.length - 1])) r = w.concat(r.slice(1));
        else if (same(r[0], w[0])) r = w.slice().reverse().concat(r.slice(1));
        else continue;
        pool.splice(i, 1); hit = true; break;
      }
      if (!hit) break;
    }
    if (r.length >= 4 && same(r[0], r[r.length - 1])) rings.push(r);
  }
  return rings;
}
function inPoly(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}
function polyArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); }
function bbox(r) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; } return { x0, z0, x1, z1 }; }
const seeded = seed => { let s = Math.abs(Math.floor(seed)) % 2147483646 + 1; return () => (s = s * 16807 % 2147483647) / 2147483647; };

const newBuf = () => ({ p: [] });
function tri(B, a, b, c, y) { if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { const t = b; b = c; c = t; } B.p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); }
function quad(B, a, b, c, d, y) { tri(B, a, b, c, y); tri(B, a, c, d, y); }
function disc(B, c, r, y, seg = 16) {
  for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; tri(B, c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], y); }
}
function ribbon(B, g, hw, y, caps) {
  const n = g.length; if (n < 2) return;
  const Lp = [], Rp = [];
  for (let i = 0; i < n; i++) {
    const p = g[i], a = g[Math.max(0, i - 1)], b = g[Math.min(n - 1, i + 1)];
    let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = b[0] - p[0], d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z), l2 = Math.hypot(d2x, d2z);
    if (l1) { d1x /= l1; d1z /= l1; } if (l2) { d2x /= l2; d2z /= l2; }
    if (!l1) { d1x = d2x; d1z = d2z; } if (!l2) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z; const tl = Math.hypot(tx, tz);
    if (tl < 1e-6) { tx = d2x; tz = d2z; } else { tx /= tl; tz /= tl; }
    const m = 1 / Math.max(0.4, tx * d2x + tz * d2z), nx = -tz * hw * m, nz = tx * hw * m;
    Lp.push([p[0] + nx, p[1] + nz]); Rp.push([p[0] - nx, p[1] - nz]);
  }
  for (let i = 0; i < n - 1; i++) quad(B, Lp[i], Rp[i], Rp[i + 1], Lp[i + 1], y);
  if (caps) { disc(B, g[0], hw, y); disc(B, g[n - 1], hw, y); }
}
function fillPoly(B, outer, holes, y) {
  const o = outer.map(p => new THREE.Vector2(p[0], p[1])), hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  let f; try { f = THREE.ShapeUtils.triangulateShape(o, hs); } catch { return; }
  const all = o.concat(...hs);
  for (const [i, j, k] of f) tri(B, [all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y], y);
}
function flatMesh(B, mat, uvScale) {
  const g = new THREE.BufferGeometry(), n = B.p.length / 3;
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  const nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { nor[i * 3 + 1] = 1; uv[i * 2] = B.p[i * 3] / uvScale; uv[i * 2 + 1] = B.p[i * 3 + 2] / uvScale; }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
function makeTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function speckle(x, w, h, n, amt, size = 2) {
  for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amt; x.fillStyle = v > 0 ? 'rgba(255,255,255,' + v + ')' : 'rgba(0,0,0,' + -v + ')'; x.fillRect(Math.random() * w, Math.random() * h, size, size); }
}

function areaKind(t) {
  if (t.building && t.building !== 'no') return 'building';
  if (t.highway) return t.area === 'yes' ? 'paving' : null;
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) return 'water';
  if (t.natural === 'tree_row' || t.waterway) return null;
  if (t.landuse === 'forest' || t.natural === 'wood') return 'forest';
  if (t.leisure === 'pitch' || t.leisure === 'golf_course') return 'pitch';
  if (t.natural === 'beach' || t.natural === 'sand' || t.leisure === 'playground') return 'sand';
  if (['farmland', 'vineyard', 'allotments', 'orchard'].includes(t.landuse)) return 'farm';
  if (['scrub', 'heath', 'wetland'].includes(t.natural)) return 'scrub';
  if (t.leisure || t.landuse || t.natural) return 'park';
  return null;
}
const ROAD = { motorway: 15, trunk: 13, primary: 11, secondary: 10, tertiary: 9, unclassified: 7, residential: 7, living_street: 6, service: 4.6, road: 7, busway: 7, raceway: 10, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 7, tertiary_link: 7 };
const PATH = { footway: 2.4, cycleway: 2.2, pedestrian: 6, steps: 2, path: 1.8, track: 3.2, bridleway: 2 };
const DIRT = new Set(['path', 'track', 'bridleway']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const SIDEWALK = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'road', 'primary_link', 'secondary_link', 'tertiary_link']);
const TYPE_LABEL = { motorway: 'Motorway', trunk: 'Main road', primary: 'Main road', secondary: 'Main road', tertiary: 'Road', unclassified: 'Road', residential: 'Residential street', living_street: 'Living street', service: 'Service road', footway: 'Footpath', cycleway: 'Cycle path', pedestrian: 'Pedestrian street', steps: 'Steps', path: 'Path', track: 'Track', bridleway: 'Bridleway' };
function bHeight(t, r) {
  const h = parseFloat(t.height); if (h > 0 && h < 700) return h;
  const l = parseFloat(t['building:levels']); if (l > 0 && l < 200) return l * 3.1 + (parseFloat(t['roof:levels']) || 0) * 1.6 + 0.6;
  const d = { house: 7, detached: 7.5, semidetached_house: 8, terrace: 9, residential: 10, apartments: 16, bungalow: 4.5, garage: 3, garages: 3, carport: 2.6, shed: 2.8, hut: 3, cabin: 3.5, commercial: 12, retail: 7, supermarket: 7, industrial: 9, warehouse: 9, office: 18, school: 10, university: 14, hospital: 18, church: 15, cathedral: 30, hotel: 20, train_station: 12, kiosk: 3, service: 3.5, static_caravan: 3, roof: 4 };
  return (d[t.building] || 8) * (0.85 + r() * 0.35);
}
const WALLS = ['#e4ddd0', '#d8cfc0', '#cbbfae', '#b59c82', '#a9725c', '#c4b39b', '#ddd6cb', '#9f948a', '#e8e2d6', '#b8866a', '#d2c6b0'];
const ROOFS = ['#5f5c58', '#6e6a64', '#4f4d4b', '#7a5040', '#8b5a44', '#686d70', '#58524c'];
function tagColor(s) {
  if (!s) return null; s = s.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(s) || /^#?[0-9a-f]{3}$/.test(s)) return new THREE.Color(s[0] === '#' ? s : '#' + s);
  if (s in THREE.Color.NAMES) return new THREE.Color(THREE.Color.NAMES[s]);
  return null;
}

// ---------------- Game ----------------
async function startGame(lat0, lon0, placeName) {
  const load = $('loading'), say = t => { $('loadMsg').textContent = t; return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };
  load.style.display = 'flex';
  await say('Downloading map data from OpenStreetMap…');
  const cosL = Math.cos(lat0 * Math.PI / 180), KX = 111320 * cosL, KZ = 110574;
  const P = (lat, lon) => [(lon - lon0) * KX, -(lat - lat0) * KZ];
  const dLat = (HALF + 60) / KZ, dLon = (HALF + 60) / KX;
  const bb = [lat0 - dLat, lon0 - dLon, lat0 + dLat, lon0 + dLon].map(v => v.toFixed(6)).join(',');
  const parts = ['way["highway"]', 'way["building"]', 'relation["building"]["type"="multipolygon"]',
    'way["natural"~"^(water|wood|scrub|grassland|heath|tree_row|beach|sand|wetland)$"]', 'relation["natural"~"^(water|wood)$"]',
    'way["waterway"~"^(river|stream|canal|riverbank|ditch|drain)$"]', 'relation["waterway"="riverbank"]', 'way["water"]',
    'way["landuse"~"^(grass|meadow|forest|recreation_ground|village_green|cemetery|allotments|orchard|farmland|vineyard)$"]', 'relation["landuse"~"^(forest|grass|meadow)$"]',
    'way["leisure"~"^(park|garden|pitch|playground|golf_course|common|dog_park)$"]', 'relation["leisure"="park"]', 'node["natural"="tree"]'];
  const q = '[out:json][timeout:90];(' + parts.map(s => s + '(' + bb + ');').join('') + ');out geom qt;';
  let data = null, err = null;
  const cacheKey = 'osm:' + lat0.toFixed(5) + ',' + lon0.toFixed(5) + ':' + HALF;
  data = await idbGet(cacheKey);
  if (data) await say('Loading saved map data…');
  for (const u of data ? [] : ENDPOINTS) {
    const host = u.split('/')[2], ac = new AbortController(), t0 = performance.now();
    const tick = setInterval(() => { $('loadMsg').textContent = 'Downloading map data from ' + host + '… ' + Math.round((performance.now() - t0) / 1000) + ' s'; }, 500);
    const kill = setTimeout(() => ac.abort(), 45000);
    try {
      const r = await fetch(u, { method: 'POST', signal: ac.signal, body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error(r.status === 429 ? 'too many requests' : 'server replied ' + r.status);
      data = await r.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('bad reply');
      idbSet(cacheKey, data);
      break;
    } catch (e) { data = null; err = e.name === 'AbortError' ? new Error('servers did not answer in time') : e; await say(host + ' is busy, trying another server…'); }
    finally { clearInterval(tick); clearTimeout(kill); }
  }
  if (!data) { $('loadMsg').textContent = 'The free OpenStreetMap servers are busy (' + (err ? err.message : 'unknown error') + '). Try again in a minute.'; $('spin').style.display = 'none'; $('loadBtns').style.display = 'flex'; return; }

  await say('Building the streets…');
  const lines = [], polys = [], treePts = [];
  for (const el of data.elements) {
    if (el.type === 'node') { treePts.push(P(el.lat, el.lon)); continue; }
    const t = el.tags || {}, kind = areaKind(t);
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 2) continue;
      const g = el.geometry.map(p => P(p.lat, p.lon)), closed = g.length > 3 && same(g[0], g[g.length - 1]);
      if (kind && closed) polys.push({ kind, outer: g, holes: [], t, id: el.id });
      else if (!kind) lines.push({ t, g });
    } else if (el.type === 'relation' && kind) {
      const outs = [], ins = [];
      for (const m of el.members || []) { if (m.type !== 'way' || !m.geometry) continue; const g = m.geometry.filter(Boolean).map(p => P(p.lat, p.lon)); if (g.length > 1) (m.role === 'inner' ? ins : outs).push(g); }
      const I = joinRings(ins);
      for (const o of joinRings(outs)) polys.push({ kind, outer: o, holes: I.filter(h => inPoly(h[0][0], h[0][1], o)), t, id: el.id });
    }
  }

  // ---- renderer / scene ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);

  function skyTex(night) {
    return makeTex(1024, 512, (x) => {
      const g = x.createLinearGradient(0, 0, 0, 512);
      if (!night) { g.addColorStop(0, '#2c5fa6'); g.addColorStop(0.4, '#8fb9de'); g.addColorStop(0.5, '#dfe9ef'); g.addColorStop(0.505, '#8a9070'); g.addColorStop(1, '#3a4030'); }
      else { g.addColorStop(0, '#04060b'); g.addColorStop(0.44, '#0d1422'); g.addColorStop(0.5, '#1a2131'); g.addColorStop(0.505, '#0a0c09'); g.addColorStop(1, '#040504'); }
      x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
      if (!night) {
        const s = x.createRadialGradient(300, 140, 0, 300, 140, 70); s.addColorStop(0, 'rgba(255,255,248,1)'); s.addColorStop(0.12, 'rgba(255,250,232,.95)'); s.addColorStop(1, 'rgba(255,240,210,0)'); x.fillStyle = s; x.fillRect(200, 40, 200, 200);
        x.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 40; i++) { const cx = Math.random() * 1024, cy = 150 + Math.random() * 80; for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse(cx + k * 14, cy + Math.random() * 6, 22, 7, 0, 0, Math.PI * 2); x.fill(); } }
      } else for (let i = 0; i < 700; i++) { x.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.85 + ')'; x.fillRect(Math.random() * 1024, Math.random() * 230, 1, 1); }
    });
  }
  const SKY = { day: skyTex(false), night: skyTex(true) };
  SKY.day.mapping = SKY.night.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  const ENV = { day: pm.fromEquirectangular(SKY.day).texture, night: pm.fromEquirectangular(SKY.night).texture };
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5d6046, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04; scene.add(sun, sun.target);
  const SUN_OFF = V(70, 110, -45);
  scene.fog = new THREE.Fog(0xdfe9ef, 160, 950);

  // ---- textures & materials ----
  const noise = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#dcdcdc'; x.fillRect(0, 0, w, h); speckle(x, w, h, 40000, 0.3); });
  const asphalt = makeTex(512, 512, (x, w, h) => { x.fillStyle = '#4b4c4f'; x.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,' + (0.04 + Math.random() * 0.06) + ')'; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 20 + Math.random() * 50, Math.random() * 3, 0, Math.PI * 2); x.fill(); } speckle(x, w, h, 80000, 0.24); });
  const slabs = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#bdbab2'; x.fillRect(0, 0, w, h); speckle(x, w, h, 16000, 0.14); x.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < w; i += 64) { x.fillRect(i, 0, 2, h); x.fillRect(0, i, w, 2); } });
  const layer = (map, color, y, extra = {}) => new THREE.MeshStandardMaterial({ map, color, roughness: 1, side: THREE.DoubleSide, ...extra });
  const LAYERS = {
    farm: [layer(noise, '#b3a774'), 0.01], sand: [layer(noise, '#d8c99c'), 0.012], park: [layer(noise, '#6f9448'), 0.014],
    scrub: [layer(noise, '#7d8d52'), 0.016], forest: [layer(noise, '#55763a'), 0.018], pitch: [layer(noise, '#5e9a4c'), 0.02],
    water: [new THREE.MeshStandardMaterial({ color: '#33607a', roughness: 0.06, metalness: 0.15, side: THREE.DoubleSide }), 0.024],
    paving: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.03], dirt: [layer(noise, '#b5a586'), 0.034], paved: [layer(slabs, '#f2f0ea', 0, { roughness: 0.95 }), 0.036],
    sidewalk: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.04], road: [layer(asphalt, '#ffffff', 0, { roughness: 0.88 }), 0.05],
    marks: [new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.55, side: THREE.DoubleSide }), 0.058]
  };
  const BUF = Object.fromEntries(Object.keys(LAYERS).map(k => [k, newBuf()]));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: noise, color: '#8a9468', roughness: 1 }));
  ground.material.map = noise.clone(); ground.material.map.repeat.set(1600, 1600); ground.material.map.needsUpdate = true;
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // ---- area fills ----
  for (const p of polys) if (p.kind !== 'building' && LAYERS[p.kind]) fillPoly(BUF[p.kind], p.outer, p.holes, LAYERS[p.kind][1]);

  // ---- roads ----
  const roads = [], paths = [], rivers = [], rows = [];
  for (const { t, g } of lines) {
    if (t.highway) {
      if (t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage') continue;
      let w = ROAD[t.highway], drive = true;
      if (!w) { w = PATH[t.highway]; drive = false; }
      if (!w) continue;
      const tw = parseFloat(t.width), ln = parseInt(t.lanes);
      if (drive && ln > 0) w = Math.max(w * 0.7, ln * 3.3 + 0.8);
      if (tw > 1 && tw < 40) w = tw;
      if (t.highway === 'service' && (t.service === 'driveway' || t.service === 'parking_aisle')) w = 3.6;
      (drive ? roads : paths).push({ g, hw: w / 2, t, type: t.highway, name: t.name || t.ref || '', drive });
    } else if (t.waterway) {
      const ww = { river: 12, canal: 10, stream: 2.5, ditch: 1.2, drain: 1.2 }[t.waterway]; const tw = parseFloat(t.width);
      if (ww) rivers.push({ g, hw: (tw > 0 && tw < 300 ? tw : ww) / 2 });
    } else if (t.natural === 'tree_row') rows.push(g);
  }
  const kk = p => Math.round(p[0] * 20) + ',' + Math.round(p[1] * 20);
  const deg = new Map();
  for (const r of roads) r.g.forEach((p, i) => { const k = kk(p); deg.set(k, (deg.get(k) || 0) + (i === 0 || i === r.g.length - 1 ? 1 : 2)); });
  for (const r of rivers) ribbon(BUF.water, r.g, r.hw, LAYERS.water[1], true);
  for (const r of paths) ribbon(DIRT.has(r.type) ? BUF.dirt : BUF.paved, r.g, r.hw, DIRT.has(r.type) ? LAYERS.dirt[1] : LAYERS.paved[1], true);
  for (const r of roads) {
    const yR = LAYERS.road[1], walk = SIDEWALK.has(r.type) && r.t.sidewalk !== 'no' && r.t.sidewalk !== 'none';
    ribbon(BUF.road, r.g, r.hw, yR, false);
    if (walk) ribbon(BUF.sidewalk, r.g, r.hw + 2.2, LAYERS.sidewalk[1], false);
    r.g.forEach((p, i) => {
      const end = i === 0 || i === r.g.length - 1;
      if (end || deg.get(kk(p)) >= 3) { disc(BUF.road, p, r.hw, yR, 20); if (walk) disc(BUF.sidewalk, p, r.hw + 2.2, LAYERS.sidewalk[1], 20); }
    });
  }
  // lane markings
  function dashLine(g, cum, off, on, gap, w, ok) {
    const total = cum[cum.length - 1]; let seg = 0;
    const at = s => { while (seg < cum.length - 2 && cum[seg + 1] < s) seg++; const a = g[seg], b = g[seg + 1], L = (cum[seg + 1] - cum[seg]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, f = s - cum[seg]; return [a[0] + dx * f, a[1] + dz * f, -dz, dx]; };
    const y = LAYERS.marks[1], hw = w / 2;
    for (let s = gap ? 1.5 : 0; s + on <= total; s += on + gap) {
      if (!ok(s) || !ok(s + on)) continue;
      const p = at(s), q = at(s + on);
      quad(BUF.marks, [p[0] + p[2] * (off + hw), p[1] + p[3] * (off + hw)], [p[0] + p[2] * (off - hw), p[1] + p[3] * (off - hw)], [q[0] + q[2] * (off - hw), q[1] + q[3] * (off - hw)], [q[0] + q[2] * (off + hw), q[1] + q[3] * (off + hw)], y);
    }
  }
  for (const r of roads) {
    if (r.hw * 2 < 6.4 || r.type === 'service' || r.type === 'living_street') continue;
    const cum = [0]; for (let i = 1; i < r.g.length; i++) cum.push(cum[i - 1] + Math.hypot(r.g[i][0] - r.g[i - 1][0], r.g[i][1] - r.g[i - 1][1]));
    const js = []; r.g.forEach((p, i) => { const d = deg.get(kk(p)); if ((i === 0 || i === r.g.length - 1) ? d !== 2 : d >= 3) js.push(cum[i]); });
    const ok = s => js.every(j => Math.abs(s - j) > 8);
    const oneway = ['yes', '1', 'true'].includes(r.t.oneway) || r.type === 'motorway';
    if (!oneway) dashLine(r.g, cum, 0, 3, 6, 0.14, ok);
    if (MAJOR.has(r.type)) { dashLine(r.g, cum, r.hw - 0.45, 4, 0, 0.14, ok); dashLine(r.g, cum, -(r.hw - 0.45), 4, 0, 0.14, ok); }
  }
  for (const k in LAYERS) if (BUF[k].p.length) scene.add(flatMesh(BUF[k], LAYERS[k][0], k === 'road' ? 7 : k === 'water' ? 20 : 5));

  // road lookup grid
  const RG = 25, rgrid = new Map(), gkey = (i, j) => i * 65536 + j, allSegs = [];
  for (const r of roads.concat(paths)) for (let i = 0; i < r.g.length - 1; i++) {
    const a = r.g[i], b = r.g[i + 1], s = { ax: a[0], az: a[1], dx: b[0] - a[0], dz: b[1] - a[1], hw: r.hw, r };
    s.l2 = s.dx * s.dx + s.dz * s.dz || 1e-9; allSegs.push(s);
    const x0 = Math.floor((Math.min(a[0], b[0]) - s.hw) / RG), x1 = Math.floor((Math.max(a[0], b[0]) + s.hw) / RG), z0 = Math.floor((Math.min(a[1], b[1]) - s.hw) / RG), z1 = Math.floor((Math.max(a[1], b[1]) + s.hw) / RG);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const k = gkey(ix, iz); let L = rgrid.get(k); if (!L) rgrid.set(k, L = []); L.push(s); }
  }
  const segDist = (x, z, s) => { const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2)); return [Math.hypot(x - s.ax - s.dx * t, z - s.az - s.dz * t), t]; };
  function roadAt(x, z) {
    const i0 = Math.floor(x / RG), j0 = Math.floor(z / RG); let any = null, ae = 1e9, drv = null, de = 1e9;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const L = rgrid.get(gkey(i, j)); if (!L) continue;
      for (const s of L) { const e = segDist(x, z, s)[0] - s.hw; if (e < ae) { ae = e; any = s; } if (s.r.drive && e < de) { de = e; drv = s; } }
    }
    return { any, ae, drv, de };
  }
  function snapToRoad(x, z) {
    let best = null, bd = 1e9, bt = 0;
    for (const s of allSegs) if (s.r.drive) { const [d, t] = segDist(x, z, s); if (d < bd) { bd = d; best = s; bt = t; } }
    if (!best) return null;
    return { x: best.ax + best.dx * bt, z: best.az + best.dz * bt, h: Math.atan2(-best.dz, best.dx) };
  }

  // ---- buildings ----
  await say('Raising ' + polys.filter(p => p.kind === 'building').length.toLocaleString() + ' buildings…');
  const WB = { p: [], n: [], uv: [], c: [] }, RB = { p: [], n: [], c: [] }, blds = [];
  const col = new THREE.Color();
  for (const b of polys) {
    if (b.kind !== 'building') continue;
    const t = b.t, rnd = seeded(b.id || b.outer[0][0] * 1000 + b.outer[0][1]);
    const minH = t.building === 'roof' ? 3 : (parseFloat(t.min_height) || (parseFloat(t['building:min_level']) * 3.1) || 0);
    const h = Math.max(minH + 0.5, bHeight(t, rnd));
    const shape = new THREE.Shape(b.outer.map(p => new THREE.Vector2(p[0], -p[1])));
    for (const hole of b.holes) shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p[0], -p[1]))));
    let g; try { g = new THREE.ExtrudeGeometry(shape, { depth: h - minH, bevelEnabled: false }); } catch { continue; }
    g.rotateX(-Math.PI / 2); g.translate(0, minH, 0);
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, uv = g.attributes.uv.array;
    const house = ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow'].includes(t.building);
    const wc = tagColor(t['building:colour']) || new THREE.Color(WALLS[Math.floor(rnd() * WALLS.length)]);
    const rc = tagColor(t['roof:colour']) || new THREE.Color(house ? ROOFS[3 + Math.floor(rnd() * 4)] : ROOFS[Math.floor(rnd() * 3)]);
    for (const gr of g.groups) for (let v = gr.start; v < gr.start + gr.count; v += 3) {
      if (gr.materialIndex === 0) {
        if (nor[v * 3 + 1] < 0) continue;
        for (let k = v; k < v + 3; k++) { RB.p.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); RB.n.push(0, 1, 0); RB.c.push(rc.r, rc.g, rc.b); }
      } else for (let k = v; k < v + 3; k++) {
        const y = pos[k * 3 + 1], ao = 0.72 + 0.28 * Math.min(1, y / 3.5);
        WB.p.push(pos[k * 3], y, pos[k * 3 + 2]); WB.n.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); WB.uv.push(uv[k * 2], uv[k * 2 + 1]);
        col.copy(wc).multiplyScalar(ao); WB.c.push(col.r, col.g, col.b);
      }
    }
    g.dispose();
    blds.push({ outer: b.outer, holes: b.holes, h, minH, ...bbox(b.outer) });
  }
  const winDay = makeTex(512, 512, (x) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 512); speckle(x, 512, 512, 14000, 0.1); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = '#7c8996'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 9); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(i * 64 + 31, j * 64 + 16, 2, 28); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 64 + 18, j * 64 + 44, 28, 3); } });
  const winNight = makeTex(512, 512, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (Math.random() < 0.32) { x.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#cfe0ff'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); } });
  for (const t of [winDay, winNight]) { t.repeat.set(1 / 24, 1 / 24.8); t.offset.set(0, -1 / 24.8); }
  const wallMat = new THREE.MeshStandardMaterial({ map: winDay, vertexColors: true, roughness: 0.85, emissiveMap: winNight, emissive: 0xffffff, emissiveIntensity: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const mkMesh = (B, mat, uv) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; scene.add(m); return m;
  };
  if (WB.p.length) mkMesh(WB, wallMat, true);
  if (RB.p.length) mkMesh(RB, roofMat, false);
  const BG = 20, bgrid = new Map();
  blds.forEach((b, i) => { for (let ix = Math.floor(b.x0 / BG); ix <= Math.floor(b.x1 / BG); ix++) for (let iz = Math.floor(b.z0 / BG); iz <= Math.floor(b.z1 / BG); iz++) { const k = gkey(ix, iz); let L = bgrid.get(k); if (!L) bgrid.set(k, L = []); L.push(i); } });
  function inBuilding(x, z, y) {
    const L = bgrid.get(gkey(Math.floor(x / BG), Math.floor(z / BG))); if (!L) return false;
    for (const i of L) { const b = blds[i]; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || b.h < y || b.minH > y) continue; if (inPoly(x, z, b.outer) && !b.holes.some(h => inPoly(x, z, h))) return true; }
    return false;
  }

  // ---- trees ----
  await say('Planting trees…');
  const trees = [], LIM = HALF + 60, within = (x, z) => Math.abs(x) < LIM && Math.abs(z) < LIM;
  const clear = (x, z) => { const r = roadAt(x, z); return !(r.any && r.ae < 1.2) && !inBuilding(x, z, 1); };
  for (const p of treePts) if (within(p[0], p[1])) trees.push([p[0], p[1], 0.8 + Math.random() * 0.5, 0]);
  for (const g of rows) for (let i = 0; i < g.length - 1; i++) { const a = g[i], b = g[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += 8) { const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L; if (within(x, z)) trees.push([x, z, 0.8 + Math.random() * 0.4, 0]); } }
  for (const p of polys) {
    if (!['park', 'forest', 'scrub'].includes(p.kind) || trees.length > 7000) continue;
    const B = bbox(p.outer), x0 = Math.max(B.x0, -LIM), x1 = Math.min(B.x1, LIM), z0 = Math.max(B.z0, -LIM), z1 = Math.min(B.z1, LIM);
    if (x1 <= x0 || z1 <= z0) continue;
    const fill = polyArea(p.outer) / Math.max(1, (B.x1 - B.x0) * (B.z1 - B.z0)), dens = p.kind === 'forest' ? 45 : p.kind === 'scrub' ? 300 : 220;
    const n = Math.min(2500, Math.round((x1 - x0) * (z1 - z0) * fill / dens));
    for (let i = 0; i < n * 1.5 && trees.length < 7500; i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
      if (!inPoly(x, z, p.outer) || p.holes.some(h => inPoly(x, z, h)) || !clear(x, z)) continue;
      trees.push([x, z, 0.7 + Math.random() * 0.7, p.kind === 'forest' && Math.random() < 0.45 ? 1 : 0]);
    }
  }
  {
    const crownG = new THREE.SphereGeometry(1, 14, 10), cp = crownG.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), f = 1 + 0.13 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 - y * 2.1); cp.setXYZ(i, x * f * 2.4, y * f * 2.1 + 4.6, z * f * 2.4); }
    crownG.computeVertexNormals();
    const coneG = new THREE.ConeGeometry(2.0, 5.5, 9).translate(0, 4.6, 0), cone2 = new THREE.ConeGeometry(1.4, 3.6, 9).translate(0, 6.6, 0);
    const trunkG = new THREE.CylinderGeometry(0.14, 0.24, 3.2, 7).translate(0, 1.6, 0);
    const leaf = new THREE.MeshStandardMaterial({ map: noise, roughness: 0.85 }), bark = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 });
    const nR = trees.filter(t => !t[3]).length, nC = trees.length - nR;
    const T = new THREE.InstancedMesh(trunkG, bark, Math.max(1, trees.length)), R = new THREE.InstancedMesh(crownG, leaf, Math.max(1, nR)), C1 = new THREE.InstancedMesh(coneG, leaf, Math.max(1, nC)), C2 = new THREE.InstancedMesh(cone2, leaf, Math.max(1, nC));
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(1, 1, 1), c = new THREE.Color(); let r = 0, k = 0;
    trees.forEach((t, i) => {
      Q.setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28); S.set(t[2], t[2] * (0.9 + Math.random() * 0.3), t[2]); M.compose(V(t[0], 0, t[1]), Q, S); T.setMatrixAt(i, M);
      c.setHSL(0.22 + Math.random() * 0.08, 0.35 + Math.random() * 0.2, 0.22 + Math.random() * 0.1);
      if (t[3]) { c.offsetHSL(0.04, 0, -0.06); C1.setMatrixAt(k, M); C2.setMatrixAt(k, M); C1.setColorAt(k, c); C2.setColorAt(k, c); k++; } else { R.setMatrixAt(r, M); R.setColorAt(r, c); r++; }
    });
    T.count = trees.length; R.count = nR; C1.count = C2.count = nC;
    for (const m of [T, R, C1, C2]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  }

  // ---- car ----
  await say('Placing the car…');
  const CAR = buildCar(), car = CAR.car;
  car.rotation.order = 'YXZ';
  CAR.lights.low.concat(CAR.lights.high, CAR.lights.fog, CAR.extraLights).forEach(l => { l.visible = false; l.intensity = 0; });
  car.traverse(o => { if (o.isMesh) { o.castShadow = o.material !== CAR.glass && o.material !== CAR.lensClear; o.receiveShadow = false; } });
  CAR.IN.traverse(o => { if (o.isMesh) o.castShadow = false; });
  { const u = car.getObjectByName('underbody'); if (u) u.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
  {
    const blob = (inner, a) => makeTex(128, 128, (x) => { const g = x.createRadialGradient(64, 64, 64 * inner, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); });
    const mk = (tex, w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.07, z); m.renderOrder = 2; car.add(m); };
    mk(blob(0.35, 0.6), 5.0, 2.1, -0.05, 0); const tb = blob(0.1, 0.8); for (const x of [1.32, -1.31]) for (const z of [0.735, -0.735]) mk(tb, 0.55, 0.34, x, z);
  }
  scene.add(car);

  const wheels = ['front_R', 'front_L', 'rear_R', 'rear_L'].map(k => { const w = car.getObjectByName('wheel_' + k); return w && { w, front: k.startsWith('front'), side: k.endsWith('R') ? 1 : -1, base: w.rotation.y }; }).filter(Boolean);
  const swFace = car.getObjectByName('steering_wheel_face');
  const st = { pos: V(), h: 0, v: 0, steer: 0, spin: 0, roll: 0, pitch: 0 };
  const camPos = V();
  function place(x, z, h) {
    st.pos.set(x, 0, z); st.h = h; st.v = 0; st.steer = 0;
    camPos.set(x - Math.cos(h) * 9, 3.2, z + Math.sin(h) * 9);
  }
  const start = snapToRoad(0, 0);
  if (start) place(start.x, start.z, start.h); else place(0, 0, 0);

  // ---- state / lights ----
  const keys = {}; let started = false, camMode = 0, head = false, night = false, shake = 0, edgeMsgT = 0;
  function setLights() {
    CAR.headMat.emissiveIntensity = head ? 6 : 0;
    CAR.lights.low.forEach(l => { l.intensity = head ? 260 : 0; l.visible = head; });
    CAR.lights.high.forEach(l => { l.intensity = head && night ? 900 : 0; l.visible = head && night; });
  }
  function setNight(n) {
    night = n; scene.background = n ? SKY.night : SKY.day; scene.environment = n ? ENV.night : ENV.day; scene.environmentIntensity = n ? 0.3 : 1;
    sun.intensity = n ? 0.1 : 2.8; sun.color.set(n ? 0x9fb3ff : 0xfff0d8); hemi.intensity = n ? 0.08 : 0.7;
    scene.fog.color.set(n ? 0x1a2131 : 0xdfe9ef); scene.fog.near = n ? 80 : 160; scene.fog.far = n ? 650 : 950;
    wallMat.emissiveIntensity = n ? 1.6 : 0;
    head = n || head; setLights();
  }
  setNight(false);

  const msgEl = $('msg'); let msgTimer;
  function flash(t) { msgEl.textContent = t; msgEl.style.opacity = 1; clearTimeout(msgTimer); msgTimer = setTimeout(() => msgEl.style.opacity = 0, 2200); }
  const corners = [[2.2, 0.86], [2.2, -0.86], [0, 0.88], [0, -0.88], [-2.18, 0.86], [-2.18, -0.86]];
  function blocked(x, z, h) {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [lx, lz] of corners) { const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c; if (Math.abs(wx) > HALF || Math.abs(wz) > HALF) return 'edge'; if (inBuilding(wx, wz, 0.6)) return 'bld'; }
    return null;
  }

  function update(dt) {
    const up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown, lf = keys.KeyA || keys.ArrowLeft, rt = keys.KeyD || keys.ArrowRight, hb = keys.Space;
    const ra = roadAt(st.pos.x, st.pos.z), onRoad = ra.drv && ra.de < 0.6, onHard = onRoad || (ra.any && ra.ae < 2.4) || (ra.drv && ra.de < 2.4);
    const vmax = onRoad ? 42 : onHard ? 20 : 12;
    let a = 0;
    if (up) a = st.v < -0.2 ? 18 : 7.4 * Math.max(0, 1 - Math.max(0, st.v) / vmax) + 0.5;
    if (dn) a = st.v > 0.2 ? -17 : -5;
    a -= 0.0011 * st.v * Math.abs(st.v) + (onHard ? 0.02 : 0.7) * st.v + Math.sign(st.v) * 0.3;
    if (hb) a -= Math.sign(st.v) * 9;
    st.v += a * dt;
    if (!up && !dn && Math.abs(st.v) < 0.4) st.v = 0;
    st.v = Math.max(-9, Math.min(50, st.v));
    const target = (lf ? 1 : 0) - (rt ? 1 : 0), ms = 0.62 / (1 + Math.abs(st.v) / 14);
    st.steer += (target * ms - st.steer) * Math.min(1, dt * (target ? 5 : 8));
    const yaw = st.v * Math.tan(st.steer) / 2.63 * (hb && Math.abs(st.v) > 4 ? 1.5 : 1);
    const nh = st.h + yaw * dt, nx = st.pos.x + Math.cos(nh) * st.v * dt, nz = st.pos.z - Math.sin(nh) * st.v * dt;
    const hit = blocked(nx, nz, nh);
    if (hit) {
      const imp = Math.abs(st.v); st.v = -st.v * 0.25; shake = Math.min(1, imp / 20);
      if (hit === 'edge' && performance.now() - edgeMsgT > 3000) { edgeMsgT = performance.now(); flash('Edge of the map area · press M to choose another place'); }
    } else { st.h = nh; st.pos.x = nx; st.pos.z = nz; }
    st.roll += (Math.max(-0.045, Math.min(0.045, st.v * yaw * 0.0045)) - st.roll) * Math.min(1, dt * 6);
    st.pitch += (Math.max(-0.03, Math.min(0.02, a * 0.0018)) - st.pitch) * Math.min(1, dt * 5);
    if (!onHard && Math.abs(st.v) > 3) st.pitch += (Math.random() - 0.5) * 0.004;
    st.spin += st.v * dt / 0.308;
    return { braking: (dn && st.v > 0.2) || hb, reversing: st.v < -0.2 };
  }
  function syncCar(s) {
    car.position.set(st.pos.x, 0, st.pos.z); car.rotation.set(st.roll, st.h, st.pitch);
    for (const w of wheels) w.w.rotation.set(0, w.base + (w.front ? st.steer : 0), w.side > 0 ? -st.spin : st.spin);
    if (swFace) swFace.rotation.z = st.steer * 4;
    CAR.tailMat.emissiveIntensity = s.braking ? 7 : head ? 1.8 : 0; CAR.cbrakeMat.emissiveIntensity = s.braking ? 7 : 0;
    CAR.revMat.emissiveIntensity = s.reversing ? 5 : 0;
  }
  const look = V(), want = V();
  function updateCam(dt) {
    const fx = Math.cos(st.h), fz = -Math.sin(st.h);
    if (camMode === 0) {
      let back = 8.5 + Math.max(0, st.v) * 0.04, camY = 3.0;
      for (let s = 2; s < back; s += 0.6) if (inBuilding(st.pos.x - fx * s, st.pos.z - fz * s, camY)) { back = Math.max(2.5, s - 0.8); camY = 2.2 + back * 0.12; break; }
      want.set(st.pos.x - fx * back, camY, st.pos.z - fz * back);
      camPos.lerp(want, 1 - Math.exp(-dt * 4.5)); camera.position.copy(camPos);
      look.set(st.pos.x + fx * 4, 1.1, st.pos.z + fz * 4); camera.lookAt(look);
      camera.fov = 58 + Math.max(0, st.v) * 0.18; camera.near = 0.1;
    } else {
      car.updateMatrixWorld(true);
      camera.position.copy(car.localToWorld(V(-0.18, 1.2, -0.37)));
      camera.lookAt(car.localToWorld(V(20, 0.75, -0.37)));
      camera.fov = 68; camera.near = 0.02;
    }
    if (shake > 0.01) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.2; shake *= Math.exp(-dt * 7); }
    camera.updateProjectionMatrix();
    sun.position.copy(st.pos).add(SUN_OFF); sun.target.position.copy(st.pos);
  }

  // ---- HUD ----
  const kmh = $('kmh'), gear = $('gear'), streetEl = $('street');
  let streetT = 0, shownStreet = null;
  function hud(s, dt) {
    kmh.textContent = Math.round(Math.abs(st.v) * 3.6);
    gear.textContent = s.reversing ? 'R' : st.v === 0 ? 'N' : 'D';
    if ((streetT -= dt) > 0) return; streetT = 0.25;
    const r = roadAt(st.pos.x, st.pos.z); let label = '';
    const seg = r.drv && r.de < 3 ? r.drv : r.any && r.ae < 1 ? r.any : null;
    if (seg) label = seg.r.name || TYPE_LABEL[seg.r.type] || 'Road';
    if (label !== shownStreet) { shownStreet = label; streetEl.style.opacity = 0; setTimeout(() => { streetEl.textContent = label; streetEl.style.opacity = label ? 1 : 0; }, 180); }
  }
  $('place').textContent = placeName || lat0.toFixed(4) + ', ' + lon0.toFixed(4);
  $('stats').textContent = roads.length.toLocaleString() + ' streets · ' + blds.length.toLocaleString() + ' buildings · ' + trees.length.toLocaleString() + ' trees';
  $('startPlace').textContent = placeName || lat0.toFixed(4) + ', ' + lon0.toFixed(4);
  if (!start) $('startNote').textContent = 'No drivable roads were found here. You can still drive on the ground, or press M to pick another place.';

  load.style.display = 'none';
  $('hud').style.display = 'block';
  const startEl = $('start'); startEl.style.display = 'flex';
  function begin() { if (started) return; started = true; startEl.style.display = 'none'; setTimeout(() => $('keys').style.opacity = 0, 7000); }
  startEl.addEventListener('click', begin);
  $('changePlace').addEventListener('click', backToMap);
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') { backToMap(); return; }
    if (!started) begin();
    keys[e.code] = true; if (e.repeat) return;
    if (e.code === 'KeyH') { head = !head; setLights(); }
    if (e.code === 'KeyN') setNight(!night);
    if (e.code === 'KeyC') camMode = 1 - camMode;
    if (e.code === 'KeyR') { const s = snapToRoad(st.pos.x, st.pos.z); if (s) place(s.x, s.z, s.h); }
  });
  addEventListener('keyup', e => keys[e.code] = false);
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  let last = performance.now(), lastS = { braking: false, reversing: false };
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (started) lastS = update(dt);
    syncCar(lastS); updateCam(dt); hud(lastS, dt);
    renderer.render(scene, camera);
  });
}
