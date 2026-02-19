import {
  Settings,
  FOV_MIN,
  FOV_MAX,
  SENS_MIN,
  SENS_MAX,
  SENS_STEP,
} from "./settings";

export class EscapeMenu {
  private el: HTMLElement;
  private settings: Settings;
  private _open = false;

  private fovSlider!: HTMLInputElement;
  private fovValue!: HTMLElement;
  private sensSlider!: HTMLInputElement;
  private sensValue!: HTMLElement;
  private unlimitedAmmoToggle!: HTMLInputElement;
  private muzzleFlashToggle!: HTMLInputElement;

  get isOpen(): boolean {
    return this._open;
  }

  constructor(settings: Settings) {
    this.settings = settings;
    this.el = document.getElementById("escape-menu")!;
    this.fovSlider = this.el.querySelector("#fov-slider") as HTMLInputElement;
    this.fovValue = this.el.querySelector("#fov-value")!;
    this.sensSlider = this.el.querySelector("#sens-slider") as HTMLInputElement;
    this.sensValue = this.el.querySelector("#sens-value")!;

    // Init slider attributes
    this.fovSlider.min = String(FOV_MIN);
    this.fovSlider.max = String(FOV_MAX);
    this.fovSlider.step = "1";
    this.fovSlider.value = String(settings.fov);
    this.fovValue.textContent = String(settings.fov);

    this.sensSlider.min = String(SENS_MIN);
    this.sensSlider.max = String(SENS_MAX);
    this.sensSlider.step = String(SENS_STEP);
    this.sensSlider.value = String(settings.sensitivity);
    this.sensValue.textContent = settings.sensitivity.toFixed(1);

    this.unlimitedAmmoToggle = this.el.querySelector(
      "#unlimited-ammo-toggle"
    ) as HTMLInputElement;
    this.unlimitedAmmoToggle.checked = settings.unlimitedAmmo;

    this.muzzleFlashToggle = this.el.querySelector(
      "#muzzle-flash-toggle"
    ) as HTMLInputElement;
    this.muzzleFlashToggle.checked = settings.muzzleFlashFx;

    // Slider listeners
    this.fovSlider.addEventListener("input", () => {
      const v = Number(this.fovSlider.value);
      this.settings.fov = v;
      this.fovValue.textContent = String(this.settings.fov);
    });

    this.sensSlider.addEventListener("input", () => {
      const v = Number(this.sensSlider.value);
      this.settings.sensitivity = v;
      this.sensValue.textContent = this.settings.sensitivity.toFixed(1);
    });

    this.unlimitedAmmoToggle.addEventListener("change", () => {
      this.settings.unlimitedAmmo = this.unlimitedAmmoToggle.checked;
    });

    this.muzzleFlashToggle.addEventListener("change", () => {
      this.settings.muzzleFlashFx = this.muzzleFlashToggle.checked;
    });

    // Resume button
    this.el.querySelector("#menu-resume")!.addEventListener("click", () => {
      this.closeAndResume();
    });
  }

  private closeCallback: (() => void) | null = null;

  onClose(fn: () => void): void {
    this.closeCallback = fn;
  }

  open(): void {
    this._open = true;
    this.el.style.display = "flex";
    // Sync slider state with current settings in case changed externally
    this.fovSlider.value = String(this.settings.fov);
    this.fovValue.textContent = String(this.settings.fov);
    this.sensSlider.value = String(this.settings.sensitivity);
    this.sensValue.textContent = this.settings.sensitivity.toFixed(1);
    this.unlimitedAmmoToggle.checked = this.settings.unlimitedAmmo;
    this.muzzleFlashToggle.checked = this.settings.muzzleFlashFx;
  }

  closeWithoutResume(): void {
    if (!this._open) return;
    this._open = false;
    this.el.style.display = "none";
  }

  closeAndResume(): void {
    if (!this._open) return;
    this._open = false;
    this.el.style.display = "none";
    if (this.closeCallback) this.closeCallback();
  }
}
