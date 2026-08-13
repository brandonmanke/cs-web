import * as THREE from "three";
import { GameAudio } from "./audio";
import { Hud } from "./hud";
import { DEFAULT_SENSITIVITY, Input } from "./input";
import { brushPlaneArray } from "./map/brush";
import type { MapDef } from "./map/mapdef";
import { DEPOT } from "./map/maps/depot";
import { FOUNDRY } from "./map/maps/foundry";
import { PRACTICE } from "./map/maps/practice";
import { SILO } from "./map/maps/silo";
import { DeathCam } from "./deathcam";
import { loadSetting, Menu, PASSIVE_SKILL, Settings, type Roster } from "./menu";
import { Renderer } from "./renderer";
import {
  EventKind, Flags, MAX_PLAYERS, Mode, ShotResult, Sim, Snapshot, StepKind, Team,
  TICK_SECONDS, type EventView, type TraceHit,
} from "./sim";
import { Viewmodel } from "./viewmodel";

const MAX_FRAME_SECONDS = 0.25;
/**
 * Past this we don't even build the audio node. Falloff itself is the panner's
 * job; this is only a cull so a firefight across the map doesn't allocate.
 */
const AUDIO_CULL_RANGE = 5000;
/** Past three walls a sound is inaudible anyway, so stop paying for traces. */
const OCCLUSION_MAX_WALLS = 3;
/** cs::kMaxPenetrations + the wall the round finally stops in. */
const MAX_IMPACT_SURFACES = 4;
/** How far past a surface the next trace starts, in units. */
const SURFACE_SKIN = 1;
/** How far past a bullet's resting point to look for the wall it stopped on. */
const IMPACT_OVERSHOOT = 4;
/** cs::sim_start_match takes skill as a continuous 0..2. */
const MAX_BOT_SKILL = 2;
const DEFAULT_BOT_SKILL = 1;
const MAX_BOTS = MAX_PLAYERS - 1;

const scratch = new THREE.Vector3();
const walkFrom = [0, 0, 0];
const walkTo = [0, 0, 0];
const earPos = [0, 0, 0];
const listenerPos = new THREE.Vector3();
const listenerFwd = new THREE.Vector3();
const listenerUp = new THREE.Vector3();

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

/**
 * How many bots to start with, in precedence order: `?bots=`, then whatever
 * you last chose in the menu, then the map's default.
 *
 * That default is 0 for anything hostile. Loading a URL should not drop you
 * into a firefight you didn't ask for — you get an empty map to look at and
 * move around in, and PvP is one slider away. Range maps are the exception:
 * their bots never shoot, so they're scenery, not opponents.
 */
