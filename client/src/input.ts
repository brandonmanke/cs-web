import { Buttons, type InputFrame } from "./sim";

const SENSITIVITY = 0.0022; // radians per pixel
const PITCH_LIMIT = (89 * Math.PI) / 180;

// 1-7 -> cs::WeaponId
const WEAPON_KEYS: Record<string, number> = {
  Digit1: 4, // AK-47
  Digit2: 5, // M4A1
  Digit3: 6, // AWP
  Digit4: 7, // MP5
  Digit5: 3, // Glock
  Digit6: 2, // USP
  Digit7: 1, // Knife
};

export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;

  private keys = new Set<string>();
  private fire = false;
  private pendingWeapon = 0;

  constructor(private readonly el: HTMLElement) {}

  attach(): void {
    this.el.addEventListener("click", () => {
      if (!this.locked) {
        void this.el.requestPointerLock();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.keys.clear();
        this.fire = false;
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * SENSITIVITY;
      this.pitch -= e.movementY * SENSITIVITY;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });
    document.addEventListener("mousedown", (e) => {
      if (this.locked && e.button === 0) this.fire = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fire = false;
    });
    document.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      const weapon = WEAPON_KEYS[e.code];
      if (weapon !== undefined) this.pendingWeapon = weapon;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  sample(): InputFrame {
    let forward = 0;
    let strafe = 0;
    if (this.keys.has("KeyW")) forward += 1;
    if (this.keys.has("KeyS")) forward -= 1;
    if (this.keys.has("KeyD")) strafe += 1;
    if (this.keys.has("KeyA")) strafe -= 1;
    let buttons = 0;
    if (this.keys.has("Space")) buttons |= Buttons.jump;
    if (this.keys.has("ControlLeft") || this.keys.has("KeyC")) buttons |= Buttons.duck;
    if (this.keys.has("KeyR")) buttons |= Buttons.reload;
    if (this.fire) buttons |= Buttons.fire;
    const weapon = this.pendingWeapon;
    this.pendingWeapon = 0;
    return { forward, strafe, yaw: this.yaw, pitch: this.pitch, buttons, weapon };
  }
}
