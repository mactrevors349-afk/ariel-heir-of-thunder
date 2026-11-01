'use strict';
/* ==========================================================================
   enemies.js · hollow hoplites, the cyclops, Ares, Hermes and the echoes
   ========================================================================== */

const ENEMY_DEFS = {
  hoplite: {
    name: 'Hollow Hoplite', hp: 150, poise: 34, radius: 0.45, height: 1.85, size: 1, ichor: 130,
    walk: 1.5, run: 4.2, sight: 19, leash: 48, turn: 7, hitSound: 'metal', blood: 'ash',
    build: (o) => buildHoplite(o),
    attacks: {
      spear: [
        { clip: 'thrust', range: 3.0, dmg: 62, hits: [[0.46, 0.58]], hitRange: 3.2, arc: 70, move: [[0.36, 0.55, 1.3]], track: 0.42, weight: 3, cool: 1.1 },
        { clip: 'bash', range: 1.9, dmg: 44, hits: [[0.4, 0.52]], hitRange: 2.1, arc: 100, move: [[0.3, 0.5, 1.0]], track: 0.36, weight: 1, cool: 1.3 },
      ],
      sword: [
        { clip: 'light1', speed: 0.72, range: 2.5, dmg: 55, hits: [[0.28, 0.46]], hitRange: 2.6, arc: 160, move: [[0.16, 0.45, 1.2]], track: 0.3, weight: 3, cool: 0.9, trail: true },
        { clip: 'light3', speed: 0.7, range: 2.6, dmg: 70, hits: [[0.4, 0.55]], hitRange: 2.8, arc: 90, move: [[0.25, 0.52, 1.5]], track: 0.36, weight: 2, cool: 1.3, trail: true },
        { clip: 'bash', range: 1.9, dmg: 44, hits: [[0.4, 0.52]], hitRange: 2.1, arc: 100, move: [[0.3, 0.5, 1.0]], track: 0.36, weight: 1, cool: 1.3 },
      ],
    },
  },
  cyclops: {
    name: 'Kin of Polyphemus', hp: 1150, poise: 150, radius: 1.15, height: 3.6, size: 1.9, ichor: 2600, field: true,
    walk: 2.3, run: 4.4, sight: 24, leash: 60, turn: 3.2, hitSound: 'flesh', blood: 'blood',
    build: () => buildCyclops(),
    attacks: {
      default: [
        { clip: 'slam', range: 5.4, dmg: 135, aoe: { t: 0.56, r: 3.3, fwd: 3.6, fx: 'dust' }, track: 0.44, weight: 3, cool: 1.5, knock: true, trail: true },
        { clip: 'sweep', range: 5.0, dmg: 95, hits: [[0.45, 0.6]], hitRange: 5.4, arc: 210, track: 0.36, weight: 2, cool: 1.4, knock: true, trail: true },
        { clip: 'stomp', range: 3.4, dmg: 80, aoe: { t: 0.52, r: 4.3, fwd: 0.6, fx: 'dust' }, track: 0.3, weight: 2, cool: 1.6, knock: true },
      ],
    },
  },
  thrall: {
    name: 'Thrall of Tartarus', hp: 210, poise: 42, radius: 0.85, height: 2.3, size: 1.25, ichor: 190, glide: true,
    walk: 1.7, run: 3.7, sight: 18, leash: 45, turn: 5, hitSound: 'flesh', blood: 'rot', alertClip: 'roar', alertPitch: 1.15,
    build: () => buildThrall(),
    attacks: {
      default: [
        { clip: 'sweep', speed: 0.95, range: 3.2, dmg: 70, hits: [[0.45, 0.6]], hitRange: 3.4, arc: 200, track: 0.4, weight: 3, cool: 1.3 },
        { clip: 'slam', speed: 1.05, range: 3.4, dmg: 88, aoe: { t: 0.56, r: 2.1, fwd: 2.1, fx: 'rot' }, track: 0.42, weight: 2, cool: 1.6 },
      ],
    },
  },
  seraph: {
    name: 'Fallen Seraph', hp: 520, poise: 85, radius: 0.6, height: 2.4, size: 1.3, ichor: 950,
    walk: 1.9, run: 5.2, sight: 24, leash: 55, turn: 6.5, hitSound: 'metal', blood: 'ash', alertClip: 'roar', alertPitch: 0.95,
    trailColor: [2.6, 0.9, 0.3],
    build: () => buildSeraph(),
    attacks: {
      default: [
        { clip: 'sweep', speed: 1.1, range: 3.6, dmg: 92, hits: [[0.45, 0.6]], hitRange: 3.9, arc: 220, track: 0.38, weight: 3, cool: 1.0, trail: true },
        { clip: 'overhead', speed: 1.15, range: 3.4, dmg: 118, hits: [[0.5, 0.6]], hitRange: 3.7, arc: 60, track: 0.44, weight: 2, cool: 1.2, knock: true, trail: true },
        { clip: 'lunge', range: 9, min: 4.5, dmg: 100, hits: [[0.45, 0.62]], hitRange: 3.0, arc: 60, move: [[0.34, 0.56, 6]], track: 0.42, weight: 2, cool: 1.4, knock: true, trail: true },
      ],
    },
  },
  ares: {
    name: 'Ares, the Bloodied God of War', hp: 3600, poise: 280, radius: 1.35, height: 4.6, size: 2.5, ichor: 30000, boss: true,
    walk: 2.6, run: 6.2, sight: 80, leash: 999, turn: 3.8, hitSound: 'metal', blood: 'ichor',
    build: () => buildAres(),
    attacks: {
      default: [
        { clip: 'sweep', range: 6.2, dmg: 120, hits: [[0.45, 0.6]], hitRange: 6.6, arc: 200, track: 0.36, weight: 3, cool: 1.2, trail: true },
        { clip: 'overhead', range: 6.0, dmg: 150, hits: [[0.5, 0.6]], hitRange: 6.4, arc: 50, aoe: { t: 0.55, r: 2.4, fwd: 5.2, fx: 'fire', p2: true }, track: 0.46, weight: 3, cool: 1.4, knock: true, trail: true },
        { clip: 'combo', range: 5.6, dmg: 95, hits: [[0.17, 0.26], [0.43, 0.52], [0.72, 0.8]], hitRange: 6.2, arc: 170, move: [[0.1, 0.24, 1.6], [0.36, 0.5, 1.6], [0.62, 0.78, 2]], track: 0.66, weight: 3, cool: 1.8, knock: false, trail: true },
        { clip: 'lunge', range: 12, min: 6, dmg: 130, hits: [[0.45, 0.62]], hitRange: 3.8, arc: 60, move: [[0.34, 0.56, 9]], track: 0.42, weight: 2, cool: 1.5, knock: true, trail: true },
        { clip: 'leap', range: 24, min: 9, dmg: 160, special: 'leap', aoe: { t: 0.58, r: 4.8, fwd: 2.4, fx: 'fire' }, track: 0.25, weight: 2, cool: 2, knock: true },
        { clip: 'nova', range: 9, dmg: 175, special: 'nova', aoe: { t: 0.62, r: 8.5, fwd: 0, fx: 'nova' }, track: 0.1, weight: 2, cool: 2.4, knock: true, phase: 2 },
        { clip: 'overhead', range: 14, min: 5, dmg: 110, special: 'wave', track: 0.46, weight: 2, cool: 2, knock: true, phase: 2, trail: true },
      ],
    },
  },
};

