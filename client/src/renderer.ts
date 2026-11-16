import * as THREE from "three";
import { Character, type Fall, type Look } from "./art/character";
import { DuskTraffic, duskSky, orbitalSky } from "./art/sky";
import { canvasTexture } from "./art/textures";
import { buildMapGeometry, sampleLight, type ShadowProbe } from "./map/build";
import type { MapDef } from "./map/mapdef";
import { Flags, Team, TICK_SECONDS, type Snapshot } from "./sim";

// Rendering only. The world is drawn unlit against a baked lightmap, so the
// map costs nothing at runtime and looks like the era it is aiming at; dynamic
// things — bodies, the weapon in your hands — are lit by lights tinted from
// the same map lights, shadow-tested, which is what keeps a player standing in
// shadow from glowing.

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

const scratchTint = new THREE.Vector3();
const MAX_PUFFS = 32;

/** What a round kicks up: keyed by cs::Material, plus blood. */
export const Puff = { concrete: 0, wood: 1, metal: 2, sand: 3, blood: 4 } as const;
const PUFFS: Record<number, { color: number; size: number; grow: number; life: number; rise: number }> = {
  [Puff.concrete]: { color: 0xa9a59a, size: 5, grow: 34, life: 0.45, rise: 6 },
  [Puff.wood]: { color: 0xb0905e, size: 4, grow: 24, life: 0.35, rise: 4 },
  [Puff.metal]: { color: 0x8f9499, size: 3, grow: 16, life: 0.25, rise: 3 },
  [Puff.sand]: { color: 0xc2ab78, size: 6, grow: 40, life: 0.55, rise: 8 },
  [Puff.blood]: { color: 0x8c1410, size: 5, grow: 30, life: 0.3, rise: -14 },
};

interface PuffSprite {
  sprite: THREE.Sprite;
  ttl: number;
  life: number;
  grow: number;
  rise: number;
  opacity: number;
}

