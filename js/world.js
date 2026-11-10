'use strict';
/* ==========================================================================
   world.js · Elysia, the Shattered Realm
   terrain · sky · sea · clouds · grass · trees · ruins · arena · landmarks
   ========================================================================== */

const STEP = 0.55;

/** Patch a standard material so distant landmarks get thinner fog. */
function farFog(mat, k) {
  const prev = mat.onBeforeCompile, base = mat.customProgramCacheKey();
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        float ffD = fogDensity * ${k.toFixed(3)} * vFogDepth;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 1.0 - exp(-ffD * ffD));
      #endif`);
  };
  mat.customProgramCacheKey = () => base + '|farfog' + k;
  return mat;
}

/** The physical sky is far too clean and bright for a fallen realm: dim it and drain most of its blue. */
function darkenSky(mat) {
  mat.fragmentShader = mat.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', `
    float skL = dot(retColor, vec3(0.2126, 0.7152, 0.0722));
    retColor = mix(vec3(skL), retColor, 0.3) * vec3(1.0, 0.93, 0.8) * 0.56;
    // a sun veiled by overcast: a soft bright patch, never a glare that blooms over the whole screen
    retColor = retColor / (1.0 + max(vec3(0.0), retColor - 0.9) * 0.9);
    gl_FragColor = vec4( retColor, 1.0 );`);
  mat.needsUpdate = true;
}

/** poses the marble statues are carved in (rig angles, degrees) */
const STATUE_POSES = {
  // Zeus raising a thunderbolt high
  zeus: { armR: [-165, 0, -18], elbowR: [-24, 0, 0], handR: [0, 0, 0], armL: [-14, 0, 22], elbowL: [-48, 0, 0], neck: [-10, 0, 0], chest: [-3, 6, 0], thighL: [-10, 0, 4], kneeL: [12, 0, 0], thighR: [4, 0, -3] },
  // the Fallen Colossus, toppled onto its back: one hand on the chest, a knee bent
  hero: { armR: [-38, 0, -26], elbowR: [-78, 0, 0], handR: [0, 0, 0], armL: [-6, 0, 34], elbowL: [-18, 0, 0], thighL: [-24, 0, 6], kneeL: [34, 0, 0], thighR: [4, 0, -5], kneeR: [6, 0, 0], neck: [10, 14, 0] },
};

/** the current pose of a skinned mesh, baked into a static geometry in world space (position + normal) */
function bakeSkinned(mesh) {
  mesh.updateMatrixWorld(true);
  const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const sk = mesh.skeleton, M = sk.bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, sk.boneInverses[i]));
  const n = pos.count, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  const v = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), nacc = new THREE.Vector3(), t = new THREE.Vector3();
  const bindN = new THREE.Matrix3().getNormalMatrix(mesh.bindMatrix), m3 = new THREE.Matrix3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    if (nor) nv.fromBufferAttribute(nor, i).applyMatrix3(bindN);
    acc.set(0, 0, 0); nacc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (!w) continue;
      const bm = M[si.getComponent(i, k)];
      acc.addScaledVector(t.copy(v).applyMatrix4(bm), w);
      if (nor) nacc.addScaledVector(t.copy(nv).applyMatrix3(m3.setFromMatrix4(bm)), w);
    }
    P[i * 3] = acc.x; P[i * 3 + 1] = acc.y; P[i * 3 + 2] = acc.z;
    nacc.normalize();
    N[i * 3] = nacc.x; N[i * 3 + 1] = nacc.y; N[i * 3 + 2] = nacc.z;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (nor) out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (g.index) out.setIndex(g.index.clone());
  return out;
}

/** drop every triangle that reaches above height y */
function cutAbove(g, y) {
  const pos = g.attributes.position;
  if (g.index) {
    const idx = g.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (pos.getY(idx[t]) <= y && pos.getY(idx[t + 1]) <= y && pos.getY(idx[t + 2]) <= y) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    g.setIndex(keep);
    return g;
  }
  const keep = [];
  for (let t = 0; t < pos.count; t += 3) if (pos.getY(t) <= y && pos.getY(t + 1) <= y && pos.getY(t + 2) <= y) keep.push(t, t + 1, t + 2);
  g.setIndex(keep);
  return g;
}

/** World-space triplanar texturing for procedural geometry without good UVs. */
function triplanarMaterial({ map, normal, rough, scale = 0.25, color = 0xffffff, normalStrength = 1, roughness = 1, metalness = 0, envMapIntensity = 1, emissive }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity });
  if (emissive) m.emissive = new THREE.Color(emissive);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.triMap = { value: map };
    sh.uniforms.triNormal = { value: normal };
    sh.uniforms.triRough = { value: rough || null };
    sh.uniforms.triScale = { value: scale };
    sh.uniforms.triNS = { value: normalStrength };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 triWP = vec4(transformed, 1.0); vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triWP = instanceMatrix * triWP; triN = mat3(instanceMatrix) * triN;
        #endif
        vTriPos = (modelMatrix * triWP).xyz; vTriN = normalize(mat3(modelMatrix) * triN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D triMap; uniform sampler2D triNormal; uniform sampler2D triRough; uniform float triScale; uniform float triNS;
        varying vec3 vTriPos; varying vec3 vTriN;
        // a projection is only sampled when it shows (most stonework is axis-aligned: one sample, not three).
        // Explicit gradients keep the mipmaps right inside the branches
        vec3 triP, triGX, triGY;
        vec4 triSample(sampler2D t, vec3 w){
          vec4 c = vec4(0.0);
          if (w.x > 0.02) c += textureGrad(t, triP.zy, triGX.zy, triGY.zy) * w.x;
          if (w.y > 0.02) c += textureGrad(t, triP.xz, triGX.xz, triGY.xz) * w.y;
          if (w.z > 0.02) c += textureGrad(t, triP.xy, triGX.xy, triGY.xy) * w.z;
          return c;
        }`)
      .replace('#include <map_fragment>', `vec3 triw = pow(abs(normalize(vTriN)), vec3(4.0)); triw /= (triw.x + triw.y + triw.z);
        triw = max(triw - 0.02, 0.0); triw /= (triw.x + triw.y + triw.z);
        triP = vTriPos * triScale; triGX = dFdx(triP); triGY = dFdy(triP);
        diffuseColor.rgb *= triSample(triMap, triw).rgb;`)
      // without a roughness map the surface keeps its constant roughness (a colour map read as
      // roughness made bark and rock look wet and metallic)
      .replace('#include <roughnessmap_fragment>', rough ? `float roughnessFactor = roughness * triSample(triRough, triw).g;` : `float roughnessFactor = roughness;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wn = normalize(vTriN), nW = vec3(0.0);
          if (triw.x > 0.0) { vec3 tx = textureGrad(triNormal, triP.zy, triGX.zy, triGY.zy).xyz * 2.0 - 1.0; tx.xy *= triNS; tx = vec3(tx.xy + wn.zy, abs(tx.z) * wn.x); nW += tx.zyx * triw.x; }
          if (triw.y > 0.0) { vec3 ty = textureGrad(triNormal, triP.xz, triGX.xz, triGY.xz).xyz * 2.0 - 1.0; ty.xy *= triNS; ty = vec3(ty.xy + wn.xz, abs(ty.z) * wn.y); nW += ty.xzy * triw.y; }
          if (triw.z > 0.0) { vec3 tz = textureGrad(triNormal, triP.xy, triGX.xy, triGY.xy).xyz * 2.0 - 1.0; tz.xy *= triNS; tz = vec3(tz.xy + wn.xy, abs(tz.z) * wn.z); nW += tz.xyz * triw.z; }
          normal = normalize((viewMatrix * vec4(normalize(nW), 0.0)).xyz);
        }`);
  };
  m.customProgramCacheKey = () => (rough ? 'triplanar+rough' : 'triplanar');
  return m;
}

