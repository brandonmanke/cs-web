import assert from "node:assert/strict";
import { test } from "node:test";
import { Flags, Sim, Snapshot, Team } from "../client/src/sim";
import { brushPlaneArray } from "../client/src/map/brush";
import { FOUNDRY } from "../client/src/map/maps/foundry";
import { DEPOT } from "../client/src/map/maps/depot";
import { SILO } from "../client/src/map/maps/silo";
import { RELAY } from "../client/src/map/maps/relay";
import { PRACTICE } from "../client/src/map/maps/practice";

for (const [map, upperFloor] of [[FOUNDRY, 208], [DEPOT, 160], [SILO, 128], [RELAY, 384], [PRACTICE, 64]] as const) {
  test(`${map.name}: bots roam between levels without falling or embedding`, async () => {
    const sim = await Sim.load();
    for (const brush of map.brushes) sim.addBrush(brushPlaneArray(brush), brush.surface);
    for (const spawn of map.spawns) sim.addSpawn(spawn.pos, spawn.yaw, spawn.team ?? Team.none);
    sim.finalizeWorld();
    sim.startMatch(map.mode, 9, 0);
    const snap = new Snapshot();
    let lowest = Infinity, highest = -Infinity;
    for (let tick = 0; tick < 300 * 64; ++tick) {
      sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 });
      sim.read(snap);
      for (let index = 1; index < snap.playerCount; ++index) {
        const p = snap.players[index]!;
        const feet = p.y - ((p.flags & Flags.ducked) !== 0 ? 18 : 36);
        lowest = Math.min(lowest, feet);
        highest = Math.max(highest, feet);
        assert.ok(feet >= -0.1, `bot ${index} fell through the floor at tick ${tick}`);
        if (tick % 16 === 0) {
          assert.ok(!map.brushes.some((brush) => brush.planes.every(({ n, d }) =>
            n[0] * p.x + n[1] * (feet + 1) + n[2] * p.z < d - 0.1)),
          `bot ${index} embedded in a brush at tick ${tick}`);
        }
      }
    }
    assert.ok(lowest < 1, "bots must reach the lower floor");
    assert.ok(highest >= upperFloor - 1, `bots never reached the ${upperFloor}u upper route (max ${highest})`);
    assert.equal(snap.deaths, 0, "passive bots must not fire at the player");
  });
}
