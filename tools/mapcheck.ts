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
import { DEPOT } from "../client/src/map/maps/depot";
import { FOUNDRY } from "../client/src/map/maps/foundry";
import { PRACTICE } from "../client/src/map/maps/practice";
import { RELAY } from "../client/src/map/maps/relay";
import { SILO } from "../client/src/map/maps/silo";
import { Flags, MAX_PLAYERS, Mode, Sim, Snapshot, Team } from "../client/src/sim";
import { checkRoutes } from "./maproutes";

const MAPS: Record<string, MapDef> = {
  foundry: FOUNDRY,
  depot: DEPOT,
  silo: SILO,
  relay: RELAY,
  practice: PRACTICE,
};

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

  for (const spawn of map.spawns) {
    sim.addSpawn(spawn.pos, spawn.yaw, spawn.team ?? Team.none);
  }
  sim.finalizeWorld();

  const snapshot = new Snapshot();

  // 3. Every spawn point must catch a player, not drop them into the void or
  //    bury them in a brush. This is the check that made targets-in-the-air
  //    impossible, generalized now that spawns are the only placement there is.
  if (map.spawns.length === 0) fail("map defines no spawn points");
  if (map.spawns.length < map.bots + 1) {
    fail(`${map.spawns.length} spawn(s) for ${map.bots + 1} players — they will stack`);
  }
  if (map.bots + 1 > MAX_PLAYERS) fail(`${map.bots} bots exceeds the roster limit`);
  let badSpawns = 0;
  for (const [i, spawn] of map.spawns.entries()) {
    // A drop can settle at the correct height while still buried in a wall.
    // Check the standing hull against each brush's expanded planes first.
    const embedded = map.brushes.some((brush) => brush.planes.every(({ n, d }) => {
      const support = 16 * (Math.abs(n[0]) + Math.abs(n[2])) + 36 * Math.abs(n[1]);
      return n[0] * spawn.pos[0] + n[1] * spawn.pos[1] + n[2] * spawn.pos[2] - d <
        support - 0.01;
    }));
    if (embedded) {
      fail(`spawn ${i} ${spawn.pos.join(",")} overlaps a solid brush`);
      ++badSpawns;
    }
    const probe = dropProbe(sim, snapshot, spawn.pos[0], spawn.pos[1], spawn.pos[2]);
    if (!probe.grounded) {
      fail(`spawn ${i} ${spawn.pos.join(",")} never lands (rests at y=${probe.y.toFixed(1)})`);
      ++badSpawns;
    } else if (probe.y < spawn.pos[1] - 400) {
      fail(`spawn ${i} ${spawn.pos.join(",")} falls ${(spawn.pos[1] - probe.y).toFixed(0)}u`);
      ++badSpawns;
    } else if (probe.y > spawn.pos[1] + 24) {
      // Landing *above* where you were placed means the hull was inside a
      // brush and the unstick pass pushed it out.
      fail(`spawn ${i} ${spawn.pos.join(",")} is embedded (popped up to y=${probe.y.toFixed(1)})`);
      ++badSpawns;
    }
  }
  if (badSpawns === 0) pass(`${map.spawns.length} spawn point(s) land clean`);

  // 4. Team maps need usable spawns on both sides.
  if (map.mode === Mode.team) {
    const ct = map.spawns.filter((s) => (s.team ?? Team.none) !== Team.t).length;
    const t = map.spawns.filter((s) => (s.team ?? Team.none) !== Team.ct).length;
    if (ct === 0 || t === 0) fail(`team map has ${ct} CT / ${t} T spawns`);
    else pass(`${ct} CT / ${t} T spawns`);
    if ((map.spawns[0]?.team ?? Team.none) === Team.t) {
      fail("spawns[0] is a T spawn, but the local player is always CT");
    }
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

  // Valid brushes and clean spawns do not guarantee a player can cross a map.
  for (const failure of checkRoutes(name, sim, snapshot)) fail(failure);
  if (name === "foundry") {
    const before = failures;
    for (const x of [-192, 192]) {
      for (const z of [-400, 0, 400]) {
        if (sim.isBlocked([x, 272, z], [x, 2000, z])) fail(`Foundry roof opening is blocked at ${x},${z}`);
      }
    }
    if (before === failures) pass("open sky above the furnace and both catwalk approaches");
  }
  if (name === "relay") {
    const before = failures;
    for (const x of [-736, 736]) {
      for (const z of [-800, 800]) {
        const eye = [x, 448, z];
        // Tall bridge cover intentionally shields the midpoint from some
        // angles; each tower must still see its half's bridge approach.
        if (sim.isBlocked(eye, [0, 256, Math.sign(z) * 320])) fail(`tower ${x},${z} cannot see the bridge approach`);
        if (!sim.isBlocked(eye, [0, 64, 0])) fail(`tower ${x},${z} exposes the sheltered lower crossing`);
      }
    }
    if (sim.isBlocked([0, 256, 0], [0, 2000, 0])) fail("Relay's open sky is blocked by a ceiling");
    for (const side of [-1, 1]) {
      if (!sim.isBlocked([side * 116, 320, side * 400], [side * 116, 256, side * 100])) {
        fail("tall bridge cover does not protect against elevated fire");
      }
    }
    // Removing just the glass must expose space, proving no opaque floor or
    // wall was left behind the pane. The full world must still block the ray.
    const withoutGlass = await Sim.load();
    for (const brush of map.brushes) {
      if (brush.tex !== "glass") withoutGlass.addBrush(brushPlaneArray(brush), brush.surface);
    }
    withoutGlass.finalizeWorld();
    for (const side of [-1, 1]) {
      const windows = [
        { label: "floor", from: [side * 416, 64, 0], to: [side * 416, -256, 0] },
        { label: "wall", from: [side * 864, 64, 0], to: [side * 1100, 64, 0] },
      ];
      for (const window of windows) {
        if (!sim.isBlocked(window.from, window.to)) fail(`${window.label} viewport has no solid glass`);
        if (withoutGlass.isBlocked(window.from, window.to)) fail(`${window.label} viewport has an opaque backing`);
      }
    }
    if (before === failures) pass("tower sightlines, tall cover, sheltered crossing and four solid viewports");
  }
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
