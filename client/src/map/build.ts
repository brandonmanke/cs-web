import * as THREE from "three";
import { TEXTURE_SCALE, textures, type TextureKey } from "../art/textures";
import { brushFaces, type Brush, type Face, type Vec3 } from "./brush";

// Brushes -> renderable geometry, with Quake-style baked lighting.
//
// Light is baked into vertex colours at load time and shadow-tested with the
// sim's own ray caster, so the lighting agrees with the collision geometry by
// construction. Nothing here is gameplay: it decides how the map looks, never
// how it behaves.

export interface MapLight {
  pos: Vec3;
  color: [number, number, number];
  intensity: number;
  radius: number;
}

/** Ray cast into the collision world. Returns true if the segment is blocked. */
export type ShadowProbe = (from: Vec3, to: Vec3) => boolean;

/** Faces are split until no edge exceeds this, giving the bake its resolution. */
const MAX_EDGE = 56;
const MAX_SUBDIVISION_DEPTH = 4;
/** Diffuse wrap, standing in for bounce light. 0 = pure Lambert. */
const WRAP = 0.45;

interface Tri {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function edgeLength(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Four-way midpoint split until edges are short enough for vertex lighting. */
function subdivide(tri: Tri, depth: number, out: Tri[]): void {
  const longest = Math.max(
    edgeLength(tri.a, tri.b), edgeLength(tri.b, tri.c), edgeLength(tri.c, tri.a),
  );
  if (longest <= MAX_EDGE || depth >= MAX_SUBDIVISION_DEPTH) {
    out.push(tri);
    return;
  }
  const ab = midpoint(tri.a, tri.b);
  const bc = midpoint(tri.b, tri.c);
  const ca = midpoint(tri.c, tri.a);
  subdivide({ a: tri.a, b: ab, c: ca }, depth + 1, out);
  subdivide({ a: ab, b: tri.b, c: bc }, depth + 1, out);
  subdivide({ a: ca, b: bc, c: tri.c }, depth + 1, out);
  subdivide({ a: ab, b: bc, c: ca }, depth + 1, out);
}

function faceTriangles(face: Face): Tri[] {
  const fan: Tri[] = [];
  for (let i = 1; i + 1 < face.points.length; ++i) {
    fan.push({ a: face.points[0]!, b: face.points[i]!, c: face.points[i + 1]! });
  }
  // Windings come out of the clipper counter-clockwise about the plane normal;
  // verify per triangle rather than trusting it, so a bad brush shows up as a
  // correct-facing triangle instead of an invisible one.
  const out: Tri[] = [];
  for (const tri of fan) {
    const ab: Vec3 = [tri.b[0] - tri.a[0], tri.b[1] - tri.a[1], tri.b[2] - tri.a[2]];
    const ac: Vec3 = [tri.c[0] - tri.a[0], tri.c[1] - tri.a[1], tri.c[2] - tri.a[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1];
    const ny = ab[2] * ac[0] - ab[0] * ac[2];
    const nz = ab[0] * ac[1] - ab[1] * ac[0];
    const facing = nx * face.normal[0] + ny * face.normal[1] + nz * face.normal[2];
    const fixed = facing < 0 ? { a: tri.a, b: tri.c, c: tri.b } : tri;
    subdivide(fixed, 0, out);
  }
  return out;
}

/** Quake's axial projection: tile by world position on the two minor axes. */
function faceUv(point: Vec3, normal: Vec3): [number, number] {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ay >= ax && ay >= az) return [point[0] / TEXTURE_SCALE, point[2] / TEXTURE_SCALE];
  if (ax >= az) return [point[2] / TEXTURE_SCALE, -point[1] / TEXTURE_SCALE];
  return [point[0] / TEXTURE_SCALE, -point[1] / TEXTURE_SCALE];
}

function bakeVertex(
  point: Vec3, normal: Vec3, lights: MapLight[], ambient: [number, number, number],
  probe: ShadowProbe,
): [number, number, number] {
  let r = ambient[0];
  let g = ambient[1];
  let b = ambient[2];
  // Lift the sample off the surface so it doesn't shadow-test against itself.
  const origin: Vec3 = [
    point[0] + normal[0] * 1.5,
    point[1] + normal[1] * 1.5,
    point[2] + normal[2] * 1.5,
  ];

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
    const energy = wrapped * falloff * falloff * light.intensity;
    if (energy < 0.004) continue; // too dim to be worth a shadow ray
    if (probe(origin, light.pos)) continue;

    r += light.color[0] * energy;
    g += light.color[1] * energy;
    b += light.color[2] * energy;
  }
  return [Math.min(r, 1.6), Math.min(g, 1.6), Math.min(b, 1.6)];
}

/**
 * Irradiance at an arbitrary point, used to sit dynamic objects (players,
 * viewmodel) inside the baked lighting instead of floating above it.
 * Unshadowed and normal-agnostic — it is a tint, not a second bake.
 */
export function sampleLight(pos: Vec3, lights: MapLight[],
                            ambient: [number, number, number]): [number, number, number] {
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
    positions: number[]; normals: number[]; uvs: number[]; colors: number[];
  }>();
  let shadowRays = 0;

  const countingProbe: ShadowProbe = (from, to) => {
    ++shadowRays;
    return probe(from, to);
  };

  for (const brush of brushes) {
    for (const face of brushFaces(brush)) {
      let group = groups.get(face.tex);
      if (!group) {
        group = { positions: [], normals: [], uvs: [], colors: [] };
        groups.set(face.tex, group);
      }
      // Light panels read as emissive; skip the bake and keep them bright.
      const emissive = face.tex === "light";

      for (const tri of faceTriangles(face)) {
        for (const point of [tri.a, tri.b, tri.c]) {
          group.positions.push(point[0], point[1], point[2]);
          group.normals.push(face.normal[0], face.normal[1], face.normal[2]);
          const [u, v] = faceUv(point, face.normal);
          group.uvs.push(u, v);
          const colour = emissive
            ? ([1.35, 1.28, 1.05] as [number, number, number])
            : bakeVertex(point, face.normal, lights, ambient, countingProbe);
          group.colors.push(colour[0], colour[1], colour[2]);
        }
      }
    }
  }

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
    geometry.setAttribute("color",
      new THREE.BufferAttribute(new Float32Array(group.colors), 3));
    geometry.computeBoundingSphere();

    const material = new THREE.MeshBasicMaterial({
      map: atlas.get(tex as TextureKey) ?? null,
      vertexColors: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.name = `world:${tex}`;
    meshes.push(mesh);
  }
  return { meshes, shadowRays };
}
