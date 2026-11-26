// three.js and OSM-tag helpers shared by the world builders (world.js, buildings.js): triangulating polygons into flat
// buffers, canvas textures, and numbers and colours read from tags.
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
