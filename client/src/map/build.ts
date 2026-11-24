import * as THREE from "three";
import { clonePropModel, getDetailTexture } from "../art/loader";
import { mapDecalTexture, TEXTURE_SCALE, textures, type TextureKey } from "../art/textures";
import { brushFaces, dot, type Brush, type Face, type Vec3 } from "./brush";
import type { MapDecalDef, PropDef, SunLight } from "./mapdef";
import type { TraceHit } from "../sim";

// Brushes -> renderable geometry, with GoldSrc/Source-style baked radiosity
// lightmaps (M2 Lighting Quality Buff):
//
// - 12u luxel grid packed into a 2048px-wide half-float atlas with 1px gutters
//   and border extrusion so bilinear sampling never bleeds across seams.
// - 4-sample jittered solar disc penumbra for soft `light_environment` sun shadows.
// - 8-ray stratified hemisphere gather (via `sim_trace_ray`) computing smooth
//   distance-weighted contact AO, continuous sky visibility, and 2-bounce
//   color-bleeding radiosity from sunlit/lit surfaces.
// - Edge-preserving cross-bilateral luxel denoise within each chart.
// - Shared real-time dynamic muzzle-flash (`dlight`) uniforms injected into the
//   world shader alongside GoldSrc `r_detailtextures`.

export interface MapLight {
  pos: Vec3;
  color: [number, number, number];
  intensity: number;
  radius: number;
}

/** Ray cast into the collision world. Returns true if the segment is blocked. */
export type ShadowProbe = (from: Vec3, to: Vec3) => boolean;
/** Full ray trace returning impact point, normal and material, or null on miss. */
export type RayTracer = (from: Vec3, to: Vec3) => TraceHit | null;

/** World units per lightmap sample (12u gives crisp architectural shadows). */
const LUXEL = 12;
const ATLAS_WIDTH = 2048;
/** 1px gutter around every chart prevents bilinear edge bleed across faces. */
const CHART_PAD = 1;
const SUN_RAY_DIST = 6144;
const SKY_RAY_DIST = 2400;
/** Angular radius of the solar disc (radians) for soft sun shadow penumbras. */
const SUN_SPREAD = 0.042;
const SUN_SAMPLES = 4;
/** Diffuse wrap for direct point lights; kept modest now that true radiosity handles bounce. */
const WRAP = 0.25;
/** Contact ambient occlusion reach (units) and strength. */
const AO_REACH = 68;
const AO_STRENGTH = 0.62;
/** Radiosity bounce energy multipliers (1st and 2nd bounce). */
const BOUNCE1_GAIN = 0.92;
const BOUNCE2_GAIN = 0.55;
/** One crate face per this many units, so a 128u crate reads as one crate. */
const CRATE_SPAN = 112;

/** Number of simultaneous dynamic world muzzle-flash lights (`dlight` pool). */
export const MAX_WORLD_FLASHES = 4;

/** Shared uniform block updated per frame by Renderer for world dynamic flashes. */
export interface WorldFlashUniforms {
  positions: THREE.Vector3[];
  colors: THREE.Vector3[];
}

export function createWorldFlashUniforms(): WorldFlashUniforms {
  return {
    positions: Array.from({ length: MAX_WORLD_FLASHES }, () => new THREE.Vector3(0, -99999, 0)),
    colors: Array.from({ length: MAX_WORLD_FLASHES }, () => new THREE.Vector3(0, 0, 0)),
  };
}

/**
 * Representative diffuse reflectance per texture, driving real color-bleeding
 * radiosity (warm ochre bounce off sunlit sand/plaster, terracotta off brick).
 */
const TEX_ALBEDO: Record<string, [number, number, number]> = {
  sand: [0.76, 0.65, 0.46],
  sandstone: [0.74, 0.60, 0.40],
  dust_wall: [0.74, 0.58, 0.39],
  plaster: [0.76, 0.66, 0.50],
  brick: [0.56, 0.30, 0.22],
  crate: [0.52, 0.38, 0.24],
  crate_wood: [0.56, 0.42, 0.26],
  wood: [0.46, 0.33, 0.20],
  wood_door: [0.40, 0.28, 0.18],
  concrete: [0.52, 0.52, 0.49],
  concrete_dark: [0.32, 0.33, 0.32],
  industrial_wall: [0.58, 0.57, 0.52],
  asphalt: [0.28, 0.29, 0.31],
  metal: [0.44, 0.46, 0.48],
  rust: [0.50, 0.32, 0.20],
  corrugated: [0.44, 0.36, 0.30],
  shutter: [0.42, 0.35, 0.28],
  grate: [0.34, 0.35, 0.34],
  container: [0.36, 0.44, 0.52],
  alloy: [0.48, 0.55, 0.62],
  deck: [0.36, 0.41, 0.45],
  tech: [0.36, 0.40, 0.44],
  hazard: [0.68, 0.54, 0.18],
  light: [1.35, 1.25, 0.98],
  light_cool: [0.98, 1.25, 1.38],
};

