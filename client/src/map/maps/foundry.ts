import { Mode, Team } from "../../sim";
import { box, ramp, stairs, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";

// FOUNDRY — an original arena, Quake's grammar with CS's sightlines.
//
// A sunken furnace floor ringed by a raised walkway, crossed overhead by a
// catwalk. Three heights, four ways between them, and every long sightline
// broken by cover, so no single position controls the room. Enclosed and lit by
// sodium fixtures rather than daylight: the bake wants pools of light and deep
// shadow to read against.

const OUTER = 768;      // walkway outer edge
const PIT = 384;        // furnace floor half-extent
const WALK_Y = 96;      // walkway surface
const CATWALK_Y = 208;  // catwalk surface
const CEIL_Y = 448;
const THICK = 32;
const FLOOR_BASE = -32;

const brushes: Brush[] = [];

// --- shell ------------------------------------------------------------------

// Furnace floor, sunk below the walkway.
brushes.push(box([-PIT, FLOOR_BASE, -PIT], [PIT, 0, PIT], Surface.concrete, "concrete_dark"));

// Walkway ring, four solid blocks around the pit.
brushes.push(
  box([-OUTER, FLOOR_BASE, -OUTER], [OUTER, WALK_Y, -PIT], Surface.metal, "grate",
      { 2: "grate" }),
  box([-OUTER, FLOOR_BASE, PIT], [OUTER, WALK_Y, OUTER], Surface.metal, "grate"),
  box([-OUTER, FLOOR_BASE, -PIT], [-PIT, WALK_Y, PIT], Surface.metal, "grate"),
  box([PIT, FLOOR_BASE, -PIT], [OUTER, WALK_Y, PIT], Surface.metal, "grate"),
);

// Outer walls and ceiling.
brushes.push(
  box([-OUTER - THICK, FLOOR_BASE, -OUTER - THICK], [OUTER + THICK, CEIL_Y, -OUTER],
      Surface.concrete, "brick"),
  box([-OUTER - THICK, FLOOR_BASE, OUTER], [OUTER + THICK, CEIL_Y, OUTER + THICK],
      Surface.concrete, "brick"),
  box([-OUTER - THICK, FLOOR_BASE, -OUTER], [-OUTER, CEIL_Y, OUTER],
      Surface.concrete, "brick"),
  box([OUTER, FLOOR_BASE, -OUTER], [OUTER + THICK, CEIL_Y, OUTER],
      Surface.concrete, "brick"),
  box([-OUTER - THICK, CEIL_Y, -OUTER - THICK], [OUTER + THICK, CEIL_Y + THICK, OUTER + THICK],
      Surface.concrete, "tech"),
);

// Hazard-striped lip around the pit edge, so the drop reads at speed.
const LIP = 8;
brushes.push(
  box([-OUTER, WALK_Y, -PIT - LIP], [OUTER, WALK_Y + 4, -PIT], Surface.metal, "hazard"),
  box([-OUTER, WALK_Y, PIT], [OUTER, WALK_Y + 4, PIT + LIP], Surface.metal, "hazard"),
  box([-PIT - LIP, WALK_Y, -PIT], [-PIT, WALK_Y + 4, PIT], Surface.metal, "hazard"),
  box([PIT, WALK_Y, -PIT], [PIT + LIP, WALK_Y + 4, PIT], Surface.metal, "hazard"),
);

// --- vertical connections ---------------------------------------------------

// Two stair runs down into the pit, diagonally opposite.
brushes.push(...stairs([-192, 0, -384], [-64, WALK_Y, -192], 12, "-z",
                       Surface.metal, "metal"));
brushes.push(...stairs([64, 0, 192], [192, WALK_Y, 384], 12, "+z",
                       Surface.metal, "metal"));

// Ramps from the walkway up to the catwalk, north and south.
brushes.push(ramp([-64, WALK_Y, -640], [64, CATWALK_Y, -384], "+z",
                  Surface.metal, "metal"));
brushes.push(ramp([-64, WALK_Y, 384], [64, CATWALK_Y, 640], "-z",
                  Surface.metal, "metal"));

// The catwalk itself, spanning the pit north to south.
brushes.push(box([-64, CATWALK_Y - 16, -384], [64, CATWALK_Y, 384],
                 Surface.metal, "grate"));
// Toe-rails, not handrails. Waist-high rails on a walkway this narrow put the
// whole pit behind cover from the one position that is supposed to overlook it.
brushes.push(
  box([-72, CATWALK_Y, -384], [-64, CATWALK_Y + 12, 384], Surface.metal, "rust"),
  box([64, CATWALK_Y, -384], [72, CATWALK_Y + 12, 384], Surface.metal, "rust"),
);

// --- cover ------------------------------------------------------------------

// Pit cover: crates at the three heights that matter (step, jump, crouch-jump).
brushes.push(
  box([-320, 0, -320], [-192, 72, -192], Surface.wood, "crate"),
  box([-320, 72, -320], [-224, 128, -256], Surface.wood, "crate"),
  box([192, 0, 208], [320, 72, 336], Surface.wood, "crate"),
  box([-160, 0, 224], [-32, 36, 352], Surface.wood, "crate"),
  box([224, 0, -352], [352, 36, -224], Surface.wood, "crate"),
  box([-64, 0, -64], [64, 64, 64], Surface.metal, "rust"), // central block
);

// Plank screens on the east and west walkways: cover that is not safety. They
// break the lane the same way a crate does, but at 12u of wood every rifle in
// the game goes through them, so holding one is a bet that nobody has worked
// out you are there. Standing off the corner and shooting the screen is the
// answer, which is the whole reason penetration is worth having.
brushes.push(
  box([-568, WALK_Y, -96], [-556, WALK_Y + 72, 96], Surface.wood, "crate"),
  box([556, WALK_Y, -96], [568, WALK_Y + 72, 96], Surface.wood, "crate"),
);

// Furnace columns: sightline breakers that also hold the ceiling up visually.
for (const [x, z] of [[-576, -576], [576, -576], [-576, 576], [576, 576]]) {
  brushes.push(box([x! - 48, WALK_Y, z! - 48], [x! + 48, CEIL_Y, z! + 48],
                   Surface.concrete, "concrete"));
}

// Pipework along the upper walls — pure silhouette, but it sells the place.
brushes.push(
  box([-OUTER, 320, -OUTER + 24], [OUTER, 352, -OUTER + 56], Surface.metal, "rust"),
  box([-OUTER, 320, OUTER - 56], [OUTER, 352, OUTER - 24], Surface.metal, "rust"),
  box([-OUTER + 24, 368, -OUTER], [-OUTER + 56, 400, OUTER], Surface.metal, "rust"),
);

// --- lights -----------------------------------------------------------------

// Recessed ceiling fixtures. Each pairs with a MapLight below it so the bright
// panel you see is the thing actually casting the pool of light.
const FIXTURES: Array<[number, number]> = [
  [-256, -256], [256, -256], [-256, 256], [256, 256],
  [-576, 0], [576, 0], [0, -576], [0, 576],
];
for (const [x, z] of FIXTURES) {
  brushes.push(box([x - 72, CEIL_Y - 10, z - 72], [x + 72, CEIL_Y, z + 72],
                   Surface.metal, "light"));
}

const SODIUM: [number, number, number] = [1.0, 0.80, 0.52];
const lights = FIXTURES.map(([x, z]) => ({
  pos: [x, CEIL_Y - 24, z] as [number, number, number],
  color: SODIUM,
  intensity: x === 0 || z === 0 ? 1.25 : 1.5,
  radius: 900,
}));

// Cold green glow from under the catwalk — the one non-sodium accent, and the
// only light down in the pit's corners.
lights.push(
  { pos: [0, CATWALK_Y - 40, -220], color: [0.42, 1.0, 0.55], intensity: 0.85, radius: 460 },
  { pos: [0, CATWALK_Y - 40, 220], color: [0.42, 1.0, 0.55], intensity: 0.85, radius: 460 },
  { pos: [0, 140, 0], color: [1.0, 0.55, 0.25], intensity: 0.7, radius: 420 },
);

// --- spawns -----------------------------------------------------------------

// Two ends of the walkway ring, clear of the corner columns and the catwalk
// ramps. CT holds north, T holds south; the pit between them is the fight.
const SPAWN_Y = WALK_Y + 44;
const spawns: SpawnDef[] = [
  ...[-480, -160, 200, 480].map((x): SpawnDef => (
    { pos: [x, SPAWN_Y, -576], yaw: Math.PI, team: Team.ct }
  )),
  ...[-480, -160, 200, 480].map((x): SpawnDef => (
    { pos: [x, SPAWN_Y, 576], yaw: 0, team: Team.t }
  )),
];

export const FOUNDRY: MapDef = {
  name: "foundry",
  brushes,
  lights,
  ambient: [0.085, 0.095, 0.115],
  mode: Mode.team,
  bots: 7, // 4v4 including you
  spawns,
  background: 0x0a0c0d,
  fog: [900, 3400],
};
