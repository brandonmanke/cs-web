import {
  ARENA_BOXES, ARENA_HULLS, ARENA_SPAWN, ARENA_SPAWN_YAW, ARENA_TARGETS,
} from "./arena";
import { GameAudio } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import { Renderer } from "./renderer";
import { Flags, ShotResult, Sim, Snapshot } from "./sim";
import { Viewmodel } from "./viewmodel";

const TICK_SECONDS = 1 / 64;
const MAX_FRAME_SECONDS = 0.25;

async function boot(): Promise<void> {
  const hud = new Hud();
  hud.setStatus("LOADING WASM SIM");

  const container = document.getElementById("app")!;
  const renderer = new Renderer(container);
  const sim = await Sim.load();
  const input = new Input(container);
  input.attach();
  const audio = new GameAudio();
  const viewmodel = new Viewmodel();
  await viewmodel.load(renderer.camera);
  renderer.scene.add(renderer.camera); // required for camera-attached viewmodel

  const wantDust2 = new URLSearchParams(location.search).get("map") === "dust2";
  let spawn = ARENA_SPAWN;
  let spawnYaw = ARENA_SPAWN_YAW;
  let useArena = !wantDust2;

  if (wantDust2) {
    hud.setStatus("LOADING DUST2");
    const dust2 = await renderer.loadDust2();
    if (dust2) {
      const ok = sim.addMesh(dust2.vertices, dust2.indices, 3);
      if (!ok) {
        hud.setStatus("DUST2 MESH REJECTED");
        return;
      }
      // Safety floor far below in case of walking off the mesh edge.
      sim.addBox([-16384, -2048, -16384], [16384, -2032, 16384], 0);
      // Drop into the middle of the map and let gravity find the ground.
      spawn = [0, 900, 0];
      spawnYaw = Math.PI * 0.5;
      sim.addTarget(200, 0, -400, 0, 400, 90);
    } else {
      // GLB missing (assets/ ref models are gitignored): fall back to the arena.
      useArena = true;
    }
  }
  if (useArena) {
    buildArena(sim);
    renderer.buildBoxes(ARENA_BOXES);
    renderer.buildHulls(ARENA_HULLS);
  }
  renderer.buildTargets(ARENA_TARGETS);
  sim.finalizeWorld();
  sim.spawn(spawn[0]!, spawn[1]!, spawn[2]!, spawnYaw);
  input.setYaw(spawnYaw);

  hud.setStatus(null);

  const prev = new Snapshot();
  const curr = new Snapshot();
  sim.read(curr);
  prev.copyFrom(curr);

  let lastShotSeen = 0;
  let accumulator = 0;
  let lastTime = performance.now();

  function frame(now: number): void {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > MAX_FRAME_SECONDS) dt = MAX_FRAME_SECONDS;
    accumulator += dt;

    while (accumulator >= TICK_SECONDS) {
      accumulator -= TICK_SECONDS;
      prev.copyFrom(curr);
      sim.step(input.sample());
      sim.read(curr);

      if (curr.shotSequence !== lastShotSeen) {
        lastShotSeen = curr.shotSequence;
        if (curr.shotResult === ShotResult.dry) {
          audio.dry();
        } else if (curr.shotResult !== ShotResult.none) {
          audio.shot();
          viewmodel.onShot();
          renderer.spawnTracer(curr.shotStart, curr.shotEnd);
          hud.onShot(curr.shotResult);
          if (curr.shotResult === ShotResult.kill) audio.kill();
          else if (curr.shotResult === ShotResult.hit) audio.hit();
        }
      }
    }

    const alpha = accumulator / TICK_SECONDS;
    renderer.updateTargets(curr);
    renderer.updateTracers(dt);
    viewmodel.update(dt, curr.speedH, (curr.flags & Flags.onGround) !== 0);
    hud.update(curr, dt);
    renderer.render(prev, curr, alpha, input.yaw, input.pitch);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function buildArena(sim: Sim): void {
  for (const box of ARENA_BOXES) {
    sim.addBox(box.min, box.max, box.mat);
  }
  for (const hull of ARENA_HULLS) {
    sim.addHull(new Float32Array(hull.points), hull.mat);
  }
  for (const target of ARENA_TARGETS) {
    sim.addTarget(target.x, target.y, target.z, target.minX, target.maxX, target.speed);
  }
}

void boot();
