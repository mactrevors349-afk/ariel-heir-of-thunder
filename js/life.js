'use strict';
/* ==========================================================================
   life.js · Ariel's ordinary life, before the lightning:
   the kitchen at home with his mother Anna, the old pier in her memory of
   the night Zeus came, and a grey morning at Westbrook High with Jesse.
   Three small stages; the story itself is told in SCRIPTS.intro.
   ========================================================================== */

const LV = (x, y, z) => new THREE.Vector3(x, y, z);

/** a character on these stages. It walks by moving its root (go), and turns to face (faceTo) */
function lifeActor(scene, key, { x = 0, z = 0, face = 0, size = 1, stance = 'casual' } = {}) {
  let b;
  if (key === 'arielTeen') {
    b = buildAriel({ casual: true });
    b.model = Models.attach(b.rig, 'arielTeen');
    if (b.model) Models.curlFingers(b.model, 26, 10);
  } else {
    b = buildShell({ stance, size, mat: Mat.chiton });
    b.model = Models.attach(b.rig, key, { ownMaterials: key === 'zeus' });
    if (b.model) Models.curlFingers(b.model, 24, 10);
  }
  b.root.position.set(x, 0, z);
  b.root.rotation.y = face;
  scene.add(b.root);
  b.speed = 0; b.walkTo = null; b.turnTo = null; b.queue = [];
  b.go = (tx, tz, speed = 1.25) => { b.walkTo = LV(tx, 0, tz); b.walkSpeed = speed; b.queue = []; };
  /** walk a path of [x, z] points without stopping at the corners */
  b.route = (pts, speed = 1.25) => { b.go(pts[0][0], pts[0][1], speed); b.queue = pts.slice(1).map(([x, z]) => LV(x, 0, z)); };
  b.faceTo = (tx, tz) => { b.turnTo = Math.atan2(tx - b.root.position.x, tz - b.root.position.z); };
  b.arrived = () => !b.walkTo;
  b.update = (dt) => {
    const p = b.root.position;
    if (b.walkTo) {
      const dx = b.walkTo.x - p.x, dz = b.walkTo.z - p.z, d = Math.hypot(dx, dz);
      if (d < (b.queue.length ? 0.25 : 0.04)) { b.walkTo = b.queue.length ? b.queue.shift() : null; }
      else {
        b.root.rotation.y = dampAngle(b.root.rotation.y, Math.atan2(dx, dz), 7, dt);
        // ease in, ease out: full pace in the middle of the walk, slowing into the last half metre
        b.speed = damp(b.speed, b.queue.length ? b.walkSpeed : Math.min(b.walkSpeed, d * 2.4 + 0.15), 5, dt);
        const step = Math.min(d, b.speed * dt);
        p.x += (dx / d) * step; p.z += (dz / d) * step;
      }
    }
    if (!b.walkTo) {
      b.speed = damp(b.speed, 0, 7, dt);
      if (b.turnTo !== null) {
        b.root.rotation.y = dampAngle(b.root.rotation.y, b.turnTo, 4.5, dt);
        if (Math.abs(wrapAngle(b.root.rotation.y - b.turnTo)) < 0.01) b.turnTo = null;
      }
    }
    b.rig.update(dt, b.speed < 0.05 ? 0 : b.speed, 1);
    if (b.model) b.model.update();
  };
  return b;
}

/**
 * Jesse: a full character (rigged like Anna), her phone in her right hand.
 * texting(on) raises it and bows her head over it; look(yaw, pitch) turns her head (radians: + yaw to her
 * left, - pitch lifts her eyes)
 */
function lifeJesse(scene, opts) {
  const J = lifeActor(scene, 'jesse', opts);
  const phone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.15, 0.009), new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.3, metalness: 0.6 }));
  J.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.136), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.7, 0.95) }));
  J.screen.position.z = 0.0048;
  phone.add(body, J.screen);
  scene.add(phone);
  J.phone = phone;
  const hold = lifeHold(J, phone);
  J.t = { yaw: 0, pitch: 0 };
  J.look = (yaw = 0, pitch = 0) => { J.t.yaw = yaw; J.t.pitch = pitch; };
  // texting: the motion-captured clip (both thumbs on the screen, head bowed over it), the phone between her hands
  J.texting = (on) => {
    hold.both = on;
    if (on) J.rig.play(CLIPS.texting ? 'texting' : 'phone', { fade: 0.6 }); else J.rig.stop(0.6);
  };
  /** the screen goes dark (his luck with anything electric) */
  J.phoneDies = () => { J.screen.material.color.setRGB(0.02, 0.02, 0.025); FX.sparks(J.screen.getWorldPosition(new THREE.Vector3()), null, 6, [1.4, 1.9, 3.4, 1], 1.2); };
  const base = J.update;
  J.update = (dt) => {
    J.rig.headYaw = damp(J.rig.headYaw, J.t.yaw, 3.5, dt);
    J.rig.headPitch = damp(J.rig.headPitch, J.t.pitch, 3.5, dt);
    base(dt);
    hold.place(dt);
  };
  return J;
}

/**
 * Something held, placed every frame from the hands themselves (the sculpts have no finger bones to
 * close on it): resting on the right palm along the fingers, or (both) held between the two palms,
 * either turned to the eyes (a phone) or kept upright (a mug). Moving between the two is eased.
 */
function lifeHold(A, obj, { upright = false } = {}) {
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), up = LV(0, 1, 0);
  const H = { obj, both: false, k: 0 };
  const hand = (S) => {
    const j = A.rig.j['hand' + S];
    j.getWorldQuaternion(q);
    return { p: j.getWorldPosition(LV(0, 0, 0)), f: LV(0, -1, 0).applyQuaternion(q), n: LV(S === 'R' ? 1 : -1, 0, 0).applyQuaternion(q) };
  };
  H.place = (dt) => {
    H.k = damp(H.k, H.both ? 1 : 0, 4, dt);
    const L = hand('L'), R = hand('R'), s = A.root.scale.x;
    // on the right palm: its back on the palm, along the fingers
    const c1 = R.p.clone().addScaledVector(R.f, 0.075 * s).addScaledVector(R.n, 0.016 * s);
    // between the palms
    const c2 = L.p.clone().addScaledVector(L.f, 0.07 * s).add(R.p.clone().addScaledVector(R.f, 0.07 * s)).multiplyScalar(0.5);
    let z2, y2;
    if (upright) { y2 = up.clone(); z2 = L.f.clone().add(R.f).setY(0).normalize(); c2.y += 0.01 * s; }
    else { z2 = A.rig.j.head.getWorldPosition(LV(0, 0, 0)).add(LV(0, 0.06 * s, 0)).sub(c2).normalize(); y2 = L.f.clone().add(R.f).normalize(); c2.y += 0.015 * s; }
    const k = H.k * H.k * (3 - 2 * H.k);
    const Z = (upright ? R.f.clone().setY(0).normalize() : R.n.clone()).lerp(z2, k).normalize();
    const Y = (upright ? up.clone() : R.f.clone()).lerp(y2, k);
    Y.sub(Z.clone().multiplyScalar(Y.dot(Z))).normalize();
    obj.quaternion.setFromRotationMatrix(m.makeBasis(LV(0, 0, 0).crossVectors(Y, Z), Y, Z));
    obj.position.copy(c1.lerp(c2, k));
  };
  return H;
}

/**
 * newborn Ariel, asleep, wrapped from the chest down in a soft knitted blanket
 * (model frame: head +Y, face +Z, centred on his middle; 34 cm curled up)
 */
