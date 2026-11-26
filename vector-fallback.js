// Fallback map data for when every Overpass server refuses: OpenFreeMap's vector tiles (OpenMapTiles schema), which
// have no request limits or keys. The features are turned into the same element list an Overpass reply has, so the
// world builder doesn't need to know where they came from. Less detail than Overpass: no roof shapes, walls or
// fences, crossings, lane counts or single trees.
import { HALF, MARGIN } from './osm-query.js';

export const FALLBACK_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const FALLBACK_CREDIT = 'OpenFreeMap © OpenMapTiles';

export async function fetchVectorArea(lat0, lon0, fetchFn = fetch) {
  const tj = await (await fetchFn(FALLBACK_TILEJSON, { signal: AbortSignal.timeout(15000) })).json();
  const tmpl = tj.tiles[0], z = Math.min(14, tj.maxzoom || 14), n = 2 ** z;
  const d = HALF + MARGIN, dLat = d / 110574, dLon = d / (111320 * Math.cos(lat0 * Math.PI / 180));
  const tx = lon => Math.floor((lon + 180) / 360 * n), ty = lat => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const list = [];
  for (let x = tx(lon0 - dLon); x <= tx(lon0 + dLon); x++) for (let y = ty(lat0 + dLat); y <= ty(lat0 - dLat); y++) list.push([x, y]);
  const bufs = await Promise.all(list.map(([x, y]) => fetchFn(tmpl.replace('{z}', z).replace('{x}', x).replace('{y}', y), { signal: AbortSignal.timeout(30000) })
    .then(r => { if (!r.ok) throw new Error('tile server replied ' + r.status); return r.arrayBuffer(); })));
  const box = [lat0 - dLat * 1.2, lon0 - dLon * 1.2, lat0 + dLat * 1.2, lon0 + dLon * 1.2], elements = [];
  list.forEach(([x, y], i) => toElements(decodeTile(bufs[i]), x, y, z, box, elements));
  return { elements, fallback: true };
}

// ---- Mapbox Vector Tile (protobuf) decoding ----
function varint(s) { let r = 0, m = 1, b; do { b = s.b[s.p++]; r += (b & 0x7f) * m; m *= 128; } while (b & 0x80); return r; }
function skip(s, wt) { if (wt === 0) varint(s); else if (wt === 1) s.p += 8; else if (wt === 2) s.p += varint(s); else if (wt === 5) s.p += 4; else throw new Error('bad tile'); }
function fields(s, end, cb) { while (s.p < end) { const key = varint(s); if (cb(Math.floor(key / 8), key & 7) === false) skip(s, key & 7); } }
export function decodeTile(buf) {
  const s = { b: new Uint8Array(buf), p: 0 }, dv = new DataView(s.b.buffer, s.b.byteOffset, s.b.byteLength), td = new TextDecoder(), layers = {};
  const str = () => { const len = varint(s), v = td.decode(s.b.subarray(s.p, s.p + len)); s.p += len; return v; };
  const packed = () => { const e = varint(s) + s.p, a = []; while (s.p < e) a.push(varint(s)); return a; };
  fields(s, s.b.length, tag => {
    if (tag !== 3) return false;
    const end = varint(s) + s.p, L = { name: '', keys: [], values: [], extent: 4096, feats: [] };
    fields(s, end, t => {
      if (t === 1) L.name = str();
      else if (t === 3) L.keys.push(str());
      else if (t === 5) L.extent = varint(s);
      else if (t === 2) { const fe = varint(s) + s.p, f = { type: 0, tags: [], geom: [] }; fields(s, fe, u => { if (u === 2) f.tags = packed(); else if (u === 3) f.type = varint(s); else if (u === 4) f.geom = packed(); else return false; }); L.feats.push(f); }
      else if (t === 4) {
        const ve = varint(s) + s.p; let v = null;
        fields(s, ve, u => {
          if (u === 1) v = str(); else if (u === 2) { v = dv.getFloat32(s.p, true); s.p += 4; } else if (u === 3) { v = dv.getFloat64(s.p, true); s.p += 8; }
          else if (u === 4 || u === 5) v = varint(s); else if (u === 6) { const q = varint(s); v = q % 2 ? -(q + 1) / 2 : q / 2; } else if (u === 7) v = !!varint(s); else return false;
        });
        L.values.push(v);
      } else return false;
    });
    layers[L.name] = L;
  });
  return layers;
}
function parts(g) { // geometry commands → polylines / rings in tile pixels
  const out = []; let x = 0, y = 0, cur = null;
  for (let i = 0; i < g.length;) {
    const c = g[i++], id = c & 7, cnt = c >> 3;
    if (id === 1 || id === 2) for (let k = 0; k < cnt; k++) { const dx = g[i++], dy = g[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1); if (id === 1) out.push(cur = []); cur.push([x, y]); }
    else if (id === 7 && cur && cur.length) cur.push(cur[0].slice());
  }
  return out;
}
const props = (L, f) => { const o = {}; for (let i = 0; i < f.tags.length; i += 2) o[L.keys[f.tags[i]]] = L.values[f.tags[i + 1]]; return o; };
const ringArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return a / 2; };
function clipRing(r, e) { // to the tile's own square, so pieces from neighbouring tiles meet edge to edge instead of overlapping
  let P = r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r.slice();
  for (const [ax, lim, sg] of [[0, 0, -1], [0, e, 1], [1, 0, -1], [1, e, 1]]) {
    const o = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length], ip = sg * (p[ax] - lim) <= 0, iq = sg * (q[ax] - lim) <= 0;
      if (ip) o.push(p);
      if (ip !== iq) { const t = (lim - p[ax]) / (q[ax] - p[ax]), c = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; c[ax] = lim; o.push(c); }
    }
    P = o; if (P.length < 3) return null;
  }
  return P.concat([P[0]]);
}

