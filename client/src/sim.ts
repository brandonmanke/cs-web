import createSimModule, { type SimModule } from "./generated/sim.mjs";

// Mirrors cs::SimSnapshot in sim/include/cs/sim.h: 4-byte fields only, so the
// layout is a flat array of 32-bit words.
export const MAX_PLAYERS = 10; // cs::kMaxPlayers
const MAX_EVENTS = 8; // cs::kMaxEvents
const API_VERSION = 2; // cs::kSimApiVersion

/** cs::kTickSeconds. Anything converting snapshot deltas to rates needs this. */
export const TICK_SECONDS = 1 / 64;
/** cs::kBaseFov — the unscoped vertical-ish field of view the camera starts at. */
export const BASE_FOV = 90;

const PLAYER_WORDS = 14; // cs::PlayerSnapshot
const EVENT_WORDS = 14;  // cs::SimEvent

export const WORDS = {
  apiVersion: 0,
  tick: 1,
  mode: 2,
  localIndex: 3,
  origin: 4,
  velocity: 7,
  eyeHeight: 10,
  speedH: 11,
  stamina: 12,
  fov: 13,
  flags: 14,
  zoom: 15,
  weapon: 16,
  magazine: 17,
  reserve: 18,
  cooldown: 19,
  reload: 20,
  punchPitch: 21,
  punchYaw: 22,
  health: 23,
  respawnTicks: 24,
  kills: 25,
  deaths: 26,
  hits: 27,
  shots: 28,
  teamScore: 29, // 3 words
  playerCount: 32,
  eventCount: 33,
  players: 34, // PLAYER_WORDS per player
  events: 34 + MAX_PLAYERS * PLAYER_WORDS,
} as const;
const SNAPSHOT_WORDS = WORDS.events + MAX_EVENTS * EVENT_WORDS;

export const Buttons = {
  jump: 1 << 0,
  duck: 1 << 1,
  fire: 1 << 2,
  reload: 1 << 3,
  walk: 1 << 4,
  zoom: 1 << 5,
} as const;

export const Flags = {
  onGround: 1 << 0,
  ducked: 1 << 1,
  alive: 1 << 2,
} as const;

export const ShotResult = {
  none: 0,
  world: 1,
  miss: 2,
  hit: 3,
  kill: 4,
  dry: 5,
} as const;

export const EventKind = {
  none: 0,
  shot: 1,
  death: 2,
} as const;

// cs::Team
export const Team = {
  none: 0,
  t: 1,
  ct: 2,
} as const;

// cs::GameMode
export const Mode = {
  range: 0,
  deathmatch: 1,
  team: 2,
} as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

export interface TraceHit {
  point: [number, number, number];
  normal: [number, number, number];
}

export interface PlayerView {
  x: number; y: number; z: number;
  yaw: number;
  pitch: number;
  health: number;
  speedH: number;
  team: number;
  flags: number;
  weapon: number;
  kills: number;
  deaths: number;
  flash: number;
  isBot: boolean;
}

export interface EventView {
  kind: number;
  actor: number;
  victim: number;
  result: number;
  hitGroup: number;
  material: number;
  weapon: number;
  damage: number;
  start: [number, number, number];
  end: [number, number, number];
}

function emptyPlayer(): PlayerView {
  return {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 0, speedH: 0,
    team: 0, flags: 0, weapon: 0, kills: 0, deaths: 0, flash: 0, isBot: false,
  };
}

function emptyEvent(): EventView {
  return {
    kind: 0, actor: 0, victim: 0, result: 0, hitGroup: 0, material: 0,
    weapon: 0, damage: 0, start: [0, 0, 0], end: [0, 0, 0],
  };
}

