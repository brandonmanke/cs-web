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
`http://127.0.0.1:3100`. Use WASD to move the green M0 simulation cube. There
are no npm packages, renderer frameworks, or handwritten browser bindings in
the frame loop.
