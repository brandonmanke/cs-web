import * as THREE from "three";
import { createRoom } from "./room";
import { Player } from "./player";
import { InputManager } from "./input";
import { Weapon } from "./weapon";
import { TargetManager } from "./targets";
import { HUD } from "./hud";
import { AudioManager } from "./audio";

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

  private timer = new THREE.Timer();
  private running = false;

  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(this.renderer.domElement);

    this.input = new InputManager();
    this.audio = new AudioManager();
    this.hud = new HUD();
    this.player = new Player(this.camera, this.input, this.renderer.domElement);
    this.weapon = new Weapon(this.camera);
    this.targets = new TargetManager(this.scene);

    this.scene.add(this.camera);
    createRoom(this.scene);

    // Pointer lock overlay
    const overlay = document.getElementById("overlay")!;
    overlay.addEventListener("click", () => {
      this.renderer.domElement.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      this.input.setPointerLocked(locked);
      overlay.style.display = locked ? "none" : "flex";
      this.hud.setVisible(locked);
      if (locked) this.audio.resume();
      if (!locked) this.input.reset();
    });

    window.addEventListener("blur", () => {
      this.input.reset();
    });

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
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
        const hit = this.targets.checkHit(this.camera);
        if (hit) {
          this.hud.addScore();
          this.audio.playHitSound();
          this.hud.showHitmarker();
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
    this.renderer.render(this.scene, this.camera);
  };
}
