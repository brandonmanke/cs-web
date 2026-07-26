import * as THREE from "three";
import { GameAudio } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import { brushPlaneArray } from "./map/brush";
import type { MapDef } from "./map/mapdef";
import { FOUNDRY } from "./map/maps/foundry";
import { PRACTICE } from "./map/maps/practice";
import { Renderer } from "./renderer";
import { Flags, ShotResult, Sim, Snapshot, TICK_SECONDS } from "./sim";
import { Viewmodel } from "./viewmodel";

const MAX_FRAME_SECONDS = 0.25;

const scratch = new THREE.Vector3();

const MAPS: Record<string, MapDef> = {
  foundry: FOUNDRY,
  practice: PRACTICE,
};

function chooseMap(): MapDef {
  const requested = new URLSearchParams(location.search).get("map");
  return MAPS[requested ?? ""] ?? FOUNDRY;
}

async function boot(): Promise<void> {
  const hud = new Hud();
  hud.setStatus("LOADING SIM");

  const container = document.getElementById("app")!;
  const renderer = new Renderer(container);
  const sim = await Sim.load();
  const input = new Input(container);
  input.attach();
  const audio = new GameAudio();
  const viewmodel = new Viewmodel(renderer.camera);

  const map = chooseMap();

  // Collision first: the light bake ray-casts against this exact geometry, so
  // the world has to be finalized before anything is lit.
  hud.setStatus("BUILDING WORLD");
  let rejected = 0;
  for (const brush of map.brushes) {
    if (!sim.addBrush(brushPlaneArray(brush), brush.surface)) ++rejected;
  }
  if (rejected > 0) {
    console.warn(`${rejected} brush(es) rejected as degenerate`);
  }
  for (const target of map.targets) {
    sim.addTarget(target.x, target.y, target.z, target.minX, target.maxX, target.speed);
  }
  sim.finalizeWorld();

  hud.setStatus("BAKING LIGHT");
  // Yield once so the status paints before the bake blocks the main thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const bakeStart = performance.now();
  const rays = renderer.buildMap(map, (from, to) => sim.isBlocked(from, to));
  const bakeMs = Math.round(performance.now() - bakeStart);
  console.info(`${map.name}: ${map.brushes.length} brushes, ${rays} shadow rays, ${bakeMs}ms bake`);

  renderer.buildTargets(map.targets.length);

  // Dev overrides for scouting geometry: ?spawn=x,y,z and ?yaw=radians.
  // Pair with ?coords to read positions back out of the HUD.
  const params = new URLSearchParams(location.search);
  let spawn = map.spawn;
  let spawnYaw = map.spawnYaw;
  const spawnParam = params.get("spawn");
  if (spawnParam) {
    const parts = spawnParam.split(",").map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      spawn = [parts[0]!, parts[1]!, parts[2]!];
    }
  }
  const yawParam = Number(params.get("yaw"));
  if (params.has("yaw") && Number.isFinite(yawParam)) spawnYaw = yawParam;

  sim.spawn(spawn[0], spawn[1], spawn[2], spawnYaw);
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
      input.notifyWeapon(curr.weapon);

      if (curr.shotSequence !== lastShotSeen) {
        lastShotSeen = curr.shotSequence;
        handleShot(curr);
      }
    }

    const alpha = accumulator / TICK_SECONDS;
    input.takeViewDelta();
    renderer.updateTargets(prev, curr, alpha, dt);
    renderer.updateEffects(dt);
    viewmodel.setWeapon(curr.weapon);
    viewmodel.update(dt, {
      speedH: curr.speedH,
      onGround: (curr.flags & Flags.onGround) !== 0,
      reloading: curr.reload > 0,
      yawDelta: input.yawDelta,
      pitchDelta: input.pitchDelta,
    });
    hud.update(curr, dt);
    renderer.render(prev, curr, alpha, input.yaw, input.pitch);
    requestAnimationFrame(frame);
  }

  function handleShot(snapshot: Snapshot): void {
    if (snapshot.shotResult === ShotResult.dry) {
      audio.dry();
      return;
    }
    if (snapshot.shotResult === ShotResult.none) return;

    audio.shot(snapshot.weapon);
    viewmodel.onShot();
    hud.onShot(snapshot.shotResult);

    // Tracers start at the muzzle, not the eye, or they read as coming from
    // your forehead.
    const muzzle = viewmodel.muzzleWorld(scratch);
    renderer.spawnTracer([muzzle.x, muzzle.y, muzzle.z], snapshot.shotEnd);

    if (snapshot.shotResult === ShotResult.world) {
      // Re-trace slightly past the impact to recover the surface normal, which
      // the snapshot doesn't carry.
      const start = snapshot.shotStart;
      const end = snapshot.shotEnd;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const dz = end[2] - start[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      const overshoot = 4 / length;
      const hit = sim.traceRay(start, [
        end[0] + dx * overshoot, end[1] + dy * overshoot, end[2] + dz * overshoot,
      ]);
      if (hit) renderer.spawnImpact(hit.point, hit.normal);
      audio.impact(snapshot.shotMaterial);
    } else if (snapshot.shotResult === ShotResult.kill) {
      audio.kill();
    } else if (snapshot.shotResult === ShotResult.hit) {
      audio.hit();
    }
  }

  requestAnimationFrame(frame);
}

void boot();
