import { DEFAULT_VOLUME, type GameAudio } from "./audio";

// Overlay menu, shown whenever the mouse isn't locked to the game. Escape is
// reserved by the browser for releasing pointer lock, so "lock lost" is the
// only trigger a browser game actually gets — the menu follows that state
// rather than trying to own an Escape key it cannot have.
//
// The sim keeps running behind it: this is a settings/controls panel, not a
// pause.

const VOLUME_KEY = "cs-web.volume";

function loadVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_KEY);
    if (stored === null) return DEFAULT_VOLUME;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME;
  } catch {
    // Private browsing / disabled storage — the default is fine.
    return DEFAULT_VOLUME;
  }
}

function saveVolume(value: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Not worth surfacing; the setting just won't persist.
  }
}

export class Menu {
  private readonly root = document.getElementById("menu")!;
  private readonly resume = document.getElementById("menu-resume")!;
  private readonly slider = document.getElementById("menu-volume") as HTMLInputElement;
  private readonly readout = document.getElementById("menu-volume-value")!;
  private readonly hint = document.getElementById("menu-hint")!;
  private readonly subtitle = document.getElementById("menu-map")!;

  private started = false;

  constructor(private readonly audio: GameAudio, onResume: () => void) {
    const volume = loadVolume();
    this.audio.setVolume(volume);
    this.slider.value = String(Math.round(volume * 100));
    this.renderVolume(volume);

    this.slider.addEventListener("input", () => {
      const value = Number(this.slider.value) / 100;
      this.audio.setVolume(value);
      this.renderVolume(value);
    });
    // Persist on release rather than per-pixel of drag.
    for (const event of ["change", "pointerup"] as const) {
      this.slider.addEventListener(event, () => saveVolume(this.audio.getVolume()));
    }

    this.resume.addEventListener("click", onResume);
    // Clicking the backdrop resumes too, but not clicks inside the panel.
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) onResume();
    });
  }

  private renderVolume(value: number): void {
    this.readout.textContent = `${Math.round(value * 100)}%`;
  }

  setMap(name: string): void {
    this.subtitle.textContent = name.toUpperCase();
    document.title = `cs-web — ${name}`;
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
    if (visible) {
      this.resume.textContent = this.started ? "RESUME" : "PLAY";
      this.hint.textContent = this.started
        ? "ESC returns here"
        : "click anywhere to lock the mouse";
    } else {
      this.started = true;
    }
  }
}
