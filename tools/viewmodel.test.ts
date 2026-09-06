import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Viewmodel, type ViewmodelPose } from "../client/src/viewmodel";
import { Buttons, Sim, Snapshot } from "../client/src/sim";

Object.assign(globalThis, { document: {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    fillRect() {}, beginPath() {}, moveTo() {}, arc() {}, fill() {}, stroke() {},
    bezierCurveTo() {}, save() {}, restore() {}, putImageData() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  }) }),
} });

const still: ViewmodelPose = { speedH: 0, onGround: true, tickAlpha: 0, yawDelta: 0, pitchDelta: 0 };
function create(id: number) {
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100);
  const view = new Viewmodel(camera);
  view.setWeapon(id);
  view.update(1, still);
  return { camera, view };
}

for (const id of [2, 3, 4, 5, 6, 7]) {
  test(`weapon ${id}: magazine, hand and sleeve stay connected through reload and cancellation`, () => {
    const { camera, view } = create(id);
    const mag = camera.getObjectByName("magazine")!;
    const action = camera.getObjectByName("action")!;
    const hand = camera.getObjectByName("support_hand")!;
    const sleeve = camera.getObjectByName("support_sleeve")!;
    const magHome = mag.position.clone(), handHome = hand.position.clone(), actionHome = action.position.clone();
    view.setReloadTicks(200);
    for (let remaining = 200; remaining > 0; --remaining) {
      view.setReloadTicks(remaining);
      view.update(1 / 64, still);
      camera.updateMatrixWorld(true);
      const wrist = hand.localToWorld(new THREE.Vector3(-1, -1.8, 1.4));
      const cuff = sleeve.localToWorld(new THREE.Vector3(0, 0.5, 0));
      assert.ok(wrist.distanceTo(cuff) < 1e-5, `sleeve detached at ${remaining}`);
      if (remaining === 120) {
        assert.ok(mag.position.y < magHome.y - 7, "magazine must visibly leave the gun");
        assert.ok(hand.position.distanceTo(handHome) > 5, "support hand must follow the magazine");
      }
      if (remaining === 42) assert.ok(action.position.z > actionHome.z + 1, "slide/bolt must rack");
    }
    view.setReloadTicks(0);
    view.update(0, still);
    assert.ok(mag.position.distanceTo(magHome) < 1e-6);
    assert.ok(hand.position.distanceTo(handHome) < 1e-6);
    assert.ok(action.position.distanceTo(actionHome) < 1e-6);

    view.setReloadTicks(200);
    view.setReloadTicks(120);
    view.update(0, still);
    const held = mag.position.clone();
    view.update(0.5, still);
    assert.ok(mag.position.distanceTo(held) < 1e-6, "render time must not advance a paused sim reload");
    view.setReloadTicks(0); // cancelled reload, same weapon
    view.update(0, still);
    assert.ok(mag.position.distanceTo(magHome) < 1e-6);
    view.setWeapon(1);
    assert.equal(camera.getObjectByName("magazine"), undefined, "switch must remove old animated parts");
  });
}

test("a respawn clears reload state and each draw settles at the ready pose", () => {
  const { camera, view } = create(4);
  const home = camera.getObjectByName("magazine")!.position.clone();
  view.setReloadTicks(160);
  view.setReloadTicks(80);
  view.update(0, still);
  view.reset();
  view.update(0.25, still);
  assert.ok(camera.getObjectByName("magazine")!.position.distanceTo(home) < 1e-6);
  for (const weapon of [1, 2, 4, 5, 6, 7]) {
    const sample = create(weapon);
    const rig = sample.camera.children[0]!;
    const ready = rig.position.clone();
    sample.view.reset();
    sample.view.update(0.06, still);
    assert.ok(rig.position.distanceTo(ready) > 2, "drawing must raise the weapon into view");
    sample.view.update(0.19, still);
    assert.ok(rig.position.distanceTo(ready) < 1e-6, "draw must finish at 0.25s");
  }
});

test("reload animations finish on the real sim's ammo-transfer tick for every firearm", async () => {
  const sim = await Sim.load();
  sim.addBox([-512, -32, -512], [512, 0, 512], 0);
  sim.finalizeWorld();
  const snap = new Snapshot();
  const { camera, view } = create(4);
  for (const weapon of [2, 3, 4, 5, 6, 7]) {
    sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon });
    for (let tick = 0; tick < 100; ++tick) {
      sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 });
    }
    sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: Buttons.fire, weapon: 0 });
    sim.read(snap);
    const before = snap.magazine;
    sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: Buttons.reload, weapon: 0 });
    sim.read(snap);
    assert.ok(snap.reload > 0);
    view.setWeapon(weapon);
    const mag = camera.getObjectByName("magazine")!;
    const home = mag.position.clone();
    do {
      view.setReloadTicks(snap.reload);
      // Several sim ticks may pass between renders; reload start must survive.
      if (snap.tick % 5 === 0) view.update(5 / 64, still);
      sim.step({ forward: 0, strafe: 0, yaw: 0, pitch: 0, buttons: 0, weapon: 0 });
      sim.read(snap);
      if (snap.reload > 0) assert.equal(snap.magazine, before);
    } while (snap.reload > 0);
    view.setReloadTicks(0);
    view.update(0, still);
    assert.ok(snap.magazine > before);
    assert.ok(mag.position.distanceTo(home) < 1e-6, "gun must be assembled when ammo becomes ready");
  }
});
