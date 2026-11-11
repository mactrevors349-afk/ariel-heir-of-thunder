'use strict';
/* ==========================================================================
   game.js · renderer, post-processing, game states, saving, main loop
   ========================================================================== */

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSharp: { value: 0 },
    uVignette: { value: 1.15 }, uGrain: { value: 0.016 }, uCA: { value: 0.0008 },
    uSat: { value: 0.8 }, uContrast: { value: 1.13 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    uLift: { value: new THREE.Vector3(0.004, 0.006, 0.011) }, uDamage: { value: 0 }, uDesat: { value: 0 },
    // split toning: cold, steel-blue shadows under warm, tarnished-gold highlights
    uShadowTone: { value: new THREE.Vector3(0.9, 0.97, 1.08) }, uHighTone: { value: new THREE.Vector3(1.07, 1.0, 0.88) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uSharp;
    uniform float uVignette, uGrain, uCA, uSat, uContrast, uDamage, uDesat;
    uniform vec3 uTint, uLift, uShadowTone, uHighTone;
    varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r = length(d);
      float ca = uCA * r * r * 4.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv - d * ca).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv + d * ca).b;
      // sharpening: brings back detail when the scene is rendered below screen resolution
      if (uSharp > 0.0) {
        vec2 px = 1.0 / uRes;
        vec3 nb = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
                + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        col = max(col + (col * 4.0 - nb) * uSharp, 0.0);
      }
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat * (1.0 - uDesat));
      col = (col - 0.5) * uContrast + 0.5;
      col *= mix(uShadowTone, uHighTone, smoothstep(0.04, 0.6, l));
      col *= uTint;
      col += uLift * (1.0 - col);
      col *= mix(1.0, smoothstep(0.95, 0.22, r), uVignette);
      col = mix(col, vec3(0.32, 0.0, 0.0), uDamage * smoothstep(0.25, 0.8, r));
      // film grain, kept fine and soft (sharp per-pixel noise read as flicker on a scaled-up frame), weaker in the lights
      float n = fract(sin(dot(floor(vUv * uRes * 0.5) + fract(uTime * 2.3) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain * (1.0 - 0.6 * smoothstep(0.2, 0.8, l));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

const Game = {
  started: false,

  async boot() {
    UI.init();
    UI.wireMenus();
    G.post = { damage: 0 };
    const progress = (label, pct) => UI.loading(label, pct);
    progress('Summoning the Fates…', 0.03);
    await this.frame();

    // ---------------- renderer
    const renderer = (G.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false }));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    document.getElementById('game').appendChild(renderer.domElement);
    // quality not chosen yet: start from the graphics card (the resolution governor takes care of the rest)
    if (!G.settings.quality) { G.settings.quality = this.gpuTier() === 'integrated' ? 'medium' : 'high'; saveSettings(); }
    Input.init(renderer.domElement);
    Voice.init();

    const scene = (G.scene = new THREE.Scene());
    G.activeScene = scene;
    const camera = (G.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.15, 12000));
    camera.position.set(0, 30, 300);
    G.cam = new CameraRig(camera);

    progress('Weaving textures…', 0.08);
    await this.frame();
    Tex.generate(renderer);
    progress('Gathering stone and earth…', 0.12);
    await Tex.loadPhotos(renderer);
    initCharacterMaterials();
    FX.init(scene);

    await World.build(scene, renderer, progress);
    await Models.load(progress);
    progress('Carving the statues…', 0.94);
    await this.frame();
    World.placeStatues(scene);

    progress('Breathing life into heroes…', 0.94);
    await this.frame();
    G.player = new Player(scene);
    G.hermes = new Hermes(scene);
    G.echo = new Echo(scene);
    G.enemies = ENEMY_SPAWNS.map(([type, x, z, o]) => new Enemy(type, x, z, o || {}));
    G.cyclops = G.enemies.find((e) => e.type === 'cyclops');
    const A = World.arena;
    G.boss = new Ares(A.x, A.z - 14);
    G.enemies.push(G.boss);
    this.buildProps(scene);
    this.buildInteractables();

    // ---------------- post-processing
    progress('Polishing the light…', 0.95);
    await this.frame();
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    const comp = (this.composer = new Addons.EffectComposer(renderer, rt));
    this.renderPass = new Addons.RenderPass(scene, camera);
    this.bloom = new Addons.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.9);
    this.output = new Addons.OutputPass();
    this.fxaa = new Addons.ShaderPass(Addons.FXAAShader);
    this.final = new Addons.ShaderPass(FinalShader);
    // the scene pass keeps its depth, for the ambient occlusion straight after it (see ao.js)
    for (const t of [comp.renderTarget1, comp.renderTarget2]) { t.depthTexture = new THREE.DepthTexture(1, 1); t.depthTexture.type = THREE.UnsignedIntType; }
    this.ao = new AOPass(camera);
    comp.addPass(this.renderPass); comp.addPass(this.ao); comp.addPass(this.bloom); comp.addPass(this.output); comp.addPass(this.fxaa); comp.addPass(this.final);
    addEventListener('resize', () => this.resize());
    this.renderScale = 1;
    this.applyQuality(true);

    // build the cutscene stages now and compile every shader, so the story never stalls to prepare
    progress('Warming the forge…', 0.97);
    await this.frame();
    G.player.setPosition(World.sites.start.x, World.sites.start.z - 13, Math.PI);
    try {
      School.build(); Prologue.build();
      // the ending's Zeus waits hidden in the world, so his glowing materials are prepared now too
      const Z = (SCRIPTS.bossDefeat.zeus = SCRIPTS.bossDefeat.makeZeus());
      Z.root.visible = false;
      scene.add(Z.root);
    } catch (e) { console.warn('cutscene stage build failed', e); }
    try { Life.build(); } catch (e) { console.warn('home / campus / memory stage build failed', e); }
    for (const s of [scene, School.scene, Prologue.olympus, Prologue.tartarus, Home.scene, Memory.scene, Campus.scene]) { if (s) { Cutscene.filmLights(s); this.warm(s); await this.frame(); } }
    // and the post-processing chain (bloom, anti-aliasing, grading)
    try { this.composer.render(); } catch (e) { /* only an optimisation */ }
    // integrated graphics start from a pixel budget (about 1 megapixel, sharpened);
    // during play the resolution governor (autoQuality) tunes it from real frame times
    if (this.gpuTier() === 'integrated') {
      // (a generous pixel budget: below it the picture turns soft and blocky, and the governor sheds effects first)
      const px = innerWidth * innerHeight * this.prCap() ** 2;
      this.renderScale = clamp(Math.sqrt(2.4e6 / px), 0.75, 1);
      this.applyQuality();
    }

    this.load();
    G.onPointerLock = (locked) => {
      if (locked) UI.hide('click-resume');
      else if (G.state === 'playing') this.pause();
    };
    this.el = { resume: document.getElementById('click-resume') };
    this.el.resume.addEventListener('click', () => { Sound.init(); Input.lock(); UI.hide('click-resume'); });

    UI.hide('loading');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    clearTimeout(window.__bootTimer);

    // debug / dev shortcuts: ?skip, ?boss, ?arena
    const auto = sessionStorage.getItem('ariel_autostart');
    sessionStorage.removeItem('ariel_autostart');
    if (G.params.has('skip') || G.params.has('boss') || G.params.has('arena')) {
      G.flags.introDone = true;
      if (G.params.has('boss') || G.params.has('arena')) { const R = World.sites.arena; G.player.setPosition(R.x, R.z + 42, Math.PI); }
      else G.player.setPosition(World.sites.start.x, World.sites.start.z - 20, Math.PI);
      G.hermes.place(World.sites.start.x + 3.4, World.sites.start.z - 21, -2.4);
      this.startPlay({ fadeIn: true });
      return;
    }
    if (auto === 'new') { this.newGame(); return; }
    if (auto === 'continue') { this.continueGame(); return; }
    this.toTitleScreen();
  },
  frame() { return new Promise((r) => setTimeout(r, 16)); },
  /** integrated / mobile / software GPUs get lighter defaults */
  gpuTier() {
    try {
      const gl = G.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
      if (/NVIDIA|GeForce|RTX|GTX|Radeon(?!.*Graphics)|RX \d|Arc\(TM\) A/i.test(name)) return 'discrete';
      if (/Intel|UHD|Iris|Mali|Adreno|PowerVR|Apple|SwiftShader|llvmpipe|Basic Render|Radeon.*Graphics/i.test(name)) return 'integrated';
      return 'discrete';
    } catch (e) { return 'integrated'; }
  },

  /* ---------------------------------------------------------- props */
  buildProps(scene) {
    // golden apples
    this.appleMeshes = {};
    const appleMat = new THREE.MeshStandardMaterial({ color: 0xffc34a, metalness: 0.8, roughness: 0.25, emissive: 0xff9a20, emissiveIntensity: 1.6 });
    const makeApple = (ap) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), appleMat);
      body.scale.set(1, 0.92, 1);
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 4), appleMat);
      leaf.position.set(0.05, 0.22, 0); leaf.rotation.z = -0.6;
      g.add(body, leaf);
      g.position.copy(ap.pos);
      scene.add(g);
      this.appleMeshes[ap.id] = g;
    };
    World.apples.forEach(makeApple);
    this.makeApple = makeApple;
    // echo messages: glowing sigils on the ground
    const runeMat = new THREE.MeshBasicMaterial({ map: Tex.rune, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.6, 1.1, 0.5) });
    World.messages.forEach((m) => {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4).rotateX(-Math.PI / 2), runeMat);
      r.position.copy(m.pos); r.position.y += 0.06;
      scene.add(r);
    });
    // lost ichor marker
    const lg = new THREE.Group();
    lg.add(new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.8) })));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.3, 6, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 0.9, 0.3), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    beam.position.y = 3; lg.add(beam);
    lg.visible = false;
    scene.add(lg);
    this.lostMesh = lg;
  },

  buildInteractables() {
    const P = () => G.player;
    G.interactables = [
      ...World.altars.map((a) => ({ pos: a.pos, r: 2.8, label: () => (a.lit ? `Rest at the ${a.name}` : `Kindle the ${a.name}`), act: () => this.useAltar(a) })),
      { pos: G.hermes.pos, r: 3.2, label: () => 'Talk to Hermes', cond: () => G.hermes.root.visible, act: () => this.talkHermes() },
      ...World.messages.map((m) => ({ pos: m.pos, r: 1.8, label: () => 'Read the echo', act: () => this.readMessage(m) })),
      ...World.apples.map((ap) => ({ pos: ap.pos, r: 2.0, label: () => 'Take the golden apple', cond: () => !G.flags[ap.id], act: () => this.takeApple(ap) })),
      { pos: World.sites.arena.gatePos, r: 4.2, label: () => 'Pass through the golden mist', cond: () => World.arena.gateActive && !G.arenaLock, act: () => this.enterBoss() },
    ];
    this.nearestInteractable = () => {
      let best = null, bd = Infinity;
      for (const it of G.interactables) {
        if (it.cond && !it.cond()) continue;
        const d = Math.hypot(it.pos.x - P().pos.x, it.pos.z - P().pos.z);
        if (d < it.r && d < bd && Math.abs(it.pos.y - P().pos.y) < 3) { bd = d; best = it; }
      }
      return best;
    };
  },
  tryInteract() {
    const it = this.nearestInteractable();
    if (!it) return false;
    UI.prompt(null);
    it.act();
    return true;
  },

  /* ---------------------------------------------------------- states */
  setState(s) { G.state = s; },
  useScene(s) {
    G.activeScene = s;
    this.renderPass.scene = s;
    FX.setScene(s);
    if (s === G.scene) this.output.enabled = true;
  },
  toTitleScreen() {
    this.setState('title');
    UI.show('title'); UI.hide('hud');
    UI.letterbox(false);
    document.getElementById('btn-continue').disabled = !this.hasSave();
    UI.setFade(1); UI.fade(0, 2.5);
    Music.play('title');
    Sound.startWind();
    this.titleT = 0;
  },
  titleAction(a) {
    Sound.init();
    if (a === 'continue') this.continueGame();
    else if (a === 'new') {
      if (this.started) { this.wipeSave(); sessionStorage.setItem('ariel_autostart', 'new'); location.reload(); return; }
      this.newGame();
    } else if (a === 'settings') UI.openPanel('settings');
    else if (a === 'controls') UI.openPanel('controls');
    else if (a === 'credits') UI.openPanel('credits-panel');
  },
  async newGame() {
    this.wipeSave();
    G.flags = {};
    UI.hide('title'); UI.closeAll();
    this.started = true;
    await UI.fade(1, 1.2);
    Cutscene.play('intro');
  },
  async continueGame() {
    UI.hide('title'); UI.closeAll();
    this.started = true;
    await UI.fade(1, 1);
    this.applySaveState();
    const a = World.altars.find((x) => x.id === G.lastAltar);
    if (a) G.player.respawn(a.pos.x + 1.6, a.pos.z + 1.6, Math.atan2(a.pos.x - (a.pos.x + 1.6), a.pos.z - (a.pos.z + 1.6)));
    else G.player.respawn(World.sites.start.x, World.sites.start.z - 20, Math.PI);
    if (!G.flags.introDone) { Cutscene.play('intro'); return; }
    await this.startPlay({ fadeIn: true });
    const area = World.areas.find((ar) => Math.hypot(ar.x - G.player.pos.x, ar.z - G.player.pos.z) < ar.r);
    if (area) UI.area(area.name);
  },
  async startPlay({ fadeIn = true } = {}) {
    const P = G.player;
    this.setState('playing');
    P.state = 'free'; P.alive = true;
    UI.letterbox(false);
    UI.show('hud');
    UI.hide('title');
    G.cam.yaw = P.heading + Math.PI;
    G.cam.pitch = 0.2;
    G.cam.snap(P);
    G.camera.fov = 55; G.cam.fov = 55; G.camera.updateProjectionMatrix();
    if (Music.mode !== 'boss') Music.play('explore');
    if (!Input.locked && !Input.lockFailed) UI.show('click-resume');
    if (fadeIn) await UI.fade(0, 1.4); else UI.setFade(0);
  },
  pause() {
    if (G.state !== 'playing') return;
    this.setState('paused');
    UI.openPanel('pause');
    UI.hide('click-resume');
  },
  resume() {
    UI.closeAll();
    this.setState('playing');
    Input.lock();
    if (!Input.locked && !Input.lockFailed) setTimeout(() => { if (!Input.locked && G.state === 'playing') UI.show('click-resume'); }, 300);
  },
  toTitle() {
    this.save();
    sessionStorage.removeItem('ariel_autostart');
    location.reload();
  },

  /* ---------------------------------------------------------- altars, NPCs, pickups */
  async useAltar(a) {
    const P = G.player;
    this.setState('menu');
    P.state = 'locked';
    P.lock = null;
    P.heading = Math.atan2(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
    P.rig.play('kneel', { fade: 0.25 });
    Input.unlock();
    if (!a.lit) {
      a.lit = true;
      UI.banner('ALTAR KINDLED');
      Sound.bell();
      FX.sparks(a.flame, new THREE.Vector3(0, 1, 0), 60, [2.6, 1.9, 0.7, 1], 5);
      FX.flashLight(a.flame, 0xffc060, 140, 0.8, 18);
    } else Sound.bell();
    G.lastAltar = a.id;
    // rest: restore and bring the shades back
    P.hp = P.maxHp; P.fp = P.maxFp; P.st = P.maxSt; P.flasks = P.maxFlasks;
    FX.healAura(P.pos);
    this.respawnEnemies();
    G.lostIchor = G.lostIchor || null;
    this.save();
    this.el.altarName = this.el.altarName || document.getElementById('altar-name');
    this.el.altarName.textContent = a.name;
    setTimeout(() => { if (G.state === 'menu') UI.openPanel('altar'); }, 900);
  },
  leaveAltar() {
    UI.closeAll();
    const P = G.player;
    P.rig.play('standUp', { fade: 0.2 });
    setTimeout(() => { this.setState('playing'); P.state = 'free'; Input.lock(); }, 700);
  },
  respawnEnemies() {
    for (const e of G.enemies) {
      if (e === G.boss) continue;
      if (e === G.cyclops && G.flags.cyclopsDead) continue;
      e.reset();
      e.dissolved = false;
    }
    UI.clearEnemyBars();
    if (UI.bossState.enemy === G.cyclops) UI.bossHide();
  },
  async readMessage(m) {
    const P = G.player;
    this.setState('menu'); P.state = 'locked'; Input.unlock();
    await UI.dialog('An echo of a fallen demigod', m.text);
    P.state = 'free'; this.setState('playing'); Input.lock();
  },
  takeApple(ap) {
    const P = G.player;
    G.flags[ap.id] = true;
    P.maxFlasks++; P.flasks++;
    const m = this.appleMeshes[ap.id];
    if (m) m.visible = false;
    FX.sparks(ap.pos, new THREE.Vector3(0, 1, 0), 50, [2.6, 1.9, 0.6, 1], 4);
    Sound.pickup();
    UI.toast('Golden Apple of the Hesperides · <b>Ambrosia +1</b>');
    this.save();
  },
  async talkHermes() {
    const P = G.player;
    this.setState('menu'); P.state = 'locked'; Input.unlock();
    const done = G.flags.bossDefeated;
    // each spoken line is written out in its own hermes call so tools/make_voices.py can record it
    const hermes = (text, choices) => UI.dialog('Hermes', text, choices);
    const topics = [['place', 'What is this place?'], ['kronos', 'Tell me about Kronos.'], ['stronger', 'How do I get stronger?'],
      ...(G.flags.mirrorSeen ? [['mirror', 'Why do I look like Ares?']] : []),
      [done ? 'now' : 'ares', done ? 'What happens now?' : 'Any advice for fighting Ares?'], ['bye', 'Farewell.']];
    const choices = topics.map((t) => t[1]);
    let k = done
      ? await hermes('You actually did it! Ares is himself again — well, as pleasant as Ares ever gets.', choices)
      : await hermes('Need something, Heir of Thunder? Be quick, I have fourteen deliveries and a very angry centaur waiting.', choices);
    while (topics[k][0] !== 'bye') {
      const id = topics[k][0];
      if (id === 'place') {
        await hermes('Elysia. When Kronos shattered Olympus, the pieces fell here — temples, heroes, whole fields of gold. The realm remembers everyone who walked it.');
        await hermes('Those glowing sigils on the ground? Echoes of demigods who came before you. Read them. Some are even helpful.');
      } else if (id === 'kronos') {
        await hermes('The Titan of time. Father of Zeus — your grandfather, if you want to make family dinners awkward.');
        await hermes('He devoured his own children once. Now he devours their divinity instead. Every spark he steals makes him stronger.');
        await hermes('Even Hades. You should have seen him at court — crowned, proud, impossible. The rot burned all of that away. What rules the underworld now only wears his name.');
      } else if (id === 'stronger') {
        await hermes('Kill shades and you collect their Ichor — the golden blood of the divine. Offer it at an Altar of Hestia to grow stronger.');
        await hermes('And find the golden apples of the Hesperides. Each one lets you carry another draught of Ambrosia.');
      } else if (id === 'mirror' && done) {
        await hermes('Because a piece of him lives in you — and now he has given it freely. The shard is yours, Ariel. The face, the strength, all of it.');
        await hermes('He will still call you little thief, I imagine. From Ares, that is practically a hug.');
      } else if (id === 'mirror') {
        await hermes('Because a piece of him lives in you. The shard your father sealed in your cradle shaped you in its own image — armour, face and all.');
        await hermes('And while the rot holds him, it is a leash. Free him, and it becomes a gift. Until then, when the world goes red, fight him.');
      } else if (done) {
        await hermes('Athena waits in the Library of Ash, and Poseidon has drowned an entire coast in his grief. Eleven sparks remain.');
        await hermes('For now, rest. Explore. Even heroes need to finish their chemistry homework.');
      } else {
        await hermes('He swings wide — roll through his blade, toward him, not away. When he lifts that sword to the sky, run. Far.');
        await hermes('And when he leaps, watch where he lands. Then do not be there.');
      }
      k = await hermes('Anything else?', choices);
    }
    if (done) await hermes('Until the next spark, cousin. Er — half-brother. It is complicated.');
    else await hermes('May your father\'s thunder guide your hand.');
    P.state = 'free'; this.setState('playing'); Input.lock();
  },
  /**
   * The war-shard wakes (SCRIPTS.mirror): once, on the road to Ares, when Ariel is out of danger.
   * While a fight is still on it waits, and looks again a moment later.
   */
  maybeMirror(tries = 0) {
    const P = G.player;
    if (G.flags.mirrorSeen || G.flags.bossDefeated || G.arenaLock || Cutscene.active) return;
    const threat = G.enemies.some((e) => e.alive && e !== G.boss && e.root.visible && (e.state === 'chase' || e.state === 'attack' || e.state === 'alert') && e.pos.distanceTo(P.pos) < 15);
    if (G.state !== 'playing' || P.state !== 'free' || !P.alive || threat) {
      if (tries < 60) setTimeout(() => this.maybeMirror(tries + 1), 1500);
      return;
    }
    Cutscene.play('mirror');
  },
  async enterBoss() {
    if (G.flags.bossDefeated) return;
    // nobody meets Ares without first learning what he is to them
    if (!G.flags.mirrorSeen) { this.maybeMirror(); return; }
    const P = G.player;
    P.state = 'locked';
    Sound.gate();
    await UI.fade(1, 0.8);
    Cutscene.play('bossIntro');
  },

  /* ---------------------------------------------------------- combat events */
  onEnemyKilled(e) {
    const P = G.player;
    P.ichor += e.def.ichor;
    UI.ichorGain();
    UI.log('combat', `${e.name || e.def.name} slain · <b>+${e.def.ichor.toLocaleString()}</b> Ichor`);
    if (e === G.cyclops) {
      G.flags.cyclopsDead = true;
      setTimeout(() => {
        UI.bossHide();
        UI.banner('GREAT FOE VANQUISHED');
        Sound.victory();
        const ap = { id: 'apple_cyclops', pos: e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)) };
        if (!G.flags[ap.id]) {
          World.apples.push(ap);
          this.makeApple(ap);
          G.interactables.push({ pos: ap.pos, r: 2.0, label: () => 'Take the golden apple', cond: () => !G.flags[ap.id], act: () => this.takeApple(ap) });
        }
        Music.play('explore');
        this.save();
      }, 1800);
      // the giant's death echoes through the war-shard: Ares stirs
      setTimeout(() => this.maybeMirror(), 7500);
    }
  },
  onBossDefeated() {
    G.slowMo = 0.3;
    G.arenaLock = false;
    setTimeout(() => {
      G.slowMo = 1;
      UI.bossHide();
      UI.banner('DIVINITY RECLAIMED');
      Sound.victory();
    }, 1600);
    setTimeout(() => Cutscene.play('bossDefeat'), 5600);
  },
  async onPlayerDeath() {
    const P = G.player;
    this.setState('dead');
    if (P.ichor > 0) { G.lostIchor = { x: P.pos.x, z: P.pos.z, y: P.pos.y, amount: P.ichor }; P.ichor = 0; }
    G.slowMo = 0.6;
    await new Promise((r) => setTimeout(r, 1200));
    G.slowMo = 1;
    UI.death();
    G.post.desat = 1;
    await new Promise((r) => setTimeout(r, 4000));
    await UI.fade(1, 1.4);
    G.post.desat = 0;
    // reset the boss fight if we died inside it
    G.arenaLock = false;
    if (!G.flags.bossDefeated) { G.boss.reset(); World.arena.gateActive = true; World.arena.gateCollider.off = false; }
    UI.bossHide();
    this.respawnEnemies();
    Music.intensity = 0;
    const a = World.altars.find((x) => x.id === G.lastAltar);
    if (a) P.respawn(a.pos.x + 1.6, a.pos.z + 1.6, Math.atan2(-1.6, -1.6));
    else P.respawn(World.sites.start.x, World.sites.start.z - 20, Math.PI);
    this.save();
    Music.play('none');
    await this.startPlay({ fadeIn: true });
  },

  /* ---------------------------------------------------------- saving */
  hasSave() { try { return !!localStorage.getItem('ariel_save'); } catch (e) { return false; } },
  wipeSave() { try { localStorage.removeItem('ariel_save'); } catch (e) { /* ignore */ } },
  save() {
    const P = G.player;
    const d = {
      v: 1, stats: P.stats, ichor: P.ichor, maxFlasks: P.maxFlasks, flags: G.flags, lastAltar: G.lastAltar || null,
      lost: G.lostIchor || null, altars: World.altars.filter((a) => a.lit).map((a) => a.id),
    };
    try { localStorage.setItem('ariel_save', JSON.stringify(d)); } catch (e) { /* storage unavailable */ }
  },
  load() {
    try { this.saveData = JSON.parse(localStorage.getItem('ariel_save') || 'null'); } catch (e) { this.saveData = null; }
  },
  applySaveState() {
    const d = this.saveData;
    if (!d) return;
    const P = G.player;
    Object.assign(P.stats, d.stats);
    P.ichor = d.ichor || 0;
    P.maxFlasks = d.maxFlasks || 4;
    P.derive();
    G.flags = d.flags || {};
    G.lastAltar = d.lastAltar;
    G.lostIchor = d.lost;
    World.altars.forEach((a) => { a.lit = (d.altars || []).includes(a.id); });
    for (const k in this.appleMeshes) if (G.flags[k]) this.appleMeshes[k].visible = false;
    if (G.flags.cyclopsDead && G.cyclops) {
      G.cyclops.alive = false; G.cyclops.root.visible = false; G.cyclops.dissolved = true;
      const ap = { id: 'apple_cyclops', pos: G.cyclops.home.clone().add(new THREE.Vector3(0, 0.6, 0)) };
      if (!G.flags[ap.id] && !World.apples.some((a) => a.id === ap.id)) {
        World.apples.push(ap);
        this.makeApple(ap);
        G.interactables.push({ pos: ap.pos, r: 2.0, label: () => 'Take the golden apple', cond: () => !G.flags[ap.id], act: () => this.takeApple(ap) });
      }
    }
    if (G.flags.bossDefeated) {
      G.boss.alive = false; G.boss.root.visible = false; if (G.boss.cape) G.boss.cape.mesh.visible = false;
      World.arena.gateActive = false; World.arena.gate.visible = false; World.arena.gateCollider.off = true;
      const R = World.arena;
      G.hermes.place(R.x + 3, R.z - 8, Math.PI);
    } else {
      G.hermes.place(World.sites.start.x + 3.4, World.sites.start.z - 21, -2.4);
    }
    G.hermes.pos.y = World.getHeight(G.hermes.pos.x, G.hermes.pos.z, G.hermes.pos.y + 10);
  },

  /* ---------------------------------------------------------- quality */
  /** the highest pixel ratio each preset may use (before the render scale) */
  prCap(q = G.settings.quality) { return Math.min(devicePixelRatio, { low: 1, medium: 1.5, high: 1.75, ultra: 2 }[q] || 1); },
  applyQuality(initial = false) {
    const q = G.settings.quality, R = G.renderer;
    this.renderScale = clamp(this.renderScale || 1, 0.75, 1);
    const pr = this.prCap(q) * this.renderScale;
    R.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    // multisampled half-float buffers are very slow on integrated graphics: FXAA there, MSAA on the top presets
    const msaa = q === 'high' || q === 'ultra';
    const samples = msaa ? 4 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); }
    }
    this.fxaa.enabled = !msaa;
    const shed = this.shed || [];
    this.bloom.enabled = q !== 'low' && !shed.includes('bloom');
    this.ao.enabled = q !== 'low' && !shed.includes('ao');
    // soft shadow filtering samples the shadow map many times per pixel: plain PCF below High
    const st = msaa ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (R.shadowMap.type !== st) {
      R.shadowMap.type = st;
      for (const s of [G.scene, School.scene, Prologue.olympus, Prologue.tartarus]) if (s) s.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
      });
    }
    if (!initial || q !== 'high') World.setQuality(q);
    this.resize();
  },
  resize() {
    const w = innerWidth, h = innerHeight;
    G.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    G.camera.aspect = w / h;
    G.camera.updateProjectionMatrix();
    const pr = G.renderer.getPixelRatio();
    FX.resize(h * pr, G.camera.fov);
    World.motes.material.uniforms.uScale.value = (h * pr) / (2 * Math.tan((G.camera.fov * DEG) / 2));
    this.final.uniforms.uRes.value.set(w * pr, h * pr);
    this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    // bloom is soft by nature: on the lighter presets it runs at half resolution
    if (G.settings.quality !== 'high' && G.settings.quality !== 'ultra') this.bloom.setSize(w * pr * 0.5, h * pr * 0.5);
    // below screen resolution, sharpen what's left
    const native = devicePixelRatio;
    this.final.uniforms.uSharp.value = pr < native * 0.95 ? clamp((native / pr - 1) * 0.5, 0.12, 0.35) : 0;
  },

  /**
   * Prepare every shader a scene will ever need, so nothing compiles mid-game: render it once,
   * offscreen, with everything forced visible and unculled (characters that are hidden or far away
   * right now, and every shadow-casting variant), with the effect lights in it as at runtime.
   */
  warm(scene) {
    const R = G.renderer, prev = FX.scene;
    FX.setScene(scene);
    // one of each effect whose materials are made on demand (rings, scorch marks, warnings, lightning)
    try {
      const o = new THREE.Vector3(0, -50, 0);
      FX.ring(o, 1); FX.decal(o, 1, 0.1); FX.telegraph(o, 1, 0.1); FX.bolt(o, o.clone().add(new THREE.Vector3(0, 3, 0)));
    } catch (e) { /* only an optimisation */ }
    // shaders depend on how many lights are on: note which lights shine right now (a light inside a
    // hidden character, like Hermes' glow, doesn't), before forcing everything visible
    const lit = new Set();
    scene.traverseVisible((o) => { if (o.isLight) lit.add(o); });
    const shown = [], unculled = [], lights = [];
    scene.traverse((o) => {
      if (!o.visible) { shown.push(o); o.visible = true; }
      if (o.frustumCulled) { unculled.push(o); o.frustumCulled = false; }
      if (o.isLight) lights.push([o, o.visible]);
    });
    const later = lights.filter(([l]) => !lit.has(l));
    const rt = this._warmRT || (this._warmRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType }));
    const draw = () => {
      try {
        R.setRenderTarget(rt);
        R.shadowMap.needsUpdate = true;
        R.render(scene, G.camera);
      } catch (e) { /* only an optimisation */ }
      R.setRenderTarget(null);
    };
    // with the lights as they are now, then with the ones that come on later too
    later.forEach(([l]) => { l.visible = false; });
    draw();
    if (later.length) { later.forEach(([l]) => { l.visible = true; }); draw(); }
    lights.forEach(([l, v]) => { l.visible = v; });
    shown.forEach((o) => { o.visible = false; });
    unculled.forEach((o) => { o.frustumCulled = true; });
    FX.update(30); // the sample effects expire
    FX.setScene(prev);
  },

  /* ---------------------------------------------------------- loop */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let raw = (now - this.last) / 1000;
    this.last = now;
    raw = Math.min(raw, 0.05);
    let dt = raw;
    if (G.hitStop > 0) { G.hitStop -= raw; dt = raw * 0.08; }
    dt *= G.slowMo;
    G.dt = dt;
    G.time += dt;
    G.uniforms.time.value = G.time;
    this.update(dt, raw);
    this.render(raw);
    Input.endFrame();
    this.autoQuality(raw);
    if (G.settings.showFps) {
      this.fpsAcc = (this.fpsAcc || 0) * 0.95 + raw * 0.05;
      if ((this.fpsT = (this.fpsT || 0) + raw) > 0.5) { this.fpsT = 0; const e = document.getElementById('fps'); e.classList.remove('hidden'); e.textContent = Math.round(1 / this.fpsAcc) + ' fps'; }
    }
  },

  /**
   * Resolution governor: during real play, nudge the render scale so the median frame stays
   * smooth (judged over 8 s, loading hitches don't count). Quality presets are never changed here.
   */
  autoQuality(raw) {
    if (G.state !== 'playing' || document.hidden) { if (this.aq) this.aq.warm = 0; return; }
    const a = (this.aq = this.aq || { t: 0, warm: 0, frames: [], first: true });
    if ((a.warm += raw) < 3) return;
    a.t += raw; a.frames.push(raw);
    if (a.t < (a.first ? 4 : 8)) return;
    a.first = false;
    const sorted = a.frames.sort((x, y) => x - y), fps = 1 / sorted[Math.floor(sorted.length / 2)];
    a.t = 0; a.frames = [];
    // too slow: shed the costliest effects first (ambient occlusion, then bloom), and only then resolution, never
    // below three quarters (lower than that the picture turns blocky); fast again: resolution first, then effects
    const shed = (this.shed = this.shed || []);
    let s = this.renderScale;
    if (fps < 40) {
      if (this.ao.enabled && !shed.includes('ao')) { shed.push('ao'); this.applyQuality(); return; }
      if (this.bloom.enabled && !shed.includes('bloom')) { shed.push('bloom'); this.applyQuality(); return; }
      if (s > 0.75) s = Math.max(0.75, s - (fps < 28 ? 0.12 : 0.06));
    } else if (fps > 58) {
      if (s < 1) s = Math.min(1, s + 0.06);
      else if (shed.length && fps > 64) { shed.pop(); this.applyQuality(); return; }
    }
    if (s !== this.renderScale) { this.renderScale = s; this.applyQuality(); }
  },

  update(dt, raw) {
    const P = G.player, st = G.state;
    if (st === 'title') {
      this.titleT += raw;
      const t = this.titleT * 0.035, S = World.sites.start;
      G.camera.position.set(S.x - 34 + Math.sin(t) * 14, S.fy + 14 + Math.sin(t * 0.7) * 3, S.z - 6 + Math.cos(t) * 10);
      G.camera.lookAt(S.x + 40, S.fy + 30, S.z - 300);
      World.update(dt, G.camera, null);
      G.hermes.update(dt);
      if (Input.pressed('Escape') && UI.panels.length) UI.back();
    } else if (st === 'cutscene') {
      Cutscene.update(raw);
      const life = Life.stageOf(G.activeScene);
      if (G.activeScene === School.scene) School.update(dt);
      else if (Prologue.built && (G.activeScene === Prologue.olympus || G.activeScene === Prologue.tartarus)) Prologue.update(dt);
      else if (life) life.update(dt);
      else this.updateWorld(dt, false);
    } else if (st === 'playing') {
      if (Input.pressed('Escape')) { this.pause(); }
      else {
        if (!Input.locked && !Input.lockFailed && Input.clicked(0)) { Input.lock(); Input.mhit = {}; }
        this.updateWorld(dt, true);
        // interaction prompt
        const it = P.state === 'free' && !P.grip ? this.nearestInteractable() : null;
        const g = P.grip;
        UI.prompt(g ? `Ares has hold of you · mash <kbd>Space</kbd> to break free&nbsp; ${'◆'.repeat(g.got)}${'◇'.repeat(Math.max(0, g.need - g.got))}`
          : it ? `<kbd>E</kbd>${it.label()}` : null);
        this.checkAreas();
        this.updateFieldBoss();
        this.updateLostIchor();
      }
    } else if (st === 'menu') {
      this.updateWorld(dt, false);
      if (Input.pressed('Escape') && UI.panels.length) {
        if (UI.panels.length === 1 && UI.panels[0] === 'altar') this.leaveAltar();
        else UI.back();
      }
    } else if (st === 'dead') {
      this.updateWorld(dt, true);
    } else if (st === 'paused') {
      if (Input.pressed('Escape')) { if (UI.panels.length > 1) UI.back(); else this.resume(); }
    }
    FX.update(st === 'paused' ? 0 : dt);
    UI.update(raw);
    G.post.damage = Math.max(0, G.post.damage - raw * 1.6);
    const lowHp = P && P.alive && G.state === 'playing' ? smooth(0.3, 0.1, P.hp / P.maxHp) * 0.35 : 0;
    // while Ares has hold of Ariel, the edges of the world throb red with his heartbeat
    const possess = G.post.possess ? G.post.possess * (0.75 + 0.25 * Math.sin(G.time * 6.6)) : 0;
    this.final.uniforms.uDamage.value = Math.max(G.post.damage * 0.8, lowHp + Math.sin(G.time * 5) * lowHp * 0.3, possess);
    // (desat: true or 1 for the full grey of a vision, a fraction for less)
    this.final.uniforms.uDesat.value = damp(this.final.uniforms.uDesat.value, G.post.desat ? 0.85 * Math.min(1, +G.post.desat) : 0, 2, raw);
    this.final.uniforms.uTime.value = G.time;
    this.gradeFor(G.activeScene);
    // Berserker God Mode: the world runs warm and a little more vivid around him
    const gk = P && G.activeScene === G.scene ? P.glowK || 0 : 0;
    if (gk > 0.01) {
      const U = this.final.uniforms;
      U.uTint.value.lerp(this._godTint || (this._godTint = new THREE.Vector3(1.1, 0.97, 0.86)), gk * 0.55);
      U.uSat.value += gk * 0.12;
    }
  },

  /**
   * Each stage is graded and exposed for its own light: the rainy night roof needs more, golden Olympus
   * less, and Anna's memory of the pier is an old photograph: faded, warm, soft at the edges.
   */
  gradeFor(sc) {
    const U = this.final.uniforms;
    // one filmic look everywhere (the split-tone and contrast in FinalShader): the modern-day scenes keep only a gentle tint
    if (sc === School.scene) { U.uTint.value.set(0.97, 1.0, 1.05); U.uSat.value = 0.8; }
    else if (sc === Memory.scene) { U.uTint.value.set(1.1, 0.98, 0.82); U.uSat.value = 0.4; }
    else if (sc === Home.scene) { U.uTint.value.set(1.02, 1.0, 0.97); U.uSat.value = 0.8; }
    else if (sc === Campus.scene) { U.uTint.value.set(0.99, 1.0, 1.02); U.uSat.value = 0.8; }
    else { U.uTint.value.set(1, 1, 1); U.uSat.value = 0.8; }
    U.uVignette.value = sc === Memory.scene ? 1.6 : 1.15;
    // a remembered moment (Jesse's flashbacks): cold, faded, closed in at the edges, whatever the stage
    if (G.flashback) { U.uTint.value.set(0.9, 0.97, 1.1); U.uSat.value = 0.16; U.uVignette.value = 1.85; }
    G.renderer.toneMappingExposure = sc === School.scene ? 1.25 : sc === Prologue.olympus ? 0.74 : sc === Prologue.tartarus ? 1.05
      : sc === Home.scene ? 1.05 : sc === Memory.scene ? 1.2 : sc === Campus.scene ? 1.15 : 0.9;
  },

  updateWorld(dt, cameraFollow) {
    const P = G.player;
    P.update(dt);
    // (while the gods speak to Ariel in God Mode's cutscene, the fight holds its breath)
    if (!G.freezeFoes) for (const e of G.enemies) e.update(dt);
    G.hermes.update(dt);
    if (G.state === 'playing') G.echo.update(dt);
    if (cameraFollow) G.cam.update(Math.min(0.05, dt / Math.max(0.05, G.slowMo)), P);
    World.update(dt, G.camera, P.pos);
    // golden apple shimmer
    for (const k in this.appleMeshes) {
      const m = this.appleMeshes[k];
      if (!m.visible) continue;
      m.rotation.y += dt;
      m.position.y = World.apples.find((a) => a.id === k).pos.y + Math.sin(G.time * 2) * 0.08;
      if (Math.random() < 0.3 && m.position.distanceTo(G.camera.position) < 60) FX.glow.spawn({ x: m.position.x + rand(-0.4, 0.4), y: m.position.y + rand(-0.3, 0.3), z: m.position.z + rand(-0.4, 0.4), vy: rand(0.2, 0.8), life: 1.4, s: 0.08, s2: 0.01, c: [2.6, 1.9, 0.6, 1], c2: [2, 1.2, 0.3, 0] });
    }
  },
  checkAreas() {
    const P = G.player;
    for (const a of World.areas) {
      const k = 'area_' + a.name;
      if (G.flags[k]) continue;
      if (Math.hypot(a.x - P.pos.x, a.z - P.pos.z) < a.r * 0.75) {
        G.flags[k] = true;
        UI.area(a.name);
        if (a.name === 'The Ascent of War') setTimeout(() => this.maybeMirror(), 4000);
        break;
      }
    }
  },
  updateFieldBoss() {
    const C = G.cyclops, P = G.player;
    if (!C) return;
    const d = C.pos.distanceTo(P.pos);
    if (C.alive && C.aggro && C.state !== 'return' && d < 32) {
      if (UI.bossState.enemy !== C) { UI.bossShow(C); Music.play('boss'); }
    } else if (UI.bossState.enemy === C && (!C.aggro || C.state === 'return' || d > 48)) {
      UI.bossHide();
      Music.play('explore');
    }
  },
  updateLostIchor() {
    const L = G.lostIchor, P = G.player;
    this.lostMesh.visible = !!L;
    if (!L) return;
    this.lostMesh.position.set(L.x, World.getHeight(L.x, L.z, L.y + 1) + 0.6 + Math.sin(G.time * 2) * 0.1, L.z);
    if (Math.random() < 0.4) FX.glow.spawn({ x: L.x + rand(-0.3, 0.3), y: this.lostMesh.position.y, z: L.z + rand(-0.3, 0.3), vy: rand(0.5, 1.5), life: 1.2, s: 0.08, s2: 0.01, c: [2.6, 1.9, 0.6, 1], c2: [2, 1.2, 0.3, 0] });
    if (Math.hypot(L.x - P.pos.x, L.z - P.pos.z) < 1.6 && P.alive) {
      P.ichor += L.amount;
      UI.toast(`Reclaimed <b>${L.amount.toLocaleString()}</b> Ichor`);
      UI.ichorGain();
      Sound.pickup();
      G.lostIchor = null;
      this.save();
    }
  },

  render() {
    this.composer.render();
  },
};

Game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('error');
  el.innerHTML = '<h3>The world failed to load</h3><p>' + (e && e.message ? e.message : e) + '</p><p class="small">Open the browser console (F12) for details. Make sure your browser supports WebGL 2.</p>';
  el.classList.remove('hidden');
});
