import { Flags, Mode, ShotResult, Team, TICK_SECONDS, type Snapshot } from "./sim";

const WEAPON_NAMES: Record<number, string> = {
  1: "KNIFE", 2: "USP", 3: "GLOCK", 4: "AK-47", 5: "M4A1", 6: "AWP", 7: "MP5",
};

/** Mirrors the inaccuracy model in sim/src/weapons.cpp so the gap tells truth. */
const CROSSHAIR_MIN = 4;
const CROSSHAIR_MAX = 44;

const KILLFEED_MAX = 5;
const KILLFEED_SECONDS = 6;

interface FeedEntry {
  el: HTMLElement;
  ttl: number;
}

function playerName(index: number, localIndex: number): string {
  return index === localIndex ? "YOU" : `BOT ${index}`;
}

export class Hud {
  private readonly ammo = document.getElementById("ammo")!;
  private readonly health = document.getElementById("health")!;
  private readonly speed = document.getElementById("speed")!;
  private readonly score = document.getElementById("score")!;
  private readonly status = document.getElementById("status")!;
  private readonly hitmarker = document.getElementById("hitmarker")!;
  private readonly crosshair = document.getElementById("crosshair")!;
  private readonly coords = document.getElementById("coords")!;
  private readonly scope = document.getElementById("scope")!;
  private readonly killfeed = document.getElementById("killfeed")!;
  private readonly respawn = document.getElementById("respawn")!;

  private hitmarkerTtl = 0;
  private gap = CROSSHAIR_MIN;
  private feed: FeedEntry[] = [];
  private lastAmmoText = "";
  private lastHealthText = "";
  private lastScoreText = "";
  private lastSpeedText = "";
  private lastZoom = -1;

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

  /** One killfeed line. Anything involving you is highlighted. */
  onDeath(actor: number, victim: number, weapon: number, localIndex: number): void {
    const el = document.createElement("div");
    const involved = actor === localIndex || victim === localIndex;
    if (involved) el.classList.add("self");
    const gun = WEAPON_NAMES[weapon] ?? "?";
    el.innerHTML =
      `${playerName(actor, localIndex)} <span class="weapon">[${gun}]</span> ` +
      `${playerName(victim, localIndex)}`;
    this.killfeed.appendChild(el);
    this.feed.push({ el, ttl: KILLFEED_SECONDS });
    while (this.feed.length > KILLFEED_MAX) this.retireFeed(this.feed.shift()!);
  }

  private retireFeed(entry: FeedEntry): void {
    entry.el.remove();
  }

  update(snapshot: Snapshot, dt: number): void {
    const alive = (snapshot.flags & Flags.alive) !== 0;

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

    const healthValue = Math.max(0, Math.ceil(snapshot.health));
    const healthText = String(healthValue);
    if (healthText !== this.lastHealthText) {
      this.health.textContent = healthText;
      this.health.classList.toggle("hurt", healthValue <= 60 && healthValue > 25);
      this.health.classList.toggle("critical", healthValue <= 25);
      this.lastHealthText = healthText;
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
    const teams = snapshot.mode === Mode.team
      ? `<span class="ct">CT ${snapshot.teamScore[Team.ct]}</span>` +
        `&nbsp;&nbsp;<span class="t">T ${snapshot.teamScore[Team.t]}</span><br>`
      : "";
    const scoreText =
      `${teams}${snapshot.kills} K / ${snapshot.deaths} D&nbsp;&nbsp;ACC ${accuracy}%`;
    if (scoreText !== this.lastScoreText) {
      this.score.innerHTML = scoreText;
      this.lastScoreText = scoreText;
    }

    // Scoped: the reticle is the scope's own hairlines, so the dynamic
    // crosshair would just be a second, wrong one on top of it.
    if (snapshot.zoom !== this.lastZoom) {
      this.scope.classList.toggle("hidden", snapshot.zoom === 0);
      this.crosshair.style.display = snapshot.zoom === 0 ? "" : "none";
      this.lastZoom = snapshot.zoom;
    }

    this.respawn.classList.toggle("hidden", alive);
    if (!alive) {
      const seconds = Math.max(0, snapshot.respawnTicks * TICK_SECONDS);
      this.respawn.textContent = `RESPAWNING IN ${seconds.toFixed(1)}`;
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

    this.feed = this.feed.filter((entry) => {
      entry.ttl -= dt;
      if (entry.ttl > 0) return true;
      this.retireFeed(entry);
      return false;
    });
  }
}
