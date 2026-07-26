// Headless map validation. Loads a map's brushes into the real wasm sim and
// checks the things that are invisible until you are standing in the level:
// degenerate brushes, a spawn that drops you through the floor, targets
// floating in the air, geometry the renderer draws but collision doesn't have.
//
// Run with: npm run mapcheck [-- mapname]
//
// This is the descendant of the dust2 probe. That tool existed because a
// display mesh made a bad collision world; this one exists so authored brushes
// never get the chance to.

import { brushFaces, brushPlaneArray } from "../client/src/map/brush";
import type { MapDef } from "../client/src/map/mapdef";
import { FOUNDRY } from "../client/src/map/maps/foundry";
import { PRACTICE } from "../client/src/map/maps/practice";
import { Flags, Sim, Snapshot } from "../client/src/sim";

const MAPS: Record<string, MapDef> = { foundry: FOUNDRY, practice: PRACTICE };

let failures = 0;

function fail(message: string): void {
  console.log(`  FAIL  ${message}`);
  ++failures;
}

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

/** Drop a player from `height` and report where they come to rest. */
function dropProbe(sim: Sim, snapshot: Snapshot, x: number, y: number, z: number) {
  sim.spawn(x, y, z, 0);
  for (let i = 0; i < 240; ++i) {
    sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 });
  }
  sim.read(snapshot);
  return {
    y: snapshot.origin[1],
    grounded: (snapshot.flags & Flags.onGround) !== 0,
  };
}

async function checkMap(name: string, map: MapDef): Promise<void> {
  console.log(`\n=== ${name} ===`);
  const sim = await Sim.load();

  // 1. Every brush must be a bounded convex solid the sim will accept.
  let rejected = 0;
  for (const brush of map.brushes) {
    if (!sim.addBrush(brushPlaneArray(brush), brush.surface)) ++rejected;
  }
  if (rejected > 0) fail(`${rejected}/${map.brushes.length} brushes rejected by the sim`);
  else pass(`${map.brushes.length} brushes accepted`);

  // 2. Every brush must also produce render faces. A brush the sim accepts but
  //    the winding clipper drops would be invisible-but-solid.
  let faceless = 0;
  let faces = 0;
  let degenerateFaces = 0;
  for (const brush of map.brushes) {
    const list = brushFaces(brush);
    if (list.length < 4) ++faceless;
    faces += list.length;
    for (const face of list) {
      if (face.points.length < 3) ++degenerateFaces;
    }
  }
  if (faceless > 0) fail(`${faceless} brush(es) produced fewer than 4 faces (solid but unrendered)`);
  else pass(`${faces} faces across ${map.brushes.length} brushes`);
  if (degenerateFaces > 0) fail(`${degenerateFaces} degenerate face(s)`);

  for (const target of map.targets) {
    sim.addTarget(target.x, target.y, target.z, target.minX, target.maxX, target.speed);
  }
  sim.finalizeWorld();

  const snapshot = new Snapshot();

  // 3. The spawn must actually catch you.
  const spawn = dropProbe(sim, snapshot, map.spawn[0], map.spawn[1], map.spawn[2]);
  if (!spawn.grounded) {
    fail(`spawn ${map.spawn.join(",")} never lands (rests at y=${spawn.y.toFixed(1)})`);
  } else if (spawn.y < map.spawn[1] - 400) {
    fail(`spawn ${map.spawn.join(",")} falls ${(map.spawn[1] - spawn.y).toFixed(0)}u before landing`);
  } else {
    pass(`spawn lands at y=${spawn.y.toFixed(2)}, grounded`);
  }

  // 4. Targets should stand on something, not hover or sink.
  for (const [i, target] of map.targets.entries()) {
    const probe = dropProbe(sim, snapshot, target.x, target.y + 80, target.z);
    // Hull centre rests half a standing hull above the surface.
    const feet = probe.y - 36;
    if (!probe.grounded) fail(`target ${i} at ${target.x},${target.z} has no floor`);
    else if (Math.abs(feet - target.y) > 24) {
      fail(`target ${i} floor is at y=${feet.toFixed(0)}, target sits at y=${target.y}`);
    } else pass(`target ${i} grounded at y=${feet.toFixed(1)}`);
  }

  // 5. Coverage sweep: how much of the map's footprint is standable ground?
  //    Not a pass/fail, but a big drop here means geometry went missing.
  let bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const brush of map.brushes) {
    for (const face of brushFaces(brush)) {
      for (const p of face.points) {
        bounds.minX = Math.min(bounds.minX, p[0]);
        bounds.maxX = Math.max(bounds.maxX, p[0]);
        bounds.minZ = Math.min(bounds.minZ, p[2]);
        bounds.maxZ = Math.max(bounds.maxZ, p[2]);
      }
    }
  }
  const STEPS = 11;
  let standable = 0;
  let total = 0;
  const top = bounds.minX === Infinity ? 0 : 600;
  for (let i = 0; i < STEPS; ++i) {
    for (let j = 0; j < STEPS; ++j) {
      const x = bounds.minX + ((bounds.maxX - bounds.minX) * (i + 0.5)) / STEPS;
      const z = bounds.minZ + ((bounds.maxZ - bounds.minZ) * (j + 0.5)) / STEPS;
      const probe = dropProbe(sim, snapshot, x, top, z);
      ++total;
      if (probe.grounded) ++standable;
    }
  }
  console.log(
    `  info  bounds x ${bounds.minX.toFixed(0)}..${bounds.maxX.toFixed(0)}, ` +
    `z ${bounds.minZ.toFixed(0)}..${bounds.maxZ.toFixed(0)}; ` +
    `${standable}/${total} probe points found ground`,
  );
  if (standable === 0) fail("no probe point found ground — the map has no floor");
}

const requested = process.argv[2];
const selected = requested ? { [requested]: MAPS[requested]! } : MAPS;
if (requested && !MAPS[requested]) {
  console.error(`unknown map "${requested}"; known: ${Object.keys(MAPS).join(", ")}`);
  process.exit(2);
}

for (const [name, map] of Object.entries(selected)) {
  await checkMap(name, map);
}

console.log(failures === 0 ? "\nmapcheck passed\n" : `\n${failures} failure(s)\n`);
process.exit(failures === 0 ? 0 : 1);
