import * as THREE from "three";
import { Settings } from "./settings";
import {
  FIRE_RATE,
  MAG_SIZE,
  RELOAD_TIME,
  RECOIL_AMOUNT,
  RECOIL_RECOVERY,
  MUZZLE_FLASH_PEAK_INTENSITY,
  MUZZLE_FLASH_DECAY_RATE,
  MUZZLE_FLASH_DURATION,
  MUZZLE_FLASH_LIGHT_DISTANCE,
  MUZZLE_FLASH_LIGHT_DECAY,
} from "./constants";

export class Weapon {
  ammo = MAG_SIZE;
  reserveAmmo = 90;
  isReloading = false;

  private camera: THREE.PerspectiveCamera;
  private settings: Settings;
  private model: THREE.Group;
  private fireTimer = 0;
  private reloadTimer = 0;
  private recoilOffset = 0;
  private bobPhase = 0;
  private muzzleFlash: THREE.PointLight;
  private muzzleSprite: THREE.Sprite;
  private muzzleTimer = 0;

  // Base position of the viewmodel
  private basePos = new THREE.Vector3(0.36, -0.33, -0.62);

  constructor(camera: THREE.PerspectiveCamera, settings: Settings) {
    this.camera = camera;
    this.settings = settings;
    this.model = this.buildModel();
    this.model.position.copy(this.basePos);
    camera.add(this.model);

    // Muzzle flash light
    this.muzzleFlash = new THREE.PointLight(0xffaa00, 0, MUZZLE_FLASH_LIGHT_DISTANCE, MUZZLE_FLASH_LIGHT_DECAY);
    this.muzzleFlash.position.set(0, 0.035, -0.75);
    this.model.add(this.muzzleFlash);

    // Muzzle flash sprite (additive billboard)
    const flashMat = new THREE.SpriteMaterial({
      map: Weapon.createFlashTexture(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      color: 0xffcc44,
    });
    this.muzzleSprite = new THREE.Sprite(flashMat);
    this.muzzleSprite.scale.set(0.35, 0.35, 1);
    this.muzzleSprite.position.copy(this.muzzleFlash.position);
    this.muzzleSprite.visible = false;
    this.model.add(this.muzzleSprite);
  }

  private static createFlashTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    );
    g.addColorStop(0, "rgba(255,255,200,1)");
    g.addColorStop(0.3, "rgba(255,180,50,0.8)");
    g.addColorStop(0.7, "rgba(255,100,0,0.3)");
    g.addColorStop(1, "rgba(255,50,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  private buildModel(): THREE.Group {
    const group = new THREE.Group();

    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a1f });
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x4a2810 });

    // === RECEIVER (main body) ===
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.058, 0.32),
      metal
    );
    receiver.position.set(0, -0.002, -0.05);
    group.add(receiver);

    // Dust cover (top of receiver, slightly raised)
    const dustCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.012, 0.25),
      metalDark
    );
    dustCover.position.set(0, 0.033, -0.07);
    group.add(dustCover);

    // === BARREL ===
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8),
      metal
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.035, -0.48);
    group.add(barrel);

    // Muzzle brake (thicker end of barrel)
    const muzzleBrake = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.015, 0.06, 8),
      metalDark
    );
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.rotation.z = 0.2;
    muzzleBrake.position.set(0, 0.035, -0.72);
    group.add(muzzleBrake);

    // === GAS TUBE (above barrel, AK signature) ===
    const gasTube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.22, 6),
      metal
    );
    gasTube.rotation.x = Math.PI / 2;
    gasTube.position.set(0, 0.06, -0.38);
    group.add(gasTube);

    // Gas block (where gas tube meets barrel)
    const gasBlock = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.04, 0.025),
      metal
    );
    gasBlock.position.set(0, 0.045, -0.49);
    group.add(gasBlock);

    // === FRONT SIGHT POST ===
    const frontSightBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.05, 0.02),
      metal
    );
    frontSightBase.position.set(0, 0.06, -0.62);
    group.add(frontSightBase);

    const frontSightPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.035, 0.004),
      metal
    );
    frontSightPost.position.set(0, 0.09, -0.62);
    group.add(frontSightPost);

    const frontSightEarL = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.022, 0.008),
      metalDark
    );
    frontSightEarL.position.set(-0.012, 0.078, -0.62);
    group.add(frontSightEarL);

    const frontSightEarR = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.022, 0.008),
      metalDark
    );
    frontSightEarR.position.set(0.012, 0.078, -0.62);
    group.add(frontSightEarR);

    // === REAR SIGHT BLOCK ===
    const rearSight = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.025, 0.03),
      metal
    );
    rearSight.position.set(0, 0.05, -0.18);
    group.add(rearSight);

    // === WOODEN HANDGUARD (wraps around gas tube, flush with receiver) ===
    const handguard = new THREE.Mesh(
      new THREE.BoxGeometry(0.056, 0.045, 0.22),
      wood
    );
    handguard.position.set(0, 0.008, -0.32);
    group.add(handguard);

    // Upper handguard (sits on top, flush with lower)
    const upperHandguard = new THREE.Mesh(
      new THREE.BoxGeometry(0.048, 0.025, 0.2),
      wood
    );
    upperHandguard.position.set(0, 0.051, -0.29);
    group.add(upperHandguard);

    // === MAGAZINE (curved banana mag) ===
    // Four overlapping sections for a more pronounced AK curve
    const magTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.06, 0.052),
      metalDark
    );
    magTop.position.set(0, -0.065, -0.072);
    magTop.rotation.x = 0.08;
    group.add(magTop);

    const magMidA = new THREE.Mesh(
      new THREE.BoxGeometry(0.036, 0.058, 0.05),
      metalDark
    );
    magMidA.position.set(0, -0.118, -0.088);
    magMidA.rotation.x = 0.24;
    group.add(magMidA);

    const magMidB = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.054, 0.048),
      metalDark
    );
    magMidB.position.set(0, -0.165, -0.108);
    magMidB.rotation.x = 0.4;
    group.add(magMidB);

    const magBottom = new THREE.Mesh(
      new THREE.BoxGeometry(0.033, 0.05, 0.045),
      metalDark
    );
    magBottom.position.set(0, -0.206, -0.14);
    magBottom.rotation.x = 0.58;
    group.add(magBottom);

    // === PISTOL GRIP ===
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.1, 0.04),
      woodDark
    );
    grip.position.set(0, -0.08, 0.06);
    grip.rotation.x = -0.25;
    group.add(grip);

    // Grip base (wider at bottom)
    const gripBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.02, 0.045),
      woodDark
    );
    gripBase.position.set(0, -0.13, 0.045);
    gripBase.rotation.x = -0.25;
    group.add(gripBase);

    // === STOCK ===
    // Stock tang (overlaps into receiver for seamless join)
    const stockTang = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.044, 0.12),
      wood
    );
    stockTang.position.set(0, -0.01, 0.14);
    stockTang.rotation.x = 0.05;
    group.add(stockTang);

    // Stock body (tapers down like AK, overlaps tang)
    const stockBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.048, 0.2),
      wood
    );
    stockBody.position.set(0, -0.027, 0.28);
    stockBody.rotation.x = 0.08;
    group.add(stockBody);

    // Stock butt plate
    const buttPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.052, 0.01),
      metalDark
    );
    buttPlate.position.set(0, -0.04, 0.39);
    buttPlate.rotation.x = 0.08;
    group.add(buttPlate);

    // === TRIGGER GUARD ===
    const triggerGuard = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.025, 0.06),
      metal
    );
    triggerGuard.position.set(0, -0.045, 0.02);
    group.add(triggerGuard);

    // Trigger
    const trigger = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.02, 0.008),
      metal
    );
    trigger.position.set(0, -0.035, 0.015);
    trigger.rotation.x = -0.3;
    group.add(trigger);

    // === SELECTOR LEVER (right side, AK signature) ===
    const selector = new THREE.Mesh(
      new THREE.BoxGeometry(0.002, 0.012, 0.04),
      metal
    );
    selector.position.set(0.03, 0.01, 0.03);
    selector.rotation.x = -0.5;
    group.add(selector);

    return group;
  }

  canShoot(): boolean {
    if (this.settings.unlimitedAmmo) {
      return this.fireTimer <= 0 && !this.isReloading;
    }
    return this.fireTimer <= 0 && this.ammo > 0 && !this.isReloading;
  }

  shoot(): void {
    if (!this.settings.unlimitedAmmo) this.ammo--;
    this.fireTimer = FIRE_RATE;
    this.recoilOffset += RECOIL_AMOUNT;

    // Muzzle flash
    this.muzzleFlash.intensity = MUZZLE_FLASH_PEAK_INTENSITY;
    this.muzzleTimer = MUZZLE_FLASH_DURATION;
    this.muzzleSprite.visible = true;
    this.muzzleSprite.material.rotation = Math.random() * Math.PI * 2;
    (this.muzzleSprite.material as THREE.SpriteMaterial).opacity = 1;
  }

  resetAmmo(): void {
    this.ammo = MAG_SIZE;
    this.reserveAmmo = 90;
    this.isReloading = false;
    this.reloadTimer = 0;
  }

  startReload(): void {
    if (this.isReloading || this.ammo === MAG_SIZE || this.reserveAmmo <= 0)
      return;
    this.isReloading = true;
    this.reloadTimer = RELOAD_TIME;
  }

  update(dt: number, moving: boolean): void {
    // Fire cooldown
    if (this.fireTimer > 0) this.fireTimer -= dt;

    // Reload
    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const needed = MAG_SIZE - this.ammo;
        const loaded = Math.min(needed, this.reserveAmmo);
        this.ammo += loaded;
        this.reserveAmmo -= loaded;
        this.isReloading = false;
      }
    }

    // Recoil recovery
    if (this.recoilOffset > 0) {
      this.recoilOffset -= RECOIL_RECOVERY * dt;
      if (this.recoilOffset < 0) this.recoilOffset = 0;
    }

    // Muzzle flash decay (smooth exponential)
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      const elapsed = MUZZLE_FLASH_DURATION - this.muzzleTimer;
      const factor = Math.exp(-MUZZLE_FLASH_DECAY_RATE * elapsed);
      this.muzzleFlash.intensity = MUZZLE_FLASH_PEAK_INTENSITY * factor;
      (this.muzzleSprite.material as THREE.SpriteMaterial).opacity = factor;
      if (this.muzzleTimer <= 0) {
        this.muzzleFlash.intensity = 0;
        this.muzzleSprite.visible = false;
      }
    }

    // Weapon bob
    if (moving) {
      this.bobPhase += dt * 10;
    } else {
      this.bobPhase = 0;
    }
    const bobX = moving ? Math.sin(this.bobPhase) * 0.01 : 0;
    const bobY = moving ? Math.sin(this.bobPhase * 2) * 0.008 : 0;

    // Apply recoil + bob to position
    this.model.position.set(
      this.basePos.x + bobX,
      this.basePos.y + bobY,
      this.basePos.z + this.recoilOffset * 0.5
    );
    this.model.rotation.x = -this.recoilOffset;

    // Reload animation — lower the gun
    if (this.isReloading) {
      const t = 1 - this.reloadTimer / RELOAD_TIME;
      const dip = Math.sin(t * Math.PI) * 0.15;
      this.model.position.y -= dip;
    }
  }
}
