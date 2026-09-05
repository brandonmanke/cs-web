import * as THREE from "three";
import { canvasTexture, fill, grain, stains } from "./textures";
import { batchParts, bevelBox, disposeParts, meshPart, type V3 } from "./geometry";
import { buildWeapon, supportGrip, WeaponId } from "./weapons";

// Rigid articulated bodies, authored from the feet. Head 58–72, chest 38–58,
// stomach 26–38, legs 0–26 follow the sim hitboxes. Arms are still visual only.
export type Team = "ct" | "t";
const PALETTE = {
  ct: { cloth: "#637c96", vest: "#46545e", trim: "#9caab1", mask: "#3a444b" },
  t: { cloth: "#a58e68", vest: "#635744", trim: "#c1a779", mask: "#775950" },
};
type SkinPart = "cloth" | "vest" | "trim" | "mask" | "face" | "boot";
const skins = new Map<string, THREE.CanvasTexture>();
function skin(team: Team, part: SkinPart): THREE.CanvasTexture {
  const key = `${team}:${part}`;
  let texture = skins.get(key);
  if (texture) return texture;
  texture = canvasTexture(64, team === "ct" ? 21 : 22, (c) => {
    fill(c, part === "face" ? "#c39776" : part === "boot" ? "#393b3b" : PALETTE[team][part]);
    grain(c, 18, 1);
    if (part === "face") {
      // This texture is used only on the forward-facing eye opening.
      c.ctx.fillStyle = "#604d40";
      c.ctx.fillRect(7, 15, 18, 5); c.ctx.fillRect(39, 15, 18, 5);
      c.ctx.fillStyle = "#292624";
      c.ctx.fillRect(10, 23, 14, 7); c.ctx.fillRect(40, 23, 14, 7);
      c.ctx.fillStyle = "#d4b294";
      c.ctx.fillRect(12, 23, 4, 2); c.ctx.fillRect(42, 23, 4, 2);
      c.ctx.fillStyle = "#8e6951";
      c.ctx.fillRect(29, 26, 6, 25);
    } else {
      // Small weave, seams and folds, without chest details repeating on limbs.
      c.ctx.fillStyle = "rgba(0,0,0,0.06)";
      for (let i = 0; i < 64; i += 4) {
        c.ctx.fillRect(i, 0, 1, 64); c.ctx.fillRect(0, i, 64, 1);
      }
      c.ctx.fillStyle = "rgba(0,0,0,0.18)";
      c.ctx.fillRect(3, 0, 2, 64); c.ctx.fillRect(59, 0, 2, 64);
      for (let i = 0; i < 8; ++i) c.ctx.fillRect(7 + c.random() * 40, c.random() * 64, 10 + c.random() * 16, 1);
      stains(c, 5, "#272520", 12);
    }
  });
  skins.set(key, texture);
  return texture;
}

function block(group: THREE.Group, material: THREE.Material, size: V3, at: V3): void {
  meshPart(group, bevelBox(...size, 0.7), material, at);
}

/** Tapered joint, local -Y is the bone direction. */
function limb(group: THREE.Group, material: THREE.Material, width: number, length: number): void {
  const geometry = new THREE.CylinderGeometry(width * 0.52, width * 0.4, length, 8);
  geometry.translate(0, -length / 2, 0);
  meshPart(group, geometry, material, [0, 0, 0]);
}

export interface CharacterPose {
  speed: number;
  onGround: boolean;
  yaw: number;
  pitch: number;
  alive: boolean;
  weapon: number;
  ducked: boolean;
}

export class Character {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legs: THREE.Group[] = [];
  private readonly knees: THREE.Group[] = [];
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly weaponSlot = new THREE.Group();
  private weapon: THREE.Group | null = null;
  private weaponId = -1;
  private readonly materials: THREE.MeshLambertMaterial[] = [];
  private readonly direction = new THREE.Vector3();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private phase = 0;
  private deathTime = 0;