function lifeBaby() {
  const g = new THREE.Group();
  const baby = Models.has('baby') ? Models.instance('baby') : null;
  if (baby) g.add(baby);
  g.add(lifeSwaddle(baby));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/**
 * The blanket he is swaddled in, wrapped round the baby model itself: a shell whose radius in each
 * direction (from the middle of his body) follows the outermost point of him there, dilated and
 * smoothed so it bridges the gaps the way cloth does, plus the blanket's thickness. It is open over
 * his face, hooded over his head, with diagonal folds from the wrapping and a rolled edge.
 */
function lifeSwaddle(baby, { C = LV(0, -0.03, -0.01), axis = LV(0.05, 0.85, 0.52), cap = 0.6, thick = 0.017 } = {}) {
  const Q = new THREE.Quaternion().setFromUnitVectors(LV(0, 1, 0), axis.clone().normalize()), Qi = Q.clone().invert();
  const W = 72, FH = 48, Hs = 40, env = new Float32Array((W + 1) * (FH + 1));
  const at = (iu, iv) => ((iu % W) + W) % W + Math.min(FH, Math.max(0, iv)) * (W + 1);
  // the envelope: the farthest point of his body in each direction
  if (baby) {
    baby.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    baby.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).sub(C).applyQuaternion(Qi);
        const r = v.length(), th = Math.acos(Math.max(-1, Math.min(1, v.y / r)));
        let ph = Math.atan2(v.z, -v.x); if (ph < 0) ph += TAU;
        const k = at(Math.round((ph / TAU) * W), Math.round((th / Math.PI) * FH));
        if (r > env[k]) env[k] = r;
      }
    });
  }
  const pass = (fn) => { const src = env.slice(); for (let iv = 0; iv <= FH; iv++) for (let iu = 0; iu < W; iu++) { const n = []; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n.push(src[at(iu + a, iv + b)]); env[at(iu, iv)] = fn(n, src[at(iu, iv)]); } };
  for (let k = 0; k < 2; k++) pass((n) => Math.max(...n));                                                          // bridge the gaps
  for (let k = 0; k < 8; k++) pass((n, c) => (c ? n.filter((x) => x > 0).reduce((s, x) => s + x, 0) / Math.max(1, n.filter((x) => x > 0).length) : Math.max(...n)));
  for (let k = 0; k < 4; k++) pass((n) => n.reduce((s, x) => s + x, 0) / 9);                                      // and soften
  // every direction at a pole is the same point: one radius there, or the cloth puckers
  for (const iv of [0, 1, FH - 1, FH]) { let s = 0; for (let iu = 0; iu < W; iu++) s += env[at(iu, iv)]; for (let iu = 0; iu < W; iu++) env[at(iu, iv)] = s / W; }
  const look = (ph, th) => {
    const u = (ph / TAU) * W, w = (th / Math.PI) * FH, iu = Math.floor(u), iv = Math.floor(w), fu = u - iu, fv = w - iv;
    const a = env[at(iu, iv)], b = env[at(iu + 1, iv)], c = env[at(iu, iv + 1)], d = env[at(iu + 1, iv + 1)];
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv || 0.09;
  };
  // the shell, open over his face
  const geo = new THREE.SphereGeometry(1, W, Hs, 0, TAU, cap, Math.PI - cap), P = geo.attributes.position, dir = new THREE.Vector3();
  const rim = [];
  for (let iy = 0; iy <= Hs; iy++) for (let ix = 0; ix <= W; ix++) {
    const i = iy * (W + 1) + ix, ph = (ix / W) * TAU, th = cap + (iy / Hs) * (Math.PI - cap);
    // the folds of the wrap run round him on a slant; they fade out toward the open edge
    const fold = (0.007 * Math.sin(ph * 3 + th * 6) + 0.003 * Math.sin(ph * 7 - th * 4) + 0.002 * Math.sin(ph * 13 + th * 9)) * Math.min(1, (th - cap) * 4) * Math.sin(th);
    dir.fromBufferAttribute(P, i).normalize();
    const p = dir.clone().multiplyScalar(look(ph, th) + thick + fold).applyQuaternion(Q).add(C);
    P.setXYZ(i, p.x, p.y, p.z);
  }
  // the opening's edge is cloth pulled taut round his face: smooth its first rows along the rim, so it
  // runs in an even curve instead of following every bump of his head
  for (let iy = 0; iy < 4; iy++) {
    const row = [], k = 5 - iy;
    for (let ix = 0; ix < W; ix++) row.push(LV(P.getX(iy * (W + 1) + ix), P.getY(iy * (W + 1) + ix), P.getZ(iy * (W + 1) + ix)));
    for (let ix = 0; ix <= W; ix++) {
      const s = LV(0, 0, 0);
      for (let o = -k; o <= k; o++) s.add(row[(ix + o + W * 2) % W]);
      s.divideScalar(2 * k + 1);
      P.setXYZ(iy * (W + 1) + ix, s.x, s.y, s.z);
      if (iy === 0 && ix < W) rim.push(s);
    }
  }
  geo.computeVertexNormals();
  const N = geo.attributes.normal;
  for (let iy = 0; iy <= Hs; iy++) {   // close the normal seam where the sphere's ends meet
    const a = iy * (W + 1), b = a + W, n = LV(N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)).normalize();
    N.setXYZ(a, n.x, n.y, n.z); N.setXYZ(b, n.x, n.y, n.z);
  }
  const tex = (t, r) => { if (!t) return null; const c = t.clone(); c.repeat.set(r[0], r[1]); c.needsUpdate = true; return c; };
  // a cream knit: the photographed fleece's relief, without its brown dye
  const F = Tex.fleece;
  const cloth = new THREE.MeshStandardMaterial({ color: 0xc9c0b0, side: THREE.DoubleSide, roughness: 1,
    normalMap: F ? tex(F.normal, [3, 1.6]) : null, normalScale: new THREE.Vector2(1.2, 1.2) });
  const shell = new THREE.Mesh(geo, cloth);
  // the edge, rolled over round his face
  const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim, true), 96, 0.0065, 8, true),
    new THREE.MeshStandardMaterial({ color: 0xc9c0b0, roughness: 1, normalMap: F ? tex(F.normal, [14, 0.3]) : null }));
  const g = new THREE.Group();
  g.add(shell, edge);
  return g;
}

/** the stages share one way of building: photo-textured boxes laid out in metres */
function lifeStage(fog, bg) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(bg);
  s.fog = fog;
  s.environment = G.scene.environment;
  const add = (g, m, x, y, z, ry = 0, shadow = true) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z); o.rotation.y = ry;
    o.castShadow = shadow; o.receiveShadow = true;
    s.add(o); return o;
  };
  return { s, add };
}
const photoMat = (set, opts) => (set ? triplanarMaterial({ map: set.map, normal: set.normal, rough: set.rough, ...opts }) : new THREE.MeshStandardMaterial({ color: opts.color ?? 0x888888, roughness: opts.roughness ?? 0.8 }));

