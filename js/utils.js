/* ============================================================
   PRIMAL ISLE — utilities, seeded noise, synthesized audio
   ============================================================ */
(function () {
  'use strict';

  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smoothstep = (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.damp = (a, b, lambda, dt) => U.lerp(a, b, 1 - Math.exp(-lambda * dt));
  U.wrapAngle = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  U.angleLerp = (a, b, t) => a + U.wrapAngle(b - a) * t;
  U.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  U.hypot = (x, z) => Math.sqrt(x * x + z * z);

  U.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.seedFrom = function (str) {
    let h = 2166136261;
    for (let i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  U.pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  U.fmtClock = function (dayTime) {
    const mins = Math.floor((dayTime % 1) * 24 * 60);
    return U.pad2(Math.floor(mins / 60)) + ':' + U.pad2(mins % 60);
  };

  U.isCoarse = () =>
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    navigator.maxTouchPoints > 0;

  U.vibrate = function (ms) {
    try {
      if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  };

  U.projectToScreen = function (vec, camera, width, height) {
    const p = vec.clone().project(camera);
    return {
      x: (p.x * 0.5 + 0.5) * width,
      y: (-p.y * 0.5 + 0.5) * height,
      visible: p.z > -1 && p.z < 1,
    };
  };

  /* ------------------------- value noise ------------------------- */
  class Noise {
    constructor(seed) {
      this.seed = (seed >>> 0) || 1;
    }
    hash(x, y) {
      let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(this.seed, 362437);
      h = (h ^ (h >>> 13)) | 0;
      h = Math.imul(h, 1274126177);
      h = (h ^ (h >>> 16)) >>> 0;
      return h / 4294967296;
    }
    value(x, y) {
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      const a = this.hash(xi, yi);
      const b = this.hash(xi + 1, yi);
      const c = this.hash(xi, yi + 1);
      const d = this.hash(xi + 1, yi + 1);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    fbm(x, y, oct = 4, gain = 0.5, lac = 2) {
      let sum = 0;
      let amp = 0.5;
      let freq = 1;
      let norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += amp * this.value(x * freq, y * freq);
        norm += amp;
        amp *= gain;
        freq *= lac;
      }
      return sum / norm;
    }
  }

  /* --------------------------- audio ---------------------------- */
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.started = false;
      this.noiseBuffer = null;
      this.ambient = null;
      this._birdTimer = 6;
      this._windGain = null;
      this._waveGain = null;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.55;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this._makeNoise(2.2);
        this._startAmbient();
        this.started = true;
      } catch (e) {
        this.ctx = null;
      }
    }

    _makeNoise(seconds) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = this.ctx.createBuffer(1, len, rate);
      const data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.72 + white * 0.28;
        data[i] = last;
      }
      return buf;
    }

    _startAmbient() {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const wind = ctx.createBufferSource();
      wind.buffer = this.noiseBuffer;
      wind.loop = true;
      const windF = ctx.createBiquadFilter();
      windF.type = 'lowpass';
      windF.frequency.value = 420;
      windF.Q.value = 0.6;
      const windG = ctx.createGain();
      windG.gain.value = 0.055;
      wind.connect(windF).connect(windG).connect(this.master);
      wind.start();

      const waves = ctx.createBufferSource();
      waves.buffer = this.noiseBuffer;
      waves.loop = true;
      waves.playbackRate.value = 0.83;
      const waveF = ctx.createBiquadFilter();
      waveF.type = 'bandpass';
      waveF.frequency.value = 520;
      waveF.Q.value = 0.45;
      const waveG = ctx.createGain();
      waveG.gain.value = 0.032;
      waves.connect(waveF).connect(waveG).connect(this.master);
      waves.start();

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.02;
      lfo.connect(lfoG).connect(windG.gain);
      lfo.start();

      const lfo2 = ctx.createOscillator();
      lfo2.frequency.value = 0.11;
      const lfo2g = ctx.createGain();
      lfo2g.gain.value = 0.016;
      lfo2.connect(lfo2g).connect(waveG.gain);
      lfo2.start();

      this.ambient = { wind, waves, lfo, lfo2 };
      this._windGain = windG;
      this._waveGain = waveG;
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.06);
      }
      try {
        localStorage.setItem('primalisle.muted', this.muted ? '1' : '0');
      } catch (e) {}
    }

    update(dt, night) {
      if (!this.ctx || this.muted) return;
      if (this._windGain) {
        this._windGain.gain.setTargetAtTime(night ? 0.075 : 0.045, this.ctx.currentTime, 1.5);
      }
      if (this._waveGain) {
        this._waveGain.gain.setTargetAtTime(night ? 0.038 : 0.028, this.ctx.currentTime, 2);
      }
      this._birdTimer -= dt;
      if (this._birdTimer < 0) {
        this._birdTimer = 7 + Math.random() * 13;
        if (!night && Math.random() < 0.75) this._bird();
      }
    }

    _tone(o) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (o.delay || 0);
      const osc = ctx.createOscillator();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t0);
      if (o.freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freq2), t0 + o.dur);
      const g = ctx.createGain();
      const peak = (o.gain == null ? 0.08 : o.gain);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(g);
      if (o.filter) {
        const f = ctx.createBiquadFilter();
        f.type = o.filter;
        f.frequency.value = o.filterFreq || 800;
        g.connect(f).connect(this.master);
      } else {
        g.connect(this.master);
      }
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.05);
    }

    _noise(o) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (o.delay || 0);
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = o.rate || 1;
      const f = ctx.createBiquadFilter();
      f.type = o.filter || 'bandpass';
      f.frequency.setValueAtTime(o.freq || 900, t0);
      if (o.freq2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freq2), t0 + o.dur);
      f.Q.value = o.q || 0.8;
      const g = ctx.createGain();
      const peak = o.gain == null ? 0.1 : o.gain;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.005));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + o.dur + 0.05);
    }

    _bird() {
      const base = 1800 + Math.random() * 1400;
      for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) {
        this._tone({
          freq: base + i * 180,
          freq2: base + 600 + Math.random() * 400,
          dur: 0.06 + Math.random() * 0.05,
          type: 'sine',
          gain: 0.018,
          delay: i * 0.09,
        });
      }
    }

    ui() {
      this._tone({ freq: 620, freq2: 440, dur: 0.06, type: 'triangle', gain: 0.03 });
    }
    step(surface) {
      const wet = surface === 'water' || surface === 'sand';
      this._noise({
        freq: wet ? 520 : 850,
        freq2: wet ? 300 : 520,
        dur: wet ? 0.16 : 0.1,
        rate: 0.7 + Math.random() * 0.3,
        filter: 'lowpass',
        gain: wet ? 0.055 : 0.04,
        q: 0.5,
      });
    }
    harvest(type) {
      if (type === 'rock') {
        this._tone({ freq: 160, freq2: 90, dur: 0.12, type: 'square', gain: 0.05 });
        this._noise({ freq: 1800, freq2: 600, dur: 0.09, filter: 'bandpass', q: 1.2, gain: 0.07 });
      } else if (type === 'tree') {
        this._noise({ freq: 300, freq2: 140, dur: 0.15, filter: 'lowpass', gain: 0.09, q: 0.7 });
        this._tone({ freq: 120, freq2: 70, dur: 0.1, type: 'triangle', gain: 0.045 });
      } else {
        this._noise({ freq: 1400, freq2: 700, dur: 0.1, filter: 'bandpass', gain: 0.05, q: 0.9 });
      }
    }
    swing() {
      this._noise({ freq: 1400, freq2: 500, dur: 0.12, filter: 'bandpass', q: 0.9, gain: 0.04 });
    }
    hit() {
      this._tone({ freq: 120, freq2: 55, dur: 0.16, type: 'square', gain: 0.07 });
      this._noise({ freq: 700, freq2: 200, dur: 0.12, filter: 'lowpass', gain: 0.09 });
    }
    hurt() {
      this._tone({ freq: 90, freq2: 60, dur: 0.3, type: 'sawtooth', gain: 0.06, filter: 'lowpass', filterFreq: 300 });
      this._noise({ freq: 500, freq2: 180, dur: 0.22, filter: 'lowpass', gain: 0.07 });
    }
    roar() {
      this._tone({ freq: 150, freq2: 46, dur: 0.85, type: 'sawtooth', gain: 0.1, filter: 'lowpass', filterFreq: 420, attack: 0.04 });
      this._noise({ freq: 380, freq2: 120, dur: 0.8, filter: 'bandpass', q: 0.6, gain: 0.12, attack: 0.03 });
      this._tone({ freq: 74, freq2: 40, dur: 0.9, type: 'square', gain: 0.04, delay: 0.06 });
    }
    chime() {
      [660, 880, 1320].forEach((f, i) => this._tone({ freq: f, dur: 0.18, type: 'sine', gain: 0.035, delay: i * 0.06 }));
    }
    tame() {
      [523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.045, delay: i * 0.09 }));
    }
    levelup() {
      [392, 523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, dur: 0.45, type: 'triangle', gain: 0.05, delay: i * 0.08 }));
    }
    craft() {
      this._noise({ freq: 1200, freq2: 400, dur: 0.09, filter: 'bandpass', gain: 0.05 });
      this._tone({ freq: 300, freq2: 220, dur: 0.12, type: 'square', gain: 0.03 });
      this._tone({ freq: 880, dur: 0.1, type: 'sine', gain: 0.02, delay: 0.08 });
    }
    place() {
      this._tone({ freq: 110, freq2: 55, dur: 0.18, type: 'triangle', gain: 0.08 });
      this._noise({ freq: 380, freq2: 160, dur: 0.15, filter: 'lowpass', gain: 0.07 });
    }
    eat() {
      for (let i = 0; i < 3; i++) {
        this._noise({ freq: 900 + Math.random() * 700, dur: 0.06, filter: 'bandpass', q: 1.3, gain: 0.04, delay: i * 0.07 });
      }
    }
    loot() {
      [880, 1174, 1568].forEach((f, i) => this._tone({ freq: f, dur: 0.22, type: 'sine', gain: 0.03, delay: i * 0.05 }));
      this._noise({ freq: 2600, freq2: 900, dur: 0.3, filter: 'highpass', gain: 0.025 });
    }
    splash() {
      this._noise({ freq: 700, freq2: 220, dur: 0.25, filter: 'lowpass', gain: 0.06 });
    }
    fire() {
      this._noise({ freq: 900, freq2: 1600, dur: 0.12, filter: 'bandpass', q: 0.8, gain: 0.02 });
    }
  }

  window.U = U;
  window.Noise = Noise;
  window.SoundEngine = SoundEngine;
  window.Sfx = new SoundEngine();
})();
