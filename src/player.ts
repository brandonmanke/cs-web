import * as THREE from "three";
import { InputManager } from "./input";
import {
  PLAYER_HEIGHT,
  PLAYER_SPEED,
  ACCELERATION,
  FRICTION,
  PLAYER_RADIUS,
  ROOM_WIDTH,
  ROOM_DEPTH,
} from "./constants";

export class Player {
  private camera: THREE.PerspectiveCamera;
  private input: InputManager;
  private velocity = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private sensitivity = 0.002;
  private _isMoving = false;

  constructor(
    camera: THREE.PerspectiveCamera,
    input: InputManager,
    _canvas: HTMLElement
  ) {
    this.camera = camera;
    this.input = input;
    this.camera.position.set(0, PLAYER_HEIGHT, 0);
  }

  update(dt: number): void {
    // Mouse look
    const { dx, dy } = this.input.consumeMouse();
    this.euler.setFromQuaternion(this.camera.quaternion);
    this.euler.y -= dx * this.sensitivity;
    this.euler.x -= dy * this.sensitivity;
    this.euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);

    // Wish direction from keys
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    const wish = new THREE.Vector3();
    if (this.input.keys.has("KeyW")) wish.add(forward);
    if (this.input.keys.has("KeyS")) wish.sub(forward);
    if (this.input.keys.has("KeyD")) wish.add(right);
    if (this.input.keys.has("KeyA")) wish.sub(right);

    if (wish.lengthSq() > 0) {
      wish.normalize();
      // Accelerate toward wish direction
      this.velocity.add(wish.multiplyScalar(ACCELERATION * dt));
    }

    // Friction
    const speed = this.velocity.length();
    if (speed > 0) {
      const drop = speed * FRICTION * dt;
      this.velocity.multiplyScalar(Math.max(0, speed - drop) / speed);
    }

    // Speed cap
    if (this.velocity.length() > PLAYER_SPEED) {
      this.velocity.normalize().multiplyScalar(PLAYER_SPEED);
    }

    this._isMoving = this.velocity.length() > 0.5;

    // Move
    this.camera.position.add(
      this.velocity.clone().multiplyScalar(dt)
    );

    // Clamp to room bounds
    const hw = ROOM_WIDTH / 2 - PLAYER_RADIUS;
    const hd = ROOM_DEPTH / 2 - PLAYER_RADIUS;
    this.camera.position.x = Math.max(-hw, Math.min(hw, this.camera.position.x));
    this.camera.position.z = Math.max(-hd, Math.min(hd, this.camera.position.z));
    this.camera.position.y = PLAYER_HEIGHT;
  }

  isMoving(): boolean {
    return this._isMoving;
  }
}
