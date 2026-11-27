// Gamepads on both drive pages. poll() (each frame) reads the first connected pad into analogue controls for
// readKeys(keys, pad), and its other buttons press the keys their actions use, sending the keydown / keyup a keyboard
// would on window (as touch.js does), so the pages' own key handling does the rest. Rumble through the pad's
// vibrationActuator; on touch screens navigator.vibrate for crashes. Without a pad, or the API, poll() gives null.
import { tyreSound } from './driving-audio.js';

// [button, code, shift]: standard mapping B horn, X camera, Y reset, LB / RB radio down / up, Back delivery, Start settings,
// d-pad up lights. Any other pad: axis 0 steers, buttons 0–3 are gas, brake, handbrake and camera.
const STD = [[1, 'KeyB'], [2, 'KeyC'], [3, 'KeyR'], [4, 'KeyQ', true], [5, 'KeyQ'], [8, 'KeyJ'], [9, 'Escape'], [12, 'KeyH']], RAW = [[3, 'KeyC']];
const stick = x => { const a = Math.abs(x); return a < 0.12 ? 0 : Math.sign(x) * ((a - 0.12) / 0.88) ** 1.6; }; // deadzone, finer near the middle
const trigger = x => x < 0.05 ? 0 : Math.min(1, (x - 0.05) / 0.95);

// A Gamepad (or anything shaped like one) → { steer (left 1 … right -1), thr, brk (0–1), hb, keys: the [button, code, shift] held }.
export function padControls(gp) {
  const b = i => { const x = gp.buttons[i]; return !x ? 0 : x.value || (x.pressed ? 1 : 0); }, std = gp.mapping === 'standard';
  const [g, br, hb] = std ? [7, 6, 0] : [0, 1, 2];
  return { steer: -stick(gp.axes[0] || 0), thr: trigger(b(g)), brk: trigger(b(br)), hb: b(hb) > 0.5, keys: (std ? STD : RAW).filter(([i]) => b(i) > 0.5) };
}

export function gamepad() {
  let pad = null, held = new Map(), next = 0;
  const key = (type, [, code, shiftKey]) => dispatchEvent(new KeyboardEvent(type, { code, shiftKey: !!shiftKey }));
  const release = () => { held.forEach(x => key('keyup', x)); held = new Map(); };
  const rumble = (strong, weak, ms) => { try { pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) })?.catch?.(() => {}); } catch {} };
  return {
    poll() {
      try { pad = [...(navigator.getGamepads?.() || [])].find(p => p?.connected) || null; } catch { pad = null; } // (blocked by a permissions policy)
      if (!pad) { release(); return null; }
      const c = padControls(pad), now = new Map(c.keys.map(x => [x[0], x]));
      now.forEach((x, i) => held.has(i) || key('keydown', x)); held.forEach((x, i) => now.has(i) || key('keyup', x));
      held = now; return c;
    },
    crash(speed) { // a hit at speed m/s (as driving-audio's impact)
      if (speed < 1.2) return; next = performance.now() + 150; // the ride rumble waits until the crash has played
      rumble(speed / 12, speed / 24, 120);
      if (document.documentElement.classList.contains('touch-ui')) try { navigator.vibrate?.(Math.round(Math.min(120, 25 + 4 * speed))); } catch {}
    },
    feel(speed, braking, ride) { // each frame: a light rumble while the tyres squeal and on rough ground (ride as for tyreSound)
      const t = performance.now(); if (!pad?.vibrationActuator || t < next) return; next = t + 100;
      const tyre = tyreSound(speed, braking, ride), weak = 0.35 * tyre.squeal + 0.12 * tyre.rumble;
      if (weak > 0.02) rumble(0, weak, 120);
    }
  };
}
