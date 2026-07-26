import type { Brush, Vec3 } from "./brush";
import type { MapLight } from "./build";

export interface TargetDef {
  x: number;
  y: number;
  z: number;
  minX: number;
  maxX: number;
  speed: number;
}

export interface MapDef {
  name: string;
  brushes: Brush[];
  lights: MapLight[];
  /** Floor lighting level everywhere; keep low so the baked lights read. */
  ambient: [number, number, number];
  spawn: Vec3;
  spawnYaw: number;
  targets: TargetDef[];
  background: number;
  fog: [number, number]; // near, far
}
