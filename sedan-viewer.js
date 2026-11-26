import { buildCar, FA, RA } from './sedan-model.js';
import { showAppVersion } from './app-version.js';

showAppVersion();
const stage = document.querySelector('three-d-stage');
const { THREE } = await stage.ready;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const renderer = stage._renderer, scene = stage._scene;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

// Studio environment for reflections (softboxes in a grey room)
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x5c5853, side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x2a2826 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1; env.add(floor);
  const box = (w, h, s, p, r) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(s, s, s * 0.97), side: THREE.DoubleSide })); m.position.set(...p); m.rotation.set(...r); env.add(m); };
  box(16, 5, 3.2, [0, 9.5, 0], [Math.PI / 2, 0, 0]);
  box(3, 10, 2.5, [14, 4, 6], [0, -Math.PI / 2, 0]);
  box(3, 10, 2.0, [-14, 4, -6], [0, Math.PI / 2, 0]);
  box(14, 2, 1.6, [0, 3, 19], [0, Math.PI, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.03).texture;
  scene.environmentIntensity = 0.9;
}
{ const under = new THREE.DirectionalLight(0xffffff, 1.1); under.name = 'under_fill'; under.position.set(1, -6, 2); scene.add(under); }
const studioLights = scene.children.filter(o => o.isLight).map(l => ({ l, i: l.intensity }));
const nightGround = new THREE.Mesh(new THREE.CircleGeometry(16, 96), new THREE.MeshStandardMaterial({ color: 0x3b3c3f, roughness: 0.88 }));
nightGround.rotation.x = -Math.PI / 2; nightGround.position.y = 0.001; nightGround.receiveShadow = true; nightGround.visible = false; scene.add(nightGround);

const { car, headMat, tailMat, cbrakeMat, revMat, fogMat, lights, extraLights: [rearGlow, revGlow, domeGlow, turnGlowL, turnGlowR, cabinFill], IN, glass, lensClear, domeMat, gaugeFace, radioDisp, turnL, turnR, drlMat } = buildCar();

stage.setObject(car);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
for (const g of [IN, car.getObjectByName('underbody')]) g.traverse(o => { if (o.isMesh) o.castShadow = false; });
{ // soft contact shadows (ambient occlusion under body and tyres)
  const blob = (inner, a) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 64 * inner, 64, 64, 64); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
  car.updateWorldMatrix(true, true);
  const bb = new THREE.Box3().setFromObject(car), sc = new THREE.Vector3(); car.getWorldScale(sc);
  const mk = (n, tex, w, d, p) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w * sc.x, d * sc.z), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })); m.name = n; m.rotation.x = -Math.PI / 2; m.position.copy(car.localToWorld(p)); m.position.y = bb.min.y + 0.004; m.renderOrder = 1; scene.add(m); };
  mk('contact_shadow_body', blob(0.35, 0.55), 5.0, 2.1, V(-0.05, 0, 0));
  const tb = blob(0.1, 0.8);
  for (const x of [FA, RA]) for (const z of [0.735, -0.735]) mk('contact_shadow_tyre', tb, 0.55, 0.34, V(x, 0, z));
}
car.traverse(o => { if (o.isMesh && o.material === glass || o.material === lensClear) o.castShadow = false; });

