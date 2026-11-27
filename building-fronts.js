export const HOUSE_T = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'farm_auxiliary', 'barn', 'cabin', 'hut', 'villa', 'chapel', 'stable', 'cowshed', 'shed', 'static_caravan', 'allotment_house']);
export const PLAIN_T = new Set(['garage', 'garages', 'shed', 'carport', 'hut', 'roof', 'service', 'storage_tank', 'silo', 'barn', 'farm_auxiliary', 'cowshed', 'stable', 'bunker', 'transformer_tower', 'greenhouse', 'ruins', 'column', 'steps']);
const OFFICE_T = new Set(['office', 'commercial', 'retail', 'supermarket', 'hotel', 'hospital', 'government', 'public', 'civic', 'bank', 'train_station', 'transportation', 'university', 'college']);
const INDUSTRY_T = new Set(['industrial', 'warehouse', 'factory', 'manufacture', 'hangar', 'storage', 'depot']);
const OLD_T = new Set(['church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'monastery', 'school', 'kindergarten', 'museum', 'palace', 'castle', 'theatre']);

// Photo surfaces in textures/ (CC0, Poly Haven, 512 px): [file, metres per repeat, contrast boost after levelling]
export const SURFACES = { plaster: ['plastered_wall_02', 2.23, 4.5], brick: ['red_bricks_04', 2.5, 1], concrete: ['concrete_wall_008', 2.71, 2.2],
  metal: ['corrugated_iron_02', 2.7, 1.3], tiles: ['clay_roof_tiles_02', 2.5, 1], gravel: ['tarred_gravel', 2.2, 1.2] };
export const WALL_SURFACES = ['plaster', 'brick', 'concrete', 'metal']; // the wall texture array's layers
// Facade styles, one column of the wall atlas each: [name, storey height (m), window bay (m), share of windows lit at night,
// WALL_SURFACES layer]. 'mansard' is the zinc slope of a mansard roof, a dormer per bay (the bay of 'classic' below it).
export const FACADES = [['house', 2.9, 3, 0.4, 0], ['panel', 2.75, 6.2, 0.5, 2], ['classic', 3.6, 2.7, 0.45, 0], ['office', 3.7, 1.8, 0.3, 2],
  ['glass', 3.8, 1.5, 0.35, 2], ['industrial', 4.5, 4.5, 0.15, 3], ['brick', 3, 3, 0.4, 1], ['blank', 3, 4, 0, 0], ['mansard', 3.2, 2.7, 0.3, 3]];
export const FACADE = Object.fromEntries(FACADES.map((f, i) => [f[0], i]));

// How untagged buildings look by region, found from the country the map data lies in (road-layout.js countryCode): the
// facade mix under 9 m, from 9 to 14 m and over 14 m tall (free: over 14 m with no party wall, a modern block rather
// than one of a terrace); wall colours by style and pitched-roof colours to use instead of the defaults (buildings.js);
// the share of metal roofs; and whether terraced apartment blocks get mansard roofs (mansardRoof).
// Anywhere else, the former Eastern Bloc included, keeps the generic mix, which builds panel blocks first.
const GENERIC = { low: { house: 0.75, brick: 0.25 }, mid: { classic: 0.55, panel: 0.225, brick: 0.225 }, tall: { panel: 0.65, classic: 0.35 }, metal: 0.3 };
const OCHRE = ['#efe4cf', '#e8c99a', '#dcae78', '#f1e9da', '#d79a6a', '#e9cfa8', '#c98b5e', '#e5bf8f', '#f3efe6'];
export const REGIONS = [
  { name: 'French', countries: 'FR BE LU MC', mansard: true, metal: 0.05, low: { house: 0.85, brick: 0.15 }, mid: { classic: 0.8, house: 0.1, brick: 0.1 }, tall: { classic: 1 }, free: { panel: 0.55, office: 0.3, classic: 0.15 },
    walls: { classic: ['#e8dcc6', '#e2d4ba', '#ded0b4', '#ece3d1', '#d6c8ac', '#e5d8bf', '#cfc0a2'], house: ['#eee8dc', '#e6dccb', '#ddd2bf', '#d6c7ad', '#efe9df', '#cdbfa8'] },
    roofs: ['#4c5059', '#55585d', '#5c6882', '#9c4f34', '#a5603f'] },
  { name: 'British', countries: 'GB IE IM JE GG', metal: 0.05, low: { brick: 0.6, house: 0.4 }, mid: { brick: 0.55, classic: 0.35, panel: 0.1 }, tall: { panel: 0.35, classic: 0.3, office: 0.2, brick: 0.15 },
    walls: { classic: ['#ece6d8', '#e4dccb', '#d9cfbb', '#c9a77f', '#b98c66', '#a0583f'] }, roofs: ['#4c5059', '#555a61', '#4a4f57', '#5f5a55', '#8b5a44'] },
  { name: 'Mediterranean', countries: 'ES PT IT GR MT CY HR ME AL SM VA AD', metal: 0.05, low: { house: 0.9, brick: 0.1 }, mid: { classic: 0.6, house: 0.25, panel: 0.15 }, tall: { classic: 0.55, panel: 0.4, office: 0.05 },
    walls: { classic: OCHRE, house: OCHRE, panel: OCHRE }, roofs: ['#a5603f', '#9c4f34', '#b2694a', '#8f4a36', '#b87650'] },
  { name: 'North American', countries: 'US CA', metal: 0.1, low: { house: 0.75, brick: 0.25 }, mid: { brick: 0.55, office: 0.25, classic: 0.2 }, tall: { office: 0.45, brick: 0.3, glass: 0.25 },
    walls: { house: ['#efece4', '#e4d9c3', '#d6dde3', '#c4d0c0', '#f0d9b5', '#d8c3d6', '#b7c7d8', '#e9e2cf', '#cfc6b8'], classic: ['#7a5444', '#8a6250', '#a07a62', '#c8b79c', '#b5a48a'] },
    roofs: ['#4b4b4d', '#5a524b', '#3f4247', '#6a6259', '#55585c'] }];
export const regionOf = code => REGIONS.find(r => r.countries.split(' ').includes(code)) || GENERIC;

// Whether a block without a roof:shape tag gets a mansard roof: where the region builds them, on 4- to 9-storey apartment
// blocks (14–34 m) in a terrace (sharing a wall), not on houses, offices, churches, sheds or industry, nor on concrete,
// glass or metal fronts.
export function mansardRoof(t, type, levels, height, region, terraced = true) {
  if (!region.mansard || !terraced || t['roof:levels'] === '0' || [PLAIN_T, HOUSE_T, OFFICE_T, INDUSTRY_T, OLD_T].some(s => s.has(type))) return false;
  if (['concrete', 'glass', 'mirror', 'metal'].includes(String(t['building:material'] || '').toLowerCase())) return false;
  return levels ? levels >= 4 && levels <= 9 : height ? height >= 14 && height <= 34 : type === 'apartments' || type === 'residential';
}

// t: the building's tags; top: its height (m); rnd: its seeded random; region: regionOf(country); terraced: it shares a
// wall with another building. Tags decide first, then type, then height and the region's mix.
export function facadeStyle(t, type, top, rnd, region = GENERIC, terraced = true) {
  const mat = String(t['building:material'] || '').toLowerCase();
  if (PLAIN_T.has(type)) return FACADE.blank;
  if (mat === 'glass' || mat === 'mirror' || top > 60 || (OFFICE_T.has(type) && top > 30 && rnd() < 0.6)) return FACADE.glass;
  if (mat === 'metal' || INDUSTRY_T.has(type)) return FACADE.industrial;
  if (mat === 'brick') return FACADE.brick;
  if (HOUSE_T.has(type) || mat === 'wood' || mat === 'timber_framing') return FACADE.house;
  if (OFFICE_T.has(type)) return FACADE.office;
  if (OLD_T.has(type) || t.heritage || t.historic || t['building:architecture']) return FACADE.classic;
  if (mat === 'concrete') return FACADE.panel;
  const mix = top < 9 ? region.low : top >= 14 ? (!terraced && region.free) || region.tall : region.mid, styles = Object.keys(mix);
  let x = rnd(); for (const s of styles) if ((x -= mix[s]) < 0) return FACADE[s];
  return FACADE[styles.at(-1)];
}

// Storeys of window rows between y0 and top: tagged levels set the storey height, otherwise the style does.
export function floorGrid(style, top, y0, levels) {
  const floors = Math.max(1, Math.round((top - y0) / (levels ? top / levels : FACADES[style][1])));
  return { floors, floorH: (top - y0) / floors };
}

// Window bays along a ring: edges meeting at under ~25° form one run, and every run holds a whole number of bays, so a
// corner never cuts a window. Runs shorter than 0.6 bay get none (u stays put). Returns [u at start, u at end] per edge.
export function bayCoords(ring, bay, u = 0) {
  const n = ring.length, L = [], D = [];
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); L.push(l); D.push(l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : null); }
  const corner = i => { if (!D[i]) return false; let p = (i + n - 1) % n; while (!D[p] && p !== i) p = (p + n - 1) % n; return D[p][0] * D[i][0] + D[p][1] * D[i][1] < 0.9; };
  let s = 0; while (s < n && !corner(s)) s++; if (s === n) s = 0; // a ring without corners (a round tower) is one run
  const out = [];
  for (let k = 0; k < n;) {
    let m = 0, len = 0; do len += L[(s + k + m++) % n]; while (k + m < n && !corner((s + k + m) % n));
    const f = len < 0.6 * bay ? 0 : Math.max(1, Math.round(len / bay)) / len;
    for (let j = 0; j < m; j++) { const i = (s + k + j) % n; out[i] = [u, u += L[i] * f]; }
    u = Math.round(u); k += m;
  }
  return out;
}

