import * as THREE from "three";
import { canvasTexture, fill, grain, stains, type Ctx } from "./textures";
import { ball, batchParts, disposeParts, loft, meshPart, type Ring, type V3 } from "./geometry";
import { buildWeapon, muzzleFlashMaterial, muzzleOffset, supportGrip, WeaponId } from "./weapons";

// Rigid articulated bodies, authored from the feet and 72u tall like the hull.
// Head 58–72, chest 38–58 and stomach 26–38 follow the sim hitboxes; the hip
// joint sits at 35 so the legs have a soldier's proportions rather than a
// toy's. Limbs and torso are lofted and smooth-shaded, and the detail a
// 2000-era model kept in its skin — pouches, straps, the face — is painted.
export type Team = "ct" | "t";
const PALETTE = {
  ct: { cloth: "#566a82", camo: "#36455a", vest: "#3a434c", trim: "#9aa6ad", mask: "#30383f", gear: "#272d33" },
  t: { cloth: "#8d7852", camo: "#6a5839", vest: "#4b4230", trim: "#a4483a", mask: "#34322e", gear: "#2a2620" },
};
const SKIN = "#c39776";
type SkinPart = "cloth" | "vest" | "gear" | "head" | "skin";
const skins = new Map<string, THREE.CanvasTexture>();

function paintHead(c: Ctx, team: Team): void {
  const colors = PALETTE[team], x = c.ctx;
  // u = 0.5 (canvas x 64) is the face; v runs neck (bottom) to crown (top).
  fill(c, team === "ct" ? colors.mask : SKIN);
  grain(c, 14, 1);
  if (team === "ct") {
    // Balaclava with one eye opening.
    x.fillStyle = SKIN;
    x.fillRect(45, 44, 38, 15);
    x.fillStyle = "rgba(0,0,0,0.35)";
    x.fillRect(45, 44, 38, 2); x.fillRect(45, 57, 38, 2);
  } else {
    // Dark hair above, a patterned scarf pulled up over the nose below.
    x.fillStyle = "#2b2420";
    x.fillRect(0, 0, 128, 38);
    x.fillStyle = colors.trim;
    x.fillRect(0, 62, 128, 66);
    x.fillStyle = "rgba(240,232,214,0.75)";
    for (let y = 64; y < 128; y += 8) {
      for (let i = (y / 8) % 2 * 8; i < 128; i += 16) x.fillRect(i, y, 8, 4);
    }
    x.fillStyle = "rgba(0,0,0,0.3)";
    x.fillRect(0, 62, 128, 2);
  }
  // Brows, eyes and the shadow down the nose.
  x.fillStyle = "#3b2c22";
  x.fillRect(50, 46, 11, 2); x.fillRect(67, 46, 11, 2);
  x.fillStyle = "#e6ded2";
  x.fillRect(51, 50, 9, 4); x.fillRect(68, 50, 9, 4);
  x.fillStyle = "#1d1a18";
  x.fillRect(54, 50, 4, 4); x.fillRect(70, 50, 4, 4);
  x.fillStyle = "rgba(90,58,40,0.45)";
  x.fillRect(62, 48, 4, 12);
}

function paintVest(c: Ctx, team: Team): void {
  const colors = PALETTE[team], x = c.ctx;
  fill(c, colors.vest);
  grain(c, 16, 1);
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
  // Cummerbund seams round the sides, and a patch on the upper back.
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
  texture = canvasTexture(128, team === "ct" ? 21 : 22, (c) => {
    if (part === "head") return paintHead(c, team);
    if (part === "vest") return paintVest(c, team);
    fill(c, part === "skin" ? SKIN : colors[part]);
    grain(c, 14, 1);
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
    stains(c, 4, "#1c1a16", 12);
  });
  skins.set(key, texture);
  return texture;
}

