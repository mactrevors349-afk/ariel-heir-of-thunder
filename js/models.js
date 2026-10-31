'use strict';
/* ==========================================================================
   models.js · imported character models
   The procedural Rig keeps doing all the animation. Each model is fitted to
   the rig at load time, and every frame its bones copy the rig's joint
   rotations (world-space retargeting). Models without a skeleton are
   auto-skinned onto the rig.
   ========================================================================== */

const LIMB_BONES = (p) => ({
  armL: p('Left', 'Arm'), elbowL: p('Left', 'ForeArm'), handL: p('Left', 'Hand'),
  armR: p('Right', 'Arm'), elbowR: p('Right', 'ForeArm'), handR: p('Right', 'Hand'),
  thighL: p('Left', 'UpLeg'), kneeL: p('Left', 'Leg'), footL: p('Left', 'Foot'),
  thighR: p('Right', 'UpLeg'), kneeR: p('Right', 'Leg'), footR: p('Right', 'Foot'),
});
const MIXAMO_LIMBS = LIMB_BONES((s, n) => s + n);
// skeleton naming used by the Zeus and Hades rips
const JO_BONES = {
  hips: 'JOPelvis1', spine: 'JOBack1', chest: 'JOBack3', neck: 'JONeck1', head: 'JOHead1',
  armL: 'JOLeftUpperArm1', elbowL: 'JOLeftLowerArm1', handL: 'JOLeftWrist1',
  armR: 'JORightUpperArm1', elbowR: 'JORightLowerArm1', handR: 'JORightWrist1',
  thighL: 'JOLeftUpperLeg1', kneeL: 'JOLeftLowerLeg1', footL: 'JOLeftAnkle1',
  thighR: 'JORightUpperLeg1', kneeR: 'JORightLowerLeg1', footR: 'JORightAnkle1',
};
const JO_TIPS = { handL: 'JOLeftMiddleA1', handR: 'JORightMiddleA1', footL: 'JOLeftToe1', footR: 'JORightToe1' };
// static sculpts: landmark sheets were measured with the model scaled to this height,
// feet on y=0, centred on its bounding box and turned (rotY) to face +Z
const LM_H = 1.84;
// joints of a sculpt mirrored across x
const mirrorLM = (L) => {
  const out = { ...L };
  for (const k in L) if (k.endsWith('L')) out[k.slice(0, -1) + 'R'] = [-L[k][0], L[k][1], L[k][2]];
  return out;
};

// the A-posed woman Anna and Jesse are both built on: joints measured from front and side
const WOMAN_SHEET = {
  landmarks: mirrorLM({
    hips: [0, 0.97, 0.005], spine: [0, 1.12, 0.01], chest: [0, 1.32, 0.01], neck: [0, 1.57, 0], head: [0, 1.67, 0],
    armL: [0.15, 1.51, 0], elbowL: [0.353, 1.258, 0.02], handL: [0.518, 1.033, 0.04],
    thighL: [0.09, 0.95, 0], kneeL: [0.07, 0.49, 0.04], footL: [0.095, 0.11, -0.02],
  }),
  rigid: [
    { bone: 'head', test: (x, y) => y > 1.64 },
    // (the skirt only: her hands hang at the same height, further out)
    { bone: 'hips', test: (x, y, z) => y > 0.64 && y < 1.02 && Math.abs(x) < 0.33 && Math.hypot(x, z * 1.3) > 0.12 + (1.02 - y) * 0.42 },
  ],
  torso: { x: 0.155, y0: 0.6, y1: 1.42, z: 0.2 },
  // weights diffused over the skin a little: round shoulders, but still a defined elbow (more reads as rubber)
  relaxSkin: 8,
  // arms: the sculpt's own arm mesh (body_2: thin, flat-fingered, joined at the shoulders under the top's
  // armholes) is replaced by the arms of a full-body model, measured and fitted when it loads (see graftArms)
  arms: { url: 'assets/arms/body.glb', hide: /^body_2$/ },
};

// the armoured sculpt ("ARIEL GOD MODE 33" — the same file as the Ares download)
const ARMOUR_SCULPT = {
  url: 'assets/ares/armour_hd.glb', type: 'glb', restPose: true,
  // the sculpt has no skeleton: joints were measured from front/side views (feet at 0, facing +Z)
  shift: [-0.14, 0, 0.3],
  landmarks: {
    hips: [0.0, 0.9, 0.0], spine: [0.0, 1.02, -0.01], chest: [0.0, 1.22, 0.0], neck: [-0.01, 1.5, 0.03], head: [-0.02, 1.6, 0.06],
    // elbows sit at the top of the vambraces (the armour must bend above them, never through them), hands at the wrist
    armL: [0.26, 1.42, -0.03], elbowL: [0.335, 1.19, 0.025], handL: [0.338, 0.958, 0.11],
    // (the sword arm hangs back beside the hip: its forearm and fist sit behind the body's midline)
    armR: [-0.26, 1.42, -0.03], elbowR: [-0.335, 1.19, -0.14], handR: [-0.375, 0.975, -0.155],
    thighL: [0.14, 0.82, 0.0], kneeL: [0.19, 0.44, -0.03], footL: [0.26, 0.11, -0.06],
    thighR: [-0.12, 0.82, 0.0], kneeR: [-0.14, 0.44, -0.03], footR: [-0.2, 0.11, -0.15],
  },
  // the blade hangs outside the right leg, angled forward: anything right of xMax and below yMax is sword
  sword: { grip: [-0.41, 0.9, -0.085], tip: [-0.65, 0.13, 0.84], radius: 0.075, xMax: -0.33, yMax: 1.0 },
  // torso + skirt volume: arm bones may not claim vertices in here (narrow at the waist, where the
  // forearms hang only 5 cm from the belt; wider below the fists, where the skirt flares)
  torso: { x: 0.25, y0: 0.45, y1: 1.3, z: 0.3, xLow: 0.3, yLow: 0.86 },
};

