import * as THREE from "three";
import { canvasTexture, fill, grain, stains } from "./textures";
import { batchParts, bevelBox, meshPart, type V3 } from "./geometry";

// Original procedural models. Barrel points -Z, +Y up, origin at the grip.
// GoldSrc inches; silhouettes and finish do the work, not high polygon counts.
export const WeaponId = {
  none: 0, knife: 1, usp: 2, glock: 3, ak47: 4, m4a1: 5, awp: 6, mp5: 7,
} as const;

function surface(base: string, seed: number, kind: "metal" | "polymer" | "wood" | "cloth") {
  return canvasTexture(128, seed, (c) => {
    fill(c, base);
    grain(c, kind === "wood" ? 25 : 14, 1);
    stains(c, 9, "#121519", 22);
    for (let i = 0; i < 128; ++i) {
      const x = Math.floor(c.random() * 128), y = Math.floor(c.random() * 128);
      if (kind === "wood") {
        c.ctx.strokeStyle = i % 2 ? "#4e2c17" : "#b17c43";
        c.ctx.globalAlpha = 0.24;
        c.ctx.beginPath();
        c.ctx.moveTo(x, 0);
        c.ctx.bezierCurveTo(x + 14, 42, x - 12, 80, x + 3, 128);
        c.ctx.stroke();
      } else {
        c.ctx.fillStyle = i % 2 ? "rgba(195,204,207,0.18)" : "rgba(0,0,0,0.22)";
        c.ctx.fillRect(x, y, kind === "metal" ? 2 + c.random() * 12 : 1, 1);
      }
    }
    c.ctx.globalAlpha = 1;
    if (kind === "cloth" || kind === "polymer") {
      c.ctx.fillStyle = kind === "cloth" ? "rgba(0,0,0,0.05)" : "rgba(0,0,0,0.12)";
      for (let i = 0; i < 128; i += 4) {
        c.ctx.fillRect(i, 0, 1, 128);
        c.ctx.fillRect(0, i, 128, 1);
      }
    }
  });
}

let materials: Record<MatKey, THREE.MeshPhongMaterial> | undefined;
type MatKey = "metal" | "edge" | "dark" | "polymer" | "wood" | "olive" | "glass" | "sleeve" | "glove";
function mats(): Record<MatKey, THREE.MeshPhongMaterial> {
  if (!materials) {
    const metal = surface("#59616a", 5150, "metal");
    const polymer = surface("#34383b", 7, "polymer");
    materials = {
      metal: new THREE.MeshPhongMaterial({ map: metal, shininess: 32, specular: 0x68717a }),
      edge: new THREE.MeshPhongMaterial({ map: surface("#9aa6ad", 5151, "metal"), shininess: 48 }),
      dark: new THREE.MeshPhongMaterial({ color: 0x151a1e, shininess: 8 }),
      polymer: new THREE.MeshPhongMaterial({ map: polymer, shininess: 7 }),
      wood: new THREE.MeshPhongMaterial({ map: surface("#8c552c", 99, "wood"), shininess: 16 }),
      olive: new THREE.MeshPhongMaterial({ map: surface("#65704a", 123, "polymer"), shininess: 5 }),
      glass: new THREE.MeshPhongMaterial({ color: 0x477b8c, emissive: 0x0b2029, shininess: 90 }),
      sleeve: new THREE.MeshPhongMaterial({ map: surface("#687887", 411, "cloth"), shininess: 3 }),
      glove: new THREE.MeshPhongMaterial({ map: surface("#454342", 413, "polymer"), shininess: 5 }),
    };
  }
  return materials;
}

function part(g: THREE.Group, mat: MatKey, size: V3, at: V3, rotX = 0): void {
  meshPart(g, bevelBox(...size), mats()[mat], at, [rotX, 0, 0]);
}

function joint(g: THREE.Group, name: string, at: V3): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...at);
  g.add(group);
  return group;
}

/** Faceted cylinder along the barrel axis; caps remain solid except the dark bore. */
function tube(g: THREE.Group, mat: MatKey, radius: number, length: number, at: V3,
              frontRadius = radius): void {
  meshPart(g, new THREE.CylinderGeometry(radius, frontRadius, length, 10),
    mats()[mat], at, [Math.PI / 2, 0, 0]);
}

