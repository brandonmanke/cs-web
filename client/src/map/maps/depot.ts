import { Mode, Team } from "../../sim";
import { box, ramp, room, stairs, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";

// DEPOT — the team map, and the one that gives the AWP a reason to exist.
//
// A long loading hall: two team ends, a raised central dock you have to commit
// to crossing, and two flank lanes north and south of it that stay at floor
// level. The dock is the short way and the exposed way. Diagonally opposite
// corner perches look straight down the long axis, which is a 1500-unit
// sightline — scope range, and the only place on any of these maps where
// holding still is the right answer.

const HALF_X = 768;
const HALF_Z = 512;
const CEIL = 320;
const DOCK_Y = 64;
const PERCH_Y = 160;

const brushes: Brush[] = [];

// --- shell ------------------------------------------------------------------

brushes.push(...room([-HALF_X, 0, -HALF_Z], [HALF_X, CEIL, HALF_Z], 32,
                     Surface.concrete, "brick", "concrete", "tech"));

// --- central dock -----------------------------------------------------------

brushes.push(box([-192, 0, -256], [192, DOCK_Y, 256], Surface.concrete,
                 "concrete_dark", { 2: "metal" }));
brushes.push(
  ramp([-320, 0, -256], [-192, DOCK_Y, 256], "+x", Surface.metal, "metal"),
  ramp([192, 0, -256], [320, DOCK_Y, 256], "-x", Surface.metal, "metal"),
);
// Hazard stripe along the two open dock edges, inset so it sits on the deck.
brushes.push(
  box([-192, DOCK_Y, -256], [192, DOCK_Y + 4, -248], Surface.metal, "hazard"),
  box([-192, DOCK_Y, 248], [192, DOCK_Y + 4, 256], Surface.metal, "hazard"),
);

// --- corner perches ---------------------------------------------------------

brushes.push(
  box([-HALF_X, 0, -HALF_Z], [-512, PERCH_Y, -320], Surface.concrete,
      "concrete", { 2: "grate" }),
  box([512, 0, 320], [HALF_X, PERCH_Y, HALF_Z], Surface.concrete,
      "concrete", { 2: "grate" }),
);
brushes.push(...stairs([-512, 0, -HALF_Z], [-384, PERCH_Y, -320], 5, "-x",
                       Surface.metal, "metal"));
brushes.push(...stairs([384, 0, 320], [512, PERCH_Y, HALF_Z], 5, "+x",
                       Surface.metal, "metal"));

// --- containers and cover ---------------------------------------------------

brushes.push(
  box([-560, 0, 64], [-400, 96, 224], Surface.wood, "crate"),
  box([400, 0, -224], [560, 96, -64], Surface.wood, "crate"),
  box([-480, 0, -160], [-384, 64, -64], Surface.metal, "rust"),
  box([384, 0, 64], [480, 64, 160], Surface.metal, "rust"),
  box([-96, 0, -448], [96, 72, -352], Surface.wood, "crate"),
  box([-96, 0, 352], [96, 72, 448], Surface.wood, "crate"),
  box([-352, 0, -448], [-224, 36, -352], Surface.metal, "metal"),
  box([224, 0, 352], [352, 36, 448], Surface.metal, "metal"),
);

// Pipe runs along the upper walls — silhouette only, but the hall needs a roof
// line to read as a building rather than a box.
brushes.push(
  box([-HALF_X, 224, -HALF_Z], [HALF_X, 256, -HALF_Z + 32], Surface.metal, "rust"),
  box([-HALF_X, 224, HALF_Z - 32], [HALF_X, 256, HALF_Z], Surface.metal, "rust"),
);

// --- lights -----------------------------------------------------------------

const FIXTURES: Array<[number, number]> = [
  [-576, -256], [-576, 256], [-192, -320], [-192, 320],
  [192, -320], [192, 320], [576, -256], [576, 256], [0, 0],
];
for (const [x, z] of FIXTURES) {
  brushes.push(box([x - 72, CEIL - 10, z - 72], [x + 72, CEIL, z + 72],
                   Surface.metal, "light"));
}

const SODIUM: [number, number, number] = [1.0, 0.86, 0.6];
const lights = FIXTURES.map(([x, z]) => ({
  pos: [x, CEIL - 24, z] as [number, number, number],
  color: SODIUM,
  intensity: x === 0 ? 1.35 : 1.15,
  radius: 900,
}));
// Under-dock glow: the one thing lighting the shadow the ramps cast.
lights.push(
  { pos: [-256, 40, 0], color: [0.5, 0.9, 1.0], intensity: 0.7, radius: 460 },
  { pos: [256, 40, 0], color: [0.5, 0.9, 1.0], intensity: 0.7, radius: 460 },
);

// --- spawns -----------------------------------------------------------------

// CT first: sim_start_match places you (always CT) at the first spawn.
const spawns: SpawnDef[] = [
  ...[-200, 0, 200, -280].map((z, i): SpawnDef => ({
    pos: [i === 3 ? -620 : -680, 40, z],
    yaw: -Math.PI / 2, // facing +X, down the hall
    team: Team.ct,
  })),
  ...[200, 0, -200, 280].map((z, i): SpawnDef => ({
    pos: [i === 3 ? 620 : 680, 40, z],
    yaw: Math.PI / 2, // facing -X
    team: Team.t,
  })),
];

export const DEPOT: MapDef = {
  name: "depot",
  brushes,
  lights,
  ambient: [0.09, 0.095, 0.105],
  mode: Mode.team,
  bots: 7,
  spawns,
  background: 0x0c0b09,
  fog: [1100, 3800],
};
