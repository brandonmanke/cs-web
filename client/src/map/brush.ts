// Convex brushes: the authoring primitive for every map.
//
// A brush is an intersection of halfspaces, exactly what sim/src/world.cpp
// traces against. The same plane set also generates the render geometry here,
// so the thing you see and the thing you collide with cannot drift apart --
// that was the failure mode of loading a display mesh as collision.
//
// Units are GoldSrc units (1u = 1 inch), Y-up. Interior is dot(n, x) <= d.

export type Vec3 = [number, number, number];

export interface Plane {
  n: Vec3; // unit normal, pointing out of the brush
  d: number;
}

// cs::Material — drives footsteps and impact effects, not appearance.
export const Surface = {
  concrete: 0,
  wood: 1,
  metal: 2,
  sand: 3,
} as const;
export type Surface = (typeof Surface)[keyof typeof Surface];

export interface Brush {
  planes: Plane[];
  surface: Surface;
  tex: string;
  /** Per-face texture override, keyed by the index of the plane it sits on. */
  faceTex?: Record<number, string>;
}

export interface Face {
  points: Vec3[]; // convex polygon, counter-clockwise seen from outside
  normal: Vec3;
  tex: string;
  surface: Surface;
}

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 1e-9 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
}

/** Plane through `point` with outward normal `n` (normalized for you). */
export function planeThrough(n: Vec3, point: Vec3): Plane {
  const unit = normalize(n);
  return { n: unit, d: dot(unit, point) };
}

// --- brush constructors -----------------------------------------------------

export function box(min: Vec3, max: Vec3, surface: Surface, tex: string,
                    faceTex?: Record<number, string>): Brush {
  return {
    planes: [
      { n: [1, 0, 0], d: max[0] },
      { n: [-1, 0, 0], d: -min[0] },
      { n: [0, 1, 0], d: max[1] },
      { n: [0, -1, 0], d: -min[1] },
      { n: [0, 0, 1], d: max[2] },
      { n: [0, 0, -1], d: -min[2] },
    ],
    surface,
    tex,
    faceTex,
  };
}

export type RampDir = "+x" | "-x" | "+z" | "-z";

/**
 * A wedge filling `min`..`max` whose top rises from floor level to full height
 * in direction `dir` — the Quake staple for ramps and buttresses.
 */
export function ramp(min: Vec3, max: Vec3, dir: RampDir, surface: Surface,
                     tex: string): Brush {
  // Low edge and high edge of the sloped face, as points on it.
  const low: Vec3 = [0, min[1], 0];
  const high: Vec3 = [0, max[1], 0];
  let slopeNormal: Vec3;
  switch (dir) {
    case "+x":
      low[0] = min[0]; high[0] = max[0];
      slopeNormal = [-(max[1] - min[1]), max[0] - min[0], 0];
      break;
    case "-x":
      low[0] = max[0]; high[0] = min[0];
      slopeNormal = [max[1] - min[1], max[0] - min[0], 0];
      break;
    case "+z":
      low[2] = min[2]; high[2] = max[2];
      slopeNormal = [0, max[2] - min[2], -(max[1] - min[1])];
      break;
    default:
      low[2] = max[2]; high[2] = min[2];
      slopeNormal = [0, max[2] - min[2], max[1] - min[1]];
      break;
  }
  const planes: Plane[] = [
    planeThrough(slopeNormal, [low[0] || min[0], min[1], low[2] || min[2]]),
    { n: [0, -1, 0], d: -min[1] },
  ];
  // Keep the four side caps, minus the one the slope replaces.
  const caps: Array<[RampDir, Plane]> = [
    ["+x", { n: [1, 0, 0], d: max[0] }],
    ["-x", { n: [-1, 0, 0], d: -min[0] }],
    ["+z", { n: [0, 0, 1], d: max[2] }],
    ["-z", { n: [0, 0, -1], d: -min[2] }],
  ];
  const opposite: Record<RampDir, RampDir> = { "+x": "-x", "-x": "+x", "+z": "-z", "-z": "+z" };
  for (const [capDir, plane] of caps) {
    if (capDir !== opposite[dir]) planes.push(plane);
  }
  return { planes, surface, tex };
}

/**
 * cs::kStepHeight. A step taller than this cannot be walked up — you have to
 * jump every single one — so `stairs` refuses to emit one rather than shipping
 * a staircase that is secretly a ladder. Both silo and depot had exactly that
 * bug, and nothing in the build caught it because the geometry was valid.
 */
const MAX_STEP_RISE = 18;

/** A run of `count` steps climbing `dir` across `min`..`max`. */
export function stairs(min: Vec3, max: Vec3, count: number, dir: RampDir,
                       surface: Surface, tex: string): Brush[] {
  const out: Brush[] = [];
  const axis = dir === "+x" || dir === "-x" ? 0 : 2;
  const ascending = dir === "+x" || dir === "+z";
  const span = max[axis] - min[axis];
  const tread = span / count;
  const rise = (max[1] - min[1]) / count;
  if (rise > MAX_STEP_RISE) {
    throw new Error(
      `stairs: ${count} steps over ${max[1] - min[1]}u rise ${rise.toFixed(1)}u each, ` +
      `over the ${MAX_STEP_RISE}u step height — use ${Math.ceil((max[1] - min[1]) / MAX_STEP_RISE)} ` +
      `steps or a ramp`,
    );
  }

  for (let i = 0; i < count; ++i) {
    const stepMin: Vec3 = [min[0], min[1], min[2]];
    const stepMax: Vec3 = [max[0], min[1] + rise * (i + 1), max[2]];
    const near = min[axis] + tread * i;
    if (ascending) {
      stepMin[axis] = near;
      stepMax[axis] = max[axis];
    } else {
      stepMin[axis] = min[axis];
      stepMax[axis] = max[axis] - tread * i;
    }
    out.push(box(stepMin, stepMax, surface, tex));
  }
  return out;
}

