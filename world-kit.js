// three.js and OSM-tag helpers shared by the world builders (world.js, buildings.js): triangulating polygons into flat
// buffers, canvas textures, numbers and colours read from tags, and wet and snowy surfaces (weatherLook).
import * as THREE from 'three';
import { tri } from './geom.js';

export function eachTri(outer, holes, cb) {
  const o = outer.map(p => new THREE.Vector2(p[0], p[1])), hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  let f; try { f = THREE.ShapeUtils.triangulateShape(o, hs); } catch { return; }
  const all = o.concat(...hs);
  for (const [i, j, k] of f) cb([all[i].x, all[i].y], [all[j].x, all[j].y], [all[k].x, all[k].y]);
}
export function fillPoly(B, outer, holes, y) { eachTri(outer, holes, (a, b, c) => tri(B, a, b, c, y)); }
export function makeTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function speckle(x, w, h, n, amt, size = 2) {
  for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amt; x.fillStyle = v > 0 ? 'rgba(255,255,255,' + v + ')' : 'rgba(0,0,0,' + -v + ')'; x.fillRect(Math.random() * w, Math.random() * h, size, size); }
}
export const num = v => { const f = parseFloat(v); return f > 0 && f < 1000 ? f : 0; };
export const WALL_MAT = { brick: '#9c5a44', stone: '#b9ae9a', sandstone: '#c9a77e', concrete: '#bdbab2', glass: '#7f97a8', wood: '#9a7a55', timber_framing: '#e0d6c2', metal: '#a3a7aa', plaster: '#ddd5c6', limestone: '#d8d0bd' };
export const matColor = (tab, v) => v && tab[v.toLowerCase()] ? new THREE.Color(tab[v.toLowerCase()]) : null;
export function tagColor(s) {
  if (!s) return null; s = s.trim().toLowerCase();
  if (/^#?[0-9a-f]{6}$/.test(s) || /^#?[0-9a-f]{3}$/.test(s)) return new THREE.Color(s[0] === '#' ? s : '#' + s);
  if (s in THREE.Color.NAMES) return new THREE.Color(THREE.Color.NAMES[s]);
  return null;
}

// Rain and snow on the surfaces that face the sky. weatherLook() → { wear(material, kind), set(wet, snow), lamps, lit, follow }:
// wear() patches a MeshStandardMaterial before its first render so that wet (0–1) darkens it and makes it glossy, with
// puddles on roads, and snow (0–1) whitens what faces up, in drifts from one world-space noise, so layers lying on top of
// each other agree. Every worn material shares the uniforms, so set() changes them all at once. kind: a row of WEAR.
// Street lamps aren't lights, so wet roads reflect them by hand: lamps(points) gives their heads (x, y, z, …), lit(on)
// switches them, and follow(x, z) hands the shader the eight nearest the camera.
const WEAR = { // [wet darkens to, wet gloss, snow (below 1: patchier), slush (0 white … 1 grey), facing up only, puddles]
  road: [0.5, 0.85, 0.36, 0.7, 0, 1], mark: [0.85, 0.6, 0.36, 0.7, 0, 1], pave: [0.62, 0.55, 0.85, 0.2, 0, 0],
  ground: [0.78, 0.15, 1, 0, 0, 0], roof: [0.7, 0.5, 1, 0, 1, 0], tree: [0.85, 0.1, 0.7, 0, 1, 0] };
export function weatherLook() {
  const U = { uWet: { value: 0 }, uSnow: { value: 0 }, wxGlint: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) } };
  const vert = s => s.replace('#include <common>', '#include <common>\nvarying vec3 vWx;\nvarying float vWxUp;').replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 wxP = vec4(transformed, 1.0); vec3 wxN = objectNormal;
#ifdef USE_INSTANCING
wxP = instanceMatrix * wxP; wxN = mat3(instanceMatrix) * wxN;
#endif
vWx = (modelMatrix * wxP).xyz; vWxUp = normalize(mat3(modelMatrix) * wxN).y;`);
  const frag = s => s.replace('#include <common>', `#include <common>
uniform float uWet, uSnow, wxK[6];
uniform vec4 wxGlint[8];
varying vec3 vWx;
varying float vWxUp;
float wxH(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wxN(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3.0 - 2.0 * f); return mix(mix(wxH(i), wxH(i + vec2(1, 0)), f.x), mix(wxH(i + vec2(0, 1)), wxH(i + vec2(1, 1)), f.x), f.y); }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
float wxUp = mix(1.0, smoothstep(0.35, 0.8, vWxUp), wxK[4]), wxWet = uWet * wxUp;
float wxF = 1.0 - smoothstep(0.15, 0.6, length(fwidth(vWx.xz))); // the fine detail fades out far away, so it doesn't shimmer
float wxD = wxN(vWx.xz * 0.2) * 0.62 + mix(0.5, wxN(vWx.xz * 0.9 + 7.3), wxF) * 0.38; // drifts
float wxPud = wxK[5] * wxWet * smoothstep(0.62, 0.68, wxN(vWx.xz * 0.33 + 21.7)); // puddles
float wxS = clamp((uSnow * wxK[2] * 1.5 - wxD) * 4.0, 0.0, 1.0) * wxUp;
diffuseColor.rgb *= mix(1.0, wxK[0], wxWet) * (1.0 - 0.4 * wxPud);
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.83, 0.86, 0.9), vec3(0.42, 0.43, 0.45), wxK[3]) * (0.93 + 0.1 * wxD), wxS);`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(mix(roughnessFactor, 0.12, wxWet * wxK[1]), 0.03, wxPud), 0.75, wxS);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float wxG = wxWet * wxK[1] * wxK[5] * (1.0 - wxS); // lit street lamps glint in wet roads, stretched towards the eye like real reflections
if (wxG > 0.0) {
  vec3 wxV = normalize(cameraPosition - vWx);
  float wxR = (0.04 + 0.96 * pow(1.0 - wxV.y, 5.0)) * wxG * mix(4.0, 14.0, wxPud), wxE = mix(120.0, 1200.0, wxPud);
  for (int i = 0; i < 8; i++) totalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * wxGlint[i].w * wxR * pow(max(normalize(normalize(wxGlint[i].xyz - vWx) + wxV).y, 0.0), wxE);
}`);
  function wear(mat, kind) {
    const k = WEAR[kind];
    mat.onBeforeCompile = s => { Object.assign(s.uniforms, U, { wxK: { value: k } }); s.vertexShader = vert(s.vertexShader); s.fragmentShader = frag(s.fragmentShader); };
    return mat;
  }
  let heads = [], on = false, fx = Infinity, fz = 0;
  function follow(x, z) {
    if (!on || !U.uWet.value || Math.hypot(x - fx, z - fz) < 4) return; fx = x; fz = z; // a new pick every 4 m
    const d = i => (heads[i * 3] - x) ** 2 + (heads[i * 3 + 2] - z) ** 2, near = [...Array(heads.length / 3).keys()].sort((a, b) => d(a) - d(b));
    U.wxGlint.value.forEach((v, i) => i < near.length ? v.set(heads[near[i] * 3], heads[near[i] * 3 + 1], heads[near[i] * 3 + 2], 1) : v.set(0, 0, 0, 0));
  }
  return {
    wear, follow, lamps(points) { heads = points; },
    lit(v) { on = v; fx = Infinity; if (!v) for (const g of U.wxGlint.value) g.w = 0; },
    set(wet, snow) { U.uWet.value = wet; U.uSnow.value = snow; fx = Infinity; }
  };
}