// Levels photo pixels (RGBA bytes, in place) so each channel averages target (0–1), with the spread around it scaled by
// contrast: the building colour then gives the hue and the photo only the surface.
export function levelPhoto(d, target, contrast = 1) {
  const m = [0, 0, 0], n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; }
  for (let c = 0; c < 3; c++) m[c] = m[c] / n || 1;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round(target * 255 * (1 + contrast * (d[i + c] / m[c] - 1)))));
  return d;
}

// The wall atlas: one 256 px column per FACADES style, the ground floor in the bottom row and upper floors above it. Drawn
// twice: layer 'color' (wall areas light grey, multiplied by the building colour and the photo surface) and layer 'mask'
// (R: keeps its own colour, G: window glass, B: the style's share of lit windows).
export const ATLAS_CELL = 256;
export function wallAtlas(ctx, layer) {
  const S = ATLAS_CELL, color = layer === 'color';
  FACADES.forEach(([name, floor, bay, lit], col) => [true, false].forEach(ground => {
    ctx.save(); ctx.translate(col * S, ground ? S : 0);
    const sx = S / bay, sy = S / floor, B = Math.round(lit * 255);
    // kind 0: wall (grey level g, takes the building colour), 1: trim with its own colour, 2: glass. Metres, y down from the ceiling.
    const R = (kind, c, x, y, w, h) => { ctx.fillStyle = color ? (typeof c === 'number' ? `rgb(${c * 255},${c * 255},${c * 255})` : c) : `rgb(${kind ? 255 : 0},${kind === 2 ? 255 : 0},${B})`; ctx.fillRect(x * sx, y * sy, w * sx, h * sy); };
    const shade = (a, x, y, w, h) => { if (color) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(x * sx, y * sy, w * sx, h * sy); } };
    const fade = (a, x, y, w, h) => { if (!color) return; const g = ctx.createLinearGradient(0, y * sy, 0, (y + h) * sy); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x * sx, y * sy, w * sx, h * sy); };
    const glass = (x, y, w, h, top = '#8ea3b0', bottom = '#2c3942') => {
      if (!color) return R(2, 0, x, y, w, h);
      const g = ctx.createLinearGradient(0, y * sy, 0, (y + h) * sy); g.addColorStop(0, top); g.addColorStop(0.45, '#4d5f6b'); g.addColorStop(1, bottom);
      R(2, g, x, y, w, h); shade(0.25, x, y, w, 0.06);
    };
    // a framed window with mullions (cols lights across, a transom tr metres below its top) and a sill that streaks the wall below
    const win = (x, y, w, h, { frame = '#e9e8e3', f = 0.07, cols = 2, tr = 0, sill = '#cfcac0', streaks = true } = {}) => {
      R(0, 0.5, x, y, w, h); x += 0.06; y += 0.07; w -= 0.09; h -= 0.08; // the reveal: the frame sits back in a shaded opening
      R(1, frame, x, y, w, h); glass(x + f, y + f, w - 2 * f, h - 2 * f);
      for (let i = 1; i < cols; i++) R(1, frame, x + w * i / cols - f / 2, y, f, h);
      if (tr) R(1, frame, x, y + tr, w, f);
      if (sill) { R(typeof sill === 'number' ? 0 : 1, sill, x - 0.08, y + h, w + 0.16, 0.06); shade(0.18, x - 0.06, y + h + 0.06, w + 0.12, 0.04); }
      if (streaks) for (const sx0 of [x - 0.04, x + w - 0.02]) fade(0.13, sx0, y + h + 0.06, 0.07, floor - y - h);
    };
    const plinth = (h, c = 0.6, kind = 0) => { R(kind, c, 0, floor - h, bay, h); R(kind, typeof c === 'number' ? Math.min(1, c + 0.15) : c, 0, floor - h, bay, 0.04); fade(0.2, 0, floor - h - 0.7, bay, 0.7); };
    R(0, 0.93, 0, 0, bay, floor);
    if (name === 'house') { win(0.95, 0.55, 1.1, 1.4, { tr: 0.38 }); if (ground) plinth(0.45); }
    else if (name === 'brick') {
      R(0, 0.97, 0, 0, bay, floor); R(0, 0.68, 0.85, 0.32, 1.3, 0.22); // soldier course over the window
      win(0.95, 0.55, 1.1, 1.45, { frame: '#efeee9', tr: 0.38, sill: '#bfb9ae' }); if (ground) plinth(0.4, '#8f8b84', 1);
    } else if (name === 'panel') {
      R(0, 0.72, 0, 0, bay, 0.03); R(0, 0.75, 0, 0, 0.03, floor); R(0, 0.75, 3.1, 0, 0.03, floor); // panel joints
      win(0.8, 0.6, 1.5, 1.45, { cols: 3, f: 0.06 });
      if (ground) { plinth(0.6, '#9d9a94', 1); }
      else { // loggia: a dark recess, the balcony door and window behind a parapet panel
        R(0, 0.42, 3.35, 0.12, 2.6, 2.63); R(1, '#e4e3de', 3.6, 0.42, 0.85, 2.0); glass(3.66, 0.48, 0.73, 1.9); R(1, '#e4e3de', 4.6, 0.42, 1.15, 1.25); glass(4.66, 0.48, 1.03, 1.13);
        R(0, 0.86, 3.25, 1.6, 2.8, 1.15); R(0, 1, 3.25, 1.6, 2.8, 0.05); shade(0.12, 3.25, 2.7, 2.8, 0.05);
      }
    } else if (name === 'classic') {
      R(0, 0.86, 0, 0, bay, floor);
      if (ground) { for (let y = 0.4; y < floor - 0.5; y += 0.42) { R(0, 0.68, 0, y, bay, 0.035); R(0, 0.97, 0, y + 0.035, bay, 0.02); } win(0.78, 0.6, 1.14, 2.25, { frame: '#d8d3c8', f: 0.08, tr: 0.55, sill: 0.98 }); plinth(0.5, '#9b968c', 1); }
      else {
        R(0, 1, 0, 0, bay, 0.16); shade(0.25, 0, 0.16, bay, 0.035); // string course
        R(0, 0.98, 0.66, 0.63, 1.38, 2.36); shade(0.12, 0.66, 0.63, 0.06, 2.36); // surround
        R(0, 1, 0.56, 0.42, 1.58, 0.18); shade(0.3, 0.56, 0.6, 1.58, 0.04); // cornice over the window
        win(0.78, 0.75, 1.14, 2.1, { frame: '#d8d3c8', f: 0.08, tr: 0.5, sill: 0.98 });
      }
    } else if (name === 'office') {
      R(0, 0.9, 0, 0, bay, floor);
      const top = ground ? 0.25 : 0.4, h = ground ? floor - 0.45 : 2.45;
      glass(0, top, bay, h, '#97abb6', '#26323a'); R(1, '#54595c', 0, top, 0.045, h); R(1, '#54595c', bay - 0.045, top, 0.045, h); R(1, '#54595c', 0, top + h - 0.05, bay, 0.05);
      if (ground) plinth(0.2, '#3d3d3f', 1); else shade(0.2, 0, top + h, bay, 0.04);
    } else if (name === 'glass') {
      glass(0, 0, bay, ground ? floor : floor - 0.4, '#7f9cab', '#2a3d49'); if (!ground) R(1, '#34414b', 0, floor - 0.4, bay, 0.4);
      R(1, '#8a9197', 0, 0, 0.04, floor); R(1, '#8a9197', bay - 0.04, 0, 0.04, floor); R(1, '#8a9197', 0, 0, bay, 0.03);
      if (ground) { R(1, '#8a9197', 0, 2.6, bay, 0.05); plinth(0.12, '#2f3133', 1); }
    } else if (name === 'industrial') {
      if (ground) plinth(0.9, '#a09d97', 1);
      else { R(1, '#7d8287', 0.3, 0.4, 3.9, 0.8); for (let x = 0.36; x < 4.1; x += 0.63) glass(x, 0.46, 0.57, 0.68, '#b9c4c8', '#7d8a90'); fade(0.15, 0.3, 1.2, 3.9, 1.5); }
    } else if (name === 'mansard') { // zinc with standing seams, and a dormer with a stepped stone cap, its window low on the slope
      for (let x = 0.12; x < bay; x += 0.45) R(0, 0.78, x, 0, 0.025, floor);
      R(1, '#e4dfd4', 0.92, 0.36, 0.86, 0.1); R(1, '#e4dfd4', 0.74, 0.46, 1.22, 0.14); shade(0.35, 0.74, 0.6, 1.22, 0.05);
      R(0, 0.55, 0.82, 0.6, 1.06, 1.95); win(0.88, 0.72, 0.94, 1.6, { frame: '#ecebe6', tr: 0.42, sill: '#d9d4c9', streaks: false });
      shade(0.3, 0.82, 2.55, 1.06, 0.12);
    } else if (ground) plinth(0.35);
    ctx.restore();
  }));
}

