# cs-web

CS 1.6-derivative shooter in the browser: C++20 sim core (WASM) with GoldSrc
movement + spray-pattern gunplay, box3d collision, Three.js renderer.
`PLAN.md` is the roadmap.

## Requirements

- Node ≥ 24 + npm
- CMake ≥ 3.24
- Emscripten (`emcc` on PATH) for the wasm sim build

## Run

```sh
npm install
npm run wasm   # build the C++ sim -> client/src/generated/sim.mjs
npm run dev    # Vite dev server; open the printed URL, click to lock the mouse
```

Greybox movement/aim arena by default; `?map=dust2` loads the local dust2
reference GLB (dev-only asset, not in git).

Controls: WASD, Space jump, Ctrl/C duck, R reload, 1–7 weapons, Mouse1 fire.

## Test

```sh
npm run test        # native build + movement/determinism tests (ctest)
npm run typecheck   # client TS
```
