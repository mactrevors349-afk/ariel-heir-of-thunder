'use strict';
/* ==========================================================================
   humanoid.js · procedural characters
   - jointed body built from smooth primitives
   - outfits & weapons for Ariel, hoplites, the cyclops, Ares, Hermes, Zeus
   - pose/keyframe animation with locomotion blending
   - verlet cloth capes
   ========================================================================== */

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'elbowL', 'handL', 'armR', 'elbowR', 'handR', 'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR'];
const NJ = JOINTS.length;
const HP = NJ * 3;
const POSE_LEN = HP + 3;
const JI = {};
JOINTS.forEach((n, i) => { JI[n] = i * 3; });
const UPPER_IDX = ['spine', 'chest', 'neck', 'head', 'armL', 'elbowL', 'handL', 'armR', 'elbowR', 'handR'].map((n) => JI[n]);
const ARM_IDX = ['armL', 'elbowL', 'handL', 'armR', 'elbowR', 'handR'].map((n) => JI[n]);

function compilePose(obj) {
  const p = new Float32Array(POSE_LEN);
  for (const k in obj) {
    const v = obj[k];
    if (k === 'hp') { p[HP] = v[0] || 0; p[HP + 1] = v[1] || 0; p[HP + 2] = v[2] || 0; continue; }
    const i = JI[k];
    if (i === undefined) continue;
    p[i] = (v[0] || 0) * DEG; p[i + 1] = (v[1] || 0) * DEG; p[i + 2] = (v[2] || 0) * DEG;
  }
  return p;
}

/* -------------------------------------------------------------- stances
   Angles in degrees. Limbs hang along -Y; character faces +Z.
   arm/thigh x<0 swings forward · elbow x<0 bends forward · knee x>0 bends back
   right arm z<0 raises sideways · left arm z>0 raises sideways · y twists     */
const STANCES = {
  sword: {
    hp: [0, -0.03, 0], spine: [6, 0, 0], chest: [3, -6, 0], neck: [-3, 4, 0], head: [-2, 2, 0],
    armL: [6, 0, 10], elbowL: [-22, 0, 0], armR: [-10, 0, -12], elbowR: [-38, 0, 0], handR: [-30, 0, 0],
    thighL: [-5, 0, 3], kneeL: [9, 0, 0], footL: [-3, 0, 0], thighR: [3, 0, -3], kneeR: [7, 0, 0], footR: [-3, 0, 0],
  },
  casual: {
    spine: [2, 0, 0], head: [3, 0, 0], armL: [3, 0, 7], elbowL: [-12, 0, 0], armR: [3, 0, -7], elbowR: [-12, 0, 0],
    thighL: [-2, 0, 2], kneeL: [3, 0, 0], thighR: [1, 0, -2], kneeR: [3, 0, 0],
  },
  hoplite: {
    hp: [0, -0.06, 0], spine: [10, 0, 0], chest: [4, 18, 0], neck: [-8, -14, 0], head: [-4, -4, 0],
    armL: [-5, -70, 40], elbowL: [-95, 0, 0], armR: [12, 0, -22], elbowR: [-95, 0, 0], handR: [0, 0, 0],
    thighL: [-22, 0, 6], kneeL: [22, 0, 0], footL: [-2, 0, 0], thighR: [14, 0, -8], kneeR: [18, 0, 0], footR: [-6, 0, 0],
  },
  brute: {
    hp: [0, -0.08, 0], spine: [20, 0, 0], chest: [10, 0, 0], neck: [-22, 0, 0], head: [-6, 0, 0],
    armL: [-8, 0, 28], elbowL: [-30, 0, 0], armR: [-18, 0, -24], elbowR: [-45, 0, 0], handR: [-55, 0, 0],
    thighL: [-12, 0, 10], kneeL: [20, 0, 0], footL: [-6, 0, 0], thighR: [8, 0, -10], kneeR: [16, 0, 0], footR: [-6, 0, 0],
  },
  reaper: {
    hp: [0, -0.04, 0], spine: [10, 0, 0], chest: [4, -6, 0], neck: [-8, 6, 0],
    armL: [-6, 0, 14], elbowL: [-25, 0, 0], armR: [-14, 0, -10], elbowR: [-30, 0, 0], handR: [0, 0, 0],
    thighL: [-8, 0, 4], kneeL: [10, 0, 0], thighR: [6, 0, -4], kneeR: [8, 0, 0],
  },
  // the gods at court (prologue): weight on one leg, arms clear of their bulk
  poseidon: {
    hp: [0, -0.02, 0], spine: [2, 0, 0], chest: [-3, -6, 0], neck: [-2, 8, 0],
    armL: [2, 0, 10], elbowL: [-14, 0, 0], armR: [-24, 0, -12], elbowR: [-64, 0, 0], handR: [0, 0, 0],
    thighL: [-4, 0, 4], kneeL: [6, 0, 0], thighR: [3, 0, -3], kneeR: [3, 0, 0],
  },
  athena: {
    hp: [0, -0.015, 0], chest: [-2, 8, 0], neck: [-3, -6, 0],
    armL: [4, 0, 9], elbowL: [-12, 0, 0], armR: [0, 0, -11], elbowR: [-22, 0, 0], handR: [0, 0, 0],
    thighL: [-6, 0, 5], kneeL: [10, 0, 0], thighR: [2, 0, -2], kneeR: [2, 0, 0],
  },
  // close to how his sculpt stands: bident upright in the left fist, right hand raised as he speaks
  hadesCourt: {
    hp: [0, -0.02, 0], spine: [-2, 0, 0], chest: [-2, 6, 0], neck: [-4, -6, 0],
    armL: [-6, 0, 12], elbowL: [-78, -30, 0], armR: [-26, 0, -26], elbowR: [-78, 0, 0], handR: [0, 0, 0],
    thighL: [-2, 0, 4], kneeL: [4, 0, 0], thighR: [-6, 0, -5], kneeR: [6, 0, 0],
  },
  aresCourt: {
    hp: [0, -0.02, 0], chest: [0, -8, 0], neck: [-2, 10, 0],
    armL: [0, 0, 16], elbowL: [-24, 0, 0], armR: [-8, 0, -14], elbowR: [-26, 0, 0], handR: [-18, 0, 0],
    thighL: [-5, 0, 6], kneeL: [8, 0, 0], thighR: [4, 0, -5], kneeR: [4, 0, 0],
  },
  thrall: {
    hp: [0, -0.02, 0], spine: [8, 0, 0], chest: [6, 0, 0], neck: [-10, 0, 0], head: [-4, 0, 0],
    armL: [-30, 0, 30], elbowL: [-60, 0, 0], armR: [-30, 0, -30], elbowR: [-60, 0, 0],
  },
  // (on top of the sculpt's own sword-arm pose: a loose, heavy stance)
  ares: {
    hp: [0, -0.05, 0], spine: [6, 0, 0], chest: [2, -12, 0], neck: [-4, 10, 0],
    armL: [-6, 0, 8], elbowL: [-16, 0, 0], armR: [-10, 0, -6], elbowR: [-18, 0, 0], handR: [-20, 0, 0],
    thighL: [-14, 0, 9], kneeL: [14, 0, 0], footL: [-2, 0, 0], thighR: [10, 0, -9], kneeR: [12, 0, 0], footR: [-4, 0, 0],
  },
  // the caduceus upright in his left fist, the forearm level and the wrist straight
  hermes: {
    chest: [-2, 8, 0], neck: [2, -6, 0], armL: [-8, 0, 12], elbowL: [-82, 0, 0], handL: [-4, 0, 0],
    armR: [4, 0, -10], elbowR: [-15, 0, 0], thighL: [-2, 0, 1], kneeL: [4, 0, 0], thighR: [6, 0, -2], kneeR: [10, 0, 0], footR: [-6, 0, 0],
  },
};

/* --------------------------------------------------------------- clips
   keys: [time 0..1, overrides merged onto the stance, ease?]
   ease: undefined = smoothstep, 'in' = accelerate (strikes), 'lin', 'out'           */
const LIE = {
  hips: [-90, 0, 0], hp: [0, -0.86, -0.3], spine: [0, 0, 0], chest: [0, 0, 0], neck: [10, 25, 0], head: [0, 15, 0],
  armL: [-10, 0, 35], elbowL: [-20, 0, 0], armR: [-20, 0, -50], elbowR: [-30, 0, 0], handR: [0, 0, 0],
  thighL: [-5, 0, 6], kneeL: [12, 0, 0], footL: [0, 0, 0], thighR: [-15, 0, -4], kneeR: [25, 0, 0], footR: [0, 0, 0],
};
const KNEEL = {
  hp: [0, -0.47, 0.05], thighL: [-88, 0, 6], kneeL: [90, 0, 0], footL: [0, 0, 0], thighR: [8, 0, -4], kneeR: [105, 0, 0], footR: [55, 0, 0],
  spine: [14, 0, 0], chest: [8, 0, 0], neck: [12, 0, 0], armR: [-40, 0, -8], elbowR: [-50, 0, 0], handR: [90, 0, 0],
  armL: [-30, 0, 15], elbowL: [-60, 0, 0],
};
// getting up off the ground, in the order people do it
// up on the elbows, chin tucked, knees starting to bend
const PROPPED = {
  hips: [-74, 0, 0], hp: [0, -0.84, -0.28], spine: [14, 0, 0], chest: [12, 0, 0], neck: [24, 0, 0], head: [6, 0, 0],
  armL: [38, 0, 22], elbowL: [-95, 0, 0], armR: [38, 0, -22], elbowR: [-95, 0, 0], handR: [0, 0, 0],
  thighL: [-28, 0, 6], kneeL: [48, 0, 0], thighR: [-10, 0, -5], kneeR: [16, 0, 0],
};
// sitting up on the ground, the free hand planted behind, the sword arm resting forward, one knee drawn up
const SIT_UP = {
  hips: [-30, 0, 4], hp: [0, -0.82, -0.2], spine: [22, 0, 0], chest: [10, 0, 0], neck: [4, 0, 0],
  armL: [35, 0, 22], elbowL: [-8, 0, 0], armR: [-48, 0, -14], elbowR: [-58, 0, 0], handR: [-25, 0, 0],
  thighL: [-62, 0, 10], kneeL: [118, 0, 0], footL: [-12, 0, 0], thighR: [-50, 0, -8], kneeR: [52, 0, 0],
};
// rolled forward onto one knee, a hand on the ground for balance
const CROUCH_HAND = {
  hp: [0, -0.56, -0.02], spine: [34, 0, 0], chest: [12, 0, 0], neck: [-14, 0, 0],
  thighL: [-96, 0, 8], kneeL: [118, 0, 0], footL: [-16, 0, 0], thighR: [-8, 0, -6], kneeR: [116, 0, 0], footR: [48, 0, 0],
  armL: [-28, 0, 10], elbowL: [-60, 0, 0], armR: [-55, 0, -14], elbowR: [-12, 0, 0], handR: [0, 0, 0],
};
// driving up off the front leg
const PUSH_UP = {
  hp: [0, -0.22, 0.04], spine: [20, 0, 0], chest: [6, 0, 0], neck: [-8, 0, 0],
  thighL: [-50, 0, 6], kneeL: [62, 0, 0], footL: [-8, 0, 0], thighR: [-2, 0, -4], kneeR: [40, 0, 0], footR: [16, 0, 0],
  armL: [-20, 0, 14], elbowL: [-30, 0, 0], armR: [-24, 0, -14], elbowR: [-30, 0, 0],
};

// doubled over, both hands clamped to the head (Ares reaching in through the shard)
const CLUTCH = {
  hp: [0, -0.12, 0.02], spine: [24, 0, 0], chest: [12, 0, 0], neck: [26, 0, 0], head: [6, 0, 0],
  armL: [-125, 0, -8], elbowL: [-125, 0, 0], armR: [-125, 0, 8], elbowR: [-125, 0, 0], handR: [0, 0, 0],
  thighL: [-16, 0, 6], kneeL: [24, 0, 0], thighR: [-4, 0, -6], kneeR: [18, 0, 0],
};

// on his knees, arms dragged out to the sides by the chains of Tartarus
const CHAINED = {
  ...KNEEL, armL: [-12, 0, 62], elbowL: [-15, 0, 0], armR: [-12, 0, -62], elbowR: [-15, 0, 0], handR: [0, 0, 0],
  spine: [22, 0, 0], chest: [8, 0, 0], neck: [30, 0, 0], head: [10, 0, 0],
};
// sitting on a ledge, leaning forward a little, both forearms resting on the thighs
// (the right one further back, so the pose isn't mirror-perfect)
const SIT = {
  hp: [0, -0.36, -0.05], thighL: [-86, 0, 7], kneeL: [82, 0, 0], thighR: [-82, 0, -9], kneeR: [74, 0, 0],
  spine: [16, 0, 0], chest: [8, 0, 0], neck: [12, 0, 0], head: [2, 0, 0],
  armL: [-14, 0, 6], elbowL: [-74, -40, 0], handL: [0, 0, 0],
  armR: [-6, 0, -8], elbowR: [-82, 36, 0], handR: [0, 0, 0],
};

// enthroned like the old seated statues: back straight, chin level, elbows on the armrests,
// forearms turned palm-down so the hands lie on his thighs, knees apart
const THRONE = {
  ...SIT, hp: [0, -0.47, -0.06], spine: [-2, 0, 0], chest: [-2, 0, 0], neck: [-3, 0, 0], head: [-2, 0, 0],
  // elbows out past his thighs, forearms level along the throne's arms, palms down and resting flat
  // (the wrists lift a touch so the hands lie in the forearms' plane; the right hand sits a little lower in the model)
  armL: [6, 0, 27], elbowL: [-92, -70, 0], handL: [0, 0, 12], armR: [6, 0, -27], elbowR: [-92, 70, 0], handR: [0, 0, -20],
  thighL: [-86, 0, 9], kneeL: [84, 0, 0], footL: [2, 0, 0], thighR: [-86, 0, -9], kneeR: [84, 0, 0], footR: [2, 0, 0],
};

