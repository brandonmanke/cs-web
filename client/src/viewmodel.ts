import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// PSX AK-47 viewmodel. The GLB is meter-ish scale with the barrel down -Z,
// which matches camera space directly.

const BASE_POSITION = new THREE.Vector3(7.5, -7, -13);
const SCALE = 8;

export class Viewmodel {
  private group: THREE.Group | null = null;
  private kick = 0;
  private bobPhase = 0;

  async load(camera: THREE.Camera): Promise<void> {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync("/models/psx/weapons/ak47/ak47.glb");
      const group = new THREE.Group();
      gltf.scene.scale.setScalar(SCALE);
      group.add(gltf.scene);
      group.position.copy(BASE_POSITION);
      camera.add(group);
      this.group = group;
    } catch {
      // Viewmodel is cosmetic; play without it if the asset is missing.
    }
  }

  onShot(): void {
    this.kick = 1;
  }

  update(dt: number, speedH: number, onGround: boolean): void {
    if (!this.group) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    if (onGround && speedH > 10) {
      this.bobPhase += dt * (speedH / 250) * 11;
    }
    const bob = Math.sin(this.bobPhase) * 0.35 * Math.min(speedH / 250, 1);
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.3 * Math.min(speedH / 250, 1);
    this.group.position.set(
      BASE_POSITION.x + bob,
      BASE_POSITION.y - bobY,
      BASE_POSITION.z + this.kick * 1.6,
    );
    this.group.rotation.x = this.kick * 0.1;
  }
}
