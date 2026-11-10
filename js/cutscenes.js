'use strict';
/* ==========================================================================
   cutscenes.js · in-engine cinematics and the story of Chapter I
   ========================================================================== */

const SKIP = { skip: true };

const Cutscene = {
  active: null,
  timers: [],
  tween: null,
  handheld: 0.6,

  async play(name) {
    const script = SCRIPTS[name];
    if (!script || this.active) return;
    this.active = { name, cancelled: false, hold: 0, advance: false };
    this.timers = [];
    Game.setState('cutscene');
    // (a cutscene in the middle of a fight keeps the mouse captured, so play goes straight on after)
    if (!script.keepLock) Input.unlock();
    // the story is staged on the ground: a cutscene that finds him flying sets him down first
    const P = G.player;
    if (!script.keepLock && P.flying) { P.flying = false; P.vy = 0; P.pos.y = World.getHeight(P.pos.x, P.pos.z, P.pos.y); P.visY = null; }
    UI.hide('hud'); UI.prompt(null); UI.hide('hint');
    UI.letterbox(true);
    G.player.state = 'locked';
    G.player.cine.speed = 0;
    let skipped = false;
    try { await script.run(this); } catch (e) { if (e !== SKIP) console.error(e); else skipped = true; }
    this.tween = null;
    this.lightsOff();
    Voice.stop();
    UI.subtitle(null); UI.card(null); UI.chapter(null); UI.skipProgress(null);
    this.active = null;
    this.timers = [];
    await script.finish(skipped);
  },

  update(dt) {
    const A = this.active;
    if (!A) return;
    for (const tm of this.timers.slice()) {
      tm.t -= dt;
      if (tm.t <= 0 || (tm.until && tm.until())) { this.timers.splice(this.timers.indexOf(tm), 1); tm.res(); }
    }
    if (Input.down('Enter') || Input.down('Escape')) {
      A.hold += dt;
      UI.skipProgress(Math.min(1, A.hold / 0.9));
      if (A.hold >= 0.9 && !A.cancelled) this.skip();
    } else {
      A.hold = Math.max(0, A.hold - dt * 3);
      UI.skipProgress(A.hold / 0.9);
    }
    if (Input.pressed('Space') || Input.clicked(0)) A.advance = true;
    // camera tween
    const T = this.tween, cam = G.camera;
    if (T) {
      T.t = Math.min(1, T.t + dt / T.dur);
      const k = T.ease(T.t);
      cam.position.lerpVectors(T.p0, T.p1, k);
      T.look.lerpVectors(T.l0, T.l1, k);
      if (T.f1) { cam.fov = lerp(T.f0, T.f1, k); cam.updateProjectionMatrix(); }
      if (T.t >= 1) { this.tween = null; this.lastLook = T.look.clone(); }
    }
    const look = T ? T.look : this.lastLook;
    if (look) {
      const sh = G.cam.shakeAmt * 0.25;
      G.cam.shakeAmt = Math.max(0, G.cam.shakeAmt - dt * 2.4);
      const h = this.handheld * 0.03 + sh, t = G.time * (sh > 0 ? 30 : 1);
      cam.lookAt(look.x + Math.sin(t * 0.7) * h, look.y + Math.sin(t * 0.9 + 1) * h, look.z + Math.cos(t * 0.6) * h);
      this.light(look, dt);
    }
  },

  /**
   * Film lighting for close shots, as a cinematographer would light them: a soft key from about 45°
   * off the lens and above whoever the camera is looking at, and a cool rim from behind them. Both are
   * short-ranged, so they model the subject (brow, cheekbones, nose, jaw) without lighting the set; they
   * fade out as the shot widens. The pair lives in every story scene (made in Game.warm) so turning
   * them up never recompiles a shader.
   */
  filmLights(scene) {
    if (!scene.userData.film) {
      // how hard each stage is lit: the golden hall takes the full rig; daylight, the kitchen and the
      // night scenes only a touch, or the key would look like a lamp on a film set
      scene.userData.filmK = scene === Prologue.olympus || scene === Prologue.tartarus ? 1 : scene === Campus.scene ? 0.4
        : scene === Memory.scene ? 0.35 : scene === Home.scene || scene === School.scene ? 0.6 : 0.85;
      // (no rim under an open overcast sky: it would only flare in the school's glass)
      scene.userData.filmRim = scene === Campus.scene ? 0 : 1;
      const key = new THREE.SpotLight(0xfff1e0, 0, 6.5, 0.42, 0.85, 2), rim = new THREE.SpotLight(0xdce6ff, 0, 6.5, 0.42, 0.85, 2);
      scene.add(key, key.target, rim, rim.target);
      scene.userData.film = { key, rim };
    }
    return scene.userData.film;
  },
  light(look, dt) {
    const F = this.filmLights(G.activeScene), cam = G.camera;
    const fwd = this._f || (this._f = new THREE.Vector3()), right = this._r || (this._r = new THREE.Vector3()), up = this._u || (this._u = new THREE.Vector3(0, 1, 0));
    fwd.copy(look).sub(cam.position);
    const d = fwd.length();
    fwd.divideScalar(d || 1);
    right.crossVectors(fwd, up).normalize();
    // close-ups get the full rig, a medium shot some, a wide shot none; scenes set their own strength
    const k = smooth(8, 3.5, d) * (G.activeScene.userData.filmK ?? 1);
    F.key.position.copy(look).addScaledVector(fwd, -0.95).addScaledVector(right, 1.05).addScaledVector(up, 0.75);
    F.rim.position.copy(look).addScaledVector(fwd, 1.2).addScaledVector(right, -0.8).addScaledVector(up, 0.6);
    F.key.target.position.copy(look); F.rim.target.position.copy(look);
    F.key.intensity = damp(F.key.intensity, 7 * k, 6, dt);
    F.rim.intensity = damp(F.rim.intensity, 3.5 * k * (G.activeScene.userData.filmRim ?? 1), 6, dt);
  },
  lightsOff() {
    for (const s of [G.scene, School.scene, Prologue.olympus, Prologue.tartarus, Home.scene, Memory.scene, Campus.scene]) if (s && s.userData.film) { s.userData.film.key.intensity = 0; s.userData.film.rim.intensity = 0; }
  },
  skip() {
    const A = this.active;
    A.cancelled = true;
    const ts = this.timers; this.timers = [];
    ts.forEach((tm) => tm.rej(SKIP));
  },
  check() { if (!this.active || this.active.cancelled) throw SKIP; },
  wait(sec, until) {
    return new Promise((res, rej) => {
      if (!this.active || this.active.cancelled) { rej(SKIP); return; }
      this.timers.push({ t: sec, res, rej, until });
    });
  },
  async say(who, text, dur) {
    this.check();
    UI.subtitle(who, text);
    Voice.speak(text, who);
    this.active.advance = false;
    // recorded lines hold the subtitle for the clip's length; otherwise estimate from the text
    const clip = Voice.duration(text, who);
    const d = clip ? Math.max(dur || 0, clip + 0.45) : dur ?? clamp(text.length * 0.068 + 1.3, 2.6, 9);
    await this.wait(d, () => this.active && this.active.advance);
    UI.subtitle(null);
    await this.wait(0.25);
  },
  shot(pos, look, fov) {
    this.tween = null;
    G.camera.position.copy(pos);
    this.lastLook = look.clone();
    G.camera.lookAt(look);
    if (fov) { G.camera.fov = fov; G.camera.updateProjectionMatrix(); }
  },
  move(pos, look, dur, { fov, ease = easeInOutCubic } = {}) {
    const cam = G.camera;
    const l0 = (this.tween ? this.tween.look : this.lastLook || look).clone();
    this.tween = { p0: cam.position.clone(), p1: pos.clone(), l0, l1: look.clone(), look: l0.clone(), t: 0, dur, ease, f0: cam.fov, f1: fov };
  },
};

/* ---------------------------------------------------------------- school rooftop */
const School = {
  built: false,
  build() {
    if (this.built) return;
    this.built = true;
    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color(0x0a0e16);
    s.fog = new THREE.FogExp2(0x101622, 0.009);
    this.hemi = new THREE.HemisphereLight(0x5a6c95, 0x2a1d22, 0.7);
    s.add(this.hemi);
    const moon = new THREE.DirectionalLight(0x9db3e6, 0.9);
    moon.position.set(-30, 40, 20); moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    Object.assign(moon.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 120 });
    s.add(moon);
    this.lamp = new THREE.PointLight(0xffc27a, 14, 16, 2);
    this.lamp.position.set(-8, 3.1, 7.4);
    this.lamp.castShadow = true;
    s.add(this.lamp);

    const concrete = triplanarMaterial({ map: Tex.rock.map, normal: Tex.rock.normal, scale: 0.4, color: 0x8a8a8c, roughness: 0.9 });
    const wet = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.12, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x6c7076, roughness: 0.45, metalness: 0.8 });
    const brick = triplanarMaterial({ map: Tex.pavers.map, normal: Tex.pavers.normal, scale: 0.35, color: 0x8a4a3a, roughness: 0.9 });
    const add = (g, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; s.add(o); return o; };

    // roof slab, parapets, the building below
    add(new THREE.BoxGeometry(32, 0.6, 24), concrete, 0, -0.3, 0);
    add(new THREE.BoxGeometry(32, 0.9, 0.5), concrete, 0, 0.45, -11.75);
    add(new THREE.BoxGeometry(32, 0.9, 0.5), concrete, 0, 0.45, 11.75);
    add(new THREE.BoxGeometry(0.5, 0.9, 24), concrete, -15.75, 0.45, 0);
    add(new THREE.BoxGeometry(0.5, 0.9, 24), concrete, 15.75, 0.45, 0);
    const win = Tex.windows(); win.repeat.set(4, 2);
    const bldg = new THREE.MeshStandardMaterial({ color: 0x40302a, map: Tex.pavers.map, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.9, roughness: 0.9 });
    add(new THREE.BoxGeometry(32, 22, 24), bldg, 0, -11.6, 0);
    for (let i = 0; i < 4; i++) add(new THREE.CircleGeometry(0.8 + i * 0.3, 18).rotateX(-Math.PI / 2), wet, -4 + i * 3.5, 0.01, 2 - i * 1.4);
    // stairwell hut with a door lamp
    add(new THREE.BoxGeometry(5, 3.4, 4), brick, -8, 1.7, 9.4);
    add(new THREE.BoxGeometry(1.3, 2.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.5, metalness: 0.6 }), -8, 1.15, 7.36);
    add(new THREE.BoxGeometry(0.4, 0.15, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.8) }), -8, 2.75, 7.3);
    // AC units, vents, a satellite dish
    for (const [x, z] of [[6, 6], [10, 6], [8, -3]]) {
      add(new THREE.BoxGeometry(2.6, 1.5, 1.8), metal, x, 0.75, z);
      add(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 20), new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6, metalness: 0.7 }), x, 1.52, z);
    }
    add(new THREE.CylinderGeometry(0.25, 0.25, 2, 10), metal, 12, 1, -8);
    const dish = add(new THREE.SphereGeometry(0.9, 18, 8, 0, TAU, 0, Math.PI / 3), metal, -12, 1.6, -6);
    dish.rotation.x = -0.9;
    // glowing school sign on the street side (south edge)
    const signTex = Tex.text('WESTBROOK HIGH', { w: 1024, h: 160, font: 'bold 92px Georgia, serif', color: '#ffe9c4', glow: '#ff9a3c' });
    const sign = add(new THREE.PlaneGeometry(14, 2.2), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, color: new THREE.Color(1.6, 1.4, 1.2) }), 0, 2.5, 12.25);
    sign.castShadow = false;
    add(new THREE.BoxGeometry(14.6, 0.15, 0.15), metal, 0, 1.3, 12.15);
    for (const x of [-6.8, 6.8]) add(new THREE.BoxGeometry(0.15, 2.5, 0.15), metal, x, 1.25, 12.15);
    this.signLight = new THREE.PointLight(0xffb070, 10, 14, 2);
    this.signLight.position.set(0, 2.5, 13.5);
    s.add(this.signLight);
    // cool key from the city side so faces read in the rain, warm rim from the stairwell
    const fill = new THREE.PointLight(0xa8c0ff, 9, 14, 2);
    fill.position.set(2.5, 2.8, -11.2);
    s.add(fill);
    const rim = new THREE.PointLight(0xffc890, 6, 10, 2);
    rim.position.set(-1, 2.6, -6.1);
    s.add(rim);

    // the city: far enough off to sit in the rain's haze, most of its windows dark at this hour
    const cityWin = Tex.windows(256, 0.2); cityWin.repeat.set(3, 6);
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x15171c, emissive: 0xffffff, emissiveMap: cityWin, emissiveIntensity: 0.9, roughness: 0.8 }), 260);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const rnd = mulberry32(12);
    for (let i = 0; i < 260; i++) {
      const a = rnd() * TAU, d = 125 + rnd() * 380;
      const w = 12 + rnd() * 26, h = 20 + rnd() * rnd() * 130;
      p.set(Math.cos(a) * d, -22 + h / 2, Math.sin(a) * d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.4);
      sc.set(w, h, 12 + rnd() * 22);
      city.setMatrixAt(i, m4.compose(p, q, sc));
    }
    s.add(city);
    add(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.3 }), 0, -22, 0);
    // storm clouds
    this.cloudU = { tNoise: { value: Tex.noise }, uTime: G.uniforms.time, uFlash: { value: 0 } };
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.cloudU,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D tNoise; uniform float uTime; uniform float uFlash; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz * 0.0006 + vec2(uTime * 0.004, uTime * 0.002);
          float n = texture2D(tNoise, uv).r * 0.6 + texture2D(tNoise, uv * 3.1).g * 0.4;
          float d = length(vW.xz - cameraPosition.xz);
          vec3 c = mix(vec3(0.04, 0.05, 0.08), vec3(0.16, 0.17, 0.22), n) + vec3(0.6, 0.65, 0.9) * uFlash * n;
          c = mix(c, vec3(0.06, 0.07, 0.11), smoothstep(400.0, 1800.0, d));
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.DoubleSide, fog: false,
    }));
    clouds.position.y = 160;
    s.add(clouds);
    // rain
    const N = 3200;
    this.rainPos = new Float32Array(N * 6);
    this.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { this.rainSeed[i * 3] = rand(-22, 22); this.rainSeed[i * 3 + 1] = rand(-3, 26); this.rainSeed[i * 3 + 2] = rand(-22, 22); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb3d6, transparent: true, opacity: 0.38 }));
    this.rain.frustumCulled = false;
    s.add(this.rain);
    this.freeze = false;

    // characters
    const a = buildAriel({ casual: true });
    a.model = Models.attach(a.rig, 'arielTeen');
    if (a.model) Models.curlFingers(a.model, 26, 10);
    this.ariel = a; s.add(a.root);
    // seated on a concrete bench just inside the parapet, feet on the roof, looking out over the city;
    // the bench is built to the height of his posed thighs, so he sits on it and not in it,
    // and his knees and toes stay clear of the parapet
    a.root.position.set(1.5, 0, -9.38);
    a.root.rotation.y = Math.PI;
    a.rig.play('sit', { fade: 0.01 });
    for (let i = 0; i < 4; i++) a.rig.update(0.1, 0, 1);
    let seat = 0.46, hipZ = -10.85;
    if (a.model) {
      a.model.update();
      a.root.updateMatrixWorld(true);
      // soles flat on the roof
      const feet = Models.posedPoints(a.model, /Foot|Toe/).map((p) => p.y).sort((x, y) => x - y);
      if (feet.length) { a.root.position.y -= feet[Math.floor(feet.length * 0.01)]; this.arielY = a.root.position.y; a.model.update(); a.root.updateMatrixWorld(true); }
      // the shoe-sole vertices (lowest few of each foot), used to keep him grounded as he moves
      this.footVerts = [];
      a.model.holder.traverse((m) => {
        if (!m.isSkinnedMesh || !m.visible) return;
        const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, n = m.geometry.attributes.position.count, idx = [];
        const pv = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          let bi = 0, bw = -1;
          for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
          if (!/Foot|Toe/.test(m.skeleton.bones[bi].name)) continue;
          m.getVertexPosition(i, pv); pv.applyMatrix4(m.matrixWorld);
          if (pv.y < 0.04) idx.push(i);
        }
        if (idx.length) this.footVerts.push([m, idx]);
      });
      hipZ = a.rig.j.hips.getWorldPosition(new THREE.Vector3()).z;
      const under = Models.posedPoints(a.model, /UpLeg|Hips/).filter((p) => Math.abs(p.x - 1.5) < 0.28 && p.z > hipZ - 0.12 && p.z < hipZ + 0.3).map((p) => p.y).sort((x, y) => x - y);
      if (under.length) seat = under[Math.floor(under.length * 0.02)] - 0.005;
    }
    this.seatTop = seat;
    add(new THREE.BoxGeometry(1.7, seat - 0.06, 0.42), concrete, 1.5, (seat - 0.06) / 2, hipZ + 0.1);
    add(new THREE.BoxGeometry(1.8, 0.06, 0.48), new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.55, metalness: 0.05 }), 1.5, seat - 0.03, hipZ + 0.1);
    const h = buildHermes();
    this.hermes = h; s.add(h.root);
    h.root.visible = false;
    const halo = new THREE.PointLight(0xffd690, 6, 7, 2);
    halo.position.set(0, 1.4, 0.9);
    h.root.add(halo);
    h.rig.play('talk', { fade: 0.01 });
    this.camera = G.camera;
  },
  update(dt) {
    const P = this.rainPos, S = this.rainSeed, N = S.length / 3;
    if (!this.freeze) for (let i = 0; i < N; i++) { S[i * 3 + 1] -= 22 * dt; if (S[i * 3 + 1] < -3) S[i * 3 + 1] += 29; }
    for (let i = 0; i < N; i++) {
      const x = S[i * 3], y = S[i * 3 + 1], z = S[i * 3 + 2];
      P[i * 6] = x; P[i * 6 + 1] = y; P[i * 6 + 2] = z;
      P[i * 6 + 3] = x + 0.08; P[i * 6 + 4] = y - (this.freeze ? 0.25 : 0.7); P[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.cloudU.uFlash.value = Math.max(0, this.cloudU.uFlash.value - dt * 3);
    this.hemi.intensity = 0.7 + this.cloudU.uFlash.value * 2.5;
    // rising from the bench: the body travels forward over the planted feet, clear of the seat
    const rise = this.rise;
    if (rise) {
      const t = this.ariel.rig.progress('standFromSit');
      const u = easeInOut(clamp((t - 0.15) / 0.65, 0, 1));
      this.ariel.root.position.x = lerp(rise.from.x, rise.to.x, u);
      this.ariel.root.position.z = lerp(rise.from.z, rise.to.z, u);
      if (t >= 1) this.rise = null;
    }
    this.ariel.rig.update(dt, this.arielSpeed || 0, 1);
    // feet stay on the roof through every pose: while he moves, the lowest point of either shoe is kept at roof level
    if (this.footVerts && (this.rise || this.ariel.rig.playing('standFromSit'))) {
      const r = this.ariel.root;
      r.updateMatrixWorld(true);
      this.ariel.model.update();
      let low = Infinity;
      const v = this._av || (this._av = new THREE.Vector3());
      for (const [m, idx] of this.footVerts) {
        m.skeleton.update();
        for (const i of idx) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (v.y < low) low = v.y; }
      }
      if (low < Infinity) r.position.y -= low;
    }
    if (this.ariel.model) this.ariel.model.update();
    if (this.hermes.root.visible) {
      this.hermes.rig.update(dt, 0, 1);
      if (this.hermes.model) this.hermes.model.update();
      this.hermes.root.position.y = this.hermesY + Math.sin(G.time * 1.6) * 0.08;
      if (Math.random() < 0.6) {
        const hp = this.hermes.root.position;
        FX.glow.spawn({ x: hp.x + rand(-0.4, 0.4), y: hp.y - 0.2 + rand(0, 0.3), z: hp.z + rand(-0.4, 0.4), vy: rand(0.2, 0.8), life: 1.6, s: 0.06, s2: 0.01, c: [2.4, 1.9, 0.9, 1], c2: [2, 1.4, 0.5, 0] });
      }
    }
    this.lamp.intensity = 14 * (Math.random() < 0.03 ? 0.3 : 1);
  },
  /** Ariel gets up off the bench: he ends up standing where his feet were */
  standUp() {
    const a = this.ariel, from = a.root.position.clone(), to = from.clone();
    if (a.model) {
      a.root.updateMatrixWorld(true);
      const feet = Models.posedPoints(a.model, /Foot|Toe/);
      if (feet.length) {
        const c = feet.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / feet.length);
        // standing, the foot centre sits a few centimetres in front of the hips
        const fwd = new THREE.Vector3(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
        to.set(c.x, from.y, c.z).addScaledVector(fwd, -0.05);
      }
    }
    this.rise = { from, to };
    a.rig.play('standFromSit', { fade: 0.2 });
  },
  strike(far = true) {
    const from = far ? new THREE.Vector3(rand(-200, 200), 150, rand(-400, -250)) : null;
    if (far) {
      const to = from.clone().add(new THREE.Vector3(rand(-40, 40), -170, rand(-20, 20)));
      FX.bolt(from, to, { radius: 0.9, branches: 4, life: 0.35 });
      Sound.thunder(rand(500, 1500));
    }
    this.cloudU.uFlash.value = far ? 0.8 : 1.6;
    UI.flash(far ? 0.12 : 0.6);
  },
};

/* ---------------------------------------------------------------- prologue: the fall of Olympus
   Two small stages for the opening narration: the hall of the gods floating above
   a sea of clouds, and the pit of Tartarus where Kronos waits in chains. */