const CLIPS = {
  /* ---------------------------------------------------------- shared */
  hit: { dur: 0.42, keys: [[0, {}], [0.15, { hp: [0, -0.05, -0.08], spine: [-14, 0, 6], chest: [-16, 0, 8], neck: [18, 0, 0], armL: [-30, 0, 40], elbowL: [-50, 0, 0], armR: [-40, 0, -40], elbowR: [-60, 0, 0] }], [1, {}]] },
  stagger: {
    dur: 1.1, keys: [[0, {}],
      [0.15, { hp: [0, -0.15, -0.12], spine: [-20, 0, 10], chest: [-15, 0, 10], neck: [20, 0, 0], armL: [-20, 0, 50], elbowL: [-20, 0, 0], armR: [-10, 0, -50], elbowR: [-20, 0, 0], thighL: [10, 0, 0], kneeL: [30, 0, 0], thighR: [-30, 0, 0], kneeR: [45, 0, 0] }],
      [0.6, { hp: [0, -0.25, 0], spine: [30, 0, 0], chest: [10, 0, 0], neck: [-10, 0, 0], armL: [0, 0, 10], armR: [0, 0, -10], elbowR: [-20, 0, 0], thighL: [-30, 0, 0], kneeL: [50, 0, 0], thighR: [-10, 0, 0], kneeR: [40, 0, 0] }],
      [1, {}]],
  },
  death: {
    dur: 1.8, hold: true, keys: [[0, {}],
      [0.2, { hp: [0, -0.1, -0.1], spine: [-20, 0, 0], chest: [-10, 0, 0], neck: [20, 0, 0], armL: [-40, 0, 40], armR: [-40, 0, -40] }],
      [0.5, { hips: [-85, 0, 0], hp: [0, -0.84, -0.4], spine: [-5, 0, 0], chest: [0, 0, 0], neck: [15, 0, 0], armL: [-10, 0, 70], elbowL: [-20, 0, 0], armR: [-10, 0, -70], elbowR: [-20, 0, 0], thighL: [-20, 0, 0], kneeL: [30, 0, 0], thighR: [-5, 0, 0], kneeR: [10, 0, 0] }, 'in'],
      [0.65, { hips: [-90, 0, 0], hp: [0, -0.88, -0.42], neck: [12, 0, 0], armL: [-10, 0, 75], elbowL: [-15, 0, 0], armR: [-10, 0, -75], elbowR: [-15, 0, 0], thighL: [-15, 0, 0], kneeL: [20, 0, 0], kneeR: [8, 0, 0] }],
      [1, { hips: [-90, 0, 0], hp: [0, -0.88, -0.42], neck: [12, 0, 0], armL: [-10, 0, 75], elbowL: [-15, 0, 0], armR: [-10, 0, -75], elbowR: [-15, 0, 0], thighL: [-15, 0, 0], kneeL: [20, 0, 0], kneeR: [8, 0, 0] }]],
  },
  deathFwd: {
    dur: 2.6, hold: true, keys: [[0, {}],
      [0.18, { hp: [0, -0.1, 0], spine: [-10, 0, 0], chest: [-8, 0, 0], neck: [10, 0, 0], armL: [-20, 0, 30], armR: [-20, 0, -30] }],
      [0.4, { hp: [0, -0.5, 0], thighL: [-5, 0, 4], kneeL: [100, 0, 0], footL: [40, 0, 0], thighR: [-5, 0, -4], kneeR: [100, 0, 0], footR: [40, 0, 0], spine: [25, 0, 0], chest: [10, 0, 0], neck: [20, 0, 0], armL: [0, 0, 12], elbowL: [-10, 0, 0], armR: [0, 0, -12], elbowR: [-10, 0, 0], handR: [0, 0, 0] }],
      [0.58, { hp: [0, -0.5, 0], thighL: [-5, 0, 4], kneeL: [100, 0, 0], footL: [40, 0, 0], thighR: [-5, 0, -4], kneeR: [100, 0, 0], footR: [40, 0, 0], spine: [30, 0, 0], chest: [12, 0, 0], neck: [25, 0, 0], armL: [0, 0, 12], elbowL: [-10, 0, 0], armR: [0, 0, -12], elbowR: [-10, 0, 0], handR: [0, 0, 0] }],
      [0.85, { hips: [82, 0, 0], hp: [0, -0.82, 0.35], spine: [5, 0, 0], chest: [0, 0, 0], neck: [-10, 0, 0], thighL: [-8, 0, 0], kneeL: [15, 0, 0], thighR: [-8, 0, 0], kneeR: [15, 0, 0], armL: [-170, 0, 30], elbowL: [-20, 0, 0], armR: [-160, 0, -30], elbowR: [-20, 0, 0] }, 'in'],
      [1, { hips: [84, 0, 0], hp: [0, -0.84, 0.36], spine: [5, 0, 0], chest: [0, 0, 0], neck: [-10, 0, 0], thighL: [-8, 0, 0], kneeL: [15, 0, 0], thighR: [-8, 0, 0], kneeR: [15, 0, 0], armL: [-170, 0, 30], elbowL: [-20, 0, 0], armR: [-160, 0, -30], elbowR: [-20, 0, 0] }]],
  },
  kneel: { dur: 1.1, hold: true, keys: [[0, {}], [0.35, { hp: [0, -0.22, 0.02], spine: [16, 0, 0], thighL: [-50, 0, 6], kneeL: [60, 0, 0], thighR: [-12, 0, -4], kneeR: [55, 0, 0], armL: [-20, 0, 12], elbowL: [-35, 0, 0] }], [0.7, KNEEL], [1, KNEEL]] },
  kneelBowed: { dur: 1.4, hold: true, keys: [[0, {}], [0.3, { hp: [0, -0.22, 0.02], spine: [16, 0, 0], thighL: [-50, 0, 6], kneeL: [60, 0, 0], thighR: [-12, 0, -4], kneeR: [55, 0, 0] }], [0.65, { ...KNEEL, neck: [35, 0, 0], spine: [25, 0, 0] }], [1, { ...KNEEL, neck: [38, 0, 0], spine: [26, 0, 0] }]] },
  // from bowed on one knee, the head comes slowly up to stare ahead (Ares, in Ariel's vision)
  kneelLookUp: { dur: 2.6, hold: true, keys: [[0, { ...KNEEL, neck: [38, 0, 0], spine: [26, 0, 0] }], [0.55, { ...KNEEL, neck: [6, 0, 0], spine: [18, 0, 0] }, 'out'], [1, { ...KNEEL, neck: [-10, 0, 0], head: [-6, 0, 0], spine: [12, 0, 0], chest: [-4, 0, 0] }]] },
  // from one knee: lean over the front foot, push off the knee with a hand, rise
  standUp: {
    dur: 1.2, keys: [[0, KNEEL],
      [0.3, { ...KNEEL, hp: [0, -0.45, 0.08], spine: [30, 0, 0], chest: [10, 0, 0], neck: [-12, 0, 0], armL: [-32, 0, 8], elbowL: [-55, 0, 0] }],
      [0.62, { hp: [0, -0.2, 0.06], spine: [20, 0, 0], chest: [6, 0, 0], neck: [-8, 0, 0], thighL: [-46, 0, 6], kneeL: [58, 0, 0], footL: [-8, 0, 0], thighR: [-4, 0, -4], kneeR: [42, 0, 0], footR: [20, 0, 0], armL: [-20, 0, 12], elbowL: [-30, 0, 0] }],
      [1, {}]],
  },
  lying: { dur: 0.5, hold: true, keys: [[0, LIE], [1, LIE]] },
  // from flat on the back: up onto the elbows, sit up, roll onto a knee with a hand down, push up, stand
  getUp: {
    dur: 4.2, keys: [[0, LIE],
      [0.1, { ...LIE, neck: [6, 0, 0], head: [-10, -10, 0] }],
      [0.24, PROPPED],
      [0.4, SIT_UP],
      [0.58, CROUCH_HAND],
      [0.76, PUSH_UP],
      [1, {}]],
  },
  sit: { dur: 0.5, hold: true, keys: [[0, SIT], [1, SIT]] },
  // upright on a throne, forearms on the armrests
  throne: { dur: 0.5, hold: true, keys: [[0, THRONE], [1, THRONE]] },
  // lean the chest over the knees first, then drive up through the legs
  standFromSit: {
    dur: 1.5, keys: [[0, SIT],
      [0.28, { ...SIT, hp: [0, -0.36, 0.02], spine: [32, 0, 0], chest: [10, 0, 0], neck: [-14, 0, 0], armL: [-40, 0, 12], elbowL: [-40, 0, 0], armR: [-40, 0, -12], elbowR: [-40, 0, 0] }],
      [0.58, { hp: [0, -0.24, 0.06], spine: [24, 0, 0], chest: [8, 0, 0], neck: [-10, 0, 0], thighL: [-50, 0, 6], kneeL: [58, 0, 0], thighR: [-46, 0, -6], kneeR: [55, 0, 0], armL: [-24, 0, 10], elbowL: [-30, 0, 0], armR: [-24, 0, -10], elbowR: [-30, 0, 0] }],
      [1, {}]],
  },
  look: { dur: 5, loop: true, keys: [[0, {}], [0.25, { neck: [-6, 28, 0], head: [-4, 12, 0] }], [0.5, { neck: [-12, 0, 0] }], [0.75, { neck: [-6, -28, 0], head: [-4, -12, 0] }], [1, {}]] },
  lookUp: { dur: 1.6, hold: true, keys: [[0, {}], [1, { neck: [-35, 0, 0], head: [-15, 0, 0], spine: [-4, 0, 0] }]] },
  talk: { dur: 2.6, loop: true, mask: 'upper', keys: [[0, {}], [0.3, { armR: [-40, 0, -20], elbowR: [-70, 0, 0], handR: [0, 0, 0], neck: [-3, 5, 0] }], [0.6, { armR: [-28, 0, -26], elbowR: [-45, 0, 0], neck: [2, -4, 0] }], [1, {}]] },
  point: { dur: 1.0, hold: true, mask: 'upper', keys: [[0, {}], [1, { armR: [-85, 12, -10], elbowR: [-5, 0, 0], handR: [0, 0, 0], neck: [0, -10, 0] }]] },
  raise: { dur: 1.2, hold: true, keys: [[0, {}], [0.6, { armR: [-175, 0, -5], elbowR: [-5, 0, 0], handR: [0, 0, 0], neck: [-20, 0, 0], chest: [-8, 0, 0], armL: [-10, 0, 30] }], [1, { armR: [-178, 0, -4], elbowR: [-4, 0, 0], handR: [0, 0, 0], neck: [-22, 0, 0], chest: [-8, 0, 0], armL: [-10, 0, 30] }]] },
  struck: {
    dur: 1.4, hold: true, keys: [[0, {}],
      [0.2, { hp: [0, 0.06, 0], spine: [-15, 0, 0], chest: [-18, 0, 0], neck: [-35, 0, 0], armL: [-30, 0, 75], elbowL: [-10, 0, 0], armR: [-30, 0, -75], elbowR: [-10, 0, 0], thighL: [-4, 0, 6], thighR: [4, 0, -6] }],
      [1, { hp: [0, 0.1, 0], spine: [-18, 0, 0], chest: [-20, 0, 0], neck: [-40, 0, 0], armL: [-25, 0, 85], elbowL: [-5, 0, 0], armR: [-25, 0, -85], elbowR: [-5, 0, 0], thighL: [-4, 0, 6], thighR: [4, 0, -6] }]],
  },
  cower: { dur: 0.5, hold: true, keys: [[0, {}], [1, { hp: [0, -0.12, 0], spine: [18, 0, 0], neck: [20, 0, 0], armL: [-110, 0, -25], elbowL: [-115, 0, 0], armR: [-100, 0, 25], elbowR: [-115, 0, 0], kneeL: [25, 0, 0], kneeR: [25, 0, 0], thighL: [-15, 0, 0], thighR: [-10, 0, 0] }]] },
  roar: {
    dur: 2.2, keys: [[0, {}],
      [0.3, { neck: [-40, 0, 0], head: [-20, 0, 0], chest: [-18, 0, 0], spine: [-10, 0, 0], armL: [-30, 0, 70], elbowL: [-40, 0, 0], armR: [-30, 0, -70], elbowR: [-40, 0, 0], hp: [0, -0.1, 0] }],
      [0.8, { neck: [-42, 0, 0], head: [-20, 0, 0], chest: [-20, 0, 0], spine: [-10, 0, 0], armL: [-30, 0, 72], elbowL: [-40, 0, 0], armR: [-30, 0, -72], elbowR: [-40, 0, 0], hp: [0, -0.1, 0] }],
      [1, {}]],
  },

  /* ---------------------------------------------------------- Ariel */
  light1: {
    dur: 0.72, keys: [[0, {}],
      [0.26, { hp: [0, -0.06, 0], spine: [8, -12, 0], chest: [4, -25, 0], neck: [-4, 30, 0], armR: [-15, 10, -80], elbowR: [-30, 0, 0], handR: [-20, 0, 0], armL: [-20, 0, 30], elbowL: [-40, 0, 0], thighL: [-18, 0, 4], kneeL: [20, 0, 0], thighR: [10, 0, -4], kneeR: [12, 0, 0] }],
      [0.44, { hp: [0, -0.1, 0.05], spine: [14, 15, 0], chest: [8, 30, 0], neck: [-6, -36, 0], armR: [-10, 90, -82], elbowR: [-12, 0, 0], handR: [-15, 0, 0], armL: [10, 0, 18], elbowL: [-30, 0, 0], thighL: [-30, 0, 4], kneeL: [34, 0, 0], thighR: [18, 0, -4], kneeR: [16, 0, 0] }, 'in'],
      [0.62, { hp: [0, -0.08, 0.03], spine: [12, 12, 0], chest: [6, 24, 0], neck: [-6, -28, 0], armR: [-15, 80, -75], elbowR: [-25, 0, 0], handR: [-25, 0, 0], thighL: [-26, 0, 4], kneeL: [30, 0, 0], thighR: [16, 0, -4], kneeR: [14, 0, 0] }],
      [1, {}]],
  },
  light2: {
    dur: 0.7, keys: [[0, {}],
      [0.24, { hp: [0, -0.06, 0], chest: [6, 35, 0], spine: [10, 15, 0], neck: [-4, -40, 0], armR: [-20, 100, -70], elbowR: [-70, 0, 0], handR: [-20, 0, 0], armL: [-10, 0, 20], thighL: [-14, 0, 4], kneeL: [18, 0, 0] }],
      [0.44, { hp: [0, -0.1, 0.05], chest: [6, -35, 0], spine: [12, -15, 0], neck: [-6, 40, 0], armR: [-10, 40, -85], elbowR: [-10, 0, 0], handR: [-10, 0, 0], armL: [-20, 0, 35], elbowL: [-40, 0, 0], thighL: [10, 0, 4], kneeL: [16, 0, 0], thighR: [-28, 0, -4], kneeR: [32, 0, 0] }, 'in'],
      [0.62, { hp: [0, -0.08, 0.03], chest: [6, -28, 0], spine: [12, -12, 0], neck: [-6, 32, 0], armR: [-12, 45, -80], elbowR: [-22, 0, 0], handR: [-18, 0, 0], thighR: [-24, 0, -4], kneeR: [28, 0, 0] }],
      [1, {}]],
  },
  light3: {
    dur: 0.95, keys: [[0, {}],
      [0.3, { hp: [0, 0, -0.02], spine: [-6, 0, 0], chest: [-10, -8, 0], neck: [10, 6, 0], armR: [-165, 0, -12], elbowR: [-70, 0, 0], handR: [-10, 0, 0], armL: [-140, 0, 25], elbowL: [-80, 0, 0] }],
      [0.5, { hp: [0, -0.16, 0.12], spine: [24, 0, 0], chest: [18, 0, 0], neck: [-22, 0, 0], armR: [-60, 0, -8], elbowR: [-8, 0, 0], handR: [-25, 0, 0], armL: [-35, 0, 15], elbowL: [-20, 0, 0], thighL: [-48, 0, 5], kneeL: [58, 0, 0], footL: [-8, 0, 0], thighR: [22, 0, -5], kneeR: [38, 0, 0], footR: [10, 0, 0] }, 'in'],
      [0.72, { hp: [0, -0.14, 0.1], spine: [20, 0, 0], chest: [14, 0, 0], neck: [-18, 0, 0], armR: [-55, 0, -8], elbowR: [-15, 0, 0], handR: [-30, 0, 0], armL: [-30, 0, 15], elbowL: [-25, 0, 0], thighL: [-44, 0, 5], kneeL: [52, 0, 0], thighR: [20, 0, -5], kneeR: [34, 0, 0] }],
      [1, {}]],
  },
  heavy: {
    dur: 1.25, keys: [[0, {}],
      [0.22, { hp: [0, -0.22, 0], spine: [18, 0, 0], chest: [10, 0, 0], armR: [-40, 0, -20], elbowR: [-60, 0, 0], handR: [-40, 0, 0], armL: [-30, 0, 20], elbowL: [-60, 0, 0], thighL: [-50, 0, 5], kneeL: [75, 0, 0], footL: [-20, 0, 0], thighR: [-30, 0, -5], kneeR: [65, 0, 0], footR: [-25, 0, 0] }],
      [0.42, { hp: [0, 0.45, 0.1], spine: [-12, 0, 0], chest: [-14, 0, 0], neck: [12, 0, 0], armR: [-175, 0, -8], elbowR: [-50, 0, 0], handR: [-15, 0, 0], armL: [-160, 0, 15], elbowL: [-55, 0, 0], thighL: [-60, 0, 5], kneeL: [90, 0, 0], thighR: [-20, 0, -5], kneeR: [70, 0, 0] }],
      [0.56, { hp: [0, -0.32, 0.18], spine: [32, 0, 0], chest: [22, 0, 0], neck: [-28, 0, 0], armR: [-55, 0, -6], elbowR: [-5, 0, 0], handR: [-30, 0, 0], armL: [-45, 0, 12], elbowL: [-15, 0, 0], thighL: [-62, 0, 5], kneeL: [92, 0, 0], footL: [-25, 0, 0], thighR: [28, 0, -5], kneeR: [75, 0, 0], footR: [20, 0, 0] }, 'in'],
      [0.8, { hp: [0, -0.3, 0.16], spine: [30, 0, 0], chest: [20, 0, 0], neck: [-26, 0, 0], armR: [-55, 0, -6], elbowR: [-8, 0, 0], handR: [-30, 0, 0], armL: [-45, 0, 12], elbowL: [-18, 0, 0], thighL: [-60, 0, 5], kneeL: [88, 0, 0], footL: [-22, 0, 0], thighR: [26, 0, -5], kneeR: [72, 0, 0], footR: [18, 0, 0] }],
      [1, {}]],
  },
  roll: {
    dur: 0.62, keys: [[0, {}],
      [0.1, { hp: [0, -0.3, 0.05], hips: [20, 0, 0], spine: [30, 0, 0], chest: [25, 0, 0], neck: [30, 0, 0], armL: [-70, 0, 15], elbowL: [-110, 0, 0], armR: [-70, 0, -15], elbowR: [-110, 0, 0], handR: [-60, 0, 0], thighL: [-95, 0, 5], kneeL: [120, 0, 0], thighR: [-80, 0, -5], kneeR: [125, 0, 0] }],
      [0.3, { hp: [0, -0.5, 0], hips: [170, 0, 0], spine: [30, 0, 0], chest: [25, 0, 0], neck: [30, 0, 0], armL: [-70, 0, 15], elbowL: [-110, 0, 0], armR: [-70, 0, -15], elbowR: [-110, 0, 0], handR: [-60, 0, 0], thighL: [-100, 0, 5], kneeL: [125, 0, 0], thighR: [-90, 0, -5], kneeR: [125, 0, 0] }, 'lin'],
      [0.48, { hp: [0, -0.45, 0], hips: [320, 0, 0], spine: [30, 0, 0], chest: [25, 0, 0], neck: [30, 0, 0], armL: [-70, 0, 15], elbowL: [-110, 0, 0], armR: [-70, 0, -15], elbowR: [-110, 0, 0], handR: [-60, 0, 0], thighL: [-100, 0, 5], kneeL: [125, 0, 0], thighR: [-90, 0, -5], kneeR: [125, 0, 0] }, 'lin'],
      [0.64, { hp: [0, -0.25, 0], hips: [360, 0, 0], spine: [20, 0, 0], thighL: [-60, 0, 5], kneeL: [90, 0, 0], thighR: [-20, 0, -5], kneeR: [60, 0, 0] }],
      [0.85, { hp: [0, -0.08, 0], hips: [360, 0, 0] }],
      [1, { hips: [360, 0, 0] }]],
  },
  backstep: { dur: 0.5, keys: [[0, {}], [0.2, { hp: [0, -0.1, -0.05], spine: [-8, 0, 0], chest: [-6, 0, 0], thighL: [10, 0, 3], kneeL: [20, 0, 0], thighR: [-25, 0, -3], kneeR: [40, 0, 0] }], [0.45, { hp: [0, -0.12, 0], spine: [8, 0, 0], thighL: [-15, 0, 3], kneeL: [25, 0, 0] }], [1, {}]] },
  cast: {
    dur: 1.05, keys: [[0, {}],
      [0.3, { chest: [-10, 15, 0], spine: [-4, 8, 0], neck: [-20, -10, 0], head: [-10, 0, 0], armL: [-170, 0, 10], elbowL: [-8, 0, 0], handL: [0, 0, 0], armR: [-5, 0, -20], thighL: [-12, 0, 3], kneeL: [12, 0, 0] }],
      [0.48, { hp: [0, -0.08, 0.05], chest: [12, 25, 0], spine: [10, 10, 0], neck: [-4, -20, 0], armL: [-92, 0, 8], elbowL: [-4, 0, 0], thighL: [-30, 0, 3], kneeL: [35, 0, 0], thighR: [18, 0, -3], kneeR: [15, 0, 0] }, 'in'],
      [0.75, { hp: [0, -0.07, 0.04], chest: [10, 22, 0], spine: [8, 8, 0], neck: [-4, -18, 0], armL: [-88, 0, 10], elbowL: [-10, 0, 0], thighL: [-26, 0, 3], kneeL: [30, 0, 0], thighR: [16, 0, -3], kneeR: [14, 0, 0] }],
      [1, {}]],
  },
  drink: {
    dur: 1.3, mask: 'upper', keys: [[0, {}],
      [0.25, { armL: [-35, 0, -25], elbowL: [-140, 0, 0], neck: [-6, 0, 0], head: [-4, 0, 0] }],
      [0.45, { neck: [-25, 0, 0], head: [-10, 0, 0], armL: [-55, 0, -25], elbowL: [-145, 0, 0] }],
      [0.75, { neck: [-25, 0, 0], head: [-10, 0, 0], armL: [-55, 0, -25], elbowL: [-145, 0, 0] }],
      [1, {}]],
  },
  // thrown back: stagger, land on the back, then get up the way a person does (quicker than in a cutscene)
  knock: {
    dur: 2.1, keys: [[0, {}],
      [0.08, { hips: [-22, 0, 0], hp: [0, -0.16, -0.22], spine: [-12, 0, 0], chest: [-8, 0, 0], neck: [18, 0, 0], armL: [-45, 0, 55], elbowL: [-30, 0, 0], armR: [-45, 0, -55], elbowR: [-30, 0, 0], thighL: [-25, 0, 6], kneeL: [35, 0, 0], thighR: [10, 0, -6], kneeR: [20, 0, 0] }],
      [0.22, { hips: [-86, 0, 0], hp: [0, -0.82, -0.62], spine: [6, 0, 0], neck: [28, 0, 0], armL: [-15, 0, 62], elbowL: [-15, 0, 0], armR: [-15, 0, -62], elbowR: [-15, 0, 0], thighL: [-22, 0, 6], kneeL: [30, 0, 0], thighR: [-34, 0, -6], kneeR: [50, 0, 0] }, 'in'],
      [0.3, { hips: [-90, 0, 0], hp: [0, -0.86, -0.64], neck: [14, 0, 0], armL: [-10, 0, 66], elbowL: [-10, 0, 0], armR: [-10, 0, -66], elbowR: [-10, 0, 0], thighL: [-14, 0, 6], kneeL: [20, 0, 0], thighR: [-26, 0, -6], kneeR: [40, 0, 0] }],
      [0.44, { ...PROPPED, hp: [0, -0.84, -0.6] }],
      [0.58, { ...SIT_UP, hp: [0, -0.82, -0.5] }],
      [0.74, { ...CROUCH_HAND, hp: [0, -0.52, -0.25] }],
      [0.88, { ...PUSH_UP, hp: [0, -0.2, -0.08] }],
      [1, {}]],
  },

  /* ---------------------------------------------------------- hoplite */
  thrust: {
    dur: 1.2, keys: [[0, {}],
      [0.36, { hp: [0, -0.08, -0.05], chest: [0, 32, 0], spine: [6, 10, 0], armR: [25, 0, -28], elbowR: [-110, 0, 0], handR: [0, 0, 0] }],
      [0.5, { hp: [0, -0.1, 0.15], chest: [10, -12, 0], spine: [16, -6, 0], armR: [-78, 0, -6], elbowR: [-6, 0, 0], handR: [0, 0, 0], thighL: [-40, 0, 6], kneeL: [40, 0, 0], thighR: [22, 0, -8], kneeR: [16, 0, 0] }, 'in'],
      [0.7, { hp: [0, -0.1, 0.14], chest: [8, -10, 0], spine: [14, -5, 0], armR: [-72, 0, -8], elbowR: [-15, 0, 0], thighL: [-38, 0, 6], kneeL: [38, 0, 0], thighR: [20, 0, -8], kneeR: [16, 0, 0] }],
      [1, {}]],
  },
  bash: {
    dur: 1.0, keys: [[0, {}],
      [0.32, { chest: [0, 40, 0], spine: [4, 10, 0], armL: [5, -80, 45], elbowL: [-105, 0, 0], hp: [0, -0.08, -0.04] }],
      [0.46, { chest: [12, -25, 0], spine: [12, -10, 0], armL: [-45, -62, 32], elbowL: [-88, 0, 0], hp: [0, -0.08, 0.2], thighL: [-35, 0, 6], kneeL: [38, 0, 0] }, 'in'],
      [0.7, { chest: [10, -20, 0], spine: [10, -8, 0], armL: [-40, -64, 34], elbowL: [-90, 0, 0], hp: [0, -0.08, 0.18], thighL: [-32, 0, 6], kneeL: [35, 0, 0] }],
      [1, {}]],
  },
  alert: { dur: 1.4, keys: [[0, {}], [0.4, { armR: [-150, 0, -20], elbowR: [-40, 0, 0], neck: [-25, 0, 0], chest: [-10, 0, 0] }], [0.7, { armR: [-152, 0, -20], elbowR: [-40, 0, 0], neck: [-25, 0, 0], chest: [-10, 0, 0] }], [1, {}]] },

  /* ---------------------------------------------------------- cyclops */
  slam: {
    dur: 1.8, keys: [[0, {}],
      [0.38, { hp: [0, 0.02, -0.05], spine: [-12, 0, 0], chest: [-12, 0, 0], neck: [10, 0, 0], armR: [-185, 0, -10], elbowR: [-50, 0, 0], handR: [-30, 0, 0], armL: [-175, 0, 10], elbowL: [-55, 0, 0] }],
      [0.55, { hp: [0, -0.3, 0.15], spine: [38, 0, 0], chest: [18, 0, 0], neck: [-30, 0, 0], armR: [-55, 0, -8], elbowR: [-5, 0, 0], handR: [-40, 0, 0], armL: [-50, 0, 8], elbowL: [-10, 0, 0], thighL: [-50, 0, 10], kneeL: [60, 0, 0], thighR: [20, 0, -10], kneeR: [40, 0, 0] }, 'in'],
      [0.78, { hp: [0, -0.3, 0.15], spine: [36, 0, 0], chest: [18, 0, 0], neck: [-28, 0, 0], armR: [-55, 0, -8], elbowR: [-8, 0, 0], handR: [-40, 0, 0], armL: [-50, 0, 8], elbowL: [-12, 0, 0], thighL: [-48, 0, 10], kneeL: [58, 0, 0], thighR: [20, 0, -10], kneeR: [40, 0, 0] }],
      [1, {}]],
  },
  sweep: {
    dur: 1.6, keys: [[0, {}],
      [0.36, { chest: [5, -40, 0], spine: [10, -20, 0], armR: [-20, 10, -85], elbowR: [-30, 0, 0], handR: [-40, 0, 0], armL: [-20, 0, 40], hp: [0, -0.1, 0] }],
      [0.55, { chest: [10, 40, 0], spine: [14, 22, 0], armR: [-15, 95, -85], elbowR: [-10, 0, 0], handR: [-40, 0, 0], armL: [10, 0, 25], hp: [0, -0.14, 0.05] }, 'in'],
      [0.75, { chest: [8, 34, 0], spine: [12, 18, 0], armR: [-18, 85, -80], elbowR: [-20, 0, 0], handR: [-40, 0, 0], armL: [10, 0, 25], hp: [0, -0.12, 0.04] }],
      [1, {}]],
  },
  stomp: {
    dur: 1.4, keys: [[0, {}],
      [0.38, { hp: [0, 0.05, 0], thighR: [-75, 0, -10], kneeR: [95, 0, 0], footR: [-10, 0, 0], armL: [-40, 0, 50], armR: [-40, 0, -50], spine: [-6, 0, 0], chest: [-10, 0, 0], thighL: [-8, 0, 0], kneeL: [10, 0, 0] }],
      [0.52, { hp: [0, -0.22, 0], thighR: [-30, 0, -10], kneeR: [30, 0, 0], thighL: [-20, 0, 0], kneeL: [40, 0, 0], spine: [25, 0, 0], chest: [15, 0, 0], armL: [-20, 0, 40], armR: [-30, 0, -40] }, 'in'],
      [0.7, { hp: [0, -0.2, 0], thighR: [-30, 0, -10], kneeR: [30, 0, 0], thighL: [-20, 0, 0], kneeL: [40, 0, 0], spine: [22, 0, 0], chest: [14, 0, 0], armL: [-20, 0, 40], armR: [-30, 0, -40] }],
      [1, {}]],
  },

  /* ---------------------------------------------------------- Ares */
  overhead: {
    dur: 1.75, keys: [[0, {}],
      [0.38, { hp: [0, 0.02, -0.06], spine: [-10, 0, 0], chest: [-12, -10, 0], neck: [10, 8, 0], armR: [-178, 0, -12], elbowR: [-55, 0, 0], handR: [-15, 0, 0], armL: [-60, 0, 40], elbowL: [-40, 0, 0] }],
      [0.54, { hp: [0, -0.28, 0.22], spine: [34, 0, 0], chest: [20, 0, 0], neck: [-28, 0, 0], armR: [-58, 0, -8], elbowR: [-6, 0, 0], handR: [-30, 0, 0], armL: [-10, 0, 40], elbowL: [-30, 0, 0], thighL: [-50, 0, 8], kneeL: [58, 0, 0], thighR: [22, 0, -8], kneeR: [38, 0, 0] }, 'in'],
      [0.8, { hp: [0, -0.26, 0.2], spine: [32, 0, 0], chest: [18, 0, 0], neck: [-26, 0, 0], armR: [-58, 0, -8], elbowR: [-8, 0, 0], handR: [-30, 0, 0], armL: [-10, 0, 40], elbowL: [-30, 0, 0], thighL: [-48, 0, 8], kneeL: [56, 0, 0], thighR: [20, 0, -8], kneeR: [36, 0, 0] }],
      [1, {}]],
  },
  combo: {
    dur: 2.7, keys: [[0, {}],
      [0.1, { chest: [4, -35, 0], spine: [8, -15, 0], armR: [-15, 10, -80], elbowR: [-25, 0, 0], handR: [-25, 0, 0], hp: [0, -0.06, 0] }],
      [0.22, { chest: [8, 35, 0], spine: [14, 15, 0], armR: [-10, 90, -82], elbowR: [-10, 0, 0], handR: [-20, 0, 0], hp: [0, -0.1, 0.08], thighL: [-30, 0, 8], kneeL: [32, 0, 0] }, 'in'],
      [0.36, { chest: [6, 40, 0], spine: [10, 15, 0], armR: [-20, 110, -70], elbowR: [-70, 0, 0], handR: [-20, 0, 0], hp: [0, -0.08, 0.05] }],
      [0.48, { chest: [6, -40, 0], spine: [12, -15, 0], armR: [-10, 30, -85], elbowR: [-10, 0, 0], handR: [-10, 0, 0], hp: [0, -0.1, 0.12], thighR: [-30, 0, -8], kneeR: [32, 0, 0] }, 'in'],
      [0.62, { armR: [-170, 0, -12], elbowR: [-60, 0, 0], handR: [-10, 0, 0], spine: [-8, 0, 0], chest: [-10, 0, 0], hp: [0, 0, 0.1] }],
      [0.76, { armR: [-60, 0, -8], elbowR: [-8, 0, 0], handR: [-30, 0, 0], spine: [30, 0, 0], chest: [20, 0, 0], neck: [-25, 0, 0], hp: [0, -0.25, 0.25], thighL: [-48, 0, 8], kneeL: [55, 0, 0], thighR: [22, 0, -8], kneeR: [35, 0, 0] }, 'in'],
      [0.9, { armR: [-60, 0, -8], elbowR: [-10, 0, 0], handR: [-30, 0, 0], spine: [28, 0, 0], chest: [18, 0, 0], neck: [-22, 0, 0], hp: [0, -0.24, 0.24], thighL: [-46, 0, 8], kneeL: [52, 0, 0], thighR: [20, 0, -8], kneeR: [33, 0, 0] }],
      [1, {}]],
  },
  lunge: {
    dur: 1.4, keys: [[0, {}],
      [0.3, { hp: [0, -0.12, -0.1], chest: [0, 30, 0], spine: [8, 15, 0], armR: [25, 0, -25], elbowR: [-100, 0, 0], handR: [-10, 0, 0] }],
      [0.48, { hp: [0, -0.15, 0.2], chest: [10, -15, 0], spine: [18, -8, 0], armR: [-80, 0, -5], elbowR: [-5, 0, 0], handR: [-5, 0, 0], thighL: [-50, 0, 8], kneeL: [50, 0, 0], thighR: [25, 0, -8], kneeR: [20, 0, 0] }, 'in'],
      [0.7, { hp: [0, -0.14, 0.18], chest: [8, -12, 0], spine: [16, -6, 0], armR: [-76, 0, -6], elbowR: [-10, 0, 0], handR: [-8, 0, 0], thighL: [-46, 0, 8], kneeL: [46, 0, 0], thighR: [22, 0, -8], kneeR: [18, 0, 0] }],
      [1, {}]],
  },
  leap: {
    dur: 2.2, keys: [[0, {}],
      [0.22, { hp: [0, -0.3, 0], spine: [25, 0, 0], chest: [10, 0, 0], armR: [-30, 0, -30], elbowR: [-60, 0, 0], handR: [-60, 0, 0], armL: [-20, 0, 30], thighL: [-60, 0, 10], kneeL: [90, 0, 0], footL: [-25, 0, 0], thighR: [-40, 0, -10], kneeR: [80, 0, 0], footR: [-30, 0, 0] }],
      [0.4, { hp: [0, 0.1, 0], spine: [-15, 0, 0], chest: [-15, 0, 0], armR: [-180, 0, -10], elbowR: [-40, 0, 0], handR: [-10, 0, 0], armL: [-150, 0, 30], thighL: [-70, 0, 0], kneeL: [100, 0, 0], thighR: [-30, 0, 0], kneeR: [80, 0, 0] }],
      [0.58, { hp: [0, -0.35, 0.2], spine: [35, 0, 0], chest: [20, 0, 0], neck: [-30, 0, 0], armR: [-55, 0, -8], elbowR: [-5, 0, 0], handR: [-35, 0, 0], armL: [-40, 0, 30], thighL: [-65, 0, 8], kneeL: [95, 0, 0], thighR: [25, 0, -8], kneeR: [80, 0, 0] }, 'in'],
      [0.82, { hp: [0, -0.33, 0.18], spine: [32, 0, 0], chest: [18, 0, 0], neck: [-26, 0, 0], armR: [-55, 0, -8], elbowR: [-8, 0, 0], handR: [-35, 0, 0], armL: [-40, 0, 30], thighL: [-62, 0, 8], kneeL: [90, 0, 0], thighR: [24, 0, -8], kneeR: [76, 0, 0] }],
      [1, {}]],
  },
  nova: {
    dur: 2.5, keys: [[0, {}],
      [0.15, { armR: [-175, 0, -5], elbowR: [-5, 0, 0], handR: [0, 0, 0], armL: [-170, 0, 10], elbowL: [-10, 0, 0], neck: [-25, 0, 0], chest: [-12, 0, 0], spine: [-6, 0, 0], hp: [0, 0.02, 0] }],
      [0.5, { armR: [-178, 0, -4], elbowR: [-4, 0, 0], handR: [0, 0, 0], armL: [-172, 0, 10], elbowL: [-8, 0, 0], neck: [-30, 0, 0], chest: [-14, 0, 0], spine: [-6, 0, 0], hp: [0, 0.04, 0] }],
      [0.62, { hp: [0, -0.4, 0.1], spine: [40, 0, 0], chest: [25, 0, 0], neck: [-30, 0, 0], armR: [-40, 0, -5], elbowR: [0, 0, 0], handR: [-35, 0, 0], armL: [-40, 0, 10], elbowL: [0, 0, 0], thighL: [-70, 0, 10], kneeL: [100, 0, 0], thighR: [20, 0, -10], kneeR: [90, 0, 0] }, 'in'],
      [0.85, { hp: [0, -0.38, 0.1], spine: [38, 0, 0], chest: [24, 0, 0], neck: [-28, 0, 0], armR: [-40, 0, -5], elbowR: [-4, 0, 0], handR: [-35, 0, 0], armL: [-40, 0, 10], elbowL: [-4, 0, 0], thighL: [-68, 0, 10], kneeL: [96, 0, 0], thighR: [20, 0, -10], kneeR: [86, 0, 0] }],
      [1, {}]],
  },
  /* ---------------------------------------------------------- Ares' grip (the shard of war in Ariel) */
  // hit by it: doubled over, hands to the head
  clutch: { dur: 0.9, hold: true, keys: [[0, {}], [0.45, CLUTCH], [1, { ...CLUTCH, neck: [32, 0, 0] }]] },
  // taken over: the body straightens like a puppet and the sword arm rises on its own
  seized: {
    dur: 3.0, hold: true, keys: [[0, CLUTCH],
      [0.3, { hp: [0, 0.02, 0], spine: [-6, 0, 0], chest: [-12, 0, 0], neck: [-26, 0, 0], head: [-8, 0, 0], armL: [-8, 0, 34], elbowL: [-10, 0, 0], armR: [-16, 0, -26], elbowR: [-14, 0, 0], handR: [0, 0, 0] }],
      [0.65, { hp: [0, 0.03, 0], spine: [-6, 0, 0], chest: [-12, 0, 0], neck: [-22, 0, 0], head: [-6, 0, 0], armL: [-8, 0, 40], elbowL: [-8, 0, 0], armR: [-95, 0, -18], elbowR: [-18, 0, 0], handR: [0, 0, 0] }, 'lin'],
      [1, { hp: [0, 0.04, 0], spine: [-6, 0, 0], chest: [-12, 0, 0], neck: [-20, 0, 0], head: [-6, 0, 0], armL: [-8, 0, 42], elbowL: [-8, 0, 0], armR: [-150, 0, -16], elbowR: [-20, 0, 0], handR: [0, 0, 0] }]],
  },
  /* ---------------------------------------------------------- Kronos (prologue) */
  chained: { dur: 0.5, hold: true, keys: [[0, CHAINED], [1, CHAINED]] },
  breakChains: {
    dur: 4.2, hold: true, keys: [[0, CHAINED],
      [0.22, { ...KNEEL, armL: [-20, 0, 82], elbowL: [-35, 0, 0], armR: [-20, 0, -82], elbowR: [-35, 0, 0], handR: [0, 0, 0], spine: [6, 0, 0], chest: [-6, 0, 0], neck: [-12, 0, 0] }],
      [0.34, { ...KNEEL, armL: [-45, 0, 105], elbowL: [-20, 0, 0], armR: [-45, 0, -105], elbowR: [-20, 0, 0], handR: [0, 0, 0], spine: [-10, 0, 0], chest: [-16, 0, 0], neck: [-38, 0, 0] }, 'in'],
      [0.72, { hp: [0, -0.08, 0], spine: [-8, 0, 0], chest: [-14, 0, 0], neck: [-32, 0, 0], head: [-10, 0, 0], armL: [-30, 0, 72], elbowL: [-45, 0, 0], armR: [-30, 0, -72], elbowR: [-45, 0, 0], handR: [0, 0, 0], thighL: [-6, 0, 8], thighR: [4, 0, -8] }],
      [1, { hp: [0, -0.06, 0], spine: [-6, 0, 0], chest: [-12, 0, 0], neck: [-26, 0, 0], head: [-8, 0, 0], armL: [-28, 0, 66], elbowL: [-48, 0, 0], armR: [-28, 0, -66], elbowR: [-48, 0, 0], handR: [0, 0, 0], thighL: [-6, 0, 8], thighR: [4, 0, -8] }]],
  },
  absorb: { dur: 1.4, hold: true, keys: [[0, {}], [1, { armR: [-150, 0, -25], elbowR: [-25, 0, 0], handR: [0, 0, 0], armL: [-20, 0, 35], elbowL: [-40, 0, 0], chest: [-10, 0, 0], neck: [-18, 0, 0] }]] },
  /* ---------------------------------------------------------- Ariel's ordinary life */
  // a newborn held against the chest, both forearms under it, head bowed to look at it
  // (an upper arm turned inward — left y<0, right y>0 — swings the bent forearm across the body)
  cradle: { dur: 1.0, hold: true, keys: [[0, {}], [1, { armL: [-32, -42, 10], elbowL: [-92, -25, 0], handL: [0, 0, 0], armR: [-30, 42, -10], elbowR: [-95, 25, 0], handR: [0, 0, 0], chest: [4, 0, 0], neck: [20, 0, 0], head: [8, 0, 0] }]] },
  // holding something out to someone (an umbrella, a mug)
  offer: { dur: 0.9, hold: true, mask: 'upper', keys: [[0, {}], [1, { armR: [-52, 0, -6], elbowR: [-34, 0, 0], handR: [0, 0, 0], neck: [6, 0, 0] }]] },
  // a fist brought down on the thing in front of him
  thump: {
    dur: 0.8, keys: [[0, {}], [0.38, { armR: [-128, 0, -14], elbowR: [-75, 0, 0], handR: [0, 0, 0], chest: [-6, 10, 0], spine: [-4, 6, 0] }],
      [0.52, { armR: [-70, 0, -10], elbowR: [-18, 0, 0], handR: [0, 0, 0], chest: [10, -6, 0], spine: [6, -2, 0] }, 'out'], [1, {}]],
  },
  // jumping back, hands up
  startle: {
    dur: 0.9, keys: [[0, {}], [0.22, { hp: [0, -0.03, -0.07], armL: [-62, 0, 34], elbowL: [-85, 0, 0], armR: [-62, 0, -34], elbowR: [-85, 0, 0], chest: [-10, 0, 0], neck: [-12, 0, 0] }],
      [1, { armL: [-18, 0, 12], elbowL: [-30, 0, 0], armR: [-18, 0, -12], elbowR: [-30, 0, 0] }]],
  },
  // palms up, elbows in
  shrug: {
    dur: 1.3, mask: 'upper', keys: [[0, {}], [0.3, { armL: [-14, 0, 18], elbowL: [-78, 45, 0], armR: [-14, 0, -18], elbowR: [-78, -45, 0], chest: [-4, 0, 0], neck: [-4, 0, 9] }],
      [0.72, { armL: [-14, 0, 18], elbowL: [-78, 45, 0], armR: [-14, 0, -18], elbowR: [-78, -45, 0], chest: [-4, 0, 0], neck: [-4, 0, 9] }], [1, {}]],
  },
  // both hands on a phone held at the chest, head bowed over the screen
  // (elbows in at the ribs; the forearms meet by bending, not by twisting the upper arms, which flattens them)
  phone: { dur: 0.8, hold: true, mask: 'upper', keys: [[0, {}], [1, { armL: [-28, -18, -10], elbowL: [-96, -4, 0], handL: [-8, 0, 0], armR: [-28, 16, 10], elbowR: [-98, 4, 0], handR: [-8, 0, 0], neck: [24, 0, 0], head: [10, 0, 0] }]] },
  // arms folded across the chest
  fold: { dur: 0.8, hold: true, mask: 'upper', keys: [[0, {}], [1, { armL: [-28, -60, 6], elbowL: [-108, -50, 0], armR: [-28, 60, -6], elbowR: [-108, 50, 0], chest: [-3, 0, 0] }]] },
  rise: {
    dur: 3.4, keys: [[0, { ...KNEEL, neck: [35, 0, 0], spine: [24, 0, 0], handR: [-30, 0, 0], armR: [-60, 0, -10] }],
      [0.35, { ...KNEEL, neck: [-25, 0, 0], spine: [5, 0, 0], handR: [-30, 0, 0], armR: [-60, 0, -10] }],
      [0.7, { hp: [0, -0.1, 0], spine: [-8, 0, 0], chest: [-12, 0, 0], neck: [-10, 0, 0], armR: [-60, 0, -40], elbowR: [-20, 0, 0], armL: [-20, 0, 40] }],
      [1, {}]],
  },
};