class Enemy {
  constructor(type, x, z, opts = {}) {
    const def = (this.def = ENEMY_DEFS[type]);
    this.type = type;
    const built = def.build(opts);
    this.root = built.root; this.rig = built.rig; this.parts = built.parts || {};
    this.model = built.model || null;
    this.attacks = def.attacks[opts.weapon || 'default'] || def.attacks.default || def.attacks.spear;
    this.name = def.name;
    this.radius = def.radius; this.height = def.height; this.size = def.size;
    this.home = new THREE.Vector3(x, World.getHeight(x, z), z);
    this.homeHeading = opts.heading ?? rand(0, TAU);
    this.patrol = opts.patrol || null;
    this.pos = new THREE.Vector3();
    G.scene.add(this.root);
    if (opts.cloak) {
      this.cape = new Cape(this.rig, { width: 0.52, topWidth: 0.36, length: 0.9, cols: 9, rows: 10, material: Mat.capeRag, top: 0.25, back: -0.15 });
      this.cape.attach(G.scene);
    }
    if (this.parts.weapon) {
      const col = type === 'ares' ? new THREE.Color(3.2, 0.9, 0.2) : def.trailColor ? new THREE.Color(...def.trailColor) : new THREE.Color(0.9, 0.85, 0.75);
      this.trail = new Trail(col, 1, 18, type === 'ares' ? 0.16 : 0.1);
      G.scene.add(this.trail.mesh);
    }
    this._b = new THREE.Vector3(); this._t = new THREE.Vector3();
    this.rig.onStep = (run) => {
      if (def.glide) return;
      if (this.size > 1.5) {
        const v = Sound.at(this.pos, 70);
        Sound.step(true, v * 0.9);
        if (v > 0.5) G.cam.shake(0.08 * v);
        FX.dust(this.pos, 0.8 * this.size, 4);
      } else Sound.step(false, Sound.at(this.pos, 30) * 0.6);
    };
    this.reset();
  }
  reset() {
    this.pos.copy(this.home);
    this.visY = this.pos.y;
    this.loco = 0; this.detourT = 0;
    this.heading = this.homeHeading;
    this.hp = this.maxHp = this.def.hp;
    this.poise = this.def.poise;
    this.alive = true; this.aggro = false;
    this.state = 'idle'; this.timer = rand(0, 2); this.cool = 0;
    this.speed = 0; this.act = null; this.patrolI = 0;
    this.deadT = 0; this.vy = 0;
    // shown again only if the next update finds it near enough
    this.root.visible = this.pos.distanceTo(G.camera.position) < 90 || (this.def.boss && G.arenaLock);
    this.rig.act = null; this.rig.prev = null;
    if (this.cape) { this.cape.mesh.visible = this.root.visible; this.cape.needsReset = true; }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
  }

