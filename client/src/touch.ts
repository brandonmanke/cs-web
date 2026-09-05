import { WEAPON_NAMES } from "./hud";
import { WEAPON_ORDER } from "./input";
import { Buttons } from "./sim";

// On-screen controls for a phone or tablet: a floating move stick on the left,
// a look pad on the right, and a thumb cluster of buttons. Input only — it
// produces the same axes and button mask a keyboard does and hands them to
// `Input`, which is still the one place a frame's InputCommand is assembled.
//
// Pointer Events rather than Touch Events, because they carry an id per finger
// (so a stick drag and a look drag coexist) and because a mouse drives them
// too, which is what makes `?touch` testable on a desktop.

/** Deflection at which the stick reads as fully pushed, in CSS pixels. */
const STICK_RADIUS = 56;
/** Below this fraction of the radius the stick reads as centred. */
const STICK_DEADZONE = 0.18;
/** Where the stick rests before a thumb finds it, as a fraction of its pad. */
const STICK_HOME_X = 0.5;
const STICK_HOME_Y = 0.68;

/**
 * Buttons that behave like a held key. Zoom is in here rather than treated as
 * a tap because the sim already edge-detects it: holding cycles the scope once
 * and then waits, exactly as holding MOUSE2 does.
 */
const HELD: Record<string, number> = {
  fire: Buttons.fire,
  jump: Buttons.jump,
  reload: Buttons.reload,
  zoom: Buttons.zoom,
};

/**
 * True on a device whose primary pointer is a finger. `?touch` forces it on
 * (for testing on a desktop) and `?touch=0` forces it off.
 */
function detect(): boolean {
  const forced = new URLSearchParams(location.search).get("touch");
  if (forced !== null) return forced !== "0";
  return matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
}

export class TouchControls {
  readonly active = detect();
  forward = 0;
  strafe = 0;
  buttons = 0;

  private readonly root = document.getElementById("touch")!;
  private readonly movePad = this.root.querySelector<HTMLElement>(".pad.move")!;
  private readonly lookPad = this.root.querySelector<HTMLElement>(".pad.look")!;
  private readonly stick = this.root.querySelector<HTMLElement>(".stick")!;
  private readonly knob = this.root.querySelector<HTMLElement>(".knob")!;
  private readonly weaponButton = this.root.querySelector<HTMLElement>(".weapon")!;

  private stickPointer = -1;
  private stickOriginX = 0;
  private stickOriginY = 0;
  private lookPointer = -1;
  private lookX = 0;
  private lookY = 0;
  private weaponIndex = 0;
  private pendingWeapon = 0;

