import * as THREE from "three";

/**
 * An in-world panel mounted on the floor that the player can shoot to reset stats.
 * Renders "RESET" text via canvas texture on a flat plane.
 */
export class ResetBoard {
  readonly mesh: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  constructor(scene: THREE.Scene) {
    // Canvas texture with "RESET" text
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, 256, 128);

    // Border
    ctx.strokeStyle = "#cc2222";
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 248, 120);

    // Text
    ctx.fillStyle = "#cc2222";
    ctx.font = "bold 48px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("RESET", 128, 64);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xcc2222,
      emissiveIntensity: 0.15,
    });

    const geometry = new THREE.PlaneGeometry(1.2, 0.6);
    this.mesh = new THREE.Mesh(geometry, material);

    // Lay flat on the floor, centered at bottom of room
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, 0.01, 0);

    scene.add(this.mesh);
  }

  /** Returns true if the center-screen ray hits the board. */
  checkHit(camera: THREE.PerspectiveCamera): boolean {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = this.raycaster.intersectObject(this.mesh);
    return intersects.length > 0;
  }
}
