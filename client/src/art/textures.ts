import * as THREE from "three";

// Procedural GoldSrc-era textures, remastered. Everything is drawn to a canvas
// with a seeded RNG, so the atlas is deterministic, diffable as source, and
// carries no licensing baggage. The era lives in the palette and the tiling
// (rust, sodium light, sickly green, wet concrete), not in visible pixels:
// like the GL renderer of the day, textures are bilinear-filtered and mipped.

const SIZE = 256;
/** The repeat most surface detail is laid out on: 64u, two to a tile. */
const CELL = 128;

/** World units per texture tile: 256px over 128u, two texels to the unit. */
export const TEXTURE_SCALE = 128;

// Mulberry32 — small, fast, deterministic.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Ctx {
  ctx: CanvasRenderingContext2D;
  random: () => number;
  size: number;
}

/** Shared canvas -> nearest-filtered texture pipeline. */
export function canvasTexture(size: number, seed: number,
                              paint: (c: Ctx) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  paint({ ctx, random: rng(seed), size });

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function draw(seed: number, paint: (c: Ctx) => void): THREE.CanvasTexture {
  return canvasTexture(SIZE, seed, paint);
}

export function fill(c: Ctx, color: string): void {
  c.ctx.fillStyle = color;
  c.ctx.fillRect(0, 0, c.size, c.size);
}

/** Per-pixel value noise, the grime pass under everything else. */
export function grain(c: Ctx, amount: number, scale = 1): void {
  const SIZE = c.size;
  const image = c.ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  const cells = Math.max(1, Math.floor(SIZE / scale));
  const field = new Float32Array(cells * cells);
  for (let i = 0; i < field.length; ++i) field[i] = c.random();

  for (let y = 0; y < SIZE; ++y) {
    for (let x = 0; x < SIZE; ++x) {
      const cell = field[(Math.floor(y / scale) % cells) * cells +
                         (Math.floor(x / scale) % cells)]!;
      const delta = (cell - 0.5) * amount;
      const index = (y * SIZE + x) * 4;
      data[index] = Math.max(0, Math.min(255, data[index]! + delta));
      data[index + 1] = Math.max(0, Math.min(255, data[index + 1]! + delta));
      data[index + 2] = Math.max(0, Math.min(255, data[index + 2]! + delta));
    }
  }
  c.ctx.putImageData(image, 0, 0);
}

/** Tileable fractal value noise, 0..1 per pixel: the raw material of every organic pattern. */
export function noiseField(size: number, random: () => number, scale = 64, octaves = 4): Float32Array {
  const sum = new Float32Array(size * size);
  let weight = 1, total = 0;
  for (let octave = 0; octave < octaves; ++octave, weight *= 0.5) {
    const cells = Math.max(1, Math.round(size / (scale / 2 ** octave)));
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; ++i) lattice[i] = random();
    total += weight;
    for (let y = 0; y < size; ++y) {
      const fy = (y / size) * cells, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty), r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; ++x) {
        const fx = (x / size) * cells, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx), c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const top = lattice[r0 + c0]! + (lattice[r0 + c1]! - lattice[r0 + c0]!) * sx;
        const bottom = lattice[r1 + c0]! + (lattice[r1 + c1]! - lattice[r1 + c0]!) * sx;
        sum[y * size + x]! += (top + (bottom - top) * sy) * weight;
      }
    }
  }
  for (let i = 0; i < sum.length; ++i) sum[i]! /= total;
  return sum;
}

/**
 * Fractal noise as a brightness pass: the slow, cloudy variation that makes a
 * flat fill read as poured concrete or worn steel.
 */
export function cloud(c: Ctx, amount: number, scale = 64, octaves = 4): void {
  const size = c.size;
  const image = c.ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const field = noiseField(size, c.random, scale, octaves);
  for (let i = 0; i < field.length; ++i) {
    const delta = (field[i]! - 0.5) * 2 * amount;
    for (let k = 0; k < 3; ++k) data[i * 4 + k] = Math.max(0, Math.min(255, data[i * 4 + k]! + delta));
  }
  c.ctx.putImageData(image, 0, 0);
}

