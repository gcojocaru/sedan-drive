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