function muzzle(g: THREE.Group, radius: number, y: number, z: number): void {
  tube(g, "edge", radius, 0.25, [0, y, z + 0.125]);
  tube(g, "dark", radius * 0.65, 0.02, [0, y, z - 0.015]);
}

function guard(g: THREE.Group): void {
  part(g, "metal", [0.5, 2, 0.5], [0, -1.5, -2.2]);
  part(g, "metal", [0.5, 0.45, 3.5], [0, -2.4, -0.7]);
  part(g, "dark", [0.4, 1.3, 0.5], [0, -1.2, -0.8], -0.25);
}

function grip(g: THREE.Group, mat: MatKey = "polymer"): void {
  part(g, mat, [2.2, 5.5, 2.8], [0, -3.2, 1.2], 0.22);
  part(g, "dark", [2.3, 0.5, 3], [0, -5.8, 1.8], 0.22);
  guard(g);
}

function sights(g: THREE.Group, front: number, rear: number, y = 3.5): void {
  part(g, "metal", [1.8, 0.3, 1.2], [0, y - 0.45, rear]);
  for (const x of [-0.65, 0.65]) {
    part(g, "metal", [0.28, 1.3, 0.7], [x, y, front]);
    part(g, "metal", [0.4, 0.65, 0.9], [x, y, rear]);
  }
  part(g, "edge", [0.2, 0.9, 0.25], [0, y - 0.3, front]);
}

function receiverDetails(g: THREE.Group, z: number, chargingHandle = true): void {
  part(g, "dark", [0.08, 1, 3.8], [1.31, 1.4, z]); // ejection port
  if (chargingHandle) {
    part(joint(g, "action", [1.6, 1.1, z + 1.6]), "edge", [0.7, 0.35, 1.1], [0, 0, 0]);
  }
  for (const x of [-1.32, 1.32]) {
    for (const offset of [-2, 2]) part(g, "edge", [0.1, 0.3, 0.3], [x, 0, z + offset]);
    part(g, "dark", [0.1, 0.28, 2.5], [x, -0.2, z + 3.5]);
  }
}

/** Continuous bent magazine, with ribs following the same three sections. */
function magazine(g: THREE.Group, z: number, width: number, depth: number, bend: number): void {
  const mag = joint(g, "magazine", [0, -0.5, z]);
  let y = 0, front = 0;
  for (let i = 0; i < 3; ++i) {
    const angle = -bend * (i + 0.3), length = 2.3;
    const cy = y - Math.cos(angle) * length / 2;
    const cz = front - Math.sin(angle) * length / 2;
    part(mag, "metal", [width, length + 0.18, depth], [0, cy, cz], angle);
    for (const side of [-1, 1]) {
      for (const rib of [-0.7, 0.7]) {
        part(mag, "dark", [0.07, length * 0.85, 0.17], [side * (width / 2 + 0.03), cy, cz + rib], angle);
      }
    }
    y -= Math.cos(angle) * length;
    front -= Math.sin(angle) * length;
  }
  part(mag, "polymer", [width + 0.18, 0.45, depth + 0.2], [0, y, front], -bend * 2.3);
}

function ak47(): THREE.Group {
  const g = new THREE.Group();
  part(g, "metal", [2.6, 2.8, 13], [0, 0.7, -2]);
  tube(g, "metal", 1.25, 10, [0, 1.9, -2]); // rounded dust cover
  tube(g, "metal", 0.46, 14, [0, 1.6, -15.5]);
  part(g, "wood", [2.8, 2, 6.5], [0, 0.65, -11.2]);
  part(g, "wood", [2.3, 1.2, 5.5], [0, 2.3, -11.5]);
  for (const z of [-8.2, -14.1]) part(g, "metal", [2.9, 2.8, 0.55], [0, 1.2, z]);
  tube(g, "metal", 0.55, 4.5, [0, 2.65, -16]);
  part(g, "metal", [1.25, 2.3, 1], [0, 2, -18.1]);
  part(g, "wood", [2.7, 4.1, 8], [0, -0.25, 8], 0.12);
  part(g, "dark", [2.8, 4.2, 0.6], [0, -0.7, 12]);
  magazine(g, -3, 1.85, 3.3, 0.22);
  part(g, "metal", [1.1, 2, 0.9], [0, 2.6, -21]);
  sights(g, -21, -5, 3.8);
  receiverDetails(g, -2.5);
  grip(g, "wood");
  muzzle(g, 0.65, 1.6, -22.5);
  return g;
}

