# PLAN.md — From Aim Trainer to a Real CS 1.6-Style Browser Shooter

**Status:** Draft v1 (2026-07-17)
**Scope:** Turn `cs-web` (Three.js aim trainer) into a full Counter-Strike-1.6-derivative FPS that runs in the browser at native-like performance: authentic GoldSrc-style movement and gunplay, multiplayer on an authoritative server, and single player vs. bots. Original assets and names — derivative feel, not a rip.

---

## 1. Vision & Goals

**The game:** a fast, skill-based, round-oriented FPS with the CS 1.6 "vibe":

- Movement that rewards mastery: strafe-accel, bunnyhop (capped), duck-jumps, jump fatigue, counter-strafing.
- Gunplay with learnable spray patterns, first-shot accuracy, movement inaccuracy, one-taps, wallbangs.
- Low barrier to entry (click a URL, playing in <10 seconds), high skill ceiling.
- Multiplayer (5v5-ish, deathmatch first, defuse mode later) + offline/single-player vs. bots.

**Non-goals (explicitly out of scope):**

- Ripping Valve assets, maps, models, sounds, or shipping Valve code. We study mechanics as *facts* and reimplement.
- Photorealism. Low-poly + lightmaps is the aesthetic *and* the performance strategy.
- Ranked matchmaking, accounts, anti-cheat beyond server-side sanity checks (v1).
- Mobile/touch support (v1).

**Guiding principle:** the *simulation* (movement, shooting, rules) is the product. It lives in portable C++ shared by client and server. Everything else (renderer, UI, transport) is replaceable behind interfaces.

---

## 2. Research Summary (what we learned and why it shapes the plan)

### 2.1 The GoldSrc movement model is small, well understood, and reimplementable

