'use strict';
/* ==========================================================================
   player.js · Ariel, son of Zeus · controller, combat and camera
   ========================================================================== */

class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.pitch = 0.2;
    this.dist = 4.4; this.curDist = 4.4;
    this.pivot = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shakeAmt = 0;
    this.fov = 58;
    this.manual = false;
    this._v = new THREE.Vector3();
  }
  shake(a) { if (G.settings.shake) this.shakeAmt = Math.min(1.5, Math.max(this.shakeAmt, a)); }
  snap(player) {
    this.pivot.copy(player.pos).add(new THREE.Vector3(0, 1.55, 0));
    this.curDist = this.dist;
    this.update(0.016, player, true);
  }
  update(dt, player, snap = false) {
    const lock = player.lock && player.lock.alive ? player.lock : null;
    const sens = 0.0021 * G.settings.sensitivity;
    if (!lock) {
      this.yaw -= Input.dx * sens;
      this.pitch += Input.dy * sens * (G.settings.invertY ? -1 : 1);
    } else {
      const d = this._v.copy(lock.pos).sub(player.pos);
      const want = Math.atan2(-d.x, -d.z);
      this.yaw = dampAngle(this.yaw, want, 9, dt);
      const hd = Math.hypot(d.x, d.z);
      const close = lock.size > 1.5 ? smooth(9, 3, hd) * 0.3 : 0;
      const wantPitch = clamp(0.28 + close - (lock.pos.y + lock.height * 0.5 - player.pos.y - 1.5) / Math.max(4, hd) * 0.6, 0.05, 0.75);
      this.pitch = damp(this.pitch, wantPitch, 4, dt);
    }
    if (Input.down('ArrowLeft')) this.yaw += 2.2 * dt;
    if (Input.down('ArrowRight')) this.yaw -= 2.2 * dt;
    if (Input.down('ArrowUp')) this.pitch -= 1.4 * dt;
    if (Input.down('ArrowDown')) this.pitch += 1.4 * dt;
    this.pitch = clamp(this.pitch, -0.55, 1.15);

    const want = this._v.copy(player.pos);
    want.y += 1.55;
    if (snap) this.pivot.copy(want);
    else {
      this.pivot.x = damp(this.pivot.x, want.x, 16, dt);
      this.pivot.z = damp(this.pivot.z, want.z, 16, dt);
      this.pivot.y = damp(this.pivot.y, want.y, 9, dt);
    }
    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = Math.sin(this.pitch), dz = Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const sh = 0.42;
    // keep the camera above ground and out of rock walls
    let dist = this.dist + (lock ? 0.8 : 0);
    for (let d = 0.6; d <= dist; d += 0.3) {
      const px = this.pivot.x + dx * d + rx * sh, py = this.pivot.y + dy * d, pz = this.pivot.z + dz * d + rz * sh;
      if (World.terrainHeight(px, pz) + 0.35 > py || (d > 1.2 && World.cameraBlocked(px, py, pz))) { dist = Math.max(0.9, d - 0.3); break; }
    }
    this.curDist = snap ? dist : damp(this.curDist, dist, dist < this.curDist ? 25 : 3, dt);
    const c = this.cam;
    c.position.set(this.pivot.x + dx * this.curDist + rx * sh, this.pivot.y + dy * this.curDist, this.pivot.z + dz * this.curDist + rz * sh);
    // never put the lens inside a giant
    for (const e of G.enemies) {
      if (e.size < 1.5 || !e.root.visible) continue;
      const ex = c.position.x - e.pos.x, ez = c.position.z - e.pos.z, ed = Math.hypot(ex, ez), rr = e.radius * 1.4 + 0.4;
      if (ed < rr && c.position.y < e.pos.y + e.height + 0.3 && ed > 1e-3) {
        c.position.x = e.pos.x + (ex / ed) * rr; c.position.z = e.pos.z + (ez / ed) * rr;
      }
    }
    const gy = World.terrainHeight(c.position.x, c.position.z) + 0.3;
    if (c.position.y < gy) c.position.y = gy;
    this.look.set(this.pivot.x + rx * sh, this.pivot.y, this.pivot.z + rz * sh);
    if (lock) this.look.lerp(this._v.copy(lock.pos).add(new THREE.Vector3(0, lock.height * 0.55, 0)), 0.18);
    // shake
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * 0.12, t = G.time * 40;
      c.position.x += Math.sin(t * 1.3) * s; c.position.y += Math.sin(t * 1.7 + 1) * s; c.position.z += Math.cos(t * 1.1) * s;
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    }
    c.lookAt(this.look);
    const fovT = player.sprinting ? 66 : 58;
    this.fov = damp(this.fov, fovT, 4, dt);
    if (Math.abs(c.fov - this.fov) > 0.01) { c.fov = this.fov; c.updateProjectionMatrix(); }
  }
}

const PLAYER_ACTIONS = {
  light1: { clip: 'light1', st: 14, hits: [[0.28, 0.46]], dmg: 1.0, poise: 16, range: 3.0, arc: 160, move: [[0.16, 0.45, 1.0]], next: 'light2', combo: 0.42, trail: [0.2, 0.55], track: 0.26 },
  light2: { clip: 'light2', st: 14, hits: [[0.26, 0.46]], dmg: 1.08, poise: 16, range: 3.0, arc: 160, move: [[0.14, 0.44, 0.9]], next: 'light3', combo: 0.42, trail: [0.18, 0.55], track: 0.24 },
  // the third cut lets go of the lightning stored in Keraunos: it arcs on to the next foes
  light3: { clip: 'light3', st: 18, hits: [[0.4, 0.55]], dmg: 1.5, poise: 28, range: 3.2, arc: 100, move: [[0.25, 0.52, 1.4]], next: 'light1', combo: 0.62, trail: [0.3, 0.62], track: 0.3, discharge: true },
  heavy: { clip: 'heavy', st: 30, aoe: [0.56, 4.2], dmg: 2.6, poise: 60, move: [[0.25, 0.56, 1.9]], trail: [0.38, 0.66], hyper: [0.15, 0.62], track: 0.35 },
  roll: { clip: 'roll', st: 18, iframes: [0.04, 0.46], move: [[0.03, 0.62, 4.7]] },
  back: { clip: 'backstep', st: 10, iframes: [0.02, 0.32], move: [[0.0, 0.5, -2.8]] },
  cast: { clip: 'cast', fp: 24, release: 0.48, track: 0.45 },
  heal: { clip: 'drink', heal: 0.55, moveMul: 0.3 },
  hit: { clip: 'hit' },
  knock: { clip: 'knock', iframes: [0, 0.78], move: [[0.05, 0.3, -1.6]] },
  // ---- the gifts of Zeus (fire: the moment in the clip the power is let go, see abilityFire)
  chain: { clip: 'chainCast', fp: 22, fire: 0.48, track: 0.45 },
  dash: { clip: 'dashStrike', st: 14, fire: 0.14, iframes: [0.04, 0.5], track: 0.12 },
  storm: { clip: 'nova', fp: 45, fire: 0.6, hyper: [0, 0.95], speed: 1.35 },
  // ---- the gifts of Ares
  warcry: { clip: 'warcry', fp: 18, fire: 0.36, hyper: [0, 0.95] },
  charge: { clip: 'charge', st: 24, move: [[0.1, 0.74, 9.5]], hits: [[0.1, 0.76]], dmg: 1.7, poise: 80, range: 1.7, arc: 140, hyper: [0, 0.82], charge: true, track: 0.1 },
  spear: { clip: 'spearThrow', fp: 26, fire: 0.5, track: 0.48 },
  // ---- in the air
  skybolt: { clip: 'chainCast', fp: 5, fire: 0.48, track: 0.45, speed: 1.6 },
  dive: { clip: 'dive', fire: 0.5, hyper: [0, 1], iframes: [0.3, 0.5] },
};

// the six gifts on the number keys: three of Zeus' thunder, three of Ares' war (cd: seconds of cooldown)
const ABILITIES = [
  { id: 'chain', key: 'Digit1', pad: 'Numpad1', god: 'zeus', cd: 6, name: 'Chain Lightning', short: 'Chain' },
  { id: 'dash', key: 'Digit2', pad: 'Numpad2', god: 'zeus', cd: 3, name: 'Thunder Step', short: 'Step' },
  { id: 'storm', key: 'Digit3', pad: 'Numpad3', god: 'zeus', cd: 20, name: 'Wrath of Olympus', short: 'Wrath' },
  { id: 'warcry', key: 'Digit4', pad: 'Numpad4', god: 'ares', cd: 24, name: 'War Cry', short: 'War Cry' },
  { id: 'charge', key: 'Digit5', pad: 'Numpad5', god: 'ares', cd: 7, name: 'Spartan Charge', short: 'Charge' },
  { id: 'spear', key: 'Digit6', pad: 'Numpad6', god: 'ares', cd: 6, name: 'Spear of Ares', short: 'Spear' },
];
const ABILITY = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));
// Berserker God Mode: how long it lasts, and what it does to the numbers
const GOD = { dur: 25, dmg: 2, taken: 0.35, cd: 3.3 };