// One face spans a straight run of the footprint, including nodes inserted to mark entrances.
export function facadeWalls(ring, winding, courtyard = false) {
  const corners = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length], b = ring[(i + 1) % ring.length];
    const ax = p[0] - a[0], az = p[1] - a[1], bx = b[0] - p[0], bz = b[1] - p[1];
    return ax * bx + az * bz <= 0 || Math.abs(ax * bz - az * bx) > 0.015 * Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const walls = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1.2) continue;
    const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
    walls.push({ a, b, dx, dz, nx: winding * dz, nz: -winding * dx, length, courtyard });
  }
  return walls;
}

function alongWall(wall, p) {
  const x = p[0] - wall.a[0], z = p[1] - wall.a[1];
  const along = x * wall.dx + z * wall.dz;
  if (along < -0.08 || along > wall.length + 0.08 || Math.abs(x * wall.nx + z * wall.nz) > 0.08) return null;
  return along;
}

export function onOutline(wall, outline) {
  return outline.some(edge => edge.nx * wall.nx + edge.nz * wall.nz > 0.99 &&
    alongWall(edge, wall.a) !== null && alongWall(edge, wall.b) !== null);
}

export function isRetail(tags) {
  return ['retail', 'supermarket', 'kiosk'].includes(tags['building:use']) ||
    ['retail', 'supermarket', 'kiosk'].includes(tags.building) ||
    ['retail', 'supermarket', 'kiosk'].includes(tags['building:part']) ||
    Boolean(tags.shop && !['no', 'vacant', 'closed', 'disused'].includes(tags.shop));
}

