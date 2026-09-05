import * as THREE from "three";

// Original orbital sky, painted once into six small cube faces. Sampling a
// direction (rather than six unrelated pictures) keeps nebulae and stars
// continuous across cube edges. No downloaded assets or per-frame effects.
const SIZE = 512;
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
  const moon = new THREE.Vector3(-0.92, 0.28, -0.25).normalize();
  const moonRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), moon).normalize();
  const moonUp = new THREE.Vector3().crossVectors(moon, moonRight);
  const craters = Array.from({ length: 24 }, (_, i) => ({
    x: hash(i, 19, 3) * 1.7 - 0.85, y: hash(i, 31, 9) * 1.7 - 0.85,
    radius: 0.035 + hash(i, 7, 21) * 0.13,
  }));
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
          // Project an inclined ring plane, then compare its depth with the
          // front of the sphere. The near arc crosses the planet; the far arc
          // disappears behind it instead of both arcs being painted over.
          const ringX = px * 0.963 - py * 0.270;
          const ringY = px * 0.270 + py * 0.963;
          const ringRadius = Math.hypot(ringX, ringY / 0.38);
          const ringDepth = -ringY * Math.sqrt(1 - 0.38 ** 2) / 0.38;
          if (ringRadius > 1.24 && ringRadius < 1.92 &&
              (disc >= 1 || ringDepth > Math.sqrt(1 - disc))) {
            const stripe = 0.78 + Math.sin(ringRadius * 55) * 0.10;
            r = 126 * stripe; g = 144 * stripe; b = 157 * stripe;
          }
        }

        // An inhabited moon in a different bearing. Crater rims catch the
        // crescent light; amber city grids cluster on its dark hemisphere.
        if (direction.dot(moon) > 0.97) {
          const mx = direction.dot(moonRight) / 0.16;
          const my = direction.dot(moonUp) / 0.16;
          const disc = mx * mx + my * my;
          if (disc < 1) {
            const mz = Math.sqrt(1 - disc);
            const sun = -mx * 0.90 + my * 0.20 + mz * 0.22;
            let rock = 115 + noise(mx * 9, my * 9, mz * 9) * 55;
            for (const crater of craters) {
              const distance = Math.hypot(mx - crater.x, my - crater.y) / crater.radius;
              if (distance < 1) rock *= 0.62 + distance * 0.25;
              else if (distance < 1.18) rock *= 1.14;
            }
            const light = 0.13 + Math.max(0, sun) * 0.86;
            r = rock * light; g = rock * light * 1.02; b = rock * light * 1.12;
            const settlement = Math.max(
              Math.exp(-((mx - 0.32) ** 2 + (my - 0.18) ** 2) / 0.030),
              Math.exp(-((mx - 0.52) ** 2 + (my + 0.32) ** 2) / 0.040),
              Math.exp(-((mx - 0.58) ** 2 + (my - 0.45) ** 2) / 0.018),
            );
            const gridX = (mx + my * 0.17) * 70, gridY = my * 70;
            const street = Math.abs(gridX - Math.round(gridX)) < 0.17 ||
              Math.abs(gridY - Math.round(gridY)) < 0.17;
            if (street && hash(Math.floor(mx * 96), Math.floor(my * 96), 490) > 0.35) {
              const city = settlement * Math.min(1, Math.max(0, (0.12 - sun) * 5)) * Math.sqrt(mz);
              r += city * 235; g += city * 164; b += city * 64;
            }
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
