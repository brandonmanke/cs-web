import * as THREE from "three";
import { Character } from "./art/character";
import { canvasTexture } from "./art/textures";
import { buildMapGeometry, sampleLight, type ShadowProbe } from "./map/build";
import type { MapDef } from "./map/mapdef";
import { Flags, Team, TICK_SECONDS, type Snapshot } from "./sim";

// Rendering only. The world is drawn with baked vertex lighting (MeshBasic), so
// the map costs nothing at runtime and looks like the era it is aiming at;
// dynamic things use Lambert plus a tint sampled from the same bake, which is
// what keeps a player standing in shadow from glowing.

const MAX_TRACERS = 48;
const MAX_DECALS = 96;
/** Standing hull half-height (cs::kHullHalfHeightStand): origin -> feet. */
const HULL_HALF_STAND = 36;
const HULL_HALF_DUCK = 18;
/** A per-tick jump further than this is a respawn, not movement — don't lerp. */
const TELEPORT_DISTANCE = 200;
/** Most the camera may lag the feet while climbing (cs::kStepHeight). */
const MAX_STEP_LAG = 18;
/** How fast that lag is paid back, u/s. A full step clears in ~0.1 s. */
const STEP_CATCHUP = 180;
/** Remaps baked irradiance onto the range a player model stays readable in. */
const CHARACTER_LIFT = (v: number): number => 0.45 + v * 0.75;

interface Tracer {
  mesh: THREE.Mesh;
  ttl: number;
}

interface Decal {
  mesh: THREE.Mesh;
  ttl: number;
}

function decalTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(32, 1234, (c) => {
    c.ctx.clearRect(0, 0, 32, 32);
    // Dark core with a ragged rim; alpha falls off to nothing at the edges.
    const gradient = c.ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, "rgba(10,9,8,0.95)");
    gradient.addColorStop(0.55, "rgba(24,20,16,0.75)");
    gradient.addColorStop(1, "rgba(30,26,20,0)");
    c.ctx.fillStyle = gradient;
    c.ctx.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 14; ++i) {
      const angle = c.random() * Math.PI * 2;
      const radius = 5 + c.random() * 8;
      c.ctx.fillStyle = `rgba(8,7,6,${0.25 + c.random() * 0.4})`;
      c.ctx.fillRect(16 + Math.cos(angle) * radius, 16 + Math.sin(angle) * radius, 2, 2);
    }
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly gl: THREE.WebGLRenderer;

  private readonly characters: Character[] = [];
  private tracers: Tracer[] = [];
  private decals: Decal[] = [];
  private readonly decalMaterial: THREE.MeshBasicMaterial;
  private readonly tracerGeometry = new THREE.CylinderGeometry(0.7, 0.7, 1, 4, 1, true);

  private mapLights: MapDef["lights"] = [];
  private mapAmbient: [number, number, number] = [0.2, 0.2, 0.2];
  private fov = 90;
  /** Step smoothing: how far the camera is currently behind the eye, and where
   *  the eye was last frame. */
  private eyeLag = 0;
  private lastEyeY = 0;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      this.fov, window.innerWidth / window.innerHeight, 1, 16384,
    );
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera); // the viewmodel rides on the camera

    // These only touch Lambert materials — players and weapons — because the
    // world is fully baked into vertex colours.
    this.scene.add(new THREE.HemisphereLight(0x8899aa, 0x2a2620, 0.55));
    const key = new THREE.DirectionalLight(0xfff0d8, 0.75);
    key.position.set(0.3, 1, 0.45);
    this.scene.add(key);

    this.decalMaterial = new THREE.MeshBasicMaterial({
      map: decalTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });

    window.addEventListener("resize", () => this.resize());
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(window.innerWidth, window.innerHeight);
  }

  setFov(fov: number): void {
    if (fov === this.fov) return; // called per frame; the matrix rebuild is not free
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Build world geometry and bake its lighting. Returns the shadow ray count. */
  buildMap(map: MapDef, probe: ShadowProbe): number {
    this.mapLights = map.lights;
    this.mapAmbient = map.ambient;

    this.scene.background = new THREE.Color(map.background);
    this.scene.fog = new THREE.Fog(map.background, map.fog[0], map.fog[1]);

    const built = buildMapGeometry(map.brushes, map.lights, map.ambient, probe);
    for (const mesh of built.meshes) this.scene.add(mesh);
    return built.shadowRays;
  }

  /**
   * One body per roster slot, skinned by team. Slot `localIndex` is built too
   * but never shown: keeping the array index-aligned with the snapshot is worth
   * more than the geometry it costs.
   */
  buildPlayers(teams: readonly number[]): void {
    for (const character of this.characters) {
      this.scene.remove(character.root);
      character.dispose();
    }
    this.characters.length = 0;
    for (const team of teams) {
      // Free-for-all has no teams; alternate the two skins so bodies are still
      // distinguishable from each other at distance.
      const character = new Character(team === Team.ct ? "ct" : "t");
      this.scene.add(character.root);
      this.characters.push(character);
    }
  }

  updatePlayers(prev: Snapshot, curr: Snapshot, alpha: number, dt: number,
                localIndex: number): void {
    for (let i = 0; i < this.characters.length; ++i) {
      const character = this.characters[i]!;
      if (i === localIndex || i >= curr.playerCount) {
        character.visible = false;
        continue;
      }
      const from = prev.players[i]!;
      const view = curr.players[i]!;
      character.visible = true;

      // Interpolate between the last two ticks, exactly like the camera —
      // except across a respawn, where the two ticks are on opposite sides of
      // the map and a lerp would draw a body streaking through the level.
      const jumped = Math.hypot(view.x - from.x, view.y - from.y, view.z - from.z) >
        TELEPORT_DISTANCE;
      const blend = jumped ? 1 : alpha;
      const x = from.x + (view.x - from.x) * blend;
      const y = from.y + (view.y - from.y) * blend;
      const z = from.z + (view.z - from.z) * blend;
      // The snapshot carries hull centres; the model is authored from the feet.
      const half = (view.flags & Flags.ducked) !== 0 ? HULL_HALF_DUCK : HULL_HALF_STAND;
      character.root.position.set(x, y - half, z);

      // Gait speed comes from the per-tick delta, not the per-frame one: at any
      // refresh rate above 64 Hz most frames advance no tick, so a frame delta
      // alternates between zero and a full step and the walk cycle strobes.
      const speed = jumped ? 0 : Math.hypot(view.x - from.x, view.z - from.z) / TICK_SECONDS;

      character.update(dt, {
        speed,
        onGround: (view.flags & Flags.onGround) !== 0,
        yaw: view.yaw,
        pitch: view.pitch,
        alive: (view.flags & Flags.alive) !== 0,
      });

      // Hit flash overrides the bake for a few ticks.
      if (view.flash > 0) {
        character.setTint(1.5, 0.5, 0.4);
      } else {
        // Tint, not dim. Raw irradiance in a shadowed corner is ~0.2, and a CT
        // skin is already dark navy — multiplied straight through, a body in
        // shadow becomes an unreadable silhouette. Lifting the floor keeps the
        // bake's relative light/dark while leaving the model legible, which for
        // a shooter matters more than the physics of it.
        const tint = sampleLight([x, y, z], this.mapLights, this.mapAmbient);
        character.setTint(...(tint.map(CHARACTER_LIFT) as [number, number, number]));
      }
    }
  }

  spawnTracer(start: readonly number[], end: readonly number[]): void {
    const from = new THREE.Vector3(start[0]!, start[1]!, start[2]!);
    const to = new THREE.Vector3(end[0]!, end[1]!, end[2]!);
    const length = from.distanceTo(to);
    if (length < 1) return;

    const mesh = new THREE.Mesh(
      this.tracerGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xffe6a8, transparent: true, opacity: 0.55, depthWrite: false,
      }),
    );
    mesh.scale.set(1, length, 1);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize(),
    );
    this.scene.add(mesh);
    this.tracers.push({ mesh, ttl: 0.055 });

    while (this.tracers.length > MAX_TRACERS) this.retireTracer(this.tracers.shift()!);
  }

  spawnImpact(point: readonly number[], normal: readonly number[]): void {
    const n = new THREE.Vector3(normal[0]!, normal[1]!, normal[2]!);
    if (n.lengthSq() < 1e-6) return;
    n.normalize();

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), this.decalMaterial);
    // Float just off the surface so it doesn't z-fight the wall.
    mesh.position.set(point[0]!, point[1]!, point[2]!).addScaledVector(n, 0.35);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    this.scene.add(mesh);
    this.decals.push({ mesh, ttl: 22 });

    while (this.decals.length > MAX_DECALS) this.retireDecal(this.decals.shift()!);
  }

  private retireTracer(tracer: Tracer): void {
    this.scene.remove(tracer.mesh);
    (tracer.mesh.material as THREE.Material).dispose();
  }

  private retireDecal(decal: Decal): void {
    this.scene.remove(decal.mesh);
    decal.mesh.geometry.dispose();
  }

  updateEffects(dt: number): void {
    this.tracers = this.tracers.filter((tracer) => {
      tracer.ttl -= dt;
      if (tracer.ttl > 0) {
        (tracer.mesh.material as THREE.MeshBasicMaterial).opacity = tracer.ttl * 10;
        return true;
      }
      this.retireTracer(tracer);
      return false;
    });

    this.decals = this.decals.filter((decal) => {
      decal.ttl -= dt;
      if (decal.ttl > 0) return true;
      this.retireDecal(decal);
      return false;
    });
  }

  /**
   * Absorb a step-up so a staircase doesn't strobe the camera.
   *
   * Stepping onto a stair teleports the hull to the top of it — that is what
   * step height *is* — so climbing a 16u flight snaps the eye upward several
   * times a second. This keeps a bounded amount of that snap as lag and pays it
   * back at a fixed rate, which is what turns a flight of stairs into a slope
   * from behind the eyes. Only the view moves: the sim's eye, and therefore
   * where shots leave from and what the bots can see, is untouched.
   *
   * Rises bigger than a step are jumps, falls and respawns, and go through
   * unsmoothed. Walking a ramp gains less per frame than the catch-up rate
   * pays off, so slopes are left alone too.
   */
  private smoothStep(eyeY: number, grounded: boolean, dt: number): number {
    const rise = eyeY - this.lastEyeY;
    this.lastEyeY = eyeY;
    if (grounded && rise > 0 && rise <= MAX_STEP_LAG) {
      this.eyeLag = Math.min(this.eyeLag + rise, MAX_STEP_LAG);
    }
    this.eyeLag = Math.max(0, this.eyeLag - STEP_CATCHUP * dt);
    return eyeY - this.eyeLag;
  }

  /** `eyeHeight` overrides the interpolated stance height — the death cam. */
  render(prev: Snapshot, curr: Snapshot, alpha: number, dt: number, yaw: number,
         pitch: number, eyeHeight?: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const eyeY = lerp(prev.origin[1]!, curr.origin[1]!) +
      (eyeHeight ?? lerp(prev.eyeHeight, curr.eyeHeight));
    // The death cam flies the camera on its own terms; smoothing would fight it.
    const cameraY = eyeHeight === undefined
      ? this.smoothStep(eyeY, (curr.flags & Flags.onGround) !== 0, dt)
      : eyeY;

    this.camera.position.set(
      lerp(prev.origin[0]!, curr.origin[0]!), cameraY,
      lerp(prev.origin[2]!, curr.origin[2]!),
    );
    this.camera.rotation.set(pitch + curr.punchPitch, yaw + curr.punchYaw, 0);
    this.gl.render(this.scene, this.camera);
  }
}
