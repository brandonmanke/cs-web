# PLAN.md — cs-web v3

Browser CS 1.6-derivative shooter. This is the v3 plan after the art/collision
rework (2026-07-25). v2 (`74f2af9`) established the C++ sim core; v3 removed the
last third-party dependency, replaced triangle-mesh collision with authored
convex brushes, and made every asset procedural. (The v1 research document, with
sources for every movement/gunplay fact below, lives in git at `8f0f180`.)

## 1. Vision

- 1.6 *feel*: GoldSrc movement (air-strafing, capped bhop with stamina,
  duck-jumps), punchy hitscan gunplay with learnable spray patterns.
  Derivative, not a rip.
- Quake's *eye*: enclosed industrial arenas, brush-built architecture, baked
  pools of light and deep shadow, verticality with multiple routes between
  levels.
- Low barrier (click a URL), high ceiling. Single player vs bots + small-server
  multiplayer.
- PSX/GoldSrc-era textured low-poly art, **generated in code**.

## 2. Architecture

```
client (TS + Three.js + Vite)          sim core (C++20 -> WASM via Emscripten)
  renderer / input / HUD / audio  <->    fixed 64 Hz tick, flat POD state
  authors brushes, feeds them in,        quake-style pmove (ours)
  reads SimSnapshot out (C ABI)          gunplay: spray tables + punch + falloff
  bakes light via sim_trace_ray          collision: convex brush traces (ours)
```

- **Sim owns all gameplay.** The client is a dumb terminal: it samples input,
  calls `sim_step()`, interpolates between the last two snapshots, renders.
  No gameplay logic in TS — that rule is what makes the future server build
  (the same C++ compiled native) authoritative for free.
