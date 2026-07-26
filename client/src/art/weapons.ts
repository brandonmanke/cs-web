import * as THREE from "three";
import { canvasTexture, fill, grain, stains } from "./textures";

// Procedural weapon models. Each is a handful of boxes — the PSX budget — but
// the silhouettes are deliberately distinct, because at viewmodel scale the
// outline is the only thing a player actually reads.
//
// Local space: barrel points -Z (camera forward), +Y up, origin at the grip.
// Units are GoldSrc inches, so an AK really is ~35u long.

export const WeaponId = {
  none: 0,
  knife: 1,
  usp: 2,
  glock: 3,
  ak47: 4,
  m4a1: 5,
  awp: 6,
  mp5: 7,
} as const;

function gunmetal(): THREE.CanvasTexture {
  return canvasTexture(32, 5150, (c) => {
    fill(c, "#2e3134");
    grain(c, 26, 1);
    stains(c, 5, "#101214", 8);
  });
}

function polymer(): THREE.CanvasTexture {
  return canvasTexture(32, 7, (c) => {
    fill(c, "#1d1f21");
    grain(c, 16, 1);
  });
}

function woodGrain(): THREE.CanvasTexture {
  return canvasTexture(32, 99, (c) => {
    fill(c, "#6b4526");
    c.ctx.fillStyle = "rgba(0,0,0,0.28)";
    for (let y = 0; y < 32; y += 5) c.ctx.fillRect(0, y, 32, 1);
    grain(c, 22, 1);
  });
}

let materials: {
  metal: THREE.MeshLambertMaterial;
  polymer: THREE.MeshLambertMaterial;
  wood: THREE.MeshLambertMaterial;
  glass: THREE.MeshLambertMaterial;
} | null = null;

function mats() {
  if (!materials) {
    materials = {
      metal: new THREE.MeshLambertMaterial({ map: gunmetal() }),
      polymer: new THREE.MeshLambertMaterial({ map: polymer() }),
      wood: new THREE.MeshLambertMaterial({ map: woodGrain() }),
      glass: new THREE.MeshLambertMaterial({ color: 0x8fb4c8, emissive: 0x16242c }),
    };
  }
  return materials;
}

type MatKey = "metal" | "polymer" | "wood" | "glass";

/** Box with explicit centre, the only primitive these models need. */
function part(group: THREE.Group, mat: MatKey, size: [number, number, number],
              at: [number, number, number], rotX = 0): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mats()[mat]);
  mesh.position.set(...at);
  if (rotX !== 0) mesh.rotation.x = rotX;
  group.add(mesh);
}

/** Grip + trigger guard, shared by everything that isn't a knife. */
function addGrip(group: THREE.Group, mat: MatKey = "polymer"): void {
  part(group, mat, [2.4, 7, 3.2], [0, -3.5, 1.2], 0.22);
  part(group, "metal", [1.6, 2.4, 4], [0, -0.6, -0.6]);
}

function ak47(): THREE.Group {
  const g = new THREE.Group();
  part(g, "metal", [2.6, 3.4, 15], [0, 0.8, -3]);      // receiver
  part(g, "metal", [1.1, 1.1, 13], [0, 1.6, -16]);     // barrel
  part(g, "wood", [2.4, 2.6, 8], [0, 0.6, -11]);       // handguard
  part(g, "metal", [1.4, 2.2, 5], [0, 3.0, -14]);      // gas block
  part(g, "wood", [2.2, 3.2, 8], [0, -0.4, 8], 0.12);  // stock
  part(g, "metal", [1.8, 6.5, 3.4], [0, -3.2, -2.4], -0.35); // curved mag
  part(g, "metal", [0.6, 1.6, 0.6], [0, 3.4, -21]);    // front sight
  part(g, "metal", [1.8, 0.8, 1.2], [0, 3.2, -5]);     // rear sight
  addGrip(g, "wood");
  return g;
}

function m4a1(): THREE.Group {
  const g = new THREE.Group();
  part(g, "polymer", [2.4, 3.2, 14], [0, 0.8, -2]);
  part(g, "metal", [1.0, 1.0, 14], [0, 1.4, -15]);
  part(g, "polymer", [2.6, 2.8, 9], [0, 1.0, -10]);    // round handguard
  part(g, "metal", [1.4, 1.4, 4], [0, 1.4, -23]);      // suppressor
  part(g, "polymer", [2.0, 2.6, 9], [0, 0.4, 8]);      // tube stock
  part(g, "polymer", [1.8, 6, 3], [0, -3.2, -1.8]);    // straight mag
  part(g, "metal", [1.6, 1.4, 10], [0, 3.0, -4]);      // carry handle
  part(g, "metal", [0.6, 2.0, 0.6], [0, 3.4, -20]);
  addGrip(g);
  return g;
}