function initialRoster(map: MapDef): Roster {
  const params = new URLSearchParams(location.search);
  const urlBots = Number(params.get("bots"));
  const urlSkill = Number(params.get("skill"));
  const mapDefault = map.mode === Mode.range ? map.bots : 0;
  return {
    bots: params.has("bots") && Number.isFinite(urlBots)
      ? Math.max(0, Math.min(MAX_BOTS, Math.floor(urlBots)))
      : loadSetting(Settings.bots, 0, MAX_BOTS) ?? mapDefault,
    // Skill is continuous, so ?skill=1.4 is a real setting, not a rounded 1.
    skill: params.has("skill") && Number.isFinite(urlSkill)
      ? Math.max(0, Math.min(MAX_BOT_SKILL, urlSkill))
      : loadSetting(Settings.skill, 0, MAX_BOT_SKILL) ?? DEFAULT_BOT_SKILL,
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
  const deathCam = new DeathCam();
  const map = chooseMap();
  const menu = new Menu(
    audio,
    (onGaveUp) => input.requestLock(onGaveUp),
    (next) => startMatch(next),
    (multiplier) => { input.sensitivity = DEFAULT_SENSITIVITY * multiplier; },
  );
  input.onLockChange = (locked) => {
    if (locked) menu.markStarted();
    menu.setVisible(!locked);
  };

  const roster = initialRoster(map);
  menu.setRoster(roster);
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

  const prev = new Snapshot();
  const curr = new Snapshot();
  // Only the sim can trace the world, so the audio asks it what is in the way.
  audio.setOcclusionProbe(wallsTo);

  /**
   * Start (or restart) a match in place. The world and its light bake are
   * untouched, so the menu's enemy slider costs a roster rebuild and nothing
   * else — which is what makes turning PvP on a slider rather than a reload.
   */
  function startMatch(next: Roster): void {
    sim.startMatch(map.mode, next.bots, next.skill);
    sim.read(curr);
    prev.copyFrom(curr);
    renderer.buildPlayers(
      Array.from({ length: curr.playerCount }, (_, i) => curr.players[i]!.team),
    );
    input.setYaw(curr.players[curr.localIndex]!.yaw);
    // "4 BOTS" would imply a firefight; at the bottom of the dial they roam and
    // never shoot, and that is worth saying before you walk in.
    const passive = next.skill <= PASSIVE_SKILL ? " · PASSIVE" : "";
    const enemies = next.bots === 0 ? "NO ENEMIES" : `${next.bots} BOTS${passive}`;
    menu.setMap(map.name, `${MODE_LABELS[map.mode] ?? "?"} · ${enemies}`);
  }

  startMatch(roster);

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
  let wasAlive = true;

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

      // The respawn tick is the one tick where the sim's yaw is the spawn
      // point's rather than the mouse's — pmove overwrites it from the next
      // command onward. Catching it here rather than at render time means it
      // survives a frame that advanced several ticks.
      const alive = (curr.flags & Flags.alive) !== 0;
      if (alive && !wasAlive) input.setYaw(curr.players[curr.localIndex]!.yaw);
      wasAlive = alive;
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
    hud.setScoreboard(input.scoreboard);
    hud.update(curr, dt);
    const death = deathCam.update(dt, curr, input.yaw, input.pitch);
    renderer.render(
      prev, curr, alpha, dt,
      death?.yaw ?? input.yaw, death?.pitch ?? input.pitch, death?.eyeHeight,
    );
    // Ears follow the camera, after it has been placed for this frame.
    renderer.camera.getWorldPosition(listenerPos);
    renderer.camera.getWorldDirection(listenerFwd);
    listenerUp.set(0, 1, 0).applyQuaternion(renderer.camera.quaternion);
    audio.setListener(listenerPos.toArray(), listenerFwd.toArray(), listenerUp.toArray());
    requestAnimationFrame(frame);
  }

  /** True if a sound at this point is close enough to be worth building. */
  function audible(at: readonly number[]): boolean {
    return Math.hypot(
      at[0]! - curr.origin[0], at[1]! - curr.origin[1] - curr.eyeHeight,
      at[2]! - curr.origin[2],
    ) < AUDIO_CULL_RANGE;
  }

  /**
   * The surfaces a segment enters, nearest first: `visit` sees each one, and
   * the count comes back.
   *
   * Each trace that hits restarts the next one just past the surface it hit,
   * and a trace that begins solid reports no hit — so a wall is entered once,
   * seen once, and never met again. That one property is what lets both the
   * audio occlusion and the wallbang decals read the world without a portal
   * graph or any authored volumes.
   */
  function eachSurface(from: readonly number[], to: readonly number[],
                       limit: number, visit?: (hit: TraceHit) => void): number {
    let dx = to[0]! - from[0]!;
    let dy = to[1]! - from[1]!;
    let dz = to[2]! - from[2]!;
    const length = Math.hypot(dx, dy, dz);
    if (length < 1) return 0;
    dx /= length;
    dy /= length;
    dz /= length;

    let found = 0;
    let travelled = 0;
    while (found < limit && travelled < length) {
      walkFrom[0] = from[0]! + dx * travelled;
      walkFrom[1] = from[1]! + dy * travelled;
      walkFrom[2] = from[2]! + dz * travelled;
      const hit = sim.traceRay(walkFrom, to);
      if (!hit) break;
      ++found;
      visit?.(hit);
      // Project the impact back onto the ray. Adding the skin makes this
      // strictly increasing, so the loop terminates even if a trace were to
      // report a hit at zero distance.
      travelled = (hit.point[0] - from[0]!) * dx + (hit.point[1] - from[1]!) * dy +
                  (hit.point[2] - from[2]!) * dz + SURFACE_SKIN;
    }
    return found;
  }

  /** How many brushes stand between the ears and a point. */
  function wallsTo(at: readonly number[]): number {
    earPos[0] = curr.origin[0];
    earPos[1] = curr.origin[1] + curr.eyeHeight;
    earPos[2] = curr.origin[2];
    return eachSurface(earPos, at, OCCLUSION_MAX_WALLS);
  }

  function handleEvent(event: EventView): void {
    if (event.kind === EventKind.death) {
      hud.onDeath(event.actor, event.victim, event.weapon, curr.localIndex);
      if (event.actor === curr.localIndex) audio.kill();
      if (event.victim === curr.localIndex) deathCam.onKilled(event.actor, curr.localIndex);
      return;
    }
    if (event.kind === EventKind.step) {
      // Your own footfalls play flat: a panner at the listener's own position
      // has no direction to give and the HRTF filtering just muddies them.
      const own = event.actor === curr.localIndex;
      if (!own && !audible(event.start)) return;
      audio.step(event.material, own ? undefined : event.start,
                 event.result === StepKind.land);
      return;
    }
    if (event.kind !== EventKind.shot) return;

    const local = event.actor === curr.localIndex;
    if (event.result === ShotResult.dry) {
      if (local) audio.dry();
      return;
    }
    if (!local && !audible(event.start)) return;

    audio.shot(event.weapon, local ? undefined : event.start);

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

    // Mark every surface the round entered, not just where it came to rest: a
    // shot that punched through a partition and killed someone behind it has to
    // leave the near-side spall, or the wallbang is invisible from where you
    // fired it. The walk re-derives what the sim already decided — the event
    // carries one endpoint, and the surfaces between are a trace away.
    //
    // A round that failed to get through stops exactly *on* the face that
    // stopped it, and a segment ending on a plane doesn't register as crossing
    // it, so that last surface needs reaching past. Only for a shot that ended
    // in the world: an endpoint on a hitbox has nothing behind it worth marking.
    let to: readonly number[] = event.end;
    if (event.result === ShotResult.world) {
      const dx = event.end[0] - event.start[0];
      const dy = event.end[1] - event.start[1];
      const dz = event.end[2] - event.start[2];
      const reach = IMPACT_OVERSHOOT / (Math.hypot(dx, dy, dz) || 1);
      walkTo[0] = event.end[0] + dx * reach;
      walkTo[1] = event.end[1] + dy * reach;
      walkTo[2] = event.end[2] + dz * reach;
      to = walkTo;
    }

    let first = true;
    eachSurface(event.start, to, MAX_IMPACT_SURFACES, (hit) => {
      renderer.spawnImpact(hit.point, hit.normal);
      if (first) audio.impact(hit.material, hit.point);
      first = false;
    });

    if (local && event.result === ShotResult.hit) {
      audio.hit();
    } else if (event.victim === curr.localIndex) {
      audio.hurt();
    }
  }

  requestAnimationFrame(frame);
}

void boot();
