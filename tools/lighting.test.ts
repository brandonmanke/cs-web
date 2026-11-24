import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { box, brushPlaneArray, Surface, type Brush } from "../client/src/map/brush";
import { buildMapGeometry, sampleLightProbe } from "../client/src/map/build";
import type { SunLight } from "../client/src/map/mapdef";
import { DUSTYARD } from "../client/src/map/maps/dustyard";
import { FOUNDRY } from "../client/src/map/maps/foundry";
import { Sim } from "../client/src/sim";

// Minimal canvas shim so procedural texture fallbacks run offline in Node.
const noop = () => {};
Object.assign(globalThis, {
  document: {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => ({
        fillStyle: "",
        strokeStyle: "",
        lineWidth: 1,
        font: "",
        textAlign: "",
        textBaseline: "",
        globalAlpha: 1,
        globalCompositeOperation: "source-over",
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: noop,
        fillRect: noop,
        strokeRect: noop,
        clearRect: noop,
        beginPath: noop,
        moveTo: noop,
        lineTo: noop,
        closePath: noop,
        fill: noop,
        stroke: noop,
        arc: noop,
        fillText: noop,
        save: noop,
        restore: noop,
        translate: noop,
        rotate: noop,
        scale: noop,
        setLineDash: noop,
        clip: noop,
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop }),
      }),
    }),
  },
});

function getLightMap(meshes: THREE.Object3D[]): THREE.DataTexture {
  for (const obj of meshes) {
    if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshBasicMaterial && obj.material.lightMap) {
      return obj.material.lightMap as THREE.DataTexture;
    }
  }
  throw new Error("expected a baked lightMap texture on world meshes");
}

function sampleMeshLightRgb(mesh: THREE.Mesh, lm: THREE.DataTexture): [number, number, number] {
  const uv1 = mesh.geometry.getAttribute("uv1");
  const pos = mesh.geometry.getAttribute("position");
  const norm = mesh.geometry.getAttribute("normal");
  const data = lm.image.data as Uint16Array;
  const w = lm.image.width;
  const h = lm.image.height;

  // Find the UV1 bounding box of the +X inner wall face (x ≈ -160) and sample its interior luxels.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < uv1.count; ++i) {
    if (norm.getX(i) < 0.9 || Math.abs(pos.getX(i) + 160) > 4) continue;
    uMin = Math.min(uMin, uv1.getX(i));
    uMax = Math.max(uMax, uv1.getX(i));
    vMin = Math.min(vMin, uv1.getY(i));
    vMax = Math.max(vMax, uv1.getY(i));
  }
  assert.ok(uMax > uMin && vMax > vMin, "expected non-degenerate UV1 chart on target wall face");

  const x0 = Math.max(0, Math.floor((uMin + (uMax - uMin) * 0.25) * w));
  const x1 = Math.min(w - 1, Math.floor((uMin + (uMax - uMin) * 0.75) * w));
  const y0 = Math.max(0, Math.floor((vMin + (vMax - vMin) * 0.25) * h));
  const y1 = Math.min(h - 1, Math.floor((vMin + (vMax - vMin) * 0.75) * h));

  let sr = 0, sg = 0, sb = 0, count = 0;
  for (let y = y0; y <= y1; ++y) {
    for (let x = x0; x <= x1; ++x) {
      const idx = (y * w + x) * 4;
      sr += THREE.DataUtils.fromHalfFloat(data[idx]!);
      sg += THREE.DataUtils.fromHalfFloat(data[idx + 1]!);
      sb += THREE.DataUtils.fromHalfFloat(data[idx + 2]!);
      ++count;
    }
  }
  assert.ok(count > 0, "expected interior luxels on target wall face");
  return [sr / count, sg / count, sb / count];
}

test("2-bounce radiosity lifts shaded wall luminance with warm color bleeding from sunlit sand", async () => {
  // Open courtyard with a sunlit sand floor and a tall shaded concrete wall facing +X
  // (sun shines from -X, so the +X inner face is in self-shadow while staring at sunlit sand).
  const brushes: Brush[] = [
    box([-192, -32, -192], [192, 0, 192], Surface.sand, "sand"),
    box([-192, 0, -192], [-160, 192, 192], Surface.concrete, "concrete"),
  ];
  const sun: SunLight = {
    dir: [-0.55, 0.78, 0.28],
    color: [1.0, 0.90, 0.72],
    intensity: 1.5,
    skyColor: [0.45, 0.60, 0.85],
    skyIntensity: 0.3,
  };
  const sim = await Sim.load();
  for (const b of brushes) sim.addBrush(brushPlaneArray(b), b.surface);
  sim.finalizeWorld();

  const directOnly = buildMapGeometry(
    brushes, [], [0.06, 0.06, 0.07],
    (a, b) => sim.isBlocked(a, b),
    sun, undefined, undefined, undefined,
  );
  const radiosity = buildMapGeometry(
    brushes, [], [0.06, 0.06, 0.07],
    (a, b) => sim.isBlocked(a, b),
    sun, undefined, undefined, (a, b) => sim.traceRay(a, b),
  );

  const directLm = getLightMap(directOnly.meshes);
  const radLm = getLightMap(radiosity.meshes);

  const directWall = directOnly.meshes.find((m) => m.name === "world:concrete") as THREE.Mesh;
  const radWall = radiosity.meshes.find((m) => m.name === "world:concrete") as THREE.Mesh;
  const [dr, dg, db] = sampleMeshLightRgb(directWall, directLm);
  const [rr, rg, rb] = sampleMeshLightRgb(radWall, radLm);

  // Radiosity must visibly lift the shaded wall AND shift its warm R/B ratio toward sunlit sand.
  assert.ok(rr > dr + 0.08, `expected radiosity red (${rr.toFixed(3)}) > direct (${dr.toFixed(3)}) + 0.08`);
  assert.ok(rg > dg + 0.05, `expected radiosity green (${rg.toFixed(3)}) > direct (${dg.toFixed(3)}) + 0.05`);
  assert.ok(
    rr / Math.max(rb, 1e-4) > dr / Math.max(db, 1e-4) + 0.12,
    `expected warm color bleed on shaded wall (rad R/B=${(rr / rb).toFixed(2)} vs direct ${(dr / db).toFixed(2)})`,
  );
});

