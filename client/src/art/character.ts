import * as THREE from "three";
import { canvasTexture, cloud, fill, grain, stains, type Ctx } from "./textures";
import { ball, batchParts, disposeParts, loft, meshPart, type Ring, type V3 } from "./geometry";
import { buildWeapon, muzzleFlashMaterial, muzzleOffset, supportGrip, WeaponId } from "./weapons";

// Rigid articulated bodies, authored from the feet and 72u (six feet) tall
// like the hull. Proportions are a real adult's — a 9u head, 15u between the
// shoulder joints, the hip joint at half height — so the figure sits inside
// the sim hitboxes (head 58–72, chest 38–58, stomach 26–38) rather than
// filling them. Every part is lofted with its own front and back depth, which
// is what gives it a jaw, a chest and a calf; the detail a model of the era
// kept in its skin — pouches, straps, the face — is painted.
export type Team = "ct" | "t";
const PALETTE = {
  ct: { cloth: "#566a82", camo: "#36455a", vest: "#3a434c", trim: "#9aa6ad", mask: "#30383f", gear: "#272d33" },
  t: { cloth: "#8d7852", camo: "#6a5839", vest: "#4b4230", trim: "#a4483a", mask: "#34322e", gear: "#2a2620" },
};
const SKIN = "#c39776";
type SkinPart = "cloth" | "vest" | "gear" | "head" | "skin" | "mask" | "scarf";
const skins = new Map<string, THREE.CanvasTexture>();

/** 256px wrapped once round the head: u = 0.5 (x 128) is the nose, v runs chin to crown. */
function paintHead(c: Ctx, team: Team): void {
  const colors = PALETTE[team], x = c.ctx;
  fill(c, SKIN);
  cloud(c, 12, 64, 3);
  // The face turns away into shadow at the temples and under the jaw.
  x.fillStyle = "rgba(60,30,20,0.2)";
  x.fillRect(82, 96, 12, 150); x.fillRect(162, 96, 12, 150);
  x.fillRect(82, 224, 92, 32);
  // Nose: a shadow down each side and under the tip, then the mouth.
  x.fillStyle = "rgba(80,45,32,0.34)";
  x.fillRect(122, 128, 2, 34); x.fillRect(132, 128, 2, 34);
  x.fillRect(120, 162, 16, 3);
  x.fillStyle = "rgba(110,50,45,0.6)";
  x.fillRect(115, 194, 26, 3);
  x.fillStyle = "rgba(40,30,25,0.16)";
  x.fillRect(94, 172, 68, 70); // stubble
  if (team === "t") {
    // Cropped dark hair over the crown and down the back to the nape.
    x.fillStyle = "#231c18";
    x.fillRect(0, 0, 256, 60);
    x.fillRect(0, 60, 68, 110); x.fillRect(188, 60, 68, 110);
  } else {
    // Balaclava over everything but the eyes.
    x.fillStyle = colors.mask;
    x.fillRect(0, 0, 256, 108); x.fillRect(0, 138, 256, 118);
    x.fillRect(0, 108, 96, 30); x.fillRect(160, 108, 96, 30);
    x.fillStyle = "rgba(0,0,0,0.3)";
    x.fillRect(96, 106, 64, 2); x.fillRect(96, 138, 64, 2);
    for (let fold = 150; fold < 250; fold += 22) x.fillRect(60, fold, 136, 1);
  }
  // Brows, the shadow of the socket, then the eye itself under its lid.
  for (const eye of [102, 137]) {
    x.fillStyle = "#2a1f18"; x.fillRect(eye, 112, 18, 3);
    x.fillStyle = "rgba(60,35,25,0.38)"; x.fillRect(eye + 1, 116, 17, 10);
    x.fillStyle = "#d8d0c4"; x.fillRect(eye + 4, 120, 11, 5);
    x.fillStyle = "#2b2622"; x.fillRect(eye + 8, 120, 4, 5);
    x.fillStyle = "rgba(0,0,0,0.5)"; x.fillRect(eye + 3, 119, 13, 1);
  }
  grain(c, 6, 1);
}

