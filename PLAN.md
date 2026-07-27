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
| stamina | 1315.789429, −1400/s | scales jump impulse and landing speed |
| jump buffer | 8 ticks (125 ms) | early tap still hops on landing |
| hull | 32×32×72, ducked 32×32×36 | eye +28 / +12 above hull center |
| step height | 18u | step_slide_move up/down compare |
| ground slope | normal.y ≥ 0.7 | |
| scoped speed | ×0.52 | on top of the per-weapon cap |
| stride | 82u of ground covered | footfall interval, distance not time |

**Footsteps are a movement rule, not an audio feature.** The sim emits an
`EventStep` every `kStrideDistance` of ground covered, carrying the surface
material under the feet and the position to play it at. Holding +speed makes no
sound at all — that trade (mobility for not announcing yourself) is only real if
the sim is what decides you were quiet. Measuring by distance rather than by a
timer means a ducked player steps as rarely as they move, for free. Every
touchdown is audible regardless of +speed, so a silent bhop is not a thing;
landings above `kLandingSpeed` (set clear of the jump impulse, so a hop is not a
fall) report as heavier ones.

**Two deliberate deviations from 1.6, both to make bhop learnable:**

1. **Jump buffering.** A jump pressed up to `kJumpBufferTicks` before touching
   ground fires on the landing tick. The buffer is armed on the *press edge*
   only, so holding space gives exactly one hop — the tap-per-hop rhythm (and
   the scroll-wheel bind) survives, it just forgives being early. Both halves
   are asserted by tests.
