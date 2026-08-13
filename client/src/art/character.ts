import * as THREE from "three";
import { canvasTexture, fill, grain, stains } from "./textures";

// Procedural low-poly humanoid, built as a hierarchy of rigid boxes rather than
// a skinned mesh — which is how PSX and GoldSrc models actually worked, and
// what makes the walk cycle a handful of sine waves instead of an animation
// pipeline.
//
// Proportions follow the sim hitboxes in sim/src/weapons.cpp (head 58-72,
// chest 38-58, stomach 26-38, legs 0-26) so the silhouette you shoot at is the
// silhouette the sim tests. Arms are visual only: the sim's "limbs" box covers
// the legs, so they are kept tucked near the torso.

export type Team = "ct" | "t";

// Bright enough to read against a map lit by pools of light and deep shadow.
// The first pass used real-kit colours (navy CT, dark webbing) and a CT body
// standing off a light pool was a black cutout you could not tell was facing
// you — which is the one thing the character art has to do.
const PALETTE: Record<Team, { cloth: string; vest: string; skin: string; trim: string }> = {
  ct: { cloth: "#5d6d80", vest: "#3c4957", skin: "#c49a76", trim: "#8794a4" },
  t: { cloth: "#9d8352", vest: "#4c4130", skin: "#b98a60", trim: "#7d6941" },
};

function bodyTexture(team: Team): THREE.CanvasTexture {
  const palette = PALETTE[team];
  return canvasTexture(64, team === "ct" ? 21 : 22, (c) => {
    fill(c, palette.cloth);
    grain(c, 30, 2);
    // Webbing and pouches across the chest.
    c.ctx.fillStyle = palette.vest;
    c.ctx.fillRect(0, 18, 64, 26);
    c.ctx.fillStyle = palette.trim;
    c.ctx.fillRect(0, 22, 64, 3);
    c.ctx.fillRect(0, 37, 64, 3);
    c.ctx.fillStyle = palette.vest;
    c.ctx.fillRect(8, 26, 12, 10);
    c.ctx.fillRect(44, 26, 12, 10);
    grain(c, 16, 1);
    stains(c, 6, "#14110c", 14);
  });
}

function headTexture(team: Team): THREE.CanvasTexture {
  const palette = PALETTE[team];
  return canvasTexture(64, team === "ct" ? 31 : 32, (c) => {
    fill(c, palette.skin);
    grain(c, 20, 2);
    // Balaclava over the top and back of the head.
    c.ctx.fillStyle = palette.vest;
    c.ctx.fillRect(0, 0, 64, 26);
    c.ctx.fillRect(0, 44, 64, 20);
    // Eye slit.
    c.ctx.fillStyle = "#15120e";
    c.ctx.fillRect(10, 28, 16, 6);
    c.ctx.fillRect(38, 28, 16, 6);
    grain(c, 12, 1);
  });
}

/**
 * Skins are per team, not per body, and the roster gets rebuilt whenever the
 * bot count changes — so generate each canvas once and share it. Character
 * disposal deliberately leaves these alone.
 */
const skins = new Map<string, THREE.CanvasTexture>();
function skin(team: Team, part: "body" | "head"): THREE.CanvasTexture {
  const key = `${team}:${part}`;
  let texture = skins.get(key);
  if (!texture) {
    texture = part === "body" ? bodyTexture(team) : headTexture(team);
    skins.set(key, texture);
  }
  return texture;
}

/** A box whose pivot sits at its top face, so limbs rotate from the joint. */
function limb(w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, -h / 2, 0);
  return new THREE.Mesh(geometry, material);
}

function block(w: number, h: number, d: number, y: number,
               material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, y, 0);
  return new THREE.Mesh(geometry, material);
}

export interface CharacterPose {
  /** Horizontal speed in u/s — drives the walk cycle. */
  speed: number;
  onGround: boolean;
  yaw: number;
  pitch: number;
  alive: boolean;
}

export class Character {
  /** Placement only — the owner sets this. */
  readonly root = new THREE.Group();
  /** Carries the death transform, so it can't fight the root's position. */
  private readonly pivot = new THREE.Group();

  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly materials: THREE.MeshLambertMaterial[] = [];

  private phase = 0;
  private deathTime = 0;

