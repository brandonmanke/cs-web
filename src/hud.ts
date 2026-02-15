export class HUD {
  private static readonly HITMARKER_DURATION = 0.15;
  private scoreEl: HTMLElement;
  private ammoEl: HTMLElement;
  private reloadEl: HTMLElement;
  private hudEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private hitmarkerEl: HTMLElement;
  private score = 0;
  private hitmarkerTimer = 0;

  constructor() {
    this.scoreEl = document.getElementById("score")!;
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

  addScore(): void {
    this.score++;
    this.scoreEl.textContent = `Score: ${this.score}`;
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
