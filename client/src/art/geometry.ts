import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type V3 = [number, number, number];

/** A single chamfer catches light without rounding away the low-poly silhouette. */
export function bevelBox(w: number, h: number, d: number, bevel = 0.2): THREE.BufferGeometry {
  const b = Math.min(bevel, Math.min(w, h, d) * 0.24);
  const x = w / 2 - b, y = h / 2 - b;
  const shape = new THREE.Shape();
  shape.moveTo(-x, -y);
  shape.lineTo(x, -y);
  shape.lineTo(x, y);
  shape.lineTo(-x, y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: d - 2 * b, bevelEnabled: true, bevelThickness: b,
    bevelSize: b, bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -d / 2 + b);
  // Planar UVs keep the texture density consistent on the broad faces.
  const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < p.count; ++i) {
    const side = Math.abs(n.getX(i)) > 0.5;
    const top = Math.abs(n.getY(i)) > 0.5;
    uv.setXY(i, (side ? p.getZ(i) / d : p.getX(i) / w) + 0.5,
      (top ? p.getZ(i) / d : p.getY(i) / h) + 0.5);
  }
  return geometry;
}

export function meshPart(group: THREE.Group, geometry: THREE.BufferGeometry,
                         material: THREE.Material, at: V3, rotation: V3 = [0, 0, 0]): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

/** Merge static parts by material, but preserve the groups used as joints. */
export function batchParts(group: THREE.Group): void {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...group.children]) {
    if (child instanceof THREE.Group) batchParts(child);
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    child.updateMatrix();
    const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    geometry.applyMatrix4(child.matrix);
    geometry.clearGroups();
    const batch = batches.get(child.material) ?? [];
    batch.push(geometry);
    batches.set(child.material, batch);
    child.geometry.dispose();
    group.remove(child);
  }
  for (const [material, geometries] of batches) {
    group.add(new THREE.Mesh(mergeGeometries(geometries)!, material));
    for (const geometry of geometries) geometry.dispose();
  }
}

/** Geometries belong to the assembly; cached materials and textures do not. */
export function disposeParts(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
}

/** Box-projected UVs at a fixed texel density, so detail never stretches. */
export function planarUv(geometry: THREE.BufferGeometry, size: number): void {
  const p = geometry.getAttribute("position"), n = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < p.count; ++i) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i) / size, p.getY(i) / size);
    else if (ay >= az) uv.setXY(i, p.getX(i) / size, p.getZ(i) / size);
    else uv.setXY(i, p.getX(i) / size, p.getY(i) / size);
  }
}

/**
 * A side silhouette, given as [z, y] points, extruded to `width` along X.
 * Era models carry their identity in the profile, not the polygon count.
 */
export function profile(points: Array<[number, number]>, width: number,
                        bevel = 0.1): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y)));
  const b = Math.min(bevel, width * 0.3);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b,
    bevelOffset: -b, bevelSegments: 1, steps: 1, curveSegments: 1,
  });
  geometry.translate(0, 0, -width / 2 + b);
  geometry.rotateY(Math.PI / 2);
  planarUv(geometry, 12);
  return geometry;
}

/**
 * One cross-section of a loft: height, half-width, half-depth and an optional
 * offset. A sixth value gives the back (+Z) its own depth, which is what
 * separates a skull, a calf or a chest from a pipe.
 */
export type Ring = [y: number, rx: number, rz: number, cx?: number, cz?: number, rzBack?: number];

/**
 * A lump or hollow pressed into a loft: centred at `u` round the body (0.5 is
 * the front) and height `y`, falling off as a Gaussian `su` wide and `sy`
 * tall, standing `h` proud of the surface (negative carves). `mirror` repeats
 * it on the other side of the body. This is how a tube gets a nose, a brow, a
 * kneecap.
 */
export interface Bump { u: number; y: number; su: number; sy: number; h: number; mirror?: boolean }

export interface LoftOptions {
  /** World units per texture repeat. Omitted, the texture wraps the tube once. */
  density?: number;
  /** Superellipse exponent: 2 is an ellipse, higher squares the section off. */
  square?: number;
  /** Extra rings splined between each authored pair, so few rings give a smooth form. */
  smooth?: number;
  bumps?: Bump[];
  /** Run the texture the other way round, for the left-hand twin of a limb. */
  mirrorU?: boolean;
}

