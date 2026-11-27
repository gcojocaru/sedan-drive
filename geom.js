// Pure geometry on plain arrays: points are [x, z] in metres (x east, z south), 3D points [x, y, z].
// No three.js and no DOM, so all of it runs (and is tested) in Node.

export const same = (a, b) => a[0] === b[0] && a[1] === b[1];
export function joinRings(parts) {
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
export function inPoly(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}
export function polyArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); }
export function bbox(r) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of r) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; } return { x0, z0, x1, z1 }; }
export const seeded = seed => { let s = Math.abs(Math.floor(seed)) % 2147483646 + 1; return () => (s = s * 16807 % 2147483647) / 2147483647; };

export const newBuf = () => ({ p: [] });
export function tri(B, a, b, c, y) { if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { const t = b; b = c; c = t; } B.p.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); }
export function quad(B, a, b, c, d, y) { tri(B, a, b, c, y); tri(B, a, c, d, y); }
export function disc(B, c, r, y, seg = 16) {
  for (let i = 0; i < seg; i++) { const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2; tri(B, c, [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r], y); }
}
export function sides(g, hw) { // mitred left/right offset polylines (negative hw swaps sides)
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
export function ribbon(B, g, hw, y, caps) {
  const n = g.length; if (n < 2) return;
  const [Lp, Rp] = sides(g, hw);
  for (let i = 0; i < n - 1; i++) quad(B, Lp[i], Rp[i], Rp[i + 1], Lp[i + 1], y);
  if (caps) { disc(B, g[0], hw, y); disc(B, g[n - 1], hw, y); }
}
export const offsetLine = (g, off) => sides(g, off)[0];
export function cumLen(g) { const c = [0]; for (let i = 1; i < g.length; i++) c.push(c[i - 1] + Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1])); return c; }
// The part of polyline g from a m along it to b m before its end
export function trimLine(g, a, b) {
  const c = cumLen(g), hi = Math.max(a, c.at(-1) - b);
  const at = s => { let i = 1; while (i < g.length - 1 && c[i] < s) i++; const t = Math.min(1, (s - c[i - 1]) / (c[i] - c[i - 1] || 1)); return [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t]; };
  const out = [at(a)];
  for (let i = 1; i < g.length - 1; i++) if (c[i] > a + 0.01 && c[i] < hi - 0.01) out.push(g[i]);
  out.push(at(hi));
  return out;
}
// The point s m along polyline g (cum = cumLen(g)), clamped to it, and the direction there: [x, z, ux, uz]
export function pointAt(g, cum, s) {
  let i = 1; while (i < g.length - 1 && cum[i] < s) i++;
  const a = g[i - 1], b = g[i], L = cum[i] - cum[i - 1], t = L ? Math.max(0, Math.min(1, (s - cum[i - 1]) / L)) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, L ? (b[0] - a[0]) / L : 0, L ? (b[1] - a[1]) / L : 0];
}
export function densify(g, step) { const o = [g[0]]; for (let i = 1; i < g.length; i++) { const a = g[i - 1], b = g[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 1; k <= n; k++) o.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); } return o; }
export function runs(g, ok) { // split a polyline into the pieces whose segment midpoints pass ok(x, z)
  const out = []; let cur = null;
  for (let i = 0; i < g.length - 1; i++) { const a = g[i], b = g[i + 1]; if (ok((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) { if (!cur) out.push(cur = [a]); cur.push(b); } else cur = null; }
  return out;
}
export function openRing(r) { const o = []; for (const p of r) if (!o.length || !same(o[o.length - 1], p)) o.push(p); if (o.length > 1 && same(o[0], o[o.length - 1])) o.pop(); return o; }
export function signedArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
// an open ring with every edge moved outward by d (inward when d < 0); corners are mitred, the mitre capped at 2|d|
// d: metres for every edge, or a list with one per edge (edge i runs from r[i] to r[i + 1]; 0 leaves it in place)
export function offsetRing(r, d) {
  const n = r.length, k = signedArea(r) > 0 ? 1 : -1, N = r.map((a, i) => { const b = r[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [k * dz / L, -k * dx / L]; });
  return r.map((p, i) => {
    const A = N[(i + n - 1) % n], B = N[i], da = d[(i + n - 1) % n] ?? d, db = d[i] ?? d;
    if (da !== db) { // where the two moved edges cross (capped at 2d like a mitre), or halfway when they are nearly in line
      const det = A[0] * B[1] - A[1] * B[0];
      if (Math.abs(det) < 0.2) return [p[0] + (A[0] * da + B[0] * db) / 2, p[1] + (A[1] * da + B[1] * db) / 2];
      const x = (da * B[1] - A[1] * db) / det, z = (A[0] * db - da * B[0]) / det, s = Math.min(1, 2 * Math.max(Math.abs(da), Math.abs(db)) / Math.hypot(x, z));
      return [p[0] + x * s, p[1] + z * s];
    }
    const mx = A[0] + B[0], mz = A[1] + B[1], c = 1 + A[0] * B[0] + A[1] * B[1]; // c = |m|² / 2
    const s = c < 0.5 ? 2 * da / Math.sqrt(2 * c || 1) : da / c;
    return [p[0] + mx * s, p[1] + mz * s];
  });
}
export function obb(r) { // minimum-area oriented box: centre, long axis (ux,uz), half length hl >= half width hw
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
export function clipHalf(P, a, b, c) { // keep the part of polygon P where a + b*x + c*z <= 0
  const o = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], gp = a + b * p[0] + c * p[1], gq = a + b * q[0] + c * q[1];
    if (gp <= 0) o.push(p);
    if ((gp <= 0) !== (gq <= 0)) { const t = gp / (gp - gq); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return o;
}
// 3D buffers {p, n, c[, uv]}: tri3 flips the winding so the face points along n; ao darkens vertices near the ground
export function tri3(B, A, Bv, C, n, col, ao, uv) {
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
export function quad3(B, a, b, c, d, n, col, ao, uv) { tri3(B, a, b, c, n, col, ao, uv && [uv[0], uv[1], uv[2]]); tri3(B, a, c, d, n, col, ao, uv && [uv[0], uv[2], uv[3]]); }
export function wallStrip(B, g, th, y0, y1, col) { // a solid wall/hedge of thickness th along polyline g
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
export function fenceStrip(B, g, y0, y1, col) { // see-through fence/railing: one double-sided quad per segment
  const cum = cumLen(g);
  for (let i = 0; i < g.length - 1; i++) {
    const a = g[i], b = g[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, u0 = cum[i] / (y1 - y0) * 0.5, u1 = cum[i + 1] / (y1 - y0) * 0.5;
    quad3(B, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [-dz / L, 0, dx / L], col, false, [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
  }
}
// Sea polygons from OSM coastline ways (land on the left, water on the right). The coast is clipped to the
// data box ±B, its loose ends are extended straight out to ±B2 so the sea carries on past the map area, and the
// pieces are closed by walking clockwise along the box. Works in (east, north) = (x, -z).
export function seaPolys(coast, B, B2) {
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

export const gkey = (i, j) => i * 65536 + j;
export const segDist = (x, z, s) => { const t = Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.l2)); return [Math.hypot(x - s.ax - s.dx * t, z - s.az - s.dz * t), t]; };
// round obstacles [x, z, r, y0, y1] (m) in a grid of `cell` m: near(x, z, y, pad) says whether (x, z) lies within
// r + pad of one that spans height y. r + pad must stay under the cell size.
export function pointGrid(points, cell = 4) {
  const g = new Map(), at = (i, j) => g.get(gkey(i, j)) || [];
  for (const p of points) { const k = gkey(Math.floor(p[0] / cell), Math.floor(p[1] / cell)); let c = g.get(k); if (!c) g.set(k, c = []); c.push(p); }
  return {
    near(x, z, y, pad = 0) {
      const i = Math.floor(x / cell), j = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const p of at(i + a, j + b)) if (y >= p[3] && y <= p[4] && (p[0] - x) ** 2 + (p[1] - z) ** 2 < (p[2] + pad) ** 2) return true;
      return false;
    }
  };
}
// A buffer of separate triangles (B.p: x, y, z per vertex, plus per-vertex attributes in `sizes` that it has) split into
// square tiles `size` m wide by each triangle's centre: Map(tile key → buffer of the same shape). One mesh per tile lets
// the renderer skip the tiles out of view and out of the shadow box, instead of drawing the whole area every pass.
export function splitByTile(B, size, sizes = { p: 3, n: 3, c: 3, uv: 2, f: 2 }) {
  const out = new Map(), keys = Object.keys(sizes).filter(k => B[k]?.length);
  for (let t = 0, n = B.p.length / 9; t < n; t++) {
    const p = B.p, i = t * 9, k = gkey(Math.floor((p[i] + p[i + 3] + p[i + 6]) / 3 / size), Math.floor((p[i + 2] + p[i + 5] + p[i + 8]) / 3 / size));
    let T = out.get(k); if (!T) out.set(k, T = Object.fromEntries(keys.map(a => [a, []])));
    for (const a of keys) { const w = 3 * sizes[a]; for (let j = t * w; j < t * w + w; j++) T[a].push(B[a][j]); }
  }
  return out;
}
