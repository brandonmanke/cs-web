import * as THREE from "three";
import { cloneHandGlb, cloneWeaponGlb, getPhotoTexture, type WeaponGlbKey } from "./loader";
import {
  camo, canvasTexture, cloud, fill, grain, reliefTextures, stains, type ReliefTextures,
} from "./textures";
import { batchParts, bevelBox, capsule, loft, meshPart, profile, roundBox, type V3 } from "./geometry";

// Original procedural models. Barrel points -Z, +Y up, origin at the grip.
// GoldSrc inches; silhouettes and finish do the work, not high polygon counts.
export const WeaponId = {
  none: 0, knife: 1, usp: 2, glock: 3, ak47: 4, m4a1: 5, awp: 6, mp5: 7,
} as const;

type Finish = "metal" | "polymer" | "wood" | "cloth" | "skin";

/**
 * A weapon surface, painted in colour and in relief. Detail runs along the
 * barrel (canvas x): that is the way steel is machined and a stock is cut, and
 * getting it wrong is what makes a stock look like a fence post.
 */
function surface(base: string, seed: number, finish: Finish, camouflage?: string[]): ReliefTextures {
  return reliefTextures(256, seed, ({ color, height }) => {
    const x = color.ctx, h = height.ctx, S = 256;
    if (camouflage) camo(color, base, camouflage, 26);
    else fill(color, base);
    cloud(color, finish === "wood" ? 16 : 9, 96, 3);
    if (finish === "wood") {
      // Grain: long, slightly wandering lines, darker in the latewood, with a knot or two.
      for (let i = 0; i < 90; ++i) {
        const y = color.random() * S, drift = (color.random() - 0.5) * 14;
        const style = i % 3 ? "rgba(58,30,14,0.17)" : "rgba(205,150,90,0.12)";
        for (const ctx of [x, h]) {
          ctx.strokeStyle = ctx === x ? style : (i % 3 ? "rgba(70,70,70,0.5)" : "rgba(190,190,190,0.4)");
          ctx.lineWidth = 0.5 + color.random() * (ctx === x ? 1.4 : 0.6);
          ctx.beginPath();
          ctx.moveTo(-4, y);
          ctx.bezierCurveTo(S * 0.3, y + drift, S * 0.7, y - drift, S + 4, y + drift * 0.5);
          ctx.stroke();
        }
      }
      for (let knot = 0; knot < 2; ++knot) {
        const kx = color.random() * S, ky = color.random() * S;
        x.fillStyle = "rgba(48,24,10,0.5)";
        x.beginPath(); x.ellipse(kx, ky, 9, 4, 0, 0, Math.PI * 2); x.fill();
      }
      grain(height, 6, 1);
    } else if (finish === "metal") {
      // Machining marks and holster wear: fine bright scratches, a few dark.
      for (let i = 0; i < 46; ++i) {
        const sx = color.random() * S, sy = color.random() * S, length = 4 + color.random() * 26;
        x.fillStyle = i % 4 ? "rgba(205,214,220,0.11)" : "rgba(0,0,0,0.2)";
        x.fillRect(sx, sy, length, 1);
        h.fillStyle = "rgba(60,60,60,0.5)";
        h.fillRect(sx, sy, length, 1);
      }
      stains(color, 6, "#0e1114", 40);
      grain(height, 5, 1);
    } else if (finish === "polymer") {
      grain(color, 5, 1);
      grain(height, 34, 1); // moulded stipple
    } else if (finish === "cloth") {
      // Sleeve: creases across the arm, then the weave.
      for (let i = 0; i < 26; ++i) {
        const y = color.random() * S, w = 40 + color.random() * 90, at = color.random() * S;
        for (const offset of [0, -S]) {
          h.fillStyle = "rgb(180,180,180)"; h.fillRect(at + offset, y, w, 1.6);
          h.fillStyle = "rgb(70,70,70)"; h.fillRect(at + offset, y + 1.6, w, 1.8);
          x.fillStyle = "rgba(0,0,0,0.14)"; x.fillRect(at + offset, y + 1.6, w, 1.8);
        }
      }
      grain(color, 5, 1);
      grain(height, 12, 1);
    } else {
      grain(color, 4, 1);
      grain(height, 5, 1);
    }
  });
}

type MatKey = "metal" | "steel" | "edge" | "dark" | "polymer" | "wood" | "olive" | "glass"
  | "sleeve" | "glove" | "skin";