// The score is distance to a street in front of the wall. Lower scores are better.
export function planFronts(walls, entrances, streetScore) {
  const faces = walls.map(wall => ({
    wall, doors: [], score: wall.courtyard ? Infinity : streetScore(wall)
  }));
  for (const p of entrances) {
    let best = null, center = 0, bestClearance = -Infinity;
    for (const face of faces) {
      const along = alongWall(face.wall, p);
      if (along === null) continue;
      const clearance = Math.min(along, face.wall.length - along);
      if (clearance > bestClearance || (clearance === bestClearance && face.score < best.score)) {
        best = face;
        center = Math.max(0.59, Math.min(face.wall.length - 0.59, along));
        bestClearance = clearance;
      }
    }
    if (best && best.doors.every(d => Math.abs(d - center) >= 1.12)) best.doors.push(center);
  }
  if (!entrances.length) {
    let front;
    for (const f of faces) if (f.wall.infer && Number.isFinite(f.score) && (!front || f.score < front.score)) front = f;
    if (front) front.doors.push(front.wall.length / 2);
  }
  for (const face of faces) {
    face.shop = face.wall.retail && !face.wall.courtyard && (Number.isFinite(face.score) || face.doors.length > 0);
    face.doors.sort((a,b) => a-b);
  }
  return faces.filter(face => face.shop || face.doors.length);
}