function m4a1(): THREE.Group {
  const g = new THREE.Group();
  part(g, "metal", [2.6, 3, 12], [0, 0.8, -1.5]);
  tube(g, "metal", 0.45, 14, [0, 1.4, -15]);
  tube(g, "polymer", 1.6, 8, [0, 1.1, -10.7], 1.25);
  for (let z = -14; z < -7; z += 0.85) tube(g, "dark", 1.63 - (-7 - z) * 0.045, 0.18, [0, 1.1, z]);
  tube(g, "metal", 0.8, 4, [0, 1.4, -23]);
  tube(g, "metal", 0.8, 8, [0, 1, 7.5]);
  part(g, "polymer", [2.5, 3.8, 5.5], [0, -0.2, 9.5]);
  part(g, "dark", [2.7, 4.5, 0.7], [0, -0.4, 12.1]);
  // Open carry handle and front sight tower.
  part(g, "metal", [1.55, 0.65, 8], [0, 4.3, -2.4]);
  for (const z of [-5.7, 0.8]) part(g, "metal", [1.3, 1.3, 0.8], [0, 3.4, z]);
  part(g, "metal", [0.7, 2.4, 0.7], [0, 2.8, -19.6], 0.2);
  magazine(g, -2.6, 1.8, 3, 0.08);
  sights(g, -19.6, 0.6, 4.5);
  receiverDetails(g, -2);
  grip(g);
  muzzle(g, 0.8, 1.4, -25);
  return g;
}

function awp(): THREE.Group {
  const g = new THREE.Group();
  part(g, "olive", [3, 2.8, 19], [0, -0.1, -2.6]);
  tube(g, "metal", 0.85, 10, [0, 1.4, -2.5]);
  tube(g, "metal", 0.62, 20, [0, 1.4, -19]);
  part(g, "olive", [3.2, 2.3, 10], [0, 0.4, 9]);
  part(g, "olive", [2.8, 1.2, 8], [0, -3.2, 10]); // thumbhole frame
  part(g, "olive", [3, 4.2, 1.4], [0, -1.2, 14]);
  part(g, "dark", [3.2, 4.5, 0.65], [0, -1.2, 15]);
  part(g, "polymer", [3, 0.9, 5], [0, 1.8, 10]);
  part(joint(g, "magazine", [0, -2.3, -2.4]), "metal", [2, 2.4, 3.6], [0, 0, 0]);
  for (const z of [-7.5, -2.2]) {
    part(g, "metal", [1.5, 1.3, 1], [0, 2.5, z]);
    tube(g, "edge", 1.06, 0.65, [0, 3.6, z]);
  }
  tube(g, "metal", 0.85, 10, [0, 3.6, -5]);
  tube(g, "metal", 1.2, 3.2, [0, 3.6, -11], 1.65);
  tube(g, "glass", 1.4, 0.04, [0, 3.6, -12.62]);
  tube(g, "metal", 1.2, 2.6, [0, 3.6, 0.8]);
  tube(g, "glass", 1.05, 0.04, [0, 3.6, 2.12]);
  part(g, "metal", [1.5, 1.2, 1.5], [0, 4.9, -4.8]);
  const bolt = joint(g, "action", [1.5, 1.6, 1.8]);
  part(bolt, "edge", [2.1, 0.5, 0.5], [0, 0, 0]);
  meshPart(bolt, new THREE.IcosahedronGeometry(0.65, 0), mats().polymer, [1, -0.3, 0]);
  for (const x of [-0.9, 0.9]) part(g, "metal", [0.45, 0.55, 6], [x, -1.6, -12]);
  grip(g, "olive");
  muzzle(g, 0.7, 1.4, -29);
  return g;
}

