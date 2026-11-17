// Sound: a handful of synthesised cues, no files. The audio context is created on the first
// real click, because browsers refuse to start one before a gesture.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function ensure() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0.24;
    master.connect(context.destination);
    const length = Math.floor(context.sampleRate * 0.4);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    return context;
  }

  function noise(duration, frequency, gain, type = 'lowpass') {
    const ctx = ensure();
    if (!ctx || muted) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    source.connect(filter).connect(envelope).connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone(frequency, duration, gain, type = 'sine', slideTo = null) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }

  return {
    unlock() {
      ensure();
      if (context?.state === 'suspended') context.resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.24;
      return muted;
    },
    shot(kind) {
      if (kind === 'shotgun') {
        noise(0.24, 900, 0.9);
        tone(90, 0.22, 0.5, 'square', 40);
      } else if (kind === 'pistol') {
        noise(0.1, 2200, 0.6);
        tone(180, 0.08, 0.3, 'square', 80);
      } else {
        noise(0.13, 1600, 0.7);
        tone(120, 0.1, 0.35, 'square', 60);
      }
    },
    enemyShot() {
      noise(0.1, 900, 0.28);
    },
    reload() {
      tone(420, 0.06, 0.22, 'square');
      setTimeout(() => tone(300, 0.08, 0.18, 'square'), 180);
    },
    hit() {
      tone(880, 0.05, 0.2, 'triangle');
    },
    headshot() {
      tone(1320, 0.07, 0.24, 'triangle');
      tone(660, 0.05, 0.12, 'sine');
    },
    hurt() {
      noise(0.18, 500, 0.5, 'bandpass');
    },
    explosion() {
      noise(0.7, 380, 1.0);
      tone(60, 0.6, 0.6, 'sine', 28);
    },
    plant() {
      tone(980, 0.08, 0.25, 'square');
    },
    defuse() {
      tone(620, 0.1, 0.25, 'sine', 880);
    },
    win() {
      tone(523, 0.16, 0.25, 'triangle');
      setTimeout(() => tone(659, 0.16, 0.25, 'triangle'), 140);
      setTimeout(() => tone(784, 0.24, 0.25, 'triangle'), 280);
    },
    lose() {
      tone(330, 0.2, 0.22, 'triangle');
      setTimeout(() => tone(247, 0.3, 0.22, 'triangle'), 180);
    },
    click() {
      tone(520, 0.04, 0.12, 'square');
    },
  };
}
