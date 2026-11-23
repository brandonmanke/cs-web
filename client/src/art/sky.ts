import * as THREE from "three";

// Original skies, painted once into six small cube faces. Sampling a
// direction (rather than six unrelated pictures) keeps clouds and stars
// continuous across cube edges. Traffic is a small separate layer of lights;
// the painted sky itself never needs to be regenerated during play.
const SIZE = 512;
let orbital: THREE.CubeTexture | null = null;
let dusk: THREE.CubeTexture | null = null;
let desert: THREE.CubeTexture | null = null;

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
  orbital = paintSky((direction, color) => {
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
    color.set(r, g, b);
  });
  return orbital;
}

/** A small warehouse district viewed from above, painted into the lower sky. */
function industrialGround(direction: THREE.Vector3, color: THREE.Vector3): boolean {
  const { x, y, z } = direction;
  const elevation = y / Math.max(0.001, Math.hypot(x, z));
  if (elevation >= -0.035) return false;
  const eye = 1.8, block = 4, maxRoof = 0.65;
  const floorT = eye / -y, roofT = (eye - maxRoof) / -y;
  const gx = x * floorT, gz = z * floorT;
  const bx = Math.floor(gx / block), bz = Math.floor(gz / block);
  const u = gx - bx * block, v = gz - bz * block;
  const roadX = Math.min(u, block - u), roadZ = Math.min(v, block - v);
  const road = Math.min(roadX, roadZ);
  const grit = hash(Math.floor(gx * 70), Math.floor(gz * 70), 603) * 8;
  let r = 69 + grit, g = 66 + grit, b = 59 + grit; // concrete service yards
  if (road < 0.38) {
    r = 38 + grit; g = 41 + grit; b = 43 + grit;
    // Dashed centre lines stop at intersections.
    if ((roadX < 0.025 && roadZ > 0.5 && v % 0.6 < 0.28) ||
        (roadZ < 0.025 && roadX > 0.5 && u % 0.6 < 0.28)) {
      r = 114; g = 107; b = 87;
    }
  } else if (road < 0.49) {
    r = 82 + grit; g = 80 + grit; b = 74 + grit; // raised curb strips
  } else if (v > 3.2 && v < 3.7 && u > 0.7 && u < 3.3 && u % 0.38 < 0.025) {
    r = 111; g = 104; b = 85; // loading-yard parking bays
  }
  // Sodium street lamps cast small pools at the corners of each block.
  const lamp = Math.exp(-((u - 0.52) ** 2 + (v - 0.52) ** 2) * 16) +
    Math.exp(-((u - 3.48) ** 2 + (v - 3.48) ** 2) * 16);
  r += lamp * 43; g += lamp * 34; b += lamp * 21;

  // Only cells between the highest possible roof and the ground can intersect
  // this ray. Usually that is one or two warehouses, even at 512px per face.
  let nearest = floorT;
  const minX = Math.floor(Math.min(x * roofT, gx) / block);
  const maxX = Math.floor(Math.max(x * roofT, gx) / block);
  const minZ = Math.floor(Math.min(z * roofT, gz) / block);
  const maxZ = Math.floor(Math.max(z * roofT, gz) / block);
  for (let ix = minX; ix <= maxX; ++ix) {
    for (let iz = minZ; iz <= maxZ; ++iz) {
      const left = ix * block + 0.8, front = iz * block + 0.8;
      const right = left + 1.6 + hash(ix, iz, 610) * 0.65;
      const back = front + 1.35 + hash(ix, iz, 611) * 0.65;
      const height = 0.35 + hash(ix, iz, 612) * 0.30;
      const tx = Math.min(left / x, right / x), tz = Math.min(front / z, back / z);
      const ty = (eye - height) / -y;
      const enter = Math.max(tx, tz, ty);
      const leave = Math.min(Math.max(left / x, right / x), Math.max(front / z, back / z), floorT);
      if (enter > leave || enter >= nearest) continue;
      nearest = enter;
      const hx = x * enter - left, hz = z * enter - front;
      const rust = hash(ix, iz, 613);
      const weathering = 0.72 + hash(ix, iz, 614) * 0.35;
      if (ty >= tx && ty >= tz) {
        const corrugation = Math.cos(hx * 110) * 2;
        r = (76 + rust * 12 + corrugation) * weathering;
        g = (78 - rust * 7 + corrugation) * weathering;
        b = (77 - rust * 10 + corrugation) * weathering;
        // A ridge, inset skylights and squat ventilation boxes make roofs read.
        if (hz > (back - front) / 2) { r *= 0.78; g *= 0.78; b *= 0.78; }
        if (hx > 0.3 && hx < 1.3 && hz > 0.35 && hz < 0.55) {
          r = 88; g = 97; b = 98;
        }
        if (hx > 0.4 && hx < 0.65 && hz > 0.95 && hz < 1.2) {
          r = 62; g = 66; b = 65;
        }
      } else {
        const light = (tx > tz ? 0.8 : 1) * weathering;
        r = 77 * light; g = 70 * light; b = 59 * light;
        const along = tx > tz ? hz : hx, wallY = eye + y * enter;
        if (along > 0.35 && along < 1.05 && wallY < height * 0.65) {
          r = 39; g = 43; b = 43; // recessed roll-up loading door
        }
        if (along > 0.3 && along < 1.2 && wallY > height * 0.77 && wallY < height * 0.9) {
          r = 137; g = 117; b = 82;
        }
      }
    }
  }
  const fogBank = noise(gx * 0.09, 4, gz * 0.09);
  const haze = 1 - Math.exp(-0.32 - Math.hypot(gx, gz) * (0.045 + fogBank * 0.025));
  const blend = Math.min(1, (-elevation - 0.035) / 0.08);
  color.x += ((r * (1 - haze) + 105 * haze) - color.x) * blend;
  color.y += ((g * (1 - haze) + 101 * haze) - color.y) * blend;
  color.z += ((b * (1 - haze) + 99 * haze) - color.z) * blend;
  return nearest === floorT;
}

