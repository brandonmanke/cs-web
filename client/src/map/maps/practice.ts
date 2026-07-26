import { box, ramp, stairs, Surface, type Brush } from "../brush";
import type { MapDef } from "../mapdef";

// PRACTICE — the movement/aim greybox, kept because it is the fastest way to
// feel whether a pmove change broke something. Every obstacle here exists to
// probe one rule from PLAN.md section 3: step height, duck-jump clearance,
// stair smoothness, slope handling, bhop chaining.

const brushes: Brush[] = [];

// Floor and perimeter.
brushes.push(box([-1024, -16, -1024], [1024, 0, 1024], Surface.sand, "sand"));
brushes.push(
  box([-1056, 0, -1056], [1056, 256, -1024], Surface.concrete, "concrete"),
  box([-1056, 0, 1024], [1056, 256, 1056], Surface.concrete, "concrete"),
  box([-1056, 0, -1024], [-1024, 256, 1024], Surface.concrete, "concrete"),
  box([1024, 0, -1024], [1056, 256, 1024], Surface.concrete, "concrete"),
  box([-1056, 256, -1056], [1056, 288, 1056], Surface.concrete, "tech"),
);

// 36u crate (walk-jumpable) and 64u crate (needs a duck-jump).
brushes.push(
  box([-200, 0, -100], [-136, 36, -36], Surface.wood, "crate"),
  box([-320, 0, -100], [-256, 64, -36], Surface.wood, "crate"),
);

// Stacked crates: 36 then 36 again.
brushes.push(
  box([140, 0, -160], [204, 36, -96], Surface.wood, "crate"),
  box([148, 36, -152], [204, 72, -104], Surface.metal, "metal"),
);

// Stair set onto a platform — should feel smooth, never launch you.
brushes.push(...stairs([300, 0, -80], [428, 48, 80], 4, "+x", Surface.concrete, "concrete"));
brushes.push(box([428, 0, -80], [560, 48, 80], Surface.concrete, "concrete"));

// Duck tunnel: 50u of clearance.
brushes.push(
  box([-560, 0, -64], [-536, 96, 64], Surface.concrete, "concrete"),
  box([-424, 0, -64], [-400, 96, 64], Surface.concrete, "concrete"),
  box([-536, 50, -64], [-424, 96, 64], Surface.concrete, "concrete"),
);

// Cover blocks near the target range.
brushes.push(
  box([-96, 0, -420], [96, 32, -388], Surface.metal, "metal"),
  box([-620, 0, -520], [-460, 48, -360], Surface.concrete, "concrete"),
  box([460, 0, -520], [620, 48, -360], Surface.concrete, "concrete"),
);

// Ramp onto a platform: the slope case the brush trace has to get right.
brushes.push(ramp([-80, 0, 200], [80, 64, 360], "+z", Surface.concrete, "concrete"));
brushes.push(box([-80, 0, 360], [80, 64, 440], Surface.concrete, "concrete"));

const lights = [
  { pos: [0, 220, 0] as [number, number, number], color: [1.0, 0.94, 0.82] as [number, number, number], intensity: 1.1, radius: 1500 },
  { pos: [-500, 200, -500] as [number, number, number], color: [1.0, 0.86, 0.62] as [number, number, number], intensity: 0.9, radius: 1100 },
  { pos: [500, 200, -500] as [number, number, number], color: [1.0, 0.86, 0.62] as [number, number, number], intensity: 0.9, radius: 1100 },
  { pos: [0, 200, 600] as [number, number, number], color: [0.85, 0.92, 1.0] as [number, number, number], intensity: 0.9, radius: 1100 },
];

export const PRACTICE: MapDef = {
  name: "practice",
  brushes,
  lights,
  ambient: [0.30, 0.30, 0.32],
  spawn: [0, 38, 640],
  spawnYaw: 0, // facing -Z, toward the target range
  targets: [
    { x: 0, y: 0, z: -550, minX: 0, maxX: 0, speed: 0 },
    { x: -150, y: 0, z: -680, minX: -380, maxX: 60, speed: 90 },
    { x: 150, y: 0, z: -800, minX: -40, maxX: 380, speed: 150 },
  ],
  background: 0x141a16,
  fog: [1400, 4200],
};