const Prologue = {
  built: false,
  build() {
    if (this.built) return;
    this.built = true;
    this.chainMat = new THREE.MeshStandardMaterial({ color: 0x2b2724, metalness: 0.9, roughness: 0.42, emissive: 0x1a0626 });
    this.linkGeo = new THREE.TorusGeometry(0.15, 0.042, 6, 14).rotateY(Math.PI / 2).scale(1, 1, 1.45);
    this.buildOlympus();
    this.buildTartarus();
    // (Game.warm prepares both stages' shaders during loading)
  },

  /** a model-wearing character for the prologue */
  actor(scene, key, { stance = 'casual', size = 1.1, x = 0, y = 0, z = 0, face = 0, spark = null } = {}) {
    const b = buildShell({ stance, size, mat: Mat.chiton });
    b.model = Models.attach(b.rig, key, { ownMaterials: key === 'zeus' });
    b.root.position.set(x, y, z);
    b.root.rotation.y = face;
    b.size = size;
    scene.add(b.root);
    if (spark) {
      b.spark = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(...spark), fog: false }));
      b.sparkCol = spark;
      scene.add(b.spark);
    }
    b.speed = 0;
    b.update = (dt) => { b.rig.update(dt, b.speed, 1); if (b.model) b.model.update(); if (b.cape) b.cape.update(dt); };
    return b;
  },

  /** build the throne around Zeus as he actually sits: feet on the dais, seat under his thighs, his forearms laid along the armrests */
  fitThrone(s, Z, top, marble, gold) {
    const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; s.add(o); return o; };
    for (let i = 0; i < 4; i++) Z.update(0.25);
    if (!Z.model) return;
    const pts = (re) => Models.posedPoints(Z.model, re);
    const lo = (a, k = 'y') => a.reduce((m, p) => Math.min(m, p[k]), Infinity), hi = (a, k = 'y') => a.reduce((m, p) => Math.max(m, p[k]), -Infinity);
    const pct = (a, k, q) => { const v = a.map((p) => p[k]).sort((x, y) => x - y); return v[Math.floor(q * (v.length - 1))]; };
    const J = Z.rig.j, wpos = (o) => o.getWorldPosition(new THREE.Vector3());
    // feet flat on the dais
    Z.root.position.y += top - lo(pts(/Ankle|Toe/));
    Z.update(0.016);
    // relaxed hands, fingers loosely curled on the stone
    Models.curlFingers(Z.model, 18, 8);
    // the seat: under the backs of his thighs, ending just behind the knees
    const hipsZ = wpos(J.hips).z, s0 = Z.size;
    const rear = pts(/UpperLeg|Pelvis/).filter((p) => p.z < hipsZ + 0.3 * s0);
    const seatTop = pct(rear, 'y', 0.05), seatBack = lo(pts(/Back/), 'z') - 0.05;
    const seatFront = Math.min(wpos(J.kneeL).z, wpos(J.kneeR).z) - 0.1 * s0;
    const zc = (seatBack + seatFront) / 2, depth = seatFront - seatBack;
    const thighHalf = Math.max(hi(rear, 'x'), -lo(rear, 'x'));
    const inner = thighHalf + 0.04;
    add(new THREE.BoxGeometry(inner * 2, seatTop - top, depth), marble, 0, (seatTop + top) / 2, zc);
    add(new THREE.BoxGeometry(inner * 2, 0.07, depth + 0.04), gold, 0, seatTop - 0.035, zc);
    // the arms of the throne, one per side, fitted under the forearm and hand: its top just touches their
    // undersides, it is as wide as the forearm (never reaching in over the thighs) and runs on past the
    // fingertips, so the whole hand lies on it
    for (const S of ['L', 'R']) {
      const side = S === 'L' ? 'Left' : 'Right';
      const fore = pts(new RegExp(`JO${side}LowerArm`)), hand = pts(new RegExp(`JO${side}Hand|JO${side}.*(Index|Middle|Ring|Pinky|Thumb)`));
      if (!fore.length) continue;
      const sg = S === 'L' ? 1 : -1, ax = fore.concat(hand).map((p) => ({ a: p.x * sg }));
      const armTop = Math.min(pct(fore, 'y', 0.02), hand.length ? pct(hand, 'y', 0.02) : Infinity) - 0.004;
      const x0 = Math.max(inner, pct(ax, 'a', 0.04) - 0.05), x1 = pct(ax, 'a', 0.96) + 0.08;
      const z0 = seatBack - 0.2, z1 = (hand.length ? hi(hand, 'z') : wpos(J['hand' + S]).z) + 0.07;
      const h = armTop - 0.08 - top, x = sg * (x0 + x1) / 2;
      add(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), marble, x, top + h / 2, (z0 + z1) / 2);
      add(new THREE.BoxGeometry(x1 - x0 + 0.06, 0.08, z1 - z0 + 0.06), gold, x, armTop - 0.04, (z0 + z1) / 2);
    }
    // high back, crowned in gold, with a thunderbolt above his head
    const headTop = hi(pts(/Head|Neck/)), backW = inner * 2 + 1.3, backH = headTop + 1.7 - top;
    add(new THREE.BoxGeometry(backW, backH, 0.55), marble, 0, top + backH / 2, seatBack - 0.3);
    add(new THREE.BoxGeometry(backW + 0.3, 0.3, 0.8), gold, 0, top + backH, seatBack - 0.3);
    const bolt = new THREE.Shape();
    bolt.moveTo(0.2, 1.6); bolt.lineTo(-0.45, 0.05); bolt.lineTo(0.0, 0.05); bolt.lineTo(-0.3, -1.6); bolt.lineTo(0.5, 0.25); bolt.lineTo(0.05, 0.25); bolt.lineTo(0.45, 1.6);
    add(new THREE.ExtrudeGeometry(bolt, { depth: 0.06, bevelEnabled: false }), gold, 0, headTop + 0.85, seatBack - 0.03).scale.setScalar(0.42);
  },
  /** glowing eye slits behind Kronos' visor */
  eyes(a) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
    for (const sx of [0.032, -0.032]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat);
      e.scale.set(1.8, 0.7, 0.6);
      e.position.set(sx, 0.085, 0.115);
      a.rig.j.head.add(e);
    }
    a.eyeMat = mat;
    a.setEyes = (k) => mat.color.setRGB(7 * k, 1.4 * k, 0.35 * k);
    a.setEyes(0.25);
  },
  head(a) { a.root.updateMatrixWorld(true); return a.rig.j.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1 * a.size, 0)); },
  hand(a, side = 'R') { a.root.updateMatrixWorld(true); return a.rig.j['hand' + side].getWorldPosition(new THREE.Vector3()); },

  buildOlympus() {
    const s = (this.olympus = new THREE.Scene());
    s.fog = new THREE.Fog(0xe8cfa2, 160, 950);
    s.environment = G.scene.environment;
    this.warm = { fog: new THREE.Color(0xe8cfa2), sky: new THREE.Color(0xfff0d2), ground: new THREE.Color(0x7a6448), sun: new THREE.Color(0xffdcae) };
    this.dark = { fog: new THREE.Color(0x1c0d26), sky: new THREE.Color(0x4c2c70), ground: new THREE.Color(0x100612), sun: new THREE.Color(0x8a5cff) };
    const sunDir = new THREE.Vector3(-0.78, 0.32, 0.36).normalize();
    // sky dome and the sea of clouds Olympus floats on
    this.skyU = { uRot: { value: 0 }, uSun: { value: sunDir } };
    s.add(new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uRot; uniform vec3 uSun; varying vec3 vD;
        void main(){
          float h = vD.y;
          vec3 c = mix(vec3(0.95, 0.74, 0.5), vec3(0.16, 0.3, 0.6), smoothstep(-0.02, 0.32, h));
          float sun = max(dot(vD, uSun), 0.0);
          c += vec3(1.6, 1.1, 0.6) * pow(sun, 90.0) * 3.0 + vec3(0.7, 0.45, 0.2) * pow(sun, 7.0) * 0.6;
          vec3 r = mix(vec3(0.2, 0.06, 0.26), vec3(0.03, 0.01, 0.05), smoothstep(-0.04, 0.5, h));
          gl_FragColor = vec4(mix(c, r, uRot), 1.0);
        }`,
    })));
    this.cloudU = { tNoise: { value: Tex.noise }, uTime: G.uniforms.time, uRot: { value: 0 }, uFlash: { value: 0 } };
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.cloudU, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D tNoise; uniform float uTime, uRot, uFlash; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz * 0.0009 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = texture2D(tNoise, uv).r * 0.55 + texture2D(tNoise, uv * 2.7 + 0.3).g * 0.3 + texture2D(tNoise, uv * 7.1 + 0.6).r * 0.15;
          vec3 c = mix(vec3(0.72, 0.6, 0.47), vec3(1.3, 1.12, 0.9), smoothstep(0.3, 0.78, n));
          float d = length(vW.xz - cameraPosition.xz);
          c = mix(c, vec3(0.95, 0.74, 0.5), smoothstep(400.0, 2600.0, d));
          vec3 r = mix(vec3(0.05, 0.02, 0.07), vec3(0.26, 0.09, 0.34), smoothstep(0.35, 0.8, n));
          r = mix(r, vec3(0.2, 0.06, 0.26), smoothstep(400.0, 2600.0, d));
          // lightning lights the cloud tops from inside, strongest where it struck
          float strike = exp(-length(vW.xz - vec2(46.0, 74.0)) * 0.006);
          gl_FragColor = vec4(mix(c, r, uRot) + vec3(0.7, 0.85, 1.4) * uFlash * n * (0.25 + strike * 1.5), 1.0);
        }`,
    }));
    clouds.position.y = -75;
    s.add(clouds);
    // light
    this.hemi = new THREE.HemisphereLight(0xfff0d2, 0x7a6448, 0.6);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffdcae, 2.1);
    this.sun.position.copy(sunDir).multiplyScalar(70);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    Object.assign(this.sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 180 });
    s.add(this.sun);
    this.rotLight = new THREE.PointLight(0x9a3cff, 0, 34, 1.5);
    s.add(this.rotLight);
    // Zeus' last light, when he rises against the dark
    this.zeusLight = new THREE.PointLight(0xffd890, 0, 16, 1.6);
    this.zeusLight.position.set(0, 5.5, -10.5);
    s.add(this.zeusLight);

    // Olympus before the fall: polished marble, not the weathered stone of Elysia's ruins
    const marble = triplanarMaterial({ map: Tex.marble.map, normal: Tex.marble.normal, rough: Tex.marble.rough, scale: 0.22, color: 0xd2c8b6, roughness: 0.75, envMapIntensity: 0.55, normalStrength: 0.6 }), gold = Mat.gold;
    const add = (g, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = o.receiveShadow = true; s.add(o); return o; };
    // the summit: a marble floor on a crag that tapers down into the clouds
    add(new THREE.CylinderGeometry(25, 25.6, 1.6, 72), marble, 0, -0.8, 0);
    add(new THREE.CylinderGeometry(26.6, 27.2, 0.7, 72), marble, 0, -1.9, 0);
    // a broken spire of rock: big lobes, then ledges and gullies at a smaller scale
    const crag = new THREE.ConeGeometry(31, 74, 120, 36).rotateX(Math.PI);
    const cp = crag.attributes.position, nz = new Simplex2(9), v = new THREE.Vector3();
    for (let i = 0; i < cp.count; i++) {
      v.fromBufferAttribute(cp, i);
      const a = Math.atan2(v.z, v.x);
      const k = 1 + nz.fbm(a * 2.2, v.y * 0.06, 4) * 0.4 + nz.fbm(a * 9 + 3, v.y * 0.22, 3) * 0.14 + Math.abs(nz.noise(a * 21, v.y * 0.5)) * 0.06;
      cp.setXYZ(i, v.x * k, v.y + nz.noise(a * 5, v.y * 0.1) * 1.5, v.z * k);
    }
    crag.computeVertexNormals();
    add(crag, World.rockMat, 0, -39.2, 0);
    for (const [r0, r1] of [[7.6, 7.95], [15.6, 15.9]]) add(new THREE.RingGeometry(r0, r1, 96).rotateX(-Math.PI / 2), gold, 0, 0.012, 0).castShadow = false;
    // colonnade, open to the front, with a ring of entablature
    const rng = mulberry32(77), cols = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      if (Math.abs(wrapAngle(a - Math.PI / 2)) < 0.32) continue;
      cols.push(World.columnGeo(14, 0.85, { flutes: 20 }, rng).translate(Math.cos(a) * 21.5, 0, Math.sin(a) * 21.5));
    }
    add(Addons.mergeGeometries(cols), marble, 0, 0, 0);
    const ent = [new THREE.Vector2(20.2, 0), new THREE.Vector2(22.8, 0), new THREE.Vector2(22.8, 1.5), new THREE.Vector2(22.4, 1.5), new THREE.Vector2(22.4, 2.1), new THREE.Vector2(20.2, 2.1)];
    add(new THREE.LatheGeometry(ent, 96, 0.36, TAU - 0.72), marble, 0, 14, 0);
    // the throne of Zeus on its dais
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(14 - i * 2.4, 0.42, 9 - i * 1.6), marble, 0, 0.21 + i * 0.42, -14 - i * 0.6);
    const top = 1.26;
    this.throneTop = top;
    // braziers
    this.fires = [];
    // only the braziers by the throne carry a real light (each light is paid for on every pixel)
    for (const [x, z, lit] of [[-7.5, -11, true], [7.5, -11, true], [-8, 5, false], [8, 5, false]]) {
      add(new THREE.CylinderGeometry(0.22, 0.32, 1.3, 10), Mat.bronze, x, 0.65, z);
      add(new THREE.SphereGeometry(0.55, 18, 8, 0, TAU, Math.PI / 2, Math.PI / 2), Mat.bronze, x, 1.75, z).scale.y = 0.6;
      let l = null;
      if (lit) {
        l = new THREE.PointLight(0xffa04a, 16, 14, 2);
        l.position.set(x, 2.3, z);
        s.add(l);
      }
      this.fires.push({ pos: new THREE.Vector3(x, 1.85, z), light: l });
    }
    // the gods: larger than mortals, Zeus largest of all
    const face = (x, z) => Math.atan2(0 - x, 7 - z);
    this.zeus = this.actor(s, 'zeus', { size: 1.9, x: 0, y: top, z: -14.9, face: 0, spark: [3.4, 2.7, 1.0] });
    this.zeus.rig.play('throne', { fade: 0.01 });
    this.fitThrone(s, this.zeus, top, marble, gold);
    this.poseidon = this.actor(s, 'poseidon', { stance: 'poseidon', size: 1.26, x: -6.2, z: -8.2, face: face(-6.2, -8.2), spark: [0.5, 2.0, 3.4] });
    this.athena = this.actor(s, 'athena', { stance: 'athena', size: 1.2, x: 6.2, z: -8.2, face: face(6.2, -8.2), spark: [2.8, 2.8, 3.1] });
    // Hades as Olympus knew him: crowned and robed in black. This model appears only here; the scarred
    // underworld Hades waits hidden on the same spot, and is what is left when the rot takes his spark
    this.hades = this.actor(s, 'hadesKing', { stance: 'hadesCourt', size: 1.2, x: -11.2, z: -3.4, face: face(-11.2, -3.4), spark: [0.4, 2.6, 1.3] });
    this.hadesFallen = this.actor(s, 'hades', { size: 1.12, x: -11.2, z: -3.4, face: face(-11.2, -3.4) });
    this.hadesFallen.root.visible = false;
    this.hadesFallen.rig.play('kneelBowed', { fade: 0.01 });
    this.ares = this.actor(s, 'ares', { stance: 'aresCourt', size: 1.24, x: 11.2, z: -3.4, face: face(11.2, -3.4), spark: [3.4, 0.8, 0.25] });
    this.gods = [this.poseidon, this.athena, this.hades, this.ares];
    this.kronosHall = this.actor(s, 'kronos', { size: 2.1, x: 0, z: 23, face: Math.PI });
    this.eyes(this.kronosHall);
    this.kronosHall.root.visible = false;
    this.hallActors = [this.zeus, ...this.gods, this.hadesFallen, this.kronosHall];
    this.rot = 0; this.rotOn = false;
  },

  buildTartarus() {
    const s = (this.tartarus = new THREE.Scene());
    s.background = new THREE.Color(0x030105);
    s.fog = new THREE.FogExp2(0x0c0512, 0.04);
    s.add(new THREE.HemisphereLight(0x4a2a6a, 0x0a0410, 0.7));
    const key = new THREE.SpotLight(0xb27cff, 420, 46, 0.55, 0.7, 1.4);
    key.position.set(5, 16, 9); key.target.position.set(0, 1.6, 0);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    s.add(key, key.target);
    const under = new THREE.PointLight(0xff3a18, 22, 16, 2);
    under.position.set(0, 0.6, 3);
    s.add(under);
    this.pitLight = new THREE.PointLight(0x9a3cff, 30, 22, 1.8);
    this.pitLight.position.set(0, 5, -4);
    s.add(this.pitLight);
    const add = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; s.add(o); return o; };
    add(new THREE.CylinderGeometry(40, 40, 2, 48), World.rockMat, 0, -1, 0);
    // cracks of violet fire in the floor
    const crackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.25, 1.8), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
    const rng = mulberry32(13);
    for (let i = 0; i < 16; i++) {
      const a = rng() * TAU, r0 = 1.8 + rng() * 2, len = 1.5 + rng() * 4;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.04 + rng() * 0.05, len).rotateX(-Math.PI / 2), crackMat);
      m.position.set(Math.cos(a) * (r0 + len / 2), 0.02, Math.sin(a) * (r0 + len / 2));
      m.rotation.y = -a + Math.PI / 2 + (rng() - 0.5) * 0.4;
      s.add(m);
    }
    // jagged walls of the pit
    const rocks = new THREE.InstancedMesh(World.rockVariants[1], World.rockMat, 40);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU + rng() * 0.1, r = 17 + rng() * 6, h = 4 + rng() * 9;
      q.setFromEuler(new THREE.Euler(rng() * 0.4, rng() * TAU, rng() * 0.4));
      sc.set(3 + rng() * 3, h, 3 + rng() * 3);
      rocks.setMatrixAt(i, m4.compose(new THREE.Vector3(Math.cos(a) * r, h * 0.3, Math.sin(a) * r), q, sc));
    }
    rocks.castShadow = rocks.receiveShadow = true;
    s.add(rocks);
    // the pillars the chains are bolted to
    for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.9, 1.5, 13, 10), World.rockMat, sx * 6.2, 6.3, -1.2);
    this.kronos = this.actor(s, 'kronos', { size: 1.75, x: 0, z: 0, face: 0 });
    this.eyes(this.kronos);
    this.kronos.rig.play('chained', { fade: 0.01 });
    this.chains = [-1, 1].map((sx) => this.makeChain(s, new THREE.Vector3(sx * 5.3, 3.8, -1.0), 15));
  },

  makeChain(s, from, n) {
    const links = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.linkGeo, this.chainMat);
      m.castShadow = true;
      s.add(m);
      links.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3() });
    }
    return { from, links, broken: false };
  },
  updateChain(ch, to, dt) {
    const n = ch.links.length, tmp = this._t || (this._t = new THREE.Vector3());
    if (!ch.broken) {
      const len = ch.from.distanceTo(to);
      const at = (t, out) => { out.lerpVectors(ch.from, to, t); out.y -= Math.sin(t * Math.PI) * len * 0.07; return out; };
      for (let i = 0; i < n; i++) {
        const L = ch.links[i].m;
        at((i + 0.5) / n, L.position);
        L.lookAt(at((i + 1.5) / n, tmp));
        if (i % 2) L.rotateZ(Math.PI / 2);
      }
      return;
    }
    for (const l of ch.links) {
      l.v.y -= 9.8 * dt;
      l.m.position.addScaledVector(l.v, dt);
      if (l.m.position.y < 0.05) { l.m.position.y = 0.05; l.v.multiplyScalar(0.35); l.v.y = Math.abs(l.v.y) * 0.4; l.w.multiplyScalar(0.5); }
      l.m.rotation.x += l.w.x * dt; l.m.rotation.y += l.w.y * dt; l.m.rotation.z += l.w.z * dt;
    }
  },
  breakChains() {
    const c = this.kronos.root.position;
    for (const ch of this.chains) {
      ch.broken = true;
      for (const l of ch.links) {
        const out = l.m.position.clone().sub(c).setY(0).normalize();
        l.v.set(rand(-2, 2), rand(3, 8), rand(-2, 2)).addScaledVector(out, rand(4, 10));
        l.w.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
      }
    }
  },

  /**
   * The rot remakes Hades: violet fire swallows the crowned king and leaves the scarred,
   * hellbound Hades kneeling in his place (the model the underworld chapters use).
   */
  corruptHades() {
    const K = this.hades, F = this.hadesFallen, p = K.root.position.clone();
    const mid = p.clone().add(new THREE.Vector3(0, 1.2 * K.size, 0));
    for (let i = 0; i < 70; i++) {
      FX.smoke.spawn({ x: p.x + rand(-0.8, 0.8), y: p.y + rand(0, 2.4), z: p.z + rand(-0.8, 0.8), vx: rand(-0.6, 0.6), vy: rand(0.6, 2.2), vz: rand(-0.6, 0.6), life: rand(1.2, 2.4), s: rand(0.6, 1.3), s2: 2.6, c: [0.32, 0.06, 0.45, 0.75], c2: [0.08, 0.02, 0.12, 0] });
    }
    // (violet fire, not a white-out: the light and the embers are kept under what the bloom turns to glare)
    FX.sparks(mid, null, 40, [1.2, 0.3, 2.0, 1], 6);
    FX.flashLight(mid, 0x9a3cff, 240, 0.9, 14);
    // the king's body comes apart in embers, from crown to sandals
    for (let i = 0; i < 100; i++) {
      const a = rand(0, TAU), r = rand(0, 0.45) * K.size, y = rand(0.05, 1.85) * K.size;
      FX.glow.spawn({ x: p.x + Math.cos(a) * r, y: p.y + y, z: p.z + Math.sin(a) * r, vx: rand(-0.4, 0.4), vy: rand(0.6, 2.2), vz: rand(-0.4, 0.4), life: rand(1.2, 2.6), s: rand(0.04, 0.1), s2: 0.01, c: [0.9, 0.24, 1.5, 1], c2: [0.5, 0.12, 0.8, 0], drag: 0.6 });
    }
    Sound.fire(true, 0.8);
    Sound.roar(0.7, 0.6);
    setTimeout(() => {
      K.root.visible = false;
      F.root.visible = true;
      F.rig.play('kneelBowed', { fade: 0.01 });
      F.rig.act.t = 1;
      for (let i = 0; i < 30; i++) FX.glow.spawn({ x: p.x + rand(-0.6, 0.6), y: p.y + rand(0.2, 2), z: p.z + rand(-0.6, 0.6), vy: rand(0.4, 1.4), life: rand(0.8, 1.6), s: 0.08, s2: 0.01, c: [2.4, 0.6, 0.2, 1], c2: [1, 0.2, 0.05, 0] });
    }, 450);
  },

  /** a god's spark is torn out and flies into Kronos' raised hand */
  tearSpark(god, delay = 0) {
    setTimeout(() => { if (god.spark && !god.sparkGone) god.sparkFly = { t: 0, from: god.spark.position.clone() }; }, delay * 1000);
  },

  update(dt) {
    const s = G.activeScene;
    if (s === this.olympus) this.updateHall(dt);
    else if (s === this.tartarus) this.updatePit(dt);
  },
  updateHall(dt) {
    const K = this.kronosHall;
    if (K.walk) {
      const w = K.walk;
      w.t = Math.min(1, w.t + dt / w.dur);
      K.root.position.lerpVectors(w.from, w.to, w.t);
      K.speed = w.t < 1 ? w.from.distanceTo(w.to) / w.dur : 0;
      if (w.t >= 1) K.walk = null;
    }
    for (const a of this.hallActors) if (a.root.visible) a.update(dt);
    // sparks: hovering over each god, torn away to Kronos, or held aloft by Zeus
    const kh = K.root.visible ? this.hand(K) : null;
    for (const g of [this.zeus, ...this.gods]) {
      if (!g.spark || g.sparkGone) continue;
      const p = g.spark.position;
      if (g.sparkFly && kh) {
        const f = g.sparkFly;
        f.t = Math.min(1, f.t + dt / 1.5);
        p.lerpVectors(f.from, kh, easeInOut(f.t));
        p.y += Math.sin(f.t * Math.PI) * 3;
        const [r, gg, b] = g.sparkCol;
        FX.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(-0.4, 0.4), life: 0.7, s: 0.28, s2: 0.02, c: [r, gg, b, 1], c2: [r * 0.6, gg * 0.6, b * 0.6, 0] });
        if (f.t >= 1) {
          g.sparkGone = true; g.spark.visible = false;
          FX.sparks(kh, null, 40, [1.4, 0.4, 2.4, 1], 5);
          FX.flashLight(kh, 0x9a3cff, 400, 0.5, 20);
          Sound.zap();
        }
      } else if (g.sparkHeld) {
        p.copy(this.hand(g)).add(new THREE.Vector3(0, 0.25, 0));
        if (Math.random() < 0.8) FX.glow.spawn({ x: p.x + rand(-0.3, 0.3), y: p.y + rand(-0.3, 0.3), z: p.z + rand(-0.3, 0.3), vy: rand(0.5, 1.5), life: 0.6, s: 0.12, s2: 0.01, c: [2.4, 2.4, 3.6, 1], c2: [1, 1.4, 3, 0] });
      } else {
        p.copy(this.head(g)).add(new THREE.Vector3(0, 0.7 * g.size, 0));
        p.y += Math.sin(G.time * 2 + g.root.position.x) * 0.06;
      }
      g.spark.scale.setScalar(1 + Math.sin(G.time * 7 + g.root.position.x) * 0.12);
    }
    // the rot: colour, light and a creeping violet mist
    // a slow, cold tide
    this.rot = damp(this.rot, this.rotOn ? 1 : 0, 0.32, dt);
    const r = this.rot, W = this.warm, D = this.dark;
    this.olympus.fog.color.copy(W.fog).lerp(D.fog, r);
    this.olympus.fog.near = lerp(160, 30, r);
    this.olympus.fog.far = lerp(950, 210, r);
    this.hemi.color.copy(W.sky).lerp(D.sky, r);
    this.hemi.groundColor.copy(W.ground).lerp(D.ground, r);
    this.hemi.intensity = lerp(0.6, 0.55, r);
    this.sun.color.copy(W.sun).lerp(D.sun, r);
    this.sun.intensity = lerp(2.1, 1.0, r);
    this.skyU.uRot.value = r; this.cloudU.uRot.value = r;
    this.cloudU.uFlash.value = Math.max(0, this.cloudU.uFlash.value - dt * 1.2);
    this.rotLight.intensity = 70 * r;
    this.rotLight.position.copy(K.root.position).add(new THREE.Vector3(0, 4, 2));
    this.zeusLight.intensity = damp(this.zeusLight.intensity, this.zeusGlow ? 60 : 0, 3, dt);
    // a low violet mist: few, low, fairly small sprites (big overlapping smoke is very costly to draw)
    if (r > 0.02 && Math.random() < r * 0.7) {
      const front = 26 - r * 52, cam = G.camera.position;
      const x = rand(-20, 20), z = rand(Math.max(-20, front), 26);
      if (x * x + z * z < 520 && Math.hypot(x - cam.x, z - cam.z) > 6) {
        FX.smoke.spawn({ x, y: rand(0, 0.3), z, vx: rand(-0.3, 0.3), vy: rand(0.1, 0.35), vz: rand(-0.6, 0.1), life: rand(2.5, 3.5), s: rand(0.8, 1.3), s2: 2.2, c: [0.24, 0.05, 0.32, 0.45], c2: [0.06, 0.02, 0.1, 0] });
      }
    }
    for (const f of this.fires) {
      if (f.light) f.light.intensity = (16 + Math.sin(G.time * 13 + f.pos.x) * 2) * (1 - r * 0.85);
      if (Math.random() < 0.7 * (1 - r)) FX.flame(f.pos, 0.8);
    }
  },
  updatePit(dt) {
    const K = this.kronos;
    K.update(dt);
    for (let i = 0; i < 2; i++) this.updateChain(this.chains[i], this.hand(K, i ? 'R' : 'L'), dt);
    this.pitLight.intensity = 30 + Math.sin(G.time * 2.3) * 8;
    if (Math.random() < 0.5) FX.glow.spawn({ x: rand(-8, 8), y: 0.1, z: rand(-6, 8), vy: rand(0.4, 1.4), life: rand(2, 4), s: 0.05, s2: 0.01, c: [1.6, 0.5, 2.6, 1], c2: [0.6, 0.1, 1, 0] });
    if (Math.random() < 0.15) FX.smoke.spawn({ x: rand(-6, 6), y: 0.2, z: rand(-4, 6), vy: rand(0.2, 0.5), life: 4.5, s: 1.4, s2: 3, c: [0.14, 0.04, 0.2, 0.45], c2: [0.04, 0.01, 0.06, 0] });
  },
};