  alert(instant = false) {
    if (this.aggro) return;
    this.aggro = true;
    if (!instant && this.type === 'hoplite') { this.state = 'alert'; this.rig.play('alert', { speed: 1.4 }); this.timer = 0.9; }
    else if (!instant && this.type === 'cyclops') { this.state = 'alert'; this.rig.play('roar'); this.timer = 2.0; Sound.roar(0.8, Sound.at(this.pos, 80)); G.cam.shake(0.4); }
    else if (!instant && this.def.alertClip) { this.state = 'alert'; this.rig.play(this.def.alertClip, { speed: 1.6 }); this.timer = 1.1; Sound.roar(this.def.alertPitch || 1, Sound.at(this.pos, 50) * 0.7); }
    else this.state = 'chase';
    // nearby allies join in
    for (const e of G.enemies) if (e !== this && e.alive && !e.aggro && e.pos.distanceTo(this.pos) < 9) e.aggro = true, e.state = 'chase';
  }

  faceTo(x, z, rate, dt) { this.heading = dampAngle(this.heading, Math.atan2(x - this.pos.x, z - this.pos.z), rate, dt); }

  update(dt) {
    const P = G.player;
    if (!this.alive) { this.updateDead(dt); return; }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const camD = this.pos.distanceTo(G.camera.position);
    // idle enemies far off in the haze aren't drawn or animated at all (the boss waits in his arena)
    const idle = !this.aggro || (this.def.boss && !G.arenaLock);
    if (idle && camD > (this.size > 1.5 ? 140 : 90)) { this.root.visible = false; if (this.cape) this.cape.mesh.visible = false; return; }
    this.root.visible = true;
    if (this.cape) this.cape.mesh.visible = camD < 60;
    this.cool -= dt;
    let moveSpeed = 0, moveDir = 1, strafe = 0;
    const x0 = this.pos.x, z0 = this.pos.z;
    switch (this.state) {
      case 'idle': {
        if (this.patrol) {
          const tgt = this.patrol[this.patrolI];
          const d = Math.hypot(tgt[0] - this.pos.x, tgt[1] - this.pos.z);
          if (d < 1) this.patrolI = (this.patrolI + 1) % this.patrol.length;
          else { this.faceTo(tgt[0], tgt[1], 3, dt); moveSpeed = this.def.walk; }
        }
        const sees = P.alive && dist < this.def.sight && (dist < this.def.sight * 0.45 || Math.cos(wrapAngle(Math.atan2(dx, dz) - this.heading)) > 0.2);
        if (sees && P.state !== 'locked' && Math.abs(P.pos.y - this.pos.y) < 8) this.alert();
        break;
      }
      case 'alert':
        this.faceTo(P.pos.x, P.pos.z, 6, dt);
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      case 'chase': {
        if (!P.alive || this.home.distanceTo(this.pos) > this.def.leash || (P.state === 'locked' && !this.def.boss)) { this.state = 'return'; break; }
        this.faceTo(P.pos.x, P.pos.z, this.def.turn, dt);
        const atk = this.cool <= 0 ? this.chooseAttack(dist) : null;
        if (atk) { this.startAttack(atk); break; }
        const close = this.def.size > 1.5 ? 3.2 : 1.9;
        if (dist > close + 0.6) moveSpeed = dist > 7 ? this.def.run : lerp(this.def.walk, this.def.run, 0.5);
        else if (this.cool > 0) {
          // circle the player while recovering
          const side = Math.sin(G.time * 0.7 + this.home.x) > 0 ? 1 : -1;
          this.steer(this.heading + side * Math.PI / 2, this.def.walk * 0.8 * dt, dt);
          strafe = side;
          this.speedOverride = true;
        }
        break;
      }
      case 'attack':
        this.updateAttack(dt, dist);
        break;
      case 'stagger':
        this.timer -= dt;
        if (this.timer <= 0) this.state = 'chase';
        break;
      case 'return': {
        const d = Math.hypot(this.home.x - this.pos.x, this.home.z - this.pos.z);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.2 * dt);
        if (d < 1.2) { this.state = 'idle'; this.aggro = false; this.hp = this.maxHp; break; }
        this.faceTo(this.home.x, this.home.z, 4, dt);
        moveSpeed = this.def.run * 0.7;
        if (P.alive && dist < this.def.sight * 0.6 && P.state !== 'locked') { this.state = 'chase'; }
        break;
      }
      case 'dormant':
        break;
    }
    if (moveSpeed > 0 && !this.speedOverride) this.steer(this.heading, moveSpeed * dt, dt);
    this.speedOverride = false;
    // shoved by Ariel (Spartan Charge, War Cry, the God Mode shockwave): slides out over a few frames
    if (this.kb && this.kb.lengthSq() > 1e-3) {
      World.move(this.pos, this.kb.x * dt, this.kb.y * dt, this.radius);
      this.kb.multiplyScalar(Math.exp(-7 * dt));
    }
    this.separate();
    this.ground(dt);
    this.place(dt);
    // the gait follows the ground actually covered (no moonwalking into walls or each other)
    const moved = dt > 0 ? Math.hypot(this.pos.x - x0, this.pos.z - z0) / dt : 0;
    this.loco = damp(this.loco, Math.min(moved, this.def.run * 1.2), 10, dt);
    // legs turn toward the real direction of travel when side-stepping or walking around something
    const legWant = strafe ? strafe * 1.15 : this.detourT > 0 ? clamp(this.detour, -1.15, 1.15) : 0;
    this.rig.legYaw = damp(this.rig.legYaw || 0, this.state === 'attack' || this.state === 'stagger' ? 0 : legWant, 8, dt);
    this.rig.update(dt, this.state === 'attack' || this.state === 'stagger' ? 0 : this.loco, moveDir);
    if (this.model) this.model.update();
    if (this.cape && this.cape.mesh.visible) this.cape.update(dt);
    if (this.trail) {
      if (this.state === 'attack' && this.act.trail && this.parts.weapon) {
        const t = this.rig.progress(this.act.clip), h = this.act.hits ? this.act.hits : [[this.act.aoe ? this.act.aoe.t - 0.12 : 0.4, this.act.aoe ? this.act.aoe.t : 0.6]];
        if (h.some(([s, e]) => t >= s - 0.08 && t <= e + 0.02)) {
          this.parts.weapon.userData.base.getWorldPosition(this._b);
          this.parts.weapon.userData.tip.getWorldPosition(this._t);
          this.trail.push(this._b, this._t);
        }
      }
      this.trail.update(dt);
    }
  }

  ground(dt) {
    const g = World.getHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.airborne) return;
    this.pos.y = g;
    if (G.arenaLock && this.def.boss) {
      const A = World.arena, dx = this.pos.x - A.x, dz = this.pos.z - A.z, d = Math.hypot(dx, dz);
      if (d > A.r - 1) { this.pos.x = A.x + (dx / d) * (A.r - 1); this.pos.z = A.z + (dz / d) * (A.r - 1); }
    }
  }
  /** move the visible body to pos, easing over steps instead of popping */
  place(dt) {
    if (this.airborne || this.visY === undefined || Math.abs(this.pos.y - this.visY) > 0.8) this.visY = this.pos.y;
    else this.visY = damp(this.visY, this.pos.y, 18, dt);
    this.root.position.set(this.pos.x, this.visY, this.pos.z);
    this.root.rotation.y = this.heading;
    this.rig.lean(dt, this.alive && this.state !== 'attack' ? this.loco || 0 : 0, this.heading);
  }

  /** walk along a heading; when something solid blocks the way, sidestep around it for a moment */
  steer(heading, step, dt) {
    if (this.detourT > 0) { this.detourT -= dt; heading += this.detour; }
    const x0 = this.pos.x, z0 = this.pos.z;
    World.move(this.pos, Math.sin(heading) * step, Math.cos(heading) * step, this.radius);
    if (this.detourT > 0 || step < 1e-4) return;
    if (Math.hypot(this.pos.x - x0, this.pos.z - z0) > step * 0.4) return;
    const probe = this.radius * 1.6 + 0.4;
    for (const a of [0.75, -0.75, 1.35, -1.35, 2.0, -2.0]) {
      const h = heading + a;
      if (World.free(x0, z0, x0 + Math.sin(h) * probe, z0 + Math.cos(h) * probe, this.pos.y, this.radius)) {
        this.detour = a; this.detourT = 0.8;
        return;
      }
    }
  }

  /** bodies don't overlap. Each enemy only moves itself; Ariel steps out of enemies in Player.collideActors */
  separate() {
    const P = G.player;
    const out = (x, z, r, share) => {
      const dx = this.pos.x - x, dz = this.pos.z - z, d = Math.hypot(dx, dz), m = this.radius + r;
      if (d >= m) return;
      const nx = d > 1e-4 ? dx / d : Math.sin(this.heading + 2), nz = d > 1e-4 ? dz / d : Math.cos(this.heading + 2);
      World.move(this.pos, nx * (m - d) * share, nz * (m - d) * share, this.radius);
    };
    // a soldier that walks into Ariel gives a little ground too
    if (P.alive && this.size <= 1.5 && !this.airborne && Math.abs(P.pos.y - this.pos.y) < 2.5) out(P.pos.x, P.pos.z, P.radius, 0.25);
    for (const e of G.enemies) {
      if (e === this || !e.alive || !e.root.visible) continue;
      // the lighter body gives way more; equals each take a bit over half so a crowd settles quickly
      const share = e.size > this.size * 1.3 ? 0.9 : this.size > e.size * 1.3 ? 0.15 : 0.6;
      out(e.pos.x, e.pos.z, e.radius, share);
    }
  }
  /** how far this enemy may lunge forward before its body meets Ariel's */
  roomAhead() {
    const P = G.player;
    if (!P.alive) return Infinity;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z;
    const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx), m = this.radius + P.radius;
    if (along <= 0 || lat >= m) return Infinity;
    return Math.max(0, along - Math.sqrt(m * m - lat * lat) - 0.05);
  }

  chooseAttack(dist) {
    const phase = this.phase || 1;
    const opts = this.attacks.filter((a) => dist <= a.range && dist >= (a.min || 0) && (!a.phase || a.phase <= phase));
    if (!opts.length) return null;
    let tot = opts.reduce((s, a) => s + a.weight, 0), r = Math.random() * tot;
    for (const a of opts) { r -= a.weight; if (r <= 0) return a; }
    return opts[0];
  }

  startAttack(a) {
    this.state = 'attack'; this.act = a; this.prevT = 0; this.hitWins = new Set(); this.fired = {};
    this.rig.play(a.clip, { speed: (a.speed || 1) * (this.animSpeed || 1), fade: 0.12 });
    if (this.onAttackStart) this.onAttackStart(a);
  }

  updateAttack(dt, dist) {
    const a = this.act, P = G.player, t = this.rig.progress(a.clip), pt = this.prevT;
    if (a.track && t < a.track) this.faceTo(P.pos.x, P.pos.z, this.def.turn * 1.6, dt);
    if (a.move) {
      let mv = 0;
      for (const [t0, t1, d] of a.move) { const f = (x) => d * easeOutQuad(clamp((x - t0) / (t1 - t0), 0, 1)); mv += f(t) - f(pt); }
      if (a.clip === 'lunge') mv = Math.min(mv, Math.max(0, dist - this.radius - 1.4));
      if (mv > 0) mv = Math.min(mv, this.roomAhead());
      if (mv) World.move(this.pos, Math.sin(this.heading) * mv, Math.cos(this.heading) * mv, this.radius);
    }
    if (a.hits) a.hits.forEach(([s, e], i) => {
      if (t >= s && pt < s) Sound.swing(this.size > 1.2, Sound.at(this.pos, 40));
      if (t >= s && pt <= e && !this.hitWins.has(i)) {
        const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d - P.radius <= a.hitRange && Math.abs(P.pos.y - this.pos.y) < 2 + this.height * 0.3) {
          const ang = Math.acos(clamp((dx * Math.sin(this.heading) + dz * Math.cos(this.heading)) / (d || 1), -1, 1));
          if (d < 1 || ang <= (a.arc / 2) * DEG) {
            if (P.takeDamage(a.dmg * (this.dmgMul || 1), this.pos, { knock: a.knock })) this.hitWins.add(i);
          }
        }
      }
    });
    if (a.aoe && t >= a.aoe.t && !this.fired.aoe && a.special !== 'wave') {
      this.fired.aoe = true;
      const c = new THREE.Vector3(this.pos.x + Math.sin(this.heading) * a.aoe.fwd, 0, this.pos.z + Math.cos(this.heading) * a.aoe.fwd);
      c.y = World.getHeight(c.x, c.z, this.pos.y + 2);
      this.impact(c, a);
    }
    if (this.updateSpecial) this.updateSpecial(dt, a, t, pt);
    this.prevT = t;
    if (t >= 1) { this.state = 'chase'; this.cool = (a.cool || 1) * rand(0.6, 1.25) / (this.animSpeed || 1); this.act = null; }
  }

  impact(c, a) {
    const P = G.player;
    const v = Sound.at(c, 90);
    if (a.aoe.fx === 'fire' && (!a.aoe.p2 || this.phase >= 2)) { FX.fireBurst(c, a.aoe.r, 50); Sound.fire(true, v); }
    else if (a.aoe.fx === 'nova') { FX.fireBurst(c, a.aoe.r, 140); FX.ring(c, a.aoe.r * 1.2, { color: [2.5, 0.8, 0.2], life: 0.7 }); Sound.fire(true, v); Sound.boom(v); }
    else if (a.aoe.fx === 'rot') { FX.ring(c, a.aoe.r * 1.1, { color: [1.2, 0.35, 2.2], life: 0.6 }); FX.ash(c.clone().add(new THREE.Vector3(0, 0.4, 0)), 18, [0.3, 0.08, 0.42, 0.7]); }
    FX.dust(c, a.aoe.r * 0.7, 18);
    FX.ring(c, a.aoe.r, { color: [1.0, 0.8, 0.55], life: 0.5, opacity: 0.6 });
    FX.decal(c, a.aoe.r * 1.1);
    Sound.boom(v * 0.8);
    G.cam.shake(0.9 * v);
    const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
    if (d <= a.aoe.r + P.radius && Math.abs(P.pos.y - c.y) < 3) P.takeDamage(a.dmg * (this.dmgMul || 1), c, { knock: a.knock });
  }

  takeHit(dmg, poiseDmg, from, kind, hitPos) {
    if (!this.alive || this.invulnerable) return;
    if (!this.aggro) this.alert(true);
    this.hp -= dmg;
    this.poise -= poiseDmg;
    this.rig.flinch = Math.min(1, 0.4 + poiseDmg / 40);
    const dir = hitPos.clone().sub(from).setY(0).normalize();
    if (this.def.blood === 'ash') { FX.ash(hitPos, 10); FX.sparks(hitPos, dir, 10, [1.8, 1.0, 0.4, 1], 6); }
    else if (this.def.blood === 'ichor') { FX.ichor(hitPos, dir, 24); FX.sparks(hitPos, dir, 8, [2.6, 0.7, 0.2, 1], 7); }
    else if (this.def.blood === 'rot') { FX.sparks(hitPos, dir, 12, [1.2, 0.4, 2.2, 1], 5); FX.ash(hitPos, 10, [0.3, 0.08, 0.42, 0.7]); }
    else { FX.sparks(hitPos, dir, 12, [1.4, 0.25, 0.1, 1], 5); FX.ash(hitPos, 6, [0.25, 0.04, 0.03, 0.6]); }
    if (kind === 'lightning') FX.sparks(hitPos, null, 16, [1.4, 1.9, 3.2, 1], 5);
    Sound.hit(this.def.hitSound, 1);
    UI.enemyDamaged(this, dmg);
    if (this.hp <= 0) { this.hp = 0; this.die(); return; }
    if (this.onHurt) this.onHurt();
    if (this.poise <= 0) {
      this.poise = this.def.poise;
      if (this.state !== 'dormant') {
        this.state = 'stagger'; this.act = null;
        this.rig.play('stagger', { speed: this.size > 1.5 ? 0.9 : 1.1 });
        this.timer = 1.1;
        this.airborne = false;
      }
    }
  }

  die() {
    this.alive = false;
    this.state = 'dead';
    this.act = null;
    this.airborne = false;
    this.rig.play(this.size > 1.5 ? 'deathFwd' : 'death', { fade: 0.1 });
    Sound.roar(this.size > 1.5 ? 0.6 : 1.4, Sound.at(this.pos, 60) * (this.size > 1.5 ? 1 : 0.35));
    this.deadT = 0;
    Game.onEnemyKilled(this);
  }

  updateDead(dt) {
    if (!this.root.visible) return;
    this.deadT += dt;
    this.ground(dt);
    this.place(dt);
    this.rig.update(dt, 0, 1);
    if (this.cape && this.cape.mesh.visible) this.cape.update(dt);
    if (this.trail) this.trail.update(dt);
    const dissolveAt = this.def.boss ? 99 : this.size > 1.5 ? 2.4 : 1.6;
    if (this.deadT > dissolveAt && !this.dissolved) {
      this.dissolved = true;
      FX.dissolve(this.root, [2.0, 1.5, 0.6, 1], this.size > 1.5 ? 260 : 110);
      Sound.pickup();
    }
    if (this.deadT > dissolveAt + 0.35) {
      this.root.visible = false;
      if (this.cape) this.cape.mesh.visible = false;
    }
  }
}

