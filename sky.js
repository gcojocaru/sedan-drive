// Sun, sky, time of day and weather for the real-map page. The sun sits where it really is over this place on today's
// date at the chosen local solar time, and the sky is redrawn around it, so the sun you see is the one casting the
// shadows. A cool moon takes over at night. Clouds dim and soften the light, haze closes the fog in, rain and snow fall.
import * as THREE from 'three';
import { seeded } from './geom.js';
import { makeTex } from './world-kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = THREE.MathUtils.smoothstep;
const MOON = V(-0.45, 0.62, 0.64).normalize(), UPV = V(0, 1, 0), SUNSET = new THREE.Color('#ff9548');
// sky colours by sun elevation (degrees): zenith, horizon, glow around the sun, ground haze
const SKYK = [[-14, '#03050a', '#0e1420', '#0e1420', '#050605'], [-5, '#141f3d', '#363c5c', '#a0604c', '#16181a'], [-1, '#2a3f73', '#7c6f80', '#f08a54', '#2c2d2a'],
  [4, '#3a60a6', '#b9b5cf', '#ffa860', '#4d4f3f'], [12, '#3567ad', '#c6d4e6', '#ffd8a6', '#6a6f52'], [35, '#2c5fa6', '#dfe9ef', '#fff4e0', '#737a58']];
const skyCols = e => { let i = 0; while (i < SKYK.length - 2 && e > SKYK[i + 1][0]) i++; const a = SKYK[i], b = SKYK[i + 1], f = THREE.MathUtils.clamp((e - a[0]) / (b[0] - a[0]), 0, 1); return [1, 2, 3, 4].map(k => new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), f)); };
const rgba = (c, a) => { const h = c.getHex(); return 'rgba(' + (h >> 16 & 255) + ',' + (h >> 8 & 255) + ',' + (h & 255) + ',' + a + ')'; };
// per kind of weather (weather.js): cloud cover, haze (0 clear air … 1 thick fog), gloom (how much darker the light gets)
const LOOK = { clear: [0, 0, 0], partly: [0.45, 0, 0], overcast: [1, 0.12, 0.3], fog: [0.85, 1, 0.15], rain: [1, 0.5, 0.45], snow: [1, 0.45, 0.2], storm: [1, 0.6, 0.65] };
const grey = c => new THREE.Color().setScalar((c.r + c.g + c.b) / 3);
const SW = 2048, SH = 1024, dirPx = d => [(Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5) * SW, (0.5 - Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)) / Math.PI) * SH]; // equirect pixel for a direction