function awp(): THREE.Group {
  const g = new THREE.Group();
  part(g, "polymer", [2.6, 3.4, 18], [0, 0.6, -2]);
  part(g, "metal", [1.3, 1.3, 20], [0, 1.4, -19]);     // long heavy barrel
  part(g, "polymer", [2.8, 3.0, 12], [0, -0.6, 10], 0.05); // thumbhole stock
  part(g, "polymer", [1.6, 3.0, 2.6], [0, -2.6, -1]);
  part(g, "metal", [1.6, 1.6, 9], [0, 3.6, -6]);       // scope tube
  part(g, "glass", [1.4, 1.4, 0.4], [0, 3.6, -10.6]);  // objective lens
  part(g, "metal", [1.0, 1.0, 1.6], [0, 3.6, -1.4]);
  part(g, "metal", [1.2, 1.2, 3], [0, 2.4, 1]);        // bolt
  addGrip(g);
  return g;
}

function mp5(): THREE.Group {
  const g = new THREE.Group();
  part(g, "polymer", [2.4, 3.0, 11], [0, 0.8, -2]);
  part(g, "metal", [1.2, 1.2, 7], [0, 1.4, -10]);
  part(g, "polymer", [2.4, 2.4, 6], [0, 1.0, -8]);
  part(g, "metal", [1.8, 2.0, 7], [0, 0.2, 6]);        // retractable stock
  part(g, "metal", [1.6, 6.5, 2.6], [0, -3.2, -2.6], -0.12);
  part(g, "metal", [1.4, 1.8, 1.4], [0, 3.0, -12]);    // hooded front sight
  addGrip(g);
  return g;
}

function pistol(slide: [number, number, number], suppressed: boolean): THREE.Group {
  const g = new THREE.Group();
  part(g, "metal", slide, [0, 1.4, -2.2]);
  part(g, "polymer", [1.9, 2.2, 5], [0, -0.4, -0.6]);
  part(g, "polymer", [1.9, 6, 2.6], [0, -3.6, 1.4], 0.16); // grip + mag well
  part(g, "metal", [1.4, 1.2, 3], [0, -0.4, -3.4]);
  if (suppressed) part(g, "metal", [1.5, 1.5, 6], [0, 1.4, -8.5]);
  part(g, "metal", [0.5, 0.9, 0.5], [0, 2.7, -5.4]);
  return g;
}

function knife(): THREE.Group {
  const g = new THREE.Group();
  part(g, "polymer", [1.6, 2.0, 5], [0, -1.2, 1.5]);   // handle
  part(g, "metal", [1.8, 0.5, 1.6], [0, 0.2, -1.2]);   // guard
  part(g, "metal", [0.5, 1.9, 9], [0, 0.4, -6]);       // blade
  part(g, "metal", [0.6, 0.9, 3], [0, 1.0, -9.5], 0.2); // clip point
  return g;
}

export function buildWeapon(id: number): THREE.Group {
  switch (id) {
    case WeaponId.ak47: return ak47();
    case WeaponId.m4a1: return m4a1();
    case WeaponId.awp: return awp();
    case WeaponId.mp5: return mp5();
    case WeaponId.usp: return pistol([1.8, 2.2, 9], true);
    case WeaponId.glock: return pistol([1.9, 2.4, 8], false);
    case WeaponId.knife: return knife();
    default: return ak47();
  }
}

/** Muzzle offset in weapon space, so flashes and tracers start at the barrel. */
export function muzzleOffset(id: number): [number, number, number] {
  switch (id) {
    case WeaponId.ak47: return [0, 1.6, -22.5];
    case WeaponId.m4a1: return [0, 1.4, -25];
    case WeaponId.awp: return [0, 1.4, -29];
    case WeaponId.mp5: return [0, 1.4, -13.5];
    case WeaponId.usp: return [0, 1.4, -11.5];
    case WeaponId.glock: return [0, 1.4, -6.5];
    case WeaponId.knife: return [0, 0.4, -10];
    default: return [0, 1.4, -20];
  }
}

/**
 * Gloved forearms so the weapon doesn't float: a trigger hand reaching in from
 * the camera and a support hand further down the handguard.
 */
export function buildArms(): THREE.Group {
  const g = new THREE.Group();
  const glove = new THREE.MeshLambertMaterial({ map: polymer() });

  const trigger = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 15), glove);
  trigger.position.set(1.8, -5.2, 6.5);
  trigger.rotation.set(-0.18, 0.06, 0.1);
  g.add(trigger);

  const support = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.2, 13), glove);
  support.position.set(-1.4, -4.4, -5.5);
  support.rotation.set(0.22, -0.1, -0.12);
  g.add(support);

  return g;
}