/* ---------------------------------------------------------------- scripts */
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ------------------------------------------------------------------ the Fates' tapestry
   What is to come, painted as on a black-figure vase. The game's own figures are posed in profile in a little
   studio and drawn twice (as a silhouette, and as their surface's turning), then painted on fired clay: black
   glaze for the figures with a wet sheen, their detail scratched through to the clay wherever the surface turns
   sharply (incision, as the painters did it), a meander above, a ground line and rays below, and every figure
   named beside his head in Greek letters. Shown full screen with a slow drift, crossfading slide to slide. */
const Vase = {
  W: 1280, H: 720,
  setup() {
    if (this.S) return;
    const S = (this.S = new THREE.Scene());
    this.cam = new THREE.PerspectiveCamera(17, this.W / this.H, 1, 300);
    this.rt = new THREE.WebGLRenderTarget(this.W, this.H, { samples: 4 });
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.normal = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    this.cast = {};
    this.props = {};
    // the screen it is shown on
    const el = (this.el = document.createElement('div'));
    el.id = 'vase';
    el.style.cssText = 'position:fixed;inset:0;z-index:19;background:#0b0705;display:none;overflow:hidden;pointer-events:none;opacity:0;transition:opacity 1.4s ease';
    this.layers = [0, 1].map(() => {
      const im = document.createElement('img');
      im.style.cssText = 'position:absolute;left:50%;top:50%;width:max(100vw,177.78vh);height:max(56.25vw,100vh);object-fit:cover;opacity:0;transform:translate(-50%,-50%) scale(1.03);will-change:transform,opacity';
      el.appendChild(im);
      return im;
    });
    // lamplight on the clay: a warm vignette that breathes a little
    const glow = document.createElement('div');
    glow.style.cssText = 'position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,rgba(255,196,120,0.10) 0%,rgba(0,0,0,0) 45%,rgba(8,4,2,0.62) 100%);animation:vaseBreath 6s ease-in-out infinite';
    el.appendChild(glow);
    this.title = document.createElement('div');
    this.title.style.cssText = 'position:absolute;left:0;right:0;top:41%;text-align:center;font-family:Cinzel,Georgia,serif;color:#e6c88a;letter-spacing:.55em;font-size:clamp(18px,2.6vw,40px);text-shadow:0 0 24px rgba(255,170,80,.45);opacity:0;transition:opacity 2.2s ease';
    el.appendChild(this.title);
    const st = document.createElement('style');
    st.textContent = '@keyframes vaseBreath{0%,100%{opacity:1}50%{opacity:.82}}';
    document.head.appendChild(st);
    document.body.appendChild(el);
    this.front = 0;
  },
  /** a figure for the studio (one of each, made once) */
  figure(key, f) {
    if (!this.cast[key]) this.cast[key] = Prologue.actor(this.S, f.model || key, { stance: f.stance || 'casual', size: f.size || 1.1 });
    return this.cast[key];
  },
  /** a temple front, for Olympus standing again */
  temple() {
    if (this.props.temple) return this.props.temple;
    const g = new THREE.Group(), m = new THREE.MeshBasicMaterial();
    const add = (geo, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); };
    for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(13.6 - i * 0.7, 0.32, 3), 0, 0.16 + i * 0.32, 0);
    for (let i = 0; i < 6; i++) { const x = -5.4 + i * 2.16; add(new THREE.CylinderGeometry(0.36, 0.44, 5.6, 20), x, 3.76, 0); add(new THREE.BoxGeometry(1.05, 0.22, 1.05), x, 6.66, 0); add(new THREE.BoxGeometry(1.0, 0.18, 1.0), x, 1.05, 0); }
    add(new THREE.BoxGeometry(12.6, 0.62, 2), 0, 7.08, 0);
    add(new THREE.BoxGeometry(12.6, 0.42, 2), 0, 7.6, 0);
    const pd = new THREE.Shape(); pd.moveTo(-6.6, 0); pd.lineTo(6.6, 0); pd.lineTo(0, 2.1); pd.lineTo(-6.6, 0);
    add(new THREE.ExtrudeGeometry(pd, { depth: 1.6, bevelEnabled: false }).translate(0, 0, -0.8), 0, 7.82, 0);
    this.S.add(g);
    return (this.props.temple = g);
  },
  /** draw one slide: pose the figures, render mask and normals, paint the vase */
  render(slide) {
    this.setup();
    const S = this.S, R = G.renderer, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const k in this.cast) this.cast[k].root.visible = false;
    for (const k in this.props) this.props[k].visible = false;
    const labels = [];
    for (const f of slide.figures || []) {
      const a = this.figure(f.key, f);
      a.root.visible = true;
      a.root.position.set(f.x, f.y || 0, f.z || 0);
      a.root.rotation.set(0, f.face > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      if (typeof f.pose === 'string') a.rig.pose(f.pose, f.t ?? 1); else a.rig.poseFrom(f.pose || {});
      a.root.updateMatrixWorld(true);
      if (a.model) a.model.update();
      a.root.updateMatrixWorld(true);
      if (f.carry) {
        const b = this.props.baby || (this.props.baby = Memory.baby.clone());
        if (!b.parent) S.add(b);
        a.hold = a.hold || { fore: 0.03, palm: 0.016, at: 0.77 };
        b.visible = true;
        Memory.placeBaby(a, b);
      }
      if (f.label) labels.push({ text: f.label, at: a.rig.j.head.getWorldPosition(V3(0, 0, 0)), side: f.labelSide || -f.face, up: f.labelUp || 0 });
    }
    if (slide.temple) this.temple().visible = true;
    const c = slide.cam || {};
    this.cam.position.set(c.x || 0, c.y ?? 1.5, c.dist || 16);
    this.cam.fov = c.fov || 17; this.cam.updateProjectionMatrix();
    this.cam.clearViewOffset();
    this.cam.lookAt(c.x || 0, c.ly ?? c.y ?? 1.5, 0);
    this.cam.updateMatrixWorld(true);
    // stand them on the painted ground line
    const g0 = new THREE.Vector3(c.x || 0, 0, 0).project(this.cam), gy = (1 - (g0.y * 0.5 + 0.5)) * this.H, want = (slide.ground ?? this.H - 128) - 2;
    this.cam.setViewOffset(this.W, this.H, 0, gy - want, this.W, this.H);
    this.cam.updateMatrixWorld(true);
    const W = this.W, H = this.H, read = (mat) => {
      S.overrideMaterial = mat;
      R.setRenderTarget(this.rt); R.setClearColor(0x000000, 1); R.clear(); R.render(S, this.cam);
      const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(this.rt, 0, 0, W, H, px);
      return px;
    };
    const oc = R.getClearColor(new THREE.Color()), oa = R.getClearAlpha(), ot = R.getRenderTarget(), osm = R.shadowMap.autoUpdate;
    R.shadowMap.autoUpdate = false;
    const mask = read(this.white), nrm = read(this.normal);
    S.overrideMaterial = null;
    R.setRenderTarget(ot); R.setClearColor(oc, oa); R.shadowMap.autoUpdate = osm;
    for (const l of labels) { const p = l.at.clone().project(this.cam); l.x = (p.x * 0.5 + 0.5) * W; l.y = (1 - (p.y * 0.5 + 0.5)) * H; }
    return this.paint(mask, nrm, labels, slide);
  },
  paint(mask, nrm, labels, slide) {
    const W = this.W, H = this.H, cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    // the clay: fired orange, the vase's curve darkening toward the sides, a bloom of lamplight
    let g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#c9773f'); g.addColorStop(1, '#b0602f');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(48,14,2,0.55)'); g.addColorStop(0.22, 'rgba(48,14,2,0)'); g.addColorStop(0.78, 'rgba(48,14,2,0)'); g.addColorStop(1, 'rgba(48,14,2,0.55)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    g = x.createRadialGradient(W * 0.46, H * 0.4, 20, W * 0.46, H * 0.4, W * 0.55); g.addColorStop(0, 'rgba(255,214,150,0.22)'); g.addColorStop(1, 'rgba(255,214,150,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    const GL = [22, 15, 11], CLAY = [196, 112, 60];
    const at = (px, py) => ((H - 1 - py) * W + px) * 4;   // the render target reads bottom-up
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const o = (py * W + px) * 4, i = at(px, py);
      // grain of the clay
      const gr = (rnd() - 0.5) * 14;
      d[o] += gr; d[o + 1] += gr * 0.8; d[o + 2] += gr * 0.6;
      const m = mask[i] / 255;
      if (m <= 0.01) continue;
      // glaze: near black, its sheen catching the lamp where the surface faces it
      const nx = nrm[i] / 127.5 - 1, ny = nrm[i + 1] / 127.5 - 1, nz = nrm[i + 2] / 127.5 - 1;
      const sh = Math.pow(Math.max(0, -0.38 * nx + 0.62 * ny + 0.68 * nz), 14) * 46 + Math.max(0, ny) * 8;
      let r = GL[0] + sh, gg = GL[1] + sh * 0.8, b = GL[2] + sh * 0.65;
      // incision: where the surface turns sharply inside the figure, the line is cut through to the clay
      if (px > 2 && py > 2 && px < W - 3 && py < H - 3) {
        const a = at(px + 1, py), bb = at(px - 1, py), cc = at(px, py + 1), dd = at(px, py - 1);
        const e = (Math.abs(nrm[a] - nrm[bb]) + Math.abs(nrm[a + 1] - nrm[bb + 1]) + Math.abs(nrm[a + 2] - nrm[bb + 2]) + Math.abs(nrm[cc] - nrm[dd]) + Math.abs(nrm[cc + 1] - nrm[dd + 1]) + Math.abs(nrm[cc + 2] - nrm[dd + 2])) / 255;
        const inside = mask[at(px + 2, py)] > 200 && mask[at(px - 2, py)] > 200 && mask[at(px, py + 2)] > 200 && mask[at(px, py - 2)] > 200;
        if (inside && e > 0.55) { const k = Math.min(1, (e - 0.55) * 2.2) * 0.85; r += (CLAY[0] - r) * k; gg += (CLAY[1] - gg) * k; b += (CLAY[2] - b) * k; }
      }
      // a little wear: the glaze chipped here and there
      if (rnd() < 0.0009) { r = CLAY[0] * 0.85; gg = CLAY[1] * 0.85; b = CLAY[2] * 0.85; }
      d[o] = d[o] * (1 - m) + r * m; d[o + 1] = d[o + 1] * (1 - m) + gg * m; d[o + 2] = d[o + 2] * (1 - m) + b * m;
    }
    x.putImageData(img, 0, 0);
    // the frieze's frame: a meander above, the ground line and rays below
    const glaze = 'rgb(24,16,12)';
    x.fillStyle = glaze; x.strokeStyle = glaze;
    const top = 64, unit = 44, hgt = 34;
    x.fillRect(0, top - 52, W, 5); x.fillRect(0, top + 2, W, 5);
    x.lineWidth = 5; x.lineCap = 'square';
    for (let u = -unit; u < W + unit; u += unit) {
      const y0 = top - 42, y1 = y0 + hgt;
      x.beginPath();
      x.moveTo(u, y1); x.lineTo(u, y0); x.lineTo(u + unit * 0.8, y0); x.lineTo(u + unit * 0.8, y1 - hgt * 0.25);
      x.lineTo(u + unit * 0.3, y1 - hgt * 0.25); x.lineTo(u + unit * 0.3, y0 + hgt * 0.35); x.lineTo(u + unit * 0.55, y0 + hgt * 0.35);
      x.moveTo(u, y1); x.lineTo(u + unit, y1);
      x.stroke();
    }
    const ground = slide.ground ?? H - 128;
    x.fillRect(0, ground, W, 7);
    x.fillRect(0, ground + 16, W, 3);
    for (let u = 0; u < W + 40; u += 40) { x.beginPath(); x.moveTo(u, H - 22); x.lineTo(u + 20, ground + 30); x.lineTo(u + 40, H - 22); x.closePath(); x.fill(); }
    x.fillRect(0, H - 22, W, 4);
    // names beside the heads, as the painters wrote them: running down the clay beside the figure, never on it
    const gl = slide.ground ?? H - 128;
    const clear = (cx, cy, w, h) => {
      if (cx - w / 2 < 4 || cx + w / 2 > W - 4 || cy - h / 2 < 76 || cy + h / 2 > gl - 6) return false;
      for (let yy = cy - h / 2; yy < cy + h / 2; yy += 3) for (let xx = cx - w / 2; xx < cx + w / 2; xx += 3) if (mask[at(Math.floor(xx), Math.floor(yy))] > 40) return false;
      return true;
    };
    x.font = '600 24px Georgia, "Times New Roman", serif';
    x.textBaseline = 'middle'; x.textAlign = 'center';
    const used = [];
    for (const l of labels) {
      const txt = l.text.split('').join('\u2009'), len = x.measureText(txt).width + 8;
      let spot = null;
      for (const off of [40, 56, 74, 94, 116, 140]) {
        for (const sd of [l.side, -l.side]) {
          const cx = l.x + sd * off, cy = l.y + len * 0.42 + l.up;
          if (clear(cx, cy, 30, len)) { spot = [cx, cy, sd]; break; }
        }
        if (spot) break;
      }
      if (!spot) spot = [l.x, l.y - 70, 0];
      used.push(spot);
      x.save();
      x.translate(spot[0], spot[1]);
      if (spot[2] !== 0) x.rotate(spot[2] > 0 ? Math.PI / 2 : -Math.PI / 2);
      x.fillText(txt, 0, 0);
      x.restore();
    }
    // filler ornament: dotted rosettes in the open field, as on the old Corinthian and Attic pots
    let placed = 0;
    for (let tries = 0; tries < 260 && placed < (slide.rosettes ?? 6); tries++) {
      const r = 11 + rnd() * 7, cx = 40 + rnd() * (W - 80), cy = 110 + rnd() * (gl - 150);
      if (!clear(cx, cy, r * 4.2, r * 4.2) || used.some((u) => Math.hypot(u[0] - cx, u[1] - cy) < 110)) continue;
      used.push([cx, cy, 0]);
      x.save(); x.translate(cx, cy);
      for (let k = 0; k < 8; k++) { x.rotate(Math.PI / 4); x.beginPath(); x.ellipse(0, -r * 0.62, r * 0.2, r * 0.5, 0, 0, TAU); x.fill(); }
      x.beginPath(); x.arc(0, 0, r * 0.2, 0, TAU); x.fillStyle = 'rgb(196,112,60)'; x.fill(); x.fillStyle = glaze;
      x.restore();
      placed++;
    }
    return cv;
  },
  /** paint every slide ahead of time (a beat of black while it happens) */
  prepare(slides) {
    return slides.map((sl) => this.render(sl).toDataURL('image/jpeg', 0.92));
  },
  open() { this.setup(); this.el.style.display = 'block'; void this.el.offsetWidth; this.el.style.opacity = '1'; },
  show(url, dur, i) {
    const nx = this.layers[1 - this.front], cur = this.layers[this.front];
    this.front = 1 - this.front;
    nx.style.transition = 'none';
    const dir = i % 2 ? -1 : 1;
    nx.style.transform = `translate(calc(-50% + ${dir * 1.2}%), -50%) scale(1.04)`;
    nx.src = url;
    void nx.offsetWidth;
    nx.style.transition = `opacity 1.6s ease, transform ${dur + 2}s linear`;
    nx.style.opacity = '1';
    nx.style.transform = `translate(calc(-50% + ${-dir * 1.2}%), -50%) scale(1.12)`;
    cur.style.opacity = '0';
  },
  caption(text) { this.title.textContent = text || ''; this.title.style.opacity = text ? '1' : '0'; },
  hide() {
    if (!this.el) return;
    this.el.style.opacity = '0';
    this.caption(null);
    setTimeout(() => { if (this.el.style.opacity === '0') { this.el.style.display = 'none'; this.layers.forEach((l) => { l.style.opacity = '0'; }); } }, 1500);
  },
};

/** what the Fates wove: the slides, each with its narration */
const ASCENSION_SLIDES = [
  { line: 'And the Fates, who see every thread, wove what was still to come.',
    figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: -1.5, face: 1, pose: 'raise', t: 1, label: 'ΑΡΙΕΛ' },
      { key: 'ares', model: 'ares', stance: 'aresCourt', size: 1.24, x: 1.7, face: -1, pose: 'kneelBowed', t: 1, label: 'ΑΡΗΣ' }], cam: { y: 1.25, dist: 12 } },
  { line: 'The son of Zeus took up the mantle of war, and carried it into the dark places of the world.',
    figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: -2.3, face: 1, pose: 'lunge', t: 0.45, label: 'ΑΡΙΕΛ' },
      { key: 'cyclops', model: 'cyclops', stance: 'brute', size: 1.5, x: 1.2, face: -1, pose: 'struck', t: 0.5, label: 'ΚΥΚΛΩΨ' },
      { key: 'hoplite', model: 'spartan', stance: 'hopliteSword', size: 1.0, x: 4.0, face: -1, pose: 'backstep', t: 0.5 }], cam: { x: 0.6, y: 1.5, dist: 14.5 } },
  { line: 'One by one, the stolen sparks came home — until the Titan himself was cast down into Tartarus.',
    figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: -2.6, face: 1, pose: 'thrust', t: 0.5, label: 'ΑΡΙΕΛ' },
      { key: 'kronos', model: 'kronos', size: 1.75, x: 1.4, face: -1, pose: 'death', t: 0.45, label: 'ΚΡΟΝΟΣ' }], cam: { y: 1.7, dist: 14 } },
  { line: 'The gods walked again on Olympus: the sea-king, the grey-eyed one, the lord of the dead — and their King.',
    figures: [{ key: 'poseidon', model: 'poseidon', stance: 'poseidon', size: 1.2, x: -5.0, face: 1, pose: {}, label: 'ΠΟΣΕΙΔΩΝ' },
      { key: 'athena', model: 'athena', stance: 'athena', size: 1.14, x: -1.8, face: 1, pose: {}, label: 'ΑΘΗΝΑ' },
      { key: 'zeus', model: 'zeus', size: 1.3, x: 1.7, face: -1, pose: 'point', t: 0.8, label: 'ΖΕΥΣ' },
      { key: 'hades', model: 'hadesKing', stance: 'hadesCourt', size: 1.16, x: 5.0, face: -1, pose: {}, label: 'ΑΙΔΗΣ' }], cam: { y: 1.55, dist: 20 } },
  { line: 'Their fires were lit, their columns stood, and Olympus shone over the world once more.',
    temple: true, rosettes: 9, figures: [], cam: { y: 4.6, dist: 40 } },
  { line: 'And at the right hand of Zeus stood the new God of War: Ariel, Heir of Thunder.',
    figures: [{ key: 'zeus', model: 'zeus', size: 1.3, x: -1.3, face: 1, pose: 'talk', t: 0.6, label: 'ΖΕΥΣ' },
      { key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: 1.3, face: -1, pose: {}, label: 'ΑΡΙΕΛ' }], cam: { y: 1.4, dist: 11.5 } },
];


/** the epilogue's tapestry: his mortal life, painted in the old way (A: up to the wedding, B: the sons) */
const LIFE_SLIDES_A = [
  { line: 'By day he was still Ariel Stormborn of Westbrook High, who turned his chemistry homework in late.',
    figures: [{ key: 'teen', model: 'arielTeen', size: 1.0, x: -1.0, face: 1, pose: 'talk', t: 0.5, label: 'ΑΡΙΕΛ' },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 1.1, face: -1, pose: 'phone', t: 1, label: 'ΤΖΕΣΣΙ' }], cam: { y: 1.0, dist: 9.5 } },
  { line: 'By night the God of War kept watch over the old places of the world, and the old places were quiet.',
    figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: -1.6, face: 1, pose: {}, label: 'ΑΡΙΕΛ' },
      { key: 'hoplite', model: 'spartan', stance: 'hopliteSword', size: 1.0, x: 1.0, face: -1, pose: 'kneel', t: 1 },
      { key: 'hoplite2', model: 'spartan', stance: 'hopliteSword', size: 1.0, x: 3.0, face: -1, pose: 'kneel', t: 1 }], cam: { x: 0.5, y: 1.1, dist: 12 } },
  { line: 'He told Jesse everything: the shard, the storm, the father in the rain. She listened to the very end, and she did not run.',
    figures: [{ key: 'teen', model: 'arielTeen', size: 1.0, x: -0.9, face: 1, pose: 'shrug', t: 0.6, label: 'ΑΡΙΕΛ' },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 0.9, face: -1, pose: 'fold', t: 1, label: 'ΤΖΕΣΣΙ' }], cam: { y: 1.0, dist: 9 } },
  { line: 'They finished school together, under a sky that held back its thunder for one whole afternoon.',
    figures: [{ key: 'teen', model: 'arielTeen', size: 1.0, x: -0.8, face: 1, pose: 'raise', t: 1, label: 'ΑΡΙΕΛ' },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 0.8, face: -1, pose: 'raise', t: 1, label: 'ΤΖΕΣΣΙ' }], cam: { y: 1.1, dist: 9.5 } },
  { line: 'Seven summers later, on the pier where Anna once met a stranger in the rain, Ariel married Jesse. Anna gave the bride away, and Hermes, of course, was late.',
    figures: [{ key: 'hermes', model: 'hermes', stance: 'hermes', size: 1.05, x: -3.2, face: 1, pose: 'talk', t: 0.5, label: 'ΕΡΜΗΣ' },
      { key: 'teen', model: 'arielTeen', size: 1.0, x: -0.6, face: 1, pose: 'offer', t: 1, label: 'ΑΡΙΕΛ' },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 0.55, face: -1, pose: 'offer', t: 1, label: 'ΤΖΕΣΣΙ' },
      { key: 'anna', model: 'anna', size: 0.97, x: 3.0, face: -1, pose: {}, label: 'ΑΝΝΑ' }], cam: { y: 1.1, dist: 15 } },
  { line: 'Zeus came as a warm summer rain. Ares came in his own fire, and for the first time it warmed instead of burned.',
    figures: [{ key: 'zeus', model: 'zeus', size: 1.25, x: -3.0, face: 1, pose: 'point', t: 0.7, label: 'ΖΕΥΣ' },
      { key: 'teen', model: 'arielTeen', size: 1.0, x: -0.6, face: 1, pose: 'offer', t: 1 },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 0.55, face: -1, pose: 'offer', t: 1 },
      { key: 'ares', model: 'ares', stance: 'aresCourt', size: 1.2, x: 3.1, face: -1, pose: {}, label: 'ΑΡΗΣ' }], cam: { y: 1.3, dist: 16 } },
];
const LIFE_SLIDES_B = [
  { line: 'Two winters after Kratos came his brother, Deimos: dread. A red ember burned beside the blue in him, the war-god\'s shard come home in the blood.',
    figures: [{ key: 'teen', model: 'arielTeen', size: 1.0, x: -1.3, face: 1, pose: 'look', t: 1, label: 'ΑΡΙΕΛ' },
      { key: 'jesse', model: 'jesse', size: 0.95, x: 0.2, face: -1, pose: 'cradle', t: 1, carry: true, label: 'ΤΖΕΣΣΙ' },
      { key: 'kid1', model: 'arielTeen', size: 0.56, x: 1.6, face: -1, pose: 'lookUp', t: 1, label: 'ΚΡΑΤΟΣ' }], cam: { y: 1.0, dist: 10 } },
  { line: 'The brothers grew up between two worlds: Saturday football in Westbrook, and Sunday sword-drill on the slopes of Olympus.',
    figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: -2.2, face: 1, pose: 'point', t: 0.8, label: 'ΑΡΙΕΛ' },
      { key: 'kid1', model: 'arielTeen', size: 0.62, x: 0.6, face: 1, pose: 'heavy', t: 0.4, label: 'ΚΡΑΤΟΣ' },
      { key: 'kid2', model: 'arielTeen', size: 0.5, x: 2.3, face: -1, pose: 'backstep', t: 0.5, label: 'ΔΕΙΜΟΣ' }], cam: { y: 1.0, dist: 12 } },
  { line: 'Kratos had his father\'s strength, and Deimos his grandfather\'s fury. Ariel, who had carried both, taught them the one thing no god had ever learned: when not to fight.',
    figures: [{ key: 'kid1', model: 'arielTeen', size: 0.66, x: -1.7, face: 1, pose: 'charge', t: 0.3, label: 'ΚΡΑΤΟΣ' },
      { key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: 0, face: 1, pose: 'raise', t: 0.6, label: 'ΑΡΙΕΛ' },
      { key: 'kid2', model: 'arielTeen', size: 0.55, x: 1.7, face: -1, pose: 'charge', t: 0.3, label: 'ΔΕΙΜΟΣ' }], cam: { y: 1.0, dist: 13 } },
  { line: 'Anna grew old in the house by the sea. And every storm that ever passed over it stopped there, for a moment, to rest.',
    rosettes: 10, figures: [{ key: 'anna', model: 'anna', size: 0.97, x: 0, face: 1, pose: 'lookUp', t: 1, label: 'ΑΝΝΑ' }], cam: { y: 1.0, dist: 8.5 } },
  { line: 'This is how the story ends. Everything else is how it happens.',
    rosettes: 8, figures: [{ key: 'ariel', model: 'arielGod', stance: 'sword', size: 1.1, x: 0, face: 1, pose: 'raise', t: 1, label: 'ΑΡΙΕΛ' }], cam: { y: 1.2, dist: 12.5 } },
];

/* ------------------------------------------------------------------ wedding and Olympus clothes
   Three static garments (made for mannequins, not for a skeleton) fitted onto the characters for the posed
   scenes of the epilogue: they hang from the character's root while the character stands in a matching pose.
   - tailcoat: its sleeves come out at an angle; they are swung down at the shoulder to hang by his sides
   - dress: the gown, already standing as a woman stands
   - goddess: a gown on a mannequin; the mannequin's head and arms are taken away (her own come through) */