/* --------------------------------------------------------------- rig */
const CLIP_CACHE = {};
class Rig {
  constructor(root, joints, opts = {}) {
    this.root = root;
    this.j = joints;
    this.jl = JOINTS.map((n) => joints[n]);
    this.hipRest = joints.hips.position.clone();
    this.stanceName = opts.stance || 'casual';
    this.stance = compilePose(STANCES[this.stanceName]);
    this.size = opts.size || 1;
    this.armSwing = opts.armSwing || [1, 0.4];
    this.stepLen = opts.stepLen || 1;
    this.cur = new Float32Array(POSE_LEN);
    this.tmp = new Float32Array(POSE_LEN);
    this.phase = 0; this.gait = 0; this.breath = Math.random() * 10;
    this.act = null; this.prev = null;
    this.flinch = 0; this.headYaw = 0; this.headPitch = 0;
    this.onStep = null; this._lastS = 0;
  }
  setStance(name) { this.stanceName = name; this.stance = compilePose(STANCES[name]); }
  clip(name) {
    const key = this.stanceName + ':' + name;
    if (CLIP_CACHE[key]) return CLIP_CACHE[key];
    const def = CLIPS[name];
    if (!def) { console.warn('missing clip', name); return null; }
    const base = STANCES[this.stanceName];
    const c = {
      name, dur: def.dur, loop: !!def.loop, hold: !!def.hold, mask: def.mask || null,
      keys: def.keys.map(([t, o, e]) => ({ t, p: compilePose(Object.assign({}, base, o)), e })),
    };
    // tangents for smooth (C1) motion through the keys: a limb keeps moving through a key pose
    // instead of stopping dead at each one. Monotone: a channel that turns around at a key gets
    // a zero tangent there, so nothing overshoots
    const K = c.keys;
    for (let i = 0; i < K.length; i++) {
      const m = new Float32Array(POSE_LEN);
      if (i > 0 && i < K.length - 1) {
        const a = K[i - 1], b = K[i], n = K[i + 1], d0t = Math.max(1e-4, b.t - a.t), d1t = Math.max(1e-4, n.t - b.t);
        for (let j = 0; j < POSE_LEN; j++) {
          const d0 = (b.p[j] - a.p[j]) / d0t, d1 = (n.p[j] - b.p[j]) / d1t;
          if (d0 * d1 <= 0) continue;
          const s = Math.sign(d0), lim = 3 * Math.min(Math.abs(d0), Math.abs(d1));
          m[j] = s * Math.min(lim, Math.abs(d0 + d1) * 0.5);
        }
      }
      K[i].m = m;
    }
    CLIP_CACHE[key] = c;
    return c;
  }
  play(name, { speed = 1, fade = 0.1, mask, t = 0 } = {}) {
    const c = this.clip(name);
    if (!c) return;
    if (this.act) this.prev = { c: this.act.c, t: this.act.t, w: this.act.w, fade: Math.max(0.05, fade), mask: this.act.mask };
    this.act = { name, c, t, speed, fade: Math.max(0.001, fade), w: fade <= 0.001 ? 1 : 0, mask: mask === undefined ? c.mask : mask, done: false };
  }
  stop(fade = 0.2) {
    if (!this.act) return;
    this.prev = { c: this.act.c, t: this.act.t, w: this.act.w, fade, mask: this.act.mask };
    this.act = null;
  }
  playing(name) { return this.act && this.act.name === name; }
  progress(name) { return this.act && this.act.name === name ? this.act.t : 1; }