/* ------------------------------------------------------------------ the Stormborn kitchen */
const Home = {
  built: false,
  build() {
    if (this.built) return;
    this.built = true;
    const { s, add } = lifeStage(new THREE.Fog(0x1a1c22, 12, 30), 0x111216);
    this.scene = s;
    const floor = photoMat(Tex.woodFloor, { scale: 0.42, color: 0xb59a7c, roughness: 0.8 });
    const wall = photoMat(Tex.plaster, { scale: 0.45, color: 0xcfc6b8, roughness: 0.95, normalStrength: 0.5 });
    // painted cabinets (soft cream, the brush texture just showing), a pale stone counter
    const cab = photoMat(Tex.plaster, { scale: 1.2, color: 0xeee6d6, roughness: 0.55, normalStrength: 0.25 });
    const top = photoMat(Tex.marble, { scale: 0.6, color: 0xe4ded6, roughness: 0.35 });
    const tableWood = photoMat(Tex.cabinet, { scale: 0.9, color: 0x8a6448, roughness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.28, metalness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.2, metalness: 0.3 });
    const W = 3.6, D = 3.1, H = 2.7;
    // room: floor, ceiling, walls (the back wall is built round the window, the left round the door)
    add(new THREE.BoxGeometry(W * 2, 0.1, D * 2), floor, 0, -0.05, 0);
    add(new THREE.BoxGeometry(W * 2, 0.1, D * 2), white, 0, H + 0.05, 0, 0, false);
    const wx0 = -1.0, wx1 = 1.0, wy0 = 1.05, wy1 = 2.15;
    add(new THREE.BoxGeometry(W + wx0, H, 0.15), wall, (-W + wx0) / 2, H / 2, -D);
    add(new THREE.BoxGeometry(W - wx1, H, 0.15), wall, (W + wx1) / 2, H / 2, -D);
    add(new THREE.BoxGeometry(wx1 - wx0, wy0, 0.15), wall, 0, wy0 / 2, -D);
    add(new THREE.BoxGeometry(wx1 - wx0, H - wy1, 0.15), wall, 0, (H + wy1) / 2, -D);
    add(new THREE.BoxGeometry(W * 2, H, 0.15), wall, 0, H / 2, D);
    add(new THREE.BoxGeometry(0.15, H, D * 2), wall, W, H / 2, 0);
    const dz0 = -0.55, dz1 = 0.45, dh = 2.1;
    add(new THREE.BoxGeometry(0.15, H, D + dz0), wall, -W, H / 2, (-D + dz0) / 2);
    add(new THREE.BoxGeometry(0.15, H, D - dz1), wall, -W, H / 2, (D + dz1) / 2);
    add(new THREE.BoxGeometry(0.15, H - dh, dz1 - dz0), wall, -W, (H + dh) / 2, (dz0 + dz1) / 2);
    // the hallway beyond the door: dim, a picture frame catching a little light
    add(new THREE.BoxGeometry(2.4, 0.1, 3.2), floor, -W - 1.2, -0.05, 0);
    add(new THREE.BoxGeometry(0.15, H, 3.2), wall, -W - 2.4, H / 2, 0);
    add(new THREE.BoxGeometry(0.03, 0.5, 0.38), tableWood, -W - 2.31, 1.55, -0.1);
    // window: frame, sill, glass, and the grey morning outside
    const frame = white;
    add(new THREE.BoxGeometry(wx1 - wx0 + 0.12, 0.08, 0.2), frame, 0, wy0 - 0.02, -D + 0.04);
    add(new THREE.BoxGeometry(wx1 - wx0 + 0.12, 0.08, 0.16), frame, 0, wy1 + 0.02, -D);
    for (const x of [wx0 - 0.02, 0, wx1 + 0.02]) add(new THREE.BoxGeometry(0.06, wy1 - wy0, 0.12), frame, x, (wy0 + wy1) / 2, -D);
    add(new THREE.BoxGeometry(wx1 - wx0, wy1 - wy0, 0.01), new THREE.MeshStandardMaterial({ color: 0x9fb0c0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }), 0, (wy0 + wy1) / 2, -D + 0.01, 0, false);
    const sky = Tex.paint(64, (x, y) => { const v = y / 64; return [0.52 - v * 0.2, 0.56 - v * 0.2, 0.62 - v * 0.18]; });
    add(new THREE.PlaneGeometry(14, 7), new THREE.MeshBasicMaterial({ map: sky, fog: false }), 0, 2.2, -D - 5, 0, false);
    // garden fence and wet trees, soft through the rain
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e2a, roughness: 1 });
    add(new THREE.BoxGeometry(14, 1.4, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 }), 0, 0.7, -D - 3.2, 0, false);
    const wetLeaves = leafMaterial([0.85, 0.95, 0.85], { fallback: Tex.leafOlive, wind: 0.05, roughness: 0.55 }), rng = mulberry32(5);
    for (const [x, r] of [[-2.6, 1.3], [2.2, 1.6], [4.5, 1.1]]) {
      add(new THREE.CylinderGeometry(0.08, 0.12, 2.4, 8), dark, x, 1.2, -D - 3.8, 0, false);
      add(leafCrown(rng, { rx: r, ry: r * 0.85, rz: r, n: Math.round(70 * r), size: 0.75 }), wetLeaves, x, 2.6 + r * 0.4, -D - 3.9, 0, false);
    }
    this.rain = lifeRain(s, { x0: -3, x1: 3, z0: -D - 2.5, z1: -D - 0.3, y0: -0.5, y1: 4, n: 600, opacity: 0.25 });
    // counters along the back wall, either side of the sink under the window
    const cy = 0.88, cd = 0.62, cz = -D + 0.08 + cd / 2;
    for (const [x0, x1] of [[-W + 0.08, wx0 - 0.05], [wx0 - 0.05, wx1 + 0.05], [wx1 + 0.05, 2.75]]) {
      add(new THREE.BoxGeometry(x1 - x0, cy - 0.1, cd - 0.04), cab, (x0 + x1) / 2, (cy - 0.1) / 2 + 0.1, cz + 0.02);
      add(new THREE.BoxGeometry(x1 - x0, 0.1, cd - 0.1), black, (x0 + x1) / 2, 0.05, cz - 0.02, 0, false);
      add(new THREE.BoxGeometry(x1 - x0 + 0.02, 0.04, cd + 0.03), top, (x0 + x1) / 2, cy + 0.02, cz + 0.01);
      // door seams and handles
      for (let x = x0 + 0.45; x < x1 - 0.1; x += 0.45) add(new THREE.BoxGeometry(0.008, cy - 0.16, 0.005), black, x, cy / 2 + 0.06, cz + cd / 2 + 0.002, 0, false);
      for (let x = x0 + 0.38; x < x1; x += 0.45) add(new THREE.BoxGeometry(0.012, 0.012, 0.12), steel, x, cy - 0.12, cz + cd / 2 + 0.02, Math.PI / 2, false);
    }
    // sink: steel basin and a tap
    add(new THREE.BoxGeometry(0.62, 0.02, 0.42), steel, 0, cy + 0.035, cz);
    const tap = add(new THREE.TorusGeometry(0.1, 0.012, 8, 16, Math.PI), steel, 0, cy + 0.14, cz - 0.2, 0, false);
    tap.rotation.set(0, Math.PI / 2, 0);
    // upper cabinets either side of the window
    for (const [x0, x1] of [[-W + 0.08, wx0 - 0.25], [wx1 + 0.25, 2.75]]) {
      add(new THREE.BoxGeometry(x1 - x0, 0.72, 0.36), cab, (x0 + x1) / 2, 1.88, -D + 0.26);
      for (let x = x0 + 0.42; x < x1; x += 0.42) add(new THREE.BoxGeometry(0.012, 0.1, 0.012), steel, x - 0.05, 1.62, -D + 0.45, 0, false);
    }
    // fridge in the corner, stove and kettle on the right run
    add(new THREE.BoxGeometry(0.78, 1.86, 0.7), steel, W - 0.47, 0.93, -D + 0.45);
    add(new THREE.BoxGeometry(0.02, 1.0, 0.03), black, W - 0.82, 1.2, -D + 0.81, 0, false);
    add(new THREE.BoxGeometry(0.6, 0.012, 0.52), black, 1.65, cy + 0.045, cz);
    const kettle = add(new THREE.CylinderGeometry(0.075, 0.095, 0.19, 18), steel, 1.5, cy + 0.15, cz - 0.05);
    add(new THREE.TorusGeometry(0.06, 0.01, 6, 14, Math.PI), black, 1.5, cy + 0.25, cz - 0.05, 0, false);
    this.kettle = kettle;
    // coffee maker, mugs, the toaster that is about to spark, a bowl of fruit
    add(new THREE.BoxGeometry(0.22, 0.34, 0.26), black, -1.6, cy + 0.19, cz - 0.08);
    this.toaster = add(new THREE.BoxGeometry(0.28, 0.18, 0.16), steel, -2.4, cy + 0.11, cz - 0.02);
    const mug = (x, z, col) => {
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 });
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.1, 16), mat));
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.007, 6, 12), mat);
      handle.position.x = 0.05; handle.rotation.x = Math.PI / 2;
      const coffee = new THREE.Mesh(new THREE.CircleGeometry(0.037, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1508, roughness: 0.15 }));
      coffee.position.y = 0.04;
      g.add(handle, coffee);
      g.position.set(x, cy + 0.07, z);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      s.add(g);
      return g;
    };
    mug(-1.3, cz + 0.12, 0x6a8fa8);
    // her coffee: in her hands through the morning (see lifeHold)
    this.mug = mug(-1.15, cz + 0.05, 0xd8cfc2);
    const bowl = add(new THREE.SphereGeometry(0.15, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2), white, -2.9, cy + 0.17, cz, 0, false);
    bowl.scale.y = 0.55;
    for (const [dx, col] of [[0, 0xc8402a], [0.07, 0xd8a43a], [-0.06, 0x8aa83a]]) add(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }), -2.9 + dx, cy + 0.15, cz + (dx ? 0.03 : -0.02), 0, false);
    // table and chairs under the pendant
    const tx = 0.75, tz = 0.75;
    this.table = LV(tx, 0, tz);
    add(new THREE.CylinderGeometry(0.58, 0.58, 0.04, 40), tableWood, tx, 0.76, tz);
    add(new THREE.CylinderGeometry(0.05, 0.07, 0.72, 12), tableWood, tx, 0.37, tz);
    add(new THREE.CylinderGeometry(0.3, 0.32, 0.03, 24), tableWood, tx, 0.015, tz);
    const chair = (x, z, ry) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.add(g);
      const p = (geo, px, py, pz) => { const m = new THREE.Mesh(geo, tableWood); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); };
      p(new THREE.BoxGeometry(0.42, 0.04, 0.42), 0, 0.46, 0);
      for (const [a, b] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) p(new THREE.BoxGeometry(0.035, 0.46, 0.035), a, 0.23, b);
      for (const a of [-0.18, 0.18]) p(new THREE.BoxGeometry(0.035, 0.5, 0.035), a, 0.72, -0.19);
      p(new THREE.BoxGeometry(0.4, 0.12, 0.025), 0, 0.88, -0.19);
    };
    chair(tx - 0.72, tz + 0.1, Math.PI / 2 + 0.2);
    chair(tx + 0.7, tz - 0.15, -Math.PI / 2 - 0.3);
    // breakfast: a plate of toast, a glass of orange juice
    add(new THREE.CylinderGeometry(0.12, 0.1, 0.015, 24), white, tx - 0.25, 0.79, tz + 0.12, 0, false);
    add(new THREE.BoxGeometry(0.1, 0.012, 0.1), new THREE.MeshStandardMaterial({ color: 0xc8904a, roughness: 0.9 }), tx - 0.25, 0.804, tz + 0.12, 0.4, false);
    add(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 14), new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.15, transparent: true, opacity: 0.85 }), tx - 0.1, 0.84, tz + 0.25, 0, false);
    // the pendant lamp: warm, and the one thing in the house that reacts to his moods
    add(new THREE.CylinderGeometry(0.004, 0.004, 0.55, 4), black, tx, H - 0.28, tz, 0, false);
    add(new THREE.ConeGeometry(0.22, 0.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3a34, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }), tx, H - 0.62, tz, 0, false);
    this.bulb = add(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.6, 2.2) }), tx, H - 0.7, tz, 0, false);
    this.pendant = new THREE.PointLight(0xffc98f, 7, 7, 1.8);
    this.pendant.position.set(tx, H - 0.75, tz);
    this.pendant.castShadow = true;
    this.pendant.shadow.mapSize.set(1024, 1024); this.pendant.shadow.bias = -0.002;
    s.add(this.pendant);
    // cool daylight through the window, and the dim bounce of a grey morning
    const sun = new THREE.DirectionalLight(0xbcc8d8, 1.5);
    sun.position.set(0.8, 3.6, -D - 4); sun.target.position.set(0.3, 0.3, 0.5);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 14 });
    s.add(sun, sun.target);
    s.add(new THREE.HemisphereLight(0x8e98a8, 0x4a3c30, 0.75));
    const hall = new THREE.PointLight(0xffb070, 1.2, 4, 2);
    hall.position.set(-W - 1.2, 2.2, 0.6);
    s.add(hall);
    this.flicker = 0; this.base = 7;
    // the family: Anna at the counter, Ariel about to come in from the hall
    this.anna = lifeActor(s, 'anna', { x: -1.25, z: cz + 0.62, face: Math.PI });
    this.ariel = lifeActor(s, 'arielTeen', { x: -W - 1.4, z: 0, face: Math.PI / 2 });
    // her coffee, held in both hands (see holdMug); set back on the counter when she lets it go
    this.mugRest = this.mug.position.clone();
    this.mugHold = lifeHold(this.anna, this.mug, { upright: true });
    this.mugHold.off = true;
  },
  /** Anna picks up her coffee (both hands round it, the motion-captured arms) or puts it down */
  holdMug(on) {
    const H = this.mugHold, A = this.anna;
    H.off = !on; H.both = on; H.k = on ? 1 : 0;
    if (on) A.rig.play(CLIPS.textingHold ? 'textingHold' : 'offer', { fade: 0.01 });
    else { this.mug.position.copy(this.mugRest); this.mug.quaternion.identity(); }
  },
  /** the lights stutter (his temper, his father's blood) */
  stutter(k = 1) { this.flicker = Math.max(this.flicker, k); },
  update(dt) {
    this.anna.update(dt);
    if (!this.mugHold.off) this.mugHold.place(dt);
    this.ariel.update(dt);
    this.rain.update(dt);
    this.flicker = Math.max(0, this.flicker - dt * 0.8);
    const f = this.flicker > 0 ? (Math.random() < 0.35 ? 0.08 : 0.7 + Math.random() * 0.3) : 1;
    this.pendant.intensity = this.base * f;
    this.bulb.material.color.setRGB(5 * f, 3.6 * f, 2.2 * f);
  },
};

