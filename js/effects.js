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
  /** drop: little round, glossy droplets (blood) instead of smoke puffs. fire: the billowy puff shapes, burning */
  constructor(max, additive, drop = false, fire = false) {
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
      uniforms: { uScale: { value: 600 }, uFog: { value: 0.002 }, uFogColor: { value: new THREE.Color() }, uTex: { value: (additive || drop) && !fire ? null : smokeAtlas() }, uTime: { value: 0 } },
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
      fragmentShader: fire ? `
        uniform float uTime;
        varying vec4 vColor; varying float vFog; varying vec2 vRot;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main(){
          // a wisp of flame: a soft body, fuller below, eaten away by noise racing upward so it licks into tongues.
          // Its colour follows its heat: deep red at the thin edges, orange, then yellow in the thick of it. The red
          // channel is far stronger than green and blue, so where flames pile up they burn orange-yellow, not white.
          vec2 q = gl_PointCoord, p = q - 0.5;
          float r = length(p) * 2.0;
          if (r > 1.0) discard;
          float seed = vRot.x * 3.7 + vRot.y * 1.3;
          float n = vnoise(vec2(q.x * 3.5 + seed, q.y * 3.0 + uTime * 3.0 + seed)) * 0.6
                  + vnoise(vec2(q.x * 8.0 - seed, q.y * 6.5 + uTime * 5.2)) * 0.4;
          float body = (1.0 - r * r) * (0.5 + 0.65 * q.y);
          float h = body * vColor.a * 1.45 - n * 0.5;
          float a = smoothstep(0.0, 0.45, h);
          if (a < 0.003) discard;
          vec3 c = mix(vec3(0.45, 0.05, 0.008), vec3(1.0, 0.3, 0.035), smoothstep(0.04, 0.35, h));
          c = mix(c, vec3(1.3, 0.78, 0.24), smoothstep(0.42, 0.85, h));
          float tint = clamp((vColor.r + vColor.g) / 4.4, 0.5, 1.25);
          gl_FragColor = vec4(c * a * tint * (1.0 - vFog), 1.0);
        }` : additive ? `
        varying vec4 vColor; varying float vFog;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r); a *= a;
          gl_FragColor = vec4(vColor.rgb * (1.0 - vFog), vColor.a * a);
        }` : drop ? `
        uniform vec3 uFogColor;
        varying vec4 vColor; varying float vFog;
        void main(){
          vec2 p = gl_PointCoord - 0.5;
          float r = length(p) * 2.0;
          if (r > 1.0) discard;
          // a wet drop: darker at the rim, a small glint up and to the left
          float glint = smoothstep(0.22, 0.0, length(p - vec2(-0.14, -0.16)));
          vec3 c = vColor.rgb * (0.6 + 0.4 * (1.0 - r * r)) + vec3(0.5, 0.35, 0.33) * glint * 0.35;
          gl_FragColor = vec4(mix(c, uFogColor, vFog), vColor.a * smoothstep(1.0, 0.8, r));
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
      blending: additive || fire ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive || fire ? 10 : 9;
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

/**
 * Blood in flight: each drop is a quad stretched along its own motion (on screen), so a spray reads as streaks and
 * arcs rather than dots: thick at the head, tapering to a thread behind, dark and wet with a glint down one side.
 * Drops stop where they meet the ground (gy).
 */
class BloodStreaks {
  constructor(max) {
    this.max = max; this.cursor = 0; this.live = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.s0 = new Float32Array(max);
    this.col = new Float32Array(max * 4);
    this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1); this.gy = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iSize', this.aSize); g.setAttribute('iCol', this.aCol);
    g.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: 0.002 }, uFogColor: { value: new THREE.Color() }, uStretch: { value: 0.028 } },
      vertexShader: `
        attribute vec3 iPos; attribute vec3 iVel; attribute float iSize; attribute vec4 iCol;
        uniform float uFog, uStretch;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
          vec2 dir = vv.xy; float sp = length(dir);
          dir = sp > 1e-4 ? dir / sp : vec2(0.0, 1.0);
          vec2 side = vec2(-dir.y, dir.x);
          float len = iSize * 1.25 + min(sp * uStretch, iSize * 2.2);
          // the head leads at the drop, the tail trails behind it
          mv.xy += dir * (position.y * 0.5 - 0.5) * len + side * position.x * iSize * 0.5;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy; vCol = iCol;
          float d = -mv.z * uFog; vFog = 1.0 - exp(-d * d);
          if (iSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uFogColor;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          float t = vUv.y * 0.5 + 0.5;                          // 0 tail, 1 head
          float w = mix(0.22, 1.0, smoothstep(0.0, 0.7, t));     // a thread behind, a full drop in front
          float qx = vUv.x / w;
          float r = length(vec2(qx, (vUv.y - 0.45) / 1.45));
          float a = smoothstep(1.0, 0.8, r) * mix(0.5, 1.0, t);  // thin tails are see-through
          if (a <= 0.01) discard;
          // shaded as a bead of liquid: round across its width, lit from above, with a sharp wet highlight
          vec3 n = normalize(vec3(qx, 0.3 * (t - 0.4), sqrt(max(0.0, 1.0 - qx * qx))));
          vec3 L = normalize(vec3(-0.45, 0.65, 0.6));
          float diff = 0.3 + 0.7 * max(dot(n, L), 0.0);
          float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
          vec3 c = vCol.rgb * diff + vec3(0.85, 0.7, 0.66) * spec * 0.4;
          gl_FragColor = vec4(mix(c, uFogColor, vFog), vCol.a * a);
        }`,
      // (the quad is laid along the drop's flight, which can face either way)
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
  }
  spawn(x, y, z, vx, vy, vz, size, life, col, gy, drag = 0.4) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.s0[i] = size; this.size[i] = size; this.life[i] = life; this.age[i] = 0; this.gy[i] = gy; this.drag[i] = drag;
    const v = 0.75 + Math.random() * 0.4;
    this.col[i4] = col[0] * v; this.col[i4 + 1] = col[1] * v; this.col[i4 + 2] = col[2] * v; this.col[i4 + 3] = 1;
    this.live = Math.max(this.live, 1);
  }
  update(dt) {
    if (!this.live) return;
    const P = this.pos, V = this.vel;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { if (this.size[i]) this.size[i] = 0; continue; }
      any = 1;
      this.age[i] += dt;
      const i3 = i * 3, dr = 1 - Math.min(1, this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 2] *= dr; V[i3 + 1] = V[i3 + 1] * dr - 13.5 * dt;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < this.gy[i]) { this.age[i] = this.life[i]; this.size[i] = 0; continue; }
      const t = this.age[i] / this.life[i];
      this.size[i] = this.s0[i] * (1 - t * t * 0.5);
      this.col[i * 4 + 3] = Math.min(1, (1 - t) * 4);
    }
    this.live = any;
    this.aPos.needsUpdate = true; this.aVel.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}

/**
 * Sparks and embers: glowing streaks stretched along their flight, white-hot at the head and cooling to orange and
 * dull red as they die (c0 to c1), falling or rising (g), and skipping off the ground a few times before they go out.
 */
class SparkStreaks {
  constructor(max) {
    this.max = max; this.cursor = 0; this.live = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.s0 = new Float32Array(max);
    this.col = new Float32Array(max * 4); this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1);
    this.gy = new Float32Array(max); this.g = new Float32Array(max); this.drag = new Float32Array(max); this.bounce = new Uint8Array(max);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const at = (arr, n) => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = at(this.pos, 3); this.aVel = at(this.vel, 3); this.aSize = at(this.size, 1); this.aCol = at(this.col, 4);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iSize', this.aSize); g.setAttribute('iCol', this.aCol);
    g.instanceCount = max;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: 0.002 }, uStretch: { value: 0.035 } },
      vertexShader: `
        attribute vec3 iPos; attribute vec3 iVel; attribute float iSize; attribute vec4 iCol;
        uniform float uFog, uStretch;
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
          vec2 dir = vv.xy; float sp = length(dir);
          dir = sp > 1e-4 ? dir / sp : vec2(0.0, 1.0);
          vec2 side = vec2(-dir.y, dir.x);
          float len = iSize * 1.5 + min(sp * uStretch, iSize * 14.0);
          mv.xy += dir * (position.y * 0.5 - 0.5) * len + side * position.x * iSize * 0.5;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy; vCol = iCol;
          float d = -mv.z * uFog; vFog = 1.0 - exp(-d * d);
          if (iSize <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vUv; varying vec4 vCol; varying float vFog;
        void main(){
          float t = vUv.y * 0.5 + 0.5;
          float w = mix(0.25, 1.0, t);
          float r = length(vec2(vUv.x / w, (vUv.y - 0.6) * 0.75));
          float a = exp(-r * r * 4.0) * smoothstep(1.0, 0.55, r) * mix(0.35, 1.0, t);
          float core = exp(-r * r * 18.0) * t;
          vec3 c = vCol.rgb * a + vec3(1.0, 0.95, 0.85) * core * min(vCol.r, 1.5) * 0.6;
          gl_FragColor = vec4(c * vCol.a * (1.0 - vFog), 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }
  /** o: { x,y,z, vx,vy,vz, s, life, c, c2, g (m/s², default falling), drag, gy (ground), bounce (times) } */
  spawn(o) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    this.s0[i] = this.size[i] = o.s ?? 0.03; this.life[i] = o.life || 0.5; this.age[i] = 0;
    this.g[i] = o.g ?? -9.8; this.drag[i] = o.drag ?? 0.8; this.gy[i] = o.gy ?? -1e9; this.bounce[i] = o.bounce ?? 0;
    const c = o.c || [3, 1.8, 0.7, 1], c2 = o.c2 || [c[0] * 0.5, c[1] * 0.15, c[2] * 0.05, 0];
    for (let k = 0; k < 4; k++) { this.c0[i4 + k] = c[k] ?? 1; this.c1[i4 + k] = c2[k] ?? 0; this.col[i4 + k] = this.c0[i4 + k]; }
    this.live = 1;
  }
  update(dt) {
    if (!this.live) return;
    const P = this.pos, V = this.vel;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { if (this.size[i]) this.size[i] = 0; continue; }
      any = 1;
      this.age[i] += dt;
      const i3 = i * 3, i4 = i * 4, dr = 1 - Math.min(1, this.drag[i] * dt);
      V[i3] *= dr; V[i3 + 2] *= dr; V[i3 + 1] = V[i3 + 1] * dr + this.g[i] * dt;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      if (P[i3 + 1] < this.gy[i]) {
        if (this.bounce[i] > 0 && V[i3 + 1] < -0.5) { this.bounce[i]--; P[i3 + 1] = this.gy[i]; V[i3 + 1] *= -0.32; V[i3] *= 0.55; V[i3 + 2] *= 0.55; }
        else { this.age[i] = this.life[i]; this.size[i] = 0; continue; }
      }
      const t = this.age[i] / this.life[i], e = t * t;
      for (let k = 0; k < 4; k++) this.col[i4 + k] = this.c0[i4 + k] + (this.c1[i4 + k] - this.c0[i4 + k]) * (k === 3 ? e : Math.sqrt(t));
      this.size[i] = this.s0[i] * (1 - 0.5 * t);
    }
    this.live = any;
    this.aPos.needsUpdate = true; this.aVel.needsUpdate = true; this.aSize.needsUpdate = true; this.aCol.needsUpdate = true;
  }
}