// ---------- Controls ----------
const KEY = 'sedan-lights-v1';
const st = Object.assign({ beam: 0, fog: false, brake: false, reverse: false, left: false, right: false, hazard: false, cabin: false, night: false }, JSON.parse(localStorage.getItem(KEY) || '{}'));
const panel = document.getElementById('panel');
function apply() {
  localStorage.setItem(KEY, JSON.stringify(st));
  const n = st.night;
  headMat.emissiveIntensity = st.beam ? (st.beam === 2 ? 9 : 5) : 0;
  drlMat.emissiveIntensity = st.beam ? 6 : 0;
  lights.low.forEach(l => l.intensity = st.beam ? 140 : 0);
  lights.high.forEach(l => l.intensity = st.beam === 2 ? 600 : 0);
  fogMat.emissiveIntensity = st.fog ? 5 : 0; lights.fog.forEach(l => l.intensity = st.fog ? 50 : 0);
  const tail = st.beam || st.fog;
  tailMat.emissiveIntensity = st.brake ? 7 : tail ? 1.8 : 0;
  cbrakeMat.emissiveIntensity = st.brake ? 7 : 0;
  rearGlow.intensity = st.brake ? 1.6 : tail ? 0.5 : 0;
  revMat.emissiveIntensity = st.reverse ? 5 : 0; revGlow.intensity = st.reverse ? 6 : 0;
  [...lights.low, ...lights.high, ...lights.fog, rearGlow, revGlow, domeGlow, cabinFill].forEach(l => l.visible = l.intensity > 0);
  renderer.shadowMap.needsUpdate = true;
  domeMat.emissiveIntensity = st.cabin ? 4 : 0; domeGlow.intensity = st.cabin ? 1.5 : 0;
  studioLights.forEach(({ l, i }) => l.intensity = n ? i * 0.12 : i);
  scene.environmentIntensity = n ? 0.14 : 0.9;
  const note = stage.shadowRoot.querySelector('.note'); if (note) note.style.color = n ? 'rgba(255,255,255,.55)' : '';
  nightGround.visible = n && view !== 'under'; stage._ground.visible = !n;
  gaugeFace.emissiveIntensity = st.beam ? 0.35 : 0; radioDisp.emissiveIntensity = st.beam ? 1.4 : 0.15;
  cabinFill.intensity = n ? 0 : 0.7;
  stage.style.setProperty('--stage-bg', n ? '#0d0f12' : '');
  panel.classList.toggle('night', n);
  document.getElementById('beamLbl').textContent = ['Off', 'Low', 'High'][st.beam];
  panel.querySelectorAll('button:not([data-k=under]):not([data-k=inside])').forEach(b => { const k = b.dataset.k; b.setAttribute('aria-pressed', String(k === 'beam' ? st.beam > 0 : !!st[k])); });
}
function toggle(k) {
  if (k === 'beam') st.beam = (st.beam + 1) % 3;
  else { st[k] = !st[k]; if (k === 'left' && st.left) st.right = false; if (k === 'right' && st.right) st.left = false; }
  apply();
}
let view = 'orbit', saved = null;
function setView(m) {
  const c = stage._camera, ctl = stage._controls;
  if (m === view) m = 'orbit';
  if (view === 'orbit') saved = { p: c.position.clone(), t: ctl.target.clone(), near: c.near };
  else { c.position.copy(saved.p); ctl.target.copy(saved.t); c.near = saved.near; }
  ctl.autoRotate = false; ctl.enableZoom = ctl.enablePan = m !== 'inside';
  if (m === 'under') c.position.copy(ctl.target).add(V(0, -5.6, 0.35));
  if (m === 'inside') { const eye = V(-0.34, 1.26, 0.56), look = V(0.36, 0.84, -0.40); c.position.copy(eye); ctl.target.copy(look.sub(eye).setLength(0.05).add(eye)); c.near = 0.01; }
  c.updateProjectionMatrix(); ctl.update(); view = m;
  nightGround.visible = st.night && m !== 'under';
  for (const k of ['under', 'inside']) panel.querySelector(`[data-k=${k}]`).setAttribute('aria-pressed', String(view === k));
}
const isView = k => k === 'under' || k === 'inside';
panel.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; isView(b.dataset.k) ? setView(b.dataset.k) : toggle(b.dataset.k); });
const keys = { u: 'under', i: 'inside', h: 'beam', f: 'fog', b: 'brake', r: 'reverse', x: 'hazard', c: 'cabin', n: 'night', arrowleft: 'left', arrowright: 'right' };
addEventListener('keydown', e => { const k = keys[e.key.toLowerCase()]; if (k && !e.repeat) { e.preventDefault(); isView(k) ? setView(k) : toggle(k); } });
apply();
const dotL = document.getElementById('dotL'), dotR = document.getElementById('dotR');
(function tick() {
  const on = (performance.now() % 750) < 400;
  const l = (st.hazard || st.left) && on, r = (st.hazard || st.right) && on;
  turnL.emissiveIntensity = l ? 5 : 0; turnR.emissiveIntensity = r ? 5 : 0;
  turnGlowL.intensity = l ? 2 : 0; turnGlowR.intensity = r ? 2 : 0; turnGlowL.visible = l; turnGlowR.visible = r;
  dotL.classList.toggle('on', l); dotR.classList.toggle('on', r);
  requestAnimationFrame(tick);
})();
