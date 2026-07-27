import { Flags, type Snapshot } from "./sim";

// What the camera does while you are dead.
//
// Freezing the view where it was leaves you staring at whatever was in front of
// your eyes when you got shot — frequently the inside of a crate you had walked
// up to. This drops the eye to body height and turns it toward whoever killed
// you, which is both less claustrophobic and the only way the game ever tells
// you where a shot came from.
//
// Presentation only: the sim decides when you die and when you come back, and
// the yaw computed here is never fed into an InputCommand.

/**
 * Eye offset relative to the hull *centre*, matching the snapshot's eyeHeight.
 * A 72u hull centres 36u up, so this puts the camera 14u off the floor.
 */
const BODY_EYE_OFFSET = -22;
const DROP_SECONDS = 0.4;
const TURN_RATE = 3.2; // radians/second toward the killer
const LOOK_UP = 0.12;  // you are on the floor; they are not

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export interface DeathView {
  yaw: number;
  pitch: number;
  /** Eye offset above the hull centre, for the renderer to use as-is. */
  eyeHeight: number;
}

export class DeathCam {
  private dead = false;
  private killer = -1;
  private drop = 0;
  private yaw = 0;
  private pitch = 0;

  /** Records who to look at. Call on every EventDeath naming the local player. */
  onKilled(killer: number, localIndex: number): void {
    this.killer = killer === localIndex ? -1 : killer;
  }

  /** The view to render from, or null while alive (the mouse has it then). */
  update(dt: number, snapshot: Snapshot, inputYaw: number, inputPitch: number):
    DeathView | null {
    if ((snapshot.flags & Flags.alive) !== 0) {
      this.dead = false;
      this.killer = -1;
      this.drop = 0;
      return null;
    }

    if (!this.dead) {
      // Take over from wherever the player was looking, so the drop reads as a
      // fall rather than a cut.
      this.dead = true;
      this.yaw = inputYaw;
      this.pitch = inputPitch;
      this.drop = 0;
    }

    this.drop = Math.min(1, this.drop + dt / DROP_SECONDS);
    const eased = 1 - (1 - this.drop) * (1 - this.drop); // fast fall, soft settle

    const killer = this.killer >= 0 && this.killer < snapshot.playerCount
      ? snapshot.players[this.killer]
      : undefined;
    let wantPitch = 0;
    if (killer) {
      const dx = killer.x - snapshot.origin[0];
      const dz = killer.z - snapshot.origin[2];
      if (dx * dx + dz * dz > 1) {
        const wantYaw = Math.atan2(-dx, -dz); // yaw 0 looks down -Z
        const step = TURN_RATE * dt;
        const delta = wrapAngle(wantYaw - this.yaw);
        this.yaw = wrapAngle(this.yaw + Math.max(-step, Math.min(step, delta)));
        wantPitch = LOOK_UP;
      }
    }
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 2.5);

    return {
      yaw: this.yaw,
      pitch: this.pitch,
      eyeHeight: snapshot.eyeHeight + (BODY_EYE_OFFSET - snapshot.eyeHeight) * eased,
    };
  }
}
