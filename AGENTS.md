# AGENTS.md

Repository guidance for any coding agent (Codex, Claude, Cursor, etc.).

## Roadmap

**`PLAN.md` is the spec.** cs-web is a CS 1.6-derivative browser shooter:
C++20 sim core (WASM in the browser, native for tests and the future server),
box3d for collision queries, Three.js as the renderer, npm/node 24 tooling.
Read PLAN.md before touching movement, shooting, maps, or networking — the
milestone list defines what gets built next.

## Commands

- `npm run dev` — Vite dev server (uses the committed-state wasm; run `npm run wasm` first if sim changed)
- `npm run wasm` — build the sim to `client/src/generated/sim.mjs` (needs Emscripten `emcc`)
- `npm run test` — configure + build + run native sim tests (ctest)
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — wasm + typecheck + production bundle

Node ≥ 24, npm (no bun). CMake ≥ 3.24. First native/wasm configure fetches
box3d via FetchContent (network needed once per build dir).

## Architecture

- `sim/` — all gameplay: movement (`pmove.cpp`), gunplay (`weapons.cpp`),
  collision wrapper over box3d (`world.cpp`), orchestration + C ABI (`sim.cpp`).
  Fixed 64 Hz tick, flat POD state, `-fno-exceptions -fno-rtti`, deterministic
  (xorshift RNG in state, `-ffp-contract=off`).
- `sim/include/cs/sim.h` — public types, tuning constants, and the C ABI.
  **The TS mirror of the snapshot layout lives in `client/src/sim.ts` (WORDS
  table) — change them together**; a byte-size assert catches drift at load.
- `client/` — rendering/input/HUD/audio only. **No gameplay logic in TS.**
  The greybox arena data (`client/src/arena.ts`) feeds both sim and renderer.
- box3d is queries-only (swept hull + ray casts); the player is kinematic.
  Keep box3d behind `sim/src/world.h` so it stays swappable.
- Angles: radians, yaw 0 = −Z, +yaw = counter-clockwise; Y-up; GoldSrc units
  (1u = 1 inch). Ref assets scale ×39.37 on import.

## Verification

- After sim changes: `npm run test` (movement invariants + determinism hash)
  and `npm run wasm` must both pass.
- After client changes: `npm run typecheck`; for behavior, `npm run dev` and
  check the feel list in PLAN.md §3 (arena) or `?map=dust2`.

## Assets

- `assets/**/*_ref.glb` are Valve-derived Sketchfab models: dev placeholders
  only, gitignored, never shipped. `assets/models/psx/` packs are CC0 and
  committed; provenance lives in `assets/README.md`.
- Art direction: PSX/GoldSrc-era low-poly **with textures** — no modern
  flat-shaded stylized low-poly. New assets must be original or CC0; record
  provenance in `assets/README.md`.

## Conventions

- Gameplay tuning values live in `sim/include/cs/sim.h` / `sim/src/weapons.cpp`.
- Prefer simple, surgical changes; match existing style (C-style C++: POD
  structs + free functions, no exceptions/RTTI/iostream).
- No speculative systems — PLAN.md milestones define scope.
- Audio stays synthesized (Web Audio) until PLAN.md M-content.
- GPL engines (Quake, xash3d) are behavior references only — never copy code.