/**
 * A lightning channel drawn as camera-facing ribbons: a thin, blinding white core inside a soft blue corona, both
 * falling off smoothly across the width (no hard-edged tube). Each vertex carries how far along the strike it lies
 * (aT, so the leader can race down the channel), its intensity (branches are dimmer) and whether it is a branch
 * (branches go out before the main channel does).
 */
const BoltShader = {
  vertexShader: `
    attribute vec3 aNext; attribute float aSide; attribute float aW; attribute float aT; attribute float aI; attribute float aB;
    varying float vX; varying float vI; varying float vT; varying float vB;
    void main(){
      vec4 a = modelViewMatrix * vec4(position, 1.0);
      vec4 b = modelViewMatrix * vec4(aNext, 1.0);
      vec2 t = b.xy - a.xy; float l = length(t);
      t = l > 1e-6 ? t / l : vec2(1.0, 0.0);
      a.xy += vec2(-t.y, t.x) * aSide * aW;
      gl_Position = projectionMatrix * a;
      vX = aSide; vI = aI; vT = aT; vB = aB;
    }`,
  fragmentShader: `
    uniform vec3 uCore, uGlow; uniform float uAlpha, uReveal, uBranch;
    varying float vX; varying float vI; varying float vT; varying float vB;
    void main(){
      if (vT > uReveal) discard;
      float x = abs(vX);
      float core = exp(-x * x * 22.0);
      float glow = exp(-x * x * 3.0) * 0.22 + exp(-x * x * 0.8) * 0.05;
      // the leader's tip burns brightest as it races down
      float tip = 1.0 + 2.0 * smoothstep(0.08, 0.0, uReveal - vT) * step(uReveal, 0.999);
      float k = uAlpha * vI * mix(1.0, uBranch, vB) * tip;
      gl_FragColor = vec4((uCore * core + uGlow * glow) * k, 1.0);
    }`,
};

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
    this.drops = new Particles(1400, false, true);
    this.streaks = new BloodStreaks(2400);
    this.sparkle = new SparkStreaks(3000);
    this.fire = new Particles(2400, false, false, true);
    this.splats = [];
    scene.add(this.glow.points, this.smoke.points, this.drops.points, this.streaks.mesh, this.sparkle.mesh, this.fire.points);
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
    [this.glow.points, this.smoke.points, this.drops.points, this.streaks.mesh, this.sparkle.mesh, this.fire.points, ...this.lights].forEach((o) => scene.add(o));
    this.scene = scene;
  },
  resize(h, fov) {
    const s = h / (2 * Math.tan((fov * DEG) / 2));
    this.glow.mat.uniforms.uScale.value = s;
    this.smoke.mat.uniforms.uScale.value = s;
    this.drops.mat.uniforms.uScale.value = s;
    this.fire.mat.uniforms.uScale.value = s;
  },
  update(dt) {
    const fog = this.scene.fog;
    const d = fog ? (fog.density || 0) : 0;
    this.glow.mat.uniforms.uFog.value = d;
    this.smoke.mat.uniforms.uFog.value = d;
    this.drops.mat.uniforms.uFog.value = d;
    this.streaks.mat.uniforms.uFog.value = d;
    this.sparkle.mat.uniforms.uFog.value = d; this.fire.mat.uniforms.uFog.value = d;
    this.sparkle.update(dt); this.fire.update(dt); this.fire.mat.uniforms.uTime.value = G.time;
    if (fog) { this.smoke.mat.uniforms.uFogColor.value.copy(fog.color); this.drops.mat.uniforms.uFogColor.value.copy(fog.color); this.streaks.mat.uniforms.uFogColor.value.copy(fog.color); }
    this.streaks.update(dt);
    this.glow.update(dt);
    this.smoke.update(dt);
    this.drops.update(dt);
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
  /** a later moment (a bolt's flicker, smoke rising after the flame) */
  later(delay, fn) { this.temp(new THREE.Object3D(), delay, (t) => { if (t.age + 0.0001 >= t.life && !t.done) { t.done = true; fn(); } }, false); },
  /** the ground under a point, where there is one */
  groundAt(pos, fallback = pos.y - 50) {
    try { return World.ready && this.scene === G.scene ? World.getHeight(pos.x, pos.z, pos.y + 0.5) : fallback; } catch (e) { return fallback; }
  },
  /**
   * Sparks: streaks of hot metal (or of electricity, when the colour is blue) thrown out along dir, cooling as they
   * fly and skipping off the ground. A small, sharp flash where they came from (not a big glowing ball).
   */
  sparks(pos, dir, n = 18, col = [1.6, 1.2, 0.6, 1], speed = 7, puff = true) {
    const electric = col[2] > col[0];
    const gy = this.groundAt(pos);
    const hot = electric ? [col[0] * 1.6, col[1] * 1.6, col[2] * 1.4, 1] : [3.2, 2.1, 0.9, 1];
    const cool = electric ? [col[0] * 0.3, col[1] * 0.4, col[2] * 0.7, 0] : [1.4, 0.25, 0.04, 0];
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize();
      if (dir) v.addScaledVector(dir, 1.2).normalize();
      const sp = speed * rand(0.5, 1.5) * (electric ? 1.4 : 1);
      this.sparkle.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: v.x * sp, vy: v.y * sp, vz: v.z * sp, s: rand(0.012, 0.03), life: electric ? rand(0.12, 0.32) : rand(0.35, 0.9),
        c: hot, c2: cool, g: electric ? -3 : -11, drag: electric ? 3.5 : 0.9, gy, bounce: electric ? 0 : 2 });
    }
    if (puff) this.glow.spawn({ x: pos.x, y: pos.y, z: pos.z, life: 0.07, s: 0.35, s2: 0.7, c: [hot[0], hot[1], hot[2], 0.8], c2: [hot[0], hot[1], hot[2], 0] });
  },
  ash(pos, n = 14, col = [0.12, 0.1, 0.09, 0.6]) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({ x: pos.x + rand(-0.2, 0.2), y: pos.y + rand(-0.2, 0.2), z: pos.z + rand(-0.2, 0.2), vx: rand(-1.5, 1.5), vy: rand(-0.2, 1.5), vz: rand(-1.5, 1.5), life: rand(0.5, 1.1), s: rand(0.2, 0.4), s2: rand(0.6, 1), c: col, c2: [col[0], col[1], col[2], 0], drag: 2.5 });
    }
  },
  ichor(pos, dir, n = 20) {
    this.sparks(pos, dir, n, [2.4, 1.7, 0.5, 1], 6);
  },
  /**
   * Blood from a wound: drops thrown along the blow (dir) and falling, a fine mist, and splatters on the ground
   * where they come down. col: the blood's colour (linear, dark: it is lit by nothing but itself)
   */
  blood(pos, dir, n = 24, col = [0.17, 0.006, 0.004], { splat = true, mist = true, ground = null } = {}) {
    const d = dir ? dir.clone().setY(0).normalize() : new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
    const gy = ground ?? (World.ready && this.scene === G.scene ? World.getHeight(pos.x, pos.z, pos.y + 1) : pos.y - 1.4);
    const S = this.streaks, side = new THREE.Vector3(-d.z, 0, d.x);
    // the spurt: a stream thrown along the blow over a tenth of a second, so it arcs out as one rope of blood
    const lift = rand(1.6, 3.2), sp0 = rand(4.2, 6.4), sideK = rand(-0.5, 0.5), rope = Math.round(n * 2.2);
    let emitted = 0;
    const emit = (frac) => {
      const want = Math.min(rope, Math.round(rope * frac));
      for (; emitted < want; emitted++) {
        const f = emitted / rope, sp = sp0 * (1 - f * 0.5) * rand(0.85, 1.12), s = rand(0.028, 0.07) * (1 - f * 0.4);
        S.spawn(pos.x + rand(-0.03, 0.03), pos.y + rand(-0.03, 0.03), pos.z + rand(-0.03, 0.03),
          d.x * sp + side.x * sideK * sp * 0.4 + rand(-0.55, 0.55), lift * (1 - f * 0.5) + rand(-0.45, 0.45), d.z * sp + side.z * sideK * sp * 0.4 + rand(-0.55, 0.55),
          s, rand(0.7, 1.1), col, gy, 0.25);
      }
    };
    emit(0.35);
    this.temp(new THREE.Object3D(), 0.15, (t) => emit(0.35 + 0.65 * Math.min(1, t.age / 0.15)), false);
    // the spray: a fan of fine droplets, fast and wide
    for (let i = 0; i < n * 1.4; i++) {
      const sp = rand(2, 6.5), a = rand(-0.9, 0.9), ca = Math.cos(a), sa = Math.sin(a);
      const vx = (d.x * ca - d.z * sa) * sp, vz = (d.z * ca + d.x * sa) * sp;
      S.spawn(pos.x, pos.y + rand(-0.05, 0.05), pos.z, vx, rand(-0.5, 3.4), vz, rand(0.012, 0.032), rand(0.4, 0.8), col, gy, 0.9);
    }
    // a few heavy drops that fall close by
    for (let i = 0; i < 2 + n / 12; i++) S.spawn(pos.x, pos.y, pos.z, d.x * rand(0.8, 2.2) + rand(-0.6, 0.6), rand(0.2, 1.6), d.z * rand(0.8, 2.2) + rand(-0.6, 0.6), rand(0.075, 0.115), rand(0.6, 1), col, gy, 0.3);
    // a fine dark mist hanging where the blade went through
    if (mist) for (let i = 0; i < 4; i++) this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x * rand(0.8, 2.2), vy: rand(-0.1, 0.5), vz: d.z * rand(0.8, 2.2), life: rand(0.35, 0.6), s: rand(0.14, 0.24), s2: rand(0.6, 1.0), c: [col[0] * 1.1, col[1], col[2], 0.5], c2: [col[0] * 0.6, col[1], col[2], 0], drag: 3.2, turb: 0.25 });
    if (!splat || !World.ready || this.scene !== G.scene) return;
    // where the drops come down: along the blow, a pace or so off
    const k = Math.max(1, Math.round(n / 16));
    for (let i = 0; i < k; i++) {
      const dist = rand(0.25, 1.4), x = pos.x + d.x * dist + rand(-0.25, 0.25), z = pos.z + d.z * dist + rand(-0.25, 0.25);
      this.bloodSplat(x, ground ?? pos.y, z, rand(0.7, 1.3) * (n > 40 ? 1.25 : 1), Math.atan2(-d.z, d.x), pick(Tex.bloodSplats), 0.28 + dist * 0.12, 26, 0, col.tint, ground !== null);
    }
  },
  /** a pool spreading out under someone who fell */
  bloodPool(pos, size = 1.4, tint = null) {
    if (!World.ready || this.scene !== G.scene) return;
    this.bloodSplat(pos.x, pos.y, pos.z, size, rand(0, TAU), Tex.bloodPool, 0.2, 45, 3.5, tint, true);
  },
  /** (onGround: y is the floor itself, as under someone standing on the arena's paving; else find the terrain) */
  bloodSplat(x, y, z, size, rot, map, delay, life, grow = 0, tint = null, onGround = false) {
    const mat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.14, metalness: 0, envMapIntensity: 0.9,
      color: tint ? new THREE.Color(tint[0], tint[1], tint[2]) : 0xffffff, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3 });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.set(x, (onGround ? Math.max(y, World.getHeight(x, z, y + 0.4)) : World.getHeight(x, z, y + 1)) + 0.03, z);
    m.rotation.y = rot;
    m.scale.setScalar(grow ? size * 0.15 : size);
    m.renderOrder = 2;
    m.receiveShadow = true;
    // (only so many at once: the oldest dries away first)
    this.splats.push(m);
    if (this.splats.length > 48) this.splats.shift().userData.dry = true;
    this.temp(m, life, (t) => {
      if (m.userData.dry) { mat.opacity = Math.max(0, mat.opacity - 0.03); if (mat.opacity <= 0) t.age = t.life; return; }
      const a = t.age - delay;
      mat.opacity = a < 0 ? 0 : Math.min(0.92, a * 6, (t.life - t.age) / 6);
      if (grow && a > 0) m.scale.setScalar(size * (0.15 + 0.85 * (1 - Math.exp(-a / (grow * 0.45)))));
      if (t.age + 0.05 >= t.life) { const i = this.splats.indexOf(m); if (i >= 0) this.splats.splice(i, 1); }
    }, false);
  },
  dust(pos, radius = 1, n = 16, col = [0.55, 0.48, 0.36, 0.45]) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), r = rand(0.2, 1) * radius;
      this.smoke.spawn({ x: pos.x + Math.cos(a) * r, y: pos.y + 0.1, z: pos.z + Math.sin(a) * r, vx: Math.cos(a) * rand(1, 4), vy: rand(0.3, 1.6), vz: Math.sin(a) * rand(1, 4), life: rand(0.8, 1.6), s: rand(0.4, 0.8) * Math.max(1, radius * 0.4), s2: rand(1.2, 2.2) * Math.max(1, radius * 0.4), c: col, c2: [col[0], col[1], col[2], 0], drag: 2.2 });
    }
  },
  /**
   * Fire: tongues of flame (turning, licking puffs, white-yellow where thick, deep orange-red as they thin and rise),
   * with sparks of ember and the dark smoke that rolls up after them.
   */
  fireBurst(pos, radius = 2, n = 40) {
    for (let i = 0; i < n * 1.8; i++) {
      const a = rand(0, TAU), r = Math.sqrt(Math.random()) * radius;
      const out = rand(1.2, 3.6) * radius * 0.6;
      this.fire.spawn({ x: pos.x + Math.cos(a) * r * 0.35, y: pos.y + rand(0, 0.5), z: pos.z + Math.sin(a) * r * 0.35,
        vx: Math.cos(a) * out, vy: rand(1.8, 4.8), vz: Math.sin(a) * out, life: rand(0.4, 0.9),
        s: rand(0.3, 0.55) * Math.max(0.8, radius * 0.5), s2: rand(0.7, 1.2) * Math.max(0.8, radius * 0.5),
        c: [3.0, 1.55, 0.5, 0.95], c2: [0.9, 0.16, 0.03, 0], drag: 2.6, g: 3, turb: 1.6, spin: 2.4 });
    }
    const gy = this.groundAt(pos);
    for (let i = 0; i < n * 0.6; i++) {
      const a = rand(0, TAU), sp = rand(2, 7);
      this.sparkle.spawn({ x: pos.x, y: pos.y + 0.3, z: pos.z, vx: Math.cos(a) * sp, vy: rand(2, 8), vz: Math.sin(a) * sp, s: rand(0.012, 0.028), life: rand(0.6, 1.6),
        c: [3.2, 1.7, 0.5, 1], c2: [1.2, 0.2, 0.03, 0], g: -4, drag: 1.2, gy, bounce: 1 });
    }
    const R = Math.max(1, radius);
    this.later(0.25, () => {
      for (let i = 0; i < 5; i++) this.smoke.spawn({ x: pos.x + rand(-0.5, 0.5) * R, y: pos.y + 0.8 + rand(0, 0.8), z: pos.z + rand(-0.5, 0.5) * R, vx: rand(-0.4, 0.4), vy: rand(1.2, 2.4), vz: rand(-0.4, 0.4),
        life: rand(1.6, 2.6), s: R * rand(0.6, 1.0), s2: R * rand(1.8, 2.6), c: [0.08, 0.07, 0.065, 0.32], c2: [0.11, 0.1, 0.09, 0], drag: 0.8, turb: 0.5 });
    });
  },
  /** one lick of a steady flame (torches, a burning spear, a foe on fire) */
  flame(pos, scale = 1, col) {
    const c = col || [2.8, 1.35, 0.42, 0.85];
    this.fire.spawn({ x: pos.x + rand(-0.1, 0.1) * scale, y: pos.y, z: pos.z + rand(-0.1, 0.1) * scale, vx: rand(-0.25, 0.25), vy: rand(1.0, 2.0) * scale, vz: rand(-0.25, 0.25),
      life: rand(0.35, 0.65), s: rand(0.3, 0.5) * scale, s2: rand(0.5, 0.8) * scale, c, c2: [c[0] * 0.3, c[1] * 0.1, c[2] * 0.05, 0], drag: 1.2, turb: 1.4, spin: 2 });
    if (Math.random() < 0.12) this.sparkle.spawn({ x: pos.x, y: pos.y + 0.25 * scale, z: pos.z, vx: rand(-0.6, 0.6), vy: rand(1.2, 3), vz: rand(-0.6, 0.6), s: rand(0.01, 0.02), life: rand(0.8, 1.8),
      c: [3, 1.5, 0.4, 1], c2: [1.1, 0.18, 0.03, 0], g: 0.8, drag: 0.7 });
    if (Math.random() < 0.05) this.smoke.spawn({ x: pos.x, y: pos.y + 0.6 * scale, z: pos.z, vx: rand(-0.2, 0.2), vy: rand(0.8, 1.4), vz: rand(-0.2, 0.2), life: rand(1.2, 2), s: 0.3 * scale, s2: 1.2 * scale, c: [0.07, 0.06, 0.06, 0.35], c2: [0.1, 0.09, 0.08, 0], drag: 0.6 });
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
    // a faint pressure wave racing out (a glowing hoop read as a game effect), with dust kicked up along its edge
    const mat = new THREE.MeshBasicMaterial({ map: Tex.ring, color: new THREE.Color(...color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: opacity * 0.22 });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos); m.position.y += 0.08;
    m.renderOrder = 8;
    this.temp(m, life, (t) => { const k = t.age / t.life; m.scale.setScalar(0.1 + easeOutCubic(k) * radius); mat.opacity = opacity * 0.22 * (1 - k) * (1 - k); }, false);
    const n = Math.round(clamp(radius * 3, 6, 26));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.15, 0.15), sp = radius / Math.max(0.2, life) * rand(0.5, 0.8);
      this.smoke.spawn({ x: pos.x + Math.cos(a) * 0.4, y: pos.y + 0.15, z: pos.z + Math.sin(a) * 0.4, vx: Math.cos(a) * sp, vy: rand(0.2, 0.9), vz: Math.sin(a) * sp,
        life: rand(0.6, 1.1), s: rand(0.3, 0.5), s2: rand(1.0, 1.8), c: [0.42, 0.39, 0.34, 0.32], c2: [0.45, 0.42, 0.37, 0], drag: 2.8, turb: 0.4 });
    }
  },
  /**
   * An orb of divine energy: a sphere that is blinding at its heart and fades to nothing at its rim (no flat-shaded
   * ball), its surface boiling slowly. col: HDR colour.
   */
  plasma(radius, col) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(...col) }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `uniform vec3 uCol; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = max(dot(normalize(vN), normalize(vV)), 0.0);
          float boil = 0.75 + 0.25 * sin(vP.x * 23.0 + uTime * 9.0) * sin(vP.y * 19.0 - uTime * 7.0) * sin(vP.z * 21.0 + uTime * 8.0);
          float core = pow(f, 3.0), halo = pow(f, 1.2) * 0.45;
          vec3 c = uCol * (halo * boil) + vec3(1.0, 0.95, 0.85) * core * max(uCol.r, uCol.b) * 0.5;
          gl_FragColor = vec4(c, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 28, 20), mat);
    m.onBeforeRender = () => { mat.uniforms.uTime.value = G.time; };
    m.renderOrder = 11;
    return m;
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
  /** a crooked channel from a to b: midpoint displacement, each kink pushed sideways off the line (not just up or down) */
  jagged(a, b, depth = 6, disp = null) {
    let pts = [a.clone(), b.clone()];
    let d = disp ?? a.distanceTo(b) * 0.11;
    const seg = new THREE.Vector3(), r = new THREE.Vector3();
    for (let k = 0; k < depth; k++) {
      const np = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        seg.subVectors(pts[i + 1], pts[i]);
        const L = seg.length() || 1;
        seg.divideScalar(L);
        r.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)); r.addScaledVector(seg, -r.dot(seg));
        const m = pts[i].clone().lerp(pts[i + 1], rand(0.4, 0.6)).addScaledVector(r, rand(0.3, 1) * d);
        np.push(m, pts[i + 1]);
      }
      pts = np; d *= 0.53;
    }
    return pts;
  },
  /** chains: [{ pts, w0, w1, i, t0, t1, b }] → one ribbon geometry (w: half-width of the corona, metres) */
  boltGeometry(chains) {
    let nv = 0, ni = 0;
    for (const c of chains) { nv += c.pts.length * 2; ni += (c.pts.length - 1) * 6; }
    const pos = new Float32Array(nv * 3), nxt = new Float32Array(nv * 3), side = new Float32Array(nv), w = new Float32Array(nv), tt = new Float32Array(nv), ii = new Float32Array(nv), bb = new Float32Array(nv);
    const idx = new Uint32Array(ni);
    let v = 0, q = 0;
    for (const c of chains) {
      const n = c.pts.length, base = v;
      for (let k = 0; k < n; k++) {
        const p = c.pts[k], pa = c.pts[Math.max(0, k - 1)], pb = c.pts[Math.min(n - 1, k + 1)];
        const nx = p.clone().add(pb.clone().sub(pa).multiplyScalar(0.5));
        const u = k / (n - 1), wid = lerp(c.w0, c.w1, u) * (0.92 + 0.16 * Math.random());
        for (const sd of [-1, 1]) {
          pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z;
          nxt[v * 3] = nx.x; nxt[v * 3 + 1] = nx.y; nxt[v * 3 + 2] = nx.z;
          side[v] = sd; w[v] = wid; tt[v] = lerp(c.t0, c.t1, u); ii[v] = c.i * (k === 0 || k === n - 1 ? 0.6 : 1); bb[v] = c.b;
          v++;
        }
      }
      for (let k = 0; k < n - 1; k++) { const a = base + k * 2; idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2; idx[q++] = a + 1; idx[q++] = a + 3; idx[q++] = a + 2; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
    g.setAttribute('aT', new THREE.BufferAttribute(tt, 1));
    g.setAttribute('aI', new THREE.BufferAttribute(ii, 1));
    g.setAttribute('aB', new THREE.BufferAttribute(bb, 1));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  },
  /** the channels of one strike: the main one and its forks, each fork forking again */
  boltChains(from, to, radius, branches) {
    const L = from.distanceTo(to);
    const depth = L > 30 ? 8 : L > 8 ? 7 : L > 2.5 ? 6 : 4;
    const main = this.jagged(from, to, depth);
    const W = radius * 2.4;
    const chains = [{ pts: main, w0: W, w1: W * 0.8, i: 1, t0: 0, t1: 1, b: 0 }];
    const fork = (pts, t0, t1, w, inten, n, level) => {
      for (let k = 0; k < n; k++) {
        const j = Math.floor(rand(0.08, 0.8) * (pts.length - 2)) + 1;
        const p = pts[j], tan = pts[j + 1].clone().sub(pts[j - 1]).normalize();
        const off = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)); off.addScaledVector(tan, -off.dot(tan)).normalize();
        const dir = tan.clone().multiplyScalar(Math.cos(rand(0.35, 0.9))).addScaledVector(off, Math.sin(rand(0.35, 0.9))).normalize();
        const rest = (1 - j / pts.length);
        const len = L * rand(0.08, 0.3) * rest * (level ? 0.6 : 1);
        if (len < 0.15) continue;
        const end = p.clone().addScaledVector(dir, len);
        const sub = this.jagged(p, end, Math.max(3, depth - 2 - level), len * 0.2);
        const ta = lerp(t0, t1, j / (pts.length - 1)), tb = ta + (t1 - t0) * (len / L) * 1.1;
        chains.push({ pts: sub, w0: w * 0.5, w1: w * 0.12, i: inten, t0: ta, t1: tb, b: 1 });
        if (level < 1 && Math.random() < 0.6) fork(sub, ta, tb, w * 0.5, inten * 0.7, randInt(1, 2), level + 1);
      }
    };
    fork(main, 0, 1, W, 0.6, branches, 0);
    return chains;
  },
  /**
   * A lightning bolt from one point to another. The leader races down the channel in a few hundredths of a second,
   * the channel flashes blinding white, then flickers as the stroke re-strikes two or three times, the forks dying
   * first, and fades with an afterglow. Called by every power and every scene that throws lightning.
   */
  bolt(from, to, { radius = 0.08, life = 0.32, color = [1.4, 1.8, 3.2], branches = 4, light = 0 } = {}) {
    const chains = this.boltChains(from, to, radius, branches);
    const L = from.distanceTo(to);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uCore: { value: new THREE.Color(Math.max(2.4, color[0] * 1.6), Math.max(2.6, color[1] * 1.5), Math.max(3.2, color[2] * 1.1)) },
        uGlow: { value: new THREE.Color(color[0] * 0.25, color[1] * 0.35, color[2] * 0.55) },
        uAlpha: { value: 0 }, uReveal: { value: 0 }, uBranch: { value: 1 },
      },
      vertexShader: BoltShader.vertexShader, fragmentShader: BoltShader.fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(this.boltGeometry(chains), mat);
    m.frustumCulled = false; m.renderOrder = 12;
    const lead = clamp(L / 900, 0.012, 0.05), total = Math.max(life, 0.18) + 0.08;
    // the return stroke, then re-strikes down the same channel
    // a long-held bolt (a god's thunderbolt in a scene) keeps burning, flickering, and re-strikes more often
    const hold = life > 0.5;
    const pulses = [[lead, 1.15]];
    for (let k = 0, tp = lead, nP = hold ? Math.round(life / 0.13) : randInt(1, 3); k < nP; k++) { tp += rand(0.04, hold ? 0.16 : 0.09); if (tp < total - 0.05) pulses.push([tp, rand(0.4, 0.8)]); }
    const U = mat.uniforms;
    this.temp(m, total, (t) => {
      const a = t.age;
      U.uReveal.value = Math.min(1, a / lead);
      let k = a < lead ? 0.7 : hold ? 0.5 + 0.2 * Math.random() : 0.16 * Math.exp(-(a - lead) * 7);
      for (const [tp, amp] of pulses) { const x = (a - tp) / 0.022; if (x > -2.5) k += amp * Math.exp(-x * x); }
      k *= Math.min(1, (t.life - a) / 0.06);
      U.uAlpha.value = k;
      U.uBranch.value = Math.max(hold ? 0.4 : 0, 1 - Math.max(0, a - lead) * 5);
      if (light && a >= lead) { const l = this._boltLight; if (l) l.intensity = Math.max(l.intensity, light * Math.min(1, k)); }
    });
    if (light) { this.flashLight(to.clone().lerp(from, 0.08), 0xc4d8ff, light, total, Math.max(20, L * 0.8)); this._boltLight = this.lights.reduce((x, y) => (y.intensity > x.intensity ? y : x)); }
    return m;
  },
  /** a short crawling arc of electricity (over a god's armour, between fingers) */
  arc(a, b, radius = 0.012) {
    return this.bolt(a, b, { radius, life: rand(0.06, 0.12), branches: Math.random() < 0.4 ? 1 : 0, color: [1.3, 1.8, 3.4] });
  },
  /** a gout of fire from one point to another (Ares' gift in the God Mode cutscene, the burning spear) */
  fireStream(from, to, n = 30, col = [3.0, 1.4, 0.4, 0.9]) {
    const d = to.clone().sub(from), len = d.length();
    d.divideScalar(len || 1);
    for (let i = 0; i < n; i++) {
      const u = Math.random(), sp = rand(0.6, 1.4) * len * 1.6;
      this.fire.spawn({ x: from.x + d.x * u * 0.3 + rand(-0.08, 0.08), y: from.y + d.y * u * 0.3 + rand(-0.08, 0.08), z: from.z + d.z * u * 0.3 + rand(-0.08, 0.08),
        vx: d.x * sp + rand(-0.5, 0.5), vy: d.y * sp + rand(-0.3, 0.8), vz: d.z * sp + rand(-0.5, 0.5),
        life: rand(0.4, 0.7), s: rand(0.18, 0.35), s2: rand(0.6, 1.1), c: col, c2: [col[0] * 0.3, col[1] * 0.1, col[2] * 0.05, 0], drag: 1.2, turb: 1.5, spin: 2.5 });
      if (i % 3 === 0) this.sparkle.spawn({ x: from.x, y: from.y, z: from.z, vx: d.x * sp * 1.2 + rand(-1, 1), vy: d.y * sp + rand(0, 1.5), vz: d.z * sp * 1.2 + rand(-1, 1), s: rand(0.01, 0.022), life: rand(0.4, 0.9),
        c: [3.2, 1.7, 0.5, 1], c2: [1.1, 0.2, 0.03, 0], g: -2, drag: 0.8 });
    }
  },
  /** embers rising off a body, and arcs of electricity crawling over it (War Cry, God Mode) */
  aura(root, n = 3, ember = true, spark = true) {
    const v = this._av || (this._av = new THREE.Vector3()), w = this._aw || (this._aw = new THREE.Vector3());
    const pts = this._ap && this._apRoot === root ? this._ap : (this._ap = [], this._apRoot = root, root.traverse((o) => { if (o.userData.joint) this._ap.push(o); }), this._ap);
    if (!pts.length) return;
    for (let i = 0; i < n; i++) {
      pick(pts).getWorldPosition(v);
      if (ember) {
        this.sparkle.spawn({ x: v.x + rand(-0.12, 0.12), y: v.y + rand(-0.1, 0.1), z: v.z + rand(-0.12, 0.12), vx: rand(-0.4, 0.4), vy: rand(0.6, 2.0), vz: rand(-0.4, 0.4), s: rand(0.008, 0.018), life: rand(0.5, 1.2),
          c: [3.0, 1.4, 0.35, 1], c2: [1.0, 0.15, 0.02, 0], g: 1.2, drag: 1.2 });
        if (Math.random() < 0.25) this.fire.spawn({ x: v.x + rand(-0.1, 0.1), y: v.y, z: v.z + rand(-0.1, 0.1), vx: rand(-0.2, 0.2), vy: rand(0.8, 1.6), vz: rand(-0.2, 0.2), life: rand(0.25, 0.45), s: rand(0.12, 0.2), s2: rand(0.25, 0.4),
          c: [2.4, 0.9, 0.22, 0.5], c2: [0.6, 0.08, 0.02, 0], drag: 1.5, turb: 1.2, spin: 2 });
      }
      if (spark && Math.random() < 0.45) {
        pick(pts).getWorldPosition(w);
        if (v.distanceTo(w) > 0.7) w.copy(v).add(new THREE.Vector3(rand(-0.35, 0.35), rand(-0.35, 0.35), rand(-0.35, 0.35)));
        this.arc(v.clone(), w.clone(), rand(0.006, 0.012));
      }
    }
  },
  /**
   * A thunderbolt from the sky. The bolt itself (with a second, fainter stroke beside it), the ground flash and blast
   * of electric sparks and molten grit where it lands, a burst of dust and smoke, a scorch, a flash of light over
   * everything, and the thunder.
   */
  lightningStrike(pos, { radius = 3, scale = 1, sound = true, shake = 0.6, flash = 0.28 * scale, decal = true, light = 4000 * scale, puff = true } = {}) {
    const from = pos.clone().add(new THREE.Vector3(rand(-14, 14), 75 + rand(0, 25), rand(-14, 14)));
    const L = from.distanceTo(pos), lead = clamp(L / 900, 0.012, 0.05);
    this.bolt(from, pos, { radius: 0.13 * scale, branches: 6, life: 0.42, light: Math.min(light, 1500) });
    if (Math.random() < 0.6) this.later(rand(0.03, 0.08), () => this.bolt(from.clone().add(new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4))), pos.clone().add(new THREE.Vector3(rand(-0.6, 0.6), 0, rand(-0.6, 0.6))), { radius: 0.05 * scale, branches: 2, life: 0.22 }));
    // everything at the ground happens when the bolt arrives, not before
    this.later(lead, () => {
      this.flashLight(pos.clone().add(new THREE.Vector3(0, 3, 0)), 0xc4d8ff, light, 0.5, 90);
      const p0 = pos.clone().add(new THREE.Vector3(0, 0.2, 0));
      // the plasma where it touches down: a blinding pinpoint, not a ball
      this.glow.spawn({ x: p0.x, y: p0.y + 0.2, z: p0.z, life: 0.09, s: 0.9 * scale, s2: 1.6 * scale, c: [5, 5.4, 6.5, 1], c2: [1.5, 2, 4, 0] });
      this.sparks(p0, new THREE.Vector3(0, 1, 0), Math.round(55 * scale), [1.5, 2.0, 3.6, 1], 12, false);
      this.sparks(p0, new THREE.Vector3(0, 0.6, 0), Math.round(30 * scale), [2.6, 1.6, 0.6, 1], 7, false);
      // grit and smoke thrown up, and a low ring of dust racing outward
      for (let i = 0; i < 12; i++) {
        const a = rand(0, TAU), sp = rand(3, 7) * scale;
        this.smoke.spawn({ x: p0.x, y: p0.y + 0.1, z: p0.z, vx: Math.cos(a) * sp, vy: rand(0.2, 1.2), vz: Math.sin(a) * sp, life: rand(0.7, 1.3), s: rand(0.3, 0.6) * scale, s2: rand(1.4, 2.2) * radius * 0.5, c: [0.38, 0.37, 0.36, 0.42], c2: [0.4, 0.4, 0.4, 0], drag: 3.2 });
      }
      if (puff) this.smoke.spawn({ x: p0.x, y: p0.y + 0.8, z: p0.z, vy: 1.6, life: 1.6, s: radius * 0.5, s2: radius * 1.4, c: [0.2, 0.2, 0.22, 0.45], c2: [0.25, 0.25, 0.27, 0], drag: 1 });
      this.ring(pos, radius * 1.2, { color: [0.5, 0.7, 1.3], life: 0.25, opacity: 0.35 });
    });
    if (decal) this.decal(pos, radius * 1.1);
    if (flash > 0) UI.flash(flash);
    if (sound) Sound.thunder(G.camera ? G.camera.position.distanceTo(pos) * 0.4 : 0);
    if (G.cam) G.cam.shake(shake);
  },
};
