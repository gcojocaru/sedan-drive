// Neighbouring 1 km areas overlap by about 100 m so grid snapping leaves room at the seam.
import { HALF, MARGIN, snap } from './osm-query.js';

const STEP = HALF * 2 - 100;
const METRES_LAT = 110574;
const metresLon = lat => 111320 * Math.cos(lat * Math.PI / 180);
const DIRECTIONS = { west: [-1, 0], east: [1, 0], north: [0, -1], south: [0, 1] };
const COOLDOWN = 30_000;
const KEY = 'sedan-area-cooldown-v1';

export function crossedEdge(x, z) {
  if (Math.max(Math.abs(x), Math.abs(z)) <= HALF) return null;
  if (Math.abs(x) >= Math.abs(z)) return x < 0 ? 'west' : 'east';
  return z < 0 ? 'north' : 'south';
}

export function nextArea(lat, lon, direction, pose) {
  const [dx, dz] = DIRECTIONS[direction];
  const nextLat = snap(lat - dz * STEP / METRES_LAT);
  const nextLon = snap(lon + dx * STEP / metresLon(lat));
  // Keep the whole requested bounding box inside the map providers' supported range.
  if (Math.abs(nextLat) > 85 || Math.abs(nextLon) + (HALF + MARGIN) / metresLon(nextLat) > 180) return null;
  const entry = { ...pose,
    x: (lon - nextLon + pose.x / metresLon(lat)) * metresLon(nextLat),
    z: pose.z + (nextLat - lat) * METRES_LAT };
  // A corner on a north/south crossing can shift sideways a fraction of a metre as longitude scale changes.
  const inset = value => Math.max(-HALF + 2.5, Math.min(HALF - 2.5, value));
  entry.x = inset(entry.x); entry.z = inset(entry.z);
  return { lat: nextLat, lon: nextLon, entry };
}

export function travelDelay(deadline, now) {
  return Math.ceil(Math.max(0, Math.min(COOLDOWN, (Number(deadline) || 0) - now)) / 1000);
}

// The history entry keeps the timer across reloads even where localStorage is unavailable.
export function cooldownSeconds() {
  let deadline = history.state?.nextAreaAt || 0;
  try { deadline = Math.max(deadline, Number(localStorage.getItem(KEY)) || 0); } catch {}
  return travelDelay(deadline, Date.now());
}

export function startCooldown() {
  const nextAreaAt = Date.now() + COOLDOWN;
  history.replaceState({ ...history.state, nextAreaAt }, '');
  try { localStorage.setItem(KEY, String(nextAreaAt)); } catch {}
}

export function visitArea(visit) {
  const hash = '#' + visit.lat.toFixed(4) + ',' + visit.lon.toFixed(4) + '|' + encodeURIComponent(visit.name || '');
  history.replaceState({ visit, nextAreaAt: history.state?.nextAreaAt }, '', hash);
  location.reload();
}

// Share the same deadline with the boundary dialog and the failed-download retry.
export function cooldownButton(button, label, available = true) {
  const refresh = () => {
    const seconds = cooldownSeconds();
    button.disabled = !available || seconds > 0;
    const text = seconds && available ? label + ' (' + seconds + 's)' : label;
    if (button.textContent !== text) button.textContent = text;
  };
  refresh();
  const timer = setInterval(refresh, 250);
  return () => clearInterval(timer);
}

export function edgePrompt({ dialog, title, detail, proceed, stay, destination, depart }) {
  let side = null, dismissed = null, target = null, stopTimer = null;
  stay.onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    stopTimer?.();
    dismissed = side;
    side = null;
    target = null;
  });
  proceed.onclick = () => {
    if (!target || proceed.disabled || cooldownSeconds()) return;
    proceed.disabled = true;
    const next = target;
    target = null; // Accept just once, even if navigation yields a frame.
    stopTimer?.();
    depart(next);
  };

  return {
    offer(direction) {
      if (dialog.open || dismissed === direction) return;
      side = direction;
      target = destination(direction);
      title.textContent = 'Continue ' + direction + '?';
      detail.textContent = target ? 'Load the next area and continue from this spot.' : 'Map coverage ends here. Turn back to keep driving in this area.';
      dialog.showModal();
      stay.focus();
      stopTimer = cooldownButton(proceed, 'Load next area', !!target);
    },
    move(x, z) {
      if (!dismissed) return;
      const [dx, dz] = DIRECTIONS[dismissed];
      if (x * dx + z * dz < HALF - 18) dismissed = null;
    }
  };
}