function albedoOf(tex: string): [number, number, number] {
  return TEX_ALBEDO[tex] ?? [0.5, 0.5, 0.5];
}

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function faceTriangles(face: Face): Tri[] {
  const out: Tri[] = [];
  for (let i = 1; i + 1 < face.points.length; ++i) {
    const tri = { a: face.points[0]!, b: face.points[i]!, c: face.points[i + 1]! };
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

/** Deterministic low-discrepancy hash in [0, 1) for per-luxel jitter rotation. */
function hash2(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Build an orthonormal tangent basis `(u, v)` perpendicular to unit normal `n`. */
function tangentBasis(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const ux = n[1] * ref[2] - n[2] * ref[1];
  const uy = n[2] * ref[0] - n[0] * ref[2];
  const uz = n[0] * ref[1] - n[1] * ref[0];
  const uLen = Math.hypot(ux, uy, uz) || 1;
  const u: Vec3 = [ux / uLen, uy / uLen, uz / uLen];
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return [u, v];
}

/** Where a face sits in the lightmap atlas, and the grid it samples on. */
interface Chart {
  s: number; t: number;
  sMin: number; tMin: number;
  width: number; height: number;
  x: number; y: number;
  /** Extent of the polygon itself, for fitting a texture to the face. */
  bounds: [number, number, number, number];
  /** World-space AABB of this face for fast radiosity hit lookup. */
  min: Vec3;
  max: Vec3;
  planeD: number;
  normal: Vec3;
  albedo: [number, number, number];
  valid: Uint8Array;
}

function chartFace(face: Face): Chart {
  const [s, t] = faceAxes(face.normal);
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of face.points) {
    s0 = Math.min(s0, point[s]!); s1 = Math.max(s1, point[s]!);
    t0 = Math.min(t0, point[t]!); t1 = Math.max(t1, point[t]!);
    for (let k = 0; k < 3; ++k) {
      min[k] = Math.min(min[k]!, point[k]!);
      max[k] = Math.max(max[k]!, point[k]!);
    }
  }
  const sMin = Math.floor(s0 / LUXEL) * LUXEL, tMin = Math.floor(t0 / LUXEL) * LUXEL;
  const width = Math.ceil((s1 - sMin) / LUXEL) + 1;
  const height = Math.ceil((t1 - tMin) / LUXEL) + 1;
  const first = face.points[0]!;
  const planeD = face.normal[0] * first[0] + face.normal[1] * first[1] + face.normal[2] * first[2];
  return {
    s, t, sMin, tMin, width, height,
    x: 0, y: 0,
    bounds: [s0, s1, t0, t1],
    min, max, planeD,
    normal: face.normal,
    albedo: albedoOf(face.tex),
    valid: new Uint8Array(width * height),
  };
}

/** Shelf-pack every chart into the atlas with 1px gutters; returns the height used. */
function packCharts(charts: Chart[]): number {
  let x = CHART_PAD, y = CHART_PAD, shelf = 0;
  for (const chart of [...charts].sort((a, b) => b.height - a.height)) {
    if (x + chart.width + CHART_PAD > ATLAS_WIDTH) {
      x = CHART_PAD; y += shelf + CHART_PAD; shelf = 0;
    }
    chart.x = x; chart.y = y;
    x += chart.width + CHART_PAD;
    shelf = Math.max(shelf, chart.height);
  }
  return Math.max(16, y + shelf + CHART_PAD);
}

interface BrushAabb {
  brush: Brush;
  min: Vec3;
  max: Vec3;
}

function buildBrushAabbs(brushes: Brush[]): BrushAabb[] {
  const out: BrushAabb[] = [];
  for (const brush of brushes) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const face of brushFaces(brush)) {
      for (const p of face.points) {
        for (let k = 0; k < 3; ++k) {
          if (p[k]! < min[k]!) min[k] = p[k]!;
          if (p[k]! > max[k]!) max[k] = p[k]!;
        }
      }
    }
    if (min[0] <= max[0]) out.push({ brush, min, max });
  }
  return out;
}

function insideAnyBrush(point: Vec3, aabbs: BrushAabb[]): boolean {
  search: for (const { brush, min, max } of aabbs) {
    if (point[0] < min[0] || point[0] > max[0] ||
        point[1] < min[1] || point[1] > max[1] ||
        point[2] < min[2] || point[2] > max[2]) {
      continue;
    }
    for (const plane of brush.planes) {
      if (plane.n[0] * point[0] + plane.n[1] * point[1] + plane.n[2] * point[2] > plane.d) {
        continue search;
      }
    }
    return true;
  }
  return false;
}

/**
 * 8 stratified cosine-weighted hemisphere directions around `normal`, rotated
 * by `spin` radians per luxel so jitter never aligns into grid banding.
 */
const HEMI_RINGS: ReadonlyArray<[elevCos: number, elevSin: number, azimuthOffset: number]> = [
  // Lower ring (4 rays at ~26° elevation — catches nearby walls & floor bounce)
  [0.898, 0.44, 0.0],
  [0.898, 0.44, Math.PI * 0.5],
  [0.898, 0.44, Math.PI],
  [0.898, 0.44, Math.PI * 1.5],
  // Upper ring (4 rays at ~62° elevation — catches open sky & ceiling bounce)
  [0.47, 0.883, Math.PI * 0.25],
  [0.47, 0.883, Math.PI * 0.75],
  [0.47, 0.883, Math.PI * 1.25],
  [0.47, 0.883, Math.PI * 1.75],
];

/** 4-point Vogel disc offsets for soft solar penumbra sampling. */
const SUN_DISC: ReadonlyArray<[number, number]> = [
  [0.42, 0.25],
  [-0.38, 0.46],
  [-0.45, -0.34],
  [0.36, -0.44],
];

/**
 * Spatial index over lightmap charts partitioned by dominant face normal
 * (+X, -X, +Y, -Y, +Z, -Z, sloped). Axial buckets are sorted by `planeD` so
 * radiosity hit lookup runs in O(log N) instead of scanning every face.
 */
interface ChartIndex {
  axial: Chart[][];
  sloped: Chart[];
}

