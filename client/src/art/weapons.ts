import * as THREE from "three";
import { canvasTexture, cloud, fill, grain, stains } from "./textures";
import { ball, batchParts, bevelBox, capsule, loft, meshPart, profile, type V3 } from "./geometry";

// Original procedural models. Barrel points -Z, +Y up, origin at the grip.
// GoldSrc inches; silhouettes and finish do the work, not high polygon counts.
export const WeaponId = {
  none: 0, knife: 1, usp: 2, glock: 3, ak47: 4, m4a1: 5, awp: 6, mp5: 7,
} as const;

function surface(base: string, seed: number, kind: "metal" | "polymer" | "wood" | "cloth") {
  return canvasTexture(128, seed, (c) => {
    fill(c, base);
    cloud(c, kind === "wood" ? 22 : 12, 48, 4);
    grain(c, 6, 1);
    stains(c, 7, "#121519", 22);
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
        if (i % 3) continue; // a few scuffs, not a hatch
        c.ctx.fillStyle = i % 2 ? "rgba(195,204,207,0.1)" : "rgba(0,0,0,0.14)";
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
type MatKey = "metal" | "steel" | "edge" | "dark" | "polymer" | "wood" | "olive" | "glass"
  | "sleeve" | "glove" | "skin";
function mats(): Record<MatKey, THREE.MeshPhongMaterial> {
  if (!materials) {
    materials = {
      // Parkerized receiver steel, and the darker blued steel of magazines and slides.
      metal: new THREE.MeshPhongMaterial({ map: surface("#474d53", 5150, "metal"), shininess: 34, specular: 0x59616a }),
      steel: new THREE.MeshPhongMaterial({ map: surface("#2b2f33", 5152, "metal"), shininess: 40, specular: 0x4c545c }),
      edge: new THREE.MeshPhongMaterial({ map: surface("#8d979d", 5151, "metal"), shininess: 48 }),
      dark: new THREE.MeshPhongMaterial({ color: 0x101316, shininess: 8 }),
      polymer: new THREE.MeshPhongMaterial({ map: surface("#26292b", 7, "polymer"), shininess: 12, specular: 0x2a2d30 }),
      wood: new THREE.MeshPhongMaterial({ map: surface("#8a4f26", 99, "wood"), shininess: 22, specular: 0x3a2a1c }),
      olive: new THREE.MeshPhongMaterial({ map: surface("#4f5a3a", 123, "polymer"), shininess: 6, specular: 0x202418 }),
      glass: new THREE.MeshPhongMaterial({ color: 0x35606e, emissive: 0x0b2029, shininess: 90 }),
      sleeve: new THREE.MeshPhongMaterial({ map: surface("#4f5d6b", 411, "cloth"), shininess: 2, specular: 0x111111 }),
      glove: new THREE.MeshPhongMaterial({ map: surface("#4b4a41", 413, "cloth"), shininess: 6, specular: 0x1c1c1c }),
      skin: new THREE.MeshPhongMaterial({ map: surface("#b98a68", 415, "cloth"), shininess: 4, specular: 0x221a14 }),
    };
  }
  return materials;
}

let flash: THREE.CanvasTexture | undefined;
/**
 * The era's muzzle flash: an additive star, a new rotation every shot. Each
 * caller gets its own material so one gun's rotation is not another's.
 */
export function muzzleFlashMaterial(): THREE.SpriteMaterial {
  flash ??= canvasTexture(64, 77, (c) => {
    const x = c.ctx;
    x.clearRect(0, 0, 64, 64);
    const core = x.createRadialGradient(32, 32, 1, 32, 32, 30);
    core.addColorStop(0, "rgba(255,250,225,1)");
    core.addColorStop(0.25, "rgba(255,205,110,0.85)");
    core.addColorStop(1, "rgba(255,130,30,0)");
    x.fillStyle = core;
    x.fillRect(0, 0, 64, 64);
    // Four uneven tongues of flame out of the core.
    x.fillStyle = "rgba(255,225,150,0.9)";
    for (const [angle, reach] of [[0.2, 30], [1.7, 24], [3.3, 31], [4.9, 22]]) {
      x.beginPath();
      x.moveTo(32 + Math.cos(angle! - 0.35) * 6, 32 + Math.sin(angle! - 0.35) * 6);
      x.lineTo(32 + Math.cos(angle!) * reach!, 32 + Math.sin(angle!) * reach!);
      x.lineTo(32 + Math.cos(angle! + 0.35) * 6, 32 + Math.sin(angle! + 0.35) * 6);
      x.closePath();
      x.fill();
    }
  });
  return new THREE.SpriteMaterial({
    map: flash, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  });
}

function part(g: THREE.Group, mat: MatKey, size: V3, at: V3, rotX = 0): void {
  meshPart(g, bevelBox(...size, 0.12), mats()[mat], at, [rotX, 0, 0]);
}

/** Side silhouette as [z, y] points (−Z is the muzzle), `width` thick, centred on `x`. */
function prof(g: THREE.Group, mat: MatKey, points: Array<[number, number]>, width: number,
              x = 0): void {
  meshPart(g, profile(points, width), mats()[mat], [x, 0, 0]);
}

function joint(g: THREE.Group, name: string, at: V3): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...at);
  g.add(group);
  return group;
}

/** Faceted cylinder along the barrel axis; `radius` is the rear end. */
function tube(g: THREE.Group, mat: MatKey, radius: number, length: number, at: V3,
              frontRadius = radius): void {
  meshPart(g, new THREE.CylinderGeometry(radius, frontRadius, length, 10),
    mats()[mat], at, [Math.PI / 2, 0, 0]);
}

function muzzle(g: THREE.Group, radius: number, y: number, z: number): void {
  tube(g, "dark", radius * 0.62, 0.04, [0, y, z - 0.01]);
}

/** Trigger, and the guard strap running forward from the grip to `front`. */
function trigger(g: THREE.Group, front: number, y = -2.2): void {
  part(g, "metal", [0.5, 0.16, -front + 0.2], [0, y, front / 2 + 0.1]);
  part(g, "metal", [0.5, -y - 0.3, 0.16], [0, (y - 0.4) / 2, front]);
  part(g, "dark", [0.26, 1.1, 0.3], [0, -1.05, -1.25], 0.3);
}

/**
 * Outline of a magazine hanging from the origin: it starts `lean` radians
 * forward of straight down and curls a further `bend` toward the muzzle.
 */
function magazineOutline(length: number, depth: number, bend: number,
                         lean: number): Array<[number, number]> {
  const front: Array<[number, number]> = [], rear: Array<[number, number]> = [];
  const steps = 5;
  let z = 0, y = 0;
  for (let i = 0; i <= steps; ++i) {
    const angle = lean + bend * (i / steps);
    const nz = -Math.cos(angle) * depth / 2, ny = Math.sin(angle) * depth / 2;
    front.push([z + nz, y + ny]);
    rear.push([z - nz, y - ny]);
    z -= Math.sin(angle) * length / steps;
    y -= Math.cos(angle) * length / steps;
  }
  return [...front, ...rear.reverse()];
}

function magazine(g: THREE.Group, at: V3, length: number, depth: number, bend: number,
                  lean: number, width = 1.25): void {
  const mag = joint(g, "magazine", at);
  prof(mag, "steel", magazineOutline(length, depth, bend, lean), width);
}

function ak47(): THREE.Group {
  const g = new THREE.Group();
  // Stamped receiver and dust cover in one silhouette.
  prof(g, "metal", [[2, -0.4], [-8.3, -0.4], [-8.3, 1.9], [-7.6, 2.6], [1.2, 2.6], [2, 1.9]], 1.9);
  part(g, "dark", [0.08, 0.7, 2.6], [0.95, 1.55, -3.6]); // ejection port
  part(g, "edge", [0.08, 0.3, 3.4], [0.97, 0.75, -1.9], 0.08); // selector lever
  for (const x of [-0.96, 0.96]) {
    for (const z of [-7.4, 1.2]) part(g, "edge", [0.06, 0.22, 0.22], [x, 0.1, z]); // rivets
  }
  // Rear sight block and leaf.
  prof(g, "metal", [[-8.3, 1.2], [-10.3, 1.2], [-10.3, 2.6], [-9.6, 3.15], [-8.3, 3]], 1.5);
  part(g, "dark", [0.7, 0.3, 1.7], [0, 3.25, -9.3]);
  // Furniture: lower handguard, gas-tube cover, stock and grip.
  prof(g, "wood", [[-8.3, -0.15], [-14.8, 0.3], [-14.8, 1.7], [-8.3, 1.7]], 2.2);
  tube(g, "wood", 0.8, 4.6, [0, 2.55, -12.4]);
  part(g, "metal", [2.3, 3, 0.45], [0, 1.35, -14.95]);
  part(g, "metal", [1.7, 1.2, 0.4], [0, 2.4, -10]);
  prof(g, "wood", [[2, 1.9], [2, -0.3], [4.2, -0.8], [11.2, -3.4], [11.6, -3.1], [11.6, 0.5],
                   [11.2, 0.95], [4.5, 1.9]], 1.7);
  part(g, "dark", [1.8, 3.9, 0.3], [0, -1.3, 11.72]);
  prof(g, "wood", [[-0.6, -0.4], [1.5, -0.4], [3.5, -4.4], [3.1, -4.8], [1.4, -4.8], [1, -4.3]], 1.5);
  // Barrel, gas system, cleaning rod and the hooded front sight.
  tube(g, "metal", 0.4, 14.5, [0, 1.6, -15.3]);
  tube(g, "metal", 0.36, 4.2, [0, 2.55, -16.9]);
  prof(g, "metal", [[-18.6, 1.3], [-19.8, 1.3], [-19.8, 2.3], [-19.2, 2.95], [-18.6, 2.95]], 0.9);
  tube(g, "metal", 0.13, 7, [0, 0.95, -18.5]);
  part(g, "metal", [0.9, 0.9, 0.8], [0, 2.1, -21.3]);
  for (const x of [-0.42, 0.42]) part(g, "metal", [0.16, 1.5, 0.7], [x, 3.15, -21.3]);
  part(g, "edge", [0.14, 1, 0.14], [0, 3, -21.3]);
  tube(g, "metal", 0.52, 0.9, [0, 1.6, -22.35]);
  muzzle(g, 0.52, 1.6, -22.8);
  trigger(g, -3.45);
  part(joint(g, "action", [1.05, 1.75, -5.6]), "edge", [1, 0.32, 0.42], [0.35, 0, 0]);
  magazine(g, [0, -0.4, -4.9], 7.2, 2.5, 0.62, 0.12);
  return g;
}

function m4a1(): THREE.Group {
  const g = new THREE.Group();
  // Upper and lower receiver with the magazine well.
  prof(g, "metal", [[2.2, 2.5], [2.2, 0.3], [1.4, -0.4], [-3.4, -0.4], [-3.6, -1.6], [-6, -1.6],
                    [-6.2, 0.2], [-6.2, 2.5]], 1.7);
  part(g, "dark", [0.08, 0.7, 2.4], [0.86, 1.6, -3.2]);
  tube(g, "edge", 0.3, 0.5, [0.95, 1.9, -0.6]); // forward assist
  // Carry handle: an arch, open underneath.
  prof(g, "metal", [[1.6, 2.5], [1.6, 3.3], [0.6, 4.5], [-4.6, 4.5], [-5.4, 3.4], [-5.4, 2.5],
                    [-4.4, 2.5], [-4, 3.6], [-0.2, 3.6], [0.4, 2.5]], 0.9);
  part(g, "dark", [0.5, 0.5, 0.5], [0, 4.6, 0.3]);
  // Barrel, ribbed handguard, front sight tower, flash hider.
  tube(g, "metal", 0.38, 15, [0, 1.4, -13.7]);
  tube(g, "metal", 1.25, 0.5, [0, 1.4, -6.5]);
  tube(g, "polymer", 1.15, 7, [0, 1.4, -9.9], 1);
  for (let z = -7.4; z > -13.2; z -= 0.9) tube(g, "dark", 1.17 + (z + 7.4) * 0.021, 0.16, [0, 1.4, z]);
  tube(g, "metal", 1.03, 0.3, [0, 1.4, -13.5]);
  prof(g, "metal", [[-14.2, 1.2], [-15.7, 1.2], [-15.25, 4.3], [-14.8, 4.3]], 0.5);
  part(g, "edge", [0.14, 0.7, 0.14], [0, 4.5, -15]);
  tube(g, "metal", 0.46, 1.5, [0, 1.4, -21]);
  muzzle(g, 0.46, 1.4, -21.75);
  // Buffer tube and collapsible stock.
  tube(g, "metal", 0.6, 7, [0, 1.5, 5.7]);
  prof(g, "polymer", [[5, 2.3], [5, 0.7], [8.5, 0.3], [10.5, -2.6], [12.2, -2.6], [12.2, 2],
                      [11.4, 2.3]], 1.5);
  part(g, "dark", [1.6, 4.7, 0.3], [0, -0.3, 12.3]);
  prof(g, "polymer", [[-0.4, -0.4], [1.6, -0.4], [3.3, -4.2], [3, -4.6], [1.3, -4.6], [0.6, -2]], 1.4);
  trigger(g, -3.5, -2);
  part(joint(g, "action", [0, 2.7, 2.2]), "steel", [1.5, 0.28, 0.5], [0, 0, 0]);
  magazine(g, [0, -1.2, -4.8], 6, 2.3, 0.22, 0.14, 1.1);
  return g;
}

function awp(): THREE.Group {
  const g = new THREE.Group();
  // Thumbhole stock: fore-end, butt, grip and the strap closing the hole.
  prof(g, "olive", [[-12.5, 0.9], [-12.5, -0.3], [-11.5, -0.9], [-2, -1.4], [0.5, -1], [3, -0.6],
                    [3, 0.9]], 2.4);
  prof(g, "olive", [[3, 0.9], [5, 2.2], [13.6, 2.2], [14.8, 1.6], [14.8, -4], [13.5, -4.4],
                    [9.5, -4.4], [8.3, -1.6], [5.5, -0.9], [3, -0.6]], 2);
  prof(g, "olive", [[0.5, -1], [2.6, -0.7], [4.4, -4.5], [3.9, -5], [2.2, -5], [1.6, -3]], 1.7);
  prof(g, "olive", [[3.9, -5], [4.4, -4.2], [9.5, -3.6], [9.5, -4.4]], 1.7);
  part(g, "dark", [2.1, 5.8, 0.4], [0, -1.2, 15]);
  part(g, "polymer", [1.9, 0.5, 5.5], [0, 2.45, 9.5]); // cheek piece
  // Action and free-floated barrel.
  tube(g, "metal", 0.8, 12, [0, 1.5, -4]);
  tube(g, "metal", 0.5, 19, [0, 1.4, -19.5]);
  tube(g, "metal", 0.66, 1.7, [0, 1.4, -28.15]);
  muzzle(g, 0.66, 1.4, -29);
  part(joint(g, "magazine", [0, -1.3, -3.2]), "steel", [1.5, 1.7, 3.2], [0, -0.75, 0]);
  // Scope: tube, bells, lenses, turrets and rings.
  tube(g, "steel", 0.55, 11, [0, 3.6, -4]);
  tube(g, "steel", 0.6, 3, [0, 3.6, -11], 1.05);
  tube(g, "glass", 0.95, 0.04, [0, 3.6, -12.48]);
  tube(g, "steel", 0.85, 2, [0, 3.6, 2.5], 0.6);
  tube(g, "glass", 0.72, 0.04, [0, 3.6, 3.52]);
  part(g, "steel", [0.8, 0.8, 0.8], [0, 4.4, -4.5]);
  part(g, "steel", [0.8, 0.8, 0.8], [0.8, 3.6, -4.5]);
  for (const z of [-7, -1.5]) {
    part(g, "metal", [1, 1.2, 0.8], [0, 2.6, z]);
    tube(g, "metal", 0.72, 0.7, [0, 3.6, z]);
  }
  const bolt = joint(g, "action", [0.9, 1.6, 1]);
  part(bolt, "edge", [1.7, 0.4, 0.4], [0.5, -0.2, 0]);
  meshPart(bolt, new THREE.IcosahedronGeometry(0.55, 0), mats().polymer, [1.5, -0.5, 0]);
  trigger(g, -3.3, -2.9);
  return g;
}

function mp5(): THREE.Group {
  const g = new THREE.Group();
  prof(g, "metal", [[3, 1.9], [2.6, 2.5], [-7.5, 2.5], [-7.5, 0.2], [3, 0.2]], 1.6);
  part(g, "dark", [0.08, 0.6, 2], [0.81, 1.5, -3.5]);
  part(g, "metal", [1.1, 0.8, 1], [0, 2.9, 1.2]); // drum sight
  // Trigger group and grip in one moulding, magazine well ahead of it.
  prof(g, "polymer", [[2.4, 0.2], [-3.4, 0.2], [-3.4, -0.9], [-0.5, -0.9], [0.6, -2.2], [1.2, -4.8],
                      [2.9, -4.8], [3.3, -4.4], [1.9, -0.9], [2.4, -0.4]], 1.5);
  prof(g, "metal", [[-3.5, 0.2], [-6, 0.2], [-6, -1.2], [-3.5, -1.2]], 1.3);
  prof(g, "polymer", [[-7.5, 2], [-7.5, -0.3], [-12.6, 0.1], [-12.6, 2]], 1.9);
  tube(g, "metal", 0.42, 6, [0, 2.3, -10.5]);
  tube(g, "metal", 0.34, 1.2, [0, 1.4, -12.9]);
  muzzle(g, 0.34, 1.4, -13.5);
  meshPart(g, new THREE.TorusGeometry(0.75, 0.16, 4, 10), mats().metal, [0, 3, -12.9]);
  part(g, "metal", [0.5, 0.7, 0.5], [0, 2.3, -12.9]);
  part(g, "edge", [0.14, 0.7, 0.14], [0, 2.9, -12.9]);
  prof(g, "polymer", [[3, 2.3], [3, 0.6], [5, 0.9], [10.2, -2.4], [10.6, -2.2], [10.6, 1.9],
                      [10, 2.3]], 1.5);
  part(g, "dark", [1.6, 4.4, 0.3], [0, -0.2, 10.7]);
  trigger(g, -3.3, -2.5);
  part(joint(g, "action", [-0.5, 2.3, -10.6]), "edge", [0.9, 0.3, 0.4], [-0.4, 0, 0]);
  magazine(g, [0, -1.1, -4.75], 6.4, 1.7, 0.36, 0.06, 1);
  return g;
}

function pistol(suppressed: boolean): THREE.Group {
  const g = new THREE.Group();
  const slide = joint(g, "action", [0, 0, 0]);
  prof(slide, suppressed ? "metal" : "steel", [[1.9, 2.25], [1.9, 0.75], [-5.9, 0.75], [-6.2, 1],
                                                 [-6.2, 2], [-5.9, 2.25]], 1.25);
  for (const side of [-1, 1]) {
    for (let z = 0.2; z < 1.7; z += 0.3) part(slide, "dark", [0.05, 1.2, 0.12], [side * 0.63, 1.5, z]);
  }
  part(slide, "dark", [0.7, 0.06, 1.7], [0.2, 2.25, -2.2]); // ejection port
  part(slide, "dark", [0.22, 0.32, 0.4], [0, 2.4, -5.6]);
  for (const x of [-0.32, 0.32]) part(slide, "dark", [0.22, 0.32, 0.4], [x, 2.4, 1.5]);
  // Frame, grip and beavertail in one moulding.
  prof(g, "polymer", [[2.2, 0.75], [-6, 0.75], [-6, -0.1], [-3.4, -0.3], [-0.3, -0.3], [1.2, -4.9],
                      [3.6, -4.9], [2.4, -0.6], [2.6, 0.3]], 1.25);
  part(g, "polymer", [0.5, 0.16, 3.6], [0, -2.3, -1.65]);
  part(g, "polymer", [0.5, 2, 0.16], [0, -1.3, -3.4]);
  part(g, "dark", [0.24, 1, 0.28], [0, -1.05, -1.3], 0.3);
  if (suppressed) part(g, "steel", [0.3, 0.6, 0.5], [0, 1.5, 2.1], -0.5); // hammer
  const mag = joint(g, "magazine", [0, -0.6, 1]);
  part(mag, "steel", [0.9, 4.2, 1.5], [0, -2.1, 0.66], -0.3);
  part(mag, "dark", [1.3, 0.35, 2], [0, -4.4, 1.4], -0.3);
  if (suppressed) {
    tube(g, "steel", 0.62, 6, [0, 1.5, -9.4]);
    muzzle(g, 0.62, 1.5, -12.4);
  } else {
    tube(g, "edge", 0.3, 0.3, [0, 1.5, -6.3]);
    muzzle(g, 0.3, 1.5, -6.45);
  }
  return g;
}

function knife(): THREE.Group {
  const g = new THREE.Group();
  prof(g, "polymer", [[4.2, 0.7], [4.4, -0.7], [-0.7, -0.75], [-0.7, 0.75]], 0.95);
  for (let z = 0; z < 4; z += 0.7) part(g, "dark", [1.05, 1.5, 0.2], [0, 0, z]);
  part(g, "metal", [1.3, 2.6, 0.4], [0, 0, -0.9]);
  // Clip-point blade, edge down.
  prof(g, "edge", [[-1.1, 0.9], [-7.2, 0.9], [-9.6, 0.1], [-8.4, -0.9], [-1.1, -0.9]], 0.22);
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
    case WeaponId.ak47: return [0, 1.6, -22.8];
    case WeaponId.m4a1: return [0, 1.4, -21.75];
    case WeaponId.awp: return [0, 1.4, -29];
    case WeaponId.mp5: return [0, 1.4, -13.5];
    case WeaponId.usp: return [0, 1.5, -12.4];
    case WeaponId.glock: return [0, 1.5, -6.45];
    case WeaponId.knife: return [0, 0.4, -10.5];
    default: return [0, 1.4, -20];
  }
}

