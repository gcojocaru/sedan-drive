// Exterior-only bodies for the instanced street fleet. Local +x is forward.
// The shared axles and wheel radius match groundPose and the traffic footprint.
import * as THREE from 'three';
import { makeTex } from './world-kit.js';
import { mergeGeometries } from './vendor/three-0.184.0/examples/jsm/utils/BufferGeometryUtils.js';

export const FLEET = [
  { name: 'saloon', rear: -2.19, backGlass: -1.51, roofBack: -0.91, roofFront: 0.36, roof: 1.45, belt: 0.91 },
  { name: 'hatchback', rear: -1.97, backGlass: -1.88, roofBack: -1.56, roofFront: 0.32, roof: 1.49, belt: 0.88 },
  { name: 'estate', rear: -2.21, backGlass: -2.09, roofBack: -1.81, roofFront: 0.34, roof: 1.53, belt: 0.94 },
];
export const AXLES = [-1.31, 1.32],
  TYRE_RADIUS = 0.308;
const front = 2.16,
  halfWidth = 0.854;

function box(x, y, z, w, h, d) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function collect(glazing = false) {
  const parts = [];
  return {
    add(geometry, hex = '#ffffff') {
      const g = geometry;
      if (!glazing) g.deleteAttribute('uv');
      const c = new THREE.Color(hex),
        values = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < values.length; i += 3) c.toArray(values, i);
      g.setAttribute('color', new THREE.BufferAttribute(values, 3));
      parts.push(g);
    },
    finish: () => mergeGeometries(parts),
  };
}