// ---- OpenMapTiles layers → OSM-style tags ----
const HW = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', raceway: 'raceway', busway: 'busway' };
const PATHS = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'bridleway']), RAIL = new Set(['rail', 'narrow_gauge', 'light_rail', 'subway', 'tram', 'monorail', 'funicular', 'preserved']);
const LANDUSE = { parking: { amenity: 'parking' }, residential: { landuse: 'residential' }, commercial: { landuse: 'commercial' }, retail: { landuse: 'retail' }, industrial: { landuse: 'industrial' }, railway: { landuse: 'railway' }, cemetery: { landuse: 'cemetery' }, military: { landuse: 'military' }, garages: { landuse: 'garages' }, quarry: { landuse: 'construction' }, school: { landuse: 'residential' }, college: { landuse: 'residential' }, university: { landuse: 'residential' }, kindergarten: { landuse: 'residential' }, hospital: { landuse: 'residential' }, pitch: { leisure: 'pitch' }, stadium: { leisure: 'pitch' }, playground: { leisure: 'playground' }, park: { leisure: 'park' }, zoo: { leisure: 'park' }, theme_park: { leisure: 'park' } };
const COVER = { wood: { natural: 'wood' }, grass: { landuse: 'grass' }, farmland: { landuse: 'farmland' }, wetland: { natural: 'wetland' }, rock: { natural: 'bare_rock' }, sand: { natural: 'sand' } };
// OpenMapTiles groups these shop subclasses into other classes such as grocery and library.
// Mixed classes also contain amenities (e.g. grocery/marketplace), so only use known shop values.
const SHOP_SUBCLASSES = new Set(['alcohol', 'art', 'bag', 'bakery', 'beverages', 'bicycle', 'books', 'butcher', 'car',
  'car_parts', 'car_repair', 'clothes', 'deli', 'delicatessen', 'department_store', 'dry_cleaning', 'greengrocer',
  'hairdresser', 'laundry', 'music', 'musical_instrument', 'supermarket', 'wine']);
function poiTags(p) {
  const name = typeof p.name === 'string' && p.name.trim(), sub = p.subclass;
  const label = name ? {name} : {};
  if (p.class === 'bus' && sub === 'bus_stop') return { ...label, highway: 'bus_stop' };
  if (sub === 'bench' || p.class === 'bench') return { ...label, amenity: 'bench' };
  if (sub === 'bollard' || p.class === 'bollard') return { ...label, barrier: 'bollard' };
  if (!name) return null;
  if (p.class === 'shop' || SHOP_SUBCLASSES.has(sub)) return { name, shop: sub || 'yes' };
  if (p.class === 'railway') {
    if (sub === 'subway') return { name, railway: 'station', station: 'subway' };
    if (sub === 'station' || sub === 'halt') return { name, railway: sub };
  }
  if (p.class === 'bus' && sub === 'bus_station') return { name, amenity: sub };
  if ((sub === 'park' || sub === 'garden') && p.class === sub) return { name, leisure: sub };
  return null;
}
function tagsFor(layer, p, poly) {
  if (layer === 'building') { if (p.hide_3d) return null; const t = { building: 'yes' }; if (p.render_height >= 13 || p.render_min_height > 0) t.height = String(p.render_height); if (p.render_min_height > 0) t.min_height = String(p.render_min_height); if (p.colour) t['building:colour'] = p.colour; return t; }
  if (layer === 'water') return poly && p.brunnel !== 'tunnel' ? { natural: 'water' } : null;
  if (layer === 'waterway') return !poly && p.brunnel !== 'tunnel' && /^(river|stream|canal|drain|ditch)$/.test(p.class) ? { waterway: p.class } : null;
  if (layer === 'landuse') return poly ? LANDUSE[p.class] || null : null;
  if (layer === 'landcover') return poly ? (p.class === 'sand' && p.subclass === 'beach' ? { natural: 'beach' } : COVER[p.class] || null) : null;
  if (layer === 'park') return poly && p.class === 'park' ? { leisure: 'park' } : null;
  if (layer === 'transportation') {
    const t = {}, sub = p.subclass;
    if (RAIL.has(sub)) t.railway = sub === 'preserved' ? 'rail' : sub;
    else if (HW[p.class]) t.highway = HW[p.class] + (p.ramp && /^(motorway|trunk|primary|secondary|tertiary)$/.test(HW[p.class]) ? '_link' : '');
    else if (p.class === 'path') t.highway = PATHS.has(sub) ? sub : 'footway';
    else return null;
    if (poly) { if (t.highway !== 'pedestrian') return null; t.area = 'yes'; }
    if (p.brunnel === 'bridge') t.bridge = 'yes'; if (p.brunnel === 'tunnel') t.tunnel = 'yes';
    if (p.oneway) t.oneway = 'yes'; if (p.service) t.service = p.service;
    return t;
  }
  return null;
}

