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

const MUTE_KEY = 'sedan-driving-muted-v1';

export function drivingAudio() {
  let ctx, engine, filter, level, master, tuner, noise, burst, muted = false;
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
        engine.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(harmonics.length), harmonics));
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
    else { stopBurst(); ctx?.close().catch(() => {}); ctx = null; }
  });
  return { activate, update, tuningStatic, toggleMute };
}
