import * as THREE from "three";
import { buildArms, buildWeapon, muzzleOffset, poseSupportSleeve, WeaponId } from "./art/weapons";
import { disposeParts } from "./art/geometry";

// First-person weapon rig. Everything here is cosmetic: the sim decides where
// bullets go, this decides how it feels to hold the thing. Bob sells speed,
// sway sells weight, and the recoil kick sells the shot — the view punch that
// actually moves the camera comes from the sim.

// Far enough forward that the stock isn't pressed against the near plane, and
// angled across the view the way a held weapon actually sits.
const BASE = new THREE.Vector3(5.8, -6.5, -17);
const LOWERED = new THREE.Vector3(9.5, -17, -20);
const BASE_ROTATION = new THREE.Euler(-0.02, 0.14, 0.02);

function ease(t: number, start: number, end: number): number {
  const x = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return x * x * (3 - 2 * x);
}

export interface ViewmodelPose {
  speedH: number;
  onGround: boolean;
  tickAlpha: number;
  /** Mouse delta this frame, radians — drives lag/sway. */
  yawDelta: number;
  pitchDelta: number;
}

export class Viewmodel {
  private readonly rig = new THREE.Group();
  private readonly slot = new THREE.Group();
  private readonly flash: THREE.Mesh;
  private readonly flashLight: THREE.PointLight;

  private model: THREE.Group | null = null;
  private arms: THREE.Group | null = null;
  private magazine: THREE.Object3D | undefined;
  private action: THREE.Object3D | undefined;
  private supportHand: THREE.Object3D | undefined;
  private supportSleeve: THREE.Object3D | undefined;
  private readonly magazineBase = new THREE.Vector3();
  private readonly actionBase = new THREE.Vector3();
  private readonly supportBase = new THREE.Vector3();
  private readonly handTarget = new THREE.Vector3();
  private readonly gripTarget = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private weaponId = -1;
  private kick = 0;
  private draw = 0;
  private bobPhase = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private flashTime = 0;
  private reloadDuration = 0;
  private lastReloadTicks = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.rig.add(this.slot);
    this.rig.position.copy(BASE);
    this.rig.scale.setScalar(0.62);
    camera.add(this.rig);