The entire CS 1.6 movement feel comes from ~2k lines of player-movement code (`pm_shared.c`, visible in Valve's [halflife repo](https://github.com/ValveSoftware/halflife) — reference only, no open license; original Quake `pmove.c` is [GPL](https://github.com/id-Software/Quake/blob/master/QW/client/pmove.c)). Key verified facts:

- Ground move: accelerate toward wish direction, `sv_accelerate` (CS default 5), friction `sv_friction 4` with `sv_stopspeed`, hard per-weapon speed cap.
- **Air strafing exists because `PM_AirAccelerate` caps `wishspeed` at 30 u/s** — you can always add up to 30 u/s perpendicular-ish to current velocity, so turning while strafing gains speed ([Quakeworld air physics](https://mattias.niklewski.com/2013/01/qw_air_physics.html)).
- **Bhop cap:** `PM_PreventMegaBunnyJumping` scales horizontal velocity down when jumping above `1.7 × maxspeed` (`BUNNYJUMP_MAX_SPEED_FACTOR = 1.7`, values chosen by Valve after playtesting — [hlcoders thread](https://hlcoders.valvesoftware.narkive.com/4O1InsrV/pm-preventmegabunnyjumping)). This cap is *why* 1.6 bhop feels like rhythm, not runaway acceleration.
- **Jump fatigue (stamina):** on jump, `fuser2 = 1315.789429`, decaying by frame-time-in-ms each frame (~1.31 s to drain). While non-zero it scales horizontal speed in `PM_WalkMove` and jump velocity in `PM_Jump` by `(100 − fuser2 × 0.001 × 19) × 0.01` → a fresh jump costs **25%** ([jwchong stamina write-up](https://www.jwchong.com/posts/counter-strike-stamina/), [KZ guide](https://kzguide.gitlab.io/techniques/stamina/), [kz-rush bhop physics](https://kz-rush.ru/page/bhop-physics)). This is the single most "1.6 vs Quake" feel differentiator — must implement.
- Core cvars: `sv_gravity 800`, `sv_friction 4`, `sv_airaccelerate 10`, `sv_accelerate 5`, `sv_stopspeed 75` (CS defaults; HL defaults differ slightly — verify against 1.6 configs in M1).
- GoldSrc physics is frame-rate dependent (100 fps bhop quirks). **Decision:** we run a fixed sim tick; we deliberately keep the *feel*, not the fps exploits.

A modern reference reimplementation exists ([QMovement, UE5](https://github.com/MrKamkar/QMovement)) confirming this is a well-trodden path.

### 2.2 CS 1.6 gunplay = punch angle + per-weapon spread cones + shot-indexed recoil

- Recoil is view "punch angle"; observed kick ≈ **2× punchangle**. Direction changes are per-weapon RNG with probabilities conditioned on stance (ground/moving/ducked) ([AlliedModders threads](https://forums.alliedmods.net/archive/index.php/t-166648.html)).
- Spread is a per-weapon cone (`VECTOR_CONE_*` via `FireBullets3`); the accuracy variable updates **after** each shot and applies to the **next** shot; resets on reload/deploy/spawn.
- CS:GO instead uses **deterministic, learnable spray pattern tables** — that's what players mean by "learning the AK spray" ([recoil overview](https://counterstrike.fandom.com/wiki/Recoil), [spray guide](https://www.tobyscs.com/csgo-spray-control/)).
- **Design decision:** deterministic per-weapon pattern tables (CS:GO-style learnability = low barrier, high ceiling) + small bounded jitter + 1.6-style stance/movement inaccuracy multipliers + punch-angle view kick. Best of both; nothing copied verbatim.
- **Penetration (wallbangs):** per-weapon penetration power, per-material modifier; damage lost at surface entry and per unit traveled inside material; averaged entry/exit materials ([Valve wiki CS:S model](https://developer.valvesoftware.com/wiki/Bullet_Penetration_in_Counter-Strike:_Source), [CS wiki](https://counterstrike.fandom.com/wiki/Bullet_Penetration)). We implement this model against brush materials.

### 2.3 Netcode: the Quake/Source model is the blueprint; WebRTC DataChannels are today's UDP

- Architecture is settled science: **authoritative server, client-side prediction + reconciliation, snapshot delta compression, entity interpolation (~100 ms), server-side lag compensation for hitscan** ([Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking), [Gambetta series](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html), [Gaffer resources](https://github.com/gafferongames/GameNetworkingResources)).
- Browsers can't do raw UDP. Options ([overview](https://www.webgamedev.com/backend/webrtc), [MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels)):
  - **WebRTC DataChannel (unreliable/unordered)** — universal browser support today; server side is clunky *unless* you use **[libdatachannel](https://github.com/paullouisageneau/libdatachannel)** (C++17, server-friendly, and its sibling **[datachannel-wasm](https://github.com/paullouisageneau/datachannel-wasm)** exposes the *same C++ API compiled to WASM in the browser* — one transport API on both ends).
  - **WebTransport (QUIC datagrams)** — cleaner, no ICE/STUN, but still uneven engine/back-end support ([Godot proposal still open](https://github.com/godotengine/godot-proposals/issues/3899)). Design the transport as an interface; add a WebTransport backend later.
  - WebSocket (TCP) — fine for signaling, lobby, chat; unacceptable for game state (head-of-line blocking).
- Precedent check: **Krunker.io** proved browser CS-likes work commercially, but its JS server ran at **10 tick** with 6–8 player lobbies ([history](https://ioground.com/blog/the-history-behind-krunker-io)) — our native C++ server at 64–100 tick is the differentiator.

### 2.4 WASM + rendering stack: C++ where it counts, proven renderer where it doesn't

- WASM runs game logic at 60–90% of native; **rendering is bounded by WebGL/WebGPU, not by WASM vs JS** ([WASM engines guide](https://simplified.media/guides/wasm-game-engines)). WebGPU now ships in all major browsers (~82% global support in 2026), and Three.js has a WebGPU renderer with automatic WebGL2 fallback since r171 ([caniuse](https://caniuse.com/webgpu), [status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).
- Full-C++ renderer options: **sokol_gfx** has solid WebGL2 + WebGPU (via `emdawnwebgpu`) backends and treats WASM as first-class ([sokol WebGPU](https://floooh.github.io/2023/10/16/sokol-webgpu.html)); **bgfx**'s WebGPU/Emscripten story is currently messy ([author's post](https://bkaradzic.github.io/posts/webgpu/)) — avoid.
- **Existence proof:** the actual GoldSrc engine reimplementation Xash3D-FWGS runs CS 1.6 in-browser via Emscripten ([webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs), [cs1.6-browser](https://github.com/modesage/cs1.6-browser)). GPL + requires owned game assets, so not our base — but it's the benchmark for "1.6 in a browser is absolutely feasible" and a behavior-comparison tool.
- Off-the-shelf engines (Godot web export, Bevy/WASM) were considered and rejected: larger bundles, less control over the sim loop and netcode, and the user preference is low-level. Three.js is kept *only* as a rendering library, not an engine.

### 2.5 Bots: nav mesh + state machine, per Mike Booth's official CS bot

- The canonical design is Mike Booth's official CS bot: auto-generated **navigation mesh** (flood-fill walkable sampling → merged rectangular areas + connections), A* over areas, layered finite-state behavior, humanized aim error ([GDC 2004 talk](https://www.gdcvault.com/play/1013625/), [recording](https://archive.org/details/GDC2004Booth2)).
- Open-source CS bots ([YaPB / E-BOT](https://github.com/EfeDursun125/CS-EBOT)) exist as design references (GPL — ideas only, no code).
- Since bots run **server-side only** (native C++), they have zero client cost, and single-player = local server (native sim compiled to WASM runs the same code offline).

### 2.6 Maps & models: TrenchBroom brushes + glTF props — the 1.6 aesthetic is a pipeline choice

- **TrenchBroom** (free, actively maintained, supports custom game configs) edits Quake `.map` files — brush-based CSG geometry, the exact workflow that made 1.6 maps look and play like 1.6 maps ([manual](https://trenchbroom.github.io/manual/latest/), [.map format](https://book.leveldesignbook.com/appendix/resources/formats/map), [parsing walkthrough](https://dev.to/mcharytoniuk/loading-quake-engine-maps-in-three-js-part-1-parsing-55mp)). The format is simple to parse; brushes give us **render geometry and collision volumes from one source**.
- Models: **Blockbench** (low-poly, animation, glTF export) and/or Blender; CC0 sources ([poly.pizza](https://poly.pizza/explore/Weapons), Kenney, AmbientCG for textures) to bootstrap. glTF parsed in C++ via `cgltf`, rendered by the client.

---

## 3. Architecture

```
┌────────────────────────────  shared C++20 "sim" core  ───────────────────────────┐
│  player movement (pm) · brush collision/trace · weapons/spread/recoil · damage   │
│  rules/rounds/economy · entities · deterministic fixed-tick step(input[]) → state│
└──────────────┬──────────────────────────────────────────────┬────────────────────┘
               │ emscripten → .wasm                            │ clang → native
┌──────────────▼──────────────┐                 ┌──────────────▼──────────────┐
│ CLIENT (browser)            │  WebRTC DC      │ SERVER (linux, docker)      │
│ TS shell (Vite, existing)   │  unreliable+    │ authoritative sim @ 64–100  │
│ Three.js renderer (WebGPU/  │  unordered      │ tick · lag compensation ·   │
│  WebGL2 fallback)           │◄───────────────►│ snapshot delta encode ·     │
│ DOM HUD/menus (existing)    │  + reliable ch. │ bots (navmesh + FSM) ·      │
│ prediction + reconciliation │  + WS signaling │ libdatachannel              │
│ interpolation buffer        │                 │                             │
└─────────────────────────────┘                 └─────────────────────────────┘
        offline single-player: same WASM sim acts as a local server (bots included)
```

**Key decisions & rationale:**

1. **C++20 sim core, zero-dependency, compiled twice** (WASM for client prediction + offline play; native for the server). Written "C-style with benefits": POD structs + free functions, flat contiguous game state (rollback = `memcpy`, snapshot delta = byte diff), `-fno-exceptions -fno-rtti`, no iostream, no deep class hierarchies; `std::vector`/`span` for buffers and operator-overloaded vec math are the C++ payoff. Compiles as lean as C, reads almost as simply, and stays ABI-compatible with the C++ libs we depend on (libdatachannel). This is the GoldSrc "shared pm code" trick modernized, and it's non-negotiable for prediction correctness. Bit-identical float determinism across native/WASM is *not* required (server is authoritative; client reconciles), but same-build determinism is, for replays and tests.
2. **Keep the TS + Three.js shell as the renderer** (hybrid model), talking to the sim through a flat snapshot/interop buffer. Rationale: at 1.6 poly counts the renderer is nowhere near the bottleneck (Krunker scaled on Three.js; our sim/netcode in C++ fixes what actually limited Krunker). This preserves the existing codebase, HUD, menus, and iteration speed. The interop boundary is designed so a full sokol_gfx C++ renderer can replace Three.js later without touching the sim (kept as an explicit M8 option if profiling ever demands it).
3. **Transport = interface with a WebRTC DataChannel implementation first** (libdatachannel server-side, datachannel-wasm or browser API client-side; one unreliable+unordered channel for inputs/snapshots, one reliable for events/chat). WebTransport backend added when support justifies it. WebSocket only for signaling/lobby.
4. **Fixed tick simulation** (start at 64 Hz, evaluate 100 Hz): client samples input per tick, predicts locally, server sends delta-compressed snapshots (20–30/s) against last-acked; interpolation delay ~100 ms for remote entities; lag-compensated hitscan rewind on server.
5. **Single-threaded WASM to start** (no SharedArrayBuffer/COOP/COEP headaches); the sim at this scale fits comfortably in one thread. Revisit only with profiler evidence.
6. **DOM stays the UI layer** (HUD, menus, buy menu, scoreboard) — it already works in this repo, it's fast to build, and it's how shipped Emscripten games do UI.

---

## 4. Feature Specs

### 4.1 Movement (the crown jewels) — target feel: CS 1.6

Units: GoldSrc units (1u = 1 inch). Player hull 32×32×72 standing / 32×32×36 ducked, eye ~28u above origin (verify against pm_shared in M1).

| Constant | Value | Notes |
|---|---|---|
| gravity | 800 u/s² | |
| ground accelerate | 5 | CS 1.6 default |
| air accelerate | 10 | with **wishspeed cap 30** → air strafing |
| friction | 4 | edge friction ×2 near ledges (verify) |
| stopspeed | 75–100 | verify CS default |
| base run speed | 250 (knife), per-weapon table | scout 260, AK ~221, M4 ~230, AWP ~210/150 scoped — verify all in M3 |
| jump impulse | √(2·800·45) ≈ 268 u/s | 45u jump height, verify |
| bhop cap | 1.7 × maxspeed, velocity scaled down on jump | `PM_PreventMegaBunnyJumping` behavior |
| jump fatigue | fuser2=1315.789429, decay dt·1000/frame, factor (100 − fuser2·0.019)/100 | 25% penalty on fresh jump |
| duck | speed ×0.333, duck-in-air hull shrink (enables duck-jumps onto boxes) | |
| water/ladders | GoldSrc ladder climb + wet physics | M2+, low priority |

**Acceptance tests ("1.6 feel checklist"), automated where possible:**
- Strafe-turning in air gains speed; W-only air = no gain.
- Bhop chain: second hop visibly lower (fatigue), speed caps around 1.7× and settles into rhythm.
- Counter-strafe stops in ≤ ~2 ticks from full run (tap opposite key).
- Duck-jump reaches 55–60u ledges; run-jump crosses standard gaps.
- Manual A/B feel comparison against CS 1.6 in [browser Xash3D](https://github.com/yohimik/webxash3d-fwgs) with same inputs.

### 4.2 Gunplay

- **Hitscan** raycasts through the brush world + player hitboxes (head/chest/stomach/limb multipliers; headshot ×4).
- **Spread model:** `direction = pattern[shotIndex] × patternScale + jitter + inaccuracy(stance, speed, airborne) × randomCone`. First-shot accuracy for rifles standing still; heavy air penalty; crouch bonus; recovery timer decays shotIndex when not firing.
- **Recoil:** punch-angle view kick per shot (decays over time), pattern tables authored per weapon (7-ish rounds up, then horizontal drift — AK-style; MP5 tight; deagle huge first-shot punch). Author in a debug "spray lab" view (fire at wall, overlay pattern) — reuse the aim-trainer roots.
- **Damage:** base dmg × range falloff (`rangeMod^(dist/500)` 1.6-style) × hitgroup × armor rule (kevlar absorbs %, helmet vs headshot).
- **Penetration:** per-weapon power, per-material (brush texture → material) modifier, entry loss + per-unit loss, max 1–2 surfaces.
- **Weapon roster (MVP 6):** knife, 2 pistols (USP/Glock analogs), AK analog, M4 analog, AWP analog, MP5 analog. Buy price/kill reward table comes with defuse mode.
- **Movement-speed per weapon** (table in `constants`), weapon switch/draw times, reload times, fire rates — all data-driven from one weapons table (C++ struct array, mirrored to a JSON for tooling).

### 4.3 Maps — two world sources, one trace API

The sim traces a player AABB through an abstract collision world; two backends feed it:

- **(a) Imported glTF worlds (dev path, M2):** load GLB world geometry (starting with `assets/maps/de_dust2_ref.glb` — audited: 9.3k tris, textured, ~meter scale), normalize units (×39.37 → GoldSrc units), build a static triangle BVH, and run **swept-AABB vs triangle** traces feeding the same clip-velocity solver as the brush path. Gets us a real, known-good CS layout for movement/gunplay/netcode development *months* before any original map exists. Material tags come from a per-material mapping table (dust2's materials are unnamed `material_N` — map them to concrete/wood/metal/sand once, by hand).
- **(b) TrenchBroom brush maps (original/shippable path, M6):** TrenchBroom with a custom game config (spawns, buyzones, bombsites, ladders, lights) → `mapc` compiler (C++): Valve-220 `.map` → CSG brush polygons → render mesh with per-material batching + baked **lightmaps** (direct+ambient raycaster first), collision brush planes with material tags, entity list. Quake-style hull tracing via plane offsetting (Minkowski expansion) — the classic 1.6 feel path (surf ramps come free). Output: one binary pack file.
- **Nav mesh** generation is collision-source-agnostic (flood-fill "can I stand here" sampling over the trace API, à la the official CS bot) — so bots work on the imported dust2 in M5, before the brush pipeline exists.
- **Maps plan:** `aim_lab` (code-built test room, M1) → **dust2 ref GLB as the dev map (M2 through M6)** → original defuse layout via TrenchBroom (M6, replaces dust2 for any public release). Mid/long sightline + chokepoint design language from 1.6.

### 4.4 Multiplayer

- Authoritative server, 64 tick baseline (test 100), snapshots 20–30 Hz delta-compressed against last-acked (Quake 3 model), inputs sent per tick with redundancy (last N cmds per packet — loss tolerance without reliability).
- Client: prediction + reconciliation (replay unacked inputs on correction), remote entity interpolation (~100 ms buffer), lag-compensated hitscan on server (rewind hitboxes by client's interpolated view time).
- Bandwidth budget: ≤ 30 kB/s down per client at 10 players (delta + quantized fields: positions 13-bit-ish per axis relative, angles 8–12 bit).
- Rooms/lobbies: signaling server (small; can be the game server binary serving WebSocket) with room codes; server browser + master server later (M7).
- Server-side sanity checks only for v1 anti-cheat: speed/teleport validation, fire-rate clamps, impossible-angle rejection.

### 4.5 Bots (single-player and backfill)

- Nav mesh generated by flood-fill sampling over the collision-trace API (→ rectangular areas, à la CS bot) — source-agnostic, so it works on the imported dust2 trimesh in M5 and on brush maps later. A* pathfinding, string-pull smoothing, jump/drop links.
- Behavior FSM per Booth's design: roam/hunt/attack/retreat (+ plant/defuse for defuse mode); vision cone + reaction delay; humanized aim (error decays toward target, difficulty = reaction ms, aim speed, error).
- Difficulty presets; bots fill empty slots in multiplayer; offline = same code in the WASM local server.

### 4.6 Game modes

1. **M4: FFA deathmatch** (respawn, all-buy) — fastest fun, tests everything.
2. **M6: Defuse** (rounds, economy, buy menu, bomb plant/defuse, win conditions) — the actual CS loop. Economy: start money, kill/objective rewards, loss bonus — tuned tables, original values.

### 4.7 Assets & audio

- **In-repo reference assets (audited — see `assets/README.md`):** `de_dust2_ref.glb` (9.3k tris, 34 baked textures, meter scale), `cs16_characters_ref.glb` (8 characters ≈1.2k tris each, textured but **unrigged**), `ak47_ref.glb` (1.8k tris, **untextured** flat-color materials split into 8 parts — barrel/magazine/handle/etc., ideal for viewmodel anims; arbitrary scale + off-origin pivot → recenter/rescale at import). All Sketchfab-sourced Valve derivatives: dev placeholders, replaced before public release. Canonical unit is the GoldSrc unit; meter-scale assets scale ×39.37 at import.
- **Art direction rule: PSX/GoldSrc-era only** — low-poly *textured* models (not modern flat-shaded stylized low-poly). Source index: [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection); any pack pulled from elsewhere must match the PSX look.
- **Weapons (chosen, CC0):** [Modern Weapons PS1 Style](https://ace-spectre.itch.io/modern-weapons-ps1-style) and [PS1 Heavy and Light Weapons Pack](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack) (ace-spectre, CC0; textures from texturer.com under its own terms — check before shipping; one reported missing pistol texture) + [Low Poly Glock](https://mextie.itch.io/low-poly-glock) (mextie, CC0, ships a GLB directly). Pull these in M3, normalize scale/pivot at import, add viewmodel keyframe anims (draw/idle/fire/reload) in Blender/Blockbench. The untextured `ak47_ref.glb` stays as a fallback with 1.6-palette flat colors.
- **Player model (chosen):** `assets/models/hazmat/` — **rigged** (27 skin clusters, 76 bones, Blender-standard names) but unanimated; author idle/run/crouch/jump/die in Blender and export glTF (M3 third-person, M5 bots wear it too). CT/T = palette-swapped texture variants. `cs16_characters_ref.glb` (unrigged, Valve-derived) is visual reference only.
- **Textures:** low-res (128–256px) CC0 (AmbientCG/Kenney) with a consistent palette; lightmaps do the atmospheric heavy lifting.
- **Audio:** keep Web Audio synthesis short-term; M3 adds sampled sounds (CC0/freesound): per-material footsteps, distance-attenuated gunfire, reload foley. Sound-as-information is core CS design — footstep audibility radius matches 1.6-ish (~1100u, verify).

---

## 5. Repo & Build Plan

```
cs-web/
├── sim/            # C++20 shared core (no deps): pm, trace, weapons, rules, snapshot
│   └── tests/      # doctest unit tests + determinism/replay tests
├── client/         # current Vite+TS app, refactored: renderer, HUD, input, interop
├── server/         # native C++: tick loop, libdatachannel transport, bots, rooms
├── tools/mapc/     # .map compiler → pack (mesh, lightmap, collision, navmesh)
├── assets/         # maps/ + models/ (dev ref GLBs, gitignored + audited in assets/README.md;
│                   #   .map sources, original models, textures, sounds — original/CC0 only)
└── CMakeLists.txt  # native + emscripten toolchains; bun/vite unchanged for shell
```

- Build: CMake presets (`native`, `wasm` via Emscripten). CI: build both + run sim tests headless.
- Interop: C ABI exports (`sim_create/step/snapshot`), flat typed-array views into WASM heap for the renderer (no per-frame JSON/marshalling).
- Dev loop stays `bun run dev`; WASM artifact hot-swapped by Vite.

---

## 6. Milestones (each with concrete success criteria)

| # | Milestone | Success criteria (verify) |
|---|---|---|
| **M0** | **Scaffold + spike** (≈1 wk): CMake + Emscripten build of a hello-sim; interop buffer renders a cube moved by C++ | `bun run dev` shows WASM-driven motion; sim unit test runs natively |
| **M1** | **Movement core** (2–3 wk): pm code (walk/air/friction/jump/duck/fatigue/bhop cap), AABB-vs-brush trace, flat test room; existing renderer drives it | 1.6 feel checklist §4.1 passes; determinism test (same inputs → same state hash) green |
| **M2** | **World importer** (2 wk): glTF world loader + unit normalization (×39.37), triangle BVH + swept-AABB trace, material mapping table, spawn markers; **dust2 ref playable** | dust2 loads <2 s; full traversal (crates, ramps, doorways) with 1.6 movement intact; 60 fps on integrated GPU |
| **M3** | **Gunplay** (2–3 wk): weapons table, spread/recoil/patterns, damage/hitgroups, penetration, viewmodels, sampled audio, spray-lab debug view | Spray patterns reproducible in spray lab; wallbang dmg matches spec table; blind playtest "feels like 1.6 tapping/bursting" |
| **M4** | **Netcode + server** (3–4 wk): native server, libdatachannel transport, prediction/reconciliation, interpolation, lag comp, FFA DM | 8 players + 150 ms simulated latency + 5% loss: hit reg feels fair, no visible warping; server tick ≤ 2 ms p95 |
| **M5** | **Bots** (2 wk): navmesh gen from the collision world (works on imported dust2), A*, combat FSM, difficulties; offline mode (WASM local server) | Bots navigate dust2 ref end-to-end; bot wins vs. new player at max difficulty; offline page works with zero network |
| **M6** | **Defuse mode + original map pipeline** (3–4 wk): rounds/economy/buy menu, bombsites, win conditions; TrenchBroom config + `mapc` (brush mesh, plane collision, lightmap v1) + first original defuse map | Full 5v5 bot match completes on dust2 ref; economy balances across 10-round sims; original map loads and plays through the same trace API |
| **M7** | **Ship v1** (2 wk): lobby/rooms UX, deploy (Docker server on Hetzner/Fly + static client CDN), perf pass, bundle budget | Cold load < 20 MB / < 10 s on 50 Mbps; 60 fps min-spec; public playtest |
| **M8+** | Options: WebGPU-first renderer or sokol C++ renderer, WebTransport backend, more maps/weapons, spectator, demos/replays (free from determinism), server browser | — |

Rough total: ~4–5 months of focused part-time work. Milestones are sequenced so the game is *playable and fun* at the end of every one (M1 = movement playground, M3 = aim trainer++, M4 = real multiplayer DM).

---

## 7. Testing & Verification Strategy

- **Sim unit tests (native, fast):** acceleration curves, friction, jump heights, fatigue factors, spread determinism, penetration damage tables.
- **Determinism/replay tests:** recorded input streams → state hash; run in CI on native and WASM (wasmtime) builds.
- **Netcode harness:** loopback server with configurable latency/jitter/loss; scripted clients assert reconciliation error bounds.
- **Feel validation:** side-by-side manual comparison vs. CS 1.6 in browser Xash3D; capture and compare strafe-speed graphs.
- **Perf budgets (regression-checked):** client frame ≤ 8 ms mid-spec; server tick ≤ 2 ms @ 10 players + 10 bots; snapshot ≤ 1.2 kB avg.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Movement doesn't "feel right" despite correct constants | A/B against Xash3D CS with identical input scripts; keep frame-quirk toggles (e.g., jump-before-friction ordering) as tunables |
| WebRTC server ops pain (ICE/STUN, certs) | libdatachannel handles ICE; single STUN (Google) suffices for client→server; document TURN fallback; keep WebSocket-TCP emergency transport |
| Scope creep (engine-itis) | Milestone gates require *playable fun*; renderer stays Three.js until profiling proves otherwise |
| Cheating in open browsers | Accept for v1; server authority + sanity checks; no client trust for hits |
| Asset quality/time sink | CC0 bootstrap, style guide (low-poly + lightmaps hides art weakness), art replaces gradually |
| Legal | No Valve assets/names/code shipped; mechanics-as-facts reimplemented; GPL projects are references only; original map layouts "inspired by" not traced. The `assets/*_ref.glb` Valve derivatives are local dev placeholders (gitignored), swapped out by M7 public release |

## 9. Open Questions (decide before/at M0)

1. Tick rate 64 vs 100 (bandwidth vs authenticity) — benchmark at M4.
2. Game name / weapon analog names (needed by M3 UI).
3. Hosting region strategy for playtests (single EU/US region first?).
4. Lightmap quality bar for v1 (direct-only vs 1-bounce).

## 10. Immediate Next Steps

1. M0 scaffold: `sim/` + CMake + Emscripten toolchain, C-ABI interop, wire into the existing Vite app behind a flag.
2. Port current player/weapon constants into `sim/` as the seed of the pm implementation; the existing TS game remains the reference harness until M1 lands.
3. Load `assets/maps/de_dust2_ref.glb` render-only in the existing Three.js scene to lock down orientation and the ×39.37 unit-normalization constant before M2 collision work.

## 11. Reference Library

**Movement/physics:** [pm_shared.c (Valve halflife repo)](https://github.com/ValveSoftware/halflife) · [Quake pmove.c](https://github.com/id-Software/Quake/blob/master/QW/client/pmove.c) · [QW air physics math](https://mattias.niklewski.com/2013/01/qw_air_physics.html) · [PM_PreventMegaBunnyJumping thread](https://hlcoders.valvesoftware.narkive.com/4O1InsrV/pm-preventmegabunnyjumping) · [CS stamina (jwchong)](https://www.jwchong.com/posts/counter-strike-stamina/) · [KZ stamina](https://kzguide.gitlab.io/techniques/stamina/) · [bhop physics (kz-rush)](https://kz-rush.ru/page/bhop-physics) · [QMovement UE5 reimpl](https://github.com/MrKamkar/QMovement)
**Gunplay:** [Recoil (CS wiki)](https://counterstrike.fandom.com/wiki/Recoil) · [Spray control guide](https://www.tobyscs.com/csgo-spray-control/) · [Accuracy internals (AlliedModders)](https://forums.alliedmods.net/archive/index.php/t-166648.html) · [Bullet penetration (Valve wiki)](https://developer.valvesoftware.com/wiki/Bullet_Penetration_in_Counter-Strike:_Source) · [Bullet penetration (CS wiki)](https://counterstrike.fandom.com/wiki/Bullet_Penetration)
**Netcode:** [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) · [Gambetta: prediction/reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html) · [Gambetta: lag compensation](https://www.gabrielgambetta.com/lag-compensation.html) · [Gaffer networking resources](https://github.com/gafferongames/GameNetworkingResources) · [WebRTC DC for games (MDN)](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels) · [libdatachannel](https://github.com/paullouisageneau/libdatachannel) · [datachannel-wasm](https://github.com/paullouisageneau/datachannel-wasm) · [WebRTC vs WebSockets](https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games)
**Platform/rendering:** [caniuse WebGPU](https://caniuse.com/webgpu) · [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) · [sokol WebGPU backend](https://floooh.github.io/2023/10/16/sokol-webgpu.html) · [bgfx WebGPU status](https://bkaradzic.github.io/posts/webgpu/) · [WASM game engines guide](https://simplified.media/guides/wasm-game-engines)
**Existence proofs:** [webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs) · [cs1.6-browser](https://github.com/modesage/cs1.6-browser) · [Krunker history](https://ioground.com/blog/the-history-behind-krunker-io)
**Maps/assets:** [TrenchBroom manual](https://trenchbroom.github.io/manual/latest/) · [.map format](https://book.leveldesignbook.com/appendix/resources/formats/map) · [Quake maps in Three.js](https://dev.to/mcharytoniuk/loading-quake-engine-maps-in-three-js-part-1-parsing-55mp) · [Blockbench](https://www.blockbench.net/wiki/guides/model-rendering/) · [Retro3DGraphicsCollection (PSX asset index)](https://github.com/Miziziziz/Retro3DGraphicsCollection) · [ace-spectre PS1 weapons](https://ace-spectre.itch.io/modern-weapons-ps1-style) · [PS1 heavy/light weapons](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack) · [Low Poly Glock](https://mextie.itch.io/low-poly-glock)
**Bots:** [Booth GDC 2004 (vault)](https://www.gdcvault.com/play/1013625/) · [Booth GDC 2004 (recording)](https://archive.org/details/GDC2004Booth2) · [CS-EBOT (reference only)](https://github.com/EfeDursun125/CS-EBOT)
