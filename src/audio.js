// Fully procedural audio: engines, weapons, explosions, tether hum and a driving synth score.

const BPM = 140;
const STEP = 60 / BPM / 4; // 16th note
const CHORDS = [
  { root: 55.0, tones: [220.0, 261.63, 329.63] }, // Am
  { root: 55.0, tones: [220.0, 261.63, 329.63] },
  { root: 43.65, tones: [174.61, 220.0, 261.63] }, // F
  { root: 41.2, tones: [164.81, 207.65, 246.94] }, // E
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.intensity = 0;
    this.musicOn = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 600;
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.musicFilter).connect(this.master);

    // noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // delay for arps
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2500;
    this.delay.connect(fb).connect(dl).connect(this.delay);
    this.delay.connect(this.music);

    this.dist = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 3);
    }
    this.dist.curve = curve;
    this.dist.connect(this.music);

    this.engines = [0, 1].map((i) => this._makeEngine(i));
    this._makeTether();
    this._makeAlarm();

    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  _makeEngine(i) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 4;
    const g = ctx.createGain(); g.gain.value = 0;
    const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 800; nf.Q.value = 0.6;
    const ng = ctx.createGain(); ng.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = i === 0 ? -0.25 : 0.25;
    o1.connect(f); o2.connect(f); f.connect(g).connect(pan);
    n.connect(nf).connect(ng).connect(pan);
    pan.connect(this.sfx);
    o1.start(); o2.start(); n.start();
    return { o1, o2, f, g, nf, ng };
  }

  _makeTether() {
    const ctx = this.ctx;
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 55;
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 55.7;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 8;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9;
    const lg = ctx.createGain(); lg.gain.value = 200;
    lfo.connect(lg).connect(f.frequency);
    a.connect(f); b.connect(f); f.connect(g).connect(this.sfx);
    a.start(); b.start(); lfo.start();
    this.tether = { a, b, f, g, lfo };
  }

  _makeAlarm() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 440;
    const g = ctx.createGain(); g.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 3;
    const lg = ctx.createGain(); lg.gain.value = 120;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(); lfo.start();
    this.alarm = g;
  }

  setEngine(i, speed01, boost, active) {
    if (!this.ctx) return;
    const e = this.engines[i];
    const t = this.ctx.currentTime;
    const base = 48 + speed01 * 70 + boost * 40;
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5 + 1, t, 0.05);
    e.f.frequency.setTargetAtTime(300 + speed01 * 1200 + boost * 2400, t, 0.06);
    e.g.gain.setTargetAtTime(active ? 0.05 + boost * 0.05 : 0, t, 0.1);
    e.nf.frequency.setTargetAtTime(500 + speed01 * 1500 + boost * 1500, t, 0.1);
    e.ng.gain.setTargetAtTime(active ? 0.05 + speed01 * 0.08 + boost * 0.12 : 0, t, 0.1);
  }

  setTether(on, strain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, T = this.tether;
    T.g.gain.setTargetAtTime(on ? 0.05 + strain * 0.08 : 0, t, 0.05);
    T.a.frequency.setTargetAtTime(55 + strain * 60, t, 0.05);
    T.b.frequency.setTargetAtTime(55.7 + strain * 64, t, 0.05);
    T.lfo.frequency.setTargetAtTime(7 + strain * 18, t, 0.05);
    T.f.frequency.setTargetAtTime(400 + strain * 1800, t, 0.05);
  }

  setAlarm(level) {
    if (!this.ctx) return;
    this.alarm.gain.setTargetAtTime(level * 0.035, this.ctx.currentTime, 0.05);
  }

  setMusic(on, intensity, muffled) {
    if (!this.ctx) return;
    const key = on + '|' + intensity + '|' + muffled;
    if (key === this._musicKey) return;
    this._musicKey = key;
    this.musicOn = on;
    this.intensity = intensity;
    const t = this.ctx.currentTime;
    this.musicFilter.frequency.setTargetAtTime(muffled ? 500 : 18000, t, muffled ? 0.15 : 0.4);
    this.music.gain.setTargetAtTime(on ? 0.55 : 0.0, t, 0.3);
  }

  sweep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(300, t);
    f.exponentialRampToValueAtTime(18000, t + 1.2);
  }

  // ---------- one-shots ----------
  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _noise(t, dur, type, freq, q, peak, dest = this.sfx, freqEnd) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.003, peak, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
  _tone(t, dur, type, f0, f1, peak, dest = this.sfx, attack = 0.003) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  shoot(i) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.07, 'square', i ? 760 : 900, 180, 0.035);
    this._noise(t, 0.05, 'highpass', 3000, 0.5, 0.05);
  }
  hit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.25, 'lowpass', 1800, 1, 0.5, this.sfx, 200);
    this._tone(t, 0.25, 'sine', 140, 40, 0.5);
  }
  ping() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.04, 'bandpass', 4000, 4, 0.08);
  }
  explode(size = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.6 + size * 0.5, 'lowpass', 3000 * Math.min(1.5, size), 0.7, Math.min(0.9, 0.35 * size + 0.2), this.sfx, 80);
    this._tone(t, 0.5 + size * 0.3, 'sine', 120, 28, Math.min(0.9, 0.4 + size * 0.2));
  }
  tetherKill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.25, 'sawtooth', 2400, 300, 0.12);
    this._tone(t + 0.02, 0.35, 'square', 1200, 90, 0.08);
    this._noise(t, 0.2, 'highpass', 2500, 0.7, 0.25);
  }
  snap() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.5, 'bandpass', 2500, 2, 0.6, this.sfx, 200);
    this._tone(t, 0.6, 'sawtooth', 300, 30, 0.2);
  }
  connect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.3, 'sawtooth', 110, 880, 0.08);
    this._tone(t + 0.12, 0.3, 'sine', 880, 1760, 0.08);
  }
  sync() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 0.9, 'sawtooth', 80, 1600, 0.2, this.sfx, 0.02);
    this._tone(t, 0.9, 'sawtooth', 81, 1620, 0.2, this.sfx, 0.02);
    this._noise(t + 0.05, 1.4, 'lowpass', 6000, 0.7, 0.8, this.sfx, 100);
    this._tone(t + 0.05, 1.2, 'sine', 90, 25, 0.9);
    this.sweep();
  }
  roll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.35, 'bandpass', 600, 2, 0.3, this.sfx, 3000);
  }
  boost() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.6, 'bandpass', 300, 1.5, 0.35, this.sfx, 4000);
  }
  scrape() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.12, 'bandpass', 3500 + Math.random() * 2000, 6, 0.12);
  }
  beep(f = 880, dur = 0.12, vol = 0.12) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, dur, 'square', f, null, vol);
  }
  revive() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [440, 554, 659, 880].forEach((f, i) => this._tone(t + i * 0.07, 0.25, 'square', f, null, 0.06));
  }
  boom() {
    // huge set-piece explosion
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 3, 'lowpass', 5000, 0.5, 1.0, this.sfx, 40);
    this._tone(t, 3, 'sine', 70, 18, 1.0);
  }

  // ---------- music ----------
  _schedule() {
    if (!this.ctx) return;
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      if (this.musicOn) this._playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % 64;
      this.nextTime += STEP;
    }
  }

  _playStep(step, t) {
    const I = this.intensity; // 0 calm .. 3 max
    const s16 = step % 16;
    const bar = (step / 16) | 0;
    const ch = CHORDS[bar % 4];
    const M = this.music;
    // kick
    if (I >= 1 && s16 % 4 === 0) {
      this._tone(t, 0.35, 'sine', 150, 38, 0.9, M);
      this._noise(t, 0.02, 'highpass', 2000, 0.5, 0.15, M);
    }
    if (I >= 3 && (s16 === 14)) this._tone(t, 0.25, 'sine', 150, 40, 0.6, M);
    // snare / clap
    if (I >= 1 && (s16 === 4 || s16 === 12)) {
      this._noise(t, 0.18, 'bandpass', 1800, 0.8, 0.45, M);
      this._tone(t, 0.1, 'triangle', 220, 120, 0.2, M);
    }
    // hats
    if (I >= 1 && s16 % 2 === 1) this._noise(t, 0.04, 'highpass', 8000, 0.5, I >= 2 ? 0.14 : 0.08, M);
    if (I >= 2 && s16 % 2 === 0) this._noise(t, 0.02, 'highpass', 10000, 0.5, 0.05, M);
    // bass: rolling 16ths with octave jumps
    if (I >= 0.5) {
      const pattern = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 2];
      const p = pattern[s16];
      if (p) {
        const f = ch.root * (p === 2 ? 2 : 1) * (s16 % 8 === 6 && I >= 2 ? 2 : 1);
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const fl = this.ctx.createBiquadFilter();
        fl.type = 'lowpass';
        fl.Q.value = 6;
        fl.frequency.setValueAtTime(200 + I * 350, t);
        fl.frequency.exponentialRampToValueAtTime(90, t + STEP * 0.9);
        const g = this.ctx.createGain();
        this._env(g, t, 0.004, 0.32, STEP * 0.9);
        o.connect(fl).connect(g).connect(this.dist);
        o.start(t);
        o.stop(t + STEP);
      }
    }
    // pad: chord on bar start
    if (s16 === 0) {
      for (const f of ch.tones) {
        for (const det of [-6, 6]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f * 0.5;
          o.detune.value = det;
          const fl = this.ctx.createBiquadFilter();
          fl.type = 'lowpass';
          fl.frequency.value = 500 + I * 300;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.025, t + 0.4);
          g.gain.exponentialRampToValueAtTime(0.0001, t + STEP * 16);
          o.connect(fl).connect(g).connect(M);
          o.start(t);
          o.stop(t + STEP * 16 + 0.1);
        }
      }
    }
    // arp
    if (I >= 2) {
      const order = [0, 1, 2, 1, 0, 2, 1, 2];
      const f = ch.tones[order[s16 % 8]] * (s16 >= 8 && I >= 3 ? 2 : 1);
      this._tone(t, STEP * 0.8, 'square', f, null, 0.035, this.delay);
    }
    // high stabs at max intensity
    if (I >= 3 && (s16 === 0 || s16 === 3 || s16 === 6)) {
      for (const f of ch.tones) this._tone(t, 0.12, 'sawtooth', f * 2, null, 0.025, M);
    }
  }
}