const THIGH = 16.5, SHIN = 13.5, UPPER_ARM = 12.5, FOREARM = 11.5;
const HIP_Y = 35;
/** Facets round every limb, and fatigue cloth per texture repeat, the same everywhere. */
const SIDES = 12;
const CLOTH_DENSITY = 22;
/** The torso turns its support shoulder toward the target; the weapon stays on the aim line. */
const BLADE = 0.4;
/** Kneeling pose height over the 36u ducked hull: squash the remainder. */
const DUCK_SCALE = 0.64;
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
    const lump = (group: THREE.Group, material: THREE.Material, size: V3, at: V3) =>
      meshPart(group, ball(...size), material, at);

    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP_Y;
    tube(this.hips, cloth, [[-7.6, 1.5, 2.6], [-6.2, 5, 4.5], [-4, 7.7, 5.5], [-1, 9, 5.9], [2, 8.9, 5.8], [4, 8.5, 5.5]], 2.4);
    tube(this.hips, gear, [[2.5, 9, 6], [3.5, 9.15, 6.1], [4.6, 9, 6]], 2.4); // belt
    lump(this.hips, gear, [1.2, 3.2, 2.2], [9.6, -4, 0.4]); // holster
    lump(this.hips, gear, [3, 2, 1.6], [-3.2, 2, 6.2]); // rear pouch

    this.hips.add(this.torso);
    this.torso.position.y = 4;
    tube(this.torso, cloth, [[0, 8.5, 5.5], [5, 9.3, 5.9], [11, 10.9, 6.6], [14.5, 11, 6.3], [16.6, 9.6, 5.6],
                             [18.2, 5.6, 4.2], [19.2, 3.2, 3.2], [20.6, 2.8, 3]], 2.4);
    // Plate carrier: a shell over the fatigues. Its pouch row and back panel
    // are swellings in the shell, with the detail painted over them.
    meshPart(this.torso, loft([[2.4, 9.6, 6.5], [3.4, 10.2, 7.4, 0, -0.5], [6.5, 10.7, 8, 0, -0.7],
                               [9.5, 11.2, 7.6, 0, -0.1], [12.5, 11.6, 7.7, 0, 0.3], [15.5, 11.2, 7, 0, 0.3],
                               [17.2, 9.2, 5.8], [18.3, 6.2, 4.7]], SIDES, { square: 2.6 }), vest, [0, 0, 0]);
    lump(this.torso, gear, [1.2, 2.2, 1], [-7.2, 15, -6.4]); // radio
    meshPart(this.torso, loft([[16.5, 0.22, 0.22, -7.6, -6.2], [21.5, 0.15, 0.15, -7.6, -6.2]], 5), gear, [0, 0, 0]);

    this.torso.add(this.head);
    this.head.position.y = 20;
    this.head.scale.setScalar(1.1);
    meshPart(this.head, loft([[0, 2.7, 2.9], [1.2, 3.3, 3.7], [2.6, 4, 4.5], [4.4, 4.4, 4.9], [6.6, 4.55, 5.05],
                              [8.6, 4.3, 4.8], [10.1, 3.4, 3.8], [11, 1.8, 2.1]], SIDES), face, [0, 0, 0]);
    if (team === "ct") {
      meshPart(this.head, loft([[7.6, 4.9, 5.5], [8.4, 5.3, 5.9], [9.8, 5.2, 5.8], [11.2, 4.4, 5],
                                [12.2, 3, 3.4], [12.7, 1.2, 1.4]], SIDES), gear, [0, 0, 0]);
      for (const x of [-5, 5]) lump(this.head, gear, [0.9, 1.9, 1.8], [x, 5.2, 0.4]); // ear cups
      // Goggles pushed up onto the helmet.
      meshPart(this.head, loft([[9.2, 5.4, 6], [9.8, 5.5, 6.1], [10.4, 5.2, 5.8]], SIDES), vest, [0, 0, 0]);
      lump(this.head, vest, [3.9, 1.3, 1], [0, 9.9, -5.6]);
    } else {
      // Knitted cap, rolled at the brim, and the scarf bunched at the throat.
      meshPart(this.head, loft([[7.6, 4.7, 5.2], [9.4, 4.5, 5], [10.8, 3.5, 3.9], [11.7, 1.6, 1.9]], SIDES),
        gear, [0, 0, 0]);
      meshPart(this.head, loft([[7, 4.8, 5.3], [7.7, 5, 5.5], [8.4, 4.8, 5.3]], SIDES), vest, [0, 0, 0]);
      meshPart(this.head, loft([[-1, 3.6, 3.9], [0.2, 4.4, 4.8], [1.6, 4.3, 4.8], [2.4, 4, 4.5]], SIDES),
        face, [0, 0, 0]);
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
      lump(upper, cloth, [3.5, 3.5, 3.5], [0, 0, 0]);
      tube(upper, cloth, [[-UPPER_ARM, 2.7, 2.7], [-9, 3, 3], [-5, 3.4, 3.4], [-1, 3.6, 3.6]]);
      lump(lower, cloth, [2.8, 2.8, 2.8], [0, 0, 0]);
      tube(lower, cloth, [[-FOREARM, 2, 2], [-8.5, 2.4, 2.4], [-4, 2.75, 2.75], [-0.5, 2.8, 2.8]]);
      meshPart(lower, loft([[-FOREARM - 0.5, 2, 2.1], [-FOREARM + 0.8, 2.3, 2.35], [-FOREARM + 2, 2.2, 2.25]], SIDES),
        gear, [0, 0, 0]); // glove cuff
      lump(lower, hand, [1.5, 2.1, 1.9], [0, -FOREARM - 1.7, 0]);
      this.torso.add(upper, lower);
      this.shoulders.push(upper); this.elbows.push(lower);

      const hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(side * 4.7, 0, 0);
      knee.position.y = -THIGH;
      lump(hip, cloth, [4.9, 4.6, 5.1], [0, -0.6, 0]);
      tube(hip, cloth, [[-THIGH, 3.5, 3.7], [-12, 3.9, 4.2], [-7, 4.6, 4.9], [-2, 4.9, 5.1]]);
      lump(knee, cloth, [3.5, 3.5, 3.7], [0, 0, 0]);
      tube(knee, cloth, [[-SHIN, 2.7, 2.9], [-9, 3.2, 3.6], [-5, 3.5, 3.8], [-0.5, 3.4, 3.6]]);
      lump(knee, gear, [3.1, 2.8, 1.1], [0, -0.4, -3.2]); // knee pad
      // Boot: shaft, instep, then a toe box that runs forward of the ankle.
      meshPart(knee, loft([[-18.5, 2.6, 4.9, 0, -1.9], [-17.6, 2.9, 5.2, 0, -1.9], [-16, 2.9, 4.6, 0, -1.4],
                           [-14.4, 2.8, 3.5, 0, -0.4], [-12.6, 2.9, 3.1], [-10.8, 3, 3.2]], SIDES),
        gear, [0, 0, 0]);
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
    const shoulder = this.shoulders[i]!.position.set(side * 12.3, 15.6, 0);
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
        this.reach(i, this.wrist.set(side * (13 + 6 * t), 14 - 9 * t, -9 + 6 * t).clone());
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
    if (pose.weapon === WeaponId.knife) this.weaponSlot.position.set(9, 6, -11);
    else if (sidearm) this.weaponSlot.position.set(2, 14.5, -17.5);
    else this.weaponSlot.position.set(4.5, 13.2, -11.5);
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
        wrist.set(side * 13, -6, -3 + sin * side * gait * 4); // empty hands swing
      } else {
        // Back off along the forearm so the hand, not the wrist, meets the grip.
        if (i === 0 && !sidearm) wrist.y -= 2;
        wrist.applyMatrix4(this.weaponSlot.matrix);
      }
      this.reach(i, wrist.clone());
    }
    const lean = kneel ? -0.4 : -gait * 0.1;
    this.hips.position.y = kneel ? 23.5
      : HIP_Y + (pose.onGround ? Math.abs(cos) * gait * 1.3 - 0.7 * gait : 0) - this.land * 2.5;
    this.hips.rotation.set(lean, this.gaitYaw, 0);
    // Undo the gait turn, pitch about the true aim axis, then blade the chest.
    const pitch = Math.max(-0.9, Math.min(0.9, pose.pitch));
    this.aim.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -this.gaitYaw);
    this.torso.quaternion.copy(this.aim);
    this.aim.setFromAxisAngle(RIGHT, pitch * 0.65 - lean * 0.8 + this.kick * 0.03 + this.flinch * 0.16);
    this.torso.quaternion.multiply(this.aim);
    this.twist.setFromEuler(EULER.set(0, -blade - sin * (moving ? gait * 0.07 : 0.008),
      sin * (moving ? gait * 0.04 : 0.012) + this.flinch * 0.1));
    this.torso.quaternion.multiply(this.twist);
    this.torso.position.y = 4 + (moving ? 0 : sin * 0.15); // breathing
    this.head.rotation.set(pitch * 0.35 - this.flinch * 0.2, blade, 0);
  }

  dispose(): void {
    disposeParts(this.root);
    for (const material of this.materials) material.dispose();
    this.flash.material.dispose();
    // Cached team textures and weapon materials outlive a roster rebuild.
  }
}
