import { Flags, type Sim, type Snapshot } from "../client/src/sim";
import type { Vec3 } from "../client/src/map/brush";

// Authored walking routes, with feet positions at each checkpoint. These use
// the real player hull and pmove, not point rays or a separate navigation model.
const ROUTES: Record<string, Record<string, Vec3[]>> = {
  foundry: {
    ring: [[-480, 96, -704], [480, 96, -704], [480, 96, 704], [-480, 96, 704], [-480, 96, -704]],
    catwalk: [[0, 96, -704], [0, 208, -352], [0, 208, 352], [0, 96, 704]],
    "pit stairs": [[-128, 96, -448], [-128, 0, -128], [128, 0, -128], [128, 0, 128], [128, 96, 448]],
  },
  silo: {
    ring: [[-368, 0, 544], [-368, 0, -544], [368, 0, -544], [368, 0, 544], [-368, 0, 544]],
    crosscut: [[-448, 0, 0], [448, 0, 0]],
    "crosscut north edge": [[-448, 0, -64], [448, 0, -64]],
    "crosscut south edge": [[-448, 0, 64], [448, 0, 64]],
    "west balcony": [[-640, 0, -712], [-640, 128, -240], [-640, 128, 240], [-640, 0, 712]],
    "east balcony": [[640, 0, -712], [640, 128, -240], [640, 128, 240], [640, 0, 712]],
    "north connection": [[-640, 0, -712], [640, 0, -712]],
    "south connection": [[-640, 0, 712], [640, 0, 712]],
  },
  relay: {
    bridge: [[0, 192, -880], [0, 192, 880]],
    "bridge left lane": [[-48, 192, -880], [-48, 192, 880]],
    "bridge right lane": [[48, 192, -880], [48, 192, 880]],
    "west gallery": [[-736, 192, -704], [-736, 192, 704]],
    "east gallery": [[736, 192, -704], [736, 192, 704]],
    "west ramps": [[-416, 192, -720], [-416, 0, -112], [-416, 0, 112], [-416, 192, 720]],
    "east ramps": [[416, 192, -720], [416, 0, -112], [416, 0, 112], [416, 192, 720]],
    "window crossing": [[-864, 0, 0], [-416, 0, 0], [416, 0, 0], [864, 0, 0]],
    "north deck": [[-736, 192, -696], [736, 192, -696]],
    "south deck": [[-736, 192, 696], [736, 192, 696]],
    "northwest tower": [[0, 192, -880], [-128, 192, -880], [-656, 384, -880], [-736, 384, -880], [-736, 384, -800]],
    "northeast tower": [[0, 192, -880], [128, 192, -880], [656, 384, -880], [736, 384, -880], [736, 384, -800]],
    "southwest tower": [[0, 192, 880], [-128, 192, 880], [-656, 384, 880], [-736, 384, 880], [-736, 384, 800]],
    "southeast tower": [[0, 192, 880], [128, 192, 880], [656, 384, 880], [736, 384, 880], [736, 384, 800]],
  },
};

/** Returns a useful failure at the first blocked checkpoint of each route. */
export function checkRoutes(name: string, sim: Sim, snapshot: Snapshot): string[] {
  const failures: string[] = [];
  const routes = Object.entries(ROUTES[name] ?? {});
  for (const [label, points] of routes) {
    for (const reverse of [false, true]) {
      const path = reverse ? [...points].reverse() : points;
      const start = path[0]!;
      sim.spawn(start[0], start[1] + 40, start[2], 0);
      for (let tick = 0; tick < 32; ++tick) {
        sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 });
      }
      sim.read(snapshot);
      for (const target of path.slice(1)) {
        const distance = Math.hypot(target[0] - snapshot.origin[0]!, target[2] - snapshot.origin[2]!);
        const timeout = Math.ceil(distance / 100 * 64) + 128;
        let reached = false;
        for (let tick = 0; tick < timeout; ++tick) {
          const dx = target[0] - snapshot.origin[0]!;
          const dz = target[2] - snapshot.origin[2]!;
          if (Math.hypot(dx, dz) < 12 && Math.abs(snapshot.origin[1]! - target[1] - 36) < 3 &&
              (snapshot.flags & Flags.onGround) !== 0) {
            reached = true;
            break;
          }
          // Ordinary forward movement only: no jump, duck, teleport or bot assist.
          sim.step({ forward: 1, strafe: 0, yaw: Math.atan2(-dx, -dz), pitch: 0, buttons: 0, weapon: 0 });
          sim.read(snapshot);
          if (snapshot.origin[1]! < 35.9) break;
        }
        if (!reached) {
          failures.push(`${label}${reverse ? " reverse" : ""}: blocked before ${target.join(",")} ` +
            `(at ${Array.from(snapshot.origin).map((n) => n.toFixed(1)).join(",")})`);
          break;
        }
      }
    }
  }
  if (routes.length > 0 && failures.length === 0) {
    console.log(`  ok    ${routes.length * 2} walking routes, including reverse traversal`);
  }
  return failures;
}
