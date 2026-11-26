// Driving sounds for both drive pages, synthesized with Web Audio: the player's engine, the traffic around it
// (real-map page) and the radio's tuning static. V mutes them all.

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
// Each voice: { id, frequency, cutoff, gain, hiss, pan (-1 left … 1 right), near (0–1), honk }. Pitch carries the
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
      pan: 0.8 * Math.max(-1, Math.min(1, (dz * ear.fx - dx * ear.fz) / d)), near, honk: !!ear.me && c.ahead === ear.me && c.still > 3
    });
  }
  return out.sort((a, b) => b.gain + b.hiss - a.gain - a.hiss).slice(0, n);
}

const MUTE_KEY = 'sedan-driving-muted-v1';

export function drivingAudio() {
  let ctx, engine, filter, level, master, tuner, noise, burst, wave, bus, roar, muted = false;
  const voices = [], horns = new Map(); let lastHorn = -1e9;
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
        master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, .024);
      } catch {
        ctx?.close().catch(() => {}); ctx = null; return;
      }
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }

  function update(speed, forward, backward) {
    if (!ctx || ctx.state !== 'running') return;
    const tone = engineTone(speed, forward, backward), now = ctx.currentTime;
    engine.frequency.setTargetAtTime(tone.frequency, now, .095);
    level.gain.setTargetAtTime(tone.gain, now, .065);
    filter.frequency.setTargetAtTime(tone.cutoff, now, .075);
  }

  // Traffic: a few voices (engine note and tyre hiss, panned) follow the nearest cars; a car keeps its voice while it
  // stays among them, and a voice goes to another car only once it has fallen quiet.
  function voice() {
    if (!bus) {
      bus = ctx.createGain(); bus.gain.value = 0.8; bus.connect(master);
      roar = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const samples = roar.getChannelData(0); for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const osc = ctx.createOscillator(), cut = ctx.createBiquadFilter(), gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const hiss = ctx.createBufferSource(), band = ctx.createBiquadFilter(), hissGain = ctx.createGain();
    osc.setPeriodicWave(wave); cut.type = 'lowpass'; gain.gain.value = 0;
    hiss.buffer = roar; hiss.loop = true; band.type = 'bandpass'; band.frequency.value = 1100; band.Q.value = 0.6; hissGain.gain.value = 0;
    osc.connect(cut).connect(gain).connect(pan); hiss.connect(band).connect(hissGain).connect(pan); pan.connect(bus);
    osc.start(); hiss.start(0, Math.random() * 1.9);
    return { osc, cut, gain, pan, hissGain, id: null, free: -1e9 };
  }
  function horn(pan, loud) { // one or two short blasts from a two-tone horn
    const now = ctx.currentTime, lp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    const blasts = Math.random() < 0.4 ? 2 : 1, len = blasts > 1 ? 0.15 : 0.45, end = now + blasts * 0.24 + len + 0.15;
    lp.type = 'lowpass'; lp.frequency.value = 2400; g.gain.value = 0; if (p.pan) p.pan.value = pan;
    for (let b = 0; b < blasts; b++) { g.gain.setTargetAtTime(loud, now + b * 0.24, 0.008); g.gain.setTargetAtTime(0, now + b * 0.24 + len, 0.02); }
    lp.connect(g).connect(p).connect(bus);
    for (const f of [415, 520]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(lp); o.start(now); o.stop(end); o.onended = () => { o.disconnect(); if (f > 500) { lp.disconnect(); g.disconnect(); p.disconnect(); } }; }
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
    for (const w of want) if (w.honk && now > (horns.get(w.id) ?? 0) && now - lastHorn > 1.5) {
      horn(w.pan, 0.07 * w.near); lastHorn = now; horns.set(w.id, now + 6 + Math.random() * 5);
    }
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
    else { stopBurst(); ctx?.close().catch(() => {}); ctx = null; voices.length = 0; bus = null; }
  });
  return { activate, update, traffic, tuningStatic, toggleMute };
}
