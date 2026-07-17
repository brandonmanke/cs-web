import { ShotResult, type Snapshot } from "./sim";

const WEAPON_NAMES: Record<number, string> = {
  1: "KNIFE", 2: "USP", 3: "GLOCK", 4: "AK-47", 5: "M4A1", 6: "AWP", 7: "MP5",
};

export class Hud {
  private readonly ammo = document.getElementById("ammo")!;
  private readonly speed = document.getElementById("speed")!;
  private readonly score = document.getElementById("score")!;
  private readonly status = document.getElementById("status")!;
  private readonly hitmarker = document.getElementById("hitmarker")!;
  private hitmarkerTtl = 0;

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
    this.ammo.textContent = snapshot.reload > 0
      ? `${name} ...`
      : `${name} ${snapshot.magazine}/${snapshot.reserve}`;
    this.speed.textContent = `${snapshot.speedH.toFixed(0)} u/s`;
    const accuracy = snapshot.shots > 0
      ? ((snapshot.hits / snapshot.shots) * 100).toFixed(0)
      : "--";
    this.score.textContent = `KILLS ${snapshot.kills}  ACC ${accuracy}%`;
    if (this.hitmarkerTtl > 0) {
      this.hitmarkerTtl -= dt;
      if (this.hitmarkerTtl <= 0) {
        this.hitmarker.classList.remove("show");
      }
    }
  }
}