2. **Faster stamina drain** (1400/s vs GoldSrc's 1000/s). A hop lasts ~0.53 s,
   so most of the fatigue has bled off by landing and a chained hop keeps ~89%
   of its speed instead of ~85%. Bhop still decays without air-strafing; it just
   forgives a sloppier one.

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
- Hitboxes: 4 AABBs per player (head/chest/stomach/limbs), ray-slab tested in
  the sim; the world ray bounds the search so walls block shots. Boxes squash
  to half height while ducked.
- Weapon table (AK, M4A1, AWP, MP5, Glock, USP, knife stub) in
  `sim/src/weapons.cpp`.
- **Optics live in the sim.** `ButtonZoom` cycles a weapon's `zoom_fov` levels
  (AWP: 40° → 10° → hip); the snapshot carries the resulting `fov` and the
  client sets the camera and scales mouse gain from it. Scoping costs
  `kZoomSpeedFactor` of your move speed and un-scoping costs
  `kUnscopedSpreadScale`× your accuracy, so the FOV you see and the cone you
  shoot into can never disagree — the reason this was never a client-only
  change. Reloading drops the scope.
- Not yet: wallbang penetration, per-weapon movement-inaccuracy curves, real
  melee, arm hitboxes (the `limbs` box covers legs only, so visible arms aren't
  hittable), armour.

## 4a. Players, bots and modes (implemented)

The sim holds a flat roster of `kMaxPlayers` entities. Index 0 is the one the
client drives; the rest are bots. **There is no second code path** — a bot
produces an `InputCommand` in `bots.cpp` and it goes through the same
`pmove_run` and `weapons_run` the local player's does. If a bot can do something
you can't, that is a bug in `bots.cpp`, not a different rulebook. It is also
what makes the M-net server a compile target rather than a rewrite.

- **Modes** (`sim_start_match`): `range` (bots roam, never shoot — the practice
  greybox), `deathmatch` (FFA), `team` (T vs CT, no friendly fire). No round
  loop and no economy: you die, you respawn 2 s later. Defuse is still later.
- **Enemies are opt-in.** Hostile modes start with zero bots; the menu's slider
  restarts the match in place (the world and its light bake are untouched, so
  it costs a roster rebuild and nothing else) and the choice persists. Loading
  a URL should not drop you into a firefight you didn't ask for. Range bots are
  exempt — they never shoot, so they're scenery.
- **Your loadout survives death.** `PlayerEntity::loadout` records the last
  deliberate weapon pick and `respawn_player` hands it back, including across a
  match restart. Re-selecting the AWP every life was the fastest way to make
  the scope feel like a chore.
- **Spawns** are authored per map and team-tagged. The first spawn is where the
  level wants you to enter, so the opening placement is authored; every respawn
  after that picks the point furthest from a living enemy.
- **Bot AI** is reactive, not a nav mesh: goals are drawn from the map's spawn
  points, steering is direct, and a ledge probe plus bump-and-slide covers the
  rest. Skill (0–2) scales aim slew rate, aim error, reaction delay and burst
  discipline. Targets are re-scanned every 8 ticks, staggered by index.
- **Events**: the snapshot carries up to `kMaxEvents` per tick (shots, deaths)
  rather than one `last_shot`, because with ten guns firing the client needs all
  of them for tracers, impacts, audio and the killfeed. The client reads the
  snapshot after every step, so a per-tick array beats a ring buffer.
- **Player separation**: hulls that end a tick overlapping are pushed apart
  along the shallower horizontal axis, rejected if the push would drive them
  into the world. Full hull-vs-hull sweeps inside pmove would be the "correct"
  fix and would also reintroduce every wedging failure v3 spent its time
  eliminating, with ten hulls shoving each other every tick.
- Known gaps: bots don't duck, don't bhop, and don't buy; no scoreboard beyond
  the HUD line; teams never rebalance.

## 5. Art pipeline — everything is code

No binary assets. Nothing to license, nothing to download, everything diffs.

- **Maps are convex brushes** (`client/src/map/brush.ts`): `box`, `ramp`,
  `stairs`, `room` constructors emit plane sets. The *same* planes feed
  `sim_add_brush` for collision and a winding clipper for render geometry, so
  what you see and what you collide with cannot drift apart. Textures tile by
  Quake-style axial projection. A `MapDef` also declares its mode, bot count
  and spawn points; `npm run mapcheck` drop-probes every spawn, so one buried
  in a brush or hanging over a pit fails the build rather than the match.
- **Light is baked** (`client/src/map/build.ts`) into vertex colours at load,
  shadow-tested through `sim_trace_ray` — so lighting agrees with collision by
  construction. Faces subdivide to ≤56u for bake resolution. Wrapped diffuse
  stands in for bounce. The world renders as unlit `MeshBasicMaterial`: free at
  runtime and correct for the era.
- **Textures** (`client/src/art/textures.ts`): seeded canvas generators —
  grain, stains, drips, rivets — at 128², nearest-filtered.
- **Characters** (`client/src/art/character.ts`): rigid box hierarchy (what PSX
  and GoldSrc actually did), proportioned to the sim hitboxes, animated with
  sines. Tinted by `sampleLight` so they sit inside the baked lighting — but
  the tint is remapped onto a readable band rather than applied raw, because a
  body in shadow that reads as a black cutout defeats the point of the art.
  Skins are cached per team, so a roster rebuild is cheap.
- **Weapons** (`client/src/art/weapons.ts`): per-weapon box assemblies with
  distinct silhouettes, plus muzzle offsets for flashes and tracers.
- **Audio** (`client/src/audio.ts`): Web Audio synthesis — per-weapon voices,
  per-material impacts and footsteps, no samples. Anything happening at a place
  in the world goes through an HRTF `PannerNode`; only the gun in your own hands
  and your own footfalls play flat, because a panner at the listener's position
  has no direction to give. Direction is not decoration in a shooter: footsteps
  behind you are the game telling you to turn around, and a mono mixdown throws
  that away. One shared noise buffer feeds every burst.

## 6. Repo layout

```
sim/                  C++20 core: pmove.cpp, weapons.cpp, world.cpp, bots.cpp,
                      sim.cpp (orchestration, match/spawn rules, C ABI)
sim/include/cs/sim.h  public types + tuning constants + C ABI
sim/tests/            native ctest: movement invariants, gunplay, match rules,
                      determinism hash (18 tests)
client/src/           main.ts loop, sim.ts (snapshot mirror), renderer.ts,
                      input.ts, hud.ts, audio.ts, viewmodel.ts, menu.ts
client/src/map/       brush.ts, build.ts (geometry + light bake), maps/
client/src/map/maps/  foundry (team), depot (team), silo (FFA), practice (range)
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
- **R7** (api v2) — multi-player sim: roster of entities, player health and
  damage, teams, kills/deaths, respawn, per-tick event list. Bots that play
  through the same pmove/weapons path. FFA/team/range modes with authored,
  team-tagged spawns. AWP scope as sim state. Bhop easing (jump buffer +
  stamina). Two new maps (`depot`, `silo`). HUD health/killfeed/scoreboard,
  in-game map switcher.

Next, in order:

- **M-net** — authoritative server: compile the sim native (already proven by
  the test binary), WebRTC DataChannels (libdatachannel server-side, browser
  API client-side), WebSocket signaling, client prediction + reconciliation,
  snapshot delta vs last-acked. Budget ≤30 kB/s down per client. Harness:
  150 ms + 5% loss must stay playable. The roster/event snapshot from R7 is
  already the shape this wants to delta-encode.
- **M-bots+** — the nav the reactive AI is standing in for: "can I stand here"
  flood-fill sampling over the trace API (`tools/mapcheck.ts` already has the
  drop-probe primitive), waypoint pathing, bots that duck and take cover.
- **M-modes+** — round loop, buy menu, defuse.
- **M-content** — more maps; a TrenchBroom `.map` importer feeding
  `sim_add_brush` if hand-authoring in TS gets tiring; armour and wallbangs.
- **M-polish** — reload/draw viewmodel anims, a TAB scoreboard, occlusion on
  spatialized sound (a shot through two walls is currently only quieter, not
  muffled), perf pass (instancing, draw batching).

## 8. Rules that don't change

- No gameplay logic in TS. Tuning lives in `sim/include/cs/sim.h` and
  `sim/src/weapons.cpp`.
- Bots run the same `pmove_run`/`weapons_run` as the player. No bot-only
  movement, no bot-only accuracy fudge — only the InputCommand differs.
- Collision geometry is authored brushes, never a display mesh. A display mesh
  as collision is what caused every bug in the v2 dust2 handoff.
- GPL engines (Quake, xash3d) are *behavior* references only — no code copied.
  The brush trace and winding clipper are standard published geometry, written
  fresh here.
- New art is generated in code, or original/CC0 with provenance in
  `assets/README.md`.
- `vite.config.ts` `publicDir` must never point at `assets/`.
