// Load the dust2 GLB exactly like renderer.loadDust2 (bake transforms, x39.37),
// feed it to the wasm sim, then probe a grid of drop-spawns to map the ground.
import fs from "node:fs";
import createSimModule from "/Users/brandon/projects/cs-web/client/src/generated/sim.mjs";

const SCALE = 39.37;
const buf = fs.readFileSync("/Users/brandon/projects/cs-web/assets/maps/de_dust2_ref.glb");
const total = buf.readUInt32LE(8);
let off = 12, json = null, bin = null;
while (off < total) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
  const chunk = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
  else if (type === 0x004e4942) bin = chunk;
  off += 8 + len;
}

function accessorArray(index) {
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const Ctor = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[acc.componentType];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
  return new Ctor(bin.buffer, bin.byteOffset + start, acc.count * comps);
}

const I = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    o[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
  return o;
}
function trs(n) {
  if (n.matrix) return n.matrix;
  const [tx,ty,tz] = n.translation || [0,0,0];
  const [qx,qy,qz,qw] = n.rotation || [0,0,0,1];
  const [sx,sy,sz] = n.scale || [1,1,1];
  const x2=qx+qx,y2=qy+qy,z2=qz+qz,xx=qx*x2,xy=qx*y2,xz=qx*z2,yy=qy*y2,yz=qy*z2,zz=qz*z2,wx=qw*x2,wy=qw*y2,wz=qw*z2;
  return [(1-(yy+zz))*sx,(xy+wz)*sx,(xz-wy)*sx,0,(xy-wz)*sy,(1-(xx+zz))*sy,(yz+wx)*sy,0,(xz+wy)*sz,(yz-wx)*sz,(1-(xx+yy))*sz,0,tx,ty,tz,1];
}

const verts = [], indices = [];
function walk(nodeIdx, parentM) {
  const node = json.nodes[nodeIdx];
  const m = mul(parentM, trs(node));
  if (node.mesh !== undefined) {
    for (const prim of json.meshes[node.mesh].primitives) {
      const pos = accessorArray(prim.attributes.POSITION);
      const base = verts.length / 3;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i+1], z = pos[i+2];
        verts.push(
          (m[0]*x + m[4]*y + m[8]*z + m[12]) * SCALE,
          (m[1]*x + m[5]*y + m[9]*z + m[13]) * SCALE,
          (m[2]*x + m[6]*y + m[10]*z + m[14]) * SCALE,
        );
      }
      const idx = prim.indices !== undefined ? accessorArray(prim.indices) : null;
      if (idx) for (let i = 0; i < idx.length; i++) indices.push(base + idx[i]);
      else for (let i = 0; i < pos.length / 3; i++) indices.push(base + i);
    }
  }
  for (const c of node.children || []) walk(c, m);
}
for (const root of json.scenes[json.scene || 0].nodes) walk(root, I());

let min = [1e9,1e9,1e9], max = [-1e9,-1e9,-1e9];
for (let i = 0; i < verts.length; i += 3)
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], verts[i+k]);
    max[k] = Math.max(max[k], verts[i+k]);
  }
console.log("AABB min", min.map(v=>v.toFixed(0)), "max", max.map(v=>v.toFixed(0)));

const m = await createSimModule();
m._sim_create();
const vArr = new Float32Array(verts), iArr = new Uint32Array(indices);
const vPtr = m._malloc(vArr.byteLength); m.HEAPF32.set(vArr, vPtr >> 2);
const iPtr = m._malloc(iArr.byteLength); m.HEAPU32.set(iArr, iPtr >> 2);
const ok = m._sim_add_mesh(vPtr, vArr.length / 3, iPtr, iArr.length / 3, 3);
console.log("mesh added:", ok, "tris:", iArr.length / 3);
m._sim_add_box(min[0]-500, min[1]-600, min[2]-500, max[0]+500, min[1]-584, max[2]+500, 0); // catch floor
m._sim_world_finalize();

