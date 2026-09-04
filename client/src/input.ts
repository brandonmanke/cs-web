import { BASE_FOV, Buttons, type InputFrame } from "./sim";

const PITCH_LIMIT = (89 * Math.PI) / 180;
/**
 * Radians of view per pixel of mouse travel, before the FOV scale. This is the
 * 1x point the menu's slider multiplies: a trackpad runs out of surface long
 * before a mouse does, so turning around at 1x takes a swipe and a half and the
 * only real fix is letting people pick their own number.
 */
export const DEFAULT_SENSITIVITY = 0.0022;
/**
 * Radians of view per pixel of thumb drag. A thumb covers far fewer pixels than
 * a wrist does, so touch gets its own gain; the menu slider multiplies both.
 */
export const DEFAULT_TOUCH_SENSITIVITY = 0.0045;
/** A single pointer-lock event this large is a browser glitch, not a flick. */
const MAX_MOUSE_DELTA = 400;
/** Long enough to outlast the post-Escape re-lock cooldown (~1s in Chrome). */
const LOCK_RETRY_WINDOW = 1800;
const LOCK_RETRY_INTERVAL = 150;

/**
 * cs::WeaponId in pick order: rifles, then pistols, then the knife. The number
 * keys index it and the touch layer's weapon button cycles through it.
 */
export const WEAPON_ORDER = [4, 5, 6, 7, 3, 2, 1];
// Digit1..Digit7 -> cs::WeaponId
const WEAPON_KEYS: Record<string, number> = Object.fromEntries(
  WEAPON_ORDER.map((id, i) => [`Digit${i + 1}`, id]),
);

/** What Input needs from the on-screen controls; see touch.ts. */
export interface TouchSource {
  readonly forward: number;
  readonly strafe: number;
  readonly buttons: number;
  takeWeapon(): number;
  notifyWeapon(id: number): void;
}

export class Input {
  yaw = 0;
  pitch = 0;
  locked = false;
  sensitivity = DEFAULT_SENSITIVITY;
  touchSensitivity = DEFAULT_TOUCH_SENSITIVITY;
  /** Set when on-screen controls are live; they feed the same command. */
  touch: TouchSource | null = null;

  /** View delta since the last sample, for viewmodel sway. */
  yawDelta = 0;
  pitchDelta = 0;

  private keys = new Set<string>();
  private fire = false;
  private zoom = false;
  /**
   * Mouse-to-view gain, scaled by the sim's current FOV. Without it a scoped
   * flick covers the same pixels but a ninth of the world, and the AWP becomes
   * unaimable — 1.6 scales the same way.
   */
  private fovScale = 1;
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
    // Touch controls do their own thing with a press on the game surface, and
    // pointer lock would eat the look drags, so it is never asked for there.
    if (!this.touch) this.el.addEventListener("click", () => this.requestLock());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.el;
      if (this.locked) {
        this.clearLockRetry();
      } else {
        this.keys.clear();
        this.fire = false;
        this.zoom = false;
        this.scrollJumps = 0;
      }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      const dx = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementX));
      const dy = Math.max(-MAX_MOUSE_DELTA, Math.min(MAX_MOUSE_DELTA, e.movementY));
      this.applyLook(dx, dy, this.sensitivity);
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.zoom = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.zoom = false;
    });
    // Right-click is secondary fire here, not a menu.
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
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
      // Ctrl+W / Ctrl+digit would otherwise reach the browser while ducking,
      // and Tab would walk focus off the canvas.
      if (e.code === "Space" || e.code === "Tab" || e.ctrlKey) e.preventDefault();
    });
    document.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });
  }

  /**
   * Turn a raw pointer delta into view angles. Shared by the mouse and the
   * on-screen look pad so both get the same pitch clamp and FOV scaling.
   */
  private applyLook(dx: number, dy: number, sensitivity: number): void {
    const gain = sensitivity * this.fovScale;
    this.yaw -= dx * gain;
    this.pitch -= dy * gain;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    this.accumYaw -= dx * gain;
    this.accumPitch -= dy * gain;
  }

  /** A drag on the on-screen look pad, in CSS pixels. */
  addTouchLook(dx: number, dy: number): void {
    this.applyLook(dx, dy, this.touchSensitivity);
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  /** Scoreboard is held rather than toggled, same as 1.6. */
  get scoreboard(): boolean {
    return this.keys.has("Tab");
  }

  /** Feed the sim's current FOV back in so aim gain follows the scope. */
  setFov(fov: number): void {
    this.fovScale = fov / BASE_FOV;
  }

  /** Track what the sim actually equipped, so Q can swap back to it. */
  notifyWeapon(id: number): void {
    if (id !== this.currentWeapon) {
      if (this.currentWeapon !== 0) this.lastWeapon = this.currentWeapon;
      this.currentWeapon = id;
    }
    this.touch?.notifyWeapon(id);
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
    if (this.zoom) buttons |= Buttons.zoom;

    if (this.touch) {
      forward = Math.max(-1, Math.min(1, forward + this.touch.forward));
      strafe = Math.max(-1, Math.min(1, strafe + this.touch.strafe));
      buttons |= this.touch.buttons;
    }
    // Always consumed, so a queued pick can't sit there behind a key press.
    const touchWeapon = this.touch?.takeWeapon() ?? 0;
    const weapon = this.pendingWeapon || touchWeapon;
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