/* ---------------------------------------------------------------- Ares */
class Ares extends Enemy {
  constructor(x, z) {
    super('ares', x, z, { heading: 0 });
    this.fuller = this.parts.weapon.userData.fuller;
    this.fuller.material = Mat.glowRed.clone();
    this.crestMat = this.parts.crest.material = Mat.glowRed.clone();
    this.model = Models.attach(this.rig, 'ares');
    if (this.model) {
      // the sculpt brings its own sword: hits, trails and flames follow it
      this.parts.weapon = { userData: { base: this.model.markers.base, tip: this.model.markers.tip, fuller: this.fuller } };
      this.bodyMat = this.model.mesh.material;
      this.bodyMat.emissive = new THREE.Color(0.022, 0.003, 0);
    }
    const capeFit = this.model ? { width: 0.48, top: 0.2, back: -0.23, profile: Cape.backProfile(this.rig, this.model) } : { width: 0.5, top: 0.25, back: -0.16 };
    this.cape = new Cape(this.rig, { length: 1.15, cols: 11, rows: 12, material: Mat.capeRed, ...capeFit, width: capeFit.width * 1.25, topWidth: capeFit.width * 0.9 });
    this.cape.attach(G.scene);
  }
  reset() {
    super.reset();
    this.state = 'dormant';
    this.phase = 1; this.animSpeed = 1; this.dmgMul = 1;
    this.invulnerable = false;
    this.aggro = true;
    if (this.fuller) this.fuller.material.color.setRGB(4, 0.6, 0.15);
    // a low smoulder in the armour even before the fight; phase two sets it ablaze
    if (this.bodyMat) this.bodyMat.emissive.setRGB(0.022, 0.003, 0);
    this.rig.play('kneelBowed', { fade: 0.01 });
    this.rig.act.t = 1;
  }
  wake() {
    this.state = 'chase';
    this.cool = 1.2;
    this.rig.stop(0.4);
  }
  onHurt() {
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) this.enterPhase2();
  }
  enterPhase2() {
    this.phase = 2;
    this.state = 'attack';
    this.act = { clip: 'roar', cool: 0.5 };
    this.prevT = 0; this.hitWins = new Set(); this.fired = {};
    this.invulnerable = true;
    this.rig.play('roar', { fade: 0.15 });
    Sound.roar(0.45, 1);
    G.cam.shake(1.2);
    FX.fireBurst(this.pos, 6, 160);
    FX.ring(this.pos, 10, { color: [2.5, 0.8, 0.2], life: 0.9 });
    // push the player back
    const P = G.player, dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 7) P.takeDamage(40, this.pos, { knock: true });
    this.fuller.material.color.setRGB(9, 2.2, 0.5);
    this.crestMat.color.setRGB(7, 1.6, 0.3);
    if (this.bodyMat) this.bodyMat.emissive.setRGB(0.2, 0.035, 0.0);
    Music.intensity = 1;
    UI.subtitle('Ares', 'Enough! Burn with me, godling!', 3.2);
    Voice.speak('Enough! Burn with me, godling!', 'Ares');
    setTimeout(() => { this.invulnerable = false; this.animSpeed = 1.15; this.dmgMul = 1.15; }, 1600);
  }
  onAttackStart(a) {
    if (a.special === 'nova') FX.telegraph(this.pos.clone(), a.aoe.r, a.aoe.t * this.rig.clip('nova').dur / (this.animSpeed || 1), [1.6, 0.4, 0.1]);
    if (a.special === 'leap') {
      this.leap = { from: this.pos.clone(), to: G.player.pos.clone() };
      const d = this.leap.to.clone().sub(this.leap.from).setY(0);
      const len = d.length();
      if (len > 2.4) this.leap.to = this.leap.from.clone().add(d.multiplyScalar((len - 2.4) / len));
      Sound.roar(0.55, 0.8);
    }
    if (Math.random() < 0.25) Sound.roar(0.5, 0.5);
  }
  updateSpecial(dt, a, t, pt) {
    if (a.special === 'leap' && this.leap) {
      const u = clamp((t - 0.25) / (0.58 - 0.25), 0, 1);
      if (t > 0.25 && t < 0.58) {
        this.airborne = true;
        const g = World.getHeight(this.pos.x, this.pos.z);
        this.pos.x = lerp(this.leap.from.x, this.leap.to.x, easeInOut(u));
        this.pos.z = lerp(this.leap.from.z, this.leap.to.z, easeInOut(u));
        this.pos.y = lerp(this.leap.from.y, g, u) + Math.sin(u * Math.PI) * 7;
        this.faceTo(this.leap.to.x + Math.sin(this.heading), this.leap.to.z + Math.cos(this.heading), 2, dt);
      } else if (t >= 0.58) { this.airborne = false; }
    }
    if (a.special === 'wave' && t >= 0.55 && !this.fired.wave) {
      this.fired.wave = true;
      const P = G.player;
      const dir = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      const sx = this.pos.x, sz = this.pos.z;
      Sound.boom(1);
      for (let i = 1; i <= 8; i++) {
        setTimeout(() => {
          if (!this.alive) return;
          const c = new THREE.Vector3(sx + Math.sin(dir) * (2 + i * 2.6), 0, sz + Math.cos(dir) * (2 + i * 2.6));
          c.y = World.getHeight(c.x, c.z, this.pos.y + 3);
          FX.fireBurst(c, 1.8, 36);
          FX.decal(c, 2.4, 8);
          Sound.fire(false, Sound.at(c, 50));
          const d = Math.hypot(P.pos.x - c.x, P.pos.z - c.z);
          if (d < 2.0 + P.radius) P.takeDamage(a.dmg * this.dmgMul, c, { knock: false });
        }, i * 110);
      }
      G.cam.shake(0.8);
    }
    if (this.phase === 2 && Math.random() < 0.7) {
      const j = pick(['armR', 'chest', 'armL', 'head', 'handR']);
      this.rig.j[j].getWorldPosition(this._b);
      FX.flame(this._b, 1.0, [3.0, 0.9, 0.2, 0.8]);
    }
  }
  update(dt) {
    super.update(dt);
    if (!this.alive) return;
    // smoldering aura even outside of attacks
    if (this.root.visible && Math.random() < (this.phase === 2 ? 0.9 : 0.35)) {
      this.parts.weapon.userData.tip.getWorldPosition(this._t);
      this.parts.weapon.userData.base.getWorldPosition(this._b);
      this._b.lerp(this._t, Math.random());
      FX.flame(this._b, this.phase === 2 ? 0.9 : 0.5, [3.0, 0.9, 0.2, 0.8]);
    }
    // the rot steams off him in slow, curling wisps
    if (this.state === 'dormant' && this.root.visible) {
      this.rig.j.chest.getWorldPosition(this._b);
      for (let k = Math.random() < 0.5 ? 1 : 2; k > 0; k--) {
        const a = rand(0, Math.PI * 2), r = rand(0.2, 0.9);
        FX.smoke.spawn({ x: this._b.x + Math.cos(a) * r, y: this._b.y + rand(-2.2, 0.8), z: this._b.z + Math.sin(a) * r, vx: Math.cos(a) * 0.15, vy: rand(0.35, 0.9), vz: Math.sin(a) * 0.15, life: rand(2.6, 3.6), s: rand(0.5, 0.9), s2: rand(1.8, 2.6), turb: 0.9, c: [0.19, 0.05, 0.25, 0.26], c2: [0.07, 0.02, 0.1, 0] });
      }
    }
  }
  die() {
    super.die();
    Music.intensity = 0;
    Game.onBossDefeated(this);
  }
}

