# AGENTS.md

Repository guidance for any coding agent (Codex, Claude, Cursor, etc.).

## Roadmap

**`PLAN.md` is the spec.** cs-web is a CS 1.6-derivative browser shooter with
Quake-influenced level design: C++20 sim core (WASM in the browser, native for
tests and the future server), convex-brush collision, Three.js as the renderer,
npm/node 24 tooling. Read PLAN.md before touching movement, shooting, maps, art,
or networking — the milestone list defines what gets built next.

## Commands

- `npm run dev` — Vite dev server (uses the committed-state wasm; run `npm run wasm` first if the sim changed)
- `npm run wasm` — build the sim to `client/src/generated/sim.mjs` (needs Emscripten `emcc`)
- `npm run test` — configure + build + run native sim tests (ctest)
- `npm run mapcheck` — headless map validation against the real wasm sim
- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — wasm + typecheck + production bundle

Node ≥ 24, npm (no bun). CMake ≥ 3.24. **The build fetches nothing** — there are
no third-party C dependencies and no binary assets.

## Architecture

- `sim/` — all gameplay: movement (`pmove.cpp`), gunplay (`weapons.cpp`),
  convex-brush collision (`world.cpp`), bot AI (`bots.cpp`), orchestration +
  match rules + C ABI (`sim.cpp`). Fixed 64 Hz tick, flat POD state,
  `-fno-exceptions -fno-rtti`, deterministic (xorshift RNG in state,
  `-ffp-contract=off`).
- **The sim is multi-player.** `SimState` holds a roster of `kMaxPlayers`
  entities; index `kLocalPlayer` is the client's, the rest are bots. Bots emit
  an `InputCommand` from `bot_think` and run through the *same* `pmove_run` and
  `weapons_run` — never add a bot-only movement or accuracy path.
- `sim/include/cs/sim.h` — public types, tuning constants, and the C ABI.
  **The TS mirror of the snapshot layout lives in `client/src/sim.ts` (WORDS
  table) — change them together.** A byte-size assert plus an `api_version`
  check catch drift at load; neither catches a same-size field reshuffle, so
  bump `kSimApiVersion` when you reorder fields.
- `client/` — rendering/input/HUD/audio only. **No gameplay logic in TS.**
- `client/src/map/` — brushes are the single source of truth: the same plane
  sets feed `sim_add_brush` (collision) and the winding clipper (render
  geometry). Never introduce a separate collision mesh. A `MapDef` also carries
  its `mode`, `bots` and team-tagged `spawns`; register new maps in both
  `client/src/main.ts` and `tools/mapcheck.ts`.
- `client/src/art/` — all textures, characters, and weapons are generated in
  code. Do not add binary assets.
- Angles: radians, yaw 0 = −Z, +yaw = counter-clockwise; Y-up; GoldSrc units
  (1u = 1 inch).

## Verification

- After sim changes: `npm run test` (movement invariants + determinism hash)
  and `npm run wasm` must both pass.
- After map changes: `npm run mapcheck` — catches degenerate brushes, spawns
  that drop you through the floor or sit buried in a brush, team maps missing a
  side, and geometry that renders but isn't solid.
- After client changes: `npm run typecheck`; for behavior, `npm run dev` and
  check the feel list in PLAN.md §3 (`?map=practice`).
- Dev flags: `?map=`, `?bots=N`, `?skill=0..2`, `?spawn=x,y,z`, `?yaw=radians`,
  `?coords`. `?bots=0` is the quickest way to look at geometry undisturbed.

## Assets

- There are none, by design. Art is procedural (PLAN.md §5). Anything left
  under `assets/` is unused reference — see `assets/README.md`.
- `vite.config.ts` `publicDir` **must never** point at `assets/`: Vite copies
  publicDir verbatim into `dist/`, which previously staged Valve-derived
  `*_ref.glb` files into the deploy artifact.
- Art direction: PSX/GoldSrc-era low-poly **with textures** — no modern
  flat-shaded stylized low-poly.

## Conventions

- Gameplay tuning values live in `sim/include/cs/sim.h` / `sim/src/weapons.cpp`.
- Prefer simple, surgical changes; match existing style (C-style C++: POD
  structs + free functions, no exceptions/RTTI/iostream).
- No speculative systems — PLAN.md milestones define scope.
- Audio stays synthesized (Web Audio) until PLAN.md M-polish.
- GPL engines (Quake, xash3d) are behavior references only — never copy code.
