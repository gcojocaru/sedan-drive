// Sun, sky and time of day for the real-map page. The sun sits where it really is over this place on today's date at
// the chosen local solar time, and the sky is redrawn around it, so the sun you see is the one casting the shadows.
// A cool moon takes over at night.
import * as THREE from 'three';
import { seeded } from './geom.js';
import { makeTex } from './world-kit.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = THREE.MathUtils.smoothstep;
const MOON = V(-0.45, 0.62, 0.64).normalize(), UPV = V(0, 1, 0);
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

// Adds the sun (with its shadow map), the sky light and fog to the scene.
// set(h, forceNight) lights the scene for local solar hour h; placeShadow(x, z) centres the shadow box on a point.
export function createSky(renderer, scene, lat, now = new Date()) {
  const DOY = Math.round((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(now.getUTCFullYear(), 0, 0)) / 864e5);
  const DEC = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + DOY) / 365), PHI = lat * Math.PI / 180;
  const sunAt = h => { const H = (h - 12) * Math.PI / 12, c = Math.cos(DEC); return V(-c * Math.sin(H), Math.sin(DEC) * Math.sin(PHI) + c * Math.cos(H) * Math.cos(PHI), c * Math.cos(H) * Math.sin(PHI) - Math.sin(DEC) * Math.cos(PHI)).normalize(); };
  const cH0 = -Math.tan(PHI) * Math.tan(DEC), SET = cH0 <= -1 ? 21 : cH0 >= 1 ? 12.5 : 12 + Math.acos(cH0) * 12 / Math.PI; // sunset (solar hours)
  const TIMES = [['Morning', 25.6 - SET], ['Midday', 12.6], ['Afternoon', 12 + (SET - 12) * 0.62], ['Golden hour', SET - 0.8], ['Dusk', SET + 0.45], ['Night', 23.6]];

  const reflectSky = createSkyReflections(renderer);
  const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x5d6046, 0.7); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); sun.castShadow = true;
  // one shadow map over a box that reaches further ahead of the car than behind it (see placeShadow)
  const SH_R = 90, SH_MAP = renderer.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
  sun.shadow.mapSize.set(SH_MAP, SH_MAP); Object.assign(sun.shadow.camera, { left: -SH_R, right: SH_R, top: SH_R, bottom: -SH_R, near: 1, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; scene.add(sun, sun.target);
  const lightDir = V(0, 1, 0); // towards the sun (or moon)
  scene.fog = new THREE.Fog(0xdfe9ef, 160, 950);
  let skyT = null;

  function set(h, forceNight) {
    const sd = sunAt(h); let e = Math.asin(sd.y) * 180 / Math.PI;
    const night = forceNight || e < -7; if (night) e = Math.min(e, -14);
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
    return { night, e, lowLight: night || e < -0.5 };
  }

  const shC = V(), lx = V(), ly = V();
  function placeShadow(x, z) { // centre the shadow box on (x, z), snapped to whole shadow-map texels so edges don't crawl
    shC.set(x, 0, z);
    lx.crossVectors(UPV, lightDir); if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0); lx.normalize(); ly.crossVectors(lightDir, lx);
    const tx = 2 * SH_R / SH_MAP, a = Math.round(shC.dot(lx) / tx) * tx, b = Math.round(shC.dot(ly) / tx) * tx, c = shC.dot(lightDir);
    shC.copy(lx).multiplyScalar(a).addScaledVector(ly, b).addScaledVector(lightDir, c);
    sun.target.position.copy(shC); sun.position.copy(shC).addScaledVector(lightDir, 400);
  }

  return { TIMES, NIGHT: 5, sunAt, set, placeShadow };
}