export class Snapshot {
  tick = 0;
  mode: number = Mode.range;
  localIndex = 0;
  origin: [number, number, number] = [0, 0, 0];
  eyeHeight = 64;
  speedH = 0;
  fov = BASE_FOV;
  flags = 0;
  zoom = 0;
  weapon = 0;
  magazine = 0;
  reserve = 0;
  reload = 0;
  punchPitch = 0;
  punchYaw = 0;
  health = 100;
  respawnTicks = 0;
  kills = 0;
  deaths = 0;
  hits = 0;
  shots = 0;
  teamScore: [number, number, number] = [0, 0, 0];
  playerCount = 0;
  eventCount = 0;
  players: PlayerView[] = Array.from({ length: MAX_PLAYERS }, emptyPlayer);
  events: EventView[] = Array.from({ length: MAX_EVENTS }, emptyEvent);

  /**
   * Copies the fields the renderer interpolates between ticks. Anything drawn
   * at a position that changes per tick belongs here — omit it and that object
   * snaps at 64 Hz while the camera runs smooth, which reads as shimmer.
   */
  copyFrom(other: Snapshot): void {
    this.tick = other.tick;
    this.origin[0] = other.origin[0];
    this.origin[1] = other.origin[1];
    this.origin[2] = other.origin[2];
    this.eyeHeight = other.eyeHeight;
    this.playerCount = other.playerCount;
    for (let i = 0; i < MAX_PLAYERS; ++i) {
      const from = other.players[i]!;
      const to = this.players[i]!;
      to.x = from.x;
      to.y = from.y;
      to.z = from.z;
      to.yaw = from.yaw;
      to.pitch = from.pitch;
      to.team = from.team;
      to.flags = from.flags;
      to.flash = from.flash;
      to.weapon = from.weapon;
    }
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
  /** Scratch for sim_trace_ray results: [fraction, end xyz, normal xyz]. */
  private readonly traceWord: number;

  private constructor(
    private readonly m: SimModule,
    private readonly snapshotWord: number,
  ) {
    this.traceWord = m._malloc(7 * 4) >> 2;
  }

  static async load(): Promise<Sim> {
    const m = await createSimModule();
    m._sim_create();
    const bytes = m._sim_snapshot_bytes();
    if (bytes !== SNAPSHOT_WORDS * 4) {
      throw new Error(`snapshot layout mismatch: wasm=${bytes}B ts=${SNAPSHOT_WORDS * 4}B`);
    }
    const snapshotWord = m._sim_snapshot() >> 2;
    // The size check alone misses same-size field reshuffles; the version word
    // is already plumbed through the snapshot, so make it earn its keep.
    const version = m.HEAPU32[snapshotWord + WORDS.apiVersion]!;
    if (version !== API_VERSION) {
      throw new Error(`sim API version mismatch: wasm=${version} ts=${API_VERSION}`);
    }
    return new Sim(m, snapshotWord);
  }

  addBox(min: readonly number[], max: readonly number[], material: number): void {
    this.m._sim_add_box(min[0]!, min[1]!, min[2]!, max[0]!, max[1]!, max[2]!, material);
  }

  /** planes: (nx, ny, nz, d) quads. Returns false if the brush is degenerate. */
  addBrush(planes: Float32Array, material: number): boolean {
    const ptr = this.m._malloc(planes.byteLength);
    this.m.HEAPF32.set(planes, ptr >> 2);
    const ok = this.m._sim_add_brush(ptr, planes.length / 4, material);
    this.m._free(ptr);
    return ok !== 0;
  }

  finalizeWorld(): void {
    this.m._sim_world_finalize();
  }

  /** True if the segment is blocked by world geometry. */
  isBlocked(from: readonly number[], to: readonly number[]): boolean {
    return this.m._sim_trace_ray(
      from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, this.traceWord << 2,
    ) !== 0;
  }

  /** Impact point and surface normal, or null on a miss. */
  traceRay(from: readonly number[], to: readonly number[]): TraceHit | null {
    const hit = this.m._sim_trace_ray(
      from[0]!, from[1]!, from[2]!, to[0]!, to[1]!, to[2]!, this.traceWord << 2,
    );
    if (hit === 0) return null;
    const f32 = this.m.HEAPF32;
    const w = this.traceWord;
    return {
      point: [f32[w + 1]!, f32[w + 2]!, f32[w + 3]!],
      normal: [f32[w + 4]!, f32[w + 5]!, f32[w + 6]!],
    };
  }

  addSpawn(origin: readonly number[], yaw: number, team: number): void {
    this.m._sim_add_spawn(origin[0]!, origin[1]!, origin[2]!, yaw, team);
  }

  /** Resets scores, fills the roster with bots and places everyone. */
  startMatch(mode: number, botCount: number, skill: number): void {
    this.m._sim_start_match(mode, botCount, skill);
  }

  spawn(x: number, y: number, z: number, yaw: number): void {
    this.m._sim_spawn(x, y, z, yaw);
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
    out.mode = u32[w + WORDS.mode]!;
    out.localIndex = u32[w + WORDS.localIndex]!;
    out.origin[0] = f32[w + WORDS.origin]!;
    out.origin[1] = f32[w + WORDS.origin + 1]!;
    out.origin[2] = f32[w + WORDS.origin + 2]!;
    out.eyeHeight = f32[w + WORDS.eyeHeight]!;
    out.speedH = f32[w + WORDS.speedH]!;
    out.fov = f32[w + WORDS.fov]!;
    out.flags = u32[w + WORDS.flags]!;
    out.zoom = u32[w + WORDS.zoom]!;
    out.weapon = u32[w + WORDS.weapon]!;
    out.magazine = u32[w + WORDS.magazine]!;
    out.reserve = u32[w + WORDS.reserve]!;
    out.reload = u32[w + WORDS.reload]!;
    out.punchPitch = f32[w + WORDS.punchPitch]!;
    out.punchYaw = f32[w + WORDS.punchYaw]!;
    out.health = f32[w + WORDS.health]!;
    out.respawnTicks = u32[w + WORDS.respawnTicks]!;
    out.kills = u32[w + WORDS.kills]!;
    out.deaths = u32[w + WORDS.deaths]!;
    out.hits = u32[w + WORDS.hits]!;
    out.shots = u32[w + WORDS.shots]!;
    for (let i = 0; i < 3; ++i) out.teamScore[i] = u32[w + WORDS.teamScore + i]!;
    out.playerCount = u32[w + WORDS.playerCount]!;

    for (let p = 0; p < MAX_PLAYERS; ++p) {
      const base = w + WORDS.players + p * PLAYER_WORDS;
      const view = out.players[p]!;
      view.x = f32[base]!;
      view.y = f32[base + 1]!;
      view.z = f32[base + 2]!;
      view.yaw = f32[base + 3]!;
      view.pitch = f32[base + 4]!;
      view.health = f32[base + 5]!;
      view.speedH = f32[base + 6]!;
      view.team = u32[base + 7]!;
      view.flags = u32[base + 8]!;
      view.weapon = u32[base + 9]!;
      view.kills = u32[base + 10]!;
      view.deaths = u32[base + 11]!;
      view.flash = u32[base + 12]!;
      view.isBot = u32[base + 13]! !== 0;
    }

    out.eventCount = u32[w + WORDS.eventCount]!;
    for (let e = 0; e < out.eventCount; ++e) {
      const base = w + WORDS.events + e * EVENT_WORDS;
      const view = out.events[e]!;
      view.kind = u32[base]!;
      view.actor = u32[base + 1]!;
      view.victim = u32[base + 2]!;
      view.result = u32[base + 3]!;
      view.hitGroup = u32[base + 4]!;
      view.material = u32[base + 5]!;
      view.weapon = u32[base + 6]!;
      view.damage = f32[base + 7]!;
      for (let i = 0; i < 3; ++i) {
        view.start[i] = f32[base + 8 + i]!;
        view.end[i] = f32[base + 11 + i]!;
      }
    }
  }
}
