# PLAN.md — cs-web v2

Browser CS 1.6-derivative shooter. This is the v2 plan after the ground-up rework
(2026-07-17): the TypeScript aim trainer is gone; the game now runs on a C++ sim
core with box3d collision, rendered by Three.js. (The v1 research document, with
sources for every movement/gunplay fact below, lives in git history: `8f0f180`.)

## 1. Vision

- 1.6 *feel*: GoldSrc movement (air-strafing, capped bhop with stamina,
  duck-jumps), punchy hitscan gunplay with learnable spray patterns.
  Derivative, not a rip.
- Low barrier (click a URL), high ceiling. Single player vs bots + small-server
  multiplayer.
- PSX/GoldSrc-era textured low-poly art. Original or CC0 assets only.

## 2. Architecture (implemented)

```
client (TS + Three.js + Vite)          sim core (C++20 -> WASM via Emscripten)
  renderer / input / HUD / audio  <->    fixed 64 Hz tick, flat POD state
  feeds world geometry in,               quake-style pmove (ours)
  reads SimSnapshot out (C ABI)          gunplay: spray tables + punch + falloff
                                         collision queries -> box3d (vendored)
```

- **Sim owns all gameplay.** The client is a dumb terminal: it samples input,
  calls `sim_step()`, interpolates between the last two snapshots, renders.
  No gameplay logic in TS — that rule is what makes the future server build
  (the same C++ compiled native) authoritative for free.
- **box3d** (Erin Catto, C17, MIT, pinned by commit via CMake FetchContent)
  provides collision *queries only*: swept-hull and ray casts against a static
  world of convex hulls + triangle meshes. The player stays kinematic — box3d
  never owns it. Wrapped behind `world_trace_hull`/`world_trace_ray`
  (sim/src/world.h) so it's swappable. The wasm build sets
  `BOX3D_DISABLE_SIMD` (clang 23 crashes on its SSE2→wasm-SIMD path; scalar is
  plenty for query workloads). Later free wins: grenades, ragdolls, props as
  rigid bodies.
- **Units/axes:** GoldSrc units (1u = 1 inch), Y-up (matches glTF/Three.js).
  Meter-scale ref assets scale ×39.37 at import.
- **Determinism:** `-ffp-contract=off` everywhere, xorshift RNG inside sim
  state, determinism verified by a hash test. Cross-platform bit-equality of
  libm sin/cos is an open question for netcode rollback — revisit at M-net.

## 3. Movement spec (implemented, tested in sim/tests)

| Constant | Value | Notes |
|---|---|---|
| tick | 64 Hz fixed | client interpolates between snapshots |
| gravity | 800 | |
| accel / airaccel | 5 / 10 | air wishspeed cap **30** → air-strafing works |
| friction / stopspeed | 4 / 75 | |
| max speed | 250 base, per-weapon (AK 221) | ducked ×0.333 |
| jump | √(2·800·45) ≈ 268.33 | 45u apex, asserted by test |
| bhop cap | 1.7 × maxspeed, excess ×0.65 | PM_PreventMegaBunnyJumping |
| stamina | 1315.789429, −1000/s | scales jump impulse and landing speed (≈25% fresh) |
| hull | 32×32×72, ducked 32×32×36 | eye +28 / +12 above hull center |
| step height | 18u | step_slide_move up/down compare |
| ground slope | normal.y ≥ 0.7 | |

Feel checklist (manual, in browser): strafe-jumping gains speed, bhop capped but
chainable, duck-jump clears 36u crates, stairs don't launch you, no jitter
resting against surfaces.

## 4. Gunplay spec (implemented, first pass)

- Deterministic 30-shot spray pattern (climb → left drift → right swing),
  scaled per weapon; pattern resets after `recovery_ticks` without firing.
- Inaccuracy: base spread × (1 + 2.5·speed/250, +5 airborne, ×0.7 ducked).
- View punch per shot with exponential decay. Punch is visual (client adds it
  to the camera); the pattern table controls actual bullet dirs (CS:GO-style
  split rather than GoldSrc punch-driven spray).
- Damage: base × rangeMod^(dist/500) × hitgroup (head ×4, stomach ×1.25,
  legs ×0.75).
- Hitboxes: 4 AABBs per target (head/chest/stomach/limbs), ray-slab tested in
  the sim; the box3d world ray bounds the search so walls block shots.
- Weapon table (AK, M4A1, AWP, MP5, Glock, USP, knife stub) in
  `sim/src/weapons.cpp`.
- Not yet: wallbang penetration, per-weapon movement-inaccuracy curves, real
  melee, weapon-switch/reload animations.

## 5. Repo layout

```
sim/                  C++20 core: pmove.cpp, weapons.cpp, world.cpp, sim.cpp
sim/include/cs/sim.h  public types + tuning constants + C ABI
sim/tests/            native ctest: movement invariants + determinism hash
client/               TS: main.ts loop, sim.ts (snapshot mirror), renderer.ts,
                      input.ts, hud.ts, audio.ts, viewmodel.ts, arena.ts
client/src/generated/ sim.mjs wasm artifact (gitignored, `npm run wasm`)
assets/               ref GLBs (gitignored) + committed CC0 PSX packs
build/native|wasm     cmake outputs (gitignored)
```

The greybox arena is defined once in `client/src/arena.ts` and fed to both the
sim (collision) and the renderer, so you collide with exactly what you see.
dust2 (`?map=dust2`) loads the ref GLB, bakes/merges its triangles, and feeds
them to `sim_add_mesh` the same way.

## 6. Milestones

Done in this rework:

- **R0** — build system: CMake presets, box3d FetchContent (pinned d421e45c),
  Emscripten wasm target, Vite + npm + node 24 client, headless wasm smoke test.
- **R1** — full pmove on the greybox arena; invariant tests (speed cap, jump
  apex, bhop clamp, air wishcap, step-up vs wall, duck headroom) pass.
- **R2** — dust2 trimesh walkable, AK spray gunplay vs patrol dummies, PSX
  viewmodel, synth audio, HUD (ammo/speed/kills/acc/hitmarker), tracers.

Next, in order:

- **M-net** — authoritative server: compile the sim native (already proven by
  the test binary), WebRTC DataChannels (libdatachannel server-side, browser
  API client-side), WebSocket signaling, client prediction + reconciliation,
  snapshot delta vs last-acked. Budget ≤30 kB/s down per client. Harness:
  150 ms + 5% loss must stay playable.
- **M-bots** — server-side bots: nav via "can I stand here" flood-fill sampling
  over the trace API (works on hull worlds and trimesh dust2 alike), waypoint
  pathing, humanized aim/error model.
- **M-modes** — FFA/DM scoring, spawn logic, round loop; defuse later.
- **M-content** — original map (TrenchBroom → hull compiler feeding
  `sim_add_hull`), replace ref assets, sampled audio, rigged player models
  (hazmat or PSX character pack), animations.
- **M-polish** — viewmodel anims, impact decals per material, netcode juice,
  perf pass (instancing, draw batching).

## 7. Rules that don't change

- `*_ref.glb` files are Valve-derived Sketchfab rips: dev-only, gitignored,
  never shipped. Replaced by M-content.
- GPL engines (Quake, xash3d) are *behavior* references only — no code copied.
- New assets: original or CC0, provenance recorded in `assets/README.md`,
  PSX-era textured low-poly only.
- Gameplay tuning lives in `sim/include/cs/sim.h` and `sim/src/weapons.cpp` —
  never in client TS.
