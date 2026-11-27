import * as THREE from 'three';
import { buildCar } from './sedan-model.js';
import { readKeys, rigCar, step, syncCar, chaseCamera, speedHud } from './drive-core.js';
import { radio, radioHud } from './radio.js';
import { drivingAudio } from './driving-audio.js';
import { touchControls } from './touch.js';
import { toasts } from './toast.js';
import { showAppVersion } from './app-version.js';

showAppVersion();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const C = buildCar(), rig = rigCar(C), car = C.car;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 4000);
scene.add(car);

// ---------- Sky + environment ----------
function skyTex(night) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  if (!night) { g.addColorStop(0, '#2c5f a6'.replace(' ', '')); g.addColorStop(0.4, '#8fb9de'); g.addColorStop(0.5, '#dfe9ef'); g.addColorStop(0.505, '#7b8868'); g.addColorStop(1, '#2d3823'); }
  else { g.addColorStop(0, '#04060b'); g.addColorStop(0.44, '#0d1422'); g.addColorStop(0.5, '#1a2131'); g.addColorStop(0.505, '#0a0c09'); g.addColorStop(1, '#040504'); }
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  if (!night) { const s = x.createRadialGradient(300, 140, 0, 300, 140, 70); s.addColorStop(0, 'rgba(255,255,248,1)'); s.addColorStop(0.12, 'rgba(255,250,232,.95)'); s.addColorStop(1, 'rgba(255,240,210,0)'); x.fillStyle = s; x.fillRect(200, 40, 200, 200);
    x.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 40; i++) { const cx = Math.random() * 1024, cy = 150 + Math.random() * 80; for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse(cx + k * 14, cy + Math.random() * 6, 22, 7, 0, 0, Math.PI * 2); x.fill(); } } }
  else for (let i = 0; i < 700; i++) { x.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.85 + ')'; x.fillRect(Math.random() * 1024, Math.random() * 230, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const pm = new THREE.PMREMGenerator(renderer);
const SKY = { day: skyTex(false), night: skyTex(true) };
const ENV = { day: pm.fromEquirectangular(SKY.day).texture, night: pm.fromEquirectangular(SKY.night).texture };
const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x4d5d36, 0.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 120 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
const SUN_OFF = V(28, 42, -18);
scene.fog = new THREE.Fog(0xdfe9ef, 140, 1300);

const noiseTex = (base, spread, rep, size = 256) => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 3; i++) { const v = (Math.random() - 0.5) * spread; x.fillStyle = v > 0 ? 'rgba(255,255,255,' + v + ')' : 'rgba(0,0,0,' + (-v) + ')'; x.fillRect(Math.random() * size, Math.random() * size, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
const ground = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ map: noiseTex('#5c7a3b', 0.25, 700), roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

// ---------- Track ----------
const ctrl = []; for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, r = 235 + 72 * Math.sin(3 * a + 0.6) + 34 * Math.cos(5 * a); ctrl.push(V(Math.cos(a) * r * 1.15, 0, Math.sin(a) * r)); }
const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
const N = 1800, pts = curve.getSpacedPoints(N); pts.pop();
const T = pts.map((p, i) => pts[(i + 1) % N].clone().sub(pts[(i - 1 + N) % N]).normalize());
const Rt = T.map(t => V(-t.z, 0, t.x)); // right-hand side of travel
const HW = 5.2;
function strip(hw, y, mat, uvLen, rough) {
  const pos = [], uv = [], nor = [], idx = []; let d = 0;
  for (let i = 0; i <= N; i++) { const k = i % N, p = pts[k], r = Rt[k]; if (i) d += pts[k].distanceTo(pts[i - 1]);
    pos.push(p.x + r.x * hw, y, p.z + r.z * hw, p.x - r.x * hw, y, p.z - r.z * hw); uv.push(1, d / uvLen, 0, d / uvLen); nor.push(0, 1, 0, 0, 1, 0);
    if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); return m;
}
const roadTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const x = c.getContext('2d');
  x.fillStyle = '#3b3c3e'; x.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 60000; i++) { const v = Math.random(); x.fillStyle = v > 0.5 ? 'rgba(255,255,255,' + (v - 0.5) * 0.16 + ')' : 'rgba(0,0,0,' + v * 0.22 + ')'; x.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2); }
  x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(58, 0, 34, 1024); x.fillRect(164, 0, 34, 1024); // tyre wear
  x.fillStyle = '#e9e7df'; x.fillRect(10, 0, 6, 1024); x.fillRect(240, 0, 6, 1024);
  x.fillRect(125, 0, 6, 340);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; })();