/* ---------------------------------------------------------------- Hermes */
class Hermes {
  constructor(scene) {
    const b = buildHermes();
    this.root = b.root; this.rig = b.rig; this.parts = b.parts; this.model = b.model;
    scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.hover = 0.25;
    this.visible = true;
    this.rig.play('talk', { fade: 0.01 });
  }
  place(x, z, heading) {
    this.pos.set(x, World.getHeight(x, z), z);
    this.heading = heading;
  }
  update(dt) {
    if (!this.root.visible) return;
    const P = G.player;
    const d = P ? this.pos.distanceTo(P.pos) : 99;
    if (d < 10 && G.state === 'playing') {
      const want = Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z);
      this.heading = dampAngle(this.heading, want, 2.5, dt);
    }
    this.root.position.set(this.pos.x, this.pos.y + this.hover + Math.sin(G.time * 1.6) * 0.08, this.pos.z);
    this.root.rotation.y = this.heading;
    this.rig.update(dt, 0, 1);
    if (this.model) this.model.update();
    if (Math.random() < 0.5) {
      const a = rand(0, TAU);
      FX.glow.spawn({ x: this.pos.x + Math.cos(a) * 0.4, y: this.pos.y + rand(0, 0.3), z: this.pos.z + Math.sin(a) * 0.4, vy: rand(0.2, 0.8), life: 1.6, s: 0.06, s2: 0.01, c: [2.4, 1.9, 0.9, 1], c2: [2, 1.4, 0.5, 0] });
    }
  }
}