// Store each bay separately so a mapped entrance can split a row of display windows.
export function shopBays(length, doors) {
  const bays = [];
  function fill(start, end) {
    const span = end - start;
    if (span < 1.2) return;
    const count = Math.min(40, Math.max(1, Math.round(span / 2.8)));
    for (let i = 0; i < count; i++) bays.push([start + span * i / count, start + span * (i + 1) / count]);
  }
  let start = 0.12;
  for (const door of doors) {
    fill(start, door - 0.58);
    start = door + 0.58;
  }
  fill(start, length - 0.12);
  return bays;
}

// Four atlas tiles: timber door, glazed shop door, dark display bay and lit display bay.
export function facadeAtlas(ctx, emissive) {
  const tile = 128;
  for (let index = 0; index < 4; index++) {
    ctx.save();
    ctx.translate(index * tile, 0);
    const rect = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    rect(emissive ? '#000' : '#344348', 0, 0, tile, tile);
    if (index === 0) {
      if (!emissive) {
        rect('#887a69', 5, 2, 118, 126);
        rect('#544139', 11, 6, 106, 119);
        rect('#90a4a6', 21, 15, 86, 33);
        rect('#684c3c', 20, 57, 88, 61);
        rect('#b1a494', 92, 66, 14, 3);
      }
    } else {
      const door = index === 1;
      const luminous = emissive && index !== 2;
      if (!emissive || luminous) {
        const glass = ctx.createLinearGradient(0, 10, 0, 108);
        glass.addColorStop(0, emissive ? '#e8b983' : '#90aaab');
        glass.addColorStop(0.64, emissive ? '#c19365' : '#647a79');
        glass.addColorStop(1, emissive ? '#5b4837' : '#394c50');
        ctx.fillStyle = glass;
        ctx.fillRect(5, 6, 118, door ? 106 : 100);
        if (!door) {
          // The display shelf and objects read as silhouettes behind the glass at night.
          for (const [x, y, w, h] of [[11,77,14,12],[29,67,9,22],[45,73,16,16],[76,70,12,19],[94,79,18,10]]) {
            rect(emissive ? '#504438' : '#74756b', x, y, w, h);
          }
          rect(emissive ? '#473729' : '#4b5150', 5, 89, 118, 4);
        }
        const frame = emissive ? '#000' : '#314246';
        rect(frame, 5, 27, 118, 3);
        if (!door) rect(frame, 64, 5, 3, 102);
        else rect(emissive ? '#000' : '#bcc1b8', 101, 57, 4, 24);
      }
      if (!emissive && !door) rect('#b3a998', 1, 108, 126, 6);
    }
    ctx.restore();
  }
}