function paintVest(c: Ctx, team: Team): void {
  const colors = PALETTE[team], x = c.ctx;
  fill(c, colors.vest);
  cloud(c, 10, 48, 3);
  const dark = "rgba(0,0,0,0.38)", light = "rgba(255,255,255,0.09)";
  // Shoulder straps down the front and back.
  for (const strap of [40, 80, 4, 116]) {
    x.fillStyle = dark; x.fillRect(strap, 0, 9, 128);
    x.fillStyle = light; x.fillRect(strap + 1, 0, 1, 128);
  }
  // Front closure, then a row of magazine pouches low on the chest.
  x.fillStyle = dark; x.fillRect(63, 0, 2, 128);
  for (const pouch of [34, 49, 66, 81]) {
    x.fillStyle = dark; x.fillRect(pouch, 70, 13, 40);
    x.fillStyle = colors.vest; x.fillRect(pouch + 1, 72, 11, 37);
    x.fillStyle = light; x.fillRect(pouch + 1, 72, 11, 1);
    x.fillStyle = dark; x.fillRect(pouch + 1, 84, 11, 2); // flap
    x.fillStyle = colors.trim; x.fillRect(pouch + 5, 86, 3, 3); // snap
  }
  // Cummerbund seams round the sides, and a patch on the chest and upper back.
  x.fillStyle = dark;
  for (const y of [66, 96, 114]) { x.fillRect(0, y, 30, 1); x.fillRect(98, y, 30, 1); }
  x.fillStyle = colors.trim;
  x.fillRect(team === "ct" ? 46 : 50, 30, team === "ct" ? 12 : 6, 5);
  x.fillRect(123, 30, 5, 5); x.fillRect(0, 30, 5, 5);
  stains(c, 5, "#15130f", 14);
}

function skin(team: Team, part: SkinPart): THREE.CanvasTexture {
  const key = `${team}:${part}`;
  let texture = skins.get(key);
  if (texture) return texture;
  const colors = PALETTE[team];
  texture = canvasTexture(part === "head" ? 256 : 128, team === "ct" ? 21 : 22, (c) => {
    if (part === "head") return paintHead(c, team);
    if (part === "vest") return paintVest(c, team);
    fill(c, part === "skin" ? SKIN : part === "scarf" ? colors.trim : colors[part]);
    cloud(c, 10, 48, 3);
    grain(c, 8, 1);
    if (part === "cloth") {
      // Camouflage blotches, then the folds and seams of worn fatigues.
      stains(c, 16, colors.camo, 20);
      stains(c, 6, "#d9d2c0", 9);
      c.ctx.fillStyle = "rgba(0,0,0,0.16)";
      for (let i = 0; i < 14; ++i) {
        c.ctx.fillRect(c.random() * 100, c.random() * 128, 14 + c.random() * 24, 1);
      }
      c.ctx.fillRect(0, 0, 2, 128);
    }
    if (part === "scarf") {
      // Woven check, pulled up over the nose.
      c.ctx.fillStyle = "rgba(240,232,214,0.75)";
      for (let y = 0; y < 128; y += 16) {
        for (let i = (y / 16) % 2 * 8; i < 128; i += 16) c.ctx.fillRect(i, y, 8, 8);
      }
    }
    stains(c, 4, "#1c1a16", 12);
  });
  skins.set(key, texture);
  return texture;
}

const THIGH = 17.5, SHIN = 16, UPPER_ARM = 12.5, FOREARM = 10.5;
const HIP_Y = 36.5;
/** Shoulder joint, in torso space. */
const SHOULDER_X = 7.6, SHOULDER_Y = 16.6;
/** Facets round every limb, and fatigue cloth per texture repeat, the same everywhere. */
const SIDES = 12;
const CLOTH_DENSITY = 22;
/** The torso turns its support shoulder toward the target; the weapon stays on the aim line. */
const BLADE = 0.55;
/** Kneeling pose height over the 36u ducked hull: squash the remainder. */
const DUCK_SCALE = 0.61;
const RIGHT = new THREE.Vector3(1, 0, 0);
const EULER = new THREE.Euler();