/* ---------------------------------------------------------------- echoes
   Ghostly replays of demigods who fell here before (the realm remembers). */
const ECHO_NAMES = ['Theron of Argos', 'Kallisto the Swift', 'Leander', 'Myrrine, Daughter of Apollo', 'Daedalos the Younger', 'Phaedra', 'Nikias the Bold', 'Iola, Child of Hecate'];
class Echo {
  constructor(scene) {
    const b = buildPhantom();
    this.root = b.root; this.rig = b.rig;
    this.root.visible = false;
    scene.add(this.root);
    this.timer = 12;
    this.active = false;
    this.pos = new THREE.Vector3();
  }
  update(dt) {
    const P = G.player;
    if (!this.active) {
      this.timer -= dt;
      if (this.timer > 0 || G.state !== 'playing') return;
      const paths = World.phantomPaths.filter((p) => { const d = Math.hypot(p[0][0] - P.pos.x, p[0][1] - P.pos.z); return d > 12 && d < 55; });
      if (!paths.length) { this.timer = 4; return; }
      this.path = pick(paths); this.i = 1; this.age = 0;
      this.pos.set(this.path[0][0], 0, this.path[0][1]);
      this.pos.y = World.getHeight(this.pos.x, this.pos.z);
      this.name = pick(ECHO_NAMES);
      this.active = true; this.root.visible = true;
      this.attackAt = rand(2, 5);
      return;
    }
    this.age += dt;
    let speed = 0;
    if (this.i < this.path.length) {
      const [tx, tz] = this.path[this.i];
      const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
      if (d < 1) this.i++;
      else if (!this.rig.act) {
        this.heading = Math.atan2(tx - this.pos.x, tz - this.pos.z);
        speed = 4.8;
        this.pos.x += Math.sin(this.heading) * speed * dt; this.pos.z += Math.cos(this.heading) * speed * dt;
        this.pos.y = World.getHeight(this.pos.x, this.pos.z);
      }
    }
    if (this.attackAt && this.age > this.attackAt) { this.attackAt = null; this.rig.play(pick(['light1', 'light3', 'roll'])); }
    const fadeIn = clamp(this.age / 1.2, 0, 1), fadeOut = this.i >= this.path.length ? clamp(1 - (this.age - this.endAge) / 1.5, 0, 1) : 1;
    if (this.i >= this.path.length && this.endAge === undefined) this.endAge = this.age;
    Mat.ghost.uniforms.uOpacity.value = 0.8 * fadeIn * fadeOut;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading || 0;
    this.rig.update(dt, speed, 1);
    UI.label('echo', fadeIn * fadeOut > 0.2 ? this.name : null, this.pos.clone().add(new THREE.Vector3(0, 2.2, 0)));
    if (fadeOut <= 0) {
      this.active = false; this.root.visible = false; this.endAge = undefined;
      this.timer = rand(25, 50);
      UI.label('echo', null);
    }
  }
}