  sample(c, t, out) {
    const k = c.keys;
    if (t <= k[0].t) { out.set(k[0].p); return; }
    const last = k[k.length - 1];
    if (t >= last.t) { out.set(last.p); return; }
    let i = 0;
    while (i < k.length - 2 && t >= k[i + 1].t) i++;
    const a = k[i], b = k[i + 1];
    let u = (t - a.t) / (b.t - a.t);
    const e = b.e;
    const A = a.p, B = b.p;
    if (e === 'in' || e === 'out' || e === 'lin') {
      // strikes accelerate into the hit; 'out' decelerates; 'lin' is constant
      if (e === 'in') u = u * u * (1.6 - 0.6 * u);
      else if (e === 'out') u = 1 - (1 - u) * (1 - u);
      for (let j = 0; j < POSE_LEN; j++) out[j] = A[j] + (B[j] - A[j]) * u;
      return;
    }
    // cubic Hermite with the precomputed tangents: continuous velocity through the keys
    const dt = b.t - a.t, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * dt, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * dt;
    const mA = a.m, mB = b.m;
    for (let j = 0; j < POSE_LEN; j++) out[j] = h00 * A[j] + h10 * mA[j] + h01 * B[j] + h11 * mB[j];
  }
  blend(src, w, mask) {
    const P = this.cur;
    if (w <= 0) return;
    // ease the cross-fade itself, so actions settle in and out instead of snapping at the ends
    w = w >= 1 ? 1 : w * w * (3 - 2 * w);
    if (mask === 'upper' || mask === 'arms') {
      for (const i of mask === 'arms' ? ARM_IDX : UPPER_IDX) { P[i] = lerpAngle(P[i], src[i], w); P[i + 1] = lerpAngle(P[i + 1], src[i + 1], w); P[i + 2] = lerpAngle(P[i + 2], src[i + 2], w); }
      return;
    }
    for (let i = 0; i < HP; i++) P[i] = lerpAngle(P[i], src[i], w);
    for (let i = HP; i < POSE_LEN; i++) P[i] = lerp(P[i], src[i], w);
  }