function mp5(): THREE.Group {
  const g = new THREE.Group();
  part(g, "metal", [2.6, 2.6, 10], [0, 0.8, -2]);
  tube(g, "metal", 1.1, 10, [0, 1.4, -2]);
  tube(g, "metal", 0.6, 7, [0, 1.4, -10]);
  part(g, "polymer", [2.8, 2.5, 5.5], [0, 0.4, -8.5]);
  tube(g, "metal", 0.45, 7, [0, 2.5, -8]);
  part(joint(g, "action", [-0.9, 2.6, -9.4]), "edge", [1.4, 0.45, 0.6], [0, 0, 0]);
  for (const x of [-1, 1]) part(g, "metal", [0.3, 0.55, 8], [x, 0.9, 6]);
  part(g, "polymer", [2.3, 4, 1], [0, -0.2, 10]);
  magazine(g, -2.8, 1.6, 2.5, 0.12);
  meshPart(g, new THREE.TorusGeometry(0.9, 0.2, 4, 10), mats().metal, [0, 3.1, -12.2]);
  part(g, "edge", [0.18, 0.75, 0.2], [0, 2.8, -12.2]);
  tube(g, "metal", 0.6, 0.9, [0, 3, 1]);
  receiverDetails(g, -2, false);
  grip(g);
  muzzle(g, 0.67, 1.4, -13.5);
  return g;
}

function pistol(suppressed: boolean): THREE.Group {
  const g = new THREE.Group();
  const slide = joint(g, "action", [0, 0, 0]);
  const length = suppressed ? 9 : 8;
  part(slide, "metal", [1.9, 2, length], [0, 1.4, -2.2]);
  part(g, "polymer", [1.85, 1.3, 6.2], [0, -0.15, -1]);
  part(g, "polymer", [2, 5.6, 2.6], [0, -3.1, 1.3], 0.18);
  const mag = joint(g, "magazine", [0, -1, 1.3]);
  part(mag, "metal", [1.5, 4.7, 2.1], [0, -2.3, 0.2], 0.18);
  part(mag, "dark", [2.2, 0.5, 2.9], [0, -4.8, 0.5]);
  guard(g);
  for (const side of [-1, 1]) {
    for (let z = -0.1; z < 1.5; z += 0.35) part(slide, "dark", [0.05, 1.4, 0.12], [side * 0.97, 1.3, z]);
    part(g, "edge", [0.15, 0.3, 1], [side, 0.1, 0.2]);
  }
  part(slide, "dark", [1.1, 0.08, 1.8], [0.2, 2.42, -1.9]);
  part(slide, "dark", [0.3, 0.4, 0.6], [0, 2.6, -5.3]);
  for (const x of [-0.6, 0.6]) {
    part(slide, "dark", [0.45, 0.4, 0.6], [x, 2.6, 1.4]);
    part(slide, "edge", [0.15, 0.15, 0.05], [x, 2.65, 1.72]);
  }
  if (suppressed) tube(g, "metal", 0.8, 6, [0, 1.4, -8.5]);
  else tube(g, "metal", 0.52, 0.4, [0, 1.4, -6.3]);
  muzzle(g, suppressed ? 0.8 : 0.5, 1.4, suppressed ? -11.5 : -6.5);
  return g;
}

function knife(): THREE.Group {
  const g = new THREE.Group();
  part(g, "polymer", [1.65, 1.9, 5], [0, 0, 1.5]);
  for (let z = -0.5; z < 4; z += 0.7) part(g, "dark", [1.75, 2, 0.2], [0, 0, z]);
  part(g, "metal", [1.2, 3.6, 0.5], [0, 0, -1.3]);
  const shape = new THREE.Shape();
  shape.moveTo(-1.2, 0);
  shape.lineTo(-1.1, 5.8);
  shape.lineTo(0.2, 9);
  shape.lineTo(1.15, 6.8);
  shape.lineTo(1.15, 0);
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16, bevelSize: 0.16, bevelThickness: 0.12, bevelSegments: 1, steps: 1,
  });
  blade.rotateX(-Math.PI / 2);
  blade.rotateZ(Math.PI / 2);
  meshPart(g, blade, mats().edge, [0, 0, -1.5]);
  return g;
}

export function buildWeapon(id: number): THREE.Group {
  let g: THREE.Group;
  switch (id) {
    case WeaponId.ak47: g = ak47(); break;
    case WeaponId.m4a1: g = m4a1(); break;
    case WeaponId.awp: g = awp(); break;
    case WeaponId.mp5: g = mp5(); break;
    case WeaponId.usp: g = pistol(true); break;
    case WeaponId.glock: g = pistol(false); break;
    case WeaponId.knife: g = knife(); break;
    default: return new THREE.Group();
  }
  batchParts(g);
  return g;
}