export function hexRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}

/**
 * Disruptive-pattern camouflage: two noise fields cut at thresholds into hard
 * patches of `colours` over a base, the way printed fabric actually looks.
 */
export function camo(c: Ctx, base: string, colours: string[], scale = 40): void {
  const size = c.size;
  const image = c.ctx.getImageData(0, 0, size, size);
  const data = image.data;
  const fields = colours.map(() => noiseField(size, c.random, scale, 3));
  const rgb = [hexRgb(base), ...colours.map(hexRgb)];
  for (let i = 0; i < size * size; ++i) {
    let pick = 0;
    for (let k = 0; k < fields.length; ++k) if (fields[k]![i]! > 0.56 + k * 0.03) pick = k + 1;
    const colour = rgb[pick]!;
    data[i * 4] = colour[0]; data[i * 4 + 1] = colour[1]; data[i * 4 + 2] = colour[2]; data[i * 4 + 3] = 255;
  }
  c.ctx.putImageData(image, 0, 0);
}

/** A colour canvas and the height canvas that goes with it, painted together. */
export interface Relief { color: Ctx; height: Ctx }
export interface ReliefTextures { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture }

/**
 * Paint a surface and its relief side by side. Height starts at mid grey;
 * lighter stands proud, darker is recessed.
 */
export function reliefTextures(size: number, seed: number, paint: (r: Relief) => void): ReliefTextures {
  let bumpMap!: THREE.CanvasTexture;
  const map = canvasTexture(size, seed, (color) => {
    bumpMap = canvasTexture(size, seed + 7919, (height) => {
      fill(height, "#808080");
      paint({ color, height });
    });
  });
  bumpMap.colorSpace = THREE.NoColorSpace;
  return { map, bumpMap };
}

/** Soft-edged blotches — water staining, soot, corrosion bloom. */
export function stains(c: Ctx, count: number, color: string, maxRadius: number): void {
  const SIZE = c.size;
  const clear = `${color}00`;
  c.ctx.save();
  for (let i = 0; i < count; ++i) {
    const x = c.random() * SIZE;
    const y = c.random() * SIZE;
    const radius = maxRadius * (0.3 + c.random() * 0.7);
    c.ctx.globalAlpha = 0.08 + c.random() * 0.2;
    // Wrap by drawing the blotch in all four offsets it could straddle.
    const offsets: Array<[number, number]> = [[0, 0], [SIZE, 0], [0, SIZE], [SIZE, SIZE]];
    for (const [ox, oy] of offsets) {
      const gradient = c.ctx.createRadialGradient(x - ox, y - oy, 0, x - ox, y - oy, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, clear);
      c.ctx.fillStyle = gradient;
      c.ctx.fillRect(x - ox - radius, y - oy - radius, radius * 2, radius * 2);
    }
  }
  c.ctx.restore();
}

/** Run a 128px layout once per 64u cell, so one tile carries four of them. */
function cells(c: Ctx, paint: (x: CanvasRenderingContext2D) => void): void {
  for (let y = 0; y < SIZE; y += CELL) {
    for (let x = 0; x < SIZE; x += CELL) {
      c.ctx.save();
      c.ctx.translate(x, y);
      paint(c.ctx);
      c.ctx.restore();
    }
  }
}

/** Vertical streaks below a feature — the single most "grimy industrial" cue. */
export function drips(c: Ctx, count: number, color: string): void {
  const SIZE = c.size;
  c.ctx.save();
  c.ctx.strokeStyle = color;
  for (let i = 0; i < count; ++i) {
    const x = Math.floor(c.random() * SIZE);
    const top = c.random() * SIZE * 0.5;
    const length = SIZE * (0.15 + c.random() * 0.5);
    c.ctx.globalAlpha = 0.06 + c.random() * 0.14;
    c.ctx.lineWidth = 1 + Math.floor(c.random() * 2);
    c.ctx.beginPath();
    c.ctx.moveTo(x + 0.5, top);
    c.ctx.lineTo(x + 0.5, top + length);
    c.ctx.stroke();
  }
  c.ctx.restore();
}

