import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { Character, type CharacterPose } from "../client/src/art/character";

// Texture painting is irrelevant to joint geometry. Keep the actual Three.js
// meshes, hierarchy and animation; supply only the canvas operations they need.
Object.assign(globalThis, { document: {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({
    fillRect() {}, beginPath() {}, moveTo() {}, arc() {}, fill() {}, stroke() {},
    bezierCurveTo() {}, save() {}, restore() {}, putImageData() {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  }) }),
} });

const pose: CharacterPose = {
  speed: 221, onGround: true, yaw: 0, pitch: 0,
  alive: true, weapon: 4, ducked: false,
};

// Inspect the joints without adding a public gameplay API just for tests.
function joints(character: Character) {
  return character as unknown as { legs: THREE.Group[]; knees: THREE.Group[] };
}

for (const team of ["ct", "t"] as const) {
  test(`${team}: knees fold behind the thighs throughout walking and jumping`, () => {
    const character = new Character(team);
    const { legs, knees } = joints(character);
    for (const onGround of [true, false]) {
      for (const speed of [0, 75, 221, 350]) {
        for (const yaw of [0, Math.PI / 2, Math.PI]) {
          for (let tick = 0; tick < 64; ++tick) {
            character.update(1 / 32, { ...pose, onGround, speed, yaw });
            character.root.updateMatrixWorld(true);
            for (let i = 0; i < 2; ++i) {
              const ankle = knees[i]!.localToWorld(new THREE.Vector3(0, -12, 0));
              legs[i]!.worldToLocal(ankle);
              assert.ok(ankle.z >= -1e-6, "ankle must stay behind the thigh's knee plane");
              if (!onGround) {
                const knee = knees[i]!.getWorldPosition(new THREE.Vector3());
                const hip = legs[i]!.getWorldPosition(new THREE.Vector3());
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(character.root.quaternion);
                assert.ok(knee.sub(hip).dot(forward) > 0, "jump must lift each knee forward");
              }
            }
          }
        }
      }
    }
    character.dispose();
  });

  test(`${team}: dying bodies stay above their feet plane and stand up on respawn`, () => {
    const character = new Character(team);
    const bounds = new THREE.Box3();
    for (const weapon of [1, 2, 3, 4, 5, 6, 7]) {
      for (const ducked of [false, true]) {
        for (const height of [0, 144]) {
          for (const yaw of [0, Math.PI / 2]) {
            character.root.position.set(200, height, -200);
            const alive = { ...pose, weapon, ducked, yaw, speed: 0 };
            character.update(1 / 64, alive);
            for (let tick = 0; tick < 32; ++tick) {
              character.update(1 / 32, { ...alive, alive: false });
              const minimum = bounds.setFromObject(character.root).min.y;
              assert.ok(minimum >= height - 1e-5, `corpse at ${minimum} sank below ${height}`);
            }
            character.update(1 / 64, alive);
            const revived = bounds.setFromObject(character.root);
            assert.ok(revived.max.y >= height + (ducked ? 34 : 68), "respawn restores upright body");
          }
        }
      }
    }
    character.dispose();
  });
}
