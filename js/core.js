'use strict';
/* ==========================================================================
   ARIEL — HEIR OF THUNDER
   core.js · shared state, math helpers, noise, input, audio, voice
   ========================================================================== */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const G = (window.G = {
  time: 0, dt: 0, timeScale: 1, hitStop: 0, slowMo: 1,
  state: 'loading',
  scene: null, camera: null, renderer: null,
  player: null, enemies: [], npcs: [], interactables: [],
  flags: {},
  params: new URLSearchParams(location.search),
  uniforms: { time: { value: 0 } },
  settings: {
    // quality null = not chosen yet: the game picks one for the graphics card at boot
    v: 2, quality: null, sensitivity: 1, invertY: false,
    master: 0.8, music: 0.55, sfx: 0.85, voice: true, voiceVol: 1,
    shake: true, showFps: false,
  },
});

(function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('ariel_settings') || 'null');
    if (s) {
      // saves from before v2 may hold a quality the old auto-tuner forced down: choose again
      if ((s.v || 1) < 2) { delete s.quality; s.v = 2; }
      Object.assign(G.settings, s);
    }
  } catch (e) { /* storage unavailable: defaults are fine */ }
})();

function saveSettings() {
  try { localStorage.setItem('ariel_settings', JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}

/* ---------------------------------------------------------------- math */
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function invLerp(a, b, v) { return clamp((v - a) / (b - a), 0, 1); }
function smooth(a, b, v) { const t = invLerp(a, b, v); return t * t * (3 - 2 * t); }
function damp(a, b, lambda, dt) { return lerp(a, b, 1 - Math.exp(-lambda * dt)); }
function wrapAngle(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function dampAngle(a, b, lambda, dt) { return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt)); }
function lerpAngle(a, b, t) { return a + wrapAngle(b - a) * t; }
function rand(a = 0, b = 1) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }
function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); }

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------- noise */
const GRAD3 = new Float32Array([1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1]);
class Simplex2 {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    this.perm = new Uint8Array(512);
    this.pm12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = p[i & 255]; this.pm12[i] = this.perm[i] % 12; }
  }
  noise(xin, yin) {
    const F2 = 0.36602540378, G2 = 0.2113248654;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255, P = this.perm, M = this.pm12;
    let n = 0, tt;
    tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) { const g = M[ii + P[jj]] * 2; tt *= tt; n += tt * tt * (GRAD3[g] * x0 + GRAD3[g + 1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { const g = M[ii + i1 + P[jj + j1]] * 2; tt *= tt; n += tt * tt * (GRAD3[g] * x1 + GRAD3[g + 1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { const g = M[ii + 1 + P[jj + 1]] * 2; tt *= tt; n += tt * tt * (GRAD3[g] * x2 + GRAD3[g + 1] * y2); }
    return 70 * n;
  }
  fbm(x, y, oct = 5, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { s += a * this.noise(x * f, y * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  ridged(x, y, oct = 5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(this.noise(x * f, y * f)); s += a * v * v; n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
}

/** Tileable fractal value noise on a size×size grid, normalised to [0,1]. */
function tileField(size, period, octaves, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  const rnd = mulberry32(seed);
  let amp = 1, p = period;
  for (let o = 0; o < octaves && p <= size; o++) {
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const sc = p / size;
    for (let y = 0; y < size; y++) {
      const fy = y * sc, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % p) * p, yb = ((y0 + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const fx = x * sc, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % p, xb = (x0 + 1) % p;
        const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx;
        const b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
        out[y * size + x] += amp * (a + (b - a) * sy);
      }
    }
    amp *= gain; p *= 2;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

/* --------------------------------------------------------------- input */
const Input = {
  keys: {}, hit: {}, mb: {}, mhit: {}, dx: 0, dy: 0, wheel: 0, locked: false, anyHit: false, el: null,
  init(el) {
    this.el = el;
    addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this.hit[e.code] = true;
      this.keys[e.code] = true;
      this.anyHit = true;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      Sound.init();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('blur', () => { this.keys = {}; this.mb = {}; });
    el.addEventListener('mousedown', (e) => {
      this.mb[e.button] = true; this.mhit[e.button] = true; this.anyHit = true;
      if (e.button === 1) e.preventDefault();
      Sound.init();
    });
    addEventListener('mousedown', () => Sound.init());
    addEventListener('mouseup', (e) => { this.mb[e.button] = false; });
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.dx += e.movementX || 0; this.dy += e.movementY || 0; }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (G.onPointerLock) G.onPointerLock(this.locked);
    });
  },
  lock() {
    if (this.locked || !this.el.requestPointerLock) return;
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* not allowed right now */ }
  },
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); },
  down(c) { return !!this.keys[c]; },
  pressed(c) { return !!this.hit[c]; },
  mouse(b) { return !!this.mb[b]; },
  clicked(b) { return !!this.mhit[b]; },
  consume(c) { this.hit[c] = false; },
  endFrame() { this.hit = {}; this.mhit = {}; this.dx = 0; this.dy = 0; this.wheel = 0; this.anyHit = false; },
};

/* --------------------------------------------------------------- audio */
const Sound = {
  ctx: null, ready: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.voiceBus = c.createGain(); this.voiceBus.connect(this.master);
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(3.4, 2.6);
    this.revIn = c.createGain(); this.revIn.gain.value = 0.9;
    this.revIn.connect(this.reverb); this.reverb.connect(this.master);
    this.white = this._noise(4, false);
    this.brown = this._noise(5, true);
    this.ready = true;
    this.applyVolumes();
    this.loadSamples();
    if (this._pendingMusic) Music.play(this._pendingMusic);
    if (this._pendingWind) this.startWind();
    Voice.preload();
  },
  /**
   * Recorded sounds: Kenney's "Impact Sounds" and "RPG Audio" (CC0, assets/sfx). Each group holds variations, one is
   * picked at random (never the same twice running) and pitched a little each time. Until they have loaded, or where
   * a browser can't decode Ogg, the synthesized versions below play instead.
   */
  SAMPLES: {
    flesh: ['impactPunch_heavy_000', 'impactPunch_heavy_001', 'impactPunch_heavy_002', 'impactPunch_heavy_003', 'impactPunch_heavy_004'],
    fleshLight: ['impactPunch_medium_000', 'impactPunch_medium_001', 'impactPunch_medium_002', 'impactPunch_medium_003', 'impactPunch_medium_004'],
    cut: ['knifeSlice', 'knifeSlice2', 'chop'],
    plate: ['impactPlate_heavy_000', 'impactPlate_heavy_001', 'impactPlate_heavy_002', 'impactPlate_heavy_003', 'impactPlate_heavy_004'],
    metal: ['impactMetal_heavy_000', 'impactMetal_heavy_001', 'impactMetal_heavy_002', 'impactMetal_heavy_003', 'impactMetal_heavy_004'],
    thud: ['impactSoft_heavy_000', 'impactSoft_heavy_001', 'impactSoft_heavy_002', 'impactSoft_heavy_003', 'impactSoft_heavy_004'],
    grass: ['footstep_grass_000', 'footstep_grass_001', 'footstep_grass_002', 'footstep_grass_003', 'footstep_grass_004'],
    stone: ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_concrete_004'],
    wood: ['footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002', 'footstep_wood_003', 'footstep_wood_004'],
    dirt: ['footstep00', 'footstep01', 'footstep02', 'footstep03', 'footstep04', 'footstep05', 'footstep06', 'footstep07', 'footstep08', 'footstep09'],
    cloth: ['cloth1', 'cloth2', 'cloth3', 'cloth4', 'clothBelt', 'clothBelt2'],
  },
  loadSamples() {
    if (this._samples) return;
    this._samples = {}; this._lastSample = {};
    for (const [g, names] of Object.entries(this.SAMPLES)) {
      this._samples[g] = [];
      for (const n of names) {
        fetch(`assets/sfx/${n}.ogg`).then((r) => r.arrayBuffer()).then((ab) => this.ctx.decodeAudioData(ab)).then((b) => this._samples[g].push(b)).catch(() => {});
      }
    }
  },
  /** play one of a group's recordings; false if none is ready (so the caller can synthesize instead) */
  sample(g, { gain = 1, rate = 1, delay = 0, rev = 0, spread = 0.06 } = {}) {
    const list = this.ready && this._samples && this._samples[g];
    if (!list || !list.length || gain < 0.002) return false;
    let i = Math.floor(Math.random() * list.length);
    if (list.length > 1 && i === this._lastSample[g]) i = (i + 1) % list.length;
    this._lastSample[g] = i;
    const c = this.ctx, src = c.createBufferSource(), out = c.createGain();
    src.buffer = list[i];
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * spread);
    out.gain.value = gain;
    src.connect(out); out.connect(this.sfx);
    if (rev) { const s = c.createGain(); s.gain.value = rev; out.connect(s); s.connect(this.revIn); }
    src.start(c.currentTime + delay);
    return true;
  },
  /** what Ariel (or whoever) is walking on: grass, the road's dirt, stone, or the pier's boards */
  surface(pos = G.player && G.player.pos) {
    try {
      const sc = FX.scene;
      if (typeof Memory !== 'undefined' && sc === Memory.scene) return 'wood';
      if (sc !== G.scene || !pos) return 'stone';
      const A = World.arenaFloor;
      if (A && (pos.x - A.x) ** 2 + (pos.z - A.z) ** 2 < A.r2) return 'stone';
      if (World.pathInfo(pos.x, pos.z).d < 3.2) return 'dirt';
      return 'grass';
    } catch (e) { return 'grass'; }
  },
  applyVolumes() {
    if (!this.ready) return;
    const s = G.settings;
    this.master.gain.value = s.master;
    this.music.gain.value = s.music * 0.6;
    this.sfx.gain.value = s.sfx;
    this.amb.gain.value = s.sfx * 0.7;
    this.voiceBus.gain.value = 1.15 * (s.voiceVol ?? 1);
  },
  /** lower the music while someone is speaking */
  duck(on) {
    if (!this.ready) return;
    const base = G.settings.music * 0.6;
    this.music.gain.setTargetAtTime(on ? base * 0.38 : base, this.ctx.currentTime, on ? 0.12 : 0.6);
  },
  _impulse(sec, decay) {
    const c = this.ctx, rate = c.sampleRate, len = Math.floor(rate * sec);
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  },
  _noise(sec, brown) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  },
  /** volume factor for a world position */
  at(pos, range = 60) {
    if (!pos || !G.camera) return 1;
    return clamp(1 - G.camera.position.distanceTo(pos) / range, 0, 1);
  },
  noise(o) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur || 0.3;
    const peak = (o.gain ?? 0.3);
    if (peak < 0.002) return;
    const src = c.createBufferSource();
    src.buffer = o.buf === 'brown' ? this.brown : this.white;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || this.sfx);
    if (o.rev) { const s = c.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(this.revIn); }
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.1);
  },
  tone(o) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur || 0.3;
    const peak = (o.gain ?? 0.2);
    if (peak < 0.002) return;
    const osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f || 440, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    let node = osc;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(o.dest || this.sfx);
    if (o.rev) { const s = c.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(this.revIn); }
    osc.start(t); osc.stop(t + dur + 0.1);
  },

  /* ---- effects library ---- */
  /** a blade through the air: a rising whistle over a heavy push of air */
  swing(heavy, v = 1) {
    const p = rand(0.92, 1.08);
    this.noise({ type: 'bandpass', f: (heavy ? 340 : 620) * p, f2: (heavy ? 1500 : 2700) * p, q: 2.2, dur: heavy ? 0.42 : 0.24, gain: (heavy ? 0.5 : 0.3) * v, attack: heavy ? 0.12 : 0.07 });
    this.noise({ buf: 'brown', type: 'lowpass', f: heavy ? 520 : 700, f2: 160, dur: heavy ? 0.5 : 0.3, gain: (heavy ? 0.55 : 0.28) * v, attack: 0.08 });
    this.sample('cloth', { gain: (heavy ? 0.32 : 0.2) * v, rate: 0.9 });
  },
  /**
   * A blow landing. Flesh: a deep body thump, the crack of the cut, a wet tear and the spatter of what it threw.
   * Metal: struck plate rings with a bar's uneven overtones (not a square wave's buzz), over the clack of the hit.
   */
  hit(kind = 'flesh', v = 1) {
    const p = rand(0.9, 1.1);
    if (kind === 'metal' && this.sample('plate', { gain: 0.8 * v, rate: 0.82, rev: 0.12 })) {
      // armour rings, and under it the body behind the plate takes the blow (and bleeds)
      this.sample('metal', { gain: 0.4 * v, rate: 0.78 });
      this.sample('flesh', { gain: 0.5 * v, rate: 0.8, delay: 0.01 });
      this.tone({ f: 105 * p, f2: 40, dur: 0.2, gain: 0.45 * v, attack: 0.002 });
      this.splat(0.5 * v);
      return;
    }
    if (kind !== 'metal' && this.sample('flesh', { gain: 1.0 * v, rate: 0.8 })) {
      this.sample('cut', { gain: 0.6 * v, rate: 0.92, delay: 0.004 });
      this.tone({ f: 115 * p, f2: 40, dur: 0.22, gain: 0.55 * v, attack: 0.002 });
      this.splat(0.85 * v);
      return;
    }
    if (kind === 'metal') {
      const f0 = rand(380, 520);
      [[1, 0.1, 0.5], [2.76, 0.07, 0.36], [5.4, 0.05, 0.24], [8.93, 0.03, 0.16]].forEach(([k, g, d]) => this.tone({ f: f0 * k, dur: d, gain: g * v, rev: 0.3 }));
      this.noise({ type: 'bandpass', f: 3200 * p, q: 0.8, dur: 0.05, gain: 0.45 * v });
      this.noise({ buf: 'brown', type: 'lowpass', f: 900, dur: 0.12, gain: 0.4 * v });
    } else {
      this.tone({ f: 120 * p, f2: 42, dur: 0.2, gain: 0.7 * v, attack: 0.002 });
      this.noise({ buf: 'brown', type: 'lowpass', f: 900 * p, f2: 180, dur: 0.22, gain: 0.85 * v, q: 0.6 });
      this.noise({ type: 'highpass', f: 3600, dur: 0.045, gain: 0.32 * v });
      this.noise({ type: 'bandpass', f: 1400 * p, f2: 520, q: 1.8, dur: 0.16, gain: 0.42 * v, attack: 0.012, delay: 0.01 });
      this.splat(v * 0.8);
    }
  },
  /** wet spatter: a scatter of tiny drops landing */
  splat(v = 1) {
    for (let i = 0; i < 7; i++) this.noise({ type: 'bandpass', f: rand(900, 3200), q: rand(2, 5), dur: rand(0.025, 0.06), gain: rand(0.06, 0.16) * v, delay: 0.05 + rand(0, 0.22) });
  },
  step(big = false, v = 1) {
    if (big && this.sample('thud', { gain: 0.85 * v, rate: 0.62 })) { this.tone({ f: 62, f2: 30, dur: 0.35, gain: 0.45 * v }); return; }
    if (!big && this.sample(this.surface(), { gain: 0.5 * v, rate: 0.95 })) return;
    if (big) { this.tone({ f: 70, f2: 35, dur: 0.35, gain: 0.5 * v }); this.noise({ buf: 'brown', type: 'lowpass', f: 300, dur: 0.3, gain: 0.5 * v }); }
    else this.noise({ type: 'bandpass', f: rand(900, 1400), q: 0.8, dur: 0.07, gain: 0.05 * v });
  },
  roll() {
    if (this.sample('cloth', { gain: 0.55, rate: 0.85 })) { this.sample('thud', { gain: 0.4, rate: 0.85, delay: 0.18 }); this.noise({ type: 'lowpass', f: 500, f2: 180, dur: 0.4, gain: 0.18, attack: 0.04 }); return; }
    this.noise({ type: 'lowpass', f: 600, f2: 200, dur: 0.4, gain: 0.3, attack: 0.04 }); this.noise({ type: 'bandpass', f: 1500, q: 0.6, dur: 0.3, gain: 0.08, attack: 0.05 });
  },
  thunder(distance = 0) {
    const v = clamp(1 - distance / 3000, 0.15, 1);
    const delay = distance / 343;
    if (distance < 200) this.noise({ type: 'highpass', f: 1800, dur: 0.22, gain: 0.8 * v, delay });
    this.noise({ buf: 'brown', type: 'lowpass', f: distance < 200 ? 600 : 260, f2: 60, dur: 4.5, gain: 1.4 * v, attack: 0.04, delay: delay + 0.03, rev: 0.4 });
    this.noise({ buf: 'brown', type: 'lowpass', f: 180, dur: 3.2, gain: 0.8 * v, attack: 0.4, delay: delay + 0.6 });
  },
  zap() {
    this.noise({ type: 'bandpass', f: 3200, f2: 800, q: 6, dur: 0.5, gain: 0.35 });
    this.tone({ type: 'sawtooth', f: 90, f2: 40, dur: 0.5, gain: 0.18, lp: 1200 });
  },
  heal() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ f, dur: 1.2, gain: 0.12, delay: i * 0.08, attack: 0.02, rev: 0.6 })); },
  bell() {
    [[392, 0.35], [784.6, 0.18], [1176, 0.1], [1569, 0.06]].forEach(([f, g]) => this.tone({ f, dur: 4, gain: g, attack: 0.01, rev: 0.9 }));
  },
  levelUp() {
    [294, 370, 440, 587, 740].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 2.2, gain: 0.1, delay: i * 0.06, rev: 0.8, attack: 0.02 }));
    this.noise({ type: 'highpass', f: 5000, dur: 1.6, gain: 0.08, attack: 0.3, rev: 0.6 });
  },
  ui(kind = 'move') {
    if (kind === 'move') this.tone({ f: 1250, dur: 0.05, gain: 0.04 });
    else if (kind === 'ok') { this.tone({ type: 'triangle', f: 660, f2: 990, dur: 0.14, gain: 0.12 }); }
    else this.tone({ type: 'triangle', f: 500, f2: 330, dur: 0.14, gain: 0.1 });
  },
  roar(pitch = 1, v = 1) {
    this.noise({ buf: 'brown', type: 'bandpass', f: 420 * pitch, f2: 160 * pitch, q: 2.5, dur: 1.4, gain: 1.1 * v, attack: 0.08, rev: 0.4 });
    this.tone({ type: 'sawtooth', f: 95 * pitch, f2: 55 * pitch, dur: 1.3, gain: 0.25 * v, lp: 700, attack: 0.08 });
  },
  fire(big = false, v = 1) {
    this.noise({ type: 'lowpass', f: big ? 2200 : 1400, f2: 300, dur: big ? 1.2 : 0.6, gain: (big ? 0.8 : 0.4) * v, attack: 0.03, rev: 0.3 });
    if (big) this.tone({ f: 60, f2: 30, dur: 0.8, gain: 0.6 * v });
  },
  boom(v = 1) { this.tone({ f: 70, f2: 28, dur: 0.9, gain: 0.9 * v }); this.noise({ buf: 'brown', type: 'lowpass', f: 500, f2: 80, dur: 1.2, gain: 0.9 * v, rev: 0.3 }); },
  death() {
    this.tone({ type: 'sawtooth', f: 110, f2: 52, dur: 3, gain: 0.25, lp: 500, attack: 0.2, rev: 0.6 });
    this.tone({ f: 55, dur: 3.5, gain: 0.4, attack: 0.3 });
    this.noise({ buf: 'brown', type: 'lowpass', f: 300, dur: 3, gain: 0.5, attack: 0.5, rev: 0.6 });
  },
  gate() { this.noise({ type: 'bandpass', f: 300, f2: 1400, q: 1, dur: 1.4, gain: 0.5, attack: 0.3, rev: 0.6 }); },
  /** lub-dub: a heart pounding in the ears */
  heartbeat(v = 1) {
    this.tone({ f: 64, f2: 38, dur: 0.2, gain: 0.7 * v, attack: 0.01 });
    this.tone({ f: 58, f2: 36, dur: 0.18, gain: 0.5 * v, attack: 0.01, delay: 0.26 });
  },
  pickup() { [880, 1320, 1760].forEach((f, i) => this.tone({ f, dur: 0.6, gain: 0.08, delay: i * 0.05, rev: 0.6 })); },
  victory() {
    [146.8, 220, 293.7, 370, 440, 587].forEach((f) => this.tone({ type: 'sawtooth', f, dur: 6, gain: 0.05, attack: 1.2, lp: 1800, rev: 0.9 }));
    this.boom(0.8);
  },

  /* ---- ambience beds ---- */
  startWind() {
    if (!this.ready) { this._pendingWind = true; return; }
    if (this.wind) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.brown; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = c.createGain(); g.gain.value = 0.28;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.08;
    const lg = c.createGain(); lg.gain.value = 0.14;
    lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.13;
    const lg2 = c.createGain(); lg2.gain.value = 220;
    lfo2.connect(lg2); lg2.connect(f.frequency);
    src.connect(f); f.connect(g); g.connect(this.amb);
    src.start(); lfo.start(); lfo2.start();
    this.wind = { src, g };
  },
  setWind(v) { if (this.wind) this.wind.g.gain.setTargetAtTime(0.28 * v, this.ctx.currentTime, 0.8); },
  startRain() {
    if (!this.ready || this.rain) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.white; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const g = c.createGain(); g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.22, c.currentTime + 1.5);
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.amb);
    src.start();
    this.rain = { src, g };
  },
  setRain(v) { if (this.rain) this.rain.g.gain.setTargetAtTime(Math.max(0.0001, 0.22 * v), this.ctx.currentTime, 0.15); },
  stopRain() {
    if (!this.rain) return;
    const r = this.rain; this.rain = null;
    r.g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    setTimeout(() => { try { r.src.stop(); } catch (e) { /* already stopped */ } }, 2500);
  },
};