function normalBucket(n: Vec3): number {
  if (n[0] > 0.985) return 0;
  if (n[0] < -0.985) return 1;
  if (n[1] > 0.985) return 2;
  if (n[1] < -0.985) return 3;
  if (n[2] > 0.985) return 4;
  if (n[2] < -0.985) return 5;
  return 6;
}

function buildChartIndex(charts: Chart[]): ChartIndex {
  const axial: Chart[][] = [[], [], [], [], [], []];
  const sloped: Chart[] = [];
  for (const chart of charts) {
    const b = normalBucket(chart.normal);
    if (b < 6) axial[b]!.push(chart);
    else sloped.push(chart);
  }
  for (const bucket of axial) bucket.sort((a, b) => a.planeD - b.planeD);
  return { axial, sloped };
}

function matchChart(chart: Chart, point: Vec3, normal: Vec3, eps: number): {
  luxelIdx: number; albedo: [number, number, number];
} | null {
  if (point[0] < chart.min[0] - eps || point[0] > chart.max[0] + eps ||
      point[1] < chart.min[1] - eps || point[1] > chart.max[1] + eps ||
      point[2] < chart.min[2] - eps || point[2] > chart.max[2] + eps) {
    return null;
  }
  const align = chart.normal[0] * normal[0] + chart.normal[1] * normal[1] + chart.normal[2] * normal[2];
  if (align < 0.88) return null;
  const planeDist = Math.abs(
    chart.normal[0] * point[0] + chart.normal[1] * point[1] + chart.normal[2] * point[2] - chart.planeD,
  );
  if (planeDist > eps) return null;
  const i = Math.max(0, Math.min(chart.width - 1, Math.round((point[chart.s]! - chart.sMin) / LUXEL)));
  const j = Math.max(0, Math.min(chart.height - 1, Math.round((point[chart.t]! - chart.tMin) / LUXEL)));
  return {
    luxelIdx: (chart.y + j) * ATLAS_WIDTH + chart.x + i,
    albedo: chart.albedo,
  };
}

/**
 * Find the chart + atlas luxel index hit by a radiosity gather ray.
 */
function lookupHitLuxel(
  point: Vec3, normal: Vec3, index: ChartIndex,
): { luxelIdx: number; albedo: [number, number, number] } | null {
  const eps = 3.5;
  const b = normalBucket(normal);
  if (b < 6) {
    const bucket = index.axial[b]!;
    const axis = b >> 1;
    const sign = (b & 1) === 0 ? 1 : -1;
    const targetD = sign * point[axis]!;
    // Binary search for first chart with planeD >= targetD - eps.
    let lo = 0, hi = bucket.length;
    const minD = targetD - eps;
    const maxD = targetD + eps;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (bucket[mid]!.planeD < minD) lo = mid + 1;
      else hi = mid;
    }
    for (let k = lo; k < bucket.length; ++k) {
      const chart = bucket[k]!;
      if (chart.planeD > maxD) break;
      const hit = matchChart(chart, point, normal, eps);
      if (hit) return hit;
    }
  }
  for (const chart of index.sloped) {
    const hit = matchChart(chart, point, normal, eps);
    if (hit) return hit;
  }
  return null;
}

/** Cached hemisphere gather links per luxel (up to 8 hit luxel indices + albedo weights). */
interface GatherRecord {
  luxelIdx: number;
  hits: Array<{ targetIdx: number; weight: number; ar: number; ag: number; ab: number }>;
}

/**
 * Pass 1: Direct light (soft 4-sample sun + point lights) + 8-ray hemisphere
 * gather for distance-weighted contact AO, continuous sky visibility, and
 * cached surface links for 2-bounce radiosity.
 */