/** Catmull-Rom through the authored rings: curvature without authoring every section. */
function splineRings(rings: Ring[], extra: number): Ring[] {
  const at = (i: number) => rings[Math.max(0, Math.min(rings.length - 1, i))]!;
  const full = (ring: Ring) => [ring[0], ring[1], ring[2], ring[3] ?? 0, ring[4] ?? 0, ring[5] ?? ring[2]];
  const out: Ring[] = [];
  for (let i = 0; i + 1 < rings.length; ++i) {
    const [p0, p1, p2, p3] = [full(at(i - 1)), full(at(i)), full(at(i + 1)), full(at(i + 2))];
    for (let step = 0; step <= extra; ++step) {
      const t = step / (extra + 1), t2 = t * t, t3 = t2 * t;
      out.push(p1.map((_, k) => 0.5 * (2 * p1[k]! + (p2[k]! - p0[k]!) * t +
        (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 +
        (3 * p1[k]! - p0[k]! - 3 * p2[k]! + p3[k]!) * t3)) as unknown as Ring);
    }
  }
  out.push(full(rings[rings.length - 1]!) as unknown as Ring);
  // Height must stay monotonic, and a radius must never spline through zero.
  for (const ring of out) { ring[1] = Math.max(0.02, ring[1]); ring[2] = Math.max(0.02, ring[2]); ring[5] = Math.max(0.02, ring[5]!); }
  return out;
}

/**
 * Smooth-shaded tube through elliptical rings. `u` runs around the body with
 * the seam at the back (+Z) and the front (-Z) at u = 0.5; `v` runs bottom to
 * top. This is how a 600-polygon body gets a waist, a chest and a calf.
 */
export function loft(authored: Ring[], sides = 8, options: LoftOptions = {}): THREE.BufferGeometry {
  const rings = options.smooth ? splineRings(authored, options.smooth) : authored;
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const y0 = rings[0]![0], span = rings[rings.length - 1]![0] - y0;
  const bumps = (options.bumps ?? []).flatMap((bump) =>
    bump.mirror ? [bump, { ...bump, u: 1 - bump.u }] : [bump]);
  const power = 2 / (options.square ?? 2);
  // A whole number of repeats round the widest ring, so the seam still tiles.
  const girth = Math.max(...rings.map((ring) => Math.PI * (ring[1] + ring[2])));
  const around = options.density ? Math.max(1, Math.round(girth / options.density)) : 1;
  const along = options.density ? span / options.density : 1;
  for (const [y, rx, rz, cx = 0, cz = 0, rzBack = rz] of rings) {
    for (let i = 0; i <= sides; ++i) {
      const a = (i / sides) * Math.PI * 2;
      const s = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** power;
      const c = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** power;
      let x = rx * s, z = (c > 0 ? rzBack : rz) * c;
      let lift = 0;
      for (const bump of bumps) {
        let du = Math.abs(i / sides - bump.u);
        if (du > 0.5) du = 1 - du;
        const e = (du / bump.su) ** 2 + ((y - bump.y) / bump.sy) ** 2;
        if (e < 18) lift += bump.h * Math.exp(-0.5 * e);
      }
      if (lift !== 0) {
        const radius = Math.hypot(x, z) || 1;
        x += x / radius * lift; z += z / radius * lift;
      }
      positions.push(cx + x, y, cz + z);
      const u = i / sides * around;
      uvs.push(options.mirrorU ? around - u : u, (y - y0) / span * along);
    }
  }
  const row = sides + 1;
  for (let r = 0; r + 1 < rings.length; ++r) {
    for (let i = 0; i < sides; ++i) {
      const a = r * row + i, b = a + 1, c = a + row, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  // Flat caps, fanned from the ring centre.
  for (const top of [false, true]) {
    const ring = rings[top ? rings.length - 1 : 0]!;
    const base = (top ? rings.length - 1 : 0) * row, centre = positions.length / 3;
    positions.push(ring[3] ?? 0, ring[0], ring[4] ?? 0);
    uvs.push(0.5, top ? 1 : 0);
    for (let i = 0; i < sides; ++i) {
      if (top) index.push(base + i, base + i + 1, centre);
      else index.push(base + i + 1, base + i, centre);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  // True surface normals, so a taper or a dome shades as one, then weld the
  // UV seam: its two columns are the same points and must light the same.
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute("normal");
  for (let r = 0; r < rings.length; ++r) {
    const a = r * row, b = a + sides;
    const x = normal.getX(a) + normal.getX(b), y = normal.getY(a) + normal.getY(b);
    const z = normal.getZ(a) + normal.getZ(b), length = Math.hypot(x, y, z) || 1;
    normal.setXYZ(a, x / length, y / length, z / length);
    normal.setXYZ(b, x / length, y / length, z / length);
  }
  return geometry;
}

/** A low-poly ellipsoid: joints, pads and anything else that should not have corners. */
export function ball(rx: number, ry = rx, rz = rx): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 12, 8).scale(rx, ry, rz);
}

/**
 * A tapered, round-ended segment from the origin along +Y: one bone of a
 * finger. Chain a few and they read as knuckles.
 */
export function capsule(length: number, radius: number, sides = 6): THREE.BufferGeometry {
  const tip = radius * 0.86;
  return loft([[-radius * 0.7, radius * 0.5, radius * 0.5], [0, radius, radius], [length, tip, tip],
               [length + tip * 0.7, tip * 0.5, tip * 0.5]], sides);
}

/**
 * A box with its corners and edges rounded off (a superellipsoid): a pouch, a
 * magazine, a radio. `round` 2 is an ellipsoid; higher is squarer.
 */
export function roundBox(w: number, h: number, d: number, round = 5, texel = 12): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 14, 10);
  const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; ++i) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const k = (Math.abs(x) ** round + Math.abs(y) ** round + Math.abs(z) ** round) ** (-1 / round);
    const qx = x * k, qy = y * k, qz = z * k;
    position.setXYZ(i, qx * w / 2, qy * h / 2, qz * d / 2);
    // Gradient of the implicit surface: exact normals, with no seam to weld.
    const nx = Math.sign(qx) * Math.abs(qx) ** (round - 1) / w;
    const ny = Math.sign(qy) * Math.abs(qy) ** (round - 1) / h;
    const nz = Math.sign(qz) * Math.abs(qz) ** (round - 1) / d;
    const length = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(i, nx / length, ny / length, nz / length);
  }
  planarUv(geometry, texel);
  return geometry;
}
