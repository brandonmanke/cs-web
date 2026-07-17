# PLAN.md — From Aim Trainer to a Real CS 1.6-Style Browser Shooter

**Status:** Draft v6 — M0–M4 complete and security-hardened; playable local M5 slice in progress (2026-07-17)
**Scope:** Turn `cs-web` (originally a Three.js aim trainer) into a full Counter-Strike-1.6-derivative FPS that runs in the browser at native-like performance: authentic GoldSrc-style movement and gunplay, multiplayer on an authoritative server, and single player vs. bots. Original assets and names — derivative feel, not a rip.

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

### 2.4 WASM + rendering stack: one C++ browser executable

- WASM runs game logic at 60–90% of native; **rendering is bounded by WebGL/WebGPU, not by WASM vs JS** ([WASM engines guide](https://simplified.media/guides/wasm-game-engines)). WebGPU now ships broadly, but WebGL2 remains the simplest universal baseline ([caniuse](https://caniuse.com/webgpu), [status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)).
- **Decision: raw WebGL2 through Emscripten's GLES3 surface.** The low-poly/lightmapped target does not need an engine renderer. A small C++ renderer keeps the frame loop, input, camera, visibility, viewmodels, debug drawing, and HUD in one executable with no per-frame JS/WASM marshalling. `sokol_gfx` remains a possible later abstraction if a WebGPU backend becomes valuable ([sokol WebGPU](https://floooh.github.io/2023/10/16/sokol-webgpu.html)).
- **Existence proof:** the actual GoldSrc engine reimplementation Xash3D-FWGS runs CS 1.6 in-browser via Emscripten ([webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs), [cs1.6-browser](https://github.com/modesage/cs1.6-browser)). GPL + requires owned game assets, so not our base — but it's the benchmark for "1.6 in a browser is absolutely feasible" and a behavior-comparison tool.
- Off-the-shelf engines and renderer frameworks (Godot, Bevy, Three.js) were considered and rejected: larger bundles, split-language ownership, and less control over the sim/render/netcode loop than this small GoldSrc-scale game needs.

### 2.5 Bots: nav mesh + state machine, per Mike Booth's official CS bot

- The canonical design is Mike Booth's official CS bot: auto-generated **navigation mesh** (flood-fill walkable sampling → merged rectangular areas + connections), A* over areas, layered finite-state behavior, humanized aim error ([GDC 2004 talk](https://www.gdcvault.com/play/1013625/), [recording](https://archive.org/details/GDC2004Booth2)).
- Open-source CS bots ([YaPB / E-BOT](https://github.com/EfeDursun125/CS-EBOT)) exist as design references (GPL — ideas only, no code).
- Since bots run **server-side only** (native C++), they have zero client cost, and single-player = local server (native sim compiled to WASM runs the same code offline).

### 2.6 Maps & models: TrenchBroom brushes + glTF props — the 1.6 aesthetic is a pipeline choice

- **TrenchBroom** (free, actively maintained, supports custom game configs) edits Quake `.map` files — brush-based CSG geometry, the exact workflow that made 1.6 maps look and play like 1.6 maps ([manual](https://trenchbroom.github.io/manual/latest/), [.map format](https://book.leveldesignbook.com/appendix/resources/formats/map), [parsing walkthrough](https://dev.to/mcharytoniuk/loading-quake-engine-maps-in-three-js-part-1-parsing-55mp)). The format is simple to parse; brushes give us **render geometry and collision volumes from one source**.
- Models: **Blockbench** (low-poly, animation, glTF export) and/or Blender; CC0 sources ([poly.pizza](https://poly.pizza/explore/Weapons), Kenney, AmbientCG for textures) to bootstrap. Optional glTF import belongs to a C++ client/tooling layer (for example `cgltf`), which converts assets into the same compact runtime structures emitted by `mapc`; the sim itself stays independent of asset formats.

---

## 3. Architecture

```
┌────────────────────────────  shared C++20 "sim" core  ───────────────────────────┐
│  player movement (pm) · brush collision/trace · weapons/spread/recoil · damage   │
│  rules/rounds/economy · entities · deterministic fixed-tick step(input[]) → state│
└──────────────┬──────────────────────────────────────────────┬────────────────────┘
               │ linked into Emscripten client                  │ clang → native
┌──────────────▼──────────────┐                 ┌──────────────▼──────────────┐
│ CLIENT (browser)            │  WebRTC DC      │ SERVER (linux, docker)      │
│ C++20 → WASM                │  unreliable+    │ authoritative sim @ 64–100  │
│ raw WebGL2 renderer         │  unordered      │ tick · lag compensation ·   │
│ input · audio · HUD/menus   │◄───────────────►│ snapshot delta encode ·     │
│ prediction + reconciliation │  + reliable ch. │ bots (navmesh + FSM) ·      │
│ interpolation buffer        │  + WS signaling │ libdatachannel              │
└─────────────────────────────┘                 └─────────────────────────────┘
        offline single-player: same WASM sim acts as a local server (bots included)
```

**Key decisions & rationale:**

1. **C++20 sim core, zero external runtime dependencies, compiled twice** (WASM for client prediction + offline play; native for the server). Written "C-style with benefits": POD structs + free functions, flat contiguous game state (rollback = `memcpy`, snapshot delta = byte diff), `-fno-exceptions -fno-rtti`, no iostream, no deep class hierarchies; small standard-library containers are allowed during world load, while the per-tick path stays allocation-free. Tooling, render importers, and transports may have their own dependencies outside the sim. This is the GoldSrc "shared pm code" trick modernized, and it's non-negotiable for prediction correctness. Bit-identical float determinism across native/WASM is *not* required (server is authoritative; client reconciles), but same-build determinism is, for replays and tests.
2. **The browser client is C++20 compiled as one WASM executable.** It owns raw WebGL2 rendering, input callbacks, audio, HUD/menus, prediction, and interpolation. The only JavaScript is Emscripten's generated loader plus a tiny static development server. This deliberately replaces the TypeScript/Three.js prototype instead of maintaining two client architectures.
3. **Transport = interface with a WebRTC DataChannel implementation first** (libdatachannel server-side, datachannel-wasm or browser API client-side; one unreliable+unordered channel for inputs/snapshots, one reliable for events/chat). WebTransport backend added when support justifies it. WebSocket only for signaling/lobby.
4. **Fixed tick simulation** (start at 64 Hz, evaluate 100 Hz): client samples input per tick, predicts locally, server sends delta-compressed snapshots (20–30/s) against last-acked; interpolation delay ~100 ms for remote entities; lag-compensated hitscan rewind on server.
5. **Single-threaded WASM to start** (no SharedArrayBuffer/COOP/COEP headaches); the sim at this scale fits comfortably in one thread. Revisit only with profiler evidence.
6. **HUD and in-game menus render in WebGL.** The HTML shell is limited to the canvas, loading/failure text, and accessibility-friendly launch instructions. If a browser API lacks a practical C/C++ binding, isolate the smallest possible `EM_JS` shim rather than moving game state into JavaScript.

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
| step height | 18u | Quake/GoldSrc-style stair step-up |
| bhop cap | 1.7 × maxspeed, velocity scaled down on jump | `PM_PreventMegaBunnyJumping` behavior |
| jump fatigue | fuser2=1315.789429, decay dt·1000/frame, factor (100 − fuser2·0.019)/100 | 25% penalty on fresh jump |
| duck | speed ×0.333, duck-in-air hull shrink (enables duck-jumps onto boxes) | |
| water/ladders | GoldSrc ladder climb + wet physics | M2+, low priority |

**Acceptance tests ("1.6 feel checklist"), automated where possible:**
- Strafe-turning in air gains speed; W-only air = no gain.
- Bhop chain: second hop visibly lower (fatigue), speed caps around 1.7× and settles into rhythm.
- Counter-strafe stops in roughly 100–160 ms from full run when the opposite key is released at the velocity crossing (about 7–10 ticks at 64 Hz; verify feel again at 100 Hz).
- Duck-jump reaches 55–60u ledges; run-jump crosses standard gaps.
- Manual A/B feel comparison against CS 1.6 in [browser Xash3D](https://github.com/yohimik/webxash3d-fwgs) with same inputs.

### 4.2 Gunplay

- **Hitscan** raycasts through the brush world + player hitboxes (head/chest/stomach/limb multipliers; headshot ×4).
- **Spread model:** `direction = pattern[shotIndex] × patternScale + jitter + inaccuracy(stance, speed, airborne) × randomCone`. First-shot accuracy for rifles standing still; heavy air penalty; crouch bonus; recovery timer decays shotIndex when not firing.
- **Recoil:** punch-angle view kick per shot (decays over time), pattern tables authored per weapon (7-ish rounds up, then horizontal drift — AK-style; MP5 tight; deagle huge first-shot punch). Author in a debug "spray lab" view (fire at wall, overlay pattern) — reuse the aim-trainer roots.
- **Damage:** base dmg × range falloff (`rangeMod^(dist/500)` 1.6-style) × hitgroup × armor rule (kevlar absorbs %, helmet vs headshot).
- **Penetration:** per-weapon power, per-material (brush texture → material) modifier, entry loss + per-unit loss, max 1–2 surfaces.
- **Weapon roster (MVP):** six firearms plus knife — 2 pistols (USP/Glock analogs), AK analog, M4 analog, AWP analog, MP5 analog. Buy price/kill reward table comes with defuse mode.
- **Movement-speed per weapon** (table in `constants`), weapon switch/draw times, reload times, fire rates — all data-driven from one weapons table (C++ struct array, mirrored to a JSON for tooling).

### 4.3 Maps — simple originals first, one trace API

The sim traces a player AABB through an abstract collision world; three authoring/import paths feed it:

- **(a) Original code-built worlds (required demo path, M1–M3):** ship a compact `aim_arena` made from simple convex boxes/ramps: two spawn ends, short lanes, wood crates, a wallbang panel, stairs, and jump/duck-jump test geometry. Render meshes and collision primitives come from the same authored data. This guarantees a redistributable, fast-loading demo with no external asset dependency and deliberately echoes the small `aim_`/`fy_` maps of early community shooters without copying a layout.
- **(b) Imported glTF worlds (optional comparison path, after the demo):** when a local reference GLB is available, the C++ client/tooling layer may load and normalize it (×39.37 for meter-authored assets) for visual comparison. World collision still comes from convex brush planes or an authored low-detail collision proxy. A static triangle BVH is deferred until a concrete prop or comparison-world use case proves it necessary; it is not an M2 blocker. `assets/maps/de_dust2_ref.glb` remains a private, gitignored feel-testing aid, never a milestone dependency or public asset.
- **(c) TrenchBroom brush maps (original/shippable path, M6):** TrenchBroom with a custom game config (spawns, buyzones, bombsites, ladders, lights) → `mapc` compiler (C++): Valve-220 `.map` → CSG brush polygons → render mesh with per-material batching + baked **lightmaps** (direct+ambient raycaster first), collision brush planes with material tags, entity list. Quake-style hull tracing via plane offsetting (Minkowski expansion) — the classic 1.6 feel path (surf ramps come free). Output: one binary pack file.
- **Nav mesh** generation is collision-source-agnostic (flood-fill "can I stand here" sampling over the trace API, à la the official CS bot) — so bots work on `aim_arena` and any optional imported comparison world before the brush pipeline exists.
- **Maps plan:** `aim_lab` movement fixture (M1) → original `aim_arena` playable demo (M2 onward) → optional local reference GLBs for comparison only → original defuse layout via TrenchBroom (M6). Mid/long sightlines, readable chokepoints, crates, and height changes carry the 1.6/Quake design language.

### 4.4 Multiplayer

- Authoritative server, 64 tick baseline (test 100), snapshots 20–30 Hz delta-compressed against last-acked (Quake 3 model), inputs sent per tick with redundancy (last N cmds per packet — loss tolerance without reliability).
- Client: prediction + reconciliation (replay unacked inputs on correction), remote entity interpolation (~100 ms buffer), lag-compensated hitscan on server (rewind hitboxes by client's interpolated view time).
- Bandwidth budget: ≤ 30 kB/s down per client at 10 players (delta + quantized fields: positions 13-bit-ish per axis relative, angles 8–12 bit).
- Rooms/lobbies: signaling server (small; can be the game server binary serving WebSocket) with room codes; server browser + master server later (M7).
- Server-side sanity checks only for v1 anti-cheat: speed/teleport validation, fire-rate clamps, impossible-angle rejection.

### 4.5 Bots (single-player and backfill)

- Nav mesh generated by flood-fill sampling over the collision-trace API (→ rectangular areas, à la CS bot) — source-agnostic, so it works on `aim_arena`, optional imported worlds, and brush maps later. A* pathfinding, string-pull smoothing, jump/drop links.
- **Current playable slice:** `aim_arena` has a deliberately small authored ten-node graph through its north/south lanes and wall gap. Three server-authoritative bots use A* over it in `?bots=1`; procedural nav-area generation, smoothing, and jump/drop links remain the rest of M5.
- Behavior FSM per Booth's design: roam/hunt/attack/retreat (+ plant/defuse for defuse mode); vision cone + reaction delay; humanized aim (error decays toward target, difficulty = reaction ms, aim speed, error).
- Difficulty presets; bots fill empty slots in multiplayer; offline = same code in the WASM local server.

### 4.6 Game modes

1. **M4: FFA deathmatch** (respawn, all-buy) — fastest fun, tests everything.
2. **M6: Defuse** (rounds, economy, buy menu, bomb plant/defuse, win conditions) — the actual CS loop. Economy: start money, kill/objective rewards, loss bonus — tuned tables, original values.

### 4.7 Assets & audio

- **Local reference assets (audited — see `assets/README.md`):** the gitignored files may include `de_dust2_ref.glb` (9.3k tris, 34 baked textures, meter scale), `cs16_characters_ref.glb` (8 characters ≈1.2k tris each, textured but **unrigged**), and `ak47_ref.glb` (1.8k tris, **untextured** flat-color materials split into 8 parts). All are Sketchfab-sourced Valve derivatives: optional private placeholders only, never copied into a required build or public release. Canonical unit is the GoldSrc unit; meter-scale assets scale ×39.37 at import.
- **Art direction rule: PSX/GoldSrc-era only** — low-poly *textured* models (not modern flat-shaded stylized low-poly). Source index: [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection); any pack pulled from elsewhere must match the PSX look.
- **Weapons (imported and audited):** shippable CC0 sources now live under `assets/models/psx/weapons/`: textured knife, Glock, AK, M4A1, and MP5 GLBs; a textured double-barrel FBX; and two textured FPS-arm rigs (the primary has 18 authored clips). `assets/README.md` records every source, license, and geometry audit. The Ace Spectre modern/heavy meshes were downloaded for intake but are not vendored because the supplied `texturer.com` texture terms are no longer verifiable; use only after retexturing from known-CC0 sources. M3's temporary debug silhouettes are fallback geometry only; the C++ GLB path is the visual path forward.
- **Player models (imported and audited):** the CC0 German Police Officer Set is the primary M4/M5 fixture: ~650 tris, rigged FBX, six useful clips, and low-resolution textures. Rigged ordinary-man and anime alternates plus an unrigged cartoon-woman art reference are also retained. The older hazmat source stays available as a secondary rig. `cs16_characters_ref.glb` (unrigged, Valve-derived) is visual reference only.
- **Textures:** low-res (128–256px) CC0 (AmbientCG/Kenney) with a consistent palette; lightmaps do the atmospheric heavy lifting.
- **Audio:** M3 caches short procedural OpenAL buffers so the WASM client has immediate shot/hit/dry/reload feedback without asset licensing or per-shot allocation. M4/M5 add audited CC0 samples for per-material footsteps, distance-attenuated gunfire, and reload foley. Sound-as-information is core CS design — footstep audibility radius matches 1.6-ish (~1100u, verify).

---

## 5. Repo & Build Plan

```
cs-web/
├── sim/            # C++20 shared core (no runtime deps): pm, trace, weapons, rules, snapshot
│   └── tests/      # small native test executable + determinism/replay tests
├── client/         # C++ WebGL2 renderer, input, audio, HUD, WASM entry point
├── server/         # native C++: tick loop, libdatachannel transport, bots, rooms
├── tools/mapc/     # .map compiler → pack (mesh, lightmap, collision, navmesh)
├── tools/serve.mjs # dependency-free Node static server for local browser testing only
├── web/            # minimal HTML canvas/loading shell copied into public/
├── assets/         # maps/ + models/ (dev ref GLBs, gitignored + audited in assets/README.md;
│                   #   .map sources, original models, textures, sounds — original/CC0 only)
└── CMakeLists.txt  # native + Emscripten client/server builds
```

- Build: CMake presets (`native`, `wasm` via Emscripten). CI builds both and runs native sim tests headless. Emscripten links sim + client into `game.wasm` and generated `game.js`, then copies the minimal shell into `public/`.
- Client/sim boundary: ordinary C++ calls in the same executable; the C ABI remains for native tests, server reuse, replay tooling, and possible future module separation.
- Dev loop: `npm run dev` builds the C++ WASM client and starts the dependency-free Node static server. Node/npm is local build plumbing only; gameplay and the authoritative server remain C++.

---

## 6. Milestones (each with concrete success criteria)

| # | Status | Milestone | Success criteria (verify) |
|---|---|---|---|
| **M0** | ✅ Complete | **Scaffold + spike** (≈1 wk): CMake + Emscripten build of sim + raw WebGL2 C++ client; render a cube moved by the sim | `npm run dev` serves a dependency-free WASM build showing C++-driven motion; sim unit test runs natively |
| **M1** | ✅ Complete | **Movement core** (2–3 wk): pm code (walk/air/friction/jump/duck/fatigue/bhop cap), Quake-style convex-brush plane trace, flat test room; C++ renderer drives it | 1.6 feel checklist §4.1 passes; determinism test (same inputs → same state hash) green |
| **M2** | ✅ Complete | **Playable world** (2 wk): original code-built `aim_arena`, shared render/collision authoring data, convex boxes and true ramp brushes through one plane-offset hull trace, material tags, spawn markers | `aim_arena` loads immediately; automated routes cover ramps, stairs, doorways, jump and duck-jump fixtures with M1 movement intact; browser smoke test is clean and the small fixed draw list sustains 60 fps on the demo machine |
| **M3** | ✅ Complete | **Gunplay** (2–3 wk): weapons table, spread/recoil/patterns, damage/hitgroups, penetration, original code-built debug viewmodels, cached procedural audio buffers, spray-lab debug view | Native tests prove deterministic continuous patterns, damage, and wallbang loss; spray patterns reproduce in spray lab without branches; a local playtest supports tapping, bursting, spraying, reloads, weapon switching, moving targets, and visible hit feedback |
| **M4** | ✅ Complete | **Netcode + server** (3–4 wk): native server, libdatachannel transport, prediction/reconciliation, interpolation, lag comp, FFA DM | Local browsers join the native server over unordered/unreliable WebRTC; the 8-player harness at 150 ms simulated latency + 5% loss has bounded corrections; server tick ≤ 2 ms p95. Signaling admission, hostile-packet validation, resource bounds, and deployment guidance are covered. Public-Internet ICE/TURN and rooms remain M7 deployment work. |
| **M5** | 🚧 Playable slice | **Bots** (2 wk): navmesh gen from the collision world, A*, combat FSM, difficulties; offline mode (WASM local server) | Bots navigate `aim_arena` end-to-end; bot wins vs. new player at max difficulty; offline page works with zero network. Remaining: generated nav areas, path smoothing, jump/drop links, and difficulty presets. |
| **M6** | ⬜ Not started | **Defuse mode + original map pipeline** (3–4 wk): rounds/economy/buy menu, bombsites, win conditions; TrenchBroom config + `mapc` (brush mesh, plane collision, lightmap v1) + first original defuse map | A full 5v5 bot match completes on the original defuse map; economy balances across 10-round sims; the map loads and plays through the same trace API |
| **M7** | ⬜ Not started | **Ship v1** (2 wk): lobby/rooms UX, deploy (Docker server on Hetzner/Fly + static client CDN), perf and security pass, bundle budget | Cold load < 20 MB / < 10 s on 50 Mbps; 60 fps min-spec; WSS/Origin enforcement, short-lived room tokens, TURN credentials, sandboxed server deployment, protocol fuzzing, and a public playtest |
| **M8+** | ⬜ Deferred | Options: WebGPU/sokol renderer backend, WebTransport backend, more maps/weapons, spectator, demos/replays (free from determinism), server browser | — |

Rough total: ~4–5 months of focused part-time work. Milestones are sequenced so the game is *playable and fun* at the end of every one (M1 = movement playground, M3 = aim trainer++, M4 = real multiplayer DM).

---

## 7. Testing & Verification Strategy

- **Sim unit tests (native, fast):** acceleration curves, friction, jump heights, fatigue factors, spread determinism, penetration damage tables.
- **Determinism/replay tests:** recorded input streams → state hash; run in CI on native and WASM (wasmtime) builds.
- **Netcode harness:** loopback server with configurable latency/jitter/loss; scripted clients assert reconciliation error bounds; adversarial fixtures reject malformed packets and sequence-window poisoning without mutating server state.
- **Feel validation:** side-by-side manual comparison vs. CS 1.6 in browser Xash3D; capture and compare strafe-speed graphs.
- **Perf budgets (regression-checked):** client frame ≤ 8 ms mid-spec; server tick ≤ 2 ms @ 10 players + 10 bots; snapshot ≤ 1.2 kB avg.

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Movement doesn't "feel right" despite correct constants | A/B against Xash3D CS with identical input scripts; keep frame-quirk toggles (e.g., jump-before-friction ordering) as tunables |
| WebRTC server ops pain (ICE/STUN, certs) | libdatachannel handles ICE; single STUN (Google) suffices for client→server; document TURN fallback; keep WebSocket-TCP emergency transport |
| Scope creep (engine-itis) | Milestone gates require *playable fun*; the raw renderer implements only what the current milestone visibly needs, with sokol/WebGPU deferred until concrete duplication or profiling justifies it |
| Cheating and hostile multiplayer input | Treat every browser as untrusted; server owns movement/hits/damage/ammo/score; authenticate signaling, bound traffic and rewind, validate identity/schema/sequence before mutation, and complete the public deployment gate in `SECURITY.md` during M7 |
| Asset quality/time sink | CC0 bootstrap, style guide (low-poly + lightmaps hides art weakness), art replaces gradually |
| Legal | No Valve assets/names/code shipped; mechanics-as-facts reimplemented; GPL projects are references only; original map layouts "inspired by" not traced. The `assets/*_ref.glb` Valve derivatives are local dev placeholders (gitignored), swapped out by M7 public release |

## 9. Decisions & Deferred Questions

1. **Decision:** start at 64 fixed ticks/s; benchmark 100 ticks/s in M4 instead of making early movement depend on render rate.
2. **Decision:** use functional working weapon names in the M3 demo; final game/weapon naming is a content decision before M6, not a sim blocker.
3. Hosting region strategy is deferred to M7 (single US region first is the baseline).
4. Lightmap quality is deferred to M6 (`mapc` starts with direct + ambient; add a bounce only if the visual gain justifies build time).

## 10. Immediate Next Steps

1. **Complete — M0:** CMake + Emscripten, one C++ WebGL2/WASM executable, minimal HTML shell, dependency-free Node development server, and native test target.
2. **Complete — M1:** 64 Hz GoldSrc-style movement, Quake-inspired convex plane tracing, deterministic replay hash, and automated feel fixtures.
3. **Complete — M2:** shared-data `aim_arena` with boxes, ramp, stairs, materials, spawns, automated traversal, and a clean browser smoke test.
4. **Complete — M3:** shot authority, weapon table, deterministic tests, moving targets, penetration, viewmodel/audio/HUD feedback, persistent spray-wall impacts, and live browser fire/reload/switch loops.
5. **Complete — art bridge:** selected PSX-style CC0 weapon, arms, and character packs are fetched, vendored, and audited; the C++ GLB path draws textured knife, pistol, AK, M4, and MP5 viewmodels with multi-material support.
6. **Playable local checkpoint — M4:** the native C++ server and browser clients exchange live FFA state over unordered/unreliable WebRTC DataChannels; prediction/reconciliation with visual error smoothing, interpolation, authoritative damage/respawn, lag compensation, 150 ms / 5% loss regression coverage, and the 8-player tick benchmark are working. Full eight-player snapshots are 346 B, redundant input packets are 64 B, and the server benchmark remains comfortably below the 2 ms p95 budget.
7. **Complete — M4 art pass:** the CC0 692-triangle textured character fixture replaces the temporary remote-player debug meshes, loads from one embedded-texture GLB, scales to the authoritative standing/ducked hull, and rotates from interpolated yaw in the two-client demo. The audited police rig and clips remain the later animation path.
8. **Playable slice — M5:** `?bots=1` runs a zero-network four-player FFA through the same authoritative C++ server core compiled into WASM. Three bots acquire opponents, follow a ten-node A* graph around the arena blockers, aim with deterministic error/reaction delay, fire, reload, score, die, and respawn. Eight separated inward-facing FFA spawns replace the old two-spawn lane offsets. Full M5 still requires generated nav areas, path smoothing, jump/drop links, and difficulty presets.
9. **Complete — M4 security checkpoint:** signaling now requires a high-entropy session token and binds to loopback by default; incomplete handshakes, signaling/ICE floods, malformed or spoofed DataChannel messages, packet-rate abuse, partial packet mutation, and far-future sequence poisoning are bounded or rejected. `SECURITY.md` records the stricter WSS/Origin/room-token/TURN/container/fuzzing gate for M7 public deployment.

## 11. Reference Library

**Movement/physics:** [pm_shared.c (Valve halflife repo)](https://github.com/ValveSoftware/halflife) · [Quake pmove.c](https://github.com/id-Software/Quake/blob/master/QW/client/pmove.c) · [QW air physics math](https://mattias.niklewski.com/2013/01/qw_air_physics.html) · [PM_PreventMegaBunnyJumping thread](https://hlcoders.valvesoftware.narkive.com/4O1InsrV/pm-preventmegabunnyjumping) · [CS stamina (jwchong)](https://www.jwchong.com/posts/counter-strike-stamina/) · [KZ stamina](https://kzguide.gitlab.io/techniques/stamina/) · [bhop physics (kz-rush)](https://kz-rush.ru/page/bhop-physics) · [QMovement UE5 reimpl](https://github.com/MrKamkar/QMovement)
**Gunplay:** [Recoil (CS wiki)](https://counterstrike.fandom.com/wiki/Recoil) · [Spray control guide](https://www.tobyscs.com/csgo-spray-control/) · [Accuracy internals (AlliedModders)](https://forums.alliedmods.net/archive/index.php/t-166648.html) · [Bullet penetration (Valve wiki)](https://developer.valvesoftware.com/wiki/Bullet_Penetration_in_Counter-Strike:_Source) · [Bullet penetration (CS wiki)](https://counterstrike.fandom.com/wiki/Bullet_Penetration)
**Netcode:** [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) · [Gambetta: prediction/reconciliation](https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html) · [Gambetta: lag compensation](https://www.gabrielgambetta.com/lag-compensation.html) · [Gaffer networking resources](https://github.com/gafferongames/GameNetworkingResources) · [WebRTC DC for games (MDN)](https://developer.mozilla.org/en-US/docs/Games/Techniques/WebRTC_data_channels) · [libdatachannel](https://github.com/paullouisageneau/libdatachannel) · [datachannel-wasm](https://github.com/paullouisageneau/datachannel-wasm) · [WebRTC vs WebSockets](https://developers.rune.ai/blog/webrtc-vs-websockets-for-multiplayer-games)
**Platform/rendering:** [caniuse WebGPU](https://caniuse.com/webgpu) · [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status) · [sokol WebGPU backend](https://floooh.github.io/2023/10/16/sokol-webgpu.html) · [bgfx WebGPU status](https://bkaradzic.github.io/posts/webgpu/) · [WASM game engines guide](https://simplified.media/guides/wasm-game-engines)
**Existence proofs:** [webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs) · [cs1.6-browser](https://github.com/modesage/cs1.6-browser) · [Krunker history](https://ioground.com/blog/the-history-behind-krunker-io)
**Maps/assets:** [TrenchBroom manual](https://trenchbroom.github.io/manual/latest/) · [.map format](https://book.leveldesignbook.com/appendix/resources/formats/map) · [Quake maps in Three.js](https://dev.to/mcharytoniuk/loading-quake-engine-maps-in-three-js-part-1-parsing-55mp) · [Blockbench](https://www.blockbench.net/wiki/guides/model-rendering/) · [Retro3DGraphicsCollection (PSX asset index)](https://github.com/Miziziziz/Retro3DGraphicsCollection) · [ace-spectre PS1 weapons](https://ace-spectre.itch.io/modern-weapons-ps1-style) · [PS1 heavy/light weapons](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack) · [Low Poly Glock](https://mextie.itch.io/low-poly-glock)
**Bots:** [Booth GDC 2004 (vault)](https://www.gdcvault.com/play/1013625/) · [Booth GDC 2004 (recording)](https://archive.org/details/GDC2004Booth2) · [CS-EBOT (reference only)](https://github.com/EfeDursun125/CS-EBOT)
