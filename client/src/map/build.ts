import * as THREE from "three";
import { TEXTURE_SCALE, textures, type TextureKey } from "../art/textures";
import { brushFaces, type Brush, type Face, type Vec3 } from "./brush";

// Brushes -> renderable geometry, with GoldSrc-style baked lightmaps.
//
// Light is baked at load time into one lightmap atlas, a luxel every 16u like
// the engine this is modelled on, and shadow-tested with the sim's own ray
// caster, so the lighting agrees with the collision geometry by construction.
// The remaster part is what the luxels hold: float overbrights, and ambient
// occlusion gathered from the same rays. Nothing here is gameplay: it decides
// how the map looks, never how it behaves.

export interface MapLight {
  pos: Vec3;
  color: [number, number, number];
  intensity: number;
  radius: number;
}

/** Ray cast into the collision world. Returns true if the segment is blocked. */
export type ShadowProbe = (from: Vec3, to: Vec3) => boolean;

/** World units per lightmap sample. */
const LUXEL = 16;
const ATLAS_WIDTH = 1024;
/** Diffuse wrap, standing in for bounce light. 0 = pure Lambert. */
const WRAP = 0.45;
/** How far an ambient-occlusion ray looks for a neighbouring surface. */
const AO_REACH = 56;
/** Ambient lost in a fully enclosed corner. */
const AO_STRENGTH = 0.7;
/** One crate face per this many units, so a 128u crate reads as one crate. */
const CRATE_SPAN = 112;

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function faceTriangles(face: Face): Tri[] {
  const out: Tri[] = [];
  for (let i = 1; i + 1 < face.points.length; ++i) {
    const tri = { a: face.points[0]!, b: face.points[i]!, c: face.points[i + 1]! };
    // Windings come out of the clipper counter-clockwise about the plane normal;
    // verify per triangle rather than trusting it, so a bad brush shows up as a
    // correct-facing triangle instead of an invisible one.
    const ab: Vec3 = [tri.b[0] - tri.a[0], tri.b[1] - tri.a[1], tri.b[2] - tri.a[2]];
    const ac: Vec3 = [tri.c[0] - tri.a[0], tri.c[1] - tri.a[1], tri.c[2] - tri.a[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    const facing = nx * face.normal[0] + ny * face.normal[1] + nz * face.normal[2];
    out.push(facing < 0 ? { a: tri.a, b: tri.c, c: tri.b } : tri);
  }
  return out;
}

/**
 * Quake's axial projection: the two world axes a face is flattened onto, and
 * the one it is dropped along. Texture and lightmap coordinates share it.
 */
function faceAxes(normal: Vec3): [s: number, t: number, drop: number] {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ay >= ax && ay >= az) return [0, 2, 1];
  if (ax >= az) return [2, 1, 0];
  return [0, 1, 2];
}

/** Where a face sits in the lightmap atlas, and the grid it samples on. */
interface Chart {
  s: number; t: number;
  sMin: number; tMin: number;
  width: number; height: number;
  x: number; y: number;
  /** Extent of the polygon itself, for fitting a texture to the face. */
  bounds: [number, number, number, number];
}

function chartFace(face: Face): Chart {
  const [s, t] = faceAxes(face.normal);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const point of face.points) {
    s0 = Math.min(s0, point[s]!); s1 = Math.max(s1, point[s]!);
    t0 = Math.min(t0, point[t]!); t1 = Math.max(t1, point[t]!);
  }
  const sMin = Math.floor(s0 / LUXEL) * LUXEL, tMin = Math.floor(t0 / LUXEL) * LUXEL;
  return {
    s, t, sMin, tMin,
    width: Math.ceil((s1 - sMin) / LUXEL) + 1,
    height: Math.ceil((t1 - tMin) / LUXEL) + 1,
    x: 0, y: 0, bounds: [s0, s1, t0, t1],
  };
}

/** Shelf-pack every chart into the atlas; returns the height used. */
function packCharts(charts: Chart[]): number {
  let x = 0, y = 0, shelf = 0;
  for (const chart of [...charts].sort((a, b) => b.height - a.height)) {
    if (x + chart.width > ATLAS_WIDTH) {
      x = 0; y += shelf; shelf = 0;
    }
    chart.x = x; chart.y = y;
    x += chart.width;
    shelf = Math.max(shelf, chart.height);
  }
  return y + shelf;
}