function rivets(c: Ctx, step: number, inset: number, light: string, dark: string): void {
  const SIZE = c.size;
  for (let y = inset; y < SIZE; y += step) {
    for (let x = inset; x < SIZE; x += step) {
      c.ctx.fillStyle = dark;
      c.ctx.fillRect(x, y, 3, 3);
      c.ctx.fillStyle = light;
      c.ctx.fillRect(x, y, 2, 2);
    }
  }
}

// --- the texture set --------------------------------------------------------

function concrete(seed: number, base: string): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, base);
    cloud(c, 34, 128, 5);
    stains(c, 12, "#1a1a16", 70);
    drips(c, 18, "#15150f");
    // Formwork seams on the 64u grid, with a tie hole in each panel corner.
    cells(c, (x) => {
      x.fillStyle = "rgba(0,0,0,0.3)";
      x.fillRect(0, 0, CELL, 1); x.fillRect(0, 0, 1, CELL);
      x.fillStyle = "rgba(255,255,255,0.06)";
      x.fillRect(0, 1, CELL, 1); x.fillRect(1, 0, 1, CELL);
      x.fillStyle = "rgba(0,0,0,0.4)";
      for (const [hx, hy] of [[14, 14], [112, 14], [14, 112], [112, 112]]) x.fillRect(hx!, hy!, 3, 3);
    });
    // Hairline cracks wandering down from a seam.
    c.ctx.strokeStyle = "rgba(0,0,0,0.16)";
    c.ctx.lineWidth = 1;
    for (let i = 0; i < 3; ++i) {
      let x = c.random() * SIZE, y = c.random() * SIZE;
      c.ctx.beginPath();
      c.ctx.moveTo(x, y);
      for (let step = 0; step < 9; ++step) {
        x += (c.random() - 0.5) * 14; y += 4 + c.random() * 8;
        c.ctx.lineTo(x, y);
      }
      c.ctx.stroke();
    }
    grain(c, 9, 1);
  });
}

function metalPanel(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#575c5d");
    cloud(c, 20, 96, 4);
    // Two plates per cell with a recessed seam.
    cells(c, (x) => {
      x.fillStyle = "rgba(0,0,0,0.34)";
      x.fillRect(0, 62, CELL, 4); x.fillRect(0, 0, 2, CELL);
      x.fillStyle = "rgba(255,255,255,0.09)";
      x.fillRect(0, 66, CELL, 1); x.fillRect(2, 0, 1, CELL);
    });
    rivets(c, 32, 8, "#8b9092", "#33383a");
    stains(c, 10, "#20211c", 44);
    drips(c, 16, "#3a2a18");
    grain(c, 7, 1);
  });
}

function rustedMetal(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#6b4a30");
    cloud(c, 34, 96, 5);
    stains(c, 26, "#31200f", 56);
    stains(c, 18, "#9a5e28", 34);
    drips(c, 30, "#2a1808");
    rivets(c, 40, 12, "#9a7048", "#2c1c0e");
    grain(c, 12, 1);
  });
}

function grate(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#232523");
    cloud(c, 12, 64, 3);
    for (let y = 0; y < SIZE; y += 16) {
      c.ctx.fillStyle = "#5b5f5b";
      c.ctx.fillRect(0, y, SIZE, 5);
      c.ctx.fillStyle = "#7b807b";
      c.ctx.fillRect(0, y, SIZE, 1);
      c.ctx.fillStyle = "rgba(0,0,0,0.5)";
      c.ctx.fillRect(0, y + 5, SIZE, 2);
    }
    for (let x = 0; x < SIZE; x += 16) {
      c.ctx.fillStyle = "#5b5f5b";
      c.ctx.fillRect(x, 0, 5, SIZE);
      c.ctx.fillStyle = "#7b807b";
      c.ctx.fillRect(x, 0, 1, SIZE);
    }
    stains(c, 12, "#140f08", 40);
    grain(c, 9, 1);
  });
}