/** Shared grip locations for first-person hands and the character's aiming pose. */
export function supportGrip(id: number): V3 {
  switch (id) {
    case WeaponId.usp: case WeaponId.glock: return [-1.1, -3.2, 0.8];
    case WeaponId.ak47: return [-0.2, -0.9, -11.5];
    case WeaponId.awp: return [-0.2, -1.9, -9];
    case WeaponId.mp5: return [-0.2, -1.2, -10];
    default: return [-0.2, -0.75, -10];
  }
}

/**
 * Unit-length forearm along +Y: cloth sleeve from the elbow (-0.5) with the
 * glove's gauntlet over its last tenth, ending at the wrist (+0.5).
 */
function forearm(group: THREE.Group): void {
  // The muscle of the forearm, narrowing to a cuff rolled just short of the glove.
  meshPart(group, loft([[-0.5, 2.6, 2.6], [-0.15, 2.55, 2.4], [0.15, 2.15, 1.95], [0.36, 1.75, 1.55],
                        [0.4, 1.95, 1.75], [0.43, 1.7, 1.5]], 12), mats().sleeve, [0, 0, 0]);
  meshPart(group, loft([[0.41, 1.75, 1.6], [0.46, 1.8, 1.6], [0.5, 1.55, 1.35]], 12), mats().glove, [0, 0, 0]);
}

