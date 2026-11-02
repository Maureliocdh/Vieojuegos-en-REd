(function (root) {
  const profiles = {
    pistola: { duration: 0.42, crack: 0.018, cutoff: 5600, body: 155, decay: 0.035, tail: 0.075, weight: 0.32, action: 0.075 },
    rifle: { duration: 0.34, crack: 0.012, cutoff: 7800, body: 190, decay: 0.025, tail: 0.055, weight: 0.25, action: 0.045 },
    escopeta: { duration: 0.88, crack: 0.045, cutoff: 3400, body: 95, decay: 0.075, tail: 0.15, weight: 0.58, action: 0.28 },
    sniper: { duration: 1.12, crack: 0.023, cutoff: 6400, body: 72, decay: 0.095, tail: 0.22, weight: 0.65, action: 0.42 },
  };
  const contexts = new WeakMap();
  const has = weapon => Object.hasOwn(profiles, weapon);
  function stateFor(context) {
    if (!contexts.has(context)) contexts.set(context, { buffers: new Map(), buses: new WeakMap(), voices: new Set() });
    return contexts.get(context);
  }
  function createBuffer(context, weapon) {
    if (!has(weapon)) throw new RangeError(`Arma sin sonido de disparo: ${weapon}`);
    const state = stateFor(context);
    if (state.buffers.has(weapon)) return state.buffers.get(weapon);
    const profile = profiles[weapon], rate = context.sampleRate;
    const buffer = context.createBuffer(1, Math.ceil(profile.duration * rate), rate);
    const samples = buffer.getChannelData(0);
    const alpha = 1 - Math.exp(-2 * Math.PI * profile.cutoff / rate);
    const bassAlpha = 1 - Math.exp(-2 * Math.PI * 420 / rate);
    let filtered = 0, bass = 0, previous = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const time = i / rate, noise = Math.random() * 2 - 1;
      filtered += alpha * (noise - filtered);
      bass += bassAlpha * (noise - bass);
      const attack = Math.min(1, time / 0.0007);
      const crack = (filtered - previous * 0.6) * Math.exp(-time / profile.crack) * 1.5;
      previous = filtered;
      // Barrido grave corto: cuerpo de la detonación, no una nota sostenida.
      const phase = 2 * Math.PI * (profile.body * 0.45 * time
        + profile.body * 0.55 * 0.012 * (1 - Math.exp(-time / 0.012)));
      const body = (Math.sin(phase) * 0.65 + bass * 2) * Math.exp(-time / profile.decay) * profile.weight;
      const tail = filtered * Math.exp(-time / profile.tail) * 0.24;
      const actionTime = time - profile.action;
      let action = 0;
      if (actionTime >= 0) {
        const envelope = Math.min(1, actionTime / 0.002) * Math.exp(-actionTime / 0.014);
        action = (filtered * 0.6 + Math.sin(actionTime * 2 * Math.PI * 1350) * 0.12) * envelope * 0.3;
        if (weapon === 'escopeta' || weapon === 'sniper') {
          const latchTime = actionTime - 0.11;
          action += filtered * Math.min(1, actionTime / 0.01) * Math.exp(-actionTime / 0.055) * 0.16;
          if (latchTime >= 0) action += filtered * Math.exp(-latchTime / 0.012) * 0.28;
        }
      }
      const value = (crack + body + tail) * attack + action;
      samples[i] = Math.tanh(value * 1.4) * 0.78;
    }
    // Reflexiones cortas sin realimentación; se calculan una sola vez por arma.
    const dry = samples.slice();
    for (const [delay, level] of [[0.037, 0.12], [0.081, 0.055]]) {
      const offset = Math.round(delay * rate);
      for (let i = offset; i < samples.length; i += 1) samples[i] += dry[i - offset] * level;
    }
    const fade = Math.round(rate * 0.02);
    for (let i = 0; i < fade; i += 1) samples[samples.length - 1 - i] *= i / fade;
    samples[samples.length - 1] = 0;
    state.buffers.set(weapon, buffer);
    return buffer;
  }
  function play(context, destination, weapon, { volume = 1, pan = 0 } = {}) {
    const buffer = createBuffer(context, weapon);
    if (!Number.isFinite(volume) || !Number.isFinite(pan)) throw new TypeError('Volumen y posición de disparo deben ser finitos');
    const state = stateFor(context);
    if (!state.buses.has(destination)) {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.12;
      const ceiling = context.createWaveShaper();
      ceiling.curve = Float32Array.from({ length: 2049 }, (_, i) => 0.9 * Math.tanh(i / 1024 - 1));
      limiter.connect(ceiling); ceiling.connect(destination);
      state.buses.set(destination, limiter);
    }
    while (state.voices.size >= 12) state.voices.values().next().value.cancel();
    const source = context.createBufferSource(), gain = context.createGain(), panner = context.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = 0.985 + Math.random() * 0.03;
    gain.gain.value = Math.max(0, Math.min(1, volume));
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(gain); gain.connect(panner); panner.connect(state.buses.get(destination));
    const voice = {
      cancel() { source.stop(); cleanup(); },
    };
    function cleanup() {
      source.onended = null;
      source.disconnect(); gain.disconnect(); panner.disconnect();
      state.voices.delete(voice);
    }
    source.onended = cleanup;
    state.voices.add(voice);
    source.start();
    return source;
  }
  function stopAll(context) {
    const state = contexts.get(context);
    if (state) for (const voice of [...state.voices]) voice.cancel();
  }
  const api = { has, createBuffer, play, stopAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeaponAudio = api;
}(typeof window !== 'undefined' ? window : globalThis));