export function muzzleOffset(id: number): V3 {
  switch (id) {
    case WeaponId.ak47: return [0, 1.6, -22.5];
    case WeaponId.m4a1: return [0, 1.4, -25];
    case WeaponId.awp: return [0, 1.4, -29];
    case WeaponId.mp5: return [0, 1.4, -13.5];
    case WeaponId.usp: return [0, 1.4, -11.5];
    case WeaponId.glock: return [0, 1.4, -6.5];
    case WeaponId.knife: return [0, 0.4, -10.5];
    default: return [0, 1.4, -20];
  }
}

/** Shared grip locations for first-person hands and the character's aiming pose. */
export function supportGrip(id: number): V3 {
  if (id === WeaponId.usp || id === WeaponId.glock) return [-1.1, -3.2, 0.8];
  return [-0.8, -0.8, id === WeaponId.mp5 ? -8 : -10.5];
}

function forearm(g: THREE.Group, from: V3, to: V3): void {
  const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
  const sleeve = meshPart(g, new THREE.CylinderGeometry(1.6, 2.65, start.distanceTo(end), 8),
    mats().sleeve, start.clone().add(end).multiplyScalar(0.5).toArray() as V3);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  part(g, "glove", [3.3, 2.3, 2.5], to);
  part(g, "dark", [3.4, 0.5, 2.6], [to[0], to[1] - 0.5, to[2] + 0.6]); // cuff
}

/** Sleeves taper into separate palms, curled fingers, thumb and knuckle pads. */
export function buildArms(id: number): THREE.Group {
  const g = new THREE.Group();
  if (id === WeaponId.none) return g;
  forearm(g, [7, -9, 18], [1.6, -3.5, 2.4]);
  part(g, "glove", [2, 3.5, 2.7], [1.25, -2.8, 0.9], 0.2);
  for (let i = 0; i < 3; ++i) {
    part(g, "glove", [2.3, 0.7, 1], [0.1, -2.3 - i * 0.8, -0.35]);
    part(g, "polymer", [0.8, 0.5, 1.6], [2.05, -2.1 - i * 0.8, 1]);
  }
  part(g, "glove", [0.85, 0.8, 2.1], [1.1, -1.2, -0.8]); // trigger finger
  part(g, "glove", [0.8, 2, 1.1], [-1, -1.9, 1.3], -0.4);
  if (id === WeaponId.knife) {
    for (const child of g.children) child.position.y += 2;
  }
  if (id !== WeaponId.knife) {
    const at = supportGrip(id);
    const sleeve = joint(g, "support_sleeve", [0, 0, 0]);
    meshPart(sleeve, new THREE.CylinderGeometry(1.6, 2.65, 1, 8), mats().sleeve, [0, 0, 0]);
    const hand = joint(g, "support_hand", at);
    part(hand, "glove", [3.3, 2.3, 2.5], [-1, -1.8, 1.4]);
    part(hand, "dark", [3.4, 0.5, 2.6], [-1, -2.3, 2]);
    part(hand, "glove", [3.5, 1.6, 3.5], [0, -1, 0]);
    for (let i = 0; i < 4; ++i) {
      part(hand, "glove", [0.8, 2.2, 0.7], [-1.2, 0, -1.2 + i * 0.8], 0.16);
      part(hand, "polymer", [0.85, 0.7, 0.6], [-1.55, 0, -1.2 + i * 0.8]);
    }
    part(hand, "glove", [0.8, 2, 1.2], [1.7, 0, 0.5], -0.4);
    poseSupportSleeve(sleeve, hand);
  }
  batchParts(g);
  return g;
}

const elbow = new THREE.Vector3(-8, -10, 12);
const wrist = new THREE.Vector3();
const sleeveDirection = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Keep the sleeve attached to the wrist as the support hand reaches/reloads. */
export function poseSupportSleeve(sleeve: THREE.Object3D, hand: THREE.Object3D): void {
  wrist.set(-1, -1.8, 1.4).applyQuaternion(hand.quaternion).add(hand.position);
  sleeve.position.copy(elbow).add(wrist).multiplyScalar(0.5);
  sleeveDirection.copy(wrist).sub(elbow);
  sleeve.scale.y = sleeveDirection.length();
  sleeve.quaternion.setFromUnitVectors(up, sleeveDirection.normalize());
}
