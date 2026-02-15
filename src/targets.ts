import * as THREE from "three";
import {
  TARGET_COUNT,
  TARGET_RADIUS,
  TARGET_MIN_HEIGHT,
  TARGET_MAX_HEIGHT,
  TARGET_SPAWN_MARGIN,
  ROOM_WIDTH,
  ROOM_DEPTH,
} from "./constants";

interface Target {
  mesh: THREE.Mesh;
  hitTime: number; // -1 if not hit, time since hit otherwise
}

export class TargetManager {
  private scene: THREE.Scene;
  private targets: Target[] = [];
  private raycaster = new THREE.Raycaster();
  private targetMat = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
  private hitMat = new THREE.MeshStandardMaterial({
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 0.5,
  });
  private geometry = new THREE.SphereGeometry(TARGET_RADIUS, 16, 12);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    for (let i = 0; i < TARGET_COUNT; i++) {
      this.spawnTarget();
    }
  }

  private randomPos(): THREE.Vector3 {
    const hw = ROOM_WIDTH / 2 - TARGET_SPAWN_MARGIN;
    const hd = ROOM_DEPTH / 2 - TARGET_SPAWN_MARGIN;
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * hw,
      TARGET_MIN_HEIGHT +
        Math.random() * (TARGET_MAX_HEIGHT - TARGET_MIN_HEIGHT),
      (Math.random() * 2 - 1) * hd
    );
  }

  private spawnTarget(): void {
    const mesh = new THREE.Mesh(this.geometry, this.targetMat.clone());
    mesh.position.copy(this.randomPos());
    this.scene.add(mesh);
    this.targets.push({ mesh, hitTime: -1 });
  }

  checkHit(camera: THREE.PerspectiveCamera): boolean {
    // Raycast from center of screen
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = this.targets
      .filter((t) => t.hitTime < 0)
      .map((t) => t.mesh);
    const intersects = this.raycaster.intersectObjects(meshes);

    if (intersects.length > 0) {
      const hitMesh = intersects[0].object as THREE.Mesh;
      const target = this.targets.find((t) => t.mesh === hitMesh);
      if (target) {
        target.hitTime = 0;
        target.mesh.material = this.hitMat.clone();
      }
      return true;
    }
    return false;
  }

  update(dt: number): void {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.hitTime >= 0) {
        t.hitTime += dt;
        // Scale down and remove
        const scale = 1 - t.hitTime * 5;
        if (scale <= 0) {
          this.scene.remove(t.mesh);
          this.targets.splice(i, 1);
          this.spawnTarget();
        } else {
          t.mesh.scale.setScalar(scale);
        }
      }
    }
  }
}