  constructor(
    /** A look drag, in CSS pixels. */
    private readonly onLook: (dx: number, dy: number) => void,
    /** The ☰ button: a touch device has no Escape to reopen the menu with. */
    private readonly onMenu: () => void,
  ) {
    if (!this.active) return;
    document.body.classList.add("touch");
    this.bindStick();
    this.bindLook();
    this.bindButtons();

    // OS gestures, app switches and rotation can interrupt a finger without
    // delivering pointerup to its pad. Never carry held input across them.
    window.addEventListener("blur", () => this.releaseAll());
    window.addEventListener("pagehide", () => this.releaseAll());
    window.addEventListener("resize", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });
  }

  /** Shown while playing, hidden behind the menu. */
  setVisible(visible: boolean): void {
    if (!this.active) return;
    if (!visible) this.releaseAll();
    this.root.classList.toggle("hidden", !visible);
    if (visible) this.homeStick();
  }

  /** The weapon the cycle button asked for, consumed once. */
  takeWeapon(): number {
    const weapon = this.pendingWeapon;
    this.pendingWeapon = 0;
    return weapon;
  }

  /** Keep the button label and the cycle position on what is actually held. */
  notifyWeapon(id: number): void {
    if (!this.active) return;
    const index = WEAPON_ORDER.indexOf(id);
    if (index >= 0) this.weaponIndex = index;
    this.weaponButton.textContent = WEAPON_NAMES[id] ?? "?";
  }

  private releaseAll(): void {
    this.forward = 0;
    this.strafe = 0;
    this.buttons = 0;
    this.pendingWeapon = 0;
    this.stickPointer = -1;
    this.lookPointer = -1;
    this.stick.classList.remove("live");
    this.homeStick();
    for (const button of this.root.querySelectorAll(".on")) {
      button.classList.remove("on");
    }
  }

  private bindStick(): void {
    this.movePad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.stickPointer !== -1) return;
      this.stickPointer = e.pointerId;
      this.movePad.setPointerCapture(e.pointerId);
      this.stickOriginX = e.clientX;
      this.stickOriginY = e.clientY;
      // The stick is where your thumb landed, not where the art was.
      const pad = this.movePad.getBoundingClientRect();
      this.stick.style.left = `${e.clientX - pad.left}px`;
      this.stick.style.top = `${e.clientY - pad.top}px`;
      this.stick.classList.add("live");
      this.moveStick(e.clientX, e.clientY);
    });
    this.movePad.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.stickPointer) this.moveStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = -1;
      this.forward = 0;
      this.strafe = 0;
      this.stick.classList.remove("live");
      this.homeStick();
    };
    this.movePad.addEventListener("pointerup", end);
    this.movePad.addEventListener("pointercancel", end);
    this.movePad.addEventListener("lostpointercapture", end);
  }

  private moveStick(x: number, y: number): void {
    let dx = x - this.stickOriginX;
    let dy = y - this.stickOriginY;
    const length = Math.hypot(dx, dy);
    if (length > STICK_RADIUS) {
      dx *= STICK_RADIUS / length;
      dy *= STICK_RADIUS / length;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const fx = dx / STICK_RADIUS;
    const fy = dy / STICK_RADIUS;
    if (Math.hypot(fx, fy) < STICK_DEADZONE) {
      this.forward = 0;
      this.strafe = 0;
      return;
    }
    // Screen y grows downward; forward is up the screen.
    this.strafe = fx;
    this.forward = -fy;
  }

  private homeStick(): void {
    const pad = this.movePad.getBoundingClientRect();
    this.stick.style.left = `${pad.width * STICK_HOME_X}px`;
    this.stick.style.top = `${pad.height * STICK_HOME_Y}px`;
    this.knob.style.transform = "";
  }

  private bindLook(): void {
    this.lookPad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (this.lookPointer !== -1) return;
      this.lookPointer = e.pointerId;
      this.lookPad.setPointerCapture(e.pointerId);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    this.lookPad.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.lookPointer) return;
      this.onLook(e.clientX - this.lookX, e.clientY - this.lookY);
      this.lookX = e.clientX;
      this.lookY = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === this.lookPointer) this.lookPointer = -1;
    };
    this.lookPad.addEventListener("pointerup", end);
    this.lookPad.addEventListener("pointercancel", end);
    this.lookPad.addEventListener("lostpointercapture", end);
  }

  private bindButtons(): void {
    for (const button of this.root.querySelectorAll<HTMLElement>("button")) {
      const action = button.dataset.act ?? "";
      const mask = HELD[action];
      button.addEventListener("pointerdown", (e) => {
        // Stops the press becoming a synthetic click, a scroll or a text
        // selection, and keeps it off the look pad underneath.
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        if (mask !== undefined) {
          this.buttons |= mask;
          button.classList.add("on");
        } else if (action === "duck") {
          // The one toggle: crouching for a whole gunfight would otherwise cost
          // the thumb that has to be on FIRE.
          this.buttons ^= Buttons.duck;
          button.classList.toggle("on", (this.buttons & Buttons.duck) !== 0);
        } else if (action === "weapon") {
          this.weaponIndex = (this.weaponIndex + 1) % WEAPON_ORDER.length;
          this.pendingWeapon = WEAPON_ORDER[this.weaponIndex]!;
          this.notifyWeapon(this.pendingWeapon);
        } else if (action === "menu") {
          this.onMenu();
        }
      });
      const release = (): void => {
        if (mask === undefined) return;
        this.buttons &= ~mask;
        button.classList.remove("on");
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("lostpointercapture", release);
    }
  }
}