function insideAnyBrush(point: Vec3, brushes: Brush[]): boolean {
  search: for (const brush of brushes) {
    for (const plane of brush.planes) {
      if (plane.n[0] * point[0] + plane.n[1] * point[1] + plane.n[2] * point[2] > plane.d) {
        continue search;
      }
    }
    return true;
  }
  return false;
}

/** Six directions tilted off the normal: enough to find a wall, a floor, a corner. */
function occlusionRays(normal: Vec3): Vec3[] {
  const [s, t] = faceAxes(normal);
  const u: Vec3 = [0, 0, 0], v: Vec3 = [0, 0, 0];
  u[s] = 1; v[t] = 1;
  const rays: Vec3[] = [];
  for (let i = 0; i < 6; ++i) {
    const angle = (i / 6) * Math.PI * 2 + 0.3, cos = Math.cos(angle), sin = Math.sin(angle);
    rays.push([
      (normal[0] * 0.5 + (u[0] * cos + v[0] * sin) * 0.87) * AO_REACH,
      (normal[1] * 0.5 + (u[1] * cos + v[1] * sin) * 0.87) * AO_REACH,
      (normal[2] * 0.5 + (u[2] * cos + v[2] * sin) * 0.87) * AO_REACH,
    ]);
  }
  return rays;
}

function bakeLuxel(
  origin: Vec3, normal: Vec3, rays: Vec3[], lights: MapLight[],
  ambient: [number, number, number], probe: ShadowProbe,
): [number, number, number] {
  // Ambient occlusion: what fraction of the open hemisphere is close geometry.
  let blocked = 0;
  for (const ray of rays) {
    if (probe(origin, [origin[0] + ray[0], origin[1] + ray[1], origin[2] + ray[2]])) ++blocked;
  }
  const open = 1 - AO_STRENGTH * (blocked / rays.length);
  let r = ambient[0] * open;
  let g = ambient[1] * open;
  let b = ambient[2] * open;

  for (const light of lights) {
    const dx = light.pos[0] - origin[0];
    const dy = light.pos[1] - origin[1];
    const dz = light.pos[2] - origin[2];
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq > light.radius * light.radius) continue;

    const distance = Math.sqrt(distanceSq);
    if (distance < 1e-3) continue;
    const ndotl = (dx * normal[0] + dy * normal[1] + dz * normal[2]) / distance;
    // Wrapped diffuse: a real lightmap picks up bounce, and without some of it
    // every downward-facing surface (every ceiling, lit from the ceiling) bakes
    // to pure black.
    const wrapped = (ndotl + WRAP) / (1 + WRAP);
    if (wrapped <= 0) continue;

    const falloff = 1 - distance / light.radius;
    // Corners hold a little less of the bounce that the wrap stands in for.
    const energy = wrapped * falloff * falloff * light.intensity * (0.6 + 0.4 * open);
    if (energy < 0.004) continue; // too dim to be worth a shadow ray
    if (probe(origin, light.pos)) continue;

    r += light.color[0] * energy;
    g += light.color[1] * energy;
    b += light.color[2] * energy;
  }
  return [Math.min(r, 1.6), Math.min(g, 1.6), Math.min(b, 1.6)];
}

/**
 * Light one face's luxel grid into the atlas. Samples that land inside another
 * brush — under a crate, behind a wall that butts into this face — would bake
 * as lit or black at random, so they borrow from their valid neighbours.
 */
