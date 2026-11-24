import type { Brush, Vec3 } from "./brush";
import type { MapLight } from "./build";

/**
 * A place the sim may drop a player. `pos` is a hull centre, so it sits
 * kHullHalfHeightStand (36u) above the floor plus a little clearance — the
 * same convention sim_spawn uses. `team` 0 means anyone may use it.
 */
export interface SpawnDef {
  pos: Vec3;
  yaw: number;
  team?: number; // cs::Team
}

/** GoldSrc `light_environment`: directional sunlight + hemisphere sky fill. */
export interface SunLight {
  /** Unit vector pointing TOWARD the sun. */
  dir: Vec3;
  color: [number, number, number];
  intensity: number;
  /** Cool fill for shaded outdoor areas that can still see the open sky. */
  skyColor: [number, number, number];
  skyIntensity: number;
}

export type PropKey = "barrel" | "crate_wood" | "crate_mil" | "ammo_box" | "lamp_ind";

/** Non-solid (or clip-wrapped) 3D GLB prop placed in the map. */
export interface PropDef {
  model: PropKey;
  pos: Vec3;
  yaw: number;
  scale?: number;
}

export type MapDecalKind = "site_a" | "site_b" | "arrow_l" | "arrow_r" | "grime";

/** Painted wall/floor overlay (bombsite stencils, arrows, grime). */
export interface MapDecalDef {
  kind: MapDecalKind;
  pos: Vec3;
  normal: Vec3;
  size: number;
  rotation?: number;
}

export interface MapDef {
  name: string;
  brushes: Brush[];
  lights: MapLight[];
  /** Optional directional sun + sky hemisphere (GoldSrc light_environment). */
  sun?: SunLight;
  /** Floor lighting level everywhere; keep low so the baked lights read. */
  ambient: [number, number, number];
  /** cs::GameMode the map is authored for. */
  mode: number;
  /** Bots to fill the server with. Capped at cs::kMaxPlayers - 1. */
  bots: number;
  /** At least one; the first doubles as the dev/fallback spawn. */
  spawns: SpawnDef[];
  /** Optional static 3D props (.glb) placed around the level. */
  props?: PropDef[];
  /** Optional painted decals (site markers, arrows, stains). */
  decals?: MapDecalDef[];
  background: number;
  /** Optional procedural sky; maps without one keep their solid background. */
  sky?: "orbital" | "dusk" | "desert";
  fog: [number, number];
}