// A strip of four-sided faces. Shared vertices along its length smooth the
// shoulder and fender highlights while preserving the creases between strips.
function strip(rows) {
  const positions = rows.flat(2),
    indices = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const j = i * 2;
    indices.push(j, j + 2, j + 1, j + 1, j + 2, j + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function bodyShell(body, model) {
  const xs = [model.rear, model.rear + 0.1, model.rear + 0.2, -0.6, 0.6, 1.88, 2.07, front];
  for (const axle of AXLES) for (let i = 0; i <= 12; i++) xs.push(axle + 0.366 * Math.cos((Math.PI * i) / 12));
  xs.sort((a, b) => a - b);
  const rings = xs.map((x) => {
    const end = Math.min(x - model.rear, front - x);
    const w = halfWidth - 0.022 * Math.max(0, 1 - (x / 1.1) ** 2) - 0.105 * (1 - Math.min(1, end / 0.35)) ** 2;
    const shoulder = model.belt - 0.11 * Math.max(0, (x - 1.08) / (front - 1.08)) - 0.06 * (1 - Math.min(1, end / 0.24));
    const fromAxle = Math.min(...AXLES.map((a) => Math.abs(x - a)));
    const sill = fromAxle <= 0.366001 ? 0.31 + Math.sqrt(Math.max(0, 0.366 ** 2 - fromAxle ** 2)) : 0.28;
    const profile = [
      [sill, -w + 0.045],
      [sill, w - 0.045],
      [sill + 0.036, w - 0.02],
      [Math.max(sill + 0.047, shoulder - 0.18), w - 0.006],
      [shoulder - 0.055, w],
      [shoulder, w - 0.035],
      [shoulder + 0.035, w - 0.15],
      [shoulder + 0.047, 0],
      [shoulder + 0.035, -w + 0.15],
      [shoulder, -w + 0.035],
      [shoulder - 0.055, -w],
      [Math.max(sill + 0.047, shoulder - 0.18), -w + 0.006],
      [sill + 0.036, -w + 0.02],
    ];
    return profile.map(([y, z]) => [x, y, z]);
  });
  for (let side = 0; side < rings[0].length; side++) body.add(strip(rings.map((r) => [r[side], r[(side + 1) % r.length]])));
  // End caps share the stamped end profile of the shell.
  for (const ring of [rings[0], rings.at(-1)]) {
    const face = new THREE.Shape(ring.map(([, y, z]) => new THREE.Vector2(z, y)));
    const cap = new THREE.ShapeGeometry(face).rotateY(-Math.PI / 2);
    if (ring === rings.at(-1)) {
      const ids = cap.index.array;
      for (let i = 0; i < ids.length; i += 3) [ids[i + 1], ids[i + 2]] = [ids[i + 2], ids[i + 1]];
      cap.computeVertexNormals();
    }
    body.add(cap.translate(ring[0][0], 0, 0));
  }
}

const lerp = THREE.MathUtils.lerp;
function cabin(body, glass, detail, m) {
  const rearBase = m.backGlass,
    noseBase = 1.09,
    lower = m.belt + 0.014,
    upper = m.roof;
  // Trapezoidal side glazing tapers in towards the roof. The surrounding shell
  // supplies real A/C pillars; the dark gasket and B pillar sit over it.
  function side(s, u, v, offset = 0) {
    return [
      lerp(lerp(rearBase, noseBase, u), lerp(m.roofBack, m.roofFront, u), v),
      lerp(lower, upper, v),
      s * (lerp(0.8, 0.654, v) + offset),
    ];
  }
  // p returns points in (u,v) order. Reverse a patch whose winding faces inward.
  function panel(batch, p, left, right, bottom, top, axis, sign, tint) {
    const a = p(left, bottom),
      b = p(right, bottom),
      c = p(left, top),
      d = p(right, top);
    const g = strip([
      [a, c],
      [b, d],
    ]);
    if (g.attributes.normal.array[axis] * sign < 0) {
      g.setIndex([0, 1, 2, 1, 3, 2]);
      g.computeVertexNormals();
    }
    if (batch === glass) {
      // Half of the atlas looks through a side door, half through the rear/front glass.
      const offset = axis === 2 ? 0 : 0.5;
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          [offset + 0.002, 0.003, offset + 0.002, 0.997, offset + 0.498, 0.003, offset + 0.498, 0.997],
          2,
        ),
      );
    }
    batch.add(g, tint);
  }
  for (const s of [-1, 1]) {
    panel(body, (u, v) => side(s, u, v), 0, 1, 0, 1, 2, s);
    panel(detail, (u, v) => side(s, u, v, 0.004), 0.042, 0.971, 0.055, 0.95, 2, s, '#24292b');
    const windows =
      m.name === 'saloon'
        ? [
            [0.084, 0.49],
            [0.527, 0.946],
          ]
        : [
            [0.065, 0.219],
            [0.243, 0.52],
            [0.555, 0.946],
          ];
    for (const [a, b] of windows) panel(glass, (u, v) => side(s, u, v, 0.008), a, b, 0.089, 0.919, 2, s);
    // A narrow bright belt moulding under the glass reads at crossing distance.
    panel(detail, (u, v) => side(s, u, v, 0.011), 0.043, 0.965, 0.036, 0.055, 2, s, '#929a9a');
    // Door shut lines follow the shoulder into the narrower rocker panel.
    const seam = (x, y) =>
      s * (halfWidth - 0.022 * Math.max(0, 1 - (x / 1.1) ** 2) - 0.02 * Math.max(0, (m.belt - 0.16 - y) / 0.46) + 0.003);
    const joint = (x, y, base) => {
      const rows = [
        [x, y],
        [x - 0.003, y - 0.16],
        [base, 0.38],
      ].map(([px, py]) => [
        [px, py, seam(px, py)],
        [px + 0.014, py, seam(px + 0.014, py)],
      ]);
      if (s < 0) rows.reverse();
      detail.add(strip(rows), '#44484a');
    };
    joint(0.09, m.belt - 0.05, 0.03);
    joint(0.95, m.belt - 0.09, 0.87);
    for (const u of [0.19, 0.58]) {
      const x = lerp(rearBase, noseBase, u);
      detail.add(box(x, m.belt - 0.105, seam(x, m.belt - 0.105), 0.148, 0.034, 0.028), '#4e5251');
    }
    detail.add(box(0.74, lower + 0.088, s * 0.837, 0.12, 0.044, 0.125), '#272c2e');
    body.add(new THREE.SphereGeometry(1, 8, 5).scale(0.117, 0.072, 0.092).translate(0.7, lower + 0.11, s * 0.902));
  }
  for (const [u, sign] of [
    [0, -1],
    [1, 1],
  ]) {
    const wind = (w, v, offset = 0) => {
      const [x, y, z] = side(1, u, v);
      return [x + sign * offset, y, lerp(-z, z, w)];
    };
    panel(body, wind, 0, 1, 0, 1, 0, sign);
    panel(detail, (w, v) => wind(w, v, 0.006), 0.025, 0.975, 0.028, 0.972, 0, sign, '#252b2b');
    panel(glass, (w, v) => wind(w, v, 0.01), 0.049, 0.951, 0.065, 0.945, 0, sign);
    if (sign < 0) {
      for (let i = 1; i <= 5; i++) {
        const v = 0.18 + i * 0.105;
        panel(detail, (w, t) => wind(w, t, 0.011), 0.09, 0.91, v, v + 0.006, 0, sign, '#585349');
      }
    }
  }
  body.add(
    strip([
      [side(1, 0, 1), side(-1, 0, 1)],
      [side(1, 1, 1), side(-1, 1, 1)],
    ]),
  );
  if (m.name === 'estate')
    for (const s of [-1, 1]) {
      for (const x of [-1.46, 0.1]) detail.add(box(x, upper + 0.027, s * 0.54, 0.1, 0.06, 0.047), '#292e31');
      detail.add(box(-0.68, upper + 0.075, s * 0.54, 1.71, 0.049, 0.046), '#717978');
    }
}