/** Which way a body goes down: away from the shot that killed it. */
export type Fall = "back" | "front" | "side";

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export interface CharacterPose {
  speed: number;
  /** World yaw of travel; the legs turn to it while the torso holds the aim. */
  moveYaw: number;
  /** Just took a hit. */
  flinch: boolean;
  onGround: boolean;
  yaw: number;
  pitch: number;
  alive: boolean;
  weapon: number;
  ducked: boolean;
}

export class Character {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly weaponSlot = new THREE.Group();
  private weapon: THREE.Group | null = null;
  private weaponId = -1;
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly direction = new THREE.Vector3();
  private readonly pole = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly wrist = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly deathBounds = new THREE.Box3();
  private readonly aim = new THREE.Quaternion();
  private readonly twist = new THREE.Quaternion();
  private readonly flash: THREE.Sprite;
  private phase = 0;
  private deathTime = 0;
  private fall: Fall = "back";
  private gaitYaw = 0;
  private kick = 0;
  private flinch = 0;
  private land = 0;
  private grounded = true;

  constructor(team: Team) {
    const mat = (part: SkinPart) => {
      const material = new THREE.MeshLambertMaterial({ map: skin(team, part) });
      this.materials.push(material);
      return material;
    };
    const cloth = mat("cloth"), vest = mat("vest"), gear = mat("gear");
    const face = mat("head"), hand = mat("skin");
    // One smooth-shaded language for the whole figure: lofts for anything
    // with length, ellipsoids for joints and gear. No part has a hard corner,
    // so a pouch and the chest it sits on take the light the same way.
    const tube = (group: THREE.Group, material: THREE.Material, rings: Ring[], square = 2) =>
      meshPart(group, loft(rings, SIDES, { density: CLOTH_DENSITY, square }), material, [0, 0, 0]);
    const shell = (group: THREE.Group, material: THREE.Material, rings: Ring[], square = 2) =>
      meshPart(group, loft(rings, SIDES, { square }), material, [0, 0, 0]);
    const lump = (group: THREE.Group, material: THREE.Material, size: V3, at: V3) =>
      meshPart(group, ball(...size), material, at);

    // Rings are [height, half-width, front depth, x, z, back depth].
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP_Y;
    tube(this.hips, cloth, [[-3.8, 1.6, 2, 0, 0, 2.2], [-2.4, 5.4, 3.6, 0, 0, 4.4], [0, 6.9, 4, 0, 0, 5],
                            [2.5, 6.6, 4, 0, 0, 4.6], [4.5, 6.1, 3.9, 0, 0, 4.2]], 2.3);
    shell(this.hips, gear, [[3, 6.75, 4.35, 0, 0, 4.85], [3.9, 6.75, 4.35, 0, 0, 4.75], [4.8, 6.5, 4.3, 0, 0, 4.6]], 2.3); // belt
    lump(this.hips, gear, [1, 2.7, 1.9], [7.4, -4.4, 0.4]); // holster
    lump(this.hips, gear, [2.4, 1.6, 1.2], [-2.6, 2.6, 5.2]); // rear pouch

    this.hips.add(this.torso);
    this.torso.position.y = 4.5;
    tube(this.torso, cloth, [[0, 6.1, 3.9, 0, 0, 4.2], [4, 6.4, 4.3, 0, 0, 4.3], [9, 7.1, 5, 0, 0, 4.6],
                             [13, 7.6, 5.1, 0, 0, 4.7], [16, 7.3, 4.4, 0, 0, 4.6], [17.8, 5.4, 3.4, 0, 0.3, 4],
                             [19, 2.9, 2.6, 0, 0.4, 2.9], [21.6, 2.4, 2.4, 0, 0.3, 2.6]], 2.3);
    // Plate carrier: a shell over the fatigues. Its pouch row and back panel
    // are swellings in the shell, with the detail painted over them.
    shell(this.torso, vest, [[2.6, 6.7, 4.6, 0, 0, 4.8], [3.6, 7.2, 5.9, 0, 0, 5], [7, 7.5, 6.4, 0, 0, 5.3],
                             [9.6, 7.9, 6, 0, 0, 5.6], [13, 8.3, 6, 0, 0, 5.7], [15.8, 7.8, 5.2, 0, 0, 5.3],
                             [17.4, 6, 4.2, 0, 0.3, 4.6], [18.3, 4.2, 3.4, 0, 0.3, 3.8]], 2.5);
    lump(this.torso, gear, [1, 1.9, 0.8], [-5.2, 15.2, -5.3]); // radio
    shell(this.torso, gear, [[16.5, 0.18, 0.18, -5.6, -5.2], [21, 0.12, 0.12, -5.6, -5.2]]);

    // The head: jaw narrower than the cheekbones, a flat face plane, and the
    // skull carried behind the ears.
    this.torso.add(this.head);
    this.head.position.y = 21;
    this.head.scale.setScalar(1.05);
    shell(this.head, face, [[0.2, 1.7, 1.9, 0, -0.5, 1.5], [0.9, 2.3, 3.3, 0, 0, 2.3], [2, 2.85, 3.8, 0, 0, 3],
                            [3.4, 3.1, 3.9, 0, 0, 3.7], [5, 3.15, 3.8, 0, 0, 4.1], [6.6, 3.15, 3.9, 0, 0, 4.2],
                            [8, 2.9, 3.5, 0, 0, 4], [9.1, 2.1, 2.5, 0, 0.2, 3.1], [9.8, 0.9, 1, 0, 0.4, 1.6]]);
    const nose = team === "ct" ? mat("mask") : hand;
    lump(this.head, nose, [0.42, 0.85, 0.6], [0, 3.95, -3.75]);
    if (team === "ct") {
      shell(this.head, gear, [[6.1, 3.5, 4.3, 0, 0, 4.65], [7, 3.75, 4.55, 0, 0, 4.85], [8.5, 3.55, 4.25, 0, 0, 4.65],
                              [9.7, 2.7, 3.2, 0, 0.2, 3.7], [10.4, 1.2, 1.4, 0, 0.3, 2]]);
      for (const x of [-3.5, 3.5]) lump(this.head, gear, [0.7, 1.5, 1.4], [x, 4.6, 0.5]); // ear cups
      // Goggles pushed up onto the helmet.
      shell(this.head, vest, [[7.3, 3.85, 4.65, 0, 0, 4.95], [7.9, 3.9, 4.7, 0, 0, 5], [8.5, 3.7, 4.45, 0, 0, 4.8]]);
      lump(this.head, vest, [2.7, 1, 0.8], [0, 7.9, -4.5]);
    } else {
      for (const x of [-3.15, 3.15]) lump(this.head, hand, [0.25, 0.75, 0.45], [x, 4.6, 0.5]); // ears
      // Knitted cap, rolled at the brim; the scarf is pulled up over the nose.
      shell(this.head, gear, [[6.6, 3.3, 4.05, 0, 0, 4.35], [8.1, 3.1, 3.7, 0, 0, 4.2], [9.3, 2.3, 2.7, 0, 0.2, 3.3],
                              [10.1, 1, 1.1, 0, 0.4, 1.8]]);
      shell(this.head, vest, [[6.2, 3.4, 4.15, 0, 0, 4.45], [6.9, 3.5, 4.25, 0, 0, 4.55], [7.6, 3.35, 4.1, 0, 0, 4.4]]);
      shell(this.head, mat("scarf"), [[-1.4, 3.1, 3.2, 0, 0, 3.2], [0, 3.3, 3.9, 0, 0, 3.2], [1.6, 3.2, 4.2, 0, 0, 3.3],
                                      [3, 3.3, 4.3, 0, 0, 3.9], [3.7, 3.25, 4.15, 0, 0, 3.9]]);
    }

    this.torso.add(this.weaponSlot);
    this.hips.rotation.order = "YXZ";
    this.head.rotation.order = "YXZ";
    this.flash = new THREE.Sprite(muzzleFlashMaterial());
    this.flash.scale.setScalar(13);
    this.flash.visible = false;
    this.weaponSlot.add(this.flash);
    for (const side of [-1, 1]) {
      const upper = new THREE.Group(), lower = new THREE.Group();
      // Each bone starts in a ball of its own girth, so a bent joint stays closed.
      lump(upper, cloth, [2.7, 2.8, 2.8], [0, -0.3, 0]); // deltoid
      tube(upper, cloth, [[-UPPER_ARM, 1.9, 1.9], [-8.5, 2.2, 2.3], [-4, 2.45, 2.5], [-1, 2.5, 2.5]]);
      lump(lower, cloth, [2, 2, 2], [0, 0, 0]);
      tube(lower, cloth, [[-FOREARM, 1.45, 1.3], [-7, 1.9, 1.8], [-3, 2.15, 2.05], [-0.5, 2.05, 1.95]]);
      shell(lower, gear, [[-FOREARM - 0.6, 1.4, 1.2], [-FOREARM + 0.6, 1.7, 1.5], [-FOREARM + 1.8, 1.65, 1.5]]); // cuff
      lump(lower, hand, [1.15, 1.9, 1.55], [0, -FOREARM - 1.8, 0]);
      this.torso.add(upper, lower);
      this.shoulders.push(upper); this.elbows.push(lower);

      const hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(side * 3.6, 0, 0);
      knee.position.y = -THIGH;
      lump(hip, cloth, [3.6, 3.6, 3.9], [0, -0.6, 0.2]);
      // Thigh and calf carry their mass at the back; the shin is straight in front.
      tube(hip, cloth, [[-THIGH, 2.35, 2.4], [-13, 2.75, 2.9], [-7, 3.3, 3.5, 0, 0, 3.6], [-2, 3.6, 3.7, 0, 0, 3.9]]);
      lump(knee, cloth, [2.45, 2.5, 2.5], [0, 0, 0]);
      tube(knee, cloth, [[-SHIN + 3, 1.9, 1.9], [-10, 2.1, 2, 0, 0, 2.7], [-5.5, 2.4, 2.2, 0, 0, 3], [-0.5, 2.3, 2.4]]);
      lump(knee, gear, [2.2, 2.3, 0.9], [0, -0.4, -2.2]); // knee pad
      // Boot: shaft, instep, then a toe box that runs forward of the ankle.
      shell(knee, gear, [[-19, 2, 5.3, 0, -2.1], [-18.1, 2.25, 5.5, 0, -2.1], [-16.7, 2.2, 4.7, 0, -1.6],
                         [-15.2, 2.1, 3.1, 0, -0.4], [-13, 2.15, 2.5], [-10.4, 2.4, 2.6], [-9.6, 2.2, 2.4]]);
      hip.add(knee); this.hips.add(hip);
      this.legs.push(hip); this.knees.push(knee);
    }
    batchParts(this.pivot);
  }

