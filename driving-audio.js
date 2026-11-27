// Driving sounds for both drive pages, synthesized with Web Audio: the player's engine, tyres, horn and crashes, the
// traffic around it (real-map page) and the radio's tuning static. V mutes them all.

// Four-cylinder, four-stroke engine: two exhaust pulses per crankshaft revolution.
// The gearbox changes the pitch as road speed rises. Opposing pedal input is braking.
export function engineTone(speed, forward, backward) {
  const load = backward ? speed <= 0.2 : !!forward && speed >= -0.2;
  const v = Math.abs(speed);
  const ratio = speed < 0 ? 315 : v < 7 ? 350 : v < 14 ? 205 : v < 23 ? 148 : v < 34 ? 108 : 80;
  const rpm = Math.min(5500, 850 + v * ratio + (load ? 520 : 0));
  return {
    frequency: rpm / 30,
    gain: 0.038 + 0.000004 * rpm + (load ? 0.035 : 0),
    cutoff: 150 + 0.10 * rpm + (load ? 300 : 0),
  };
}

// The traffic around the listener as it hears it: the n loudest of the cars within 80 m, as engine voices.
// cars: traffic.js cars ({ id, x, z, h, v, braking, still, ahead, paint }); ear = { x, z, fx, fz, vx, vz, wet, me }:
// where the listener is (the camera), the way it faces, how fast it moves, how wet the road is (0–1) and the player's
// own body as traffic sees it (a car held up by it a few seconds sounds its horn).
// Each voice: { id, frequency, cutoff, gain, hiss, pan (-1 left … 1 right), near (0–1), honk, screech (braking hard) }. Pitch carries the
// Doppler shift of a car passing, and differs a little from car to car.
export function trafficVoices(cars, ear, n = 4) {
  const out = [];
  for (const c of cars) {
    const dx = c.x - ear.x, dz = c.z - ear.z, d = Math.hypot(dx, dz) || 0.01;
    if (d > 80) continue;
    const vx = Math.cos(c.h) * c.v, vz = -Math.sin(c.h) * c.v;
    const closing = Math.max(-60, Math.min(60, ((ear.vx - vx) * dx + (ear.vz - vz) * dz) / d)); // m/s, the gap shrinking
    const tone = engineTone(c.v, !c.braking && c.v > 0.3, false), near = Math.min(1, 5 / d) * (1 - d / 80);
    out.push({
      id: c.id, frequency: tone.frequency * (0.94 + (c.paint % 7) * 0.02) * 343 / (343 - closing), cutoff: tone.cutoff,
      gain: tone.gain * 0.9 * near, hiss: 0.05 * Math.min(1, c.v / 16) ** 1.5 * (1 + 1.5 * (ear.wet || 0)) * near,
      pan: 0.8 * Math.max(-1, Math.min(1, (dz * ear.fx - dx * ear.fz) / d)), near, honk: !!ear.me && c.ahead === ear.me && c.still > 3,
      screech: c.v > 4 && (c.brake || 0) > 5.5
    });
  }
  return out.sort((a, b) => b.gain + b.hiss - a.gain - a.hiss).slice(0, n);
}

// What the tyres sound like at `speed` (m/s): squeal (0–1) and its pitch (Hz) from hard braking, the handbrake,
// cornering near the limit and sliding sideways, on a hard surface only (not off-road or on snow, and less when wet);
// rumble off-road and on snow; swish on a wet road. ride: { hb, steer, slip, rough, wet, snow, grip } (drive-core.js
// state and the ground under the car); braking: the brakes are on against the motion.
export function tyreSound(speed, braking, ride = {}) {
  const v = Math.abs(speed), wet = ride.wet || 0, snow = ride.snow || 0, hard = !ride.rough && snow < 0.5;
  const turning = v * v * Math.abs(Math.tan(ride.steer || 0)) / 2.63, limit = 15 * (ride.grip ?? 1) /* DRY in drive-core.js: the sideways grip */, clamp = x => Math.max(0, Math.min(1, x));
  let squeal = 0;
  if (hard && v > 3) squeal = Math.max(braking ? clamp((v - 6) / 12) * 0.8 : 0, ride.hb ? clamp((v - 3) / 8) : 0,
    clamp((turning - 0.7 * limit) / (0.5 * limit)), clamp(Math.abs(Math.sin(ride.slip || 0)) * v / 4)) * (1 - 0.5 * wet);
  return { squeal, pitch: 850 + 450 * squeal + 6 * v, rumble: clamp(v / 12) * (ride.rough ? 1 : 0.6 * snow), swish: hard ? clamp(v / 18) ** 1.5 * wet : 0 };
}