function brick(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#3d3a35"); // mortar
    const height = 16;
    const width = 32;
    for (let row = 0, y = 0; y < SIZE; y += height, ++row) {
      const offset = (row % 2) * (width / 2);
      for (let x = -width; x < SIZE + width; x += width) {
        const shade = 0.78 + c.random() * 0.4;
        const r = Math.floor(112 * shade);
        const g = Math.floor(72 * shade);
        const b = Math.floor(54 * shade);
        c.ctx.fillStyle = `rgb(${r},${g},${b})`;
        c.ctx.fillRect(x + offset + 1, y + 1, width - 2, height - 2);
        // Lit top edge, shadowed bottom: the brick stands proud of the mortar.
        c.ctx.fillStyle = "rgba(255,235,210,0.1)";
        c.ctx.fillRect(x + offset + 1, y + 1, width - 2, 1);
        c.ctx.fillStyle = "rgba(0,0,0,0.22)";
        c.ctx.fillRect(x + offset + 1, y + height - 2, width - 2, 1);
      }
    }
    cloud(c, 22, 96, 4);
    stains(c, 14, "#1c150c", 56);
    drips(c, 14, "#181109");
    grain(c, 9, 1);
  });
}

function sand(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#978256");
    cloud(c, 26, 128, 5);
    stains(c, 14, "#6b5a34", 60);
    // Scattered pebbles and their shadows.
    for (let i = 0; i < 160; ++i) {
      const x = c.random() * SIZE, y = c.random() * SIZE;
      c.ctx.fillStyle = "rgba(0,0,0,0.25)";
      c.ctx.fillRect(x, y + 1, 2, 1);
      c.ctx.fillStyle = "rgba(215,200,160,0.4)";
      c.ctx.fillRect(x, y, 2, 1);
    }
    grain(c, 12, 1);
  });
}