/* ------------------------------------------------------------------ Anna's memory: the pier in the storm */
const Memory = {
  built: false,
  build() {
    if (this.built) return;
    this.built = true;
    const { s, add } = lifeStage(new THREE.FogExp2(0x161a24, 0.03), 0x0d1016);
    this.scene = s;
    const planks = photoMat(Tex.planks, { scale: 0.5, color: 0x8a7a68, roughness: 0.85 });
    const wood = photoMat(Tex.planks, { scale: 0.9, color: 0x5a4c40, roughness: 0.9 });
    const iron = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.7 });
    // the pier runs out to sea along +Z; its deck is y = 0
    const z0 = -26, z1 = 9;
    add(new THREE.BoxGeometry(3.4, 0.14, z1 - z0), planks, 0, -0.07, (z0 + z1) / 2);
    for (let z = z0 + 1; z < z1; z += 3) for (const x of [-1.55, 1.55]) add(new THREE.CylinderGeometry(0.14, 0.16, 3.2, 10), wood, x, -1.6, z, 0, false);
    for (let z = z0 + 0.5; z < z1; z += 1.8) for (const x of [-1.62, 1.62]) add(new THREE.BoxGeometry(0.09, 1.05, 0.09), wood, x, 0.52, z, 0, false);
    for (const x of [-1.62, 1.62]) { add(new THREE.BoxGeometry(0.1, 0.08, z1 - z0), wood, x, 1.05, (z0 + z1) / 2, 0, false); add(new THREE.BoxGeometry(0.06, 0.06, z1 - z0), wood, x, 0.6, (z0 + z1) / 2, 0, false); }
    // the lamp at the end, where she used to wait
    const lx = 1.2, lz = 6.4;
    add(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 10), iron, lx, 1.8, lz);
    add(new THREE.BoxGeometry(0.34, 0.42, 0.34), iron, lx, 3.7, lz, 0, false);
    this.lampGlass = add(new THREE.BoxGeometry(0.26, 0.32, 0.26), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 3.0, 1.5) }), lx, 3.68, lz, 0, false);
    this.lamp = new THREE.PointLight(0xffb468, 18, 14, 1.7);
    this.lamp.position.set(lx, 3.45, lz);
    this.lamp.castShadow = true; this.lamp.shadow.mapSize.set(1024, 1024); this.lamp.shadow.bias = -0.002;
    s.add(this.lamp);
    this.lampAt = LV(lx, 0, lz);
    // the sea: dark, heaving, catching the lamp and the lightning
    const waterN = Tex.waterN.clone(); waterN.needsUpdate = true; waterN.wrapS = waterN.wrapT = THREE.RepeatWrapping; waterN.repeat.set(30, 30);
    this.waterN = waterN;
    add(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.12, metalness: 0.2, normalMap: waterN, normalScale: new THREE.Vector2(0.7, 0.7), envMapIntensity: 0.5 }), 0, -2.6, 0, 0, false);
    // the town behind her: a dark shoreline, a few windows still lit
    const win = Tex.windows(); win.repeat.set(2, 1);
    const town = new THREE.MeshStandardMaterial({ color: 0x0c0d10, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.55, roughness: 1 });
    const rnd = mulberry32(31);
    for (let i = 0; i < 22; i++) { const w = 5 + rnd() * 9, h = 4 + rnd() * 10; add(new THREE.BoxGeometry(w, h, 6), town, -70 + i * 6.6 + rnd() * 3, h / 2 - 2.6, -48 - rnd() * 12, 0, false); }
    add(new THREE.BoxGeometry(220, 2, 40), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 1 }), 0, -2.0, -46, 0, false);
    // storm sky and its lightning
    this.cloudU = { tNoise: { value: Tex.noise }, uTime: G.uniforms.time, uFlash: { value: 0 } };
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.cloudU, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D tNoise; uniform float uTime; uniform float uFlash; varying vec3 vW;
        void main(){
          vec2 uv = vW.xz * 0.0008 + vec2(uTime * 0.006, uTime * 0.002);
          float n = texture2D(tNoise, uv).r * 0.6 + texture2D(tNoise, uv * 3.3).g * 0.4;
          float d = length(vW.xz - cameraPosition.xz);
          vec3 c = mix(vec3(0.03, 0.035, 0.05), vec3(0.13, 0.14, 0.18), n) + vec3(0.65, 0.7, 0.95) * uFlash * n;
          c = mix(c, vec3(0.05, 0.06, 0.08), smoothstep(300.0, 1400.0, d));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    clouds.position.y = 90;
    s.add(clouds);
    this.hemi = new THREE.HemisphereLight(0x5a6688, 0x1a1410, 0.5);
    s.add(this.hemi);
    const moon = new THREE.DirectionalLight(0x8090b8, 0.5);
    moon.position.set(-10, 20, 30); moon.target.position.set(0, 0, 5);
    moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024);
    Object.assign(moon.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 70 });
    s.add(moon, moon.target);
    this.rain = lifeRain(s, { x0: -14, x1: 14, z0: -10, z1: 20, y0: -2.6, y1: 14, n: 2600, opacity: 0.32 });
    // young Anna under the lamp; Zeus, who will come out of the rain; and later, a newborn
    this.anna = lifeActor(s, 'anna', { x: lx - 0.6, z: lz + 0.2, face: 0 });
    this.zeus = lifeActor(s, 'zeus', { x: 0, z: -8, face: 0, size: 1.0 });
    if (this.zeus.model) {
      // the god, seen through her memory: a faint storm-light at his edges
      this.zeus.model.materials && this.zeus.model.materials().forEach((m) => Models.rim(m, [0.45, 0.6, 1.1], 2.8, 0.22));
    }
    this.zeus.root.visible = false;
    // how thick their forearms and hands are above the bone (Zeus wears bracers): where the bundle comes to rest
    // (at: how far along the forearms the bundle sits, so its back rests against their stomach)
    this.anna.hold = { fore: 0.03, palm: 0.016, at: 0.77 };
    this.zeus.hold = { fore: 0.05, palm: 0.022, at: 0.88 };
    this.baby = lifeBaby();
    this.baby.visible = false;
    s.add(this.baby);
  },
  /** lightning over the sea, close or far */
  strike(close = false) {
    const x = rand(-60, 60), z = close ? rand(25, 45) : rand(60, 140);
    FX.bolt(LV(x, 90, z), LV(x + rand(-12, 12), -2.6, z + rand(-8, 8)), { radius: close ? 0.9 : 0.5, branches: close ? 6 : 3, life: 0.45 });
    Sound.thunder(close ? 80 : rand(600, 1400));
    this.cloudU.uFlash.value = close ? 1.8 : 0.9;
    if (close) UI.flash(0.35);
  },
  /** hand the baby to someone: it lies across their forearms, over their upturned hands */
  carry(actor) {
    if (this.carrier && this.carrier !== actor) this.cupHands(this.carrier, false);
    this.carrier = actor;
    this.baby.visible = true;
    this.cupHands(actor, true);
    this.placeBaby();
  },
  /** a carrier with finger bones (Zeus) closes his fingers round the bundle's sides, and opens them again after */
  cupHands(actor, on) {
    const sk = actor.model && actor.model.model && actor.model.model.userData.skeleton;
    if (!sk) return;
    const fingers = actor._fingers || (actor._fingers = sk.bones.filter((b) => /Index|Middle|Ring|Pinky|Thumb/.test(b.name)));
    if (on && !actor._fingerRest) {
      actor._fingerRest = fingers.map((b) => b.quaternion.clone());
      Models.curlFingers(actor.model, 34, 14);
    } else if (!on && actor._fingerRest) {
      fingers.forEach((b, i) => b.quaternion.copy(actor._fingerRest[i]));
      actor._fingerRest = null;
    }
  },
  /** (any carrier and any copy of the bundle: the painted slides of the epilogue hold one too) */
  placeBaby(A = this.carrier, B = this.baby) {
    if (!A) return;
    A.root.updateMatrixWorld(true);
    const J = A.rig.j, wp = (n, k) => J[n].getWorldPosition(this['_' + k] || (this['_' + k] = LV(0, 0, 0)));
    // lying across both forearms, over the upturned hands (so the hands are under him, not beside him),
    // his head to the carrier's left and a little raised, lifted by the bundle's own depth.
    // His face (in its hood of blanket) is turned up and a little out of the arms, as a newborn is shown
    const s = A.size || 1;
    const at = (A.hold && A.hold.at) || 0.8;
    const pL = wp('elbowL', 'eL').lerp(wp('handL', 'hL'), at), pR = wp('elbowR', 'eR').lerp(wp('handR', 'hR'), at);
    const y = A.root.rotation.y, fwd = LV(Math.sin(y), 0, Math.cos(y));
    const across = pL.clone().sub(pR).setY(0).normalize();
    const head = across.clone().add(LV(0, 0.16, 0)).normalize();
    const face = LV(0, 1, 0).addScaledVector(fwd, 0.4).normalize();
    const side = new THREE.Vector3().crossVectors(head, face).normalize();
    face.crossVectors(side, head).normalize();
    B.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, head, face));
    B.position.copy(pL).add(pR).multiplyScalar(0.5).add(LV(0, 0.15 * s, 0)).addScaledVector(across, 0.03 * s);
    this.settleBaby(A, B);
  },
  /** the bundle's underside as a height map in its own frame (x across its width, y head to feet, z out of its face) */
  underside() {
    const B = this.baby, pts = [], v = LV(0, 0, 0);
    B.updateMatrixWorld(true);
    const inv = B.matrixWorld.clone().invert();
    B.traverse((o) => {
      if (!o.isMesh) return;
      const P = o.geometry.attributes.position, m = inv.clone().multiply(o.matrixWorld);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); }
    });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
    const cell = 0.012, nx = Math.ceil((x1 - x0) / cell) + 1, ny = Math.ceil((y1 - y0) / cell) + 1, H = new Float32Array(nx * ny).fill(Infinity);
    for (let i = 0; i < pts.length; i += 3) { const k = Math.floor((pts[i + 1] - y0) / cell) * nx + Math.floor((pts[i] - x0) / cell); H[k] = Math.min(H[k], pts[i + 2]); }
    return (x, y) => {
      const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
      let m = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) m = Math.min(m, H[jj * nx + ii]); }
      return m;
    };
  },
  /**
   * Let the bundle down onto the carrier's forearms and upturned palms: the nearest point of contact is found
   * along both arms, and the bundle settled until it rests there, sunk in a little (a blanket gives), so it is
   * carried, never floating above the hands or cut through by them
   */
  settleBaby(A, B = this.baby) {
    const J = A.rig.j, s = A.size || 1, H = this.under || (this.under = this.underside());
    const R = A.hold || { fore: 0.035, palm: 0.018 };
    B.updateMatrixWorld(true);
    const inv = this._inv || (this._inv = new THREE.Matrix4()); inv.copy(B.matrixWorld).invert();
    const q = this._q || (this._q = new THREE.Quaternion()), e = LV(0, 0, 0), h = LV(0, 0, 0), p = LV(0, 0, 0), up = LV(0, 0, 0), fin = LV(0, 0, 0);
    let gap = Infinity;
    const probe = (r) => { p.addScaledVector(up, r).applyMatrix4(inv); const u = H(p.x, p.y); if (u < Infinity) gap = Math.min(gap, u - p.z); };
    for (const S of ['L', 'R']) {
      J['elbow' + S].getWorldPosition(e); J['hand' + S].getWorldPosition(h); J['hand' + S].getWorldQuaternion(q);
      up.set(S === 'L' ? -1 : 1, 0, 0).applyQuaternion(q);   // the palm's normal (palms are turned up under him)
      if (up.y < 0.3) up.set(0, 1, 0);
      fin.set(0, -1, 0).applyQuaternion(q);
      for (let t = 0.3; t <= 1.001; t += 0.05) { p.copy(e).lerp(h, t); probe(R.fore * s * (1 - 0.3 * t)); }
      for (let t = 0.01; t <= 0.091; t += 0.02) { p.copy(h).addScaledVector(fin, t * s); probe(R.palm * s); }
    }
    if (gap === Infinity) return;
    B.position.addScaledVector(up.set(0, 0, 1).applyQuaternion(B.quaternion), -(gap + 0.02 * s));
  },
  update(dt) {
    this.anna.update(dt);
    if (this.zeus.root.visible) this.zeus.update(dt);
    if (this.baby.visible) this.placeBaby();
    this.rain.update(dt);
    this.waterN.offset.x += dt * 0.012; this.waterN.offset.y += dt * 0.02;
    const f = this.cloudU.uFlash.value = Math.max(0, this.cloudU.uFlash.value - dt * 2.6);
    this.hemi.intensity = 0.5 + f * 2.2;
    this.lamp.intensity = 18 * (Math.random() < 0.02 ? 0.55 : 1);
  },
};