  setTint(r: number, g: number, b: number): void {
    for (const material of this.materials) material.color.setRGB(r, g, b);
  }

  set visible(value: boolean) { this.root.visible = value; }

  private setWeapon(id: number): void {
    if (id === this.weaponId) return;
    if (this.weapon) {
      this.weaponSlot.remove(this.weapon);
      disposeParts(this.weapon);
    }
    this.weapon = buildWeapon(id);
    this.weaponSlot.add(this.weapon);
    this.weaponId = id;
    const muzzle = muzzleOffset(id);
    this.flash.position.set(muzzle[0], muzzle[1], muzzle[2] - 3);
  }

  /** A shot left this body's weapon: recoil through the arms, flash at the muzzle. */
  fire(): void {
    this.kick = 1;
    this.flash.material.rotation = Math.random() * Math.PI;
  }

  /** Choose how the body falls before the pose stops being alive. */
  die(fall: Fall): void {
    this.fall = fall;
  }

  private aimBone(bone: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, length: number): void {
    bone.position.copy(from);
    this.direction.copy(to).sub(from);
    bone.scale.y = this.direction.length() / length;
    bone.quaternion.setFromUnitVectors(this.down, this.direction.normalize());
  }

  /** Two-bone IK: put the hand on `wrist` and let the elbow fall out and down. */
  private reach(i: number, wrist: THREE.Vector3): void {
    const side = i === 0 ? -1 : 1;
    const shoulder = this.shoulders[i]!.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
    const span = this.direction.copy(wrist).sub(shoulder);
    const distance = Math.min(span.length(), UPPER_ARM + FOREARM - 0.01);
    span.normalize();
    const along = (UPPER_ARM ** 2 - FOREARM ** 2 + distance ** 2) / (2 * distance);
    const out = Math.sqrt(Math.max(0, UPPER_ARM ** 2 - along ** 2));
    this.pole.set(side * 0.7, -1, 0.25).addScaledVector(span, -this.pole.dot(span)).normalize();
    this.elbow.copy(shoulder).addScaledVector(span, along).addScaledVector(this.pole, out);
    this.wrist.copy(wrist);
    this.aimBone(this.shoulders[i]!, shoulder.clone(), this.elbow, UPPER_ARM);
    this.aimBone(this.elbows[i]!, this.elbow, this.wrist, FOREARM + 1.6);
  }

