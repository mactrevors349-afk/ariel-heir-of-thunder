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
  light1: { clip: 'light1', st: 14, hits: [[0.28, 0.46]], dmg: 1.0, poise: 14, range: 2.8, arc: 160, move: [[0.16, 0.45, 1.0]], next: 'light2', combo: 0.42, trail: [0.2, 0.55], track: 0.26 },
  light2: { clip: 'light2', st: 14, hits: [[0.26, 0.46]], dmg: 1.05, poise: 14, range: 2.8, arc: 160, move: [[0.14, 0.44, 0.9]], next: 'light3', combo: 0.42, trail: [0.18, 0.55], track: 0.24 },
  light3: { clip: 'light3', st: 18, hits: [[0.4, 0.55]], dmg: 1.45, poise: 24, range: 3.0, arc: 100, move: [[0.25, 0.52, 1.4]], next: 'light1', combo: 0.62, trail: [0.3, 0.62], track: 0.3 },
  heavy: { clip: 'heavy', st: 30, aoe: [0.56, 3.6], dmg: 2.3, poise: 50, move: [[0.25, 0.56, 1.9]], trail: [0.38, 0.66], hyper: [0.15, 0.62], track: 0.35 },
  roll: { clip: 'roll', st: 18, iframes: [0.04, 0.46], move: [[0.03, 0.62, 4.7]] },
  back: { clip: 'backstep', st: 10, iframes: [0.02, 0.32], move: [[0.0, 0.5, -2.8]] },
  cast: { clip: 'cast', fp: 28, release: 0.48, track: 0.45 },
  heal: { clip: 'drink', heal: 0.55, moveMul: 0.3 },
  hit: { clip: 'hit' },
  knock: { clip: 'knock', iframes: [0, 0.78], move: [[0.05, 0.3, -1.6]] },
};

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
    // pinned across the tops of the shoulders, cloth wider than the shoulders so it drapes
    const sh = Math.abs(this.rig.j.armL.position.x);
    const capeFit = this.model
      ? { width: 0.66, topWidth: sh * 2 + 0.05, top: this.rig.j.armL.position.y + 0.07, back: -0.17, profile: Cape.backProfile(this.rig, this.model) }
      : { width: 0.56, topWidth: sh * 2, top: 0.25, back: -0.14 };
    this.cape = new Cape(this.rig, { length: 1.08, cols: 12, rows: 14, material: Mat.capeBlue, ...capeFit });
    this.cape.attach(scene);
    this.trail = new Trail(new THREE.Color(1.3, 1.9, 3.6), 1, 22, 0.13);
    scene.add(this.trail.mesh);
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
    this.anim = { speed: 0, dir: 1 };
    this.cine = { speed: 0 };
    this._v = new THREE.Vector3(); this._b = new THREE.Vector3(); this._t = new THREE.Vector3();
    this.rig.onStep = (run) => {
      if (this.state === 'locked' && this.cine.speed < 0.1) return;
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
    this.maxHp = Math.round(360 + s.vig * 40);
    this.maxSt = Math.round(88 + s.end * 7);
    this.maxFp = Math.round(60 + s.div * 10);
    this.dmg = 30 * (1 + s.str * 0.075);
    this.spellDmg = 85 * (1 + s.div * 0.1);
  }
  static levelCost(level) { return Math.round(160 * Math.pow(1.13, level)); }

  setPosition(x, z, heading) {
    this.pos.set(x, World.getHeight(x, z), z);
    if (heading !== undefined) this.heading = heading;
    this.vx = this.vz = this.vy = 0;
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
    return {
      dx, dz, mag: Math.min(1, m),
      sprint: k.down('ShiftLeft') || k.down('ShiftRight'),
      roll: k.pressed('Space'), light: k.clicked(0), heavy: k.clicked(2),
      cast: k.pressed('KeyQ'), heal: k.pressed('KeyR'),
      lock: k.pressed('Tab') || k.clicked(1), interact: k.pressed('KeyE'),
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
      this.animate(dt, this.state === 'locked' ? this.cine.speed : 0, 1);
      return;
    }
    this.updateShard(dt);
    const inp = this.grip ? this.gripInput(dt) : this.readInput();
    // stamina / focus regeneration
    this.stDelay -= dt;
    if (this.stDelay <= 0 && this.state === 'free') this.st = Math.min(this.maxSt, this.st + 48 * dt);
    this.fp = Math.min(this.maxFp, this.fp + 1.2 * dt);
    if (inp.lock) this.toggleLock();
    if (this.lock && (!this.lock.alive || this.lock.pos.distanceTo(this.pos) > 32)) this.lock = null;
    if (this.state === 'free') this.updateFree(dt, inp);
    else if (this.state === 'action') this.updateAction(dt, inp);
    this.animate(dt, this.anim.speed, this.anim.dir);
  }

  animate(dt, speed, dir) {
    // knockback slides out smoothly instead of teleporting
    if (this.kb.lengthSq() > 1e-4 && this.state !== 'locked') {
      World.move(this.pos, this.kb.x * dt, this.kb.y * dt, this.radius);
      this.kb.multiplyScalar(Math.exp(-8 * dt));
    }
    if (this.state !== 'locked') this.collideActors();
    // ground & gravity
    const g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y > g + 0.02 && !(this.pos.y - g < 0.5 && this.vy <= 0)) {
      this.vy -= 28 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g) { this.pos.y = g; if (this.vy < -8) Sound.step(true, 0.4); this.vy = 0; }
    } else { this.pos.y = g; this.vy = 0; }
    if (G.arenaLock) {
      const A = World.arena, dx = this.pos.x - A.x, dz = this.pos.z - A.z, d = Math.hypot(dx, dz);
      if (d > A.r) { this.pos.x = A.x + (dx / d) * A.r; this.pos.z = A.z + (dz / d) * A.r; }
    }
    // steps and ledges: the body eases up/down instead of popping (big jumps still snap)
    if (this.visY === null || Math.abs(this.pos.y - this.visY) > 0.8) this.visY = this.pos.y;
    else this.visY = damp(this.visY, this.pos.y, 22, dt);
    this.root.position.set(this.pos.x, this.visY, this.pos.z);
    this.root.rotation.y = this.heading;
    this.rig.lean(dt, this.state === 'free' ? Math.hypot(this.vx, this.vz) : 0, this.heading);
    this.rig.update(dt, speed, dir);
    if (this.model) this.model.update();
    this.cape.update(dt);
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
      this.st -= 15 * dt; this.stDelay = 0.5;
    }
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
    if (inp.roll) { this.startAction(inp.mag > 0.1 ? 'roll' : 'back', inp); return; }
    if (inp.light) { this.startAction('light1', inp); return; }
    if (inp.heavy) { this.startAction('heavy', inp); return; }
    if (inp.cast) { this.startAction('cast', inp); return; }
    if (inp.heal) { this.startAction('heal', inp); return; }
  }

  startAction(name, inp) {
    const a = PLAYER_ACTIONS[name];
    if (a.st && this.st <= 0) { Sound.ui('back'); return false; }
    if (a.fp && this.fp < a.fp) { UI.toast('Not enough <b>FP</b>'); Sound.ui('back'); return false; }
    if (name === 'heal') {
      if (this.flasks <= 0) { UI.pulseSlot('slot-flask'); Sound.ui('back'); return false; }
      this.flasks--; UI.pulseSlot('slot-flask');
    }
    if (a.st) { this.st -= a.st; this.stDelay = 0.7; }
    if (a.fp) this.fp -= a.fp;
    this.state = 'action'; this.act = a; this.actName = name;
    this.prevT = 0; this.hitSet = new Set(); this.buffer = null; this.fired = {};
    this.rig.legYaw = 0;
    // facing
    if (name === 'roll' && inp && inp.mag > 0.1) this.heading = Math.atan2(inp.dx, inp.dz);
    else if (name !== 'back' && name !== 'hit' && name !== 'knock') {
      if (this.lock) this.heading = Math.atan2(this.lock.pos.x - this.pos.x, this.lock.pos.z - this.pos.z);
      else if (inp && inp.mag > 0.1) this.heading = Math.atan2(inp.dx, inp.dz);
    }
    this.rig.play(a.clip, { fade: name === 'roll' || name === 'back' ? 0.05 : 0.08 });
    if (name === 'roll' || name === 'back') Sound.roll();
    if (name === 'cast') Sound.zap();
    this.vx = this.vz = 0;
    return true;
  }

  updateAction(dt, inp) {
    const a = this.act, t = this.rig.progress(a.clip), pt = this.prevT;
    // root motion
    let mv = 0;
    if (a.move) for (const [t0, t1, d] of a.move) {
      const f = (x) => d * easeOutQuad(clamp((x - t0) / (t1 - t0), 0, 1));
      mv += f(t) - f(pt);
    }
    // lunges and rolls stop at an enemy's body instead of sliding into it
    if (mv > 0) mv = Math.min(mv, this.roomAhead());
    if (mv) World.move(this.pos, Math.sin(this.heading) * mv, Math.cos(this.heading) * mv, this.radius);
    if (a.moveMul && inp.mag > 0.1) {
      World.move(this.pos, inp.dx * 5 * a.moveMul * dt, inp.dz * 5 * a.moveMul * dt, this.radius);
      this.heading = dampAngle(this.heading, Math.atan2(inp.dx, inp.dz), 6, dt);
      this.anim.speed = 5 * a.moveMul;
    } else this.anim.speed = 0;
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
      FX.lightningStrike(c.clone(), { radius: 2.6, scale: 0.75, shake: 0.7 });
      this.aoeDamage(c, a.aoe[1], this.dmg * a.dmg, a.poise, 'lightning');
      G.hitStop = 0.07;
    }
    // Zeus's bolt
    if (a.release && t >= a.release && !this.fired.cast) {
      this.fired.cast = true;
      const target = this.spellTarget();
      setTimeout(() => {
        FX.lightningStrike(target.clone(), { radius: 3, scale: 1.1, shake: 0.8 });
        this.aoeDamage(target, 3.2, this.spellDmg, 45, 'lightning');
      }, 120);
      FX.sparks(this.root.position.clone().add(new THREE.Vector3(0, 2.0, 0)), new THREE.Vector3(0, 1, 0), 20, [1.4, 1.8, 3.2, 1], 5);
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
    if (inp.roll && t > 0.3) this.buffer = inp.mag > 0.1 ? 'roll' : 'back';
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
   * Never before Ariel knows what it is, never once Ares is free.
   */
  updateShard(dt) {
    if (this.grip || !G.flags.mirrorSeen || G.flags.bossDefeated || G.state !== 'playing') return;
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
    // Keraunos burns red in his grip
    const m = this.parts.sword.material;
    if (m && m.emissive) {
      this.grip.emissive = m.emissive.getHex(); this.grip.ei = m.emissiveIntensity;
      m.emissive.setHex(0xff2a0a); m.emissiveIntensity = 0.9;
    }
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
    // red fire licks along the blade
    if (Math.random() < 0.6) {
      this.parts.sword.userData.tip.getWorldPosition(this._t);
      this.parts.sword.userData.base.getWorldPosition(this._b);
      FX.flame(this._b.lerp(this._t, Math.random()), 0.35, [3.0, 0.55, 0.12, 0.8]);
    }
    // Ares drives the body: straight at the nearest foe, cutting the moment it is in reach
    const inp = { dx: 0, dz: 0, mag: 0, sprint: false, roll: false, light: false, heavy: false, cast: false, heal: false, lock: false, interact: false };
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
    const m = this.parts.sword.material;
    if (m && g.emissive !== undefined) { m.emissive.setHex(g.emissive); m.emissiveIntensity = g.ei; }
    this.gripT = G.arenaLock ? rand(30, 45) : rand(70, 120);
    if (quiet) return;
    this.speak('Ariel', pick(GRIP_LINES.Ariel));
    const c = this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    FX.sparks(c, null, 60, [1.4, 1.9, 3.4, 1], 7);
    FX.flashLight(c, 0xb8d4ff, 500, 0.4, 14);
    Sound.zap();
    this.invuln = Math.max(this.invuln, 0.8);
  }

  /** how far Ariel can travel straight ahead before touching an enemy */
  roomAhead() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let room = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible || e.airborne) continue;
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
      if (H && H.root.visible) push(H.pos.x, H.pos.z, 0.42);
    }
  }

  hitEnemies(range, arc, dmg, poise) {
    // in Ares' grip every blow lands with the God of War's strength
    if (this.grip) dmg *= 1.35;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
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
      const p = this._b.set(e.pos.x - dx / d * e.radius * 0.6, e.pos.y + e.height * 0.55, e.pos.z - dz / d * e.radius * 0.6);
      e.takeHit(dmg * rand(0.95, 1.05), poise, this.pos, 'slash', p);
      G.hitStop = Math.max(G.hitStop, 0.055);
      G.cam.shake(0.25);
    }
  }
  aoeDamage(c, r, dmg, poise, kind) {
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - c.x, e.pos.z - c.z) - e.radius;
      if (d > r || Math.abs(e.pos.y - c.y) > 4 + e.height * 0.5) continue;
      e.takeHit(dmg * (d < r * 0.5 ? 1 : 0.75), poise, c, kind, e.pos.clone().add(new THREE.Vector3(0, e.height * 0.5, 0)));
    }
  }
  spellTarget() {
    if (this.lock && this.lock.alive) return this.lock.pos.clone();
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!e.alive) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 20) continue;
      const dot = (dx * fx + dz * fz) / (d || 1);
      if (dot < 0.6) continue;
      const s = d * (2 - dot);
      if (s < bs) { bs = s; best = e; }
    }
    if (best) return best.pos.clone();
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
    this.hp -= dmg;
    this.invuln = 0.4;
    const chest = this.pos.clone().add(new THREE.Vector3(0, 1.25, 0));
    const away = this.pos.clone().sub(from).setY(0).normalize();
    FX.sparks(chest, away, 16, [2.4, 1.6, 0.5, 1], 6);
    Sound.hit('flesh', 1);
    G.cam.shake(opts.knock ? 1.0 : 0.55);
    UI.damage();
    if (this.hp <= 0) { this.hp = 0; this.die(); return true; }
    const hyper = this.state === 'action' && this.act.hyper && (() => { const t = this.rig.progress(this.act.clip); return t >= this.act.hyper[0] && t <= this.act.hyper[1]; })();
    if (opts.knock || dmg > this.maxHp * 0.28) {
      this.heading = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      this.startAction('knock');
      this.invuln = 0.9;
    } else if (!hyper) {
      this.heading = Math.atan2(from.x - this.pos.x, from.z - this.pos.z);
      this.startAction('hit');
      this.kb.set(away.x * 4, away.z * 4);
    } else this.rig.flinch = 1;
    return true;
  }
  die() {
    this.releaseGrip(true);
    this.alive = false;
    this.state = 'dead';
    this.lock = null;
    this.rig.play('deathFwd', { fade: 0.1 });
    Sound.death();
    Game.onPlayerDeath();
  }
}
