import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createRoom } from "./room";
import { Player } from "./player";
import { InputManager } from "./input";
import { Weapon } from "./weapon";
import { TargetManager } from "./targets";
import { HUD } from "./hud";
import { AudioManager } from "./audio";
import { Settings } from "./settings";
import { EscapeMenu } from "./menu";
import { ResetBoard } from "./resetboard";
import {
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
} from "./constants";

export class Game {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  input: InputManager;
  player: Player;
  weapon: Weapon;
  targets: TargetManager;
  hud: HUD;
  audio: AudioManager;
  settings: Settings;
  menu: EscapeMenu;
  resetBoard: ResetBoard;

  private composer: EffectComposer;
  private timer = new THREE.Timer();
  private running = false;

  constructor() {
    this.settings = new Settings();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);

    this.camera = new THREE.PerspectiveCamera(
      this.settings.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(this.renderer.domElement);

    // Post-processing: bloom for muzzle flash FX
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(window.devicePixelRatio);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD
      )
    );
    this.composer.addPass(new OutputPass());

    this.input = new InputManager();
    this.audio = new AudioManager();
    this.hud = new HUD();
    this.player = new Player(this.camera, this.input, this.renderer.domElement, this.settings);
    this.weapon = new Weapon(this.camera, this.settings);
    this.targets = new TargetManager(this.scene);
    this.menu = new EscapeMenu(this.settings);
    this.resetBoard = new ResetBoard(this.scene);

    this.scene.add(this.camera);
    createRoom(this.scene);

    // Apply settings changes live
    this.settings.onChange((s) => {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    });

    const overlay = document.getElementById("overlay")!;
    const canvas = this.renderer.domElement;

    const requestPointerLockSafely = (): void => {
      try {
        // Handle browsers that return either void or a promise from requestPointerLock.
        void Promise.resolve(canvas.requestPointerLock()).catch(() => {
          overlay.style.display = "flex";
        });
      } catch {
        overlay.style.display = "flex";
      }
    };

    // Click overlay or Resume button → request pointer lock (click = valid gesture)
    overlay.addEventListener("click", requestPointerLockSafely);

    // Resume button: request pointer lock directly (click gesture is valid)
    this.menu.onClose(requestPointerLockSafely);

    // Escape key: exit pointer lock (shows menu), or close menu (shows overlay)
    document.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        e.preventDefault();
        if (this.menu.isOpen) {
          this.menu.closeWithoutResume();
          overlay.style.display = "flex";
        } else if (document.pointerLockElement === canvas) {
          document.exitPointerLock();
        }
      }
    });

    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === canvas;
      this.input.setPointerLocked(locked);

      if (locked) {
        overlay.style.display = "none";
        if (this.menu.isOpen) this.menu.closeWithoutResume();
        this.hud.setVisible(true);
        this.audio.resume();
      } else {
        this.hud.setVisible(false);
        this.input.reset();
        this.menu.open();
        overlay.style.display = "none";
      }
    });

    window.addEventListener("blur", () => {
      this.input.reset();
    });

    window.addEventListener("resize", () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.composer.setSize(w, h);
    });
  }

  start(): void {
    this.running = true;
    this.loop();
  }

  private loop = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);

    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const locked = document.pointerLockElement === this.renderer.domElement;

    if (locked) {
      this.player.update(dt);

      // Shooting
      if (this.input.mouseDown && this.weapon.canShoot()) {
        this.weapon.shoot();
        this.audio.playGunshot();

        // Check reset board first (doesn't count as a shot for accuracy)
        if (this.resetBoard.checkHit(this.camera)) {
          this.hud.resetStats();
          this.weapon.resetAmmo();
        } else {
          const hit = this.targets.checkHit(this.camera);
          this.hud.recordShot(hit);
          if (hit) {
            this.audio.playHitSound();
            this.hud.showHitmarker();
          }
        }
      }

      // Reload
      if (this.input.keys.has("KeyR")) {
        this.weapon.startReload();
      }

      this.weapon.update(dt, this.player.isMoving());
      this.hud.updateAmmo(this.weapon.ammo, this.weapon.reserveAmmo);
      this.hud.updateReloadMsg(this.weapon.isReloading, this.weapon.ammo === 0);
      this.hud.update(dt);
    }

    this.targets.update(dt);

    if (this.settings.muzzleFlashFx) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };
}