/* ------------------------------------------------------------------ the street across from the school */

/** a box whose texture coordinates are metres / tile on every face, so a texture keeps its real scale */
function uvBox(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
/** a gable end: a triangle facing +x, its base along z on y = 0, its apex at (0, rise, 0) */
function uvGable(base, rise, tile = 1) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -base / 2, 0, 0, base / 2, 0, rise, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([-base / 2 / tile, 0, base / 2 / tile, 0, 0, rise / tile], 2));
  g.setIndex([0, 2, 1]);
  return g;
}

/**
 * Collects the pieces of many buildings by material and merges them, one mesh per material:
 * a whole street in a dozen draw calls. Each piece can carry its own tint (vertex colour).
 */
function lifeKit() {
  const parts = new Map(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = LV(1, 1, 1), m = new THREE.Matrix4();
  return {
    put(key, geo, M, x, y, z, ry = 0, rx = 0, tint = null) {
      e.set(rx, ry, 0, 'YXZ'); q.setFromEuler(e);
      geo.applyMatrix4(m.copy(M).multiply(new THREE.Matrix4().compose(LV(x, y, z), q, one)));
      if (tint || !geo.attributes.color) {
        const c = tint || [1, 1, 1], n = geo.attributes.position.count, a = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) a.set(c, i * 3);
        geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      }
      (parts.get(key) || parts.set(key, []).get(key)).push(geo);
    },
    build(add, mats) {
      for (const [key, list] of parts) {
        const o = add(Addons.mergeGeometries(list), mats[key], 0, 0, 0, 0, !mats[key].transparent);
        o.receiveShadow = true;
      }
    },
  };
}

/**
 * A suburban house, front to -z, its front wall's centre at the origin of M: painted lap siding
 * (or brick) on a concrete foundation, a shingled gable roof with boxed eaves and gutters, framed
 * windows (glass over blinds, curtains, a lamp on in some rooms), a panelled front door up a stoop,
 * and as it comes: a chimney, a porch roof, shutters, an attached garage with its drive.
 */