const up = new THREE.Vector3(0, 1, 0);
const span = new THREE.Vector3();
function aimForearm(arm: THREE.Object3D, elbow: THREE.Vector3, wrist: THREE.Vector3): void {
  arm.position.copy(elbow).add(wrist).multiplyScalar(0.5);
  span.copy(wrist).sub(elbow);
  arm.scale.y = span.length();
  arm.quaternion.setFromUnitVectors(up, span.normalize());
}

const from = new THREE.Vector3(), reachTo = new THREE.Vector3();
/** A finger: capsules through each knuckle in turn, thinning toward the tip. */
function digit(g: THREE.Group, mat: MatKey, radius: number, ...knuckles: V3[]): void {
  for (let i = 0; i + 1 < knuckles.length; ++i) {
    from.set(...knuckles[i]!);
    reachTo.set(...knuckles[i + 1]!).sub(from);
    const bone = meshPart(g, capsule(reachTo.length(), radius * (1 - i * 0.1)), mats()[mat],
      knuckles[i]!);
    bone.quaternion.setFromUnitVectors(up, reachTo.normalize());
  }
}

/** A rounded mass of glove: palm, heel, the back of a hand. */
function pad(g: THREE.Group, size: V3, at: V3, rotX = 0): void {
  meshPart(g, ball(...size), mats().glove, at, [rotX, 0, 0]);
}

