import * as THREE from "three";

// Procedural PSX-era textures. Everything is drawn to a small canvas with a
// seeded RNG, so the atlas is deterministic, diffable as source, and carries no
// licensing baggage. Nearest filtering and low resolution do the era work; the
// palette does the Quake work (rust, sodium light, sickly green, wet concrete).

const SIZE = 128;

/** World units per texture tile. GoldSrc-ish: one tile per 64u. */
export const TEXTURE_SCALE = 64;

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
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
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

/** Irregular dark blotches — water staining, soot, corrosion bloom. */
export function stains(c: Ctx, count: number, color: string, maxRadius: number): void {
  const SIZE = c.size;
  c.ctx.save();
  c.ctx.fillStyle = color;
  for (let i = 0; i < count; ++i) {
    const x = c.random() * SIZE;
    const y = c.random() * SIZE;
    const radius = maxRadius * (0.3 + c.random() * 0.7);
    c.ctx.globalAlpha = 0.05 + c.random() * 0.18;
    c.ctx.beginPath();
    // Wrap by drawing the blotch in all four offsets it could straddle.
    const offsets: Array<[number, number]> = [[0, 0], [SIZE, 0], [0, SIZE], [SIZE, SIZE]];
    for (const [ox, oy] of offsets) {
      c.ctx.moveTo(x - ox + radius, y - oy);
      c.ctx.arc(x - ox, y - oy, radius, 0, Math.PI * 2);
    }
    c.ctx.fill();
  }
  c.ctx.restore();
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
    grain(c, 34, 2);
    stains(c, 14, "#1a1a16", 30);
    drips(c, 10, "#15150f");
    // Faint panel seams on a 64px grid.
    c.ctx.strokeStyle = "rgba(0,0,0,0.28)";
    c.ctx.lineWidth = 1;
    c.ctx.beginPath();
    c.ctx.moveTo(0, 64.5); c.ctx.lineTo(SIZE, 64.5);
    c.ctx.moveTo(64.5, 0); c.ctx.lineTo(64.5, SIZE);
    c.ctx.stroke();
    grain(c, 12, 1);
  });
}

function metalPanel(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#5a5f60");
    grain(c, 26, 2);
    // Two plates with a recessed seam.
    c.ctx.fillStyle = "rgba(0,0,0,0.30)";
    c.ctx.fillRect(0, 62, SIZE, 4);
    c.ctx.fillStyle = "rgba(255,255,255,0.07)";
    c.ctx.fillRect(0, 66, SIZE, 1);
    rivets(c, 32, 8, "#8b9092", "#33383a");
    stains(c, 8, "#20211c", 24);
    drips(c, 7, "#3a2a18");
    grain(c, 10, 1);
  });
}

function rustedMetal(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#6b4a30");
    grain(c, 40, 2);
    stains(c, 22, "#31200f", 34);
    stains(c, 12, "#8c5a28", 22);
    drips(c, 16, "#2a1808");
    rivets(c, 40, 12, "#9a7048", "#2c1c0e");
    grain(c, 16, 1);
  });
}

function grate(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#2a2c2a");
    grain(c, 18, 2);
    c.ctx.fillStyle = "#585c58";
    for (let y = 0; y < SIZE; y += 16) c.ctx.fillRect(0, y, SIZE, 5);
    for (let x = 0; x < SIZE; x += 16) c.ctx.fillRect(x, 0, 5, SIZE);
    c.ctx.fillStyle = "rgba(0,0,0,0.45)";
    for (let y = 0; y < SIZE; y += 16) c.ctx.fillRect(0, y + 5, SIZE, 2);
    stains(c, 10, "#140f08", 20);
    grain(c, 14, 1);
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
        const shade = 0.75 + c.random() * 0.5;
        const r = Math.floor(108 * shade);
        const g = Math.floor(76 * shade);
        const b = Math.floor(58 * shade);
        c.ctx.fillStyle = `rgb(${r},${g},${b})`;
        c.ctx.fillRect(x + offset + 1, y + 1, width - 2, height - 2);
      }
    }
    grain(c, 26, 2);
    stains(c, 12, "#1c150c", 28);
    drips(c, 8, "#181109");
    grain(c, 10, 1);
  });
}

function sand(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#9a8558");
    grain(c, 30, 2);
    grain(c, 22, 1);
    stains(c, 16, "#6b5a34", 30);
  });
}

function crate(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#7a5a32");
    // Plank lines.
    c.ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let y = 0; y < SIZE; y += 21) c.ctx.fillRect(0, y, SIZE, 2);
    grain(c, 30, 1);
    // Metal banding at the edges.
    c.ctx.fillStyle = "#4a4640";
    c.ctx.fillRect(0, 0, SIZE, 8);
    c.ctx.fillRect(0, SIZE - 8, SIZE, 8);
    c.ctx.fillRect(0, 0, 8, SIZE);
    c.ctx.fillRect(SIZE - 8, 0, 8, SIZE);
    rivets(c, 28, 2, "#8a8680", "#26241f");
    stains(c, 8, "#241705", 20);
    grain(c, 12, 1);
  });
}

function techPanel(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#33383c");
    grain(c, 20, 2);
    // Vent louvres in the lower half.
    c.ctx.fillStyle = "#1a1e21";
    for (let y = 74; y < 118; y += 8) c.ctx.fillRect(12, y, SIZE - 24, 5);
    c.ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let y = 74; y < 118; y += 8) c.ctx.fillRect(12, y + 5, SIZE - 24, 1);
    // A recessed upper plate.
    c.ctx.strokeStyle = "rgba(0,0,0,0.5)";
    c.ctx.lineWidth = 2;
    c.ctx.strokeRect(12, 12, SIZE - 24, 48);
    c.ctx.strokeStyle = "rgba(255,255,255,0.05)";
    c.ctx.lineWidth = 1;
    c.ctx.strokeRect(13, 13, SIZE - 26, 46);
    rivets(c, 48, 6, "#7d8388", "#20252a");
    stains(c, 7, "#101318", 22);
    grain(c, 10, 1);
  });
}

/** Bright sodium panel. Paired with a real light so it reads as the source. */
function lightPanel(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#f2d89a");
    grain(c, 16, 2);
    c.ctx.fillStyle = "#8a7038";
    c.ctx.fillRect(0, 0, SIZE, 10);
    c.ctx.fillRect(0, SIZE - 10, SIZE, 10);
    c.ctx.fillStyle = "rgba(255,255,255,0.5)";
    c.ctx.fillRect(0, 42, SIZE, 44);
    grain(c, 8, 1);
  });
}

/** Hazard banding for ledges and doorframes — reads instantly at speed. */
function hazard(seed: number): THREE.CanvasTexture {
  return draw(seed, (c) => {
    fill(c, "#c8a032");
    c.ctx.fillStyle = "#22201c";
    c.ctx.save();
    c.ctx.translate(0, 0);
    for (let i = -SIZE; i < SIZE * 2; i += 32) {
      c.ctx.beginPath();
      c.ctx.moveTo(i, 0);
      c.ctx.lineTo(i + 16, 0);
      c.ctx.lineTo(i + 16 - SIZE, SIZE);
      c.ctx.lineTo(i - SIZE, SIZE);
      c.ctx.closePath();
      c.ctx.fill();
    }
    c.ctx.restore();
    grain(c, 26, 2);
    stains(c, 10, "#1a1810", 24);
    grain(c, 12, 1);
  });
}

export type TextureKey =
  | "concrete" | "concrete_dark" | "metal" | "rust" | "grate" | "brick"
  | "sand" | "crate" | "tech" | "light" | "hazard";

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
  ]);
  return cache;
}