test("soft solar disc penumbra produces smooth intermediate shadow values across a cast shadow edge", async () => {
  // Floor + overhead lintel casting a midday shadow across the floor.
  const brushes: Brush[] = [
    box([-256, -32, -256], [256, 0, 256], Surface.concrete, "concrete"),
    box([-128, 128, -128], [0, 160, 128], Surface.concrete, "concrete_dark"),
  ];
  const sun: SunLight = {
    dir: [0.15, 0.98, 0.05],
    color: [1.0, 0.94, 0.80],
    intensity: 1.4,
    skyColor: [0.4, 0.5, 0.7],
    skyIntensity: 0.25,
  };
  const sim = await Sim.load();
  for (const b of brushes) sim.addBrush(brushPlaneArray(b), b.surface);
  sim.finalizeWorld();

  const built = buildMapGeometry(
    brushes, [], [0.05, 0.05, 0.05],
    (a, b) => sim.isBlocked(a, b),
    sun, undefined, undefined, (a, b) => sim.traceRay(a, b),
  );
  const lm = getLightMap(built.meshes);
  const data = lm.image.data as Uint16Array;

  // Verify zero NaNs/Infinities and verify we observe dark shadow, bright sun, AND intermediate penumbra luxels.
  let minLum = Infinity;
  let maxLum = -Infinity;
  const lums: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = THREE.DataUtils.fromHalfFloat(data[i]!);
    const g = THREE.DataUtils.fromHalfFloat(data[i + 1]!);
    const b = THREE.DataUtils.fromHalfFloat(data[i + 2]!);
    assert.ok(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b), "lightmap contains non-finite value");
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    if (lum > 0.001) {
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
      lums.push(lum);
    }
  }
  const midLo = minLum + (maxLum - minLum) * 0.25;
  const midHi = minLum + (maxLum - minLum) * 0.75;
  const midCount = lums.filter((l) => l >= midLo && l <= midHi).length;
  assert.ok(maxLum - minLum > 0.5, `expected strong shadow contrast (min=${minLum.toFixed(2)}, max=${maxLum.toFixed(2)})`);
  assert.ok(midCount > 20, `expected smooth penumbra transition luxels, found ${midCount}`);
});

test("dustyard and foundry bake cleanly within atlas and latency budgets and light probes separate sun vs tunnel", async () => {
  for (const map of [DUSTYARD, FOUNDRY]) {
    const sim = await Sim.load();
    for (const b of map.brushes) {
      if (b.solid !== false) sim.addBrush(brushPlaneArray(b), b.surface);
    }
    sim.finalizeWorld();

    const t0 = performance.now();
    const built = buildMapGeometry(
      map.brushes, map.lights, map.ambient,
      (a, b) => sim.isBlocked(a, b),
      map.sun, map.props, map.decals,
      (a, b) => sim.traceRay(a, b),
    );
    const ms = performance.now() - t0;

    assert.ok(built.atlasHeight <= 2048, `${map.name} atlasHeight ${built.atlasHeight} exceeds 2048`);
    assert.ok(built.luxelCount > 10000, `${map.name} expected >10k radiosity gathers, got ${built.luxelCount}`);
    assert.ok(ms < 4000, `${map.name} bake took ${ms.toFixed(0)}ms (budget < 4000ms)`);

    // Verify zero NaN/Inf in the final half-float lightmap.
    const lm = getLightMap(built.meshes);
    const data = lm.image.data as Uint16Array;
    for (let i = 0; i < data.length; i += 4) {
      assert.ok(Number.isFinite(THREE.DataUtils.fromHalfFloat(data[i]!)), `${map.name} lightmap has non-finite R`);
      assert.ok(Number.isFinite(THREE.DataUtils.fromHalfFloat(data[i + 1]!)), `${map.name} lightmap has non-finite G`);
      assert.ok(Number.isFinite(THREE.DataUtils.fromHalfFloat(data[i + 2]!)), `${map.name} lightmap has non-finite B`);
    }

    if (map.name === "dustyard") {
      // Sunlit Mid courtyard vs dark vaulted West Tunnel.
      const outdoor = sampleLightProbe([0, 64, -120], map.lights, map.ambient, (a, b) => sim.isBlocked(a, b), map.sun);
      const tunnel = sampleLightProbe([-450, 64, 0], map.lights, map.ambient, (a, b) => sim.isBlocked(a, b), map.sun);
      const outSky = outdoor.sky[0] + outdoor.sky[1] + outdoor.sky[2];
      const tunSky = tunnel.sky[0] + tunnel.sky[1] + tunnel.sky[2];
      assert.ok(outSky > tunSky + 0.4, `expected outdoor sky (${outSky.toFixed(2)}) > tunnel (${tunSky.toFixed(2)})`);
      assert.ok(outdoor.keyDir[1] > 0.3, `expected outdoor keyDir pointing upward toward sun: ${outdoor.keyDir}`);
    }
  }
});