let nextId = 1;
function toElements(layers, tx, ty, z, box, out) {
  const n = 2 ** z, ll = (e, [px, py]) => ({ lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + py / e) / n))) * 180 / Math.PI, lon: (tx + px / e) / n * 360 - 180 });
  const inBox = p => p.lat > box[0] && p.lat < box[2] && p.lon > box[1] && p.lon < box[3];
  function pointFeatures(layer, tagsForPoint) {
    if (!layer) return;
    for (const f of layer.feats) {
      if (f.type !== 1) continue;
      const tags = tagsForPoint(props(layer, f));
      if (!tags) continue;
      for (const [[x,y]] of parts(f.geom)) {
        // Buffered points belong to the tile containing their anchor.
        if (x<0 || y<0 || x>=layer.extent || y>=layer.extent) continue;
        const pos = ll(layer.extent,[x,y]);
        if (inBox(pos)) out.push({type:'node', id:nextId++, tags, ...pos});
      }
    }
  }
  pointFeatures(layers.poi, poiTags);
  pointFeatures(layers.housenumber, p => {
    const number = String(p.housenumber ?? '').trim();
    return number ? {'addr:housenumber':number} : null;
  });
  const names = nameIndex(layers.transportation_name);
  for (const name of ['water', 'waterway', 'landcover', 'landuse', 'park', 'transportation', 'building']) {
    const L = layers[name]; if (!L) continue;
    for (const f of L.feats) {
      const poly = f.type === 3; if (f.type !== 2 && !poly) continue;
      const p = props(L, f);
      let tags = tagsFor(name, p, poly); if (!tags) continue;
      if (typeof p.name === 'string' && p.name.trim() && (tags.building || tags.highway || (tags.leisure === 'park' && p.class === 'park'))) {
        tags = { ...tags, name: p.name.trim() };
      }
      const rings = parts(f.geom);
      if (!poly) {
        if (name === 'transportation' && tags.highway && !tags.name) { const nm = names(rings, p.class); if (nm) tags.name = nm; }
        for (const r of rings) { const g = r.map(q => ll(L.extent, q)); if (g.length > 1 && g.some(inBox)) out.push({ type: 'way', id: nextId++, tags, geometry: g }); }
        continue;
      }
      // polygons: an exterior ring (positive area in tile pixels) starts a polygon, negative rings are its holes
      const polys = [];
      for (const r of rings) { const c = clipRing(r, L.extent); if (!c) continue; if (ringArea(r) > 0 || !polys.length) polys.push([c]); else polys[polys.length - 1].push(c); }
      for (const [outer, ...holes] of polys) {
        const g = outer.map(q => ll(L.extent, q)); if (!g.some(inBox)) continue;
        if (!holes.length) out.push({ type: 'way', id: nextId++, tags, geometry: g });
        else out.push({ type: 'relation', id: nextId++, tags, members: [{ type: 'way', role: 'outer', geometry: g }, ...holes.map(h => ({ type: 'way', role: 'inner', geometry: h.map(q => ll(L.extent, q)) }))] });
      }
    }
  }
}
// street names live in a separate layer of merged lines: match each road to the nearest named line of the same class
function nameIndex(L) {
  if (!L) return () => '';
  const G = 64, grid = new Map();
  for (const f of L.feats) {
    const p = props(L, f); if (!p.name || f.type !== 2) continue;
    for (const r of parts(f.geom)) for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1], s = { a, b, name: p.name, cls: p.class };
      for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) for (let gy = Math.floor(Math.min(a[1], b[1]) / G); gy <= Math.floor(Math.max(a[1], b[1]) / G); gy++) { const k = gx + ',' + gy; (grid.get(k) || grid.set(k, []).get(k)).push(s); }
    }
  }
  const dist = (p, s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2)); return Math.hypot(p[0] - s.a[0] - dx * t, p[1] - s.a[1] - dy * t); };
  return (rings, cls) => {
    const r = rings.reduce((m, q) => q.length > m.length ? q : m, []); if (r.length < 2) return '';
    const i = Math.floor((r.length - 1) / 2), mid = [(r[i][0] + r[i + 1][0]) / 2, (r[i][1] + r[i + 1][1]) / 2];
    let best = '', bd = 6;
    for (const s of grid.get(Math.floor(mid[0] / G) + ',' + Math.floor(mid[1] / G)) || []) { const dd = dist(mid, s) + (s.cls === cls ? 0 : 3); if (dd < bd) { bd = dd; best = s.name; } }
    return best;
  };
}
