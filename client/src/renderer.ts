import * as THREE from "three";
import { Character, type Fall, type Look } from "./art/character";
import { reflectionRoom } from "./art/weapons";
import { desertSky, DuskTraffic, duskSky, orbitalSky } from "./art/sky";
import { canvasTexture } from "./art/textures";
import { buildMapGeometry, sampleLight, type ShadowProbe } from "./map/build";
import type { MapDef, SunLight } from "./map/mapdef";
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

/** Per-material bullet holes + crimson wall blood splatter (classic 1.6 FX). */
function decalTexture(kind: number): THREE.CanvasTexture {
  const texture = canvasTexture(48, 1234 + kind * 97, (c) => {
    const x = c.ctx;
    x.clearRect(0, 0, 48, 48);
    if (kind === Puff.blood) {
      // Dark crimson spray splatter for walls behind hit enemies.
      const g = x.createRadialGradient(24, 24, 2, 24, 24, 20);
      g.addColorStop(0, "rgba(96, 8, 6, 0.92)");
      g.addColorStop(0.5, "rgba(74, 6, 5, 0.68)");
      g.addColorStop(1, "rgba(50, 4, 4, 0)");
      x.fillStyle = g;
      x.fillRect(0, 0, 48, 48);
      for (let i = 0; i < 24; ++i) {
        const a = c.random() * Math.PI * 2;
        const r = 4 + c.random() * 18;
        const sz = 1.5 + c.random() * 3.5;
        x.fillStyle = `rgba(${70 + Math.floor(c.random() * 45)}, 6, 5, ${0.45 + c.random() * 0.45})`;
        x.beginPath();
        x.arc(24 + Math.cos(a) * r, 24 + Math.sin(a) * r, sz, 0, Math.PI * 2);
        x.fill();
      }
      return;
    }

    // Core hole + material-specific spall/splinter/scorch ring.
    const outer = kind === Puff.wood ? "rgba(86, 62, 34, 0.72)"
      : kind === Puff.metal ? "rgba(185, 192, 198, 0.65)"
      : "rgba(96, 92, 84, 0.65)";
    const gradient = x.createRadialGradient(24, 24, 1.5, 24, 24, 20);
    gradient.addColorStop(0, "rgba(8, 7, 6, 0.98)");
    gradient.addColorStop(0.32, "rgba(18, 16, 14, 0.90)");
    gradient.addColorStop(0.55, outer);
    gradient.addColorStop(1, "rgba(30, 26, 20, 0)");
    x.fillStyle = gradient;
    x.fillRect(0, 0, 48, 48);
    for (let i = 0; i < 16; ++i) {
      const angle = c.random() * Math.PI * 2;
      const radius = 6 + c.random() * 13;
      x.fillStyle = kind === Puff.wood
        ? `rgba(110, 78, 42, ${0.35 + c.random() * 0.45})`
        : `rgba(14, 13, 12, ${0.28 + c.random() * 0.45})`;
      const w = kind === Puff.wood ? 5 : 2.2;
      x.save();
      x.translate(24 + Math.cos(angle) * radius, 24 + Math.sin(angle) * radius);
      x.rotate(angle);
      x.fillRect(-w / 2, -1, w, 2);
      x.restore();
    }
  });
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function lerpAngle(a: number, b: number, t: number): number {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
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
  private readonly shadowGeometry = new THREE.PlaneGeometry(34, 34).rotateX(-Math.PI / 2);
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly sceneKey: THREE.DirectionalLight;
  private readonly sceneHemi: THREE.HemisphereLight;
  private readonly weaponFill: THREE.HemisphereLight;
  private readonly weaponKey: THREE.DirectionalLight;
  private readonly weaponTint = new THREE.Vector3(1, 1, 1);
  private probe: ShadowProbe | undefined;
  private tracers: Tracer[] = [];
  private decals: Decal[] = [];
  private readonly decalGeometry = new THREE.PlaneGeometry(6.5, 6.5);
  private readonly bloodDecalGeometry = new THREE.PlaneGeometry(24, 24);
  private readonly decalMaterials: Record<number, THREE.MeshBasicMaterial>;
  private readonly tracerGeometry = new THREE.CylinderGeometry(0.18, 0.18, 1, 4, 1, true);
  private readonly tracerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe9b5, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  private mapLights: MapDef["lights"] = [];
  private mapSun: SunLight | undefined;
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
    // ACES Filmic rolls off HDR lightmap overbrights & PBR highlights cleanly.
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.06;
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

    // Weapons and GLB props reflect a generated strip-lit room, prefiltered once.
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const envScene = reflectionRoom();
    const room = pmrem.fromScene(envScene, 0.03).texture;
    pmrem.dispose();
    envScene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.weaponScene.environment = room;
    this.scene.environment = room;
    this.scene.environmentIntensity = 0.4;

    // Dynamic lighting for characters, held weapons, and GLB props; world
    // architecture uses the baked lightmap atlas.
    this.sceneHemi = new THREE.HemisphereLight(0xa9b6c4, 0x4a443c, 1.15);
    this.scene.add(this.sceneHemi);
    this.sceneKey = new THREE.DirectionalLight(0xfff0d8, 1.35);
    this.sceneKey.position.set(0.3, 1, 0.45);
    this.scene.add(this.sceneKey);

    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const makeDecalMat = (kind: number) => new THREE.MeshBasicMaterial({
      map: decalTexture(kind),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.decalMaterials = {
      [Puff.concrete]: makeDecalMat(Puff.concrete),
      [Puff.wood]: makeDecalMat(Puff.wood),
      [Puff.metal]: makeDecalMat(Puff.metal),
      [Puff.sand]: makeDecalMat(Puff.concrete),
      [Puff.blood]: makeDecalMat(Puff.blood),
    };

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
    this.mapSun = map.sun;
    this.mapAmbient = map.ambient;
    this.probe = probe;

    this.scene.background = map.sky === "orbital" ? orbitalSky()
      : map.sky === "dusk" ? duskSky()
      : map.sky === "desert" ? desertSky()
      : new THREE.Color(map.background);
    this.scene.fog = new THREE.Fog(map.background, map.fog[0], map.fog[1]);
    if (this.skyTraffic) {
      this.scene.remove(this.skyTraffic.root);
      this.skyTraffic.dispose();
    }
    this.skyTraffic = map.sky === "dusk" ? new DuskTraffic() : null;
    if (this.skyTraffic) this.scene.add(this.skyTraffic.root);

    // Align scene dynamic key/hemi lights with the map's sun so characters and
    // GLB props match the direction and colour temperature of the baked world.
    if (map.sun) {
      this.sceneKey.position.set(...map.sun.dir);
      this.sceneKey.color.setRGB(...map.sun.color);
      this.sceneKey.intensity = 1.45;
      this.sceneHemi.color.setRGB(...map.sun.skyColor);
    }

    const built = buildMapGeometry(
      map.brushes, map.lights, map.ambient, probe, map.sun, map.props, map.decals,
    );
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
        yaw: lerpAngle(from.yaw, view.yaw, blend),
        pitch: from.pitch + (view.pitch - from.pitch) * blend,
        alive: (view.flags & Flags.alive) !== 0,
        weapon: view.weapon,
        ducked: (view.flags & Flags.ducked) !== 0,
      });

      // Hit flash overrides the bake for a few ticks — on the living only, or
      // a body killed mid-flash would lie there red.
      if (view.flash > 0 && (view.flags & Flags.alive) !== 0) {
        character.setTint(1.5, 0.5, 0.4);
      } else {
        const tint = sampleLight([x, y, z], this.mapLights, this.mapAmbient, this.probe, this.mapSun);
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
    if (length < 24) return;

    // Subtle, fast CS 1.6-style bullet streak (shared material, zero per-shot alloc).
    const mesh = new THREE.Mesh(this.tracerGeometry, this.tracerMaterial);
    mesh.scale.set(1, length, 1);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize(),
    );
    this.scene.add(mesh);
    this.tracers.push({ mesh, ttl: 0.032 });

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
    if (material === Puff.metal || (material === Puff.concrete && Math.random() < 0.35)) {
      this.spawnPuff(off, material, true);
    }

    const mat = this.decalMaterials[material] ?? this.decalMaterials[Puff.concrete]!;
    const geom = material === Puff.blood ? this.bloodDecalGeometry : this.decalGeometry;
    const mesh = new THREE.Mesh(geom, mat);
    // Float just off the surface so it doesn't z-fight the wall.
    mesh.position.set(point[0]!, point[1]!, point[2]!).addScaledVector(n, 0.35);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    this.scene.add(mesh);
    this.decals.push({ mesh, ttl: 26 });

    while (this.decals.length > MAX_DECALS) this.retireDecal(this.decals.shift()!);
  }

  private retireTracer(tracer: Tracer): void {
    this.scene.remove(tracer.mesh);
  }

  private retireDecal(decal: Decal): void {
    this.scene.remove(decal.mesh);
  }

  updateEffects(dt: number): void {
    this.tracers = this.tracers.filter((tracer) => {
      tracer.ttl -= dt;
      if (tracer.ttl > 0) return true;
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
    const [r, g, b] = sampleLight([eye.x, eye.y, eye.z], this.mapLights, this.mapAmbient, this.probe, this.mapSun);
    const tint = this.weaponTint;
    tint.lerp(scratchTint.set(r, g, b), Math.min(1, dt * 6));
    const level = (tint.x + tint.y + tint.z) / 3;
    const lift = CHARACTER_LIFT(level) / (level || 1);
    const exposure = Math.min(1.25, CHARACTER_LIFT(level));
    this.weaponFill.intensity = 1.5 * exposure;
    // Reflections dim with the room, or blued steel would gleam in the dark.
    this.weaponScene.environmentIntensity = 0.6 * exposure;
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