  constructor(team: Team) {
    const cloth = new THREE.MeshLambertMaterial({ map: skin(team, "body") });
    const flesh = new THREE.MeshLambertMaterial({ map: skin(team, "head") });
    this.materials.push(cloth, flesh);

    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = 28;
    this.hips.add(block(22, 12, 13, 4, cloth)); // pelvis, world y 26-38

    this.hips.add(this.torso);
    this.torso.position.y = 10; // world y 38
    this.torso.add(block(24, 20, 14, 10, cloth)); // chest, world y 38-58

    this.torso.add(this.head);
    this.head.position.y = 20; // world y 58
    this.head.add(block(12, 12, 12, 6, flesh));
    // Brow ridge: gives the silhouette a facing direction at distance.
    this.head.add(block(13, 3, 3, 8, cloth).translateZ(-5.5));

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 14, 18, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -13;
      shoulder.add(limb(7, 13, 7, cloth), elbow);
      elbow.add(limb(6, 13, 6, cloth));
      this.torso.add(shoulder);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);

      const hip = new THREE.Group();
      hip.position.set(side * 6, 0, 0);
      const knee = new THREE.Group();
      knee.position.y = -14;
      hip.add(limb(10, 14, 10, cloth), knee);
      knee.add(limb(9, 14, 9, cloth));
      // Boot.
      knee.add(block(10, 4, 12, -12, cloth).translateZ(1));
      this.hips.add(hip);
      this.legs.push(hip);
      this.knees.push(knee);
    }
  }

  /** Modulate by the baked light where the character stands. */
  setTint(r: number, g: number, b: number): void {
    for (const material of this.materials) material.color.setRGB(r, g, b);
  }

  set visible(value: boolean) {
    this.root.visible = value;
  }

  update(dt: number, pose: CharacterPose): void {
    this.root.rotation.y = pose.yaw;

    if (!pose.alive) {
      // Fall forward and settle — cheap, readable, no ragdoll needed.
      this.deathTime = Math.min(this.deathTime + dt, 1);
      const t = 1 - (1 - this.deathTime) * (1 - this.deathTime);
      this.pivot.rotation.x = t * -Math.PI * 0.5;
      this.pivot.position.y = -t * 12;
      return;
    }
    this.deathTime = 0;
    this.pivot.rotation.x = 0;
    this.pivot.position.y = 0;

    const moving = pose.speed > 12;
    const gait = Math.min(pose.speed / 250, 1.4);
    if (moving && pose.onGround) {
      this.phase += dt * (4 + gait * 7);
    } else if (!moving) {
      this.phase += dt * 1.2; // idle breathing keeps the same clock
    }

    const swing = pose.onGround ? gait * 0.9 : 0.35;
    const sin = Math.sin(this.phase);
    const cos = Math.cos(this.phase);

    if (pose.onGround) {
      for (let i = 0; i < 2; ++i) {
        const side = i === 0 ? 1 : -1;
        this.legs[i]!.rotation.x = sin * side * swing;
        // Knees only bend backwards, and only on the return stroke.
        this.knees[i]!.rotation.x = Math.max(0, -sin * side) * gait * 1.1;
        this.shoulders[i]!.rotation.x = -sin * side * swing * 0.7;
        this.elbows[i]!.rotation.x = -0.35 - Math.max(0, sin * side) * 0.4;
      }
      // Vertical bob and a slight roll, scaled by gait.
      this.hips.position.y = 28 + Math.abs(cos) * gait * 2.2;
      this.torso.rotation.z = sin * gait * 0.06;
      this.torso.rotation.y = -sin * gait * 0.12;
    } else {
      // Airborne: legs tuck, arms come up.
      for (let i = 0; i < 2; ++i) {
        const side = i === 0 ? 1 : -1;
        this.legs[i]!.rotation.x = 0.5 * side * 0.6 - 0.2;
        this.knees[i]!.rotation.x = 0.8;
        this.shoulders[i]!.rotation.x = -0.9;
        this.elbows[i]!.rotation.x = -0.7;
      }
      this.hips.position.y = 28;
    }

    if (!moving) {
      // Idle: shoulders drop, weapon comes down, slow sway.
      const breath = Math.sin(this.phase) * 0.03;
      this.torso.rotation.z = breath;
      this.torso.rotation.y = breath * 0.5;
      for (let i = 0; i < 2; ++i) {
        this.shoulders[i]!.rotation.x = -0.25 + breath;
        this.elbows[i]!.rotation.x = -0.5;
      }
    }

    // Aim: the torso carries most of the pitch, the head the rest.
    const pitch = Math.max(-0.9, Math.min(0.9, pose.pitch));
    this.torso.rotation.x = pitch * 0.35;
    this.head.rotation.x = pitch * 0.5;
  }

  dispose(): void {
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    // Maps are shared across every body on a team and outlive this one.
    for (const material of this.materials) material.dispose();
  }
}
