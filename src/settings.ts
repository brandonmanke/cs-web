const STORAGE_KEY = "aim-trainer-settings";

export interface SettingsValues {
  fov: number;
  sensitivity: number;
  unlimitedAmmo: boolean;
  muzzleFlashFx: boolean;
}

const DEFAULTS: SettingsValues = {
  fov: 75,
  sensitivity: 2.0,
  unlimitedAmmo: false,
  muzzleFlashFx: true,
};

export const FOV_MIN = 65;
export const FOV_MAX = 120;
export const SENS_MIN = 0.5;
export const SENS_MAX = 10.0;
export const SENS_STEP = 0.1;

export class Settings {
  private values: SettingsValues;
  private listeners: Array<(s: SettingsValues) => void> = [];

  constructor() {
    this.values = { ...DEFAULTS };
    this.load();
  }

  get fov(): number {
    return this.values.fov;
  }
  set fov(v: number) {
    this.values.fov = Math.round(Math.max(FOV_MIN, Math.min(FOV_MAX, v)));
    this.save();
    this.notify();
  }

  get sensitivity(): number {
    return this.values.sensitivity;
  }
  set sensitivity(v: number) {
    this.values.sensitivity =
      Math.round(Math.max(SENS_MIN, Math.min(SENS_MAX, v)) * 10) / 10;
    this.save();
    this.notify();
  }

  get unlimitedAmmo(): boolean {
    return this.values.unlimitedAmmo;
  }
  set unlimitedAmmo(v: boolean) {
    this.values.unlimitedAmmo = v;
    this.save();
    this.notify();
  }

  get muzzleFlashFx(): boolean {
    return this.values.muzzleFlashFx;
  }
  set muzzleFlashFx(v: boolean) {
    this.values.muzzleFlashFx = v;
    this.save();
    this.notify();
  }

  onChange(fn: (s: SettingsValues) => void): void {
    this.listeners.push(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.values);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // storage unavailable
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SettingsValues>;
      if (typeof parsed.fov === "number") this.fov = parsed.fov;
      if (typeof parsed.sensitivity === "number")
        this.sensitivity = parsed.sensitivity;
      if (typeof parsed.unlimitedAmmo === "boolean")
        this.unlimitedAmmo = parsed.unlimitedAmmo;
      if (typeof parsed.muzzleFlashFx === "boolean")
        this.muzzleFlashFx = parsed.muzzleFlashFx;
    } catch {
      // corrupt data, keep defaults
    }
  }
}