const MODEL_DEFS = {
  // god-mode Ariel: the armoured sculpt, his blade split off as Keraunos (shown, hidden and lit on its own)
  arielGod: { ...ARMOUR_SCULPT, height: 1.9, label: 'Ariel', splitWeapon: true, material: agedGold, weaponMaterial: keraunosMaterial },
  arielTeen: {
    url: 'assets/ariel/ariel.fbx', type: 'fbx', height: 1.78,
    bones: { hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head', ...MIXAMO_LIMBS },
    tips: { handL: 'LeftHandMiddle1', handR: 'RightHandMiddle1', footL: 'LeftToeBase', footR: 'RightToeBase' },
  },
  zeus: { url: 'assets/zeus/zeus.fbx', type: 'fbx', height: 2.0, label: 'Zeus', bones: JO_BONES, tips: JO_TIPS },
  hades: { url: 'assets/hades/hades.fbx', type: 'fbx', height: 2.1, label: 'Hades', bones: JO_BONES, tips: JO_TIPS },
  // Ares: the same armour gone dark and blood-red, smouldering at the edges (and 2.5x Ariel's size in the arena)
  ares: { ...ARMOUR_SCULPT, height: 1.84, label: 'Ares', material: aresCrimson },
  // the Kin of Polyphemus, field boss of the Agora (T-pose sculpt, its log was cut away: it swings a club)
  cyclops: {
    url: 'assets/cyclops/cyclops.glb', type: 'glb', height: LM_H, label: 'the Cyclops',
    landmarks: mirrorLM({
      hips: [0, 0.89, -0.05], spine: [0, 1.05, -0.08], chest: [0, 1.31, -0.06], neck: [0, 1.53, 0.1], head: [0, 1.6, 0.22],
      armL: [0.43, 1.59, -0.04], elbowL: [0.9, 1.59, -0.04], handL: [1.4, 1.58, -0.02],
      thighL: [0.19, 0.82, -0.04], kneeL: [0.22, 0.49, -0.07], footL: [0.23, 0.2, -0.13],
    }),
  },
  // Thralls of Tartarus: a thin torso riding a knot of tentacles, which glide with the hips
  thrall: {
    url: 'assets/goon/goon.glb', type: 'glb', height: LM_H, rotY: Math.PI, label: 'the Thralls',
    landmarks: mirrorLM({
      hips: [0, 1.0, 0], spine: [0, 1.07, 0], chest: [0, 1.16, 0], neck: [0, 1.25, 0], head: [0, 1.33, 0.03],
      armL: [0.1, 1.19, 0], elbowL: [0.18, 1.11, 0.02], handL: [0.34, 1.21, 0.03],
      thighL: [0.1, 0.6, 0], kneeL: [0.1, 0.35, 0], footL: [0.1, 0.08, 0],
    }),
    rigid: [{ bone: 'hips', test: (x, y) => y < 0.98 }, { bone: 'head', test: (x, y) => y > 1.37 }],
    material: () => Models.rim(new THREE.MeshStandardMaterial({ color: 0x1c1820, roughness: 0.38, metalness: 0.1, envMapIntensity: 0.7 }), [0.5, 0.16, 0.85], 3.5, 0.6),
  },
  // Fallen Seraphim: winged reapers, the stronger shades
  seraph: {
    url: 'assets/elite/elite.glb', type: 'glb', height: LM_H, rotY: -Math.PI / 2, label: 'the Fallen Seraphim',
    landmarks: {
      hips: [0.04, 0.95, 0.06], spine: [0.04, 1.12, 0.07], chest: [0.04, 1.28, 0.08], neck: [0.04, 1.5, 0.11], head: [0.04, 1.59, 0.14],
      armL: [0.21, 1.39, 0.06], elbowL: [0.35, 1.12, 0.04], handL: [0.36, 0.85, 0.06],
      armR: [-0.13, 1.39, 0.06], elbowR: [-0.24, 1.12, 0.02], handR: [-0.31, 0.92, 0.0],
      thighL: [0.14, 0.86, 0.05], kneeL: [0.19, 0.51, 0.08], footL: [0.28, 0.14, 0.05],
      thighR: [-0.06, 0.86, 0.05], kneeR: [-0.11, 0.51, 0.04], footR: [-0.17, 0.14, 0.0],
    },
    // the scythe: pole and the curve of the blade belong to the right hand
    weapon: {
      segs: [[[-0.05, 1.22, -0.64], [-0.57, 0.63, 0.64], 0.05], [[-0.55, 0.62, 0.6], [-0.43, 0.32, 0.42], 0.07], [[-0.43, 0.32, 0.42], [-0.27, 0.03, 0.12], 0.06]],
      base: [-0.5, 0.64, 0.55], tip: [-0.29, 0.06, 0.15],
    },
    rigid: [{ bone: 'chest', test: (x, y) => Math.abs(x - 0.04) > 0.42 && y > 0.8 }, { bone: 'hips', test: (x, y, z) => z < -0.2 && y < 1.0 }],
    torso: { x: 0.2, y0: 0.5, y1: 1.35, z: 0.2 },
    material: (m) => Models.rim(m, [1.0, 0.3, 0.08], 4, 0.4),
  },
  // the gods of the prologue
  // (a small game model, ~5,000 triangles and 256-pixel paint: smoothed twice and its textures redrawn
  // sharper at load, so her face is round and modelled by the light instead of faceted and flat)
  athena: {
    url: 'assets/athena/athena.glb', type: 'glb', height: LM_H, rotY: Math.PI, label: 'Athena', smooth: 2, enhance: 4,
    // her face, sculpted deeper than the game model carved it (bumps and hollows in metres on the
    // landmark sheet, x mirrored): set-in eyes under a brow, a bridged nose, cheekbones, lips, chin
    relief: {
      mesh: /^head/, box: { x: 0.08, y0: 1.585, y1: 1.725, z: 0.06 },
      shape: [
        [0.031, 1.690, 0.017, 0.011, -0.0065], [0.015, 1.686, 0.006, 0.008, -0.003],   // eye sockets, inner corners
        [0.031, 1.697, 0.012, 0.0025, -0.0012],                                        // upper eyelid crease
        [0.028, 1.705, 0.020, 0.006, 0.0035], [0.058, 1.700, 0.010, 0.015, -0.002],     // brow ridge, temples
        [0, 1.680, 0.007, 0.016, 0.0028], [0, 1.662, 0.010, 0.008, 0.003],              // nose bridge and tip
        [0.012, 1.655, 0.006, 0.005, 0.002], [0, 1.650, 0.010, 0.003, -0.0022],         // nostril wings, under the nose
        [0.046, 1.665, 0.015, 0.010, 0.0045], [0.045, 1.635, 0.013, 0.012, -0.003],     // cheekbones, and the hollow below
        [0.021, 1.641, 0.004, 0.010, -0.0018], [0, 1.643, 0.003, 0.004, -0.0008],       // smile lines, philtrum
        [0, 1.634, 0.015, 0.0035, 0.002], [0, 1.622, 0.013, 0.004, 0.0028], [0, 1.628, 0.017, 0.0014, -0.0016], // lips
        [0, 1.604, 0.013, 0.009, 0.0035], [0.05, 1.612, 0.010, 0.014, 0.0015],          // chin, jawline
      ],
      // shading worked into the skin where light doesn't reach (a multiplier taken off: x, y, spread, strength)
      shade: [
        [0.031, 1.690, 0.015, 0.011, 0.32], [0.016, 1.687, 0.006, 0.008, 0.28],          // eye sockets, inner corners
        [0.012, 1.655, 0.005, 0.005, 0.3], [0, 1.649, 0.011, 0.004, 0.25],                // beside the nostrils, under the nose
        [0.017, 1.628, 0.004, 0.004, 0.3], [0, 1.628, 0.016, 0.0016, 0.3],                // mouth corners, the line of the lips
        [0, 1.616, 0.012, 0.003, 0.2], [0.021, 1.641, 0.004, 0.010, 0.15],                // under the lower lip, smile lines
        [0, 1.593, 0.03, 0.008, 0.25], [0.045, 1.636, 0.013, 0.010, 0.12],                // under the chin, cheek hollows
      ],
    },
    landmarks: mirrorLM({
      hips: [0, 0.97, 0], spine: [0, 1.13, 0], chest: [0, 1.32, 0], neck: [0, 1.56, 0.01], head: [0, 1.63, 0.03],
      armL: [0.13, 1.48, -0.02], elbowL: [0.42, 1.27, -0.03], handL: [0.6, 1.03, 0.02],
      thighL: [0.09, 0.9, 0], kneeL: [0.11, 0.53, -0.03], footL: [0.16, 0.09, 0],
    }),
    torso: { x: 0.2, y0: 0.45, y1: 1.4, z: 0.2 },
  },
  poseidon: {
    url: 'assets/poseidon/poseidon_opt.glb', type: 'glb', height: LM_H, label: 'Poseidon',
    landmarks: {
      hips: [0, 0.95, -0.14], spine: [0, 1.13, -0.15], chest: [0, 1.31, -0.15], neck: [0, 1.53, -0.16], head: [0, 1.62, -0.13],
      armL: [0.23, 1.45, -0.2], elbowL: [0.33, 1.18, -0.27], handL: [0.4, 0.93, -0.22],
      armR: [-0.22, 1.45, -0.18], elbowR: [-0.24, 1.3, 0.06], handR: [-0.33, 1.28, 0.31],
      thighL: [0.13, 0.9, -0.15], kneeL: [0.18, 0.56, -0.2], footL: [0.21, 0.13, -0.22],
      thighR: [-0.13, 0.9, -0.12], kneeR: [-0.12, 0.56, -0.08], footR: [-0.15, 0.13, -0.07],
    },
    // the orb of water rides in his right hand
    rigid: [{ bone: 'handR', test: (x, y, z) => (x + 0.36) ** 2 + (y - 1.44) ** 2 + (z - 0.42) ** 2 < 0.04 }],
    torso: { x: 0.24, y0: 0.2, y1: 1.35, z: 0.22 },
  },
  // Hermes (God of War III): tunic, winged helm and sandals, two sash streamers. T-pose, turned to face +Z
  hermes: {
    url: 'assets/hermes/hermes.glb', type: 'glb', height: LM_H, rotY: -Math.PI / 2, label: 'Hermes',
    // his left hand is sculpted flat and open: its fingers are closed into a fist round the caduceus
    // (knuckle line, finger centre height and spread on the sheet; the staff's radius and a finger's half-thickness)
    grip: { L: { knuckle: 0.755, y: 1.477, y0: 1.44, y1: 1.52, z0: -0.03, z1: 0.095, zc: 0.035, rod: 0.014, finger: 0.012 } },
    landmarks: mirrorLM({
      hips: [0, 1.0, 0.08], spine: [0, 1.18, 0.08], chest: [0, 1.38, 0.08], neck: [0, 1.57, 0.07], head: [0, 1.64, 0.06],
      armL: [0.14, 1.52, 0.06], elbowL: [0.37, 1.49, 0.05], handL: [0.65, 1.47, 0.05],
      thighL: [0.09, 0.95, 0.08], kneeL: [0.1, 0.57, 0.1], footL: [0.13, 0.15, 0.06],
    }),
    rigid: [
      { bone: 'head', test: (x, y) => y > 1.6 && Math.abs(x) < 0.16 },
      // the sash streamers hang from the belt and sway with the hips, not the legs
      { bone: 'hips', test: (x, y) => y > 0.38 && y < 1.05 && Math.abs(x) > 0.14 + (1.02 - y) * 0.75 },
    ],
  },
  // Hades as he comes to Olympus: crowned, robed in black, bident in his left hand
  hadesKing: {
    url: 'assets/hades2/hades2.glb', type: 'glb', height: LM_H, label: 'Hades',
    landmarks: {
      hips: [0, 0.95, -0.14], spine: [0, 1.1, -0.13], chest: [0, 1.27, -0.13], neck: [0, 1.47, -0.09], head: [0, 1.55, -0.06],
      armL: [0.2, 1.42, -0.14], elbowL: [0.29, 1.18, -0.18], handL: [0.4, 1.15, 0.08],
      armR: [-0.19, 1.42, -0.13], elbowR: [-0.33, 1.29, 0.02], handR: [-0.42, 1.47, 0.22],
      thighL: [0.1, 0.9, -0.15], kneeL: [0.1, 0.52, -0.22], footL: [0.14, 0.21, -0.28],
      thighR: [-0.1, 0.9, -0.12], kneeR: [-0.16, 0.52, -0.05], footR: [-0.24, 0.21, -0.06],
    },
    // the bident runs floor to crown through his left fist; its forked head is wider than the shaft
    weapon: { hand: 'handL', segs: [[[0.3, 0.0, 0.1], [0.38, 1.5, 0.1], 0.05], [[0.38, 1.48, 0.1], [0.4, 1.86, 0.1], 0.15]], base: [0.35, 0.9, 0.1], tip: [0.39, 1.8, 0.1] },
    rigid: [
      // crown, curls and beard ride on the skull
      { bone: 'head', test: (x, y, z) => y > 1.5 && Math.abs(x) < 0.2 && z > -0.36 },
      { bone: 'hips', test: (x, y, z) => z < -0.32 && y < 1.0 },
    ],
    torso: { x: 0.22, y0: 0.2, y1: 1.36, z: 0.26 },
  },
  // ---- Ariel's ordinary life
  // Anna Stormborn, his mother (an A-posed figure, auto-skinned; her flared skirt swings with her hips)
  anna: { url: 'assets/anna/anna.glb', type: 'glb', height: 1.74, label: 'Anna', ...WOMAN_SHEET },
  // Jesse: the same figure in her own clothes, wearing her own (sculpted) head
  jesse: { url: 'assets/jesse/jesse.glb', type: 'glb', height: 1.64, label: 'Jesse', ...WOMAN_SHEET },
  // a classmate with his own skeleton (Ready Player Me naming is Mixamo's)
  classmateBoy: {
    url: 'assets/npc/boy.glb', type: 'glb', height: 1.8, label: 'Westbrook High',
    bones: { hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head', ...MIXAMO_LIMBS },
    tips: { handL: 'LeftHandMiddle1', handR: 'RightHandMiddle1', footL: 'LeftToeBase', footR: 'RightToeBase' },
  },
  // Principal Steinback (an Avaturn avatar: Mixamo naming too)
  principal: {
    url: 'assets/npc/principal.glb', type: 'glb', height: 1.82, label: 'Westbrook High',
    bones: { hips: 'Hips', spine: 'Spine', chest: 'Spine2', neck: 'Neck', head: 'Head', ...MIXAMO_LIMBS },
    tips: { handL: 'LeftHandMiddle1', handR: 'RightHandMiddle1', footL: 'LeftToeBase', footR: 'RightToeBase' },
  },
  // a posed figure, placed as she is (no rig): a classmate by the vending machine
  classmateGirl: { url: 'assets/npc/girl.glb', type: 'glb', label: 'Westbrook High', static: true },
  // newborn Ariel, asleep (34 cm curled up, centred on his middle; head +Y, face +Z)
  baby: { url: 'assets/memory/baby.glb', type: 'glb', label: 'Anna', static: true },
  kronos: {
    url: 'assets/kronos/kronos_opt.glb', type: 'glb', height: LM_H, label: 'Kronos',
    landmarks: {
      hips: [0, 0.9, -0.02], spine: [0, 1.07, -0.02], chest: [0, 1.27, -0.02], neck: [0, 1.52, 0], head: [0, 1.62, 0.03],
      armL: [0.27, 1.43, -0.03], elbowL: [0.42, 1.2, -0.04], handL: [0.51, 0.98, 0.06],
      armR: [-0.27, 1.43, -0.03], elbowR: [-0.42, 1.2, -0.04], handR: [-0.51, 0.98, 0.06],
      thighL: [0.14, 0.86, -0.02], kneeL: [0.2, 0.6, 0.02], footL: [0.23, 0.13, -0.03],
      thighR: [-0.15, 0.86, -0.02], kneeR: [-0.22, 0.6, 0.02], footR: [-0.26, 0.13, -0.03],
    },
    torso: { x: 0.25, y0: 0.55, y1: 1.35, z: 0.25 },
  },
};

const Models = {
  loaded: {}, // key → template; every character gets its own clone of it
  failed: false,
  has(k) { return !!this.loaded[k]; },

  async load(progress) {
    const fbx = new Addons.FBXLoader(), glb = new Addons.GLTFLoader();
    const keys = Object.keys(MODEL_DEFS);
    let done = 0;
    progress('Summoning the gods…', 0.88);
    // motion-captured clips, retargeted onto the rig (see loadMotion)
    this.loadMotion('texting', 'assets/anim/texting.json');
    // the full-body model whose arms some sculpts wear (see graftArms): measured before any model is prepared
    const donorUrl = keys.map((k) => MODEL_DEFS[k].arms && MODEL_DEFS[k].arms.url).find(Boolean);
    if (donorUrl) try { await this.loadDonor(glb, donorUrl); } catch (e) { console.warn('arm donor failed', e); this.donor = null; }
    await Promise.all(keys.map(async (k) => {
      const d = MODEL_DEFS[k];
      try {
        const obj = d.type === 'fbx' ? await fbx.loadAsync(d.url) : (await glb.loadAsync(d.url)).scene;
        this.loaded[k] = this.prepare(obj, d);
      } catch (e) {
        console.warn('Model failed to load:', k, e);
        this.failed = true;
      }
      done++;
      progress('Summoning ' + (d.label || { arielGod: 'Ariel', arielTeen: 'Westbrook High' }[k] || k) + '…', 0.88 + (done / keys.length) * 0.06);
    }));
  },

  /**
   * A motion-captured clip baked onto the rig's joints (rig angles in degrees per frame, then the hip
   * offset in metres): registered as a looping clip, so the rig plays it like any other. Retargeted from
   * Mixamo with arm IK, so hands meet where the source's hands meet whatever the character's proportions.
   */
  async loadMotion(name, url) {
    try {
      const m = await (await fetch(url)).json(), dt = 1 / m.fps, n = m.frames.length;
      const keys = m.frames.map((f, i) => {
        const o = {};
        m.joints.forEach((j, k) => { o[j] = [f[k * 3], f[k * 3 + 1], f[k * 3 + 2]]; });
        o.hp = f.slice(m.joints.length * 3);
        return [i / n, o, 'lin'];
      });
      keys.push([1, keys[0][1], 'lin']);
      CLIPS[name] = { dur: n * dt, loop: true, keys };
      // the same arms, held still: the hands together in front of the body (a mug, a phone)
      CLIPS[name + 'Hold'] = { dur: 0.6, hold: true, mask: 'arms', keys: [[0, {}], [1, keys[Math.floor(n * 0.3)][1]]] };
    } catch (e) { /* opened from disk: the hand-made poses stand in */ }
  },

  /** materials → PBR, shadows, hidden props, one shared skeleton */
  prepare(obj, d) {
    const cache = new Map();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (d.hide && d.hide.test(o.name)) { o.visible = false; return; }
      // stray export debris (a lone triangle) would hang in the air once the sculpt moves
      if (d.landmarks && o.geometry.attributes.position.count < 12) { o.visible = false; return; }
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;
      if (d.type === 'fbx') {
        const conv = (m) => { if (!cache.has(m)) cache.set(m, this.toStandard(m)); return cache.get(m); };
        o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      } else {
        if (d.smooth) o.geometry = this.subdivide(o.geometry, d.smooth);
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => {
          m.envMapIntensity = 0.75; m.roughness = Math.max(m.roughness, 0.3);
          if (d.enhance && m.map && !cache.has(m.map)) cache.set(m.map, this.enhance(m.map, d.enhance));
          if (d.enhance && m.map) m.map = cache.get(m.map);
        });
        if (d.material) {
          const conv = (m) => { if (!cache.has(m)) cache.set(m, d.material(m)); return cache.get(m); };
          o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
        }
      }
    });
    if (d.relief) this.relief(obj, d);
    if (d.grip) this.curlGrip(obj, d);
    if (d.arms && this.donor && !d._graft) this.graftArms(obj, d);
    if (d.arms && d._graft) this.trimArms(obj, d);
    // FBX exports often give every mesh piece its own copy of the skeleton:
    // drive the biggest visible mesh's skeleton and re-attach the other pieces to it
    const meshes = [];
    obj.updateMatrixWorld(true);
    obj.traverse((o) => { if (o.isSkinnedMesh && o.visible) meshes.push(o); });
    // some exporters write a bind matrix that disagrees with the skeleton's frame:
    // bind every piece in the frame its bones actually live in
    meshes.forEach((m) => m.bind(m.skeleton, m.matrixWorld.clone()));
    if (meshes.length) {
      meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
      const main = meshes[0].skeleton;
      const byName = new Map(main.bones.map((b) => [b.name, b]));
      for (const m of meshes.slice(1)) {
        if (m.skeleton === main) continue;
        const bones = m.skeleton.bones.map((b) => byName.get(b.name) || b);
        m.bind(new THREE.Skeleton(bones, m.skeleton.boneInverses), m.bindMatrix);
      }
      // nested duplicate skeletons: give every bone its logical parent from the main skeleton
      for (const b of main.bones) {
        let p = b.parent;
        while (p && p.name === b.name) p = p.parent;
        const target = p && byName.get(p.name);
        if (target && target !== b.parent) target.attach(b);
      }
      obj.updateMatrixWorld(true);
      // marked rather than stored: userData is JSON-copied when the template is cloned
      meshes[0].userData.mainSkin = true;
      // height of the bind pose in skeleton units (to convert centimetres of armour into model units)
      const box = new THREE.Box3(), b = new THREE.Box3();
      for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(b.copy(m.geometry.boundingBox).applyMatrix4(m.bindMatrix)); }
      obj.userData.bindH = box.max.y - box.min.y;
    }
    return obj;
  },

  /**
   * Smooth a low-poly model: each pass splits every triangle in four and lifts each new edge point
   * onto the curved surface its end normals describe (PN triangles), so faceted cheeks, noses and jaws
   * come out round. Points are placed from the welded surface, so a UV seam never opens a crack.
   */
  subdivide(g, passes = 1) {
    for (let p = 0; p < passes; p++) g = this.subdividePass(g);
    return g;
  },
  subdividePass(g) {
    const pos = g.attributes.position, uv = g.attributes.uv, n = pos.count;
    const idx = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
    // welded points: both sides of a seam share one position and one smooth normal
    const weld = new Int32Array(n), keys = new Map(), P = [];
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
      let w = keys.get(key);
      if (w === undefined) { w = keys.size; keys.set(key, w); P.push(x, y, z); }
      weld[i] = w;
    }
    const N = new Float32Array(keys.size * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = weld[idx[t]] * 3, b = weld[idx[t + 1]] * 3, c = weld[idx[t + 2]] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;   // area-weighted
      for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    for (let k = 0; k < N.length; k += 3) { const l = Math.hypot(N[k], N[k + 1], N[k + 2]) || 1; N[k] /= l; N[k + 1] /= l; N[k + 2] /= l; }
    const outP = Array.from(pos.array), outUV = uv ? Array.from(uv.array) : null, mids = new Map(), tris = [];
    const edge = (i, j) => {
      const key = i < j ? i * n + j : j * n + i;
      let m = mids.get(key);
      if (m !== undefined) return m;
      const a = weld[i] * 3, b = weld[j] * 3, d = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const w12 = d[0] * N[a] + d[1] * N[a + 1] + d[2] * N[a + 2], w21 = -(d[0] * N[b] + d[1] * N[b + 1] + d[2] * N[b + 2]);
      // midpoint of the cubic edge: (P1 + P2) / 2 − (w12·N1 + w21·N2) / 8
      for (let k = 0; k < 3; k++) outP.push((P[a + k] + P[b + k]) / 2 - (w12 * N[a + k] + w21 * N[b + k]) / 8);
      if (outUV) outUV.push((uv.getX(i) + uv.getX(j)) / 2, (uv.getY(i) + uv.getY(j)) / 2);
      m = outP.length / 3 - 1;
      mids.set(key, m);
      return m;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2], ab = edge(a, b), bc = edge(b, c), ca = edge(c, a);
      tris.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(outP, 3));
    if (outUV) out.setAttribute('uv', new THREE.Float32BufferAttribute(outUV, 2));
    out.setIndex(new THREE.Uint32BufferAttribute(tris, 1));
    for (const gr of g.groups) out.addGroup(gr.start * 4, gr.count * 4, gr.materialIndex);
    this.smoothNormals(out);
    return out;
  },
  /**
   * Sculpt relief into a face: gaussian bumps and hollows given on the landmark sheet (feet at 0,
   * LM_H tall, facing +Z, x mirrored), pushed along the surface normal of the front-facing skin only.
   */
  relief(obj, d) {
    const R = d.relief, r = d.rotY || 0, c = Math.cos(r), sn = Math.sin(r);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), s = (box.max.y - box.min.y) / LM_H, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const v = new THREE.Vector3(), nm = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.isMesh || ![].concat(o.material).some((m) => R.mesh.test(m.name))) return;
      const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, inv = o.matrixWorld.clone().invert(), nmat = new THREE.Matrix3().getNormalMatrix(o.matrixWorld);
      // depth painted in as well: the hollows darkened (vertex colour, white everywhere else)
      const col = R.shade ? new Float32Array(P.count * 3).fill(1) : null;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
        const lx = (v.x - cx) / s, y = (v.y - box.min.y) / s, lz = (v.z - cz) / s;
        const x = lx * c + lz * sn, z = -lx * sn + lz * c;
        if (Math.abs(x) > R.box.x || y < R.box.y0 || y > R.box.y1 || z < R.box.z) continue;
        if (col) {
          let k = 1;
          for (const [bx, by, sx, sy, a] of R.shade) { const dx = (Math.abs(x) - bx) / sx, dy = (y - by) / sy; k *= 1 - a * Math.exp(-(dx * dx + dy * dy)); }
          col[i * 3] = k; col[i * 3 + 1] = k * 0.97 + 0.03 * k * k; col[i * 3 + 2] = k * 0.95 + 0.05 * k * k;
        }
        nm.fromBufferAttribute(N, i).applyMatrix3(nmat).normalize();
        const facing = smooth(0.15, 0.55, -nm.x * sn + nm.z * c);
        if (facing <= 0) continue;
        let h = 0;
        for (const [bx, by, sx, sy, a] of R.shape) { const dx = (Math.abs(x) - bx) / sx, dy = (y - by) / sy; h += a * Math.exp(-(dx * dx + dy * dy)); }
        v.addScaledVector(nm, h * s * facing).applyMatrix4(inv);
        P.setXYZ(i, v.x, v.y, v.z);
      }
      this.smoothNormals(g);
      if (col) { g.setAttribute('color', new THREE.BufferAttribute(col, 3)); [].concat(o.material).forEach((m) => { m.vertexColors = true; }); }
    });
  },
  /**
   * Close a sculpt's flat, open hand into a fist round a pole. On the sheet's T-pose the fingers run out
   * along ±x from the knuckle line, palm down; each finger is bent like a beam round the pole's axis
   * (which runs along z, just under the knuckles), so its tip comes back under the palm.
   */
  curlGrip(obj, d) {
    const r = d.rotY || 0, c = Math.cos(r), sn = Math.sin(r);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), s = (box.max.y - box.min.y) / LM_H, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const v = new THREE.Vector3();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, P = g.attributes.position, inv = o.matrixWorld.clone().invert();
      let moved = 0;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
        const lx = (v.x - cx) / s, y = (v.y - box.min.y) / s, lz = (v.z - cz) / s;
        let x = lx * c + lz * sn;
        const z = -lx * sn + lz * c;
        for (const S in d.grip) {
          const H = d.grip[S], sg = S === 'L' ? 1 : -1, ax = x * sg;
          if (ax <= H.knuckle || y < H.y0 || y > H.y1 || z < H.z0 || z > H.z1) continue;
          const R = H.rod + H.finger, phi = (ax - H.knuckle) / R, rho = R + (y - H.y);
          x = sg * (H.knuckle + rho * Math.sin(phi));
          const ny = H.y - R + rho * Math.cos(phi);
          v.set((x * c - z * sn) * s + cx, ny * s + box.min.y, (x * sn + z * c) * s + cz).applyMatrix4(inv);
          P.setXYZ(i, v.x, v.y, v.z);
          moved++;
        }
      }
      if (moved) { if (g.index) this.smoothNormals(g); else g.computeVertexNormals(); }
    });
  },
  /** vertex normals averaged across seams (a split normal shows as a crease down the face) */
  smoothNormals(g) {
    const pos = g.attributes.position, n = pos.count, idx = g.index.array, keys = new Map(), weld = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
      let w = keys.get(key); if (w === undefined) { w = keys.size; keys.set(key, w); }
      weld[i] = w;
    }
    const N = new Float32Array(keys.size * 3), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      a.fromBufferAttribute(pos, idx[t]); b.fromBufferAttribute(pos, idx[t + 1]); c.fromBufferAttribute(pos, idx[t + 2]);
      c.sub(a); b.sub(a); b.cross(c);
      for (let k = 0; k < 3; k++) { const w = weld[idx[t + k]] * 3; N[w] += b.x; N[w + 1] += b.y; N[w + 2] += b.z; }
    }
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const w = weld[i] * 3, l = Math.hypot(N[w], N[w + 1], N[w + 2]) || 1;
      out[i * 3] = N[w] / l; out[i * 3 + 1] = N[w + 1] / l; out[i * 3 + 2] = N[w + 2] / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  },
  /** a small texture redrawn larger, softly upsampled, then sharpened (unsharp mask) so the paint reads crisp */
  enhance(tex, scale = 4) {
    const img = tex.image;
    if (!img || !img.width || img.width > 512) return tex;
    const w = img.width * scale, h = img.height * scale;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, w, h);
    const sharp = cx.getImageData(0, 0, w, h);
    const bl = document.createElement('canvas'); bl.width = w; bl.height = h;
    const bx = bl.getContext('2d'); bx.filter = `blur(${scale * 0.6}px)`; bx.drawImage(cv, 0, 0);
    const soft = bx.getImageData(0, 0, w, h).data, px = sharp.data;
    for (let i = 0; i < px.length; i += 4) for (let k = 0; k < 3; k++) px[i + k] = Math.max(0, Math.min(255, px[i + k] + (px[i + k] - soft[i + k]) * 0.9));
    cx.putImageData(sharp, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
    t.anisotropy = 8;
    return t;
  },

  /** relax a rigged model's hands: curl the fingers toward the palm (degrees per joint); sides: ['Left'] etc. */
  curlFingers(binding, deg = 28, thumbDeg = 12, sides = ['Left', 'Right']) {
    // the bones the mesh is actually skinned to (these rips carry unused duplicate skeletons)
    const bones = {};
    if (!binding || !binding.model || !binding.model.userData.skeleton) return; // sculpts have no finger bones
    for (const b of binding.model.userData.skeleton.bones) if (!bones[b.name]) bones[b.name] = b;
    binding.rig.root.updateMatrixWorld(true);
    const wp = (b) => b.getWorldPosition(new THREE.Vector3());
    const q = new THREE.Quaternion(), pq = new THREE.Quaternion(), wq = new THREE.Quaternion();
    for (const side of sides) {
      // God of War rips (JOLeftIndexA1) or Mixamo rigs (LeftHandIndex1)
      const B = (f, k) => bones[`JO${side}${f}A${k}`] || bones[`${side}Hand${f}${k}`];
      if (!B('Index', 1) || !B('Ring', 1) || !B('Middle', 2) || !B('Thumb', 1)) continue;
      const f = wp(B('Middle', 2)).sub(wp(B('Middle', 1))).normalize();
      const lat = wp(B('Index', 1)).sub(wp(B('Ring', 1))).normalize();
      // the palm is on the thumb's side of the knuckle line
      const nrm = new THREE.Vector3().crossVectors(f, lat).normalize();
      if (nrm.dot(wp(B('Thumb', 1)).sub(wp(B('Index', 1)))) < 0) nrm.negate();
      const axis = new THREE.Vector3().crossVectors(f, nrm).normalize();
      const turn = (b, a) => {
        q.setFromAxisAngle(axis, a * DEG);
        b.getWorldQuaternion(wq); b.parent.getWorldQuaternion(pq);
        b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
        b.updateMatrixWorld(true);
      };
      for (const fin of ['Index', 'Middle', 'Ring', 'Pinky']) for (let k = 1; k <= 3; k++) if (B(fin, k)) turn(B(fin, k), deg * (k === 1 ? 0.8 : 1) * (fin === 'Pinky' ? 1.15 : 1));
      for (let k = 2; k <= 3; k++) if (B('Thumb', k)) turn(B('Thumb', k), thumbDeg);
    }
  },

  /** posed world positions of a rigged model's vertices whose main bone matches re */
  posedPoints(binding, re) {
    const out = [], v = new THREE.Vector3();
    binding.rig.root.updateMatrixWorld(true);
    binding.holder.traverse((m) => {
      if (!m.isSkinnedMesh || !m.visible || m.userData.shell) return;
      const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, n = m.geometry.attributes.position.count;
      m.skeleton.update();
      for (let i = 0; i < n; i += 2) {
        let bi = 0, bw = -1;
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; bi = si.getComponent(i, k); } }
        if (!re.test(m.skeleton.bones[bi].name)) continue;
        m.getVertexPosition(i, v);
        out.push(v.clone().applyMatrix4(m.matrixWorld));
      }
    });
    return out;
  },
  /** a fresh copy of a loaded model (geometry and materials are shared) */
  instance(key, ownMaterials) {
    const d = MODEL_DEFS[key], tpl = this.loaded[key];
    const m = d.landmarks ? tpl.clone() : Addons.SkeletonUtils.clone(tpl);
    m.traverse((o) => { if (o.isSkinnedMesh && o.userData.mainSkin) m.userData.skeleton = o.skeleton; });
    if (ownMaterials) {
      const cache = new Map();
      const own = (x) => { if (!cache.has(x)) cache.set(x, x.clone()); return cache.get(x); };
      m.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); });
    }
    return m;
  },
  /** glowing rim at grazing angles (shades of Tartarus, divine apparitions) */
  rim(m, color, power, strength) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      if (prev) prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
        outgoingLight += vec3(${color.map((c) => c.toFixed(3)).join(', ')}) * pow(rimF, ${power.toFixed(2)}) * ${strength.toFixed(2)};
        #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => 'rim' + color.join(',') + power + strength;
    m.needsUpdate = true;
    return m;
  },
  toStandard(m) {
    const n = (m.name || '').toLowerCase();
    const s = new THREE.MeshStandardMaterial({
      name: m.name, map: m.map || null, normalMap: m.normalMap || null,
      color: m.map ? 0xffffff : (m.color || new THREE.Color(0x888888)),
      roughness: 0.7, metalness: 0, envMapIntensity: 0.9, side: m.side,
    });
    if (s.map) s.map.colorSpace = THREE.SRGBColorSpace;
    if (/metal|armor|gold|bronze/.test(n)) { s.metalness = 0.75; s.roughness = 0.38; }
    else if (/skin|body|head/.test(n)) s.roughness = 0.58;
    else if (/eye(?!lash)|cornea/.test(n)) s.roughness = 0.12;
    else if (/cloth|leather|outfit|polo|jeans/.test(n)) s.roughness = 0.85;
    if (/cornea/.test(n)) { s.transparent = true; s.opacity = 0.15; s.depthWrite = false; }
    if (/hair|lash|alpha|brow|beard/.test(n)) { s.alphaTest = 0.45; s.side = THREE.DoubleSide; s.transparent = false; }
    if (/eyelash/.test(n) && !s.map) { s.color.set(0x111111); }
    return s;
  },

  /**
   * Put a loaded model on a Rig: fit the rig's skeleton to the model's
   * proportions, find the rotation offsets between them, and hide the
   * procedural body. keep: objects (weapons…) that stay visible.
   */
  attach(rig, key, { keep = [], ownMaterials = false } = {}) {
    const d = MODEL_DEFS[key];
    if (!this.loaded[key]) return null;
    const model = this.instance(key, ownMaterials);
    const root = rig.root;
    const saved = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone(), parent: root.parent };
    if (saved.parent) saved.parent.remove(root);
    root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
    rig.act = null; rig.prev = null;
    rig.apply(new Float32Array(POSE_LEN));
    root.updateMatrixWorld(true);

    const holder = new THREE.Group(), inner = new THREE.Group();
    holder.add(inner); inner.add(model); root.add(holder);
    if (d.rotY) inner.rotation.y = d.rotY;
    holder.updateMatrixWorld(true);

    let binding;
    if (d.landmarks) binding = this.autoSkin(rig, d, model, holder);
    else binding = this.retarget(rig, d, model, holder);

    // hide the procedural body but keep weapons and other requested objects
    const keepSet = new Set();
    keep.filter(Boolean).forEach((o) => o.traverse((c) => keepSet.add(c)));
    root.traverse((o) => {
      if (!o.isMesh || keepSet.has(o)) return;
      let p = o.parent, isModel = false;
      while (p) { if (p === holder) { isModel = true; break; } p = p.parent; }
      if (!isModel) o.visible = false;
    });

    rig.apply(new Float32Array(POSE_LEN));
    rig.act = null; rig.prev = null;
    root.position.copy(saved.p); root.quaternion.copy(saved.q); root.scale.copy(saved.s);
    if (saved.parent) saved.parent.add(root);
    root.updateMatrixWorld(true);
    binding.holder = holder;
    binding.key = key;
    binding.model = model;
    // cull characters that are off screen (and out of the shadow area) instead of drawing every model, always:
    // the bind-pose sphere, widened for swinging limbs and weapons
    holder.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      m.boundingSphere = m.geometry.boundingSphere.clone();
      m.boundingSphere.radius *= 1.6;
      m.frustumCulled = true;
    });
    binding.update();
    return binding;
  },

  /** scale the model to d.height with its feet on y=0 and its hips on the rig's axis */
  fitModel(d, model, holder, hipsWorld) {
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3();
    model.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
    const k = d.height / (box.max.y - box.min.y);
    holder.scale.setScalar(k);
    holder.updateMatrixWorld(true);
    box.makeEmpty();
    model.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
    const c = hipsWorld ? hipsWorld() : box.getCenter(new THREE.Vector3());
    holder.position.set(-c.x, -box.min.y, -c.z);
    if (d.shift) holder.position.add(new THREE.Vector3(...d.shift));
    holder.updateMatrixWorld(true);
  },

  /** set rig joint offsets from landmark positions (rig in zero pose, root at identity) */
  fitRig(rig, L) {
    const J = rig.j, V = (a) => (a.isVector3 ? a : new THREE.Vector3(...a));
    const P = {};
    for (const k in L) P[k] = V(L[k]);
    J.hips.position.copy(P.hips);
    J.spine.position.copy(P.spine).sub(P.hips);
    J.chest.position.copy(P.chest).sub(P.spine);
    J.neck.position.copy(P.neck).sub(P.chest);
    J.head.position.copy(P.head).sub(P.neck);
    for (const S of ['L', 'R']) {
      J['arm' + S].position.copy(P['arm' + S]).sub(P.chest);
      J['elbow' + S].position.set(0, -P['elbow' + S].distanceTo(P['arm' + S]), 0);
      J['hand' + S].position.set(0, -P['hand' + S].distanceTo(P['elbow' + S]), 0);
      J['thigh' + S].position.copy(P['thigh' + S]).sub(P.hips);
      J['knee' + S].position.set(0, -P['knee' + S].distanceTo(P['thigh' + S]), 0);
      J['foot' + S].position.set(0, -P['foot' + S].distanceTo(P['knee' + S]), 0);
    }
    rig.hipRest.copy(J.hips.position);
    rig.root.updateMatrixWorld(true);
    return P;
  },

  /** rotate the rig's limbs so they point where the model's limbs point */
  alignRig(rig, P, tips) {
    const J = rig.j;
    const wq = new THREE.Quaternion(), pq = new THREE.Quaternion(), q = new THREE.Quaternion();
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const chain = [];
    for (const S of ['L', 'R']) chain.push(['arm' + S, 'elbow' + S], ['elbow' + S, 'hand' + S], ['hand' + S, null], ['thigh' + S, 'knee' + S], ['knee' + S, 'foot' + S], ['foot' + S, null]);
    for (const [j, c] of chain) {
      const want = c ? P[c].clone().sub(P[j]) : tips[j] ? tips[j].clone().sub(P[j]) : null;
      if (!want || want.lengthSq() < 1e-8) continue;
      J[j].getWorldPosition(a);
      if (c) J[c].getWorldPosition(b);
      else b.copy(j.startsWith('hand') ? new THREE.Vector3(0, -0.1, 0) : new THREE.Vector3(0, -0.05, 0.15)).applyMatrix4(J[j].matrixWorld);
      const cur = b.sub(a).normalize();
      q.setFromUnitVectors(cur, want.normalize());
      J[j].getWorldQuaternion(wq);
      J[j].parent.getWorldQuaternion(pq);
      J[j].quaternion.copy(pq.invert().multiply(q.multiply(wq)));
      rig.root.updateMatrixWorld(true);
    }
  },

  retarget(rig, d, model, holder) {
    const main = model.userData.skeleton;
    const bones = {};
    main.bones.forEach((b) => { if (!bones[b.name]) bones[b.name] = b; });
    // stand the model up and face it down +Z, judged from its own skeleton
    const inner = model.parent;
    holder.updateMatrixWorld(true);
    const wpos = (n) => bones[n].getWorldPosition(new THREE.Vector3());
    const up = wpos(d.bones.head).sub(wpos(d.bones.hips)).normalize();
    inner.quaternion.setFromUnitVectors(up, new THREE.Vector3(0, 1, 0));
    holder.updateMatrixWorld(true);
    const lr = wpos(d.bones.armL).sub(wpos(d.bones.armR));
    inner.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(lr.z, lr.x)));
    holder.updateMatrixWorld(true);
    const hb = bones[d.bones.hips];
    this.fitModel(d, model, holder, () => hb.getWorldPosition(new THREE.Vector3()));
    const pos = (n) => bones[n].getWorldPosition(new THREE.Vector3());
    const L = {};
    for (const j in d.bones) L[j] = pos(d.bones[j]);
    const tips = {};
    for (const j in d.tips) if (bones[d.tips[j]]) tips[j] = pos(d.tips[j]);
    const P = this.fitRig(rig, L);
    this.alignRig(rig, P, tips);
    // offsets: bone world rotation relative to its rig joint in the matching pose
    const order = JOINTS.filter((j) => d.bones[j]);
    const map = order.map((j) => {
      const bone = bones[d.bones[j]];
      const jq = rig.j[j].getWorldQuaternion(new THREE.Quaternion());
      const bq = bone.getWorldQuaternion(new THREE.Quaternion());
      return { joint: rig.j[j], bone, offset: jq.invert().multiply(bq) };
    });
    return new ModelBinding(rig, map, bones[d.bones.hips]);
  },

  /**
   * Bind a static sculpt to the rig: vertices follow the nearest bones.
   * Weights are worked out once per geometry; later copies of the same model
   * (a pack of thralls) reuse them and only get their own bones.
   */
  autoSkin(rig, d, scene, holder) {
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
    this.fitModel(d, scene, holder, null);
    // landmark sheet → rig space: scaled to the model's height, hips on the rig's vertical axis
    const k = d.height / LM_H, ox = d.landmarks.hips[0], oz = d.landmarks.hips[2];
    holder.position.x -= ox * k; holder.position.z -= oz * k;
    holder.updateMatrixWorld(true);
    const toRig = (p) => new THREE.Vector3((p[0] - ox) * k, p[1] * k, (p[2] - oz) * k);
    const L = {};
    for (const j in d.landmarks) L[j] = toRig(d.landmarks[j]);
    const P = this.fitRig(rig, L);
    this.alignRig(rig, P, {});
    rig.root.updateMatrixWorld(true);
    const J = rig.j;
    // a sculpt standing in a natural pose keeps it: animation angles are applied on top of the sculpted
    // limbs instead of replacing them (T-posed sculpts keep the plain rig, where zero means arms down)
    if (d.restPose) rig.rest = JOINTS.map((n) => (J[n].quaternion.angleTo(new THREE.Quaternion()) > 1e-4 ? J[n].quaternion.clone() : null));
    // one bone per joint, glued to the joint
    const bones = JOINTS.map((n) => { const b = new THREE.Bone(); b.name = n; J[n].add(b); return b; });
    // a sculpted sword gets its own bone, pivoting in the fist at the grip (see the end of this function)
    let swordBone = null;
    if (d.sword) {
      swordBone = new THREE.Bone(); swordBone.name = 'sword';
      rig.root.updateMatrixWorld(true);
      J.handR.add(swordBone);
      swordBone.position.copy(J.handR.worldToLocal(toRig(d.sword.grip).applyMatrix4(rig.root.matrixWorld)));
      bones.push(swordBone);
    }
    rig.root.updateMatrixWorld(true);
    let ctx = null;
    const skeleton = new THREE.Skeleton(bones);
    const skinnedMeshes = [];
    let weapon = null;
    for (const src of meshes) {
      const g = src.geometry;
      if (!g.userData.skinned) {
        ctx = ctx || this.skinContext(rig, d, k, ox, oz, toRig);
        const toRoot = new THREE.Matrix4().copy(rig.root.matrixWorld).invert().multiply(src.matrixWorld);
        this.weigh(g, toRoot, ctx);
        g.userData.skinned = true;
      }
      // a sculpted weapon can be split off: shown, hidden and lit on its own
      const split = d.splitWeapon && g.userData.weaponVerts ? this.splitWeapon(g) : null;
      const parts = split ? [[split.body, src.material], [split.blade, d.weaponMaterial ? (d._wm || (d._wm = d.weaponMaterial(src.material))) : src.material]] : [[g, src.material]];
      parts.forEach(([geo, mat], pi) => {
        const skinned = new THREE.SkinnedMesh(geo, mat);
        skinned.name = src.name + (pi ? '_weapon' : '');
        skinned.castShadow = true; skinned.receiveShadow = true;
        skinned.frustumCulled = false;
        src.parent.add(skinned);
        skinned.position.copy(src.position); skinned.quaternion.copy(src.quaternion); skinned.scale.copy(src.scale);
        rig.root.updateMatrixWorld(true);
        skinned.bind(skeleton);
        if (pi) weapon = skinned; else skinnedMeshes.push(skinned);
      });
      src.parent.remove(src);
    }
    // the grafted arms (see graftArms), from the sheet into this rig, on the same skeleton
    if (d._graft) {
      rig.root.updateMatrixWorld(true);
      const toHolder = holder.matrixWorld.clone().invert(), nm = new THREE.Matrix3().getNormalMatrix(toHolder), v = new THREE.Vector3();
      const mat = d._graft.mat || (d._graft.mat = new THREE.MeshStandardMaterial({ map: d._graft.map, color: d._graft.tint, roughness: 0.6, envMapIntensity: 0.75 }));
      for (const S of ['L', 'R']) {
        const A = d._graft[S], pos = new Float32Array(A.pos.length), nor = new Float32Array(A.nor.length);
        for (let i = 0; i < A.pos.length; i += 3) {
          v.copy(toRig([A.pos[i], A.pos[i + 1], A.pos[i + 2]])).applyMatrix4(toHolder); pos.set([v.x, v.y, v.z], i);
          v.set(A.nor[i], A.nor[i + 1], A.nor[i + 2]).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], i);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(A.uv, 2));
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(A.si, 4));
        g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(A.sw, 4));
        g.setIndex(new THREE.Uint32BufferAttribute(A.idx, 1));
        const m = new THREE.SkinnedMesh(g, mat);
        m.name = 'arms' + S; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        holder.add(m);
        m.bind(skeleton);
        skinnedMeshes.push(m);
      }
    }
    // weapon markers (trails, flames, hit sparks) from the sculpted blade, in the right hand's frame
    const markers = {};
    const W = d.weapon ? { base: toRig(d.weapon.base), tip: toRig(d.weapon.tip) }
      : d.sword && d._swordTip ? { base: toRig(d.sword.grip).lerp(d._swordTip, 0.25), tip: d._swordTip.clone() } : null;
    if (W) {
      const hand = swordBone || J[(d.weapon && d.weapon.hand) || 'handR'];
      rig.root.updateMatrixWorld(true);
      for (const key of ['base', 'tip']) {
        const o = new THREE.Object3D();
        hand.add(o);
        o.position.copy(hand.worldToLocal(W[key].clone().applyMatrix4(rig.root.matrixWorld)));
        markers[key] = o;
      }
    }
    // a closed grip (see curlGrip): a marker in the fist, its y axis along the pole, for whatever it holds
    if (d.grip) for (const S in d.grip) {
      const H = d.grip[S], sg = S === 'L' ? 1 : -1, hand = J['hand' + S];
      rig.root.updateMatrixWorld(true);
      const o = new THREE.Object3D();
      hand.add(o);
      o.position.copy(hand.worldToLocal(toRig([sg * H.knuckle, H.y - H.rod - H.finger, H.zc]).applyMatrix4(rig.root.matrixWorld)));
      const along = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
      o.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(along));
      markers['grip' + S] = o;
    }
    // The sculpt holds its sword angled ~50° forward of the forearm; the game's stances and attacks are
    // made for a blade in line with the arm. Turn the sword in the fist, about the grip, to line it up.
    if (swordBone) {
      const wp = (n) => J[n].getWorldPosition(new THREE.Vector3());
      const fore = wp('handR').sub(wp('elbowR')).normalize();
      const tip = d._swordTip ? d._swordTip.clone().applyMatrix4(rig.root.matrixWorld) : toRig(d.sword.tip).applyMatrix4(rig.root.matrixWorld);
      const dir = tip.sub(toRig(d.sword.grip).applyMatrix4(rig.root.matrixWorld)).normalize();
      const qw = new THREE.Quaternion().setFromUnitVectors(dir, fore);
      const hq = J.handR.getWorldQuaternion(new THREE.Quaternion());
      swordBone.quaternion.copy(hq.clone().invert().multiply(qw).multiply(hq));
    }
    const binding = new ModelBinding(rig, [], null);
    binding.mesh = skinnedMeshes[0];
    binding.meshes = skinnedMeshes;
    binding.markers = markers;
    binding.weapon = weapon;
    return binding;
  },

  /** the full-body model whose arms some sculpts wear (d.arms.url), in its own landmark-sheet frame */
  async loadDonor(glb, url) {
    const sc = (await glb.loadAsync(url)).scene;
    sc.updateMatrixWorld(true);
    let mesh = null;
    sc.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    const b = g.boundingBox, s = (b.max.y - b.min.y) / LM_H;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.scale(1 / s, 1 / s, 1 / s);
    if (mesh.material.map) mesh.material.map.colorSpace = THREE.SRGBColorSpace;
    this.donor = { g, map: mesh.material.map, L: this.measureArm(g, 1), R: this.measureArm(g, -1) };
  },
  /**
   * A hanging arm, from horizontal slices: below the armpit the arm is whatever lies beyond the widest gap
   * from the torso. The wrist is its narrowest point above the hand, the elbow an adult forearm above that,
   * the shoulder an upper arm beyond the elbow, on the line up through the armpit.
   */
  measureArm(g, sg) {
    const P = g.attributes.position, step = 0.01, top = 1.6, rows = [];
    const bins = Array.from({ length: Math.ceil(top / step) + 2 }, () => []);
    for (let i = 0; i < P.count; i++) { const x = P.getX(i) * sg, y = P.getY(i); if (x > 0 && y < top) bins[Math.floor((top - y) / step)].push([x, P.getZ(i)]); }
    // every slice where something stands apart; the arm is the longest run of them (a thin slice can come up
    // empty, so a run survives a few misses; the gap between neck and shoulder makes only a short run)
    const runs = [];
    let run = [], miss = 0;
    for (let k = 0; k < bins.length; k++) {
      const pts = bins[k];
      let row = null;
      if (pts.length >= 6) {
        pts.sort((a, b) => a[0] - b[0]);
        let gi = -1, gm = 0.012;
        for (let i = 1; i < pts.length; i++) if (pts[i][0] - pts[i - 1][0] > gm) { gm = pts[i][0] - pts[i - 1][0]; gi = i; }
        if (gi > 0) {
          const arm = pts.slice(gi), xs = arm.map((p) => p[0]), zs = arm.map((p) => p[1]);
          const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), y = top - (k + 0.5) * step;
          row = { y, gap: pts[gi][0], c: new THREE.Vector3(sg * (x0 + x1) / 2, y, (z0 + z1) / 2), w: x1 - x0 };
        }
      }
      if (row) { run.push(row); miss = 0; }
      else if (run.length && ++miss > 3) { runs.push(run); run = []; miss = 0; }
    }
    if (run.length) runs.push(run);
    for (const r of runs) if (r.length > rows.length) rows.splice(0, rows.length, ...r);
    const tip = rows[rows.length - 1], pit = rows[0];
    let wr = null;
    for (const r of rows) if (r.y > tip.y + 0.12 && r.y < tip.y + 0.27 && (!wr || r.w < wr.w)) wr = r;
    const at = (y) => { let a = rows[0]; for (const r of rows) if (Math.abs(r.y - y) < Math.abs(a.y - y)) a = r; return a; };
    const el = at(wr.y + 0.245).c.clone();
    const sh = el.clone().addScaledVector(pit.c.clone().sub(el).normalize(), 0.28);
    return { sh, el, wr: wr.c.clone(), tip: tip.c.clone(), pitY: pit.y, rows, gapAt: (y) => at(y).gap };
  },
  /**
   * Arms for a sculpt from the full-body donor (d.arms): the sculpt's own arm mesh is measured where it
   * joins the body (the open ring at each shoulder, under the top's armholes) and hidden; the donor's
   * arms are cut at the matching ring and laid onto the sculpt's arm chain segment by segment (upper arm
   * onto shoulder→elbow, forearm onto elbow→wrist, the hand after it), blended at the joints, their own
   * skin texture tinted to the sculpt's. Kept on the sheet, with skin weights, for every copy (autoSkin).
   */
  graftArms(obj, d) {
    let arm = null;
    obj.traverse((o) => { if (o.isMesh && d.arms.hide.test(o.name)) arm = o; });
    if (!arm) return;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), s = (box.max.y - box.min.y) / LM_H, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
    const sheet = (v) => v.set((v.x - cx) / s, (v.y - box.min.y) / s, (v.z - cz) / s);
    // the open edge of the arm mesh, one ring per shoulder
    const P = arm.geometry.attributes.position, idx = arm.geometry.index ? arm.geometry.index.array : Array.from({ length: P.count }, (_, i) => i);
    const keys = new Map(), weld = new Int32Array(P.count), pts = [], v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(arm.matrixWorld); sheet(v);
      const key = `${Math.round(v.x * 2e4)},${Math.round(v.y * 2e4)},${Math.round(v.z * 2e4)}`;
      let w = keys.get(key); if (w === undefined) { w = keys.size; keys.set(key, w); pts.push(v.clone()); }
      weld[i] = w;
    }
    const edges = new Map();
    for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = weld[idx[t + e]], b = weld[idx[t + (e + 1) % 3]], key = a < b ? a * 1e6 + b : b * 1e6 + a;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    const ring = { L: [], R: [] };
    for (const [key, n] of edges) if (n === 1) for (const w of [Math.floor(key / 1e6), key % 1e6]) ring[pts[w].x > 0 ? 'L' : 'R'].push(pts[w]);
    const centre = (list) => list.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, list.length));
    // the sculpt's arm colour and the donor's, to tint the donor's skin to it
    const tone = this.averageColor(arm.material.map, arm.geometry.attributes.uv, 5);
    const D = this.donor, out = { map: D.map };
    for (const S of ['L', 'R']) out[S] = this.graftSide(d, D, S, centre(ring[S]));
    const dt = this.averageColor(D.map, D.g.attributes.uv, 5, out.L.used);
    // (the sculpt's skin texture is a good deal paler than the donor's: up to about twice as bright)
    // (a shade under it, toward the faces, which are a little warmer and darker than the body's texture)
    out.tint = tone && dt ? new THREE.Color(...['r', 'g', 'b'].map((c) => clamp(0.88 * tone[c] / Math.max(1e-4, dt[c]), 0.5, 2.4))) : new THREE.Color(1, 1, 1);
    d._graft = out;
  },
  /**
   * The sculpt's own arms go, all but a short collar at each shoulder, kept where the top covers it: it
   * fills the armhole under the fabric (where the new arm's root can't quite reach), and the new arm
   * carries on from inside it.
   */
  trimArms(obj, d) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj), s = (box.max.y - box.min.y) / LM_H, cx = (box.min.x + box.max.x) / 2;
    obj.traverse((o) => {
      if (!o.isMesh || !d.arms.hide.test(o.name) || o.userData.trimmed) return;
      const g = o.geometry, P = g.attributes.position, v = new THREE.Vector3(), keep = new Uint8Array(P.count);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
        keep[i] = Math.abs((v.x - cx) / s) < (d.arms.collar ?? 0.17) && (v.y - box.min.y) / s > 1.38 ? 1 : 0;
      }
      const idx = g.index ? g.index.array : Array.from({ length: P.count }, (_, i) => i), tri = [];
      for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) tri.push(idx[t], idx[t + 1], idx[t + 2]);
      g.setIndex(tri);
      o.userData.trimmed = true;
    });
  },
  graftSide(d, D, S, ringC) {
    const sg = S === 'L' ? 1 : -1, A = D[S], L = d.landmarks, V3 = (a) => new THREE.Vector3(...a);
    const Jsh = ringC.clone(), Jel = V3(L['elbow' + S]), Jwr = V3(L['hand' + S]);
    const dU = A.el.clone().sub(A.sh).normalize(), dF = A.wr.clone().sub(A.el).normalize();
    const jU = Jel.clone().sub(Jsh).normalize(), jF = Jwr.clone().sub(Jel).normalize();
    const RU = new THREE.Quaternion().setFromUnitVectors(dU, jU), RF = new THREE.Quaternion().setFromUnitVectors(dF, jF);
    const kU = Jel.distanceTo(Jsh) / A.el.distanceTo(A.sh), kF = Jwr.distanceTo(Jel) / A.wr.distanceTo(A.el), LF = A.wr.distanceTo(A.el), LJ = Jwr.distanceTo(Jel);
    // the sculpt's ring lies across the arm (on the plane x = const); carried back into the donor
    const nCut = new THREE.Vector3(sg, 0, 0).applyQuaternion(RU.clone().invert());
    const bC = JOINTS.indexOf('chest'), bA = JOINTS.indexOf('arm' + S), bE = JOINTS.indexOf('elbow' + S), bH = JOINTS.indexOf('hand' + S);
    const G = D.g, P = G.attributes.position, N = G.attributes.normal, UV = G.attributes.uv, idx = G.index.array;
    const map = new Int32Array(P.count).fill(-1), pos = [], nor = [], uv = [], si = [], sw = [], used = [];
    const p = new THREE.Vector3(), r = new THREE.Vector3(), u = new THREE.Vector3(), f = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Vector3();
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      const ax = p.x * sg;
      if (ax < 0.1) continue;
      // arm, not torso: below the armpit, what lies beyond the gap; above it, the shoulder past the cut
      if (p.y < A.pitY) { if (ax < A.gapAt(p.y) - 0.003 || p.y < A.tip.y - 0.03) continue; }
      else {
        // the shoulder: past the cut (reaching a little under the top), and close to the arm's own axis,
        // so none of the donor's chest comes along with it
        r.copy(p).sub(A.sh);
        const along = r.dot(dU), off = r.addScaledVector(dU, -along).length();
        if (r.copy(p).sub(A.sh).dot(nCut) < -0.03 || ax < 0.12 || p.y > A.sh.y + 0.07 || off > 0.062) continue;
      }
      // upper-arm placement, forearm placement, blended across the elbow; near the root the arm is drawn in
      // a little toward its axis, so it fills the armhole under the top without pushing out through it
      r.copy(p).sub(A.sh); const aU = r.dot(dU); r.addScaledVector(dU, -aU);
      r.multiplyScalar(0.92 + 0.08 * sm(0.0, 0.1, aU));
      u.copy(dU).multiplyScalar(aU < 0 ? aU : aU * kU).add(r).applyQuaternion(RU).add(Jsh);
      r.copy(p).sub(A.el); const aF = r.dot(dF); r.addScaledVector(dF, -aF);
      const hs = 1 - 0.06 * sm(LF - 0.01, LF + 0.03, aF);   // a slightly smaller hand
      if (aF <= LF) f.copy(dF).multiplyScalar(aF * kF).add(r.multiplyScalar(hs)).applyQuaternion(RF).add(Jel);
      else f.copy(dF).multiplyScalar(aF - LF).add(r).multiplyScalar(hs).applyQuaternion(RF).add(Jwr);
      const w = sm(-0.03, 0.03, aF);
      q.copy(u).lerp(f, w);
      n.fromBufferAttribute(N, i);
      const nu = n.clone().applyQuaternion(RU), nf = n.clone().applyQuaternion(RF);
      n.copy(nu).lerp(nf, w).normalize();
      map[i] = pos.length / 3; used.push(i);
      pos.push(q.x, q.y, q.z); nor.push(n.x, n.y, n.z); uv.push(UV.getX(i), UV.getY(i));
      // weights on the sculpt's chain: the chest at the root (moving with the torso's own skin), the upper
      // arm, the forearm past a short elbow blend, the hand past a shorter one at the wrist
      const sU = r.copy(q).sub(Jsh).dot(jU), sF = r.copy(q).sub(Jel).dot(jF);
      const c = 1 - sm(-0.03, 0.08, sU), e = sm(-0.03, 0.03, sF), h = sm(LJ - 0.015, LJ + 0.015, sF);
      const W = [[bC, (1 - e) * c], [bA, (1 - e) * (1 - c)], [bE, e * (1 - h)], [bH, h]].sort((a, b) => b[1] - a[1]);
      for (let k = 0; k < 4; k++) { si.push(W[k][0]); sw.push(W[k][1]); }
    }
    const tri = [];
    for (let t = 0; t < idx.length; t += 3) { const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]]; if (a >= 0 && b >= 0 && c >= 0) tri.push(a, b, c); }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), uv: new Float32Array(uv), si: new Uint16Array(si), sw: new Float32Array(sw), idx: new Uint32Array(tri), used };
  },
  /** average colour (linear) of a texture over a geometry's UVs (every nth vertex, or the listed ones) */
  averageColor(map, uv, every = 5, only = null) {
    const img = map && map.image;
    if (!img || !uv) return null;
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, 256, 256);
    const px = cx.getImageData(0, 0, 256, 256).data, lin = (x) => { x /= 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    let r = 0, g = 0, b = 0, k = 0;
    const list = only || Array.from({ length: Math.floor(uv.count / every) }, (_, i) => i * every);
    for (let j = 0; j < list.length; j += only ? every : 1) {
      const i = list[j], x = Math.floor((uv.getX(i) - Math.floor(uv.getX(i))) * 255), yv = uv.getY(i) - Math.floor(uv.getY(i)), y = Math.floor((map.flipY ? 1 - yv : yv) * 255), o = (y * 256 + x) * 4;
      r += lin(px[o]); g += lin(px[o + 1]); b += lin(px[o + 2]); k++;
    }
    return k ? { r: r / k, g: g / k, b: b / k } : null;
  },


  /** bone capsules and the def's special rules, in rig space */
  skinContext(rig, d, k, ox, oz, toRig) {
    const J = rig.j;
    const wp = (n) => J[n].getWorldPosition(new THREE.Vector3());
    const end = { hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head', armL: 'elbowL', elbowL: 'handL', armR: 'elbowR', elbowR: 'handR', thighL: 'kneeL', kneeL: 'footL', thighR: 'kneeR', kneeR: 'footR' };
    const rad = { hips: 0.15, spine: 0.15, chest: 0.17, neck: 0.06, head: 0.12, armL: 0.07, elbowL: 0.06, handL: 0.05, armR: 0.07, elbowR: 0.06, handR: 0.05, thighL: 0.09, kneeL: 0.065, footL: 0.05, thighR: 0.09, kneeR: 0.065, footR: 0.05 };
    const segs = JOINTS.map((n) => {
      const a = wp(n);
      let b;
      if (end[n]) b = wp(end[n]);
      else if (n === 'head') b = a.clone().add(new THREE.Vector3(0, 0.22, 0));
      else if (n.startsWith('hand')) b = a.clone().add(a.clone().sub(wp('elbow' + n[4])).normalize().multiplyScalar(0.1));
      else b = a.clone().add(new THREE.Vector3(0, -0.06, 0.16));
      return { a, ab: b.clone().sub(a), r: rad[n] };
    });
    const cap = (a, b, r) => ({ a, b, ab: b.clone().sub(a), r });
    const sw = d.sword && cap(toRig(d.sword.grip), toRig(d.sword.tip), d.sword.radius * k);
    const weapon = d.weapon && d.weapon.segs.map(([a, b, r]) => cap(toRig(a), toRig(b), r * k));
    const T = d.torso && { x: d.torso.x * k, y0: d.torso.y0 * k, y1: d.torso.y1 * k, z: d.torso.z * k,
      xLow: (d.torso.xLow ?? d.torso.x) * k, yLow: (d.torso.yLow ?? 0) * k };
    const rigid = (d.rigid || []).map((r) => ({ bone: JOINTS.indexOf(r.bone), test: r.test }));
    // rig space → the landmark sheet's frame, where the def's region tests are written
    const toSheet = (x, y, z) => [x / k + ox, y / k, z / k + oz];
    // the fist closed around a held weapon moves rigidly with the hand bone, exactly like the weapon,
    // so a bent wrist can never pull the grip out of the hand
    let fist = null;
    if (d.sword || d.weapon) {
      const hand = (d.weapon && d.weapon.hand) || 'handR';
      const hp = toRig(d.landmarks[hand]);
      const c = d.sword ? hp.clone().lerp(toRig(d.sword.grip), 0.5) : hp;
      // only below the wrist: the vambrace's rim stays with the forearm
      const fore = hp.clone().sub(toRig(d.landmarks['elbow' + hand.slice(4)])).normalize();
      fist = { c, r: 0.095 * k, bone: JOINTS.indexOf(hand), w: hp, fore };
    }
    return { d, k, segs, sw, weapon, T, rigid, toSheet, fist };
  },

  /** skin weights for one geometry (positions taken to rig space by toRoot) */
  weigh(g, toRoot, C) {
    const { d, k, segs, sw, weapon, T, rigid, toSheet, fist } = C;
    const handR = JOINTS.indexOf('handR'), elbowR = JOINTS.indexOf('elbowR'), weaponHand = JOINTS.indexOf((d.weapon && d.weapon.hand) || 'handR');
    const pa = g.attributes.position, n = pa.count;
    const si = new Uint16Array(n * 4), swt = new Float32Array(n * 4);
    const v = new THREE.Vector3(), t = new THREE.Vector3();
    const dist = (s, out) => {
      t.copy(v).sub(s.a);
      const l2 = s.ab.lengthSq();
      const u = l2 > 0 ? clamp(t.dot(s.ab) / l2, 0, 1) : 0;
      out.copy(s.a).addScaledVector(s.ab, u);
      return v.distanceTo(out) - s.r;
    };
    const tmp = new THREE.Vector3();
    const NS = segs.length;
    // 1) separate the sculpt into connected pieces (welding seam duplicates by position)
    const P3 = new Float32Array(n * 3);
    const weld = new Int32Array(n), ids = new Map();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(toRoot);
      P3[i * 3] = v.x; P3[i * 3 + 1] = v.y; P3[i * 3 + 2] = v.z;
      const key = (Math.round(v.x * 4000) + 16384) + (Math.round(v.y * 4000) + 16384) * 32768 + (Math.round(v.z * 4000) + 16384) * 1073741824;
      let id = ids.get(key);
      if (id === undefined) { id = ids.size; ids.set(key, id); }
      weld[i] = id;
    }
    const parent = new Int32Array(ids.size);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    const index = g.index ? g.index.array : null, triCount = index ? index.length / 3 : n / 3;
    for (let t = 0; t < triCount; t++) {
      const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
      unite(weld[a], weld[b]); unite(weld[b], weld[c]);
    }
    const comp = new Int32Array(n);
    for (let i = 0; i < n; i++) comp[i] = find(weld[i]);
    // 2) nearest bone per vertex, tallied per piece
    const D = new Float32Array(n * NS), near = new Uint8Array(n);
    const armBone = JOINTS.map((nme) => /^(arm|elbow|hand)/.test(nme));
    const tally = new Map();
    for (let i = 0; i < n; i++) {
      v.set(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]);
      const inTorso = T && Math.abs(v.x) < (v.y < T.yLow ? T.xLow : T.x) && v.y > T.y0 && v.y < T.y1 && Math.abs(v.z) < T.z;
      let bi = 0, bd = Infinity;
      for (let s = 0; s < NS; s++) {
        const dd = inTorso && armBone[s] ? 9 : dist(segs[s], tmp);
        D[i * NS + s] = dd;
        if (dd < bd) { bd = dd; bi = s; }
      }
      near[i] = bi;
      let t = tally.get(comp[i]);
      if (!t) { t = { n: 0, bones: new Uint32Array(NS), sword: 0 }; tally.set(comp[i], t); }
      t.n++; t.bones[bi]++;
      if (sw && dist(sw, tmp) < 0.12) t.sword++;
    }
    // 3) decide per piece: sword → hand, compact armour pieces → one bone, the body → smooth
    const rule = new Map();
    for (const [c, t] of tally) {
      let dom = 0;
      for (let s = 1; s < NS; s++) if (t.bones[s] > t.bones[dom]) dom = s;
      if (t.sword > t.n * 0.5) rule.set(c, handR);
      else if (t.bones[dom] >= t.n * 0.8 && t.n < n * 0.4) rule.set(c, dom);
      else rule.set(c, -1);
    }
    const PAR = { hips: -1, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', armL: 'chest', elbowL: 'armL', handL: 'elbowL', armR: 'chest', elbowR: 'armR', handR: 'elbowR', thighL: 'hips', kneeL: 'thighL', footL: 'kneeL', thighR: 'hips', kneeR: 'thighR', footR: 'kneeR' };
    const allowed = JOINTS.map((nme, s) => {
      const set = new Set([s]);
      if (PAR[nme] !== -1) set.add(JOINTS.indexOf(PAR[nme]));
      JOINTS.forEach((o, k) => { if (PAR[o] === nme) set.add(k); });
      return set;
    });
    const best = [0, 0, 0], bw = [0, 0, 0];
    const xMax = d.sword && (d.sword.xMax - (d.landmarks.hips[0])) * k, yMax = d.sword && d.sword.yMax * k;
    // in the sword's region AND along the blade (crossguard included): stray strap and sandal bits stay on the body
    // above the wrist is the forearm: the vambrace's rim and hinge stay on it, whatever lies near the grip
    const aboveWrist = (i) => {
      const { w, fore } = fist;
      return (P3[i * 3] - w.x) * fore.x + (P3[i * 3 + 1] - w.y) * fore.y + (P3[i * 3 + 2] - w.z) * fore.z < -0.01 * k;
    };
    const inFist = (i) => {
      if (!fist) return false;
      const fx = P3[i * 3] - fist.c.x, fy = P3[i * 3 + 1] - fist.c.y, fz = P3[i * 3 + 2] - fist.c.z;
      return fx * fx + fy * fy + fz * fz < fist.r * fist.r && !aboveWrist(i);
    };
    const isSword = (i) => {
      // the fingers wrapped around the hilt belong to the hand, not the sword
      if (!d.sword || inFist(i) || aboveWrist(i) || !(P3[i * 3] < xMax && P3[i * 3 + 1] < yMax)) return false;
      v.set(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]);
      // (nor the vambrace's surface just above the hilt)
      return dist(sw, tmp) < 0.26 * k && dist(segs[elbowR], tmp) > 0.025 * k;
    };
    let tipI = -1;
    const onWeapon = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (isSword(i)) {
        si[i * 4] = NJ; swt[i * 4] = 1; // the sword bone (see autoSkin)
        onWeapon[i] = 1;
        if (tipI < 0 || P3[i * 3 + 1] < P3[tipI * 3 + 1]) tipI = i;
        continue;
      }
      if (inFist(i)) { si[i * 4] = fist.bone; swt[i * 4] = 1; continue; }
      // a sculpted pole weapon: whatever lies on it (and nearer to it than to the body) moves with the hand
      if (weapon) {
        v.set(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]);
        let dw = Infinity;
        for (const s of weapon) dw = Math.min(dw, dist(s, tmp));
        if (dw < 0 && dw < D[i * NS + near[i]]) { si[i * 4] = weaponHand; swt[i * 4] = 1; onWeapon[i] = 1; continue; }
      }
      // named regions (wings on the back, a tentacle mass, an orb in the hand) are rigid
      if (rigid.length) {
        const [sx, sy, sz] = toSheet(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]);
        const hit = rigid.find((r) => r.test(sx, sy, sz));
        if (hit) { si[i * 4] = hit.bone; swt[i * 4] = 1; continue; }
      }
      const r = rule.get(comp[i]);
      if (r >= 0) { si[i * 4] = r; swt[i * 4] = 1; continue; }
      best[0] = best[1] = best[2] = -1; bw[0] = bw[1] = bw[2] = 0;
      for (const s of allowed[near[i]]) {
        const dd = Math.max(0, D[i * NS + s]) + 0.012;
        const w = 1 / (dd * dd * dd * dd);
        if (w > bw[0]) { bw[2] = bw[1]; best[2] = best[1]; bw[1] = bw[0]; best[1] = best[0]; bw[0] = w; best[0] = s; }
        else if (w > bw[1]) { bw[2] = bw[1]; best[2] = best[1]; bw[1] = w; best[1] = s; }
        else if (w > bw[2]) { bw[2] = w; best[2] = s; }
      }
      const sum = bw[0] + bw[1] + bw[2];
      for (let k = 0; k < 3; k++) { si[i * 4 + k] = Math.max(0, best[k]); swt[i * 4 + k] = bw[k] / sum; }
    }
    // relax the weights over the surface: joints then bend in a broad, round curve instead of folding
    // along one ring of vertices, and a region's edge (the torso box at the armpit) no longer shears the skin
    if (d.relaxSkin && index) {
      const fixed = new Uint8Array(n);
      for (let i = 0; i < n; i++) if (swt[i * 4] === 1 && swt[i * 4 + 1] === 0) { const r = rule.get(comp[i]); if (r >= 0 || onWeapon[i] || inFist(i)) fixed[i] = 1; }
      if (rigid.length) for (let i = 0; i < n; i++) { const [sx, sy, sz] = toSheet(P3[i * 3], P3[i * 3 + 1], P3[i * 3 + 2]); if (rigid.some((r) => r.test(sx, sy, sz))) fixed[i] = 1; }
      this.relaxWeights(n, weld, ids.size, index, si, swt, fixed, d.relaxSkin);
    }
    // cut triangles that bridge bones which aren't neighbours (fused sculpt contacts):
    // the parts separate cleanly instead of stretching into slivers
    const up = (nme) => { const c = [nme]; while (PAR[c[c.length - 1]] !== -1) c.push(PAR[c[c.length - 1]]); return c; };
    const hops = (a, b) => { const ca = up(a), cb = up(b); for (let i = 0; i < ca.length; i++) { const k = cb.indexOf(ca[i]); if (k >= 0) return i + k; } return 99; };
    const adj = JOINTS.map((a) => JOINTS.map((b) => hops(a, b) <= 2));
    let cut = 0;
    if (index) {
      const keep = [];
      for (let t = 0; t < triCount; t++) {
        const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
        // (the sword bone counts as the hand it's held in)
        const J0 = (x) => (x >= NJ ? handR : x);
        const ba = J0(si[a * 4]), bb = J0(si[b * 4]), bc = J0(si[c * 4]);
        // a held weapon parts cleanly from the hand and body that were sculpted around it
        const mixed = onWeapon[a] !== onWeapon[b] || onWeapon[b] !== onWeapon[c];
        if (!mixed && adj[ba][bb] && adj[bb][bc] && adj[ba][bc]) keep.push(a, b, c); else cut++;
      }
      g.setIndex(new THREE.Uint32BufferAttribute(keep, 1));
    }
    this.lastSkinStats = { vertices: n, pieces: tally.size, rigid: [...rule.values()].filter((r) => r >= 0).length, cut };
    // the sword's real tip is its lowest vertex: remembered for the trail markers of every copy
    if (sw && tipI >= 0) d._swordTip = new THREE.Vector3(P3[tipI * 3], P3[tipI * 3 + 1], P3[tipI * 3 + 2]);
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swt, 4));
    // which vertices belong to a held weapon (so it can be split off as its own mesh)
    if (d.splitWeapon) g.userData.weaponVerts = onWeapon;
  },

  /**
   * Diffuse skin weights across the welded surface (passes of neighbour averaging, sparse: up to four
   * bones per point), leaving fixed points (rigid pieces, held weapons, fists) as they are.
   */
  relaxWeights(n, weld, W, index, si, swt, fixed, passes) {
    const MAXB = 6;
    let bones = new Int16Array(W * MAXB).fill(-1), ws = new Float32Array(W * MAXB);
    const lock = new Uint8Array(W);
    const add = (B, Wt, w, b, x) => { const o = w * MAXB; for (let k = 0; k < MAXB; k++) { if (B[o + k] === b) { Wt[o + k] += x; return; } if (B[o + k] < 0) { B[o + k] = b; Wt[o + k] = x; return; } } let m = 0; for (let k = 1; k < MAXB; k++) if (Wt[o + k] < Wt[o + m]) m = k; if (x > Wt[o + m]) { B[o + m] = b; Wt[o + m] = x; } };
    const seen = new Uint16Array(W);
    for (let i = 0; i < n; i++) {
      const w = weld[i]; seen[w]++;
      if (fixed[i]) lock[w] = 1;
      for (let k = 0; k < 4; k++) if (swt[i * 4 + k] > 0) add(bones, ws, w, si[i * 4 + k], swt[i * 4 + k]);
    }
    for (let w = 0; w < W; w++) if (seen[w] > 1) for (let k = 0; k < MAXB; k++) ws[w * MAXB + k] /= seen[w];
    // neighbours over the welded surface
    const deg = new Uint16Array(W);
    for (let t = 0; t < index.length; t += 3) for (let e = 0; e < 3; e++) { deg[weld[index[t + e]]] += 2; }
    const start = new Uint32Array(W + 1);
    for (let w = 0; w < W; w++) start[w + 1] = start[w] + deg[w];
    const nb = new Int32Array(start[W]), fill = start.slice(0, W);
    for (let t = 0; t < index.length; t += 3) {
      const a = weld[index[t]], b = weld[index[t + 1]], c = weld[index[t + 2]];
      nb[fill[a]++] = b; nb[fill[a]++] = c; nb[fill[b]++] = a; nb[fill[b]++] = c; nb[fill[c]++] = a; nb[fill[c]++] = b;
    }
    for (let p = 0; p < passes; p++) {
      const B2 = new Int16Array(W * MAXB).fill(-1), W2 = new Float32Array(W * MAXB);
      for (let w = 0; w < W; w++) {
        const o = w * MAXB;
        if (lock[w] || start[w + 1] === start[w]) { for (let k = 0; k < MAXB; k++) { B2[o + k] = bones[o + k]; W2[o + k] = ws[o + k]; } continue; }
        for (let k = 0; k < MAXB; k++) if (bones[o + k] >= 0) add(B2, W2, w, bones[o + k], ws[o + k] * 0.5);
        const cnt = start[w + 1] - start[w], f = 0.5 / cnt;
        for (let j = start[w]; j < start[w + 1]; j++) { const q = nb[j] * MAXB; for (let k = 0; k < MAXB; k++) if (bones[q + k] >= 0) add(B2, W2, w, bones[q + k], ws[q + k] * f); }
      }
      bones = B2; ws = W2;
    }
    // back to four weights per vertex, strongest first, normalised
    const ord = [0, 1, 2, 3, 4, 5];
    for (let i = 0; i < n; i++) {
      if (fixed[i]) continue;
      const o = weld[i] * MAXB;
      ord.sort((a, b) => ws[o + b] - ws[o + a]);
      let sum = 0;
      for (let k = 0; k < 4; k++) if (bones[o + ord[k]] >= 0) sum += ws[o + ord[k]];
      for (let k = 0; k < 4; k++) {
        const b = bones[o + ord[k]];
        si[i * 4 + k] = b >= 0 ? b : 0; swt[i * 4 + k] = b >= 0 && sum > 0 ? ws[o + ord[k]] / sum : 0;
      }
    }
  },

  /** split a weighed geometry into body and weapon geometries sharing the same vertex data (made once) */
  splitWeapon(g) {
    if (g.userData.split) return g.userData.split;
    const flag = g.userData.weaponVerts, idx = g.index.array, body = [], blade = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      (flag[a] && flag[b] && flag[c] ? blade : body).push(a, b, c);
    }
    const view = (list) => {
      const v = new THREE.BufferGeometry();
      for (const k in g.attributes) v.setAttribute(k, g.attributes[k]);
      v.setIndex(list);
      v.computeBoundingSphere();
      return v;
    };
    return (g.userData.split = blade.length ? { body: view(body), blade: view(blade) } : null);
  },
};