strip(HW + 1.6, 0.008, new THREE.MeshStandardMaterial({ map: noiseTex('#8a8070', 0.35, 1, 128), roughness: 1 }), 3);
strip(HW, 0.016, new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0 }), 24);

// start / finish line + gantry
{ const c = document.createElement('canvas'); c.width = 16; c.height = 2; const x = c.getContext('2d'); for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; x.fillRect(i, j, 1, 1); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  const p = pts[0], h = Math.atan2(-T[0].z, T[0].x);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.4, HW * 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
  line.rotation.set(-Math.PI / 2, 0, h); line.position.set(p.x, 0.02, p.z); line.receiveShadow = true; scene.add(line);
  const G = new THREE.Group(); G.position.copy(p); G.rotation.y = h; scene.add(G);
  const gm = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.6 });
  for (const s of [1, -1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.2, 0.35), gm); post.position.set(0, 3.1, s * (HW + 1.2)); post.castShadow = true; G.add(post); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, (HW + 1.4) * 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 })); beam.position.y = 6.2; beam.castShadow = true; G.add(beam); }

// edge posts
{ const g = new THREE.BoxGeometry(0.14, 1.0, 0.14).translate(0, 0.5, 0), m = new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.5 });
  const k = Math.floor(N / 22), im = new THREE.InstancedMesh(g, m, k * 2), M = new THREE.Matrix4(); let n = 0;
  for (let i = 0; i < k; i++) { const j = i * 22, p = pts[j], r = Rt[j]; for (const s of [1, -1]) { M.makeTranslation(p.x + r.x * s * (HW + 2.2), 0, p.z + r.z * s * (HW + 2.2)); im.setMatrixAt(n++, M); } }
  im.castShadow = true; scene.add(im);
  const rg = new THREE.BoxGeometry(0.15, 0.12, 0.15).translate(0, 0.82, 0), rm = new THREE.MeshStandardMaterial({ color: 0xd2a21e, emissive: 0x3a2800, roughness: 0.3 }), ri = new THREE.InstancedMesh(rg, rm, k * 2);
  for (let i = 0; i < k * 2; i++) { im.getMatrixAt(i, M); ri.setMatrixAt(i, M); } scene.add(ri); }

