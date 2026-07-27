import * as THREE from "three";
import { GameAudio } from "./audio";
import { Hud } from "./hud";
import { Input } from "./input";
import { brushPlaneArray } from "./map/brush";
import type { MapDef } from "./map/mapdef";
import { DEPOT } from "./map/maps/depot";
import { FOUNDRY } from "./map/maps/foundry";
import { PRACTICE } from "./map/maps/practice";
import { SILO } from "./map/maps/silo";
import { Menu } from "./menu";
import { Renderer } from "./renderer";
import {
  EventKind, Flags, MAX_PLAYERS, Mode, ShotResult, Sim, Snapshot, Team,
  TICK_SECONDS, type EventView,
} from "./sim";
import { Viewmodel } from "./viewmodel";

const MAX_FRAME_SECONDS = 0.25;
/** Beyond this a gunshot is inaudible; inside it, volume falls off linearly. */
const AUDIO_RANGE = 2600;
const DEFAULT_BOT_SKILL = 1;

const scratch = new THREE.Vector3();

const MAPS: Record<string, MapDef> = {
  foundry: FOUNDRY,
  depot: DEPOT,
  silo: SILO,
  practice: PRACTICE,
};

const MODE_LABELS: Record<number, string> = {
  [Mode.range]: "RANGE",
  [Mode.deathmatch]: "DEATHMATCH",
  [Mode.team]: "TEAM",
};

function chooseMap(): MapDef {
  const requested = new URLSearchParams(location.search).get("map");
  return MAPS[requested ?? ""] ?? FOUNDRY;
}

/** ?bots= and ?skill= override the map's roster; everything else is authored. */
function rosterOverrides(map: MapDef): { bots: number; skill: number } {
  const params = new URLSearchParams(location.search);
  const bots = Number(params.get("bots"));
  const skill = Number(params.get("skill"));
  return {
    bots: params.has("bots") && Number.isFinite(bots)
      ? Math.max(0, Math.min(MAX_PLAYERS - 1, Math.floor(bots)))
      : map.bots,
    skill: params.has("skill") && Number.isFinite(skill)
      ? Math.max(0, Math.min(2, Math.floor(skill)))
      : DEFAULT_BOT_SKILL,
  };
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
  const menu = new Menu(audio, (onGaveUp) => input.requestLock(onGaveUp));
  input.onLockChange = (locked) => {
    if (locked) menu.markStarted();
    menu.setVisible(!locked);
  };

  const map = chooseMap();
  const roster = rosterOverrides(map);
  menu.setMap(map.name, `${MODE_LABELS[map.mode] ?? "?"} · ${roster.bots} BOTS`);
  menu.setMapList(Object.keys(MAPS), map.name);

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
  for (const spawn of map.spawns) {
    sim.addSpawn(spawn.pos, spawn.yaw, spawn.team ?? Team.none);
  }
  sim.finalizeWorld();

  hud.setStatus("BAKING LIGHT");
  // Yield once so the status paints before the bake blocks the main thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const bakeStart = performance.now();
  const rays = renderer.buildMap(map, (from, to) => sim.isBlocked(from, to));
  const bakeMs = Math.round(performance.now() - bakeStart);
  console.info(`${map.name}: ${map.brushes.length} brushes, ${rays} shadow rays, ${bakeMs}ms bake`);

  sim.startMatch(map.mode, roster.bots, roster.skill);

  const prev = new Snapshot();
  const curr = new Snapshot();
  sim.read(curr);
  prev.copyFrom(curr);

  renderer.buildPlayers(
    Array.from({ length: curr.playerCount }, (_, i) => curr.players[i]!.team),
  );

  // Dev overrides for scouting geometry: ?spawn=x,y,z and ?yaw=radians. These
  // land after the match starts, so they win over the authored spawn.
  const params = new URLSearchParams(location.search);
  let spawnYaw = map.spawns[0]?.yaw ?? 0;
  const spawnParam = params.get("spawn");
  const yawParam = Number(params.get("yaw"));
  if (params.has("yaw") && Number.isFinite(yawParam)) spawnYaw = yawParam;
  if (spawnParam) {
    const parts = spawnParam.split(",").map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      sim.spawn(parts[0]!, parts[1]!, parts[2]!, spawnYaw);
    }
  } else if (params.has("yaw")) {
    sim.spawn(curr.origin[0], curr.origin[1], curr.origin[2], spawnYaw);
  }
  input.setYaw(spawnYaw);
  sim.read(curr);
  prev.copyFrom(curr);

  hud.setStatus(null);
  menu.setVisible(true); // the world is ready; this is the start screen

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
      // Events are per-tick, not cumulative: read them before the next step
      // overwrites them, which is exactly what this loop does.
      for (let i = 0; i < curr.eventCount; ++i) handleEvent(curr.events[i]!);
    }

    const alpha = accumulator / TICK_SECONDS;
    input.takeViewDelta();
    input.setFov(curr.fov);
    renderer.setFov(curr.fov);
    renderer.updatePlayers(prev, curr, alpha, dt, curr.localIndex);
    renderer.updateEffects(dt);
    viewmodel.setWeapon(curr.weapon);
    // Scoped, the viewmodel would sit across the middle of the scope image.
    viewmodel.setHidden(curr.zoom > 0 || (curr.flags & Flags.alive) === 0);
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

  /** 1 at the muzzle, 0 past AUDIO_RANGE. */
  function attenuation(at: readonly number[]): number {
    const distance = Math.hypot(
      at[0]! - curr.origin[0], at[1]! - curr.origin[1] - curr.eyeHeight,
      at[2]! - curr.origin[2],
    );
    return Math.max(0, 1 - distance / AUDIO_RANGE);
  }

  function handleEvent(event: EventView): void {
    if (event.kind === EventKind.death) {
      hud.onDeath(event.actor, event.victim, event.weapon, curr.localIndex);
      if (event.actor === curr.localIndex) audio.kill();
      return;
    }
    if (event.kind !== EventKind.shot) return;

    const local = event.actor === curr.localIndex;
    if (event.result === ShotResult.dry) {
      if (local) audio.dry();
      return;
    }

    const gain = local ? 1 : attenuation(event.start);
    if (gain <= 0) return;
    audio.shot(event.weapon, gain);

    if (local) {
      viewmodel.onShot();
      hud.onShot(event.result);
    }

    // Your own tracers start at the muzzle, not the eye, or they read as coming
    // from your forehead — unless the viewmodel is hidden down the scope, where
    // the shot should leave from the middle of the sight picture instead.
    const start = local && curr.zoom === 0
      ? (() => {
          const muzzle = viewmodel.muzzleWorld(scratch);
          return [muzzle.x, muzzle.y, muzzle.z] as const;
        })()
      : event.start;
    renderer.spawnTracer(start, event.end);

    if (event.result === ShotResult.world) {
      // Re-trace slightly past the impact to recover the surface normal, which
      // the event doesn't carry.
      const from = event.start;
      const to = event.end;
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const dz = to[2] - from[2];
      const length = Math.hypot(dx, dy, dz) || 1;
      const overshoot = 4 / length;
      const hit = sim.traceRay(from, [
        to[0] + dx * overshoot, to[1] + dy * overshoot, to[2] + dz * overshoot,
      ]);
      if (hit) renderer.spawnImpact(hit.point, hit.normal);
      audio.impact(event.material, gain);
    } else if (local && event.result === ShotResult.hit) {
      audio.hit();
    } else if (event.victim === curr.localIndex) {
      audio.hurt();
    }
  }

  requestAnimationFrame(frame);
}

void boot();
