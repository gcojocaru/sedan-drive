// A masked photographic sky dome. Only the cloud layer is photographed; the
// horizon, solar disc and weather tint follow the location's current lighting.
const photo = new Image();
photo.src = new URL('./textures/cloud-deck.webp', import.meta.url).href;
export const cloudReady = photo.decode().catch(() => {});
let tinted;

export function drawClouds(ctx, sun, cover, haze, shadow, bright) {
  if (!photo.naturalWidth || !cover) return;
  tinted ??= document.createElement('canvas');
  tinted.width = photo.width;
  tinted.height = photo.height;
  const layer = tinted.getContext('2d');
  // Compose colour behind the luminance, then restore the photographic mask.
  layer.drawImage(photo, 0, 0);
  layer.globalCompositeOperation = 'multiply';
  layer.fillStyle = '#' + bright.getHexString();
  layer.fillRect(0, 0, tinted.width, tinted.height);
  layer.globalCompositeOperation = 'screen';
  layer.globalAlpha = 0.52;
  layer.fillStyle = '#' + shadow.getHexString();
  layer.fillRect(0, 0, tinted.width, tinted.height);
  layer.globalAlpha = 1;
  layer.globalCompositeOperation = 'destination-in';
  layer.drawImage(photo, 0, 0);
  const w = ctx.canvas.width,
    h = ctx.canvas.height / 2;
  const shift = Math.round(w * (Math.atan2(sun.z, sun.x) / (2 * Math.PI) + 0.5 - 0.598));
  ctx.save();
  ctx.globalAlpha = Math.min(1, cover * 2.2) * (1 - 0.66 * haze);
  for (const dx of [-w, 0, w]) ctx.drawImage(tinted, shift + dx, 0, w, h);
  ctx.restore();
}
