import { Buttons, type InputFrame } from "./sim";

const PITCH_LIMIT = (89 * Math.PI) / 180;
const DEFAULT_SENSITIVITY = 0.0022; // radians per pixel
/** A single pointer-lock event this large is a browser glitch, not a flick. */
const MAX_MOUSE_DELTA = 400;
/** Long enough to outlast the post-Escape re-lock cooldown (~1s in Chrome). */
const LOCK_RETRY_WINDOW = 1800;
const LOCK_RETRY_INTERVAL = 150;

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
  sensitivity = DEFAULT_SENSITIVITY;

  /** View delta since the last sample, for viewmodel sway. */
  yawDelta = 0;
  pitchDelta = 0;

  private keys = new Set<string>();
  private fire = false;
  private pendingWeapon = 0;
  private lastWeapon = 0;
  private currentWeapon = 0;
  /** Scroll ticks queued as jumps — the 1.6 bhop binding. */
  private scrollJumps = 0;
  private lockRetry: number | null = null;
  private accumYaw = 0;
  private accumPitch = 0;

  /** Notified whenever pointer lock is gained or lost. */
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly el: HTMLElement) {}

  /**
   * Ask for pointer lock, retrying until the browser accepts.
   *
   * Browsers refuse a re-lock for roughly a second after Escape released it, so
   * a single request right after opening the menu is usually rejected and the
   * click appears to do nothing. Retrying until `LOCK_RETRY_WINDOW` covers that
   * cooldown. Some browsers return void rather than a promise, so success is
   * detected via `locked` (set by pointerlockchange) rather than the result.
   */
  requestLock(onGaveUp?: () => void): void {
    if (this.locked) return;
    this.clearLockRetry();
    const deadline = performance.now() + LOCK_RETRY_WINDOW;

    const attempt = (): void => {
      this.lockRetry = null;
      if (this.locked) return;
      if (performance.now() > deadline) {
        onGaveUp?.();
        return;
      }
      const result: unknown = this.el.requestPointerLock();
      if (result instanceof Promise) result.catch(() => {});
      this.lockRetry = window.setTimeout(attempt, LOCK_RETRY_INTERVAL);
    };
    attempt();
  }

  private clearLockRetry(): void {
    if (this.lockRetry !== null) {
      clearTimeout(this.lockRetry);
      this.lockRetry = null;
    }
  }

  attach(): void {
    this.el.addEventListener("click", () => this.requestLock());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) {
        this.clearLockRetry();
      } else {
        this.keys.clear();
        this.fire = false;
        this.scrollJumps = 0;
      }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      const dx = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementX));
      const dy = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementY));
      this.yaw -= dx * this.sensitivity;
      this.pitch -= dy * this.sensitivity;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
      this.accumYaw -= dx * this.sensitivity;
      this.accumPitch -= dy * this.sensitivity;
    });
    document.addEventListener("mousedown", (e) => {
      if (this.locked && e.button === 0) this.fire = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fire = false;
    });
    // Scroll-to-jump: muscle memory for anyone who ever bhopped in 1.6.
    document.addEventListener("wheel", (e) => {
      if (!this.locked) return;
      if (e.deltaY !== 0) this.scrollJumps = Math.min(this.scrollJumps + 1, 2);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("keydown", (e) => {
      if (!this.locked) return;
      const weapon = WEAPON_KEYS[e.code];
      if (weapon !== undefined && weapon !== this.currentWeapon) {
        this.pendingWeapon = weapon;
      }
      if (e.code === "KeyQ" && this.lastWeapon !== 0) this.pendingWeapon = this.lastWeapon;
      this.keys.add(e.code);
      // Ctrl+W / Ctrl+digit would otherwise reach the browser while ducking.
      if (e.code === "Space" || e.ctrlKey) e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** Track what the sim actually equipped, so Q can swap back to it. */
  notifyWeapon(id: number): void {
    if (id !== this.currentWeapon) {
      if (this.currentWeapon !== 0) this.lastWeapon = this.currentWeapon;
      this.currentWeapon = id;
    }
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
    if (this.scrollJumps > 0) {
      buttons |= Buttons.jump;
      --this.scrollJumps;
    }
    if (this.keys.has("ControlLeft") || this.keys.has("KeyC")) buttons |= Buttons.duck;
    if (this.keys.has("ShiftLeft")) buttons |= Buttons.walk;
    if (this.keys.has("KeyR")) buttons |= Buttons.reload;
    if (this.fire) buttons |= Buttons.fire;

    const weapon = this.pendingWeapon;
    this.pendingWeapon = 0;
    return { forward, strafe, yaw: this.yaw, pitch: this.pitch, buttons, weapon };
  }

  /** Consume the accumulated view delta; call once per rendered frame. */
  takeViewDelta(): void {
    this.yawDelta = this.accumYaw;
    this.pitchDelta = this.accumPitch;
    this.accumYaw = 0;
    this.accumPitch = 0;
  }
}
