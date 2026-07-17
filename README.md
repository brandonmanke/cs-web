# CS-Web

Browser FPS prototype written in C++20. Emscripten compiles the simulation and
raw WebGL2 client into one WebAssembly executable; native builds run tests and
will later power the authoritative server.

## Development

Requirements: CMake and Emscripten. Node.js 22+ is used only by the tiny,
dependency-free local static server.

```sh
npm run sim:test
npm run dev
```

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
viewmodel silhouettes. Those silhouettes are mechanics placeholders; the next
art pass imports the audited textured PSX-style CC0 weapon packs listed in
`assets/README.md`.
