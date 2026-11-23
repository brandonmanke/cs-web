import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { PropKey } from "../map/mapdef";

// Central asset loader for CC0 / original binary assets under `client/public/assets/`.
// All provenance and licenses are tracked in PROVENANCE.md.
//
// In headless Node tests (mapcheck, test:art) there is no DOM fetch/Image
// pipeline; preloadAssets() detects that and becomes a no-op, so every system
// falls back cleanly to its lightweight procedural stand-in.

/** GoldSrc units per metre (1u = 1 inch). */
const UNITS_PER_METER = 39.3701;

/** Photo-sourced world & material textures loaded from `/assets/textures/`. */
export const PHOTO_TEXTURE_KEYS = [
  "concrete",
  "concrete_dark",
  "brick",
  "sandstone",
  "plaster",
  "dust_wall",
  "industrial_wall",
  "wood_door",
  "sand",
  "asphalt",
  "metal",
  "rust",
  "corrugated",
  "shutter",
  "grate",
  "wood",
  "crate",
  "crate_wood",
  "container",
  "alloy",
  "deck",
  "tech",
] as const;

export type PhotoTextureKey = (typeof PHOTO_TEXTURE_KEYS)[number];

const loadedTextures = new Map<string, THREE.Texture>();
let loadedDetail: THREE.Texture | null = null;
const loadedModels = new Map<string, THREE.Group>();
let preloaded = false;

function hasBrowserDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof Image !== "undefined";
}

function loadTexture(loader: THREE.TextureLoader, url: string, srgb = true): Promise<THREE.Texture | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = 8;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null),
    );
  });
}

function loadGlb(loader: GLTFLoader, url: string): Promise<THREE.Group | null> {
  return new Promise((resolve) => {
    loader.load(
      url,
      (gltf) => resolve(gltf.scene),
      undefined,
      () => resolve(null),
    );
  });
}

/**
 * Normalise a Poly Haven GLB prop (metres, Y-up) into GoldSrc inches with its
 * base resting on y = 0 and X/Z centred.
 */
function prepareProp(raw: THREE.Group, key: PropKey): THREE.Group {
  const root = new THREE.Group();
  root.name = `prop:${key}`;
  raw.scale.setScalar(UNITS_PER_METER);
  raw.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(raw);
  const center = box.getCenter(new THREE.Vector3());
  // Ceiling lamps hang from y = 0 down; floor props stand on y = 0.
  if (key === "lamp_ind") {
    raw.position.set(-center.x, -box.max.y, -center.z);
  } else {
    raw.position.set(-center.x, -box.min.y, -center.z);
  }
  root.add(raw);
  return root;
}

/**
 * Normalise a Poly Haven GLB firearm into our weapon-local frame:
 * GoldSrc inches (1u = 1 inch), barrel pointing -Z, +Y up, grip near [0, 0, 0].
 * Strips loose demo parts (extra variant pistols, floating cartridges) so only
 * the single assembled weapon renders.
 */
function prepareWeaponGlb(raw: THREE.Group, key: "awp" | "pistol"): THREE.Group {
  const root = new THREE.Group();
  root.name = `glb:${key}`;

  // Strip stray showcase objects bundled in Poly Haven multi-variant scenes.
  const drop: THREE.Object3D[] = [];
  raw.traverse((obj) => {
    const n = obj.name.toLowerCase();
    if (key === "pistol") {
      if (n.endsWith("_b") || n.includes("magazine_empty") || n.includes("bullet") || n.includes("magazine_loaded")) {
        drop.push(obj);
      }
    } else if (key === "awp") {
      if (n.includes("bullet")) drop.push(obj);
    }
  });
  for (const obj of drop) obj.parent?.remove(obj);

  // Poly Haven firearms point along +X; rotate +90° around Y so barrel faces -Z.
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI / 2;
  holder.scale.setScalar(UNITS_PER_METER);
  holder.add(raw);
  holder.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(holder);
  const center = box.getCenter(new THREE.Vector3());
  if (key === "pistol") {
    // Align trigger (raw y≈1.02, z≈-2.07) onto the firing finger (y=-0.85, z=-1.7),
    // putting the barrel bore cleanly at y=+0.58 and muzzle face at z=-6.47.
    holder.position.set(-center.x, -1.87, 0.37);
  } else {
    // Align bolt-action trigger (raw y≈-0.41, z≈+11.36) onto the firing finger
    // (y=-0.85, z=-1.7) so the stock, grip and fore-end sit naturally in both hands.
    holder.position.set(-center.x, -0.44, -13.06);
  }
  root.add(holder);
  return root;
}

/**
 * Preload all photo textures, detail map, and GLB props/weapons in parallel.
 * Safe to call multiple times; a no-op outside the browser.
 */
export async function preloadAssets(): Promise<void> {
  if (preloaded || !hasBrowserDom()) return;
  preloaded = true;

  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();

  const texPromises = PHOTO_TEXTURE_KEYS.map(async (key) => {
    const tex = await loadTexture(texLoader, `/assets/textures/${key}.jpg`, true);
    if (tex) loadedTextures.set(key, tex);
  });

  const detailPromise = loadTexture(texLoader, "/assets/textures/detail.jpg", false).then((tex) => {
    loadedDetail = tex;
  });

  const propKeys: PropKey[] = ["barrel", "crate_wood", "crate_mil", "ammo_box", "lamp_ind"];
  const propPromises = propKeys.map(async (key) => {
    const raw = await loadGlb(gltfLoader, `/assets/models/${key}.glb`);
    if (raw) loadedModels.set(key, prepareProp(raw, key));
  });

  const weaponKeys: Array<"awp" | "pistol"> = ["awp", "pistol"];
  const weaponPromises = weaponKeys.map(async (key) => {
    const raw = await loadGlb(gltfLoader, `/assets/models/${key}.glb`);
    if (raw) loadedModels.set(`weapon:${key}`, prepareWeaponGlb(raw, key));
  });

  await Promise.all([...texPromises, detailPromise, ...propPromises, ...weaponPromises]);
}

export function getPhotoTexture(key: string): THREE.Texture | null {
  return loadedTextures.get(key) ?? null;
}

export function getDetailTexture(): THREE.Texture | null {
  return loadedDetail;
}

/**
 * Clone a preloaded static prop GLB with per-instance material copies so each
 * placed prop can be tinted cleanly by the map's baked lighting at its origin.
 */
export function clonePropModel(key: PropKey): THREE.Group | null {
  const template = loadedModels.get(key);
  if (!template) return null;
  const clone = template.clone(true);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
    }
  });
  return clone;
}

/** Clone a preloaded GLB firearm if available (null in headless tests or for procedural guns). */
export function cloneWeaponGlb(key: "awp" | "pistol"): THREE.Group | null {
  const template = loadedModels.get(`weapon:${key}`);
  if (!template) return null;
  const clone = template.clone(true);
  clone.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
    }
  });
  return clone;
}
