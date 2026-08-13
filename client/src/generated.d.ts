// Type surface of the Emscripten module emitted by `npm run wasm` into
// client/src/generated/sim.mjs (gitignored build artifact).
declare module "*/generated/sim.mjs" {
  export interface SimModule {
    HEAPF32: Float32Array;
    HEAPU32: Uint32Array;
    HEAP32: Int32Array;
    _malloc(bytes: number): number;
    _free(ptr: number): void;
    _sim_create(): void;
    _sim_world_reset(): void;
    _sim_add_box(
      minX: number, minY: number, minZ: number,
      maxX: number, maxY: number, maxZ: number,
      material: number,
    ): void;
    _sim_add_brush(planesPtr: number, planeCount: number, material: number): number;
    _sim_world_finalize(): void;
    _sim_trace_ray(
      startX: number, startY: number, startZ: number,
      endX: number, endY: number, endZ: number,
      outPtr: number,
    ): number;
    _sim_add_spawn(x: number, y: number, z: number, yaw: number, team: number): void;
    _sim_start_match(mode: number, botCount: number, skill: number): void;
    _sim_add_bot(
      x: number, y: number, z: number, yaw: number,
      team: number, skill: number,
    ): number;
    _sim_spawn(x: number, y: number, z: number, yaw: number): void;
    _sim_step(
      forward: number, strafe: number, yaw: number, pitch: number,
      buttons: number, weapon: number,
    ): void;
    _sim_snapshot(): number;
    _sim_snapshot_bytes(): number;
  }
  const createSimModule: () => Promise<SimModule>;
  export default createSimModule;
}