function bakeChartDirect(
  face: Face, chart: Chart, directAtlas: Float32Array, aabbs: BrushAabb[],
  chartIndex: ChartIndex, lights: MapLight[], ambient: [number, number, number],
  probe: ShadowProbe, trace: RayTracer | undefined, sun: SunLight | undefined,
  gathers: GatherRecord[],
): void {
  const { s, t, width, height } = chart;
  const drop = faceAxes(face.normal)[2];
  const n = face.normal;
  const d = chart.planeD;
  const [uTan, vTan] = tangentBasis(n);
  const [sunU, sunV] = sun ? tangentBasis(sun.dir) : [uTan, vTan];
  const [s0, s1, t0, t1] = chart.bounds;
  const seed = Math.round(chart.x * 31 + chart.y * 17);

  for (let j = 0; j < height; ++j) {
    for (let i = 0; i < width; ++i) {
      const point: Vec3 = [0, 0, 0];
      point[s] = Math.min(Math.max(chart.sMin + i * LUXEL, s0 + 0.75), s1 - 0.75);
      point[t] = Math.min(Math.max(chart.tMin + j * LUXEL, t0 + 0.75), t1 - 0.75);
      point[drop] = (d - n[s]! * point[s]! - n[t]! * point[t]!) / n[drop]!;
      const origin: Vec3 = [point[0] + n[0] * 1.5, point[1] + n[1] * 1.5, point[2] + n[2] * 1.5];
      if (insideAnyBrush(origin, aabbs)) continue;

      const spin = hash2(i, j, seed) * Math.PI * 2;
      const cosSpin = Math.cos(spin), sinSpin = Math.sin(spin);

      // 8-ray stratified hemisphere gather: smooth contact AO + sky visibility + bounce links.
      let aoOcclusion = 0;
      let skyVis = 0;
      const hits: GatherRecord["hits"] = [];

      for (const [eCos, eSin, azOff] of HEMI_RINGS) {
        const az = azOff + spin;
        const ca = Math.cos(az), sa = Math.sin(az);
        const rx = n[0] * eSin + (uTan[0] * ca + vTan[0] * sa) * eCos;
        const ry = n[1] * eSin + (uTan[1] * ca + vTan[1] * sa) * eCos;
        const rz = n[2] * eSin + (uTan[2] * ca + vTan[2] * sa) * eCos;
        const end: Vec3 = [
          origin[0] + rx * SKY_RAY_DIST,
          origin[1] + ry * SKY_RAY_DIST,
          origin[2] + rz * SKY_RAY_DIST,
        ];

        if (trace) {
          const hit = trace(origin, end);
          if (!hit) {
            // Unobstructed ray into the upper hemisphere sees the open sky.
            if (ry > 0.05) skyVis += 0.5 + 0.5 * ry;
          } else {
            const dist = Math.hypot(
              hit.point[0] - origin[0], hit.point[1] - origin[1], hit.point[2] - origin[2],
            );
            if (dist < AO_REACH) {
              const near = 1 - dist / AO_REACH;
              aoOcclusion += near * near;
            }
            // Record visible hit surface for multi-bounce radiosity gather.
            if (dist > 1.0 && dist < 1400) {
              const matched = lookupHitLuxel(hit.point, hit.normal, chartIndex);
              if (matched) {
                // Distance gently rolls off very far bounces while preserving room color bleed.
                const weight = (1 / HEMI_RINGS.length) * (1 / (1 + dist * 0.0008));
                hits.push({
                  targetIdx: matched.luxelIdx,
                  weight,
                  ar: matched.albedo[0],
                  ag: matched.albedo[1],
                  ab: matched.albedo[2],
                });
              }
            }
          }
        } else {
          // Fallback when only boolean shadow probe is supplied.
          const aoEnd: Vec3 = [origin[0] + rx * AO_REACH, origin[1] + ry * AO_REACH, origin[2] + rz * AO_REACH];
          if (probe(origin, aoEnd)) aoOcclusion += 1;
          else if (ry > 0.05 && !probe(origin, end)) skyVis += 0.5 + 0.5 * ry;
        }
      }

      const open = 1 - AO_STRENGTH * Math.min(1, aoOcclusion / (HEMI_RINGS.length * 0.65));
      const skyFrac = Math.min(1, skyVis / (HEMI_RINGS.length * 0.52));

      let r = ambient[0] * open;
      let g = ambient[1] * open;
      let b = ambient[2] * open;

      if (sun) {
        // Continuous sky dome fill: bright cool blue outdoors, smoothly fading inside tunnels.
        if (skyFrac > 0.005) {
          const skyE = skyFrac * sun.skyIntensity * (0.6 + 0.4 * open);
          r += sun.skyColor[0] * skyE;
          g += sun.skyColor[1] * skyE;
          b += sun.skyColor[2] * skyE;
        }

        // 4-sample jittered solar disc penumbra for soft architectural shadows.
        const sunNdotL = n[0] * sun.dir[0] + n[1] * sun.dir[1] + n[2] * sun.dir[2];
        if (sunNdotL > 0.01) {
          let litSamples = 0;
          for (let k = 0; k < SUN_SAMPLES; ++k) {
            const [ox, oy] = SUN_DISC[k]!;
            const jx = (ox * cosSpin - oy * sinSpin) * SUN_SPREAD;
            const jy = (ox * sinSpin + oy * cosSpin) * SUN_SPREAD;
            const dx = sun.dir[0] + sunU[0] * jx + sunV[0] * jy;
            const dy = sun.dir[1] + sunU[1] * jx + sunV[1] * jy;
            const dz = sun.dir[2] + sunU[2] * jx + sunV[2] * jy;
            const target: Vec3 = [
              origin[0] + dx * SUN_RAY_DIST,
              origin[1] + dy * SUN_RAY_DIST,
              origin[2] + dz * SUN_RAY_DIST,
            ];
            if (!probe(origin, target)) ++litSamples;
          }
          if (litSamples > 0) {
            const direct = sunNdotL * sun.intensity * (litSamples / SUN_SAMPLES) * (0.82 + 0.18 * open);
            r += sun.color[0] * direct;
            g += sun.color[1] * direct;
            b += sun.color[2] * direct;
          }
        }
      }

      for (const light of lights) {
        const dx = light.pos[0] - origin[0];
        const dy = light.pos[1] - origin[1];
        const dz = light.pos[2] - origin[2];
        const distanceSq = dx * dx + dy * dy + dz * dz;
        if (distanceSq > light.radius * light.radius) continue;

        const distance = Math.sqrt(distanceSq);
        if (distance < 1e-3) continue;
        const ndotl = (dx * n[0] + dy * n[1] + dz * n[2]) / distance;
        const wrapped = (ndotl + WRAP) / (1 + WRAP);
        if (wrapped <= 0) continue;

        const falloff = 1 - distance / light.radius;
        const energy = wrapped * falloff * falloff * light.intensity * (0.65 + 0.35 * open);
        if (energy < 0.004) continue;
        if (probe(origin, light.pos)) continue;

        r += light.color[0] * energy;
        g += light.color[1] * energy;
        b += light.color[2] * energy;
      }

      const luxelIdx = (chart.y + j) * ATLAS_WIDTH + chart.x + i;
      const at = luxelIdx * 3;
      directAtlas[at] = Math.min(r, 2.2);
      directAtlas[at + 1] = Math.min(g, 2.2);
      directAtlas[at + 2] = Math.min(b, 2.2);
      chart.valid[j * width + i] = 1;
      if (hits.length > 0) gathers.push({ luxelIdx, hits });
    }
  }
}

