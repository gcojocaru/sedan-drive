// Graphics quality on both drive pages: three tiers, the one picked for this device, and the pixel ratio that keeps the
// frame inside the tier's pixel budget. Pure (no three.js, DOM or storage): the pages pass in what they read.
// pixels: most pixels drawn a frame; msaa: antialias (fixed when the renderer is made, so a change needs a reload);
// shadow: shadow map size; cars, people: most traffic cars and pedestrians at once; drops: rain drops / snowflakes;
// post: post-processing (post-fx.js: glow, grade, FXAA; false: none, the renderer antialiases with MSAA instead); probe: the car's reflection cube size (0 none);
// lampLights: street lamps near the car that really light it (0 none).
export const QUALITY = [
  { name: 'Low', pixels: 0.9e6, msaa: false, shadow: 1024, cars: 30, people: 60, drops: 3500, post: false, probe: 0, lampLights: 0 },
  { name: 'Medium', pixels: 2.0e6, msaa: true, shadow: 2048, cars: 45, people: 90, drops: 6000, post: true, probe: 64, lampLights: 2 },
  { name: 'High', pixels: 3.7e6, msaa: true, shadow: 4096, cars: 100, people: 280, drops: 9000, post: true, probe: 128, lampLights: 3 }
];

// The tier for a device: phones and tablets (coarse pointer) Medium, small ones Low; desktops High unless they have
// four cores or fewer. cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory (GB; not every browser has it).
export const autoQuality = ({ coarse = false, cores = 8, memory = 8 } = {}) => coarse ? (cores <= 4 || memory <= 3 ? 0 : 1) : cores <= 4 ? 1 : 2;

// The stored choice ('auto' or a tier index) → a tier index
export const pickQuality = (stored, device) => Number.isInteger(stored) && QUALITY[stored] ? stored : autoQuality(device);

// The pixel ratio for a w × h canvas: as sharp as the screen allows (at most 1.5) within the tier's pixel budget, never
// below 0.6, times `scale` (dynamic resolution, 1 at most).
export const pixelRatio = (q, dpr, w, h, scale = 1) => Math.max(0.6, Math.min(dpr || 1, 1.5, Math.sqrt(q.pixels / Math.max(1, w * h)))) * scale;

// A window of frame times (ms) → -1 when slow (median over 20 ms: under 50 fps), 1 when holding about 57 fps or
// better (median under 17.6 ms, so 60 Hz screens count), 0 in between.
export function frameVerdict(frames) {
  const s = [...frames].sort((a, b) => a - b), mid = s[s.length >> 1];
  return mid > 20 ? -1 : mid < 17.6 ? 1 : 0;
}

// Dynamic resolution as a frame counter: tick(ms) each frame. Every `every` frames a slow window costs a tenth of the
// resolution (down to 0.7); `patience` good windows in a row win a tenth back. A step back up that turns out too slow
// doubles the patience, so the resolution doesn't keep flipping. apply(scale) is called when the scale changes.
export function dynamicRes(apply, every = 120, patience = 5) {
  let scale = 1, frames = [], good = 0, raised = false;
  return ms => {
    frames.push(ms); if (frames.length < every) return;
    const v = frameVerdict(frames); frames = [];
    if (v < 0) { if (raised) patience *= 2; raised = false; good = 0; if (scale > 0.7) apply(scale = +(scale - 0.1).toFixed(2)); return; }
    raised = false; good = v > 0 ? good + 1 : 0;
    if (good >= patience && scale < 1) { good = 0; raised = true; apply(scale = +(scale + 0.1).toFixed(2)); }
  };
}