/**
 * A sealed room: floor, ceiling and four walls of `thickness`, built just
 * outside the given interior volume so the interior dimensions are exact.
 */
export function room(min: Vec3, max: Vec3, thickness: number, surface: Surface,
                     wallTex: string, floorTex = wallTex, ceilTex = wallTex): Brush[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const t = thickness;
  return [
    box([x0 - t, y0 - t, z0 - t], [x1 + t, y0, z1 + t], surface, floorTex),
    box([x0 - t, y1, z0 - t], [x1 + t, y1 + t, z1 + t], surface, ceilTex),
    box([x0 - t, y0, z0 - t], [x0, y1, z1 + t], surface, wallTex),
    box([x1, y0, z0 - t], [x1 + t, y1, z1 + t], surface, wallTex),
    box([x0, y0, z0 - t], [x1, y1, z0], surface, wallTex),
    box([x0, y0, z1], [x1, y1, z1 + t], surface, wallTex),
  ];
}

// --- plane set -> polygons --------------------------------------------------

const WINDING_EXTENT = 1 << 16;
const CLIP_EPSILON = 0.01;

/** A quad on `plane`, large enough to contain any brush face before clipping. */
function baseWinding(plane: Plane): Vec3[] {
  const n = plane.n;
  // Tangent basis from whichever axis is least parallel to the normal.
  const ax = Math.abs(n[0]);
  const ay = Math.abs(n[1]);
  const az = Math.abs(n[2]);
  let seed: Vec3;
  if (ax <= ay && ax <= az) seed = [1, 0, 0];
  else if (ay <= az) seed = [0, 1, 0];
  else seed = [0, 0, 1];

  const right = mul(normalize(cross(seed, n)), WINDING_EXTENT);
  const up = mul(normalize(cross(n, right)), WINDING_EXTENT);
  const origin = mul(n, plane.d);
  // Counter-clockwise seen from the +n side.
  return [
    add(add(origin, mul(right, -1)), mul(up, -1)),
    add(add(origin, right), mul(up, -1)),
    add(add(origin, right), up),
    add(add(origin, mul(right, -1)), up),
  ];
}

/** Keep the part of `winding` inside the halfspace dot(n, x) <= d. */
function clipWinding(winding: Vec3[], plane: Plane): Vec3[] {
  const distances = winding.map((p) => dot(plane.n, p) - plane.d);
  const out: Vec3[] = [];

  for (let i = 0; i < winding.length; ++i) {
    const current = winding[i]!;
    const next = winding[(i + 1) % winding.length]!;
    const dCurrent = distances[i]!;
    const dNext = distances[(i + 1) % winding.length]!;

    if (dCurrent <= CLIP_EPSILON) out.push(current);
    if ((dCurrent > CLIP_EPSILON && dNext < -CLIP_EPSILON) ||
        (dCurrent < -CLIP_EPSILON && dNext > CLIP_EPSILON)) {
      const t = dCurrent / (dCurrent - dNext);
      out.push([
        current[0] + (next[0] - current[0]) * t,
        current[1] + (next[1] - current[1]) * t,
        current[2] + (next[2] - current[2]) * t,
      ]);
    }
  }
  return out;
}

/**
 * The polygonal faces of a brush: clip each plane's base quad by every other
 * plane. Planes that clip away to nothing contribute no face (they are
 * redundant halfspaces), which is exactly what we want for render geometry.
 */
export function brushFaces(brush: Brush): Face[] {
  const faces: Face[] = [];

  for (let i = 0; i < brush.planes.length; ++i) {
    const plane = brush.planes[i]!;
    let winding = baseWinding(plane);
    for (let j = 0; j < brush.planes.length && winding.length >= 3; ++j) {
      if (j !== i) winding = clipWinding(winding, brush.planes[j]!);
    }
    if (winding.length < 3) continue;

    // Drop near-duplicate points left by grazing clips.
    const points: Vec3[] = [];
    for (const point of winding) {
      const last = points[points.length - 1];
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1],
                              point[2] - last[2]) > 0.05) {
        points.push(point);
      }
    }
    if (points.length >= 3) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      if (Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) < 0.05) {
        points.pop();
      }
    }
    if (points.length < 3) continue;

    faces.push({
      points,
      normal: plane.n,
      tex: brush.faceTex?.[i] ?? brush.tex,
      surface: brush.surface,
    });
  }
  return faces;
}

/** Flat (nx, ny, nz, d) quads, the layout sim_add_brush expects. */
export function brushPlaneArray(brush: Brush): Float32Array {
  const out = new Float32Array(brush.planes.length * 4);
  for (let i = 0; i < brush.planes.length; ++i) {
    const plane = brush.planes[i]!;
    out[i * 4 + 0] = plane.n[0];
    out[i * 4 + 1] = plane.n[1];
    out[i * 4 + 2] = plane.n[2];
    out[i * 4 + 3] = plane.d;
  }
  return out;
}
