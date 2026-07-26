# cs-web

CS 1.6-derivative shooter in the browser, with Quake's eye for levels and light.
C++20 sim core (WASM) doing GoldSrc movement and spray-pattern gunplay against
convex-brush collision; Three.js renders it. Every asset — geometry, textures,
characters, weapons, sound — is generated in code. `PLAN.md` is the roadmap.

## Requirements

- Node ≥ 24 + npm
- CMake ≥ 3.24
- Emscripten (`emcc` on PATH) for the wasm sim build

No third-party C or asset dependencies: the build fetches nothing.

## Run

```sh
npm install
npm run wasm   # build the C++ sim -> client/src/generated/sim.mjs
npm run dev    # Vite dev server; open the printed URL, click to lock the mouse
```

`foundry` (the arena) loads by default; `?map=practice` is the movement/aim
greybox. Dev flags: `?spawn=x,y,z`, `?yaw=radians`, `?coords`.

Controls: **WASD** move · **Space**/**wheel** jump · **Shift** walk ·
**Ctrl**/**C** duck · **R** reload · **1–7** weapons · **Q** last weapon ·
**Mouse1** fire.

## Test

```sh
npm run test        # native build + movement/determinism tests (ctest)
npm run mapcheck    # headless map validation against the real sim
npm run typecheck   # client TS
npm run build       # wasm + typecheck + production bundle
```