/** Faint vehicle lights on the sky's streets; no traffic simulation or actors. */
export class DuskTraffic {
  readonly root: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly positions = new THREE.BufferAttribute(new Float32Array(56 * 3), 3);
  private readonly colors = new THREE.BufferAttribute(new Float32Array(56 * 4), 4);
  private readonly direction = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly headlights = new THREE.Color(0xc6bba7);
  private readonly taillights = new THREE.Color(0xad756a);
  private seconds = 0;

  constructor() {
    const pixels = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; ++y) {
      for (let x = 0; x < 16; ++x) {
        const at = (y * 16 + x) * 4;
        const radius = Math.hypot(x - 7.5, y - 7.5) / 7.5;
        pixels[at] = pixels[at + 1] = pixels[at + 2] = 255;
        pixels[at + 3] = Math.max(0, 1 - radius) ** 2 * 255;
      }
    }
    const glow = new THREE.DataTexture(pixels, 16, 16);
    glow.magFilter = glow.minFilter = THREE.LinearFilter;
    glow.needsUpdate = true;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.positions.setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", this.colors.setUsage(THREE.DynamicDrawUsage));
    this.root = new THREE.Points(geometry, new THREE.PointsMaterial({
      map: glow, size: 4, sizeAttenuation: false, vertexColors: true,
      transparent: true, opacity: 0.7, depthWrite: false, fog: false, toneMapped: false,
    }));
    this.root.name = "sky:traffic";
    this.root.frustumCulled = false;
    this.root.renderOrder = -1; // Behind the transparent window glass.
  }

  update(dt: number, camera: THREE.Vector3): void {
    this.seconds += dt;
    this.root.position.copy(camera);
    for (let i = 0; i < this.positions.count; ++i) {
      const sign = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
      const road = (Math.floor(i / 4) % 7 - 3) * 4 + sign * 0.14;
      const phase = hash(i, 621, 0) * 56 + this.seconds * (0.16 + hash(i, 622, 0) * 0.12);
      const travel = ((phase % 56) - 28) * sign;
      const x = i % 2 === 0 ? travel : road, z = i % 2 === 0 ? road : travel;
      const distance = Math.hypot(x, z);
      this.direction.set(x, -1.8, z).normalize();
      const visible = industrialGround(this.direction, this.scratch);
      const fade = Math.max(0, Math.min(1, (distance - 7) / 3, (28 - Math.abs(travel)) / 4)) *
        Math.exp(-distance * 0.035);
      const light = travel * sign < 0 ? this.headlights : this.taillights;
      // Canvas cubemaps mirror X when Three.js samples the background.
      this.positions.setXYZ(i, -this.direction.x * 12000, this.direction.y * 12000, this.direction.z * 12000);
      this.colors.setXYZW(i, light.r, light.g, light.b, visible ? fade : 0);
    }
    this.positions.needsUpdate = this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.root.geometry.dispose();
    this.root.material.map!.dispose();
    this.root.material.dispose();
  }
}

