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

/** Photo-sourced & bespoke textures loaded from `/assets/textures/`. */
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
  // Character, first-person glove, and firearm surface sheets
  "ct_head",
  "t_head",
  "ct_vest",
  "t_vest",
  "ct_cloth",
  "t_cloth",
  "glove",
  "gunmetal",
  "ak_wood",
] as const;

export type PhotoTextureKey = (typeof PHOTO_TEXTURE_KEYS)[number];
export type WeaponGlbKey = "ak47" | "m4a1" | "mp5" | "knife" | "awp" | "pistol";
export type HandGlbKey =
  | "hand_gun_r"
  | "hand_rifle_l"
  | "hand_pistol_l"
  | "hand_knife_r"
  | "sleeve_ct"
  | "sleeve_t";
export type HeadgearGlbKey = "ct_gasmask";

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

function cloneWithOwnMaterials(template: THREE.Group): THREE.Group {
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

/**
 * Preload all photo textures, detail map, and GLB props/weapons/hands in parallel.
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

  // Weapons, hands, sleeves and headgear are pre-exported from Blender directly
  // in GoldSrc inches (1u = 1 inch, barrel/blade along -Z, +Y up).
  const weaponKeys: WeaponGlbKey[] = ["ak47", "m4a1", "mp5", "knife", "awp", "pistol"];
  const weaponPromises = weaponKeys.map(async (key) => {
    const raw = await loadGlb(gltfLoader, `/assets/models/${key}.glb`);
    if (raw) loadedModels.set(`weapon:${key}`, raw);
  });

  const handKeys: HandGlbKey[] = [
    "hand_gun_r", "hand_rifle_l", "hand_pistol_l", "hand_knife_r", "sleeve_ct", "sleeve_t",
  ];
  const handPromises = handKeys.map(async (key) => {
    const raw = await loadGlb(gltfLoader, `/assets/models/${key}.glb`);
    if (raw) loadedModels.set(`hand:${key}`, raw);
  });

  const headgearKeys: HeadgearGlbKey[] = ["ct_gasmask"];
  const headgearPromises = headgearKeys.map(async (key) => {
    const raw = await loadGlb(gltfLoader, `/assets/models/${key}.glb`);
    if (raw) loadedModels.set(`headgear:${key}`, raw);
  });

  await Promise.all([
    ...texPromises, detailPromise, ...propPromises, ...weaponPromises, ...handPromises, ...headgearPromises,
  ]);
}

export function getPhotoTexture(key: string): THREE.Texture | null {
  return loadedTextures.get(key) ?? null;
}

export function getDetailTexture(): THREE.Texture | null {
  return loadedDetail;
}

/** Clone a preloaded static prop GLB with per-instance material copies for tinting. */
export function clonePropModel(key: PropKey): THREE.Group | null {
  const template = loadedModels.get(key);
  return template ? cloneWithOwnMaterials(template) : null;
}

/** Clone a preloaded GLB firearm if available (null in headless tests). */
export function cloneWeaponGlb(key: WeaponGlbKey): THREE.Group | null {
  const template = loadedModels.get(`weapon:${key}`);
  return template ? cloneWithOwnMaterials(template) : null;
}

/** Clone a preloaded first-person sculpted gloved hand or BDU sleeve GLB. */
export function cloneHandGlb(key: HandGlbKey): THREE.Group | null {
  const template = loadedModels.get(`hand:${key}`);
  return template ? cloneWithOwnMaterials(template) : null;
}

/** Clone a preloaded operator headgear GLB (e.g. CT SAS respirator gas mask). */
export function cloneHeadgearGlb(key: HeadgearGlbKey): THREE.Group | null {
  const template = loadedModels.get(`headgear:${key}`);
  return template ? cloneWithOwnMaterials(template) : null;
}