function bakeChart(
  face: Face, chart: Chart, atlas: Float32Array, brushes: Brush[], lights: MapLight[],
  ambient: [number, number, number], probe: ShadowProbe,
): void {
  const { s, t, width, height } = chart;
  const drop = faceAxes(face.normal)[2];
  const n = face.normal, first = face.points[0]!;
  const d = n[0] * first[0] + n[1] * first[1] + n[2] * first[2];
  const rays = occlusionRays(n);
  const valid = new Uint8Array(width * height);
  const [s0, s1, t0, t1] = chart.bounds;

  for (let j = 0; j < height; ++j) {
    for (let i = 0; i < width; ++i) {
      // Pull edge samples just inside the face so they do not sit in a seam.
      const point: Vec3 = [0, 0, 0];
      point[s] = Math.min(Math.max(chart.sMin + i * LUXEL, s0 + 1), s1 - 1);
      point[t] = Math.min(Math.max(chart.tMin + j * LUXEL, t0 + 1), t1 - 1);
      point[drop] = (d - n[s]! * point[s]! - n[t]! * point[t]!) / n[drop]!;
      // Lift the sample off the surface so it doesn't shadow-test against itself.
      const origin: Vec3 = [point[0] + n[0] * 1.5, point[1] + n[1] * 1.5, point[2] + n[2] * 1.5];
      if (insideAnyBrush(origin, brushes)) continue;
      const colour = bakeLuxel(origin, n, rays, lights, ambient, probe);
      const at = ((chart.y + j) * ATLAS_WIDTH + chart.x + i) * 3;
      atlas[at] = colour[0]; atlas[at + 1] = colour[1]; atlas[at + 2] = colour[2];
      valid[j * width + i] = 1;
    }
  }

  for (let pass = 0; pass < 3; ++pass) {
    const filled: number[] = [];
    for (let j = 0; j < height; ++j) {
      for (let i = 0; i < width; ++i) {
        if (valid[j * width + i]) continue;
        let r = 0, g = 0, b = 0, count = 0;
        for (let dj = -1; dj <= 1; ++dj) {
          for (let di = -1; di <= 1; ++di) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= width || nj >= height || !valid[nj * width + ni]) continue;
            const from = ((chart.y + nj) * ATLAS_WIDTH + chart.x + ni) * 3;
            r += atlas[from]!; g += atlas[from + 1]!; b += atlas[from + 2]!;
            ++count;
          }
        }
        if (count === 0) continue;
        const at = ((chart.y + j) * ATLAS_WIDTH + chart.x + i) * 3;
        atlas[at] = r / count; atlas[at + 1] = g / count; atlas[at + 2] = b / count;
        filled.push(j * width + i);
      }
    }
    if (filled.length === 0) break;
    for (const index of filled) valid[index] = 1;
  }
}

/**
 * Irradiance at an arbitrary point, used to sit dynamic objects (players,
 * viewmodel) inside the baked lighting instead of floating above it.
 * Normal-agnostic — it is a tint, not a second bake. With a `probe`, lights
 * the point cannot see are skipped, so a body behind a wall stays in its shadow.
 */
export function sampleLight(pos: Vec3, lights: MapLight[], ambient: [number, number, number],
                            probe?: ShadowProbe): [number, number, number] {
  let r = ambient[0];
  let g = ambient[1];
  let b = ambient[2];
  for (const light of lights) {
    const dx = light.pos[0] - pos[0];
    const dy = light.pos[1] - pos[1];
    const dz = light.pos[2] - pos[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= light.radius) continue;
    const falloff = 1 - distance / light.radius;
    const energy = falloff * falloff * light.intensity * 0.75;
    if (probe && energy > 0.02 && probe(pos, light.pos)) continue;
    r += light.color[0] * energy;
    g += light.color[1] * energy;
    b += light.color[2] * energy;
  }
  return [Math.min(r, 1.5), Math.min(g, 1.5), Math.min(b, 1.5)];
}

export interface BuiltMap {
  meshes: THREE.Mesh[];
  shadowRays: number;
}

