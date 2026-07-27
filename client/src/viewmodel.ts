import * as THREE from "three";
import { buildArms, buildWeapon, muzzleOffset } from "./art/weapons";

// First-person weapon rig. Everything here is cosmetic: the sim decides where
// bullets go, this decides how it feels to hold the thing. Bob sells speed,
// sway sells weight, and the recoil kick sells the shot — the view punch that
// actually moves the camera comes from the sim.

// Far enough forward that the stock isn't pressed against the near plane, and
// angled across the view the way a held weapon actually sits.
const BASE = new THREE.Vector3(7.4, -7.2, -22);
const LOWERED = new THREE.Vector3(9.5, -17, -20);
const BASE_ROTATION = new THREE.Euler(-0.02, 0.14, 0.02);

export interface ViewmodelPose {
  speedH: number;
  onGround: boolean;
  reloading: boolean;
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
  private weaponId = -1;
  private kick = 0;
  private draw = 0;
  private bobPhase = 0;
  private swayYaw = 0;
  private swayPitch = 0;
  private flashTime = 0;
  private reloadTime = 0;

  constructor(camera: THREE.Camera) {
    this.rig.add(this.slot);
    this.rig.add(buildArms());
    this.rig.position.copy(BASE);
    this.rig.scale.setScalar(0.55);
    camera.add(this.rig);

    // Muzzle flash: a crossed pair of emissive quads plus a real light, which
    // is what makes it read on the surrounding geometry.
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
      this.model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    }
    this.model = buildWeapon(id);
    this.slot.add(this.model);

    const muzzle = muzzleOffset(id);
    this.flash.position.set(muzzle[0], muzzle[1], muzzle[2] - 1);
    this.flashLight.position.set(muzzle[0], muzzle[1], muzzle[2] - 2);
    this.draw = 1; // play the raise
  }

  /** Down the scope, or dead: the weapon has no business in the frame. */
  setHidden(hidden: boolean): void {
    this.rig.visible = !hidden;
  }

  onShot(): void {
    this.kick = 1;
    this.flashTime = 0.045;
    this.flash.rotation.z = Math.random() * Math.PI;
    const scale = 0.75 + Math.random() * 0.5;
    this.flash.scale.setScalar(scale);
  }

  /** Muzzle position in world space, for tracer origins. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.flash.getWorldPosition(out);
  }

  update(dt: number, pose: ViewmodelPose): void {
    this.kick = Math.max(0, this.kick - dt * 8.5);
    this.draw = Math.max(0, this.draw - dt * 3.2);

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

    // Reload: dip the weapon out of view and roll it over.
    this.reloadTime += (Number(pose.reloading) - this.reloadTime) * Math.min(1, dt * 7);
    const reload = this.reloadTime;

    const target = new THREE.Vector3().copy(BASE).lerp(LOWERED, Math.max(reload, this.draw));
    this.rig.position.set(
      target.x + bobX + swayX,
      target.y - bobY + swayY - (pose.onGround ? 0 : 0.8),
      target.z + this.kick * 2.2,
    );
    this.rig.rotation.set(
      BASE_ROTATION.x + this.kick * 0.16 + reload * 0.5 + this.draw * 0.4,
      BASE_ROTATION.y + swayX * 0.04 - reload * 0.35,
      BASE_ROTATION.z - swayY * 0.03 + reload * 0.45,
    );
  }
}