- **Collision is convex brushes**, the GoldSrc/Quake model. A swept AABB is
  traced by expanding each brush plane by the hull's support along that normal
  (Minkowski sum), reducing the sweep to a ray-vs-convex-polytope clip. Sealed
  brushes with outward normals make plane-side tests unambiguous. Axial bevel
  planes (Quake's `CM_AddBrushBevels`) keep box-vs-slope corners tight.
  ~330 lines in `sim/src/world.cpp`, behind the same `world.h` seam.
- **No third-party dependencies in the sim.** box3d was removed in v3: it was
  only ever used for queries, the display-mesh bugs it papered over are gone
  with trimesh support, and the native build (SIMD) and wasm build (scalar)
  were silently computing collision differently — a real determinism hazard for
  future rollback netcode. The build now fetches nothing.
- **Units/axes:** GoldSrc units (1u = 1 inch), Y-up, right-handed.
- **Determinism:** `-ffp-contract=off` everywhere, xorshift RNG inside sim
  state, verified by a hash test. Cross-platform bit-equality of libm sin/cos
  is still open for netcode rollback — revisit at M-net.

## 3. Movement spec (implemented, tested in sim/tests)

| Constant | Value | Notes |
|---|---|---|
| tick | 64 Hz fixed | client interpolates between snapshots |
| gravity | 800 | |
| accel / airaccel | 5 / 10 | air wishspeed cap **30** → air-strafing works |
| friction / stopspeed | 4 / 75 | |
| max speed | 250 base, per-weapon (AK 221) | ducked ×0.333, walking ×0.52 |
| jump | √(2·800·45) ≈ 268.33 | 45u apex, asserted by test |
| bhop cap | 1.7 × maxspeed, excess ×0.65 | PM_PreventMegaBunnyJumping |
| stamina | 1315.789429, −1000/s | scales jump impulse and landing speed |
| hull | 32×32×72, ducked 32×32×36 | eye +28 / +12 above hull center |
| step height | 18u | step_slide_move up/down compare |
| ground slope | normal.y ≥ 0.7 | |

Feel checklist (manual, `?map=practice`): strafe-jumping gains speed, bhop
capped but chainable, duck-jump clears 36u crates, stairs don't launch you, no
jitter resting against surfaces, ramps carry you smoothly.

## 4. Gunplay spec (implemented, first pass)

- Deterministic 30-shot spray pattern (climb → left drift → right swing),
  scaled per weapon; pattern resets after `recovery_ticks` without firing.
- Inaccuracy: base spread × (1 + 2.5·speed/250, +5 airborne, ×0.7 ducked).
  The HUD crosshair gap mirrors these terms, so it tells the truth.
- View punch per shot with exponential decay. Punch is visual (client adds it
  to the camera); the pattern table controls actual bullet dirs.
- Damage: base × rangeMod^(dist/500) × hitgroup (head ×4, stomach ×1.25,
  legs ×0.75).
- Hitboxes: 4 AABBs per target (head/chest/stomach/limbs), ray-slab tested in
  the sim; the world ray bounds the search so walls block shots.
- Weapon table (AK, M4A1, AWP, MP5, Glock, USP, knife stub) in
  `sim/src/weapons.cpp`.
- Not yet: wallbang penetration, per-weapon movement-inaccuracy curves, real
  melee, AWP scope (needs zoom state in the sim — a client-only FOV change
  would desync accuracy from what you see), arm hitboxes (the `limbs` box
  covers legs only, so visible arms aren't hittable).

## 5. Art pipeline — everything is code

No binary assets. Nothing to license, nothing to download, everything diffs.

- **Maps are convex brushes** (`client/src/map/brush.ts`): `box`, `ramp`,
  `stairs`, `room` constructors emit plane sets. The *same* planes feed
  `sim_add_brush` for collision and a winding clipper for render geometry, so
  what you see and what you collide with cannot drift apart. Textures tile by
  Quake-style axial projection.
- **Light is baked** (`client/src/map/build.ts`) into vertex colours at load,
  shadow-tested through `sim_trace_ray` — so lighting agrees with collision by
  construction. Faces subdivide to ≤56u for bake resolution. Wrapped diffuse
  stands in for bounce. The world renders as unlit `MeshBasicMaterial`: free at
  runtime and correct for the era.
- **Textures** (`client/src/art/textures.ts`): seeded canvas generators —
  grain, stains, drips, rivets — at 128², nearest-filtered.
- **Characters** (`client/src/art/character.ts`): rigid box hierarchy (what PSX
  and GoldSrc actually did), proportioned to the sim hitboxes, animated with
  sines. Tinted by `sampleLight` so they sit inside the baked lighting.
- **Weapons** (`client/src/art/weapons.ts`): per-weapon box assemblies with
  distinct silhouettes, plus muzzle offsets for flashes and tracers.
- **Audio** (`client/src/audio.ts`): Web Audio synthesis, per-weapon voices and
  per-material impacts.

## 6. Repo layout

```
sim/                  C++20 core: pmove.cpp, weapons.cpp, world.cpp, sim.cpp
sim/include/cs/sim.h  public types + tuning constants + C ABI
sim/tests/            native ctest: movement invariants + determinism hash
client/src/           main.ts loop, sim.ts (snapshot mirror), renderer.ts,
                      input.ts, hud.ts, audio.ts, viewmodel.ts
client/src/map/       brush.ts, build.ts (geometry + light bake), maps/
client/src/art/       textures.ts, character.ts, weapons.ts
client/src/generated/ sim.mjs wasm artifact (gitignored, `npm run wasm`)
tools/mapcheck.ts     headless map validation against the real sim
assets/               unused; see assets/README.md
```

## 7. Milestones

Done in v3:

- **R3** — box3d removed, convex-brush collision, `sim_add_brush` +
  `sim_trace_ray` ABI, ramp/degenerate-brush/ray tests (13 total).
- **R4** — brush map pipeline with baked lighting; original maps `foundry`
  (arena) and `practice` (movement greybox); dust2 and all ref-asset loading
  deleted.
- **R5** — procedural textures, characters, weapons, viewmodel; per-weapon and
  per-material audio; dynamic crosshair; decals, tracers, muzzle flash.
- **R6** — shift-walk and scroll-jump; `mapcheck` tool; build no longer stages
  Valve-derived assets into `dist/`.

Next, in order:

- **M-net** — authoritative server: compile the sim native (already proven by
  the test binary), WebRTC DataChannels (libdatachannel server-side, browser
  API client-side), WebSocket signaling, client prediction + reconciliation,
  snapshot delta vs last-acked. Budget ≤30 kB/s down per client. Harness:
  150 ms + 5% loss must stay playable.
- **M-bots** — server-side bots: nav via "can I stand here" flood-fill sampling
  over the trace API (`tools/mapcheck.ts` already has the drop-probe
  primitive), waypoint pathing, humanized aim/error model.
- **M-modes** — FFA/DM scoring, spawn logic, round loop; defuse later.
- **M-content** — more maps; a TrenchBroom `.map` importer feeding
  `sim_add_brush` if hand-authoring in TS gets tiring; player health + damage
  in the sim (there is no player health field today); scope/zoom state.
- **M-polish** — footstep audio per material, reload/draw viewmodel anims,
  spatialized sound, perf pass (instancing, draw batching).

## 8. Rules that don't change

- No gameplay logic in TS. Tuning lives in `sim/include/cs/sim.h` and
  `sim/src/weapons.cpp`.
- Collision geometry is authored brushes, never a display mesh. A display mesh
  as collision is what caused every bug in the v2 dust2 handoff.
- GPL engines (Quake, xash3d) are *behavior* references only — no code copied.
  The brush trace and winding clipper are standard published geometry, written
  fresh here.
- New art is generated in code, or original/CC0 with provenance in
  `assets/README.md`.
- `vite.config.ts` `publicDir` must never point at `assets/`.