let materials: Record<MatKey, THREE.MeshStandardMaterial> | undefined;
/**
 * Physically-based, because a gun is the one thing in the game made of
 * surfaces that differ: blued steel that mirrors the room, oiled wood, dull
 * moulded polymer. The renderer supplies the room they reflect.
 */
function mats(): Record<MatKey, THREE.MeshStandardMaterial> {
  if (!materials) {
    // Cloth and rubber take almost nothing from the room: left at full
    // strength its glare greys them out like clay.
    const make = (textures: ReliefTextures, metalness: number, roughness: number, bumpScale: number,
                  envMapIntensity = 1, photoKey?: string, tint?: number) => {
      const photo = photoKey ? getPhotoTexture(photoKey) : null;
      return new THREE.MeshStandardMaterial({
        map: photo ?? textures.map,
        bumpMap: textures.bumpMap,
        color: photo && tint !== undefined ? tint : 0xffffff,
        metalness,
        roughness,
        bumpScale,
        envMapIntensity,
      });
    };
    materials = {
      // Parkerized receiver steel, and the darker blued steel of magazines and slides.
      metal: make(surface("#555b61", 5150, "metal"), 0.85, 0.4, 0.5, 1, "gunmetal", 0xc2c8ce),
      steel: make(surface("#33373b", 5152, "metal"), 0.92, 0.3, 0.5, 1, "gunmetal", 0x6e747a),
      edge: make(surface("#a0a9ae", 5151, "metal"), 1, 0.24, 0.4, 1, "gunmetal", 0xffffff),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0d0f, metalness: 0.3, roughness: 0.75 }),
      polymer: make(surface("#232629", 7, "polymer"), 0.04, 0.62, 1.4, 0.45, "glove", 0x686c70),
      wood: make(surface("#84491f", 99, "wood"), 0, 0.36, 0.28, 0.65, "ak_wood", 0xf2dfc8),
      olive: make(surface("#4a5536", 123, "polymer"), 0.04, 0.7, 1.4, 0.4),
      glass: new THREE.MeshStandardMaterial({ color: 0x1b3b45, metalness: 0.7, roughness: 0.06 }),
      sleeve: make(surface("#4f6177", 411, "cloth", ["#3b4a5f", "#647890"]), 0, 0.95, 2.2, 0.15, "ct_cloth"),
      glove: make(surface("#232425", 413, "polymer"), 0, 0.78, 1.2, 0.2, "glove"),
      skin: make(surface("#b98a68", 415, "skin"), 0, 0.62, 0.4, 0.2),
    };
  }
  return materials;
}

/**
 * The room the weapons reflect: dim walls under three strip lights, a warm
 * panel to one side and a cool one to the other. Nothing here is ever drawn —
 * it is prefiltered into an environment map — but it is why a flat receiver
 * carries a moving streak of light instead of one grey value.
 */
export function reflectionRoom(): THREE.Scene {
  const room = new THREE.Scene();
  const glow = (r: number, g: number, b: number) => {
    const material = new THREE.MeshBasicMaterial();
    material.color.setRGB(r, g, b);
    return material;
  };
  const shell = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 24), glow(0.3, 0.31, 0.35));
  shell.material.side = THREE.BackSide;
  room.add(shell);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), glow(0.05, 0.05, 0.055));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -5.9;
  room.add(floor);
  for (const z of [-7, 0, 7]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(17, 0.2, 1.3), glow(9, 9, 8.6));
    strip.position.set(0, 5.8, z);
    room.add(strip);
  }
  const warm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 6, 8), glow(4.6, 3.3, 1.9));
  warm.position.set(-11.8, 0, -2);
  const cool = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5, 7), glow(1.1, 1.5, 2.1));
  cool.position.set(11.8, 0.5, 3);
  room.add(warm, cool);
  return room;
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
  meshPart(g, new THREE.CylinderGeometry(radius, frontRadius, length, 18),
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
  // Stiffening ribs: the same outline again, narrower and standing proud.
  prof(mag, "metal", magazineOutline(length * 0.82, depth * 0.3, bend * 0.82, lean), width + 0.12);
}