/**
 * Fill invalid luxels (samples that fell inside adjoining solids) from valid
 * neighbours, then extrude the chart's outer edge into its 1px gutter so
 * bilinear filtering never samples black padding.
 */
function dilateAndPadChart(chart: Chart, atlas: Float32Array, atlasHeight: number): void {
  const { width, height } = chart;
  const valid = new Uint8Array(chart.valid);

  for (let pass = 0; pass < 4; ++pass) {
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

  // Extrude chart borders by 1px into the surrounding gutter.
  const copyPx = (sx: number, sy: number, dx: number, dy: number) => {
    if (dx < 0 || dy < 0 || dx >= ATLAS_WIDTH || dy >= atlasHeight) return;
    const sAt = (sy * ATLAS_WIDTH + sx) * 3;
    const dAt = (dy * ATLAS_WIDTH + dx) * 3;
    atlas[dAt] = atlas[sAt]!;
    atlas[dAt + 1] = atlas[sAt + 1]!;
    atlas[dAt + 2] = atlas[sAt + 2]!;
  };
  for (let i = 0; i < width; ++i) {
    copyPx(chart.x + i, chart.y, chart.x + i, chart.y - 1);
    copyPx(chart.x + i, chart.y + height - 1, chart.x + i, chart.y + height);
  }
  for (let j = 0; j < height; ++j) {
    copyPx(chart.x, chart.y + j, chart.x - 1, chart.y + j);
    copyPx(chart.x + width - 1, chart.y + j, chart.x + width, chart.y + j);
  }
  copyPx(chart.x, chart.y, chart.x - 1, chart.y - 1);
  copyPx(chart.x + width - 1, chart.y, chart.x + width, chart.y - 1);
  copyPx(chart.x, chart.y + height - 1, chart.x - 1, chart.y + height);
  copyPx(chart.x + width - 1, chart.y + height - 1, chart.x + width, chart.y + height);
}

/**
 * Edge-preserving bilateral filter on indirect bounce light within a chart:
 * smooths 8-ray hemisphere noise into silky GoldSrc radiosity without blurring
 * crisp direct shadow boundaries.
 */
function smoothChartBounce(chart: Chart, bounce: Float32Array, scratch: Float32Array): void {
  const { width, height } = chart;
  for (let j = 0; j < height; ++j) {
    for (let i = 0; i < width; ++i) {
      if (!chart.valid[j * width + i]) continue;
      const cAt = ((chart.y + j) * ATLAS_WIDTH + chart.x + i) * 3;
      const cr = bounce[cAt]!, cg = bounce[cAt + 1]!, cb = bounce[cAt + 2]!;
      let sr = cr * 2, sg = cg * 2, sb = cb * 2, wSum = 2;
      for (let dj = -1; dj <= 1; ++dj) {
        for (let di = -1; di <= 1; ++di) {
          if (di === 0 && dj === 0) continue;
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= width || nj >= height || !chart.valid[nj * width + ni]) continue;
          const nAt = ((chart.y + nj) * ATLAS_WIDTH + chart.x + ni) * 3;
          const nr = bounce[nAt]!, ng = bounce[nAt + 1]!, nb = bounce[nAt + 2]!;
          const diff = Math.abs(nr - cr) + Math.abs(ng - cg) + Math.abs(nb - cb);
          const w = Math.exp(-diff * 3.5) * (di === 0 || dj === 0 ? 1 : 0.65);
          sr += nr * w; sg += ng * w; sb += nb * w;
          wSum += w;
        }
      }
      scratch[cAt] = sr / wSum;
      scratch[cAt + 1] = sg / wSum;
      scratch[cAt + 2] = sb / wSum;
    }
  }
  for (let j = 0; j < height; ++j) {
    for (let i = 0; i < width; ++i) {
      if (!chart.valid[j * width + i]) continue;
      const at = ((chart.y + j) * ATLAS_WIDTH + chart.x + i) * 3;
      bounce[at] = scratch[at]!;
      bounce[at + 1] = scratch[at + 1]!;
      bounce[at + 2] = scratch[at + 2]!;
    }
  }
}

/**
 * Directional + hemisphere world light probe at an arbitrary 3D point.
 * Drives unified character, prop, and first-person viewmodel lighting so
 * dynamic models match the sun, sky dome, floor bounce, and indoor lamps.
 */
export interface LightProbeSample {
  /** Overall RGB irradiance tint (backward-compatible with `sampleLight`). */
  tint: [number, number, number];
  /** Upper hemisphere fill color (blue sky outdoors, warm ceiling bounce indoors). */
  sky: [number, number, number];
  /** Lower hemisphere bounce color (warm golden sand outdoors, dark concrete indoors). */
  ground: [number, number, number];
  /** Dominant directional light vector (unit, pointing TOWARD the light). */
  keyDir: Vec3;
  /** Dominant directional light RGB color. */
  keyColor: [number, number, number];
}

