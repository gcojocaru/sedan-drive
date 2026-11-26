// The world is in metres, with east along +x and south along +z.
const SPAN = 240;
const WATER = '#35637a';
const LAND = { park: '#345747', forest: '#2b4e40', scrub: '#395547', pitch: '#40664f', parking: '#474e53' };

export function minimapView(x, z, heading, half) {
  return { left: half + x - SPAN / 2, top: half + z - SPAN / 2, span: SPAN, rotation: Math.PI / 2 - heading };
}

function trace(ctx, points) {
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
}

function fillArea(ctx, area, color) {
  ctx.beginPath();
  trace(ctx, area.outer);
  ctx.closePath();
  for (const ring of area.holes) {
    trace(ctx, ring);
    ctx.closePath();
  }
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}

function strokeWay(ctx, way, color, minWidth) {
  ctx.beginPath();
  trace(ctx, way.g);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(minWidth, way.hw * 2);
  ctx.stroke();
}

function drawWorld(canvas, half, { polys, seas, rivers, buildings, paths, roads }) {
  // One pixel per metre. The canvas clips geometry that extends outside the playable area.
  canvas.width = canvas.height = 2 * half;
  const ctx = canvas.getContext('2d');
  ctx.translate(half, half);
  ctx.fillStyle = '#253237';
  ctx.fillRect(-half, -half, canvas.width, canvas.height);
  for (const p of polys) if (LAND[p.kind]) fillArea(ctx, p, LAND[p.kind]);
  for (const p of polys) if (p.kind === 'water') fillArea(ctx, p, WATER);
  for (const p of seas) fillArea(ctx, p, WATER);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const r of rivers) strokeWay(ctx, r, WATER, 2);
  for (const b of buildings) fillArea(ctx, b, '#506067');
  for (const p of paths) strokeWay(ctx, p, '#75817c', 2);
  for (const r of roads) strokeWay(ctx, r, r.type === 'service' ? '#8d9b9b' : '#b9c6c3', 4);
  ctx.strokeStyle = '#a99b82';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 5]);
  ctx.strokeRect(-half + 1, -half + 1, canvas.width - 2, canvas.height - 2);
}

export function createMinimap(canvas, base, half, geometry) {
  drawWorld(base, half, geometry);
  const ctx = canvas.getContext('2d');
  const size = 180; // drawing units, independent of the display's CSS size
  ctx.scale(canvas.width / size, canvas.height / size);
  let lastX, lastZ, lastHeading, lastTarget;
  return (x, z, heading, target = null) => {
    if (x === lastX && z === lastZ && heading === lastHeading && target === lastTarget) return;
    lastX = x; lastZ = z; lastHeading = heading; lastTarget = target;
    const { left, top, span, rotation } = minimapView(x, z, heading, half);
    ctx.fillStyle = '#151d21';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(base, left, top, span, span, 0, 0, size, size);

    const bar = 50 * size / span;
    ctx.fillStyle = '#172126';
    ctx.fillRect(6, size - 19, bar + 36, 15);
    ctx.fillStyle = '#e6edeb';
    ctx.fillRect(10, size - 10, bar, 2);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('50 m', 15 + bar, size - 8);

    if (target) {
      const dx = (target.x-x)*size/span, dz = (target.z-z)*size/span;
      const scale = Math.min(1, (size/2-13)/(Math.max(Math.abs(dx),Math.abs(dz)) || 1));
      ctx.save();
      ctx.translate(size/2 + dx*scale, size/2 + dz*scale);
      ctx.beginPath();
      if (scale < 1) {
        ctx.rotate(Math.atan2(dz,dx));
        ctx.moveTo(8,0); ctx.lineTo(-5,-6); ctx.lineTo(-5,6); ctx.closePath();
      } else ctx.arc(0,0,7,0,Math.PI*2);
      ctx.fillStyle = '#68e6d3'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#102d2c'; ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 5); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = '#172026';
    ctx.stroke();
    ctx.fillStyle = '#ffbd66';
    ctx.fill();
    ctx.restore();


  };
}
