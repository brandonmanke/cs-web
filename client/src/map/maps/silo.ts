import { Mode } from "../../sim";
import { box, ramp, room, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";

// SILO — a roomy industrial loop with a crosscut through the central tower.
// Lower lanes are 320u wide before cover; 192u ramps have approaches at both
// ends. No required route depends on jumping or squeezing past crates.
const HALF = 768;
const CEIL = 512;
const TERRACE = 128;
const brushes: Brush[] = room([-HALF, 0, -HALF], [HALF, CEIL, HALF], 32,
  Surface.concrete, "brick", "concrete", "tech");

// Supporting walls leave a 224u-wide, 160u-high east/west passage.
brushes.push(
  box([-192, 0, -192], [192, 160, -112], Surface.concrete, "concrete_dark"),
  box([-192, 0, 112], [192, 160, 192], Surface.concrete, "concrete_dark"),
  box([-192, 160, -192], [192, CEIL, 192], Surface.metal, "rust"),
  box([-200, 160, -200], [200, 180, 200], Surface.metal, "hazard", { 2: "metal", 3: "metal" }),
  box([-200, 352, -200], [200, 372, 200], Surface.metal, "metal"),
);
for (const x of [-192, 192]) {
  for (const z of [-192, 192]) {
    brushes.push(box([x - 8, 0, z - 8], [x + 8, CEIL, z + 8], Surface.metal, "metal"));
  }
}

// Short balconies leave the north and south ends open. Four shallow ramps
// replace the old diagonal choke points and dead-end terraces.
for (const side of [-1, 1]) {
  const lo = side < 0 ? -768 : 512;
  const hi = side < 0 ? -512 : 768;
  const x = side * 640;
  brushes.push(
    box([lo, 0, -288], [hi, TERRACE, 288], Surface.concrete, "concrete_dark", { 2: "grate" }),
    ramp([x - 96, 0, -672], [x + 96, TERRACE, -288], "+z", Surface.metal, "metal"),
    ramp([x - 96, 0, 288], [x + 96, TERRACE, 672], "-z", Surface.metal, "metal"),
    box([side < 0 ? hi - 8 : lo, TERRACE, -288],
        [side < 0 ? hi : lo + 8, TERRACE + 8, 288], Surface.metal, "hazard"),
    // Cover at the back leaves the inner balcony lane clear.
    box([x + side * 64 - 40, TERRACE, -48], [x + side * 64 + 40, TERRACE + 64, 48],
        Surface.wood, "crate"),
  );
}

// Offset cover breaks long angles without fencing off the ring. The main
// north/south lanes at x = +/-368 and crosscut at z = 0 stay unobstructed.
brushes.push(
  box([-192, 0, -448], [-64, 64, -352], Surface.wood, "crate"),
  box([64, 0, 352], [192, 64, 448], Surface.wood, "crate"),
  box([208, 0, -240], [272, 80, -144], Surface.metal, "rust"),
  box([-272, 0, 144], [-208, 80, 240], Surface.metal, "rust"),
  box([-528, 0, -464], [-516, 72, -336], Surface.wood, "crate"),
  box([516, 0, 336], [528, 72, 464], Surface.wood, "crate"),
);

// Wall bays, structural ribs and high pipework give the larger room detail
// without projecting obstacles into its walking routes.
for (const z of [-576, -192, 192, 576]) {
  for (const side of [-1, 1]) {
    const x = side * 756;
    brushes.push(
      box([x - 12, 0, z - 16], [x + 12, CEIL, z + 16], Surface.concrete, "concrete_dark"),
      box([x - 12, 304, z + 48], [x + 12, 400, z + 160], Surface.metal, "tech"),
    );
  }
}
for (const z of [-752, 720]) {
  brushes.push(box([-HALF, 400, z], [HALF, 424, z + 32], Surface.metal, "rust"));
}
for (const z of [-576, 576]) {
  brushes.push(box([-HALF, 464, z - 16], [HALF, CEIL, z + 16], Surface.metal, "metal"));
}

const fixtures: Array<[number, number]> = [
  [-368, -448], [368, -448], [-368, 448], [368, 448], [-640, 0], [640, 0],
];
for (const [x, z] of fixtures) {
  brushes.push(box([x - 48, CEIL - 12, z - 80], [x + 48, CEIL, z + 80], Surface.metal, "light"));
}
brushes.push(box([-112, 152, -16], [112, 160, 16], Surface.metal, "light"));
const lights = fixtures.map(([x, z]) => ({
  pos: [x, CEIL - 28, z] as [number, number, number],
  color: [1, 0.84, 0.62] as [number, number, number], intensity: 1.8, radius: 1050,
}));
lights.push(
  { pos: [0, 132, 0], color: [1, 0.78, 0.48], intensity: 1.0, radius: 480 },
  { pos: [0, 192, -600], color: [0.62, 0.80, 1], intensity: 1.0, radius: 680 },
  { pos: [0, 192, 600], color: [0.62, 0.80, 1], intensity: 1.0, radius: 680 },
);

const spawns: SpawnDef[] = [
  { pos: [-368, 40, 544], yaw: 0 },
  { pos: [368, 40, -544], yaw: Math.PI },
  { pos: [-368, 40, -544], yaw: Math.PI },
  { pos: [368, 40, 544], yaw: 0 },
  { pos: [0, 40, -640], yaw: Math.PI },
  { pos: [0, 40, 640], yaw: 0 },
  { pos: [-600, TERRACE + 40, -160], yaw: -Math.PI / 2 },
  { pos: [600, TERRACE + 40, 160], yaw: Math.PI / 2 },
  { pos: [-368, 40, 0], yaw: -Math.PI / 2 },
  { pos: [368, 40, 0], yaw: Math.PI / 2 },
];

export const SILO: MapDef = {
  name: "silo", brushes, lights, spawns,
  ambient: [0.13, 0.135, 0.15],
  mode: Mode.deathmatch, bots: 5,
  background: 0x11151b, fog: [1200, 3400],
};
