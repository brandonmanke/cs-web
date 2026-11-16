import * as THREE from "three";
import { canvasTexture, fill, grain, stains, type Ctx } from "./textures";
import { batchParts, bevelBox, disposeParts, loft, meshPart, profile, type V3 } from "./geometry";
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
  x.fillRect(118, 30, 10, 6); x.fillRect(0, 30, 10, 6);
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
    const box = (group: THREE.Group, material: THREE.Material, size: V3, at: V3, rotX = 0) =>
      meshPart(group, bevelBox(...size, 0.5), material, at, [rotX, 0, 0]);

    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP_Y;
    meshPart(this.hips, loft([[-5, 6.8, 5.2], [-1, 9, 5.9], [4, 8.5, 5.5]]), cloth, [0, 0, 0]);
    meshPart(this.hips, loft([[2.6, 9, 6], [4.6, 9, 6]]), gear, [0, 0, 0]); // belt
    box(this.hips, gear, [2.2, 6, 4], [10, -2.5, 0.5]); // holster
    box(this.hips, gear, [5, 3.4, 2.4], [-3, 2.2, 6.2]); // rear pouch

    this.hips.add(this.torso);
    this.torso.position.y = 4;
    meshPart(this.torso, loft([[0, 8.5, 5.5], [5, 9.3, 5.9], [11, 10.9, 6.6], [16, 10.6, 5.9],
                               [18.4, 5, 4], [20.4, 2.7, 2.9]]), cloth, [0, 0, 0]);
    // Plate carrier: a shell over the fatigues, its pouches painted on.
    meshPart(this.torso, loft([[2.5, 9.9, 6.7], [7, 10.6, 7.2], [12, 11.5, 7.5], [16.6, 10, 6.5],
                               [18, 6, 4.8]], 10), vest, [0, 0, 0]);
    for (const x of [-5.6, -1.9, 1.9, 5.6]) box(this.torso, vest, [3.3, 5.4, 1.6], [x, 6.6, -7.7]);
    box(this.torso, gear, [2.2, 3.6, 1.6], [-7, 14.6, -6.2]); // radio
    box(this.torso, gear, [0.4, 4.5, 0.4], [-7.6, 18.4, -6]);
    box(this.torso, vest, [11, 10, 2.4], [0, 10.5, 7.2]); // back panel

    this.torso.add(this.head);
    this.head.position.y = 20;
    this.head.scale.setScalar(1.1);
    meshPart(this.head, loft([[0, 2.7, 2.9], [1.6, 3.7, 4.1], [4, 4.3, 4.8], [7, 4.5, 5],
                              [9.6, 3.9, 4.4], [11, 2, 2.4]]), face, [0, 0, 0]);
    box(this.head, face, [1.3, 2, 1.2], [0, 5.2, -5]); // nose, under the paint
    if (team === "ct") {
      meshPart(this.head, loft([[7.7, 5, 5.6], [9, 5.35, 5.95], [11, 4.6, 5.2], [12.6, 2.4, 2.8]], 10),
        gear, [0, 0, 0]);
      for (const x of [-5.2, 5.2]) box(this.head, gear, [1.2, 3.6, 3.4], [x, 5, 0.4]); // ear cups
      // Goggles pushed up onto the helmet.
      box(this.head, vest, [8.4, 2.4, 1.4], [0, 10, -5.6], -0.3);
      meshPart(this.head, loft([[9.4, 5.45, 6.05], [10.4, 5.1, 5.7]], 10), vest, [0, 0, 0]);
    } else {
      // Knitted cap, rolled at the brim.
      meshPart(this.head, loft([[7.4, 4.75, 5.25], [9.8, 4.3, 4.8], [11.6, 2.3, 2.7]], 10), gear, [0, 0, 0]);
      meshPart(this.head, loft([[7, 4.95, 5.45], [8.3, 4.95, 5.45]], 10), vest, [0, 0, 0]);
      meshPart(this.head, loft([[-0.6, 4.2, 4.5], [1.6, 4.4, 4.9]], 10), face, [0, 0, 0]); // scarf
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
      meshPart(upper, loft([[-UPPER_ARM, 2.7, 2.7], [-6, 3.4, 3.4], [0, 3.6, 3.6]]), cloth, [0, 0, 0]);
      box(upper, vest, [6, 3, 6], [0, -2.4, 0]); // shoulder patch
      meshPart(lower, loft([[-FOREARM, 2, 2], [-7, 2.7, 2.7], [0, 2.8, 2.8]]), cloth, [0, 0, 0]);
      meshPart(lower, loft([[-FOREARM - 0.4, 2.1, 2.2], [-FOREARM + 2, 2.35, 2.35]]), gear, [0, 0, 0]);
      box(lower, hand, [2.6, 3.6, 3], [0, -FOREARM - 1.6, 0]);
      this.torso.add(upper, lower);
      this.shoulders.push(upper); this.elbows.push(lower);

      const hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(side * 4.7, 0, 0);
      knee.position.y = -THIGH;
      meshPart(hip, loft([[-THIGH, 3.5, 3.7], [-8, 4.5, 4.8], [0, 4.9, 5.1]]), cloth, [0, 0, 0]);
      box(hip, cloth, [1.6, 5.4, 4.6], [side * 4.5, -7.5, 0]); // cargo pocket
      meshPart(knee, loft([[-SHIN, 2.7, 2.9], [-6.5, 3.5, 3.8], [0, 3.4, 3.6]]), cloth, [0, 0, 0]);
      box(knee, gear, [5.6, 4.4, 1.6], [0, -0.6, -3.4]); // knee pad
      meshPart(knee, profile([[2.9, -11.5], [2.9, -18.5], [-6.6, -18.5], [-6.8, -17], [-4.2, -15.4],
                              [-2.8, -11.5]], 5.8, 0.4), gear, [0, 0, 0]);
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