function ak47(): THREE.Group {
  const g = new THREE.Group();
  // Stamped receiver and dust cover in one silhouette.
  prof(g, "metal", [[2, -0.4], [-8.3, -0.4], [-8.3, 1.9], [-7.6, 2.6], [1.2, 2.6], [2, 1.9]], 1.9);
  part(g, "dark", [0.08, 0.7, 2.6], [0.95, 1.55, -3.6]); // ejection port
  // Pressed ribs across the dust cover, the magazine dimple, and the trunnion block.
  for (const z of [-5.6, -3.4, -1.2]) part(g, "metal", [1.5, 0.16, 0.5], [0, 2.62, z]);
  for (const x of [-0.96, 0.96]) part(g, "dark", [0.06, 0.55, 1.5], [x, 0.55, -5]);
  part(g, "steel", [2, 1.5, 0.9], [0, 1.2, -7.9]);
  part(g, "steel", [0.5, 0.5, 0.7], [0, -0.55, -3.55]); // magazine catch
  for (const z of [-11.2, -12.4, -13.6]) part(g, "dark", [1.7, 0.3, 0.5], [0, 2.75, z]); // gas-tube vents
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
  part(joint(g, "action", [1.05, 1.75, -5.6]), "steel", [1, 0.32, 0.42], [0.35, 0, 0]);
  for (const z of [3.2, 10.6]) part(g, "steel", [0.3, 0.9, 0.5], [-0.95, 0.2 - (z > 5 ? 2.4 : 0), z]); // sling loops
  magazine(g, [0, -0.4, -4.9], 7.2, 2.5, 0.62, 0.12);
  return g;
}

