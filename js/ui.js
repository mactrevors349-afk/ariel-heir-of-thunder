'use strict';
/* ==========================================================================
   ui.js · HUD, cinematic overlays, dialogue and menus
   ========================================================================== */

const QICON = '<svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-1h11v1a1 1 0 0 0 2 0V5H8v9H6Z" fill="currentColor"/></svg>';

const UI = {
  _c: {},
  el(id) { return this._c[id] || (this._c[id] = document.getElementById(id)); },
  show(id) { this.el(id).classList.remove('hidden'); },
  hide(id) { this.el(id).classList.add('hidden'); },
  visible(id) { return !this.el(id).classList.contains('hidden'); },
  replay(id) { const e = this.el(id); e.classList.add('hidden'); void e.offsetWidth; e.classList.remove('hidden'); },

  init() {
    this.bars = { hp: { v: 1, chip: 1, hold: 0 }, fp: { v: 1, chip: 1, hold: 0 }, st: { v: 1, chip: 1, hold: 0 }, rage: { v: 0, chip: 0, hold: 0 } };
    this.buildAbilities();
    this.bossState = { v: 1, chip: 1, hold: 0, dmg: 0, dmgT: 0, enemy: null };
    this.ebars = new Map();
    this.labels = new Map();
    this.panels = [];
    document.addEventListener('mouseover', (e) => { if (e.target.closest && e.target.closest('button')) Sound.ui('move'); });
    const tips = [
      'Rolling forward through an attack is safer than running from it.',
      'Resting at an Altar of Hestia restores Ambrosia — but the shades you slew will rise again.',
      'Hold Shift to sprint. Every swing and roll costs stamina.',
      'Right-click calls the thunder down with your blade. It hits everything around you.',
      'Zeus\'s Bolt (Q) strikes whatever you are locked on to.',
      'Golden apples of the Hesperides grant another draught of Ambrosia.',
      'Every blow you trade fills your Rage. When it is full, press G: Zeus and Ares lend you everything.',
      'Press F to ride the storm into the air. Right-click from above to dive like a thunderbolt.',
      'Keys 1 to 6 call the gifts of Zeus and Ares. Thunder Step (2) goes straight through a foe.',
      'If you fall, your Ichor stays where you died. Return to reclaim it.',
      'Watch for the moment a foe\'s weapon stops rising. That is when to roll.',
    ];
    this.el('load-tip').textContent = pick(tips);
    this.tips = tips;
  },

  /** a slot for each gift of Zeus and Ares (keys 1-6), then flight (F) and God Mode (G) */
  buildAbilities() {
    const Z = 'fill="url(#gZeus)" stroke="#e8f2ff" stroke-width="1.2"', A = 'fill="url(#gAres)" stroke="#ffd9a8" stroke-width="1.2"';
    const ICON = {
      chain: `<path d="M6 44 L20 24 L28 36 L40 14 L48 28 L58 20" fill="none" stroke="url(#gZeus)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="20" cy="24" r="4" fill="#fff"/><circle cx="40" cy="14" r="4" fill="#fff"/><circle cx="58" cy="20" r="3.5" fill="#fff"/>`,
      dash: `<path d="M4 38 L30 30 L25 19 L60 32 L34 39 L39 50 Z" ${Z}/>`,
      storm: `<path d="M14 32 a10 10 0 0 1 10-12 a13 13 0 0 1 24 3 a9 9 0 0 1 3 17 H17 a8 8 0 0 1 -3-8 Z" fill="#9fb3cf" stroke="#e8f2ff" stroke-width="1.2"/><path d="M26 42 l-5 10 h6 l-3 10 l10-14 h-6 l3-6 Z M42 42 l-4 8 h5 l-2 8 l8-11 h-5 l2-5 Z" ${Z}/>`,
      warcry: `<path d="M32 4 C37 16 48 22 46 38 a14 14 0 0 1 -28 0 c0-8 5-12 6-19 c4 4 6 8 6 13 c3-7 0-16 2-28 Z" ${A}/>`,
      charge: `<path d="M32 6 L54 14 V30 C54 44 44 54 32 58 C20 54 10 44 10 30 V14 Z" ${A}/><path d="M24 22 L32 40 L40 22" fill="none" stroke="#3a0c04" stroke-width="3"/>`,
      spear: `<path d="M8 56 L46 18" stroke="url(#gAres)" stroke-width="4" stroke-linecap="round"/><path d="M42 10 L58 6 L54 22 L46 22 L42 18 Z" ${A}/><path d="M14 46 c-4 2 -6 6 -5 10 c4 0 8-2 10-6" fill="#ff8a2a" opacity=".85"/>`,
      fly: `<path d="M4 42 C16 22 34 14 60 12 C48 20 42 26 38 32 C46 30 52 30 58 33 C46 39 30 46 4 42 Z" ${Z}/>`,
      god: `<path d="M32 4 C38 16 50 22 48 40 a16 16 0 0 1 -32 0 c0-9 6-14 7-22 c4 5 6 9 6 14 c3-8 0-18 5-28 Z" fill="url(#gGod)" stroke="#fff1c8" stroke-width="1.2"/><path d="M34 22 L24 40 h7 l-3 14 L42 34 h-7 l4-12 Z" fill="#ffffff" opacity=".95"/>`,
    };
    this.slots = {};
    const add = (id, key, name, cls, box) => {
      const el = document.createElement('div');
      el.className = 'slot mini ' + cls; el.id = 'slot-' + id;
      el.innerHTML = `<svg viewBox="0 0 64 64">${ICON[id]}</svg><span class="key">${key}</span><span class="slot-name">${name}</span><div class="cd"></div><span class="cd-num"></span>`;
      el.title = `${name} (${key})`;
      box.appendChild(el);
      this.slots[id] = { el, cd: el.querySelector('.cd'), num: el.querySelector('.cd-num'), f: -1 };
    };
    // Zeus's three after his Bolt (Q) on the left, Ares's three and flight on the right, God Mode between them
    const L = this.el('ab-left'), R = this.el('ab-right'), M = this.el('ab-mid');
    for (const ab of ABILITIES) add(ab.id, ab.key.slice(-1), ab.short, ab.god, ab.god === 'zeus' ? L : R);
    add('fly', 'F', 'Fly', 'zeus', R);
    add('god', 'G', 'God Mode', 'god', M);
  },

  loading(label, pct) {
    this.el('load-text').textContent = label;
    this.el('load-fill').style.width = Math.round(pct * 100) + '%';
  },

  /* ---------------------------------------------------------- HUD */
  /** one scale for the whole HUD: 1 at 1440 x 900, smaller on small windows, a little larger on big ones */
  fitHud() {
    const s = clamp(Math.min(innerWidth / 1440, innerHeight / 860), 0.62, 1.2);
    document.documentElement.style.setProperty('--hs', s.toFixed(3));
  },
  update(dt) {
    const P = G.player;
    if (this._hsW !== innerWidth || this._hsH !== innerHeight) { this._hsW = innerWidth; this._hsH = innerHeight; this.fitHud(); }
    if (P && this.visible('hud')) {
      this.bar('hp', P.hp, P.maxHp, 180 + P.maxHp * 0.3, dt);
      this.bar('fp', P.fp, P.maxFp, 110 + P.maxFp * 1.5, dt);
      this.bar('st', Math.max(0, P.st), P.maxSt, 110 + P.maxSt * 1.6, dt);
      this.el('flask-count').textContent = P.flasks;
      this.el('slot-flask').classList.toggle('empty', P.flasks <= 0);
      this.el('slot-spell').classList.toggle('empty', P.fp < PLAYER_ACTIONS.cast.fp && !P.god);
      // the gifts: the cooldown's shade drains off each slot; Rage, flight and God Mode light up
      for (const ab of ABILITIES) {
        const s = this.slots[ab.id], left = P.cd[ab.id] || 0, f = left / ab.cd;
        if (Math.abs(s.f - f) > 0.002) { s.f = f; s.cd.style.background = f > 0.001 ? `conic-gradient(from 0deg, rgba(0,0,0,.7) ${(f * 360).toFixed(1)}deg, rgba(0,0,0,0) 0)` : 'none'; s.num.textContent = left > 0.05 ? Math.ceil(left) : ''; }
        const a = PLAYER_ACTIONS[ab.id];
        s.el.classList.toggle('empty', !P.god && ((a.fp && P.fp < a.fp) || (a.st && P.st <= 0)));
      }
      this.slots.fly.el.classList.toggle('active', P.flying);
      this.slots.fly.el.classList.toggle('empty', !P.flying && !P.god && P.fp < 12);
      const full = P.rage >= 100 && !P.god;
      this.slots.god.el.classList.toggle('ready', full);
      this.slots.god.el.classList.toggle('active', !!P.god);
      this.slots.god.el.classList.toggle('empty', !full && !P.god);
      // Rage fills the ring round God Mode
      const mid = this.el('ab-mid'), rg = Math.round(clamp(P.rage, 0, 100));
      if (this._rg !== rg) { this._rg = rg; mid.style.setProperty('--rage', rg); }
      mid.classList.toggle('full', full);
      mid.classList.toggle('god', !!P.god);
      const rl = P.god ? 'GOD MODE' : full ? 'PRESS G' : 'RAGE';
      if (this._rl !== rl) { this._rl = rl; this.el('rage-label').textContent = rl; }
      // stamina shows only while it's being spent
      const stOn = P.st < P.maxSt - 0.5;
      if (this._stOn !== stOn) { this._stOn = stOn; this.el('bar-st').classList.toggle('on', stOn); }
      if (this._ichor !== P.ichor || this._lvl !== P.level) {
        this._ichor = P.ichor; this._lvl = P.level;
        this.el('ichor-val').textContent = P.ichor.toLocaleString();
        this.el('uf-level').textContent = P.level;
        const need = Player.levelCost(P.level), pct = clamp(P.ichor / need, 0, 1);
        this.el('exp-pct').textContent = (pct * 100).toFixed(1) + '%';
        this.el('exp-fill').style.width = (pct * 100).toFixed(2) + '%';
      }
      if ((this._mmT = (this._mmT || 0) - dt) <= 0) { this._mmT = 0.05; this.updateMinimap(P); }
      if ((this._qT = (this._qT || 0) - dt) <= 0) { this._qT = 0.5; this.updateQuest(P); }
      this.updatePlates(P, dt);
      this.updateWaypoint(P);
      // lock reticle
      if (P.lock && P.lock.alive) {
        const s = this.toScreen(P.lock.pos.clone().add(new THREE.Vector3(0, P.lock.height * 0.6, 0)));
        if (s) { this.show('lock'); const l = this.el('lock'); l.style.left = s.x + 'px'; l.style.top = s.y + 'px'; } else this.hide('lock');
      } else this.hide('lock');
    }
    // boss bar
    const B = this.bossState;
    if (B.enemy && this.visible('boss')) {
      const f = clamp(B.enemy.hp / B.enemy.maxHp, 0, 1);
      if (f < B.v) B.hold = 0.8;
      B.v = f;
      B.hold -= dt;
      if (B.hold <= 0) B.chip = Math.max(B.v, B.chip - dt * 0.35);
      const box = this.el('boss');
      box.querySelector('.bar-fill').style.transform = `scaleX(${B.v})`;
      box.querySelector('.bar-chip').style.transform = `scaleX(${B.chip})`;
      B.dmgT -= dt;
      const de = this.el('boss-dmg');
      if (B.dmgT <= 0) { B.dmg = 0; de.style.opacity = 0; } else { de.textContent = Math.round(B.dmg); de.style.opacity = 1; }
    }
    for (const [, l] of this.labels) {
      if (!l.pos) continue;
      const s = this.toScreen(l.pos);
      if (!s) { l.el.style.display = 'none'; continue; }
      l.el.style.display = 'block'; l.el.style.left = s.x + 'px'; l.el.style.top = s.y + 'px';
    }
  },
  /** names and health over the foes in the fight (and the one you're locked on to) */
  updatePlates(P, dt) {
    const want = new Set();
    for (const e of G.enemies) {
      if (!e.alive || !e.root.visible || e.def.boss || this.bossState.enemy === e) continue;
      const d = e.pos.distanceTo(P.pos);
      if (e === P.lock || (e.aggro && d < 28) || (this.ebars.get(e) && this.ebars.get(e).dt > 0)) want.add(e);
    }
    for (const [e, b] of this.ebars) if (!want.has(e)) { b.el.remove(); this.ebars.delete(e); }
    for (const e of want) {
      let b = this.ebars.get(e);
      if (!b) b = this.plate(e);
      b.dt -= dt;
      const s = this.toScreen(e.pos.clone().add(new THREE.Vector3(0, e.height + 0.45, 0)));
      if (!s) { b.el.style.display = 'none'; continue; }
      b.el.style.display = 'block';
      b.el.style.left = s.x + 'px'; b.el.style.top = s.y + 'px';
      const f = clamp(e.hp / e.maxHp, 0, 1);
      if (f < b.v) b.hold = 0.7;
      b.v = f; b.hold -= dt;
      if (b.hold <= 0) b.chip = Math.max(b.v, b.chip - dt * 0.6);
      b.fill.style.transform = `scaleX(${b.v})`; b.chipEl.style.transform = `scaleX(${b.chip})`;
      const pz = e.def.poise ? clamp((e.poise ?? e.def.poise) / e.def.poise, 0, 1) : 1;
      b.poise.style.transform = `scaleX(${pz})`;
      b.el.classList.toggle('locked', e === P.lock);
      b.num.textContent = b.dt > 0 ? Math.round(b.dmg) : '';
      if (b.dt <= 0) b.dmg = 0;
    }
  },
  plate(e) {
    const el = document.createElement('div'); el.className = 'ebar';
    el.innerHTML = `<div class="ep-name"></div><div class="ep-bar"><div class="ep-chip"></div><div class="ep-fill"></div></div><div class="ep-poise"><div></div></div><span class="ep-num"></span>`;
    el.querySelector('.ep-name').textContent = e.name || e.def.name;
    this.el('enemy-bars').appendChild(el);
    const b = { el, fill: el.querySelector('.ep-fill'), chipEl: el.querySelector('.ep-chip'), poise: el.querySelector('.ep-poise div'), num: el.querySelector('.ep-num'), v: 1, chip: 1, hold: 0, dmg: 0, dt: 0 };
    this.ebars.set(e, b);
    return b;
  },
  /** the map: north up, the island painted from the terrain, foes in red, you as the arrow with your view */
  updateMinimap(P) {
    const cv = this.el('mm-canvas'); if (!cv || !World.ready) return;
    const x = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, k = 2.9;   // canvas pixels per metre
    const to = (wx, wz) => [cx + (wx - P.pos.x) * k, cy + (wz - P.pos.z) * k];
    x.fillStyle = '#3a3c38'; x.fillRect(0, 0, W, H);
    const base = this.mapBase();
    if (base) { x.imageSmoothingEnabled = true; const [ox, oy] = to(-World.HALF, -World.HALF); x.drawImage(base, ox, oy, World.HALF * 2 * k, World.HALF * 2 * k); }
    // the road
    if (World.PATH) { x.strokeStyle = 'rgba(236,224,196,.85)'; x.lineWidth = 4; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); World.PATH.forEach(([px, pz], i) => { const [mx, my] = to(px, pz); i ? x.lineTo(mx, my) : x.moveTo(mx, my); }); x.stroke(); }
    if (World.arena) { const [ax, ay] = to(World.arena.x, World.arena.z); x.strokeStyle = 'rgba(70,52,36,.9)'; x.lineWidth = 3; x.beginPath(); x.arc(ax, ay, 28 * k, 0, Math.PI * 2); x.stroke(); }
    const dot = (wx, wz, r, col, ring) => { const [mx, my] = to(wx, wz); if (mx < -10 || my < -10 || mx > W + 10 || my > H + 10) return; x.fillStyle = col; x.beginPath(); x.arc(mx, my, r, 0, Math.PI * 2); x.fill(); if (ring) { x.strokeStyle = ring; x.lineWidth = 1.5; x.stroke(); } };
    for (const a of World.altars || []) dot(a.pos.x, a.pos.z, 6, a.lit ? '#ffb347' : '#8a7a5a', '#2a1a08');
    for (const ap of World.apples || []) if (!G.flags[ap.id]) dot(ap.pos.x, ap.pos.z, 5, '#ffd84a', '#3a2a04');
    if (G.hermes && G.hermes.root.visible) dot(G.hermes.pos.x, G.hermes.pos.z, 6, '#7ad0ff', '#04202a');
    for (const e of G.enemies) if (e.alive && e.root.visible) dot(e.pos.x, e.pos.z, e.def.boss || e.def.field ? 8 : 5, '#e0342a', 'rgba(60,0,0,.8)');
    // your view, then you
    const yaw = G.cam ? G.cam.yaw : 0, va = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
    const cone = x.createRadialGradient(cx, cy, 4, cx, cy, 70); cone.addColorStop(0, 'rgba(255,250,230,.42)'); cone.addColorStop(1, 'rgba(255,250,230,0)');
    x.fillStyle = cone; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, 70, va - 0.55, va + 0.55); x.closePath(); x.fill();
    const h = P.heading || 0;
    x.save(); x.translate(cx, cy); x.rotate(Math.atan2(Math.cos(h), Math.sin(h)) + Math.PI / 2);
    x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(20,20,20,.85)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(0, -11); x.lineTo(8, 9); x.lineTo(0, 4); x.lineTo(-8, 9); x.closePath(); x.stroke(); x.fill();
    x.restore();
  },
  /** the island from above, painted once from the terrain heights in the map's parchment tones, hill-shaded */
  mapBase() {
    if (this._mapBase !== undefined) return this._mapBase;
    this._mapBase = null;
    const H = World.H, N = World.N;
    if (!H || !N) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const x = cv.getContext('2d'), img = x.createImageData(N, N), d = img.data, st = World.step || 2.5;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const DEEP = [52, 58, 60], SHAL = [92, 100, 98], SAND = [206, 192, 160], LAND = [184, 170, 140], HIGH = [160, 146, 118], ROCK = [134, 124, 108];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = H[j * N + i];
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)], hu = H[Math.max(0, j - 1) * N + i], hd = H[Math.min(N - 1, j + 1) * N + i];
      const nx = (hl - hr) / (2 * st), nz = (hu - hd) / (2 * st), slope = Math.hypot(nx, nz);
      let c;
      if (h < 0) c = mix(SHAL, DEEP, clamp(-h / 12, 0, 1));
      else if (h < 2.2) c = mix(SAND, LAND, clamp((h - 0.8) / 1.4, 0, 1));
      else { c = mix(LAND, HIGH, clamp((h - 10) / 50, 0, 1)); c = mix(c, ROCK, clamp((slope - 0.5) * 2, 0, 1)); }
      const sh = h < 0 ? 1 : clamp(1 + (nx + nz) * 0.9, 0.62, 1.25);
      const o = (j * N + i) * 4;
      d[o] = c[0] * sh; d[o + 1] = c[1] * sh; d[o + 2] = c[2] * sh; d[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    // the shore, inked
    x.globalCompositeOperation = 'source-over';
    return (this._mapBase = cv);
  },
  /** the quests, from how far the story has got: the main quest, then the altars and the apples */
  updateQuest(P) {
    const F = G.flags || {};
    let main;
    if (F.bossDefeated) main = { t: 'The Two Lives', s: 'Speak with Hermes', n: '' };
    else if (G.arenaLock) main = { t: 'The Spark of War', s: 'Defeat Ares', n: '(0/1)' };
    else if (F.mirrorSeen) main = { t: 'The Spark of War', s: 'Pass the golden mist', n: '' };
    else main = { t: 'The Spark of War', s: 'Reach the Colosseum of Ares', n: '' };
    const alt = World.altars || [], lit = alt.filter((a) => a.lit).length;
    const ap = World.apples || [], got = ap.filter((a) => F[a.id]).length;
    const cards = [
      `<div class="qc main"><span class="qc-ico">${QICON}</span><div class="qc-title"><span><i>[Main]</i>${main.t}</span></div><div class="qc-step"><b>${main.s}</b><span>${main.n}</span></div></div>`,
      `<div class="qc side${lit >= alt.length ? ' done' : ''}"><span class="qc-ico">${QICON}</span><div class="qc-title"><span>Altars of Hestia</span><span>${lit >= alt.length ? 'Complete' : ''}</span></div><div class="qc-step"><b>Kindle the altars</b><span>(${lit}/${alt.length})</span></div></div>`,
      `<div class="qc side${got >= ap.length ? ' done' : ''}"><span class="qc-ico">${QICON}</span><div class="qc-title"><span>The Hesperides</span><span>${got >= ap.length ? 'Complete' : ''}</span></div><div class="qc-step"><b>Find the golden apples</b><span>(${got}/${ap.length})</span></div></div>`,
    ].join('');
    if (this._qhtml !== cards) { this._qhtml = cards; this.el('quests').innerHTML = cards; }
    const zone = this._zone || '';
    if (this._z2 !== zone) { this._z2 = zone; this.el('mm-zone').textContent = zone.toUpperCase(); }
    // where the main quest leads
    let wp = null;
    if (F.bossDefeated) {
      const left = ap.filter((a) => !F[a.id]).sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))[0];
      if (G.hermes && G.hermes.root.visible) wp = { name: 'Hermes', x: G.hermes.pos.x, z: G.hermes.pos.z };
      else if (left) wp = { name: 'Golden Apple', x: left.pos.x, z: left.pos.z };
    } else if (!G.arenaLock && World.sites.arena) wp = { name: 'Colosseum of Ares', x: World.sites.arena.x, z: World.sites.arena.z + 30 };
    this._wp = wp;
  },
  /** the distance to the objective under Ariel, with an arrow turned toward it (hidden in a fight) */
  updateWaypoint(P) {
    const wp = this._wp, box = this.el('waypoint');
    const busy = P.lock || G.enemies.some((e) => e.alive && e.aggro && e.pos.distanceTo(P.pos) < 22) || this.visible('boss') || this.visible('prompt');
    const d = wp ? Math.hypot(wp.x - P.pos.x, wp.z - P.pos.z) : 0;
    if (!wp || busy || d < 12) { if (!box.classList.contains('hidden')) box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    if (this._wpn !== wp.name) { this._wpn = wp.name; this.el('wp-name').textContent = wp.name; }
    const m = Math.round(d) + 'm';
    if (this._wpd !== m) { this._wpd = m; this.el('wp-dist').textContent = m; }
    // the bearing against the camera's forward (forward is (-sin yaw, -cos yaw))
    const yaw = G.cam ? G.cam.yaw : 0, dx = wp.x - P.pos.x, dz = wp.z - P.pos.z;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    this.el('wp-arrow').style.transform = `rotate(${ang.toFixed(3)}rad)`;
  },
  /** a line in the log under the quests: tag is system, quest, combat or notice */
  log(tag, html) {
    const box = this.el('log');
    const name = { system: 'System', quest: 'Quest', combat: 'Combat', notice: 'Notice' }[tag] || 'System';
    const l = document.createElement('div'); l.className = 'lg';
    l.innerHTML = `<span class="tag ${tag}">${name}</span><span></span>`;
    l.lastChild.innerHTML = html;
    box.appendChild(l);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => l.classList.add('old'), 14000);
  },
  /** the system line across the top */
  sysmsg(html, dur = 4.5) {
    this.el('sysmsg-text').innerHTML = html;
    this.replay('sysmsg');
    clearTimeout(this._smT);
    this._smT = setTimeout(() => this.hide('sysmsg'), dur * 1000);
  },
  bar(k, v, max, width, dt) {
    const b = this.bars[k], f = clamp(v / max, 0, 1);
    if (f < b.v - 0.001) b.hold = 0.6;
    b.v = f;
    b.hold -= dt;
    if (b.hold <= 0 || b.chip < b.v) b.chip = b.chip < b.v ? b.v : Math.max(b.v, b.chip - dt * 0.5);
    const e = this.el('bar-' + k);
    e.children[1].style.transform = `scaleX(${b.v})`;
    e.children[0].style.transform = `scaleX(${b.chip})`;
    const val = e.querySelector('.bar-val');
    if (val) { const t = `${Math.ceil(Math.max(0, v))} / ${Math.round(max)}`; if (b.t !== t) { b.t = t; val.textContent = t; } }
  },
  toScreen(p) {
    const v = p.clone().project(G.camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  },
  clearEnemyBars() { for (const [, b] of this.ebars) b.el.remove(); this.ebars.clear(); },
  label(id, text, pos) {
    let l = this.labels.get(id);
    if (!text) { if (l) { l.el.remove(); this.labels.delete(id); } return; }
    if (!l) { const el = document.createElement('div'); el.className = 'label'; this.el('labels').appendChild(el); l = { el }; this.labels.set(id, l); }
    l.el.textContent = text; l.pos = pos;
  },
  enemyDamaged(e, dmg) {
    if (e.def.boss || e.def.field && this.bossState.enemy === e) { this.bossState.dmg += dmg; this.bossState.dmgT = 2.2; return; }
    const b = this.ebars.get(e) || this.plate(e);
    b.dmg += dmg; b.dt = 2;
  },
  pulseSlot(id) { const e = this.el(id); e.classList.remove('pulse'); void e.offsetWidth; e.classList.add('pulse'); },
  ichorGain() { const e = this.el('ichor'); e.classList.remove('gain'); void e.offsetWidth; e.classList.add('gain'); },

  bossShow(enemy, name) {
    this.bossState = { v: 1, chip: 1, hold: 0, dmg: 0, dmgT: 0, enemy };
    this.el('boss-name').textContent = name || enemy.name;
    this.show('boss');
  },
  bossHide() { this.hide('boss'); this.bossState.enemy = null; },

  prompt(html) {
    if (this._prompt === html) return;
    this._prompt = html;
    if (!html) { this.hide('prompt'); return; }
    this.el('prompt').innerHTML = html;
    this.show('prompt');
  },
  hint(html, dur = 7) {
    const e = this.el('hint');
    e.innerHTML = html;
    this.replay('hint');
    clearTimeout(this._hintT);
    this._hintT = setTimeout(() => this.hide('hint'), dur * 1000);
  },
  toast(html) {
    this.log('notice', html);
    this.sysmsg('[System] ' + html);
  },
  area(name) {
    this._zone = name;
    this.log('system', `Entered <b>${name}</b>`);
    this.el('area-name').textContent = name;
    this.replay('area');
    clearTimeout(this._areaT);
    this._areaT = setTimeout(() => this.hide('area'), 5200);
  },
  banner(text, cls = '') {
    if (this.visible('hud')) this.log('quest', text.charAt(0) + text.slice(1).toLowerCase());
    this.el('banner-text').textContent = text;
    const b = this.el('banner');
    b.className = cls;
    this.replay('banner');
    clearTimeout(this._banT);
    this._banT = setTimeout(() => this.hide('banner'), 4700);
  },
  damage() { G.post.damage = 1; },
  flash(v = 0.5) {
    const f = this.el('flash');
    f.style.transition = 'none'; f.style.opacity = v;
    void f.offsetWidth;
    f.style.transition = 'opacity .45s ease-out'; f.style.opacity = 0;
  },
  fade(to, dur = 1) {
    const f = this.el('fade');
    f.style.transition = `opacity ${dur}s ease`;
    f.style.opacity = to;
    return new Promise((r) => setTimeout(r, dur * 1000));
  },
  setFade(v) { const f = this.el('fade'); f.style.transition = 'none'; f.style.opacity = v; },

  /* ---------------------------------------------------------- cinematic */
  letterbox(on) { this.el('letterbox').classList.toggle('on', on); },
  subtitle(speaker, text, dur) {
    if (!text) { this.hide('subtitle'); return; }
    this.el('sub-speaker').textContent = speaker ? speaker.toUpperCase() : '';
    this.el('sub-line').textContent = text;
    this.show('subtitle');
    clearTimeout(this._subT);
    if (dur) this._subT = setTimeout(() => this.hide('subtitle'), dur * 1000);
  },
  card(text) {
    const c = this.el('card-text');
    if (!text) { c.style.opacity = 0; setTimeout(() => { if (c.style.opacity === '0') this.hide('card'); }, 1300); return; }
    this.show('card');
    c.style.transition = 'none'; c.style.opacity = 0; c.innerHTML = text;
    void c.offsetWidth;
    c.style.transition = 'opacity 1.2s'; c.style.opacity = 1;
  },
  chapter(small, big) {
    if (!big) { this.hide('chapter'); return; }
    this.el('chapter-small').textContent = small;
    this.el('chapter-big').textContent = big;
    this.replay('chapter');
  },
  skipProgress(v) {
    if (v === null) { this.hide('skip'); return; }
    this.show('skip');
    this.el('skip-fill').style.width = (v * 100) + '%';
  },
  credits(html, dur = 32) {
    const box = this.el('credits'), roll = this.el('credits-roll');
    roll.innerHTML = html;
    this.show('credits');
    roll.style.transition = 'none'; roll.style.transform = 'translateY(0)';
    void roll.offsetWidth;
    const h = roll.offsetHeight + innerHeight;
    roll.style.transition = `transform ${dur}s linear`;
    roll.style.transform = `translateY(-${h}px)`;
    return new Promise((r) => {
      const end = () => { clearTimeout(tm); removeEventListener('keydown', key); this.hide('credits'); r(); };
      const key = (e) => { if (e.code === 'Escape' || e.code === 'Enter') end(); };
      const tm = setTimeout(end, dur * 1000);
      addEventListener('keydown', key);
    });
  },
  death() {
    this.replay('death');
    return new Promise((r) => setTimeout(() => { this.hide('death'); r(); }, 5000));
  },

  /* ---------------------------------------------------------- dialogue */
  dialog(name, text, choices = null) {
    return new Promise((resolve) => {
      this.show('dialog');
      this.el('dlg-name').textContent = name.toUpperCase();
      const tEl = this.el('dlg-text'), cEl = this.el('dlg-choices');
      cEl.innerHTML = '';
      let i = 0, done = false;
      const finishText = () => {
        if (done) return;
        done = true; clearInterval(iv); tEl.textContent = text;
        if (choices) {
          choices.forEach((c, k) => {
            const b = document.createElement('button');
            b.textContent = c;
            b.onclick = () => close(k);
            cEl.appendChild(b);
          });
        } else {
          const m = document.createElement('div'); m.className = 'dlg-more'; m.textContent = '▸ continue';
          cEl.appendChild(m);
        }
      };
      const iv = setInterval(() => { i += 2; tEl.textContent = text.slice(0, i); if (i >= text.length) finishText(); }, 22);
      const key = (e) => {
        if (['Space', 'Enter', 'KeyE'].includes(e.code)) {
          e.preventDefault();
          if (!done) finishText(); else if (!choices) close(0);
        } else if (choices && /^Digit[1-9]$/.test(e.code)) {
          const k = +e.code.slice(5) - 1; if (k < choices.length) close(k);
        } else if (e.code === 'Escape' && choices) close(choices.length - 1);
      };
      const click = (e) => { if (e.target.closest && e.target.closest('button')) return; if (!done) finishText(); else if (!choices) close(0); };
      const close = (k) => {
        clearInterval(iv); removeEventListener('keydown', key); this.el('dialog').removeEventListener('mousedown', click); document.getElementById('game').removeEventListener('mousedown', click);
        this.hide('dialog'); Sound.ui('ok'); resolve(k);
      };
      setTimeout(() => {
        addEventListener('keydown', key);
        this.el('dialog').addEventListener('mousedown', click);
        document.getElementById('game').addEventListener('mousedown', click);
      }, 150);
      Voice.speak(text, name);
    });
  },

  /* ---------------------------------------------------------- panels */
  openPanel(id) {
    this.panels.forEach((p) => this.hide(p));
    this.panels.push(id);
    if (id === 'settings') this.buildSettings();
    if (id === 'levelup') this.buildLevelUp();
    this.show(id);
    Input.unlock();
  },
  back() {
    const cur = this.panels.pop();
    if (cur) this.hide(cur);
    Sound.ui('back');
    const prev = this.panels[this.panels.length - 1];
    if (prev) { this.show(prev); if (prev === 'levelup') this.buildLevelUp(); return true; }
    return false;
  },
  closeAll() { this.panels.forEach((p) => this.hide(p)); this.panels = []; },
  wireMenus() {
    const on = (id, fn) => this.el(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.act) { Sound.ui('ok'); fn(b.dataset.act); } });
    on('title-menu', (a) => Game.titleAction(a));
    on('pause-menu', (a) => {
      if (a === 'resume') Game.resume();
      else if (a === 'settings') this.openPanel('settings');
      else if (a === 'controls') this.openPanel('controls');
      else if (a === 'title') Game.toTitle();
    });
    on('altar-menu', (a) => { if (a === 'level') this.openPanel('levelup'); else Game.leaveAltar(); });
    for (const id of ['settings', 'controls', 'credits-panel']) on(id, (a) => { if (a === 'back') this.back(); });
    on('levelup', (a) => {
      if (a === 'confirm') this.confirmLevelUp();
      else this.back();
    });
  },
  buildSettings() {
    const s = G.settings, g = this.el('set-grid');
    g.innerHTML = '';
    const row = (label, input, note) => {
      const l = document.createElement('div'); l.textContent = label;
      g.append(l, input);
      if (note) { const n = document.createElement('div'); n.className = 'note'; n.textContent = note; g.append(n); }
    };
    const sel = document.createElement('select');
    [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if (s.quality === v) o.selected = true; sel.append(o); });
    sel.onchange = () => { s.quality = sel.value; saveSettings(); Game.applyQuality(); };
    row('Graphics quality', sel, 'Lower this if the game stutters. Ultra uses full resolution and the densest grass.');
    const range = (key, min, max, step, onch) => {
      const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = s[key];
      r.oninput = () => { s[key] = parseFloat(r.value); saveSettings(); if (onch) onch(); };
      return r;
    };
    const check = (key, onch) => {
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!s[key];
      c.onchange = () => { s[key] = c.checked; saveSettings(); if (onch) onch(); };
      return c;
    };
    row('Mouse sensitivity', range('sensitivity', 0.2, 3, 0.05));
    row('Invert camera Y', check('invertY'));
    row('Master volume', range('master', 0, 1, 0.01, () => Sound.applyVolumes()));
    row('Music volume', range('music', 0, 1, 0.01, () => Sound.applyVolumes()));
    row('Effects volume', range('sfx', 0, 1, 0.01, () => Sound.applyVolumes()));
    row('Voiced dialogue', check('voice', () => { if (!s.voice) Voice.stop(); }), 'Every character is fully voiced. Turn this off for subtitles only.');
    row('Voice volume', range('voiceVol', 0, 1.5, 0.01, () => Sound.applyVolumes()));
    row('Camera shake', check('shake'));
    row('Show FPS', check('showFps', () => this.el('fps').classList.toggle('hidden', !s.showFps)));
  },

  /* ---------------------------------------------------------- level up */
  STATS: [
    ['vig', 'Vigor', 'Raises maximum health'],
    ['end', 'Endurance', 'Raises stamina for swings and rolls'],
    ['str', 'Strength', 'Raises the damage of your blade'],
    ['div', 'Divinity', 'Raises FP and the power of thunder'],
  ],
  buildLevelUp() {
    const P = G.player;
    if (!this.pending || this._lvOpenFor !== P.level) { this.pending = { vig: 0, end: 0, str: 0, div: 0 }; this._lvOpenFor = P.level; }
    const pend = this.pending, n = pend.vig + pend.end + pend.str + pend.div;
    const costOf = (k) => { let c = 0; for (let i = 0; i < k; i++) c += Player.levelCost(P.level + i); return c; };
    const spent = costOf(n), next = Player.levelCost(P.level + n);
    this.el('lv-level').textContent = P.level + n;
    this.el('lv-held').textContent = (P.ichor - spent).toLocaleString();
    this.el('lv-cost').textContent = next.toLocaleString();
    const box = this.el('lv-stats');
    box.innerHTML = '';
    for (const [k, name, desc] of this.STATS) {
      const r = document.createElement('div'); r.className = 'lv-row';
      r.innerHTML = `<div>${name}<span class="desc">${desc}</span></div><button data-k="${k}" data-d="-1">−</button><div class="val ${pend[k] ? 'up' : ''}">${P.stats[k] + pend[k]}</div><button data-k="${k}" data-d="1">+</button>`;
      const [minus, plus] = r.querySelectorAll('button');
      minus.disabled = pend[k] <= 0;
      plus.disabled = P.ichor - spent < next || P.stats[k] + pend[k] >= 40;
      r.querySelectorAll('button').forEach((b) => { b.onclick = () => { pend[b.dataset.k] += +b.dataset.d; Sound.ui(+b.dataset.d > 0 ? 'ok' : 'back'); this.buildLevelUp(); }; });
      box.appendChild(r);
    }
    const s = { vig: P.stats.vig + pend.vig, end: P.stats.end + pend.end, str: P.stats.str + pend.str, div: P.stats.div + pend.div };
    const hp = Math.round(360 + s.vig * 40), st = Math.round(88 + s.end * 7), fp = Math.round(60 + s.div * 10), atk = Math.round(30 * (1 + s.str * 0.075));
    this.el('lv-derived').innerHTML = `<div><b>${hp}</b>Health</div><div><b>${fp}</b>FP</div><div><b>${st}</b>Stamina</div><div><b>${atk}</b>Attack</div>`;
  },
  confirmLevelUp() {
    const P = G.player, pend = this.pending, n = pend.vig + pend.end + pend.str + pend.div;
    if (!n) { this.back(); return; }
    let c = 0; for (let i = 0; i < n; i++) c += Player.levelCost(P.level + i);
    P.ichor -= c;
    for (const k in pend) P.stats[k] += pend[k];
    P.derive();
    P.hp = P.maxHp; P.fp = P.maxFp; P.st = P.maxSt;
    this.pending = null;
    Sound.levelUp();
    FX.healAura(P.pos);
    this.toast(`Reached <b>Level ${P.level}</b>`);
    Game.save();
    this.back();
  },
};
