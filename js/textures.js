'use strict';
/* ==========================================================================
   textures.js · textures painted by code, plus photo-scanned stone and earth (assets/tex)
   ========================================================================== */

const Tex = {
  aniso: 8,

  canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },

  toTex(c, srgb = true, repeat = true) {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.aniso;
    t.needsUpdate = true;
    return t;
  },

  /** paint a size×size texture: fn(x, y, i) returns [r,g,b] (0..1) or [r,g,b,a] */
  paint(size, fn, srgb = true) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4, v = fn(x, y, i);
      d[k] = clamp(v[0], 0, 1) * 255; d[k + 1] = clamp(v[1], 0, 1) * 255; d[k + 2] = clamp(v[2], 0, 1) * 255;
      d[k + 3] = v.length > 3 ? clamp(v[3], 0, 1) * 255 : 255;
    }
    ctx.putImageData(img, 0, 0);
    return this.toTex(c, srgb);
  },

  normalMap(h, size, strength) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
      const dx = (h[y * size + xr] - h[y * size + xl]) * strength;
      const dy = (h[yd * size + x] - h[yu * size + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (y * size + x) * 4;
      d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return this.toTex(c, false);
  },

  /**
   * Photo-scanned CC0 textures from Poly Haven (assets/tex) replace the painted ground, rock,
   * marble, paving and bark. Opened straight from disk (no server) the painted set stays.
   */
  async loadPhotos(renderer) {
    const L = new THREE.TextureLoader(), aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const get = (name, srgb) => L.loadAsync('assets/tex/' + name + '.jpg').then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    });
    const set = (id) => Promise.all([get(id + '_diff', true), get(id + '_nor', false), get(id + '_rough', false)]);
    try {
      const [grass, dirt, sand, rock, marble, pavers, bark] = await Promise.all(
        ['withered_grass', 'dirt', 'coast_sand_01', 'rock_face_03', 'marble_01', 'seaworn_stone_tiles', 'bark_brown_02'].map(set));
      this.grass = grass[0]; this.dirt = dirt[0]; this.sand = sand[0]; this.groundN = dirt[1];
      this.grassN = grass[1];
      this.rock = { map: rock[0], normal: rock[1], rough: rock[2] };
      this.marble = { map: marble[0], normal: marble[1], rough: marble[2] };
      this.pavers = { map: pavers[0], normal: pavers[1], rough: pavers[2] };
      this.bark = { map: bark[0], normal: bark[1], rough: bark[2] };
      // Ariel's own world: the school, the house, the pier in his mother's memory
      const [brick, concrete, asphalt, woodFloor, plaster, cabinet, planks, siding, shingles, fleece] = await Promise.all(
        ['red_brick_03', 'concrete_floor_02', 'asphalt_02', 'wood_floor', 'painted_plaster_wall', 'wood_cabinet_worn_long', 'weathered_brown_planks', 'white_planks_clean', 'grey_roof_01', 'knitted_fleece'].map(set));
      const pbr = (s) => ({ map: s[0], normal: s[1], rough: s[2] });
      // real leaves: clusters photographed from a Poly Haven shrub (searsia lucida), 4×2 tiles with alpha
      this.leafAtlas = await L.loadAsync('assets/tex/foliage_small.png').then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; });
      this.leafTiles = { cols: 4, rows: 2 };
      // real grass: eight tufts rendered side-on from Poly Haven's grass_medium_01/02, each stretched
      // to fill its tile (aspect = the tuft's true height / width)
      this.grassTufts = await L.loadAsync('assets/tex/grass_tufts.png').then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; });
      this.grassAspect = [0.463, 0.553, 1.01, 0.822, 1.134, 1.026, 0.812, 0.579];
      // the same leaves turned to gold for the great tree: brightness kept, hue replaced
      {
        const img = this.leafAtlas.image, w = img.width / 2, h = img.height / 2;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h), px = d.data;
        for (let i = 0; i < px.length; i += 4) {
          const l = Math.min(1, (px[i] * 0.3 + px[i + 1] * 0.55 + px[i + 2] * 0.15) / 120);
          px[i] = 255 * Math.min(1, 0.25 + l * 0.95); px[i + 1] = 255 * (0.12 + l * 0.66); px[i + 2] = 255 * (0.03 + l * 0.2);
        }
        cx.putImageData(d, 0, 0);
        this.leafAtlasGold = new THREE.CanvasTexture(cv);
        this.leafAtlasGold.colorSpace = THREE.SRGBColorSpace; this.leafAtlasGold.anisotropy = aniso;
      }
      Object.assign(this, { brick: pbr(brick), concrete: pbr(concrete), asphalt: pbr(asphalt), woodFloor: pbr(woodFloor), plaster: pbr(plaster), cabinet: pbr(cabinet), planks: pbr(planks), siding: pbr(siding), shingles: pbr(shingles), fleece: pbr(fleece) });
      this.photo = true;
    } catch (e) { /* opened from disk: the painted textures are used */ }
  },

  /* ---------------------------------------------------------------- build */
  generate(renderer) {
    this.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    const S = 512;

    // ---------- marble: warm white stone, grey veins, grime and lichen
    {
      const turb = tileField(S, 4, 7, 11), grime = tileField(S, 6, 6, 12), grain = tileField(S, 64, 3, 13), lich = tileField(S, 8, 5, 14);
      const vein = new Float32Array(S * S), h = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const ph = TAU * (2 * x / S + 1 * y / S) + turb[i] * 11;
        const ph2 = TAU * (1 * x / S - 3 * y / S) + turb[(i * 7) % (S * S)] * 9;
        vein[i] = Math.pow(1 - Math.abs(Math.sin(ph * 0.5)), 14) + 0.5 * Math.pow(1 - Math.abs(Math.sin(ph2 * 0.5)), 26);
        h[i] = grain[i] * 0.4 + grime[i] * 0.6 - vein[i] * 0.15;
      }
      this.marble = {
        map: this.paint(S, (x, y, i) => {
          const g = smooth(0.5, 0.82, grime[i]), l = smooth(0.66, 0.82, lich[i]);
          let r = 0.9 + grain[i] * 0.06, gg = 0.88 + grain[i] * 0.05, b = 0.83 + grain[i] * 0.05;
          const v = clamp(vein[i], 0, 1) * 0.45;
          r -= v * 0.35; gg -= v * 0.33; b -= v * 0.28;
          r *= 1 - g * 0.32; gg *= 1 - g * 0.34; b *= 1 - g * 0.4;
          r = lerp(r, 0.5, l * 0.5); gg = lerp(gg, 0.55, l * 0.5); b = lerp(b, 0.38, l * 0.5);
          return [r, gg, b];
        }),
        rough: this.paint(S, (x, y, i) => { const r = 0.42 + smooth(0.45, 0.8, grime[i]) * 0.4 + grain[i] * 0.1; return [1, r, 0]; }, false),
        normal: this.normalMap(h, S, 3.5),
      };
    }

    // ---------- rock: layered grey-brown stone with cracks
    {
      const f = tileField(S, 4, 8, 21), cr = tileField(S, 8, 5, 22), sp = tileField(S, 16, 4, 23), lay = tileField(S, 2, 6, 24);
      const h = new Float32Array(S * S);
      const crack = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) {
        crack[i] = Math.pow(1 - Math.abs(cr[i] * 2 - 1), 10);
        h[i] = f[i] * 0.8 + lay[i] * 0.4 - crack[i] * 0.5;
      }
      this.rock = {
        map: this.paint(S, (x, y, i) => {
          const t = f[i], c = crack[i], s = smooth(0.7, 0.85, sp[i]);
          let r = lerp(0.36, 0.56, t), g = lerp(0.34, 0.52, t), b = lerp(0.31, 0.47, t);
          r *= 1 - c * 0.55; g *= 1 - c * 0.55; b *= 1 - c * 0.5;
          r = lerp(r, 0.55, s * 0.4); g = lerp(g, 0.5, s * 0.4); b = lerp(b, 0.3, s * 0.4);
          return [r, g, b];
        }),
        normal: this.normalMap(h, S, 6),
      };
    }

    // ---------- ground textures for the terrain
    {
      const a = tileField(S, 8, 6, 31), b = tileField(S, 64, 3, 32), c = tileField(S, 128, 2, 33), d = tileField(S, 4, 5, 34);
      this.grass = this.paint(S, (x, y, i) => {
        const gold = smooth(0.35, 0.75, a[i]), dirt = smooth(0.72, 0.9, d[i]);
        let r = lerp(0.28, 0.6, gold), g = lerp(0.34, 0.5, gold), bb = lerp(0.12, 0.2, gold);
        const sp = 0.75 + b[i] * 0.3 + (c[i] - 0.5) * 0.35;
        r *= sp; g *= sp; bb *= sp;
        r = lerp(r, 0.4, dirt * 0.6); g = lerp(g, 0.32, dirt * 0.6); bb = lerp(bb, 0.22, dirt * 0.6);
        return [r, g, bb];
      });
      const pe = tileField(S, 32, 3, 35), pe2 = tileField(S, 96, 2, 36);
      this.dirt = this.paint(S, (x, y, i) => {
        const peb = smooth(0.7, 0.78, pe[i]) * 0.5 + smooth(0.75, 0.8, pe2[i]) * 0.3;
        const t = a[i] * 0.5 + b[i] * 0.5;
        return [lerp(0.33, 0.47, t) + peb * 0.25, lerp(0.26, 0.37, t) + peb * 0.22, lerp(0.18, 0.26, t) + peb * 0.18];
      });
      this.sand = this.paint(S, (x, y, i) => {
        const t = b[i] * 0.6 + c[i] * 0.4;
        return [lerp(0.66, 0.8, t), lerp(0.58, 0.7, t), lerp(0.44, 0.54, t)];
      });
      const h = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) h[i] = b[i] * 0.5 + c[i] * 0.4 + smooth(0.7, 0.78, pe[i]) * 0.5;
      this.groundN = this.normalMap(h, S, 5);
    }

    // ---------- paving stones (arena floor)
    {
      const n = tileField(S, 16, 4, 41), n2 = tileField(S, 4, 5, 42);
      const cells = 6, cell = S / cells;
      const jit = mulberry32(43);
      const shade = [];
      for (let i = 0; i < cells * cells * 2; i++) shade.push(0.8 + jit() * 0.35);
      const h = new Float32Array(S * S);
      const tone = new Float32Array(S * S);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const row = Math.floor(y / cell), off = (row % 2) * cell * 0.5;
        const xx = (x + off) % S, col = Math.floor(xx / cell);
        const fx = (xx % cell) / cell, fy = (y % cell) / cell;
        const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
        const groove = smooth(0.0, 0.035, edge + (n[y * S + x] - 0.5) * 0.02);
        const i = y * S + x;
        h[i] = groove * 0.8 + n[i] * 0.2;
        tone[i] = shade[(row * cells + col) % shade.length] * (0.55 + 0.45 * groove);
      }
      this.pavers = {
        map: this.paint(S, (x, y, i) => {
          const t = tone[i] * (0.85 + n2[i] * 0.25);
          return [0.62 * t, 0.57 * t, 0.5 * t];
        }),
        normal: this.normalMap(h, S, 4),
      };
    }

    const M = 256;
    // ---------- bronze with verdigris patina (map + roughness/metal packed)
    {
      const p = tileField(M, 16, 4, 51), s = tileField(M, 32, 3, 52);
      this.bronze = {
        map: this.paint(M, (x, y, i) => {
          const pat = smooth(0.74, 0.92, p[i]) * 0.7;
          return [lerp(0.78, 0.4, pat) * (0.9 + s[i] * 0.15), lerp(0.56, 0.5, pat) * (0.9 + s[i] * 0.15), lerp(0.32, 0.4, pat)];
        }),
        orm: this.paint(M, (x, y, i) => {
          const pat = smooth(0.74, 0.92, p[i]) * 0.7;
          return [1, 0.28 + pat * 0.5 + s[i] * 0.12, 1 - pat * 0.75];
        }, false),
      };
    }

    // ---------- cloth weave
    {
      const n = tileField(M, 16, 3, 61);
      const h = new Float32Array(M * M);
      for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
        const wv = Math.sin(x / M * TAU * 48) * Math.sin(y / M * TAU * 48);
        h[y * M + x] = wv * 0.5 + n[y * M + x] * 0.6;
      }
      this.cloth = { normal: this.normalMap(h, M, 2.2), map: this.paint(M, (x, y, i) => { const v = 0.85 + n[i] * 0.2; return [v, v, v]; }) };
    }

    // ---------- bark (vertical fibres)
    {
      const W = 256;
      const n = new Float32Array(W * W), base = tileField(W, 8, 5, 71), fine = tileField(W, 32, 3, 72);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const fib = Math.abs(Math.sin((x / W) * TAU * 14 + base[i] * 7));
        n[i] = fib * 0.6 + fine[((y >> 3) * W + x) % (W * W)] * 0.4;
      }
      this.bark = {
        map: this.paint(W, (x, y, i) => { const t = n[i]; return [lerp(0.16, 0.38, t), lerp(0.13, 0.31, t), lerp(0.1, 0.24, t)]; }),
        normal: this.normalMap(n, W, 5),
      };
    }

    // ---------- foliage cards
    this.leafOlive = this.foliage(256, 1, [[0.42, 0.5, 0.35], [0.55, 0.6, 0.45], [0.33, 0.4, 0.27]], 'olive');
    this.leafCypress = this.foliage(256, 2, [[0.11, 0.2, 0.09], [0.17, 0.27, 0.12], [0.08, 0.15, 0.07]], 'cypress');
    this.leafGold = this.foliage(256, 3, [[1, 0.78, 0.3], [1, 0.88, 0.5], [0.85, 0.6, 0.2]], 'olive');

    // ---------- water normals
    {
      const a = tileField(S, 8, 6, 81), b = tileField(S, 16, 5, 82);
      const h = new Float32Array(S * S);
      for (let i = 0; i < S * S; i++) h[i] = a[i] * 0.6 + b[i] * 0.4;
      this.waterN = this.normalMap(h, S, 9);
    }

    // ---------- generic noise (clouds, macro variation) – linear data
    {
      const a = tileField(S, 4, 7, 91), b = tileField(S, 8, 6, 92);
      this.noise = this.paint(S, (x, y, i) => [a[i], b[i], 0], false);
    }

    this.glow = this.radial(128, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.7)'], [0.5, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
    this.puff = this.cloudPuff(256);
    this.scorch = this.scorchTex(256);
    // blood on the ground: a few splatters (thrown along +x, the way the blow went) and a pool
    this.bloodSplats = [11, 23, 37].map((seed) => this.bloodTex(256, seed, true));
    this.bloodPool = this.bloodTex(256, 51, false);
    this.rune = this.runeTex(256);
    this.ring = this.radial(256, [[0, 'rgba(255,255,255,0)'], [0.78, 'rgba(255,255,255,0)'], [0.9, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    this.capeBlue = this.capeTex(256, '#1c2c63', '#d9b45b');
    this.capeRed = this.capeTex(256, '#5b0f0c', '#2a0606', true);
    this.capeRag = this.capeTex(256, '#3b1712', '#1b0a07', true);
  },

  radial(size, stops) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => g.addColorStop(o, col));
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    return this.toTex(c, true, false);
  },

  foliage(size, seed, cols, kind) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    const rnd = mulberry32(seed * 101);
    const col = (k) => { const b = cols[Math.floor(rnd() * cols.length)]; const v = 0.8 + rnd() * 0.35; return `rgba(${(b[0] * v * 255) | 0},${(b[1] * v * 255) | 0},${(b[2] * v * 255) | 0},1)`; };
    const cx = size / 2, cy = size / 2;
    if (kind === 'cypress') {
      for (let i = 0; i < 1400; i++) {
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * size * 0.46;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 1.0;
        ctx.fillStyle = col();
        ctx.beginPath(); ctx.ellipse(x, y, 3 + rnd() * 4, 2 + rnd() * 3, rnd() * TAU, 0, TAU); ctx.fill();
      }
    } else {
      // twigs with narrow leaves radiating from the centre
      for (let t = 0; t < 9; t++) {
        const a0 = rnd() * TAU, len = size * (0.25 + rnd() * 0.2);
        ctx.strokeStyle = 'rgba(70,55,35,1)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * len, cy + Math.sin(a0) * len); ctx.stroke();
        for (let l = 0; l < 16; l++) {
          const d = (l / 16) * len, side = l % 2 ? 1 : -1;
          const x = cx + Math.cos(a0) * d, y = cy + Math.sin(a0) * d;
          const la = a0 + side * (0.5 + rnd() * 0.5);
          ctx.save(); ctx.translate(x, y); ctx.rotate(la);
          ctx.fillStyle = col();
          ctx.beginPath(); ctx.ellipse(10, 0, 11 + rnd() * 5, 2.6 + rnd() * 1.4, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
      }
    }
    return this.toTex(c, true, false);
  },

  cloudPuff(size) {
    const f = tileField(size, 4, 6, 99);
    return this.paint(size, (x, y, i) => {
      const dx = x / size - 0.5, dy = y / size - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = smooth(1, 0.35, r + (f[i] - 0.5) * 0.7);
      const v = 0.75 + f[i] * 0.25;
      return [v, v, v, a];
    });
  },

  scorchTex(size) {
    const f = tileField(size, 8, 5, 101);
    return this.paint(size, (x, y, i) => {
      const dx = x / size - 0.5, dy = y / size - 0.5, r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = smooth(1, 0.2, r + (f[i] - 0.5) * 0.5);
      return [0.05, 0.04, 0.03, a * 0.85];
    });
  },

  /** a blood splatter: a wet blot, satellite drops and streaks flung along +x (or a rounder pool) */
  bloodTex(size, seed, thrown) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const blob = (x, y, r, a) => {
      ctx.beginPath();
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * TAU, rr = r * (0.78 + rnd() * 0.4);
        const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.fillStyle = 'rgba(' + Math.round(78 + rnd() * 26) + ',' + Math.round(3 + rnd() * 5) + ',' + Math.round(3 + rnd() * 4) + ',' + a + ')';
      ctx.fill();
    };
    // a drop that hit at a slant: a round head and a tail pointing the way it flew (a, from the blow)
    const flung = (x, y, r, a, len) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(' + Math.round(70 + rnd() * 30) + ',4,3,0.95)';
      ctx.beginPath(); ctx.moveTo(-r * 0.2, -r); ctx.quadraticCurveTo(len * 0.6, -r * 0.35, len, 0); ctx.quadraticCurveTo(len * 0.6, r * 0.35, -r * 0.2, r);
      ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.fill();
      ctx.restore();
    };
    const C = size / 2;
    if (thrown) {
      ctx.translate(C * 0.6, C);
      blob(0, 0, size * 0.12, 0.96);
      for (let i = 0; i < 5; i++) blob(rnd() * size * 0.16 - size * 0.04, (rnd() - 0.5) * size * 0.16, size * (0.035 + rnd() * 0.05), 0.94);
      // drops flung on along the blow: further out they are smaller and longer
      for (let i = 0; i < 30; i++) {
        const d = size * (0.1 + rnd() * 0.52), a = (rnd() - 0.5) * 0.9, r = size * (0.006 + rnd() * 0.02) * (1 - d / size * 0.8);
        flung(Math.cos(a) * d, Math.sin(a) * d, r, a + (rnd() - 0.5) * 0.2, r * (2 + d / size * 9));
      }
      // fine spatter
      for (let i = 0; i < 70; i++) { const d = size * (0.06 + rnd() * 0.5), a = (rnd() - 0.5) * 1.6; blob(Math.cos(a) * d, Math.sin(a) * d, size * (0.002 + rnd() * 0.005), 0.85); }
    } else {
      ctx.translate(C, C);
      blob(0, 0, size * 0.3, 0.95);
      for (let i = 0; i < 9; i++) { const a = rnd() * TAU, d = size * (0.12 + rnd() * 0.14); blob(Math.cos(a) * d, Math.sin(a) * d, size * (0.08 + rnd() * 0.08), 0.95); }
      for (let i = 0; i < 14; i++) { const a = rnd() * TAU, d = size * (0.3 + rnd() * 0.15); blob(Math.cos(a) * d, Math.sin(a) * d, size * (0.006 + rnd() * 0.014), 0.9); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  },

  runeTex(size) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    ctx.translate(size / 2, size / 2);
    ctx.strokeStyle = 'rgba(255,190,90,1)'; ctx.shadowColor = 'rgba(255,170,60,1)'; ctx.shadowBlur = 10; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, size * 0.42, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, size * 0.34, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,110,1)';
    ctx.font = `${size * 0.08}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const letters = 'ΑΡΗΣΖΕΥΣΟΛΥΜΠΟΣΕΛΠΙΣ';
    for (let i = 0; i < letters.length; i++) {
      const a = (i / letters.length) * TAU;
      ctx.save(); ctx.rotate(a); ctx.fillText(letters[i], 0, -size * 0.38); ctx.restore();
    }
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-size * 0.1, -size * 0.2); ctx.lineTo(size * 0.06, -size * 0.02); ctx.lineTo(-size * 0.05, 0.0); ctx.lineTo(size * 0.1, size * 0.2); ctx.stroke();
    return this.toTex(c, true, false);
  },

  capeTex(size, base, trim, ragged = false) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
    const n = tileField(size, 8, 4, ragged ? 112 : 111);
    const img = ctx.getImageData(0, 0, size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x, k = i * 4, v = 0.85 + n[i] * 0.3;
      d[k] *= v; d[k + 1] *= v; d[k + 2] *= v;
      if (ragged) {
        // torn hem: alpha eaten away near the bottom (v → 1 is the hem)
        const hem = y / size;
        const tear = hem - (0.82 + (n[(i * 13) % (size * size)] - 0.5) * 0.3);
        if (tear > 0) d[k + 3] = 0;
        if (n[i] > 0.86 && hem > 0.3) d[k + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (!ragged) {
      ctx.fillStyle = trim;
      ctx.fillRect(0, size - 14, size, 7);
      ctx.fillRect(0, 0, 5, size); ctx.fillRect(size - 5, 0, 5, size);
      ctx.globalAlpha = 0.85;
      for (let x = 8; x < size; x += 22) { ctx.fillRect(x, size - 30, 12, 3); ctx.fillRect(x + 4, size - 34, 3, 7); }
      ctx.globalAlpha = 1;
    }
    const t = this.toTex(c, true, false);
    t.flipY = false;
    return t;
  },

  /** lit office windows on a dark facade (lit: the share of windows with a light on) */
  windows(size = 256, lit = 0.58) {
    const c = this.canvas(size), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    const rnd = mulberry32(5);
    const cols = 8, rows = 16, cw = size / cols, ch = size / rows;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const r = rnd();
      if (r < 1 - lit) continue;
      ctx.fillStyle = r < 1 - lit * 0.35 ? `rgba(255,${190 + rnd() * 40 | 0},${110 + rnd() * 50 | 0},${0.5 + rnd() * 0.5})` : `rgba(170,200,255,${0.4 + rnd() * 0.4})`;
      ctx.fillRect(x * cw + cw * 0.18, y * ch + ch * 0.2, cw * 0.64, ch * 0.55);
    }
    return this.toTex(c, true, true);
  },

  text(str, { w = 1024, h = 128, font = 'bold 84px Georgia, serif', color = '#fff', glow = null, bg = null } = {}) {
    const c = this.canvas(w, h), ctx = c.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 18; }
    ctx.fillStyle = color; ctx.fillText(str, w / 2, h / 2 + 4);
    return this.toTex(c, true, false);
  },
};
