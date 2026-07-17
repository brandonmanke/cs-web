import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BoxDef, HullDef, TargetDef } from "./arena";
import type { Snapshot } from "./sim";

export const METERS_TO_UNITS = 39.37; // ref assets are meter scale, sim is GoldSrc units

const MATERIAL_COLORS = [0x8a8a80, 0x8a6a45, 0x6a7a8a, 0xb89a68];

// Hitbox silhouette mirrored from sim/src/weapons.cpp kHitboxes.
const TARGET_PARTS: Array<{ min: number[]; max: number[]; color: number }> = [
  { min: [-6, 58, -6], max: [6, 72, 6], color: 0xd8b890 },   // head
  { min: [-12, 38, -7], max: [12, 58, 7], color: 0x506a50 }, // chest
  { min: [-11, 26, -7], max: [11, 38, 7], color: 0x46584a }, // stomach
  { min: [-14, 0, -6], max: [14, 26, 6], color: 0x3c4a42 },  // legs
];

interface Tracer {
  line: THREE.Line;
  ttl: number;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly gl: THREE.WebGLRenderer;
  private readonly targetGroups: THREE.Group[] = [];
  private readonly targetMaterials: THREE.MeshStandardMaterial[][] = [];
  private tracers: Tracer[] = [];

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: false });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(
      90, window.innerWidth / window.innerHeight, 1, 32768,
    );
    this.camera.rotation.order = "YXZ";

    this.scene.background = new THREE.Color(0x18201c);
    this.scene.fog = new THREE.Fog(0x18201c, 2200, 9000);
    this.scene.add(new THREE.HemisphereLight(0xcfd8c8, 0x3a3830, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    sun.position.set(0.4, 1, 0.25).multiplyScalar(4096);
    this.scene.add(sun);

    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.gl.setSize(window.innerWidth, window.innerHeight);
    });
  }

  buildBoxes(boxes: BoxDef[]): void {
    for (const box of boxes) {
      const size = [
        box.max[0] - box.min[0],
        box.max[1] - box.min[1],
        box.max[2] - box.min[2],
      ];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[box.mat] ?? 0x808080 }),
      );
      mesh.position.set(
        (box.min[0] + box.max[0]) / 2,
        (box.min[1] + box.max[1]) / 2,
        (box.min[2] + box.max[2]) / 2,
      );
      this.scene.add(mesh);
    }
  }

  buildHulls(hulls: HullDef[]): void {
    for (const hull of hulls) {
      const points: THREE.Vector3[] = [];
      for (let i = 0; i < hull.points.length; i += 3) {
        points.push(new THREE.Vector3(hull.points[i], hull.points[i + 1], hull.points[i + 2]));
      }
      // Wedge (6 points): build the prism faces explicitly.
      const geometry = new THREE.BufferGeometry();
      const v = hull.points;
      // points order: 0/1 near-bottom, 2/3 far-bottom, 4/5 far-top
      const tri = (a: number, b: number, c: number) => [
        v[a * 3]!, v[a * 3 + 1]!, v[a * 3 + 2]!,
        v[b * 3]!, v[b * 3 + 1]!, v[b * 3 + 2]!,
        v[c * 3]!, v[c * 3 + 1]!, v[c * 3 + 2]!,
      ];
      const positions = new Float32Array([
        ...tri(0, 4, 5), ...tri(0, 5, 1), // slope
        ...tri(0, 2, 4), // left side
        ...tri(1, 5, 3), // right side
        ...tri(2, 5, 4), ...tri(2, 3, 5), // back
        ...tri(0, 1, 2), ...tri(1, 3, 2), // bottom
      ]);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS[hull.mat] ?? 0x808080 }),
      );
      this.scene.add(mesh);
    }
  }

  buildTargets(defs: TargetDef[]): void {
    for (let i = 0; i < defs.length; ++i) {
      const group = new THREE.Group();
      const materials: THREE.MeshStandardMaterial[] = [];
      for (const part of TARGET_PARTS) {
        const size = [
          part.max[0]! - part.min[0]!,
          part.max[1]! - part.min[1]!,
          part.max[2]! - part.min[2]!,
        ];
        const material = new THREE.MeshStandardMaterial({ color: part.color });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
        mesh.position.set(
          (part.min[0]! + part.max[0]!) / 2,
          (part.min[1]! + part.max[1]!) / 2,
          (part.min[2]! + part.max[2]!) / 2,
        );
        group.add(mesh);
        materials.push(material);
      }
      this.scene.add(group);
      this.targetGroups.push(group);
      this.targetMaterials.push(materials);
    }
  }

  updateTargets(snapshot: Snapshot): void {
    for (let i = 0; i < this.targetGroups.length && i < snapshot.targetCount; ++i) {
      const group = this.targetGroups[i]!;
      const view = snapshot.targets[i]!;
      group.visible = view.alive;
      group.position.set(view.x, view.y, view.z);
      const flashing = view.flash > 0;
      for (const material of this.targetMaterials[i]!) {
        material.emissive.setHex(flashing ? 0xa03020 : 0x000000);
      }
    }
  }

  // Load the dust2 reference GLB; returns merged collision geometry in sim units.
  async loadDust2(): Promise<{ vertices: Float32Array; indices: Uint32Array } | null> {
    const loader = new GLTFLoader();
    let gltf;
    try {
      gltf = await loader.loadAsync("/maps/de_dust2_ref.glb");
    } catch {
      return null;
    }
    const root = gltf.scene;
    root.scale.setScalar(METERS_TO_UNITS);
    root.updateMatrixWorld(true);
    this.scene.add(root);

    const chunks: { positions: Float32Array; index: Uint32Array }[] = [];
    let vertexTotal = 0;
    let indexTotal = 0;
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geometry = mesh.geometry;
      const position = geometry.getAttribute("position");
      if (!position) return;
      const positions = new Float32Array(position.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < position.count; ++i) {
        v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        positions[i * 3] = v.x;
        positions[i * 3 + 1] = v.y;
        positions[i * 3 + 2] = v.z;
      }
      let index: Uint32Array;
      if (geometry.index) {
        index = new Uint32Array(geometry.index.count);
        for (let i = 0; i < geometry.index.count; ++i) {
          index[i] = geometry.index.getX(i);
        }
      } else {
        index = new Uint32Array(position.count);
        for (let i = 0; i < position.count; ++i) index[i] = i;
      }
      chunks.push({ positions, index });
      vertexTotal += position.count;
      indexTotal += index.length;
    });

    const vertices = new Float32Array(vertexTotal * 3);
    const indices = new Uint32Array(indexTotal);
    let vOffset = 0;
    let iOffset = 0;
    for (const chunk of chunks) {
      vertices.set(chunk.positions, vOffset * 3);
      for (let i = 0; i < chunk.index.length; ++i) {
        indices[iOffset + i] = chunk.index[i]! + vOffset;
      }
      vOffset += chunk.positions.length / 3;
      iOffset += chunk.index.length;
    }
    return { vertices, indices };
  }

  spawnTracer(start: [number, number, number], end: [number, number, number]): void {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(...start),
      new THREE.Vector3(...end),
    ]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.7 }),
    );
    this.scene.add(line);
    this.tracers.push({ line, ttl: 0.06 });
  }

  updateTracers(dt: number): void {
    this.tracers = this.tracers.filter((tracer) => {
      tracer.ttl -= dt;
      if (tracer.ttl <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        return false;
      }
      return true;
    });
  }

  render(
    prev: Snapshot, curr: Snapshot, alpha: number,
    yaw: number, pitch: number,
  ): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    this.camera.position.set(
      lerp(prev.origin[0], curr.origin[0]),
      lerp(prev.origin[1], curr.origin[1]) + lerp(prev.eyeHeight, curr.eyeHeight),
      lerp(prev.origin[2], curr.origin[2]),
    );
    this.camera.rotation.set(pitch + curr.punchPitch, yaw + curr.punchYaw, 0);
    this.gl.render(this.scene, this.camera);
  }
}
