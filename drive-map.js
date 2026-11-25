import * as THREE from 'three';
import { buildCar } from './sedan-model.js';
import { loadVaz } from './vaz-model.js';
import { HALF, CACHE_V, AREA_PROXY, ENDPOINTS, snap, areaKey, overpassQuery, overpassError } from './osm-query.js';
import { fetchVectorArea, FALLBACK_CREDIT } from './vector-fallback.js';
import { radio, stationsNear } from './radio.js';

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

// ---------------- Cache (IndexedDB) ----------------
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('sedan-map-cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('osm'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('osm').objectStore('osm').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const db = await idb(); db.transaction('osm', 'readwrite').objectStore('osm').put(v, k); } catch { } }
async function idbPrune(prefix) { // drop entries saved by older versions of the query
  try { const s = (await idb()).transaction('osm', 'readwrite').objectStore('osm'), q = s.getAllKeys(); q.onsuccess = () => { for (const k of q.result) if (!String(k).startsWith(prefix)) s.delete(k); }; } catch { }
}

// ---------------- Map data download ----------------
// The caching proxy first (one shared download per place for all players), then the public Overpass servers one by
// one. A server that answers 429/406 is left alone for 30 s, as the Overpass usage policy asks. When none of them
// delivers, the place is built from OpenFreeMap's vector tiles instead (no limits, less detail; see vector-fallback.js).
const REST_KEY = 'sedan-overpass-rest-v1';
const restMap = () => { try { return JSON.parse(localStorage.getItem(REST_KEY) || '{}'); } catch { return {}; } };
const restHost = host => { const m = restMap(); m[host] = Date.now() + 30000; try { localStorage.setItem(REST_KEY, JSON.stringify(m)); } catch { } };
async function fetchArea(lat0, lon0, status) {
  const proxy = AREA_PROXY ? [{ host: new URL(AREA_PROXY).host, url: AREA_PROXY.replace(/\/$/, '') + '/area?lat=' + lat0.toFixed(4) + '&lon=' + lon0.toFixed(4), wait: 150000, proxy: true }] : [];
  const sources = proxy.concat(ENDPOINTS.map(u => ({ host: new URL(u).host, url: u, wait: 45000 })));
  let err = null, rested = 0;
  for (const s of sources) {
    if ((restMap()[s.host] || 0) > Date.now()) { rested++; continue; }
    const ac = new AbortController(), t0 = performance.now();
    const tick = setInterval(() => status('Downloading map data from ' + s.host + '… ' + Math.round((performance.now() - t0) / 1000) + ' s'), 500);
    const kill = setTimeout(() => ac.abort(), s.wait);
    try {
      const r = await fetch(s.url, s.proxy ? { signal: ac.signal } : { method: 'POST', signal: ac.signal, body: 'data=' + encodeURIComponent(overpassQuery(lat0, lon0)), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (s.proxy && r.status === 503) { // the proxy already tried every Overpass server; asking them again ourselves would only add load
        const j = await r.json().catch(() => ({})); err = new Error(j.error || 'the map servers are busy'); break;
      }
      if (r.status === 429 || r.status === 406) { restHost(s.host); throw new Error('too many requests'); }
      if (!r.ok) throw new Error('server replied ' + r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.elements)) throw new Error('bad reply');
      const bad = overpassError(data.remark); if (bad) throw new Error(bad.slice(0, 90));
      return { data };
    } catch (e) { err = e.name === 'AbortError' ? new Error('no answer in time') : e; status(s.host + ' is busy, trying another server…'); }
    finally { clearInterval(tick); clearTimeout(kill); }
  }
  status('The map servers are busy. Building a simplified map from OpenFreeMap…');
  try { return { data: await fetchVectorArea(lat0, lon0), fallback: true }; } catch (e) { console.warn('vector fallback failed', e); }
  return { err: rested && !err ? new Error('the servers asked us to wait 30 seconds') : err };
}

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
function sides(g, hw) { // mitred left/right offset polylines (negative hw swaps sides)
  const n = g.length, Lp = [], Rp = [];
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
  return [Lp, Rp];
}
function ribbon(B, g, hw, y, caps) {
  const n = g.length; if (n < 2) return;
  const [Lp, Rp] = sides(g, hw);
  for (let i = 0; i < n - 1; i++) quad(B, Lp[i], Rp[i], Rp[i + 1], Lp[i + 1], y);
  if (caps) { disc(B, g[0], hw, y); disc(B, g[n - 1], hw, y); }
}
const offsetLine = (g, off) => sides(g, off)[0];
function cumLen(g) { const c = [0]; for (let i = 1; i < g.length; i++) c.push(c[i - 1] + Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1])); return c; }
function densify(g, step) { const o = [g[0]]; for (let i = 1; i < g.length; i++) { const a = g[i - 1], b = g[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 1; k <= n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; }
function runs(g, ok) { // split a polyline into the pieces whose segment midpoints pass ok(x, z)
  const out = []; let cur = null;
  for (let i = 0; i < g.length - 1; i++) { const a = g[i], b = g[i + 1]; if (ok((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) { if (!cur) out.push(cur = [a]); cur.push(b); } else cur = null; }
  return out;
}
function eachTri(outer, holes, cb) {
  const o = outer.map(p => new THREE.Vector2(p[0], p[1])), hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  let f; try { f = THREE.ShapeUtils.triangulateShape(o, hs); } catch { return; }
  const all = o.concat(...hs);
  for (const [i, j, k] of f) cb([all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]);
}
function fillPoly(B, outer, holes, y) { eachTri(outer, holes, (a, b, c) => tri(B, a, b, c, y)); }
function openRing(r) { const o = []; for (const p of r) if (!o.length || !same(o[o.length - 1], p)) o.push(p); if (o.length > 1 && same(o[0], o[o.length - 1])) o.pop(); return o; }
function signedArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
function innerPt(r) { // a point inside the ring (centroid, or the middle of its largest triangle)
  let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } x /= r.length; z /= r.length;
  if (inPoly(x, z, r)) return [x, z];
  let best = r[0], ba = -1;
  eachTri(openRing(r), [], (a, b, c) => { const ar = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])); if (ar > ba) { ba = ar; best = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; } });
  return best;
}
function obb(r) { // minimum-area oriented box: centre, long axis (ux,uz), half length hl >= half width hw
  let b = null;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 0.2) continue;
    const ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of r) { const u = p[0] * ux + p[1] * uz, v = p[1] * ux - p[0] * uz; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const ar = (u1 - u0) * (v1 - v0); if (!b || ar < b.ar) b = { ar, ux, uz, u0, u1, v0, v1 };
  }
  if (!b) return null;
  const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2; let hl = (b.u1 - b.u0) / 2, hw = (b.v1 - b.v0) / 2, ux = b.ux, uz = b.uz;
  const o = { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, ar: b.ar };
  if (hw > hl) { [hl, hw] = [hw, hl]; [ux, uz] = [-uz, ux]; }
  return Object.assign(o, { ux, uz, hl, hw });
}
function clipHalf(P, a, b, c) { // keep the part of polygon P where a + b*x + c*z <= 0
  const o = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], gp = a + b * p[0] + c * p[1], gq = a + b * q[0] + c * q[1];
    if (gp <= 0) o.push(p);
    if ((gp <= 0) !== (gq <= 0)) { const t = gp / (gp - gq); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return o;
}
// 3D buffers {p, n, c[, uv]}: tri3 flips the winding so the face points along n; ao darkens vertices near the ground
function tri3(B, A, Bv, C, n, col, ao, uv) {
  const e1x = Bv[0] - A[0], e1y = Bv[1] - A[1], e1z = Bv[2] - A[2], e2x = C[0] - A[0], e2y = C[1] - A[1], e2z = C[2] - A[2];
  const d = (e1y * e2z - e1z * e2y) * n[0] + (e1z * e2x - e1x * e2z) * n[1] + (e1x * e2y - e1y * e2x) * n[2];
  if (Math.abs(d) < 1e-7) return;
  const vs = d > 0 ? [A, Bv, C] : [A, C, Bv], us = uv && (d > 0 ? uv : [uv[0], uv[2], uv[1]]);
  for (let k = 0; k < 3; k++) {
    const v = vs[k], f = ao ? 0.72 + 0.28 * Math.min(1, v[1] / 3.5) : 1;
    B.p.push(v[0], v[1], v[2]); B.n.push(n[0], n[1], n[2]); B.c.push(col.r * f, col.g * f, col.b * f);
    if (B.uv) B.uv.push(us ? us[k][0] : 0, us ? us[k][1] : 0);
  }
}
function quad3(B, a, b, c, d, n, col, ao, uv) { tri3(B, a, b, c, n, col, ao, uv && [uv[0], uv[1], uv[2]]); tri3(B, a, c, d, n, col, ao, uv && [uv[0], uv[2], uv[3]]); }
function wallStrip(B, g, th, y0, y1, col) { // a solid wall/hedge of thickness th along polyline g
  if (g.length < 2) return;
  const [Lp, Rp] = sides(g, th / 2), cum = cumLen(g), S = 0.5;
  for (let i = 0; i < g.length - 1; i++) {
    const dx = g[i + 1][0] - g[i][0], dz = g[i + 1][1] - g[i][1], L = Math.hypot(dx, dz) || 1, nl = [-dz / L, 0, dx / L], nr = [dz / L, 0, -dx / L], u0 = cum[i] * S, u1 = cum[i + 1] * S;
    for (const [P, n] of [[Lp, nl], [Rp, nr]]) quad3(B, [P[i][0], y0, P[i][1]], [P[i + 1][0], y0, P[i + 1][1]], [P[i + 1][0], y1, P[i + 1][1]], [P[i][0], y1, P[i][1]], n, col, false, [[u0, y0 * S], [u1, y0 * S], [u1, y1 * S], [u0, y1 * S]]);
    quad3(B, [Lp[i][0], y1, Lp[i][1]], [Lp[i + 1][0], y1, Lp[i + 1][1]], [Rp[i + 1][0], y1, Rp[i + 1][1]], [Rp[i][0], y1, Rp[i][1]], [0, 1, 0], col, false, [[u0, 0], [u1, 0], [u1, th * S], [u0, th * S]]);
  }
  for (const [i, j] of [[0, 1], [g.length - 1, g.length - 2]]) {
    const dx = g[i][0] - g[j][0], dz = g[i][1] - g[j][1], L = Math.hypot(dx, dz) || 1;
    quad3(B, [Lp[i][0], y0, Lp[i][1]], [Rp[i][0], y0, Rp[i][1]], [Rp[i][0], y1, Rp[i][1]], [Lp[i][0], y1, Lp[i][1]], [dx / L, 0, dz / L], col, false, [[0, y0 * S], [th * S, y0 * S], [th * S, y1 * S], [0, y1 * S]]);
  }
}
function fenceStrip(B, g, y0, y1, col) { // see-through fence/railing: one double-sided quad per segment
  const cum = cumLen(g);
  for (let i = 0; i < g.length - 1; i++) {
    const a = g[i], b = g[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, u0 = cum[i] / (y1 - y0) * 0.5, u1 = cum[i + 1] / (y1 - y0) * 0.5;
    quad3(B, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [-dz / L, 0, dx / L], col, false, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
  }
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

const LANDUSE = { residential: 'resid', religious: 'resid', commercial: 'urban', retail: 'urban', industrial: 'indus', railway: 'indus', military: 'indus', construction: 'bare', brownfield: 'bare', garages: 'parking' };
// Sea polygons from OSM coastline ways (land on the left, water on the right). The coast is clipped to the
// data box ±B, its loose ends are extended straight out to ±B2 so the sea carries on past the map area, and the
// pieces are closed by walking clockwise along the box. Works in (east, north) = (x, -z).
function seaPolys(coast, B, B2) {
  const pool = coast.map(g => g.map(p => [p[0], -p[1]])), chains = [];
  while (pool.length) { // join ways end-to-start (coastline ways are all oriented the same way)
    let c = pool.shift();
    for (let hit = true; hit && !same(c[0], c[c.length - 1]);) {
      hit = false;
      for (let i = 0; i < pool.length; i++) {
        if (same(c[c.length - 1], pool[i][0])) { c = c.concat(pool[i].slice(1)); pool.splice(i, 1); hit = true; break; }
        if (same(pool[i][pool[i].length - 1], c[0])) { c = pool[i].concat(c.slice(1)); pool.splice(i, 1); hit = true; break; }
      }
    }
    chains.push(c);
  }
  const inBox = p => Math.abs(p[0]) < B && Math.abs(p[1]) < B, islands = [], lakes = [], pieces = [];
  const clipSeg = (p, q) => { // Liang–Barsky against the ±B box → [t0, t1] or null
    let t0 = 0, t1 = 1; const dx = q[0] - p[0], dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] + B], [dx, B - p[0]], [-dy, p[1] + B], [dy, B - p[1]]]) {
      if (pp === 0) { if (qq < 0) return null; continue; }
      const r = qq / pp; if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [t0, t1];
  };
  for (const c of chains) {
    const closed = same(c[0], c[c.length - 1]);
    if (closed && c.every(inBox)) { (signedArea(c) > 0 ? islands : lakes).push(c); continue; }
    const out = []; let cur = null, firstOpen = false;
    for (let i = 0; i < c.length - 1; i++) {
      const p = c[i], q = c[i + 1], t = clipSeg(p, q); if (!t || t[1] - t[0] < 1e-9) continue;
      const a = [p[0] + (q[0] - p[0]) * t[0], p[1] + (q[1] - p[1]) * t[0]], b = [p[0] + (q[0] - p[0]) * t[1], p[1] + (q[1] - p[1]) * t[1]];
      if (!cur) { cur = [a]; cur.start = t[0] > 0; if (!out.length && !cur.start) firstOpen = true; out.push(cur); }
      cur.push(b);
      if (t[1] < 1) { cur.end = true; cur = null; }
    }
    if (closed && cur && firstOpen && out.length > 1) { const f = out.shift(); cur.push(...f.slice(1)); cur.end = f.end; } // ring started inside the box
    for (const p of out) if (p.start && p.end) pieces.push(p);
  }
  if (!pieces.length && !islands.length) return lakes.map(l => ({ outer: l.map(p => [p[0], -p[1]]), holes: [] }));
  const P8 = 8 * B2, edgeN = p => Math.abs(p[1]) >= Math.abs(p[0]) ? [0, Math.sign(p[1])] : [Math.sign(p[0]), 0];
  const per = p => { // clockwise perimeter coordinate on the ±B2 box, starting at the top-left corner
    const [e, n] = p, b = B2;
    if (Math.abs(n) >= Math.abs(e)) return n > 0 ? e + b : 4 * b + (b - e);
    return e > 0 ? 2 * b + (b - n) : 6 * b + (n + b);
  };
  const ext = p => { const d = edgeN(p); return [p[0] + d[0] * (B2 - B), p[1] + d[1] * (B2 - B)]; };
  const P = pieces.map(p => { const pts = [ext(p[0]), ...p, ext(p[p.length - 1])]; return { pts, sIn: per(pts[0]), sOut: per(pts[pts.length - 1]), used: false }; });
  const corners = [[-B2, B2], [B2, B2], [B2, -B2], [-B2, -B2]], seas = [];
  if (!P.length) seas.push(corners.slice());
  for (const st of P) if (!st.used) {
    const poly = []; let cur = st;
    for (let guard = 0; guard < 200; guard++) {
      cur.used = true; poly.push(...cur.pts);
      let best = st, bd = (st.sIn - cur.sOut + P8) % P8 || P8;
      for (const q of P) if (!q.used) { const d = (q.sIn - cur.sOut + P8) % P8; if (d < bd) { bd = d; best = q; } }
      corners.map(c => [c, (per(c) - cur.sOut + P8) % P8]).filter(([, d]) => d > 0 && d < bd).sort((a, b) => a[1] - b[1]).forEach(([c]) => poly.push(c));
      if (best === st) break; cur = best;
    }
    seas.push(poly);
  }
  const res = seas.map(o => ({ outer: o, holes: islands.filter(i => inPoly(i[0][0], i[0][1], o)) }));
  for (const l of lakes) res.push({ outer: l, holes: [] });
  return res.map(s => ({ outer: s.outer.map(p => [p[0], -p[1]]), holes: s.holes.map(h => h.map(p => [p[0], -p[1]])) }));
}
function areaKind(t) {
  if (t.building && t.building !== 'no') return 'building';
  if (t['building:part'] && t['building:part'] !== 'no') return 'part';
  if (t.highway) return t.area === 'yes' ? 'paving' : null;
  if (t.amenity === 'parking') return ['underground', 'multi-storey', 'rooftop'].includes(t.parking) ? null : 'parking';
  if (t.amenity === 'marketplace' || t.railway === 'platform' || t.man_made === 'pier') return 'paving';
  if (t.man_made === 'breakwater' || t.man_made === 'groyne' || t.natural === 'bare_rock' || t.natural === 'scree') return 'rock';
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.water) return 'water';
  if (t.natural === 'tree_row' || t.natural === 'coastline' || t.waterway || t.railway) return null;
  if (LANDUSE[t.landuse]) return LANDUSE[t.landuse];
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
const TYPE_LABEL = { motorway: 'Motorway', trunk: 'Main road', primary: 'Main road', secondary: 'Main road', tertiary: 'Road', unclassified: 'Road', residential: 'Residential street', living_street: 'Living street', service: 'Service road', footway: 'Footpath', cycleway: 'Cycle path', pedestrian: 'Pedestrian street', steps: 'Steps', path: 'Path', track: 'Track', bridleway: 'Bridleway', pier: 'Pier' };
const num = v => { const f = parseFloat(v); return f > 0 && f < 1000 ? f : 0; };
function bDefaultH(type, r) { // typical total height (m) when a building has no height or level tags
  const d = { house: 7, detached: 7.5, semidetached_house: 8, terrace: 9, residential: 10, apartments: 16, bungalow: 4.5, garage: 3, garages: 3, carport: 2.6, shed: 2.8, hut: 3, cabin: 3.5, commercial: 12, retail: 7, supermarket: 7, industrial: 9, warehouse: 9, office: 18, school: 10, university: 14, hospital: 18, church: 15, cathedral: 30, hotel: 20, train_station: 12, kiosk: 3, service: 3.5, static_caravan: 3, roof: 4, farm: 7, barn: 7, farm_auxiliary: 5 };
  return (d[type] || 8) * (0.85 + r() * 0.35);
}
// roof:shape → the shapes we can build; anything else falls back to the house/flat defaults
const ROOF_SHAPE = { flat: 'flat', gabled: 'gabled', gambrel: 'gabled', side_mansard: 'gabled', saltbox: 'gabled', round: 'gabled', hipped: 'hipped', 'half-hipped': 'hipped', side_hipped: 'hipped', mansard: 'hipped', quadruple_saltbox: 'hipped', pyramidal: 'pyramidal', cone: 'pyramidal', skillion: 'skillion', sloped: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'onion' };
const HOUSE_T = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'farm_auxiliary', 'barn', 'cabin', 'hut', 'villa', 'chapel', 'stable', 'cowshed', 'shed', 'static_caravan', 'allotment_house']);
const PLAIN_T = new Set(['garage', 'garages', 'shed', 'carport', 'hut', 'roof', 'service', 'storage_tank', 'silo', 'barn', 'farm_auxiliary', 'cowshed', 'stable', 'bunker', 'transformer_tower', 'greenhouse', 'ruins', 'column', 'steps']);
const WALLS = ['#e4ddd0', '#d8cfc0', '#cbbfae', '#b59c82', '#a9725c', '#c4b39b', '#ddd6cb', '#9f948a', '#e8e2d6', '#b8866a', '#d2c6b0'];
const ROOFS = ['#5f5c58', '#6e6a64', '#4f4d4b'], PITCHED = ['#9c4f34', '#8b5a44', '#a5603f', '#7a5040', '#55585d', '#45484d', '#8f4a36'], DOMES = ['#6f9a86', '#7d8287', '#a58a4e'];
const WALL_MAT = { brick: '#9c5a44', stone: '#b9ae9a', sandstone: '#c9a77e', concrete: '#bdbab2', glass: '#7f97a8', wood: '#9a7a55', timber_framing: '#e0d6c2', metal: '#a3a7aa', plaster: '#ddd5c6', limestone: '#d8d0bd' };
const ROOF_MAT = { roof_tiles: '#a0553a', tile: '#a0553a', tiles: '#a0553a', slate: '#4c5059', metal: '#7b8287', metal_sheet: '#7b8287', copper: '#6f9a86', concrete: '#8e8c87', tar_paper: '#3f3f42', asphalt: '#3f3f42', glass: '#8fa7b8', thatch: '#8a7448', grass: '#6f8d4a', gravel: '#9a958c', wood: '#6b5038', stone: '#8e877c', eternit: '#7d7d78' };
const matColor = (tab, v) => v && tab[v.toLowerCase()] ? new THREE.Color(tab[v.toLowerCase()]) : null;
const COMPASS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
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
  const cacheKey = areaKey(lat0, lon0);
  let data = await idbGet(cacheKey), err = null, fallback = false;
  if (data) await say('Loading saved map data…');
  else { ({ data, err, fallback } = await fetchArea(lat0, lon0, say)); if (data && !fallback) { idbSet(cacheKey, data); idbPrune(CACHE_V); } } // a simplified map isn't kept, so the next visit tries for full detail
  if (!data) { $('loadMsg').textContent = 'The free OpenStreetMap servers are busy (' + (err ? err.message : 'unknown error') + '). Try again in a minute.'; $('spin').style.display = 'none'; $('loadBtns').style.display = 'flex'; return; }

  await say('Building the streets…');
  const lines = [], polys = [], treePts = [], crossPts = [];
  for (const el of data.elements) {
    if (el.type === 'node') { ((el.tags || {}).highway === 'crossing' ? crossPts : treePts).push(P(el.lat, el.lon)); continue; }
    const t = el.tags || {}, kind = areaKind(t);
    if (el.type === 'way') {
      if (!el.geometry || el.geometry.length < 2) continue;
      const g = el.geometry.map(p => P(p.lat, p.lon)), closed = g.length > 3 && same(g[0], g[g.length - 1]);
      if (kind && closed) polys.push({ kind, outer: g, holes: [], t, id: el.id });
      else lines.push({ t, g });
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
  const pm = new THREE.PMREMGenerator(renderer);
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5d6046, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
  // one shadow map over a box that reaches further ahead of the car than behind it (see placeShadow)
  const SH_R = 90, SH_MAP = renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
  sun.shadow.mapSize.set(SH_MAP, SH_MAP); Object.assign(sun.shadow.camera, { left: -SH_R, right: SH_R, top: SH_R, bottom: -SH_R, near: 1, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; scene.add(sun, sun.target);
  const lightDir = V(0, 1, 0); // towards the sun (or moon)
  scene.fog = new THREE.Fog(0xdfe9ef, 160, 950);

  // ---- textures & materials ----
  const noise = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#dcdcdc'; x.fillRect(0, 0, w, h); speckle(x, w, h, 40000, 0.3); });
  const asphalt = makeTex(512, 512, (x, w, h) => { x.fillStyle = '#4b4c4f'; x.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(0,0,0,' + (0.04 + Math.random() * 0.06) + ')'; x.beginPath(); x.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 80, 20 + Math.random() * 50, Math.random() * 3, 0, Math.PI * 2); x.fill(); } speckle(x, w, h, 80000, 0.24); });
  const slabs = makeTex(256, 256, (x, w, h) => { x.fillStyle = '#bdbab2'; x.fillRect(0, 0, w, h); speckle(x, w, h, 16000, 0.14); x.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i < w; i += 64) { x.fillRect(i, 0, 2, h); x.fillRect(0, i, w, 2); } });
  const layer = (map, color, y, extra = {}) => new THREE.MeshStandardMaterial({ map, color, roughness: 1, side: THREE.DoubleSide, ...extra });
  // [material, height]: flat layers are stacked a couple of millimetres apart so later ones win where they overlap
  const LAYERS = {
    resid: [layer(noise, '#8b9d63'), 0.004], urban: [layer(noise, '#b3afa6'), 0.005], indus: [layer(noise, '#aaa79f'), 0.006], bare: [layer(noise, '#ad9f84'), 0.008],
    farm: [layer(noise, '#b3a774'), 0.01], sand: [layer(noise, '#d8c99c'), 0.012], park: [layer(noise, '#6f9448'), 0.014],
    scrub: [layer(noise, '#7d8d52'), 0.016], forest: [layer(noise, '#55763a'), 0.018], pitch: [layer(noise, '#5e9a4c'), 0.02],
    water: [new THREE.MeshStandardMaterial({ color: '#33607a', roughness: 0.06, metalness: 0.15, side: THREE.DoubleSide }), 0.024],
    rock: [layer(noise, '#9a958c'), 0.028], paving: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.03], parking: [layer(asphalt, '#dcdcda', 0, { roughness: 0.9 }), 0.032],
    dirt: [layer(noise, '#b5a586'), 0.034], paved: [layer(slabs, '#f2f0ea', 0, { roughness: 0.95 }), 0.036],
    ballast: [layer(noise, '#968e83'), 0.038], sleeper: [layer(null, '#6e665d', 0, { roughness: 0.9 }), 0.039],
    sidewalk: [layer(slabs, '#ffffff', 0, { roughness: 0.95 }), 0.04], road: [layer(asphalt, '#ffffff', 0, { roughness: 0.88 }), 0.05],
    marks: [new THREE.MeshStandardMaterial({ color: '#ecebe4', roughness: 0.55, side: THREE.DoubleSide }), 0.058],
    rail: [new THREE.MeshStandardMaterial({ color: '#a4a7ad', metalness: 0.8, roughness: 0.3, side: THREE.DoubleSide }), 0.062]
  };
  const BUF = Object.fromEntries(Object.keys(LAYERS).map(k => [k, newBuf()]));
  // the base ground sits a few cm below the flat layers and is tiled, so it can't win the depth test against them far away
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000, 50, 50), new THREE.MeshStandardMaterial({ map: noise, color: '#8a9468', roughness: 1 }));
  ground.material.map = noise.clone(); ground.material.map.repeat.set(1600, 1600); ground.material.map.needsUpdate = true;
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; scene.add(ground);

  // ---- area fills ----
  for (const p of polys) if (LAYERS[p.kind]) fillPoly(BUF[p.kind], p.outer, p.holes, LAYERS[p.kind][1]);

  // ---- roads ----
  const roads = [], paths = [], rivers = [], rows = [], rails = [], barriers = [], coast = [];
  for (const { t, g } of lines) {
    if (t.railway && t.railway !== 'platform' && !(t.tunnel && t.tunnel !== 'no')) rails.push({ g, t, tram: t.railway === 'tram' });
    if (t.barrier) barriers.push({ g, t });
    else if (t.natural === 'coastline') coast.push(g);
    else if (t.man_made === 'pier') paths.push({ g, hw: (num(t.width) || 3) / 2, t, type: 'pier', name: t.name || '', drive: false });
    else if (t.man_made === 'breakwater' || t.man_made === 'groyne') ribbon(BUF.rock, g, (num(t.width) || 4) / 2, LAYERS.rock[1], true);
    else if (t.highway) {
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
  const seas = seaPolys(coast, HALF + 50, 3000);
  for (const s of seas) fillPoly(BUF.water, s.outer, s.holes, LAYERS.water[1]);
  const kk = p => Math.round(p[0] * 20) + ',' + Math.round(p[1] * 20);
  const deg = new Map();
  for (const r of roads) r.g.forEach((p, i) => { const k = kk(p); deg.set(k, (deg.get(k) || 0) + (i === 0 || i === r.g.length - 1 ? 1 : 2)); });
  for (const r of rivers) ribbon(BUF.water, r.g, r.hw, LAYERS.water[1], true);
  for (const r of paths) ribbon(DIRT.has(r.type) ? BUF.dirt : BUF.paved, r.g, r.hw, DIRT.has(r.type) ? LAYERS.dirt[1] : LAYERS.paved[1], true);
  for (const r of roads) {
    const yR = LAYERS.road[1], walk = r.walk = SIDEWALK.has(r.type) && r.t.sidewalk !== 'no' && r.t.sidewalk !== 'none';
    ribbon(BUF.road, r.g, r.hw, yR, false);
    if (walk) ribbon(BUF.sidewalk, r.g, r.hw + 2.2, LAYERS.sidewalk[1], false);
    r.g.forEach((p, i) => {
      const end = i === 0 || i === r.g.length - 1;
      if (end || deg.get(kk(p)) >= 3) { disc(BUF.road, p, r.hw, yR, 20); if (walk) disc(BUF.sidewalk, p, r.hw + 2.2, LAYERS.sidewalk[1], 20); }
    });
  }
  // Dashes along a polyline: pieces `on` m long every `on + gap` m, `w` wide, centred `off` m left of the line.
  // ok(s, p) can veto a piece (p = [x, z, nx, nz]); gap 0 draws a continuous line made of pieces.
  function dashLine(g, cum, off, on, gap, w, ok, B = BUF.marks, y = LAYERS.marks[1]) {
    const total = cum[cum.length - 1], hw = w / 2; let seg = 0;
    const at = s => { while (seg < cum.length - 2 && cum[seg + 1] < s) seg++; const a = g[seg], b = g[seg + 1], L = (cum[seg + 1] - cum[seg]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, f = s - cum[seg]; return [a[0] + dx * f, a[1] + dz * f, -dz, dx]; };
    for (let s = gap ? 1.5 : 0; s < total - 0.05; s += on + gap) {
      const e = Math.min(total, s + on); if (gap && e < s + on) break;
      const p = at(s), q = at(e);
      if (!ok(s, p) || !ok(e, q)) continue;
      quad(B, [p[0] + p[2] * (off + hw), p[1] + p[3] * (off + hw)], [p[0] + p[2] * (off - hw), p[1] + p[3] * (off - hw)], [q[0] + q[2] * (off - hw), q[1] + q[3] * (off - hw)], [q[0] + q[2] * (off + hw), q[1] + q[3] * (off + hw)], y);
    }
  }
  // lane markings: centre line (solid double on 4+ lanes), edge lines on main roads, lane dividers from lanes=*
  for (const r of roads) {
    if (r.hw * 2 < 6.4 || r.type === 'service' || r.type === 'living_street') continue;
    const cum = cumLen(r.g);
    const js = []; r.g.forEach((p, i) => { const d = deg.get(kk(p)); if ((i === 0 || i === r.g.length - 1) ? d !== 2 : d >= 3) js.push(cum[i]); });
    const ok = s => js.every(j => Math.abs(s - j) > 8);
    const oneway = ['yes', '1', 'true'].includes(r.t.oneway) || r.type === 'motorway', ln = parseInt(r.t.lanes) || 0, edge = r.hw - 0.45;
    if (!oneway) { if (ln >= 4) for (const o of [0.12, -0.12]) dashLine(r.g, cum, o, 4, 0, 0.12, ok); else dashLine(r.g, cum, 0, 3, 6, 0.14, ok); }
    if (MAJOR.has(r.type)) { dashLine(r.g, cum, edge, 4, 0, 0.14, ok); dashLine(r.g, cum, -edge, 4, 0, 0.14, ok); }
    if (oneway && ln >= 2) for (let j = 1; j < ln; j++) dashLine(r.g, cum, -edge + j * 2 * edge / ln, 3, 6, 0.12, ok);
    if (!oneway && ln >= 4) { const k = Math.floor(ln / 2); for (let j = 1; j < k; j++) for (const sg of [1, -1]) dashLine(r.g, cum, sg * j * edge / k, 3, 6, 0.12, ok); }
  }

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
    return { x: best.ax + best.dx * bt, z: best.az + best.dz * bt, h: Math.atan2(-best.dz, best.dx), name: best.r.name };
  }
  const onDrive = (x, z, m = 0) => { const r = roadAt(x, z); return !!r.drv && r.de < -m; };
  const isBridge = t => t.bridge && t.bridge !== 'no';
  const ends = r => [r.g[0], r.g[r.g.length - 1]];
  function onOther(x, z, self) { // on another street/path: one passing under the bridge, or a bridge running alongside it
    const L = rgrid.get(gkey(Math.floor(x / RG), Math.floor(z / RG))); if (!L) return false;
    for (const s of L) {
      if (s.r === self) continue;
      const side = isBridge(s.r.t) && !ends(s.r).some(p => ends(self).some(q => same(p, q))); // parallel deck, not this bridge's continuation
      if (segDist(x, z, s)[0] < s.hw + (side ? 0.8 : 0)) return true;
    }
    return false;
  }
  const railSegs = rails.flatMap(r => r.g.slice(1).map((b, i) => ({ ax: r.g[i][0], az: r.g[i][1], dx: b[0] - r.g[i][0], dz: b[1] - r.g[i][1], l2: (b[0] - r.g[i][0]) ** 2 + (b[1] - r.g[i][1]) ** 2 || 1e-9, bridge: isBridge(r.t) })));
  const nearRail = (x, z) => railSegs.some(s => !s.bridge && Math.abs(x - s.ax) < 60 + Math.abs(s.dx) && Math.abs(z - s.az) < 60 + Math.abs(s.dz) && segDist(x, z, s)[0] < 2);

  // zebra crossings: crossing footways, plus crossing nodes that have no such way
  const crossWays = paths.filter(r => (r.type === 'footway' || r.type === 'path') && (r.t.footway === 'crossing' || r.t.crossing) && !/^(unmarked|no)$/.test(r.t.crossing || '') && r.t['crossing:markings'] !== 'no');
  for (const r of crossWays) dashLine(r.g, cumLen(r.g), 0, 0.5, 0.55, 3, (s, p) => onDrive(p[0], p[1], 0.2));
  const cwPts = crossWays.flatMap(r => r.g);
  for (const c of crossPts) {
    if (cwPts.some(p => Math.abs(p[0] - c[0]) < 4 && Math.abs(p[1] - c[1]) < 4)) continue;
    const r = roadAt(c[0], c[1]); if (!r.drv || r.de > -0.5) continue;
    const L = Math.sqrt(r.drv.l2), ux = r.drv.dx / L, uz = r.drv.dz / L, hw = r.drv.hw - 0.5;
    for (let a = -hw; a + 0.5 <= hw; a += 1.05) {
      const b = a + 0.5, P = (o, l) => [c[0] - uz * o + ux * l, c[1] + ux * o + uz * l];
      quad(BUF.marks, P(a, -1.5), P(b, -1.5), P(b, 1.5), P(a, 1.5), LAYERS.marks[1]);
    }
  }
  // railways: ballast, sleepers and rails (trams: rails only); rail bridges are left out where they pass over a street
  for (const r of rails) {
    const bridge = isBridge(r.t);
    for (const part of bridge ? runs(densify(r.g, 2), (x, z) => !onDrive(x, z, -0.5)) : [r.g]) {
      if (!r.tram) { ribbon(BUF.ballast, part, 1.7, LAYERS.ballast[1], false); dashLine(part, cumLen(part), 0, 0.26, 0.39, 2.6, () => true, BUF.sleeper, LAYERS.sleeper[1]); }
      for (const o of [0.72, -0.72]) ribbon(BUF.rail, offsetLine(part, o), 0.04, LAYERS.rail[1], false);
    }
  }
  for (const k in LAYERS) if (BUF[k].p.length) scene.add(flatMesh(BUF[k], LAYERS[k][0], k === 'road' || k === 'parking' ? 7 : k === 'water' ? 20 : 5));

  const mkMesh = (B, mat, uv, shadow = true) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m;
  };
  // ---- walls, fences, hedges, bridge railings ----
  {
    const SB = { p: [], n: [], c: [], uv: [] }, FB = { p: [], n: [], c: [], uv: [] };
    const BAR = { wall: [1.8, 0.3, '#b9ae9c'], retaining_wall: [1.1, 0.4, '#a29e95'], city_wall: [5, 1.6, '#a99f8c'], hedge: [1.4, 0.9, '#4f6b33'], guard_rail: [0.75, 0.06, '#a8acb0'], fence: [1.5, 0, '#5d6160'] };
    for (const { g, t } of barriers) {
      const d = BAR[t.barrier]; if (!d) continue;
      const h = Math.min(num(t.height) || d[0], 12), c = tagColor(t.colour) || matColor(WALL_MAT, t.material) || new THREE.Color(/wood/.test((t.fence_type || '') + (t.material || '')) ? '#7a5c40' : d[2]);
      for (const part of runs(densify(g, 3), (x, z) => !onDrive(x, z, -0.3))) { // gates and mapping slips stay off the roads
        if (t.barrier === 'fence') fenceStrip(FB, part, 0, h, c);
        else if (t.barrier === 'guard_rail') wallStrip(SB, part, d[1], 0.45, 0.75, c);
        else wallStrip(SB, part, d[1], 0, h, c);
      }
    }
    const railCol = new THREE.Color('#6b6f72');
    for (const r of roads.concat(paths)) if (isBridge(r.t) && r.type !== 'pier') {
      const off = r.hw + (r.walk ? 2.2 : 0) + 0.1;
      for (const sg of [1, -1]) for (const part of runs(densify(offsetLine(r.g, sg * off), 2), (x, z) => !onOther(x, z, r) && !nearRail(x, z))) fenceStrip(FB, part, 0, 1.1, railCol);
    }
    const fenceTex = makeTex(64, 64, (x) => { x.clearRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 6); x.fillRect(0, 52, 64, 5); for (let i = 0; i < 64; i += 8) x.fillRect(i + 3, 0, 2, 64); });
    if (SB.p.length) mkMesh(SB, new THREE.MeshStandardMaterial({ map: noise, vertexColors: true, roughness: 0.95 }), true);
    if (FB.p.length) mkMesh(FB, new THREE.MeshStandardMaterial({ map: fenceTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3 }), true);
  }
  // area lookup grid: parking/paving count as hard ground for the car; trees keep off these, water and pitches
  const AG = 25, agrid = new Map(), LIM2 = HALF + 80, aPolys = polys.filter(p => ['parking', 'paving', 'water', 'pitch'].includes(p.kind)).concat(seas.map(s => ({ kind: 'water', ...s })));
  aPolys.forEach((p, i) => { const b = p.bb = bbox(p.outer); for (let ix = Math.floor(Math.max(b.x0, -LIM2) / AG); ix <= Math.floor(Math.min(b.x1, LIM2) / AG); ix++) for (let iz = Math.floor(Math.max(b.z0, -LIM2) / AG); iz <= Math.floor(Math.min(b.z1, LIM2) / AG); iz++) { const k = gkey(ix, iz); let L = agrid.get(k); if (!L) agrid.set(k, L = []); L.push(i); } });
  function areaAt(x, z, kinds) {
    const L = agrid.get(gkey(Math.floor(x / AG), Math.floor(z / AG))); if (!L) return null;
    for (const i of L) { const p = aPolys[i], b = p.bb; if (!kinds.includes(p.kind) || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue; if (inPoly(x, z, p.outer) && !p.holes.some(h => inPoly(x, z, h))) return p.kind; }
    return null;
  }
  const HARD = ['parking', 'paving'], NOTREE = ['parking', 'paving', 'water', 'pitch'];

  // ---- buildings ----
  // Walls and roofs are generated per footprint. A pitched roof (roof:shape, or the house default) is the lower
  // envelope of a few planes over the footprint's oriented bounding box: walls rise to that roof line, which makes
  // gable ends on their own, and each plane's roof face is the footprint clipped to where that plane is the lowest.
  const nB = polys.filter(p => p.kind === 'building').length;
  await say('Raising ' + nB.toLocaleString() + ' buildings…');
  const bPolys = polys.filter(p => p.kind === 'building' || p.kind === 'part');
  // outlines with building:part pieces inside are drawn as those parts only (OSM simple 3D buildings)
  const PG = 20, pgrid = new Map(), hidden = new Set();
  for (const p of bPolys) if (p.kind === 'part') { const q = innerPt(p.outer), k = gkey(Math.floor(q[0] / PG), Math.floor(q[1] / PG)); let L = pgrid.get(k); if (!L) pgrid.set(k, L = []); L.push(q); }
  if (pgrid.size) for (const b of bPolys) if (b.kind === 'building') {
    const B = bbox(b.outer);
    out: for (let ix = Math.floor(B.x0 / PG); ix <= Math.floor(B.x1 / PG); ix++) for (let iz = Math.floor(B.z0 / PG); iz <= Math.floor(B.z1 / PG); iz++) for (const q of pgrid.get(gkey(ix, iz)) || [])
      if (inPoly(q[0], q[1], b.outer) && !b.holes.some(h => inPoly(q[0], q[1], h))) { hidden.add(b); break out; }
  }
  // how mappers here tag roofs decides whether untagged houses get pitched or flat roofs
  let nFlat = 0, nPitch = 0; for (const b of bPolys) { const s = b.t['roof:shape']; if (s) s === 'flat' ? nFlat++ : nPitch++; }
  const flatShare = (nFlat + 1) / (nFlat + nPitch + 2), UP = [0, 1, 0];
  const WB = { p: [], n: [], uv: [], c: [] }, PB = { p: [], n: [], c: [] }, RB = { p: [], n: [], c: [] }, blds = [];
  const roofF = (pl, p) => { let m = 1e9; for (const P of pl) { const f = P[0] + P[1] * p[0] + P[2] * p[1]; if (f < m) m = f; } return Math.max(0, m); };
  const wallQuad = (B, p, q, ya0, yb0, ya1, yb1, n, col, u0, u1) => quad3(B, [p[0], ya0, p[1]], [q[0], yb0, q[1]], [q[0], yb1, q[1]], [p[0], ya1, p[1]], n, col, true, [[u0, 1 - ya0], [u1, 1 - yb0], [u1, 1 - yb1], [u0, 1 - ya1]]);
  function wallRing(r, k, y0, eave, pl, low, col) { // k = ±1 so that k*(dz, -dx) points out of the building
    let u = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 1e-3) continue;
      const n = [k * dz / L, 0, -k * dx / L], ts = [0, 1];
      if (pl) for (let p = 0; p < pl.length; p++) for (let q = p + 1; q < pl.length; q++) { // where the roof line along this wall bends
        const A = pl[p], C = pl[q], ga = A[0] - C[0] + (A[1] - C[1]) * a[0] + (A[2] - C[2]) * a[1], gb = A[0] - C[0] + (A[1] - C[1]) * b[0] + (A[2] - C[2]) * b[1];
        if ((ga > 0) !== (gb > 0)) ts.push(ga / (ga - gb));
      }
      ts.sort((x, y) => x - y);
      for (let j = 0; j < ts.length - 1; j++) {
        if (ts[j + 1] - ts[j] < 1e-6) continue;
        const p0 = [a[0] + dx * ts[j], a[1] + dz * ts[j]], p1 = [a[0] + dx * ts[j + 1], a[1] + dz * ts[j + 1]], u0 = u + L * ts[j], u1 = u + L * ts[j + 1];
        if (eave > y0 + 0.01) wallQuad(low, p0, p1, y0, y0, eave, eave, n, col, u0, u1);
        if (pl) { const h0 = eave + roofF(pl, p0), h1 = eave + roofF(pl, p1); if (h0 > eave + 0.01 || h1 > eave + 0.01) wallQuad(PB, p0, p1, eave, eave, h0, h1, n, col, u0, u1); }
      }
      u += L;
    }
  }
  function roofPlanes(o, shape, H, dir, rnd) { // planes [a, b, c]: roof height above the eaves = min(a + b*x + c*z)
    const { cx, cz, ux, uz, hl, hw } = o, vx = -uz, vz = ux;
    const pl = (nx, nz, half, k) => [k * (nx * cx + nz * cz + half), -k * nx, -k * nz]; // rises with slope k from the box side facing (nx, nz)
    if (shape === 'gabled') return o.across ? [pl(ux, uz, hl, H / hl), pl(-ux, -uz, hl, H / hl)] : [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw)];
    if (shape === 'hipped') return [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw), pl(ux, uz, hl, H / hw), pl(-ux, -uz, hl, H / hw)];
    if (shape === 'pyramidal') return [pl(vx, vz, hw, H / hw), pl(-vx, -vz, hw, H / hw), pl(ux, uz, hl, H / hl), pl(-ux, -uz, hl, H / hl)];
    const S = [[vx, vz, hw], [-vx, -vz, hw], [ux, uz, hl], [-ux, -uz, hl]]; // skillion: low edge on the side roof:direction faces
    let s = S[rnd() < 0.5 ? 0 : 1]; const a = COMPASS[String(dir || '').toUpperCase()] ?? parseFloat(dir);
    if (isFinite(a)) { const dx = Math.sin(a * Math.PI / 180), dz = -Math.cos(a * Math.PI / 180); s = S.reduce((m, q) => q[0] * dx + q[1] * dz > m[0] * dx + m[1] * dz ? q : m); }
    return [pl(s[0], s[1], s[2], H / (2 * s[2]))];
  }
  function dome(o, eave, H, onion, col) {
    const { cx, cz, ux, uz, hl, hw } = o, N = 20, R = onion ? 9 : 7, ring = [];
    for (let r = 0; r <= R; r++) {
      const h = r / R, rho = Math.sqrt(Math.max(0, 1 - h * h)) * (onion ? 1 + 1.4 * h * (1 - h) : 1), pts = [];
      for (let s = 0; s < N; s++) { const a = s / N * Math.PI * 2, lu = Math.cos(a) * hl * rho, lv = Math.sin(a) * hw * rho; pts.push([cx + lu * ux - lv * uz, eave + h * H, cz + lu * uz + lv * ux]); }
      ring.push(pts);
    }
    for (let r = 0; r < R; r++) for (let s = 0; s < N; s++) {
      const a = ring[r][s], b = ring[r][(s + 1) % N], c = ring[r + 1][(s + 1) % N], d = ring[r + 1][s];
      const e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], f = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      let n = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]]; const l = Math.hypot(...n); if (l < 1e-9) continue;
      const out = (a[0] - cx) * n[0] + (a[1] - eave) * n[1] + (a[2] - cz) * n[2] < 0 ? -1 : 1; n = n.map(v => v * out / l);
      quad3(RB, a, b, c, d, n, col);
    }
  }
  for (const b of bPolys) {
    if (hidden.has(b)) continue;
    const t = b.t, rnd = seeded(b.id || b.outer[0][0] * 1000 + b.outer[0][1]), pick = a => a[Math.floor(rnd() * a.length)];
    const outer = openRing(b.outer), holes = b.holes.map(openRing).filter(h => h.length >= 3);
    if (outer.length < 3) continue;
    const area = Math.abs(signedArea(outer)); if (area < 1) continue;
    const bp = t['building:part'], type = t.building && t.building !== 'yes' ? t.building : bp && bp !== 'yes' ? bp : b.kind === 'part' ? 'part' : 'yes';
    const lv = num(t['building:levels']), H = num(t.height), minH = num(t.min_height) || num(t['building:min_level']) * 3.1 || (type === 'roof' ? 3 : 0);
    let shape = ROOF_SHAPE[t['roof:shape']] || 'auto', o = null, roofH = 0;
    const tagged = shape !== 'auto';
    if (!tagged) shape = b.kind === 'building' && !H && lv <= 4 && area < 600 && ((HOUSE_T.has(type) && flatShare < 0.75) || (['yes', 'residential'].includes(type) && area < 220 && lv <= 3 && flatShare < 0.55)) ? (rnd() < 0.55 ? 'gabled' : 'hipped') : 'flat';
    if (shape !== 'flat') {
      o = holes.length || outer.length > 80 ? null : obb(outer);
      if (!o || area / o.ar < (tagged ? 0.62 : 0.78) || o.hw < 1 || (!tagged && o.hw > 9)) shape = 'flat';
    }
    if (shape !== 'flat') {
      o.across = shape === 'gabled' && t['roof:orientation'] === 'across';
      const span = o.across ? o.hl : o.hw, ang = num(t['roof:angle']) || (span > 9 ? 18 + rnd() * 8 : 30 + rnd() * 12);
      roofH = num(t['roof:height']) || num(t['roof:levels']) * 2.6 || (shape === 'skillion' ? span * 0.4 : shape === 'dome' ? span : shape === 'onion' ? span * 1.9 : span * Math.tan(ang * Math.PI / 180));
      roofH = Math.min(roofH, shape === 'dome' || shape === 'onion' ? 60 : 16);
    }
    let eave;
    if (H) { eave = H - roofH; if (eave < minH + 1.5) { roofH = Math.max(0, H - minH - 1.5); eave = H - roofH; } }
    else if (lv) eave = lv * 3.1 + (minH ? 0 : 0.5) + (shape === 'flat' ? num(t['roof:levels']) * 1.6 : 0);
    else eave = bDefaultH(type, rnd) * (shape === 'flat' ? 1 : 0.72);
    eave = Math.max(eave, minH + (shape === 'flat' ? 0.5 : 1.5));
    if (roofH < 0.3) shape = 'flat';
    const wc = tagColor(t['building:colour']) || matColor(WALL_MAT, t['building:material']) || new THREE.Color(pick(WALLS));
    const rc = tagColor(t['roof:colour']) || matColor(ROOF_MAT, t['roof:material']) || new THREE.Color(pick(shape === 'dome' || shape === 'onion' ? DOMES : shape === 'flat' ? ROOFS : PITCHED));
    const low = PLAIN_T.has(type) || area < 12 ? PB : WB, k = signedArea(outer) > 0 ? 1 : -1;
    if (shape === 'flat') {
      wallRing(outer, k, minH, eave, null, low, wc);
      for (const h of holes) wallRing(h, signedArea(h) > 0 ? -1 : 1, minH, eave, null, low, wc);
      eachTri(outer, holes, (A, B, C) => tri3(RB, [A[0], eave, A[1]], [B[0], eave, B[1]], [C[0], eave, C[1]], UP, rc));
    } else if (shape === 'dome' || shape === 'onion') {
      wallRing(outer, k, minH, eave, null, low, wc);
      eachTri(outer, [], (A, B, C) => tri3(RB, [A[0], eave, A[1]], [B[0], eave, B[1]], [C[0], eave, C[1]], UP, rc));
      dome(o, eave, roofH, shape === 'onion', rc);
    } else {
      const pl = roofPlanes(o, shape, roofH, t['roof:direction'], rnd);
      wallRing(outer, k, minH, eave, pl, low, wc);
      for (let i = 0; i < pl.length; i++) {
        let poly = outer;
        for (let j = 0; j < pl.length && poly.length >= 3; j++) if (j !== i) poly = clipHalf(poly, pl[i][0] - pl[j][0], pl[i][1] - pl[j][1], pl[i][2] - pl[j][2]);
        if (poly.length < 3) continue;
        const P = pl[i], l = Math.hypot(P[1], 1, P[2]), n = [-P[1] / l, 1 / l, -P[2] / l], lift = p => [p[0], eave + roofF([P], p), p[1]];
        eachTri(poly, [], (A, B, C) => tri3(RB, lift(A), lift(B), lift(C), n, rc));
      }
    }
    blds.push({ outer: b.outer, holes: b.holes, h: eave + roofH, minH, ...bbox(b.outer) });
  }
  const winDay = makeTex(512, 512, (x) => { x.fillStyle = '#ffffff'; x.fillRect(0, 0, 512, 512); speckle(x, 512, 512, 14000, 0.1); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = '#7c8996'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); x.fillStyle = 'rgba(255,255,255,.22)'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 9); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(i * 64 + 31, j * 64 + 16, 2, 28); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(i * 64 + 18, j * 64 + 44, 28, 3); } });
  const winNight = makeTex(512, 512, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512); for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if (Math.random() < 0.32) { x.fillStyle = Math.random() < 0.7 ? '#ffd9a0' : '#cfe0ff'; x.fillRect(i * 64 + 20, j * 64 + 16, 24, 28); } });
  for (const t of [winDay, winNight]) { t.repeat.set(1 / 24, 1 / 24.8); t.offset.set(0, -1 / 24.8); }
  const wallMat = new THREE.MeshStandardMaterial({ map: winDay, vertexColors: true, roughness: 0.85, emissiveMap: winNight, emissive: 0xffffff, emissiveIntensity: 0 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  if (WB.p.length) mkMesh(WB, wallMat, true);
  if (PB.p.length) mkMesh(PB, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), false);
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
  const clear = (x, z) => { const r = roadAt(x, z); return !(r.any && r.ae < 1.2) && !inBuilding(x, z, 1) && !areaAt(x, z, NOTREE) && !nearRail(x, z); };
  const roomy = (x, z) => !inBuilding(x + 3, z, 1) && !inBuilding(x - 3, z, 1) && !inBuilding(x, z + 3, 1) && !inBuilding(x, z - 3, 1) && !(roadAt(x, z).ae < 2.5);
  for (const p of treePts) if (within(p[0], p[1])) trees.push([p[0], p[1], 0.8 + Math.random() * 0.5, 0]);
  for (const g of rows) for (let i = 0; i < g.length - 1; i++) { const a = g[i], b = g[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += 8) { const x = a[0] + (b[0] - a[0]) * s / L, z = a[1] + (b[1] - a[1]) * s / L; if (within(x, z)) trees.push([x, z, 0.8 + Math.random() * 0.4, 0]); } }
  const DENS = { forest: 45, scrub: 300, park: 220, resid: 650 }; // m² per tree; residential land gets scattered garden trees
  for (const p of polys.filter(p => DENS[p.kind]).sort((a, b) => (a.kind === 'resid') - (b.kind === 'resid'))) {
    if (trees.length > 7000) break;
    const B = bbox(p.outer), x0 = Math.max(B.x0, -LIM), x1 = Math.min(B.x1, LIM), z0 = Math.max(B.z0, -LIM), z1 = Math.min(B.z1, LIM);
    if (x1 <= x0 || z1 <= z0) continue;
    const fill = polyArea(p.outer) / Math.max(1, (B.x1 - B.x0) * (B.z1 - B.z0)), resid = p.kind === 'resid';
    const n = Math.min(2500, Math.round((x1 - x0) * (z1 - z0) * fill / DENS[p.kind]));
    for (let i = 0; i < n * 1.5 && trees.length < 7500; i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
      if (!inPoly(x, z, p.outer) || p.holes.some(h => inPoly(x, z, h)) || !clear(x, z) || (resid && !roomy(x, z))) continue;
      trees.push([x, z, resid ? 0.6 + Math.random() * 0.5 : 0.7 + Math.random() * 0.7, (p.kind === 'forest' ? 0.45 : resid ? 0.15 : 0) > Math.random() ? 1 : 0]);
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

  // ---- street lamps: posts along the streets; from dusk their heads glow and they throw pools of light ----
  const glowTex = makeTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  glowTex.wrapS = glowTex.wrapT = THREE.ClampToEdgeWrapping;
  const lamps = [], LG = 12, lgrid = new Map();
  const lampFree = (x, z) => { const i = Math.floor(x / LG), j = Math.floor(z / LG); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of lgrid.get(gkey(i + a, j + b)) || []) if (Math.hypot(p[0] - x, p[1] - z) < 12) return false; return true; };
  for (const r of roads) {
    if (['service', 'track', 'raceway', 'busway'].includes(r.type) || r.hw < 2.6) continue;
    const cum = cumLen(r.g), total = cum[cum.length - 1], wide = r.hw >= 4.5; let seg = 0, k = 0;
    for (let s = 10; s < total - 4 && lamps.length < 2500; s += wide ? 26 : 34, k++) {
      while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
      const a = r.g[seg], b = r.g[seg + 1], L = cum[seg + 1] - cum[seg] || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, f = s - cum[seg];
      const side = wide && k % 2 ? -1 : 1, nx = -dz * side, nz = dx * side, off = r.hw + (r.walk ? 0.9 : 0.45); // wide streets: staggered on both sides
      const x = a[0] + dx * f + nx * off, z = a[1] + dz * f + nz * off;
      if (Math.abs(x) > HALF + 40 || Math.abs(z) > HALF + 40 || onDrive(x, z, -0.4) || inBuilding(x, z, 1) || (!isBridge(r.t) && areaAt(x, z, ['water'])) || !lampFree(x, z)) continue;
      lamps.push([x, z, -nx, -nz]); const kk2 = gkey(Math.floor(x / LG), Math.floor(z / LG)); let Lc = lgrid.get(kk2); if (!Lc) lgrid.set(kk2, Lc = []); Lc.push([x, z]);
    }
  }
  let setLamps = () => { };
  if (lamps.length) {
    const nL = lamps.length, metal = new THREE.MeshStandardMaterial({ color: 0x4a4e52, roughness: 0.5, metalness: 0.6 });
    const lampHead = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.4, emissive: 0xffd9a0, emissiveIntensity: 0 });
    const parts = [[new THREE.CylinderGeometry(0.06, 0.1, 7.4, 6).translate(0, 3.7, 0), metal], [new THREE.BoxGeometry(1.6, 0.09, 0.09).translate(0.8, 7.3, 0), metal], [new THREE.BoxGeometry(0.6, 0.13, 0.28).translate(1.5, 7.22, 0), lampHead]].map(([g, m]) => new THREE.InstancedMesh(g, m, nL));
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffaa4c, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), nL);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), one = V(1, 1, 1), pool = V(15, 1, 15), Y = V(0, 1, 0), I = new THREE.Quaternion(), gp = new Float32Array(nL * 3);
    lamps.forEach(([x, z, ax, az], i) => {
      Q.setFromAxisAngle(Y, Math.atan2(-az, ax)); M.compose(V(x, 0, z), Q, one); for (const m of parts) m.setMatrixAt(i, M); // arm points along (ax, az), over the road
      const hx = x + ax * 1.5, hz = z + az * 1.5; M.compose(V(hx, 0.075, hz), I, pool); pools.setMatrixAt(i, M); gp.set([hx, 7.08, hz], i * 3);
    });
    parts.forEach((m, i) => { m.castShadow = i < 2; m.receiveShadow = true; scene.add(m); });
    const glows = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(gp, 3)), new THREE.PointsMaterial({ map: glowTex, color: 0xffd39a, size: 2.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pools.renderOrder = 1; scene.add(pools, glows);
    setLamps = on => { lampHead.emissiveIntensity = on ? 3.5 : 0; pools.visible = glows.visible = on; };
  }

  // ---- car ----
  await say('Placing the car…');
  const CAR = localStorage.getItem(LS_CAR) === 'vaz' ? await loadVaz().catch(e => (console.warn('VAZ-2101 did not load, using the sedan', e), buildCar())) : buildCar(), car = CAR.car;
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
  // glows on the head and tail lights while they are on
  const glowMat = c => new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const headGlow = glowMat(0xfff1dc), tailGlow = glowMat(0xff2a1a), tails = [];
  for (const l of CAR.lights.low) { const s = new THREE.Sprite(headGlow); s.position.copy(l.position).add(V(0.12, 0, 0)); s.scale.setScalar(1.1); car.add(s); }
  car.updateMatrixWorld(true); car.traverse(o => { if (o.isMesh && o.name === 'tail_brake') tails.push(new THREE.Box3().setFromObject(o).getCenter(V())); });
  for (const c of tails) { const s = new THREE.Sprite(tailGlow); s.position.copy(car.worldToLocal(c)).add(V(-0.1, 0, 0)); s.scale.setScalar(0.6); car.add(s); }

  const wheels =['front_R', 'front_L', 'rear_R', 'rear_L'].map(k => { const w = car.getObjectByName('wheel_' + k); return w && { w, front: k.startsWith('front'), side: k.endsWith('R') ? 1 : -1, base: w.rotation.y }; }).filter(Boolean);
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
  const msgEl = $('msg'); let msgTimer;
  function flash(t) { msgEl.textContent = t; msgEl.style.opacity = 1; clearTimeout(msgTimer); msgTimer = setTimeout(() => msgEl.style.opacity = 0, 2200); }

  // ---- time of day ----
  let tIdx = 0, dayIdx = 0, lowLight = false, skyT = null, envRT = null;
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
    hemi.color.copy(hor).lerp(zen, 0.25); hemi.groundColor.copy(gnd); hemi.intensity = night ? 0.1 : 0.22 + 0.33 * ss(e, -6, 15); // sky fill kept well below the sun so shadows read
    if (skyT) skyT.dispose(); if (envRT) envRT.dispose();
    skyT = drawSky(sd, e, night); envRT = pm.fromEquirectangular(skyT);
    scene.background = skyT; scene.environment = envRT.texture; scene.environmentIntensity = night ? 0.3 : 0.35 + 0.45 * ss(e, -6, 12);
    scene.fog.color.copy(hor); scene.fog.near = night ? 80 : 110 + 50 * ss(e, -3, 10); scene.fog.far = night ? 650 : 760 + 190 * ss(e, -3, 10);
    renderer.toneMappingExposure = night ? 1.1 : e < 0 ? 1.25 : 1 + 0.08 * warm;
    wallMat.emissiveIntensity = night ? 1.6 : e < 0 ? 0.9 : 0;
    setLamps(lowLight);
    if (lowLight) head = true;
    setLights();
    $('tod').textContent = name + ' · ' + clock(h);
    if (announce) flash(name + ' · ' + clock(h));
  }
  { // start in daylight: whichever of morning / midday / afternoon has the sun nearest 32° up (low winter sun, high summer sun)
    const el = i => Math.asin(sunAt(TIMES[i][1]).y) * 180 / Math.PI;
    applyTime([2, 1, 0].reduce((b, i) => Math.abs(el(i) - 32) < Math.abs(el(b) - 32) ? i : b));
  }
  const corners = [[2.2, 0.86], [2.2, -0.86], [0, 0.88], [0, -0.88], [-2.18, 0.86], [-2.18, -0.86]];
  function blocked(x, z, h) {
    const c = Math.cos(h), s = Math.sin(h);
    for (const [lx, lz] of corners) { const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c; if (Math.abs(wx) > HALF || Math.abs(wz) > HALF) return 'edge'; if (inBuilding(wx, wz, 0.6)) return 'bld'; }
    return null;
  }

  function update(dt) {
    const up = keys.KeyW || keys.ArrowUp, dn = keys.KeyS || keys.ArrowDown, lf = keys.KeyA || keys.ArrowLeft, rt = keys.KeyD || keys.ArrowRight, hb = keys.Space;
    const ra = roadAt(st.pos.x, st.pos.z), onRoad = ra.drv && ra.de < 0.6, onHard = onRoad || (ra.any && ra.ae < 2.4) || (ra.drv && ra.de < 2.4) || !!areaAt(st.pos.x, st.pos.z, HARD);
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
    headGlow.opacity = head ? (lowLight ? 0.85 : 0.25) : 0; tailGlow.opacity = s.braking ? (lowLight ? 0.9 : 0.4) : head && lowLight ? 0.35 : 0;
  }
  const look = V(), want = V(), shC = V(), lx = V(), ly = V();
  function placeShadow() { // centre the shadow box ahead of the car, snapped to whole shadow-map texels so edges don't crawl
    shC.set(st.pos.x + Math.cos(st.h) * 45, 0, st.pos.z - Math.sin(st.h) * 45);
    lx.crossVectors(UPV, lightDir); if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0); lx.normalize(); ly.crossVectors(lightDir, lx);
    const tx = 2 * SH_R / SH_MAP, a = Math.round(shC.dot(lx) / tx) * tx, b = Math.round(shC.dot(ly) / tx) * tx, c = shC.dot(lightDir);
    shC.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lightDir, c);
    sun.target.position.copy(shC); sun.position.copy(shC).addScaledVector(lightDir, 400);
  }
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
    placeShadow();
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
  const shownName = placeName || (start && start.name) || lat0.toFixed(4) + ', ' + lon0.toFixed(4); // no address found: the street you start on
  $('place').textContent = shownName;
  $('stats').textContent = roads.length.toLocaleString() + ' streets · ' + nB.toLocaleString() + ' buildings · ' + trees.length.toLocaleString() + ' trees';
  $('startPlace').textContent = shownName;
  if (!start) $('startNote').textContent = 'No drivable roads were found here. You can still drive on the ground, or press M to pick another place.';
  if (fallback) {
    $('startNote').textContent = ($('startNote').textContent + ' The OpenStreetMap servers are busy, so this is a simplified map from OpenFreeMap: no roof shapes, walls, crossings or single trees. Pick the place again later for full detail.').trim();
    $('stats').textContent += ' · simplified map'; $('attrib').textContent += ' · ' + FALLBACK_CREDIT;
  }

  load.style.display = 'none';
  $('hud').style.display = 'block';
  const startEl = $('start'); startEl.style.display = 'flex';
  function begin() { if (started) return; started = true; startEl.style.display = 'none'; setTimeout(() => $('keys').style.opacity = 0, 7000); }
  startEl.addEventListener('click', begin);
  $('changePlace').addEventListener('click', backToMap);
  const tune = radio(flash, () => stationsNear(lat0, lon0, fetch));
  addEventListener('keydown', e => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyM') { backToMap(); return; }
    if (!started) begin();
    keys[e.code] = true; if (e.repeat) return;
    if (e.code === 'KeyH') { head = !head; setLights(); }
    if (e.code === 'KeyN') applyTime(tIdx === NIGHT ? dayIdx : NIGHT, true);
    if (e.code === 'KeyT') applyTime((tIdx + 1) % TIMES.length, true);
    if (e.code === 'KeyC') camMode = 1 - camMode;
    if (e.code === 'KeyQ') tune(e.shiftKey ? -1 : 1);
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
