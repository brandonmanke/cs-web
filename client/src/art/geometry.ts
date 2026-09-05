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