function lifeHouse(kit, M, rnd, o) {
  const { w, d, storeys, ridge = 'x', wall = 'siding', tint, roofTint = [1, 1, 1], door, shutter = null, garage = 0, porch = false, chimney = false, yard = 4.9 } = o;
  const T = (x, y, z, ry = 0) => M.clone().multiply(new THREE.Matrix4().compose(LV(x, y, z), new THREE.Quaternion().setFromAxisAngle(LV(0, 1, 0), ry), LV(1, 1, 1)));
  const fl = 0.5, sh = 2.75, H = fl + storeys * sh, white = [0.92, 0.91, 0.88];
  const wallTint = wall === 'brick' ? [1, 1, 1] : tint;
  // body, foundation, corner boards
  kit.put(wall, uvBox(w, H - fl + 0.02, d, wall === 'brick' ? 2.4 : 2.2), M, 0, fl + (H - fl) / 2, d / 2, 0, 0, wallTint);
  kit.put('concrete', uvBox(w + 0.08, fl + 0.05, d + 0.08, 2.4), M, 0, fl / 2 - 0.02, d / 2);
  if (wall !== 'brick') for (const [x, z] of [[-w / 2, 0], [w / 2, 0], [-w / 2, d], [w / 2, d]]) kit.put('trim', uvBox(0.15, H - fl, 0.15), M, x, fl + (H - fl) / 2, z, 0, 0, white);
  // the roof: two shingled slopes, boxed eaves, gutters, rake boards; the gable ends in the wall's material
  const roof = (R, A, B, pitch, wallKey, wTint) => {
    const over = 0.38, gOver = 0.3, rise = (B / 2) * Math.tan(pitch), s = B / 2 + over, L = s / Math.cos(pitch), len = A + 2 * gOver;
    const eaveY = rise - s * Math.tan(pitch);
    for (const side of [-1, 1]) {
      const ny = Math.cos(pitch) * 0.045, nz = side * Math.sin(pitch) * 0.045, cz = side * s / 2, cy = rise - (s / 2) * Math.tan(pitch);
      kit.put('roof', uvBox(len, 0.09, L, 2.4), R, 0, cy + ny, cz + nz, 0, side * pitch, roofTint);
      for (const end of [-1, 1]) kit.put('trim', uvBox(0.05, 0.2, L, 1), R, end * (len / 2 + 0.02), cy - 0.02, cz, 0, side * pitch, white);
      kit.put('trim', uvBox(len, 0.2, 0.05), R, 0, eaveY - 0.04, side * (s + 0.02), 0, 0, white);       // fascia
      kit.put('trim', uvBox(len, 0.12, 0.13), R, 0, eaveY - 0.08, side * (s + 0.09), 0, 0, white);      // gutter
      kit.put('trim', uvBox(A + 0.02, 0.03, over), R, 0, eaveY - 0.02, side * (B / 2 + over / 2), 0, 0, white); // soffit
    }
    kit.put('roof', uvBox(len, 0.07, 0.3, 1), R, 0, rise + 0.07, 0, 0, 0, roofTint.map((v) => v * 0.8));  // ridge cap
    for (const end of [-1, 1]) kit.put(wallKey, uvGable(B, rise, 2.2), R, end * A / 2, 0, 0, end > 0 ? 0 : Math.PI, 0, wTint);
    return { rise, eaveY, s };
  };
  const pitch = storeys > 1 ? 0.6 : 0.68;
  const R = ridge === 'x' ? T(0, H, d / 2) : T(0, H, d / 2, Math.PI / 2);
  const rf = roof(R, ridge === 'x' ? w : d, ridge === 'x' ? d : w, pitch, wall, wallTint);
  // downspouts at the front corners
  for (const x of [-w / 2 - 0.05, w / 2 + 0.05]) kit.put('trim', uvBox(0.07, H - 0.1, 0.07), M, x, (H - 0.1) / 2, -0.12, 0, 0, white);

  // windows: room (dark, or lit), blinds or curtains behind the glass, frame, sill, meeting rail, shutters
  const curtainCols = [[0.75, 0.68, 0.55], [0.55, 0.6, 0.66], [0.82, 0.8, 0.74], [0.5, 0.35, 0.3]];
  const pane = (F, cx, cy, ww, wh) => {
    const lit = rnd() < 0.1, dress = rnd();
    kit.put(lit ? 'roomLit' : 'room', new THREE.PlaneGeometry(ww, wh), F, cx, cy, -0.006, Math.PI);
    if (dress < 0.45) { const b = 0.2 + rnd() * 0.5; kit.put('blind', new THREE.PlaneGeometry(ww * 0.97, wh * b), F, cx, cy + wh / 2 - wh * b / 2, -0.014, Math.PI); }
    else if (dress < 0.8) { const c = curtainCols[Math.floor(rnd() * 4)]; for (const sx of [-1, 1]) kit.put('cloth', new THREE.PlaneGeometry(ww * 0.26, wh * 0.98), F, cx + sx * ww * 0.37, cy, -0.014, Math.PI, 0, c); }
    kit.put('glass', new THREE.PlaneGeometry(ww, wh), F, cx, cy, -0.024, Math.PI);
    kit.put('trim', uvBox(ww + 0.26, 0.13, 0.07), F, cx, cy + wh / 2 + 0.065, -0.035, 0, 0, white);
    for (const sx of [-1, 1]) kit.put('trim', uvBox(0.11, wh, 0.07), F, cx + sx * (ww / 2 + 0.055), cy, -0.035, 0, 0, white);
    kit.put('trim', uvBox(ww + 0.34, 0.06, 0.12), F, cx, cy - wh / 2 - 0.03, -0.06, 0, 0, white);
    kit.put('trim', uvBox(ww, 0.05, 0.035), F, cx, cy, -0.035, 0, 0, white);
    kit.put('trim', uvBox(0.035, wh / 2, 0.03), F, cx, cy + wh / 4, -0.035, 0, 0, white);
    if (shutter) for (const sx of [-1, 1]) {
      kit.put('paint', uvBox(ww * 0.42, wh + 0.06, 0.04), F, cx + sx * (ww / 2 + 0.14 + ww * 0.21), cy, -0.03, 0, 0, shutter);
      for (let k = 1; k < 8; k++) kit.put('paint', uvBox(ww * 0.38, 0.015, 0.02), F, cx + sx * (ww / 2 + 0.14 + ww * 0.21), cy - wh / 2 + (k / 8) * wh, -0.055, 0, 0, shutter.map((v) => v * 0.7));
    }
  };
  const front = M;
  // front: the door in one bay, windows in the rest; the upper floor a row of windows
  const bays = Math.max(2, Math.round((w - 0.6) / 2.1)), bayX = (i) => -w / 2 + (i + 0.5) * (w / bays);
  const doorBay = garage > 0 ? bays - 1 : (garage < 0 ? 0 : Math.floor(rnd() * bays));
  for (let i = 0; i < bays; i++) {
    const x = bayX(i);
    if (i === doorBay) {
      const dy = fl + 1.05;
      kit.put('paint', uvBox(0.96, 2.1, 0.06), front, x, dy, -0.03, 0, 0, door);
      for (const [px, py] of [[-0.22, 0.45], [0.22, 0.45], [-0.22, -0.48], [0.22, -0.48]]) kit.put('paint', uvBox(0.3, 0.8, 0.025), front, x + px, dy + py, -0.07, 0, 0, door.map((v) => v * 1.25));
      kit.put('brass', uvBox(0.06, 0.06, 0.07), front, x + 0.36, dy - 0.05, -0.09);
      kit.put('trim', uvBox(1.26, 0.15, 0.09), front, x, fl + 2.2, -0.045, 0, 0, white);
      for (const sx of [-1, 1]) kit.put('trim', uvBox(0.13, 2.2, 0.09), front, x + sx * 0.56, fl + 1.1, -0.045, 0, 0, white);
      // the stoop: a landing and two steps down to the walk, the walk out to the sidewalk
      kit.put('concrete', uvBox(1.9, fl, 1.3, 2), front, x, fl / 2, -0.65);
      kit.put('concrete', uvBox(1.5, fl * 0.66, 0.3, 2), front, x, fl * 0.33, -1.45);
      kit.put('concrete', uvBox(1.5, fl * 0.33, 0.3, 2), front, x, fl * 0.165, -1.75);
      kit.put('concrete', uvBox(1.1, 0.05, yard - 1.9, 2), front, x, 0.02, -1.9 - (yard - 1.9) / 2);
      if (porch) {
        kit.put('trim', uvBox(2.3, 0.14, 1.7), front, x, fl + 2.55, -0.85, 0, 0, white);
        kit.put('roof', uvBox(2.4, 0.06, 1.8, 2.4), front, x, fl + 2.65, -0.85, 0, 0, roofTint);
        for (const sx of [-1, 1]) kit.put('trim', uvBox(0.13, 2.5, 0.13), front, x + sx * 1.05, fl + 1.25, -1.6, 0, 0, white);
      }
    } else pane(front, x, fl + 1.5, 0.95, 1.45);
    if (storeys > 1) pane(front, x, fl + sh + 1.45, i === doorBay ? 0.75 : 0.92, i === doorBay ? 1.1 : 1.35);
  }
  // the sides and the back: a window or two per floor
  for (const [F, len] of [[T(w / 2, 0, d / 2, -Math.PI / 2), d], [T(-w / 2, 0, d / 2, Math.PI / 2), d], [T(0, 0, d, Math.PI), w]]) {
    const n = len > 7 ? 2 : 1;
    for (let f = 0; f < storeys; f++) for (let k = 0; k < n; k++) pane(F, (n === 1 ? 0 : (k ? 1 : -1) * len * 0.22) + (f ? 0.3 : 0), fl + f * sh + 1.5, 0.9, 1.3);
  }
  // a front gable gets an attic window
  if (ridge === 'z') pane(front, 0, H + rf.rise * 0.42, 0.7, 0.85);
  // a brick chimney up the outside of a gable end
  if (chimney && ridge === 'x') {
    const cx = (w / 2 + 0.32) * (rnd() < 0.5 ? -1 : 1), top = H + rf.rise + 0.7;
    kit.put('brick', uvBox(0.62, top, 0.9, 2.4), M, cx, top / 2, d / 2);
    kit.put('concrete', uvBox(0.72, 0.08, 1.0, 2), M, cx, top + 0.04, d / 2);
  }
  // an attached garage beside the house, its drive out to the street
  if (garage) {
    const gw = 3.5, gd = d - 1, gh = fl + 2.6, gx = garage * (w / 2 + gw / 2), G2 = T(gx, 0, 0.6);
    kit.put(wall, uvBox(gw, gh, gd, wall === 'brick' ? 2.4 : 2.2), G2, 0, gh / 2, gd / 2, 0, 0, wallTint);
    roof(T(gx, gh, 0.6 + gd / 2, Math.PI / 2), gd, gw, 0.5, wall, wallTint);
    kit.put('trim', uvBox(2.75, 2.3, 0.06), G2, 0, 1.15, -0.03, 0, 0, white);
    for (let k = 1; k < 4; k++) kit.put('gap', uvBox(2.7, 0.03, 0.03), G2, 0, k * 0.575, -0.065);
    kit.put('trim', uvBox(3.0, 0.14, 0.09), G2, 0, 2.37, -0.045, 0, 0, white);
    kit.put('concrete', uvBox(3.1, 0.05, yard + 0.6, 2.4), M, gx, 0.02, 0.6 - (yard + 0.6) / 2);
    // the mailbox at the end of the drive
    const mx = gx - garage * 1.9;
    kit.put('trim', uvBox(0.09, 1.05, 0.09), M, mx, 0.52, -yard + 0.35, 0, 0, white);
    kit.put('paint', uvBox(0.22, 0.24, 0.48), M, mx, 1.14, -yard + 0.35, 0, 0, [0.04, 0.04, 0.045]);
  }
  return { H, rise: rf.rise, doorX: bayX(doorBay) };
}