  constructor(team: Team) {
    const mat = (part: SkinPart) => {
      const material = new THREE.MeshLambertMaterial({ map: skin(team, part) });
      this.materials.push(material);
      return material;
    };
    const cloth = mat("cloth"), vest = mat("vest"), trim = mat("trim");
    const mask = mat("mask"), face = mat("face"), boot = mat("boot");
    this.root.add(this.pivot);
    this.pivot.add(this.hips);
    this.hips.position.y = 28;
    block(this.hips, cloth, [19, 10, 12], [0, 4, 0]);
    block(this.hips, boot, [21, 2.2, 13], [0, 9, 0]);
    block(this.hips, trim, [3, 2, 0.8], [0, 9, -6.7]);
    this.hips.add(this.torso);
    this.torso.position.y = 10;
    block(this.torso, cloth, [23, 19, 13], [0, 10, 0]);
    block(this.torso, vest, [20, 15, 15], [0, 9, -0.2]);
    for (const x of [-7, 7]) {
      block(this.torso, vest, [3, 6, 15], [x, 17, 0]); // shoulder webbing
      block(this.torso, trim, [2.7, 1.6, 0.7], [x, 16, -7.8]);
    }
    for (const x of [-6, 0, 6]) {
      block(this.torso, vest, [5, 6.5, 2.8], [x, 5.5, -8.8]);
      block(this.torso, trim, [4.6, 1, 0.4], [x, 7.5, -10.2]);
    }
    block(this.torso, trim, [7, 2.3, 0.4], [0, 14, -7.9]);
    block(this.torso, vest, [13, 12, 3], [0, 10, 8.4]); // back plate
    block(this.torso, boot, [2.4, 4, 2], [-9, 13, -8.1]); // radio
    block(this.torso, boot, [0.4, 5, 0.4], [-9, 17, -8.1]);

    this.torso.add(this.head);
    this.head.position.y = 20;
    meshPart(this.head, bevelBox(10.8, 12, 10.8, 1.8), mask, [0, 6, 0]);
    meshPart(this.head, new THREE.PlaneGeometry(8.6, 3.6), face, [0, 7.3, -5.43], [0, Math.PI, 0]);
    if (team === "ct") {
      const helmet = meshPart(this.head, new THREE.SphereGeometry(7.1, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), vest, [0, 9, 0]);
      helmet.scale.y = 0.65;
      meshPart(this.head, bevelBox(13.4, 1.2, 12.5, 0.25), vest, [0, 9.1, 0]);
      for (const x of [-5.7, 5.7]) block(this.head, boot, [1.5, 4, 3.5], [x, 5.7, 0]);
    } else {
      block(this.head, mask, [11.4, 2, 11.4], [0, 10, 0]);
      block(this.head, trim, [12.3, 3.6, 12], [0, 0.4, 0]); // wrapped scarf
    }

    this.weaponSlot.position.set(2.5, 9, -5);
    this.torso.add(this.weaponSlot);
    for (const side of [-1, 1]) {
      const upper = new THREE.Group(), lower = new THREE.Group();
      limb(upper, cloth, 6.8, 13);
      block(upper, vest, [5.7, 4, 5.7], [0, -3, 0]);
      limb(lower, cloth, 5.8, 13);
      block(lower, boot, [5, 4, 5], [0, -11, 0]);
      this.torso.add(upper, lower);
      this.shoulders.push(upper); this.elbows.push(lower);

      const hip = new THREE.Group(), knee = new THREE.Group();
      hip.position.set(side * 5.7, 0, 0);
      knee.position.y = -14;
      limb(hip, cloth, 10, 14);
      block(hip, vest, [2, 6, 6], [side * 4.1, -5, 0]); // cargo pocket
      limb(knee, cloth, 8.4, 12);
      block(knee, vest, [6.4, 4.5, 2], [0, -1.7, -3.4]);
      block(knee, boot, [8.5, 5.5, 12], [0, -11.3, -1.2]);
      block(knee, boot, [8.7, 1.1, 12.2], [0, -13.4, -1.2]);
      hip.add(knee); this.hips.add(hip);
      this.legs.push(hip); this.knees.push(knee);
    }
    batchParts(this.pivot);
  }

