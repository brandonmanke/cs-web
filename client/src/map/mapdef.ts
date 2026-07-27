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

export interface MapDef {
  name: string;
  brushes: Brush[];
  lights: MapLight[];
  /** Floor lighting level everywhere; keep low so the baked lights read. */
  ambient: [number, number, number];
  /** cs::GameMode the map is authored for. */
  mode: number;
  /** Bots to fill the server with. Capped at cs::kMaxPlayers - 1. */
  bots: number;
  /** At least one; the first doubles as the dev/fallback spawn. */
  spawns: SpawnDef[];
  background: number;
  fog: [number, number];
}