// trees, rocks, hills
const distToRoad = (x, z) => { let d = 1e9; for (let i = 0; i < N; i += 6) { const p = pts[i], dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < d) d = dd; } return Math.sqrt(d); };
{ const trunkG = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7).translate(0, 1.1, 0);
  const pineG = new THREE.ConeGeometry(1.9, 5.2, 8).translate(0, 4.4, 0);
  const pine2 = new THREE.ConeGeometry(1.4, 3.6, 8).translate(0, 6.2, 0);
  const roundG = new THREE.IcosahedronGeometry(2.1, 1).translate(0, 3.6, 0);
  const tm = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 0.95 }), lm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
  const COUNT = 900, trunks = new THREE.InstancedMesh(trunkG, tm, COUNT), pines = new THREE.InstancedMesh(pineG, lm, COUNT), tops = new THREE.InstancedMesh(pine2, lm, COUNT), rounds = new THREE.InstancedMesh(roundG, lm, COUNT);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = V(1, 1, 1), col = new THREE.Color(); let nP = 0, nR = 0, n = 0, tries = 0;
  while (n < COUNT && tries++ < 20000) {
    const x = (Math.random() - 0.5) * 1100, z = (Math.random() - 0.5) * 900, d = distToRoad(x, z);
    if (d < HW + 9) continue; if (d > 60 && Math.random() < 0.55) continue;
    const s = 0.7 + Math.random() * 0.8; Q.setFromAxisAngle(V(0, 1, 0), Math.random() * 6.28); S.set(s, s * (0.85 + Math.random() * 0.4), s);
    M.compose(V(x, 0, z), Q, S); trunks.setMatrixAt(n, M);
    col.setHSL(0.25 + Math.random() * 0.08, 0.35 + Math.random() * 0.2, 0.2 + Math.random() * 0.1);
    if (Math.random() < 0.6) { pines.setMatrixAt(nP, M); tops.setMatrixAt(nP, M); pines.setColorAt(nP, col); tops.setColorAt(nP, col); nP++; }
    else { rounds.setMatrixAt(nR, M); col.offsetHSL(-0.03, 0, 0.05); rounds.setColorAt(nR, col); nR++; }
    n++;
  }
  trunks.count = n; pines.count = tops.count = nP; rounds.count = nR;
  for (const m of [trunks, pines, tops, rounds]) { m.castShadow = true; scene.add(m); }
  const hm = new THREE.MeshStandardMaterial({ color: 0x55703f, roughness: 1, flatShading: true });
  for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2 + Math.random() * 0.2, r = 1000 + Math.random() * 500, s = 110 + Math.random() * 160;
    const h = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), hm); h.scale.set(s, s * (0.3 + Math.random() * 0.35), s * (0.8 + Math.random() * 0.5)); h.position.set(Math.cos(a) * r, -s * 0.05, Math.sin(a) * r); scene.add(h); } }

// soft contact shadow that travels with the car
{ const blob = (inner, a) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 64 * inner, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
  const mk = (tex, w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); m.renderOrder = 2; car.add(m); };
  mk(blob(0.35, 0.6), 5.0, 2.1, -0.05, 0); const tb = blob(0.1, 0.8); for (const x of [1.32, -1.31]) for (const z of [0.735, -0.735]) mk(tb, 0.55, 0.34, x, z); }

// ---------- Driving ----------
const st = { pos: V(), h: 0, v: 0, steer: 0, spin: 0, roll: 0, pitch: 0, idx: 0 };
const keys = {};
let started = false, camMode = 0, head = false, night = false;
const cam = chaseCamera(camera, car);
function placeOnTrack(i, lane = 2.4) { const p = pts[i]; st.pos.copy(p).addScaledVector(Rt[i], lane); st.h = Math.atan2(-T[i].z, T[i].x); st.v = 0; st.steer = 0; st.idx = i;
  cam.reset(st); }
function nearest(p, full) { let best = 1e9, bi = st.idx; const rng = full ? N : 60;
  for (let o = -rng; o <= rng; o++) { const i = ((st.idx + o) % N + N) % N, q = pts[i], d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < best) { best = d; bi = i; } }
  return { i: bi, d: Math.sqrt(best) }; }
placeOnTrack(N - 14);

// laps
const BEST_KEY = 'sedan-drive-best-v1';
let lap = { running: false, t0: 0, n: 0, cps: new Set(), last: null, best: +localStorage.getItem(BEST_KEY) || null };
const fmt = s => s == null ? '–' : Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
const flash = toasts(); // flash(text, tone, key)
let clock = 0;
function lapLogic(prev, cur) {
  const q = N / 4; for (const c of [1, 2, 3]) if (Math.abs(cur - c * q) < 30) lap.cps.add(c);
  if (prev > N - 80 && cur < 80) { // crossed start line forwards
    if (lap.running && lap.cps.size === 3) { const t = clock - lap.t0; lap.last = t; lap.n++;
      if (!lap.best || t < lap.best) { lap.best = t; localStorage.setItem(BEST_KEY, t); flash('New best lap  ' + fmt(t), 'gold'); } else flash('Lap ' + fmt(t)); }
    else if (!lap.running) flash('Go', 'good');
    lap.running = true; lap.t0 = clock; lap.cps.clear();
  }
  if (prev < 80 && cur > N - 80) lap.cps.clear();
}