/** One soft disc: tinted it is dust or blood, additive it is a spark. */
function puffTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(32, 2, (c) => {
    c.ctx.clearRect(0, 0, 32, 32);
    const gradient = c.ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    c.ctx.fillStyle = gradient;
    c.ctx.fillRect(0, 0, 32, 32);
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

interface Tracer {
  mesh: THREE.Mesh;
  ttl: number;
}

interface Decal {
  mesh: THREE.Mesh;
  ttl: number;
}

/** Soft dark disc dropped under each body: the cheapest thing that grounds it. */
function shadowTexture(): THREE.CanvasTexture {
  const texture = canvasTexture(64, 1, (c) => {
    c.ctx.clearRect(0, 0, 64, 64);
    const gradient = c.ctx.createRadialGradient(32, 32, 4, 32, 32, 31);
    gradient.addColorStop(0, "rgba(0,0,0,0.6)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    c.ctx.fillStyle = gradient;
    c.ctx.fillRect(0, 0, 64, 64);
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
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
  readonly weaponCamera: THREE.PerspectiveCamera;
  private readonly weaponScene = new THREE.Scene();
  private readonly gl: THREE.WebGLRenderer;
  private skyTraffic: DuskTraffic | null = null;

  private readonly characters: Character[] = [];
  private readonly shadows: THREE.Mesh[] = [];
  private readonly puffs: PuffSprite[] = [];
  private readonly puffMap = puffTexture();
  private nextPuff = 0;
  private readonly shadowGeometry = new THREE.PlaneGeometry(44, 44).rotateX(-Math.PI / 2);
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly weaponFill: THREE.HemisphereLight;
  private readonly weaponKey: THREE.DirectionalLight;
  private readonly weaponTint = new THREE.Vector3(1, 1, 1);
  private probe: ShadowProbe | undefined;
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
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      this.fov, window.innerWidth / window.innerHeight, 1, 16384,
    );
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);

    // A separate pass keeps nearby walls from cutting off the hands, and gives
    // the weapon consistent readable light as the player turns through the map.
    this.weaponCamera = new THREE.PerspectiveCamera(70, this.camera.aspect, 0.1, 256);
    this.weaponCamera.rotation.order = "YXZ";
    this.weaponScene.add(this.weaponCamera);
    this.weaponFill = new THREE.HemisphereLight(0xcbd9ec, 0x555049, 1.5);
    this.weaponScene.add(this.weaponFill);
    this.weaponKey = new THREE.DirectionalLight(0xffe4c4, 2.1);
    this.weaponKey.position.set(-15, 25, 10);
    this.weaponKey.target.position.set(0, 0, -25);
    this.weaponCamera.add(this.weaponKey, this.weaponKey.target);

    // These light player bodies and their held weapons; the world is fully
    // baked into vertex colours.
    this.scene.add(new THREE.HemisphereLight(0xa9b6c4, 0x4a443c, 1.1));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.25);
    key.position.set(0.3, 1, 0.45);
    this.scene.add(key);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
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
    this.weaponCamera.aspect = this.camera.aspect;
    this.weaponCamera.updateProjectionMatrix();
    this.gl.setSize(window.innerWidth, window.innerHeight);
  }

  setFov(fov: number): void {
    if (fov === this.fov) return; // called per frame; the matrix rebuild is not free
    this.fov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Drop leftover stair lag; call on respawn so the eye does not tween there. */
  resetViewSmoothing(): void {
    this.eyeLag = 0;
    this.lastEyeY = 0;
  }

  /** Build world geometry and bake its lighting. Returns the shadow ray count. */
  buildMap(map: MapDef, probe: ShadowProbe): number {
    this.mapLights = map.lights;
    this.mapAmbient = map.ambient;
    this.probe = probe;

    this.scene.background = map.sky === "orbital" ? orbitalSky() :
      map.sky === "dusk" ? duskSky() : new THREE.Color(map.background);
    this.scene.fog = new THREE.Fog(map.background, map.fog[0], map.fog[1]);
    if (this.skyTraffic) {
      this.scene.remove(this.skyTraffic.root);
      this.skyTraffic.dispose();
    }
    this.skyTraffic = map.sky === "dusk" ? new DuskTraffic() : null;
    if (this.skyTraffic) this.scene.add(this.skyTraffic.root);

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
    for (const shadow of this.shadows) this.scene.remove(shadow);
    this.characters.length = 0;
    this.shadows.length = 0;
    for (const [index, team] of teams.entries()) {
      // Free-for-all has no teams; alternate the two skins so bodies are still
      // distinguishable from each other at distance.
      const skin = team === Team.ct || (team === Team.none && index % 2 === 0)
        ? "ct" : "t";
      // Alternate each side's two looks in pairs, so both show up on either team.
      const character = new Character(skin, ((index >> 1) & 1) as Look);
      this.scene.add(character.root);
      this.characters.push(character);
      const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
      this.scene.add(shadow);
      this.shadows.push(shadow);
    }
  }

  updatePlayers(prev: Snapshot, curr: Snapshot, alpha: number, dt: number,
                localIndex: number): void {
    for (let i = 0; i < this.characters.length; ++i) {
      const character = this.characters[i]!;
      const shadow = this.shadows[i]!;
      if (i === localIndex || i >= curr.playerCount) {
        character.visible = shadow.visible = false;
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
      // Only a body standing on something has a floor to cast onto.
      shadow.visible = (view.flags & Flags.onGround) !== 0;
      shadow.position.set(x, y - half + 0.4, z);

      // Gait speed comes from the per-tick delta, not the per-frame one: at any
      // refresh rate above 64 Hz most frames advance no tick, so a frame delta
      // alternates between zero and a full step and the walk cycle strobes.
      const speed = jumped ? 0 : Math.hypot(view.x - from.x, view.z - from.z) / TICK_SECONDS;

      character.update(dt, {
        speed,
        moveYaw: Math.atan2(from.x - view.x, from.z - view.z),
        flinch: view.flash > 0,
        onGround: (view.flags & Flags.onGround) !== 0,
        yaw: view.yaw,
        pitch: view.pitch,
        alive: (view.flags & Flags.alive) !== 0,
        weapon: view.weapon,
        ducked: (view.flags & Flags.ducked) !== 0,
      });

      // Hit flash overrides the bake for a few ticks — on the living only, or
      // a body killed mid-flash would lie there red.
      if (view.flash > 0 && (view.flags & Flags.alive) !== 0) {
        character.setTint(1.5, 0.5, 0.4);
      } else {
        // Tint, not dim. Raw irradiance in a shadowed corner is ~0.2, and a CT
        // skin is already dark navy — multiplied straight through, a body in
        // shadow becomes an unreadable silhouette. Lifting the floor keeps the
        // bake's relative light/dark while leaving the model legible, which for
        // a shooter matters more than the physics of it.
        const tint = sampleLight([x, y, z], this.mapLights, this.mapAmbient, this.probe);
        character.setTint(...(tint.map(CHARACTER_LIFT) as [number, number, number]));
      }
    }
  }

  /** A roster slot fired: recoil and muzzle flash on its body. */
  onShot(actor: number): void {
    this.characters[actor]?.fire();
  }

  /** Pick the fall before the body goes limp: backward off a shot from the front. */
  onDeath(snapshot: Snapshot, victim: number, actor: number, headshot: boolean): void {
    const body = snapshot.players[victim], killer = snapshot.players[actor];
    if (!body || !killer) return;
    const bearing = Math.atan2(body.x - killer.x, body.z - killer.z) - body.yaw;
    const facing = Math.cos(bearing); // 1: killer dead ahead, -1: directly behind
    const fall: Fall = headshot || facing > 0.5 ? "back" : facing < -0.5 ? "front" : "side";
    this.characters[victim]?.die(fall);
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

  /**
   * Dust off a wall, a spark off steel, blood off a body. Sprites come from a
   * ring of MAX_PUFFS, so a spray reuses the oldest instead of allocating.
   */
  spawnPuff(point: readonly number[], kind: number, spark = false): void {
    let puff = this.puffs[this.nextPuff % MAX_PUFFS];
    if (!puff) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.puffMap, transparent: true, depthWrite: false,
      }));
      this.scene.add(sprite);
      puff = { sprite, ttl: 0, life: 1, grow: 0, rise: 0, opacity: 1 };
      this.puffs.push(puff);
    }
    ++this.nextPuff;
    const spec = PUFFS[kind] ?? PUFFS[Puff.concrete]!;
    const material = puff.sprite.material;
    material.color.setHex(spark ? 0xffd28a : spec.color);
    material.blending = spark ? THREE.AdditiveBlending : THREE.NormalBlending;
    material.rotation = Math.random() * Math.PI;
    puff.sprite.position.set(point[0]!, point[1]!, point[2]!);
    puff.sprite.scale.setScalar(spark ? 7 : spec.size);
    puff.sprite.visible = true;
    puff.life = puff.ttl = spark ? 0.07 : spec.life;
    puff.grow = spark ? 30 : spec.grow;
    puff.rise = spark ? 0 : spec.rise;
    puff.opacity = spark ? 1 : kind === Puff.blood ? 0.85 : 0.5;
  }

  spawnImpact(point: readonly number[], normal: readonly number[], material: number): void {
    const n = new THREE.Vector3(normal[0]!, normal[1]!, normal[2]!);
    if (n.lengthSq() < 1e-6) return;
    n.normalize();
    // Stand the effect off the wall so the sprite is not cut by it.
    const off = [point[0]! + n.x * 3, point[1]! + n.y * 3, point[2]! + n.z * 3];
    this.spawnPuff(off, material);
    if (material === Puff.metal || (material === Puff.concrete && Math.random() < 0.3)) {
      this.spawnPuff(off, material, true);
    }

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

    for (const puff of this.puffs) {
      if (puff.ttl <= 0) continue;
      puff.ttl -= dt;
      const sprite = puff.sprite;
      sprite.visible = puff.ttl > 0;
      sprite.scale.addScalar(puff.grow * dt);
      sprite.position.y += puff.rise * dt;
      sprite.material.opacity = puff.opacity * Math.max(0, puff.ttl / puff.life);
    }

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

  /**
   * GoldSrc lit the weapon in your hands from the floor you stood on. Same
   * idea: the viewmodel's lights follow the map light reaching the eye, eased
   * so stepping past a pillar dims the gun instead of blinking it.
   */
  private lightWeapon(dt: number): void {
    const eye = this.camera.position;
    const [r, g, b] = sampleLight([eye.x, eye.y, eye.z], this.mapLights, this.mapAmbient, this.probe);
    const tint = this.weaponTint;
    tint.lerp(scratchTint.set(r, g, b), Math.min(1, dt * 6));
    const level = (tint.x + tint.y + tint.z) / 3;
    const lift = CHARACTER_LIFT(level) / (level || 1);
    this.weaponFill.intensity = 1.5 * Math.min(1.25, CHARACTER_LIFT(level));
    this.weaponKey.color.setRGB(tint.x * lift, tint.y * lift, tint.z * lift);
  }

  /** `eyeHeight` overrides the interpolated stance height — the death cam. */
  render(prev: Snapshot, curr: Snapshot, alpha: number, dt: number, yaw: number,
         pitch: number, bob: number, eyeHeight?: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const eyeY = lerp(prev.origin[1]!, curr.origin[1]!) +
      (eyeHeight ?? lerp(prev.eyeHeight, curr.eyeHeight));
    // The death cam flies the camera on its own terms; smoothing would fight it.
    // The living eye also rides the view bob the weapon does.
    const cameraY = eyeHeight === undefined
      ? this.smoothStep(eyeY, (curr.flags & Flags.onGround) !== 0, dt) + bob
      : eyeY;

    this.camera.position.set(
      lerp(prev.origin[0]!, curr.origin[0]!), cameraY,
      lerp(prev.origin[2]!, curr.origin[2]!),
    );
    this.camera.rotation.set(pitch + curr.punchPitch, yaw + curr.punchYaw, 0);
    this.skyTraffic?.update(dt, this.camera.position);
    this.lightWeapon(dt);
    this.gl.render(this.scene, this.camera);
    this.weaponCamera.position.copy(this.camera.position);
    this.weaponCamera.quaternion.copy(this.camera.quaternion);
    this.gl.autoClear = false;
    this.gl.clearDepth();
    this.gl.render(this.weaponScene, this.weaponCamera);
    this.gl.autoClear = true;
  }
}