export function streetCarModel(model) {
  const body = collect(),
    glass = collect(true),
    detail = collect(),
    head = collect(),
    tail = collect();
  bodyShell(body, model);
  cabin(body, glass, detail, model);
  // Bumper inserts, grille slats, license-plate recesses and lamp clusters.
  for (const [x, sign] of [
    [model.rear, -1],
    [front, 1],
  ]) {
    detail.add(box(x, 0.4, 0, 0.06, 0.116, 1.4), '#303235');
    detail.add(box(x + sign * 0.025, 0.565, 0, 0.045, 0.166, 0.47), '#454849');
    detail.add(box(x + sign * 0.053, 0.568, 0, 0.012, 0.116, 0.392), '#d6d6ca');
    for (const z of [-0.11, -0.065, 0.004, 0.05, 0.105])
      detail.add(box(x + sign * 0.061, 0.57, z, 0.005, 0.043, 0.019), '#53595b');
  }
  for (const s of [-1, 1]) {
    for (const x of AXLES) {
      // Recessed wheel-well backing is visible through the gap above the tire.
      detail.add(
        new THREE.CylinderGeometry(0.358, 0.358, 0.065, 12, 1, false, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(x, 0.31, s * 0.62),
        '#272a2c',
      );
    }
    detail.add(box(model.rear + 0.08, model.belt - 0.14, s * 0.758, 0.16, 0.074, 0.043), '#7b191d');
  }
  detail.add(box(model.rear - 0.013, 0.7, 0, 0.036, 0.026, 0.8), '#85898b');
  detail.add(box(model.rear - 0.02, 0.753, 0, 0.032, 0.044, 0.077), '#adb1b4');
  for (let n = 0; n < 3; n++)
    detail.add(box(front + 0.013, 0.645 + n * 0.027, 0, 0.032, 0.015, 0.74), n === 1 ? '#8b9293' : '#333a3e');
  const heads = [],
    tails = [];
  for (const s of [-1, 1]) {
    const z = s * 0.577,
      y = model.belt - 0.151;
    head.add(box(front + 0.009, 0.678, z, 0.053, 0.093, 0.292));
    head.add(box(front - 0.052, 0.678, z + s * 0.129, 0.13, 0.08, 0.056));
    detail.add(box(front + 0.04, 0.68, z + s * 0.088, 0.012, 0.074, 0.023), '#c1aa7e');
    tail.add(box(model.rear - 0.012, y, z, 0.056, 0.104, 0.329));
    detail.add(box(model.rear - 0.042, y - 0.023, z - s * 0.086, 0.008, 0.031, 0.08), '#c8bfb0');
    tail.add(box(model.rear + 0.04, y + 0.006, z + s * 0.148, 0.14, 0.084, 0.052));
    heads.push([front + 0.048, 0.678, z]);
    tails.push([model.rear - 0.052, y, z]);
  }
  return {
    body: body.finish(),
    glass: glass.finish(),
    detail: detail.finish(),
    head: head.finish(),
    tail: tail.finish(),
    heads,
    tails,
  };
}

// One outward-facing alloy and tire, shared by every axle and body style.
export function streetWheel() {
  const wheel = collect();
  const lathe = (profile, hex) =>
    wheel.add(
      new THREE.LatheGeometry(
        profile.map(([r, z]) => new THREE.Vector2(r, z)),
        18,
      ).rotateX(Math.PI / 2),
      hex,
    );
  lathe(
    [
      [0.155, -0.097],
      [0.263, -0.097],
      [0.3, -0.069],
      [TYRE_RADIUS, -0.05],
      [TYRE_RADIUS, 0.05],
      [0.299, 0.078],
      [0.267, 0.103],
      [0.196, 0.104],
      [0.19, 0.088],
    ],
    '#1e2022',
  );
  lathe(
    [
      [0.164, 0.083],
      [0.196, 0.097],
      [0.201, 0.107],
      [0.183, 0.109],
      [0.16, 0.089],
    ],
    '#aeb4b7',
  );
  wheel.add(new THREE.CylinderGeometry(0.167, 0.167, 0.032, 18).rotateX(Math.PI / 2).translate(0, 0, 0.063), '#505456');
  for (let i = 0; i < 5; i++) {
    const spoke = box(0, 0.109, 0.098, 0.049, 0.158, 0.025);
    wheel.add(spoke.rotateZ((i * 2 * Math.PI) / 5), '#afb4b5');
  }
  wheel.add(new THREE.CylinderGeometry(0.052, 0.06, 0.045, 10).rotateX(Math.PI / 2).translate(0, 0, 0.101), '#787e80');
  return wheel.finish();
}

// A view through tinted glass, baked once for the whole fleet: far glazing,
// seat backs and rear shelf. The scene's environment supplies the reflections.
export function cabinTexture() {
  const map = makeTex(512, 160, (ctx) => {
    for (let pane = 0; pane < 2; pane++) {
      ctx.save();
      ctx.translate(pane * 256, 0);
      ctx.beginPath();
      ctx.rect(0, 0, 256, 160);
      ctx.clip();
      const wash = ctx.createLinearGradient(0, 0, 0, 160);
      wash.addColorStop(0, '#5e7987');
      wash.addColorStop(0.45, '#8598a0');
      wash.addColorStop(0.72, '#617174');
      wash.addColorStop(1, '#354344');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, 256, 160);
      ctx.fillStyle = '#445255';
      ctx.beginPath();
      ctx.moveTo(0, 102);
      ctx.lineTo(256, 90);
      ctx.lineTo(256, 160);
      ctx.lineTo(0, 160);
      ctx.fill();
      const seats = pane ? [56, 194] : [84];
      for (const x of seats) {
        ctx.fillStyle = '#404d50';
        ctx.beginPath();
        ctx.roundRect(x - 19, 76, 38, 30, 7);
        ctx.fill();
        ctx.fillStyle = '#454f51';
        ctx.beginPath();
        ctx.roundRect(x - 34, 105, 68, 53, 13);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(173,201,216,.12)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(193, 0);
      ctx.lineTo(22, 140);
      ctx.lineTo(0, 147);
      ctx.fill();
      ctx.restore();
    }
  });
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  return map;
}