function drawSky(sd, e, dark, [zen, hor, glow, gnd], cover, haze) {
  const warm = 1 - ss(e, 2, 30), clear = 1 - cover;
  const t = makeTex(SW, SH, (x) => {
    let g = x.createLinearGradient(0, 0, 0, SH / 2); g.addColorStop(0, rgba(zen, 1)); g.addColorStop(0.62, rgba(zen.clone().lerp(hor, 0.45), 1)); g.addColorStop(1, rgba(hor, 1));
    x.fillStyle = g; x.fillRect(0, 0, SW, SH / 2);
    g = x.createLinearGradient(0, SH / 2, 0, SH); g.addColorStop(0, rgba(hor, 1)); g.addColorStop(0.05, rgba(hor.clone().lerp(gnd, 0.6), 1)); g.addColorStop(1, rgba(gnd, 1));
    x.fillStyle = g; x.fillRect(0, SH / 2, SW, SH / 2);
    const rs = seeded(11), sa = (dark ? 1 : 1 - ss(e, -10, -3)) * clear; // stars
    if (sa > 0.02) for (let i = 0; i < 1600; i++) { x.fillStyle = 'rgba(255,255,255,' + (rs() * 0.85 * sa).toFixed(3) + ')'; const z = rs() < 0.08 ? 2 : 1; x.fillRect(rs() * SW, rs() * SH * 0.46, z, z); }
    const [sx, sy] = dirPx(sd), ga = dark ? 0 : (1 - ss(e, 2, 25)) * ss(e, -7, -2) * clear;
    for (const ox of [-SW, 0, SW]) if (ga > 0.01) { // warm band on the horizon around the sun (drawn on both sides of the seam)
      x.save(); x.translate(sx + ox, SH / 2); x.scale(1, 0.28); const r = x.createRadialGradient(0, 0, 0, 0, 0, SW * 0.28);
      r.addColorStop(0, rgba(glow, 0.9 * ga)); r.addColorStop(1, rgba(glow, 0)); x.fillStyle = r; x.fillRect(-SW * 0.28, -SW * 0.28, SW * 0.56, SW * 0.56); x.restore();
    }
    const deck = Math.max(2 * cover - 1, haze); // overcast cloud deck or fog: the sky turns one grey towards the horizon
    if (deck > 0) { g = x.createLinearGradient(0, 0, 0, SH / 2); g.addColorStop(0, rgba(zen, deck * 0.9)); g.addColorStop(1, rgba(hor, deck)); x.fillStyle = g; x.fillRect(0, 0, SW, SH / 2); }
    const rc = seeded(7), cc = (dark ? new THREE.Color('#2a3140') : new THREE.Color('#ffffff').lerp(glow, warm * 0.55).multiplyScalar(0.35 + 0.65 * ss(e, -6, 6))).lerp(grey(hor).multiplyScalar(0.8), cover * 0.7);
    for (let i = 0; i < 46 + cover * 150; i++) { // clouds
      const cx = rc() * SW, cy = SH * (0.29 + rc() * 0.16), n = 3 + Math.floor(rc() * 5); x.fillStyle = rgba(cc, ((0.18 + rc() * 0.2) * (dark ? 0.5 : 1) * (1 + cover)).toFixed(3));
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
    x.globalAlpha = 1 - ss(cover, 0.5, 1); // the sun or moon fades behind thick cloud (a pale disc still shows through fog)
    if (dark) disc(MOON, 'rgba(236,240,255,1)', 'rgba(150,170,220,.25)', 70, 10);
    else if (e > -3) disc(sd, 'rgba(255,253,244,1)', rgba(glow, 0.6), 120, 14);
  });
  t.mapping = THREE.EquirectangularReflectionMapping; t.wrapT = THREE.ClampToEdgeWrapping; return t;
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

// Rain streaks or snowflakes in a box that follows the camera. Drops keep world positions, so you drive through them.
function precipitation(scene, N, height) {
  const R = 20, H = 16, drops = new Float32Array(N * 3), rainAt = new Float32Array(N * 6), snowAt = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { drops[i * 3] = (Math.random() - 0.5) * 2 * R; drops[i * 3 + 1] = Math.random() * H; drops[i * 3 + 2] = (Math.random() - 0.5) * 2 * R; }
  const geo = a => new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(a, 3).setUsage(THREE.DynamicDrawUsage));
  const flake = makeTex(32, 32, x => { const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); });
  const rain = new THREE.LineSegments(geo(rainAt), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }));
  const snow = new THREE.Points(geo(snowAt), new THREE.PointsMaterial({ size: 0.22, map: flake, transparent: true, depthWrite: false }));
  for (const o of [rain, snow]) { o.frustumCulled = false; o.visible = false; scene.add(o); }
  let n = 0, t = 0;
  const wrap = d => d - 2 * R * Math.floor((d + R) / (2 * R)); // offset folded into [-R, R)
  return {
    set(kind, amount, color) {
      rain.visible = kind === 'rain'; snow.visible = kind === 'snow'; n = rain.visible || snow.visible ? Math.round(N * amount) : 0;
      rain.material.color.copy(color); snow.material.color.copy(color);
      rain.geometry.setDrawRange(0, n * 2); snow.geometry.setDrawRange(0, n);
    },
    update(dt, cam) {
      if (!n) return; t += dt;
      const base = height(cam.x, cam.z);
      const isRain = rain.visible, v = isRain ? 15 : 1.4;
      for (let i = 0; i < n; i++) {
        const k = i * 3; let x = drops[k], y = drops[k + 1] - v * dt, z = drops[k + 2];
        if (y < 0) y += H;
        if (!isRain) { x += Math.sin(t * 0.7 + i) * 0.5 * dt; z += Math.cos(t * 0.5 + i * 1.3) * 0.5 * dt; } // flakes drift
        const dx = wrap(x - cam.x), dz = wrap(z - cam.z); x = cam.x + dx; z = cam.z + dz; // keep every drop in the box around the camera
        drops[k] = x; drops[k + 1] = y; drops[k + 2] = z;
        y += base;
        if (dx * dx + dz * dz < 2.2) y = base - 50; // none right at the lens, or inside the car from the driver's seat
        if (isRain) { const j = i * 6; rainAt[j] = rainAt[j + 3] = x; rainAt[j + 1] = y; rainAt[j + 4] = y + 0.8; rainAt[j + 2] = rainAt[j + 5] = z; rainAt[j + 3] += 0.04; }
        else { snowAt[k] = x; snowAt[k + 1] = y; snowAt[k + 2] = z; }
      }
      (isRain ? rain : snow).geometry.attributes.position.needsUpdate = true;
    }
  };
}