  /** speed: ground speed in m/s · dir: +1 forward, -1 backward */
  update(dt, speed = 0, dir = 1) {
    const P = this.cur;
    P.set(this.stance);
    // ---- locomotion layer
    this.gait = damp(this.gait, speed > 0.2 ? 1 : 0, 9, dt);
    const g = this.gait;
    if (g > 0.01) {
      const ns = speed / this.size;
      const run = smooth(2.4, 5.6, ns);
      const stride = lerp(0.62, 1.18, run) * this.stepLen;
      this.phase += dt * Math.max(ns, 0.8) / (2 * stride) * TAU * (dir < 0 ? -1 : 1);
      const s = Math.sin(this.phase), c = Math.cos(this.phase);
      const amp = lerp(22, 40, run) * g * DEG;
      const tL = -s * amp, tR = s * amp;
      const kL = (6 + Math.max(0, c) * lerp(32, 85, run)) * g * DEG;
      const kR = (6 + Math.max(0, -c) * lerp(32, 85, run)) * g * DEG;
      P[JI.thighL] += tL; P[JI.thighR] += tR;
      P[JI.kneeL] += kL; P[JI.kneeR] += kR;
      P[JI.footL] += -(tL + kL) * 0.35; P[JI.footR] += -(tR + kR) * 0.35;
      const arm = lerp(16, 36, run) * g * DEG;
      P[JI.armL] += s * arm * this.armSwing[0];
      P[JI.armR] += -s * arm * this.armSwing[1];
      P[JI.elbowL] += -lerp(6, 48, run) * g * DEG * this.armSwing[0];
      P[JI.elbowR] += -lerp(6, 30, run) * g * DEG * this.armSwing[1];
      P[JI.spine] += lerp(2, 13, run) * g * DEG;
      P[JI.hips + 1] += -s * lerp(4, 9, run) * g * DEG;
      P[JI.chest + 1] += s * lerp(5, 11, run) * g * DEG;
      // the head stays on target while the chest twists, and the pelvis drops toward the swinging leg
      P[JI.neck + 1] += -s * lerp(4, 9, run) * 0.8 * g * DEG;
      P[JI.hips + 2] += c * lerp(3, 4.5, run) * g * DEG;
      P[JI.chest + 2] += -c * lerp(2, 3, run) * g * DEG;
      P[JI.neck] += -lerp(0, 8, run) * g * DEG;
      P[HP + 1] += (-Math.abs(s) * lerp(0.02, 0.06, run) - 0.025 * run) * g;
      if (s * this._lastS < 0 && this.onStep) this.onStep(run);
      this._lastS = s;
    }
    // ---- breathing, and a slow shift of weight from foot to foot when standing
    this.breath += dt;
    const br = Math.sin(this.breath * 1.7), sway = Math.sin(this.breath * 0.42) * (1 - g);
    P[JI.chest] += br * 1.4 * DEG * (1 - g * 0.7);
    P[JI.armL + 2] += br * 1.0 * DEG; P[JI.armR + 2] -= br * 1.0 * DEG;
    P[HP] += sway * 0.012; P[JI.hips + 2] += sway * 1.6 * DEG; P[JI.chest + 2] -= sway * 1.2 * DEG; P[JI.neck + 2] -= sway * 0.6 * DEG;

    // ---- action layer
    const a = this.act;
    if (a) {
      a.t += dt * a.speed / a.c.dur;
      if (a.t >= 1) {
        if (a.c.loop) a.t %= 1;
        else if (a.c.hold) { a.t = 1; a.done = true; }
        else {
          a.done = true;
          this.prev = { c: a.c, t: 1, w: a.w, fade: 0.16, mask: a.mask };
          this.act = null;
        }
      }
    }
    if (this.prev) {
      const pr = this.prev, ac = this.act;
      // a new action over the same body parts blends straight from the old pose: the old one holds
      // its weight until the new one has fully taken over (fading both at once sags toward the idle
      // stance mid-transition). With nothing following, the old action fades back to the stance.
      if (ac && (ac.mask || null) === (pr.mask || null)) { if (ac.w >= 1) this.prev = null; }
      else pr.w -= dt / pr.fade;
      if (this.prev) {
        if (pr.w <= 0) this.prev = null;
        else { this.sample(pr.c, pr.t, this.tmp); this.blend(this.tmp, pr.w, pr.mask); }
      }
    }
    if (this.act) {
      const ac = this.act;
      ac.w = Math.min(1, ac.w + dt / ac.fade);
      this.sample(ac.c, ac.t, this.tmp);
      this.blend(this.tmp, ac.w, ac.mask);
    }
    // ---- additive layers
    if (this.flinch > 0) {
      this.flinch = Math.max(0, this.flinch - dt * 4);
      P[JI.spine] -= this.flinch * 14 * DEG; P[JI.chest] -= this.flinch * 10 * DEG; P[JI.neck] += this.flinch * 12 * DEG;
    }
    if (this.legYaw) { P[JI.hips + 1] += this.legYaw; P[JI.spine + 1] -= this.legYaw * 0.55; P[JI.chest + 1] -= this.legYaw * 0.45; }
    P[JI.neck + 1] += this.headYaw * 0.6; P[JI.head + 1] += this.headYaw * 0.4;
    P[JI.neck] += this.headPitch * 0.6; P[JI.head] += this.headPitch * 0.4;
    this.apply(P);
  }
  /**
   * Whole-body lean, pivoting at the feet: into turns (as fast as you're turning) and forward or
   * back when speeding up or slowing down. Call after setting root.rotation.y.
   */
  lean(dt, speed, heading) {
    if (dt <= 0) return;
    const r = this.root;
    if (r.rotation.order !== 'YXZ') r.rotation.order = 'YXZ';
    const L = this._lean || (this._lean = { h: heading, v: speed, bank: 0, pitch: 0 });
    const om = wrapAngle(heading - L.h) / dt, acc = (speed - L.v) / dt;
    L.h = heading; L.v = speed;
    const wantBank = clamp(-Math.atan((speed * om) / 9.8) * 0.45, -0.2, 0.2);
    const wantPitch = clamp(acc * 0.011, -0.07, 0.09);
    L.bank = damp(L.bank, wantBank, 6, dt);
    L.pitch = damp(L.pitch, wantPitch, 4, dt);
    r.rotation.z = L.bank;
    r.rotation.x = L.pitch;
  }
  apply(P) {
    const rest = this.rest;
    for (let i = 0; i < NJ; i++) {
      const j = this.jl[i];
      if (!j) continue;
      j.rotation.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      // a sculpted model's own resting pose, with the animation laid on top of it (see Models.autoSkin)
      if (rest && rest[i]) j.quaternion.premultiply(rest[i]);
    }
    this.j.hips.position.set(this.hipRest.x + P[HP], this.hipRest.y + P[HP + 1], this.hipRest.z + P[HP + 2]);
  }
  /** pose immediately from a clip at time t (used for statues) */
  pose(name, t = 1) {
    const c = this.clip(name);
    this.cur.set(this.stance);
    if (c) { this.sample(c, t, this.tmp); this.blend(this.tmp, 1, null); }
    this.apply(this.cur);
  }
  poseFrom(obj) {
    this.apply(compilePose(Object.assign({}, STANCES[this.stanceName], obj)));
  }
}

/* --------------------------------------------------------------- cloth */
class Cape {
  constructor(rig, o) {
    this.rig = rig;
    this.cols = o.cols || 9; this.rows = o.rows || 13;
    const s = rig.size;
    this.w = o.width * s; this.len = o.length * s;
    this.back = (o.back ?? -0.13) * s;
    const n = this.cols * this.rows;
    this.p = new Float32Array(n * 3);
    this.q = new Float32Array(n * 3);
    // pinned in a curve over the tops of the shoulders and gathered behind the neck; the cloth itself
    // is wider than that gather, so it falls in folds and flares toward the hem instead of hanging flat
    this.anchor = [];
    const topW = o.topWidth ?? o.width * 0.72;
    let anchorBack = o.back ?? -0.13;
    if (o.profile) {
      const P = o.profile, b = clamp(Math.floor(((o.top ?? 0.24) - P.y0) / P.dy), 0, P.z.length - 1);
      anchorBack = Math.min(P.z[b], P.z[Math.max(0, b - 1)]) - 0.03;
    }
    for (let c = 0; c < this.cols; c++) {
      const u = c / (this.cols - 1), e = 2 * u - 1;
      this.anchor.push(new THREE.Vector3((0.5 - u) * topW, (o.top ?? 0.24) + e * e * 0.02, anchorBack * (1 - e * e * 0.6) - Math.sin(u * Math.PI) * 0.02));
    }
    this.dx = this.w / (this.cols - 1);
    this.dy = this.len / (this.rows - 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    const uv = new Float32Array(n * 2), idx = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const i = r * this.cols + c;
      uv[i * 2] = c / (this.cols - 1); uv[i * 2 + 1] = r / (this.rows - 1);
      if (r < this.rows - 1 && c < this.cols - 1) { const b = i + 1, d = i + this.cols, e = d + 1; idx.push(i, d, b, b, d, e); }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, o.material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.v = new THREE.Vector3(); this.c = new THREE.Vector3(); this.f = new THREE.Vector3();
    this.profile = o.profile || null;
    this.legSegs = new Float32Array(4 * 7); // thigh and shin capsules: ax ay az bx by bz r
    this.active = true;
    this.needsReset = true;
  }
  /**
   * How far back the body reaches at each height, measured on a character's model (chest space,
   * centre of the back): the cape drapes over the real shoulder blades, belt and hips, not a flat wall.
   */
  static backProfile(rig, binding) {
    rig.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(rig.j.chest.matrixWorld).invert();
    const bins = 28, y0 = -0.95, y1 = 0.45, dy = (y1 - y0) / bins, z = new Float32Array(bins).fill(9), v = new THREE.Vector3();
    for (const p of Models.posedPoints(binding, /./)) {
      v.copy(p).applyMatrix4(inv);
      if (Math.abs(v.x) > 0.2) continue;
      const b = Math.floor((v.y - y0) / dy);
      if (b >= 0 && b < bins && v.z < z[b]) z[b] = v.z;
    }
    for (let i = 0; i < bins; i++) if (z[i] > 8) z[i] = i > 0 ? z[i - 1] : -0.15;
    for (let i = bins - 2; i >= 0; i--) if (z[i] > 8) z[i] = z[i + 1];
    // widen each bump over its neighbours, so the cloth can't settle into the gap between two heights
    const out = new Float32Array(bins);
    for (let i = 0; i < bins; i++) out[i] = Math.min(z[i], z[Math.max(0, i - 1)], z[Math.min(bins - 1, i + 1)]);
    return { y0, dy, z: out };
  }
  profileAt(y) {
    const P = this.profile, b = clamp(Math.floor((y - P.y0) / P.dy), 0, P.z.length - 1);
    return P.z[b];
  }
  /** capsules around the legs, so a running stride pushes the cloth aside instead of passing through it */
  updateLegs() {
    const J = this.rig.j, k = this.rig.root.scale.x, S = this.legSegs, a = this.v, b = this.c;
    let n = 0;
    for (const side of ['L', 'R']) {
      for (const [j0, j1, r] of [['thigh', 'knee', 0.115], ['knee', 'foot', 0.09]]) {
        J[j0 + side].getWorldPosition(a); J[j1 + side].getWorldPosition(b);
        S.set([a.x, a.y, a.z, b.x, b.y, b.z, r * k], n * 7);
        n++;
      }
    }
  }
  collideLegs() {
    const P = this.p, S = this.legSegs;
    for (let i = this.cols * 3; i < P.length; i += 3) {
      for (let s = 0; s < 4; s++) {
        const o = s * 7;
        const ax = S[o], ay = S[o + 1], az = S[o + 2], ex = S[o + 3] - ax, ey = S[o + 4] - ay, ez = S[o + 5] - az, r = S[o + 6];
        const l2 = ex * ex + ey * ey + ez * ez || 1e-6;
        const u = clamp(((P[i] - ax) * ex + (P[i + 1] - ay) * ey + (P[i + 2] - az) * ez) / l2, 0, 1);
        const dx = P[i] - (ax + ex * u), dy = P[i + 1] - (ay + ey * u), dz = P[i + 2] - (az + ez * u);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-10) continue;
        const d = Math.sqrt(d2), f = (r - d) / d;
        P[i] += dx * f; P[i + 1] += dy * f; P[i + 2] += dz * f;
      }
    }
  }
  attach(scene) { scene.add(this.mesh); this.needsReset = true; }
  reset() {
    this.rig.root.updateMatrixWorld(true);
    const M = this.rig.j.chest.matrixWorld;
    this.f.set(M.elements[8], M.elements[9], M.elements[10]).normalize();
    const rx = M.elements[0], rz = M.elements[2], rl = Math.hypot(rx, rz) || 1;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const i = (r * this.cols + c) * 3;
      this.v.copy(this.anchor[c]).applyMatrix4(M);
      // start already flared toward the full width, with alternate columns set back: the folds form at once
      const k = Math.min(1, r / 3), u = c / (this.cols - 1);
      const spread = ((0.5 - u) * (this.w - Math.abs(this.anchor[0].x * 2 * this.rig.root.scale.x))) * k;
      const pleat = (c % 2 ? 0.035 : 0) * k * this.rig.size;
      this.p[i] = this.v.x + (rx / rl) * spread - this.f.x * pleat;
      this.p[i + 1] = this.v.y - r * this.dy;
      this.p[i + 2] = this.v.z + (rz / rl) * spread - this.f.z * pleat;
      this.q[i] = this.p[i]; this.q[i + 1] = this.p[i + 1]; this.q[i + 2] = this.p[i + 2];
    }
    this.needsReset = false;
  }
  update(dt) {
    if (!this.mesh.visible) return;
    if (this.needsReset) this.reset();
    dt = Math.min(dt, 1 / 30);
    if (dt <= 0) return;
    this.rig.root.updateMatrixWorld(true);
    const M = this.rig.j.chest.matrixWorld;
    const P = this.p, Q = this.q, cols = this.cols, rows = this.rows;
    // pin top row; teleport guard
    this.v.copy(this.anchor[0]).applyMatrix4(M);
    if (Math.abs(this.v.x - P[0]) + Math.abs(this.v.z - P[2]) > 3 * this.rig.size) { this.reset(); return; }
    for (let c = 0; c < cols; c++) {
      this.v.copy(this.anchor[c]).applyMatrix4(M);
      const i = c * 3;
      P[i] = this.v.x; P[i + 1] = this.v.y; P[i + 2] = this.v.z;
      Q[i] = P[i]; Q[i + 1] = P[i + 1]; Q[i + 2] = P[i + 2];
    }
    // integrate
    const grav = -9.8 * dt * dt, t = G.time;
    const wx = (Math.sin(t * 1.3) * 0.5 + 0.6) * dt * dt * 1.6, wz = Math.cos(t * 0.9) * 0.4 * dt * dt * 1.6;
    for (let i = cols * 3; i < P.length; i += 3) {
      const vx = (P[i] - Q[i]) * 0.982, vy = (P[i + 1] - Q[i + 1]) * 0.982, vz = (P[i + 2] - Q[i + 2]) * 0.982;
      Q[i] = P[i]; Q[i + 1] = P[i + 1]; Q[i + 2] = P[i + 2];
      P[i] += vx + wx; P[i + 1] += vy + grav; P[i + 2] += vz + wz;
    }
    // the back is rounded, not a wall: the cloth stays behind it, but may wrap forward around the sides
    this.c.setFromMatrixPosition(M);
    this.f.set(M.elements[8], M.elements[9], M.elements[10]).normalize();
    const rl = Math.hypot(M.elements[0], M.elements[1], M.elements[2]) || 1;
    const ax = M.elements[0] / rl, ay = M.elements[1] / rl, az = M.elements[2] / rl;
    const ux = M.elements[4] / rl, uy = M.elements[5] / rl, uz = M.elements[6] / rl;
    const back = this.back, cx = this.c.x, cy = this.c.y, cz = this.c.z, fx = this.f.x, fy = this.f.y, fz = this.f.z;
    const curve = 1.6 / this.rig.size, prof = this.profile;
    const dx = this.dx, dy = this.dy;
    this.updateLegs();
    for (let it = 0; it < 5; it++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 3;
        if (c < cols - 1) this.solve(i, i + 3, dx, r === 0);
        if (r < rows - 1) this.solve(i, i + cols * 3, dy, r === 0);
        // a little stiffness down the length, so folds run in long smooth lines instead of crumpling
        if (r < rows - 2) this.solve(i, i + cols * 6, dy * 2, r === 0, 0.35);
      }
      for (let i = cols * 3; i < P.length; i += 3) {
        const ox = P[i] - cx, oy = P[i + 1] - cy, oz = P[i + 2] - cz;
        const lat = ox * ax + oy * ay + oz * az;
        // measured back (chest space, scaled with the body) or the flat default
        const base = prof ? (this.profileAt((ox * ux + oy * uy + oz * uz) / rl) - 0.035) * rl : back;
        const lim = base + curve * lat * lat;
        const d = ox * fx + oy * fy + oz * fz;
        if (d > lim) { const k = d - lim; P[i] -= fx * k; P[i + 1] -= fy * k; P[i + 2] -= fz * k; }
      }
      if (it >= 2) this.collideLegs();
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  solve(i, j, rest, pinnedI, stiff = 1) {
    const P = this.p;
    const x = P[j] - P[i], y = P[j + 1] - P[i + 1], z = P[j + 2] - P[i + 2];
    const d = Math.sqrt(x * x + y * y + z * z) || 1e-6;
    const diff = ((d - rest) / d) * stiff;
    if (pinnedI) {
      if (j < this.cols * 3) return;
      P[j] -= x * diff; P[j + 1] -= y * diff; P[j + 2] -= z * diff;
    } else {
      const h = diff * 0.5;
      P[i] += x * h; P[i + 1] += y * h; P[i + 2] += z * h;
      P[j] -= x * h; P[j + 1] -= y * h; P[j + 2] -= z * h;
    }
  }
}

