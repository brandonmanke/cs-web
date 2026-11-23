import * as THREE from "three";
import {
  ball, batchParts, disposeParts, loft, meshPart, roundBox, type Bump, type LoftOptions, type Ring, type V3,
} from "./geometry";
import { cloneHeadgearGlb } from "./loader";
import { lensMaterial, skinMaterial, type Look, type SkinPart, type Team } from "./skins";
import { buildWeapon, muzzleFlashMaterial, muzzleOffset, supportGrip, WeaponId } from "./weapons";

export type { Look, Team } from "./skins";

// Skinned, sculpted bodies, authored from the feet and 72u (six feet) tall
// like the hull. Proportions are a real adult's — a 9u head, 15u between the
// shoulder joints, the hip joint at half height — so the figure sits inside
// the sim hitboxes (head 58–72, chest 38–58, stomach 26–38) rather than
// filling them. Every form is a loft splined through a few authored sections,
// each with its own front and back depth, then pressed with bumps and hollows:
// that is where the nose, the brow, the kneecap and the plate under the vest
// come from. Gear is modelled as rounded boxes; cloth, webbing and the face
// are painted, in colour and in relief (`skins.ts`).

const THIGH = 17.5, SHIN = 16, UPPER_ARM = 12.5, FOREARM = 10.5;
const HIP_Y = 36.5;
/** Shoulder joint, in torso space. */
const SHOULDER_X = 7.6, SHOULDER_Y = 16.6;
/** Facets round every limb, and fatigue cloth per texture repeat, the same everywhere. */
const SIDES = 16;
const CLOTH_DENSITY = 22;
/** The torso turns its support shoulder toward the target; the weapon stays on the aim line. */
const BLADE = 0.55;
/** Kneeling pose height over the 36u ducked hull: squash the remainder. */
const DUCK_SCALE = 0.61;
/**
 * The face, as bumps on the head loft (0.5 is the nose; heights are the head's
 * own): brow ridge over hollow sockets, the nose and its tip, cheekbones, lips,
 * chin, the angle of the jaw, and the temples drawn in.
 */
const FACE: Bump[] = [
  { u: 0.5, y: 4.9, su: 0.022, sy: 1.1, h: 0.55 }, { u: 0.5, y: 3.95, su: 0.032, sy: 0.55, h: 0.95 },
  { u: 0.43, y: 6.05, su: 0.05, sy: 0.4, h: 0.3, mirror: true }, { u: 0.5, y: 6.2, su: 0.03, sy: 0.4, h: 0.2 },
  { u: 0.428, y: 5.2, su: 0.034, sy: 0.42, h: -0.42, mirror: true },
  { u: 0.375, y: 4.3, su: 0.05, sy: 0.7, h: 0.28, mirror: true },
  { u: 0.5, y: 2.75, su: 0.05, sy: 0.38, h: 0.32 }, { u: 0.5, y: 2.2, su: 0.06, sy: 0.2, h: -0.12 },
  { u: 0.5, y: 1.35, su: 0.06, sy: 0.5, h: 0.42 },
  { u: 0.31, y: 1.9, su: 0.05, sy: 0.7, h: 0.22, mirror: true },
  { u: 0.34, y: 6.4, su: 0.04, sy: 0.9, h: -0.18, mirror: true },
];
const RIGHT = new THREE.Vector3(1, 0, 0);
const EULER = new THREE.Euler();

/** Which way a body goes down: away from the shot that killed it. */
export type Fall = "back" | "front" | "side";

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Weight a limb authored along -Y to two bones: everything above `joint`
 * follows the first, everything below the second, blended across the joint so
 * the cloth bends rather than breaks.
 */