/* --------------------------------------------------------------- music
   Procedural score: choir pads + lyre plucks for exploration, war drums
   and a bass ostinato for the boss. Scheduled ahead on the audio clock. */
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const Music = {
  mode: null, bus: null, timer: null, step: 0, next: 0, bpm: 60, intensity: 0,
  CHORDS: [[50, 57, 62, 65], [46, 53, 58, 62], [43, 55, 58, 62], [45, 57, 61, 64]],
  play(mode) {
    if (!Sound.ready) { Sound._pendingMusic = mode; return; }
    if (this.mode === mode) return;
    const c = Sound.ctx, t = c.currentTime;
    if (this.bus) {
      const old = this.bus;
      old.gain.cancelScheduledValues(t);
      old.gain.setTargetAtTime(0.0001, t, 0.9);
      setTimeout(() => old.disconnect(), 5000);
    }
    this.mode = mode;
    this.bus = null;
    if (mode === 'none') return;
    this.bus = c.createGain();
    this.bus.gain.setValueAtTime(0.0001, t);
    this.bus.gain.exponentialRampToValueAtTime(1, t + (mode === 'boss' ? 0.6 : 3));
    this.bus.connect(Sound.music);
    this.step = 0;
    this.next = t + 0.15;
    this.bpm = mode === 'boss' ? 126 : mode === 'victory' ? 50 : 58;
    if (!this.timer) this.timer = setInterval(() => this.tick(), 40);
  },
  tick() {
    if (!this.bus || !Sound.ready) return;
    const spb = 60 / this.bpm / 4;
    while (this.next < Sound.ctx.currentTime + 0.3) {
      this.schedule(this.step, this.next, spb);
      this.next += spb;
      this.step++;
    }
  },
  choir(freq, t, dur, gain) {
    const c = Sound.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(2.2, dur * 0.35));
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 730; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1090; f2.Q.value = 4;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const vib = c.createOscillator(); vib.frequency.value = 4.6 + Math.random();
    const vg = c.createGain(); vg.gain.value = 5;
    vib.connect(vg);
    const oscs = [-9, 0, 8].map((d) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = d;
      vg.connect(o.detune); o.connect(f1); o.connect(f2); o.connect(lp); return o;
    });
    const body = c.createOscillator(); body.frequency.value = freq;
    const bg = c.createGain(); bg.gain.value = 0.6; body.connect(bg); bg.connect(g);
    const mix = c.createGain(); mix.gain.value = 0.5;
    f1.connect(mix); f2.connect(mix);
    const lpg = c.createGain(); lpg.gain.value = 0.12; lp.connect(lpg); lpg.connect(mix);
    mix.connect(g);
    g.connect(this.bus);
    const s = c.createGain(); s.gain.value = 0.8; g.connect(s); s.connect(Sound.revIn);
    [...oscs, body, vib].forEach((o) => { o.start(t); o.stop(t + dur + 0.2); });
  },
  pluck(freq, t, gain = 0.09) {
    const c = Sound.ctx;
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2.003;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    const g2 = c.createGain(); g2.gain.value = 0.3;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3800, t); lp.frequency.exponentialRampToValueAtTime(600, t + 1.5);
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.bus);
    const s = c.createGain(); s.gain.value = 0.7; g.connect(s); s.connect(Sound.revIn);
    o.start(t); o2.start(t); o.stop(t + 2.3); o2.stop(t + 2.3);
  },
  drum(t, gain = 1, pitch = 1) {
    const c = Sound.ctx;
    const o = c.createOscillator(); o.frequency.setValueAtTime(95 * pitch, t); o.frequency.exponentialRampToValueAtTime(42 * pitch, t + 0.35);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(this.bus);
    const s = c.createGain(); s.gain.value = 0.35; g.connect(s); s.connect(Sound.revIn);
    o.start(t); o.stop(t + 0.7);
    const n = c.createBufferSource(); n.buffer = Sound.brown; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * gain, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(nf); nf.connect(ng); ng.connect(this.bus);
    n.start(t, Math.random()); n.stop(t + 0.25);
  },
  snare(t, gain = 0.4) {
    const c = Sound.ctx;
    const n = c.createBufferSource(); n.buffer = Sound.white; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(f); f.connect(g); g.connect(this.bus);
    const s = c.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(Sound.revIn);
    n.start(t, Math.random()); n.stop(t + 0.25);
  },
  bass(freq, t, dur, gain = 0.22) {
    const c = Sound.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = freq * 0.5;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 4;
    f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = c.createGain(); g2.gain.value = 0.4;
    o.connect(f); o2.connect(g2); g2.connect(f); f.connect(g); g.connect(this.bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  },
  brass(notes, t, dur, gain = 0.07) {
    const c = Sound.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.12); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(this.bus);
    const s = c.createGain(); s.gain.value = 0.6; g.connect(s); s.connect(Sound.revIn);
    notes.forEach((m) => [-6, 6].forEach((d) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(m); o.detune.value = d;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }));
  },
  schedule(s, t, spb) {
    const m = this.mode;
    if (m === 'explore' || m === 'title') {
      const ci = Math.floor(s / 32) % 4, chord = this.CHORDS[ci];
      const quiet = m === 'explore' ? 0.55 : 1;
      if (s % 32 === 0) {
        const dur = 32 * spb + 2;
        chord.forEach((n, i) => this.choir(midi(n), t, dur, (i === 0 ? 0.05 : 0.035) * quiet));
        this.choir(midi(chord[0] - 12), t, dur, 0.04 * quiet);
      }
      if (s % 2 === 0 && Math.random() < (m === 'title' ? 0.28 : 0.16)) {
        const n = pick(chord) + (Math.random() < 0.5 ? 12 : 24);
        this.pluck(midi(n), t, 0.07 * quiet);
      }
      if (m === 'title' && s % 64 === 0) this.drum(t, 0.5, 0.8);
    } else if (m === 'boss') {
      const st = s % 16, ci = Math.floor(s / 32) % 4, chord = this.CHORDS[ci];
      const hard = this.intensity;
      if ([0, 3, 6, 8, 11, 14].includes(st)) this.drum(t, st === 0 || st === 8 ? 1 : 0.6, st % 2 ? 1.25 : 1);
      if (st === 4 || st === 12) this.snare(t, 0.35);
      if (hard && st % 2 === 1) this.snare(t, 0.08);
      if (st % 2 === 0) {
        const pat = [0, 0, 3, 0, 1, 0, -2, 0];
        this.bass(midi(chord[0] - 12 + pat[(st / 2) | 0]), t, spb * 1.8, 0.2);
      }
      if (st === 0) this.brass([chord[0], chord[0] + 7], t, spb * 6, 0.05 + hard * 0.03);
      if (s % 32 === 0) chord.forEach((n) => this.choir(midi(n + 12), t, 32 * spb, 0.03 + hard * 0.015));
    } else if (m === 'victory') {
      if (s === 0) [62, 66, 69, 74].forEach((n) => this.choir(midi(n), t, 12, 0.05));
      if (s === 32) [59, 62, 66, 71].forEach((n) => this.choir(midi(n), t, 12, 0.045));
      if (s % 4 === 0 && s < 64 && Math.random() < 0.5) this.pluck(midi(pick([74, 78, 81, 86])), t, 0.06);
    }
  },
};