/* --------------------------------------------------------------- materials */
const Mat = {};
function initCharacterMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  Tex.cloth.normal.repeat.set(4, 4);
  Object.assign(Mat, {
    skin: std({ color: 0xc48d6e, roughness: 0.55 }),
    skinDark: std({ color: 0x8c5e44, roughness: 0.6 }),
    skinDead: std({ color: 0x5d5c55, roughness: 0.85 }),
    skinCyclops: std({ color: 0x8b7158, roughness: 0.7 }),
    hair: std({ color: 0x1e140d, roughness: 0.7 }),
    hairBlond: std({ color: 0x8a6a3c, roughness: 0.65 }),
    eye: std({ color: 0x0c0a09, roughness: 0.15 }),
    eyeWhite: std({ color: 0xe8e2d8, roughness: 0.2 }),
    hoodie: new THREE.MeshPhysicalMaterial({ color: 0x232f45, roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x5a6d96), normalMap: Tex.cloth.normal, normalScale: new THREE.Vector2(0.6, 0.6) }),
    denim: std({ color: 0x2e4163, roughness: 0.88, normalMap: Tex.cloth.normal, normalScale: new THREE.Vector2(0.8, 0.8) }),
    sneaker: std({ color: 0xe4e0d8, roughness: 0.7 }),
    sole: std({ color: 0x2a2725, roughness: 0.9 }),
    backpack: std({ color: 0x6b2222, roughness: 0.85, normalMap: Tex.cloth.normal }),
    bronze: std({ color: 0xffffff, map: Tex.bronze.map, roughnessMap: Tex.bronze.orm, metalnessMap: Tex.bronze.orm, metalness: 1, roughness: 1, envMapIntensity: 1.3 }),
    bronzeClean: std({ color: 0xd9a35f, metalness: 1, roughness: 0.32, envMapIntensity: 1.3 }),
    gold: std({ color: 0xffcf73, metalness: 1, roughness: 0.25, envMapIntensity: 1.5 }),
    darkArmor: std({ color: 0x3a1610, map: Tex.bronze.map, metalness: 0.92, roughness: 0.42, envMapIntensity: 1.1 }),
    darkTrim: std({ color: 0x8a5a22, metalness: 1, roughness: 0.3 }),
    leather: std({ color: 0x4a2f1c, roughness: 0.8, normalMap: Tex.cloth.normal }),
    crest: std({ color: 0x8e1612, roughness: 0.9, normalMap: Tex.cloth.normal }),
    chiton: std({ color: 0xece5d4, roughness: 0.9, normalMap: Tex.cloth.normal }),
    wood: std({ color: 0xffffff, map: Tex.bark.map, normalMap: Tex.bark.normal, roughness: 0.85 }),
    blade: std({ color: 0xdfe5ee, metalness: 1, roughness: 0.16, envMapIntensity: 1.8 }),
    darkBlade: std({ color: 0x2a2220, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 }),
    glowBlue: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 2.6, 5.0) }),
    glowEmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 1.4, 0.25) }),
    glowRed: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 0.6, 0.15) }),
    glowGold: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.8, 1.0) }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 1.6, 0.3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    capeBlue: new THREE.MeshStandardMaterial({ map: Tex.capeBlue, roughness: 0.85, side: THREE.DoubleSide, normalMap: Tex.cloth.normal }),
    capeRed: new THREE.MeshStandardMaterial({ map: Tex.capeRed, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5, normalMap: Tex.cloth.normal }),
    capeRag: new THREE.MeshStandardMaterial({ map: Tex.capeRag, roughness: 0.9, side: THREE.DoubleSide, alphaTest: 0.5, normalMap: Tex.cloth.normal }),
  });
  Mat.ghost = makeGhostMaterial(new THREE.Color(0.55, 0.8, 1.6), 0.9);
  Mat.zeus = makeGhostMaterial(new THREE.Color(0.8, 0.95, 1.8), 0.85);
}

function makeGhostMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: opacity }, uTime: G.uniforms.time },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vW = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; uniform float uTime;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
        float flick = 0.85 + 0.15 * sin(uTime * 7.0 + vW.y * 3.0);
        float bands = 0.75 + 0.25 * sin(vW.y * 18.0 - uTime * 4.0);
        gl_FragColor = vec4(uColor * (0.12 + f * 1.7) * flick * bands, (0.08 + f) * uOpacity);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}

/* --------------------------------------------------------------- body */
const _geoCache = {};
function gcap(r, len, seg = 14) { const k = `c${r.toFixed(3)}_${len.toFixed(3)}_${seg}`; return _geoCache[k] || (_geoCache[k] = new THREE.CapsuleGeometry(r, len, 6, seg)); }
function gsph(r, w = 20, h = 14) { const k = `s${r.toFixed(3)}_${w}_${h}`; return _geoCache[k] || (_geoCache[k] = new THREE.SphereGeometry(r, w, h)); }
function gbox(x, y, z) { const k = `b${x}_${y}_${z}`; return _geoCache[k] || (_geoCache[k] = new THREE.BoxGeometry(x, y, z)); }
/** capsule whose radius tapers from rTop (+Y end) to rBot (-Y end) */
function gtaper(rTop, rBot, len, seg = 16) {
  const k = `t${rTop.toFixed(3)}_${rBot.toFixed(3)}_${len.toFixed(3)}`;
  if (_geoCache[k]) return _geoCache[k];
  const pts = [];
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(rBot * Math.sin(a), -len / 2 - rBot * Math.cos(a))); }
  for (let i = 6; i >= 0; i--) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(rTop * Math.sin(a), len / 2 + rTop * Math.cos(a))); }
  return (_geoCache[k] = new THREE.LatheGeometry(pts, seg));
}
/** solid of revolution from [radius, y] pairs (bottom → top) */
function glathe(key, pairs, seg = 20) {
  return _geoCache[key] || (_geoCache[key] = new THREE.LatheGeometry(pairs.map(([r, y]) => new THREE.Vector2(r, y)), seg));
}

function part(parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], keep = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(p[0], p[1], p[2]);
  m.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
  if (typeof s === 'number') m.scale.setScalar(s); else m.scale.set(s[0], s[1], s[2]);
  m.castShadow = true; m.receiveShadow = true;
  if (keep) m.userData.keep = true;
  parent.add(m);
  return m;
}

/**
 * Build a jointed human body.
 * o.mats: { skin, torso, pelvis, upper, fore, hand, thigh, shin, foot, eye }
 */
function buildBody(o = {}) {
  const bw = o.bulk || 1, M = o.mats;
  const root = new THREE.Group();
  const J = {};
  const add = (p, n, x, y, z) => { const g = new THREE.Group(); g.name = n; g.position.set(x, y, z); g.userData.joint = true; p.add(g); J[n] = g; return g; };
  add(root, 'hips', 0, 0.98, 0);
  add(J.hips, 'spine', 0, 0.1, 0);
  add(J.spine, 'chest', 0, 0.2, 0);
  add(J.chest, 'neck', 0, 0.26, 0);
  add(J.neck, 'head', 0, 0.09, 0);
  const sx = 0.185 * (0.85 + 0.15 * bw), lx = 0.092 * Math.sqrt(bw);
  add(J.chest, 'armL', sx, 0.2, -0.01); add(J.armL, 'elbowL', 0, -0.29, 0); add(J.elbowL, 'handL', 0, -0.26, 0);
  add(J.chest, 'armR', -sx, 0.2, -0.01); add(J.armR, 'elbowR', 0, -0.29, 0); add(J.elbowR, 'handR', 0, -0.26, 0);
  add(J.hips, 'thighL', lx, -0.04, 0); add(J.thighL, 'kneeL', 0, -0.44, 0); add(J.kneeL, 'footL', 0, -0.45, 0);
  add(J.hips, 'thighR', -lx, -0.04, 0); add(J.thighR, 'kneeR', 0, -0.44, 0); add(J.kneeR, 'footR', 0, -0.45, 0);

  // torso: sculpted solids of revolution (v-taper chest, narrow waist)
  const k = bw.toFixed(2);
  part(J.hips, glathe('pel' + k, [[0, -0.13], [0.09 * bw, -0.125], [0.125 * bw, -0.07], [0.132 * bw, 0.0], [0.124 * bw, 0.06], [0, 0.08]]), M.pelvis, [0, 0, 0], [0, 0, 0], [1.12, 1, 0.8]);
  part(J.spine, glathe('abd' + k, [[0, -0.06], [0.124 * bw, -0.05], [0.117 * bw, 0.05], [0.122 * bw, 0.14], [0.13 * bw, 0.2], [0, 0.22]]), M.torso, [0, 0, 0], [0, 0, 0], [1.14, 1, 0.78]);
  part(J.chest, glathe('chs' + k, [[0, -0.04], [0.128 * bw, -0.03], [0.14 * bw, 0.05], [0.16 * bw, 0.14], [0.166 * bw, 0.2], [0.152 * bw, 0.25], [0.11 * bw, 0.29], [0.05, 0.305], [0, 0.31]], 24), M.torso, [0, 0, 0], [0, 0, 0], [1.24, 1, 0.74]);
  part(J.chest, gsph(0.075 * bw, 16, 12), M.torso, [0.06 * bw, 0.16, 0.06], [0, 0, 0], [1.1, 0.75, 0.6]);
  part(J.chest, gsph(0.075 * bw, 16, 12), M.torso, [-0.06 * bw, 0.16, 0.06], [0, 0, 0], [1.1, 0.75, 0.6]);
  part(J.chest, gsph(0.07), M.torso, [0, 0.235, -0.025], [0, 0, 0], [2.4 * bw, 0.62, 1.1]);
  // neck & head
  part(J.neck, gtaper(0.044 * Math.sqrt(bw), 0.05 * Math.sqrt(bw), 0.07), M.skin, [0, 0.03, 0]);
  if (!o.noHead) {
    const S = M.skin;
    part(J.head, gsph(0.104, 28, 20), S, [0, 0.1, 0.0], [0, 0, 0], [0.86, 1.05, 0.98]);
    part(J.head, gsph(0.07, 18, 14), S, [0, 0.048, 0.03], [0, 0, 0], [1.0, 0.86, 1.02]);
    part(J.head, gsph(0.03, 12, 10), S, [0, 0.03, 0.078], [0, 0, 0], [1.0, 0.8, 0.8]);
    part(J.head, gsph(0.022, 12, 8), S, [0.046, 0.083, 0.064], [0, 0, 0], [1, 0.7, 0.75]);
    part(J.head, gsph(0.022, 12, 8), S, [-0.046, 0.083, 0.064], [0, 0, 0], [1, 0.7, 0.75]);
    part(J.head, glathe('nose', [[0, 0], [0.013, 0.004], [0.011, 0.03], [0.004, 0.045], [0, 0.046]], 10), S, [0, 0.07, 0.1], [70, 0, 0], [1, 1, 0.9]);
    part(J.head, gsph(0.012, 8, 6), S, [0.011, 0.074, 0.112]); part(J.head, gsph(0.012, 8, 6), S, [-0.011, 0.074, 0.112]);
    part(J.head, gsph(0.02, 10, 8), S, [0.088, 0.1, 0], [0, 0, 0], [0.4, 1, 0.8]);
    part(J.head, gsph(0.02, 10, 8), S, [-0.088, 0.1, 0], [0, 0, 0], [0.4, 1, 0.8]);
    part(J.head, gcap(0.0065, 0.026, 8), Mat.lip || S, [0, 0.05, 0.1], [0, 0, 90]);
    if (M.eye) {
      for (const sx of [0.034, -0.034]) {
        part(J.head, gsph(0.0155, 14, 10), Mat.eyeWhite, [sx, 0.111, 0.088], [0, 0, 0], [1.05, 0.72, 0.6]);
        part(J.head, gsph(0.0085, 12, 10), M.eye, [sx * 0.97, 0.111, 0.096]);
        part(J.head, gsph(0.017, 14, 10), S, [sx, 0.121, 0.087], [0, 0, 0], [1.1, 0.42, 0.62]);
      }
    }
    if (M.brow) {
      part(J.head, gbox(0.038, 0.009, 0.014), M.brow, [0.035, 0.134, 0.1], [0, -8, 9]);
      part(J.head, gbox(0.038, 0.009, 0.014), M.brow, [-0.035, 0.134, 0.1], [0, 8, -9]);
    }
  }
  // limbs: tapered, with muscle bulges
  for (const S of ['L', 'R']) {
    part(J['arm' + S], gsph(0.062 * bw), M.upper, [0, -0.03, 0], [0, 0, 0], [1, 1.1, 1]);
    part(J['arm' + S], gtaper(0.05 * bw, 0.041 * bw, 0.2), M.upper, [0, -0.15, 0]);
    part(J['arm' + S], gsph(0.04 * bw, 12, 10), M.upper, [0, -0.13, 0.014], [0, 0, 0], [1, 1.7, 1]);
    part(J['elbow' + S], gtaper(0.045 * bw, 0.032 * bw, 0.18), M.fore, [0, -0.12, 0]);
    part(J['hand' + S], gcap(0.031 * bw, 0.045), M.hand, [0, -0.055, 0.005], [0, 0, 0], [1.15, 1, 0.72]);
    part(J['hand' + S], gcap(0.011 * bw, 0.03), M.hand, [S === 'L' ? -0.02 : 0.02, -0.04, 0.022], [30, 0, 0]);
    part(J['thigh' + S], gtaper(0.08 * bw, 0.052 * bw, 0.3), M.thigh, [0, -0.21, 0]);
    part(J['knee' + S], gtaper(0.054 * bw, 0.038 * bw, 0.33), M.shin, [0, -0.21, 0]);
    part(J['knee' + S], gsph(0.052 * bw), M.shin, [0, -0.13, -0.018], [0, 0, 0], [1, 1.7, 1]);
    part(J['foot' + S], gcap(0.042, 0.13), M.foot, [0, -0.035, 0.045], [90, 0, 0], [1.1, 1, 0.7]);
  }
  return { root, J };
}

/** Merge static meshes per joint & material to keep draw calls low. */
function bakeRig(root) {
  root.traverse((j) => {
    if (!j.userData.joint) return;
    const groups = new Map();
    for (const ch of j.children) {
      if (!ch.isMesh || ch.userData.keep) continue;
      const k = ch.material.uuid;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(ch);
    }
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
        g.applyMatrix4(m.matrix);
        return g;
      });
      const merged = Addons.mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      list.forEach((m) => j.remove(m));
      j.add(mesh);
    }
  });
}

/**
 * Turn a code-built body (one mesh per joint and material) into one skinned mesh per material:
 * the same look, a fraction of the draw calls. Each piece follows its joint rigidly.
 * Kept parts (userData.keep) and props hung on joints as groups (weapons, shields) stay as they are.
 */