  update(dt: number, pose: CharacterPose): void {
    this.setWeapon(pose.weapon);
    this.root.rotation.y = pose.yaw;
    // The sim squashes hitboxes while ducked; a kneel plus a mild squash keeps
    // the rendered target inside them without flattening the model.
    this.root.scale.y = pose.ducked ? DUCK_SCALE : 1;
    if (!pose.alive) {
      this.deathTime = Math.min(this.deathTime + dt / 0.7, 1);
      const t = 1 - (1 - this.deathTime) ** 2;
      // Knees go first, then the body follows the shot down and settles with
      // one small bounce. The weapon is the sim's to drop, so it leaves the hands.
      const settle = Math.sin(Math.PI * Math.max(0, (this.deathTime - 0.75) / 0.25)) * 0.07;
      const angle = (t - settle) * Math.PI * 0.5;
      this.pivot.rotation.set(
        this.fall === "back" ? angle : this.fall === "front" ? -angle : 0, 0,
        this.fall === "side" ? angle : 0);
      this.flash.visible = false;
      this.weaponSlot.visible = this.deathTime < 0.2;
      for (let i = 0; i < 2; ++i) {
        const side = i === 0 ? -1 : 1;
        this.legs[i]!.rotation.x = t * (0.25 + 0.2 * side);
        this.knees[i]!.rotation.x = -t * (0.5 - 0.25 * side);
        this.reach(i, this.wrist.set(side * (9 + 7 * t), 14 - 9 * t, -9 + 6 * t).clone());
      }
      this.head.rotation.x = -0.3 * t;
      // Keep the whole pose above the snapshot's feet plane instead of sinking
      // it below the floor. This is visual placement, not corpse physics.
      this.pivot.position.y = 0;
      this.root.updateMatrixWorld(true);
      this.deathBounds.setFromObject(this.pivot);
      this.pivot.position.y = Math.max(0,
        (this.root.position.y - this.deathBounds.min.y) / this.root.scale.y);
      return;
    }
    this.deathTime = 0;
    this.weaponSlot.visible = true;
    this.pivot.rotation.set(0, 0, 0); this.pivot.position.y = 0;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.flash.visible = this.kick > 0.55;
    this.flinch += ((pose.flinch ? 1 : 0) - this.flinch) * Math.min(1, dt * 14);
    if (pose.onGround && !this.grounded) this.land = 1;
    this.grounded = pose.onGround;
    this.land = Math.max(0, this.land - dt * 5);

    const moving = pose.speed > 12;
    const gait = Math.min(pose.speed / 250, 1.4);
    // GoldSrc's gait yaw: the lower body turns to face where it is going, and
    // runs backward rather than turning more than a quarter away from the aim.
    let heading = moving ? wrap(pose.moveYaw - pose.yaw) : 0;
    let direction = 1;
    if (Math.abs(heading) > Math.PI * 0.6) {
      heading = wrap(heading + Math.PI);
      direction = -1;
    }
    heading = Math.max(-0.9, Math.min(0.9, heading));
    this.gaitYaw += (heading - this.gaitYaw) * Math.min(1, dt * 10);
    this.phase += dt * (moving && pose.onGround ? 4 + gait * 11 : 1.2);
    const sin = Math.sin(this.phase), cos = Math.cos(this.phase);
    const kneel = pose.ducked && pose.onGround;
    for (let i = 0; i < 2; ++i) {
      const side = i === 0 ? -1 : 1;
      // Bones point -Y and the body faces -Z: positive hip rotation lifts the
      // thigh forward; negative knee rotation folds the heel back toward +Z.
      const stride = sin * side * gait * direction;
      // The knee folds while its leg swings through, and straightens to plant.
      const swing = Math.max(0, cos * side * direction) * gait;
      this.legs[i]!.rotation.x = !pose.onGround ? 0.55 + 0.15 * side
        : kneel ? 1.15 + stride * 0.25 : stride * 0.6 + swing * 0.2;
      this.knees[i]!.rotation.x = !pose.onGround ? -0.8
        : kneel ? -1.95 : -0.06 - swing * 1.05 - this.land * 0.5;
    }

    // The weapon rides the aim line while the torso blades behind it.
    const sidearm = pose.weapon === WeaponId.usp || pose.weapon === WeaponId.glock;
    const blade = pose.weapon === WeaponId.none || pose.weapon === WeaponId.knife ? 0
      : sidearm ? BLADE * 0.4 : BLADE;
    if (pose.weapon === WeaponId.knife) this.weaponSlot.position.set(7, 6, -11);
    else if (sidearm) this.weaponSlot.position.set(1.5, 15, -16.5);
    else this.weaponSlot.position.set(5.5, 13.8, -8.5);
    // Recoil comes back through the arms; a run bounces the muzzle.
    this.weaponSlot.position.z += this.kick * 1.6;
    this.weaponSlot.position.y += this.kick * 0.5 + (moving ? Math.sin(this.phase * 2) * gait * 0.35 : sin * 0.12);
    this.weaponSlot.rotation.set(this.kick * 0.06, blade, 0);
    this.weaponSlot.position.applyAxisAngle(THREE.Object3D.DEFAULT_UP, blade);
    this.weaponSlot.updateMatrix();
    for (let i = 0; i < 2; ++i) {
      const side = i === 0 ? -1 : 1;
      const grip: V3 = i === 0 ? supportGrip(pose.weapon) : [1.2, -2.6, 2.6];
      const wrist = this.wrist.set(...grip);
      if (pose.weapon === WeaponId.none || (i === 0 && pose.weapon === WeaponId.knife)) {
        wrist.set(side * 9.5, -5, -2 + sin * side * gait * 4); // empty hands swing
      } else {
        // Back off along the forearm so the hand, not the wrist, meets the grip.
        if (i === 0 && !sidearm) wrist.y -= 2;
        wrist.applyMatrix4(this.weaponSlot.matrix);
      }
      this.reach(i, wrist.clone());
    }
    // Only a kneel tips the pelvis; a run leans from the waist, and sinks the
    // hips as the legs spread so the planted foot stays on the floor.
    const lean = kneel ? -0.4 : 0;
    this.hips.position.y = kneel ? 25
      : HIP_Y - (pose.onGround ? gait * (3.2 - 2.2 * Math.abs(cos)) : 0) - this.land * 2.5;
    this.hips.rotation.set(lean, this.gaitYaw, 0);
    // Undo the gait turn, pitch about the true aim axis, then blade the chest.
    const pitch = Math.max(-0.9, Math.min(0.9, pose.pitch));
    this.aim.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -this.gaitYaw);
    this.torso.quaternion.copy(this.aim);
    this.aim.setFromAxisAngle(RIGHT,
      pitch * 0.65 - lean * 0.8 - gait * 0.08 + this.kick * 0.03 + this.flinch * 0.16);
    this.torso.quaternion.multiply(this.aim);
    this.twist.setFromEuler(EULER.set(0, -blade - sin * (moving ? gait * 0.07 : 0.008),
      sin * (moving ? gait * 0.04 : 0.012) + this.flinch * 0.1));
    this.torso.quaternion.multiply(this.twist);
    this.torso.position.y = 4.5 + (moving ? 0 : sin * 0.12); // breathing
    this.head.rotation.set(pitch * 0.35 - this.flinch * 0.2, blade, 0);
  }

  dispose(): void {
    disposeParts(this.root);
    for (const material of this.materials) material.dispose();
    this.flash.material.dispose();
    // Cached team textures and weapon materials outlive a roster rebuild.
  }
}