const Garments = {
  defs: {
    tailcoat: { url: 'assets/wedding/tailcoat.glb' },
    dress: { url: 'assets/wedding/dress.glb' },
    goddess: { url: 'assets/wedding/goddess.glb' },
  },
  cache: {},
  /** start loading them all (the ending is long: they are ready well before they are worn) */
  preload() { for (const k in this.defs) this.load(k); },
  load(k) {
    if (this.cache[k]) return this.cache[k];
    const L = new Addons.GLTFLoader();
    return (this.cache[k] = L.loadAsync(this.defs[k].url).then((g) => this.prepare(k, g.scene)).catch((e) => { console.warn('garment failed', k, e); return null; }));
  },
  /** bake each into one group in its own units, feet (or hem) at y = 0, facing +Z, with the fixes it needs */
  prepare(k, sc) {
    sc.updateMatrixWorld(true);
    const out = new THREE.Group(), v = new THREE.Vector3(), n = new THREE.Vector3();
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    sc.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      ['uv1', 'uv2', 'uv3', 'tangent'].forEach((a) => g.deleteAttribute(a));
      const P = g.attributes.position, N = g.attributes.normal;
      if (k === 'tailcoat') {
        // the sleeves leave the shoulder about 39 degrees below level, along an axis from a pivot at (±0.24, 0.8):
        // every sleeve vertex is measured along that axis (t) and around it (r), to be laid onto the wearer's
        // real arm when it is worn (wrapSleeves), shoulder to elbow to wrist
        const SL = { side: new Int8Array(P.count), w: new Float32Array(P.count), t: new Float32Array(P.count), r: new Float32Array(P.count * 3) };
        const d = new THREE.Vector3(), rel = new THREE.Vector3();
        for (let i = 0; i < P.count; i++) {
          v.fromBufferAttribute(P, i);
          // (the armhole is deep: near the shoulder the sleeve reaches well below its axis, down to the armpit)
          const ax = Math.abs(v.x), cy = 0.8 - 0.8 * (ax - 0.24), band = 0.17;
          if (ax < 0.2 || Math.abs(v.y - cy) > band || v.y < 0.28) continue;
          const sg = Math.sign(v.x);
          d.set(sg, -0.8, 0).normalize();
          rel.set(v.x - sg * 0.24, v.y - 0.8, v.z - 0.0);
          const t = rel.dot(d);
          rel.addScaledVector(d, -t);
          SL.side[i] = sg; SL.w[i] = sm(-0.02, 0.06, t); SL.t[i] = t;
          SL.r[i * 3] = rel.x; SL.r[i * 3 + 1] = rel.y; SL.r[i * 3 + 2] = rel.z;
        }
        g.userData.sleeve = SL;
      }
      if (k === 'dress' && o.material.map && o.material.map.image && g.attributes.uv) {
        // the gown came on a dressmaker's dummy: every triangle painted in the dummy's tan goes, the white stays
        const img = o.material.map.image, cv = document.createElement('canvas'), W = 512, H = 512;
        cv.width = W; cv.height = H;
        const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, W, H);
        const px = cx.getImageData(0, 0, W, H).data, UV = g.attributes.uv, flip = o.material.map.flipY;
        const skin = new Uint8Array(P.count);
        for (let i = 0; i < P.count; i++) {
          const u = UV.getX(i) - Math.floor(UV.getX(i)), vv = UV.getY(i) - Math.floor(UV.getY(i));
          const o4 = (Math.min(H - 1, Math.floor((flip ? 1 - vv : vv) * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
          const r = px[o4], gg = px[o4 + 1], bb = px[o4 + 2];
          skin[i] = r > 100 && r - bb > 42 && r - gg > 12 && gg - bb > 12 ? 1 : 0;
        }
        const idx = g.index ? g.index.array : Array.from({ length: P.count }, (_, i) => i), keep = [];
        // (and only the skirt and train are worn, from the waist down: the bodice is her own, in ivory satin)
        for (let t = 0; t < idx.length; t += 3) {
          const yc = (P.getY(idx[t]) + P.getY(idx[t + 1]) + P.getY(idx[t + 2])) / 3;
          if (yc < 3.22 && skin[idx[t]] + skin[idx[t + 1]] + skin[idx[t + 2]] < 2) keep.push(idx[t], idx[t + 1], idx[t + 2]);
        }
        g.setIndex(keep);
      }
      if (k === 'goddess') {
        // the mannequin's head and arms go: whole pieces, told apart by where they stand
        const idx = g.index.array, keep = [];
        const key = new Map(), wid = new Int32Array(P.count);
        for (let i = 0; i < P.count; i++) { const kk = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4); let w = key.get(kk); if (w === undefined) { w = key.size; key.set(kk, w); } wid[i] = w; }
        const par = new Int32Array(key.size).map((_, i) => i), f = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
        for (let t = 0; t < idx.length; t += 3) { const a = f(wid[idx[t]]); par[f(wid[idx[t + 1]])] = a; par[f(wid[idx[t + 2]])] = a; }
        const box = new Map();
        for (let i = 0; i < P.count; i++) { const r = f(wid[i]); let b = box.get(r); if (!b) box.set(r, b = [9, -9, 9, -9]); const x = P.getX(i), y = P.getY(i); b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); }
        const drop = new Map();
        for (const [r, b] of box) {
          const cx = (b[0] + b[1]) / 2, wx = b[1] - b[0];
          const arm = b[2] > 0.38 && Math.abs(cx) > 0.08 && wx < 0.11;
          const head = b[2] > 0.72 && b[3] > 0.9 && wx < 0.16;
          drop.set(r, arm || head);
        }
        for (let t = 0; t < idx.length; t += 3) {
          if (drop.get(f(wid[idx[t]]))) continue;
          const yc = (P.getY(idx[t]) + P.getY(idx[t + 1]) + P.getY(idx[t + 2])) / 3, xc = Math.abs(P.getX(idx[t]) + P.getX(idx[t + 1]) + P.getX(idx[t + 2])) / 3;
          if (yc > 0.86 || (yc > 0.55 && xc > 0.112)) continue;
          keep.push(idx[t], idx[t + 1], idx[t + 2]);
        }
        g.setIndex(keep);
      }
      const m = o.material.clone();
      m.side = THREE.DoubleSide;
      // (the extra UV sets are gone: every map reads the first)
      for (const t of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[t]) { m[t] = m[t].clone(); m[t].channel = 0; m[t].needsUpdate = true; }
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.envMapIntensity = 0.8;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      out.add(mesh);
    });
    const bb = new THREE.Box3().setFromObject(out), top = new THREE.Box3(), p = new THREE.Vector3();
    // (centred on the upper body: a train or a cape spreads the box far behind)
    const yTop = bb.min.y + (bb.max.y - bb.min.y) * 0.7;
    out.children.forEach((c) => { const P = c.geometry.attributes.position; for (let i = 0; i < P.count; i += 7) { p.fromBufferAttribute(P, i); if (p.y > yTop) top.expandByPoint(p); } });
    const cx = top.isEmpty() ? (bb.min.x + bb.max.x) / 2 : (top.min.x + top.max.x) / 2, cz = top.isEmpty() ? (bb.min.z + bb.max.z) / 2 : (top.min.z + top.max.z) / 2;
    out.children.forEach((c) => c.geometry.translate(-cx, -bb.min.y, -cz));
    out.userData.h = bb.max.y - bb.min.y;
    out.userData.pivot = { x: -cx, y: -bb.min.y, z: -cz };   // where the garment's own origin went
    return out;
  },
  /**
   * Put a garment on an actor standing still: its own clothes hidden, the garment scaled from the actor's own
   * measurements (fit: which of the garment's heights meets which joint), and hung from the actor's root
   */
  /**
   * Lay each sleeve onto the wearer's real arm as it is posed now: the upper sleeve along shoulder to elbow,
   * the cuff end along elbow to wrist, each ring of cloth turned with its segment (so no bare arm shows through)
   */
  wrapSleeves(a, g, off) {
    a.root.updateMatrixWorld(true);
    g.updateMatrixWorld(true);
    const inv = g.matrixWorld.clone().invert(), J = a.rig.j, V3 = THREE.Vector3;
    const at = (n2) => J[n2].getWorldPosition(new V3()).applyMatrix4(inv);
    const sm = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };
    const L0 = 0.77, arms = {};
    for (const sg of [1, -1]) {
      // (the garment faces +Z as the character does: its +x side is the character's left)
      const S = at(sg > 0 ? 'armL' : 'armR'), E = at(sg > 0 ? 'elbowL' : 'elbowR'), W = at(sg > 0 ? 'handL' : 'handR');
      const lu = S.distanceTo(E), lf = E.distanceTo(W), te = L0 * lu / (lu + lf);
      const d0 = new V3(sg, -0.8, 0).normalize();
      const dU = E.clone().sub(S).normalize(), dF = W.clone().sub(E).normalize();
      arms[sg] = { S, E, W, te, ku: lu / te, kf: lf / (L0 - te), dU, dF, qU: new THREE.Quaternion().setFromUnitVectors(d0, dU), qF: new THREE.Quaternion().setFromUnitVectors(d0, dF) };
    }
    const pivot = (sg) => new V3(sg * 0.24 + off.x, 0.8 + off.y, off.z);
    const v = new V3(), r = new V3(), pu = new V3(), pf = new V3(), n = new V3(), nu = new V3();
    // each sleeve's tube centred on its axis (the coat's sleeves need not sit exactly on the line it was measured on)
    const mid = { 1: new V3(), '-1': new V3() }, cnt = { 1: 0, '-1': 0 };
    g.children.forEach((c) => { const SL = c.geometry.userData.sleeve; if (!SL) return; for (let i = 0; i < SL.side.length; i++) { const sg = SL.side[i]; if (sg && SL.t[i] > 0.15 && SL.t[i] < 0.65) { mid[sg].x += SL.r[i * 3]; mid[sg].y += SL.r[i * 3 + 1]; mid[sg].z += SL.r[i * 3 + 2]; cnt[sg]++; } } });
    for (const sg of [1, -1]) if (cnt[sg]) mid[sg].divideScalar(cnt[sg]);
    g.children.forEach((c) => {
      const SL = c.geometry.userData.sleeve;
      if (!SL) return;
      c.geometry = c.geometry.clone();
      const P = c.geometry.attributes.position, N = c.geometry.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const sg = SL.side[i], w = SL.w[i];
        if (!sg || w <= 0) continue;
        const A = arms[sg], t = SL.t[i];
        // (let out a good deal: the coat was cut for a slimmer arm than his, which would push through it)
        r.set(SL.r[i * 3], SL.r[i * 3 + 1], SL.r[i * 3 + 2]).sub(mid[sg]).multiplyScalar(1.45 - 0.2 * Math.min(1, Math.max(0, t / L0)));
        // (the shoulder end stays on the coat; the axis point there is the coat's own pivot)
        pu.copy(r).applyQuaternion(A.qU).add(A.S).addScaledVector(A.dU, t * A.ku);
        pf.copy(r).applyQuaternion(A.qF).add(A.E).addScaledVector(A.dF, (t - A.te) * A.kf);
        const b = sm(A.te - 0.05, A.te + 0.05, t);
        v.fromBufferAttribute(P, i);
        const p = pu.lerp(pf, b);
        // near the shoulder, ease from the coat's own shape into the wrapped sleeve: by distance along the arm, so a
        // whole ring of the sleeve moves together (its inner seam must not stay behind and tear open)
        const k = sm(-0.02, 0.06, t);
        P.setXYZ(i, v.x + (p.x - v.x) * k, v.y + (p.y - v.y) * k, v.z + (p.z - v.z) * k);
        n.fromBufferAttribute(N, i);
        nu.copy(n).applyQuaternion(A.qU).lerp(n.clone().applyQuaternion(A.qF), b);
        n.lerp(nu, k).normalize();
        N.setXYZ(i, n.x, n.y, n.z);
      }
      P.needsUpdate = true; N.needsUpdate = true;
      c.geometry.computeBoundingSphere();
    });
    void pivot;
  },
  async wear(a, k, fit) {
    const src = await this.load(k);
    if (!src) return null;
    const g = src.clone();
    a.root.updateMatrixWorld(true);
    const J = a.rig.j, loc = (n2) => a.root.worldToLocal(J[n2].getWorldPosition(new THREE.Vector3()));
    const sh = loc('armL'), sr = loc('armR'), ft = loc('footL');
    const s = fit.s || (sh.y - (fit.foot ?? 0) * Math.max(0, ft.y)) / fit.shoulder;
    const sx = fit.width ? (sh.x - sr.x) / 2 / fit.width : s;
    g.scale.set(sx * (fit.wide || 1), s, s * (fit.deep || 1));
    g.position.set((sh.x + sr.x) / 2 + (fit.x || 0), fit.y || 0, (sh.z + sr.z) / 2 + (fit.z || 0));
    a.root.add(g);
    let liner = null;
    if (k === 'tailcoat') {
      this.wrapSleeves(a, g, src.userData.pivot);
      // a dark lining round his chest: with his arms down, the coat's armholes (cut for arms held out) open a
      // gap under each arm, and only dark cloth may show there
      liner = new THREE.Mesh(new THREE.CapsuleGeometry(1, 1.5, 6, 20), new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.85 }));
      liner.scale.set(0.168, 0.12, 0.118);
      liner.position.set((sh.x + sr.x) / 2, sh.y - 0.2, (sh.z + sr.z) / 2 - 0.01);
      liner.castShadow = liner.receiveShadow = true;
      a.root.add(liner);
      // and his arms slimmer inside the sleeves (the coat was cut for a slighter man): the upper arm most, the
      // forearm less, the hands put back to their own size, so no part of his arm comes through the cloth
      const sk = a.model && a.model.model && a.model.model.userData.skeleton;
      if (sk) {
        const B = (n2) => sk.bones.find((b) => b.name === n2), ku = 0.45, kf = 0.62 / ku;
        this._arms = ['Left', 'Right'].map((S) => [B(S + 'Arm'), B(S + 'ForeArm'), B(S + 'Hand')]).filter((p) => p[0] && p[1] && p[2]);
        this._arms.forEach(([u, f2, h]) => { u.scale.set(ku, 1, ku); f2.scale.set(kf, 1, kf); h.scale.set(1 / (ku * kf), 1, 1 / (ku * kf)); });
      }
    }
    const hidden = [];
    a.root.traverse((o) => { if (o.isMesh && o.visible && fit.hide && fit.hide.test((o.name + ' ' + (o.material && o.material.name)).toLowerCase())) { o.visible = false; hidden.push(o); } });
    return () => {
      a.root.remove(g); hidden.forEach((o) => { o.visible = true; });
      if (liner) a.root.remove(liner);
      if (k === 'tailcoat' && this._arms) { this._arms.forEach((bs) => bs.forEach((b) => b.scale.set(1, 1, 1))); this._arms = null; }
    };
  },
};

