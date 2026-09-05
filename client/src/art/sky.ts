import * as THREE from "three";

// Original orbital sky, painted once into six small cube faces. Sampling a
// direction (rather than six unrelated pictures) keeps nebulae and stars
// continuous across cube edges. No downloaded assets or per-frame effects.
const SIZE = 256;
let orbital: THREE.CubeTexture | null = null;

function hash(x: number, y: number, z: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ 9277;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (v: number): number => v * v * (3 - 2 * v);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  let value = 0;
  for (let dx = 0; dx < 2; ++dx) {
    for (let dy = 0; dy < 2; ++dy) {
      for (let dz = 0; dz < 2; ++dz) {
        value += hash(ix + dx, iy + dy, iz + dz) *
          (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
      }
    }
  }
  return value;
}

export function orbitalSky(): THREE.CubeTexture {
  if (orbital) return orbital;
  const planet = new THREE.Vector3(0.25, 0.48, 0.84).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), planet).normalize();
  const up = new THREE.Vector3().crossVectors(planet, right);
  const direction = new THREE.Vector3();
  const faces: HTMLCanvasElement[] = [];
  for (let face = 0; face < 6; ++face) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; ++y) {
      for (let x = 0; x < SIZE; ++x) {
        const u = 2 * (x + 0.5) / SIZE - 1, v = 2 * (y + 0.5) / SIZE - 1;
        switch (face) {
          case 0: direction.set(1, -v, -u); break;
          case 1: direction.set(-1, -v, u); break;
          case 2: direction.set(u, 1, v); break;
          case 3: direction.set(u, -1, -v); break;
          case 4: direction.set(u, -v, 1); break;
          default: direction.set(-u, -v, -1); break;
        }
        direction.normalize();
        const { x: dx, y: dy, z: dz } = direction;
        const cloud = noise(dx * 5, dy * 5, dz * 5);
        const detail = noise(dx * 19, dy * 19, dz * 19);
        const band = Math.exp(-Math.pow(dy + dx * 0.55 - 0.12 + (cloud - 0.5) * 0.5, 2) * 18);
        const mist = band * (0.35 + cloud * 0.65) * (0.65 + detail * 0.35);
        const horizon = Math.pow(1 - Math.abs(dy), 5);
        let r = 7 + horizon * 7 + mist * 32;
        let g = 11 + horizon * 12 + mist * 39;
        let b = 24 + horizon * 19 + mist * 73;
        const star = hash(Math.floor(dx * 900), Math.floor(dy * 900), Math.floor(dz * 900));
        if (star > 0.9985) {
          const shine = 85 + (star - 0.9985) / 0.0015 * 160;
          r += shine; g += shine; b += shine;
        }

        // A banded ice giant with a tilted ring, lit from its upper left.
        const facing = direction.dot(planet);
        if (facing > 0.88) {
          const px = direction.dot(right) / 0.18;
          const py = direction.dot(up) / 0.18;
          const ringY = py + px * 0.28;
          const ringRadius = Math.hypot(px, ringY / 0.28);
          if (ringRadius > 1.24 && ringRadius < 1.92) {
            const stripe = 0.72 + Math.sin(ringRadius * 105) * 0.15;
            r = 126 * stripe; g = 144 * stripe; b = 157 * stripe;
          }
          const disc = px * px + py * py;
          if (disc < 1) {
            const pz = Math.sqrt(1 - disc);
            const light = Math.max(0.08, -px * 0.5 + py * 0.35 + pz * 0.76);
            const bands = Math.sin((py + detail * 0.055) * 32) * 0.08 + 0.86;
            const rim = Math.pow(1 - pz, 4) * 36;
            r = (96 * bands) * light + rim * 0.4;
            g = (153 * bands) * light + rim * 0.8;
            b = (189 * bands) * light + rim;
          }
        }
        const index = (y * SIZE + x) * 4;
        pixels.data[index] = r;
        pixels.data[index + 1] = g;
        pixels.data[index + 2] = b;
        pixels.data[index + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    faces.push(canvas);
  }
  orbital = new THREE.CubeTexture(faces);
  orbital.colorSpace = THREE.SRGBColorSpace;
  orbital.magFilter = THREE.LinearFilter;
  orbital.minFilter = THREE.LinearFilter;
  orbital.generateMipmaps = false;
  orbital.needsUpdate = true;
  return orbital;
}