function m4a1(): THREE.Group {
  const g = new THREE.Group();
  // Upper and lower receiver with the magazine well.
  prof(g, "metal", [[2.2, 2.5], [2.2, 0.3], [1.4, -0.4], [-3.4, -0.4], [-3.6, -1.6], [-6, -1.6],
                    [-6.2, 0.2], [-6.2, 2.5]], 1.7);
  part(g, "dark", [0.08, 0.7, 2.4], [0.86, 1.6, -3.2]);
  tube(g, "steel", 0.3, 0.5, [0.95, 1.9, -0.6]); // forward assist
  // Left side, the one you look at: selector, bolt catch, magazine fence, pins.
  part(g, "steel", [0.1, 0.3, 1.2], [-0.88, 0.5, 0.6], 0.5);
  part(g, "steel", [0.12, 1, 0.6], [-0.88, 1, -2.6]);
  part(g, "metal", [0.1, 1.1, 2.2], [-0.88, 0.2, -4.6]);
  for (const z of [1.6, -5.6]) part(g, "steel", [1.8, 0.3, 0.3], [0, 0.35, z]); // takedown pins
  part(g, "steel", [1.1, 0.5, 0.6], [0, 4.75, -4.2]); // rear sight drum
  part(g, "metal", [0.6, 0.5, 0.7], [0, 0.55, -15]); // bayonet lug
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
  part(joint(g, "action", [0, 2.68, 2.2]), "steel", [1.15, 0.22, 0.45], [0, 0, 0]);
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
  // Bedding screws along the stock and the bipod stud under the fore-end.
  for (const z of [-10.5, -6, 6]) tube(g, "steel", 0.22, 2.5, [0, 0, z]);
  for (const x of [-1.21, 1.21]) part(g, "dark", [0.05, 0.5, 5], [x, 0.2, -7]);
  part(g, "steel", [0.6, 0.5, 0.9], [0, -0.9, -11.6]);
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
  // Selector and its markings, receiver pins, and the handguard's grip lines.
  part(g, "steel", [0.1, 0.3, 1], [-0.78, -0.15, 1.1], 0.4);
  for (const z of [2.6, -3.2, -7.2]) part(g, "steel", [1.7, 0.28, 0.28], [0, 0.45, z]);
  for (const z of [-8.6, -9.8, -11]) for (const x of [-0.97, 0.97]) part(g, "dark", [0.05, 1.3, 0.3], [x, 0.9, z]);
  part(g, "steel", [0.5, 0.9, 0.5], [0, -1.5, -3.3]); // magazine release paddle
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

const GLB_FOR_WEAPON: Partial<Record<number, WeaponGlbKey>> = {
  [WeaponId.ak47]: "ak47",
  [WeaponId.m4a1]: "m4a1",
  [WeaponId.mp5]: "mp5",
  [WeaponId.knife]: "knife",
  [WeaponId.awp]: "awp",
  [WeaponId.usp]: "pistol",
  [WeaponId.glock]: "pistol",
};

export function buildWeapon(id: number): THREE.Group {
  // Prefer preloaded Blender/CC0 GLB firearms when available (falls back cleanly
  // to procedural geometry in headless tests or before assets load).
  const glbKey = GLB_FOR_WEAPON[id];
  if (glbKey) {
    const glb = cloneWeaponGlb(glbKey);
    if (glb) {
      const g = new THREE.Group();
      g.add(glb);
      if (id === WeaponId.awp) {
        if (!glb.getObjectByName("magazine")) {
          part(joint(g, "magazine", [0, -1.3, -3.2]), "steel", [1.4, 1.5, 3.0], [0, -0.75, 0]);
        }
        if (!glb.getObjectByName("action")) joint(g, "action", [0.9, 1.6, 1]);
      } else if (id === WeaponId.usp || id === WeaponId.glock) {
        if (!glb.getObjectByName("magazine")) {
          const mag = joint(g, "magazine", [0, -0.8, 0.4]);
          part(mag, "steel", [0.7, 2.8, 1.1], [0, -1.6, 0.2], -0.22);
        }
        if (!glb.getObjectByName("action")) joint(g, "action", [0, 0, 0]);
        if (id === WeaponId.usp) {
          // Coaxial tactical suppressor threaded flush onto the GLB barrel bore
          // (bore axis y = 0.58, muzzle face z = -6.47).
          tube(g, "metal", 0.34, 0.5, [0, 0.58, -6.55]);
          tube(g, "steel", 0.54, 5.8, [0, 0.58, -9.55]);
          muzzle(g, 0.54, 0.58, -12.45);
        }
      }
      return g;
    }
  }

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
function forearm(group: THREE.Group, team: "ct" | "t" = "ct"): void {
  const glb = cloneHandGlb(team === "t" ? "sleeve_t" : "sleeve_ct");
  if (glb) {
    group.add(glb);
    return;
  }
  // Procedural fallback for headless tests.
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
    const bone = meshPart(g, capsule(reachTo.length(), radius * (1 - i * 0.1), 8), mats()[mat],
      knuckles[i]!);
    bone.quaternion.setFromUnitVectors(up, reachTo.normalize());
  }
}

const basisX = new THREE.Vector3(), basisY = new THREE.Vector3(), basisZ = new THREE.Vector3();
const basis = new THREE.Matrix4();
/**
 * The body of a hand: one flattened, tapering form from the wrist to the row
 * of knuckles, `width` across and `thick` through, its back facing `normal`.
 * Fingers and thumb are hung off it, so the hand reads as one thing.
 */
function palm(g: THREE.Group, wristAt: V3, knuckles: V3, normal: V3, width: number, thick: number): void {
  basisY.set(...knuckles).sub(from.set(...wristAt));
  const length = basisY.length();
  basisY.normalize();
  basisZ.set(...normal).addScaledVector(basisY, -basisY.dot(basisZ.set(...normal))).normalize();
  basisX.crossVectors(basisY, basisZ);
  const mesh = meshPart(g, loft([[-0.5, width * 0.3, thick * 0.42], [0.3, width * 0.4, thick * 0.5],
                                 [length * 0.55, width * 0.5, thick * 0.5], [length, width * 0.5, thick * 0.44],
                                 [length + 0.45, width * 0.44, thick * 0.28]], 12, { square: 3, smooth: 1 }),
    mats().glove, wristAt);
  mesh.quaternion.setFromRotationMatrix(basis.makeBasis(basisX, basisY, basisZ));
}

/**
 * Gloved firing hand around the grip, and a hand cupping the fore-end. Hands
 * are the one model the player never stops looking at, so they are built like
 * hands: a palm from wrist to knuckles, three-bone fingers wrapped round what
 * they hold, and a thumb with a base.
 */
export function buildArms(id: number, team: "ct" | "t" = "ct"): THREE.Group {
  const g = new THREE.Group();
  if (id === WeaponId.none) return g;
  const pistol = id === WeaponId.usp || id === WeaponId.glock;
  const firing = new THREE.Group();
  g.add(firing);
  const sleeve = new THREE.Group();
  forearm(sleeve, team);
  firing.add(sleeve);
  if (id === WeaponId.knife) {
    aimForearm(sleeve, new THREE.Vector3(5.6, -7.2, 17.2), new THREE.Vector3(1.1, -0.45, 4.5));
    const knifeHand = cloneHandGlb("hand_knife_r");
    if (knifeHand) {
      firing.add(knifeHand);
    } else {
      palm(firing, [1.05, -0.4, 4.35], [1.0, -0.1, 1.05], [1, 0.15, 0], 3.2, 1.15);
      meshPart(firing, roundBox(0.35, 2.3, 1.6, 4), mats().polymer, [1.55, -0.2, 2.6]);
      for (let i = 0; i < 4; ++i) {
        const z = 0.65 + i * 0.85;
        digit(firing, "glove", 0.4,
          [0.95, -0.2, z], [0.7, -0.95, z], [-0.45, -0.95, z], [-0.72, -0.15, z]);
        meshPart(firing, roundBox(0.38, 0.55, 0.72, 4), mats().polymer, [1.35, -0.15, z]);
      }
      digit(firing, "glove", 0.48, [0.55, 0.35, 3.4], [-0.35, 0.82, 2.1], [-0.35, 0.86, 0.55]);
      batchParts(g);
    }
    return g;
  }
  aimForearm(sleeve, new THREE.Vector3(8, -9, 19), new THREE.Vector3(1.3, -2.6, 4.3));
  const gunHand = cloneHandGlb("hand_gun_r");
  if (gunHand) {
    firing.add(gunHand);
  } else {
    // Procedural fallback for headless tests.
    palm(firing, [1.3, -2.6, 4.2], [1.5, -2.6, 0.95], [1, 0, 0], 3.3, 1.25);
    meshPart(firing, roundBox(0.4, 2.5, 1.8, 4), mats().polymer, [2.05, -2.6, 2.2]);
    for (let i = 0; i < 3; ++i) {
      const y = -1.75 - i * 0.85, z = -0.45 + i * 0.3;
      digit(firing, "glove", 0.43, [1.45, y, z + 1], [0.9, y - 0.05, z - 0.3], [-0.55, y - 0.05, z - 0.25],
        [-1.1, y, z + 0.95]);
      meshPart(firing, roundBox(0.45, 0.62, 0.9, 4), mats().polymer, [1.85, y, z + 0.95]);
    }
    digit(firing, "glove", 0.41, [1.35, -0.85, 0.5], [1.05, -0.8, -1.3], [0.45, -0.95, -2.2]);
    digit(firing, "glove", 0.62, [1.1, -1.5, 3.5], [0, -0.8, 2.9], [-0.9, -0.6, 1.7]);
    digit(firing, "glove", 0.47, [-0.9, -0.6, 1.7], [-1.08, -0.55, 0.2]);
  }
  {
    const support = joint(g, "support_sleeve", [0, 0, 0]);
    forearm(support, team);
    support.userData.elbow = pistol ? new THREE.Vector3(-8, -13, 9) : new THREE.Vector3(-14, -5, 7);
    const hand = joint(g, "support_hand", supportGrip(id));
    const supGlb = cloneHandGlb(pistol ? "hand_pistol_l" : "hand_rifle_l");
    if (supGlb) {
      hand.add(supGlb);
    } else if (pistol) {
      palm(hand, [-1, -1.8, 1.4], [-0.75, 0.9, -0.2], [-1, 0, 0.2], 3.2, 1.2);
      for (let i = 0; i < 4; ++i) {
        const y = 1.5 - i * 0.8, z = -1 + i * 0.28;
        digit(hand, "glove", 0.4, [-0.4, y, z + 0.6], [0.7, y, z - 0.45], [1.9, y, z - 0.35], [2.5, y, z + 0.6]);
      }
      digit(hand, "glove", 0.5, [-0.7, 1.4, 1.3], [-0.3, 2.4, 0], [-0.2, 2.5, -1.3]);
    } else {
      palm(hand, [-1, -1.8, 1.4], [0.9, 0.2, -0.1], [0, -1, 0.3], 3.7, 1.2);
      digit(hand, "glove", 0.5, [-1, 0, 0.8], [-1.75, 1.3, -0.3], [-1.65, 1.9, -1.6]);
      for (let i = 0; i < 4; ++i) {
        const z = -1.3 + i * 0.85;
        digit(hand, "glove", 0.4, [1.2, 0.2, z], [1.8, 1.2, z], [1.6, 2.2, z - 0.05], [1.05, 2.75, z - 0.1]);
      }
    }
    poseSupportSleeve(support, hand);
  }
  if (!gunHand) batchParts(g);
  return g;
}

const wrist = new THREE.Vector3();

/** Keep the sleeve attached to the wrist as the support hand reaches/reloads. */
export function poseSupportSleeve(sleeve: THREE.Object3D, hand: THREE.Object3D): void {
  wrist.set(-1, -1.8, 1.4).applyQuaternion(hand.quaternion).add(hand.position);
  aimForearm(sleeve, sleeve.userData.elbow as THREE.Vector3, wrist);
}
