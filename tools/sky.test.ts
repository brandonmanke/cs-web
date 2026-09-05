import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { orbitalSky } from "../client/src/art/sky";

interface SkyCanvas { width: number; height: number; pixels: Uint8ClampedArray }
Object.assign(globalThis, { document: { createElement: () => {
  const canvas = { width: 0, height: 0, pixels: new Uint8ClampedArray(), getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: { data: Uint8ClampedArray }) => { canvas.pixels = image.data; },
  }) };
  return canvas;
} } });

// Read the actual generated +Z cube face, at a direction relative to the
// planet's centre. Check the painted result, not the ring's implementation.
function planetPixel(x: number, y: number): number[] {
  const planet = new THREE.Vector3(0.25, 0.48, 0.84).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), planet).normalize();
  const up = new THREE.Vector3().crossVectors(planet, right);
  const direction = planet.multiplyScalar(Math.sqrt(1 - 0.18 ** 2 * (x * x + y * y)))
    .addScaledVector(right, x * 0.18).addScaledVector(up, y * 0.18);
  const face = orbitalSky().images[4] as SkyCanvas;
  const px = Math.floor((direction.x / direction.z + 1) * face.width / 2);
  const py = Math.floor((1 - direction.y / direction.z) * face.height / 2);
  return Array.from(face.pixels.slice((py * face.width + px) * 4, (py * face.width + px) * 4 + 3));
}

test("planet occludes the far ring while the near ring crosses its face", () => {
  const near = planetPixel(0, -0.55);
  const far = planetPixel(0, 0.55);
  assert.ok(near[0]! / near[2]! > 0.72, `near ring must paint over the blue planet: ${near}`);
  assert.ok(far[0]! / far[2]! < 0.70, `far ring must stay behind the blue planet: ${far}`);
});