/* ------------------------------------------------------------------ Westbrook High, a grey morning */
const Campus = {
  built: false,
  build() {
    if (this.built) return;
    this.built = true;
    const { s, add } = lifeStage(new THREE.FogExp2(0x8a8f96, 0.018), 0x8c9198);
    this.scene = s;
    const brick = photoMat(Tex.brick, { scale: 0.42, color: 0xb88a78, roughness: 0.9 });
    const concrete = photoMat(Tex.concrete, { scale: 0.35, color: 0xb0ada6, roughness: 0.9 });
    const paving = photoMat(Tex.concrete, { scale: 0.25, color: 0x9a978f, roughness: 0.95 });
    const asphalt = photoMat(Tex.asphalt, { scale: 0.22, color: 0x6a6a6c, roughness: 0.95 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1c2630, roughness: 0.06, metalness: 0.65, envMapIntensity: 1.2 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xa8acb0, roughness: 0.35, metalness: 0.8 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 });
    const soil = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 });
    // ground: paving in front of the school, the kerb, the street
    add(new THREE.BoxGeometry(120, 0.2, 16), paving, 0, -0.1, -2);
    add(new THREE.BoxGeometry(120, 0.16, 0.3), concrete, 0, -0.02, 6.15);
    add(new THREE.BoxGeometry(120, 0.2, 14), asphalt, 0, -0.22, 13.3);
    for (let x = -58; x < 58; x += 4) add(new THREE.BoxGeometry(2, 0.005, 0.14), new THREE.MeshStandardMaterial({ color: 0xd8d4c0, roughness: 0.8 }), x, -0.115, 13.3, 0, false);
    // the school: two storeys of brick, a row of tall windows on each
    const fz = -6;
    add(new THREE.BoxGeometry(40, 9, 1), brick, 0, 4.5, fz - 0.5);
    add(new THREE.BoxGeometry(40.4, 0.35, 1.3), trim, 0, 9.1, fz - 0.4);
    add(new THREE.BoxGeometry(40.2, 0.2, 1.1), trim, 0, 4.6, fz - 0.45);
    for (let x = -18; x <= 18; x += 3) {
      if (Math.abs(x) < 3) continue;
      for (const [y0, y1] of [[1.4, 3.9], [5.4, 8.1]]) {
        add(new THREE.BoxGeometry(1.7, y1 - y0, 0.06), glass, x, (y0 + y1) / 2, fz + 0.02, 0, false);
        add(new THREE.BoxGeometry(1.86, 0.1, 0.16), trim, x, y0 - 0.05, fz + 0.06, 0, false);
        add(new THREE.BoxGeometry(1.86, 0.08, 0.1), trim, x, y1 + 0.04, fz + 0.03, 0, false);
        add(new THREE.BoxGeometry(0.05, y1 - y0, 0.08), trim, x, (y0 + y1) / 2, fz + 0.05, 0, false);
      }
    }
    // the entrance: a stone landing up five steps, glass doors under a lit sign
    const rise = 0.19, run = 0.32, steps = 5, ly = rise * steps, lz0 = fz, lz1 = fz + 2.4, sw = 4.4;
    add(new THREE.BoxGeometry(sw + 0.4, ly, lz1 - lz0), concrete, 0, ly / 2, (lz0 + lz1) / 2);
    for (let i = 0; i < steps; i++) { const h = rise * (steps - i), z = lz1 + run * i + run / 2; add(new THREE.BoxGeometry(sw, h, run), concrete, 0, h / 2, z); }
    // handrails down both sides: posts, and a rail that follows the slope of the steps
    for (const sx of [-1, 1]) {
      const x = sx * (sw / 2 - 0.15), zTop = lz1 - 0.2, zBot = lz1 + steps * run - 0.1;
      for (const [z, y] of [[zTop, ly], [zBot, rise]]) add(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), alu, x, y + 0.45, z, 0, false);
      const len = Math.hypot(zBot - zTop, ly - rise), rail = add(new THREE.CylinderGeometry(0.022, 0.022, len, 8), alu, x, (ly + rise) / 2 + 0.9, (zTop + zBot) / 2, 0, false);
      rail.rotation.x = Math.PI / 2 - Math.atan2(ly - rise, zBot - zTop);
    }
    add(new THREE.BoxGeometry(4.2, 3.0, 0.08), glass, 0, ly + 1.5, fz + 0.04, 0, false);
    for (const x of [-2.1, -1.05, 0, 1.05, 2.1]) add(new THREE.BoxGeometry(0.08, 3.0, 0.14), alu, x, ly + 1.5, fz + 0.06, 0, false);
    add(new THREE.BoxGeometry(4.3, 0.1, 0.16), alu, 0, ly + 3.0, fz + 0.06, 0, false);
    add(new THREE.BoxGeometry(5.6, 0.25, 1.6), trim, 0, ly + 3.35, fz + 0.75);
    const signTex = Tex.text('WESTBROOK HIGH SCHOOL', { w: 1024, h: 128, font: 'bold 70px Georgia, serif', color: '#e9dcc0' });
    const sign = add(new THREE.PlaneGeometry(5.0, 0.62), new THREE.MeshStandardMaterial({ map: signTex, transparent: true, roughness: 0.5, metalness: 0.4 }), 0, ly + 3.85, fz + 0.03, 0, false);
    sign.castShadow = false;
    // the planters either side of the steps; Jesse sits on the front ledge of the right one
    const seatY = (MODEL_DEFS.jesse && 0.383) || 0.383;
    const leaves = leafMaterial([1.1, 1.12, 0.95], { fallback: Tex.leafOlive, wind: 0.03 }), rng = mulberry32(23);
    const planter = (x0, x1, zA, zB) => {
      add(new THREE.BoxGeometry(x1 - x0, seatY - 0.05, zB - zA), brick, (x0 + x1) / 2, (seatY - 0.05) / 2, (zA + zB) / 2);
      add(new THREE.BoxGeometry(x1 - x0 + 0.06, 0.05, zB - zA + 0.06), concrete, (x0 + x1) / 2, seatY - 0.025, (zA + zB) / 2);
      add(new THREE.BoxGeometry(x1 - x0 - 0.5, 0.02, zB - zA - 0.5), soil, (x0 + x1) / 2, seatY - 0.04, (zA + zB) / 2, 0, false);
      // shrubs in the soil, a little overgrown and running into each other
      for (let x = x0 + 0.6; x < x1 - 0.4; x += 0.8) {
        const r = 0.4 + rng() * 0.12;
        add(leafCrown(rng, { rx: r * 1.15, ry: r * 0.9, rz: r, n: 90, size: 0.36, flatBottom: 0.55 }), leaves, x + rand(-0.08, 0.08), seatY + r * 0.55, (zA + zB) / 2 - 0.15 + rand(-0.1, 0.1), rng() * TAU);
      }
    };
    const pz1 = lz1 + steps * run;
    planter(sw / 2 + 0.25, sw / 2 + 4.4, lz0 + 0.4, pz1 - 0.3);
    this.jesseSeat = LV(sw / 2 + 2.0, 0, pz1 - 0.3);
    // the vending machine to the left of the steps, against the wall
    const vx = -3.6, vz = fz + 0.42;
    this.vend = this.vending(s, vx, vz);
    this.vendFront = LV(vx, 0, vz + 0.95);
    // a bench, a bin, two lamp posts, a bike rack
    const bench = new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8 });
    add(new THREE.BoxGeometry(1.8, 0.06, 0.45), bench, -7.5, 0.45, -3.6);
    for (const x of [-8.2, -6.8]) add(new THREE.BoxGeometry(0.06, 0.45, 0.4), alu, x, 0.22, -3.6, 0, false);
    add(new THREE.CylinderGeometry(0.25, 0.22, 0.85, 14), new THREE.MeshStandardMaterial({ color: 0x2c3a34, roughness: 0.6, metalness: 0.3 }), -5.2, 0.42, -5.2);
    for (const x of [-9, 9]) { add(new THREE.CylinderGeometry(0.06, 0.08, 4.4, 10), alu, x, 2.2, 5.6); add(new THREE.BoxGeometry(0.5, 0.12, 0.25), alu, x, 4.4, 5.4, 0, false); }
    for (let i = 0; i < 6; i++) add(new THREE.TorusGeometry(0.32, 0.025, 6, 16, Math.PI), alu, 10 + i * 0.55, 0, -4.2, Math.PI / 2, false);
    // across the street: kerb, grass verge, sidewalk, front lawns, and a row of houses
    const rnd = mulberry32(17);
    add(new THREE.BoxGeometry(120, 0.16, 0.3), concrete, 0, -0.02, 20.45);
    const lawn = photoMat(Tex.grass ? { map: Tex.grass, normal: Tex.grassN } : null, { scale: 0.32, color: 0x8e9c6a, roughness: 1 });
    add(new THREE.BoxGeometry(120, 0.2, 30), lawn, 0, -0.12, 35.6);
    add(new THREE.BoxGeometry(120, 0.06, 1.5), paving, 0, 0, 22.4);
    for (let x = -58.5; x < 60; x += 1.5) add(new THREE.BoxGeometry(0.02, 0.005, 1.5), soil, x, 0.03, 22.4, 0, false);
    const tex = (t) => { if (!t) return null; const c = t.clone(); c.rotation = Math.PI / 2; c.needsUpdate = true; return c; };
    const pbrMat = (set, opts) => new THREE.MeshStandardMaterial(Object.assign(set ? { map: opts.turn ? tex(set.map) : set.map, normalMap: opts.turn ? tex(set.normal) : set.normal, roughnessMap: opts.turn ? tex(set.rough) : set.rough } : {}, { vertexColors: true, roughness: 1, envMapIntensity: 0.6 }, opts.m || {}));
    const houseMats = {
      siding: pbrMat(Tex.siding, { turn: true }),            // board-and-batten turned on its side: lap siding
      brick: pbrMat(Tex.brick, { m: { color: 0xc09080 } }),
      roof: pbrMat(Tex.shingles, { m: { color: 0xb8b4ae } }),
      concrete: pbrMat(Tex.concrete, { m: { color: 0xb6b2aa } }),
      trim: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, envMapIntensity: 0.6 }),
      paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, envMapIntensity: 0.8 }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      room: new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 1 }),
      roomLit: new THREE.MeshStandardMaterial({ color: 0x2a2018, emissive: 0xffc27a, emissiveIntensity: 0.32, roughness: 1 }),
      blind: new THREE.MeshStandardMaterial({ color: 0xd6cfc0, roughness: 0.9 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9aa6b0, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.45, envMapIntensity: 2.2, depthWrite: false }),
      brass: new THREE.MeshStandardMaterial({ color: 0xb08a40, metalness: 1, roughness: 0.35 }),
      gap: new THREE.MeshStandardMaterial({ color: 0x6e6b66, roughness: 0.8 }),
      shrub: leaves,
    };
    const kit = lifeKit(), zf = 28.2;
    const W = [0.93, 0.92, 0.89], NAVY = [0.05, 0.08, 0.2], RED = [0.42, 0.05, 0.04], BLACK = [0.03, 0.03, 0.035], GREEN = [0.05, 0.16, 0.09];
    const street = [
      { w: 8.4, d: 9.0, storeys: 2, tint: W, door: NAVY, shutter: BLACK, garage: 1, chimney: true },
      { w: 7.6, d: 9.4, storeys: 1, ridge: 'z', tint: [0.62, 0.69, 0.56], door: RED, porch: true },
      { w: 8.2, d: 9.0, storeys: 2, wall: 'brick', door: BLACK, shutter: GREEN, garage: -1, chimney: true },
      { w: 7.4, d: 9.6, storeys: 2, ridge: 'z', tint: [0.6, 0.67, 0.74], door: W, porch: true },
      { w: 8.6, d: 8.6, storeys: 1, tint: [0.86, 0.78, 0.62], door: GREEN, garage: 1, chimney: true, roofTint: [0.95, 0.85, 0.75] },
      { w: 8.0, d: 9.2, storeys: 2, tint: [0.4, 0.47, 0.56], door: RED, shutter: W, porch: true },
      { w: 7.8, d: 9.0, storeys: 2, ridge: 'z', tint: [0.93, 0.86, 0.62], door: NAVY, garage: -1 },
      { w: 8.4, d: 8.8, storeys: 1, tint: [0.6, 0.6, 0.58], door: BLACK, shutter: BLACK, chimney: true },
    ];
    const shrubs = [];
    street.forEach((h, i) => {
      const lot = -49 + i * 14, hx = lot - (h.garage || 0) * 1.75;
      const M = new THREE.Matrix4().makeTranslation(hx, 0, zf);
      const r = lifeHouse(kit, M, rnd, { ...h, yard: zf - 23.15 });
      // foundation plantings under the front windows
      for (let x = -h.w / 2 + 0.7; x < h.w / 2 - 0.5; x += 0.95 + rnd() * 0.4) {
        if (Math.abs(x - r.doorX) < 1.25) continue;
        const s = 0.38 + rnd() * 0.2;
        shrubs.push([hx + x, s * 0.55, zf - 0.55 - rnd() * 0.15, s]);
      }
    });
    for (const [x, y, z, s] of shrubs) kit.put('shrub', leafCrown(rnd, { rx: s * 1.15, ry: s * 0.9, rz: s, n: 80, size: 0.34, flatBottom: 0.55 }), new THREE.Matrix4(), x, y, z, rnd() * TAU);
    kit.build(add, houseMats);

    // trees: on the school side of the street, and a few in the front yards
    const trunk = photoMat(Tex.bark, { scale: 1.5, color: 0xb0a088, roughness: 1 });
    const crown = leafMaterial([1.05, 1.1, 0.95], { fallback: Tex.leafOlive, wind: 0.04 });
    const tree =(x, z, k0 = 1) => {
      add(new THREE.CylinderGeometry(0.16 * k0, 0.22 * k0, 3.4 * k0, 10), trunk, x, 1.7 * k0, z, 0, false);
      // a few limbs into the crown, then the crown itself: overlapping masses of leaves
      for (let k = 0; k < 3; k++) {
        const limb = add(new THREE.CylinderGeometry(0.05 * k0, 0.1 * k0, 1.8 * k0, 6), trunk, x, 0, z, rnd() * TAU, false);
        limb.rotation.z = 0.5 + rnd() * 0.3;
        limb.position.set(x, 3.3 * k0, z).addScaledVector(new THREE.Vector3(0, 1, 0).applyEuler(limb.rotation), 0.9 * k0);
      }
      for (let k = 0; k < 7; k++) {
        const r = (0.75 + rnd() * 0.55) * k0, a = (k / 7) * TAU + rnd(), out = (k === 0 ? 0 : 0.7 + rnd() * 0.6) * k0;
        add(leafCrown(rnd, { rx: r, ry: r * 0.8, rz: r, n: Math.round(120 * r / k0), size: 0.8 * k0, flatBottom: 0.6 }), crown,
          x + Math.cos(a) * out, (k === 0 ? 5.6 : 4.2 + rnd() * 1.4) * k0, z + Math.sin(a) * out * 0.8, rnd() * TAU);
      }
    };
    for (const x of [-14, -4.5, 6.5, 16]) tree(x, 7.4);
    for (const [x, z, k] of [[-41.5, 25.2, 1.25], [-12.5, 25.6, 1.4], [13.5, 25.0, 1.15], [41, 25.4, 1.3]]) tree(x, z, k);
    // an overcast sky
    const sky = Tex.paint(64, (x, y) => { const v = y / 64; return [0.62 - v * 0.14, 0.64 - v * 0.13, 0.67 - v * 0.1]; });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false }));
    s.add(dome);
    const sun = new THREE.DirectionalLight(0xe4e0d8, 2.3);
    sun.position.set(14, 22, 18); sun.target.position.set(0, 0, -2);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -10, near: 1, far: 70 });
    s.add(sun, sun.target);
    s.add(new THREE.HemisphereLight(0xb8c0cc, 0x50463c, 1.5));
    // people: Jesse by the planter at the foot of the steps, two classmates by the machine, Ariel coming up the street
    this.jessePos = LV(this.jesseSeat.x - 0.35, 0, this.jesseSeat.z + 0.5);
    this.jesse = lifeJesse(s, { x: this.jessePos.x, z: this.jessePos.z, face: 0.35 });
    this.boy = lifeActor(s, 'classmateBoy', { x: -6.2, z: -2.6, face: 1.2 });
    this.girl = Models.has('classmateGirl') ? Models.instance('classmateGirl') : new THREE.Group();
    this.girl.scale.setScalar(1.66 / LM_H);
    this.girl.position.set(-5.2, 0, -2.0); this.girl.rotation.y = -1.9;
    s.add(this.girl);
    this.ariel = lifeActor(s, 'arielTeen', { x: 16, z: 2.2, face: -Math.PI / 2 });
    // Principal Steinback waits just inside the doors (he comes out when the machine dies)
    this.landingY = ly;
    this.doorAt = LV(0.5, 0, fz + 0.35);
    this.principal = lifeActor(s, Models.has('principal') ? 'principal' : 'classmateBoy', { x: this.doorAt.x, z: this.doorAt.z, face: 0 });
    this.principal.root.position.y = ly;
    this.principal.root.visible = false;
  },
  /** a soda machine with a lit front: red cabinet, a window of cans, a coin slot */
  vending(s, x, z) {
    const c = Tex.canvas(256, 512), ctx = c.getContext('2d');
    ctx.fillStyle = '#7a1414'; ctx.fillRect(0, 0, 256, 512);
    ctx.fillStyle = '#f4f0e8'; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center'; ctx.fillText('ICE COLD', 128, 52);
    ctx.fillStyle = '#101418'; ctx.fillRect(18, 74, 160, 340);
    const cans = ['#c8202a', '#1a4ab0', '#e8a020', '#20a050', '#e0e0e0', '#7a2aa8'];
    for (let r = 0; r < 5; r++) for (let k = 0; k < 4; k++) {
      const col = cans[(r * 4 + k) % cans.length];
      ctx.fillStyle = col; ctx.fillRect(26 + k * 38, 86 + r * 64, 30, 50);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(30 + k * 38, 88 + r * 64, 5, 46);
    }
    ctx.fillStyle = '#222'; ctx.fillRect(192, 90, 48, 150);
    for (let i = 0; i < 8; i++) { ctx.fillStyle = '#c8c4b8'; ctx.fillRect(198 + (i % 2) * 20, 100 + Math.floor(i / 2) * 26, 16, 16); }
    ctx.fillStyle = '#0d2a10'; ctx.fillRect(194, 250, 44, 22);
    ctx.fillStyle = '#4cff6a'; ctx.font = 'bold 14px monospace'; ctx.fillText('1.50', 216, 266);
    ctx.fillStyle = '#111'; ctx.fillRect(208, 290, 14, 36);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(30, 438, 150, 46);
    const face = Tex.toTex(c, true, false);
    const glow = Tex.toTex(c, true, false);
    const body = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.4, metalness: 0.3 });
    const front = new THREE.MeshStandardMaterial({ map: face, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0.55, roughness: 0.25 });
    const g = new THREE.Group(); g.position.set(x, 0, z); s.add(g);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.85, 0.8), [body, body, body, body, front, body]);
    box.position.y = 0.925; box.castShadow = box.receiveShadow = true; g.add(box);
    const light = new THREE.PointLight(0xdfe8ff, 1.6, 3.5, 2);
    light.position.set(0, 1.1, 0.7); g.add(light);
    return { group: g, front, light, box, dead: false };
  },
  /** the machine dies in a shower of sparks */
  fry() {
    const V = this.vend;
    if (V.dead) return;
    V.dead = true;
    const p = this.vendFront.clone().setY(1.1).add(LV(0.15, 0, -0.5));
    FX.sparks(p, LV(0, 0.4, 1), 140, [1.4, 1.9, 3.4, 1], 9);
    FX.sparks(p, LV(0, 1, 0.3), 60, [3, 2.2, 1, 1], 6);
    FX.flashLight(p, 0xb8d4ff, 130, 0.4, 10);
    FX.smoke.spawn({ x: p.x, y: p.y + 0.2, z: p.z, vy: 0.6, life: 3, s: 0.3, s2: 1.4, turb: 0.5, c: [0.3, 0.3, 0.32, 0.5], c2: [0.25, 0.25, 0.27, 0] });
    Sound.zap(); Sound.hit('metal', 0.8);
    this.smoking = 6;
    V.flick = 0.5;
  },
  update(dt) {
    this.jesse.update(dt);
    this.boy.update(dt);
    this.ariel.update(dt);
    if (this.principal.root.visible) this.principal.update(dt);
    const V = this.vend;
    if (V.dead) {
      // the light inside gasps once or twice and goes out
      V.flick = Math.max(0, (V.flick || 0) - dt);
      const on = V.flick > 0 && Math.random() < 0.4;
      V.front.emissiveIntensity = on ? 0.4 : 0.0;
      V.light.intensity = on ? 1.2 : 0;
      if (this.smoking > 0) {
        this.smoking -= dt;
        if (Math.random() < 0.3) { const p = this.vendFront; FX.smoke.spawn({ x: p.x + rand(-0.2, 0.2), y: 1.6 + rand(0, 0.3), z: p.z - 0.6, vy: rand(0.3, 0.6), life: 2.5, s: 0.15, s2: 0.8, turb: 0.4, c: [0.32, 0.32, 0.34, 0.35], c2: [0.3, 0.3, 0.32, 0] }); }
      }
    }
  },
};

/** falling rain as streaks, inside a box */
function lifeRain(s, { x0, x1, z0, z1, y0, y1, n, opacity }) {
  const pos = new Float32Array(n * 6), seed = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { seed[i * 3] = rand(x0, x1); seed[i * 3 + 1] = rand(y0, y1); seed[i * 3 + 2] = rand(z0, z1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa8b8d0, transparent: true, opacity }));
  lines.frustumCulled = false;
  s.add(lines);
  return {
    lines, speed: 1,
    update(dt) {
      for (let i = 0; i < n; i++) {
        let y = seed[i * 3 + 1] - 20 * dt * this.speed; if (y < y0) y += y1 - y0; seed[i * 3 + 1] = y;
        const x = seed[i * 3], z = seed[i * 3 + 2];
        pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x + 0.05; pos[i * 6 + 4] = y - 0.55; pos[i * 6 + 5] = z;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

/** which of these stages a scene is, if any */
const Life = {
  build() { Home.build(); Memory.build(); Campus.build(); },
  stageOf(scene) { return [Home, Memory, Campus].find((st) => st.built && st.scene === scene) || null; },
};
