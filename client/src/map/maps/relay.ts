import { Mode, Team } from "../../sim";
import { box, planeThrough, ramp, Surface, type Brush } from "../brush";
import type { MapDef, SpawnDef } from "../mapdef";
import type { MapLight } from "../build";

// RELAY — an original open-air orbital transfer station. A bridge and two side
// galleries connect the end decks; four ramps lead to a continuous lower
// maintenance floor. Falling off a bridge always leaves a walkable way back.
const X = 896;
const Z = 1024;
const DECK = 192;
const FRAME = 704;
const WALL = 512;
const TOWER = 384;
// Open roof, solid perimeter. Even from a tower, the outer wall is too high
// to jump over; the sky never needs an invisible collision ceiling.
const brushes: Brush[] = [
  // Leave two real openings for flush, load-bearing floor viewports.
  box([-X - 32, -32, -Z - 32], [X + 32, 0, -64], Surface.metal, "concrete_dark"),
  box([-X - 32, -32, 64], [X + 32, 0, Z + 32], Surface.metal, "concrete_dark"),
  box([-X - 32, -32, -64], [-544, 0, 64], Surface.metal, "concrete_dark"),
  box([-288, -32, -64], [288, 0, 64], Surface.metal, "concrete_dark"),
  box([544, -32, -64], [X + 32, 0, 64], Surface.metal, "concrete_dark"),
  box([-X, 0, -Z - 32], [X, WALL, -Z], Surface.metal, "alloy"),
  box([-X, 0, Z], [X, WALL, Z + 32], Surface.metal, "alloy"),
];
for (const side of [-1, 1]) {
  const lo = side < 0 ? -X - 32 : X;
  const hi = side < 0 ? -X : X + 32;
  // Lower observation alcoves look through the shell into the same sky seen
  // overhead. The glass brush itself provides collision and bullet resistance.
  brushes.push(
    box([lo, 0, -Z - 32], [hi, WALL, -128], Surface.metal, "alloy"),
    box([lo, 0, 128], [hi, WALL, Z + 32], Surface.metal, "alloy"),
    box([lo, 0, -128], [hi, 32, 128], Surface.metal, "metal"),
    box([lo, 144, -128], [hi, WALL, 128], Surface.metal, "metal"),
    box([lo, 32, -128], [hi, 144, -116], Surface.metal, "metal"),
    box([lo, 32, 116], [hi, 144, 128], Surface.metal, "metal"),
    box([side < 0 ? -904 : 896, 32, -116], [side < 0 ? -896 : 904, 144, 116],
      Surface.metal, "glass"),
  );
  const x0 = side < 0 ? -544 : 288;
  const x1 = x0 + 256;
  brushes.push(
    box([x0, -32, -64], [x1, 0, -52], Surface.metal, "metal"),
    box([x0, -32, 52], [x1, 0, 64], Surface.metal, "metal"),
    box([x0, -32, -52], [x0 + 12, 0, 52], Surface.metal, "metal"),
    box([x1 - 12, -32, -52], [x1, 0, 52], Surface.metal, "metal"),
    box([x0 + 12, -8, -52], [x1 - 12, 0, 52], Surface.metal, "glass"),
  );
}

// End decks, the 320u main bridge, and 256u side galleries.
brushes.push(
  box([-X, 0, -Z], [X, DECK, -640], Surface.metal, "alloy", { 2: "deck" }),
  box([-X, 0, 640], [X, DECK, Z], Surface.metal, "alloy", { 2: "deck" }),
  box([-160, DECK - 24, -640], [160, DECK, 640], Surface.metal, "metal", { 2: "deck" }),
);
for (const side of [-1, 1]) {
  const lo = side < 0 ? -X : 640;
  const hi = side < 0 ? -640 : X;
  brushes.push(
    box([lo, 0, -640], [hi, DECK, -128], Surface.metal, "alloy", { 2: "deck" }),
    box([lo, 0, 128], [hi, DECK, 640], Surface.metal, "alloy", { 2: "deck" }),
    box([lo, 160, -128], [hi, DECK, 128], Surface.metal, "metal", { 2: "deck" }),
  );
}
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
// Shield the lower crossing from the towers. The 128u passage between these
// bulkheads stays open east/west, and both ramp lanes pass around their ends.
for (const z of [-80, 80]) {
  brushes.push(box([-144, 0, z - 16], [144, 128, z + 16], Surface.metal, "alloy"));
}

// Alternating bridge cover leaves at least 240u of usable width. Side routes
// have cover against the wall, and the end decks have room behind each block.
brushes.push(
  box([-152, DECK, -272], [-80, DECK + 112, -144], Surface.metal, "tech"),
  box([80, DECK, 144], [152, DECK + 112, 272], Surface.metal, "tech"),
  box([80, DECK, -544], [152, DECK + 48, -448], Surface.metal, "alloy"),
  box([-152, DECK, 448], [-80, DECK + 48, 544], Surface.metal, "alloy"),
);
for (const side of [-1, 1]) {
  const x = side * 848;
  brushes.push(box([x - 32, DECK, -64], [x + 32, DECK + 80, 64], Surface.metal, "tech"));
  // Inner-edge cover shields the side galleries from the opposite towers,
  // leaving a 160u lane between it and the outer wall ribs.
  for (const z of [-304, 304]) {
    brushes.push(box([side * 668 - 28, DECK, z - 64], [side * 668 + 28, DECK + 72, z + 64],
      Surface.metal, "alloy"));
  }
  for (const z of [-752, 752]) {
    brushes.push(box([side * 288 - 56, DECK, z - 32], [side * 288 + 56, DECK + 80, z + 32],
      Surface.metal, "alloy"));
  }
}

