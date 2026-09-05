import { Mode, Team } from "../../sim";
import { box, planeThrough, ramp, room, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";
import type { MapLight } from "../build";

// RELAY — an original orbital transfer hall. A broad bridge and two side
// galleries connect the end decks; four ramps lead to a continuous lower
// maintenance floor. Falling off a bridge always leaves a walkable way back.
const X = 896;
const Z = 1024;
const DECK = 192;
const CEIL = 704;
const brushes: Brush[] = room([-X, 0, -Z], [X, CEIL, Z], 32,
  Surface.metal, "alloy", "concrete_dark", "tech");

// End decks, the 320u main bridge, and 256u side galleries.
brushes.push(
  box([-X, 0, -Z], [X, DECK, -640], Surface.metal, "alloy", { 2: "deck" }),
  box([-X, 0, 640], [X, DECK, Z], Surface.metal, "alloy", { 2: "deck" }),
  box([-160, DECK - 24, -640], [160, DECK, 640], Surface.metal, "metal", { 2: "deck" }),
  box([-X, 0, -640], [-640, DECK, 640], Surface.metal, "alloy", { 2: "deck" }),
  box([640, 0, -640], [X, DECK, 640], Surface.metal, "alloy", { 2: "deck" }),
);
for (const x of [-416, 416]) {
  brushes.push(
    ramp([x - 96, 0, -640], [x + 96, DECK, -160], "-z", Surface.metal, "deck"),
    ramp([x - 96, 0, 160], [x + 96, DECK, 640], "+z", Surface.metal, "deck"),
  );
}

// Low edge trim signals the drop without trapping players behind handrails.
for (const x of [-168, 160, -648, 640]) {
  brushes.push(box([x, DECK, -640], [x + 8, DECK + 8, 640], Surface.metal, "hazard"));
}
for (const z of [-400, 400]) {
  // Bridge supports are outside the lower east/west crossing at z = 0.
  brushes.push(
    box([-144, 0, z - 24], [-96, DECK - 24, z + 24], Surface.metal, "metal"),
    box([96, 0, z - 24], [144, DECK - 24, z + 24], Surface.metal, "metal"),
  );
}

// Alternating bridge cover leaves at least 240u of usable width. Side routes
// have cover against the wall, and the end decks have room behind each block.
brushes.push(
  box([-152, DECK, -272], [-80, DECK + 64, -144], Surface.metal, "tech"),
  box([80, DECK, 144], [152, DECK + 64, 272], Surface.metal, "tech"),
);
for (const side of [-1, 1]) {
  const x = side * 848;
  brushes.push(box([x - 32, DECK, -64], [x + 32, DECK + 80, 64], Surface.metal, "tech"));
  for (const z of [-816, 816]) {
    brushes.push(box([side * 288 - 56, DECK, z - 48], [side * 288 + 56, DECK + 80, z + 48],
      Surface.metal, "alloy"));
  }
}

// Deep wall ribs, high girders and inset light strips give the hall a strong
// silhouette. All detail remains solid brush geometry, above player clearance.
for (const z of [-768, -384, 384, 768]) {
  for (const side of [-1, 1]) {
    const x = side * 880;
    brushes.push(
      box([x - 16, DECK, z - 24], [x + 16, CEIL, z + 24], Surface.metal, "metal"),
      box([x - 16, 352, z + 72], [x + 16, 512, z + 200], Surface.metal, "tech"),
    );
    // Sloped arch shoulders break the rectangular roof line. Their underside
    // stays at least 256u above the galleries, clear of a standing jump.
    const shoulder = box([side < 0 ? -X : 640, 448, z - 24],
      [side < 0 ? -640 : X, 624, z + 24], Surface.metal, "metal");
    shoulder.planes.push(planeThrough([-side * 176, -256, 0], [side * X, 448, z]));
    brushes.push(shoulder);
  }
  brushes.push(box([-X, 624, z - 24], [X, CEIL, z + 24], Surface.metal, "metal"));
}

// The relay banks sit high on the end walls: layered frames and cool panels,
// with a warm central inset to make the two ends legible from the bridge.
for (const side of [-1, 1]) {
  const z = side * 1008;
  brushes.push(
    box([-256, 320, z - 16], [256, 592, z + 16], Surface.metal, "metal"),
    box([-224, 352, z - 20], [224, 560, z + 20], Surface.metal, "tech"),
    box([-192, 384, z - 24], [-128, 528, z + 24], Surface.metal, "light_cool"),
    box([128, 384, z - 24], [192, 528, z + 24], Surface.metal, "light_cool"),
    box([-80, 400, z - 24], [80, 512, z + 24], Surface.metal, side < 0 ? "light_cool" : "light"),
  );
}

const lights: MapLight[] = [];
for (const x of [-720, 0, 720]) {
  for (const z of [-560, 560]) {
    brushes.push(box([x - 40, CEIL - 12, z - 96], [x + 40, CEIL, z + 96], Surface.metal, "light_cool"));
    lights.push({ pos: [x, CEIL - 28, z], color: [0.66, 0.86, 1], intensity: 2.2, radius: 1150 });
  }
}
for (const x of [-608, 608]) {
  brushes.push(box([x - 8, 32, -96], [x + 8, 112, 96], Surface.metal, "light_cool"));
  lights.push({ pos: [x - Math.sign(x) * 24, 128, 0], color: [0.35, 0.85, 1], intensity: 1.3, radius: 620 });
}
lights.push(
  { pos: [0, 112, 0], color: [0.58, 0.76, 1], intensity: 0.9, radius: 480 },
  { pos: [0, 384, -928], color: [0.58, 0.84, 1], intensity: 1.8, radius: 800 },
  { pos: [0, 384, 928], color: [1, 0.66, 0.34], intensity: 1.8, radius: 800 },
);

const spawns: SpawnDef[] = [];
for (const side of [-1, 1]) {
  for (const x of [0, -736, -480, 480, 736]) {
    spawns.push({ pos: [x, DECK + 40, side * 880], yaw: side < 0 ? Math.PI : 0,
      team: side < 0 ? Team.ct : Team.t });
  }
}

export const RELAY: MapDef = {
  name: "relay", brushes, lights, spawns,
  ambient: [0.14, 0.17, 0.21],
  mode: Mode.team, bots: 7,
  background: 0x0d1520, fog: [1600, 4200],
};