export function sampleLightProbe(
  pos: Vec3, lights: MapLight[], ambient: [number, number, number],
  probe?: ShadowProbe, sun?: SunLight,
): LightProbeSample {
  let r = ambient[0], g = ambient[1], b = ambient[2];
  let skyR = ambient[0] * 1.1, skyG = ambient[1] * 1.1, skyB = ambient[2] * 1.15;
  let gndR = ambient[0] * 0.85, gndG = ambient[1] * 0.82, gndB = ambient[2] * 0.78;
  let keyDir: Vec3 = [0.3, 0.85, 0.42];
  let keyR = ambient[0] * 0.6, keyG = ambient[1] * 0.6, keyB = ambient[2] * 0.6;
  let bestKeyLum = 0.01;

  if (sun) {
    // 3-ray quick sky openness check (up + two tilted) for smooth tunnel transitions.
    let skyOpen = 1;
    if (probe) {
      let openCount = 0;
      if (!probe(pos, [pos[0], pos[1] + SKY_RAY_DIST, pos[2]])) ++openCount;
      if (!probe(pos, [pos[0] + 600, pos[1] + SKY_RAY_DIST, pos[2] - 400])) ++openCount;
      if (!probe(pos, [pos[0] - 600, pos[1] + SKY_RAY_DIST, pos[2] + 400])) ++openCount;
      skyOpen = openCount / 3;
    }
    if (skyOpen > 0) {
      const se = sun.skyIntensity * skyOpen;
      r += sun.skyColor[0] * se * 0.65;
      g += sun.skyColor[1] * se * 0.65;
      b += sun.skyColor[2] * se * 0.65;
      skyR += sun.skyColor[0] * se;
      skyG += sun.skyColor[1] * se;
      skyB += sun.skyColor[2] * se;
      // Warm ground bounce in sunlit outdoor spaces.
      gndR += sun.color[0] * se * 0.55;
      gndG += sun.color[1] * se * 0.46;
      gndB += sun.color[2] * se * 0.34;
    }

    const sunTarget: Vec3 = [
      pos[0] + sun.dir[0] * SUN_RAY_DIST,
      pos[1] + sun.dir[1] * SUN_RAY_DIST,
      pos[2] + sun.dir[2] * SUN_RAY_DIST,
    ];
    if (!probe || !probe(pos, sunTarget)) {
      const e = sun.intensity * 0.72;
      const sr = sun.color[0] * e, sg = sun.color[1] * e, sb = sun.color[2] * e;
      r += sr; g += sg; b += sb;
      gndR += sr * 0.28; gndG += sg * 0.24; gndB += sb * 0.16;
      const lum = sr * 0.3 + sg * 0.59 + sb * 0.11;
      if (lum > bestKeyLum) {
        bestKeyLum = lum;
        keyDir = [sun.dir[0], sun.dir[1], sun.dir[2]];
        keyR = sr; keyG = sg; keyB = sb;
      }
    }
  }

  for (const light of lights) {
    const dx = light.pos[0] - pos[0];
    const dy = light.pos[1] - pos[1];
    const dz = light.pos[2] - pos[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance >= light.radius || distance < 1e-3) continue;
    const falloff = 1 - distance / light.radius;
    const energy = falloff * falloff * light.intensity * 0.8;
    if (probe && energy > 0.02 && probe(pos, light.pos)) continue;

    const lr = light.color[0] * energy;
    const lg = light.color[1] * energy;
    const lb = light.color[2] * energy;
    r += lr; g += lg; b += lb;
    if (dy >= 0) {
      skyR += lr * 0.45; skyG += lg * 0.45; skyB += lb * 0.45;
      gndR += lr * 0.18; gndG += lg * 0.16; gndB += lb * 0.14;
    } else {
      gndR += lr * 0.55; gndG += lg * 0.55; gndB += lb * 0.55;
    }
    const lum = lr * 0.3 + lg * 0.59 + lb * 0.11;
    if (lum > bestKeyLum) {
      bestKeyLum = lum;
      keyDir = [dx / distance, dy / distance, dz / distance];
      keyR = lr; keyG = lg; keyB = lb;
    }
  }

  return {
    tint: [Math.min(r, 1.65), Math.min(g, 1.65), Math.min(b, 1.65)],
    sky: [Math.min(skyR, 1.5), Math.min(skyG, 1.5), Math.min(skyB, 1.5)],
    ground: [Math.min(gndR, 1.2), Math.min(gndG, 1.2), Math.min(gndB, 1.2)],
    keyDir,
    keyColor: [Math.min(keyR, 1.6), Math.min(keyG, 1.6), Math.min(keyB, 1.6)],
  };
}

/** Convenience wrapper returning the scalar RGB tint from `sampleLightProbe`. */
export function sampleLight(pos: Vec3, lights: MapLight[], ambient: [number, number, number],
                            probe?: ShadowProbe, sun?: SunLight): [number, number, number] {
  return sampleLightProbe(pos, lights, ambient, probe, sun).tint;
}

/**
 * GoldSrc world shader extension:
 * 1. `r_detailtextures`: multiplies subtle high-frequency grit up close.
 * 2. Dynamic `dlight` muzzle flashes: up to 4 real-time point flashes light up
 *    walls, floors and crates when weapons fire in dark tunnels/interiors.
 */
