# FINDINGS.md — dust2 collision issues (2026-07-17)

Handoff notes on the wall-stick / doors / spawn problems reported on `?map=dust2`.
Context: PLAN.md §2 (architecture), AGENTS.md (commands). Sim = C++ WASM, 64 Hz;
collision = box3d **queries only** behind `sim/src/world.h`; movement =
quake-style pmove in `sim/src/pmove.cpp`.

## Symptoms reported

1. Walk up to a wall on dust2 → stuck (couldn't move away at all).
2. Can't pass through the B-site double doors.
3. Spawn was on a roof above B (outside playable space).

## Root causes found (headless repro: scratchpad dust2-probe.mjs drop/walk tests)

1. **Wedged hull on trimesh** — two compounding bugs, both fixed:
   - `world.cpp` traces accepted **backface/grazing triangle hits**. The dust2
     GLB is a one-sided *display* mesh, not a sealed collision hull; near walls
     and slopes, casts in almost any direction returned fraction≈0 hits whose
     normals point *with* the motion. Repro showed reverse AND strafe moving
     0.0u while `world_overlap_hull` said "not embedded".
   - `pmove.cpp slide_move` zeroed velocity when the same plane was hit
     repeatedly at fraction 0 (trace backoff clamps to 0, so contact-distance
     grazes re-hit forever).
   - **Fixes** (commit this session): cast callback rejects surfaces with
     `dot(normal, castDir) >= 0`; slide loop got Q3-style hardening —
     overclip 1.001, duplicate-plane velocity nudge instead of plane-slot burn,
     and a bounded overlap-checked pull-off when a bump produced zero movement.
   - **Verified**: wall repro reverse went 0→340-408u on all headings; all 10
     native tests (arena hulls) still pass. Hull-world behavior unchanged.

2. **B doors impassable** — *asset limitation, not code*: the GLB models the
   B double doors as closed geometry. No collision fix can open them.
   Options: (a) strip door triangles at import (hard: mesh has no semantic
   material names, only `material_N`), (b) author a hole in Blender on the
   local copy, (c) accept until PLAN.md M-content replaces ref assets with a
   sealed authored collision mesh. Recommend (c), or (b) if it blocks playtests.

3. **Bad spawn** — the probe grid mistook the large flat roof above B for a
   playable plateau (no semantic data in the mesh; drop-probes can't tell roof
   from floor). Now spawns on probed B-site ground `(-1305, 90, -1600)`
   (lands y=42). Tools added: `?spawn=x,y,z` URL override + HUD shows live
   player coords — walk somewhere good, read coords, hardcode them.

## "Should we use more libraries?"

Collision *is* a library (box3d) — the bugs were in (a) feeding it a one-sided
display mesh as if it were a collision hull (data problem; no library fixes bad
data) and (b) our pmove glue, now hardened with standard Quake-3 techniques.
Options if sliding still feels off:

- **box3d character mover** (`b3World_CastMover` + `b3World_CollideMover` +
  `b3SolvePlanes`): purpose-built slide/depenetration solver, would replace
  slide_move's contact handling. Tradeoff: capsule-shaped mover (not the
  GoldSrc 32×32 box) — subtly different feel on steps/edges. Worth a spike
  behind the existing `world.h` interface if trimesh movement still misbehaves.
- Not recommended: a full physics-driven character (rigid body + forces) —
  incompatible with 1.6 movement feel.
- The durable fix for map collision is PLAN.md M-content: sealed convex-hull
  collision authored from map source (TrenchBroom), where the display mesh is
  never the collision source. dust2-on-trimesh is a dev convenience.

## State / how to verify

- All commits on `main` (latest: this fix). `npm run test` = 10/10;
  `npm run wasm` rebuilt; `npx tsc --noEmit` clean.
- Headless repro tooling (GLB→sim mesh loader, ground probes, wall repro):
  session scratchpad `dust2-probe.mjs` — worth committing under `tools/` if
  this work continues.
- Known-good dust2 coords: B ground y=42 near (-1305, -1550..-1700); big roof
  plateau (not playable) y 255-336 at z≈-2400. Map AABB:
  x -2149..1582, y -161..348, z -3099..1284 (GoldSrc units, ×39.37 from GLB).