    // Muzzle flash: an emissive quad and a brief light on the weapon and hands.
    const flashMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd88a,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), flashMaterial);
    this.flash.visible = false;
    this.slot.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffc266, 0, 500, 2);
    this.flashLight.visible = false;
    this.slot.add(this.flashLight);
  }

  setWeapon(id: number): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.model) {
      this.slot.remove(this.model);
      disposeParts(this.model);
    }
    if (this.arms) {
      this.rig.remove(this.arms);
      disposeParts(this.arms);
    }
    this.model = buildWeapon(id);
    this.slot.add(this.model);
    this.arms = buildArms(id);
    this.rig.add(this.arms);
    this.magazine = this.model.getObjectByName("magazine");
    this.action = this.model.getObjectByName("action");
    this.supportHand = this.arms.getObjectByName("support_hand");
    this.supportSleeve = this.arms.getObjectByName("support_sleeve");
    if (this.magazine) this.magazineBase.copy(this.magazine.position);
    if (this.action) this.actionBase.copy(this.action.position);
    if (this.supportHand) this.supportBase.copy(this.supportHand.position);

    const muzzle = muzzleOffset(id);
    this.flash.position.set(muzzle[0], muzzle[1], muzzle[2] - 1);
    this.flashLight.position.set(muzzle[0], muzzle[1], muzzle[2] - 2);
    this.reset();
  }

  /** A weapon switch or respawn starts a fresh draw, never a leftover reload. */
  reset(): void {
    this.draw = 1;
    this.kick = this.flashTime = this.reloadDuration = this.lastReloadTicks = 0;
  }

  /** Observe every sim tick so a slow render frame cannot miss reload start. */
  setReloadTicks(ticks: number): void {
    if (ticks > this.lastReloadTicks) this.reloadDuration = ticks;
    if (ticks === 0) this.reloadDuration = 0;
    this.lastReloadTicks = ticks;
  }

  /** Down the scope, or dead: the weapon has no business in the frame. */
  setHidden(hidden: boolean): void {
    this.rig.visible = !hidden;
  }

  onShot(): void {
    this.draw = 0; // an accepted shot means the sim has finished drawing
    this.kick = 1;
    this.flashTime = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    const scale = 0.75 + Math.random() * 0.5;
    this.flash.scale.setScalar(scale);
  }

  /** Match the overlay's screen position when the tracer uses the world FOV. */
  muzzleWorld(out: THREE.Vector3, worldCamera: THREE.PerspectiveCamera): THREE.Vector3 {
    this.flash.getWorldPosition(out);
    this.camera.worldToLocal(out);
    const scale = Math.tan(THREE.MathUtils.degToRad(worldCamera.fov / 2)) /
      Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    out.x *= scale;
    out.y *= scale;
    return worldCamera.localToWorld(out);
  }

  update(dt: number, pose: ViewmodelPose): void {
    this.kick = Math.max(0, this.kick - dt * 8.5);
    this.draw = Math.max(0, this.draw - dt * 4);

    // Flash decay.
    this.flashTime = Math.max(0, this.flashTime - dt);
    const lit = this.flashTime > 0;
    this.flash.visible = lit;
    this.flashLight.visible = lit;
    this.flashLight.intensity = lit ? 2.6 : 0;

    // Bob: phase advances with distance travelled, not time, so it stays
    // locked to footfalls at any speed.
    const speedFactor = Math.min(pose.speedH / 250, 1.2);
    if (pose.onGround && pose.speedH > 10) {
      this.bobPhase += dt * (2.2 + speedFactor * 9);
    }
    const bobX = Math.sin(this.bobPhase) * 0.5 * speedFactor;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * 0.42 * speedFactor;

    // Sway: the weapon lags the view, then eases back.
    this.swayYaw += (-pose.yawDelta * 9 - this.swayYaw) * Math.min(1, dt * 11);
    this.swayPitch += (-pose.pitchDelta * 9 - this.swayPitch) * Math.min(1, dt * 11);
    const swayX = Math.max(-2.5, Math.min(2.5, this.swayYaw));
    const swayY = Math.max(-2.5, Math.min(2.5, this.swayPitch));

    // Normalize the countdown observed from the sim, including frame fractions.
    // Cancellation, switching and the final ammo-transfer tick all return home.
    const phase = this.magazine && this.reloadDuration > 0 ?
      1 - Math.max(0, this.lastReloadTicks - pose.tickAlpha) / this.reloadDuration : 0;
    const reload = ease(phase, 0, 0.16) * (1 - ease(phase, 0.82, 1));
    const extract = ease(phase, 0.18, 0.36) * (1 - ease(phase, 0.48, 0.66));
    const reach = ease(phase, 0.05, 0.18) * (1 - ease(phase, 0.65, 0.72));
    const rackReach = ease(phase, 0.67, 0.73) * (1 - ease(phase, 0.86, 0.95));
    const rack = ease(phase, 0.73, 0.79) * (1 - ease(phase, 0.81, 0.87));
    const pistol = this.weaponId === WeaponId.usp || this.weaponId === WeaponId.glock;
    if (this.magazine) {
      this.magazine.position.copy(this.magazineBase);
      this.magazine.position.x -= extract * 2.5;
      this.magazine.position.y -= extract * (pistol ? 8 : 10);
      this.magazine.position.z += extract * 2;
      this.magazine.rotation.x = extract * (this.weaponId === WeaponId.ak47 ? 0.28 : 0.08);
    }
    if (this.action) {
      this.action.position.copy(this.actionBase);
      this.action.position.z += rack * (pistol ? 1.6 : 2.5);
      this.action.rotation.z = this.weaponId === WeaponId.awp ? rack * 0.8 : 0;
    }
    if (this.supportHand && this.supportSleeve && this.magazine && this.action) {
      const hand = this.handTarget.copy(this.supportBase);
      const grip = this.gripTarget.set(-0.8, pistol ? -3.8 : -3, 0)
        .applyEuler(this.magazine.rotation).add(this.magazine.position);
      hand.lerp(grip, reach);
      grip.copy(this.action.position);
      grip.x -= 1.2; grip.y += 1.2;
      hand.lerp(grip, rackReach);
      hand.y -= this.draw * 2;
      hand.z += this.draw * 2;
      this.supportHand.position.copy(hand);
      this.supportHand.rotation.set(reach * 0.35, 0, -rackReach * 0.25);
      poseSupportSleeve(this.supportSleeve, this.supportHand);
    }

    const target = this.target.copy(BASE);
    if (this.weaponId >= WeaponId.knife && this.weaponId <= WeaponId.glock) {
      // Short weapons need the grip higher in frame to keep both hands visible.
      target.x -= 1.3;
      target.y += 1.4;
      target.z -= 1.5;
    }
    target.lerp(LOWERED, this.draw * this.draw);
    target.x -= reload * (pistol ? 2 : 3.2);
    target.y += reload * 1.4;
    target.z += reload * 0.7;
    const settle = Math.sin((1 - this.draw) * Math.PI) * this.draw;
    this.rig.position.set(
      target.x + bobX + swayX,
      target.y - bobY + swayY - (pose.onGround ? 0 : 0.8),
      target.z + this.kick * 2.2,
    );
    this.rig.rotation.set(
      BASE_ROTATION.x + this.kick * 0.16 + reload * (pistol ? 0.38 : 0.16) + this.draw * 0.4 - settle * 0.15,
      BASE_ROTATION.y + swayX * 0.04 + reload * 0.55,
      BASE_ROTATION.z - swayY * 0.03 - reload * 0.45 +
        this.draw * (this.weaponId === WeaponId.knife ? -1.1 : pistol ? 0.4 : 0.18),
    );
  }
}
