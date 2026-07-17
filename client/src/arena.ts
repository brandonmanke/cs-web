// Greybox movement/aim arena. One data source feeds both the sim (collision)
// and the renderer, so what you see is exactly what you collide with.
// Units are GoldSrc units (1u = 1 inch), Y-up.

export interface BoxDef {
  min: [number, number, number];
  max: [number, number, number];
  mat: number; // cs::Material
}

export interface HullDef {
  points: number[]; // xyz triples, convex
  mat: number;
}

export interface TargetDef {
  x: number; y: number; z: number;
  minX: number; maxX: number;
  speed: number;
}

const CONCRETE = 0;
const WOOD = 1;
const METAL = 2;
const SAND = 3;

export const ARENA_BOXES: BoxDef[] = [
  // floor + perimeter walls
  { min: [-1024, -16, -1024], max: [1024, 0, 1024], mat: SAND },
  { min: [-1048, 0, -1048], max: [1048, 192, -1024], mat: CONCRETE },
  { min: [-1048, 0, 1024], max: [1048, 192, 1048], mat: CONCRETE },
  { min: [-1048, 0, -1024], max: [-1024, 192, 1024], mat: CONCRETE },
  { min: [1024, 0, -1024], max: [1048, 192, 1024], mat: CONCRETE },
  // jumpable 36u crate and a 64u crouch-jump crate
  { min: [-200, 0, -100], max: [-136, 36, -36], mat: WOOD },
  { min: [-320, 0, -100], max: [-256, 64, -36], mat: WOOD },
  // crate + stacked crate (36 + 36)
  { min: [140, 0, -160], max: [204, 36, -96], mat: WOOD },
  { min: [148, 36, -152], max: [204, 72, -104], mat: METAL },
  // stair set: 4 x 12u risers onto a 48u platform
  { min: [300, 0, -80], max: [332, 12, 80], mat: CONCRETE },
  { min: [332, 0, -80], max: [364, 24, 80], mat: CONCRETE },
  { min: [364, 0, -80], max: [396, 36, 80], mat: CONCRETE },
  { min: [396, 0, -80], max: [428, 48, 80], mat: CONCRETE },
  { min: [428, 0, -80], max: [560, 48, 80], mat: CONCRETE },
  // duck tunnel: 50u clearance between two blocks
  { min: [-560, 0, -64], max: [-536, 96, 64], mat: CONCRETE },
  { min: [-424, 0, -64], max: [-400, 96, 64], mat: CONCRETE },
  { min: [-536, 50, -64], max: [-424, 96, 64], mat: CONCRETE },
  // cover blocks near the target range
  { min: [-96, 0, -420], max: [96, 32, -388], mat: METAL },
  { min: [-620, 0, -520], max: [-460, 48, -360], mat: CONCRETE },
  { min: [460, 0, -520], max: [620, 48, -360], mat: CONCRETE },
];

// Wedge ramp: rises from y0 at z=200 to y64 at z=360, then a platform box above.
export const ARENA_HULLS: HullDef[] = [
  {
    points: [
      -80, 0, 200, 80, 0, 200,
      -80, 0, 360, 80, 0, 360,
      -80, 64, 360, 80, 64, 360,
    ],
    mat: CONCRETE,
  },
];
export const ARENA_RAMP_PLATFORM: BoxDef = { min: [-80, 0, 360], max: [80, 64, 440], mat: CONCRETE };
ARENA_BOXES.push(ARENA_RAMP_PLATFORM);

export const ARENA_SPAWN: [number, number, number] = [0, 38, 640];
export const ARENA_SPAWN_YAW = 0; // facing -Z, toward the target range

export const ARENA_TARGETS: TargetDef[] = [
  { x: 0, y: 0, z: -550, minX: 0, maxX: 0, speed: 0 },
  { x: -150, y: 0, z: -680, minX: -380, maxX: 60, speed: 90 },
  { x: 150, y: 0, z: -800, minX: -40, maxX: 380, speed: 150 },
];
