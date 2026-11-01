'use strict';
/* ==========================================================================
   effects.js · particles, lightning, sword trails, shockwaves, decals
   ========================================================================== */

/**
 * Smoke puffs: four billowy, cauliflower-edged puffs in a 2×2 sheet (painted by tools/smoke_atlas.js).
 * R = how lit the puff is (thin wisps and upper edges catch the light, the dense core is in its own shadow),
 * A = density.
 */
function smokeAtlas() {
  return new THREE.TextureLoader().load('assets/tex/smoke.png');
}

class Particles {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.turb = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.rot = new Float32Array(max * 2); // angle, which puff of the sheet
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aRot', this.aRot);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uFog: { value: 0.002 }, uFogColor: { value: new THREE.Color() }, uTex: { value: additive ? null : smokeAtlas() } },
      vertexShader: `
        attribute float aSize; attribute vec4 aColor; attribute vec2 aRot;
        uniform float uScale; uniform float uFog;
        varying vec4 vColor; varying float vFog; varying vec2 vRot;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.05, -mv.z);
          vColor = aColor; vRot = aRot;
          float d = -mv.z * uFog;
          vFog = 1.0 - exp(-d * d);
        }`,
      fragmentShader: additive ? `
        varying vec4 vColor; varying float vFog;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r); a *= a;
          gl_FragColor = vec4(vColor.rgb * (1.0 - vFog), vColor.a * a);
        }` : `
        uniform vec3 uFogColor; uniform sampler2D uTex;
        varying vec4 vColor; varying float vFog; varying vec2 vRot;
        void main(){
          // each puff turns slowly; corners of the turned square fall outside its tile
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot.x), s = sin(vRot.x);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          if (abs(p.x) > 0.5 || abs(p.y) > 0.5) discard;
          vec2 uv = (vec2(p.x, -p.y) + 0.5) * 0.5 + vec2(mod(vRot.y, 2.0), floor(vRot.y * 0.5)) * 0.5;
          vec4 t = texture2D(uTex, uv);
          // lit from above, wisps brighter than the dense core
          float light = (0.42 + 0.8 * t.r) * (1.12 - 0.3 * gl_PointCoord.y);
          gl_FragColor = vec4(mix(vColor.rgb * light, uFogColor, vFog), vColor.a * t.a);
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 10 : 9;
  }
  spawn(o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c = o.c || [1, 1, 1, 1], c2 = o.c2 || [c[0], c[1], c[2], 0];
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = c[k] ?? 1; this.c1[i4 + k] = c2[k] ?? 0; }
    this.s0[i] = o.s ?? 0.3; this.s1[i] = o.s2 ?? this.s0[i];
    this.life[i] = o.life || 1; this.age[i] = 0;
    this.grav[i] = o.g || 0; this.drag[i] = o.drag || 0;
    // smoke curls (turb, m/s²) and every puff has its own shape, angle and slow spin
    this.turb[i] = o.turb ?? 0.6;
    this.spin[i] = (Math.random() - 0.5) * (o.spin ?? 0.8);
    this.rot[i * 2] = Math.random() * Math.PI * 2; this.rot[i * 2 + 1] = Math.floor(Math.random() * 4);
  }
  update(dt) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.size[i] = 0; continue; }
      this.age[i] += dt;
      const age = this.age[i], t = Math.min(1, age / this.life[i]);
      const i3 = i * 3, i4 = i * 4;
      const dr = 1 - Math.min(1, this.drag[i] * dt);
      const tb = this.turb[i] * dt;
      V[i3] = V[i3] * dr + Math.sin(age * 1.7 + i * 0.37) * tb;
      V[i3 + 1] = V[i3 + 1] * dr + this.grav[i] * dt;
      V[i3 + 2] = V[i3 + 2] * dr + Math.cos(age * 1.3 + i * 0.73) * tb;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      for (let k = 0; k < 4; k++) this.col[i4 + k] = this.c0[i4 + k] + (this.c1[i4 + k] - this.c0[i4 + k]) * t;
      // fade in instead of popping; billow out fast, then slow down
      this.col[i4 + 3] *= Math.min(1, t * 7);
      this.rot[i * 2] += this.spin[i] * dt * (1 - 0.6 * t);
      this.size[i] = t >= 1 ? 0 : this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aRot.needsUpdate = true;
  }
}

class Trail {
  constructor(color, width = 1, maxPts = 22, life = 0.14) {
    this.max = maxPts; this.life = life;
    this.samples = [];
    const n = maxPts * 2;
    this.posArr = new Float32Array(n * 3);
    this.alphaArr = new Float32Array(n);
    this.sideArr = new Float32Array(n);
    for (let i = 0; i < maxPts; i++) { this.sideArr[i * 2] = 0; this.sideArr[i * 2 + 1] = 1; }
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.posArr, 3).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alphaArr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aAlpha', this.aAlpha);
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.sideArr, 1));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color } },
      vertexShader: `attribute float aAlpha; attribute float aSide; varying float vA; varying float vS;
        void main(){ vA = aAlpha; vS = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; varying float vS;
        void main(){ float edge = smoothstep(0.0, 0.25, vS) * (0.35 + 0.65 * vS); gl_FragColor = vec4(uColor * edge, vA * edge); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.emitting = false;
  }
  push(base, tip) {
    this.samples.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
    if (this.samples.length > this.max) this.samples.pop();
  }
  update(dt) {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.life) this.samples.pop();
    const n = this.samples.length;
    this.mesh.visible = n > 1;
    if (n < 2) return;
    for (let i = 0; i < this.max; i++) {
      const s = this.samples[Math.min(i, n - 1)];
      const k = i * 6;
      this.posArr[k] = s.b.x; this.posArr[k + 1] = s.b.y; this.posArr[k + 2] = s.b.z;
      this.posArr[k + 3] = s.t.x; this.posArr[k + 4] = s.t.y; this.posArr[k + 5] = s.t.z;
      const a = i < n ? (1 - s.age / this.life) * (1 - i / n) : 0;
      this.alphaArr[i * 2] = a; this.alphaArr[i * 2 + 1] = a;
    }
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6);
    this.aPos.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
}