// spoken when Ares takes hold of Ariel through the war-shard, and when Ariel throws him off
// (tools/make_voices.py reads these lists)
const GRIP_LINES = {
  Ares: ['Yes… let the war in.', 'Your blade is mine, brother.', 'Stop fighting me. You were made for this.', 'Blood first. Questions never.'],
  Ariel: ['Not… today!', 'Get out of my head!', 'My arm. MY arm.'],
};

class Player {
  constructor(scene) {
    const a = buildAriel();
    this.root = a.root; this.rig = a.rig; this.parts = a.parts;
    scene.add(this.root);
    this.model = Models.attach(this.rig, 'arielGod', { keep: [this.parts.sword] });
    if (this.model && this.model.weapon) {
      // the armoured sculpt carries its own blade: that is Keraunos now (trails and hits follow it)
      this.parts.sword.visible = false;
      const w = this.model.weapon;
      w.userData.base = this.model.markers.base;
      w.userData.tip = this.model.markers.tip;
      this.parts.sword = w;
    } else if (this.model) {
      // a rigged model: the sword hand closes on the grip, the free hand rests half-open, and the sword sits in the fist
      Models.curlFingers(this.model, 62, 30, ['Right']);
      Models.curlFingers(this.model, 22, 8, ['Left']);
      this.seatSword();
    }
    // he runs with the motion-captured Mixamo run when it is loaded (Models.loadMotion 'run')
    this.rig.mocapRun = 'run';
    // pinned across the tops of the shoulders, cloth wider than the shoulders so it drapes
    const sh = Math.abs(this.rig.j.armL.position.x);
    const capeFit = this.model
      ? { width: 0.66, topWidth: sh * 2 + 0.05, top: this.rig.j.armL.position.y + 0.07, back: -0.17, profile: Cape.backProfile(this.rig, this.model) }
      : { width: 0.56, topWidth: sh * 2, top: 0.25, back: -0.14 };
    this.cape = new Cape(this.rig, { length: 1.08, cols: 12, rows: 14, material: Mat.capeBlue, ...capeFit });
    this.cape.attach(scene);
    this.trail = new Trail(new THREE.Color(1.3, 1.9, 3.6), 1, 22, 0.13);
    this.trailBase = this.trail.mesh.material.uniforms.uColor.value.clone();
    scene.add(this.trail.mesh);
    // the light he gives off when the gods are in him (always in the scene, so turning it on never recompiles a shader)
    this.aura = new THREE.PointLight(0xffb060, 0, 10, 2);
    scene.add(this.aura);
    const sm = this.parts.sword.material;
    this.swordBase = sm && sm.emissive ? { e: sm.emissive.clone(), i: sm.emissiveIntensity } : null;
    this.pos = new THREE.Vector3();
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.kb = new THREE.Vector2(); // knockback velocity, bled off over a few frames
    this.visY = null;
    this.heading = Math.PI;
    this.height = 1.8; this.radius = 0.4;
    this.state = 'locked';
    this.alive = true;
    this.stats = { vig: 1, end: 1, str: 1, div: 1 };
    this.ichor = 0;
    this.flasks = 4; this.maxFlasks = 4;
    this.derive();
    this.hp = this.maxHp; this.fp = this.maxFp; this.st = this.maxSt;
    this.stDelay = 0; this.invuln = 0;
    this.lock = null;
    // Ares' hold through the war-shard (see seize): null, or the struggle in progress
    this.grip = null; this.gripT = rand(70, 120);
    // the gifts: seconds of cooldown left on each, Rage (fills in a fight, spent on God Mode), the buffs
    this.cd = {};
    for (const ab of ABILITIES) this.cd[ab.id] = 0;
    this.rage = G.params.has('rage') ? 100 : 0;
    this.god = null; this.fury = 0; this.flying = false; this.flyW = 0; this.flyLean = 0;
    this.glowK = 0; this.cineGlow = 0; this.blink = 0;
    this.sinceHurt = 99; this.sinceFight = 99;
    this.storm = null; this.spears = []; this.burns = new Map();
    this.anim = { speed: 0, dir: 1 };
    this.cine = { speed: 0 };
    this._v = new THREE.Vector3(); this._b = new THREE.Vector3(); this._t = new THREE.Vector3();
    this.rig.onStep = (run) => {
      if (this.state === 'locked' && this.cine.speed < 0.1) return;
      if (this.flying) return;
      Sound.step(false, 0.5 + run * 0.8);
      if (run > 0.5 && Math.random() < 0.5) FX.dust(this.pos, 0.3, 3, [0.5, 0.44, 0.33, 0.25]);
    };
  }
  /**
   * Put Keraunos' grip inside the model's closed right fist: grip centre between the knuckles and
   * the curled fingertips, blade out of the thumb side, edge facing the way the knuckles point.
   */
  seatSword() {
    if (!this.model.model.userData.skeleton) return;
    const bones = {};
    for (const b of this.model.model.userData.skeleton.bones) if (!bones[b.name]) bones[b.name] = b;
    const B = (n) => bones['RightHand' + n];
    if (!B('Index1') || !B('Pinky1') || !B('Middle1') || !B('Middle3')) return;
    this.root.updateMatrixWorld(true);
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const wrist = wp(bones.RightHand || B('Middle1').parent), idx = wp(B('Index1')), pky = wp(B('Pinky1'));
    const m1 = wp(B('Middle1')), m3 = wp(B('Middle3'));
    const centre = m1.clone().add(m3).multiplyScalar(0.5);
    const blade = idx.clone().sub(pky).normalize();                          // sword local -Y
    const edge = m1.clone().sub(wrist); edge.addScaledVector(blade, -edge.dot(blade)).normalize(); // local +X
    const y = blade.clone().negate(), z = new THREE.Vector3().crossVectors(edge, y).normalize();
    const R = new THREE.Matrix4().makeBasis(edge, y, z);
    const q = new THREE.Quaternion().setFromRotationMatrix(R);
    const grip = new THREE.Vector3(0, -0.06, 0).applyQuaternion(q);
    const sword = this.parts.sword;
    const world = new THREE.Matrix4().compose(centre.clone().sub(grip), q, new THREE.Vector3(1, 1, 1));
    sword.parent.updateMatrixWorld(true);
    const local = new THREE.Matrix4().copy(sword.parent.matrixWorld).invert().multiply(world);
    local.decompose(sword.position, sword.quaternion, sword.scale);
  }
  get level() { const s = this.stats; return s.vig + s.end + s.str + s.div - 3; }
  derive() {
    const s = this.stats;
    // the son of Zeus: a demigod's constitution and a god-forged blade
    this.maxHp = Math.round(560 + s.vig * 60);
    this.maxSt = Math.round(110 + s.end * 8);
    this.maxFp = Math.round(100 + s.div * 12);
    this.dmg = 44 * (1 + s.str * 0.08);
    this.spellDmg = 120 * (1 + s.div * 0.1);
    // the armour turns part of every blow
    this.armor = Math.min(0.35, 0.2 + s.vig * 0.008);
  }
  static levelCost(level) { return Math.round(160 * Math.pow(1.13, level)); }

  setPosition(x, z, heading) {
    this.pos.set(x, World.getHeight(x, z), z);
    if (heading !== undefined) this.heading = heading;
    this.vx = this.vz = this.vy = 0;
    this.flying = false;
    this.kb.set(0, 0);
    this.visY = this.pos.y;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.cape.needsReset = true;
  }
  respawn(x, z, heading) {
    this.setPosition(x, z, heading);
    this.hp = this.maxHp; this.fp = this.maxFp; this.st = this.maxSt;
    this.flasks = this.maxFlasks;
    this.alive = true; this.state = 'free'; this.lock = null; this.act = null;
    this.endGod(true);
    this.fury = 0; this.rage = 0; this.storm = null; this.burns.clear();
    for (const k in this.cd) this.cd[k] = 0;
    this.clearSpears();
    this.rig.stop(0.01); this.rig.act = null; this.rig.prev = null;
  }

  readInput() {
    const k = Input;
    const f = (k.down('KeyW') ? 1 : 0) - (k.down('KeyS') ? 1 : 0);
    const r = (k.down('KeyD') ? 1 : 0) - (k.down('KeyA') ? 1 : 0);
    const yaw = G.cam.yaw;
    let dx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
    let dz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    const m = Math.hypot(dx, dz);
    if (m > 0) { dx /= m; dz /= m; }
    const ab = ABILITIES.find((a) => k.pressed(a.key) || k.pressed(a.pad));
    return {
      dx, dz, mag: Math.min(1, m),
      sprint: k.down('ShiftLeft') || k.down('ShiftRight'),
      roll: k.pressed('Space'), light: k.clicked(0), heavy: k.clicked(2),
      cast: k.pressed('KeyQ'), heal: k.pressed('KeyR'),
      lock: k.pressed('Tab') || k.clicked(1), interact: k.pressed('KeyE'),
      ability: ab ? ab.id : null, fly: k.pressed('KeyF'), god: k.pressed('KeyG'),
      // in the air: Space climbs, C sinks (never Ctrl: Ctrl+W would close the browser tab)
      up: k.down('Space'), down: k.down('KeyC'),
    };
  }