/* the armoured sculpt: god-mode Ariel wears it, and Ares wears it restyled (crimson, burning, giant) */
// the blade of god-mode Ariel: Keraunos, bright steel with lightning in it
function keraunosMaterial(m) {
  // the sculpt's blade texture is gold: keep its detail, but as polished steel with a cold blue light in it
  const k = new THREE.MeshStandardMaterial({
    map: m.map || null, color: 0xffffff, metalness: 0.92, roughness: 0.18, envMapIntensity: 1.5,
    emissive: 0x2a5cff, emissiveIntensity: 0.28,
  });
  k.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float kL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = vec3(0.5 + kL * 0.9) * vec3(0.8, 0.88, 1.0);`);
  };
  k.customProgramCacheKey = () => 'keraunos';
  return Models.rim(k, [0.5, 0.8, 2.2], 2.5, 1.1);
}
// god-mode Ariel: the gold worn and tarnished toward old bronze, the way war-gods' armour looks in the old games.
// Only the metal changes (the sculpt's skin and cloth share the texture, and stay as they are)
function agedGold(m) {
  const c = m.clone();
  c.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      float agL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      vec3 aged = mix(vec3(agL), diffuseColor.rgb, 0.72) * vec3(1.0, 0.91, 0.76) * 0.84;
      float agM = smoothstep(0.3, 0.7, metalnessFactor);
      diffuseColor.rgb = mix(diffuseColor.rgb, aged, agM);
      roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.36), agM);`);
  };
  c.envMapIntensity = 0.85;
  c.customProgramCacheKey = () => 'agedGold';
  return c;
}
// Ares: the same armour gone dark, blood-red and smouldering
function aresCrimson(m) {
  const c = m.clone();
  c.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float crL = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(crL) * vec3(1.15, 0.2, 0.14), 0.85) * 0.46;`);
  };
  c.metalness = Math.max(c.metalness || 0, 0.55);
  c.roughness = Math.max(c.roughness, 0.42);
  c.envMapIntensity = 0.5;
  c.customProgramCacheKey = () => 'aresCrimson';
  return Models.rim(c, [1.3, 0.22, 0.03], 3.6, 0.35);
}

class ModelBinding {
  constructor(rig, map, hipsBone) {
    this.rig = rig; this.map = map; this.hipsBone = hipsBone;
    this._q = new THREE.Quaternion(); this._p = new THREE.Quaternion(); this._v = new THREE.Vector3();
  }
  /** copy the rig's current pose onto the model's bones */
  update() {
    if (!this.map.length) return;
    this.rig.root.updateMatrixWorld(true);
    const q = this._q, pq = this._p;
    for (const m of this.map) {
      m.joint.getWorldQuaternion(q).multiply(m.offset);
      m.bone.parent.getWorldQuaternion(pq);
      m.bone.quaternion.copy(pq.invert().multiply(q));
    }
    if (this.hipsBone) {
      this.rig.j.hips.getWorldPosition(this._v);
      this.hipsBone.parent.worldToLocal(this._v);
      this.hipsBone.position.copy(this._v);
    }
  }
  materials() {
    const out = new Set();
    this.holder.traverse((o) => { if (o.isMesh && o.visible) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => out.add(m)); });
    return [...out];
  }
}