// Adds the sun (with its shadow map), the sky light and fog to the scene.
// set(h, forceNight, weather, snow) lights the scene for local solar hour h and a weather from weather.js ({ kind, amount });
// snow (0–1) is how much of the ground is white, which brightens the light bouncing up from it;
// update(dt, cameraPosition) moves the rain or snow each frame; placeShadow(x, z) centres the shadow box on a point.
// quality: { shadow, drops } from quality.js (shadow map size, most rain drops / snowflakes); height(x, z): the ground
export function createSky(renderer, scene, lat, { shadow = 4096, drops = 9000 } = {}, now = new Date(), height = () => 0) {
  const DOY = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5);
  const DEC = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + DOY) / 365), PHI = lat * Math.PI / 180;
  const sunAt = h => { const H = (h - 12) * Math.PI / 12, c = Math.cos(DEC); return V(-c * Math.sin(H), Math.sin(DEC) * Math.sin(PHI) + c * Math.cos(H) * Math.cos(PHI), c * Math.cos(H) * Math.sin(PHI) - Math.sin(DEC) * Math.cos(PHI)).normalize(); };
  const cH0 = -Math.tan(PHI) * Math.tan(DEC), SET = cH0 <= -1 ? 21 : cH0 >= 1 ? 12.5 : 12 + Math.acos(cH0) * 12 / Math.PI; // sunset (solar hours)
  const TIMES = [['Morning', 25.6 - SET], ['Midday', 12.6], ['Afternoon', 12 + (SET - 12) * 0.62], ['Golden hour', SET - 0.8], ['Dusk', SET + 0.45], ['Night', 23.6]];

  const reflectSky = createSkyReflections(renderer);
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5d6046, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
  // one shadow map over a box that reaches further ahead of the car than behind it (see placeShadow), fitted in set() to
  // the ground within SH_R of its centre and walls up to SH_UP m tall, so a low sun's long shadows get finer texels
  const SH_R = 90, SH_UP = 60, SH_MAP = Math.min(shadow, renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048);
  sun.shadow.mapSize.set(SH_MAP, SH_MAP); Object.assign(sun.shadow.camera, { left: -SH_R, right: SH_R, top: SH_R, bottom: -SH_R, near: 1, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; scene.add(sun, sun.target);
  const lightDir = V(0, 1, 0); // towards the sun (or moon)
  scene.fog = new THREE.Fog(0xdfe9ef, 160, 950);
  let skyT = null;

  const fall = precipitation(scene, drops, height); let kind = 'clear', exposure = 1, flash = 0, nextFlash = 3;
  function set(h, forceNight, w = { kind: 'clear' }, snow = 0) {
    const sd = sunAt(h); let e = Math.asin(sd.y) * 180 / Math.PI;
    const night = forceNight || e < -7; if (night) e = Math.min(e, -14);
    const [cover, haze0, gloom] = LOOK[w.kind] || LOOK.clear, haze = haze0 * (w.amount ? 0.5 + 0.5 * w.amount : 1), warm = 1 - ss(e, 2, 30), low = (1 - ss(e, 2, 20)) * ss(e, -3, 1); // low sun: a warm key and a cool fill
    const cols = skyCols(e), [zen, hor, glow, gnd] = cols, hg = grey(hor); // clouds grey the sky and gloom darkens it
    zen.lerp(hg.clone().multiplyScalar(0.85), cover * 0.85); hor.lerp(hg, cover * 0.8); glow.lerp(hg, cover * 0.9);
    for (const c of cols) c.multiplyScalar(1 - 0.5 * gloom);
    gnd.lerp(hor, 0.7 * snow); // snow on the ground
    // direct light: the sun by day, soft light from the whole sky at dusk, the moon at night
    if (night) { lightDir.copy(MOON); sun.color.set(0x9fb3ff); sun.intensity = 0.14; }
    else if (e < -1) { lightDir.set(0.25, 1, 0.3).normalize(); sun.color.copy(zen).lerp(new THREE.Color(0xffffff), 0.6); sun.intensity = 0.3; }
    else { lightDir.copy(sd); if (lightDir.y < 0.06) { lightDir.y = 0.06; lightDir.normalize(); } sun.color.set(0xfff3e4).lerp(glow, warm * 0.85).lerp(SUNSET, 0.5 * low); sun.intensity = 1 + 2.6 * ss(e, -1, 12) + 1.6 * low * ss(e, -1, 3); }
    const ls = lightDir.y, sc = sun.shadow.camera; sc.top = Math.min(SH_R, SH_R * ls + SH_UP * Math.sqrt(1 - ls * ls)); sc.bottom = -Math.min(SH_R, SH_R * ls + 2); sc.updateProjectionMatrix();
    if (night) {
      // Cool indirect light keeps the kerb and car silhouette legible between street lamps.
      hemi.color.set(0xa4b9d1);
      hemi.groundColor.set(0x5c6270).lerp(new THREE.Color(0x9aa3b5), 0.6 * snow);
      hemi.intensity = 0.24;
    } else {
      hemi.color.copy(hor).lerp(zen, 0.25 + 0.45 * low); // the shade is lit by the blue sky overhead, not the sunset
      hemi.groundColor.copy(gnd).lerp(glow, 0.2 * low);
      hemi.intensity = 0.22 + 0.33 * ss(e, -6, 22); // the sky light fades with the sun, so long low shadows still show
    }
    sun.intensity *= 1 - 0.7 * cover * cover; sun.shadow.intensity = 1 - 0.3 * cover * cover; sun.shadow.radius = 1 + 5 * cover * cover; // light through cloud: soft shadows, but still there
    hemi.intensity *= (1 + 0.3 * cover) * (1 - 0.5 * gloom);
    if (skyT) skyT.dispose();
    skyT = drawSky(sd, e, night, cols, cover, haze);
    scene.background = skyT; scene.environment = reflectSky(skyT); scene.environmentIntensity = (night ? 0.3 : 0.35 + 0.45 * ss(e, 2, 22)) * (1 - 0.35 * gloom);
    scene.fog.color.copy(hor); scene.fog.near = THREE.MathUtils.lerp(night ? 80 : 110 + 50 * ss(e, -3, 10), 5, haze); scene.fog.far = THREE.MathUtils.lerp(night ? 650 : 760 + 190 * ss(e, -3, 10), 140, haze);
    renderer.toneMappingExposure = exposure = (night ? 1.1 : e < 0 ? 1.25 : 1 + 0.08 * warm + 0.12 * low) * (1 - 0.2 * gloom);
    kind = w.kind; fall.set(kind === 'storm' ? 'rain' : kind, w.amount || 0, hor.clone().lerp(new THREE.Color(1, 1, 1), night ? 0.1 : 0.45));
    return { night, e, lowLight: night || e < -0.5, murky: haze > 0.4, post: { night: night || e < -1, low, cover } }; // post: for post-fx.js look()
  }

  function update(dt, cam) {
    fall.update(dt, cam);
    if (kind !== 'storm' && !flash) return;
    if ((nextFlash -= dt) < 0 && kind === 'storm') { flash = 1; nextFlash = 4 + Math.random() * 12; } // lightning, now and then
    flash = flash > 0.02 ? flash * Math.exp(-dt * 7) : 0;
    renderer.toneMappingExposure = exposure * (1 + 2.5 * flash * (0.6 + 0.4 * Math.sin(flash * 40))); // with a flicker
  }

  const shC = V(), lx = V(), ly = V();
  function placeShadow(x, z) { // centre the shadow box on (x, z), snapped to whole shadow-map texels so edges don't crawl
    shC.set(x, height(x, z), z);
    lx.crossVectors(UPV, lightDir); if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0); lx.normalize(); ly.crossVectors(lightDir, lx);
    const sc = sun.shadow.camera, tx = (sc.right - sc.left) / SH_MAP, ty = (sc.top - sc.bottom) / SH_MAP; // texels on each axis
    const a = Math.round(shC.dot(lx) / tx) * tx, b = Math.round(shC.dot(ly) / ty) * ty, c = shC.dot(lightDir);
    shC.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lightDir, c);
    sun.target.position.copy(shC); sun.position.copy(shC).addScaledVector(lightDir, 400);
  }

  return { TIMES, NIGHT: 5, sunAt, set, update, placeShadow };
}
