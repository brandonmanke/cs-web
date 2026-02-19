export class HUD {
  private static readonly HITMARKER_DURATION = 0.15;
  private scoreEl: HTMLElement;
  private accuracyEl: HTMLElement;
  private ammoEl: HTMLElement;
  private reloadEl: HTMLElement;
  private hudEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private hitmarkerEl: HTMLElement;
  private score = 0;
  private shots = 0;
  private hits = 0;
  private hitmarkerTimer = 0;

  constructor() {
    this.scoreEl = document.getElementById("score")!;
    this.accuracyEl = document.getElementById("accuracy")!;
    this.ammoEl = document.getElementById("ammo")!;
    this.reloadEl = document.getElementById("reload-msg")!;
    this.hudEl = document.getElementById("hud")!;
    this.crosshairEl = document.getElementById("crosshair")!;
    this.hitmarkerEl = document.getElementById("hitmarker")!;
  }

  setVisible(visible: boolean): void {
    this.hudEl.style.display = visible ? "block" : "none";
    this.crosshairEl.style.display = visible ? "block" : "none";
  }

  recordShot(hit: boolean): void {
    this.shots++;
    if (hit) {
      this.hits++;
      this.score++;
      this.scoreEl.textContent = `Score: ${this.score}`;
    }
    const pct = this.shots > 0 ? Math.round((this.hits / this.shots) * 100) : 0;
    this.accuracyEl.textContent = `${this.hits}/${this.shots} (${pct}%)`;
  }

  addScore(): void {
    // kept for compat but prefer recordShot
    this.score++;
    this.scoreEl.textContent = `Score: ${this.score}`;
  }

  resetStats(): void {
    this.score = 0;
    this.shots = 0;
    this.hits = 0;
    this.scoreEl.textContent = "Score: 0";
    this.accuracyEl.textContent = "0/0 (0%)";
  }

  updateAmmo(ammo: number, reserve: number): void {
    this.ammoEl.textContent = `${ammo} / ${reserve}`;
  }

  updateReloadMsg(isReloading: boolean, isEmpty: boolean): void {
    if (isReloading) {
      this.reloadEl.textContent = "RELOADING...";
      this.reloadEl.style.display = "block";
    } else if (isEmpty) {
      this.reloadEl.textContent = "RELOAD [R]";
      this.reloadEl.style.display = "block";
    } else {
      this.reloadEl.style.display = "none";
    }
  }

  showHitmarker(): void {
    this.hitmarkerEl.style.display = "block";
    this.hitmarkerTimer = HUD.HITMARKER_DURATION;
  }

  update(dt: number): void {
    if (this.hitmarkerTimer <= 0) {
      return;
    }

    this.hitmarkerTimer -= dt;
    if (this.hitmarkerTimer <= 0) {
      this.hitmarkerEl.style.display = "none";
    }
  }
}