function applyWorldShader(
  material: THREE.MeshBasicMaterial,
  detail: THREE.Texture | null,
  flashes: WorldFlashUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    if (detail) shader.uniforms.uDetailMap = { value: detail };
    shader.uniforms.uFlashPos = { value: flashes.positions };
    shader.uniforms.uFlashColor = { value: flashes.colors };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vDetailDist;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNorm;",
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n" +
        "\tvDetailDist = -mvPosition.z;\n" +
        "\tvWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n" +
        "\tvWorldNorm = normalize( mat3( modelMatrix ) * normal );",
      );

    const detailPars = detail ? "uniform sampler2D uDetailMap;\n" : "";
    const detailApply = detail
      ? "\n#ifdef USE_MAP\n" +
        "\tfloat detailFade = smoothstep( 480.0, 64.0, vDetailDist );\n" +
        "\tfloat detailVal = texture2D( uDetailMap, vMapUv * 4.0 ).r * 2.0;\n" +
        "\tdiffuseColor.rgb *= mix( 1.0, detailVal, 0.36 * detailFade );\n" +
        "#endif"
      : "";

    const flashPars =
      `uniform vec3 uFlashPos[${MAX_WORLD_FLASHES}];\n` +
      `uniform vec3 uFlashColor[${MAX_WORLD_FLASHES}];\n` +
      "varying float vDetailDist;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNorm;\n";

    const flashApply =
      "\n\tvec3 dlight = vec3( 0.0 );\n" +
      `\tfor ( int i = 0; i < ${MAX_WORLD_FLASHES}; i++ ) {\n` +
      "\t\tvec3 fc = uFlashColor[i];\n" +
      "\t\tif ( fc.r + fc.g + fc.b > 0.001 ) {\n" +
      "\t\t\tvec3 toL = uFlashPos[i] - vWorldPos;\n" +
      "\t\t\tfloat d = length( toL );\n" +
      "\t\t\tif ( d < 320.0 ) {\n" +
      "\t\t\t\tfloat att = 1.0 - d / 320.0;\n" +
      "\t\t\t\tfloat ndl = max( 0.18, dot( normalize( vWorldNorm ), toL / max( d, 1.0 ) ) );\n" +
      "\t\t\t\tdlight += fc * ( att * att * ndl );\n" +
      "\t\t\t}\n" +
      "\t\t}\n" +
      "\t}\n" +
      "\treflectedLight.indirectDiffuse += dlight;\n";

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${detailPars}${flashPars}`)
      .replace("#include <map_fragment>", `#include <map_fragment>${detailApply}`)
      .replace("#include <aomap_fragment>", `${flashApply}\t#include <aomap_fragment>`);
  };
  material.customProgramCacheKey = () => (detail ? "goldsrc-world-detail-dlight" : "goldsrc-world-dlight");
}

export interface BuiltMap {
  meshes: THREE.Object3D[];
  shadowRays: number;
  luxelCount: number;
  atlasHeight: number;
}

