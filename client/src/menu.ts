import { DEFAULT_VOLUME, type GameAudio } from "./audio";

// Overlay menu, shown whenever the mouse isn't locked to the game. Escape is
// reserved by the browser for releasing pointer lock, so "lock lost" is the
// only trigger a browser game actually gets — the menu follows that state
// rather than trying to own an Escape key it cannot have.
//
// The sim keeps running behind it: this is a settings/controls panel, not a
// pause.

const VOLUME_KEY = "cs-web.volume";
const BOTS_KEY = "cs-web.bots";
const SKILL_KEY = "cs-web.skill";

/**
 * Bands over the sim's continuous 0..2 skill. The number rides alongside the
 * name because it is exactly what `?skill=` takes, and because a five-band name
 * alone can't tell 1.25 from 1.55 — which, in aim error and reaction time, is a
 * difference you feel.
 */
const SKILL_BANDS: Array<[number, string]> = [
  [0.4, "EASY"], [0.8, "FAIR"], [1.2, "NORMAL"], [1.6, "TOUGH"], [Infinity, "EXPERT"],
];

/** The bottom of the slider is its own thing, not the bottom of the ramp. */
export const PASSIVE_SKILL = 0;

function skillName(skill: number): string {
  if (skill <= PASSIVE_SKILL) return "PASSIVE";
  return SKILL_BANDS.find(([upper]) => skill < upper)?.[1] ?? "NORMAL";
}

/** A stored number, clamped, or null when absent/unreadable. */
export function loadSetting(key: string, min: number, max: number): number | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return null;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
  } catch {
    // Private browsing / disabled storage.
    return null;
  }
}

function saveSetting(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Not worth surfacing; the setting just won't persist.
  }
}

/** Preference keys main.ts seeds the menu from. */
export const Settings = { bots: BOTS_KEY, skill: SKILL_KEY } as const;

export interface Roster {
  bots: number;
  skill: number;
}

export class Menu {
  private readonly root = document.getElementById("menu")!;
  private readonly resume = document.getElementById("menu-resume")!;
  private readonly slider = document.getElementById("menu-volume") as HTMLInputElement;
  private readonly readout = document.getElementById("menu-volume-value")!;
  private readonly hint = document.getElementById("menu-hint")!;
  private readonly subtitle = document.getElementById("menu-map")!;
  private readonly maps = document.getElementById("menu-maps")!;
  private readonly bots = document.getElementById("menu-bots") as HTMLInputElement;
  private readonly botsValue = document.getElementById("menu-bots-value")!;
  private readonly skill = document.getElementById("menu-skill") as HTMLInputElement;
  private readonly skillValue = document.getElementById("menu-skill-value")!;

  private started = false;

  constructor(
    private readonly audio: GameAudio,
    private readonly requestLock: (onGaveUp: () => void) => void,
    /** Fired when the roster changes; the caller restarts the match. */
    private readonly onRoster: (roster: Roster) => void,
  ) {
    const volume = loadSetting(VOLUME_KEY, 0, 1) ?? DEFAULT_VOLUME;
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
      this.slider.addEventListener(event, () => saveSetting(VOLUME_KEY, this.audio.getVolume()));
    }

    // Restarting a match on every pixel of a drag would be silly, so the labels
    // track "input" and the actual restart waits for "change".
    for (const input of [this.bots, this.skill]) {
      input.addEventListener("input", () => this.renderRoster());
      input.addEventListener("change", () => {
        const roster = this.roster();
        saveSetting(BOTS_KEY, roster.bots);
        saveSetting(SKILL_KEY, roster.skill);
        this.onRoster(roster);
      });
    }

    this.resume.addEventListener("click", () => this.dismiss());
    // Anywhere outside the panel dismisses; clicks inside it do not.
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.dismiss();
    });
  }

  /**
   * Hide first, then chase the lock. The browser's post-Escape cooldown means
   * the request often can't succeed for up to a second, and waiting for
   * pointerlockchange to hide the menu makes that latency look like a dead
   * click. If the lock never lands, the menu comes back.
   */
  private dismiss(): void {
    this.setVisible(false);
    this.requestLock(() => this.setVisible(true));
  }

  private renderVolume(value: number): void {
    this.readout.textContent = `${Math.round(value * 100)}%`;
  }

  private roster(): Roster {
    return { bots: Number(this.bots.value), skill: Number(this.skill.value) };
  }

  private renderRoster(): void {
    const { bots, skill } = this.roster();
    this.botsValue.textContent = bots === 0 ? "OFF" : String(bots);
    this.skillValue.textContent = `${skillName(skill)} ${skill.toFixed(1)}`;
  }

  /** Seed the controls without firing a restart. */
  setRoster(roster: Roster): void {
    this.bots.value = String(roster.bots);
    this.skill.value = String(roster.skill);
    this.renderRoster();
  }

  setMap(name: string, detail: string): void {
    this.subtitle.textContent = `${name.toUpperCase()} · ${detail}`;
    document.title = `cs-web — ${name}`;
  }

  /**
   * Switching maps rebuilds the world and re-bakes its lighting, both of which
   * happen at boot — so these are links that reload rather than in-place
   * swaps. Cheap, and it keeps map loading a single code path.
   */
  setMapList(names: readonly string[], current: string): void {
    this.maps.replaceChildren(...names.map((name) => {
      const link = document.createElement("a");
      link.href = `?map=${encodeURIComponent(name)}`;
      link.textContent = name;
      if (name === current) link.classList.add("active");
      return link;
    }));
  }

  setVisible(visible: boolean): void {
    if (visible) {
      this.resume.textContent = this.started ? "RESUME" : "PLAY";
      this.hint.textContent = this.started
        ? "ESC returns here"
        : "click anywhere to lock the mouse";
    }
    this.root.classList.toggle("hidden", !visible);
  }

  /**
   * Called once the mouse is actually locked. Hiding the menu optimistically is
   * not the same as having started — if the lock is refused and the menu comes
   * back, it should still say PLAY.
   */
  markStarted(): void {
    this.started = true;
  }
}