function skinBody(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const joints = [];
  root.traverse((j) => { if (j.userData.joint) joints.push(j); });
  const bones = joints.map((j) => { const b = new THREE.Bone(); j.add(b); return b; });
  root.updateMatrixWorld(true);
  const byMat = new Map(), m4 = new THREE.Matrix4();
  joints.forEach((j, ji) => {
    for (const ch of [...j.children]) {
      if (!ch.isMesh || ch.userData.keep || ch.isSkinnedMesh) continue;
      let g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m4.multiplyMatrices(inv, ch.matrixWorld));
      const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) { si[i * 4] = ji; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!byMat.has(ch.material)) byMat.set(ch.material, []);
      byMat.get(ch.material).push(g);
      j.remove(ch);
    }
  });
  const skeleton = new THREE.Skeleton(bones);
  for (const [mat, geos] of byMat) {
    const g = Addons.mergeGeometries(geos, false);
    if (!g) continue;
    g.computeBoundingSphere();
    const sm = new THREE.SkinnedMesh(g, mat);
    sm.castShadow = sm.receiveShadow = true;
    sm.boundingSphere = g.boundingSphere.clone();
    sm.boundingSphere.radius *= 1.5;
    root.add(sm);
    sm.bind(skeleton, new THREE.Matrix4());
  }
  return root;
}

/** Bake a posed rig into one geometry in root space (statues). */
function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const geos = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    geos.push(g);
  });
  return Addons.mergeGeometries(geos, false);
}

/* --------------------------------------------------------------- weapons */
function marker(parent, y) { const o = new THREE.Object3D(); o.position.set(0, y, 0); parent.add(o); return o; }

function makeXiphos() {
  const g = new THREE.Group();
  const L = 0.86;
  const sh = new THREE.Shape();
  sh.moveTo(-0.021, 0);
  sh.bezierCurveTo(-0.028, L * 0.25, -0.046, L * 0.55, -0.034, L * 0.76);
  sh.quadraticCurveTo(-0.018, L * 0.93, 0, L);
  sh.quadraticCurveTo(0.018, L * 0.93, 0.034, L * 0.76);
  sh.bezierCurveTo(0.046, L * 0.55, 0.028, L * 0.25, 0.021, 0);
  sh.lineTo(-0.021, 0);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.007, bevelSegments: 2, curveSegments: 10 });
  bg.translate(0, 0, -0.002);
  part(g, bg, Mat.blade, [0, -0.125, 0], [180, 0, 0], 1, true);
  part(g, gbox(0.008, L * 0.72, 0.017), Mat.glowBlue, [0, -0.125 - L * 0.4, 0], [0, 0, 0], 1, true);
  part(g, gbox(0.15, 0.022, 0.036), Mat.gold, [0, -0.113, 0], [0, 0, 0], 1, true);
  part(g, new THREE.CylinderGeometry(0.0135, 0.0155, 0.1, 10), Mat.leather, [0, -0.06, 0], [0, 0, 0], 1, true);
  part(g, gsph(0.021, 12, 10), Mat.gold, [0, -0.004, 0], [0, 0, 0], 1, true);
  g.userData.base = marker(g, -0.14);
  g.userData.tip = marker(g, -0.125 - L);
  return g;
}

function makeSpear() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.016, 0.019, 2.2, 8), Mat.wood, [0, -0.41, 0]);
  const tip = new THREE.LatheGeometry([new THREE.Vector2(0.0, 0), new THREE.Vector2(0.02, 0.02), new THREE.Vector2(0.035, 0.12), new THREE.Vector2(0.0, 0.3)], 6);
  part(g, tip, Mat.bronze, [0, -1.5, 0], [180, 0, 0]);
  part(g, new THREE.ConeGeometry(0.02, 0.12, 6), Mat.bronze, [0, 0.74, 0]);
  g.userData.base = marker(g, -1.3);
  g.userData.tip = marker(g, -1.8);
  return g;
}

function makeHoplon(emblem = true) {
  const g = new THREE.Group();
  const prof = [[0, 0.075], [0.18, 0.068], [0.33, 0.045], [0.41, 0.015], [0.445, 0.0], [0.47, 0.012], [0.475, 0.03], [0.46, 0.035], [0.44, 0.02], [0.0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y));
  part(g, new THREE.LatheGeometry(prof, 32), Mat.bronze, [0, 0, 0]);
  if (emblem) {
    part(g, new THREE.TorusGeometry(0.2, 0.012, 6, 28), Mat.crest, [0, 0.066, 0], [90, 0, 0]);
    part(g, gbox(0.03, 0.006, 0.26), Mat.crest, [0.05, 0.074, 0], [0, 25, 0]);
    part(g, gbox(0.03, 0.006, 0.26), Mat.crest, [-0.05, 0.074, 0], [0, -25, 0]);
  }
  return g;
}

function makeClub() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.045, 0.13, 1.3, 10), Mat.wood, [0, -0.66, 0]);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, y = -0.75 - (i % 3) * 0.17;
    const r = 0.09 + (i % 3) * 0.012;
    part(g, new THREE.ConeGeometry(0.022, 0.1, 5), Mat.bronze, [Math.cos(a) * r, y, Math.sin(a) * r], [0, 0, 0], 1).lookAt(Math.cos(a) * 3, y, Math.sin(a) * 3);
  }
  g.children.forEach((m, i) => { if (i > 0) m.rotateX(Math.PI / 2); });
  g.userData.base = marker(g, -0.5);
  g.userData.tip = marker(g, -1.3);
  return g;
}

function makeGreatsword() {
  const g = new THREE.Group();
  const L = 1.35, W = 0.065;
  const sh = new THREE.Shape();
  sh.moveTo(-W, 0); sh.lineTo(-W * 0.92, L * 0.82); sh.lineTo(0, L); sh.lineTo(W * 0.92, L * 0.82); sh.lineTo(W, 0); sh.lineTo(-W, 0);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.01, bevelSegments: 1, curveSegments: 4 });
  bg.translate(0, 0, -0.005);
  part(g, bg, Mat.darkBlade, [0, -0.16, 0], [180, 0, 0], 1, true);
  const fuller = part(g, gbox(0.014, L * 0.8, 0.026), Mat.glowRed, [0, -0.16 - L * 0.44, 0], [0, 0, 0], 1, true);
  part(g, gbox(0.3, 0.04, 0.06), Mat.darkTrim, [0, -0.145, 0], [0, 0, 0], 1, true);
  part(g, new THREE.CylinderGeometry(0.018, 0.02, 0.2, 8), Mat.leather, [0, -0.04, 0], [0, 0, 0], 1, true);
  part(g, gsph(0.03, 10, 8), Mat.darkTrim, [0, 0.07, 0], [0, 0, 0], 1, true);
  g.userData.fuller = fuller;
  g.userData.base = marker(g, -0.3);
  g.userData.tip = marker(g, -0.16 - L);
  return g;
}

function makeCaduceus() {
  const g = new THREE.Group();
  part(g, new THREE.CylinderGeometry(0.011, 0.013, 1.15, 8), Mat.gold, [0, 0.15, 0]);
  part(g, gsph(0.028, 12, 10), Mat.gold, [0, 0.74, 0]);
  for (const sgn of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40, a = t * TAU * 2.2 * sgn; pts.push(new THREE.Vector3(Math.cos(a) * 0.035, -0.25 + t * 0.9, Math.sin(a) * 0.035)); }
    part(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0075, 5), Mat.bronzeClean, [0, 0, 0]);
    const wing = part(g, gsph(0.05, 10, 8), Mat.chiton, [0.07 * sgn, 0.7, 0], [0, 0, 30 * sgn], [1.6, 0.35, 0.15]);
    wing.castShadow = false;
  }
  return g;
}

/* --------------------------------------------------------------- characters */
function finalize(root, rigOpts) {
  bakeRig(root);
  root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  return root;
}

function hairAriel(J) {
  const H = Mat.hair;
  part(J.head, new THREE.SphereGeometry(0.113, 22, 14, 0, TAU, 0, Math.PI * 0.5), H, [0, 0.118, -0.006], [-24, 0, 0], [0.93, 1.0, 1.06]);
  part(J.head, gsph(0.1, 16, 12), H, [0, 0.09, -0.04], [0, 0, 0], [0.9, 0.92, 0.82]);
  const rnd = mulberry32(7);
  for (let i = 0; i < 11; i++) {
    const a = (-60 + (i / 10) * 120) * DEG + (rnd() - 0.5) * 0.2;
    const y = 0.185 + rnd() * 0.025;
    const m = part(J.head, gsph(0.028, 8, 6), H, [Math.sin(a) * 0.075, y, 0.03 + Math.cos(a) * 0.06], [0, 0, 0], [1, 0.5, 2.0]);
    m.lookAt(Math.sin(a) * 0.5, y - 0.05 - rnd() * 0.08, 0.45 + Math.cos(a) * 0.2);
  }
  for (let i = 0; i < 8; i++) {
    const a = (rnd() - 0.5) * 1.6 + Math.PI;
    const m = part(J.head, gsph(0.03, 8, 6), H, [Math.sin(a) * 0.08, 0.18 + rnd() * 0.02, Math.cos(a) * 0.07], [0, 0, 0], [1, 0.55, 2.0]);
    m.lookAt(Math.sin(a) * 0.5, 0.1, Math.cos(a) * 0.5 - 0.1);
  }
}

/** Ariel. casual=true → school clothes only (prologue). */
function buildAriel({ casual = false } = {}) {
  const { root, J } = buildBody({ bulk: 1, mats: { skin: Mat.skin, torso: Mat.hoodie, pelvis: Mat.denim, upper: Mat.hoodie, fore: Mat.hoodie, hand: Mat.skin, thigh: Mat.denim, shin: Mat.denim, foot: Mat.sneaker, eye: Mat.eye, brow: Mat.hair } });
  hairAriel(J);
  // hood bunched behind the neck + drawstrings
  part(J.chest, new THREE.TorusGeometry(0.095, 0.045, 10, 20, Math.PI * 1.25), Mat.hoodie, [0, 0.25, -0.02], [80, 0, -135]);
  part(J.chest, new THREE.CylinderGeometry(0.004, 0.004, 0.16, 5), Mat.chiton, [0.04, 0.16, 0.12], [8, 0, 0]);
  part(J.chest, new THREE.CylinderGeometry(0.004, 0.004, 0.14, 5), Mat.chiton, [-0.04, 0.17, 0.12], [8, 0, 0]);
  // cuffs, sneaker soles
  part(J.handL, new THREE.CylinderGeometry(0.036, 0.038, 0.035, 12), Mat.hoodie, [0, 0.0, 0]);
  part(J.handR, new THREE.CylinderGeometry(0.036, 0.038, 0.035, 12), Mat.hoodie, [0, 0.0, 0]);
  for (const S of ['L', 'R']) part(J['foot' + S], gbox(0.085, 0.022, 0.25), Mat.sole, [0, -0.062, 0.045]);

  const parts = {};
  if (casual) {
    parts.pack = part(J.chest, gbox(0.26, 0.32, 0.12), Mat.backpack, [0, 0.08, -0.17], [-4, 0, 0], 1, true);
  } else {
    // divine kit: bronze pauldron, bracer, belt, lightning xiphos
    const pa = part(J.armL, new THREE.SphereGeometry(0.088, 20, 10, 0, TAU, 0, Math.PI / 2), Mat.bronzeClean, [0.012, 0.0, 0], [0, 0, -14], [1.15, 0.8, 1.15], true);
    part(J.armL, new THREE.TorusGeometry(0.098, 0.008, 6, 24), Mat.gold, [0.012, -0.004, 0], [90, 0, -14], [1.05, 1.05, 1], true);
    part(J.armL, new THREE.SphereGeometry(0.07, 18, 8, 0, TAU, 0, Math.PI / 2.4), Mat.bronzeClean, [0.03, -0.05, 0], [0, 0, -34], [1.05, 0.55, 1.05], true);
    part(J.elbowR, new THREE.CylinderGeometry(0.05, 0.043, 0.13, 16, 1, true), Mat.bronzeClean, [0, -0.13, 0], [0, 0, 0], 1, true);
    part(J.elbowR, new THREE.TorusGeometry(0.05, 0.005, 6, 18), Mat.gold, [0, -0.07, 0], [90, 0, 0], 1, true);
    part(J.elbowL, new THREE.CylinderGeometry(0.05, 0.045, 0.1, 14, 1, true), Mat.leather, [0, -0.14, 0], [0, 0, 0], 1, true);
    part(J.hips, new THREE.TorusGeometry(0.128, 0.018, 8, 26), Mat.leather, [0, 0.03, 0], [90, 0, 0], [1, 0.8, 1], true);
    part(J.hips, gbox(0.06, 0.05, 0.02), Mat.gold, [0, 0.03, 0.105], [0, 0, 0], 1, true);
    // leather baldric strap across the chest
    part(J.chest, new THREE.TorusGeometry(0.17, 0.011, 6, 28), Mat.leather, [0, 0.13, 0], [90, 35, 0], [1.22, 0.78, 1], true);
    parts.sword = makeXiphos();
    J.handR.add(parts.sword);
    parts.pauldron = pa;
  }
  finalize(root);
  const rig = new Rig(root, J, { stance: casual ? 'casual' : 'sword', armSwing: casual ? [1, 1] : [1, 0.35] });
  return { root, J, rig, parts };
}

function corinthian(J, mat, crestMat, eyeMat, scale = 1) {
  part(J.head, new THREE.SphereGeometry(0.128, 22, 16, 0, TAU, 0, Math.PI * 0.72), mat, [0, 0.11, 0.0], [0, 0, 0], [0.95, 1.12, 1.1]);
  part(J.head, new THREE.CylinderGeometry(0.118, 0.1, 0.12, 20, 1, true), mat, [0, 0.03, 0.005], [0, 0, 0], [0.96, 1, 1.12]);
  part(J.head, gbox(0.1, 0.016, 0.02), Mat.sole, [0, 0.113, 0.128]);
  part(J.head, gbox(0.018, 0.08, 0.02), Mat.sole, [0, 0.075, 0.13]);
  part(J.head, gbox(0.016, 0.06, 0.016), mat, [0, 0.12, 0.138]);
  if (eyeMat) {
    part(J.head, gsph(0.011, 8, 6), eyeMat, [0.028, 0.113, 0.134], [0, 0, 0], [1.3, 0.6, 0.5], true);
    part(J.head, gsph(0.011, 8, 6), eyeMat, [-0.028, 0.113, 0.134], [0, 0, 0], [1.3, 0.6, 0.5], true);
  }
  if (crestMat) {
    part(J.head, new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 0.035, 22, 1, false, 0, Math.PI), crestMat, [0, 0.23, -0.02], [0, 0, 90], [1, 1, 1]);
    part(J.head, gbox(0.02, 0.05, 0.16), mat, [0, 0.235, -0.01]);
  }
}

function buildHoplite({ weapon = 'spear', cloak = true } = {}) {
  const { root, J } = buildBody({ bulk: 0.92, mats: { skin: Mat.skinDead, torso: Mat.bronze, pelvis: Mat.leather, upper: Mat.skinDead, fore: Mat.skinDead, hand: Mat.skinDead, thigh: Mat.skinDead, shin: Mat.bronze, foot: Mat.leather, eye: null } });
  corinthian(J, Mat.bronze, Mat.crest, Mat.glowEmber);
  // pteruges skirt
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    part(J.hips, gbox(0.065, 0.22, 0.012), Mat.leather, [Math.sin(a) * 0.13, -0.12, Math.cos(a) * 0.1], [Math.cos(a) * 8, a / DEG, -Math.sin(a) * 8]);
  }
  part(J.armR, new THREE.SphereGeometry(0.075, 14, 8, 0, TAU, 0, Math.PI / 2), Mat.bronze, [-0.01, 0.0, 0], [0, 0, 12], [1.1, 0.8, 1.1]);
  part(J.armL, new THREE.SphereGeometry(0.075, 14, 8, 0, TAU, 0, Math.PI / 2), Mat.bronze, [0.01, 0.0, 0], [0, 0, -12], [1.1, 0.8, 1.1]);
  const parts = {};
  const shield = makeHoplon();
  shield.position.set(0.043, -0.131, -0.04);
  shield.rotation.set(-56.3 * DEG, 36.4 * DEG, -63.1 * DEG);
  J.elbowL.add(shield);
  parts.shield = shield;
  if (weapon === 'spear') { parts.weapon = makeSpear(); J.handR.add(parts.weapon); }
  else { parts.weapon = makeXiphos(); parts.weapon.children.forEach((c) => { if (c.material === Mat.glowBlue) c.visible = false; }); J.handR.add(parts.weapon); }
  finalize(root);
  skinBody(root);
  const rig = new Rig(root, J, { stance: 'hoplite', armSwing: [0.2, 0.25] });
  return { root, J, rig, parts, cloak };
}

