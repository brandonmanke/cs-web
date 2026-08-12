import { Mode } from "../../sim";
import { box, ramp, room, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";

// SILO — a tight free-for-all donut.
//
// One room, one full-height core, and a ring corridor around it. Nothing here
// has a sightline longer than half a lap, which is the point: foundry is the
// map you hold an angle on, this is the map you keep moving on. Two raised
// terraces on the east and west give height without giving anyone the whole
// room, and the only ways up are at diagonally opposite corners, so taking
// height always costs you the lap you were in the middle of.

const HALF = 512;
const CEIL = 384;
const CORE = 128;    // central block half-extent
const TERRACE = 144; // terrace surface height
const TERRACE_EDGE = 288;

const brushes: Brush[] = [];

// --- shell ------------------------------------------------------------------

brushes.push(...room([-HALF, 0, -HALF], [HALF, CEIL, HALF], 32, Surface.concrete,
                     "brick", "concrete_dark", "tech"));

// The core. Full height on purpose: a block you can see over is a block that
// doesn't break the room into a ring.
brushes.push(box([-CORE, 0, -CORE], [CORE, CEIL, CORE], Surface.metal, "rust"));

// Ribs and a mid band, so a 256-wide face of one texture doesn't read as a
// flat wall you can't judge distance against. Purely silhouette — they stand
// 12u proud, which is under the 18u step height and so never catches anyone.
for (const [x, z] of [[-CORE, -CORE], [CORE, -CORE], [-CORE, CORE], [CORE, CORE]]) {
  brushes.push(box([x! - 12, 0, z! - 12], [x! + 12, CEIL, z! + 12],
                   Surface.metal, "metal"));
}
brushes.push(
  box([-CORE - 10, 152, -CORE - 10], [CORE + 10, 176, CORE + 10],
      Surface.metal, "hazard"),
  box([-CORE - 8, 300, -CORE - 8], [CORE + 8, 316, CORE + 8],
      Surface.metal, "metal"),
);

// --- terraces ---------------------------------------------------------------

brushes.push(
  box([-HALF, 0, -HALF], [-TERRACE_EDGE, TERRACE, HALF], Surface.concrete,
      "concrete", { 2: "grate" }),
  box([TERRACE_EDGE, 0, -HALF], [HALF, TERRACE, HALF], Surface.concrete,
      "concrete", { 2: "grate" }),
);

// Toe-rails so the drop reads at speed, inset into the terrace top.
brushes.push(
  box([-TERRACE_EDGE - 8, TERRACE, -HALF], [-TERRACE_EDGE, TERRACE + 12, HALF],
      Surface.metal, "hazard"),
  box([TERRACE_EDGE, TERRACE, -HALF], [TERRACE_EDGE + 8, TERRACE + 12, HALF],
      Surface.metal, "hazard"),
);

// Ramps up, diagonally opposite: north-west onto the west terrace, south-east
// onto the east one.
//
// These were six 24u stairs, which is over the 18u step height — every one of
// them had to be jumped. Ramps rather than more steps because this is the map
// you keep moving on: a slope carries your speed and gives the terrace a
// run-up, where a staircase would still cost you the momentum. They reach
// further into the ring than the stairs did (224u of run for 144u of rise, so
// about 33 degrees) because that is what a walkable slope costs.
const RAMP_TOE = 64; // how far the foot of each ramp reaches past the core

brushes.push(
  ramp([-TERRACE_EDGE, 0, -HALF], [-RAMP_TOE, TERRACE, -352], "-x",
       Surface.metal, "metal"),
  ramp([RAMP_TOE, 0, 352], [TERRACE_EDGE, TERRACE, HALF], "+x",
       Surface.metal, "metal"),
);

// --- cover ------------------------------------------------------------------

brushes.push(
  box([-256, 0, -96], [-160, 64, 0], Surface.wood, "crate"),
  box([160, 0, 0], [256, 64, 96], Surface.wood, "crate"),
  box([-64, 0, -320], [64, 36, -224], Surface.wood, "crate"),
  box([-64, 0, 224], [64, 36, 320], Surface.wood, "crate"),
  box([-224, 0, 224], [-128, 72, 320], Surface.metal, "rust"),
  box([128, 0, -320], [224, 72, -224], Surface.metal, "rust"),
);

// --- lights -----------------------------------------------------------------

const FIXTURES: Array<[number, number]> = [
  [-384, -384], [384, -384], [-384, 384], [384, 384],
  [0, -352], [0, 352], [-352, 0], [352, 0],
];
for (const [x, z] of FIXTURES) {
  brushes.push(box([x - 64, CEIL - 10, z - 64], [x + 64, CEIL, z + 64],
                   Surface.metal, "light"));
}

const COOL: [number, number, number] = [0.86, 0.93, 1.0];
const lights = FIXTURES.map(([x, z]) => ({
  pos: [x, CEIL - 24, z] as [number, number, number],
  color: COOL,
  intensity: 1.15,
  radius: 780,
}));
// Two warm accents at floor level so the ring corridor isn't uniformly cold.
lights.push(
  { pos: [0, 120, -300], color: [1.0, 0.62, 0.3], intensity: 0.8, radius: 480 },
  { pos: [0, 120, 300], color: [1.0, 0.62, 0.3], intensity: 0.8, radius: 480 },
);

// --- spawns -----------------------------------------------------------------

const spawns: SpawnDef[] = [
  { pos: [-208, 40, 200], yaw: Math.PI },
  { pos: [208, 40, -200], yaw: 0 },
  { pos: [-208, 40, -200], yaw: 0 },
  { pos: [208, 40, 200], yaw: Math.PI },
  { pos: [0, 40, -400], yaw: Math.PI },
  { pos: [0, 40, 400], yaw: 0 },
  { pos: [-400, TERRACE + 40, -200], yaw: -Math.PI / 2 },
  { pos: [400, TERRACE + 40, 200], yaw: Math.PI / 2 },
];

export const SILO: MapDef = {
  name: "silo",
  brushes,
  lights,
  ambient: [0.10, 0.105, 0.12],
  mode: Mode.deathmatch,
  bots: 5,
  spawns,
  background: 0x0b0d10,
  fog: [700, 2600],
};