/** Wind sway for instanced foliage. */
function windMaterial(mat, strength = 0.06) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = G.uniforms.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float wph = uTime * 1.4 + ip.x * 0.05 + ip.z * 0.07;
        float wk = max(0.0, position.y) * ${strength.toFixed(3)};
        transformed.x += (sin(wph) * 0.7 + sin(wph * 2.7 + position.y) * 0.3) * wk;
        transformed.z += cos(wph * 0.8) * 0.5 * wk;`);
  };
  // the strength is baked into the shader, so each strength needs its own program
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => key + '|wind' + strength;
  return mat;
}

/** Tube with linearly tapering radius along a smooth curve. */
function taperedTube(pts, r0, r1, radial = 8, segMul = 3) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = Math.max(2, (pts.length - 1) * segMul);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const P = new THREE.Vector3(), n = new THREE.Vector3();
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      n.set(0, 0, 0).addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial * Math.max(1, Math.round(r * 2)), t * len * 0.25);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * Leaf cards: one quad per card, normals bent out from the crown's centre (soft, rounded light).
 * With an atlas ({ cols, rows }) each card shows one tile of it (card.tile, else a random one);
 * card.shade (vertex colour) darkens the cards deep inside a crown.
 */
function foliageCards(cards, normalCenterFn, atlas = null) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  cards.forEach((c, k) => {
    e.set(c.rx, c.ry, c.rz); q.setFromEuler(e);
    const base = k * 4;
    const t = atlas ? (c.tile ?? (k * 7919) % (atlas.cols * atlas.rows)) : 0;
    const tx = atlas ? t % atlas.cols : 0, ty = atlas ? atlas.rows - 1 - Math.floor(t / atlas.cols) : 0;
    for (const [x, y] of corners) {
      v.set(x * c.s, y * c.s, 0).applyQuaternion(q).add(c.p);
      pos.push(v.x, v.y, v.z);
      n.copy(v).sub(normalCenterFn(v)).normalize();
      n.y = n.y * 0.6 + 0.4; n.normalize();
      nor.push(n.x, n.y, n.z);
      if (atlas) uv.push((tx + x + 0.5) / atlas.cols, (ty + y + 0.5) / atlas.rows);
      else uv.push(x + 0.5, y + 0.5);
      const sh = c.shade ?? 1;
      col.push(sh, sh, sh);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** the photographed leaf atlas' tiles, or null when it isn't loaded (opened from disk: painted cards) */
const leafTiles = () => (Tex.leafAtlas ? Tex.leafTiles : null);

/**
 * Material for leaf cards: the photographed leaves tinted per plant (tint: linear rgb multipliers
 * around 1, the photo already has a real leaf's brightness), shaded per card.
 * Both faces of a card keep the crown's outward normal, so a crown lights as one soft mass
 * rather than a patchwork of flipped, dark backs.
 */
function leafMaterial(tint, { fallback = null, map = null, wind = 0.03, roughness = 0.85, emissive = 0, emissiveIntensity = 0 } = {}) {
  const atlas = !!Tex.leafAtlas, tex = atlas ? (map || Tex.leafAtlas) : fallback;
  const mat = new THREE.MeshStandardMaterial({
    map: tex, color: atlas ? new THREE.Color(...tint) : 0xffffff, vertexColors: atlas,
    alphaTest: 0.5, side: THREE.DoubleSide, roughness, envMapIntensity: 0.45,
    emissive, emissiveIntensity, emissiveMap: emissive ? tex : null,
  });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef DOUBLE_SIDED\n\tnormal *= faceDirection;\n#endif');
  };
  mat.customProgramCacheKey = () => 'leafcards';
  return wind ? windMaterial(mat, wind) : mat;
}

/**
 * A bush or a tree crown of leaf cards filling an ellipsoid (radii rx, ry, rz, centred at cy):
 * most cards near the surface facing out, a few inside, darker the deeper and lower they sit.
 */
function leafCrown(rng, { rx, ry, rz, cy = 0, n, size, flatBottom = 1 }) {
  const cards = [], q = new THREE.Quaternion(), spin = new THREE.Quaternion(), e = new THREE.Euler();
  const Z = new THREE.Vector3(0, 0, 1), d = new THREE.Vector3(), rnd = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    let x, y, z;
    do { x = rng() * 2 - 1; y = rng() * 2 - 1; z = rng() * 2 - 1; } while (x * x + y * y + z * z > 1 || y < -flatBottom);
    const r = Math.hypot(x, y, z) || 1e-3, depth = Math.pow(r, 0.4);
    x *= depth / r; y *= depth / r; z *= depth / r;
    // facing: out from the crown, loosened with some randomness, then spun in its own plane
    d.set(x / rx, y / ry, z / rz).normalize();
    rnd.set(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    d.addScaledVector(rnd, 1.1).normalize();
    q.setFromUnitVectors(Z, d);
    spin.setFromAxisAngle(Z, rng() * TAU);
    e.setFromQuaternion(q.multiply(spin));
    const light = 0.38 + 0.5 * depth + 0.22 * (y * 0.5 + 0.5);
    cards.push({ p: new THREE.Vector3(x * rx, cy + y * ry, z * rz), s: size * (0.75 + rng() * 0.5), rx: e.x, ry: e.y, rz: e.z, shade: Math.min(1.05, light * (0.9 + rng() * 0.2)), tile: Math.floor(rng() * 8) });
  }
  const center = new THREE.Vector3(0, cy - ry * 0.25, 0);
  return foliageCards(cards, () => center, leafTiles());
}

function prep(g) {
  let x = g.index ? g.toNonIndexed() : g;
  if (!x.attributes.uv) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.attributes.position.count * 2), 2));
  for (const a of Object.keys(x.attributes)) if (!['position', 'normal', 'uv'].includes(a)) x.deleteAttribute(a);
  if (!x.attributes.normal) x.computeVertexNormals();
  return x;
}

const World = {
  ready: false,
  HALF: 500, SEG: 400,
  noise: new Simplex2(1337),
  colliders: [], grid: new Map(), platforms: [], footprints: [],
  fires: [], altars: [], messages: [], apples: [], phantomPaths: [],
  sunDir: new THREE.Vector3(-0.78, 0.17, 0.6).normalize(),
  // cold grey-brown haze, the colour of ash and old stone
  fogColor: new THREE.Color(0x5d5852),
  sites: {
    start: { x: 0, z: 248 },
    agora: { x: -58, z: 22 },
    colossus: { x: 66, z: 112 },
    hill: { x: 118, z: -38 },
    arena: { x: -130, z: -252 },
    ascent: { x: -118, z: -188 },
  },
  PATH: [[0, 222], [6, 180], [-8, 132], [-36, 84], [-52, 50], [-60, 6], [-76, -38], [-96, -88], [-110, -138], [-118, -182], [-126, -214], [-130, -230]],
  FLAT: [
    { x: 0, z: 244, r: 28, f: 24 },
    { x: -58, z: 22, r: 48, f: 30 },
    { x: 66, z: 112, r: 20, f: 22 },
    { x: 118, z: -38, r: 16, f: 18 },
    { x: -130, z: -252, r: 38, f: 24 },
    { x: -118, z: -188, r: 9, f: 12 },
  ],
  areas: [
    { name: 'Temple of Dawn', x: 0, z: 244, r: 45 },
    { name: 'The Golden Fields', x: -10, z: 150, r: 60 },
    { name: 'Agora of the Forgotten', x: -58, z: 22, r: 55 },
    { name: 'The Fallen Colossus', x: 66, z: 112, r: 35 },
    { name: 'Shrine of the Hesperides', x: 118, z: -38, r: 30 },
    { name: 'The Ascent of War', x: -100, z: -110, r: 45 },
    { name: 'Colosseum of Ares', x: -130, z: -252, r: 40 },
  ],

  /* ============================================================ heights */
  rawHeight(x, z) {
    const n = this.noise;
    let h = 9 + n.fbm(x * 0.0032 + 3.1, z * 0.0032 - 1.7, 5) * 20;
    h += n.fbm(x * 0.013 + 7, z * 0.013 + 2, 3) * 3.2;
    // soft floor keeps inland valleys above the sea
    if (h < 4) h = 4 - (4 - h) * 0.12;
    const north = smooth(-40, -300, z);
    h += north * 36;
    const ridge = n.ridged(x * 0.0065 + 11, z * 0.0065 - 4, 5);
    const wall = Math.min(1, smooth(-290, -360, z) + smooth(180, 300, Math.abs(x + 40)) * smooth(-60, -260, z));
    h += wall * ridge * 120 + north * ridge * 22;
    const east = smooth(200, 330, x) * smooth(150, -100, z);
    h += east * ridge * 50;
    const d = Math.hypot(x * 1.04, z);
    const isl = 1 - smooth(300, 470, d);
    return lerp(-26, h, isl);
  },
  computeHeights() {
    const N = this.SEG + 1, H = new Float32Array(N * N), step = (this.HALF * 2) / this.SEG;
    this.step = step;
    for (const f of this.FLAT) {
      let s = 0, c = 0;
      for (let a = 0; a < TAU; a += TAU / 12) for (const rr of [0, f.r * 0.5, f.r]) { s += this.rawHeight(f.x + Math.cos(a) * rr, f.z + Math.sin(a) * rr); c++; }
      f.h = Math.max(3.5, s / c);
    }
    // path node heights (smoothed)
    const ph = this.PATH.map(([x, z]) => this.flatHeight(x, z, this.rawHeight(x, z)));
    this.pathH = ph.map((h, i) => (h * 2 + (ph[i - 1] ?? h) + (ph[i + 1] ?? h)) / 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -this.HALF + i * step, z = -this.HALF + j * step;
      let h = this.flatHeight(x, z, this.rawHeight(x, z));
      const p = this.pathInfo(x, z);
      const w = (1 - smooth(4, 11, p.d)) * 0.92;
      if (w > 0) h = lerp(h, p.h, w);
      H[j * N + i] = h;
    }
    this.H = H; this.N = N;
  },
  flatHeight(x, z, h) {
    for (const f of this.FLAT) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r + f.f) h = lerp(h, f.h, 1 - smooth(f.r, f.r + f.f, d));
    }
    return h;
  },
  pathInfo(x, z) {
    let best = 1e9, bh = 0, bt = 0, bi = 0;
    const P = this.PATH;
    for (let i = 0; i < P.length - 1; i++) {
      const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / l2, 0, 1);
      const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bt = t; bi = i; }
    }
    if (this.pathH) bh = lerp(this.pathH[bi], this.pathH[bi + 1], bt);
    return { d: best, h: bh, i: bi, t: bt };
  },
  terrainHeight(x, z) {
    const s = this.step, N = this.N;
    const gx = clamp((x + this.HALF) / s, 0, N - 1.001), gz = clamp((z + this.HALF) / s, 0, N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const H = this.H, k = j * N + i;
    // match the mesh triangulation (diagonal from a to d)
    const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
    if (fx + fz < 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  },
  getHeight(x, z, refY = Infinity) {
    let h = this.terrainHeight(x, z);
    // the arena's paving is one flat disc: where the ground dips under it (toward the gate) you stand on the stone
    const A = this.arenaFloor;
    if (A && h < A.top) { const dx = x - A.x, dz = z - A.z; if (dx * dx + dz * dz < A.r2) h = A.top; }
    for (const p of this.platforms) {
      if (p.top <= h || p.top > refY + STEP) continue;
      if (this.inPlatform(p, x, z)) h = p.top;
    }
    return h;
  },
  inPlatform(p, x, z) {
    const dx = x - p.x, dz = z - p.z;
    if (p.r) return dx * dx + dz * dz < p.r * p.r;
    const lx = dx * p.c + dz * p.s, lz = -dx * p.s + dz * p.c;
    return Math.abs(lx) < p.hx && Math.abs(lz) < p.hz;
  },
  addPlatform(x, z, hx, hz, rot, top) {
    this.platforms.push({ x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), top });
  },

  /* ============================================================ collisions */
  addCollider(c) {
    this.colliders.push(c);
    // registered with a margin the size of the biggest body, so an entity standing
    // in the next grid cell still finds colliders it overlaps
    const r = (c.type === 'circle' ? c.r : Math.hypot(c.hx, c.hz)) + 1.5;
    const cs = 8;
    for (let gx = Math.floor((c.x - r) / cs); gx <= Math.floor((c.x + r) / cs); gx++)
      for (let gz = Math.floor((c.z - r) / cs); gz <= Math.floor((c.z + r) / cs); gz++) {
        const k = gx + ',' + gz;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(c);
      }
    return c;
  },
  circle(x, z, r, top) { return this.addCollider({ type: 'circle', x, z, r, top }); },
  box(x, z, hx, hz, rot = 0, top) { return this.addCollider({ type: 'box', x, z, hx, hz, c: Math.cos(rot), s: Math.sin(rot), top }); },
  /** is a camera sample point inside something solid? */
  cameraBlocked(x, y, z) {
    const list = this.grid.get(Math.floor(x / 8) + ',' + Math.floor(z / 8));
    if (!list) return false;
    for (const c of list) {
      if (c.off || (c.top !== undefined && y > c.top)) continue;
      if (c.type === 'circle') { if (c.r > 0.3 && Math.hypot(x - c.x, z - c.z) < c.r + 0.2) return true; }
      else {
        const dx = x - c.x, dz = z - c.z, lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c;
        if (Math.abs(lx) < c.hx + 0.2 && Math.abs(lz) < c.hz + 0.2) return true;
      }
    }
    return false;
  },
  pushOut(x, z, r) {
    const cs = 8, list = this.grid.get(Math.floor(x / cs) + ',' + Math.floor(z / cs));
    if (!list) return [x, z];
    // a few passes: leaving one collider can push into a neighbour (column rows, wall segments)
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const c of list) {
        if (c.off) continue;
        if (c.type === 'circle') {
          const dx = x - c.x, dz = z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
          if (d < m - 1e-4) {
            if (d > 1e-5) { x = c.x + (dx / d) * m; z = c.z + (dz / d) * m; } else x = c.x + m;
            moved = true;
          }
        } else {
          const dx = x - c.x, dz = z - c.z;
          let lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c;
          const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
          const ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
          if (d < r - 1e-4) {
            if (d < 1e-5) {
              const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
              if (px < pz) lx = Math.sign(lx || 1) * (c.hx + r); else lz = Math.sign(lz || 1) * (c.hz + r);
            } else { lx = qx + (ex / d) * r; lz = qz + (ez / d) * r; }
            x = c.x + lx * c.c - lz * c.s; z = c.z + lx * c.s + lz * c.c;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  },
  /** does a body of radius r at x,z overlap any solid collider? */
  blocked(x, z, r) {
    const [px, pz] = this.pushOut(x, z, r);
    return Math.abs(px - x) + Math.abs(pz - z) > 1e-3;
  },
  walkable(x0, z0, x1, z1, y) {
    const t = this.terrainHeight(x1, z1);
    if (t < -0.9) return false;
    const dist = Math.hypot(x1 - x0, z1 - z0);
    if (t - y > STEP + dist * 1.3) return false;
    for (const p of this.platforms) if (p.top > y + STEP && this.inPlatform(p, x1, z1)) return false;
    if (Math.abs(x1) > this.HALF - 5 || Math.abs(z1) > this.HALF - 5) return false;
    return true;
  },
  /** can a body of radius r stand at x,z (coming from x0,z0 at height y)? */
  free(x0, z0, x, z, y, r) { return this.walkable(x0, z0, x, z, y) && !this.blocked(x, z, r); },
  /** move an entity (pos.y = feet height) by dx,dz with sliding & collision */
  move(pos, dx, dz, r) {
    // long moves (rolls, lunges, knockback) are split so they can't tunnel through thin walls
    const len = Math.hypot(dx, dz), n = Math.min(12, Math.max(1, Math.ceil(len / (r * 0.7))));
    for (let i = 0; i < n; i++) this.moveStep(pos, dx / n, dz / n, r);
  },
  moveStep(pos, dx, dz, r) {
    let nx = pos.x + dx, nz = pos.z + dz;
    if (!this.walkable(pos.x, pos.z, nx, nz, pos.y)) {
      if (this.walkable(pos.x, pos.z, nx, pos.z, pos.y)) nz = pos.z;
      else if (this.walkable(pos.x, pos.z, pos.x, nz, pos.y)) nx = pos.x;
      else { nx = pos.x; nz = pos.z; }
    }
    const [px, pz] = this.pushOut(nx, nz, r);
    if (this.walkable(pos.x, pos.z, px, pz, pos.y)) { pos.x = px; pos.z = pz; return; }
    // the push-out landed somewhere unwalkable: never end inside a collider, stay put instead
    const [ox, oz] = this.pushOut(pos.x, pos.z, r);
    if (this.walkable(pos.x, pos.z, ox, oz, pos.y)) { pos.x = ox; pos.z = oz; }
  },

  /* ============================================================ build */
  async build(scene, renderer, progress) {
    this.scene = scene;
    const step = async (label, pct, fn) => { progress(label, pct); await new Promise((r) => setTimeout(r, 0)); fn(); };
    await step('Raising the land…', 0.22, () => this.computeHeights());
    await step('Lighting the sky…', 0.3, () => this.buildSky(scene, renderer));
    await step('Carving the ruins…', 0.38, () => this.buildRuins(scene));
    await step('Painting the earth…', 0.48, () => this.buildTerrain(scene));
    await step('Filling the sea…', 0.53, () => this.buildSea(scene));
    await step('Growing the fields…', 0.58, () => this.buildGrass(scene));
    await step('Planting olive groves…', 0.66, () => this.buildTrees(scene));
    await step('Scattering stones…', 0.7, () => this.buildRocks(scene));
    await step('Growing the Golden Tree…', 0.76, () => this.buildGoldenTree(scene));
    await step('Raising Mount Olympus…', 0.82, () => this.buildOlympus(scene));
    await step('Kindling sacred flames…', 0.86, () => this.buildLights(scene));
    this.ready = true;
  },

  /* ------------------------------------------------------------ sky */
  buildSky(scene, renderer) {
    const sky = new Addons.Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    // a dying day over a fallen realm: thick, grey-gold air, the sun low and veiled
    u.turbidity.value = 10; u.rayleigh.value = 0.75; u.mieCoefficient.value = 0.008; u.mieDirectionalG.value = 0.84;
    darkenSky(sky.material);
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    scene.add(sky);
    this.sky = sky;

    // image based lighting from the same sky
    const pm = new THREE.PMREMGenerator(renderer);
    const env = new THREE.Scene();
    const sky2 = new Addons.Sky(); sky2.scale.setScalar(1000);
    for (const k in u) if (sky2.material.uniforms[k]) sky2.material.uniforms[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value;
    darkenSky(sky2.material);
    env.add(sky2);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.09, 0.07) }));
    ground.position.y = -30;
    env.add(ground);
    scene.environment = pm.fromScene(env, 0.03, 0.1, 2000).texture;
    pm.dispose();

    scene.fog = new THREE.FogExp2(this.fogColor.clone(), 0.0032);
    scene.background = new THREE.Color(0x34322f);

    // sun + sky light: a weak, low, amber sun; the shadows are cold and deep
    const sun = new THREE.DirectionalLight(0xffc48a, 2.5);
    sun.castShadow = true;
    const shadowRes = { low: 1024, medium: 2048, high: 2048, ultra: 4096 }[G.settings.quality] || 2048;
    sun.shadow.mapSize.set(shadowRes, shadowRes);
    const sc = sun.shadow.camera;
    sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46; sc.near = 1; sc.far = 500;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    // layer 2 holds shadow-only copies of nearby props (see instanced)
    sun.shadow.camera.layers.enable(2);
    scene.add(sun, sun.target);
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0x7d8592, 0x2e261c, 0.7);
    scene.add(this.hemi);

    // horizon haze ring blends the sky into the fog
    const haze = new THREE.Mesh(new THREE.CylinderGeometry(5200, 5200, 2400, 64, 1, true), new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.fogColor }, uSun: { value: this.sunDir } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform vec3 uColor; uniform vec3 uSun; varying vec3 vW;
        void main(){
          vec3 d = normalize(vW - cameraPosition);
          float h = vW.y;
          float a = pow(1.0 - smoothstep(-200.0, 900.0, h), 1.6);
          float s = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 6.0);
          vec3 c = mix(uColor, uColor * vec3(1.35, 1.1, 0.8), s);
          gl_FragColor = vec4(c, a * 0.95);
        }`,
      transparent: true, depthWrite: false, side: THREE.BackSide, fog: false,
    }));
    haze.position.y = 900;
    haze.renderOrder = -2;
    haze.frustumCulled = false;
    scene.add(haze);

    // cloud deck
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(18000, 18000).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: { tNoise: { value: Tex.noise }, uTime: G.uniforms.time, uSun: { value: this.sunDir }, uFog: { value: this.fogColor } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D tNoise; uniform float uTime; uniform vec3 uSun; uniform vec3 uFog; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz * 0.00009 + vec2(uTime * 0.0012, uTime * 0.0004);
          float n = texture2D(tNoise, uv).r * 0.62 + texture2D(tNoise, uv * 2.9 + 0.31).g * 0.28 + texture2D(tNoise, uv * 7.3).r * 0.1;
          // an overcast storm deck: heavy, bruised undersides, torn open here and there by the sun
          float cov = smoothstep(0.3, 0.62, n);
          vec3 d = normalize(vW - cameraPosition);
          float sunAmt = pow(max(dot(d, uSun), 0.0), 6.0);
          float dist = length(vW.xz - cameraPosition.xz);
          float fade = smoothstep(8500.0, 2500.0, dist);
          float thick = smoothstep(0.45, 0.85, n);
          vec3 col = mix(vec3(0.3, 0.29, 0.29), vec3(0.11, 0.1, 0.11), thick) + vec3(1.3, 0.75, 0.35) * sunAmt * (1.0 - thick) * 1.1;
          col = mix(col, uFog * 0.9, 1.0 - fade * 0.7);
          gl_FragColor = vec4(col, cov * fade * 0.94);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    clouds.position.y = 1500;
    clouds.renderOrder = -1;
    clouds.frustumCulled = false;
    scene.add(clouds);

    // ambient motes (pollen / golden dust) wrapped around the camera
    const MN = 900, mp = new Float32Array(MN * 3), ms = new Float32Array(MN);
    for (let i = 0; i < MN; i++) { mp[i * 3] = rand(0, 70); mp[i * 3 + 1] = rand(0, 26); mp[i * 3 + 2] = rand(0, 70); ms[i] = rand(0, 1); }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aR', new THREE.BufferAttribute(ms, 1));
    this.motes = new THREE.Points(mg, new THREE.ShaderMaterial({
      uniforms: { uC: { value: new THREE.Vector3() }, uTime: G.uniforms.time, uScale: { value: 600 } },
      vertexShader: `attribute float aR; uniform vec3 uC; uniform float uTime; uniform float uScale; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.3 + aR * 40.0) * 2.0; p.z += cos(uTime * 0.25 + aR * 30.0) * 2.0; p.y += sin(uTime * 0.4 + aR * 20.0) * 1.0;
          vec3 rel = mod(p - uC + vec3(35.0, 8.0, 35.0), vec3(70.0, 26.0, 70.0)) - vec3(35.0, 8.0, 35.0);
          vec3 w = uC + rel;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aR * 2.0) + aR * 60.0);
          vA = tw * smoothstep(35.0, 15.0, length(rel.xz)) * smoothstep(1.0, 5.0, -mv.z);
          gl_PointSize = (0.05 + aR * 0.05) * uScale / -mv.z;
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(vec3(2.4, 1.8, 0.8) * a, a * vA); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  },

  /* ------------------------------------------------------------ terrain */
  buildTerrain(scene) {
    const N = this.N, H = this.H, step = this.step, S = this.SEG;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), spl = new Float32Array(N * N * 4);
    const dens = new Float32Array(N * N * 2);
    const n = this.noise;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = -this.HALF + i * step, z = -this.HALF + j * step, h = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
      const hd = H[Math.max(0, j - 1) * N + i], hu = H[Math.min(N - 1, j + 1) * N + i];
      const nx = (hl - hr) / (2 * step), nz = (hd - hu) / (2 * step);
      const slope = 1 - 1 / Math.sqrt(nx * nx + nz * nz + 1);
      // concavity → fake ambient occlusion
      let avg = 0;
      for (const [di, dj] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) avg += H[clamp(j + dj, 0, N - 1) * N + clamp(i + di, 0, N - 1)];
      const ao = clamp(1 - (avg / 4 - h) * 0.06, 0.62, 1.08);
      const pn = n.noise(x * 0.04, z * 0.04), pn2 = n.noise(x * 0.11 + 9, z * 0.11);
      const path = this.pathInfo(x, z);
      let rock = smooth(0.2, 0.36, slope + pn * 0.06) + smooth(70, 110, h) * 0.7;
      let sand = smooth(3.4, 1.0, h + pn * 0.8);
      let dirt = (1 - smooth(2.2, 5.5 + pn * 1.5, path.d)) * 0.95 + smooth(0.55, 0.8, pn2) * 0.35;
      const ad = Math.hypot(x - this.sites.arena.x, z - this.sites.arena.z);
      dirt += 1 - smooth(30, 36, ad);
      rock = clamp(rock, 0, 1); sand = clamp(sand, 0, 1) * (1 - rock); dirt = clamp(dirt, 0, 1) * (1 - rock) * (1 - sand);
      let grass = Math.max(0, 1 - rock - sand - dirt);
      const sum = grass + rock + sand + dirt || 1;
      spl[k * 4] = grass / sum; spl[k * 4 + 1] = rock / sum; spl[k * 4 + 2] = sand / sum; spl[k * 4 + 3] = dirt / sum;
      const tint = 1 + n.noise(x * 0.008 + 40, z * 0.008) * 0.08;
      col[k * 3] = ao * tint; col[k * 3 + 1] = ao * tint * (1 - pn2 * 0.03); col[k * 3 + 2] = ao * (1 - pn * 0.04);
      // grass density for the blade field
      let gd = smooth(0.3, 0.75, spl[k * 4]) * (0.55 + 0.45 * smooth(-0.6, 0.3, n.noise(x * 0.02 + 3, z * 0.02)));
      if (h < 1.2) gd = 0;
      for (const f of this.footprints) if (Math.abs(x - f.x) < f.r && Math.abs(z - f.z) < f.r && Math.hypot(x - f.x, z - f.z) < f.r) { gd = 0; break; }
      dens[k * 2] = h; dens[k * 2 + 1] = gd;
    }
    const idx = new Uint32Array(S * S * 6);
    let q = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.55 });
    // world-space tiling: the photo-scanned set covers ~2-3 m per tile, the painted set was made for ~5 m
    const f = (v) => v.toFixed(4);
    const K = Tex.photo ? { g: 0.34, d: 0.42, s: 0.36, r: 0.12, n: 0.42 } : { g: 0.19, d: 0.23, s: 0.2, r: 0.085, n: 0.19 };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, {
        tGrass: { value: Tex.grass }, tDirt: { value: Tex.dirt }, tSand: { value: Tex.sand },
        tRock: { value: Tex.rock.map }, tRockN: { value: Tex.rock.normal }, tGroundN: { value: Tex.groundN }, tGrassN: { value: Tex.grassN || Tex.groundN }, tNoise: { value: Tex.noise },
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vTW;\nvarying vec3 vTN;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSplat = splat; vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass; uniform sampler2D tDirt; uniform sampler2D tSand; uniform sampler2D tRock; uniform sampler2D tRockN; uniform sampler2D tGroundN; uniform sampler2D tGrassN; uniform sampler2D tNoise;
          varying vec4 vSplat; varying vec3 vTW; varying vec3 vTN;`)
        .replace('#include <map_fragment>', `
          vec2 wxz = vTW.xz;
          float macro = texture2D(tNoise, wxz * 0.0031).r;
          float macro2 = texture2D(tNoise, wxz * 0.019).g;
          vec4 sp = vSplat;
          float nb = texture2D(tNoise, wxz * 0.045).g;
          sp.y = clamp(sp.y + (nb - 0.5) * 0.35 * sp.y * (1.0 - sp.y) * 4.0, 0.0, 1.0);
          sp.w = clamp(sp.w + (nb - 0.5) * 0.4 * sp.w * (1.0 - sp.w) * 4.0, 0.0, 1.0);
          sp /= max(0.001, sp.x + sp.y + sp.z + sp.w);
          // two scales of each layer, rotated against each other, so the tiling doesn't show.
          // Layers are only sampled where they show (explicit gradients keep mipmaps right inside the branches)
          vec2 wxr = mat2(0.8, -0.6, 0.6, 0.8) * wxz;
          vec2 gx = dFdx(wxz), gy = dFdy(wxz);
          #define TG(t, s, uv) textureGrad(t, (uv) * (s), gx * (s), gy * (s)).rgb
          vec3 alb = vec3(0.0);
          if (sp.x > 0.004) {
            vec3 cg = TG(tGrass, ${f(K.g)}, wxz) * 0.6 + TG(tGrass, ${f(K.g * 0.27)}, wxr) * 0.4;
            // sun-dried meadow: warm gold, with greener hollows
            cg *= vec3(1.04, 0.98, 0.66);
            cg = mix(cg, cg * vec3(0.72, 0.9, 0.5), smoothstep(0.5, 0.8, macro2) * 0.55);
            alb += cg * sp.x;
          }
          if (sp.w > 0.004) alb += (TG(tDirt, ${f(K.d)}, wxz) * 0.65 + TG(tDirt, ${f(K.d * 0.3)}, wxr) * 0.35) * sp.w;
          if (sp.z > 0.004) alb += (TG(tSand, ${f(K.s)}, wxz) * 0.7 + TG(tSand, ${f(K.s * 0.3)}, wxr) * 0.3) * sp.z;
          vec3 bw = pow(abs(normalize(vTN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 rp = vTW * ${f(K.r)};
          vec3 rgx = dFdx(rp), rgy = dFdy(rp);
          if (sp.y > 0.004) {
            vec3 cr = textureGrad(tRock, rp.zy, rgx.zy, rgy.zy).rgb * bw.x + textureGrad(tRock, rp.xz, rgx.xz, rgy.xz).rgb * bw.y + textureGrad(tRock, rp.xy, rgx.xy, rgy.xy).rgb * bw.z;
            alb += cr * sp.y;
          }
          alb *= mix(0.8, 1.16, macro) * mix(0.92, 1.06, macro2);
          diffuseColor.rgb *= alb;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.97, 0.8, sp.y);')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec3 wn = normalize(vTN);
            vec3 gn = mix(texture2D(tGroundN, wxz * ${f(K.n)}).xyz, texture2D(tGrassN, wxz * ${f(K.g)}).xyz, sp.x) * 2.0 - 1.0;
            vec3 nW = normalize(wn + vec3(gn.x, 0.0, gn.y) * 0.7);
            if (sp.y > 0.004) {
              vec3 tx = textureGrad(tRockN, rp.zy, rgx.zy, rgy.zy).xyz * 2.0 - 1.0;
              vec3 ty = textureGrad(tRockN, rp.xz, rgx.xz, rgy.xz).xyz * 2.0 - 1.0;
              vec3 tz = textureGrad(tRockN, rp.xy, rgx.xy, rgy.xy).xyz * 2.0 - 1.0;
              tx = vec3(tx.xy + wn.zy, abs(tx.z) * wn.x);
              ty = vec3(ty.xy + wn.xz, abs(ty.z) * wn.y);
              tz = vec3(tz.xy + wn.xy, abs(tz.z) * wn.z);
              vec3 nR = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz.xyz * bw.z);
              nW = normalize(mix(nW, nR, sp.y));
            }
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`);
    };
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.terrain = mesh;

    // height+density texture for the GPU grass
    const tex = new THREE.DataTexture(dens, N, N, THREE.RGFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.grassMask = this.buildGrassMask();
    this.heightTex = tex;
  },

  /**
   * 1 m grid of where grass may grow: none on floors, steps, pedestals, walls or columns,
   * thinning out softly toward their edges (the terrain grid alone is too coarse for that).
   */
  buildGrassMask() {
    const R = 1024, H = this.HALF, cell = (2 * H) / R, data = new Uint8Array(R * R);
    const boxD = (c, x, z) => {
      const dx = x - c.x, dz = z - c.z, lx = Math.abs(dx * c.c + dz * c.s) - c.hx, lz = Math.abs(-dx * c.s + dz * c.c) - c.hz;
      return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
    };
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = -H + (i + 0.5) * cell, z = -H + (j + 0.5) * cell;
      let d = 99;
      for (const p of this.platforms) {
        const pd = p.r ? Math.hypot(x - p.x, z - p.z) - p.r : boxD({ x: p.x, z: p.z, c: p.c, s: p.s, hx: p.hx, hz: p.hz }, x, z);
        if (pd < d) d = pd;
      }
      const list = this.grid.get(Math.floor(x / 8) + ',' + Math.floor(z / 8));
      if (list) for (const c of list) {
        if (c.type !== 'box' && c.r <= 0.4) continue;
        const cd =(c.type === 'circle' ? Math.hypot(x - c.x, z - c.z) - c.r : boxD(c, x, z)) + 0.6;
        if (cd < d) d = cd;
      }
      let m = smooth(0.1, 2.2, d);
      for (const f of this.footprints) {
        const fd = Math.hypot(x - f.x, z - f.z);
        if (fd < f.r + 1) m *= smooth(f.r - 4, f.r + 1, fd);
      }
      data[j * R + i] = Math.round(m * 255);
    }
    const t = new THREE.DataTexture(data, R, R, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  },

  /* ------------------------------------------------------------ sea */
  buildSea(scene) {
    const geo = new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(-Math.PI / 2);
    const water = new Addons.Water(new THREE.PlaneGeometry(12000, 12000), {
      textureWidth: 512, textureHeight: 512, waterNormals: Tex.waterN,
      sunDirection: this.sunDir.clone(), sunColor: 0xffd9a0, waterColor: 0x0a2731, distortionScale: 2.4, fog: true, alpha: 1,
    });
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0;
    this.waterHi = water;
    const n = Tex.waterN.clone(); n.repeat.set(900, 900); n.needsUpdate = true;
    this.waterLoN = n;
    this.waterLo = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x0c2a35, roughness: 0.06, metalness: 0.1, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 }));
    scene.add(water, this.waterLo);
    this.setWaterQuality(G.settings.quality);
  },
  setWaterQuality(q) {
    // the mirror sea renders the whole world a second time every frame: Ultra only
    const hi = q === 'ultra';
    this.waterHi.visible = hi;
    this.waterLo.visible = !hi;
  },

  /* ------------------------------------------------------------ grass */
  /**
   * The meadow around the camera. With the photo set loaded every instance is a tuft of real grass
   * (a card from the grass atlas, bent by the wind along its height); opened from disk it falls
   * back to single painted blades.
   */
  buildGrass(scene) {
    if (this.grass) { scene.remove(this.grass); this.grass.geometry.dispose(); }
    const tufts = !!Tex.grassTufts;
    // a tuft holds dozens of blades, so far fewer instances fill the same field
    const Q = (tufts ? { low: [11000, 36], medium: [26000, 46], high: [40000, 58], ultra: [70000, 78] }
      : { low: [30000, 36], medium: [85000, 46], high: [130000, 58], ultra: [230000, 78] })[G.settings.quality] || (tufts ? [26000, 46] : [85000, 46]);
    const [count, win] = Q;
    const w = 0.075;
    const bp = tufts ? [-0.5, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 1, 0, 0.5, 1, 0]
      : [-w / 2, 0, 0, w / 2, 0, 0, -w * 0.42, 0.33, 0, w * 0.42, 0.33, 0, -w * 0.27, 0.66, 0, w * 0.27, 0.66, 0, 0, 1, 0];
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(bp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    if (tufts) geo.setAttribute('uv', new THREE.Float32BufferAttribute(bp.flatMap((v, i) => (i % 3 === 0 ? [v + 0.5] : i % 3 === 1 ? [v] : [])), 2));
    geo.setIndex(tufts ? [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4] : [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6]);
    const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4);
    const r = mulberry32(4242);
    for (let i = 0; i < count; i++) {
      // clumped placement: blades gather around clump centres
      const cx = r() * win, cz = r() * win, a = r() * TAU, d = Math.pow(r(), 1.5) * 0.9;
      off[i * 2] = (cx + Math.cos(a) * d + win) % win; off[i * 2 + 1] = (cz + Math.sin(a) * d + win) % win;
      rnd[i * 4] = r(); rnd[i * 4 + 1] = r(); rnd[i * 4 + 2] = r(); rnd[i * 4 + 3] = r();
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRnd', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, map: tufts ? Tex.grassTufts : null, alphaTest: tufts ? 0.5 : 0 });
    if (tufts) mat.defines = { GRASS_TUFTS: '' };
    const U = {
      uCenter: { value: new THREE.Vector2() }, uWin: { value: win }, uHeight: { value: this.heightTex }, uHRes: { value: this.N }, uHalf: { value: this.HALF },
      uPlayer: { value: new THREE.Vector3(0, -999, 0) }, uSun: { value: this.sunDir }, uTime: G.uniforms.time, uMask: { value: this.grassMask },
      // matched to the sun-dried meadow under it
      // withered, dusty grass: olive-dark at the root, dry straw at the tips
      uColA: { value: new THREE.Color(0.2, 0.21, 0.1) }, uColB: { value: new THREE.Color(0.43, 0.37, 0.2) }, uTip: { value: new THREE.Color(0.66, 0.57, 0.38) },
      // tufts: the photographed grass (it averages 3% luminance) brought up to the meadow's brightness
      // and half-withered toward straw; and each atlas tile's height/width
      uGain: { value: 8.5 }, uStraw: { value: new THREE.Color(9.4, 8.1, 4.4) }, uDry: { value: 0.6 }, uAspect: { value: Tex.grassAspect || [1, 1, 1, 1, 1, 1, 1, 1] },
    };
    this.grassU = U;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aOff; attribute vec4 aRnd;
          uniform vec2 uCenter; uniform float uWin; uniform sampler2D uHeight; uniform sampler2D uMask; uniform float uHRes; uniform float uHalf; uniform vec3 uPlayer; uniform float uTime;
          uniform float uAspect[8]; uniform vec3 uSun;
          varying float vGT; varying float vGC; varying vec3 vGW;
          int grassTile() { return int(floor(fract(aRnd.x * 13.7 + aRnd.w * 5.3) * 7.999)); }
          vec2 terr(vec2 p){
            vec2 g = clamp((p + uHalf) / (2.0 * uHalf) * (uHRes - 1.0), vec2(0.0), vec2(uHRes - 1.001));
            ivec2 i = ivec2(floor(g)); vec2 f = fract(g);
            vec2 a = texelFetch(uHeight, i, 0).rg, b = texelFetch(uHeight, i + ivec2(1, 0), 0).rg;
            vec2 c = texelFetch(uHeight, i + ivec2(0, 1), 0).rg, d = texelFetch(uHeight, i + ivec2(1, 1), 0).rg;
            return (f.x + f.y < 1.0) ? a + (b - a) * f.x + (c - a) * f.y : d + (c - d) * (1.0 - f.x) + (b - d) * (1.0 - f.y);
          }`)
        // lit like the ground it grows from (a side-facing normal turns half the blades black against a low sun)
        .replace('#include <beginnormal_vertex>', `float gAng = aRnd.x * 6.28318; vec3 objectNormal = normalize(vec3(-sin(gAng), 0.0, cos(gAng)) * 0.12 + vec3(0.0, 1.0, 0.0));
          #ifdef GRASS_TUFTS
            // upright blades catch a low sun the way the ground under them can't: lean the normal toward it
            objectNormal = normalize(vec3(uSun.x, 0.0, uSun.z) * 0.85 + vec3(0.0, 1.0, 0.0));
          #endif`)
        .replace('#include <begin_vertex>', `
          vec2 rel = mod(aOff - uCenter + uWin * 0.5, uWin) - uWin * 0.5;
          vec2 wp = uCenter + rel;
          vec2 hd = terr(wp);
          float dist = length(rel) / (uWin * 0.5);
          float mask = texture2D(uMask, (wp + uHalf) / (2.0 * uHalf)).r;
          // the field thins out toward the edge of the window instead of ending on a line
          float keep = step(aRnd.z, hd.y * mask * smoothstep(1.0, 0.45, dist));
          float bh = (0.24 + aRnd.y * aRnd.y * 0.55) * keep * mix(0.6, 1.0, smoothstep(1.0, 0.7, dist)) * mix(0.55, 1.0, mask);
          float ang = aRnd.x * 6.28318;
          float t = position.y;
          float cs = cos(ang), sn = sin(ang);
          #ifdef GRASS_TUFTS
            // a tuft card: as wide as its tile's tuft is for this height
            bh *= 1.15;
            float tw = bh / uAspect[grassTile()] * (0.85 + aRnd.w * 0.3);
            vec3 p = vec3(position.x * cs * tw, 0.0, position.x * sn * tw);
          #else
            vec3 p = vec3(position.x * cs * (0.8 + aRnd.w * 0.7), 0.0, position.x * sn * (0.8 + aRnd.w * 0.7));
          #endif
          vec2 wdir = normalize(vec2(1.0, 0.35));
          float gust = sin(uTime * 1.2 + wp.x * 0.06 + wp.y * 0.045) * 0.5 + 0.5;
          float flutter = sin(uTime * 3.7 + aRnd.x * 40.0) * 0.07;
          vec2 lean = wdir * (0.12 + gust * gust * 0.42 + flutter) + vec2(-sn, cs) * (aRnd.w - 0.5) * 0.55;
          vec2 toP = wp - uPlayer.xz; float pd = length(toP);
          lean += (toP / max(pd, 0.001)) * smoothstep(1.5, 0.15, pd) * 1.4 * step(abs(uPlayer.y - hd.x), 1.5);
          float bend = t * t;
          vec3 transformed = vec3(wp.x, hd.x - 0.03, wp.y) + p;
          transformed += vec3(lean.x * bend * bh, t * bh * (1.0 - 0.3 * bend * min(1.0, length(lean))), lean.y * bend * bh);
          vGT = t; vGC = aRnd.w; vGW = transformed;`)
        // each tuft shows one tile of the atlas
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          #ifdef GRASS_TUFTS
            int gt = grassTile();
            vMapUv = vec2((float(gt - (gt / 4) * 4) + uv.x) * 0.25, 1.0 - float(gt / 4 + 1) * 0.5 + uv.y * 0.5);
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uTip; uniform vec3 uSun; uniform vec3 uStraw; uniform float uDry; uniform float uGain;
          varying float vGT; varying float vGC; varying vec3 vGW;`)
        .replace('#include <color_fragment>', `
          #ifdef GRASS_TUFTS
            // the photographed blades, part-withered to straw; darker down in the tuft
            float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
            diffuseColor.rgb = mix(diffuseColor.rgb * uGain, gLum * uStraw, uDry) * mix(0.55, 1.0, vGT) * (0.85 + 0.3 * vGC);
          #else
            vec3 gc = mix(uColA, uColB, smoothstep(0.15, 0.95, vGC));
            gc = mix(gc * 0.72, mix(gc, uTip, 0.45), vGT);
            diffuseColor.rgb *= gc;
          #endif`)
        // a blade is lit the same from both sides (no black backs)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n          normal = normalize(vNormal);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          vec3 vd = normalize(vGW - cameraPosition);
          float back = pow(max(dot(vd, uSun), 0.0), 3.0);
          #ifdef GRASS_TUFTS
            totalEmissiveRadiance += diffuseColor.rgb * vec3(1.6, 1.4, 0.9) * back * vGT * vGT;
            // skylight through and between the blades, so a tuft in shadow stays grass, not a black cut-out
            totalEmissiveRadiance += diffuseColor.rgb * 0.3;
          #else
            totalEmissiveRadiance += uTip * vec3(1.0, 0.85, 0.5) * back * vGT * vGT * 0.9;
          #endif`);
    };
    mat.customProgramCacheKey = () => (tufts ? 'grass-tufts' : 'grass-blades');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    this.grass = mesh;
  },

  /**
   * One InstancedMesh per kind of prop (one draw call), holding only the instances near the
   * camera: they are re-packed whenever the camera has moved a little. Props deep in the haze
   * cost nothing, in the main view or the shadow map. items: [x, z, ...]; place(item) → matrix.
   */
  instanced(scene, geo, mat, items, place, shadow) {
    if (!items.length) return;
    const all = items.map((it) => place(it).clone());
    const make = () => {
      const im = new THREE.InstancedMesh(geo, mat, items.length);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      return im;
    };
    // what the camera sees: everything out to the haze, casting no shadow itself
    const view = make();
    view.receiveShadow = true;
    // what the sun sees: only the props near the camera, on a layer only the shadow camera renders
    const caster = shadow ? make() : null;
    if (caster) { caster.castShadow = true; caster.layers.set(2); }
    (this.propSets || (this.propSets = [])).push({ all, at: all.map((m) => new THREE.Vector3().setFromMatrixPosition(m)), view, caster });
  },
  cullProps(cam, force = false) {
    if (!this.propSets) return;
    const c = cam.position;
    if (!force && this._cullAt && this._cullAt.distanceToSquared(c) < 100) return;
    (this._cullAt || (this._cullAt = new THREE.Vector3())).copy(c);
    const R2 = 470 * 470, S2 = 85 * 85;
    for (const { all, at, view, caster } of this.propSets) {
      let n = 0, s = 0;
      for (let i = 0; i < all.length; i++) {
        const dx = at[i].x - c.x, dz = at[i].z - c.z, d2 = dx * dx + dz * dz;
        if (d2 < R2) view.setMatrixAt(n++, all[i]);
        if (caster && d2 < S2) caster.setMatrixAt(s++, all[i]);
      }
      view.count = n; view.instanceMatrix.needsUpdate = true;
      if (caster) { caster.count = s; caster.instanceMatrix.needsUpdate = true; }
    }
  },

  /* ------------------------------------------------------------ trees */
  buildTrees(scene) {
    const rng = mulberry32(777);
    const barkMat = triplanarMaterial({ map: Tex.bark.map, normal: Tex.bark.normal, rough: Tex.bark.rough, scale: 0.6, roughness: 1, normalStrength: 1.2, envMapIntensity: 0.6 });
    // photographed leaves: cypress deep green, olive the dusty silver-green of the real tree
    const cypMat = leafMaterial([0.62, 0.78, 0.56], { fallback: Tex.leafCypress, wind: 0.02, roughness: 0.9 });
    const oliMat = leafMaterial([1.4, 1.15, 2.0], { fallback: Tex.leafOlive, wind: 0.04 });
    const tiles = leafTiles(), nTiles = tiles ? tiles.cols * tiles.rows : 1;

    const cypress = [], olives = [];
    for (let v = 0; v < 3; v++) {
      const H = 10 + v * 2.5, R = 1.25 + v * 0.15;
      const trunk = taperedTube([new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0.05, H * 0.4, 0), new THREE.Vector3(0, H * 0.85, 0.05)], 0.28, 0.05, 6, 2);
      const cards = [];
      for (let i = 0; i < 170; i++) {
        const t = Math.pow(rng(), 0.8) * 0.92 + 0.06;
        const prof = t < 0.3 ? lerp(0.55, 1, t / 0.3) : Math.pow((1 - t) / 0.7, 0.75);
        const a = rng() * TAU, depth = 0.35 + rng() * 0.65, rr = R * prof * depth;
        // cards stand upright round the column, facing out; deep ones sit in the shade
        cards.push({ p: new THREE.Vector3(Math.cos(a) * rr, H * t, Math.sin(a) * rr), s: 1.1 + rng() * 0.8 * prof + 0.3, rx: (rng() - 0.5) * 0.7, ry: a + Math.PI / 2 + (rng() - 0.5) * 1.4, rz: rng() * TAU, shade: 0.45 + 0.6 * depth * (0.8 + 0.2 * t), tile: Math.floor(rng() * nTiles) });
      }
      cypress.push({ trunk, leaves: foliageCards(cards, (p) => new THREE.Vector3(0, p.y, 0), tiles), H });
    }
    for (let v = 0; v < 3; v++) {
      const geos = [];
      const top = new THREE.Vector3(rng() - 0.5, 2.1 + rng() * 0.5, rng() - 0.5);
      for (let k = 0; k < 2; k++) {
        const pts = [new THREE.Vector3((rng() - 0.5) * 0.4, -0.4, (rng() - 0.5) * 0.4), new THREE.Vector3((rng() - 0.5) * 0.6, 0.8, (rng() - 0.5) * 0.6), new THREE.Vector3((rng() - 0.5) * 0.8, 1.5, (rng() - 0.5) * 0.8), top.clone().add(new THREE.Vector3((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3))];
        geos.push(taperedTube(pts, 0.32 - k * 0.08, 0.2, 7, 3));
      }
      const clusters = [];
      for (let b = 0; b < 5; b++) {
        const a = (b / 5) * TAU + rng() * 0.6, len = 1.6 + rng() * 1.2;
        const end = top.clone().add(new THREE.Vector3(Math.cos(a) * len, 1 + rng() * 1.2, Math.sin(a) * len));
        geos.push(taperedTube([top.clone(), top.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.3, 0)), end], 0.16, 0.05, 5, 3));
        clusters.push(end);
      }
      clusters.push(top.clone().add(new THREE.Vector3(0, 2.2, 0)));
      const cards = [];
      const center = top.clone().add(new THREE.Vector3(0, 1.2, 0));
      for (const c of clusters) for (let i = 0; i < 26; i++) {
        const off = new THREE.Vector3((rng() - 0.5) * 2, (rng() - 0.3) * 1.2, (rng() - 0.5) * 2);
        const p = c.clone().add(off), out = Math.min(1, p.distanceTo(center) / 3.2);
        cards.push({ p, s: 1.0 + rng() * 0.7, rx: (rng() - 0.5) * 1.4, ry: rng() * TAU, rz: rng() * TAU, shade: 0.5 + 0.45 * out + 0.12 * Math.max(0, off.y), tile: Math.floor(rng() * nTiles) });
      }
      olives.push({ trunk: Addons.mergeGeometries(geos.map(prep)), leaves: foliageCards(cards, () => center, tiles), H: 5 });
    }

    // placement
    const placeOK = (x, z, minH = 1.8) => {
      const h = this.terrainHeight(x, z);
      if (h < minH) return false;
      const p = this.pathInfo(x, z);
      if (p.d < 7) return false;
      for (const f of this.FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.92 + 4) return false;
      const e = 1.2;
      const slope = Math.abs(this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z)) + Math.abs(this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e));
      if (slope > 2.0) return false;
      for (const f of this.footprints) if (Math.hypot(x - f.x, z - f.z) < f.r + 2) return false;
      return true;
    };
    const placed = { cyp: [[], [], []], oli: [[], [], []] };
    let tries = 0;
    while (tries++ < 9000 && placed.cyp.flat().length < 190) {
      // cypress stand in lines and clusters on the hills
      const x = (rng() - 0.5) * 820, z = (rng() - 0.5) * 820;
      if (this.noise.noise(x * 0.006 + 20, z * 0.006) < 0.15) continue;
      if (!placeOK(x, z, 3)) continue;
      placed.cyp[Math.floor(rng() * 3)].push([x, z, 0.8 + rng() * 0.45, rng() * TAU]);
    }
    tries = 0;
    while (tries++ < 9000 && placed.oli.flat().length < 170) {
      const x = (rng() - 0.5) * 760, z = (rng() - 0.5) * 760;
      if (this.noise.noise(x * 0.008 - 30, z * 0.008 + 5) < 0.0) continue;
      if (!placeOK(x, z, 2)) continue;
      placed.oli[Math.floor(rng() * 3)].push([x, z, 0.85 + rng() * 0.5, rng() * TAU]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const inst = (geo, mat, list, shadow) => this.instanced(scene, geo, mat, list, ([x, z, sc, ry]) => {
      q.setFromAxisAngle(up, ry); s.setScalar(sc); p.set(x, this.terrainHeight(x, z), z);
      return m4.compose(p, q, s);
    }, shadow);
    for (let v = 0; v < 3; v++) {
      inst(cypress[v].trunk, barkMat, placed.cyp[v], true);
      inst(cypress[v].leaves, cypMat, placed.cyp[v], true);
      inst(olives[v].trunk, barkMat, placed.oli[v], true);
      inst(olives[v].leaves, oliMat, placed.oli[v], true);
      placed.cyp[v].forEach(([x, z, sc]) => this.circle(x, z, 0.45 * sc));
      placed.oli[v].forEach(([x, z, sc]) => this.circle(x, z, 0.5 * sc));
    }
    this.barkMat = barkMat;
  },

  /* ------------------------------------------------------------ rocks */
  buildRocks(scene) {
    const rng = mulberry32(31);
    const rockMat = triplanarMaterial({ map: Tex.rock.map, normal: Tex.rock.normal, rough: Tex.rock.rough, scale: 0.3, roughness: 1, normalStrength: 1.4 });
    this.rockMat = rockMat;
    const variants = [];
    for (let v = 0; v < 4; v++) {
      const g = new THREE.IcosahedronGeometry(1, 4);
      const P = g.attributes.position, n = new Simplex2(100 + v), vv = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        vv.fromBufferAttribute(P, i);
        const d = 1 + n.fbm(vv.x * 1.3 + vv.y, vv.z * 1.3 - vv.y, 4) * 0.35 + Math.abs(n.noise(vv.x * 3, vv.z * 3 + vv.y)) * 0.08;
        vv.multiplyScalar(d);
        vv.y = vv.y < -0.2 ? -0.2 + (vv.y + 0.2) * 0.3 : vv.y;
        vv.x *= 1 + v * 0.15; vv.y *= 0.65 + v * 0.08;
        P.setXYZ(i, vv.x, vv.y, vv.z);
      }
      g.computeVertexNormals();
      variants.push(g);
    }
    this.rockVariants = variants;
    const lists = [[], [], [], []];
    let tries = 0;
    while (tries++ < 6000 && lists.flat().length < 260) {
      const x = (rng() - 0.5) * 860, z = (rng() - 0.5) * 860;
      const h = this.terrainHeight(x, z);
      if (h < -1) continue;
      if (this.pathInfo(x, z).d < 6) continue;
      let bad = false;
      for (const f of this.FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r * 0.85) bad = true;
      for (const f of this.footprints) if (Math.hypot(x - f.x, z - f.z) < f.r + 2) bad = true;
      if (bad) continue;
      const big = rng() < 0.18;
      const sc = big ? 2.5 + rng() * 4 : 0.4 + rng() * 1.6;
      // don't bury a rock inside a tree, a column or another rock
      if (this.blocked(x, z, sc * 1.05)) continue;
      lists[Math.floor(rng() * 4)].push([x, z, sc, rng() * TAU, rng()]);
      this.circle(x, z, sc * 0.9, this.terrainHeight(x, z) + sc * 0.65);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    lists.forEach((list, v) => this.instanced(scene, variants[v], rockMat, list, ([x, z, sc, ry, t]) => {
      e.set((t - 0.5) * 0.3, ry, (t - 0.5) * 0.3); q.setFromEuler(e);
      s.set(sc, sc * (0.7 + t * 0.6), sc);
      p.set(x, this.terrainHeight(x, z) - sc * 0.15, z);
      return m4.compose(p, q, s);
    }, true));
  },

  /* ------------------------------------------------------------ statues
     Carved in marble from the character models: Zeus and Hercules are posed on their rigs and
     baked, Athena and Poseidon are their sculpts as they stand. Without models, the old
     code-built statues stand in. */
  placeStatues(scene) {
    const cache = {};
    for (const st of this.statues || []) {
      const key = st.kind + (st.headless ? '-h' : '');
      let g = cache[key];
      if (g === undefined) {
        try { g = this.statueGeometry(st.kind, st.headless); } catch (e) { console.warn('statue', st.kind, e); g = null; }
        if (!g) {
          const proc = buildStatueGeometry(st.kind, { headless: st.headless, broken: st.headless });
          g = prep(proc);
        }
        cache[key] = g;
      }
      const m = new THREE.Mesh(g, this.marbleMat);
      m.position.set(st.x, st.y, st.z);
      m.rotation.set(st.rx || 0, st.ry || 0, st.rz || 0, st.order || 'XYZ');
      m.scale.setScalar(st.s);
      if (st.rz || st.rx) {
        // a fallen statue rests on the ground, sunk a little into it
        m.position.y = 0;
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        m.position.y = this.terrainHeight(st.x, st.z) - box.min.y - 0.35;
      }
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
  },
  /** a statue as one geometry: feet on y=0, ~1.85 tall, facing +Z (position + normal only) */
  statueGeometry(kind, headless) {
    const H = 1.85;
    let geos = [], neckY = null;
    if (kind === 'athena' || kind === 'poseidon') {
      const tpl = Models.loaded[kind], d = MODEL_DEFS[kind];
      if (!tpl) return null;
      tpl.updateMatrixWorld(true);
      tpl.traverse((o) => {
        if (!o.isMesh || !o.visible || o.geometry.attributes.position.count < 12) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', o.geometry.attributes.position.clone());
        if (o.geometry.attributes.normal) g.setAttribute('normal', o.geometry.attributes.normal.clone());
        if (o.geometry.index) g.setIndex(o.geometry.index.clone());
        g.applyMatrix4(o.matrixWorld);
        if (d.rotY) g.rotateY(d.rotY);
        geos.push(g.index ? g : g);
      });
      if (headless) neckY = d.landmarks.neck[1] / LM_H;
    } else {
      // the Fallen Colossus is a Zeus too: the detailed model holds up at twelve metres
      const key = 'zeus';
      if (!Models.loaded[key]) return null;
      const b = buildShell({ stance: 'casual' });
      const binding = Models.attach(b.rig, key);
      if (!binding) return null;
      b.rig.poseFrom(STATUE_POSES[kind]);
      binding.update();
      b.root.updateMatrixWorld(true);
      if (headless) neckY = b.rig.j.neck.getWorldPosition(new THREE.Vector3()).y + 0.03;
      binding.holder.traverse((o) => { if (o.isSkinnedMesh && o.visible) geos.push(bakeSkinned(o)); });
    }
    if (!geos.length) return null;
    geos.forEach((g) => { if (!g.attributes.normal) g.computeVertexNormals(); });
    if (geos.some((g) => g.index) && geos.some((g) => !g.index)) geos = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    let g = geos.length > 1 ? Addons.mergeGeometries(geos) : geos[0];
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const k = (kind === 'athena' || kind === 'poseidon') ? H / (bb.max.y - bb.min.y) : H / MODEL_DEFS.zeus.height;
    g.translate(kind === 'athena' || kind === 'poseidon' ? -(bb.min.x + bb.max.x) / 2 : 0, -bb.min.y, kind === 'athena' || kind === 'poseidon' ? -(bb.min.z + bb.max.z) / 2 : 0);
    g.scale(k, k, k);
    if (neckY !== null) {
      // the head broken away, a little below the jaw
      const cut = (kind === 'athena' || kind === 'poseidon') ? neckY * H : (neckY - bb.min.y) * k;
      g = cutAbove(g, cut);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  },

  /* ------------------------------------------------------------ ruins */
  columnGeo(h, r, { broken = 0, capital = true, base = true, flutes = 18 } = {}, rng = Math.random) {
    const parts = [];
    const shaftH = h - (capital && !broken ? 0.42 : 0) - (base ? 0.26 : 0);
    const sh = new THREE.CylinderGeometry(r * 0.84, r, shaftH, flutes * 4, 6, false);
    const P = sh.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), rr = Math.hypot(x, z);
      if (rr < r * 0.5) { if (broken && y > 0) P.setY(i, y - rng() * r * 0.5); continue; }
      const a = Math.atan2(z, x), t = y / shaftH + 0.5;
      const groove = Math.pow(Math.max(0, Math.cos(a * flutes)), 2.5) * 0.05;
      const ent = 1 + Math.sin(t * Math.PI) * 0.025;
      const k = (1 - groove) * ent;
      P.setX(i, x * k); P.setZ(i, z * k);
      if (broken && y > shaftH / 2 - 0.01) P.setY(i, y - rng() * r * 0.9);
    }
    sh.computeVertexNormals();
    sh.translate(0, shaftH / 2 + (base ? 0.26 : 0), 0);
    parts.push(sh);
    if (base) {
      parts.push(new THREE.CylinderGeometry(r * 1.28, r * 1.32, 0.16, 32).translate(0, 0.08, 0));
      parts.push(new THREE.TorusGeometry(r * 1.03, r * 0.11, 8, 32).rotateX(Math.PI / 2).translate(0, 0.2, 0));
    }
    if (capital && !broken) {
      parts.push(new THREE.CylinderGeometry(r * 1.28, r * 0.86, 0.24, 32).translate(0, h - 0.3, 0));
      parts.push(new THREE.BoxGeometry(r * 2.75, 0.18, r * 2.75).translate(0, h - 0.09, 0));
    }
    return Addons.mergeGeometries(parts.map(prep));
  },

  buildRuins(scene) {
    const marble = triplanarMaterial({ map: Tex.marble.map, normal: Tex.marble.normal, rough: Tex.marble.rough, scale: Tex.photo ? 0.45 : 0.32, color: Tex.photo ? 0xe9e3d7 : 0xd6cfc2, roughness: 1, normalStrength: 1.1, envMapIntensity: 0.7 });
    this.marbleMat = marble;
    const paveMat = new THREE.MeshStandardMaterial({ map: Tex.pavers.map, normalMap: Tex.pavers.normal, roughnessMap: Tex.pavers.rough || null, roughness: Tex.pavers.rough ? 1 : 0.85 });
    const sites = {};
    const M = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    const addTo = (key, g, x, y, z, ry = 0, rx = 0, rz = 0, sc = 1) => {
      if (!sites[key]) sites[key] = [];
      M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sc, sc, sc));
      const gg = prep(g.clone ? g.clone() : g);
      gg.applyMatrix4(M);
      sites[key].push(gg);
    };
    const rng = mulberry32(2024);
    const local = (cx, cz, rot, lx, lz) => [cx + lx * Math.cos(rot) + lz * Math.sin(rot), cz - lx * Math.sin(rot) + lz * Math.cos(rot)];

    // ---------- peripteral temple
    const temple = (key, o) => {
      const { x, z, rot = 0, cols = 6, rows = 9, sp = 3.2, colH = 7.2, colR = 0.55, ruin = 0.4, roof = true, cella = true } = o;
      const W = (cols - 1) * sp, D = (rows - 1) * sp, m = 1.7;
      const y0 = this.terrainHeight(x, z) - 0.25;
      const stepH = 0.38;
      for (let s = 0; s < 3; s++) {
        const bw = W + 2 * m + (2 - s) * 1.4, bd = D + 2 * m + (2 - s) * 1.4;
        addTo(key, new THREE.BoxGeometry(bw, stepH + (s === 0 ? 1.2 : 0), bd), x, y0 + stepH * (s + 0.5) - (s === 0 ? 0.6 : 0), z, rot);
        this.addPlatform(x, z, bw / 2, bd / 2, -rot, y0 + stepH * (s + 1));
      }
      this.footprints.push({ x, z, r: Math.max(W, D) / 2 + m + 3 });
      const fy = y0 + stepH * 3;
      const colState = [];
      const perim = [];
      for (let i = 0; i < cols; i++) { perim.push([i, 0]); perim.push([i, rows - 1]); }
      for (let j = 1; j < rows - 1; j++) { perim.push([0, j]); perim.push([cols - 1, j]); }
      for (const [i, j] of perim) {
        const lx = -W / 2 + i * sp, lz = -D / 2 + j * sp;
        const [wx, wz] = local(x, z, rot, lx, lz);
        const r = rng();
        let st = 'full';
        if (r < ruin * 0.32) st = 'gone'; else if (r < ruin) st = 'broken';
        colState[i + ',' + j] = st;
        if (st === 'gone') {
          for (let d = 0; d < 3; d++) {
            const a = rng() * TAU, dd = 2 + rng() * 5;
            const gx = wx + Math.cos(a) * dd, gz = wz + Math.sin(a) * dd;
            const gy = this.getHeight(gx, gz, fy + 1);
            addTo(key, this.columnGeo(1.3, colR, { capital: false, base: false, broken: 0 }, rng), gx, gy + colR * 0.85, gz, rng() * TAU, 0, Math.PI / 2);
            this.circle(gx, gz, colR * 1.1);
          }
          continue;
        }
        const h = st === 'full' ? colH : colH * (0.2 + rng() * 0.55);
        addTo(key, this.columnGeo(h, colR, { broken: st === 'broken' ? 1 : 0, capital: st === 'full' }, rng), wx, fy, wz, rot);
        this.circle(wx, wz, colR * 1.15, fy + h);
      }
      // entablature over runs of standing columns
      const beam = (i0, j0, i1, j1) => {
        const a = colState[i0 + ',' + j0], b = colState[i1 + ',' + j1];
        if (a !== 'full' || b !== 'full') return;
        const lx = -W / 2 + (i0 + i1) / 2 * sp, lz = -D / 2 + (j0 + j1) / 2 * sp;
        const [wx, wz] = local(x, z, rot, lx, lz);
        const alongX = j0 === j1;
        addTo(key, new THREE.BoxGeometry(alongX ? sp + colR * 2.2 : colR * 2.3, 0.75, alongX ? colR * 2.3 : sp + colR * 2.2), wx, fy + colH + 0.37, wz, rot);
        addTo(key, new THREE.BoxGeometry(alongX ? sp + colR * 2.2 : colR * 2.1, 0.6, alongX ? colR * 2.1 : sp + colR * 2.2), wx, fy + colH + 1.05, wz, rot);
        addTo(key, new THREE.BoxGeometry(alongX ? sp + colR * 2.6 : colR * 2.8, 0.22, alongX ? colR * 2.8 : sp + colR * 2.6), wx, fy + colH + 1.45, wz, rot);
      };
      for (let i = 0; i < cols - 1; i++) { beam(i, 0, i + 1, 0); beam(i, rows - 1, i + 1, rows - 1); }
      for (let j = 0; j < rows - 1; j++) { beam(0, j, 0, j + 1); beam(cols - 1, j, cols - 1, j + 1); }
      // pediment on the front if the whole front stands
      let frontOK = true;
      for (let i = 0; i < cols; i++) if (colState[i + ',0'] !== 'full') frontOK = false;
      if (roof && frontOK) {
        const tri = new THREE.Shape();
        tri.moveTo(-W / 2 - colR * 1.4, 0); tri.lineTo(W / 2 + colR * 1.4, 0); tri.lineTo(0, 2.6); tri.lineTo(-W / 2 - colR * 1.4, 0);
        const pg = new THREE.ExtrudeGeometry(tri, { depth: colR * 2.2, bevelEnabled: false });
        pg.translate(0, 0, -colR * 1.1);
        const [wx, wz] = local(x, z, rot, 0, -D / 2);
        addTo(key, pg, wx, fy + colH + 1.56, wz, rot);
        // first roof slabs
        const slope = Math.atan2(2.6, W / 2);
        for (const sg of [-1, 1]) {
          const [rx, rz] = local(x, z, rot, sg * W / 4, -D / 2 + sp * 0.9);
          addTo(key, new THREE.BoxGeometry(W / 2 / Math.cos(slope) + 1, 0.3, sp * 1.8), rx, fy + colH + 1.56 + 1.3, rz, rot);
          sites[key][sites[key].length - 1].applyMatrix4(new THREE.Matrix4().makeTranslation(-rx, -(fy + colH + 2.86), -rz))
            .applyMatrix4(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot)), -sg * slope))
            .applyMatrix4(new THREE.Matrix4().makeTranslation(rx, fy + colH + 2.86, rz));
        }
      }
      // cella walls (ruined to various heights)
      if (cella) {
        const cw = W - sp * 1.6, cd = D - sp * 2.2, t = 0.6;
        const wall = (lx0, lz0, lx1, lz1, door) => {
          const len = Math.hypot(lx1 - lx0, lz1 - lz0), segs = Math.ceil(len / 2.2);
          for (let s = 0; s < segs; s++) {
            const u = (s + 0.5) / segs;
            if (door && Math.abs(u - 0.5) < 0.18) continue;
            const hh = (colH + 1) * (rng() < ruin ? 0.12 + rng() * 0.5 : 0.85 + rng() * 0.15);
            const lx = lerp(lx0, lx1, u), lz = lerp(lz0, lz1, u);
            const [wx, wz] = local(x, z, rot, lx, lz);
            const alongX = Math.abs(lz1 - lz0) < 0.01;
            const sl = len / segs + 0.02;
            addTo(key, new THREE.BoxGeometry(alongX ? sl : t, hh, alongX ? t : sl), wx, fy + hh / 2, wz, rot);
            this.box(wx, wz, alongX ? sl / 2 : t / 2, alongX ? t / 2 : sl / 2, -rot, fy + hh);
          }
        };
        wall(-cw / 2, -cd / 2, cw / 2, -cd / 2, true);
        wall(-cw / 2, cd / 2, cw / 2, cd / 2, false);
        wall(-cw / 2, -cd / 2, -cw / 2, cd / 2, false);
        wall(cw / 2, -cd / 2, cw / 2, cd / 2, false);
      }
      // rubble
      for (let i = 0; i < 14; i++) {
        const a = rng() * TAU, d = Math.max(W, D) / 2 + 2 + rng() * 9;
        const gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d, s = 0.4 + rng() * 0.9;
        const ry = rng() * TAU, rx = (rng() - 0.5) * 0.4, rz = (rng() - 0.5) * 0.4;
        if (this.blocked(gx, gz, s * 0.9)) continue;
        addTo(key, new THREE.BoxGeometry(s * 1.6, s, s * 1.1), gx, this.terrainHeight(gx, gz) + s * 0.3, gz, ry, rx, rz);
        this.circle(gx, gz, s * 0.75);
      }
      return { fy, W, D, y0 };
    };

    // ---------- Temple of Dawn (start)
    const S0 = this.sites.start;
    const t0 = temple('start', { x: S0.x, z: S0.z, rot: 0, cols: 6, rows: 10, ruin: 0.32, roof: true });
    this.sites.start.fy = t0.fy;
    // broken statue of Zeus inside the cella (carved from the models once they load: placeStatues)
    this.statues = [];
    addTo('start', new THREE.BoxGeometry(2.2, 1.4, 2.2), S0.x, t0.fy + 0.7, S0.z + 6);
    this.statues.push({ kind: 'zeus', headless: true, x: S0.x, y: t0.fy + 1.4, z: S0.z + 6, ry: Math.PI, s: 2.1 });
    this.circle(S0.x, S0.z + 6, 1.4);

    // ---------- Agora: stoa, tholos, statues, small temple
    const A = this.sites.agora;
    const ay = this.terrainHeight(A.x, A.z);
    for (let i = 0; i < 12; i++) {
      const x = A.x - 30 + i * 4.2, z = A.z + 34;
      const r = rng(), st = r < 0.2 ? 'gone' : r < 0.45 ? 'broken' : 'full';
      if (st === 'gone') continue;
      const h = st === 'full' ? 6.2 : 6.2 * (0.25 + rng() * 0.5);
      addTo('agora', this.columnGeo(h, 0.45, { broken: st === 'broken' ? 1 : 0, capital: st === 'full', flutes: 16 }, rng), x, this.terrainHeight(x, z) - 0.1, z);
      this.circle(x, z, 0.55);
      if (st === 'full' && i % 3 !== 2) addTo('agora', new THREE.BoxGeometry(4.6, 0.7, 1.0), x + 2.1, this.terrainHeight(x, z) + 6.45, z);
    }
    for (let i = 0; i < 10; i++) {
      const x = A.x - 30 + i * 5, z = A.z + 39, hh = rng() < 0.4 ? 1 + rng() * 2 : 4 + rng() * 2;
      addTo('agora', new THREE.BoxGeometry(5.05, hh, 0.7), x + 2.5, this.terrainHeight(x + 2.5, z) + hh / 2 - 0.2, z);
      this.box(x + 2.5, z, 2.52, 0.35);
    }
    this.footprints.push({ x: A.x - 5, z: A.z + 36, r: 6 });
    // tholos
    const T = { x: A.x + 26, z: A.z - 14 };
    const ty = this.terrainHeight(T.x, T.z) - 0.2;
    for (let s = 0; s < 3; s++) {
      addTo('agora', new THREE.CylinderGeometry(9.2 - s * 0.8, 9.2 - s * 0.8, 0.36, 48), T.x, ty + 0.18 + s * 0.36, T.z);
      this.platforms.push({ x: T.x, z: T.z, r: 9.2 - s * 0.8, top: ty + 0.36 * (s + 1) });
    }
    this.footprints.push({ x: T.x, z: T.z, r: 11 });
    const tfy = ty + 1.08;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU, x = T.x + Math.cos(a) * 7, z = T.z + Math.sin(a) * 7;
      const st = rng() < 0.3 ? 'broken' : 'full';
      addTo('agora', this.columnGeo(st === 'full' ? 6.5 : 2 + rng() * 2.5, 0.42, { broken: st === 'broken' ? 1 : 0, capital: st === 'full', flutes: 16 }, rng), x, tfy, z);
      this.circle(x, z, 0.5);
    }
    const ring = new THREE.TorusGeometry(7, 0.55, 6, 48, Math.PI * 0.9).rotateX(Math.PI / 2);
    addTo('agora', ring, T.x, tfy + 6.85, T.z, 0.4);
    // statues on pedestals
    const statueSpots = [['zeus', A.x - 10, A.z + 10, false], ['athena', A.x + 6, A.z + 18, false], ['poseidon', A.x - 22, A.z - 8, true]];
    for (const [kind, x, z, headless] of statueSpots) {
      const y = this.terrainHeight(x, z);
      addTo('agora', new THREE.BoxGeometry(2, 1.6, 2), x, y + 0.6, z);
      addTo('agora', new THREE.BoxGeometry(2.4, 0.3, 2.4), x, y + 1.45, z);
      this.statues.push({ kind, headless, x, y: y + 1.6, z, ry: Math.atan2(A.x - x, A.z - z), s: 1.75 });
      this.box(x, z, 1.2, 1.2);
    }
    temple('agora', { x: A.x - 42, z: A.z - 22, rot: Math.PI / 2, cols: 4, rows: 6, sp: 3.0, colH: 6.2, colR: 0.47, ruin: 0.65, roof: false });

    // ---------- the Fallen Colossus
    const C = this.sites.colossus;
    const cy = this.terrainHeight(C.x, C.z);
    // fallen on its back, feet at the centre, laid along the line of colliders below
    this.statues.push({ kind: 'hero', x: C.x, y: cy, z: C.z, rx: -Math.PI / 2 + 0.05, ry: Math.PI / 2 + 0.7, rz: 0.12, order: 'YXZ', s: 6.5 });
    const ax = Math.sin(0.7), az = Math.cos(0.7);
    for (let i = -1; i < 7; i++) this.circle(C.x - az * i * 1.6 * 1.4 + ax * 0, C.z + ax * i * 1.6 * 1.4, 2.2);
    this.footprints.push({ x: C.x, z: C.z, r: 10 });
    for (let i = 0; i < 9; i++) {
      const a = rng() * TAU, d = 6 + rng() * 10, gx = C.x + Math.cos(a) * d, gz = C.z + Math.sin(a) * d, s = 0.6 + rng() * 1.4;
      addTo('colossus', new THREE.DodecahedronGeometry(s, 0), gx, this.terrainHeight(gx, gz) + s * 0.4, gz, rng() * 3, rng(), rng());
      this.circle(gx, gz, s * 0.85);
    }

    // ---------- Shrine of the Hesperides (hilltop)
    const Hs = this.sites.hill;
    const ht = temple('hill', { x: Hs.x, z: Hs.z, rot: 0.5, cols: 4, rows: 5, sp: 3.0, colH: 6, colR: 0.45, ruin: 0.45, roof: false, cella: false });
    this.sites.hill.fy = ht.fy;

    // ---------- Colosseum of Ares
    const R = this.sites.arena;
    const ry = this.terrainHeight(R.x, R.z);
    R.y = ry; R.r = 27;
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(28, 28.5, 1, 64), paveMat);
    const rep = Tex.photo ? 16 : 6;
    for (const t of [floor.material.map, floor.material.normalMap, floor.material.roughnessMap]) if (t) t.repeat.set(rep, rep);
    floor.position.set(R.x, ry - 0.47, R.z);
    this.arenaFloor = { x: R.x, z: R.z, r2: 27.9 * 27.9, top: ry + 0.03 };
    floor.receiveShadow = true;
    scene.add(floor);
    const gap = 0.36;
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU + Math.PI / 22;
      const da = wrapAngle(a - Math.PI / 2);
      if (Math.abs(da) < gap) continue;
      const x = R.x + Math.cos(a) * 29.5, z = R.z + Math.sin(a) * 29.5;
      const st = rng() < 0.25 ? 'broken' : 'full';
      addTo('arena', this.columnGeo(st === 'full' ? 11 : 3 + rng() * 4, 0.7, { broken: st === 'broken' ? 1 : 0, capital: st === 'full', flutes: 20 }, rng), x, ry, z);
      this.circle(x, z, 0.92);
    }
    // tiers of seating (a lathe ring with an opening to the south)
    const prof = [];
    for (let s = 0; s < 5; s++) { prof.push(new THREE.Vector2(31.5 + s * 2.2, s * 1.25)); prof.push(new THREE.Vector2(31.5 + s * 2.2, (s + 1) * 1.25)); }
    prof.push(new THREE.Vector2(31.5 + 5 * 2.2 + 1, 6.25)); prof.push(new THREE.Vector2(31.5 + 5 * 2.2 + 1, -3)); prof.push(new THREE.Vector2(31.5, -3)); prof.push(new THREE.Vector2(31.5, 0));
    const tiers = new THREE.LatheGeometry(prof, 72, gap + 0.08, TAU - (gap + 0.08) * 2);
    addTo('arena', tiers, R.x, ry - 0.3, R.z);
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * TAU, da = wrapAngle(a - Math.PI / 2);
      if (Math.abs(da) < gap + 0.02) continue;
      this.circle(R.x + Math.cos(a) * 31.2, R.z + Math.sin(a) * 31.2, 1.0);
    }
    // gate pylons at the south opening
    for (const sg of [-1, 1]) {
      const a = Math.PI / 2 + sg * (gap + 0.05), x = R.x + Math.cos(a) * 30.5, z = R.z + Math.sin(a) * 30.5;
      addTo('arena', new THREE.BoxGeometry(2.6, 13, 2.6), x, ry + 6.2, z);
      addTo('arena', new THREE.BoxGeometry(3.2, 0.8, 3.2), x, ry + 12.9, z);
      this.box(x, z, 1.35, 1.35);
    }
    addTo('arena', new THREE.BoxGeometry(24, 1.4, 2.8), R.x, ry + 13.9, R.z + 30.5);
    // throne on a dais
    const thz = R.z - 22;
    addTo('arena', new THREE.BoxGeometry(10, 1.2, 6), R.x, ry + 0.6, thz);
    addTo('arena', new THREE.BoxGeometry(5, 1.6, 3), R.x, ry + 2, thz - 0.8);
    addTo('arena', new THREE.BoxGeometry(5.4, 7, 1), R.x, ry + 4.5, thz - 2.4);
    addTo('arena', new THREE.BoxGeometry(1, 3, 3), R.x - 2.7, ry + 2.6, thz - 0.8);
    addTo('arena', new THREE.BoxGeometry(1, 3, 3), R.x + 2.7, ry + 2.6, thz - 0.8);
    this.box(R.x, thz - 0.5, 5, 3);
    this.footprints.push({ x: R.x, z: R.z, r: 44 });
    // banners
    const banMat = new THREE.MeshStandardMaterial({ map: Tex.capeRed, side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5 });
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 2 + Math.PI * 0.3 + (i / 7) * Math.PI * 1.4;
      const x = R.x + Math.cos(a) * 28.6, z = R.z + Math.sin(a) * 28.6;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 7.5, 1, 6), banMat);
      b.position.set(x, ry + 6.6, z);
      b.lookAt(R.x, ry + 6.6, R.z);
      b.castShadow = true;
      scene.add(b);
    }
    // fog gate
    const gate = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 11), new THREE.ShaderMaterial({
      uniforms: { uTime: G.uniforms.time, tNoise: { value: Tex.noise }, uOpacity: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform sampler2D tNoise; uniform float uOpacity; varying vec2 vUv;
        void main(){
          vec2 uv = vUv;
          float n = texture2D(tNoise, uv * vec2(0.8, 1.2) + vec2(uTime * 0.04, -uTime * 0.07)).r;
          float n2 = texture2D(tNoise, uv * vec2(1.6, 2.0) + vec2(-uTime * 0.06, uTime * 0.03) + n * 0.3).g;
          float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x) * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.85, uv.y);
          float wisps = smoothstep(0.35, 0.8, n * 0.6 + n2 * 0.6);
          float a = (0.2 + wisps * 0.8) * edge;
          // a dim, warm haze: additive over a sunlit sky, anything brighter blows out to a white wall
          vec3 c = mix(vec3(0.42, 0.27, 0.1), vec3(0.85, 0.58, 0.26), n2);
          gl_FragColor = vec4(c * a, a * uOpacity * 0.34);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    gate.position.set(R.x, ry + 5.5, R.z + 30.4);
    scene.add(gate);
    this.arena = { x: R.x, z: R.z, y: ry, r: 27, gate, gateCollider: this.box(R.x, R.z + 30.4, 3.4, 0.6), gateActive: true };
    this.sites.arena.gatePos = new THREE.Vector3(R.x, ry, R.z + 31.5);

    // ---------- scattered ruins along the road
    for (let i = 0; i < 26; i++) {
      const pi = Math.floor(rng() * (this.PATH.length - 1));
      const [ax2, az2] = this.PATH[pi], [bx, bz] = this.PATH[pi + 1];
      const t = rng(), side = rng() < 0.5 ? -1 : 1;
      const dx = bx - ax2, dz = bz - az2, l = Math.hypot(dx, dz);
      const x = lerp(ax2, bx, t) + (-dz / l) * side * (8 + rng() * 10), z = lerp(az2, bz, t) + (dx / l) * side * (8 + rng() * 10);
      let skip = false;
      for (const f of this.FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r + 4) skip = true;
      if (skip) continue;
      const y = this.terrainHeight(x, z);
      if (rng() < 0.55) {
        const h = 1.5 + rng() * 4.5;
        addTo('road', this.columnGeo(h, 0.5, { broken: 1, capital: false }, rng), x, y - 0.2, z, rng() * TAU);
        this.circle(x, z, 0.6);
      } else {
        addTo('road', this.columnGeo(1.6 + rng(), 0.5, { capital: false, base: false }, rng), x, y + 0.42, z, rng() * TAU, 0, Math.PI / 2);
        this.circle(x, z, 0.8);
      }
    }
    // ruined walls on the hillsides
    for (let i = 0; i < 10; i++) {
      const x = (rng() - 0.5) * 500, z = (rng() - 0.5) * 500;
      const y = this.terrainHeight(x, z);
      if (y < 3 || this.pathInfo(x, z).d < 10) continue;
      let skip = false;
      for (const f of this.FLAT) if (Math.hypot(x - f.x, z - f.z) < f.r + 8) skip = true;
      if (skip) continue;
      const rot = rng() * Math.PI, len = 6 + rng() * 10;
      for (let s = 0; s < len / 2; s++) {
        const hh = 0.6 + rng() * 2.6, lx = -len / 2 + s * 2 + 1;
        const [wx, wz] = local(x, z, rot, lx, 0);
        addTo('walls', new THREE.BoxGeometry(2.02, hh, 0.9), wx, this.terrainHeight(wx, wz) + hh / 2 - 0.3, wz, rot);
      }
      this.box(x, z, len / 2, 0.5, -rot);
    }

    // merge each site into one mesh
    for (const key in sites) {
      const merged = Addons.mergeGeometries(sites[key]);
      const mesh = new THREE.Mesh(merged, marble);
      mesh.castShadow = true; mesh.receiveShadow = true;
      scene.add(mesh);
    }

    // ---------- altars of Hestia (checkpoints)
    const altar = (id, name, x, z, y) => {
      y = y ?? this.terrainHeight(x, z);
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.0, 1.1), marble); base.position.y = 0.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.2, 1.4), marble); top.position.y = 1.1;
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2), Mat.bronze); bowl.position.y = 1.55; bowl.rotation.x = Math.PI;
      bowl.rotation.x = 0; bowl.scale.y = 0.6;
      [base, top, bowl].forEach((m) => { m.castShadow = true; m.receiveShadow = true; g.add(m); });
      g.position.set(x, y, z);
      scene.add(g);
      this.box(x, z, 0.85, 0.65);
      const a = { id, name, pos: new THREE.Vector3(x, y, z), flame: new THREE.Vector3(x, y + 1.55, z), lit: false, group: g };
      this.altars.push(a);
      this.fires.push({ pos: a.flame, scale: 0.7, gold: true, altar: a });
      return a;
    };
    altar('dawn', 'Altar of Dawn', S0.x + 7, S0.z - 26);
    altar('agora', 'Altar of the Agora', A.x + 12, A.z + 26);
    altar('ascent', 'Altar of the Ascent', this.sites.ascent.x, this.sites.ascent.z);

    // braziers
    const brazier = (x, z, y) => {
      y = y ?? this.terrainHeight(x, z);
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 6), Mat.bronze);
        leg.position.set(Math.cos(a) * 0.25, 0.62, Math.sin(a) * 0.25);
        leg.rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
        g.add(leg);
      }
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 8, 0, TAU, Math.PI / 2, Math.PI / 2), Mat.bronze);
      bowl.position.y = 1.38; bowl.scale.y = 0.55;
      g.add(bowl);
      g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      g.position.set(x, y, z);
      scene.add(g);
      this.circle(x, z, 0.45);
      this.fires.push({ pos: new THREE.Vector3(x, y + 1.42, z), scale: 0.75 });
    };
    brazier(S0.x - 6, S0.z - 25, t0.y0 + 0.2);
    brazier(S0.x + 6, S0.z - 9.6, t0.fy);
    brazier(S0.x - 6, S0.z - 9.6, t0.fy);
    brazier(A.x + 2, A.z + 8);
    brazier(A.x - 14, A.z + 20);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + Math.PI * 0.35 + (i / 5) * Math.PI * 1.3;
      brazier(R.x + Math.cos(a) * 24, R.z + Math.sin(a) * 24, ry);
    }
    brazier(R.x - 4, R.z + 34, this.terrainHeight(R.x - 4, R.z + 34));
    brazier(R.x + 4, R.z + 34, this.terrainHeight(R.x + 4, R.z + 34));

    // golden apples (flask upgrades) and echo messages
    this.apples.push({ id: 'apple_colossus', pos: new THREE.Vector3(C.x + 5, this.terrainHeight(C.x + 5, C.z - 6) + 0.6, C.z - 6) });
    this.apples.push({ id: 'apple_hill', pos: new THREE.Vector3(Hs.x, ht.fy + 0.6, Hs.z) });
    this.messages.push(
      { pos: new THREE.Vector3(2, 0, 208), text: 'Try rolling ▸ through the spear, not away from it.' },
      { pos: new THREE.Vector3(-14, 0, 122), text: 'Hoplites ahead. Therefore, patience.' },
      { pos: new THREE.Vector3(-44, 0, 66), text: 'Beware the one-eyed giant… and his stomp.' },
      { pos: new THREE.Vector3(C.x - 6, 0, C.z + 8), text: 'Behold, golden fruit near the fallen hero.' },
      { pos: new THREE.Vector3(-108, 0, -132), text: 'Rest at the altar ahead. Thunder answers patience.' },
      { pos: new THREE.Vector3(-127, 0, -205), text: 'Fire, O fire… when he lifts his blade to the sky, run.' },
    );
    this.messages.forEach((m) => { m.pos.y = this.terrainHeight(m.pos.x, m.pos.z); });
    this.phantomPaths = [
      [[0, 205], [4, 180], [-4, 150]], [[-30, 92], [-45, 70], [-52, 50]], [[-62, 0], [-74, -30], [-90, -75]],
      [[-104, -120], [-112, -150], [-118, -175]], [[50, 120], [62, 104], [70, 92]],
    ];
  },

  /* ------------------------------------------------------------ Golden Tree */
  buildGoldenTree(scene) {
    const rng = mulberry32(99);
    const P0 = new THREE.Vector3(430, 0, -840);
    // islet
    const isl = new THREE.CylinderGeometry(70, 150, 40, 48, 6);
    const ip = isl.attributes.position, n = new Simplex2(5);
    for (let i = 0; i < ip.count; i++) {
      const x = ip.getX(i), y = ip.getY(i), z = ip.getZ(i);
      const k = 1 + n.fbm(x * 0.02, z * 0.02 + y * 0.02, 3) * 0.25;
      ip.setXYZ(i, x * k, y + (y > 19 ? n.fbm(x * 0.03, z * 0.03, 3) * 6 : 0), z * k);
    }
    isl.computeVertexNormals();
    const islMat = farFog(triplanarMaterial({ map: Tex.rock.map, normal: Tex.rock.normal, scale: 0.05, color: 0xb59a70 }), 0.3);
    const islet = new THREE.Mesh(isl, islMat);
    islet.position.copy(P0).add(new THREE.Vector3(0, 0, 0));
    scene.add(islet);

    const geos = [], leafPts = [];
    const branch = (p0, dir, len, rad, depth) => {
      const pts = [p0.clone()];
      let p = p0.clone();
      const d = dir.clone();
      for (let s = 1; s <= 5; s++) {
        d.x += (rng() - 0.5) * 0.45; d.z += (rng() - 0.5) * 0.45; d.y += depth === 0 ? 0.08 : 0.12; d.normalize();
        p = p.clone().addScaledVector(d, len / 5);
        pts.push(p);
      }
      geos.push(taperedTube(pts, rad, rad * 0.5, depth < 2 ? 12 : 6, 3));
      if (depth >= 4) { leafPts.push(p); return; }
      const kids = depth === 0 ? 6 : 3;
      for (let k = 0; k < kids; k++) {
        const t = depth === 0 ? 0.55 + (k / kids) * 0.45 : 0.6 + rng() * 0.4;
        const q = pts[Math.min(pts.length - 1, Math.round(t * (pts.length - 1)))];
        const a = (k / kids) * TAU + rng();
        const nd = new THREE.Vector3(Math.cos(a), 0.45 + rng() * 0.5, Math.sin(a)).lerp(d, 0.25).normalize();
        branch(q, nd, len * (depth === 0 ? 0.55 : 0.62), rad * 0.48, depth + 1);
      }
      if (depth >= 2) leafPts.push(p);
    };
    branch(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, 1, 0), 150, 13, 0);
    for (let r = 0; r < 7; r++) {
      const a = (r / 7) * TAU + rng() * 0.3;
      const pts = [new THREE.Vector3(0, 25, 0), new THREE.Vector3(Math.cos(a) * 18, 4, Math.sin(a) * 18), new THREE.Vector3(Math.cos(a) * 42, -6, Math.sin(a) * 42)];
      geos.push(taperedTube(pts, 6, 1.5, 8, 4));
    }
    const barkMat = farFog(new THREE.MeshStandardMaterial({ color: 0xc8a060, map: Tex.bark.map, normalMap: Tex.bark.normal, roughness: 0.6, metalness: 0.3, emissive: 0x6a4410, emissiveIntensity: 0.6 }), 0.28);
    const trunk = new THREE.Mesh(Addons.mergeGeometries(geos.map(prep)), barkMat);
    trunk.position.copy(P0).add(new THREE.Vector3(0, 18, 0));
    scene.add(trunk);

    // its leaves: the photographed leaf clusters turned to glowing gold
    const leafMat = farFog(leafMaterial([1, 1, 1], { fallback: Tex.leafGold, map: Tex.leafAtlasGold, wind: 0, roughness: 0.6, emissive: 0xffb347, emissiveIntensity: 1.9 }), 0.28);
    const tiles = leafTiles(), per = 16, cards = [], apples = [];
    const crownC = leafPts.reduce((c, lp) => c.add(lp), new THREE.Vector3()).divideScalar(leafPts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const lp of leafPts) for (let i = 0; i < per; i++) {
      const p = lp.clone().add(new THREE.Vector3((rng() - 0.5) * 26, (rng() - 0.4) * 14, (rng() - 0.5) * 26));
      const out = Math.min(1, p.distanceTo(crownC) / 70);
      cards.push({ p, s: 9 + rng() * 9, rx: rng() * TAU, ry: rng() * TAU, rz: rng() * TAU, shade: 0.55 + 0.5 * out, tile: tiles ? Math.floor(rng() * tiles.cols * tiles.rows) : 0 });
      if (rng() < 0.08) apples.push(p.clone().add(trunk.position).add(new THREE.Vector3(0, -3, 0)));
    }
    const leaves = new THREE.Mesh(foliageCards(cards, () => crownC, tiles), leafMat);
    leaves.position.copy(trunk.position);
    scene.add(leaves);
    const appleMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 10, 8), farFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 2.6, 0.7) }), 0.25), apples.length);
    apples.forEach((ap, i) => appleMesh.setMatrixAt(i, m4.compose(ap, q.identity(), s.setScalar(1))));
    appleMesh.computeBoundingSphere();
    scene.add(appleMesh);
    this.goldenTree = { pos: P0.clone().add(new THREE.Vector3(0, 120, 0)), leaves };
  },

  /* ------------------------------------------------------------ Olympus */
  buildOlympus(scene) {
    const O = new THREE.Vector3(-420, 0, -2800);
    const geo = new THREE.PlaneGeometry(3400, 2600, 170, 130).rotateX(-Math.PI / 2);
    const P = geo.attributes.position, n = new Simplex2(77);
    const cols = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), z = P.getZ(i);
      const r = Math.hypot(x * 0.8, z);
      let h = 980 * Math.exp(-Math.pow(r / 520, 1.6));
      h += n.ridged(x * 0.0022, z * 0.0022, 6) * 320 * smooth(1700, 300, r);
      h += 260 * Math.exp(-Math.pow(Math.hypot(x + 700, z - 200) / 380, 2)) + 200 * Math.exp(-Math.pow(Math.hypot(x - 800, z - 300) / 420, 2));
      h -= 60;
      P.setY(i, h);
      const snow = smooth(480, 640, h + n.noise(x * 0.01, z * 0.01) * 70);
      const c = lerp(0.5, 2.1, snow);
      cols[i * 3] = c * 0.94; cols[i * 3 + 1] = c * 0.96; cols[i * 3 + 2] = c * 1.04;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mat = farFog(triplanarMaterial({ map: Tex.rock.map, normal: Tex.rock.normal, scale: 0.012, roughness: 0.9 }), 0.13);
    mat.vertexColors = true;
    const mtn = new THREE.Mesh(geo, mat);
    mtn.position.copy(O);
    scene.add(mtn);
    // temple of the gods on the summit, glowing
    const peakY = O.y + 920;
    const tg = new THREE.Group();
    const gold = farFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 1.0) }), 0.1);
    tg.add(new THREE.Mesh(new THREE.BoxGeometry(90, 10, 60), gold));
    for (let i = 0; i < 8; i++) for (const zz of [-26, 26]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 34, 8), gold); c.position.set(-40 + i * 11.4, 22, zz); tg.add(c); }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(96, 6, 64), gold); roof.position.y = 42; tg.add(roof);
    tg.position.set(O.x, peakY, O.z);
    scene.add(tg);
    // beam of light into the storm
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(14, 30, 2600, 24, 1, true), new THREE.ShaderMaterial({
      uniforms: { uTime: G.uniforms.time },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uTime; varying vec2 vUv; void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.3) * (0.55 + 0.1 * sin(uTime * 2.0 + vUv.y * 30.0)); gl_FragColor = vec4(vec3(2.0, 1.6, 0.9) * a, a * 0.5); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    }));
    beam.position.set(O.x, peakY + 1300, O.z);
    scene.add(beam);
    // storm crown
    // storm crown: stacked, flattened cloud discs spiralling around the summit
    const storm = new THREE.Group();
    this.stormMats = [];
    const discGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < 40; i++) {
      const m = new THREE.MeshBasicMaterial({ map: Tex.puff, color: new THREE.Color(0.34, 0.34, 0.4), transparent: true, depthWrite: false, fog: false, opacity: 0.75, side: THREE.DoubleSide });
      this.stormMats.push(m);
      const d = new THREE.Mesh(discGeo, m);
      const a = (i / 40) * TAU * 2.3, r = 120 + (i / 40) * 320;
      d.position.set(Math.cos(a) * r, 1080 + (i % 5) * 28 + rand(-20, 20), Math.sin(a) * r);
      d.rotation.y = rand(0, TAU);
      d.rotation.x = rand(-0.12, 0.12);
      d.scale.set(rand(380, 620), 1, rand(240, 420));
      storm.add(d);
    }
    storm.position.set(O.x, O.y, O.z);
    scene.add(storm);
    this.storm = storm;
    this.olympus = { pos: new THREE.Vector3(O.x, peakY, O.z), next: 3 };

    // distant islands on the horizon
    const isMat = farFog(new THREE.MeshStandardMaterial({ color: 0x6b6a58, roughness: 1 }), 0.5);
    const rnd = mulberry32(55);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * TAU, d = 1300 + rnd() * 1500;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - O.x, z - O.z) < 1500) continue;
      const g = new THREE.ConeGeometry(120 + rnd() * 260, 60 + rnd() * 220, 24, 6);
      const gp = g.attributes.position, nn = new Simplex2(200 + i);
      for (let v = 0; v < gp.count; v++) { const x2 = gp.getX(v), y2 = gp.getY(v), z2 = gp.getZ(v); const k = 1 + nn.fbm(x2 * 0.01, z2 * 0.01 + y2 * 0.01, 3) * 0.35; gp.setXYZ(v, x2 * k, y2, z2 * k); }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, isMat);
      m.position.set(x, 0, z);
      scene.add(m);
    }
  },

  /* ------------------------------------------------------------ lights */
  buildLights(scene) {
    this.firelights = [];
    // every point light is paid for on every lit pixel: fewer flickering fire lights on the lighter presets
    const n = G.settings.quality === 'high' || G.settings.quality === 'ultra' ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, 20, 2);
      scene.add(l);
      this.firelights.push(l);
    }
    this.lightTimer = 0;
  },

  /* ============================================================ update */
  update(dt, cam, playerPos) {
    const t = G.time;
    if ((this._cullT = (this._cullT || 0) - dt) <= 0) { this._cullT = 0.2; this.cullProps(cam); }
    if (this.grassU) {
      this.grassU.uCenter.value.set(cam.position.x, cam.position.z);
      if (playerPos) this.grassU.uPlayer.value.copy(playerPos);
    }
    if (this.waterHi.visible) this.waterHi.material.uniforms.time.value += dt * 0.5;
    else { this.waterLoN.offset.x += dt * 0.004; this.waterLoN.offset.y += dt * 0.002; }
    this.motes.material.uniforms.uC.value.copy(cam.position);
    // follow-the-player shadow frustum, snapped to texels to avoid shimmer
    const focus = playerPos || cam.position;
    const sun = this.sun, ext = 46, texel = (2 * ext) / sun.shadow.mapSize.x;
    const f = this._sf || (this._sf = { r: new THREE.Vector3(), u: new THREE.Vector3(), d: new THREE.Vector3() });
    f.d.copy(this.sunDir).negate();
    f.r.crossVectors(f.d, new THREE.Vector3(0, 1, 0)).normalize();
    f.u.crossVectors(f.r, f.d).normalize();
    const pr = Math.round(focus.dot(f.r) / texel) * texel, pu = Math.round(focus.dot(f.u) / texel) * texel, pd = focus.dot(f.d);
    sun.target.position.set(0, 0, 0).addScaledVector(f.r, pr).addScaledVector(f.u, pu).addScaledVector(f.d, pd);
    sun.position.copy(sun.target.position).addScaledVector(this.sunDir, 220);
    sun.target.updateMatrixWorld();
    // fires: particles near the camera, light pool on the nearest flames
    for (const fi of this.fires) {
      const d = fi.pos.distanceTo(cam.position);
      if (d > 70) continue;
      if (fi.altar && !fi.altar.lit) { if (Math.random() < 0.15) FX.flame(fi.pos, 0.25, [1.6, 1.0, 0.4, 0.5]); continue; }
      const n = d < 30 ? 2 : 1;
      for (let i = 0; i < n; i++) FX.flame(fi.pos, fi.scale, fi.gold ? [2.6, 1.7, 0.55, 0.85] : null);
      if (fi.gold && Math.random() < 0.3) {
        const a = rand(0, TAU), r = rand(0.5, 2.5);
        FX.glow.spawn({ x: fi.pos.x + Math.cos(a) * r, y: fi.pos.y - 1.4, z: fi.pos.z + Math.sin(a) * r, vy: rand(0.4, 1.2), life: 2.5, s: 0.07, s2: 0.01, c: [2.4, 1.8, 0.7, 1], c2: [2, 1.2, 0.4, 0] });
      }
    }
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.3;
      const near = this.fires.filter((fi) => !fi.altar || fi.altar.lit).map((fi) => [fi, fi.pos.distanceTo(cam.position)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
      this.firelights.forEach((l, i) => { l.userData.f = near[i] && near[i][1] < 60 ? near[i][0] : null; });
    }
    for (const l of this.firelights) {
      const fi = l.userData.f;
      if (!fi) { l.intensity = 0; continue; }
      l.position.copy(fi.pos).add(new THREE.Vector3(0, 0.4, 0));
      l.color.set(fi.gold ? 0xffc060 : 0xff8a30);
      l.intensity = (fi.gold ? 38 : 30) * (0.82 + 0.18 * Math.sin(t * 13 + l.id) * Math.sin(t * 7.3 + l.id * 2));
    }
    // Olympus storm lightning
    const O = this.olympus;
    O.next -= dt;
    this.storm.rotation.y += dt * 0.01;
    this._stormC = this._stormC || new THREE.Color(0.34, 0.34, 0.4);
    this.stormMats.forEach((m) => m.color.lerp(this._stormC, Math.min(1, dt * 6)));
    if (O.next <= 0) {
      O.next = rand(2.5, 7);
      const a = rand(0, TAU), r = rand(80, 300);
      const from = O.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, rand(200, 330), Math.sin(a) * r));
      const to = O.pos.clone().add(new THREE.Vector3(rand(-60, 60), rand(-40, 60), rand(-60, 60)));
      FX.bolt(from, to, { radius: 2.2, life: 0.4, branches: 5 });
      this.stormMats.forEach((m) => m.color.setRGB(1.8, 1.9, 2.4));
      if (cam.position.distanceTo(O.pos) < 5000) Sound.thunder(2400);
    }
  },

  setQuality(q) {
    this.setWaterQuality(q);
    this.buildGrass(this.scene);
    const size = { low: 1024, medium: 2048, high: 2048, ultra: 4096 }[q] || 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  },
};
