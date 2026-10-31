'use strict';
/* ==========================================================================
   ui.js · HUD, cinematic overlays, dialogue and menus
   ========================================================================== */

const UI = {
  _c: {},
  el(id) { return this._c[id] || (this._c[id] = document.getElementById(id)); },
  show(id) { this.el(id).classList.remove('hidden'); },
  hide(id) { this.el(id).classList.add('hidden'); },
  visible(id) { return !this.el(id).classList.contains('hidden'); },
  replay(id) { const e = this.el(id); e.classList.add('hidden'); void e.offsetWidth; e.classList.remove('hidden'); },

  init() {
    this.bars = { hp: { v: 1, chip: 1, hold: 0 }, fp: { v: 1, chip: 1, hold: 0 }, st: { v: 1, chip: 1, hold: 0 } };
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
      'If you fall, your Ichor stays where you died. Return to reclaim it.',
      'Watch for the moment a foe\'s weapon stops rising. That is when to roll.',
    ];
    this.el('load-tip').textContent = pick(tips);
    this.tips = tips;
  },

  loading(label, pct) {
    this.el('load-text').textContent = label;
    this.el('load-fill').style.width = Math.round(pct * 100) + '%';
  },

  /* ---------------------------------------------------------- HUD */
  update(dt) {
    const P = G.player;
    if (P && this.visible('hud')) {
      this.bar('hp', P.hp, P.maxHp, 180 + P.maxHp * 0.3, dt);
      this.bar('fp', P.fp, P.maxFp, 110 + P.maxFp * 1.5, dt);
      this.bar('st', Math.max(0, P.st), P.maxSt, 110 + P.maxSt * 1.6, dt);
      this.el('flask-count').textContent = P.flasks;
      this.el('slot-flask').classList.toggle('empty', P.flasks <= 0);
      this.el('slot-spell').classList.toggle('empty', P.fp < PLAYER_ACTIONS.cast.fp);
      if (this._ichor !== P.ichor) { this._ichor = P.ichor; this.el('ichor-val').textContent = P.ichor.toLocaleString(); }
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
    // enemy bars
    for (const [e, b] of this.ebars) {
      b.t -= dt; b.dt -= dt;
      if (b.t <= 0 || !e.root.visible || (!e.alive && b.t < 4)) { b.el.remove(); this.ebars.delete(e); continue; }
      const s = this.toScreen(e.pos.clone().add(new THREE.Vector3(0, e.height + 0.35, 0)));
      if (!s) { b.el.style.display = 'none'; continue; }
      b.el.style.display = 'block';
      b.el.style.left = s.x + 'px'; b.el.style.top = s.y + 'px';
      b.fill.style.width = (clamp(e.hp / e.maxHp, 0, 1) * 100) + '%';
      b.num.textContent = b.dt > 0 ? Math.round(b.dmg) : '';
      if (b.dt <= 0) b.dmg = 0;
    }
    for (const [, l] of this.labels) {
      if (!l.pos) continue;
      const s = this.toScreen(l.pos);
      if (!s) { l.el.style.display = 'none'; continue; }
      l.el.style.display = 'block'; l.el.style.left = s.x + 'px'; l.el.style.top = s.y + 'px';
    }
  },
  bar(k, v, max, width, dt) {
    const b = this.bars[k], f = clamp(v / max, 0, 1);
    if (f < b.v - 0.001) b.hold = 0.6;
    b.v = f;
    b.hold -= dt;
    if (b.hold <= 0 || b.chip < b.v) b.chip = b.chip < b.v ? b.v : Math.max(b.v, b.chip - dt * 0.5);
    const e = this.el('bar-' + k);
    const w = Math.round(width);
    if (b.w !== w) { b.w = w; e.style.width = w + 'px'; }
    e.children[1].style.transform = `scaleX(${b.v})`;
    e.children[0].style.transform = `scaleX(${b.chip})`;
  },
  toScreen(p) {
    const v = p.clone().project(G.camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  },
  enemyDamaged(e, dmg) {
    if (e.def.boss || e.def.field && this.bossState.enemy === e) {
      this.bossState.dmg += dmg; this.bossState.dmgT = 2.2;
      return;
    }
    let b = this.ebars.get(e);
    if (!b) {
      const el = document.createElement('div'); el.className = 'ebar';
      const fill = document.createElement('div'); const num = document.createElement('span');
      el.append(fill, num);
      this.el('enemy-bars').appendChild(el);
      b = { el, fill, num, t: 0, dmg: 0, dt: 0 };
      this.ebars.set(e, b);
    }
    b.t = 6; b.dmg += dmg; b.dt = 2;
  },
  clearEnemyBars() { for (const [, b] of this.ebars) b.el.remove(); this.ebars.clear(); },
  label(id, text, pos) {
    let l = this.labels.get(id);
    if (!text) { if (l) { l.el.remove(); this.labels.delete(id); } return; }
    if (!l) { const el = document.createElement('div'); el.className = 'label'; this.el('labels').appendChild(el); l = { el }; this.labels.set(id, l); }
    l.el.textContent = text; l.pos = pos;
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
    const t = document.createElement('div');
    t.className = 'toast'; t.innerHTML = html;
    this.el('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4100);
  },
  area(name) {
    this.el('area-name').textContent = name;
    this.replay('area');
    clearTimeout(this._areaT);
    this._areaT = setTimeout(() => this.hide('area'), 5200);
  },
  banner(text, cls = '') {
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
