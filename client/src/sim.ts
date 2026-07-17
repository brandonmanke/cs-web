import createSimModule, { type SimModule } from "./generated/sim.mjs";

// Mirrors cs::SimSnapshot in sim/include/cs/sim.h: 4-byte fields only, so the
// layout is a flat array of 32-bit words.
const WORDS = {
  tick: 1,
  origin: 2,
  velocity: 5,
  eyeHeight: 8,
  speedH: 9,
  stamina: 10,
  flags: 11,
  weapon: 12,
  magazine: 13,
  reserve: 14,
  cooldown: 15,
  reload: 16,
  punchPitch: 17,
  punchYaw: 18,
  kills: 19,
  hits: 20,
  shots: 21,
  shotSequence: 22,
  shotResult: 23,
  shotHitGroup: 24,
  shotTarget: 25,
  shotMaterial: 26,
  shotDamage: 27,
  shotStart: 28,
  shotEnd: 31,
  targetCount: 34,
  targets: 35, // 6 words per target
} as const;
const SNAPSHOT_WORDS = 35 + 8 * 6;

export const Buttons = {
  jump: 1 << 0,
  duck: 1 << 1,
  fire: 1 << 2,
  reload: 1 << 3,
} as const;

export const ShotResult = {
  none: 0,
  world: 1,
  miss: 2,
  hit: 3,
  kill: 4,
  dry: 5,
} as const;

export const Flags = {
  onGround: 1 << 0,
  ducked: 1 << 1,
} as const;

export interface TargetView {
  x: number; y: number; z: number;
  health: number;
  alive: boolean;
  flash: number;
}

export class Snapshot {
  tick = 0;
  origin: [number, number, number] = [0, 0, 0];
  eyeHeight = 64;
  speedH = 0;
  flags = 0;
  weapon = 0;
  magazine = 0;
  reserve = 0;
  reload = 0;
  punchPitch = 0;
  punchYaw = 0;
  kills = 0;
  hits = 0;
  shots = 0;
  shotSequence = 0;
  shotResult = 0;
  shotStart: [number, number, number] = [0, 0, 0];
  shotEnd: [number, number, number] = [0, 0, 0];
  targetCount = 0;
  targets: TargetView[] = Array.from({ length: 8 }, () => ({
    x: 0, y: 0, z: 0, health: 0, alive: false, flash: 0,
  }));

  copyFrom(other: Snapshot): void {
    this.tick = other.tick;
    this.origin[0] = other.origin[0];
    this.origin[1] = other.origin[1];
    this.origin[2] = other.origin[2];
    this.eyeHeight = other.eyeHeight;
  }
}

export interface InputFrame {
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  buttons: number;
  weapon: number;
}

export class Sim {
  private constructor(
    private readonly m: SimModule,
    private readonly snapshotWord: number,
  ) {}

  static async load(): Promise<Sim> {
    const m = await createSimModule();
    m._sim_create();
    const bytes = m._sim_snapshot_bytes();
    if (bytes !== SNAPSHOT_WORDS * 4) {
      throw new Error(`snapshot layout mismatch: wasm=${bytes}B ts=${SNAPSHOT_WORDS * 4}B`);
    }
    return new Sim(m, m._sim_snapshot() >> 2);
  }

  addBox(min: readonly number[], max: readonly number[], material: number): void {
    this.m._sim_add_box(min[0]!, min[1]!, min[2]!, max[0]!, max[1]!, max[2]!, material);
  }

  addHull(points: Float32Array, material: number): void {
    const ptr = this.m._malloc(points.byteLength);
    this.m.HEAPF32.set(points, ptr >> 2);
    this.m._sim_add_hull(ptr, points.length / 3, material);
    this.m._free(ptr);
  }

  addMesh(vertices: Float32Array, indices: Uint32Array, material: number): boolean {
    const vPtr = this.m._malloc(vertices.byteLength);
    this.m.HEAPF32.set(vertices, vPtr >> 2);
    const iPtr = this.m._malloc(indices.byteLength);
    this.m.HEAPU32.set(indices, iPtr >> 2);
    const ok = this.m._sim_add_mesh(vPtr, vertices.length / 3, iPtr, indices.length / 3, material);
    this.m._free(iPtr);
    this.m._free(vPtr);
    return ok !== 0;
  }

  finalizeWorld(): void {
    this.m._sim_world_finalize();
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.m._sim_spawn(x, y, z, yaw);
  }

  addTarget(x: number, y: number, z: number, minX: number, maxX: number, speed: number): void {
    this.m._sim_add_target(x, y, z, minX, maxX, speed);
  }

  step(input: InputFrame): void {
    this.m._sim_step(input.forward, input.strafe, input.yaw, input.pitch, input.buttons, input.weapon);
  }

  read(out: Snapshot): void {
    // Re-grab views each read: memory growth invalidates cached typed arrays.
    const f32 = this.m.HEAPF32;
    const u32 = this.m.HEAPU32;
    const w = this.snapshotWord;
    out.tick = u32[w + WORDS.tick]!;
    out.origin[0] = f32[w + WORDS.origin]!;
    out.origin[1] = f32[w + WORDS.origin + 1]!;
    out.origin[2] = f32[w + WORDS.origin + 2]!;
    out.eyeHeight = f32[w + WORDS.eyeHeight]!;
    out.speedH = f32[w + WORDS.speedH]!;
    out.flags = u32[w + WORDS.flags]!;
    out.weapon = u32[w + WORDS.weapon]!;
    out.magazine = u32[w + WORDS.magazine]!;
    out.reserve = u32[w + WORDS.reserve]!;
    out.reload = u32[w + WORDS.reload]!;
    out.punchPitch = f32[w + WORDS.punchPitch]!;
    out.punchYaw = f32[w + WORDS.punchYaw]!;
    out.kills = u32[w + WORDS.kills]!;
    out.hits = u32[w + WORDS.hits]!;
    out.shots = u32[w + WORDS.shots]!;
    out.shotSequence = u32[w + WORDS.shotSequence]!;
    out.shotResult = u32[w + WORDS.shotResult]!;
    for (let i = 0; i < 3; ++i) {
      out.shotStart[i] = f32[w + WORDS.shotStart + i]!;
      out.shotEnd[i] = f32[w + WORDS.shotEnd + i]!;
    }
    out.targetCount = u32[w + WORDS.targetCount]!;
    for (let t = 0; t < 8; ++t) {
      const base = w + WORDS.targets + t * 6;
      const view = out.targets[t]!;
      view.x = f32[base]!;
      view.y = f32[base + 1]!;
      view.z = f32[base + 2]!;
      view.health = f32[base + 3]!;
      view.alive = u32[base + 4]! !== 0;
      view.flash = u32[base + 5]!;
    }
  }
}
