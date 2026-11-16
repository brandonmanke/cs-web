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

export interface LoftOptions {
  /** World units per texture repeat. Omitted, the texture wraps the tube once. */
  density?: number;
  /** Superellipse exponent: 2 is an ellipse, higher squares the section off. */
  square?: number;
}

/**
 * Smooth-shaded tube through elliptical rings. `u` runs around the body with
 * the seam at the back (+Z) and the front (-Z) at u = 0.5; `v` runs bottom to
 * top. This is how a 600-polygon body gets a waist, a chest and a calf.
 */
export function loft(rings: Ring[], sides = 8, options: LoftOptions = {}): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  const y0 = rings[0]![0], span = rings[rings.length - 1]![0] - y0;
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
      positions.push(cx + rx * s, y, cz + (c > 0 ? rzBack : rz) * c);
      uvs.push(i / sides * around, (y - y0) / span * along);
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