  invulnerable() {
    if (G.params.has('god')) return true;
    if (this.invuln > 0) return true;
    if (this.state === 'action' && this.act.iframes) {
      const t = this.rig.progress(this.act.clip);
      return t >= this.act.iframes[0] && t <= this.act.iframes[1];
    }
    return false;
  }

  update(dt) {
    this.invuln -= dt;
    this.sprinting = false;
    if (this.state === 'locked' || this.state === 'dead') {
      if (this.grip) this.releaseGrip(true);
      if (this.state === 'dead') { this.endGod(true); this.flying = false; }
      this.updateGlow(dt);
      this.animate(dt, this.state === 'locked' ? this.cine.speed : 0, 1);
      return;
    }
    if (!G.flags.powersHint && G.state === 'playing' && !this.hintT) {
      this.hintT = setTimeout(() => {
        G.flags.powersHint = true;
        UI.hint('The gods are with you. <b>1–6</b> call the powers of Zeus and Ares · <b>F</b> to fly · when your <b>Rage</b> is full, <b>G</b> unleashes Berserker God Mode.', 12);
      }, 2500);
    }
    this.updateShard(dt);
    this.updateGifts(dt);
    const inp = this.grip ? this.gripInput(dt) : this.readInput();
    // stamina / focus / health regeneration (God Mode: the gods pour it back in)
    this.stDelay -= dt;
    if (this.god) this.st = this.maxSt;
    else if (this.stDelay <= 0 && this.state === 'free') this.st = Math.min(this.maxSt, this.st + 52 * dt);
    this.fp = Math.min(this.maxFp, this.fp + (this.god ? 14 : this.flying ? 0 : 2) * dt);
    this.sinceHurt += dt;
    if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + (this.sinceHurt > 4 ? 6 : 1.5) * (this.god ? 4 : 1) * dt);
    if (inp.lock) this.toggleLock();
    if (this.lock && (!this.lock.alive || this.lock.pos.distanceTo(this.pos) > 32)) this.lock = null;
    if (this.state === 'free') { if (this.flying) this.updateFly(dt, inp); else this.updateFree(dt, inp); }
    else if (this.state === 'action') this.updateAction(dt, inp);
    this.updateGlow(dt);
    this.animate(dt, this.anim.speed, this.anim.dir);
  }

  animate(dt, speed, dir) {
    // knockback slides out smoothly instead of teleporting
    if (this.kb.lengthSq() > 1e-4 && this.state !== 'locked') {
      World.move(this.pos, this.kb.x * dt, this.kb.y * dt, this.radius);
      this.kb.multiplyScalar(Math.exp(-8 * dt));
    }
    if (this.state !== 'locked') this.collideActors();
    if (this.flying && this.state !== 'dead') this.flyMove(dt);
    else {
      // ground & gravity
      const g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y > g + 0.02 && !(this.pos.y - g < 0.5 && this.vy <= 0)) {
        this.vy -= 28 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= g) { this.pos.y = g; if (this.vy < -8) Sound.step(true, 0.4); this.vy = 0; }
      } else { this.pos.y = g; this.vy = 0; }
    }
    if (G.arenaLock) {
      const A = World.arena, dx = this.pos.x - A.x, dz = this.pos.z - A.z, d = Math.hypot(dx, dz);
      if (d > A.r) { this.pos.x = A.x + (dx / d) * A.r; this.pos.z = A.z + (dz / d) * A.r; }
    }
    // steps and ledges: the body eases up/down instead of popping (big jumps still snap)
    if (this.visY === null || Math.abs(this.pos.y - this.visY) > 0.8 || this.flying) this.visY = this.pos.y;
    else this.visY = damp(this.visY, this.pos.y, 22, dt);
    this.root.position.set(this.pos.x, this.visY, this.pos.z);
    this.root.rotation.y = this.heading;
    this.rig.lean(dt, this.state === 'free' && !this.flying ? Math.hypot(this.vx, this.vz) : 0, this.heading);
    // in flight: the flying pose under everything he does, the body tipped into the direction of travel
    this.flyW = damp(this.flyW, this.flying ? 1 : 0, 6, dt);
    if (this.flyW > 0.001) {
      if (!this.rig.overlay) this.rig.overlay = { name: 'fly', t: 0, w: 0 };
      this.rig.overlay.w = this.flyW;
    } else this.rig.overlay = null;
    const fwd = this.flying ? (Math.sin(this.heading) * this.vx + Math.cos(this.heading) * this.vz) : 0;
    this.flyLean = damp(this.flyLean, clamp(fwd / 16, -0.25, 1) * 0.55, 3, dt);
    if (dt > 0) this.root.rotation.x += this.flyLean;
    this.rig.update(dt, this.flying ? 0 : speed, dir);
    if (this.model) this.model.update();
    this.cape.update(dt);
    // Thunder Step: for a blink he is the bolt, not a body
    if (this.blink > 0) {
      this.blink -= dt;
      this.root.visible = this.cape.mesh.visible = this.blink <= 0;
    }
    if (this.state === 'action' && this.act.trail) {
      const t = this.rig.progress(this.act.clip);
      if (t >= this.act.trail[0] && t <= this.act.trail[1]) {
        this.parts.sword.userData.base.getWorldPosition(this._b);
        this.parts.sword.userData.tip.getWorldPosition(this._t);
        this.trail.push(this._b, this._t);
      }
    }
    this.trail.update(dt);
  }

  updateFree(dt, inp) {
    const lock = this.lock;
    let max = 5.3;
    if (lock) max = 3.9;
    if (inp.sprint && inp.mag > 0.1 && this.st > 0) {
      max = 7.8; this.sprinting = true;
      if (!this.god) { this.st -= 15 * dt; this.stDelay = 0.5; }
    }
    if (this.god) max *= 1.25;
    this.vx = damp(this.vx, inp.dx * inp.mag * max, 11, dt);
    this.vz = damp(this.vz, inp.dz * inp.mag * max, 11, dt);
    const x0 = this.pos.x, z0 = this.pos.z;
    World.move(this.pos, this.vx * dt, this.vz * dt, this.radius);
    this.collideActors();
    // velocity follows what actually happened: no running on the spot against walls or bodies
    if (dt > 0) { this.vx = (this.pos.x - x0) / dt; this.vz = (this.pos.z - z0) / dt; }
    const sp = Math.hypot(this.vx, this.vz);
    let dir = 1;
    if (lock && !this.sprinting) {
      const want = Math.atan2(lock.pos.x - this.pos.x, lock.pos.z - this.pos.z);
      this.heading = dampAngle(this.heading, want, 12, dt);
      if (sp > 0.3) {
        const mv = Math.atan2(this.vx, this.vz);
        let rel = wrapAngle(mv - this.heading);
        if (Math.abs(rel) > Math.PI * 0.6) { dir = -1; rel = wrapAngle(rel + Math.PI); }
        this.rig.legYaw = damp(this.rig.legYaw || 0, clamp(rel, -1.2, 1.2), 10, dt);
      } else this.rig.legYaw = damp(this.rig.legYaw || 0, 0, 10, dt);
    } else {
      this.rig.legYaw = damp(this.rig.legYaw || 0, 0, 10, dt);
      if (inp.mag > 0.1) this.heading = dampAngle(this.heading, Math.atan2(inp.dx, inp.dz), 13, dt);
    }
    this.anim.speed = sp; this.anim.dir = dir;

    if (inp.interact && Game.tryInteract()) return;
    if (inp.god) { this.awaken(); return; }
    if (inp.fly) { this.takeOff(); return; }
    if (inp.ability && this.useAbility(inp.ability, inp)) return;
    if (inp.roll) { this.startAction(inp.mag > 0.1 ? 'roll' : 'back', inp); return; }
    if (inp.light) { this.startAction('light1', inp); return; }
    if (inp.heavy) { this.startAction('heavy', inp); return; }
    if (inp.cast) { this.startAction('cast', inp); return; }
    if (inp.heal) { this.startAction('heal', inp); return; }
  }

  /* ------------------------------------------------------------ flight */
  /** Zeus' storm carries him: F lifts him off (and lets him fall again). Costs FP while aloft, outside God Mode */
  takeOff() {
    if (!this.god && this.fp < 12) { UI.toast('Not enough <b>FP</b> to fly'); Sound.ui('back'); return; }
    this.flying = true;
    this.vy = 7.5;
    this.lock = this.lock && this.lock.alive ? this.lock : null;
    FX.dust(this.pos, 1.6, 18, [0.55, 0.5, 0.42, 0.4]);
    FX.ring(this.pos, 3.2, { color: [0.7, 0.95, 1.8], life: 0.45 });
    FX.sparks(this.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), new THREE.Vector3(0, -1, 0), 24, [1.4, 1.9, 3.4, 1], 6, false);
    Sound.zap(); Sound.roll();
    G.cam.shake(0.25);
  }
  land(soft = false) {
    if (!this.flying) return;
    this.flying = false;
    this.vy = soft ? 0 : this.vy;
    if (soft) { FX.dust(this.pos, 1.0, 10); Sound.step(true, 0.35); }
  }
  updateFly(dt, inp) {
    const boost = inp.sprint && inp.mag > 0.1;
    const max = (boost ? 16 : 9.5) * (this.god ? 1.3 : 1);
    this.sprinting = boost;
    this.vx = damp(this.vx, inp.dx * inp.mag * max, 3.2, dt);
    this.vz = damp(this.vz, inp.dz * inp.mag * max, 3.2, dt);
    this.vy = damp(this.vy, (inp.up ? 7.5 : 0) - (inp.down ? 9 : 0), 4, dt);
    if (!this.god) {
      this.fp -= (boost ? 8 : 4.5) * dt;
      if (this.fp <= 0) { this.fp = 0; this.land(); UI.toast('Your <b>FP</b> is spent — the storm lets you fall'); }
    }
    if (this.lock) this.heading = dampAngle(this.heading, Math.atan2(this.lock.pos.x - this.pos.x, this.lock.pos.z - this.pos.z), 8, dt);
    else if (inp.mag > 0.1) this.heading = dampAngle(this.heading, Math.atan2(inp.dx, inp.dz), 6, dt);
    this.anim.speed = 0;
    // the storm trails off his heels
    if (Math.random() < 0.5) {
      const f = this.rig.j[Math.random() < 0.5 ? 'footL' : 'footR'].getWorldPosition(this._v);
      FX.glow.spawn({ x: f.x, y: f.y, z: f.z, vx: -this.vx * 0.2 + rand(-0.4, 0.4), vy: rand(-1.2, -0.3), vz: -this.vz * 0.2 + rand(-0.4, 0.4), life: rand(0.2, 0.45), s: rand(0.06, 0.14), s2: 0.01, c: [1.4, 1.9, 3.4, 1], c2: [0.6, 0.9, 2.4, 0], drag: 2 });
    }
    if (!this.flying) return;
    if (inp.fly) { this.land(); return; }
    if (inp.god) { this.awaken(); return; }
    if (inp.ability) { if (this.useAbility(inp.ability, inp)) return; }
    if (inp.light) { this.startAction('skybolt', inp); return; }
    if (inp.heavy) { this.startAction('dive', inp); return; }
    if (inp.cast) { this.startAction('cast', inp); return; }
    if (inp.heal) { this.startAction('heal', inp); return; }
  }
  /** move through the air: over walls and rooftops when clear of the ground, never above the storm's ceiling */
  flyMove(dt) {
    let g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y - g < 3) World.move(this.pos, this.vx * dt, this.vz * dt, this.radius);
    else {
      const lim = World.HALF - 8;
      this.pos.x = clamp(this.pos.x + this.vx * dt, -lim, lim);
      this.pos.z = clamp(this.pos.z + this.vz * dt, -lim, lim);
    }
    this.pos.y += this.vy * dt;
    const t = World.terrainHeight(this.pos.x, this.pos.z), ceil = t + (G.arenaLock ? 9 : 30);
    if (this.pos.y > ceil) { this.pos.y = ceil; this.vy = Math.min(this.vy, 0); }
    g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y < g + 0.3) {
      this.pos.y = g + 0.3;
      // sinking onto the ground on purpose sets him down
      if (this.vy < -1.5 && this.state === 'free') this.land(true);
      else this.vy = Math.max(this.vy, 0);
    }
  }

  /* ------------------------------------------------------------ the gifts */
  useAbility(id, inp) {
    const ab = ABILITY[id];
    if (this.cd[id] > 0) { UI.pulseSlot('slot-' + id); Sound.ui('back'); return false; }
    // in the air the Spartan Charge becomes a dive onto whatever is below
    const name = this.flying && id === 'charge' ? 'dive' : id;
    if (!this.startAction(name, inp)) return false;
    this.cd[id] = ab.cd;
    UI.pulseSlot('slot-' + id);
    return true;
  }
  /** cooldowns, Rage, War Cry, the storm, the spears and the burning, every frame of play */
  updateGifts(dt) {
    const k = this.god ? GOD.cd : 1;
    for (const id in this.cd) if (this.cd[id] > 0) this.cd[id] = Math.max(0, this.cd[id] - dt * k);
    this.sinceFight += dt;
    if (this.god) {
      this.god.t -= dt;
      this.rage = Math.max(0, (this.god.t / this.god.dur) * 100);
      if (this.god.t <= 0) this.endGod();
    } else if (this.sinceFight > 10 && this.rage > 0 && this.rage < 100) this.rage = Math.max(0, this.rage - 1.5 * dt);
    if (this.fury > 0) {
      this.fury -= dt;
      if (this.fury <= 0) UI.toast('Ares\' fury cools');
    }
    this.updateStorm(dt);
    this.updateSpears(dt);
    for (const [e, b] of this.burns) {
      b.t -= dt; b.tick -= dt;
      if (!e.alive || b.t <= 0) { this.burns.delete(e); continue; }
      if (Math.random() < 0.5) FX.flame(e.pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3) * e.radius, rand(0.2, 0.9) * e.height, rand(-0.3, 0.3) * e.radius)), 0.45);
      if (b.tick <= 0) { b.tick = 0.5; this.strike(e, b.dps * 0.5, 2, 'fire', e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)), null, true); }
    }
  }
  dmgMul() { return (this.god ? GOD.dmg : 1) * (this.fury > 0 ? 1.35 : 1) * (this.grip ? 1.35 : 1); }
  /** every blow Ariel lands goes through here: the multipliers, Rage, War Cry's lifesteal */
  strike(e, dmg, poise, kind, hitPos, from = null, raw = false) {
    if (!e.alive) return;
    if (!raw) dmg *= this.dmgMul();
    e.takeHit(dmg * rand(0.95, 1.05), poise * (this.god ? 1.5 : 1), from || this.pos, kind, hitPos);
    this.sinceFight = 0;
    if (!this.god && !raw) {
      const was = this.rage;
      this.rage = Math.min(100, this.rage + (dmg / this.dmg) * 2.6);
      if (was < 100 && this.rage >= 100) this.rageFull();
    }
    if ((this.fury > 0 || this.god) && !raw) this.hp = Math.min(this.maxHp, this.hp + dmg * (this.god ? 0.06 : 0.15));
  }
  rageFull() {
    UI.toast('<b>Rage</b> is full — press <b>G</b> for Berserker God Mode');
    Sound.heartbeat(1); Sound.bell();
    if (!G.flags.rageHint) { G.flags.rageHint = true; UI.hint('Your <b>Rage</b> is full. Press <b>G</b>: Zeus and Ares will lend you everything they have.', 9); }
  }
  burn(e, dps, t = 3) {
    if (!e.alive) return;
    const b = this.burns.get(e);
    if (b) { b.t = Math.max(b.t, t); b.dps = Math.max(b.dps, dps); } else this.burns.set(e, { t, dps, tick: 0.5 });
  }
  shove(e, x, z, force) {
    if (!e.alive || e.size > 1.5 || e.def.boss) return;
    const d = Math.hypot(x, z) || 1;
    if (!e.kb) e.kb = new THREE.Vector2();
    e.kb.set((x / d) * force, (z / d) * force);
  }
  /** the moment an ability is let go (PLAYER_ACTIONS[...].fire) */
  abilityFire(name) {
    if (name === 'chain') this.chainLightning();
    else if (name === 'dash') this.thunderStep();
    else if (name === 'storm') this.callStorm();
    else if (name === 'warcry') this.warCry();
    else if (name === 'spear') this.throwSpear();
    else if (name === 'skybolt') this.skyBolt();
    else if (name === 'dive') this.diveImpact();
  }
  swordTip() { return this.parts.sword.userData.tip.getWorldPosition(new THREE.Vector3()); }
  /** the foe Ariel means: the locked one, else the best one ahead within range */
  aimFoe(range = 20, minDot = 0.5) {
    if (this.lock && this.lock.alive) return this.lock;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > range) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < minDot && d > 2.5) continue;
      const s = d * (2 - dot);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  /** Chain Lightning: a bolt from Keraunos to the foe, then on from foe to foe */
  chainLightning(first = null, links = this.god ? 8 : 5, dmg = this.spellDmg * 0.8, from = null, exclude = null) {
    const hit = new Set(exclude ? [exclude] : []);
    // on from a foe already struck (Keraunos' discharge): the nearest other foe, or nothing at all
    const nextFrom = (src) => {
      let next = null, nd = 9;
      for (const e of G.enemies) {
        if (!e.alive || hit.has(e) || !e.root.visible) continue;
        const d = e.pos.distanceTo(src.pos) - e.radius;
        if (d < nd) { nd = d; next = e; }
      }
      return next;
    };
    let cur = first || (exclude ? nextFrom(exclude) : this.aimFoe(18));
    if (!cur && exclude) return;
    const tip = from || this.swordTip();
    Sound.zap(); Sound.thunder(6);
    if (!cur) {
      const p = this.pos.clone().add(new THREE.Vector3(Math.sin(this.heading) * 9, 0, Math.cos(this.heading) * 9));
      p.y = World.getHeight(p.x, p.z, this.pos.y + 2);
      FX.bolt(tip, p, { radius: 0.07, life: 0.3, branches: 3 });
      FX.sparks(p, new THREE.Vector3(0, 1, 0), 20, [1.4, 1.9, 3.4, 1], 6, false);
      return;
    }
    let prev = tip, i = 0;
    const link = () => {
      if (!cur || !cur.alive || i >= links) return;
      const tp = cur.pos.clone().add(new THREE.Vector3(0, cur.height * 0.55, 0));
      FX.bolt(prev, tp, { radius: 0.075, life: 0.34, branches: 3 });
      FX.flashLight(tp, 0x9cc4ff, 60, 0.25, 12);
      this.strike(cur, dmg * (1 - i * 0.07), 30, 'lightning', tp);
      hit.add(cur);
      prev = tp; i++;
      // on to the nearest foe it has not struck yet
      cur = nextFrom(cur);
      if (cur) setTimeout(link, 70);
    };
    link();
    G.cam.shake(0.3);
  }
  /** Thunder Step: he becomes the bolt and is somewhere else, striking everything it passed through */
  thunderStep() {
    const start = this.pos.clone();
    let dist = this.god ? 12 : 8.5;
    const foe = this.lock && this.lock.alive ? this.lock : null;
    if (foe) {
      this.heading = Math.atan2(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z);
      dist = Math.min(dist + 2, Math.hypot(foe.pos.x - this.pos.x, foe.pos.z - this.pos.z) + foe.radius + 1.6);
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (this.flying) { this.pos.x += fx * dist; this.pos.z += fz * dist; this.flyMove(0); }
    else { World.move(this.pos, fx * dist, fz * dist, this.radius); this.pos.y = World.getHeight(this.pos.x, this.pos.z, this.pos.y + 1); }
    const end = this.pos.clone();
    const sx = end.x - start.x, sz = end.z - start.z, L = Math.hypot(sx, sz) || 1;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      const ex = e.pos.x - start.x, ez = e.pos.z - start.z;
      const u = clamp((ex * sx + ez * sz) / (L * L), 0, 1);
      const lat = Math.hypot(ex - sx * u, ez - sz * u);
      if (lat > e.radius + 1.3 || Math.abs(e.pos.y - lerp(start.y, end.y, u)) > 2 + e.height * 0.5) continue;
      const hp = e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0));
      this.strike(e, this.dmg * 1.9, 45, 'lightning', hp, start);
    }
    // (thin: seen end-on from behind him, a thick bolt stacks into a white blob)
    const a = start.clone().add(new THREE.Vector3(fx * 0.8, 1.0, fz * 0.8)), b = end.clone().add(new THREE.Vector3(0, 1.0, 0));
    FX.bolt(a, b, { radius: 0.035, life: 0.24, branches: 4 });
    FX.bolt(a.clone().add(new THREE.Vector3(0, -0.4, 0)), b.clone().add(new THREE.Vector3(0, 0.4, 0)), { radius: 0.018, life: 0.16, branches: 2 });
    FX.sparks(a, null, 24, [1.4, 1.9, 3.4, 1], 6, false);
    FX.sparks(b, null, 30, [1.4, 1.9, 3.4, 1], 7, false);
    FX.flashLight(b.clone().add(new THREE.Vector3(0, 0.5, 0)), 0xb8d4ff, 70, 0.3, 14);
    Sound.zap(); Sound.thunder(2);
    G.cam.shake(0.4);
    this.blink = 0.14;
    this.root.visible = this.cape.mesh.visible = false;
    this.cape.needsReset = true;
    this.visY = this.pos.y;
  }
  /** Wrath of Olympus: the sky answers, bolt after bolt around him for a few seconds */
  callStorm() {
    this.storm = { n: this.god ? 18 : 12, next: 0.1, struck: new Map() };
    const c = this.pos.clone();
    FX.ring(c, 10, { color: [0.6, 0.85, 1.6], life: 0.9 });
    FX.sparks(this.swordTip(), new THREE.Vector3(0, 1, 0), 40, [1.4, 1.9, 3.4, 1], 9, false);
    FX.bolt(this.swordTip(), this.swordTip().add(new THREE.Vector3(rand(-4, 4), 60, rand(-4, 4))), { radius: 0.12, life: 0.4, branches: 4 });
    FX.flashLight(c.clone().add(new THREE.Vector3(0, 4, 0)), 0xb8d4ff, 220, 0.5, 30);
    UI.flash(0.15);
    Sound.thunder(0);
    G.cam.shake(0.7);
  }
  updateStorm(dt) {
    const S = this.storm;
    if (!S) return;
    S.next -= dt;
    if (S.next > 0) return;
    S.n--; S.next = rand(0.16, 0.28);
    // the bolts hunt the foes around him (each struck a few times at most), and scorch the ground between
    let target = null, best = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      const d = e.pos.distanceTo(this.pos);
      if (d > 16) continue;
      const s = d + (S.struck.get(e) || 0) * 9 + rand(0, 4);
      if (s < best && (S.struck.get(e) || 0) < 4) { best = s; target = e; }
    }
    let p;
    if (target) { p = target.pos.clone(); S.struck.set(target, (S.struck.get(target) || 0) + 1); }
    else { const a = rand(0, TAU), r = rand(6, 13); p = this.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    p.y = World.getHeight(p.x, p.z, p.y + 2);
    FX.lightningStrike(p, { radius: 2.4, scale: 0.75, shake: 0.3, sound: S.n % 2 === 0, flash: 0, decal: S.n % 3 === 0, light: 260, puff: false });
    this.aoeDamage(p, 2.7, this.spellDmg * 0.7, 35, 'lightning');
    if (S.n <= 0) this.storm = null;
  }
  /** War Cry: Ares' roar. Foes close by are shaken and thrown back, and his fury fills Keraunos */
  warCry() {
    this.fury = this.god ? GOD.dur : 12;
    Sound.roar(1.25, 0.9); Sound.fire(true, 0.8);
    const c = this.pos.clone();
    FX.ring(c, 8, { color: [1.6, 0.45, 0.12], life: 0.7, opacity: 0.45 });
    FX.fireBurst(c, 1.1, 18);
    FX.flashLight(c.clone().add(new THREE.Vector3(0, 2, 0)), 0xff6a20, 90, 0.5, 16);
    G.cam.shake(0.8);
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      const dx = e.pos.x - c.x, dz = e.pos.z - c.z, d = Math.hypot(dx, dz) - e.radius;
      if (d > 7.5 || Math.abs(e.pos.y - c.y) > 3 + e.height * 0.5) continue;
      this.strike(e, this.dmg * 0.7, 70, 'fire', e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)));
      this.shove(e, dx, dz, 9);
    }
    UI.toast('<b>War Cry</b> — Ares\' fury burns in Keraunos');
  }
  spearMesh() {
    if (!Player.spearGeo) {
      const shaft = new THREE.CylinderGeometry(0.035, 0.035, 2.1, 8); shaft.translate(0, -0.2, 0);
      const head = new THREE.ConeGeometry(0.09, 0.42, 8); head.translate(0, 1.06, 0);
      Player.spearGeo = Addons.mergeGeometries([shaft.toNonIndexed(), head.toNonIndexed()]);
      Player.spearMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 1.3, 0.3) });
    }
    return new THREE.Mesh(Player.spearGeo, Player.spearMat);
  }
  /** Spear of Ares: a javelin of his fire, out of the free hand */
  throwSpear() {
    const hand = this.rig.j.handL.getWorldPosition(new THREE.Vector3());
    const foe = this.aimFoe(30, 0.4);
    let target;
    if (foe) target = foe.pos.clone().add(new THREE.Vector3(0, foe.height * 0.5, 0));
    else {
      target = this.pos.clone().add(new THREE.Vector3(Math.sin(this.heading) * 24, 1.2, Math.cos(this.heading) * 24));
      if (this.flying) target.y = World.getHeight(target.x, target.z, this.pos.y) + 0.5;
    }
    const dir = target.sub(hand).normalize();
    const mesh = this.spearMesh();
    mesh.position.copy(hand);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.root.parent.add(mesh);
    this.spears.push({ mesh, dir, speed: 42, life: 1.3 });
    FX.fireStream(hand, hand.clone().addScaledVector(dir, 2), 14);
    Sound.fire(false, 0.9); Sound.swing(true);
  }
  updateSpears(dt) {
    for (let i = this.spears.length - 1; i >= 0; i--) {
      const s = this.spears[i], p = s.mesh.position;
      s.life -= dt;
      const step = s.speed * dt;
      let hit = s.life <= 0;
      // swept along the step, so it cannot fly through a body between two frames
      for (let k = 0; k < 4 && !hit; k++) {
        p.addScaledVector(s.dir, step / 4);
        if (p.y < World.getHeight(p.x, p.z, p.y + 1) + 0.05) hit = true;
        for (const e of G.enemies) {
          if (!e.alive || !e.root.visible) continue;
          if (Math.hypot(p.x - e.pos.x, p.z - e.pos.z) < e.radius + 0.35 && p.y > e.pos.y - 0.2 && p.y < e.pos.y + e.height + 0.3) { hit = true; break; }
        }
      }
      FX.flame(p.clone().addScaledVector(s.dir, -0.6), 0.5);
      if (Math.random() < 0.5) FX.flame(p.clone().addScaledVector(s.dir, -1.2), 0.35);
      if (!hit) continue;
      this.spears.splice(i, 1);
      s.mesh.parent.remove(s.mesh);
      const c = p.clone();
      FX.fireBurst(c, 2, 50);
      FX.ring(c, 4.2, { color: [1.8, 0.5, 0.12], life: 0.6, opacity: 0.85 });
      FX.flashLight(c.clone().add(new THREE.Vector3(0, 1.5, 0)), 0xff6a20, 120, 0.45, 20);
      FX.decal(c, 3.4);
      Sound.boom(0.7); Sound.fire(true, 0.7);
      G.cam.shake(0.5);
      this.aoeDamage(c, 3.8, this.spellDmg * 1.1, 55, 'fire', (e) => this.burn(e, this.spellDmg * 0.18 * this.dmgMul(), 3.5));
    }
  }
  clearSpears() { for (const s of this.spears) if (s.mesh.parent) s.mesh.parent.remove(s.mesh); this.spears = []; }
  /** in the air, Keraunos points and the lightning goes down to the foe below */
  skyBolt() {
    const foe = this.aimFoe(26, 0.2);
    let p;
    if (foe) p = foe.pos.clone().add(new THREE.Vector3(0, foe.height * 0.5, 0));
    else { p = this.pos.clone().add(new THREE.Vector3(Math.sin(this.heading) * 10, 0, Math.cos(this.heading) * 10)); p.y = World.getHeight(p.x, p.z, this.pos.y) + 0.1; }
    FX.bolt(this.swordTip(), p, { radius: 0.09, life: 0.3, branches: 4 });
    FX.sparks(p, null, 26, [1.4, 1.9, 3.4, 1], 7, false);
    FX.flashLight(p, 0x9cc4ff, 70, 0.25, 14);
    Sound.zap();
    this.aoeDamage(p, 1.9, this.spellDmg * 0.6, 25, 'lightning');
  }
  /** the dive lands: the ground takes Zeus' thunder and Ares' fire at once */
  diveImpact() {
    const c = this.pos.clone();
    FX.lightningStrike(c.clone(), { radius: 3.4, scale: 1.0, shake: 1.0, flash: 0.12, light: 1200 });
    FX.fireBurst(c, 2.2, 50);
    FX.ring(c, 6, { color: [2.6, 0.9, 0.3], life: 0.7 });
    FX.dust(c, 4, 26);
    Sound.boom(1);
    G.hitStop = 0.08;
    this.aoeDamage(c, 5.2, this.dmg * 3.2, 90, 'lightning', (e) => this.shove(e, e.pos.x - c.x, e.pos.z - c.z, 11));
  }

  /* ------------------------------------------------------------ Berserker God Mode */
  /** G with a full Rage: Zeus and Ares answer (SCRIPTS.godMode), and the cutscene hands him their power */
  awaken() {
    if (this.god) return;
    if (this.rage < 100) {
      UI.toast(`<b>Rage</b> ${Math.floor(this.rage)}% — fill it in battle to call the gods`);
      UI.pulseSlot('slot-god'); Sound.ui('back');
      return;
    }
    if (G.state === 'playing' && SCRIPTS.godMode && !Cutscene.active) Cutscene.play('godMode');
    else this.beginGod();
  }
  beginGod() {
    if (this.god) return;
    this.god = { t: GOD.dur, dur: GOD.dur };
    this.rage = 100;
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
    this.st = this.maxSt; this.fp = this.maxFp;
    for (const k in this.cd) this.cd[k] = 0;
    if (this.grip) this.releaseGrip(true);
    UI.banner('BERSERKER — GOD MODE', 'god');
  }
  endGod(quiet = false) {
    if (!this.god) return;
    this.god = null;
    this.rage = 0;
    if (quiet) return;
    const c = this.root.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    FX.sparks(c, null, 50, [2.6, 1.6, 0.6, 1], 6, false);
    Sound.tone({ type: 'sine', f: 320, f2: 160, dur: 1.2, gain: 0.12, rev: 0.6 });
    UI.toast('The gods withdraw. <b>God Mode</b> ends.');
  }
  /** the gods' light in him: rim of fire on the armour, the aura, the blade's colour, embers and sparks */
  updateGlow(dt) {
    const fury = this.fury > 0 ? 1 : 0;
    this.glowK = damp(this.glowK, Math.max(this.god ? 1 : 0, this.cineGlow), 3, dt);
    if (typeof GOD_GLOW !== 'undefined') GOD_GLOW.value = this.glowK * (0.82 + 0.18 * Math.sin(G.time * 7));
    const k = Math.max(this.glowK, fury * 0.45, this.grip ? 0.3 : 0);
    this.aura.position.copy(this.root.position).add(new THREE.Vector3(0, 1.3, 0));
    this.aura.intensity = k > 0.01 ? k * (16 + Math.sin(G.time * 23) * 3 + Math.random() * 3) : 0;
    this.aura.color.setRGB(1, 0.5 + 0.12 * Math.sin(G.time * 5), 0.22 + 0.2 * this.glowK * (0.5 + 0.5 * Math.sin(G.time * 3.1)));
    if (k > 0.05 && this.root.visible && Math.random() < 0.35 + k * 0.4) FX.aura(this.root, 1, fury || this.glowK > 0.05, this.glowK > 0.05);
    // Keraunos: cold blue with Zeus' thunder, burning red with Ares (War Cry, his grip), both at once in God Mode
    const m = this.parts.sword.material, B = this.swordBase;
    if (m && m.emissive && B) {
      if (this.grip) { m.emissive.setHex(0xff2a0a); m.emissiveIntensity = 0.9; }
      else if (this.glowK > 0.05) { m.emissive.setRGB(1, 0.35 + 0.3 * Math.sin(G.time * 4), 0.1 + 0.6 * (0.5 + 0.5 * Math.sin(G.time * 2.3))); m.emissiveIntensity = lerp(B.i, 1.3, this.glowK); }
      else if (fury) { m.emissive.setHex(0xff4a10); m.emissiveIntensity = 0.8; }
      else { m.emissive.copy(B.e); m.emissiveIntensity = B.i; }
    }
    const tu = this.trail.mesh.material.uniforms.uColor.value;
    if (this.glowK > 0.05 || fury || this.grip) tu.setRGB(3.4, 1.3, 0.4); else tu.copy(this.trailBase);
    if ((fury || this.glowK > 0.05 || this.grip) && this.root.visible && Math.random() < 0.7) {
      this.parts.sword.userData.tip.getWorldPosition(this._t);
      this.parts.sword.userData.base.getWorldPosition(this._b);
      const p = this._b.lerp(this._t, Math.random());
      if (Math.random() < 0.6) FX.flame(p, 0.26, [2.4, 0.5, 0.12, 0.7]);
      if (this.glowK > 0.05 && Math.random() < 0.5) FX.glow.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-2, 2), vy: rand(-1, 2), vz: rand(-2, 2), life: rand(0.06, 0.16), s: rand(0.05, 0.1), s2: 0.01, c: [1.6, 2.1, 3.6, 1], c2: [0.8, 1.2, 3, 0], drag: 4 });
    }
  }

  startAction(name, inp) {
    const a = PLAYER_ACTIONS[name];
    const free = !!this.god;
    if (a.st && this.st <= 0 && !free) { Sound.ui('back'); return false; }
    if (a.fp && this.fp < a.fp && !free) { UI.toast('Not enough <b>FP</b>'); Sound.ui('back'); return false; }
    if (name === 'heal') {
      if (this.flasks <= 0) { UI.pulseSlot('slot-flask'); Sound.ui('back'); return false; }
      this.flasks--; UI.pulseSlot('slot-flask');
    }
    if (a.st && !free) { this.st -= a.st; this.stDelay = 0.7; }
    if (a.fp && !free) this.fp -= a.fp;
    this.state = 'action'; this.act = a; this.actName = name;
    this.prevT = 0; this.hitSet = new Set(); this.buffer = null; this.fired = {};
    this.rig.legYaw = 0;
    // facing
    if (name === 'roll' && inp && inp.mag > 0.1) this.heading = Math.atan2(inp.dx, inp.dz);
    else if (name !== 'back' && name !== 'hit' && name !== 'knock') {
      if (this.lock) this.heading = Math.atan2(this.lock.pos.x - this.pos.x, this.lock.pos.z - this.pos.z);
      else if (inp && inp.mag > 0.1) this.heading = Math.atan2(inp.dx, inp.dz);
    }
    // the gods make him quicker; in the air only the upper body acts, the flying pose holds the legs
    const quick = this.god ? 1.2 : this.fury > 0 && (a.hits || a.aoe) ? 1.1 : 1;
    const air = this.flying && name !== 'dive';
    this.rig.play(a.clip, { fade: name === 'roll' || name === 'back' ? 0.05 : 0.08, speed: (a.speed || 1) * quick, mask: air ? 'upper' : undefined });
    if (name === 'roll' || name === 'back') Sound.roll();
    if (name === 'cast' || name === 'chain' || name === 'skybolt') Sound.zap();
    if (name === 'charge') { Sound.roar(1.4, 0.5); Sound.roll(); }
    if (name === 'dive') {
      // Keraunos over his head and down like a thunderbolt
      this.diving = this.flying;
      this.flying = false;
      this.vy = this.diving ? -32 : 0;
      Sound.swing(true);
    }
    if (!this.flying) this.vx = this.vz = 0;
    return true;
  }

  updateAction(dt, inp) {
    const a = this.act;
    // the dive holds its raised pose until he meets the ground
    if (this.actName === 'dive' && this.diving) {
      const g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
      if (this.pos.y - g > 0.05) {
        if (this.rig.act && this.rig.act.name === 'dive' && this.rig.act.t > 0.3) this.rig.act.t = 0.3;
        this.vy = Math.min(this.vy, -32);
        if (Math.random() < 0.8) FX.sparks(this.swordTip(), new THREE.Vector3(0, 1, 0), 3, [1.4, 1.9, 3.4, 1], 3, false);
      } else this.diving = false;
    }
    const t = this.rig.progress(a.clip), pt = this.prevT;
    // root motion
    let mv = 0;
    if (a.move) for (const [t0, t1, d] of a.move) {
      const f = (x) => d * easeOutQuad(clamp((x - t0) / (t1 - t0), 0, 1));
      mv += f(t) - f(pt);
    }
    // lunges and rolls stop at an enemy's body instead of sliding into it (the charge only stops at a giant)
    if (mv > 0) mv = Math.min(mv, this.roomAhead(a.charge));
    if (mv) World.move(this.pos, Math.sin(this.heading) * mv, Math.cos(this.heading) * mv, this.radius);
    if (a.charge && t > 0.1 && t < 0.74 && Math.random() < 0.6) FX.dust(this.pos, 0.5, 2);
    if (a.moveMul && inp.mag > 0.1 && !this.flying) {
      World.move(this.pos, inp.dx * 5 * a.moveMul * dt, inp.dz * 5 * a.moveMul * dt, this.radius);
      this.heading = dampAngle(this.heading, Math.atan2(inp.dx, inp.dz), 6, dt);
      this.anim.speed = 5 * a.moveMul;
    } else this.anim.speed = 0;
    // in the air he hangs where he is while he acts
    if (this.flying) {
      this.vx = damp(this.vx, 0, 2.5, dt); this.vz = damp(this.vz, 0, 2.5, dt);
      this.vy = damp(this.vy, (inp.up ? 5 : 0) - (inp.down ? 6 : 0), 4, dt);
    }
    // tracking during wind-up
    if (a.track && t < a.track) {
      let want = null;
      if (this.lock) want = Math.atan2(this.lock.pos.x - this.pos.x, this.lock.pos.z - this.pos.z);
      else if (inp.mag > 0.1) want = Math.atan2(inp.dx, inp.dz);
      if (want !== null) this.heading = dampAngle(this.heading, want, 10, dt);
    }
    // sword hits
    if (a.hits) a.hits.forEach(([s, e], i) => {
      if (t >= s && pt < s) Sound.swing(this.actName === 'light3');
      if (t >= s && pt <= e) this.hitEnemies(a.range, a.arc, this.dmg * a.dmg, a.poise);
    });
    // thunder slam
    if (a.aoe && t >= a.aoe[0] && !this.fired.aoe) {
      this.fired.aoe = true;
      Sound.swing(true);
      const c = this._v.set(this.pos.x + Math.sin(this.heading) * 1.9, 0, this.pos.z + Math.cos(this.heading) * 1.9);
      c.y = World.getHeight(c.x, c.z, this.pos.y + 1);
      FX.lightningStrike(c.clone(), { radius: 2.8, scale: 0.8, shake: 0.7 });
      // in God Mode Ares' fire goes with Zeus' thunder
      if (this.god || this.fury > 0) { FX.fireBurst(c, 2.6, 50); FX.ring(c, a.aoe[1] * 1.2, { color: [2.6, 0.8, 0.2], life: 0.5 }); }
      this.aoeDamage(c, a.aoe[1] * (this.god ? 1.3 : 1), this.dmg * a.dmg, a.poise, 'lightning');
      G.hitStop = 0.07;
    }
    // Zeus's bolt
    if (a.release && t >= a.release && !this.fired.cast) {
      this.fired.cast = true;
      const target = this.spellTarget();
      setTimeout(() => {
        FX.lightningStrike(target.clone(), { radius: 3, scale: 1.1, shake: 0.8 });
        this.aoeDamage(target, 3.4, this.spellDmg, 45, 'lightning');
      }, 120);
      FX.sparks(this.root.position.clone().add(new THREE.Vector3(0, 2.0, 0)), new THREE.Vector3(0, 1, 0), 20, [1.4, 1.8, 3.2, 1], 5);
    }
    // an ability's moment
    if (a.fire !== undefined && t >= a.fire && !this.fired.fire && !this.diving) {
      this.fired.fire = true;
      this.abilityFire(this.actName);
    }
    // ambrosia
    if (a.heal && t >= a.heal && !this.fired.heal) {
      this.fired.heal = true;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.6);
      FX.healAura(this.pos);
      Sound.heal();
    }
    // input buffering
    if (a.next && inp.light && t > 0.2) this.buffer = a.next;
    if (inp.roll && t > 0.3 && !this.flying) this.buffer = inp.mag > 0.1 ? 'roll' : 'back';
    if (inp.heavy && a.next && t > 0.3) this.buffer = 'heavy';
    if (inp.roll) this.bufferInp = inp;
    const lastHit = a.hits ? a.hits[a.hits.length - 1][1] : a.aoe ? a.aoe[0] : 0.5;
    if (this.buffer) {
      const isDodge = this.buffer === 'roll' || this.buffer === 'back';
      const ready = isDodge ? (a.hits || a.aoe ? t > lastHit + 0.08 : t > 0.75) : t >= (a.combo || 0.85);
      if (ready && this.actName !== 'hit' && this.actName !== 'knock') {
        const b = this.buffer; this.buffer = null;
        if (this.startAction(b, isDodge ? this.bufferInp || inp : inp)) { this.prevT = 0; return; }
      }
    }
    this.prevT = t;
    if (t >= 1) { this.state = 'free'; this.act = null; }
  }

  /* ------------------------------------------------------------ the war-shard */
  /**
   * Ares' hold. A shard of his spark lives in Ariel (SCRIPTS.mirror), and while the rot has him he can
   * reach through it: now and then, in a fight, he takes the body. Ariel charges and cuts at the nearest
   * foe with Ares' strength (harder hits, no dodging) until the player throws him off by mashing Space.
   * Never before Ariel knows what it is, never once Ares is free, never while the gods are in him.
   */
  updateShard(dt) {
    if (this.grip || this.god || this.flying || !G.flags.mirrorSeen || G.flags.bossDefeated || G.state !== 'playing') return;
    // he only reaches in when there is blood to spill
    if (!G.arenaLock && !this.nearestFoe(16)) return;
    this.gripT -= dt;
    if (this.gripT <= 0 && this.state === 'free') this.seize();
  }
  nearestFoe(range) {
    let best = null, bd = range;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible || e.state === 'dormant') continue;
      const d = e.pos.distanceTo(this.pos) - e.radius;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  speak(who, text) {
    UI.subtitle(who, text);
    Voice.speak(text, who);
    clearTimeout(this.subT);
    this.subT = setTimeout(() => UI.subtitle(null), ((Voice.duration(text, who) || 2.4) + 0.6) * 1000);
  }
  seize() {
    this.grip = { t: 6.5, need: 7, got: 0, foe: null };
    this.lock = null;
    this.speak('Ares', pick(GRIP_LINES.Ares));
    G.post.possess = 0.6;
    Sound.heartbeat(1); Sound.roar(0.75, 0.45);
    G.cam.shake(0.5);
    // (Keraunos burns red in his grip: see updateGlow)
  }
  gripInput(dt) {
    const g = this.grip;
    g.t -= dt;
    // every press of Space wrenches a little more of the body back
    if (Input.pressed('Space')) {
      g.got++;
      Sound.tone({ type: 'triangle', f: 180 + g.got * 45, dur: 0.14, gain: 0.14 });
      G.cam.shake(0.18);
      FX.sparks(this.root.position.clone().add(new THREE.Vector3(0, 1.5, 0)), null, 8, [1.4, 1.9, 3.4, 1], 3);
    }
    g.beat = (g.beat || 0) - dt;
    if (g.beat <= 0) { Sound.heartbeat(0.8); g.beat = 0.9; }
    if (g.got >= g.need || g.t <= 0) { this.releaseGrip(); return this.readInput(); }
    // Ares drives the body: straight at the nearest foe, cutting the moment it is in reach
    const inp = { dx: 0, dz: 0, mag: 0, sprint: false, roll: false, light: false, heavy: false, cast: false, heal: false, lock: false, interact: false, ability: null, fly: false, god: false, up: false, down: false };
    const foe = g.foe && g.foe.alive ? g.foe : (g.foe = this.nearestFoe(30));
    if (foe) {
      const dx = foe.pos.x - this.pos.x, dz = foe.pos.z - this.pos.z, dd = Math.hypot(dx, dz) || 1, reach = dd - foe.radius;
      inp.dx = dx / dd; inp.dz = dz / dd;
      if (reach > 2.1) { inp.mag = 1; inp.sprint = reach > 5 && this.st > 10; }
      else if (this.st > 14) { inp.mag = 0.5; inp.light = true; }
    }
    return inp;
  }
  releaseGrip(quiet = false) {
    const g = this.grip;
    if (!g) return;
    this.grip = null;
    G.post.possess = 0;
    this.gripT = G.arenaLock ? rand(30, 45) : rand(70, 120);
    if (quiet) return;
    this.speak('Ariel', pick(GRIP_LINES.Ariel));
    const c = this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    FX.sparks(c, null, 60, [1.4, 1.9, 3.4, 1], 7, false);
    // (a light this close to the camera target: kept low, or the frame whites out)
    FX.flashLight(c, 0xb8d4ff, 90, 0.35, 12);
    Sound.zap();
    this.invuln = Math.max(this.invuln, 0.8);
  }

  /** how far Ariel can travel straight ahead before touching an enemy (charging: only one too big to shove) */
  roomAhead(charging = false) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let room = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible || e.airborne) continue;
      if (charging && e.size <= 1.5 && !e.def.boss) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const along = dx * fx + dz * fz;
      if (along <= 0) continue;
      const lat = Math.abs(dx * fz - dz * fx), m = this.radius + e.radius;
      if (lat >= m) continue;
      room = Math.min(room, Math.max(0, along - Math.sqrt(m * m - lat * lat) - 0.04));
    }
    return room;
  }
  /** bodies are solid: Ariel steps fully out of enemies and NPCs (two passes, for when she is hemmed in) */
  collideActors() {
    const push = (x, z, r) => {
      const dx = this.pos.x - x, dz = this.pos.z - z, d = Math.hypot(dx, dz), m = this.radius + r;
      if (d >= m) return;
      const nx = d > 1e-4 ? dx / d : -Math.sin(this.heading), nz = d > 1e-4 ? dz / d : -Math.cos(this.heading);
      World.move(this.pos, nx * (m - d), nz * (m - d), this.radius);
    };
    const H = G.hermes;
    for (let pass = 0; pass < 2; pass++) {
      for (const e of G.enemies) {
        if (!e.alive || !e.root.visible || e.airborne || Math.abs(e.pos.y - this.pos.y) > 2.5) continue;
        push(e.pos.x, e.pos.z, e.radius);
      }
      if (H && H.root.visible && Math.abs(H.pos.y - this.pos.y) < 2.5) push(H.pos.x, H.pos.z, 0.42);
    }
  }

  hitEnemies(range, arc, dmg, poise) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const a = this.act;
    for (const e of G.enemies) {
      if (!e.alive || this.hitSet.has(e)) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d - e.radius > range) continue;
      if (Math.abs(e.pos.y - this.pos.y) > 2 + e.height * 0.5) continue;
      if (arc < 360 && d > 0.6) {
        const ang = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
        if (ang > (arc / 2) * DEG) continue;
      }
      this.hitSet.add(e);
      const p = this._b.set(e.pos.x - dx / d * e.radius * 0.6, e.pos.y + e.height * 0.55, e.pos.z - dz / d * e.radius * 0.6).clone();
      this.strike(e, dmg, poise, 'slash', p);
      if (a && a.charge) {
        // thrown aside and back by the shoulder
        const side = Math.sign(dx * fz - dz * fx) || 1;
        this.shove(e, fx * 1.6 + fz * side * 0.8, fz * 1.6 - fx * side * 0.8, 12);
        FX.dust(e.pos, 0.8, 8);
        Sound.boom(0.4);
      }
      // God Mode: every cut carries the thunder and the fire with it
      if (this.god) {
        FX.bolt(this.swordTip(), p, { radius: 0.03, life: 0.16, branches: 2 });
        for (let k = 0; k < 3; k++) FX.flame(p, 0.45);
      } else if (this.fury > 0) for (let k = 0; k < 2; k++) FX.flame(p, 0.4);
      // the third cut lets the stored lightning go on to the next foes
      if (a && a.discharge) { const q = p.clone(); setTimeout(() => this.chainLightning(null, this.god ? 4 : 2, this.dmg * 0.6, q, e), 60); }
      G.hitStop = Math.max(G.hitStop, a && a.charge ? 0.04 : 0.055);
      G.cam.shake(a && a.charge ? 0.45 : 0.25);
    }
  }
  aoeDamage(c, r, dmg, poise, kind, each = null) {
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.radius;
      if (d > r || Math.abs(e.pos.y - c.y) > 4 + e.height * 0.5) continue;
      this.strike(e, dmg * (d < r * 0.5 ? 1 : 0.75), poise, kind, e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)), c);
      if (each) each(e);
    }
  }
  spellTarget() {
    if (this.lock && this.lock.alive) return this.lock.pos.clone();
    const best = this.aimFoe(20, 0.6);
    if (best) return best.pos.clone();
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const p = new THREE.Vector3(this.pos.x + fx * 9, 0, this.pos.z + fz * 9);
    p.y = World.getHeight(p.x, p.z, this.pos.y + 2);
    return p;
  }
  toggleLock() {
    if (this.lock) { this.lock = null; Sound.ui('back'); return; }
    const cf = new THREE.Vector3(); G.camera.getWorldDirection(cf);
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible) continue;
      const v = e.pos.clone().sub(this.pos); const d = v.length();
      if (d > 28) continue;
      v.normalize();
      const dot = v.x * cf.x + v.z * cf.z;
      if (dot < 0.35) continue;
      const s = d * (1.6 - dot);
      if (s < bs) { bs = s; best = e; }
    }
    if (best) { this.lock = best; Sound.ui('move'); }
  }

  takeDamage(dmg, from, opts = {}) {
    if (!this.alive || this.state === 'locked' || this.invulnerable()) return false;
    // the armour turns part of it; in God Mode the gods take most of the rest
    dmg *= (1 - this.armor) * (this.god ? GOD.taken : 1) * (this.fury > 0 ? 0.85 : 1);
    this.hp -= dmg;
    this.invuln = 0.4;
    this.sinceHurt = 0; this.sinceFight = 0;
    if (!this.god) {
      const was = this.rage;
      this.rage = Math.min(100, this.rage + (dmg / this.maxHp) * 70);
      if (was < 100 && this.rage >= 100) this.rageFull();
    }
    const chest = this.pos.clone().add(new THREE.Vector3(0, 1.25, 0));
    const away = this.pos.clone().sub(from).setY(0).normalize();
    FX.blood(chest, away, Math.round(clamp(14 + dmg * 0.4, 16, 40)), [0.62, 0.03, 0.022], { ground: this.pos.y });
    FX.sparks(chest, away, 6, [2.4, 1.6, 0.5, 1], 6, false);
    Sound.hit('flesh', 1);
    G.cam.shake(opts.knock ? 1.0 : 0.55);
    UI.damage();
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    const hyper = this.god || this.flying || (this.state === 'action' && this.act.hyper && (() => { const t = this.rig.progress(this.act.clip); return t >= this.act.hyper[0] && t <= this.act.hyper[1]; })());
    if (hyper) { this.rig.flinch = 1; return true; }
    if (opts.knock || dmg > this.maxHp * 0.38) {
      this.heading = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      this.startAction('knock');
      this.invuln = 0.9;
    } else {
      this.heading = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      this.startAction('hit');
      this.kb.set(away.x * 4, away.z * 4);
    }
    return true;
  }
  die() {
    this.releaseGrip(true);
    this.endGod(true);
    this.flying = false; this.diving = false;
    this.alive = false;
    this.state = 'dead';
    this.lock = null;
    this.rig.play('deathFwd', { fade: 0.1 });
    Sound.death();
    Game.onPlayerDeath();
  }
}