export function buildMapGeometry(
  brushes: Brush[], lights: MapLight[], ambient: [number, number, number],
  probe: ShadowProbe, sun?: SunLight, props?: PropDef[], decals?: MapDecalDef[],
  trace?: RayTracer, flashes?: WorldFlashUniforms,
): BuiltMap {
  const atlas = textures();
  const detail = getDetailTexture();
  const flashUniforms = flashes ?? createWorldFlashUniforms();
  const groups = new Map<string, {
    positions: number[]; normals: number[]; uvs: number[]; lightUvs: number[];
  }>();
  let shadowRays = 0;

  const countingProbe: ShadowProbe = (from, to) => {
    ++shadowRays;
    return probe(from, to);
  };
  const countingTrace: RayTracer | undefined = trace
    ? (from, to) => {
        ++shadowRays;
        return trace(from, to);
      }
    : undefined;

  const solidBrushes = brushes.filter((b) => b.solid !== false);
  const aabbs = buildBrushAabbs(solidBrushes);

  // Light panels and glass glow on their own; everything else gets a lightmap chart.
  const emission: Record<string, Vec3> = {
    light: [1.45, 1.34, 1.05], light_cool: [1.05, 1.32, 1.45], glass: [1, 1, 1],
  };
  const faces = brushes.flatMap((brush) => brushFaces(brush));
  const charts = faces.map((face) => (emission[face.tex] ? null : chartFace(face)));
  const activeCharts = charts.filter((chart): chart is Chart => chart !== null);
  const atlasHeight = packCharts(activeCharts);
  const chartIndex = buildChartIndex(activeCharts);

  const totalTexels = ATLAS_WIDTH * atlasHeight;
  const direct = new Float32Array(totalTexels * 3);
  const bounce1 = new Float32Array(totalTexels * 3);
  const bounce2 = new Float32Array(totalTexels * 3);
  const scratch = new Float32Array(totalTexels * 3);
  const gathers: GatherRecord[] = [];

  // Pass 1: Direct lighting (soft 4-sample sun + point lights) + 8-ray hemisphere gather.
  for (let i = 0; i < faces.length; ++i) {
    const chart = charts[i];
    if (chart) {
      bakeChartDirect(
        faces[i]!, chart, direct, aabbs, chartIndex, lights, ambient,
        countingProbe, countingTrace, sun, gathers,
      );
    }
  }
  // Fill invalid direct luxels before radiosity reads from `direct`.
  for (const chart of activeCharts) dilateAndPadChart(chart, direct, atlasHeight);

  // Pass 2: True 1st-bounce color-bleeding radiosity (zero extra raycasts!).
  for (const rec of gathers) {
    let br = 0, bg = 0, bb = 0;
    for (const h of rec.hits) {
      const sAt = h.targetIdx * 3;
      br += direct[sAt]! * h.ar * h.weight;
      bg += direct[sAt + 1]! * h.ag * h.weight;
      bb += direct[sAt + 2]! * h.ab * h.weight;
    }
    const at = rec.luxelIdx * 3;
    bounce1[at] = br * BOUNCE1_GAIN;
    bounce1[at + 1] = bg * BOUNCE1_GAIN;
    bounce1[at + 2] = bb * BOUNCE1_GAIN;
  }
  for (const chart of activeCharts) {
    smoothChartBounce(chart, bounce1, scratch);
    dilateAndPadChart(chart, bounce1, atlasHeight);
  }

  // Pass 3: 2nd-bounce radiosity (lifts deep shaded arches & tunnel corners with warm bleed).
  for (const rec of gathers) {
    let br = 0, bg = 0, bb = 0;
    for (const h of rec.hits) {
      const sAt = h.targetIdx * 3;
      br += bounce1[sAt]! * h.ar * h.weight;
      bg += bounce1[sAt + 1]! * h.ag * h.weight;
      bb += bounce1[sAt + 2]! * h.ab * h.weight;
    }
    const at = rec.luxelIdx * 3;
    bounce2[at] = br * BOUNCE2_GAIN;
    bounce2[at + 1] = bg * BOUNCE2_GAIN;
    bounce2[at + 2] = bb * BOUNCE2_GAIN;
  }
  for (const chart of activeCharts) {
    smoothChartBounce(chart, bounce2, scratch);
    dilateAndPadChart(chart, bounce2, atlasHeight);
  }

  // Combine direct + 2 bounces into the final half-float HDR lightmap atlas.
  const luxels = new Float32Array(totalTexels * 3);
  for (let i = 0; i < totalTexels * 3; ++i) {
    luxels[i] = Math.min(2.2, direct[i]! + bounce1[i]! + bounce2[i]!);
  }

  for (const [index, face] of faces.entries()) {
    let group = groups.get(face.tex);
    if (!group) {
      group = { positions: [], normals: [], uvs: [], lightUvs: [] };
      groups.set(face.tex, group);
    }
    const chart = charts[index] ?? null;
    const [s, t] = faceAxes(face.normal);
    const fit = !face.uv && (face.tex === "crate" || face.tex === "wood_door") && chart
      ? chart.bounds : null;
    for (const tri of faceTriangles(face)) {
      for (const point of [tri.a, tri.b, tri.c]) {
        group.positions.push(point[0], point[1], point[2]);
        group.normals.push(face.normal[0], face.normal[1], face.normal[2]);
        if (face.uv) {
          const u = (dot(point, face.uv.uAxis) / face.uv.uScale + face.uv.uOffset) / TEXTURE_SCALE;
          const v = -(dot(point, face.uv.vAxis) / face.uv.vScale + face.uv.vOffset) / TEXTURE_SCALE;
          group.uvs.push(u, v);
        } else if (fit) {
          const across = fit[1] - fit[0], up = fit[3] - fit[2];
          const span = face.tex === "wood_door" ? 160 : CRATE_SPAN;
          group.uvs.push(
            (point[s]! - fit[0]) / across * Math.max(1, Math.round(across / span)),
            -(point[t]! - fit[2]) / up * Math.max(1, Math.round(up / span)),
          );
        } else {
          group.uvs.push(point[s]! / TEXTURE_SCALE, (t === 1 ? -1 : 1) * point[t]! / TEXTURE_SCALE);
        }
        if (chart) {
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

  const pixels = new Uint16Array(totalTexels * 4);
  for (let i = 0; i < totalTexels; ++i) {
    for (let k = 0; k < 3; ++k) pixels[i * 4 + k] = THREE.DataUtils.toHalfFloat(luxels[i * 3 + k]!);
    pixels[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  const lightMap = new THREE.DataTexture(pixels, ATLAS_WIDTH, atlasHeight, THREE.RGBAFormat,
    THREE.HalfFloatType);
  lightMap.magFilter = THREE.LinearFilter;
  lightMap.minFilter = THREE.LinearFilter;
  lightMap.channel = 1;
  lightMap.needsUpdate = true;

  const meshes: THREE.Object3D[] = [];
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
      material.lightMapIntensity = Math.PI;
      applyWorldShader(material, detail, flashUniforms);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.name = `world:${tex}`;
    meshes.push(mesh);
  }

  // Painted map decals tinted from the baked light probe.
  if (decals) {
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (const decal of decals) {
      const n = new THREE.Vector3(...decal.normal).normalize();
      const tint = sampleLight(
        [decal.pos[0] + n.x * 4, decal.pos[1] + n.y * 4, decal.pos[2] + n.z * 4],
        lights, ambient, countingProbe, sun,
      );
      const mat = new THREE.MeshBasicMaterial({
        map: mapDecalTexture(decal.kind),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
      });
      mat.color.setRGB(
        Math.min(1.25, 0.25 + tint[0] * 0.85),
        Math.min(1.25, 0.25 + tint[1] * 0.85),
        Math.min(1.25, 0.25 + tint[2] * 0.85),
      );
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(decal.size, decal.size), mat);
      mesh.position.set(decal.pos[0] + n.x * 0.45, decal.pos[1] + n.y * 0.45, decal.pos[2] + n.z * 0.45);
      mesh.quaternion.setFromUnitVectors(zAxis, n);
      if (decal.rotation) mesh.rotateZ(decal.rotation);
      mesh.name = `decal:${decal.kind}`;
      meshes.push(mesh);
    }
  }

  // Static CC0 GLB world props tinted by the baked world light probe.
  if (props) {
    for (const prop of props) {
      const obj = clonePropModel(prop.model);
      if (!obj) continue;
      obj.position.set(...prop.pos);
      obj.rotation.y = prop.yaw;
      if (prop.scale) obj.scale.setScalar(prop.scale);
      const liftY = prop.model === "lamp_ind" ? -28 : 24;
      const lp = sampleLightProbe(
        [prop.pos[0], prop.pos[1] + liftY, prop.pos[2]],
        lights, ambient, countingProbe, sun,
      );
      const r = 0.32 + lp.tint[0] * 0.78;
      const g = 0.32 + lp.tint[1] * 0.78;
      const b = 0.32 + lp.tint[2] * 0.78;
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
          child.material.color.setRGB(r, g, b);
          child.material.envMapIntensity = 0.32;
        }
      });
      meshes.push(obj);
    }
  }

  return { meshes, shadowRays, luxelCount: gathers.length, atlasHeight };
}