/**
 * Fingerless-gloved firing hand around the grip, and a hand cupping the
 * fore-end. Hands are the one model the player never stops looking at, so
 * they get real fingers: three bones each, wrapped round what they hold.
 */
export function buildArms(id: number): THREE.Group {
  const g = new THREE.Group();
  if (id === WeaponId.none) return g;
  const pistol = id === WeaponId.usp || id === WeaponId.glock;
  const firing = new THREE.Group();
  g.add(firing);
  const sleeve = new THREE.Group();
  forearm(sleeve);
  firing.add(sleeve);
  if (id === WeaponId.knife) {
    // A fist round a handle that runs fore and aft, thumb laid along the spine.
    aimForearm(sleeve, new THREE.Vector3(8, -9, 19), new THREE.Vector3(1.1, -0.7, 4.9));
    pad(firing, [0.6, 1.15, 2], [1, -0.1, 2]);
    pad(firing, [0.95, 0.95, 0.95], [1, -0.45, 4.1]);
    for (let i = 0; i < 4; ++i) {
      const z = 0.5 + i * 0.9;
      digit(firing, "skin", 0.42, [0.8, 0.75, z], [-0.65, 0.8, z], [-0.95, -0.4, z], [-0.15, -1, z]);
    }
    digit(firing, "skin", 0.46, [0.85, 0.4, 3.9], [0.1, 1.05, 2.4], [-0.3, 1.05, 0.9]);
    batchParts(g);
    return g;
  }
  aimForearm(sleeve, new THREE.Vector3(8, -9, 19), new THREE.Vector3(1.3, -2.6, 4.3));
  pad(firing, [0.6, 1.8, 1.75], [1.2, -2.5, 1.8], -0.3); // back of the hand
  pad(firing, [1.05, 0.85, 0.7], [0.3, -1.15, 2.85], -0.3); // web behind the grip
  pad(firing, [0.95, 0.95, 0.9], [1.2, -2.4, 3.6]); // wrist, into the gauntlet
  for (let i = 0; i < 3; ++i) {
    // Knuckle on the far side, round the front of the grip, tip on the near side.
    const y = -1.75 - i * 0.85, z = -0.45 + i * 0.3;
    digit(firing, "skin", 0.43, [1.45, y, z + 1], [0.9, y - 0.05, z - 0.3], [-0.55, y - 0.05, z - 0.25],
      [-1.1, y, z + 0.95]);
    meshPart(firing, ball(0.5, 0.42, 0.55), mats().glove, [1.6, y, z + 0.9]); // knuckle of the glove
  }
  digit(firing, "skin", 0.41, [1.35, -0.85, 0.5], [1.05, -0.8, -1.3], [0.45, -0.95, -2.2]); // trigger finger
  digit(firing, "skin", 0.47, [-0.2, -0.7, 2.7], [-1, -0.5, 1.5], [-1.08, -0.55, 0.2]); // thumb
  {
    const support = joint(g, "support_sleeve", [0, 0, 0]);
    forearm(support);
    // A pistol's support arm comes up from below; a rifle's reaches in from the left.
    support.userData.elbow = pistol ? new THREE.Vector3(-8, -13, 9) : new THREE.Vector3(-14, -5, 7);
    const hand = joint(g, "support_hand", supportGrip(id));
    pad(hand, [1.05, 0.75, 1.05], [-0.65, -0.9, 1.05], 0.5); // heel, toward the wrist
    if (pistol) {
      // Wrapped over the firing hand from the left.
      pad(hand, [0.5, 1.6, 1.5], [-0.55, 0.5, 0.8], -0.3);
      for (let i = 0; i < 4; ++i) {
        const y = 1.5 - i * 0.8, z = -1 + i * 0.28;
        digit(hand, "skin", 0.4, [-0.4, y, z + 0.6], [0.7, y, z - 0.45], [1.9, y, z - 0.35], [2.5, y, z + 0.6]);
      }
      digit(hand, "skin", 0.44, [-0.5, 1.9, 1.3], [-0.3, 2.4, 0], [-0.2, 2.5, -1.3]);
    } else {
      // Cupped under the fore-end: thumb along the near side, fingers up the far.
      pad(hand, [1.55, 0.6, 1.95], [0.1, 0.3, 0]);
      digit(hand, "skin", 0.46, [-1.2, 0.3, 0.7], [-1.75, 1.3, -0.3], [-1.65, 1.9, -1.6]);
      for (let i = 0; i < 4; ++i) {
        const z = -1.3 + i * 0.85;
        digit(hand, "skin", 0.4, [1.2, 0.2, z], [1.8, 1.2, z], [1.6, 2.2, z - 0.05], [1.05, 2.75, z - 0.1]);
      }
    }
    poseSupportSleeve(support, hand);
  }
  batchParts(g);
  return g;
}

const wrist = new THREE.Vector3();

/** Keep the sleeve attached to the wrist as the support hand reaches/reloads. */
export function poseSupportSleeve(sleeve: THREE.Object3D, hand: THREE.Object3D): void {
  wrist.set(-1, -1.8, 1.4).applyQuaternion(hand.quaternion).add(hand.position);
  aimForearm(sleeve, sleeve.userData.elbow as THREE.Vector3, wrist);
}