const ENEMY_SPAWNS = [
  // golden fields
  ['hoplite', 12, 178, { cloak: true }], ['hoplite', -4, 166, { weapon: 'sword' }],
  ['hoplite', -26, 114, { patrol: [[-26, 114], [-6, 128], [-30, 100]] }], ['hoplite', -16, 98, { weapon: 'sword', cloak: true }], ['thrall', -44, 90],
  // agora
  ['hoplite', -38, 44, { cloak: true }], ['hoplite', -74, 34, { weapon: 'sword' }], ['thrall', -32, -2], ['hoplite', -80, 4, { weapon: 'sword', cloak: true }],
  ['cyclops', -60, 6, { heading: Math.PI }],
  // the ascent: the rot thickens toward the colosseum
  ['hoplite', -82, -52, { cloak: true }], ['seraph', -96, -92, { heading: 0.6 }], ['thrall', -108, -110], ['thrall', -102, -116],
  ['hoplite', -110, -158, { weapon: 'sword', cloak: true }], ['seraph', -124, -168, { heading: 0.2 }],
  // colossus and the shrine
  ['thrall', 56, 98], ['hoplite', 78, 122, { weapon: 'sword' }], ['hoplite', 108, -28, { cloak: true }], ['seraph', 126, -48, { heading: Math.PI }],
];