/* --------------------------------------------------------------- voice
   Dialogue is performed by recorded neural-voice clips (assets/voice, made
   by tools/make_voices.py). A clip's id is an FNV-1a hash of "Speaker|text",
   so any line in the code finds its recording. Lines without a clip fall
   back to the system's speech engine. */
const Voice = {
  clips: new Map(), ready: false, token: 0, current: null, tts: [],
  ALIAS: { 'An echo of a fallen demigod': 'Echo' },
  // per-speaker treatment: reverb send, low-shelf boost (dB), lowpass, slap-back echo,
  // presence lift (dB at 2.8 kHz) and playback rate (below 1 = slower and a touch deeper, like tape)
  FX: {
    Narrator: { rev: 0.14, low: 4.5, presence: 2, rate: 0.965 },
    Ariel: { rev: 0.08 },
    Hermes: { rev: 0.12 },
    // the gods: big, but still a voice in the room, not a cathedral (a long tail and a slap-back muddied every word)
    Ares: { rev: 0.24, low: 4, presence: 1.5, rate: 0.955 },
    Zeus: { rev: 0.42, low: 5, presence: 1.5, rate: 0.95 },
    Echo: { rev: 0.75, lp: 3800, gain: 0.85 },
  },
  async init() {
    this.initTTS();
    try {
      // no-cache: re-recorded lines must not be timed from a stale manifest
      const r = await fetch('assets/voice/manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      const m = await r.json();
      for (const k in m) this.clips.set(k, { dur: m[k].dur, buf: null, loading: null });
      this.ready = true;
      this.preload();
    } catch (e) { /* opened from file:// or no recordings: system speech is used instead */ }
  },
  key(text, who) {
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(who + '|' + text)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  },
  speaker(name) { return this.ALIAS[name] || name; },
  /** seconds of recorded audio for this line, or 0 */
  duration(text, who) {
    who = this.speaker(who);
    const c = this.clips.get(this.key(text, who));
    return c ? c.dur / ((this.FX[who] || {}).rate || 1) : 0;
  },
  load(k, c) {
    if (!c.loading) c.loading = fetch(`assets/voice/${k}.mp3`).then((r) => r.arrayBuffer()).then((ab) => Sound.ctx.decodeAudioData(ab)).then((b) => (c.buf = b)).catch(() => null);
    return c.loading;
  },
  /** decode every clip in the background once audio is unlocked */
  preload() {
    if (!this.ready || !Sound.ready || this._preloading) return;
    this._preloading = true;
    (async () => { for (const [k, c] of this.clips) await this.load(k, c); })();
  },
  speak(text, who) {
    if (!G.settings.voice) return;
    who = this.speaker(who);
    this.stop();
    const k = this.key(text, who), c = this.clips.get(k);
    if (c) { if (Sound.ready) this.play(k, c, who); return; }
    this.speakTTS(text, who);
  },
  async play(k, c, who) {
    const token = ++this.token;
    const buf = c.buf || (await this.load(k, c));
    if (!buf || token !== this.token) return;
    const ctx = Sound.ctx, fx = this.FX[who] || {};
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (fx.rate) src.playbackRate.value = fx.rate;
    let node = src;
    if (fx.low) { const f = ctx.createBiquadFilter(); f.type = 'lowshelf'; f.frequency.value = 220; f.gain.value = fx.low; node.connect(f); node = f; }
    if (fx.presence) { const f = ctx.createBiquadFilter(); f.type = 'peaking'; f.frequency.value = 2800; f.Q.value = 0.8; f.gain.value = fx.presence; node.connect(f); node = f; }
    if (fx.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fx.lp; node.connect(f); node = f; }
    const g = ctx.createGain();
    g.gain.value = fx.gain || 1;
    node.connect(g); g.connect(Sound.voiceBus);
    if (fx.rev) { const s = ctx.createGain(); s.gain.value = fx.rev; g.connect(s); s.connect(Sound.revIn); }
    if (fx.delay) {
      const d = ctx.createDelay(1), fb = ctx.createGain(), out = ctx.createGain();
      d.delayTime.value = fx.delay; fb.gain.value = 0.25; out.gain.value = 0.3;
      g.connect(d); d.connect(fb); fb.connect(d); d.connect(out); out.connect(Sound.voiceBus);
    }
    src.start();
    this.current = { src, g };
    Sound.duck(true);
    src.onended = () => { if (this.current && this.current.src === src) { this.current = null; Sound.duck(false); } };
  },
  stop() {
    this.token++;
    if (this.current) {
      const { src, g } = this.current, t = Sound.ctx.currentTime;
      try { g.gain.setTargetAtTime(0, t, 0.03); src.stop(t + 0.15); } catch (e) { /* already stopped */ }
      this.current = null;
      Sound.duck(false);
    }
    try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  },

  /* ---- fallback: system speech, preferring the natural/neural voices browsers ship */
  initTTS() {
    if (!('speechSynthesis' in window)) return;
    const load = () => { this.tts = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); };
    load();
    speechSynthesis.onvoiceschanged = load;
  },
  speakTTS(text, who) {
    if (!('speechSynthesis' in window) || !this.tts.length) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      const natural = this.tts.filter((v) => /natural|neural|online|google/i.test(v.name));
      const pool = natural.length ? natural : this.tts;
      const male = pool.filter((v) => /guy|andrew|brian|christopher|eric|ryan|thomas|roger|steffan|davis|male|david|mark/i.test(v.name));
      u.voice = (who === 'Echo' ? pool : male.length ? male : pool)[0];
      u.rate = { Ares: 0.92, Zeus: 0.88, Hermes: 1.05 }[who] || 1;
      u.volume = clamp(G.settings.master * (G.settings.voiceVol ?? 1), 0, 1);
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  },
};