export function buildMapGeometry(
  brushes: Brush[], lights: MapLight[], ambient: [number, number, number],
  probe: ShadowProbe,
): BuiltMap {
  const atlas = textures();
  const groups = new Map<string, {
    positions: number[]; normals: number[]; uvs: number[]; lightUvs: number[];
  }>();
  let shadowRays = 0;

  const countingProbe: ShadowProbe = (from, to) => {
    ++shadowRays;
    return probe(from, to);
  };

  // Light panels and glass glow on their own; everything else gets a chart.
  const emission: Record<string, Vec3> = {
    light: [1.35, 1.28, 1.05], light_cool: [1.05, 1.28, 1.35], glass: [1, 1, 1],
  };
  const faces = brushes.flatMap((brush) => brushFaces(brush));
  const charts = faces.map((face) => (emission[face.tex] ? null : chartFace(face)));
  const atlasHeight = packCharts(charts.filter((chart) => chart !== null));
  const luxels = new Float32Array(ATLAS_WIDTH * atlasHeight * 3);

  for (const [index, face] of faces.entries()) {
    let group = groups.get(face.tex);
    if (!group) {
      group = { positions: [], normals: [], uvs: [], lightUvs: [] };
      groups.set(face.tex, group);
    }
    const chart = charts[index] ?? null;
    if (chart) bakeChart(face, chart, luxels, brushes, lights, ambient, countingProbe);

    const [s, t] = faceAxes(face.normal);
    // A crate texture is one whole crate, so fit it to the face instead of
    // letting the world grid cut it wherever the brush happens to sit.
    const fit = face.tex === "crate" && chart ? chart.bounds : null;
    for (const tri of faceTriangles(face)) {
      for (const point of [tri.a, tri.b, tri.c]) {
        group.positions.push(point[0], point[1], point[2]);
        group.normals.push(face.normal[0], face.normal[1], face.normal[2]);
        if (fit) {
          const across = fit[1] - fit[0], up = fit[3] - fit[2];
          group.uvs.push(
            (point[s]! - fit[0]) / across * Math.max(1, Math.round(across / CRATE_SPAN)),
            -(point[t]! - fit[2]) / up * Math.max(1, Math.round(up / CRATE_SPAN)),
          );
        } else {
          group.uvs.push(point[s]! / TEXTURE_SCALE, (t === 1 ? -1 : 1) * point[t]! / TEXTURE_SCALE);
        }
        if (chart) {
          // Luxels are sampled at their centres, so a face never reads its neighbour's.
          group.lightUvs.push(
            (chart.x + 0.5 + (point[s]! - chart.sMin) / LUXEL) / ATLAS_WIDTH,
            (chart.y + 0.5 + (point[t]! - chart.tMin) / LUXEL) / atlasHeight,
          );
        } else {
          group.lightUvs.push(0, 0);
        }
      }
    }
  }

  // Half floats keep the overbrights that make a light pool look hot.
  const pixels = new Uint16Array(ATLAS_WIDTH * atlasHeight * 4);
  for (let i = 0; i < ATLAS_WIDTH * atlasHeight; ++i) {
    for (let k = 0; k < 3; ++k) pixels[i * 4 + k] = THREE.DataUtils.toHalfFloat(luxels[i * 3 + k]!);
    pixels[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const lightMap = new THREE.DataTexture(pixels, ATLAS_WIDTH, atlasHeight, THREE.RGBAFormat,
    THREE.HalfFloatType);
  lightMap.magFilter = THREE.LinearFilter;
  lightMap.minFilter = THREE.LinearFilter;
  lightMap.channel = 1;
  lightMap.needsUpdate = true;

  const meshes: THREE.Mesh[] = [];
  for (const [tex, group] of groups) {
    if (group.positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position",
      new THREE.BufferAttribute(new Float32Array(group.positions), 3));
    geometry.setAttribute("normal",
      new THREE.BufferAttribute(new Float32Array(group.normals), 3));
    geometry.setAttribute("uv",
      new THREE.BufferAttribute(new Float32Array(group.uvs), 2));
    geometry.setAttribute("uv1",
      new THREE.BufferAttribute(new Float32Array(group.lightUvs), 2));
    geometry.computeBoundingSphere();

    const glow = emission[tex];
    const material = new THREE.MeshBasicMaterial({
      map: atlas.get(tex as TextureKey) ?? null,
      transparent: tex === "glass",
      depthWrite: tex !== "glass",
    });
    if (glow) material.color.setRGB(...glow);
    else {
      material.lightMap = lightMap;
      // The basic material divides a lightmap by pi; the bake is already final.
      material.lightMapIntensity = Math.PI;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.name = `world:${tex}`;
    meshes.push(mesh);
  }
  return { meshes, shadowRays };
}