function buildCyclops() {
  const { root, J } = buildBody({ bulk: 1.65, noHead: true, mats: { skin: Mat.skinCyclops, torso: Mat.skinCyclops, pelvis: Mat.leather, upper: Mat.skinCyclops, fore: Mat.skinCyclops, hand: Mat.skinCyclops, thigh: Mat.skinCyclops, shin: Mat.skinCyclops, foot: Mat.skinCyclops } });
  const S = Mat.skinCyclops;
  part(J.spine, gsph(0.2, 20, 14), S, [0, 0.06, 0.06], [0, 0, 0], [1.15, 1.0, 1.05]);
  part(J.head, gsph(0.13, 22, 16), S, [0, 0.11, 0.02], [0, 0, 0], [1.0, 1.05, 1.0]);
  part(J.head, gsph(0.1, 16, 12), S, [0, 0.045, 0.06], [0, 0, 0], [1.15, 0.8, 1.0]);
  part(J.head, gbox(0.17, 0.03, 0.06), S, [0, 0.165, 0.11], [12, 0, 0]);
  part(J.head, gsph(0.045, 16, 12), Mat.eyeWhite, [0, 0.125, 0.11], [0, 0, 0], 1, true);
  part(J.head, gsph(0.022, 12, 10), Mat.glowRed, [0, 0.125, 0.145], [0, 0, 0], 1, true);
  part(J.head, new THREE.ConeGeometry(0.012, 0.05, 6), Mat.eyeWhite, [0.04, 0.02, 0.13], [180, 0, 0]);
  part(J.head, new THREE.ConeGeometry(0.012, 0.05, 6), Mat.eyeWhite, [-0.04, 0.02, 0.13], [180, 0, 0]);
  part(J.head, gsph(0.025, 8, 6), S, [0.12, 0.11, 0], [0, 0, 0], [0.5, 1, 0.8]);
  part(J.head, gsph(0.025, 8, 6), S, [-0.12, 0.11, 0], [0, 0, 0], [0.5, 1, 0.8]);
  part(J.hips, gbox(0.34, 0.32, 0.03), Mat.leather, [0, -0.17, 0.13], [-6, 0, 0]);
  part(J.hips, gbox(0.34, 0.3, 0.03), Mat.leather, [0, -0.16, -0.13], [6, 0, 0]);
  part(J.hips, new THREE.TorusGeometry(0.2, 0.025, 6, 20), Mat.leather, [0, 0.02, 0], [90, 0, 0], [1, 0.75, 1]);
  part(J.elbowR, new THREE.CylinderGeometry(0.075, 0.07, 0.1, 12, 1, true), Mat.bronze, [0, -0.1, 0]);
  part(J.elbowL, new THREE.CylinderGeometry(0.075, 0.07, 0.1, 12, 1, true), Mat.bronze, [0, -0.1, 0]);
  const parts = { weapon: makeClub() };
  J.handR.add(parts.weapon);
  finalize(root);
  const rig = new Rig(root, J, { stance: 'brute', armSwing: [0.6, 0.3], size: 1.9, stepLen: 0.9 });
  root.scale.setScalar(1.9);
  // the sculpted cyclops wears the rig; the club stays in its fist
  const model = Models.attach(rig, 'cyclops', { keep: [parts.weapon] });
  return { root, J, rig, parts, model };
}

/** Thrall of Tartarus: a torso on a knot of tentacles (sculpt), gliding instead of walking */
function buildThrall() {
  const b = buildShell({ stance: 'thrall', size: 1.25, armSwing: [0.5, 0.5], mat: Mat.darkArmor });
  b.model = Models.attach(b.rig, 'thrall');
  return b;
}

/** Fallen Seraph: winged reaper with a sculpted scythe */
function buildSeraph() {
  const b = buildShell({ stance: 'reaper', size: 1.3, armSwing: [0.6, 0.25], mat: Mat.darkArmor });
  b.model = Models.attach(b.rig, 'seraph');
  if (b.model && b.model.markers.tip) b.parts.weapon = { userData: { base: b.model.markers.base, tip: b.model.markers.tip } };
  return b;
}

function buildAres() {
  const { root, J } = buildBody({ bulk: 1.3, mats: { skin: Mat.skinDark, torso: Mat.darkArmor, pelvis: Mat.darkArmor, upper: Mat.skinDark, fore: Mat.darkArmor, hand: Mat.darkArmor, thigh: Mat.skinDark, shin: Mat.darkArmor, foot: Mat.darkArmor, eye: null } });
  corinthian(J, Mat.darkArmor, null, Mat.glowEmber, 1.4);
  // flaming crest
  const crest = part(J.head, new THREE.CylinderGeometry(0.24, 0.24, 0.045, 24, 1, false, 0, Math.PI), Mat.glowRed, [0, 0.24, -0.04], [0, 0, 90], 1, true);
  for (const S of ['L', 'R']) {
    const sg = S === 'L' ? 1 : -1;
    part(J['arm' + S], new THREE.SphereGeometry(0.1, 16, 10, 0, TAU, 0, Math.PI / 2), Mat.darkArmor, [0.015 * sg, 0.01, 0], [0, 0, -14 * sg], [1.2, 0.9, 1.2]);
    part(J['arm' + S], new THREE.TorusGeometry(0.105, 0.01, 6, 22), Mat.darkTrim, [0.015 * sg, 0.0, 0], [90, 0, -14 * sg], [1.12, 1.12, 1]);
    for (let k = 0; k < 3; k++) part(J['arm' + S], new THREE.ConeGeometry(0.018, 0.09, 6), Mat.darkTrim, [0.04 * sg, 0.07, -0.04 + k * 0.04], [0, 0, -30 * sg]);
    part(J['thigh' + S], gbox(0.15, 0.24, 0.02), Mat.darkArmor, [0, -0.1, 0.07], [-6, 0, 0]);
  }
  part(J.chest, new THREE.TorusGeometry(0.17, 0.014, 6, 22, Math.PI), Mat.darkTrim, [0, 0.22, 0.03], [-90, 0, 180], [1.25, 1, 1]);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    part(J.hips, gbox(0.075, 0.26, 0.014), i % 2 ? Mat.darkArmor : Mat.darkTrim, [Math.sin(a) * 0.15, -0.13, Math.cos(a) * 0.12], [Math.cos(a) * 9, a / DEG, -Math.sin(a) * 9]);
  }
  const parts = { weapon: makeGreatsword(), crest };
  J.handR.add(parts.weapon);
  finalize(root);
  const rig = new Rig(root, J, { stance: 'ares', armSwing: [0.6, 0.3], size: 2.5, stepLen: 1.0 });
  root.scale.setScalar(2.5);
  return { root, J, rig, parts };
}

function buildHermes() {
  const { root, J } = buildBody({ bulk: 0.95, mats: { skin: Mat.skin, torso: Mat.chiton, pelvis: Mat.chiton, upper: Mat.skin, fore: Mat.skin, hand: Mat.skin, thigh: Mat.skin, shin: Mat.skin, foot: Mat.leather, eye: Mat.eye, brow: Mat.hairBlond } });
  part(J.head, new THREE.SphereGeometry(0.112, 20, 12, 0, TAU, 0, Math.PI * 0.55), Mat.hairBlond, [0, 0.112, -0.006], [-6, 0, 0], [0.93, 1.0, 1.05]);
  const rnd = mulberry32(3);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * TAU, e = rnd() * 0.9;
    part(J.head, gsph(0.028, 8, 6), Mat.hairBlond, [Math.sin(a) * 0.09 * Math.cos(e), 0.13 + Math.sin(e) * 0.06, Math.cos(a) * 0.09 * Math.cos(e) - 0.01]);
  }
  // winged cap
  part(J.head, new THREE.SphereGeometry(0.118, 20, 10, 0, TAU, 0, Math.PI * 0.42), Mat.gold, [0, 0.13, -0.004], [-6, 0, 0], [0.97, 0.9, 1.06]);
  for (const sg of [1, -1]) for (let k = 0; k < 3; k++) {
    const w = part(J.head, gsph(0.05, 10, 8), Mat.chiton, [0.1 * sg, 0.17 + k * 0.025, -0.03 - k * 0.025], [0, 0, 0], [0.12, 0.35, 1.5 - k * 0.3]);
    w.rotation.set((-30 - k * 12) * DEG, 0, 15 * sg * DEG);
  }
  // chiton skirt & sash
  part(J.hips, new THREE.CylinderGeometry(0.14, 0.24, 0.48, 20, 1, true), Mat.chiton, [0, -0.2, 0]);
  part(J.chest, new THREE.TorusGeometry(0.17, 0.02, 6, 22), Mat.gold, [0, 0.05, 0], [90, 20, 0], [1, 0.8, 1]);
  part(J.hips, new THREE.TorusGeometry(0.13, 0.016, 6, 20), Mat.gold, [0, 0.04, 0], [90, 0, 0], [1, 0.8, 1]);
  // winged sandals
  for (const S of ['L', 'R']) {
    const sg = S === 'L' ? 1 : -1;
    for (let k = 0; k < 2; k++) part(J['foot' + S], gsph(0.04, 8, 6), Mat.chiton, [0.04 * sg, 0.01 + k * 0.02, -0.02 - k * 0.02], [-30, 0, 20 * sg], [0.12, 0.3, 1.2]);
  }
  const parts = { staff: makeCaduceus() };
  parts.staff.position.set(0, -0.06, 0);
  J.handL.add(parts.staff);
  finalize(root);
  const rig = new Rig(root, J, { stance: 'hermes', armSwing: [0.1, 1] });
  // the God of War Hermes wears the rig; the code-built body above is only the stand-in if it can't load
  const model = Models.attach(rig, 'hermes', { keep: [parts.staff] });
  // the model's left hand is closed round the caduceus: the staff stands in that fist, upright, with the wrist straight
  const grip = model && model.markers && model.markers.gripL;
  if (grip) { grip.add(parts.staff); parts.staff.position.set(0, 0, 0); parts.staff.rotation.set(0, 0, 0); }
  else parts.staff.rotation.x = Math.PI / 2;   // the code-built stand-in: upright across its hand
  return { root, J, rig, parts, model };
}

function buildPhantom() {
  const m = Mat.ghost;
  const { root, J } = buildBody({ bulk: 1, mats: { skin: m, torso: m, pelvis: m, upper: m, fore: m, hand: m, thigh: m, shin: m, foot: m } });
  const sw = makeXiphos();
  sw.traverse((o) => { if (o.isMesh) o.material = m; });
  J.handR.add(sw);
  finalize(root);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const rig = new Rig(root, J, { stance: 'sword', armSwing: [1, 0.35] });
  return { root, J, rig };
}

function buildZeusSpirit() {
  const m = Mat.zeus;
  const { root, J } = buildBody({ bulk: 1.25, mats: { skin: m, torso: m, pelvis: m, upper: m, fore: m, hand: m, thigh: m, shin: m, foot: m } });
  part(J.head, new THREE.ConeGeometry(0.1, 0.26, 16), m, [0, -0.02, 0.06], [180, 0, 0]);
  part(J.head, gsph(0.12, 16, 12), m, [0, 0.14, -0.03], [0, 0, 0], [1.05, 1, 1.05]);
  part(J.head, new THREE.TorusGeometry(0.115, 0.012, 6, 24), Mat.glowGold, [0, 0.17, 0], [90, 0, 0]);
  finalize(root);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  const rig = new Rig(root, J, { stance: 'casual', armSwing: [0, 0] });
  return { root, J, rig };
}

/** a plain jointed body that carries an imported model (and stands in for it if the model can't load) */
function buildShell({ stance = 'casual', size = 1, armSwing = [1, 0.4], stepLen = 1, mat = Mat.skinDead, bulk = 1 } = {}) {
  const m = mat;
  const { root, J } = buildBody({ bulk, mats: { skin: m, torso: m, pelvis: m, upper: m, fore: m, hand: m, thigh: m, shin: m, foot: m } });
  finalize(root);
  const rig = new Rig(root, J, { stance, armSwing, size, stepLen });
  if (size !== 1) root.scale.setScalar(size);
  return { root, J, rig, parts: {} };
}

/** Marble statue, baked to a single geometry. kind: zeus | athena | poseidon | hero */
function buildStatueGeometry(kind, { headless = false, broken = false } = {}) {
  const mm = { skin: null, torso: null, pelvis: null, upper: null, fore: null, hand: null, thigh: null, shin: null, foot: null };
  const marble = new THREE.MeshBasicMaterial();
  for (const k in mm) mm[k] = marble;
  const { root, J } = buildBody({ bulk: kind === 'zeus' || kind === 'poseidon' ? 1.2 : 1, mats: mm, noHead: headless });
  if (!headless && (kind === 'zeus' || kind === 'poseidon')) {
    part(J.head, new THREE.ConeGeometry(0.085, 0.2, 12), marble, [0, 0.0, 0.06], [180, 0, 0]);
    part(J.head, gsph(0.11, 14, 10), marble, [0, 0.14, -0.02]);
  }
  if (!headless && kind === 'athena') corinthian(J, marble, marble, null);
  if (kind !== 'hero') part(J.hips, new THREE.CylinderGeometry(0.15, 0.26, 0.6, 18, 1, true), marble, [0, -0.3, 0]);
  const rig = new Rig(root, J, { stance: 'casual' });
  const P = {
    zeus: { armR: [-170, 0, -20], elbowR: [-30, 0, 0], armL: [-20, 0, 25], elbowL: [-60, 0, 0], neck: [-12, 0, 0], thighL: [-12, 0, 4], kneeL: [12, 0, 0] },
    athena: { armR: [-150, 0, -10], elbowR: [-40, 0, 0], handR: [-90, 0, 0], armL: [-5, -70, 40], elbowL: [-95, 0, 0], neck: [-4, 10, 0] },
    poseidon: { armR: [-120, 0, -30], elbowR: [-60, 0, 0], handR: [-90, 0, 0], armL: [5, 0, 15], elbowL: [-20, 0, 0], chest: [0, 15, 0] },
    hero: { armR: [-100, 0, -30], elbowR: [-20, 0, 0], armL: [10, 0, 30], thighL: [-30, 0, 4], kneeL: [30, 0, 0], thighR: [12, 0, -4], spine: [8, 0, 0] },
  }[kind];
  rig.poseFrom(P);
  if (kind === 'zeus') {
    const bolt = new THREE.Group();
    part(bolt, new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), marble, [0, -0.2, 0], [0, 0, 0]);
    part(bolt, new THREE.ConeGeometry(0.07, 0.2, 6), marble, [0, -0.7, 0], [180, 0, 0]);
    part(bolt, new THREE.ConeGeometry(0.07, 0.2, 6), marble, [0, 0.3, 0]);
    J.handR.add(bolt);
  }
  if (kind === 'athena') {
    const sp = makeSpear(); sp.traverse((o) => { if (o.isMesh) o.material = marble; }); J.handR.add(sp);
    const sh = makeHoplon(false); sh.traverse((o) => { if (o.isMesh) o.material = marble; });
    sh.position.set(0.043, -0.131, -0.04); sh.rotation.set(-56.3 * DEG, 36.4 * DEG, -63.1 * DEG); J.elbowL.add(sh);
  }
  if (kind === 'poseidon') {
    const tri = new THREE.Group();
    part(tri, new THREE.CylinderGeometry(0.02, 0.02, 2.2, 6), marble, [0, -0.3, 0]);
    for (const x of [-0.09, 0, 0.09]) part(tri, new THREE.ConeGeometry(0.025, 0.22, 6), marble, [x, -1.5, 0], [180, 0, 0]);
    part(tri, gbox(0.2, 0.03, 0.03), marble, [0, -1.38, 0]);
    J.handR.add(tri);
  }
  if (kind === 'hero') { const sw = makeXiphos(); sw.traverse((o) => { if (o.isMesh) o.material = marble; }); J.handR.add(sw); }
  if (broken) { J.armL.visible = false; J.armL.traverse((o) => { o.visible = false; }); }
  // remove hidden parts before baking
  const hidden = [];
  root.traverse((o) => { if (!o.visible) hidden.push(o); });
  hidden.forEach((o) => o.parent && o.parent.remove(o));
  return bakeStatic(root);
}