// A hit at `speed` (m/s) against a 'wall', a 'car', a 'post' or a 'person': null when too soft to hear, else how loud each part
// is: a low thump (the body), a crunch (noise, brighter the harder, dying away over `decay` s), a metal ring (cars and
// posts) and breaking glass (cars, hard hits). A person is only a soft thud.
export function impactSound(speed, kind) {
  const v = Math.abs(speed), s = Math.min(1, v / 14);
  if (v < 1.2) return null; // (leaning on a wall makes no noise)
  if (kind === 'person') return { thump: 0.3 * s ** 0.7, crunch: 0, cutoff: 500 + 900 * s, decay: 0.1, ring: 0, glass: 0 }; // a soft thud
  return { thump: 0.4 * s ** 0.7, crunch: 0.22 * s, cutoff: 900 + 4000 * s, decay: 0.12 + 0.3 * s,
    ring: kind === 'wall' ? 0 : (kind === 'car' ? 0.06 : 0.1) * s ** 0.8, glass: kind === 'car' && v > 7 ? Math.min(1, (v - 7) / 8) * 0.12 : 0 };
}

// The results card's sounds as notes, [frequency (Hz), start (s), length (s)]: a tick as the pay counts up, two bright
// notes for the coin, star i one step higher up a major chord than the star before, a rising arpeggio for a level-up
// and two falling notes for a ruined load.
export function chimeNotes(kind, i = 0) {
  const up = 2 ** (([0, 4, 7][i] ?? 12) / 12);
  return { tick: [[1760, 0, 0.03]], coin: [[988, 0, 0.08], [1319, 0.07, 0.3]], star: [[784 * up, 0, 0.22], [1568 * up, 0.01, 0.12]],
    level: [[523, 0, 0.14], [659, 0.1, 0.14], [784, 0.2, 0.14], [1047, 0.3, 0.45]], fail: [[392, 0, 0.18], [294, 0.17, 0.4]] }[kind] || [];
}

const MUTE_KEY = 'sedan-driving-muted-v1';