export function duskSky(): THREE.CubeTexture {
  if (dusk) return dusk;
  const sun = new THREE.Vector3(-0.55, 0.50, 0.83).normalize();
  // Far city blocks, a refinery belt, then nearby warehouse roofs. Longitude
  // wraps around the whole sky, so the industrial district joins at cube seams.
  const districts = [112, 64, 40].map((count, layer) => Array.from({ length: count }, (_, i) => {
    const width = 0.62 + hash(i, layer, 52) * 0.30;
    const side = hash(i, layer, 75) > 0.5 ? 1 : -1;
    // Neighbouring factories share a plant, with banks of two or three stacks
    // near the roof edges. The distant city blocks have no chimneys.
    const cluster = layer > 0 && i % 3 !== 2 && hash(Math.floor(i / 3), layer, 74) > 0.65;
    return {
      height: layer === 0 ? 0.015 + hash(i, layer, 41) * 0.065 :
        0.015 - layer * 0.025 + hash(i, layer, 41) * 0.055,
      width,
      shape: Math.floor(hash(i, layer, 63) * 3),
      stacks: Array.from({ length: cluster ? 2 + Math.floor(hash(i, layer, 76) * 2) : 0 }, (_, j) => ({
        at: 0.5 + side * (width * 0.36 - j * 0.11),
        height: 0.028 + hash(i * 3 + j, layer, 85) * 0.055,
        radius: 0.024 + hash(i * 3 + j, layer, 86) * 0.012,
      })),
    };
  }));
  dusk = paintSky((direction, color) => {
    const { x, y, z } = direction;
    const horizon = Math.exp(-Math.max(0, y) * 3.8);
    const facing = Math.max(0, direction.dot(sun));
    const glow = Math.pow(facing, 14);
    let r = 34 + horizon * 118 + glow * 65;
    let g = 43 + horizon * 51 + glow * 28;
    let b = 64 + horizon * 11 + glow * 8;
    // Broad smoky banks with finer ragged edges, lit amber toward the sun.
    const cloud = noise(x * 3, y * 6, z * 3) * 0.65 +
      noise(x * 11, y * 18, z * 11) * 0.25 + noise(x * 31, y * 43, z * 31) * 0.10;
    const opacity = Math.min(0.92, Math.max(0, (cloud - 0.38) * 3));
    const edge = Math.exp(-Math.pow((cloud - 0.40) * 18, 2)) * glow;
    const disc = Math.min(1, Math.max(0, (facing - 0.9982) / 0.0005));
    r += disc * 150; g += disc * 118; b += disc * 64;
    r = r * (1 - opacity) + (36 + horizon * 28 + glow * 55) * opacity + edge * 48;
    g = g * (1 - opacity) + (38 + horizon * 13 + glow * 24) * opacity + edge * 24;
    b = b * (1 - opacity) + (50 + horizon * 4 + glow * 8) * opacity + edge * 9;

    const elevation = y / Math.max(0.001, Math.hypot(x, z));
    if (elevation < 0.4) {
      const bearing = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
      const smog = Math.exp(-(((elevation - 0.025) * 6) ** 2)) * 0.65;
      r = r * (1 - smog) + 113 * smog;
      g = g * (1 - smog) + 106 * smog;
      b = b * (1 - smog) + 101 * smog;
      for (const [layer, buildings] of districts.entries()) {
        const longitude = bearing * buildings.length;
        const index = Math.floor(longitude), u = longitude - index;
        const building = buildings[index]!;
        const across = (u - 0.5) / building.width;
        let roof = building.height;
        if (layer > 0) {
          // Sawtooth sheds and rounded storage tanks break up the flat roofs.
          if (building.shape === 1) roof += ((u * 4) % 1) * 0.018;
          if (building.shape === 2) roof += Math.sqrt(Math.max(0, 1 - across * across * 4)) * 0.025;
        }
        let stackTop = -Infinity;
        for (const chimney of building.stacks) {
          const top = building.height + chimney.height;
          if (elevation > top) {
            const rise = elevation - top;
            const plume = Math.exp(-(((u - chimney.at - rise * 1.2) / (0.05 + rise * 0.8)) ** 2)) *
              Math.max(0, 1 - rise / 0.10) * (0.10 + cloud * 0.10);
            r = r * (1 - plume) + 69 * plume;
            g = g * (1 - plume) + 65 * plume;
            b = b * (1 - plume) + 65 * plume;
          }
          if (Math.abs(u - chimney.at) < chimney.radius) stackTop = top;
        }
        const stack = elevation < stackTop;
        if ((Math.abs(across) < 0.5 && elevation < roof) || stack || elevation < -0.10 - layer * 0.07) {
          const haze = [0.78, 0.60, 0.40][layer]!;
          const panel = hash(Math.floor(u * 20), index, layer) * 7;
          r = (29 + panel) * (1 - haze) + 105 * haze;
          g = (33 + panel) * (1 - haze) + 101 * haze;
          b = (39 + panel) * (1 - haze) + 99 * haze;
          if (!stack && elevation < roof - 0.012 && elevation > roof - 0.09) {
            const column = u * (layer === 0 ? 5 : 12), row = (roof - elevation) * 150;
            if (column % 1 < 0.3 && row % 1 < 0.25 && hash(Math.floor(column), Math.floor(row), index + layer * 211) > 0.58) {
              r += 140 * (1 - haze); g += 88 * (1 - haze); b += 32 * (1 - haze);
            }
          }
          // Occasional red obstruction lamps on the chimney caps.
          if (stack && stackTop - elevation < 0.005) {
            r += 105 * (1 - haze); g += 24 * (1 - haze); b += 12 * (1 - haze);
          }
        }
      }
    }
    color.set(r, g, b);
    industrialGround(direction, color);
  });
  return dusk;
}