const FX = {
  temps: [],
  init(scene) {
    this.scene = scene;
    this.glow = new Particles(6000, true);
    this.smoke = new Particles(1500, false);
    scene.add(this.glow.points, this.smoke.points);
    // one flash light: every point light costs on every lit pixel, all the time
    this.lights = [0].map(() => {
      const l = new THREE.PointLight(0xaaccff, 0, 80, 1.6);
      l.userData.decay = 0;
      scene.add(l);
      return l;
    });
    this.ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  },
  setScene(scene) {
    if (this.scene === scene) return;
    [this.glow.points, this.smoke.points, ...this.lights].forEach((o) => scene.add(o));
    this.scene = scene;
  },
  resize(h, fov) {
    const s = h / (2 * Math.tan((fov * DEG) / 2));
    this.glow.mat.uniforms.uScale.value = s;
    this.smoke.mat.uniforms.uScale.value = s;
  },
  update(dt) {
    const fog = this.scene.fog;
    const d = fog ? (fog.density || 0) : 0;
    this.glow.mat.uniforms.uFog.value = d;
    this.smoke.mat.uniforms.uFog.value = d;
    if (fog) this.smoke.mat.uniforms.uFogColor.value.copy(fog.color);
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const l of this.lights) {
      if (l.intensity > 0) l.intensity = Math.max(0, l.intensity - l.userData.decay * dt);
    }
    for (let i = this.temps.length - 1; i >= 0; i--) {
      const t = this.temps[i];
      t.age += dt;
      if (t.update) t.update(t, dt);
      if (t.age >= t.life) {
        t.obj.parent && t.obj.parent.remove(t.obj);
        if (t.dispose) t.obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.temps.splice(i, 1);
      }
    }
  },
  temp(obj, life, update, dispose = true) {
    this.scene.add(obj);
    this.temps.push({ obj, life, update, age: 0, dispose });
  },
  flashLight(pos, color, intensity, decayTime = 0.35, range = 80) {
    const l = this.lights.reduce((a, b) => (b.intensity < a.intensity ? b : a));
    l.position.copy(pos);
    l.color.set(color);
    l.intensity = intensity;
    l.distance = range;
    l.userData.decay = intensity / decayTime;
  },

  /* ---- particle presets */
  sparks(pos, dir, n = 18, col = [1.6, 1.2, 0.6, 1], speed = 7, puff = true) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      if (dir) v.addScaledVector(dir, 1.2).normalize();
      const sp = speed * rand(0.4, 1.2);
      this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp, life: rand(0.25, 0.6), s: rand(0.05, 0.11), s2: 0.01, c: col, c2: [col[0], col[1] * 0.4, col[2] * 0.2, 0], g: -14, drag: 2 });
    }
    if (puff) this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.12, s: 1.4, s2: 2.2, c: [col[0], col[1], col[2], 0.7], c2: [col[0], col[1], col[2], 0] });
  },
  ash(pos, n = 14, col = [0.12, 0.1, 0.09, 0.6]) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({ x: pos.x + rand(-0.2, 0.2), y: pos.y + rand(-0.2, 0.2), z: pos.z + rand(-0.2, 0.2), vx: rand(-1.5, 1.5), vy: rand(-0.2, 1.5), vz: rand(-1.5, 1.5), life: rand(0.5, 1.1), s: rand(0.2, 0.4), s2: rand(0.6, 1), c: col, c2: [col[0], col[1], col[2], 0], drag: 2.5 });
    }
  },
  ichor(pos, dir, n = 20) {
    this.sparks(pos, dir, n, [2.4, 1.7, 0.5, 1], 6);
  },
  dust(pos, radius = 1, n = 16, col = [0.55, 0.48, 0.36, 0.45]) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(0.2, 1) * radius;
      this.smoke.spawn({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.1, z: pos.z + Math.sin(a) * r, vx: Math.cos(a) * rand(1, 4), vy: rand(0.3, 1.6), vz: Math.sin(a) * rand(1, 4), life: rand(0.8, 1.6), s: rand(0.4, 0.8) * Math.max(1, radius * 0.4), s2: rand(1.2, 2.2) * Math.max(1, radius * 0.4), c: col, c2: [col[0], col[1], col[2], 0], drag: 2.2 });
    }
  },
  fireBurst(pos, radius = 2, n = 40) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(0, 1) * radius;
      this.glow.spawn({ x: pos.x + Math.cos(a) * r * 0.4, y: pos.y + rand(0, 0.5), z: pos.z + Math.sin(a) * r * 0.4, vx: Math.cos(a) * r * 2.5, vy: rand(2, 7), vz: Math.sin(a) * r * 2.5, life: rand(0.4, 0.9), s: rand(0.5, 1.1), s2: 0.1, c: [3.2, 1.2, 0.25, 0.9], c2: [1.2, 0.2, 0.05, 0], drag: 2.4, g: 2 });
    }
    this.smoke.spawn({ x: pos.x, y: pos.y + 1, z: pos.z, vy: 2, life: 1.2, s: radius * 1.2, s2: radius * 2.4, c: [0.1, 0.07, 0.06, 0.45], c2: [0.1, 0.08, 0.07, 0] });
  },
  flame(pos, scale = 1, col) {
    const c = col || [3.0, 1.15, 0.25, 0.85];
    this.glow.spawn({ x: pos.x + rand(-0.12, 0.12) * scale, y: pos.y, z: pos.z + rand(-0.12, 0.12) * scale, vx: rand(-0.3, 0.3), vy: rand(1.2, 2.4) * scale, vz: rand(-0.3, 0.3), life: rand(0.35, 0.7), s: rand(0.35, 0.6) * scale, s2: 0.05, c, c2: [c[0] * 0.5, c[1] * 0.2, c[2] * 0.1, 0], drag: 1 });
    if (Math.random() < 0.08) this.glow.spawn({ x: pos.x, y: pos.y + 0.3 * scale, z: pos.z, vx: rand(-0.6, 0.6), vy: rand(1.5, 3.5), vz: rand(-0.6, 0.6), life: rand(1, 2), s: 0.04, s2: 0.01, c: [3, 1.4, 0.4, 1], c2: [2, 0.5, 0.1, 0], drag: 0.5 });
  },
  dissolve(root, col = [2.0, 1.5, 0.6, 1], count = 120) {
    const v = new THREE.Vector3();
    const pts = [];
    // joints spread the embers over the whole body (skinned bodies have one mesh at the feet)
    root.traverse((o) => { if ((o.isMesh && o.visible && !o.isSkinnedMesh) || o.userData.joint) pts.push(o); });
    if (!pts.length) return;
    for (let i = 0; i < count; i++) {
      pick(pts).getWorldPosition(v);
      this.glow.spawn({ x: v.x + rand(-0.15, 0.15), y: v.y + rand(-0.15, 0.15), z: v.z + rand(-0.15, 0.15), vx: rand(-0.4, 0.4), vy: rand(0.6, 2.2), vz: rand(-0.4, 0.4), life: rand(1.2, 2.6), s: rand(0.05, 0.14), s2: 0.01, c: col, c2: [col[0], col[1] * 0.7, col[2] * 0.5, 0], drag: 0.6 });
    }
  },
  healAura(pos) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, TAU), r = rand(0.3, 0.8);
      this.glow.spawn({ x: pos.x + Math.cos(a) * r, y: pos.y + rand(0, 1.6), z: pos.z + Math.sin(a) * r, vx: -Math.cos(a) * 0.3, vy: rand(0.5, 1.6), vz: -Math.sin(a) * 0.3, life: rand(0.8, 1.5), s: rand(0.06, 0.12), s2: 0.01, c: [2.2, 1.7, 0.6, 1], c2: [1.5, 1, 0.3, 0], drag: 0.5 });
    }
  },

  /* ---- shapes */
  ring(pos, radius, { color = [1, 0.9, 0.6], life = 0.5, opacity = 1, width } = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: Tex.ring, color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.08;
    m.renderOrder = 8;
    this.temp(m, life, (t) => { const k = t.age / t.life; m.scale.setScalar(0.1 + easeOutCubic(k) * radius); mat.opacity = opacity * (1 - k); }, false);
  },
  /** growing warning disc for telegraphed attacks */
  telegraph(pos, radius, dur, color = [1.4, 0.35, 0.1]) {
    const mat = new THREE.MeshBasicMaterial({ map: Tex.glow, color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.1;
    m.scale.setScalar(radius);
    m.renderOrder = 8;
    const edge = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: Tex.ring, color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    edge.position.y = 0.01;
    m.add(edge);
    this.temp(m, dur, (t) => { const k = t.age / t.life; mat.opacity = 0.25 + k * 0.5; edge.scale.setScalar(Math.max(0.05, k)); }, false);
  },
  decal(pos, size, life = 12) {
    const mat = new THREE.MeshBasicMaterial({ map: Tex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.set(pos.x, (World.ready && this.scene === G.scene ? World.getHeight(pos.x, pos.z, pos.y + 1) : pos.y) + 0.04, pos.z);
    m.scale.setScalar(size);
    m.rotation.y = rand(0, TAU);
    m.renderOrder = 2;
    this.temp(m, life, (t) => { mat.opacity = Math.min(1, (t.life - t.age) / 3); }, false);
  },

  /* ---- lightning */
  jagged(a, b, depth = 6, disp = null) {
    let pts = [a.clone(), b.clone()];
    let d = disp ?? a.distanceTo(b) * 0.12;
    for (let k = 0; k < depth; k++) {
      const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const m = pts[i].clone().lerp(pts[i + 1], 0.5);
        m.x += rand(-d, d); m.y += rand(-d, d) * 0.4; m.z += rand(-d, d);
        np.push(m, pts[i + 1]);
      }
      pts = np; d *= 0.55;
    }
    return pts;
  },
  boltMesh(pts, radius, color) {
    const path = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, radius, 4, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(color[0] * 2, color[1] * 2, color[2] * 2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const glow = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, radius * 4, 4, false), new THREE.MeshBasicMaterial({ color: new THREE.Color(color[0] * 0.5, color[1] * 0.6, color[2] * 0.9), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow);
    core.frustumCulled = glow.frustumCulled = false;
    return g;
  },
  bolt(from, to, { radius = 0.08, life = 0.32, color = [1.4, 1.8, 3.2], branches = 4 } = {}) {
    const pts = this.jagged(from, to, 6);
    const g = this.boltMesh(pts, radius, color);
    for (let b = 0; b < branches; b++) {
      const i = randInt(2, pts.length - 6);
      const p = pts[i];
      const end = p.clone().add(new THREE.Vector3(rand(-1, 1), rand(-1.2, -0.2), rand(-1, 1)).multiplyScalar(from.distanceTo(to) * rand(0.1, 0.25)));
      g.add(this.boltMesh(this.jagged(p, end, 4), radius * 0.5, color));
    }
    g.renderOrder = 12;
    this.temp(g, life, (t) => {
      const on = t.age < 0.06 || Math.random() < 0.6;
      g.visible = on;
    });
    return g;
  },
  /** a gout of fire from one point to another (Ares' gift in the God Mode cutscene, the burning spear) */
  fireStream(from, to, n = 30, col = [3.2, 0.9, 0.2, 0.9]) {
    const d = to.clone().sub(from), len = d.length();
    d.divideScalar(len || 1);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), sp = rand(0.6, 1.4) * len * 1.6;
      this.glow.spawn({ x: from.x + d.x * u * 0.3 + rand(-0.1, 0.1), y: from.y + d.y * u * 0.3 + rand(-0.1, 0.1), z: from.z + d.z * u * 0.3 + rand(-0.1, 0.1),
        vx: d.x * sp + rand(-0.6, 0.6), vy: d.y * sp + rand(-0.6, 0.6), vz: d.z * sp + rand(-0.6, 0.6),
        life: rand(0.45, 0.7), s: rand(0.3, 0.7), s2: 0.1, c: col, c2: [col[0] * 0.4, col[1] * 0.2, col[2] * 0.1, 0], drag: 0.6 });
    }
  },
  /** embers and crawling sparks clinging to a body (War Cry, God Mode) */
  aura(root, n = 3, ember = true, spark = true) {
    const v = this._av || (this._av = new THREE.Vector3());
    const pts = this._ap && this._apRoot === root ? this._ap : (this._ap = [], this._apRoot = root, root.traverse((o) => { if (o.userData.joint) this._ap.push(o); }), this._ap);
    if (!pts.length) return;
    for (let i = 0; i < n; i++) {
      pick(pts).getWorldPosition(v);
      if (ember) this.glow.spawn({ x: v.x + rand(-0.12, 0.12), y: v.y + rand(-0.1, 0.1), z: v.z + rand(-0.12, 0.12), vx: rand(-0.3, 0.3), vy: rand(0.8, 2.2), vz: rand(-0.3, 0.3), life: rand(0.4, 0.8), s: rand(0.03, 0.08), s2: 0.01, c: [2.4, 0.7, 0.15, 1], c2: [1.2, 0.2, 0.04, 0], drag: 0.8 });
      if (spark && Math.random() < 0.6) this.glow.spawn({ x: v.x + rand(-0.15, 0.15), y: v.y + rand(-0.15, 0.15), z: v.z + rand(-0.15, 0.15), vx: rand(-2, 2), vy: rand(-1, 2), vz: rand(-2, 2), life: rand(0.08, 0.2), s: rand(0.04, 0.09), s2: 0.01, c: [1.6, 2.1, 3.6, 1], c2: [0.8, 1.2, 3, 0], drag: 4 });
    }
  },
  lightningStrike(pos, { radius = 3, scale = 1, sound = true, shake = 0.6, flash = 0.28 * scale, decal = true, light = 4000 * scale, puff = true } = {}) {
    const from = pos.clone().add(new THREE.Vector3(rand(-10, 10), 70 + rand(0, 20), rand(-10, 10)));
    this.bolt(from, pos, { radius: 0.12 * scale, branches: 5 });
    this.bolt(from.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))), pos, { radius: 0.05 * scale, branches: 2, life: 0.2 });
    this.flashLight(pos.clone().add(new THREE.Vector3(0, 3, 0)), 0xb8d4ff, light, 0.45, 90);
    this.sparks(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, 1, 0), 50, [1.6, 2.0, 3.4, 1], 11, puff);
    this.ring(pos, radius * 1.4, { color: [0.6, 0.85, 1.6], life: 0.45 });
    this.ring(pos, radius * 0.8, { color: [1.2, 1.4, 2.0], life: 0.3 });
    this.dust(pos, radius * 0.6, 14, [0.4, 0.42, 0.48, 0.4]);
    if (decal) this.decal(pos, radius * 1.3);
    if (flash > 0) UI.flash(flash);
    if (sound) Sound.thunder(G.camera ? G.camera.position.distanceTo(pos) * 0.4 : 0);
    if (G.cam) G.cam.shake(shake);
  },
};