export function drivingAudio() {
  let ctx, engine, filter, level, master, tuner, noise, burst, wave, bus, roar, tyres, hornOn = null, muted = false;
  const voices = [], horns = new Map(), skids = new Map(); let lastHorn = -1e9, lastHit = -1e9, lastThump = 0;
  try { muted = globalThis.sessionStorage?.getItem(MUTE_KEY) === '1'; } catch {} // blocked storage

  function activate() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || globalThis.document?.hidden) return;
    if (!ctx) {
      try {
        ctx = new Context();
        master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
        const idle = engineTone(0, false, false);
        engine = ctx.createOscillator();
        // Harmonics keep the exhaust note audible on small speakers even at idle.
        const harmonics = Float32Array.of(0, .68, .50, .39, .22, .18, .13, .10, .09, .06, .04);
        wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics);
        engine.setPeriodicWave(wave);
        engine.frequency.value = idle.frequency;
        const wobble = ctx.createOscillator(), depth = ctx.createGain();
        wobble.frequency.value = 7; depth.gain.value = 0.9;
        wobble.connect(depth).connect(engine.frequency);
        filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = idle.cutoff;
        level = ctx.createGain(); level.gain.value = idle.gain;
        engine.connect(filter).connect(level).connect(master);
        tuner = ctx.createBiquadFilter(); tuner.type = 'bandpass'; tuner.frequency.value = 2350; tuner.Q.value = 0.65;
        tuner.connect(master);
        engine.start(); wobble.start();
        roar = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); // white noise, for tyres, crashes and traffic
        const samples = roar.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        tyres = tyreVoices();
        master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .024);
      } catch {
        ctx?.close().catch(() => {}); ctx = null; return;
      }
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  const loop = () => { const src = ctx.createBufferSource(); src.buffer = roar; src.loop = true; src.start(0, Math.random() * 1.9); return src; };
  const filtered = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
  const silent = () => { const g = ctx.createGain(); g.gain.value = 0; return g; };
  function tyreVoices() { // squeal (narrow noise and a wavering tone), rumble and swish, all silent until update() says
    const squeal = silent(), band = filtered('bandpass', 1100, 8), tone = ctx.createOscillator(), toneLevel = ctx.createGain(), shake = ctx.createOscillator(), depth = ctx.createGain();
    tone.type = 'triangle'; toneLevel.gain.value = 0.35; shake.frequency.value = 9; depth.gain.value = 30;
    shake.connect(depth).connect(tone.frequency); tone.connect(toneLevel).connect(squeal); loop().connect(band).connect(squeal); squeal.connect(master);
    const rumble = silent(), swish = silent();
    loop().connect(filtered('lowpass', 220)).connect(rumble).connect(master); loop().connect(filtered('bandpass', 1500, 0.8)).connect(swish).connect(master);
    tone.start(); shake.start();
    return { squeal, band, tone, rumble, swish };
  }

  // speed (m/s), the pedals, and ride: what the tyres are doing (tyreSound)
  function update(speed, forward, backward, ride) {
    if (!ctx || ctx.state !== 'running') return;
    const tone = engineTone(speed, forward, backward), now = ctx.currentTime;
    engine.frequency.setTargetAtTime(tone.frequency, now, .095);
    level.gain.setTargetAtTime(tone.gain, now, .065);
    filter.frequency.setTargetAtTime(tone.cutoff, now, .075);
    const t = tyreSound(speed, (backward && speed > 0.2) || (forward && speed < -0.2), ride);
    tyres.squeal.gain.setTargetAtTime(0.07 * t.squeal, now, t.squeal > tyres.squeal.gain.value / 0.07 ? 0.03 : 0.09);
    tyres.band.frequency.setTargetAtTime(t.pitch, now, 0.05); tyres.tone.frequency.setTargetAtTime(t.pitch * 0.82, now, 0.05);
    tyres.rumble.gain.setTargetAtTime(0.14 * t.rumble, now, 0.08); tyres.swish.gain.setTargetAtTime(0.05 * t.swish, now, 0.08);
  }

  // A crash at `speed` m/s into a 'wall', a 'car' or a 'post' (impactSound). Pressing on against a wall doesn't
  // keep re-sounding it: within 0.3 s only a much harder hit does.
  function impact(speed, kind) {
    if (!ctx || ctx.state !== 'running') return;
    const p = impactSound(speed, kind), now = ctx.currentTime;
    if (!p || (now - lastHit < 0.3 && p.thump < lastThump * 1.3)) return;
    lastHit = now; lastThump = p.thump;
    const out = ctx.createGain(); out.connect(master);
    const hit = (node, gain, decay) => { const g = ctx.createGain(); g.gain.setValueAtTime(gain, now); g.gain.setTargetAtTime(0, now + 0.004, decay); node.connect(g).connect(out); };
    const thump = ctx.createOscillator(); thump.frequency.setValueAtTime(110, now); thump.frequency.exponentialRampToValueAtTime(42, now + 0.25);
    hit(thump, p.thump, 0.09); thump.start(now); thump.stop(now + 0.6);
    const crunch = ctx.createBufferSource(), lp = filtered('lowpass', p.cutoff); crunch.buffer = roar;
    hit(crunch.connect(lp), p.crunch, p.decay / 3); crunch.start(now, Math.random() * 1.5); crunch.stop(now + p.decay * 2 + 0.1);
    if (p.ring) for (const f of [1, 2.76, 5.4]) { // a struck panel or post: a few inharmonic partials
      const r = ctx.createOscillator(); r.frequency.value = (kind === 'car' ? 340 : 620) * f * (0.95 + Math.random() * 0.1);
      hit(r, p.ring / f, 0.18 / Math.sqrt(f)); r.start(now); r.stop(now + 1.2);
    }
    if (p.glass) for (let i = 0; i < 9; i++) { // glass: short bright ticks scattered over the next 0.4 s
      const t = now + 0.03 + Math.random() * 0.4, src = ctx.createBufferSource(), bp = filtered('bandpass', 4500 + Math.random() * 3000, 12), g = ctx.createGain();
      src.buffer = roar; g.gain.setValueAtTime(0, now); g.gain.setValueAtTime(p.glass * 3, t); g.gain.setTargetAtTime(0, t, 0.012);
      src.connect(bp).connect(g).connect(out); src.start(t, Math.random() * 1.8); src.stop(t + 0.1);
    }
    setTimeout(() => out.disconnect(), 1600);
  }

  // The player's horn, held down (it sounds for at least 0.3 s, so a tap is still a beep)
  function horn(on) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    if (on && !hornOn) {
      const g = silent(), lp = filtered('lowpass', 2400), oscs = [415, 520].map(f => { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(now); return o; });
      lp.connect(g).connect(master); g.gain.setTargetAtTime(0.06, now, 0.008); hornOn = { g, oscs, t: now };
    } else if (!on && hornOn) {
      const { g, oscs, t } = hornOn, end = Math.max(now, t + 0.3);
      g.gain.setTargetAtTime(0, end, 0.02); for (const o of oscs) o.stop(end + 0.2);
      setTimeout(() => g.disconnect(), (end - now + 0.4) * 1000); hornOn = null;
    }
  }

  // A results-card sound (chimeNotes), through the master gain so V mutes it too
  function chime(kind, i) {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, out = ctx.createGain(); let end = 0;
    out.gain.value = kind === 'tick' ? 0.04 : 0.1; out.connect(master);
    for (const [f, t, d] of chimeNotes(kind, i)) {
      const o = ctx.createOscillator(), g = silent(); o.type = kind === 'tick' ? 'sine' : 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0, now + t); g.gain.linearRampToValueAtTime(1, now + t + 0.006); g.gain.setTargetAtTime(0, now + t + 0.01, d / 3);
      o.connect(g).connect(out); o.start(now + t); o.stop(now + t + d + 0.2); end = Math.max(end, t + d + 0.3);
    }
    setTimeout(() => out.disconnect(), end * 1000);
  }

  // Traffic: a few voices (engine note and tyre hiss, panned) follow the nearest cars; a car keeps its voice while it
  // stays among them, and a voice goes to another car only once it has fallen quiet.
  function voice() {
    if (!bus) { bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(master); }
    const osc = ctx.createOscillator(), cut = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const hiss = ctx.createBufferSource(), band = ctx.createBiquadFilter(), hissGain = ctx.createGain();
    osc.setPeriodicWave(wave); cut.type = 'lowpass'; gain.gain.value = 0;
    hiss.buffer = roar; hiss.loop = true; band.type = 'bandpass'; band.frequency.value = 1100; band.Q.value = 0.6; hissGain.gain.value = 0;
    osc.connect(cut).connect(gain).connect(pan); hiss.connect(band).connect(hissGain).connect(pan); pan.connect(bus);
    osc.start(); hiss.start(0, Math.random() * 1.9);
    return { osc, cut, gain, pan, hissGain, id: null, free: -1e9 };
  }
  function beep(pan, loud, angry = false) { // a traffic car's horn: one or two short blasts, or a long angry one after a moment
    const now = ctx.currentTime + (angry ? 0.35 : 0), lp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const blasts = !angry && Math.random() < 0.4 ? 2 : 1, len = angry ? 1.1 : blasts > 1 ? 0.15 : 0.45, end = now + blasts * 0.24 + len + 0.15;
    lp.type = 'lowpass'; lp.frequency.value = 2400; g.gain.value = 0; if (p.pan) p.pan.value = pan;
    for (let b = 0; b < blasts; b++) { g.gain.setTargetAtTime(loud, now + b * 0.24, 0.008); g.gain.setTargetAtTime(0, now + b * 0.24 + len, 0.02); }
    lp.connect(g).connect(p).connect(bus);
    const pitch = 0.9 + Math.random() * 0.2; // every car's horn a little different
    for (const f of [415, 520]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * pitch; o.connect(lp); o.start(now); o.stop(end); o.onended = () => { o.disconnect(); if (f > 500) { lp.disconnect(); g.disconnect(); p.disconnect(); } }; }
  }
  function traffic(cars, ear) {
    if (!ctx || ctx.state !== 'running' || !wave) return;
    while (voices.length < 4) voices.push(voice());
    const now = ctx.currentTime, want = trafficVoices(cars, ear, voices.length), left = new Set(want);
    for (const v of voices) {
      const w = want.find(w => w.id === v.id);
      if (w) { left.delete(w); play(v, w, now, false); }
      else if (v.id !== null) { v.id = null; v.free = now; v.gain.gain.setTargetAtTime(0, now, 0.12); v.hissGain.gain.setTargetAtTime(0, now, 0.12); }
    }
    for (const w of left) {
      const v = voices.find(v => v.id === null && now - v.free > 0.5); // quiet by now
      if (v) { v.id = w.id; play(v, w, now, true); }
    }
    for (const w of want) {
      if (w.honk && now > (horns.get(w.id) ?? 0) && now - lastHorn > 1.5) { beep(w.pan, 0.07 * w.near); lastHorn = now; horns.set(w.id, now + 6 + Math.random() * 5); }
      if (w.screech && now > (skids.get(w.id) ?? 0)) { screech(w.pan, 0.06 * w.near); skids.set(w.id, now + 3); }
    }
  }
  function screech(pan, loud) { // a traffic car braking hard: a squeal sliding down in pitch
    const now = ctx.currentTime, src = loop(), bp = filtered('bandpass', 1600, 7), g = silent(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    bp.frequency.setTargetAtTime(1000, now, 0.3); g.gain.setTargetAtTime(loud, now, 0.02); g.gain.setTargetAtTime(0, now + 0.45, 0.08); if (p.pan) p.pan.value = pan;
    src.connect(bp).connect(g).connect(p).connect(bus); src.stop(now + 1); src.onended = () => { src.disconnect(); bp.disconnect(); g.disconnect(); p.disconnect(); };
  }
  // A traffic car the player crashed into sounds a long horn
  function honkAt(car, ear) {
    if (!ctx || ctx.state !== 'running' || !bus || ctx.currentTime < (horns.get(car.id) ?? 0)) return; // once, not at every bump
    const [w] = trafficVoices([car], ear, 1);
    if (w) { beep(w.pan, 0.08 * w.near, true); horns.set(car.id, ctx.currentTime + 6); }
  }
  function play(v, w, now, fresh) {
    if (fresh) v.osc.frequency.setValueAtTime(w.frequency, now); else v.osc.frequency.setTargetAtTime(w.frequency, now, 0.08);
    v.cut.frequency.setTargetAtTime(w.cutoff, now, 0.08);
    v.gain.gain.setTargetAtTime(w.gain, now, fresh ? 0.15 : 0.06);
    v.hissGain.gain.setTargetAtTime(w.hiss, now, 0.08);
    v.pan.pan?.setTargetAtTime(w.pan, now, 0.05);
  }

  function stopBurst() {
    if (burst) { burst.stop(); burst.disconnect(); burst = null; }
  }

  function tuningStatic() {
    if (!ctx || muted || globalThis.document?.hidden) return;
    if (!noise) {
      noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .16), ctx.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const t = i / samples.length;
        samples[i] = (Math.random() * 2 - 1) * .19 * Math.min(1, t * 24) * (1 - t) ** 2;
      }
    }
    stopBurst();
    const source = ctx.createBufferSource(); source.buffer = noise; source.connect(tuner);
    source.onended = () => { source.disconnect(); if (burst === source) burst = null; };
    burst = source; source.start();
  }

  function toggleMute() {
    muted = !muted;
    try { globalThis.sessionStorage?.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
    if (ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .02);
    return muted;
  }

  function suspend() { stopBurst(); ctx?.suspend().catch(() => {}); }
  function resume() { if (!globalThis.document?.hidden) ctx?.resume().catch(() => {}); }
  globalThis.document?.addEventListener('visibilitychange', () => globalThis.document.hidden ? suspend() : resume());
  globalThis.addEventListener?.('pageshow', resume);
  globalThis.addEventListener?.('pagehide', e => {
    if (e.persisted) suspend();
    else { stopBurst(); ctx?.close().catch(() => {}); ctx = null; voices.length = 0; bus = null; hornOn = null; }
  });
  return { activate, update, impact, horn, chime, traffic, honkAt, tuningStatic, toggleMute };
}