const TUNE = { power: 7.8, idle: 0.6, vtop: 60 };
function update(dt) {
  const k = readKeys(keys), rough = nearest(st.pos).d > HW + 1.6, prev = st.idx;
  const s = step(st, k, dt, { vmax: rough ? 15 : 52, drag: rough ? 0.9 : 0.02, rough }, TUNE);
  sound.update(st.v, k.up, k.dn, { hb: k.hb, steer: st.steer, slip: st.slip, rough });
  st.idx = nearest(st.pos).i; lapLogic(prev, st.idx);
  if (k.dn && st.v <= 0.2 && Math.abs(st.v) < 0.5) s.reversing = true; // reverse lamp on while holding brake at a standstill
  return s;
}
function setLights() {
  C.headMat.emissiveIntensity = head ? 6 : 0; C.drlMat.emissiveIntensity = head ? 6 : 0;
  C.lights.low.forEach(l => { l.intensity = head ? 260 : 0; l.visible = head; });
  C.lights.high.forEach(l => { l.intensity = head && night ? 900 : 0; l.visible = head && night; });
}
function setNight(n) {
  night = n; scene.background = n ? SKY.night : SKY.day; scene.environment = n ? ENV.night : ENV.day; scene.environmentIntensity = n ? 0.35 : 1;
  sun.intensity = n ? 0.12 : 2.8; sun.color.set(n ? 0x9fb3ff : 0xfff0d8); hemi.intensity = n ? 0.08 : 0.7;
  scene.fog.color.set(n ? 0x1a2131 : 0xdfe9ef); scene.fog.near = n ? 60 : 140; scene.fog.far = n ? 600 : 1300;
  head = n || head; setLights();
}
setNight(false);
function updateCam(dt) {
  cam.update(st, camMode, dt);
  sun.position.copy(st.pos).add(SUN_OFF); sun.target.position.copy(st.pos);
}
const el = id => document.getElementById(id), kmh = el('kmh'), gear = el('gear'), lapT = el('lapT'), lastT = el('lastT'), bestT = el('bestT'), lapN = el('lapN');
function hud(s) {
  speedHud(kmh, gear, st, s);
  lapT.textContent = lap.running ? fmt(clock - lap.t0) : '0:00.0';
  lastT.textContent = fmt(lap.last); bestT.textContent = fmt(lap.best); lapN.textContent = lap.n;
}
const startEl = el('start');
const sound = drivingAudio();
function begin() {
  sound.activate(); if (started) return; started = true; startEl.style.display = 'none'; setTimeout(() => el('keys').style.opacity = 0, 6000);
  touchControls([['Lights', 'KeyH'], ['Night', 'KeyN'], ['Camera', 'KeyC'], ['Horn', 'KeyB'], ['Radio', 'KeyQ'], ['Sound', 'KeyV'], ['Reset', 'KeyR']]);
}
startEl.addEventListener('click', begin);
const tune = radio(radioHud(), undefined, sound.tuningStatic);
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true; if (e.repeat) return;
  begin();
  if (e.code === 'KeyB') sound.horn(true);
  if (e.code === 'KeyH') { head = !head; setLights(); }
  if (e.code === 'KeyN') setNight(!night);
  if (e.code === 'KeyC') camMode = 1 - camMode;
  if (e.code === 'KeyQ') tune(e.shiftKey ? -1 : 1);
  if (e.code === 'KeyV') flash(sound.toggleMute() ? 'Driving sounds off' : 'Driving sounds on', '', 'sound');
  if (e.code === 'KeyR') { const n = nearest(st.pos, true); st.idx = n.i; placeOnTrack(n.i); }
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'KeyB') sound.horn(false); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; sound.horn(false); });
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
let last = performance.now(), lastS = { braking: false, reversing: false };
renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (started) { clock += dt; lastS = update(dt); }
  syncCar(rig, st, lastS, head); updateCam(dt); hud(lastS);
  renderer.render(scene, camera);
});

