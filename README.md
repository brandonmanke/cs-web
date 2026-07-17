# CS-Web

Browser FPS prototype written in C++20. Emscripten compiles the simulation and
raw WebGL2 client into one WebAssembly executable; native builds run tests and
the authoritative deathmatch server.

## Development

Requirements: CMake and Emscripten. Node.js 22+ is used only by the tiny,
dependency-free local static server and asset audit/conversion helpers.

```sh
npm run sim:test
npm run dev
```

After `npm run sim:test`, `./build/native/cs_server_benchmark` runs the
eight-player tick benchmark used by M4.

`npm run dev` builds `game.wasm` and serves `public/` at
`http://127.0.0.1:3100`. Click the canvas, then use WASD + mouse, Space to jump,
Ctrl/C to duck, Mouse1/F to fire, R to reload, and 1–7 to switch weapons. There
are no npm packages or renderer frameworks; browser glue is limited to
Emscripten callbacks and a tiny canvas-sizing shim.

The M2 `aim_arena` currently includes fixed 64 Hz simulation, Quake-style
acceleration/slide movement and convex-brush tracing, GoldSrc-style air
acceleration, jump fatigue, mega-bhop slowdown, duck hulls, stair stepping, a
true ramp, opposing spawns, and concrete/wood/metal/sand material tags. The
renderer and simulation consume the same original map definitions.

The M3 gunplay demo adds a shared C++ weapon table (knife + six firearms),
deterministic spray/recoil, movement inaccuracy, ammo and reload timing,
head/chest/stomach/limb damage, range falloff, material penetration, moving
targets, cached procedural OpenAL audio, a WebGL HUD, and temporary code-built
fallback silhouettes. The runtime now draws the audited textured PSX-style CC0
knife, pistol, AK, M4, and MP5 models listed in `assets/README.md`.

M4 adds a versioned binary input/snapshot protocol, three-command input
redundancy, eighth-unit snapshot quantization, client prediction and replay
reconciliation, remote interpolation, a native eight-player authoritative FFA
loop, bounded hitscan rewind, death/respawn, and a deterministic 150 ms RTT / 5%
packet-loss harness. The browser and native C++ server exchange those packets on
an unordered, unreliable WebRTC DataChannel; WebSocket is used only for the
small signaling exchange. Remote players use an audited, textured 692-triangle
CC0 PSX-style model; the code-built humanoid remains only a load-failure fallback.

To play the local multiplayer demo, start these in separate terminals:

```sh
npm run server:run
npm run dev
```

Open `http://127.0.0.1:3100/?online=1` in two browser windows. The default page
without `?online=1` remains the zero-network M3 gunplay demo. The first server
build fetches the pinned libdatachannel source and its native dependencies, so it
takes longer than later incremental builds. A non-default signaling endpoint can
be supplied as `?online=1&signal=ws://host:port`.

For a zero-network solo FFA, run only `npm run dev` and open
`http://127.0.0.1:3100/?bots=1`. Three server-authoritative C++ bots run inside
the same WASM executable, follow an A* navigation graph around the arena's
central blockers, acquire/fire/reload/respawn through the normal simulation, and
use the same textured remote-player model as WebRTC opponents.