function skinAcross(geometry: THREE.BufferGeometry, joint: number, blend = 2.4): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const indices = new Uint16Array(position.count * 4), weights = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; ++i) {
    const t = Math.max(0, Math.min(1, (joint + blend - position.getY(i)) / (2 * blend)));
    const lower = t * t * (3 - 2 * t);
    indices[i * 4 + 1] = 1;
    weights[i * 4] = 1 - lower;
    weights[i * 4 + 1] = lower;
  }
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  return geometry;
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
  private readonly materials: THREE.MeshPhongMaterial[] = [];
  private readonly lens = lensMaterial();
  private readonly skeletons: THREE.Skeleton[] = [];
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

  constructor(team: Team, look: Look = 0) {
    const mat = (part: SkinPart) => {
      const material = skinMaterial(team, look, part);
      this.materials.push(material);
      return material;
    };
    const cloth = mat("cloth"), vest = mat("vest"), pouch = mat("pouch"), gear = mat("gear");
    const face = mat("head"), hand = mat("hand"), boot = mat("boot");
    // Tiled cloth, a sheet wrapped once round a form, and a rounded box of kit.
    const tube = (group: THREE.Group, material: THREE.Material, rings: Ring[], options: LoftOptions = {}) =>
      meshPart(group, loft(rings, SIDES, { density: CLOTH_DENSITY, ...options }), material, [0, 0, 0]);
    const wrapped = (group: THREE.Group, material: THREE.Material, rings: Ring[], options: LoftOptions = {},
                     sides = SIDES) => meshPart(group, loft(rings, sides, options), material, [0, 0, 0]);
    const kit = (group: THREE.Group, material: THREE.Material, size: V3, at: V3, rotation: V3 = [0, 0, 0],
                 round = 8) => meshPart(group, roundBox(...size, round), material, at, rotation);
    const lump = (group: THREE.Group, material: THREE.Material, size: V3, at: V3) =>
      meshPart(group, ball(...size), material, at);

    // Rings are [height, half-width, front depth, x, z, back depth].
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = HIP_Y;
    tube(this.hips, cloth, [[-3.8, 1.6, 2, 0, 0, 2.2], [-2.4, 5.4, 3.6, 0, 0, 4.4], [0, 6.9, 4, 0, 0, 5],
                            [2.5, 6.6, 4, 0, 0, 4.6], [4.5, 6.1, 3.9, 0, 0, 4.2]],
      { square: 2.3, smooth: 2, bumps: [{ u: 0.09, y: -0.4, su: 0.07, sy: 1.7, h: 0.45, mirror: true }] });
    // Duty belt: buckle, pistol magazines on the left, a utility pouch behind.
    wrapped(this.hips, gear, [[3, 6.75, 4.35, 0, 0, 4.85], [3.9, 6.8, 4.4, 0, 0, 4.8], [4.8, 6.5, 4.3, 0, 0, 4.6]],
      { square: 2.3 });
    kit(this.hips, gear, [1.9, 1.5, 0.5], [0, 3.9, -4.6]);
    for (const x of [-3.3, -5]) kit(this.hips, pouch, [1.4, 2.7, 1.1], [x, 2.9, x < -4 ? -3.6 : -4.4], [0, x < -4 ? 0.5 : 0.2, 0]);
    kit(this.hips, pouch, [3.6, 2.7, 1.7], [2.8, 2.7, 5.1]);
    kit(this.hips, pouch, [3.7, 1, 1.9], [2.8, 3.7, 5.15]);

    this.hips.add(this.torso);
    this.torso.position.y = 4.5;
    tube(this.torso, cloth, [[0, 6.1, 3.9, 0, 0, 4.2], [4, 6.4, 4.3, 0, 0, 4.3], [9, 7.1, 5, 0, 0, 4.6],
                             [13, 7.6, 5.1, 0, 0, 4.7], [16, 7.3, 4.4, 0, 0, 4.6], [17.8, 5.4, 3.4, 0, 0.3, 4],
                             [19, 2.9, 2.6, 0, 0.4, 2.9], [21.6, 2.4, 2.4, 0, 0.3, 2.6]], { square: 2.3, smooth: 2 });
    wrapped(this.torso, cloth, [[18.6, 3.5, 3.1, 0, 0.3, 3.3], [19.6, 3.3, 3.1, 0, 0.3, 3.2], [20.5, 3.4, 3.3, 0, 0.3, 3.3]]); // collar
    // Plate carrier: a shell over the fatigues with a hard plate front and
    // back, webbing painted round it and the load hung off that.
    wrapped(this.torso, vest, [[2.6, 6.7, 4.6, 0, 0, 4.8], [3.6, 7.2, 5.7, 0, 0, 5], [7, 7.5, 6, 0, 0, 5.3],
                               [9.6, 7.9, 5.9, 0, 0, 5.6], [13, 8.3, 5.9, 0, 0, 5.7], [15.8, 7.8, 5.2, 0, 0, 5.3],
                               [17.4, 6, 4.2, 0, 0.3, 4.6], [18.3, 4.2, 3.4, 0, 0.3, 3.8]],
      { square: 2.7, smooth: 2, bumps: [{ u: 0.5, y: 11, su: 0.13, sy: 4.5, h: 0.45 }, { u: 0, y: 11, su: 0.13, sy: 4.5, h: 0.4 }] });
    for (const x of [-5.3, 5.3]) kit(this.torso, vest, [3.2, 1.2, 6.4], [x, 17.5, 0.3], [0, 0, x < 0 ? 0.25 : -0.25]); // shoulder pads
    // Three rifle magazines across the stomach, each under its own flap.
    for (const x of [-3.2, 0, 3.2]) {
      kit(this.torso, pouch, [2.7, 5.2, 1.8], [x, 6.2, -6.9 + Math.abs(x) * 0.13]);
      kit(this.torso, pouch, [2.85, 1.7, 2], [x, 8.3, -6.95 + Math.abs(x) * 0.13]);
      kit(this.torso, gear, [0.7, 0.7, 0.3], [x, 7.8, -8 + Math.abs(x) * 0.13]);
    }
    kit(this.torso, pouch, [4.4, 2.5, 1], [2.5, 13.6, -6.2]); // admin pouch
    kit(this.torso, pouch, [2, 4.4, 1.7], [-5.2, 13.2, -5.5], [0, 0.35, 0]); // radio
    wrapped(this.torso, gear, [[15.2, 0.2, 0.2, -5.6, -5.4], [20.5, 0.12, 0.12, -5.6, -5.4]], {}, 5);
    kit(this.torso, pouch, [1.9, 3.6, 3.3], [-8.2, 6.8, 0]); // utility, left side
    kit(this.torso, pouch, [1.8, 2.8, 2.5], [8.2, 6.6, -0.6]); // grenade, right side
    kit(this.torso, pouch, [9.4, 10.5, 2.3], [0, 10.6, 6.5], [0, 0, 0], 4); // pack
    kit(this.torso, gear, [3.4, 0.7, 0.9], [0, 16.4, 6.4]); // drag handle

    // The head: jaw narrower than the cheekbones, the skull carried behind the
    // ears, and the features pressed in — brow over hollow sockets, the nose,
    // cheekbones, lips and chin.
    this.torso.add(this.head);
    this.head.position.y = 21;
    this.head.scale.setScalar(1.05);
    wrapped(this.head, face, [[0.2, 1.7, 1.9, 0, -0.5, 1.5], [0.9, 2.3, 3.2, 0, 0, 2.3], [2, 2.85, 3.65, 0, 0, 3],
                              [3.4, 3.1, 3.75, 0, 0, 3.7], [5, 3.15, 3.7, 0, 0, 4.1], [6.6, 3.15, 3.85, 0, 0, 4.2],
                              [8, 2.9, 3.5, 0, 0, 4], [9.1, 2.1, 2.5, 0, 0.2, 3.1], [9.8, 0.9, 1, 0, 0.4, 1.6]],
      { smooth: 2, bumps: FACE }, 28);
    const lens = this.lens;
    const ears = () => { for (const x of [-3.2, 3.2]) meshPart(this.head, ball(0.28, 0.85, 0.55), mat("skin"), [x, 4.7, 0.55], [0, 0, x < 0 ? 0.12 : -0.12]); };
    if (team === "ct" && look === 0) {
      // Fabric-covered helmet, flared at the rim, with goggles pushed up.
      const helmet = mat("helmet");
      wrapped(this.head, helmet, [[5.7, 3.75, 4.5, 0, 0, 4.9], [6.3, 3.75, 4.5, 0, 0, 4.9], [7.4, 3.75, 4.5, 0, 0, 4.85],
                                  [8.7, 3.45, 4.1, 0, 0, 4.55], [9.8, 2.6, 3.1, 0, 0.2, 3.6], [10.5, 1.2, 1.4, 0, 0.3, 1.9]],
        { smooth: 2 }, 20);
      wrapped(this.head, gear, [[7.5, 3.86, 4.62, 0, 0, 4.97], [8, 3.84, 4.58, 0, 0, 4.95], [8.5, 3.66, 4.36, 0, 0, 4.8]], {}, 20);
      kit(this.head, gear, [5.8, 2, 1.3], [0, 8, -4.45], [-0.12, 0, 0], 4);
      kit(this.head, lens, [5, 1.3, 0.5], [0, 8, -5.05], [-0.12, 0, 0], 4);
      for (const x of [-3.45, 3.45]) {
        lump(this.head, gear, [0.75, 1.5, 1.4], [x, 4.6, 0.5]); // ear cups
        kit(this.head, gear, [0.22, 4.6, 0.8], [x * 0.93, 3.4, -1.5], [0.5, 0, x < 0 ? -0.16 : 0.16]); // chin strap
      }
      kit(this.head, gear, [2.4, 0.9, 1.1], [0, 0.9, -3.3]); // chin cup
    } else if (team === "ct") {
      // Iconic CS 1.6 SAS / urban operator: ballistic helmet + dual-lens respirator gas mask.
      const cap = mat("helmet");
      wrapped(this.head, cap, [[6.0, 3.65, 4.35, 0, 0, 4.75], [7.2, 3.6, 4.3, 0, 0, 4.7],
                               [8.6, 3.25, 3.9, 0, 0, 4.35], [9.8, 2.4, 2.85, 0, 0.2, 3.35],
                               [10.4, 1.1, 1.3, 0, 0.3, 1.85]], { smooth: 2 }, 20);
      const gasmask = cloneHeadgearGlb("ct_gasmask");
      if (gasmask) {
        this.head.add(gasmask);
      } else {
        kit(this.head, lens, [5.4, 1.2, 0.45], [0, 5.15, -3.75], [0, 0, 0], 6);
        lump(this.head, gear, [0.65, 1.4, 1.3], [-3.4, 4.6, 0.5]);
      }
    } else if (look === 0) {
      ears();
      // Knitted cap, rolled at the brim; the scarf is pulled up over the nose.
      wrapped(this.head, gear, [[6.6, 3.3, 4.05, 0, 0, 4.35], [8.1, 3.1, 3.7, 0, 0, 4.2], [9.3, 2.3, 2.7, 0, 0.2, 3.3],
                                [10.1, 1, 1.1, 0, 0.4, 1.8]], { smooth: 2 }, 20);
      wrapped(this.head, pouch, [[6.2, 3.4, 4.15, 0, 0, 4.45], [6.9, 3.5, 4.25, 0, 0, 4.55], [7.6, 3.35, 4.1, 0, 0, 4.4]], {}, 20);
      wrapped(this.head, mat("scarf"), [[-1.6, 3.2, 3.3, 0, 0, 3.3], [-0.2, 3.4, 3.9, 0, 0, 3.3], [1.6, 3.2, 4.25, 0, 0, 3.3],
                                        [3, 3.3, 4.6, 0, 0, 3.9], [3.8, 3.2, 4.35, 0, 0, 3.9]], { smooth: 2 }, 20);
    } else {
      ears();
      // Bare-headed behind dark glasses, the scarf loose at the throat.
      kit(this.head, lens, [5.6, 1.5, 0.5], [0, 5.1, -3.8], [0, 0, 0], 4);
      for (const x of [-3.1, 3.1]) kit(this.head, gear, [0.2, 0.3, 3.6], [x, 5.2, -2]);
      wrapped(this.head, mat("scarf"), [[-2.2, 3, 3.2, 0, 0.2, 3.1], [-1.2, 3.5, 3.9, 0, 0.1, 3.4], [-0.3, 3.3, 3.7, 0, 0.1, 3.3],
                                        [0.3, 2.7, 3, 0, 0.2, 2.9]], { smooth: 2 }, 20);
    }

    this.torso.add(this.weaponSlot);
    this.hips.rotation.order = "YXZ";
    this.head.rotation.order = "YXZ";
    this.flash = new THREE.Sprite(muzzleFlashMaterial());
    this.flash.scale.setScalar(13);
    this.flash.visible = false;
    this.weaponSlot.add(this.flash);
    const limbs: Array<[THREE.Group, THREE.Group, THREE.BufferGeometry, number, THREE.Material]> = [];
    const sleeves = mat("arms"), trousers = mat("legs");
    for (const side of [-1, 1]) {
      const upper = new THREE.Group(), lower = new THREE.Group();
      // Glove: a gauntlet over the cuff and a closed fist with the thumb across it.
      wrapped(lower, hand, [[-FOREARM - 0.7, 1.35, 1.15], [-FOREARM + 0.5, 1.7, 1.5], [-FOREARM + 1.7, 1.65, 1.5]]);
      kit(lower, hand, [2.3, 3, 2.7], [0, -FOREARM - 1.8, 0], [0, 0, 0], 3);
      kit(lower, hand, [0.9, 1.9, 1], [0, -FOREARM - 1.7, -1.5], [0.35, 0, 0], 3);
      this.torso.add(upper, lower);
      this.shoulders.push(upper); this.elbows.push(lower);
      // One sleeve from the cap of the deltoid to the wrist, authored hanging
      // straight down and skinned across the elbow, so the joint bends
      // instead of hinging. The left arm mirrors the sheet so its pocket
      // still faces out.
      const U = UPPER_ARM;
      limbs.push([upper, lower, loft(
        [[-U - FOREARM, 1.45, 1.3], [-U - 7, 1.9, 1.8], [-U - 3, 2.15, 2.05], [-U - 1.2, 2.05, 2], [-U, 1.95, 2],
         [-U + 1.5, 2, 2], [-U + 4, 2.2, 2.3], [-4, 2.5, 2.55], [-1.2, 2.75, 2.8], [0.8, 2.5, 2.6],
         [2, 1.5, 1.6], [2.5, 0.3, 0.3]],
        SIDES, { smooth: 1, mirrorU: side < 0, bumps: [
          { u: 0.5, y: -6.5, su: 0.1, sy: 2.6, h: 0.3 }, { u: 0, y: -U, su: 0.09, sy: 1, h: 0.3 },
          { u: 0.5, y: -U - 3.5, su: 0.12, sy: 2, h: 0.2 }] }), -U, sleeves]);

      const hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(side * 3.6, 0, 0);
      knee.position.y = -THIGH;
      if (side > 0) {
        // Drop-leg holster strapped to the right thigh, the pistol's grip clear of it.
        kit(hip, gear, [1.5, 5.6, 3.2], [3.9, -6.6, 0.3], [0, 0, 0], 4);
        kit(hip, gear, [1.1, 2.4, 1.5], [4, -3.3, 1.5], [-0.35, 0, 0]);
        for (const y of [-5.6, -8.4]) {
          wrapped(hip, gear, [[y - 0.45, 3.5, 3.65, 0, 0, 3.8], [y + 0.45, 3.6, 3.75, 0, 0, 3.9]]);
        }
        kit(hip, gear, [0.5, 5.4, 1.1], [3.5, -2, 0.3]);
      }
      // Hard knee pad on its strap.
      kit(knee, gear, [3.7, 4.3, 1.5], [0, -0.5, -2.35], [0, 0, 0], 3);
      wrapped(knee, gear, [[-1.3, 2.6, 2.6, 0, 0, 2.8], [-0.4, 2.6, 2.6, 0, 0, 2.8]]);
      // Boot: lugged sole, then the upper laced to a padded collar.
      wrapped(knee, boot, [[-19, 2.15, 5.45, 0, -2.1], [-18.2, 2.3, 5.55, 0, -2.1], [-17.4, 2.2, 5.3, 0, -2.05],
                           [-16.4, 2.15, 4.4, 0, -1.4], [-15.2, 2.1, 3.1, 0, -0.4], [-13, 2.15, 2.5],
                           [-10.4, 2.4, 2.6], [-9.4, 2.5, 2.7], [-9, 2.2, 2.4]], { smooth: 1 });
      hip.add(knee); this.hips.add(hip);
      this.legs.push(hip); this.knees.push(knee);
      // Trouser leg, hip to boot top: mass at the back of thigh and calf, a
      // straight shin, the kneecap, and the cloth bloused above the boot.
      const T = THIGH;
      limbs.push([hip, knee, loft(
        [[-T - SHIN + 3, 1.9, 1.9], [-T - 11.6, 2.5, 2.4, 0, 0, 2.8], [-T - 9.5, 2.2, 2.05, 0, 0, 2.8],
         [-T - 5.5, 2.4, 2.2, 0, 0, 3], [-T - 1.5, 2.35, 2.4, 0, 0, 2.5], [-T, 2.4, 2.5], [-T + 1.5, 2.4, 2.45],
         [-T + 4.5, 2.75, 2.9], [-7, 3.3, 3.5, 0, 0, 3.6], [-2, 3.6, 3.7, 0, 0, 3.9], [0.5, 3.5, 3.6, 0, 0, 3.8],
         [2.2, 2.4, 2.6], [2.8, 0.4, 0.4]],
        SIDES, { smooth: 1, mirrorU: side < 0, bumps: [{ u: 0.5, y: -T, su: 0.09, sy: 1.3, h: 0.35 }] }),
        -T, trousers]);
    }
    batchParts(this.pivot);
    // Skinned after batching, which would otherwise merge them into rigid parts.
    for (const [parent, child, geometry, joint, material] of limbs) {
      const mesh = new THREE.SkinnedMesh(skinAcross(geometry, joint), material);
      // The bones are this rig's own joint groups; a Skeleton only reads their matrices.
      const skeleton = new THREE.Skeleton([parent, child] as unknown as THREE.Bone[],
        [new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(0, -joint, 0)]);
      mesh.bind(skeleton, new THREE.Matrix4());
      mesh.frustumCulled = false; // posed far from its bind box; the body is tiny anyway
      this.pivot.add(mesh);
      this.skeletons.push(skeleton);
    }
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

  private readonly boneX = new THREE.Vector3();
  private readonly boneZ = new THREE.Vector3();
  private readonly boneMat = new THREE.Matrix4();

  private aimBone(bone: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, length: number,
                  ref: THREE.Vector3): void {
    bone.position.copy(from);
    this.direction.copy(to).sub(from);
    const len = this.direction.length();
    bone.scale.y = len / length;
    if (len < 1e-5) return;
    // Construct a twist-free orthonormal basis with -Y along the bone and +Z
    // facing the elbow pole so sleeve details never spin unpredictably.
    const yAxis = this.direction.multiplyScalar(-1 / len);
    this.boneX.crossVectors(yAxis, ref);
    if (this.boneX.lengthSq() < 1e-5) this.boneX.set(1, 0, 0);
    else this.boneX.normalize();
    this.boneZ.crossVectors(this.boneX, yAxis).normalize();
    bone.quaternion.setFromRotationMatrix(this.boneMat.makeBasis(this.boneX, yAxis, this.boneZ));
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
    this.aimBone(this.shoulders[i]!, shoulder.clone(), this.elbow, UPPER_ARM, this.pole);
    this.aimBone(this.elbows[i]!, this.elbow, this.wrist, FOREARM + 1.6, this.pole);
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
    this.lens.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    // Cached team textures and weapon materials outlive a roster rebuild.
  }
}