// Four corner sniper platforms. The 192u rise is reached by a 448u ramp,
// with a 144u-wide entrance; ordinary walking reaches every firing position.
for (const side of [-1, 1]) {
  const lo = side < 0 ? -848 : 608;
  const hi = side < 0 ? -608 : 848;
  for (const end of [-1, 1]) {
    const z = end * 880;
    brushes.push(
      box([lo, DECK, z - 112], [hi, TOWER, z + 112], Surface.metal, "alloy", { 2: "deck" }),
      ramp([side < 0 ? -608 : 160, DECK, z - 72],
        [side < 0 ? -160 : 608, TOWER, z + 72], side < 0 ? "-x" : "+x", Surface.metal, "deck"),
      // Front and back parapets: crouch to hide, stand to take the shot.
      box([lo, TOWER, z - 112], [hi, TOWER + 44, z - 100], Surface.metal, "metal"),
      box([lo, TOWER, z + 100], [hi, TOWER + 44, z + 112], Surface.metal, "metal"),
      box([lo - 8, TOWER + 160, z - 120], [hi + 8, TOWER + 176, z + 120], Surface.metal, "tech"),
    );
    for (const x of [lo + 8, hi - 8]) {
      for (const cornerZ of [z - 104, z + 104]) {
        brushes.push(box([x - 8, TOWER, cornerZ - 8], [x + 8, TOWER + 160, cornerZ + 8],
          Surface.metal, "metal"));
      }
    }
    // A narrow outside screen gives flank cover without closing the ramp.
    const outside = side < 0 ? lo : hi - 12;
    brushes.push(box([outside, TOWER, z - 100], [outside + 12, TOWER + 96, z + 100],
      Surface.metal, "alloy"));
    brushes.push(box([lo + 80, TOWER + 152, z - 24], [hi - 80, TOWER + 160, z + 24],
      Surface.metal, "light_cool"));
  }
}

// Deep wall ribs, high girders and inset light strips give the hall a strong
// silhouette. All detail remains solid brush geometry, above player clearance.
for (const z of [-768, -384, 384, 768]) {
  for (const side of [-1, 1]) {
    const x = side * 880;
    brushes.push(
      box([x - 16, DECK, z - 24], [x + 16, FRAME, z + 24], Surface.metal, "metal"),
      box([x - 16, 352, z + 72], [x + 16, 512, z + 200], Surface.metal, "tech"),
    );
    // Sloped arch shoulders break the rectangular roof line. Their underside
    // stays at least 256u above the galleries, clear of a standing jump.
    const shoulder = box([side < 0 ? -X : 640, 448, z - 24],
      [side < 0 ? -640 : X, 624, z + 24], Surface.metal, "metal");
    shoulder.planes.push(planeThrough([-side * 176, -256, 0], [side * X, 448, z]));
    brushes.push(shoulder);
  }
  brushes.push(box([-X, 624, z - 24], [X, 656, z + 24], Surface.metal, "metal"));
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
  for (const z of [-384, 384]) {
    brushes.push(box([x - 48, 612, z - 24], [x + 48, 624, z + 24], Surface.metal, "light_cool"));
    lights.push({ pos: [x, 592, z], color: [0.66, 0.86, 1], intensity: 2.2, radius: 1150 });
  }
}
for (const x of [-728, 728]) {
  for (const z of [-880, 880]) {
    lights.push({ pos: [x, TOWER + 136, z], color: [0.66, 0.86, 1], intensity: 1.2, radius: 460 });
  }
}
for (const x of [-656, 656]) {
  brushes.push(box([x - 8, 152, -80], [x + 8, 160, 80], Surface.metal, "light_cool"));
  lights.push({ pos: [x, 132, 0], color: [0.35, 0.85, 1], intensity: 1.3, radius: 620 });
}
lights.push(
  { pos: [0, 112, 0], color: [0.58, 0.76, 1], intensity: 0.9, radius: 480 },
  { pos: [0, 384, -928], color: [0.58, 0.84, 1], intensity: 1.8, radius: 800 },
  { pos: [0, 384, 928], color: [1, 0.66, 0.34], intensity: 1.8, radius: 800 },
);

const spawns: SpawnDef[] = [];
for (const side of [-1, 1]) {
  for (const x of [0, -736, -480, 480, 736]) {
    // Two tower starts per team; the remaining spawns stay clear of the ramps.
    const tower = Math.abs(x) === 736;
    spawns.push({ pos: [x, (tower ? TOWER : DECK) + 40, side * (tower ? 880 : 696)], yaw: side < 0 ? Math.PI : 0,
      team: side < 0 ? Team.ct : Team.t });
  }
}

export const RELAY: MapDef = {
  name: "relay", brushes, lights, spawns,
  ambient: [0.14, 0.17, 0.21],
  mode: Mode.team, bots: 7,
  background: 0x0d1520, fog: [1600, 4200],
  sky: "orbital",
};