  setTint(r: number, g: number, b: number): void {
    for (const material of this.materials) material.color.setRGB(r, g, b);
  }

  set visible(value: boolean) { this.root.visible = value; }

  private setWeapon(id: number): void {
    if (id === this.weaponId) return;
    if (this.weapon) {
      this.weaponSlot.remove(this.weapon);
      disposeParts(this.weapon);
    }
    this.weapon = buildWeapon(id);
    this.weaponSlot.add(this.weapon);
    this.weaponId = id;
  }

  private aimBone(bone: THREE.Group, from: V3, to: V3): void {
    bone.position.set(...from);
    this.direction.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    bone.scale.y = this.direction.length() / 13;
    bone.quaternion.setFromUnitVectors(this.down, this.direction.normalize());
  }

  update(dt: number, pose: CharacterPose): void {
    this.setWeapon(pose.weapon);
    this.root.rotation.y = pose.yaw;
    // The sim squashes hitboxes while ducked; keep the rendered target aligned.
    this.root.scale.y = pose.ducked ? 0.5 : 1;
    if (!pose.alive) {
      this.deathTime = Math.min(this.deathTime + dt, 1);
      const t = 1 - (1 - this.deathTime) ** 2;
      this.pivot.rotation.x = t * -Math.PI * 0.5;
      this.pivot.position.y = -t * 12;
      return;
    }
    this.deathTime = 0;
    this.pivot.rotation.x = 0; this.pivot.position.y = 0;
    const moving = pose.speed > 12;
    const gait = Math.min(pose.speed / 250, 1.4);
    this.phase += dt * (moving && pose.onGround ? 4 + gait * 7 : 1.2);
    const sin = Math.sin(this.phase), cos = Math.cos(this.phase);
    for (let i = 0; i < 2; ++i) {
      const side = i === 0 ? -1 : 1;
      this.legs[i]!.rotation.x = pose.onGround ? sin * side * gait * 0.9 : 0.3 * side - 0.2;
      this.knees[i]!.rotation.x = pose.onGround ? Math.max(0, -sin * side) * gait * 1.1 : 0.8;
      const wrist: V3 = i === 0 ? supportGrip(pose.weapon) : [1.2, -3, 1];
      wrist[0] += 2.5; wrist[1] += 9; wrist[2] -= 5;
      if (pose.weapon === WeaponId.none || (i === 0 && pose.weapon === WeaponId.knife)) {
        wrist[0] = side * 12; wrist[1] = -4; wrist[2] = -2;
      }
      const shoulder: V3 = [side * 12, 17, 0];
      const elbow: V3 = [side * 12.8, (17 + wrist[1]) / 2 - 4, wrist[2] * 0.35];
      this.aimBone(this.shoulders[i]!, shoulder, elbow);
      this.aimBone(this.elbows[i]!, elbow, wrist);
    }
    this.hips.position.y = 28 + (pose.onGround ? Math.abs(cos) * gait * 1.4 : 0);
    this.torso.rotation.z = sin * (moving ? gait * 0.035 : 0.015);
    this.torso.rotation.y = -sin * (moving ? gait * 0.05 : 0.008);
    const pitch = Math.max(-0.9, Math.min(0.9, pose.pitch));
    this.torso.rotation.x = pitch * 0.65;
    this.head.rotation.x = pitch * 0.35;
  }

  dispose(): void {
    disposeParts(this.root);
    for (const material of this.materials) material.dispose();
    // Cached team textures and weapon materials outlive a roster rebuild.
  }
}