const SCRIPTS = {
  intro: {
    async run(c) {
      UI.setFade(1);
      Music.play('none');
      await c.wait(0.8);
      // tools/make_voices.py reads this array for the narrator's lines
      const narration = [
        'Before memory… before the first mortal looked up and named the stars… there was Olympus.',
        'Upon its summit the gods ruled sky, sea and soul. Zeus of the thunder. Poseidon of the deep. Wise Athena. And Hades, keeper of the dead.',
        'But far below, in the black pit of Tartarus, something old was waiting. Something patient.',
        'Kronos. The Devourer of Ages. A father who once swallowed his own children — and swore one day to finish the meal.',
        'When his chains broke, the rot came with him. It crept through the marble halls like a slow, cold tide.',
        'One by one, the Olympians fell. Their divine sparks were torn from their hearts, and scattered across a shattered realm.',
        'With the last of his strength, Zeus hid a single spark where Kronos would never think to look…',
        '…inside a mortal child.',
      ];
      await SCRIPTS.intro.prologue(c, narration);
      // ---------------------------------------------- his ordinary life: home, his mother's story, school
      await SCRIPTS.intro.home(c);
      await SCRIPTS.intro.campus(c);
      // ---------------------------------------------- Westbrook High, that night
      School.build();
      Game.useScene(School.scene);
      Sound.startRain();
      const A = School.ariel, H = School.hermes;
      c.shot(V(14, 30, 70), V(0, 2, 11), 50);
      c.move(V(5, 8, 30), V(0, 1.5, 6), 9, { ease: easeOutCubic });
      UI.fade(0, 2.5);
      UI.chapter('THAT NIGHT', 'Detention · Westbrook High');
      await c.wait(2.2);
      School.strike();
      await c.wait(3.2);
      UI.chapter(null);
      await c.wait(1.2);
      c.shot(V(-2.5, 2.4, -5.1), V(1.5, 1.2, -9.6), 46);
      c.move(V(-1.2, 2.0, -6.8), V(1.5, 1.1, -9.6), 12, { ease: (t) => t });
      await c.say('Ariel', 'Detention. Again. Apparently I "electrocuted" the vending machine.');
      await c.say('Ariel', 'It\'s not my fault metal sparks when I touch it. Nothing about me is ever my fault.');
      School.strike();
      // facing him from just inside the parapet, the city glowing behind the lens
      c.shot(V(3.0, 1.32, -11.2), V(1.5, 1.18, -9.55), 40);
      await c.say('Ariel', '…Seventeen years, and the storms still follow me everywhere.');
      // time stops
      School.freeze = true;
      Sound.setRain(0);
      UI.flash(0.25);
      Sound.tone({ f: 220, f2: 110, dur: 2.5, gain: 0.2, rev: 0.9 });
      await c.wait(1.2);
      c.shot(V(0.2, 1.45, -8), V(1.5, 1.25, -9.6), 34);
      A.rig.headYaw = 0;
      await c.wait(0.4);
      await c.say('Ariel', '…The rain stopped. In mid-air.');
      // Hermes arrives
      H.root.position.set(-1.8, 0.3, -5.8); School.hermesY = 0.3;
      H.root.rotation.y = Math.atan2(1.5 - -1.8, -9.6 - -5.8);
      H.root.visible = true;
      FX.sparks(V(-1.8, 1.2, -5.8), null, 60, [2.6, 2.0, 0.8, 1], 6);
      FX.flashLight(V(-1.8, 2, -5.8), 0xffd28a, 600, 0.6, 20);
      Sound.bell();
      UI.flash(0.35);
      c.shot(V(4.2, 1.8, -3.6), V(0, 1.2, -8), 44);
      School.standUp();
      // up on his feet first, then he turns to face Hermes (turning while still half-seated drags him across the bench)
      await c.wait(1.45);
      A.root.rotation.y = Math.PI;
      const turn = { t: 0 };
      const tid = setInterval(() => { turn.t = Math.min(1, turn.t + 0.04); A.root.rotation.y = lerpAngle(Math.PI, Math.atan2(-1.8 - A.root.position.x, -5.8 - A.root.position.z), easeInOut(turn.t)); if (turn.t >= 1) clearInterval(tid); }, 30);
      await c.say('Hermes', 'Ariel Stormborn. Do you have any idea how hard you are to find? Seventeen years of searching!');
      c.shot(V(-0.6, 1.75, -8.2), V(1.5, 1.42, -9.6), 38);
      await c.say('Ariel', 'Who are you? How did you get up here? Are those… wings on your shoes?');
      c.shot(V(0.9, 1.75, -8), V(-1.8, 1.75, -5.8), 36);
      await c.say('Hermes', 'Hermes. Messenger of the gods. Patron of travelers, thieves, and very late deliveries.');
      await c.say('Hermes', 'Your father sent me. Well — what is left of him.');
      c.shot(V(-0.6, 1.75, -8.2), V(1.5, 1.42, -9.6), 38);
      await c.say('Ariel', 'My father walked out before I was born.');
      c.shot(V(0.9, 1.75, -8), V(-1.8, 1.75, -5.8), 34);
      await c.say('Hermes', 'Your father is Zeus, King of Olympus. And right now, Olympus is dying.');
      c.shot(V(4.2, 1.8, -3.6), V(0, 1.2, -8), 44);
      await c.say('Hermes', 'Kronos has corrupted the gods. Ares, Athena, Poseidon — all of them. Only the blood of Zeus can reclaim their stolen sparks.');
      c.shot(V(-0.6, 1.75, -8.2), V(1.5, 1.42, -9.6), 36);
      await c.say('Ariel', 'I have a chemistry test on Monday.');
      c.shot(V(0.9, 1.75, -8), V(-1.8, 1.75, -5.8), 34);
      H.rig.play('point', { fade: 0.3 });
      await c.say('Hermes', 'Then you had better be quick. Hold still. This is going to sting.');
      // the lightning strike
      c.shot(V(2.5, 0.6, -6.1), V(1.5, 2.2, -9.6), 55);
      c.move(V(3.2, 0.5, -5.2), V(1.5, 2.8, -9.6), 3, { fov: 62 });
      Sound.tone({ type: 'sawtooth', f: 60, f2: 200, dur: 1.4, gain: 0.25, lp: 900 });
      await c.wait(1.0);
      FX.bolt(V(1.0, 120, -16.6), V(1.5, 1.7, -9.6), { radius: 0.18, branches: 6, life: 0.6 });
      FX.bolt(V(4.0, 120, -13.6), V(1.5, 1.4, -9.6), { radius: 0.08, branches: 3, life: 0.5 });
      FX.sparks(V(1.5, 1.4, -9.6), null, 90, [1.6, 2.2, 3.6, 1], 9);
      FX.flashLight(V(1.5, 3, -9.6), 0xb8d4ff, 2500, 0.5, 40);
      School.strike(false);
      Sound.thunder(0);
      A.rig.play('struck', { fade: 0.08 });
      G.cam.shake(1.4);
      UI.flash(1);
      await c.wait(0.9);
      UI.flash(1);
      await UI.fade(1, 0.5);
      Sound.stopRain();
      // ---------------------------------------------- Elysia
      await c.wait(1.2);
      Game.useScene(G.scene);
      SCRIPTS.intro.placeWorld();
      const S = World.sites.start, P = G.player;
      Music.play('title');
      Sound.startWind(); Sound.setWind(1);
      c.shot(V(S.x + 40, S.fy + 60, S.z - 30), V(S.x - 40, S.fy + 80, S.z - 400), 55);
      c.move(V(S.x + 6, S.fy + 3.5, S.z - 24), V(P.pos.x, P.pos.y + 0.6, P.pos.z), 11, { fov: 45 });
      await UI.fade(0, 2.5);
      UI.chapter('CHAPTER I', 'The Shattered Realm of Elysia');
      await c.wait(5.5);
      UI.chapter(null);
      await c.wait(3);
      c.shot(V(P.pos.x + 2.2, P.pos.y + 1.0, P.pos.z - 1.6), V(P.pos.x, P.pos.y + 0.5, P.pos.z), 40);
      P.rig.play('getUp', { fade: 0.2 });
      await c.wait(2.0);
      c.move(V(P.pos.x + 2.8, P.pos.y + 1.8, P.pos.z - 2.8), V(P.pos.x, P.pos.y + 1.3, P.pos.z), 3);
      await c.wait(2.4);
      // the blade answers
      P.parts.sword.visible = true;
      const hand = new THREE.Vector3(); P.rig.j.handR.getWorldPosition(hand);
      FX.sparks(hand, null, 50, [1.4, 1.9, 3.4, 1], 4);
      FX.bolt(hand.clone().add(V(0, 40, 0)), hand, { radius: 0.05, branches: 2, life: 0.3 });
      Sound.zap();
      P.cape.mesh.visible = true; P.cape.needsReset = true;
      c.shot(V(P.pos.x - 2.4, P.pos.y + 1.7, P.pos.z - 3.2), V(P.pos.x + 30, P.pos.y + 12, P.pos.z - 120), 50);
      await c.say('Ariel', 'Ugh… where…? Okay. Okay. That\'s a giant golden tree. That is a GIANT golden tree.');
      // Hermes lands
      const Hm = G.hermes;
      Hm.root.visible = true;
      FX.sparks(Hm.pos.clone().add(V(0, 1, 0)), null, 60, [2.6, 2.0, 0.8, 1], 6);
      Sound.bell();
      c.shot(V(P.pos.x + 1.6, P.pos.y + 1.7, P.pos.z - 1.2), V(Hm.pos.x, Hm.pos.y + 1.6, Hm.pos.z), 40);
      await c.say('Hermes', 'Welcome to Elysia — the Shattered Realm, where the broken pieces of Olympus come to rest.');
      await c.say('Hermes', 'That blade is Keraunos, forged from your father\'s first thunderbolt. It answers only to his blood.');
      c.shot(V(Hm.pos.x - 1.4, Hm.pos.y + 1.7, Hm.pos.z + 1.4), V(P.pos.x, P.pos.y + 1.55, P.pos.z), 40);
      await c.say('Ariel', 'Cool. Cool cool cool. And the mountain with the storm sitting on top of it?');
      c.shot(V(S.x - 6, S.fy + 4, S.z - 30), V(-420, 700, -2800), 42);
      await c.say('Hermes', 'Olympus. Kronos sits upon your father\'s throne. But you are not ready for him — not yet.');
      const R = World.sites.arena;
      c.shot(V(P.pos.x + 1.2, P.pos.y + 2.2, P.pos.z + 3.5), V(R.x, R.y + 30, R.z), 50);
      Hm.rig.play('point', { fade: 0.3 });
      await c.say('Hermes', 'North, past the Agora, stands the Colosseum of Ares. The God of War has fallen to the rot. Free him, and reclaim the Spark of War.');
      Hm.rig.play('talk', { fade: 0.4 });
      c.shot(V(P.pos.x + 1.6, P.pos.y + 1.7, P.pos.z - 1.2), V(Hm.pos.x, Hm.pos.y + 1.6, Hm.pos.z), 40);
      await c.say('Hermes', 'When you are hurt, rest at the Altars of Hestia. Her flame mends flesh… though it also wakes the shades you have slain.');
      c.shot(V(Hm.pos.x - 1.4, Hm.pos.y + 1.7, Hm.pos.z + 1.4), V(P.pos.x, P.pos.y + 1.55, P.pos.z), 40);
      await c.say('Ariel', 'Shades. Ghost soldiers. Great. Love that for me.');
      c.shot(V(P.pos.x + 1.6, P.pos.y + 1.7, P.pos.z - 1.2), V(Hm.pos.x, Hm.pos.y + 1.6, Hm.pos.z), 40);
      await c.say('Hermes', 'Go, Heir of Thunder. I will be watching. Probably from somewhere very safe.');
    },
    /** the fall of Olympus, told by the narrator over the two prologue stages */
    async prologue(c, N) {
      Prologue.build();
      const PR = Prologue;
      // one narrated line over the pictures; word(w) estimates when a word is spoken
      const beat = (i) => {
        const l = N[i];
        UI.subtitle('', l);
        Voice.speak(l, 'Narrator');
        c.active.advance = false;
        const clip = Voice.duration(l, 'Narrator');
        const dur = clip ? clip + 0.5 : clamp(l.length * 0.075, 3.5, 10);
        const t0 = G.time;
        return {
          word: (w) => dur * Math.max(0, l.indexOf(w)) / l.length,
          until: (t) => c.wait(Math.max(0, t0 + t - G.time)),
          end: async (pad = 0.3) => { await c.wait(Math.max(0, t0 + dur - G.time), () => c.active.advance); UI.subtitle(null); await c.wait(pad); },
        };
      };
      const fwd = (a) => V(Math.sin(a.root.rotation.y), 0, Math.cos(a.root.rotation.y));
      // a slow push-in on a face
      const portrait = (a, d = 2.6, side = 0.8, fov = 32, up = 0.05) => {
        const h = PR.head(a), f = fwd(a), r = V(f.z, 0, -f.x);
        const at = (k) => h.clone().addScaledVector(f, d * k).addScaledVector(r, side * k).add(V(0, up, 0));
        c.shot(at(1), h.clone().add(V(0, -0.12, 0)), fov);
        c.move(at(0.82), h.clone().add(V(0, -0.08, 0)), 5, { ease: (t) => t });
      };

      // ---- 0 · Olympus, floating above the clouds at the dawn of the world
      Game.useScene(PR.olympus);
      Music.play('title');
      Sound.startWind(); Sound.setWind(1);
      c.shot(V(-95, 4, 170), V(0, 4, 0), 38);
      c.move(V(-30, 10, 52), V(0, 6, -6), 16, { ease: easeOutCubic });
      UI.fade(0, 3.5);
      await c.wait(1.6);
      let b = beat(0);
      await b.end(0.2);

      // ---- 1 · the gods
      b = beat(1);
      c.shot(V(0.8, 4.2, -5), V(0, 3.0, -15), 34);
      c.move(V(0.5, 3.6, -8.5), V(0, 2.9, -15), 6, { ease: (t) => t });
      await b.until(b.word('Poseidon'));
      portrait(PR.poseidon);
      await b.until(b.word('Wise Athena'));
      portrait(PR.athena, 2.4, -0.7);
      await b.until(b.word('Hades'));
      portrait(PR.hades, 3.0, 0.9, 34);
      await b.end(0.2);

      // ---- 2 · down into Tartarus
      await UI.fade(1, 0.8);
      Game.useScene(PR.tartarus);
      Music.play('none');
      Sound.setWind(0.3);
      Sound.tone({ type: 'sawtooth', f: 41, f2: 38, dur: 9, gain: 0.1, lp: 260, attack: 2, rev: 0.7 });
      c.shot(V(3, 26, 30), V(0, 1.6, 0), 46);
      c.move(V(3.6, 3.4, 10.5), V(0, 2.4, 0), 10, { ease: easeOutCubic });
      UI.fade(0, 2.2);
      b = beat(2);
      await b.end(0.2);

      // ---- 3 · Kronos
      const K = PR.kronos, kh = PR.head(K);
      // low, in front of the bowed helm: when he lifts his head the visor finds the lens
      c.shot(kh.clone().add(V(0.9, -1.1, 3.6)), kh.clone().add(V(0, -0.2, 0)), 30);
      c.move(kh.clone().add(V(0.5, -0.8, 2.6)), kh.clone().add(V(0, 0.1, 0)), 9, { ease: (t) => t });
      b = beat(3);
      await b.until(b.word('Devourer'));
      Sound.roar(0.35, 0.55);
      Sound.tone({ f: 55, f2: 40, dur: 3, gain: 0.18, rev: 0.8 });
      const lift0 = G.time;
      await c.wait(2.6, () => {
        const u = easeInOut(clamp((G.time - lift0) / 2.4, 0, 1));
        K.rig.headPitch = -0.95 * u;
        K.setEyes(lerp(0.25, 1, u));
        return false;
      });
      await b.end(0.1);

      // ---- 4 · the chains break and the rot rises into Olympus
      c.shot(V(-8.5, 2.2, 10), V(0, 2.6, 0), 46);
      K.rig.play('breakChains', { fade: 0.25 });
      b = beat(4);
      await c.wait(4.2 * 0.31);
      PR.breakChains();
      Sound.boom(1); Sound.thunder(0); G.cam.shake(1.4);
      UI.flash(0.45);
      FX.sparks(PR.hand(K, 'L'), null, 40, [1.6, 0.6, 2.6, 1], 8);
      FX.sparks(PR.hand(K, 'R'), null, 40, [1.6, 0.6, 2.6, 1], 8);
      FX.ring(V(0, 0.1, 0), 9, { color: [1.4, 0.4, 2.4], life: 0.9 });
      Music.play('boss');
      c.move(V(-6, 1.2, 12.5), V(0, 4.2, 0), 2.6, { ease: easeOutCubic });
      await b.until(Math.max(b.word('the rot') - 0.4, 2.8));
      Game.useScene(PR.olympus);
      PR.rotOn = true;
      c.shot(V(0, 0.9, 25), V(0, 1.2, -10), 52);
      c.move(V(0, 2.4, 14), V(0, 2.4, -15), 9, { ease: (t) => t });
      await b.end(0.2);

      // ---- 5 · one by one, the Olympians fall
      const KH = PR.kronosHall;
      KH.root.visible = true;
      KH.setEyes(1);
      KH.walk = { from: V(0, 0, 23), to: V(0, 0, 7), t: 0, dur: 7 };
      b = beat(5);
      // the Titan walks out of the mist
      c.shot(V(3.2, 0.7, 4), V(0, 3.6, 16), 44);
      c.move(V(2.6, 0.8, 2.5), V(0, 3.8, 12), 2.2, { ease: (t) => t });
      await c.wait(2.0);
      KH.rig.play('absorb', { fade: 0.4 });
      // each god falls and their spark is torn away toward his raised hand
      const falls = [[PR.poseidon, 'deathFwd'], [PR.athena, 'kneelBowed'], [PR.hades, 'struck'], [PR.ares, 'kneelBowed']];
      for (let i = 0; i < falls.length; i++) {
        const [g, clip] = falls[i], h = PR.head(g), f = fwd(g), r = V(f.z, 0, -f.x);
        c.shot(h.clone().addScaledVector(f, 4.6).addScaledVector(r, 1.4).add(V(0, -0.5, 0)), h.clone().add(V(0, -0.7, 0)), 40);
        g.rig.play(clip, { fade: 0.35 });
        PR.tearSpark(g, 0.3);
        Sound.roar(1.3 - i * 0.15, 0.3);
        if (g === PR.hades) {
          // the rot does not just take Hades' spark: it remakes him into what rules the underworld now
          await c.wait(0.8);
          PR.corruptHades();
          await c.wait(1.7);
        } else await c.wait(1.3);
      }
      c.shot(V(3.4, 2.0, 12.5), PR.hand(KH).add(V(0, -1.2, 0)), 42);
      await b.end(0.2);

      // ---- 6 · Zeus rises and casts his last spark down to the mortal world
      b = beat(6);
      const Z = PR.zeus;
      PR.zeusGlow = true;
      Z.rig.play('standFromSit', { fade: 0.3 });
      c.shot(V(2.4, 1.6, -9.6), PR.head(Z).add(V(0, 0.6, 0)), 40);
      await c.wait(1.6);
      Z.rig.play('raise', { fade: 0.4 });
      Z.sparkHeld = true;
      Sound.tone({ type: 'sawtooth', f: 70, f2: 240, dur: 3, gain: 0.18, lp: 1200 });
      await c.wait(1.0);
      // low and in front of him: the king's face and the last spark held high above it, in one frame
      const zh = PR.head(Z), zs = PR.hand(Z);
      c.shot(V(zh.x + 1.7, zh.y - 1.15, zh.z + 5.4), zh.clone().lerp(zs, 0.42), 40);
      c.move(V(zh.x + 1.3, zh.y - 1.0, zh.z + 4.6), zh.clone().lerp(zs, 0.45), 3.5, { ease: (t) => t });
      await b.end(0);
      // the bolt falls through the clouds
      Music.play('none');
      const from = PR.hand(Z), rim = V(13, 0.4, 20), sea = V(46, -75, 74);
      Z.spark.visible = false; Z.sparkGone = true;
      // seen from outside: the bolt leaps off the edge of Olympus and dives into the clouds
      c.shot(V(110, -18, 165), V(26, -28, 40), 44);
      c.move(V(96, -40, 150), V(38, -62, 64), 2.6);
      FX.bolt(from, rim, { radius: 0.5, branches: 3, life: 1.2 });
      FX.bolt(rim, sea, { radius: 1.1, branches: 8, life: 1.3 });
      FX.bolt(rim, sea.clone().add(V(-14, 0, 9)), { radius: 0.45, branches: 4, life: 1.0 });
      FX.flashLight(sea.clone().add(V(0, 6, 0)), 0xb8d4ff, 6000, 0.9, 260);
      PR.cloudU.uFlash.value = 1.6;
      Sound.thunder(0); G.cam.shake(1.0);
      UI.flash(0.8);
      await c.wait(1.8);
      UI.flash(1);
      await UI.fade(1, 0.5);
      Sound.setWind(0);

      // ---- 7 · …inside a mortal child
      await c.wait(0.6);
      const l = N[7];
      UI.card(l);
      Voice.speak(l, 'Narrator');
      c.active.advance = false;
      const clip = Voice.duration(l, 'Narrator');
      await c.wait(clip ? clip + 1.0 : 3.5, () => c.active.advance);
      UI.card(null);
      await c.wait(1.2);
    },
    /**
     * Morning at the Stormborn house. Ariel and his mother Anna; the lights flicker when he loses his
     * temper, and for the first time she tells him about his father (her memory: the pier, the storm, Zeus)
     */
    async home(c) {
      Home.build(); Memory.build();
      const Hm = Home, A = Hm.ariel, M = Hm.anna;
      Game.useScene(Hm.scene);
      Sound.startRain(); Sound.setRain(0.35);
      Music.play('none');
      // places: Anna at the counter, Ariel in the hall
      M.root.position.set(-1.25, 0, -2.09); M.root.rotation.y = Math.PI; M.rig.stop(0.01);
      Hm.holdMug(true);
      A.root.position.set(-5.0, 0, -0.05); A.root.rotation.y = Math.PI / 2; A.rig.stop(0.01);
      const head = (b, up = 1.58) => b.root.position.clone().add(V(0, up, 0));
      c.shot(V(3.15, 1.75, 2.75), V(-0.8, 1.0, -1.6), 52);
      c.move(V(2.7, 1.6, 2.35), V(-0.9, 1.05, -1.6), 9, { ease: (t) => t });
      UI.fade(0, 2.2);
      UI.chapter('PRESENT DAY', 'The Stormborn house · 7:42 a.m.');
      await c.wait(3.6);
      UI.chapter(null);
      await c.say('Anna', 'Ariel! You have eight minutes, and I have watched you lose a fight with a sock for longer than that.');
      A.route([[-3.0, -0.05], [-1.5, 0.35], [-0.35, 0.55]], 1.3);
      // from inside the kitchen, onto the hall doorway he comes through
      c.shot(V(0.2, 1.6, 2.2), V(-3.4, 1.3, -0.1), 44);
      c.move(V(-0.6, 1.58, 2.3), V(-1.0, 1.25, 0.2), 4.5);
      await c.wait(2.2);
      await c.say('Ariel', 'I\'m up. Mostly. Is that coffee?');
      await c.wait(3, () => A.arrived());
      A.faceTo(M.root.position.x, M.root.position.z);
      M.faceTo(A.root.position.x, A.root.position.z);
      // over his shoulder, onto her
      c.shot(A.root.position.clone().add(V(0.55, 1.62, 0.75)), head(M, 1.5), 40);
      await c.say('Anna', 'It\'s mine. Yours is orange juice and a lecture.');
      c.shot(M.root.position.clone().add(V(-0.45, 1.55, 0.35)), head(A, 1.55), 40);
      await c.say('Ariel', 'Can I skip to the juice?');
      c.shot(A.root.position.clone().add(V(0.55, 1.62, 0.75)), head(M, 1.5), 38);
      await c.say('Anna', 'Mrs. Patterson called. Every microscope in the science lab fried at once. While you were standing next to them.');
      A.rig.play('shrug', { fade: 0.2 });
      c.shot(M.root.position.clone().add(V(-0.45, 1.55, 0.35)), head(A, 1.55), 38);
      await c.say('Ariel', 'That\'s a coincidence. Electronics hate me. It\'s a known thing.');
      c.shot(A.root.position.clone().add(V(0.4, 1.6, 0.6)), head(M, 1.52), 34);
      await c.say('Anna', 'Electronics hated your father, too.');
      await c.wait(0.6);
      c.shot(V(0.9, 1.35, 1.9), V(-0.6, 1.4, -0.6), 40);
      await c.say('Ariel', 'You never talk about him.');
      await c.say('Anna', 'You never ask.');
      c.shot(M.root.position.clone().add(V(-0.35, 1.5, 0.3)), head(A, 1.55), 34);
      c.move(M.root.position.clone().add(V(-0.3, 1.52, 0.55)), head(A, 1.56), 6, { ease: (t) => t });
      // his temper reaches the wiring before it reaches his voice
      Hm.stutter(1.6);
      const t = Hm.toaster.position.clone().add(V(0, 0.12, 0));
      setTimeout(() => { FX.sparks(t, V(0, 1, 0.3), 26, [1.4, 1.9, 3.4, 1], 4); Sound.zap(); }, 900);
      await c.say('Ariel', 'Because the answer is always "he had to go." Seventeen years, Mom. Who just goes?');
      c.shot(V(0.3, 2.0, 1.3), V(0.75, 2.0, 0.75), 46);
      await c.wait(1.4);
      c.shot(A.root.position.clone().add(V(0.4, 1.58, 0.6)), head(M, 1.52), 32);
      c.move(A.root.position.clone().add(V(0.3, 1.56, 0.4)), head(M, 1.52), 8, { ease: (t) => t });
      await c.say('Anna', '…Sit down. You want to know? Then I\'ll tell you. All of it. Just once.');
      await c.say('Anna', 'It was the summer I turned twenty. The worst storm this town has ever seen — and I was the only fool out on the old pier, watching it come in.');
      await UI.fade(1, 1.4);

      // ---- her memory: the pier, the storm, the man who walked out of it
      const Me = Memory, YA = Me.anna, Z = Me.zeus, L = Me.lampAt;
      Game.useScene(Me.scene);
      Sound.setRain(0.9); Sound.startWind(); Sound.setWind(0.8);
      YA.root.position.set(L.x - 0.55, 0, L.z + 0.25); YA.root.rotation.y = 0.2; YA.rig.stop(0.01);
      Z.root.visible = false; Z.root.position.set(0.1, 0, -9); Z.root.rotation.y = 0; Z.rig.stop(0.01);
      Me.baby.visible = false;
      c.shot(V(-2.2, 1.9, 2.0), V(L.x, 1.6, L.z + 3), 42);
      c.move(V(-1.6, 1.7, 3.4), V(L.x, 1.5, L.z + 4), 9, { ease: (t) => t });
      UI.fade(0, 2.0);
      await c.wait(1.0);
      Me.strike(false);
      await c.wait(1.6);
      Me.strike(true);
      Z.root.visible = true;
      Z.route([[0.2, 2.0], [0.15, L.z - 1.1]], 1.15);
      await c.say('Anna', 'He walked out of the rain like it was parting for him. He didn\'t run. He didn\'t even get wet.');
      // over her shoulder, down the pier at him coming out of the rain (in front of her, she hid him)
      c.shot(V(L.x - 1.5, 1.65, L.z + 1.3), V(0.2, 1.7, L.z - 3.5), 44);
      c.move(V(L.x - 1.35, 1.62, L.z + 1.0), V(0.2, 1.7, L.z - 1.8), 5.5, { ease: (t) => t });
      await c.wait(6, () => Z.arrived());
      YA.faceTo(Z.root.position.x, Z.root.position.z);
      Z.faceTo(YA.root.position.x, YA.root.position.z);
      await c.wait(0.8);
      const zH = () => Z.root.position.clone().add(V(0, 1.82, 0)), aH = () => YA.root.position.clone().add(V(0, 1.55, 0));
      const zDir = () => YA.root.position.clone().sub(Z.root.position).setY(0).normalize();
      const side = () => { const d = zDir(); return V(d.z, 0, -d.x); };
      // over a shoulder, never through a head: he is two metres tall, so the lens stays under his ear and wide of it
      const overHer = () => c.shot(YA.root.position.clone().addScaledVector(zDir(), 1.15).addScaledVector(side(), 0.5).add(V(0, 1.5, 0)), zH(), 38);
      // well wide of his shoulder: from straight behind, his mane of locks fills the frame
      const overHim = () => c.shot(Z.root.position.clone().addScaledVector(zDir(), -0.95).addScaledVector(side(), -1.1).add(V(0, 1.55, 0)), aH(), 40);
      overHer();
      await c.say('Zeus', 'You are not afraid of the storm.');
      overHim();
      await c.say('Anna', 'Should I be?');
      overHer();
      await c.say('Zeus', 'Most mortals are.');
      overHim();
      await c.say('Anna', 'Most people don\'t say "mortals."');
      c.shot(V(-2.4, 2.4, L.z - 1.5), V(0.4, 1.5, L.z + 0.2), 40);
      c.move(V(-2.0, 2.6, L.z - 3.5), V(0.4, 1.6, L.z + 0.4), 8, { ease: (t) => t });
      Me.strike(false);
      await c.say('Anna', 'He stayed the whole summer. I never asked where he came from. I think part of me already knew.');
      await UI.fade(1, 1.2);
      // ---- the night Ariel was born: the same lamp, a worse storm, a newborn in her arms
      Z.root.visible = false;
      YA.root.position.set(L.x - 0.6, 0, L.z + 0.2); YA.root.rotation.y = -0.35;
      YA.rig.play('cradle', { fade: 0.01 }); Me.carry(YA);
      Me.rain.speed = 1.4; Sound.setRain(1);
      c.shot(V(1.6, 1.6, L.z + 2.4), YA.root.position.clone().add(V(0, 1.25, 0)), 38);
      c.move(V(1.3, 1.5, L.z + 1.8), YA.root.position.clone().add(V(0, 1.2, 0)), 9, { ease: (t) => t });
      UI.fade(0, 1.6);
      await c.say('Anna', 'He left before you were born. And the night you came into the world, every light in the hospital went out — and he was there. Just for a moment.');
      // he is simply there, in the flash
      Z.root.position.set(L.x + 0.35, 0, L.z - 0.5); Z.root.rotation.y = Math.atan2(YA.root.position.x - Z.root.position.x, YA.root.position.z - Z.root.position.z);
      Z.rig.stop(0.01);
      Me.strike(true); Z.root.visible = true;
      // (the lightning and the screen flash carry the moment; a light this close only has to catch them)
      FX.flashLight(Z.root.position.clone().add(V(0, 1.8, 0)), 0xb8d4ff, 200, 0.5, 12);
      c.shot(V(-1.2, 1.7, L.z + 1.0), V(L.x, 1.6, L.z - 0.2), 40);
      await c.wait(1.6);
      // she lets him hold his son
      Z.rig.play('cradle', { fade: 0.5 }); YA.rig.stop(0.5);
      await c.wait(0.5);
      Me.carry(Z);
      // in front of him, a little to the side: the god looking down at his son
      const zf = () => V(Math.sin(Z.root.rotation.y), 0, Math.cos(Z.root.rotation.y)), zr = () => { const f = zf(); return V(f.z, 0, -f.x); };
      const babyAt = () => Me.baby.getWorldPosition(new THREE.Vector3());
      // (from his left: from his right the pier's lamp post stands in the way)
      c.shot(Z.root.position.clone().addScaledVector(zf(), 1.7).addScaledVector(zr(), -0.6).add(V(0, 1.55, 0)), babyAt().add(V(0, 0.25, 0)), 34);
      c.move(Z.root.position.clone().addScaledVector(zf(), 1.35).addScaledVector(zr(), -0.45).add(V(0, 1.5, 0)), babyAt().add(V(0, 0.22, 0)), 8, { ease: (t) => t });
      await c.say('Zeus', 'Ariel. My son.');
      // thunder of his own, and something else: a red ember beside the blue (Ares' shard, though no one here knows it)
      const chest = Me.baby.getWorldPosition(new THREE.Vector3());
      FX.sparks(chest, V(0, 1, 0), 40, [1.4, 1.9, 3.4, 1], 2.5);
      FX.flashLight(chest, 0x9cc4ff, 260, 0.9, 6);
      setTimeout(() => { FX.sparks(chest, V(0, 1, 0), 14, [3, 0.7, 0.2, 1], 1.8); FX.flashLight(chest, 0xff5020, 160, 0.8, 5); }, 1300);
      Sound.zap();
      await c.say('Zeus', 'I give you my thunder… and a heart for war that is not mine to give. Forgive me, little one. You will need them both.');
      // over her other shoulder: this night he stands where the lamp post would cut her from him
      const overHerLamp = () => c.shot(YA.root.position.clone().addScaledVector(zDir(), 1.1).addScaledVector(side(), -0.55).add(V(0, 1.5, 0)), zH(), 38);
      overHerLamp();
      await c.say('Zeus', 'When the storms come looking for him, I will send someone. Until then, keep him close. Keep him kind.');
      overHerLamp();
      Z.rig.stop(0.5); YA.rig.play('cradle', { fade: 0.5 });
      await c.wait(0.4);
      Me.carry(YA);
      // on her, from where he stands (he is behind the lens)
      c.shot(aH().addScaledVector(zDir(), -1.25).addScaledVector(side(), 0.35).add(V(0, 0.05, 0)), aH(), 36);
      await c.say('Anna', 'Will we ever see you again?');
      // from his left, at his height: his face lifted to the storm (in front of him she stood in the way)
      c.shot(Z.root.position.clone().addScaledVector(zf(), 1.6).addScaledVector(zr(), -1.3).add(V(0, 1.6, 0)), zH().add(V(0, 0.15, 0)), 42);
      Z.rig.play('lookUp', { fade: 0.5 });
      await c.say('Zeus', 'Look up, whenever it storms.');
      Me.strike(true);
      UI.flash(1);
      Z.root.visible = false;
      await c.wait(1.6);
      await UI.fade(1, 1.6);
      Me.baby.visible = false; Me.rain.speed = 1;

      // ---- back in the kitchen
      Game.useScene(Hm.scene);
      Sound.setRain(0.35); Sound.setWind(0);
      Hm.flicker = 0;
      A.rig.stop(0.01); M.rig.stop(0.01);
      Hm.holdMug(true);
      A.faceTo(M.root.position.x, M.root.position.z); M.faceTo(A.root.position.x, A.root.position.z);
      for (let i = 0; i < 30; i++) { A.update(0.05); M.update(0.05); }
      c.shot(V(0.9, 1.35, 1.9), V(-0.7, 1.4, -0.7), 40);
      c.move(V(0.6, 1.4, 1.5), V(-0.7, 1.45, -0.8), 9, { ease: (t) => t });
      UI.fade(0, 1.6);
      await c.say('Anna', 'Look up whenever it storms. That\'s all he left me. That, and you.');
      c.shot(M.root.position.clone().add(V(-0.45, 1.55, 0.35)), head(A, 1.55), 38);
      await c.say('Ariel', 'Mom. You\'re telling me Dad was some kind of… weather guy.');
      c.shot(A.root.position.clone().add(V(0.55, 1.62, 0.75)), head(M, 1.5), 36);
      await c.say('Anna', 'I didn\'t say what he was.');
      c.shot(M.root.position.clone().add(V(-0.45, 1.55, 0.35)), head(A, 1.55), 36);
      await c.say('Ariel', 'You kind of did.');
      // (her coffee goes back on the counter on the cut)
      Hm.holdMug(false);
      M.rig.play('offer', { fade: 0.4 });
      c.shot(V(0.9, 1.35, 1.9), V(-0.7, 1.4, -0.7), 40);
      await c.say('Anna', 'Take the umbrella. It\'s going to storm.');
      await c.say('Ariel', 'It always storms.');
      M.rig.stop(0.5);
      c.shot(A.root.position.clone().add(V(0.4, 1.6, 0.6)), head(M, 1.52), 34);
      await c.say('Anna', 'Around you, it does. Now go, you\'ll be late. And Ariel? Be kind today.');
      A.route([[-1.5, 0.35], [-3.0, -0.05], [-5.0, -0.05]], 1.3);
      c.shot(V(2.6, 1.6, 2.2), V(-2.4, 1.1, -0.2), 46);
      await c.wait(2.6);
      await UI.fade(1, 1.2);
    },

    /** the same morning at Westbrook High: Jesse on the planter ledge, and a vending machine that eats his dollar */
    async campus(c) {
      Campus.build();
      const S = Campus, A = S.ariel, J = S.jesse, B = S.boy;
      Game.useScene(S.scene);
      Sound.stopRain(); Sound.startWind(); Sound.setWind(0.5);
      // Jesse waits at the foot of the steps, thumbs on her phone
      const jp = S.jessePos, seat = jp, jH = () => J.root.position.clone().add(V(0, 1.5, 0));
      J.root.position.copy(jp); J.root.rotation.y = 0.35; J.texting(true); J.look(0, 0);
      J.screen.material.color.setRGB(0.55, 0.7, 0.95);
      A.root.position.set(16, 0, 2.2); A.root.rotation.y = -Math.PI / 2; A.rig.stop(0.01);
      B.rig.play('talk', { fade: 0.01 });
      S.vend.dead = false; S.vend.front.emissiveIntensity = 0.55; S.vend.light.intensity = 1.6;
      S.principal.root.visible = false;
      const stand = V(jp.x + 0.35, 0, jp.z + 1.15);
      A.route([[9, 1.8], [stand.x + 0.4, stand.z + 0.4], [stand.x, stand.z]], 1.35);
      c.shot(V(12.5, 1.55, 6.2), V(4, 1.3, -2.2), 48);
      c.move(V(10.5, 1.5, 5.0), V(3.6, 1.2, -2.0), 10, { ease: (t) => t });
      UI.fade(0, 2.0);
      UI.chapter('WESTBROOK HIGH', 'The same morning');
      await c.wait(4.2);
      UI.chapter(null);
      await c.wait(9, () => A.arrived());
      A.faceTo(jp.x, jp.z);
      // the two of them, face to face; and over each one's shoulder onto the other
      const aj = () => J.root.position.clone().sub(A.root.position).setY(0).normalize(), sideOf = (d) => V(d.z, 0, -d.x);
      const overHim = () => { const d = aj(); c.shot(A.root.position.clone().addScaledVector(d, -0.75).addScaledVector(sideOf(d), 0.42).add(V(0, 1.6, 0)), jH(), 36); };
      const onHim = () => { const d = aj(); c.shot(J.root.position.clone().addScaledVector(d, 0.7).addScaledVector(sideOf(d), -0.4).add(V(0, 1.5, 0)), A.root.position.clone().add(V(0, 1.58, 0)), 36); };
      const twoShot = () => { const d = aj(), m = A.root.position.clone().lerp(J.root.position, 0.5); c.shot(m.clone().addScaledVector(sideOf(d), 2.4).add(V(0, 1.45, 0)), m.clone().add(V(0, 1.3, 0)), 40); };
      twoShot();
      await c.say('Jesse', 'You\'re late, Stormborn. Even for you.');
      onHim();
      await c.say('Ariel', 'Family thing.');
      // she looks up from her phone, at him
      J.texting(false);
      J.faceTo(A.root.position.x, A.root.position.z);
      J.look(0, -0.05);
      overHim();
      await c.wait(0.8);
      await c.say('Jesse', 'Is this about the microscopes? Because the whole school thinks you have a superpower. Mostly the power of breaking stuff.');
      onHim();
      await c.say('Ariel', 'It\'s a gift.');
      J.look(0.12, -0.02);
      overHim();
      await c.say('Jesse', 'Uh-huh. You okay? You look like someone just told you a ghost story.');
      onHim();
      await c.say('Ariel', 'Something like that.');
      // his luck with electronics, again
      J.texting(true); J.look(0, 0);
      setTimeout(() => J.phoneDies(), 900);
      twoShot();
      await c.say('Jesse', 'Ugh, my phone just died. Again. Every single time you stand next to me.');
      J.texting(false); J.look(0, -0.05);
      onHim();
      await c.say('Ariel', 'Sorry. Happens a lot.');
      overHim();
      await c.say('Jesse', 'Lab partners don\'t let lab partners brood before first period. Buy me a soda, and I\'ll let you copy my chem homework.');
      onHim();
      await c.say('Ariel', 'Deal.');
      // around the steps to the machine
      const vf = S.vendFront;
      A.route([[1.2, -0.9], [-2.9, -1.6], [vf.x, vf.z + 0.15]], 1.3);
      setTimeout(() => J.faceTo(vf.x, vf.z), 1200);
      c.shot(V(-1.2, 1.7, 2.6), V(-2.4, 1.2, -3.0), 46);
      c.move(V(-2.0, 1.65, 0.8), V(-3.4, 1.25, -4.2), 6);
      await c.wait(9, () => A.arrived());
      A.faceTo(vf.x, vf.z - 2);
      await c.wait(0.6);
      c.shot(vf.clone().add(V(1.1, 1.55, 0.9)), vf.clone().add(V(-0.1, 1.15, -0.7)), 42);
      A.rig.play('point', { fade: 0.25 });
      Sound.ui('move'); setTimeout(() => Sound.ui('move'), 300); setTimeout(() => Sound.ui('back'), 900);
      await c.wait(1.2);
      A.rig.stop(0.3);
      await c.say('Ariel', 'Come on. Come on… I literally just paid you.');
      A.rig.play('thump', { fade: 0.08 });
      await c.wait(0.32);
      S.fry();
      G.cam.shake(0.7);
      B.rig.play('startle', { fade: 0.08 });
      await c.wait(1.3);
      B.rig.play('talk', { fade: 0.5 });
      c.shot(V(-7.6, 1.6, -0.6), B.root.position.clone().add(V(0.3, 1.5, 0)), 42);
      await c.say('Marcus', 'Dude. Did you just electrocute the vending machine?');
      // Principal Steinback pushes out through the doors onto the landing
      const Pr = S.principal, D = S.doorAt;
      Pr.root.position.set(D.x, S.landingY, D.z); Pr.root.rotation.y = 0; Pr.rig.stop(0.01);
      Pr.root.visible = true;
      Sound.gate();
      Pr.go(D.x - 0.3, D.z + 1.45, 1.35);
      c.shot(V(-1.5, 1.55, -0.4), V(0.2, S.landingY + 1.4, D.z + 0.9), 40);
      await c.wait(1.7);
      Pr.faceTo(A.root.position.x, A.root.position.z);
      A.faceTo(Pr.root.position.x, Pr.root.position.z);
      await c.wait(0.4);
      Pr.rig.play('point', { fade: 0.3 });
      c.shot(V(-0.6, S.landingY + 1.25, D.z + 3.9), V(0.15, S.landingY + 1.6, D.z + 1.3), 36);
      await c.say('Principal', 'STORMBORN! My office. Now. And after school, you can spend the evening in detention, thinking about school property.');
      Pr.rig.stop(0.6);
      // Jesse, across the yard, trying not to laugh
      J.faceTo(A.root.position.x, A.root.position.z); J.look(0.1, 0.04);
      const toJ = () => J.root.position.clone().sub(A.root.position).setY(0).normalize();
      c.shot(J.root.position.clone().addScaledVector(toJ(), -1.25).addScaledVector(V(toJ().z, 0, -toJ().x), 0.35).add(V(0, 1.55, 0)), jH(), 34);
      await c.say('Jesse', 'My hero.');
      A.faceTo(jp.x, jp.z);
      c.shot(V(-1.6, 1.6, -1.0), A.root.position.clone().add(V(0, 1.55, 0)), 40);
      await c.say('Ariel', 'I\'ll get you that soda later.');
      c.shot(J.root.position.clone().addScaledVector(toJ(), -1.25).addScaledVector(V(toJ().z, 0, -toJ().x), 0.35).add(V(0, 1.55, 0)), jH(), 34);
      await c.say('Jesse', 'You\'d better. See you in chem, Stormborn.');
      await UI.fade(1, 1.4);
      Sound.setWind(0);
    },

    placeWorld() {
      const S = World.sites.start, P = G.player;
      P.setPosition(S.x, S.z - 15.2, Math.PI);
      P.pos.y = World.getHeight(P.pos.x, P.pos.z, S.fy + 1);
      P.rig.play('lying', { fade: 0.01 });
      P.parts.sword.visible = false;
      P.cape.mesh.visible = false;
      G.hermes.place(S.x + 3.4, S.z - 21, -2.4);
      G.hermes.root.visible = false;
    },
    async finish() {
      if (G.activeScene !== G.scene) { Game.useScene(G.scene); }
      Sound.stopRain();
      Sound.startWind(); Sound.setWind(1);
      const S = World.sites.start, P = G.player;
      P.setPosition(S.x, S.z - 20, Math.PI);
      P.parts.sword.visible = true;
      P.cape.mesh.visible = true; P.cape.needsReset = true;
      P.rig.stop(0.2);
      G.hermes.place(S.x + 3.4, S.z - 21, -2.4);
      G.hermes.root.visible = true;
      G.hermes.rig.play('talk', { fade: 0.2 });
      G.flags.introDone = true;
      Game.save();
      await Game.startPlay({ fadeIn: true });
      UI.area('Temple of Dawn');
      setTimeout(() => UI.hint('<b>WASD</b> move · <b>Mouse</b> look · <b>Shift</b> sprint<br><b>Space</b> roll · <b>Left click</b> attack · <b>Right click</b> thunder slam', 9), 2500);
      setTimeout(() => UI.hint('<b>Q</b> Zeus\'s Bolt · <b>R</b> drink Ambrosia · <b>Tab</b> lock on<br>Kindle the <b>Altar of Dawn</b> with <b>E</b> before heading north.', 9), 13000);
    },
  },

  /**
   * The Mirror. Why god-mode Ariel wears Ares' armour and face: seventeen years ago Zeus cut a shard of
   * Ares' war-spark and sealed it in the infant beside his own thunder, so a mortal child could survive
   * the hunt. Ares was never asked; the grudge was the crack Kronos' rot crept in through. And through
   * that shard the corrupted Ares can reach in and seize Ariel (see Player.seize), until Ares is freed.
   */
  mirror: {
    async run(c) {
      const P = G.player, B = G.boss, Hm = G.hermes;
      // he turns into the low sun: it lights his face, and no shot of him looks into its glare
      P.heading = Math.atan2(World.sunDir.x, World.sunDir.z) + 0.45;
      const h = P.heading, f = V(Math.sin(h), 0, Math.cos(h)), r = V(Math.cos(h), 0, -Math.sin(h));
      const at = (fw, rt, up) => P.pos.clone().addScaledVector(f, fw).addScaledVector(r, rt).add(V(0, up, 0));
      const head = () => P.pos.clone().add(V(0, 1.6, 0));
      // his heart pounds and the world bleeds red while Ares is inside him
      const pulse = { on: true };
      const beat = () => { if (!pulse.on || !Cutscene.active) return; Sound.heartbeat(0.9); setTimeout(beat, 950); };
      Music.play('none');
      Sound.tone({ type: 'sawtooth', f: 46, f2: 41, dur: 6, gain: 0.08, lp: 300, attack: 1.5, rev: 0.7 });
      P.rig.play('clutch', { fade: 0.3 });
      G.post.possess = 0.55;
      beat();
      G.cam.shake(0.4);
      c.shot(at(3.6, 2.1, 1.35), head().add(V(0, -0.15, 0)), 38);
      c.move(at(2.8, 1.6, 1.5), head().add(V(0, -0.1, 0)), 7, { ease: (t) => t });
      await c.wait(1.4);
      await c.say('Ares', 'Do you feel it, little brother? The war in your blood… calling home.');
      // from his left, the side without the sword
      c.shot(at(1.6, 0.8, 1.85), head().add(V(0, -0.08, 0)), 32);
      await c.say('Ariel', 'Who said that? Who — get out of my head!');

      // ---- the vision: across Elysia, the God of War kneels in his arena… and lifts his head
      UI.flash(0.6);
      Sound.thunder(400);
      G.post.desat = 1; G.post.possess = 0.85;
      B.rig.play('kneelLookUp', { fade: 0.01 });
      // (far from the player his rig has been asleep: pose it now, so the camera finds his head)
      B.root.visible = true;
      B.rig.update(0.016, 0, 1); B.root.updateMatrixWorld(true);
      const bh = B.rig.j.head.getWorldPosition(new THREE.Vector3());
      // from low on the sand, up at him against the sky, the rot smoking off him
      c.shot(bh.clone().add(V(2.2, -1.5, 8.0)), bh.clone().add(V(0, 0.4, 0)), 36);
      c.move(bh.clone().add(V(0.9, -0.9, 4.6)), bh.clone().add(V(0, 0.15, 0)), 11, { ease: (t) => t });
      await c.wait(1.2);
      await c.say('Ares', 'That armour. That face. Did you never wonder why they look like mine?');
      await c.say('Ares', 'Seventeen years ago your father cut a shard from my spark — my war, my strength — and sealed it inside a mortal child. Inside you.');

      // ---- back in his own body, which is no longer only his
      UI.flash(0.5);
      G.post.desat = 0; G.post.possess = 0.7;
      P.rig.play('seized', { fade: 0.25 });
      Sound.roar(0.7, 0.5);
      c.shot(at(2.2, -1.3, 1.1), head().add(V(0, 0.15, 0)), 40);
      c.move(at(1.7, -1.0, 1.0), head().add(V(0, 0.25, 0)), 4);
      await c.say('Ares', 'And what is mine answers to me. Kneel to war, boy.');
      c.shot(at(1.45, 0.5, 1.6), head().add(V(0, 0.05, 0)), 32);
      G.cam.shake(0.5);
      await c.say('Ariel', 'Get… out… of… my… head!');

      // ---- Hermes breaks the hold
      const hp = at(3.0, 1.9, 0); hp.y = World.getHeight(hp.x, hp.z, P.pos.y + 1);
      Hm.place(hp.x, hp.z, Math.atan2(P.pos.x - hp.x, P.pos.z - hp.z));
      Hm.pos.y = hp.y;
      Hm.root.visible = true;
      Hm.rig.play('point', { fade: 0.2 });
      FX.sparks(hp.clone().add(V(0, 1.2, 0)), null, 60, [2.6, 2.0, 0.8, 1], 6);
      FX.flashLight(hp.clone().add(V(0, 2, 0)), 0xffd28a, 600, 0.6, 20);
      Sound.bell();
      const d = P.pos.clone().sub(hp).setY(0).normalize(), side = V(d.z, 0, -d.x);
      c.shot(P.pos.clone().addScaledVector(d, 1.5).addScaledVector(side, -1.0).add(V(0, 1.8, 0)), hp.clone().add(V(0, 1.5, 0)), 40);
      await c.say('Hermes', 'Hands off the boy, you overgrown war drum!');
      // the caduceus rings like a struck bell; the red drains out of the world
      FX.ring(P.pos, 4, { color: [2.6, 2.1, 1.0], life: 0.7 });
      FX.sparks(head(), null, 70, [1.4, 1.9, 3.4, 1], 7);
      UI.flash(0.7);
      Sound.zap();
      pulse.on = false;
      G.post.possess = 0;
      P.rig.play('kneel', { fade: 0.15 });
      Hm.rig.play('talk', { fade: 0.4 });
      // over the shoulder, both ways
      const onHermes = () => c.shot(P.pos.clone().addScaledVector(d, 1.3).addScaledVector(side, 0.85).add(V(0, 1.75, 0)), hp.clone().add(V(0, 1.5, 0)), 36);
      const onAriel = (y = 1.2) => c.shot(hp.clone().addScaledVector(d, -1.1).addScaledVector(side, -0.75).add(V(0, 1.7, 0)), P.pos.clone().add(V(0, y, 0)), 36);
      onAriel(1.0);
      await c.wait(0.8);
      await c.say('Ariel', 'He was in my head. He moved my arm. Hermes — what is he talking about?');
      onHermes();
      await c.say('Hermes', 'I had hoped to have this conversation after you freed him. Or, ideally, never.');
      P.rig.play('standUp', { fade: 0.3 });
      P.heading = Math.atan2(hp.x - P.pos.x, hp.z - P.pos.z);
      await c.say('Hermes', 'When Kronos began to stir, your father knew his thunder alone would never keep a mortal child alive. So he cut a shard from Ares\' spark and sealed it in you, right beside his own.');
      await c.say('Hermes', 'I carried it to your cradle myself. Wrapped in a storm cloud, still burning. Ares was never asked.');
      onAriel(1.6);
      await c.say('Ariel', 'So the armour. The face. I don\'t look like a god of war… I look like him.');
      onHermes();
      await c.say('Hermes', 'You look like the piece of him you carry. And that wound is how the rot got in. Kronos whispered that Zeus chose a mortal over his own son — and Ares believed him.');
      await c.say('Hermes', 'While the rot holds him, he can reach through that shard and pull your strings. When he does, fight him. Hard. He lets go of what fights back.');
      onAriel(1.6);
      await c.say('Ariel', 'Great. My half-brother is living rent-free in my head. Just what I needed.');
      onHermes();
      await c.say('Hermes', 'Look on the bright side: while he has hold of you, you hit like he does. Try not to enjoy it.');
    },
    async finish() {
      const P = G.player, Hm = G.hermes, S = World.sites.start;
      G.flags.mirrorSeen = true;
      G.post.possess = 0; G.post.desat = 0;
      if (G.boss && G.boss.state === 'dormant') G.boss.reset();
      // Hermes goes back to minding the Temple of Dawn
      Hm.place(S.x + 3.4, S.z - 21, -2.4);
      Hm.pos.y = World.getHeight(Hm.pos.x, Hm.pos.z);
      Hm.rig.play('talk', { fade: 0.2 });
      P.rig.stop(0.3);
      P.releaseGrip(true);
      P.gripT = rand(45, 70);
      Game.save();
      await Game.startPlay({ fadeIn: false });
      setTimeout(() => UI.hint('Ares can seize you through the war-shard. Mash <b>Space</b> to break his hold — while he holds you, your blows strike with his strength.', 11), 1500);
    },
  },

  bossIntro: {
    async run(c) {
      const R = World.arena, P = G.player, B = G.boss;
      Music.play('none');
      P.setPosition(R.x, R.z + 25, Math.PI);
      B.reset();
      B.pos.set(R.x, World.getHeight(R.x, R.z - 14), R.z - 14);
      B.heading = 0;
      UI.setFade(1);
      c.shot(V(R.x + 6, R.y + 3, R.z + 30), V(R.x, R.y + 2.4, R.z - 14), 50);
      c.move(V(R.x + 3, R.y + 2.2, R.z + 21), V(R.x, R.y + 2.4, R.z - 14), 6);
      await UI.fade(0, 1.2);
      Sound.gate();
      await c.wait(2.2);
      c.shot(V(R.x - 4.5, R.y + 1.6, R.z - 6.5), V(R.x, R.y + 2.7, R.z - 14), 38);
      c.move(V(R.x - 3.2, R.y + 1.9, R.z - 8.4), V(R.x, R.y + 2.9, R.z - 14), 6, { ease: (t) => t });
      await c.say('Ares', 'Another little godling, sent to die in my arena.', 4);
      B.rig.play('rise', { fade: 0.3 });
      Sound.roar(0.5, 0.8);
      c.shot(V(R.x + 2.2, R.y + 0.6, R.z - 6.5), V(R.x, R.y + 3.2, R.z - 14), 52);
      c.move(V(R.x + 3, R.y + 0.5, R.z - 5.5), V(R.x, R.y + 4.2, R.z - 14), 3.4);
      await c.wait(1.6);
      FX.fireBurst(B.pos.clone().add(V(0, 4.8, 0)), 1.2, 50);
      Sound.fire(true, 1);
      await c.wait(1.6);
      c.shot(V(R.x + 0.6, R.y + 4.05, R.z - 8.6), V(R.x, R.y + 3.95, R.z - 14), 30);
      c.move(V(R.x + 0.4, R.y + 4.05, R.z - 9.4), V(R.x, R.y + 3.95, R.z - 14), 6, { ease: (t) => t });
      await c.say('Ares', 'I am ARES. I am every war that was ever fought — and every war that ever will be.');
      // Ariel's replies: three-quarter close-ups off his own position, from the side that puts the arena wall behind him
      // (not the gate, and not the low sun on the other side, which washes the frame out)
      const arielCU = (d) => c.shot(P.pos.clone().add(V(-d * 0.85, 1.76, -d * 0.55)), P.pos.clone().add(V(-0.12, 1.66, 0)), 34);
      arielCU(2.7);
      await c.say('Ariel', 'You\'re also, like, the size of a bus.');
      c.shot(V(R.x + 3.6, R.y + 3, R.z - 8.5), V(R.x, R.y + 3.9, R.z - 14), 40);
      await c.say('Ares', 'And still you wear my face, little thief. Did the messenger tell you whose strength you have been borrowing?');
      arielCU(2.2);
      await c.say('Ariel', 'He told me. Doesn\'t mean you get it back.');
      c.shot(V(R.x + 3.6, R.y + 3, R.z - 8.5), V(R.x, R.y + 3.9, R.z - 14), 40);
      await c.say('Ares', 'Kronos showed me the truth, boy. Olympus is a corpse wearing a crown — and your father let it rot.');
      c.move(V(R.x + 1.2, R.y + 2.4, R.z - 7), V(R.x, R.y + 4.1, R.z - 14), 5);
      await c.say('Ares', 'Come, son of Zeus. Show me your father\'s thunder — so I can tear it from your chest!');
      B.rig.play('roar', { fade: 0.2 });
      Sound.roar(0.45, 1);
      G.cam.shake(1.2);
      FX.ring(B.pos, 14, { color: [2.5, 0.8, 0.2], life: 0.9 });
      FX.fireBurst(B.pos, 5, 120);
      c.shot(V(R.x - 2, R.y + 1.4, R.z + 19), V(R.x, R.y + 3, R.z - 14), 55);
      await c.wait(1.8);
    },
    async finish() {
      const R = World.arena, P = G.player, B = G.boss;
      UI.setFade(0);
      if (!P.alive) return;
      P.setPosition(R.x, R.z + 22, Math.PI);
      B.pos.set(R.x, World.getHeight(R.x, R.z - 14), R.z - 14);
      B.heading = 0;
      B.wake();
      G.arenaLock = true;
      World.arena.gateCollider.off = false;
      UI.bossShow(B, 'Ares, the Bloodied God of War');
      Music.intensity = 0;
      Music.play('boss');
      await Game.startPlay({ fadeIn: false });
      G.cam.yaw = 0; G.cam.pitch = 0.18;
    },
  },

  bossDefeat: {
    /** Zeus speaking from the storm: the imported model with a divine rim glow, or the procedural spirit */
    makeZeus() {
      const Z = buildZeusSpirit();
      // (his own materials: the storm-glow below must not leak into every other Zeus)
      Z.model = Models.attach(Z.rig, 'zeus', { ownMaterials: true });
      if (Z.model) {
        Z.mats = Z.model.materials();
        Z.mats.forEach((m) => {
          m.transparent = true;
          m.emissive = new THREE.Color(0.18, 0.24, 0.42);
          m.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
              float zr = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
              outgoingLight += vec3(0.55, 0.75, 1.6) * pow(zr, 2.5) * 1.5;
              #include <opaque_fragment>`);
          };
          m.needsUpdate = true;
        });
        Z.setOpacity = (v) => Z.mats.forEach((m) => { m.opacity = v; m.depthWrite = v > 0.95; });
      } else Z.setOpacity = (v) => { Mat.zeus.uniforms.uOpacity.value = v * 0.85; };
      return Z;
    },
    async run(c) {
      const R = World.arena, P = G.player, B = G.boss;
      Music.play('none');
      await c.wait(0.5);
      B.rig.play('kneelBowed', { fade: 0.6 });
      // stage the ending in the open centre of the arena, Zeus rises behind Ares
      B.pos.set(R.x, World.getHeight(R.x, R.z - 4), R.z - 4);
      B.heading = 0;
      B.root.position.copy(B.pos); B.root.rotation.y = 0;
      if (B.cape) B.cape.needsReset = true;
      const bp = B.pos.clone();
      const toP = new THREE.Vector3(0, 0, 1);
      P.setPosition(bp.x + toP.x * 8, bp.z + toP.z * 8, Math.atan2(-toP.x, -toP.z));
      c.shot(bp.clone().add(toP.clone().multiplyScalar(14)).add(V(3, 3, 0)), bp.clone().add(V(0, 3, 0)), 45);
      await c.wait(2.2);
      // the rot leaves him
      for (let i = 0; i < 6; i++) setTimeout(() => {
        for (let k = 0; k < 40; k++) FX.smoke.spawn({ x: bp.x + rand(-2, 2), y: bp.y + rand(1, 6), z: bp.z + rand(-2, 2), vx: rand(-1, 1), vy: rand(1, 4), vz: rand(-1, 1), life: rand(1.5, 3), s: rand(0.8, 1.6), s2: 3.5, c: [0.22, 0.06, 0.3, 0.5], c2: [0.1, 0.02, 0.15, 0] });
      }, i * 250);
      B.fuller.material.color.setRGB(0.8, 0.15, 0.05);
      B.crestMat.color.setRGB(1.0, 0.25, 0.08);
      if (B.bodyMat) B.bodyMat.emissive.setRGB(0, 0, 0);
      Sound.roar(0.4, 0.6);
      // kneeling and bowed his head is only ~2.4 m up and a metre forward: look up into it from below, not over it
      c.shot(bp.clone().add(toP.clone().multiplyScalar(4.6)).add(V(-1.3, 1.5, 0)), bp.clone().add(V(0, 2.2, 0)).addScaledVector(toP, 0.8), 38);
      await c.wait(1.6);
      await c.say('Ares', 'The rot… it burns away. My mind is… my own again.');
      await c.say('Ares', 'Boy. Kronos waits on Olympus, on your father\'s throne. Every god you free will weaken his hold.');
      // the shard: what Zeus took from him is now his to give
      await c.say('Ares', 'That shard in your chest… I hated you for it before you could walk. A mortal, wearing my strength like a borrowed cloak.');
      await c.say('Ares', 'It was never his to give. So let it be mine. Keep it, brother.');
      // the Spark of War
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 1.4, 0.4) }));
      orb.position.copy(bp).add(V(0, 3.4, 0));
      G.scene.add(orb);
      Sound.bell();
      const target = P.pos.clone().add(V(0, 1.3, 0));
      // side-on, far enough back that the kneeling Ares and Ariel both sit inside the frame
      c.shot(bp.clone().lerp(P.pos, 0.5).add(toP.clone().cross(V(0, 1, 0)).multiplyScalar(9.5)).add(V(0, 2.3, 0)), bp.clone().lerp(P.pos, 0.5).add(V(0, 2.2, 0)), 50);
      await c.say('Ares', 'Take my spark. Wield it better than I did.', 3);
      const t0 = G.time;
      await c.wait(3, () => {
        const u = clamp((G.time - t0) / 2.6, 0, 1);
        orb.position.lerpVectors(bp.clone().add(V(0, 3.4, 0)), target, easeInOut(u));
        orb.position.y += Math.sin(u * Math.PI) * 2.5;
        FX.glow.spawn({ x: orb.position.x, y: orb.position.y, z: orb.position.z, vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5), vz: rand(-0.5, 0.5), life: 0.8, s: 0.3, s2: 0.02, c: [3, 0.8, 0.2, 1], c2: [2, 0.4, 0.1, 0] });
        return false;
      });
      G.scene.remove(orb);
      FX.sparks(target, null, 80, [3, 1, 0.3, 1], 6, false);
      FX.flashLight(target, 0xff6030, 200, 0.7, 18);
      UI.flash(0.6);
      Sound.victory();
      // Zeus speaks from the storm
      const Z = SCRIPTS.bossDefeat.zeus || (SCRIPTS.bossDefeat.zeus = SCRIPTS.bossDefeat.makeZeus());
      Z.root.scale.setScalar(13);
      // high over the far wall, in the storm: lower, his feet met the throne's back and he read as a statue on a plinth
      Z.root.position.set(R.x, R.y + 15, R.z - 38);
      Z.root.rotation.y = 0;
      Z.rig.poseFrom({ armR: [-40, 0, -30], elbowR: [-60, 0, 0], armL: [-30, 0, 30], elbowL: [-50, 0, 0], neck: [10, 0, 0] });
      G.scene.add(Z.root);
      Z.root.visible = true;
      if (Z.model) Z.model.update();
      Z.setOpacity(0);
      const z0 = G.time;
      const fadeZ = () => { Z.setOpacity(clamp((G.time - z0) / 3, 0, 1)); return false; };
      FX.lightningStrike(V(R.x - 18, R.y, R.z - 30), { radius: 3, sound: true, shake: 0.4 });
      c.shot(P.pos.clone().add(V(1.2, 1.2, 2.5)), V(R.x, R.y + 30, R.z - 38), 55);
      c.move(P.pos.clone().add(V(0.8, 0.6, 3.6)), V(R.x, R.y + 31, R.z - 38), 7, { ease: (t) => t });
      await c.wait(3, fadeZ);
      P.rig.play('lookUp', { fade: 0.5 });
      await c.say('Zeus', 'Ariel. My son.');
      // he is looking up: from a little below, so the raised face is in frame and not the top of the helmet
      c.shot(P.pos.clone().add(V(-0.8, 1.5, -1.6)), P.pos.clone().add(V(0, 1.74, 0)), 34);
      await c.say('Ariel', '…Dad?');
      c.shot(P.pos.clone().add(V(2, 0.4, 4)), V(R.x, R.y + 30, R.z - 38), 50);
      await c.say('Zeus', 'One spark returns to Olympus. Eleven remain in shadow — and each will be harder won than the last.');
      await c.say('Zeus', 'I am sorry I was not there. Rise now, Heir of Thunder. Olympus awaits.');
      FX.lightningStrike(V(R.x + 14, R.y, R.z - 26), { radius: 3, sound: true, shake: 0.3, light: 900, flash: 0.1 });
      // his father goes back into the storm
      const z1 = G.time;
      c.shot(P.pos.clone().add(V(2, 0.4, 4)), V(R.x, R.y + 30, R.z - 38), 50);
      await c.wait(1.8, () => { Z.setOpacity(1 - clamp((G.time - z1) / 1.6, 0, 1)); return false; });
      G.scene.remove(Z.root);
      await SCRIPTS.bossDefeat.ascend(c);
      UI.chapter('CHAPTER I COMPLETE', 'The Spark of War');
      Music.play('victory');
      await c.wait(5);
      UI.chapter(null);
      await c.wait(1);
      UI.letterbox(false);
      await UI.credits(`
        <h1>ARIEL</h1><p style="letter-spacing:.5em;color:#c9a95c">HEIR OF THUNDER</p>
        <h3>CHAPTER I</h3><p>The Spark of War</p>
        <h3>STARRING</h3><p>Ariel Stormborn — son of Zeus, junior at Westbrook High, God of War</p><p>Jesse — who believed him first</p><p>Anna Stormborn — who waited in the storms</p><p>Hermes — messenger of the gods</p><p>Ares — freed from the rot</p><p>Zeus — King of Olympus</p><p>Kratos and Deimos — sons of the Heir of Thunder</p>
        <h3>THE WORLD</h3><p>Its land, ruins, sounds and music<br>are generated by code when you press play.</p>
        <h3>STONE AND EARTH</h3><p>Photo-scanned textures from Poly Haven (CC0)</p>
        <h3>HOLLOW HOPLITES</h3><p>"Rigged for UE4 – Spartan" by Andy Woodhead (CC BY 4.0)</p>
        <h3>WEDDING AND OLYMPUS CLOTHES</h3><p>"Fancy Tailcoat Suit" by LuuHung (CC BY-ND 4.0)<br>"Wedding Dress 2" by Brian Trepanier (CC BY 4.0)<br>"Maniqui di_or godess" by Roberto Domínguez (CC BY 4.0)</p>
        <h3>MOTION AND VOICES</h3><p>Running and texting motion capture from Mixamo<br>Voices recorded with Microsoft neural voices</p>
        <h3>ENGINE</h3><p>three.js</p>
        <h3>TO BE CONTINUED</h3><p>Eleven sparks remain.<br>Athena waits in the Library of Ash.</p>
        <p style="margin-top:80px;font-style:italic">Thank you for playing.</p>`, 30);
    },
    /**
     * Ares gives up the mantle of war, and Ariel takes it: thunder and fire come down on him together.
     * Then the Fates' tapestry (painted slides: what is still to come), and Olympus with its light coming back
     */
    async ascend(c) {
      Garments.preload();
      const R = World.arena, P = G.player, B = G.boss, bp = B.pos.clone();
      const toP = P.pos.clone().sub(bp).setY(0).normalize();
      B.rig.play('kneelLookUp', { fade: 0.8 });
      P.rig.play('look', { fade: 0.5 });
      c.shot(bp.clone().addScaledVector(toP, 4.4).add(V(-1.5, 1.45, 0)), bp.clone().add(V(0, 2.3, 0)).addScaledVector(toP, 0.8), 36);
      await c.say('Ares', 'Hear me, brother. The mantle of war was never mine to keep. I wore it like a butcher wears his apron.');
      await c.say('Ares', 'Take it. Be the god of war that I never was.');
      c.shot(P.pos.clone().add(V(-1.0, 1.55, -1.9)), P.pos.clone().add(V(0, 1.7, 0)), 34);
      await c.say('Ariel', '…Then I will make it mean something.');
      // the mantle: fire from the earth, thunder from the sky, and he raises Keraunos into both
      P.rig.play('raise', { fade: 0.35 });
      const pf = V(Math.sin(P.heading), 0, Math.cos(P.heading)), pr = V(pf.z, 0, -pf.x);
      c.shot(P.pos.clone().addScaledVector(pf, 3.4).addScaledVector(pr, 2.2).add(V(0, 0.45, 0)), P.pos.clone().add(V(0, 2.0, 0)), 44);
      c.move(P.pos.clone().addScaledVector(pf, 4.2).addScaledVector(pr, 1.0).add(V(0, 0.35, 0)), P.pos.clone().add(V(0, 2.3, 0)), 6.5, { ease: (t) => t });
      FX.ring(P.pos, 7, { color: [2.4, 0.7, 0.18], life: 1.4, opacity: 0.8 });
      FX.fireBurst(P.pos, 2.2, 60);
      Sound.fire(true, 1); Sound.roar(0.5, 0.7);
      const t0 = G.time;
      let nextBolt = 0;
      await c.wait(4.2, () => {
        const k = G.time - t0;
        const tip = P.swordTip ? P.swordTip() : P.pos.clone().add(V(0, 2.6, 0));
        if (k > nextBolt) {
          nextBolt = k + rand(0.35, 0.6);
          FX.bolt(tip.clone().add(V(rand(-6, 6), 40, rand(-6, 6))), tip, { radius: 0.09, life: 0.3, branches: 4 });
          FX.flashLight(tip, 0xb8d4ff, 110, 0.3, 14);
          Sound.zap();
        }
        for (let i = 0; i < 3; i++) { const a = rand(0, TAU), r = rand(0.4, 1.4); FX.glow.spawn({ x: P.pos.x + Math.cos(a) * r, y: P.pos.y + rand(0, 0.4), z: P.pos.z + Math.sin(a) * r, vx: 0, vy: rand(1.5, 3.5), vz: 0, life: rand(0.8, 1.4), s: rand(0.08, 0.16), s2: 0.01, c: [2.6, 0.8, 0.2, 1], c2: [1.2, 0.2, 0.05, 0] }); }
        return false;
      });
      FX.lightningStrike(P.pos.clone(), { radius: 2.6, scale: 0.8, shake: 0.9, flash: 0.1, light: 700, puff: false });
      UI.chapter('ARIEL', 'God of War');
      await c.wait(3.4);
      UI.chapter(null);
      await UI.fade(1, 1.4);
      // the Fates' tapestry
      Music.play('victory');
      await SCRIPTS.bossDefeat.tapestry(c, ASCENSION_SLIDES, 'THE FATES’ TAPESTRY');
      await SCRIPTS.bossDefeat.olympus(c);
      await SCRIPTS.bossDefeat.epilogue(c);
    },
    /** painted slides, full screen, each held for its narration */
    async tapestry(c, slides, title) {
      Vase.open();
      const urls = Vase.prepare(slides);
      Vase.caption(title);
      await UI.fade(0, 1.2);
      await c.wait(2.4);
      Vase.caption(null);
      for (let i = 0; i < urls.length; i++) {
        Vase.show(urls[i], 9, i);
        await c.wait(1.2);
        await c.say('Narrator', slides[i].line);
        await c.wait(0.9);
      }
      await UI.fade(1, 1.4);
      Vase.hide();
    },
    /** Olympus as it will be: the rot draining out of the hall, the sparks coming home, Ariel at his father's right hand */
    async olympus(c) {
      const PR = Prologue, S = PR.olympus, V3 = V;
      const keep = this.hallState = {
        rot: PR.rot, rotOn: PR.rotOn,
        vis: PR.hallActors.map((a) => a.root.visible),
        sparks: [PR.zeus, ...PR.gods].map((g) => g.spark ? [g.sparkGone, g.spark.visible, g.sparkFly, g.sparkHeld] : null),
      };
      PR.rot = 1; PR.rotOn = false;
      PR.kronosHall.root.visible = false; PR.hadesFallen.root.visible = false; PR.hades.root.visible = true;
      for (const g of [PR.zeus, ...PR.gods]) if (g.spark) { g.sparkGone = true; g.spark.visible = false; g.sparkFly = null; g.sparkHeld = false; }
      const top = PR.zeus.root.position.y;
      const A = this.arielHall || (this.arielHall = PR.actor(S, 'arielGod', { stance: 'sword', size: 1.18, x: -2.7, y: 0, z: -10.6, face: 0.2 }));
      A.root.visible = true;
      Game.useScene(S);
      c.shot(V3(0, 1.7, 24), V3(0, top + 3.2, -14.9), 46);
      c.move(V3(0, 3.6, 4), V3(-0.6, top + 2.8, -14.9), 11, { ease: (t) => t * t * (3 - 2 * t) });
      await UI.fade(0, 1.6);
      // the sparks come home, one god at a time
      const act = Cutscene.active;
      [PR.poseidon, PR.athena, PR.hades, PR.ares, PR.zeus].forEach((g, i) => setTimeout(() => {
        if (!g.spark || Cutscene.active !== act || !this.hallState) return;
        g.sparkGone = false; g.spark.visible = true;
        const p = g.spark.position;
        FX.sparks(p, null, 26, [g.sparkCol[0], g.sparkCol[1], g.sparkCol[2], 1], 4, false);
        Sound.bell();
      }, 2200 + i * 900));
      await c.wait(6.5);
      await c.say('Narrator', 'Olympus stood again in the light, as it was in the beginning.');
      // at the right hand of the throne
      c.shot(V3(-0.6, 1.9, -4.4), V3(-1.5, top + 1.2, -12.6), 38);
      c.move(V3(-1.0, 2.0, -5.6), V3(-1.4, top + 1.4, -12.8), 7, { ease: (t) => t });
      await c.say('Zeus', 'Olympus stands again. And at my right hand, the God of War — my son.');
      await c.wait(1.5);
      await UI.fade(1, 2);
      Game.useScene(G.scene);
    },
    restoreHall() {
      const PR = Prologue, k = this.hallState;
      if (!k) return;
      PR.rot = k.rot; PR.rotOn = k.rotOn;
      PR.hallActors.forEach((a, i) => { a.root.visible = k.vis[i]; });
      [PR.zeus, ...PR.gods].forEach((g, i) => { const s = k.sparks[i]; if (s && g.spark) { [g.sparkGone, g.spark.visible, g.sparkFly, g.sparkHeld] = s; } });
      if (this.arielHall) this.arielHall.root.visible = false;
      this.hallState = null;
    },
    /**
     * The two lives of Ariel Stormborn: home to his mother, the truth to Jesse, his mortal life painted on the
     * vase, the night his first son is born (in the kitchen where it all began), and how it all turns out
     */
    async epilogue(c) {
      const Hm = Home, A = Hm.ariel, M = Hm.anna, Ca = Campus, J = Ca.jesse, Me = Memory;
      const head = (b, up = 1.58) => b.root.position.clone().add(V(0, up, 0));
      UI.chapter('EPILOGUE', 'The Two Lives of Ariel Stormborn');
      await c.wait(4);
      UI.chapter(null);
      // ---- home, the morning after: the son comes back to his mother a god, and chooses to stay her son
      Game.useScene(Hm.scene);
      Sound.startRain(); Sound.setRain(0.12);
      Music.play('none');
      Hm.holdMug(false);
      M.root.position.set(-1.25, 0, -2.09); M.rig.stop(0.01);
      A.root.position.set(-0.55, 0, -0.35); A.rig.stop(0.01);
      A.faceTo(M.root.position.x, M.root.position.z); M.faceTo(A.root.position.x, A.root.position.z);
      for (let i = 0; i < 40; i++) { A.update(0.05); M.update(0.05); }
      // side on to the two of them, so neither stands in front of the other
      c.shot(V(1.25, 1.45, -1.9), V(-0.9, 1.42, -1.2), 42);
      c.move(V(1.0, 1.45, -1.75), V(-0.9, 1.44, -1.22), 10, { ease: (t) => t });
      await UI.fade(0, 1.8);
      await c.say('Anna', 'Three days, Ariel. Three days, and not one word.');
      c.shot(M.root.position.clone().add(V(-0.5, 1.55, 0.45)), head(A, 1.55), 38);
      await c.say('Ariel', 'I met him, Mom. Dad. He said he was sorry he was not there.');
      c.shot(A.root.position.clone().add(V(0.45, 1.6, -0.5)), head(M, 1.5), 38);
      await c.say('Anna', '…He was always there. In every storm that ever passed over this house.');
      c.shot(M.root.position.clone().add(V(-0.5, 1.55, 0.45)), head(A, 1.55), 38);
      await c.say('Ariel', 'They want me on Olympus. A throne, a mantle, all of it. I said yes.');
      await c.say('Ariel', 'But I am not leaving you. I am not leaving any of this.');
      c.shot(A.root.position.clone().add(V(0.45, 1.6, -0.5)), head(M, 1.5), 36);
      await c.say('Anna', 'Then you will do the one thing your father never could. You will be both.');
      await UI.fade(1, 1.4);
      // ---- the school steps: Jesse has worked it out on her own
      Game.useScene(Ca.scene);
      Sound.setRain(0);
      const B2 = Ca.ariel;
      J.texting(false);
      const jp = J.root.position;
      B2.root.position.set(jp.x + 1.25, 0, jp.z + 0.6); B2.rig.stop(0.01);
      B2.faceTo(jp.x, jp.z); J.look(0, 0);
      J.root.rotation.y = Math.atan2(B2.root.position.x - jp.x, B2.root.position.z - jp.z);
      for (let i = 0; i < 40; i++) { J.update(0.05); B2.update(0.05); }
      const side = V(B2.root.position.z - jp.z, 0, -(B2.root.position.x - jp.x)).normalize();
      const mid = jp.clone().lerp(B2.root.position, 0.5);
      c.shot(mid.clone().addScaledVector(side, 3.2).add(V(0, 1.5, 0)), mid.clone().add(V(0, 1.35, 0)), 36);
      c.move(mid.clone().addScaledVector(side, 2.6).add(V(0, 1.5, 0)), mid.clone().add(V(0, 1.38, 0)), 12, { ease: (t) => t });
      await UI.fade(0, 1.4);
      await c.say('Jesse', 'I worked it out, you know.');
      // as she lists them, the moments themselves: what we saw happen, in a cold, faded memory grade
      const U = Game.final.uniforms;
      const memory = (sc) => {
        G.flashback = true;
        if (G.activeScene !== sc) Game.useScene(sc);
        Game.gradeFor(sc);
        UI.flash(0.6);
        if (Sound.tone) Sound.tone({ type: 'sine', f: 1200, f2: 260, dur: 0.6, gain: 0.07 });
      };
      const after = (sec, fn) => { let done = false; FX.temp(new THREE.Object3D(), sec + 0.1, (t) => { if (!done && t.age >= sec) { done = true; fn(); } }, false); };
      const keepB = { pos: B2.root.position.clone(), rot: B2.root.rotation.y };
      // her phone, dying in her hands
      J.texting(true); J.look(0, 0);
      if (J.screen) J.screen.material.color.setRGB(0.55, 0.7, 0.95);
      for (let i = 0; i < 24; i++) J.update(0.05);
      memory(Ca.scene);
      const ph = J.phone.getWorldPosition(new THREE.Vector3());
      c.shot(ph.clone().add(V(0.32, 0.16, 0.42)), ph.clone().add(V(0, -0.02, 0)), 34);
      c.move(ph.clone().add(V(0.26, 0.13, 0.34)), ph.clone().add(V(0, -0.02, 0)), 4, { ease: (t) => t });
      after(1.1, () => { J.phoneDies(); Sound.zap(); });
      await c.say('Jesse', 'My phone, dying every single time you stood next to me.');
      J.texting(false);
      // the vending machine
      const vf = Ca.vendFront;
      B2.root.position.set(vf.x, 0, vf.z + 0.15); B2.root.rotation.y = Math.PI; B2.rig.stop(0.01);
      for (let i = 0; i < 10; i++) B2.update(0.05);
      if (Ca.vend) Ca.vend.dead = false;
      memory(Ca.scene);
      c.shot(vf.clone().add(V(1.1, 1.55, 0.9)), vf.clone().add(V(-0.1, 1.15, -0.7)), 42);
      after(0.5, () => B2.rig.play('thump', { fade: 0.08 }));
      after(0.85, () => { Ca.fry(); G.cam.shake(0.6); });
      await c.say('Jesse', 'The vending machine. Marcus still tells that story.');
      B2.rig.stop(0.2);
      // the night on the school roof
      memory(School.scene);
      Sound.startRain(); Sound.setRain(0.4);
      c.shot(V(2.5, 0.6, -6.1), V(1.5, 2.2, -9.6), 55);
      c.move(V(3.2, 0.5, -5.2), V(1.5, 2.8, -9.6), 3, { fov: 62 });
      after(1.0, () => {
        FX.bolt(V(1.0, 120, -16.6), V(1.5, 1.7, -9.6), { radius: 0.18, branches: 6, life: 0.6 });
        FX.bolt(V(4.0, 120, -13.6), V(1.5, 1.4, -9.6), { radius: 0.08, branches: 3, life: 0.5 });
        FX.sparks(V(1.5, 1.4, -9.6), null, 70, [1.6, 2.2, 3.6, 1], 8, false);
        FX.flashLight(V(1.5, 3, -9.6), 0xb8d4ff, 300, 0.5, 30);
        School.strike(false);
        Sound.thunder(0);
        G.cam.shake(1.0);
      });
      await c.say('Jesse', 'And the lightning on the school roof, the night you disappeared.');
      Sound.setRain(0);
      // back on the steps
      B2.root.position.copy(keepB.pos); B2.root.rotation.y = keepB.rot; B2.rig.stop(0.01);
      for (let i = 0; i < 10; i++) B2.update(0.05);
      G.flashback = false;
      Game.useScene(Ca.scene);
      Game.gradeFor(Ca.scene);
      UI.flash(0.3);
      c.shot(B2.root.position.clone().add(V(0, 1.6, 0)).addScaledVector(side, -0.6).add(jp.clone().sub(B2.root.position).multiplyScalar(-0.35)), J.root.position.clone().add(V(0, 1.5, 0)), 34);
      await c.say('Jesse', 'That was you. All of it.');
      c.shot(jp.clone().add(V(0, 1.55, 0)).addScaledVector(side, 0.6).add(B2.root.position.clone().sub(jp).multiplyScalar(-0.35)), head(B2, 1.55), 36);
      await c.say('Ariel', 'Would you believe me if I said yes?');
      c.shot(B2.root.position.clone().add(V(0, 1.6, 0)).addScaledVector(side, -0.6).add(jp.clone().sub(B2.root.position).multiplyScalar(-0.35)), J.root.position.clone().add(V(0, 1.5, 0)), 36);
      await c.say('Jesse', 'Stormborn, I have believed you since the third grade. Try me.');
      await UI.fade(1, 1.4);
      // ---- his mortal life, painted in the old way
      Music.play('victory');
      await SCRIPTS.bossDefeat.tapestry(c, LIFE_SLIDES_A, 'THE TWO LIVES');
      // ---- the wedding photograph, on Olympus
      await SCRIPTS.bossDefeat.wedding(c);
      // ---- years later, in the hall of the gods: Kratos is born
      await SCRIPTS.bossDefeat.firstborn(c);
      await SCRIPTS.bossDefeat.tapestry(c, LIFE_SLIDES_B, 'KRATOS AND DEIMOS');
      this.restoreHall();
    },
    /**
     * Borrow actors from their own stages into another scene (with what they hold), and give them back after.
     * Their meshes can be re-dressed meanwhile (dress): every material swapped is put back too.
     */
    borrow(scene, actors) {
      const k = this.borrowed || (this.borrowed = []);
      for (const a of actors) {
        k.push({ a, parent: a.root.parent, pos: a.root.position.clone(), rot: a.root.rotation.y, vis: a.root.visible,
          phone: a.phone ? { parent: a.phone.parent, vis: a.phone.children.map((o) => o.visible) } : null });
        scene.add(a.root);
        a.root.visible = true;
        if (a.phone) scene.add(a.phone);
      }
    },
    dress(a, style) {
      const k = this.dressed || (this.dressed = []), extras = this.extras || (this.extras = []);
      const ivory = new THREE.Color(0xf3eee3), gold = new THREE.Color(0xc9a24a);
      a.root.traverse((o) => {
        if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
        const n = (o.name + ' ' + o.material.name).toLowerCase();
        const cloth = /dress2|cotton|denim|sleeve|outfit_top|outfit_bottom/.test(n), shoe = /shoe|heel/.test(n);
        if (!cloth && !shoe && style !== 'heavenly') return;
        const m = o.material.clone();
        if (style === 'bride-extras' || style === 'heavenly-extras') return;
        if (style === 'mother' && cloth) { m.map = null; m.color.set(/denim|dress2 /.test(n) ? 0x2b3346 : 0x3a4762); m.roughness = 0.6; }
        else if (style === 'mother') return;
        else if (style === 'bride' && (cloth || shoe)) { m.map = null; m.color.copy(ivory); m.roughness = 0.42; m.side = THREE.DoubleSide; }
        else if (style === 'groom' && cloth) { m.map = null; m.color.set(/bottom/.test(n) ? 0x15161a : 0x1d2026); m.roughness = 0.55; }
        else if (style === 'groom' && shoe) { m.map = null; m.color.set(0x0c0c0d); m.roughness = 0.3; }
        else if (style === 'heavenly') {
          if (cloth) { m.map = null; m.color.copy(ivory); m.roughness = 0.5; m.side = THREE.DoubleSide; if (m.emissive) m.emissive.set(0x2a1f0c); }
          if (shoe) { m.map = null; m.color.copy(gold); m.metalness = 0.8; m.roughness = 0.3; }
          // a faint light at their edges, as the gods have here
          Models.rim(m, [1.0, 0.85, 0.55], 3, cloth ? 0.5 : 0.28);
        } else return;
        k.push({ o, m: o.material });
        o.material = m;
      });
      // what they wear on top of it
      const head = a.rig.j.head;
      if (style === 'bride' || style === 'bride-extras' || style === 'heavenly' || style === 'heavenly-extras') {
        const circ = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.0055, 8, 40), new THREE.MeshStandardMaterial({ color: 0xd8b25a, metalness: 0.9, roughness: 0.25 }));
        circ.rotation.x = Math.PI / 2 - 0.25; circ.position.set(0, 0.105, -0.012);
        head.add(circ); extras.push(circ);
      }
      if (style === 'bride' || style === 'bride-extras') {
        // the veil: from the crown, falling behind her shoulders
        const veil = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.36, 0.95, 32, 6, true, Math.PI / 2, Math.PI),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false }));
        veil.position.set(0, 0.1 - 0.475, -0.07);
        head.add(veil); extras.push(veil);
        // the bouquet, where the phone would be, between her hands
        if (a.phone) {
          a.phone.children.forEach((o) => { o.visible = false; });
          const b = new THREE.Group();
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.2, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d5a2c, roughness: 0.7 }));
          stem.position.z = -0.1; b.add(stem);
          const petals = [0xf6efe6, 0xf2d6d0, 0xfaf6ef, 0xe9c2c4];
          for (let i = 0; i < 13; i++) {
            const t = i / 13, ang = i * 2.4, r = 0.055 * Math.sqrt(t);
            const f = new THREE.Mesh(new THREE.SphereGeometry(0.03 + 0.008 * Math.random(), 12, 10), new THREE.MeshStandardMaterial({ color: petals[i % 4], roughness: 0.6 }));
            f.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0.03 - t * 0.03);
            b.add(f);
          }
          a.phone.add(b); extras.push(b);
        }
      }
    },
    giveBack() {
      for (const d of this.dressed || []) d.o.material = d.m;
      this.dressed = [];
      for (const e of this.extras || []) if (e.parent) e.parent.remove(e);
      this.extras = [];
      for (const k of this.borrowed || []) {
        if (k.parent) k.parent.add(k.a.root);
        k.a.root.position.copy(k.pos); k.a.root.rotation.y = k.rot; k.a.root.visible = k.vis;
        k.a.rig.stop(0.01);
        if (k.phone) { if (k.phone.parent) k.phone.parent.add(k.a.phone); k.a.phone.children.forEach((o, i) => { o.visible = k.phone.vis[i]; }); }
      }
      this.borrowed = [];
      if (Campus.jesse.texting) Campus.jesse.texting(false);
    },
    /** the hall restored, and the borrowed actors kept moving in it every frame */
    hallStage(actors) {
      const PR = Prologue;
      PR.rot = 0; PR.rotOn = false;
      PR.kronosHall.root.visible = false; PR.hadesFallen.root.visible = false; PR.hades.root.visible = true;
      for (const g of [PR.zeus, ...PR.gods]) if (g.spark) { g.sparkGone = false; g.spark.visible = true; g.sparkFly = null; g.sparkHeld = false; }
      if (this.arielHall) this.arielHall.root.visible = false;
      Game.useScene(PR.olympus);
      this.tickOn = true;
      FX.temp(new THREE.Object3D(), 900, (t, dt) => {
        if (!this.tickOn) { t.age = t.life; return; }
        for (const a of actors) a.update(dt);
        if (Memory.carrier) Memory.placeBaby();
      }, false);
    },
    /** their wedding photograph, on the pier where it all began: the bride in her gown, the groom in his tailcoat */
    async wedding(c) {
      const Me = Memory, J = Campus.jesse, A = Home.ariel, M = Home.anna;
      const S = Me.scene;
      this.borrow(S, [J, A, M]);
      this.memVis = [Me.anna.root.visible, Me.zeus.root.visible];
      Me.anna.root.visible = false; Me.zeus.root.visible = false;
      this.rainOp = Me.rain.lines ? Me.rain.lines.material.opacity : null;
      if (Me.rain.lines) Me.rain.lines.material.opacity = 0.12;
      J.root.position.set(1.05, 0, 5.75); J.root.rotation.y = Math.PI - 0.2;
      A.root.position.set(0.45, 0, 5.85); A.root.rotation.y = Math.PI + 0.25;
      M.root.position.set(2.2, 0, 6.35); M.root.rotation.y = Math.PI - 0.5;
      // groom: arms down at his sides, as the tailcoat hangs; bride: the bouquet held in front
      A.rig.poseFrom({ armL: [2, 0, 10], elbowL: [-6, 0, 0], armR: [2, 0, -10], elbowR: [-6, 0, 0] });
      A.rig.play('look', { fade: 0.01 }); A.rig.stop(0.01);
      J.texting(true); J.rig.play(CLIPS.textingHold ? 'textingHold' : 'phone', { fade: 0.01 }); J.look(0, -0.05);
      M.rig.stop(0.01);
      for (let i = 0; i < 50; i++) { J.update(0.05); A.update(0.05); M.update(0.05); }
      // the clothes
      this.undress = [];
      this.dress(J, 'bride');
      this.dress(M, 'mother');
      Game.useScene(S);
      Sound.startRain(); Sound.setRain(0.12);
      this.tickOn = true;
      FX.temp(new THREE.Object3D(), 900, (t, dt) => {
        if (!this.tickOn) { t.age = t.life; return; }
        J.update(dt); M.update(dt);
        // he stands for the photograph: arms down, in the pose the coat was cut for
        A.rig.poseFrom({ armL: [2, 0, 10], elbowL: [-6, 0, 0], armR: [2, 0, -10], elbowR: [-6, 0, 0], neck: [4, 0, 0] });
        if (A.model) A.model.update();
      }, false);
      for (let i = 0; i < 4; i++) { A.rig.poseFrom({ armL: [2, 0, 10], elbowL: [-6, 0, 0], armR: [2, 0, -10], elbowR: [-6, 0, 0], neck: [4, 0, 0] }); if (A.model) A.model.update(); }
      // (the gown's bodice is cut slimmer than she is: wider than it is tall, so it closes round her)
      const u1 = await Garments.wear(J, 'dress', { s: 0.343, wide: 1.4, deep: 1.55, hide: /denim|shoe|heel/, z: 0 });
      const u2 = await Garments.wear(A, 'tailcoat', { shoulder: 1.8, foot: 0, wide: 1.12, deep: 1.1, hide: /outfit_top|outfit_bottom|outfit_shoes/, z: -0.015 });
      [u1, u2].forEach((u) => u && this.undress.push(u));
      Music.play('victory');
      UI.chapter('THE WEDDING', 'The pier · the seventh summer');
      c.shot(V(0.8, 1.6, 3.3), V(0.85, 1.3, 5.8), 34);
      c.move(V(0.75, 1.55, 3.7), V(0.85, 1.32, 5.8), 6, { ease: (t) => t });
      await UI.fade(0, 1.6);
      await c.wait(3);
      UI.chapter(null);
      await c.wait(1.6);
      // the photograph
      c.shot(V(0.8, 1.45, 3.5), V(0.85, 1.2, 5.85), 32);
      await c.wait(0.4);
      Sound.ui && Sound.ui('ok');
      FX.flashLight(V(0.8, 1.6, 3.8), 0xfff4e6, 60, 0.4, 9);
      UI.flash(0.25);
      Game.render();
      const src = G.renderer.domElement, W = 1280, Hh = 720, pc = document.createElement('canvas');
      pc.width = W; pc.height = Hh;
      const x = pc.getContext('2d');
      // a print on a linen-covered table: warm, a little faded, with a white border
      let gr = x.createRadialGradient(W / 2, Hh / 2, 50, W / 2, Hh / 2, W * 0.7); gr.addColorStop(0, '#3a2c22'); gr.addColorStop(1, '#120c08');
      x.fillStyle = gr; x.fillRect(0, 0, W, Hh);
      x.save();
      x.translate(W / 2, Hh / 2); x.rotate(-0.028);
      const pw = 760, ph = 540, sw = pw - 56, sh = ph - 110;
      x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 40; x.shadowOffsetY = 14;
      x.fillStyle = '#f4efe6'; x.fillRect(-pw / 2, -ph / 2, pw, ph);
      x.shadowColor = 'transparent';
      const sa = src.width / src.height, ta = sw / sh;
      let cw = src.width, ch = src.height, cx0 = 0, cy0 = 0;
      if (sa > ta) { cw = src.height * ta; cx0 = (src.width - cw) / 2; } else { ch = src.width / ta; cy0 = (src.height - ch) / 2; }
      x.filter = 'sepia(0.22) saturate(1.05) contrast(1.04) brightness(1.04)';
      x.drawImage(src, cx0, cy0, cw, ch, -pw / 2 + 28, -ph / 2 + 28, sw, sh);
      x.filter = 'none';
      const vg = x.createRadialGradient(0, -ph / 2 + 28 + sh / 2, sh * 0.35, 0, -ph / 2 + 28 + sh / 2, sw * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(40,20,0,0.35)');
      x.fillStyle = vg; x.fillRect(-pw / 2 + 28, -ph / 2 + 28, sw, sh);
      x.fillStyle = '#4a3a2c'; x.font = 'italic 34px "Cormorant Garamond", Georgia, serif'; x.textAlign = 'center';
      x.fillText('Ariel & Jesse', 0, ph / 2 - 46);
      x.font = '18px "Cormorant Garamond", Georgia, serif'; x.fillStyle = '#7a6550';
      x.fillText('the pier  ·  the seventh summer', 0, ph / 2 - 20);
      x.restore();
      await c.wait(0.8);
      await UI.fade(1, 0.6);
      Vase.open();
      Vase.show(pc.toDataURL('image/jpeg', 0.92), 10, 0);
      await UI.fade(0, 0.8);
      await c.wait(1.2);
      await c.say('Narrator', 'Anna kept that photograph on her mantel for the rest of her life.');
      await c.wait(1.6);
      await UI.fade(1, 1.2);
      Vase.hide();
      this.tickOn = false;
      this.endWedding();
    },
    endWedding() {
      const Me = Memory;
      (this.undress || []).forEach((u) => u());
      this.undress = [];
      if (this.memVis) { Me.anna.root.visible = this.memVis[0]; Me.zeus.root.visible = this.memVis[1]; this.memVis = null; }
      if (this.rainOp !== null && this.rainOp !== undefined && Me.rain.lines) { Me.rain.lines.material.opacity = this.rainOp; this.rainOp = null; }
      Sound.setRain(0);
      this.giveBack();
    },
    /** years later, in the hall of the gods: Jesse with their first son in her arms, Ariel beside her as a god */
    async firstborn(c) {
      const PR = Prologue, J = Campus.jesse, M = Home.anna, Me = Memory;
      const Ag = this.arielHall || (this.arielHall = PR.actor(PR.olympus, 'arielGod', { stance: 'sword', size: 1.18, x: -2.7, y: 0, z: -10.6, face: 0.2 }));
      this.borrow(PR.olympus, [J, M]);
      this.dress(J, 'heavenly-extras'); this.dress(M, 'heavenly');
      this.babyHome = Me.baby.parent;
      PR.olympus.add(Me.baby);
      J.root.position.set(0.15, 0, -6.4); J.root.rotation.y = 0.12;
      J.hold = { fore: 0.03, palm: 0.016, at: 0.77 };
      J.texting(false);
      if (J.phone) J.phone.children.forEach((o) => { o.visible = false; });
      J.rig.play('cradle', { fade: 0.01 });
      Me.carry(J);
      M.root.position.set(1.3, 0, -6.0); M.rig.stop(0.01); M.faceTo(J.root.position.x, J.root.position.z);
      this.hallStage([J, M, Ag]);
      Ag.root.visible = true;
      Ag.root.position.set(-0.95, 0, -6.75); Ag.root.rotation.y = Math.atan2(J.root.position.x - -0.95, J.root.position.z - -6.75 + 0.4);
      for (let i = 0; i < 50; i++) { J.update(0.05); M.update(0.05); Ag.update(0.05); Me.placeBaby(); }
      this.undress = [];
      const ug = await Garments.wear(J, 'goddess', { shoulder: 0.79, hide: /dress2|cotton|denim|sleeve|shoe|heel/, z: 0.01 });
      if (ug) this.undress.push(ug);
      Music.play('none');
      UI.chapter('YEARS LATER', 'Olympus · the Hall of the Gods');
      const top = PR.zeus.root.position.y;
      c.shot(V(0.5, 1.6, -2.4), J.root.position.clone().add(V(-0.1, 1.2, -0.3)), 40);
      c.move(V(0.35, 1.5, -3.2), J.root.position.clone().add(V(-0.1, 1.22, -0.3)), 12, { ease: (t) => t });
      await UI.fade(0, 2);
      await c.wait(2.5);
      UI.chapter(null);
      await c.say('Anna', 'Hello, little storm.');
      c.shot(J.root.position.clone().add(V(0.5, 1.48, 0.95)), J.root.position.clone().add(V(0, 1.22, 0.1)), 34);
      await c.say('Jesse', 'He has your eyes. And your father\'s weather.');
      c.shot(J.root.position.clone().add(V(0.6, 1.62, 0.7)), Ag.root.position.clone().add(V(0, 1.75, 0)), 36);
      await c.say('Ariel', 'Kratos. His name is Kratos.');
      // his grandfather, on the throne behind them
      c.shot(V(-1.2, 2.0, -4.2), V(0, top + 2.6, -14.9), 34);
      PR.zeusGlow = true;
      Sound.thunder(300);
      await c.say('Zeus', 'A grandson. Olympus has not heard a child cry in a thousand years.');
      PR.zeusGlow = false;
      c.shot(V(1.8, 1.9, -1.2), J.root.position.clone().add(V(-0.3, 1.2, -0.4)), 44);
      for (let i = 0; i < 40; i++) setTimeout(() => { const p = J.root.position; FX.glow.spawn({ x: p.x + rand(-2, 2), y: rand(0.5, 3), z: p.z + rand(-2, 2), vx: 0, vy: rand(0.1, 0.4), vz: 0, life: rand(2, 3.5), s: rand(0.05, 0.1), s2: 0.01, c: [2.4, 2.0, 1.2, 0.9], c2: [1.6, 1.2, 0.6, 0] }); }, i * 120);
      await c.say('Narrator', 'And so the son of a storm became a father, and the story of the gods began again, in the halls of Olympus, in his mother\'s arms.');
      await c.wait(1.2);
      await UI.fade(1, 1.6);
      this.endFirstborn();
    },
    endFirstborn() {
      const Me = Memory, J = Campus.jesse;
      this.tickOn = false;
      if (Me.carrier) { Me.cupHands(Me.carrier, false); Me.carrier = null; }
      Me.baby.visible = false;
      if (this.babyHome) { this.babyHome.add(Me.baby); this.babyHome = null; }
      if (this.arielHall) this.arielHall.root.visible = false;
      (this.undress || []).forEach((u) => u());
      this.undress = [];
      this.giveBack();
      Home.flicker = 0;
    },
    async finish() {
      const R = World.arena, P = G.player, B = G.boss;
      if (SCRIPTS.bossDefeat.zeus) G.scene.remove(SCRIPTS.bossDefeat.zeus.root);
      Vase.hide();
      SCRIPTS.bossDefeat.restoreHall();
      G.flashback = false;
      SCRIPTS.bossDefeat.endWedding();
      SCRIPTS.bossDefeat.endFirstborn();
      Sound.setRain(0);
      if (G.activeScene !== G.scene) Game.useScene(G.scene);
      UI.hide('credits'); UI.chapter(null);
      B.root.visible = false;
      if (B.cape) B.cape.mesh.visible = false;
      G.flags.bossDefeated = true;
      P.stats.div += 1; P.derive();
      P.hp = P.maxHp; P.fp = P.maxFp;
      World.arena.gateActive = false;
      World.arena.gate.visible = false;
      World.arena.gateCollider.off = true;
      G.arenaLock = false;
      G.hermes.place(R.x + 3, R.z - 8, Math.PI);
      G.hermes.pos.y = World.getHeight(G.hermes.pos.x, G.hermes.pos.z);
      P.setPosition(R.x, R.z + 2, Math.PI);
      Game.save();
      UI.setFade(1);
      await Game.startPlay({ fadeIn: true });
      Music.play('explore');
      UI.toast('Obtained <b>Spark of War</b> · Divinity +1');
      setTimeout(() => UI.hint('Chapter I complete! Elysia is yours to explore — find the <b>golden apples</b>, level up, and speak with <b>Hermes</b>.', 10), 2000);
    },
  },

  /**
   * Berserker God Mode. Ariel's Rage is full and he calls on both halves of what he is: his father's thunder
   * and the shard of Ares' war. The fight holds its breath (G.freezeFoes) while the two gods tower out of the
   * sky behind him, Zeus in his storm and Ares in his fire, and pour themselves into him. He rises, and the
   * shockwave throws everything near him back. The first time in full; after that in a few beats.
   */
  godMode: {
    keepLock: true,
    /** Ares as an apparition: his own crimson armour, translucent, burning at the edges */
    makeAres() {
      const A = buildShell({ stance: 'ares', armSwing: [0, 0], mat: Mat.zeus });
      A.model = Models.attach(A.rig, 'ares', { ownMaterials: true });
      if (A.model) {
        A.mats = A.model.materials();
        A.mats.forEach((m) => {
          m.transparent = true;
          m.emissive = new THREE.Color(0.3, 0.04, 0.01);
          m.onBeforeCompile = (sh) => {
            sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
              float arL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(arL) * vec3(1.15, 0.2, 0.14), 0.85) * 0.5;`).replace('#include <opaque_fragment>', `
              float arR = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
              outgoingLight += vec3(1.8, 0.42, 0.08) * pow(arR, 2.2) * 2.4;
              #include <opaque_fragment>`);
          };
          m.customProgramCacheKey = () => 'aresSpectre';
          m.needsUpdate = true;
        });
        A.setOpacity = (v) => A.mats.forEach((m) => { m.opacity = v; m.depthWrite = v > 0.95; });
      } else A.setOpacity = (v) => { A.root.visible = v > 0.05; };
      return A;
    },
    /** the gods' power arriving: thunder and fire out from where he hangs, everything near thrown back */
    shockwave(P) {
      const c = P.pos.clone(), gy = World.getHeight(c.x, c.z, c.y + 1);
      FX.lightningStrike(c.clone(), { radius: 5, scale: 1.4, shake: 1.2, flash: 0.4, light: 1300, puff: false });
      FX.fireBurst(c, 3.5, 70);
      FX.ring(c.clone().setY(gy), 16, { color: [1.8, 0.8, 0.25], life: 1.0, opacity: 0.7 });
      FX.ring(c.clone().setY(gy), 10, { color: [0.6, 0.8, 1.6], life: 0.8, opacity: 0.7 });
      Sound.roar(1.15, 0.9); Sound.boom(1);
      for (const e of G.enemies) {
        if (!e.alive || !e.root.visible) continue;
        const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz) - e.radius;
        if (d > 10 || Math.abs(e.pos.y - gy) > 5) continue;
        P.strike(e, P.dmg * 1.5, 120, 'lightning', e.pos.clone().add(V(0, e.height * 0.5, 0)), c);
        P.shove(e, dx, dz, 14);
      }
    },
    async run(c) {
      const P = G.player, S = SCRIPTS.godMode;
      const first = !G.flags.godModeSeen;
      G.flags.godModeSeen = true;
      G.freezeFoes = true;
      const h = P.heading, f = V(Math.sin(h), 0, Math.cos(h)), r = V(Math.cos(h), 0, -Math.sin(h));
      const at = (fw, rt, up) => P.pos.clone().addScaledVector(f, fw).addScaledVector(r, rt).add(V(0, up, 0));
      const chest = () => P.pos.clone().add(V(0, 1.3, 0));
      const head = () => P.pos.clone().add(V(0, 1.62, 0));
      // the gods, giant and translucent high behind him: Zeus over his left shoulder, Ares over his right
      const Z = S.zeus || (S.zeus = SCRIPTS.bossDefeat.makeZeus());
      const A = S.ares || (S.ares = S.makeAres());
      const scale = 8, base = P.pos.y + 6.5;
      const place = (g, rt) => {
        const p = at(-25, rt, 0); p.y = base;
        g.root.scale.setScalar(scale);
        g.root.position.copy(p);
        g.root.rotation.y = Math.atan2(P.pos.x - p.x, P.pos.z - p.z);
        g.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        G.scene.add(g.root);
        g.setOpacity(0);
        g.root.visible = false;
      };
      place(Z, 12); place(A, -12);
      const godAt = (g, up) => g.root.position.clone().add(V(0, up * scale, 0));
      // their presence, every frame of the scene: fading in, reaching out to him, the storm and the fire round them
      const st = S.st = { z: 0, a: 0, zT: 0, aT: 0, reach: 0, reachT: 0, stream: false, n: 0, riseTo: null };
      const hz = new THREE.Vector3(), ha = new THREE.Vector3(), jp = new THREE.Vector3();
      const aJoints = [];
      A.root.traverse((o) => { if (o.userData.joint) aJoints.push(o); });
      clearInterval(S.iv);
      S.iv = setInterval(() => {
        const dt = 0.033;
        st.n++;
        st.z = damp(st.z, st.zT, 2.4, dt); st.a = damp(st.a, st.aT, 2.4, dt); st.reach = damp(st.reach, st.reachT, 2.5, dt);
        // he rises about three metres and hangs there, however long the line runs
        if (st.riseTo !== null) P.vy = clamp((st.riseTo - P.pos.y) * 1.6, 0, 2.6);
        Z.setOpacity(st.z * 0.9); A.setOpacity(st.a * 0.9);
        Z.root.visible = st.z > 0.01; A.root.visible = st.a > 0.01;
        const k = st.reach;
        Z.rig.poseFrom({ armR: [lerp(-40, -112, k), 0, lerp(-30, -12, k)], elbowR: [lerp(-60, -10, k), 0, 0], armL: [-30, 0, 30], elbowL: [-50, 0, 0], neck: [lerp(10, 24, k), 0, 0] });
        A.rig.poseFrom({ armL: [lerp(-20, -108, k), 0, lerp(20, 10, k)], elbowL: [lerp(-30, -8, k), 0, 0], armR: [-20, 0, -18], elbowR: [-30, 0, 0], neck: [lerp(4, 22, k), 0, 0] });
        if (Z.model) Z.model.update();
        if (A.model) A.model.update();
        Z.rig.j.handR.getWorldPosition(hz);
        A.rig.j.handL.getWorldPosition(ha);
        // Zeus in his storm: lightning crawls off him into the clouds
        if (st.z > 0.3 && Math.random() < 0.12) FX.bolt(hz.clone().add(V(rand(-3, 3), rand(-4, 2), rand(-3, 3))), hz.clone().add(V(rand(-10, 10), rand(18, 30), rand(-10, 10))), { radius: 0.18, life: 0.2, branches: 3 });
        // Ares in his fire
        if (st.a > 0.3 && aJoints.length) for (let i = 0; i < 3; i++) { aJoints[Math.floor(Math.random() * aJoints.length)].getWorldPosition(jp); FX.flame(jp, 3.2); }
        // the gift itself: the bolt and the fire into his chest
        if (st.stream) {
          if (st.n % 2 === 0) FX.bolt(hz, chest(), { radius: 0.12, life: 0.09, branches: 2 });
          FX.fireStream(ha, chest(), 12);
          if (st.n % 6 === 0) FX.flashLight(chest(), st.n % 12 ? 0xff7a30 : 0xb8d4ff, 140, 0.25, 16);
        }
      }, 33);

      // ---- the fight holds its breath: the colour drains out of the world, his heart pounds
      Sound.heartbeat(1);
      // (only half grey: the gods keep their colour against it)
      G.post.desat = 0.55;
      P.rig.play('clutch', { fade: 0.25 });
      G.cam.shake(0.3);
      c.shot(at(2.4, 0.8, 1.2), head(), 40);
      c.move(at(1.8, 0.6, 1.35), head(), first ? 4 : 2);
      await c.wait(first ? 1.1 : 0.6);
      if (first) await c.say('Ariel', 'Dad. Ares. If you can hear me — I need everything you have.');
      Sound.heartbeat(1);

      // ---- Zeus comes out of the storm
      FX.lightningStrike(godAt(Z, 0).setY(World.getHeight(Z.root.position.x, Z.root.position.z, base)), { radius: 4, scale: 1.4, shake: 0.6, flash: 0.18, light: 1400 });
      Sound.thunder(0);
      st.zT = 1;
      const upAt = (g) => godAt(g, 1.45);
      if (first) {
        c.shot(at(3.6, -2.8, 0.55), upAt(Z), 50);
        c.move(at(3.0, -2.3, 0.6), upAt(Z), 6, { ease: (t) => t });
        await c.wait(1.2);
        await c.say('Zeus', 'You never needed to ask, my son. The sky has always been yours.');
      }

      // ---- Ares comes out of the fire
      FX.fireBurst(godAt(A, 0.2), 6, 120);
      Sound.fire(true, 1); Sound.roar(0.55, 0.7);
      st.aT = 1;
      if (first) {
        c.shot(at(3.6, 2.8, 0.55), upAt(A), 50);
        c.move(at(3.0, 2.3, 0.6), upAt(A), 6, { ease: (t) => t });
        await c.wait(1.2);
        if (G.flags.bossDefeated) await c.say('Ares', 'And the war answers with it, brother. Let them see what the two of us made.');
        else await c.say('Ares', 'You want my war, little thief? Then take it. Every drop. And see if you can hold it.');
      } else {
        // the short version: both of them at once, behind him, and one of them speaks
        const mid = () => godAt(Z, 1.0).lerp(godAt(A, 1.0), 0.5);
        c.shot(at(5.5, 0, 0.7), P.pos.clone().lerp(mid(), 0.6), 56);
        c.move(at(4.8, 0, 0.9), P.pos.clone().lerp(mid(), 0.62), 3, { ease: (t) => t });
        await c.wait(0.8);
        const lines = G.flags.bossDefeated
          ? [() => c.say('Zeus', 'Rise, my son.'), () => c.say('Ares', 'Blood and thunder, brother!'), () => c.say('Ariel', 'Thunder and war. Let\'s go.')]
          : [() => c.say('Zeus', 'Rise, my son.'), () => c.say('Ares', 'Burn for me, little thief.'), () => c.say('Ariel', 'Thunder and war. Let\'s go.')];
        await pick(lines)();
      }

      // ---- the gift: they reach for him, and the thunder and the fire pour in; he rises with his arms spread
      st.reachT = 1;
      await c.wait(0.4);
      st.stream = true;
      P.cineGlow = 1;
      P.rig.play('ascend', { fade: 0.35 });
      P.flying = true; P.vx = P.vz = 0;
      st.riseTo = P.pos.y + 3;
      Sound.zap(); Sound.fire(true, 0.8);
      G.cam.shake(0.6);
      c.shot(at(7.5, 1.2, 0.9), chest().add(V(0, 1.6, 0)), 54);
      c.move(at(6.2, 1.0, 1.6), chest().add(V(0, 2.6, 0)), 2.6, { ease: (t) => t });
      if (first) {
        await c.wait(1.0);
        await c.say('Ariel', 'Then let\'s finish this.');
      } else await c.wait(1.6);
      st.riseTo = null; P.vy = 0;

      // ---- the roar, the shockwave, and the colour comes back burning
      st.stream = false;
      st.zT = st.aT = 0;
      G.post.desat = 0;
      P.beginGod();
      S.shockwave(P);
      c.shot(at(4.2, -1.6, 1.4), chest(), 46);
      c.move(at(5.6, -2.0, 2.0), chest(), 1.4);
      await c.wait(1.2);
    },
    async finish() {
      const P = G.player, S = SCRIPTS.godMode;
      clearInterval(S.iv);
      if (S.st) S.st.riseTo = null;
      for (const g of [S.zeus, S.ares]) if (g) { g.setOpacity(0); g.root.visible = false; if (g.root.parent) g.root.parent.remove(g.root); }
      G.freezeFoes = false;
      G.post.desat = 0;
      P.vy = 0;
      // (skipped before the gift: it is given all the same)
      if (!P.god && P.alive) { P.beginGod(); S.shockwave(P); }
      P.cineGlow = 0;
      if (!P.alive) return;
      // back into the fight where it stood: no reset, and the music plays on
      Game.setState('playing');
      P.state = 'free';
      P.rig.stop(0.3);
      UI.letterbox(false);
      UI.show('hud');
      G.cam.yaw = P.heading + Math.PI; G.cam.pitch = 0.22;
      G.cam.snap(P);
      G.camera.fov = 58; G.camera.updateProjectionMatrix();
      if (!Input.locked && !Input.lockFailed) UI.show('click-resume');
    },
  },
};
