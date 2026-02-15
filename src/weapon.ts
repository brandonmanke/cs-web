import * as THREE from "three";
import {
  FIRE_RATE,
  MAG_SIZE,
  RELOAD_TIME,
  RECOIL_AMOUNT,
  RECOIL_RECOVERY,
} from "./constants";

export class Weapon {
  ammo = MAG_SIZE;
  reserveAmmo = 90;
  isReloading = false;

  private camera: THREE.PerspectiveCamera;
  private model: THREE.Group;
  private fireTimer = 0;
  private reloadTimer = 0;
  private recoilOffset = 0;
  private bobPhase = 0;
  private muzzleFlash: THREE.PointLight;
  private muzzleTimer = 0;

  // Base position of the viewmodel
  private basePos = new THREE.Vector3(0.3, -0.3, -0.6);

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.model = this.buildModel();
    this.model.position.copy(this.basePos);
    camera.add(this.model);

    // Muzzle flash light
    this.muzzleFlash = new THREE.PointLight(0xffaa00, 0, 3);
    this.muzzleFlash.position.set(0, 0.05, -0.5);
    this.model.add(this.muzzleFlash);
  }

  private buildModel(): THREE.Group {
    const group = new THREE.Group();
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x664422 });

    // Body (receiver)
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.08, 0.45),
      gunMat
    );
    body.position.set(0, 0, -0.1);
    group.add(body);

    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8),
      gunMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.04, -0.45);
    group.add(barrel);

    // Magazine
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.15, 0.08),
      gunMat
    );
    mag.position.set(0, -0.1, -0.08);
    mag.rotation.x = -0.15;
    group.add(mag);

    // Stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.06, 0.2),
      woodMat
    );
    stock.position.set(0, -0.01, 0.2);
    group.add(stock);

    // Grip
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.1, 0.04),
      woodMat
    );
    grip.position.set(0, -0.09, 0.05);
    grip.rotation.x = -0.3;
    group.add(grip);

    return group;
  }

  canShoot(): boolean {
    return this.fireTimer <= 0 && this.ammo > 0 && !this.isReloading;
  }

  shoot(): void {
    this.ammo--;
    this.fireTimer = FIRE_RATE;
    this.recoilOffset += RECOIL_AMOUNT;

    // Muzzle flash
    this.muzzleFlash.intensity = 2;
    this.muzzleTimer = 0.04;
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

    // Muzzle flash decay
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzleFlash.intensity = 0;
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
