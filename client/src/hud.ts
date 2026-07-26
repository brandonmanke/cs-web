import { Flags, ShotResult, type Snapshot } from "./sim";

const WEAPON_NAMES: Record<number, string> = {
  1: "KNIFE", 2: "USP", 3: "GLOCK", 4: "AK-47", 5: "M4A1", 6: "AWP", 7: "MP5",
};

/** Mirrors the inaccuracy model in sim/src/weapons.cpp so the gap tells truth. */
const CROSSHAIR_MIN = 4;
const CROSSHAIR_MAX = 44;

export class Hud {
  private readonly ammo = document.getElementById("ammo")!;
  private readonly speed = document.getElementById("speed")!;
  private readonly score = document.getElementById("score")!;
  private readonly status = document.getElementById("status")!;
  private readonly hitmarker = document.getElementById("hitmarker")!;
  private readonly crosshair = document.getElementById("crosshair")!;
  private readonly coords = document.getElementById("coords")!;

  private hitmarkerTtl = 0;
  private gap = CROSSHAIR_MIN;
  private lastAmmoText = "";
  private lastScoreText = "";
  private lastSpeedText = "";

  /** Dev readout; off unless ?coords is present. */
  private readonly showCoords = new URLSearchParams(location.search).has("coords");

  constructor() {
    if (!this.showCoords) this.coords.style.display = "none";
  }

  setStatus(text: string | null): void {
    if (text === null) {
      this.status.classList.add("hidden");
    } else {
      this.status.classList.remove("hidden");
      this.status.textContent = text;
    }
  }

  onShot(result: number): void {
    if (result === ShotResult.hit || result === ShotResult.kill) {
      this.hitmarkerTtl = 0.12;
      this.hitmarker.classList.add("show");
      this.hitmarker.style.color = result === ShotResult.kill ? "#ffd24a" : "#ff5a4a";
    }
  }

  update(snapshot: Snapshot, dt: number): void {
    const name = WEAPON_NAMES[snapshot.weapon] ?? "?";
    const ammoText = snapshot.reload > 0
      ? `${name} <span class="dim">RELOADING</span>`
      : `${name} <span class="mag">${snapshot.magazine}</span> / ${snapshot.reserve}`;
    // Six DOM writes a frame is cheap but not free; skip the ones that changed
    // nothing, which is most of them most frames.
    if (ammoText !== this.lastAmmoText) {
      this.ammo.innerHTML = ammoText;
      this.lastAmmoText = ammoText;
    }

    const speedText = `${snapshot.speedH.toFixed(0)} u/s`;
    if (speedText !== this.lastSpeedText) {
      this.speed.textContent = speedText;
      this.lastSpeedText = speedText;
    }

    if (this.showCoords) {
      this.coords.textContent =
        `${snapshot.origin[0].toFixed(0)}, ${snapshot.origin[1].toFixed(0)}, ${snapshot.origin[2].toFixed(0)}`;
    }

    const accuracy = snapshot.shots > 0
      ? ((snapshot.hits / snapshot.shots) * 100).toFixed(0)
      : "--";
    const scoreText = `KILLS ${snapshot.kills}   ACC ${accuracy}%`;
    if (scoreText !== this.lastScoreText) {
      this.score.textContent = scoreText;
      this.lastScoreText = scoreText;
    }

    // Crosshair gap tracks the same terms weapons.cpp uses for spread: movement,
    // being airborne, and the ducked bonus.
    const airborne = (snapshot.flags & Flags.onGround) === 0;
    const ducked = (snapshot.flags & Flags.ducked) !== 0;
    let spread = 1 + (snapshot.speedH / 250) * 2.5 + (airborne ? 5 : 0);
    if (ducked && !airborne) spread *= 0.7;
    const target = Math.min(CROSSHAIR_MAX, CROSSHAIR_MIN + (spread - 1) * 5);
    this.gap += (target - this.gap) * Math.min(1, dt * 14);
    this.crosshair.style.setProperty("--gap", `${this.gap.toFixed(1)}px`);

    if (this.hitmarkerTtl > 0) {
      this.hitmarkerTtl -= dt;
      if (this.hitmarkerTtl <= 0) this.hitmarker.classList.remove("show");
    }
  }
}