const ptr = m._sim_snapshot() >> 2;
function probe(x, z) {
  m._sim_spawn(x, max[1] + 200, z, 0);
  for (let i = 0; i < 400; i++) m._sim_step(0, 0, 0, 0, 0, 0);
  const y = m.HEAPF32[ptr + 3], flags = m.HEAPU32[ptr + 11];
  const grounded = (flags & 1) !== 0;
  const onCatchFloor = y < min[1] - 500;
  return { y, grounded, out: onCatchFloor };
}

const NX = 7, NZ = 9;
console.log("\nground map (rows z from min->max, cols x from min->max; '.'=fell out):");
for (let zi = 0; zi < NZ; zi++) {
  let row = "";
  const z = min[2] + ((zi + 0.5) / NZ) * (max[2] - min[2]);
  for (let xi = 0; xi < NX; xi++) {
    const x = min[0] + ((xi + 0.5) / NX) * (max[0] - min[0]);
    const r = probe(x, z);
    row += r.out ? "    .   " : (r.grounded ? String(r.y.toFixed(0)).padStart(7) + " " : "   ??   ");
  }
  console.log(`z=${z.toFixed(0).padStart(6)} ${row}`);
}

console.log("\nfine probe of T-plateau candidate area:");
for (let z = -2750; z <= -2050; z += 175) {
  let row = "";
  for (let x = -1700; x <= -400; x += 185) {
    const r = probe(x, z);
    row += r.out ? "    .   " : (r.grounded ? String(r.y.toFixed(0)).padStart(7) + " " : "   ??   ");
  }
  console.log(`z=${z.toFixed(0).padStart(6)} ${row}`);
}

console.log("\nwall-stick repro (walk to wall, jitter watch, reverse, strafe):");
const f = () => m.HEAPF32, u = () => m.HEAPU32;
for (const [name, yaw] of [["+Z", Math.PI], ["-X", Math.PI/2], ["+X", -Math.PI/2]]) {
  m._sim_spawn(-1330, 320, -2400, yaw);
  let pinnedAt = -1;
  for (let i = 0; i < 600; i++) {
    m._sim_step(1, 0, yaw, 0, 0, 0);
    if (i > 60 && f()[ptr+9] < 3 && (u()[ptr+11] & 1)) { pinnedAt = i; break; }
  }
  const px = f()[ptr+2], py = f()[ptr+3], pz = f()[ptr+4];
  let jitter = 0;
  for (let i = 0; i < 8; i++) {
    m._sim_step(1, 0, yaw, 0, 0, 0);
    jitter = Math.max(jitter, Math.abs(f()[ptr+3]-py), Math.abs(f()[ptr+2]-px), Math.abs(f()[ptr+4]-pz));
  }
  for (let i = 0; i < 128; i++) m._sim_step(-1, 0, yaw, 0, 0, 0);
  const back = Math.hypot(f()[ptr+2]-px, f()[ptr+4]-pz);
  m._sim_spawn(px, py + 2, pz, yaw);
  for (let i = 0; i < 128; i++) m._sim_step(1, 1, yaw, 0, 0, 0);
  const strafe = Math.hypot(f()[ptr+2]-px, f()[ptr+4]-pz);
  console.log(`${name}: pinned@${pinnedAt} pos=(${px.toFixed(0)},${py.toFixed(0)},${pz.toFixed(0)}) jitter=${jitter.toFixed(3)} reverse=${back.toFixed(1)}u strafe=${strafe.toFixed(1)}u`);
}

console.log("\nspawn candidates near B ground:");
for (const [x,z] of [[-1305,-1550],[-1305,-1700],[-1150,-1450],[-1450,-1450],[-1305,-1300]]) {
  const r = probe(x, z);
  console.log(`(${x},${z}) -> y=${r.y.toFixed(0)} grounded=${r.grounded} out=${r.out}`);
}