/**
 * Classic CS 1.6 sunlit desert / Mediterranean skybox (de_dust / de_dust2 feel):
 * crisp azure zenith fading to dusty warm golden-ochre horizon haze, high sun,
 * soft sunlit cumulus banks, and distant layered desert mesas.
 */
export function desertSky(): THREE.CubeTexture {
  if (desert) return desert;
  const sun = new THREE.Vector3(0.45, 0.72, 0.55).normalize();
  desert = paintSky((direction, color) => {
    const { x, y, z } = direction;
    const up = Math.max(0, y);
    const horizon = Math.exp(-up * 4.2);
    const facing = Math.max(0, direction.dot(sun));
    const glow = Math.pow(facing, 10);
    const disc = Math.min(1, Math.max(0, (facing - 0.9975) / 0.0012));

    // Crisp dry blue zenith -> dusty warm ochre-cream horizon.
    let r = 82 + horizon * 144 + glow * 42 + disc * 110;
    let g = 132 + horizon * 88 + glow * 32 + disc * 95;
    let b = 188 + horizon * 12 + glow * 8 + disc * 60;

    // Soft bright cumulus wisps drifting overhead.
    if (y > 0.02) {
      const c1 = noise(x * 3.5 + 1.2, y * 7, z * 3.5 - 0.8);
      const c2 = noise(x * 11, y * 16, z * 11);
      const cloud = c1 * 0.7 + c2 * 0.3;
      const alpha = Math.min(0.62, Math.max(0, (cloud - 0.50) * 2.6)) * Math.min(1, y * 5);
      const lit = 0.86 + glow * 0.14;
      r = r * (1 - alpha) + 242 * lit * alpha;
      g = g * (1 - alpha) + 232 * lit * alpha;
      b = b * (1 - alpha) + 210 * lit * alpha;
    }

    // Distant sandstone ridge line along the horizon.
    const elevation = y / Math.max(0.001, Math.hypot(x, z));
    const bearing = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1;
    const farRidge = 0.02 + noise(Math.cos(bearing * Math.PI * 2) * 4, 2.3, Math.sin(bearing * Math.PI * 2) * 4) * 0.09;
    const nearRidge = -0.01 + noise(Math.cos(bearing * Math.PI * 2) * 8, 7.1, Math.sin(bearing * Math.PI * 2) * 8) * 0.055;
    if (elevation < farRidge) {
      const shade = 0.82 + noise(x * 24, y * 24, z * 24) * 0.2;
      r = 178 * shade; g = 152 * shade; b = 118 * shade;
    }
    if (elevation < nearRidge) {
      const shade = 0.78 + noise(x * 32, y * 32, z * 32) * 0.22;
      r = 148 * shade; g = 122 * shade; b = 90 * shade;
    }
    if (elevation < -0.06) {
      r = 158; g = 136; b = 104;
    }

    color.set(Math.min(255, r), Math.min(255, g), Math.min(255, b));
  });
  return desert;
}

function paintSky(paint: (direction: THREE.Vector3, color: THREE.Vector3) => void): THREE.CubeTexture {
  const direction = new THREE.Vector3();
  const color = new THREE.Vector3();
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
        paint(direction, color);
        const index = (y * SIZE + x) * 4;
        pixels.data[index] = color.x;
        pixels.data[index + 1] = color.y;
        pixels.data[index + 2] = color.z;
        pixels.data[index + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    faces.push(canvas);
  }
  const texture = new THREE.CubeTexture(faces);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