/** One whole crate face per tile: framed, planked and cross-braced. */
function crate(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    const x = c.ctx, frame = 26;
    fill(c, "#7d5a30");
    // Inner planks, each a slightly different cut of wood.
    for (let px = frame; px < SIZE - frame; px += 34) {
      x.fillStyle = `rgba(${c.random() < 0.5 ? "0,0,0" : "255,220,170"},${0.04 + c.random() * 0.1})`;
      x.fillRect(px, frame, 34, SIZE - 2 * frame);
      x.fillStyle = "rgba(0,0,0,0.4)";
      x.fillRect(px, frame, 2, SIZE - 2 * frame);
    }
    // Diagonal brace across the panel.
    x.save();
    x.beginPath();
    x.moveTo(frame, frame + 30); x.lineTo(frame + 30, frame);
    x.lineTo(SIZE - frame, SIZE - frame - 30); x.lineTo(SIZE - frame - 30, SIZE - frame);
    x.closePath();
    x.fillStyle = "#8a6436";
    x.fill();
    x.strokeStyle = "rgba(0,0,0,0.45)";
    x.lineWidth = 2;
    x.stroke();
    x.restore();
    // Frame boards, mitred by overlap, shadowing the panel they sit on.
    x.fillStyle = "rgba(0,0,0,0.35)";
    x.fillRect(frame, frame, SIZE - 2 * frame, 4); x.fillRect(frame, frame, 4, SIZE - 2 * frame);
    x.fillStyle = "#8f6839";
    x.fillRect(0, 0, SIZE, frame); x.fillRect(0, SIZE - frame, SIZE, frame);
    x.fillStyle = "#86602f";
    x.fillRect(0, frame, frame, SIZE - 2 * frame); x.fillRect(SIZE - frame, frame, frame, SIZE - 2 * frame);
    x.fillStyle = "rgba(0,0,0,0.4)";
    x.fillRect(0, frame - 1, SIZE, 1); x.fillRect(0, SIZE - frame, SIZE, 1);
    x.fillRect(0, 0, SIZE, 2); x.fillRect(0, SIZE - 2, SIZE, 2);
    x.fillRect(0, 0, 2, SIZE); x.fillRect(SIZE - 2, 0, 2, SIZE);
    // Wood grain: long faint streaks along each board.
    for (let i = 0; i < 260; ++i) {
      const gx = c.random() * SIZE, gy = c.random() * SIZE;
      const along = gy < frame || gy > SIZE - frame;
      x.fillStyle = `rgba(${c.random() < 0.5 ? "40,22,8" : "200,160,110"},0.16)`;
      x.fillRect(gx, gy, along ? 20 + c.random() * 40 : 1, along ? 1 : 20 + c.random() * 40);
    }
    // Nail heads in the frame corners and along the boards.
    for (const nx of [9, 60, 128, 196, 245]) {
      for (const ny of [9, 245]) {
        x.fillStyle = "#2a2622"; x.fillRect(nx, ny, 3, 3); x.fillRect(ny, nx, 3, 3);
        x.fillStyle = "#9a958c"; x.fillRect(nx, ny, 2, 2); x.fillRect(ny, nx, 2, 2);
      }
    }
    cloud(c, 18, 64, 4);
    stains(c, 8, "#241705", 44);
    grain(c, 8, 1);
  });
}

function techPanel(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#33383c");
    cloud(c, 14, 96, 4);
    cells(c, (x) => {
      // Vent louvres in the lower half.
      x.fillStyle = "#1a1e21";
      for (let y = 74; y < 118; y += 8) x.fillRect(12, y, CELL - 24, 5);
      x.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = 74; y < 118; y += 8) x.fillRect(12, y + 5, CELL - 24, 1);
      // A recessed upper plate.
      x.strokeStyle = "rgba(0,0,0,0.5)";
      x.lineWidth = 2;
      x.strokeRect(12, 12, CELL - 24, 48);
      x.strokeStyle = "rgba(255,255,255,0.07)";
      x.lineWidth = 1;
      x.strokeRect(13, 13, CELL - 26, 46);
      x.fillStyle = "rgba(0,0,0,0.35)";
      x.fillRect(0, 0, CELL, 1); x.fillRect(0, 0, 1, CELL);
    });
    rivets(c, 48, 6, "#7d8388", "#20252a");
    stains(c, 8, "#101318", 44);
    grain(c, 7, 1);
  });
}

/** Bright sodium panel. Paired with a real light so it reads as the source. */
function lightPanel(seed: number, cool = false): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, cool ? "#a3e3ee" : "#f2d89a");
    cloud(c, 10, 64, 3);
    cells(c, (x) => {
      x.fillStyle = cool ? "#3a6979" : "#8a7038";
      x.fillRect(0, 0, CELL, 10);
      x.fillRect(0, CELL - 10, CELL, 10);
      x.fillStyle = "rgba(255,255,255,0.5)";
      x.fillRect(0, 42, CELL, 44);
      // Diffuser ribs.
      x.fillStyle = "rgba(0,0,0,0.08)";
      for (let rib = 8; rib < CELL; rib += 16) x.fillRect(rib, 10, 1, CELL - 20);
    });
    grain(c, 5, 1);
  });
}

