import { readFile } from "node:fs/promises";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node tools/audit-glb.mjs <file.glb> [...]");
  process.exit(2);
}

for (const file of files) {
  const bytes = await readFile(file);
  if (bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2) {
    throw new Error(`${file}: not a glTF 2.0 binary`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.toString("ascii", 16, 20);
  if (jsonType !== "JSON") throw new Error(`${file}: missing JSON chunk`);
  const gltf = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  let vertices = 0;
  let triangles = 0;
  let primitiveCount = 0;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      ++primitiveCount;
      const position = gltf.accessors?.[primitive.attributes?.POSITION];
      const indices = gltf.accessors?.[primitive.indices];
      vertices += position?.count ?? 0;
      const elementCount = indices?.count ?? position?.count ?? 0;
      if ((primitive.mode ?? 4) === 4) triangles += Math.floor(elementCount / 3);
      if (position?.min && position?.max) {
        for (let axis = 0; axis < 3; ++axis) {
          minimum[axis] = Math.min(minimum[axis], position.min[axis]);
          maximum[axis] = Math.max(maximum[axis], position.max[axis]);
        }
      }
    }
  }
  const skins = gltf.skins ?? [];
  const result = {
    file,
    bytes: bytes.length,
    meshes: gltf.meshes?.length ?? 0,
    primitives: primitiveCount,
    vertices,
    triangles,
    materials: gltf.materials?.length ?? 0,
    images: gltf.images?.length ?? 0,
    textures: gltf.textures?.length ?? 0,
    skins: skins.length,
    joints: skins.reduce((sum, skin) => sum + (skin.joints?.length ?? 0), 0),
    animations: gltf.animations?.length ?? 0,
    meshNames: (gltf.meshes ?? []).map((mesh) => mesh.name ?? "<unnamed>"),
    skinNames: skins.map((skin) => skin.name ?? "<unnamed>"),
    animationNames: (gltf.animations ?? []).map((animation) => animation.name ?? "<unnamed>"),
    meshNodes: (gltf.nodes ?? [])
      .filter((node) => node.mesh !== undefined)
      .map((node) => ({name: node.name ?? "<unnamed>", mesh: node.mesh, skin: node.skin ?? null})),
    accessorBounds: minimum.every(Number.isFinite)
      ? {minimum, maximum, size: maximum.map((value, axis) => value - minimum[axis])}
      : null,
  };
  console.log(JSON.stringify(result));
}