/** Original station cladding: bevelled plates, vents and rubbed edges. */
function alloy(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#303d49");
    cells(c, (x) => {
      for (const y of [0, 64]) {
        x.fillStyle = "#73818a";
        x.fillRect(4, y + 4, 120, 56);
        x.fillStyle = "#566671";
        x.fillRect(8, y + 8, 112, 48);
        x.fillStyle = "#202c36";
        x.fillRect(8, y + 54, 112, 4);
        for (let vent = 76; vent < 112; vent += 6) x.fillRect(vent, y + 20, 3, 20);
        x.fillStyle = "#b4ac82";
        x.fillRect(16, y + 18, 24, 3);
        x.fillStyle = "#354550";
        x.fillRect(16, y + 28, 40, 16);
      }
    });
    rivets(c, 56, 10, "#adb4b1", "#27323b");
    cloud(c, 16, 96, 4);
    stains(c, 12, "#20262a", 40);
    drips(c, 12, "#29241c");
    grain(c, 6, 1);
  });
}

function deck(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#535f65");
    for (let y = 0; y < SIZE; y += 32) {
      c.ctx.fillStyle = "#252e35";
      c.ctx.fillRect(0, y, SIZE, 3);
      c.ctx.fillStyle = "#879093";
      c.ctx.fillRect(0, y + 3, SIZE, 1);
      for (let x = 8; x < SIZE; x += 16) {
        c.ctx.fillStyle = "#303b43";
        c.ctx.fillRect(x, y + 12, 8, 3);
        c.ctx.fillStyle = "#727e82";
        c.ctx.fillRect(x, y + 15, 8, 1);
      }
    }
    rivets(c, 32, 5, "#9ba29f", "#2b3338");
    cloud(c, 16, 96, 4);
    stains(c, 10, "#191e21", 52);
    grain(c, 7, 1);
  });
}

/** Hazard banding for ledges and doorframes — reads instantly at speed. */
function hazard(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#c8a032");
    c.ctx.fillStyle = "#22201c";
    for (let i = -SIZE; i < SIZE * 2; i += 32) {
      c.ctx.beginPath();
      c.ctx.moveTo(i, 0);
      c.ctx.lineTo(i + 16, 0);
      c.ctx.lineTo(i + 16 - SIZE, SIZE);
      c.ctx.lineTo(i - SIZE, SIZE);
      c.ctx.closePath();
      c.ctx.fill();
    }
    cloud(c, 20, 64, 4);
    stains(c, 12, "#1a1810", 44);
    grain(c, 9, 1);
  });
}

export type TextureKey =
  | "concrete" | "concrete_dark" | "metal" | "rust" | "grate" | "brick"
  | "sand" | "crate" | "tech" | "light" | "hazard" | "alloy" | "deck" | "light_cool" | "glass";

let cache: Map<TextureKey, THREE.CanvasTexture> | null = null;

export function textures(): Map<TextureKey, THREE.CanvasTexture> {
  if (cache) return cache;
  cache = new Map<TextureKey, THREE.CanvasTexture>([
    ["concrete", concrete(1337, "#6f7069")],
    ["concrete_dark", concrete(4242, "#4a4b46")],
    ["metal", metalPanel(77)],
    ["rust", rustedMetal(915)],
    ["grate", grate(31)],
    ["brick", brick(2024)],
    ["sand", sand(808)],
    ["crate", crate(511)],
    ["tech", techPanel(66)],
    ["light", lightPanel(9)],
    ["hazard", hazard(404)],
    ["alloy", alloy(702)],
    ["deck", deck(703)],
    ["light_cool", lightPanel(704, true)],
    ["glass", draw(705, (c) => {
      fill(c, "rgba(115,191,214,0.08)");
      // Faint rubbed streaks leave the space beyond the pane readable.
      c.ctx.strokeStyle = "rgba(207,237,244,0.07)";
      c.ctx.lineWidth = 1;
      for (const offset of [-64, 24, 108]) {
        c.ctx.beginPath();
        c.ctx.moveTo(offset, 16); c.ctx.lineTo(offset + 16, 64);
        c.ctx.stroke();
      }
      grain(c, 10, 1);
    })],
  ]);
  return cache;
}
