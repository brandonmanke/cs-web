# AGENTS.md

Repository guidance for any coding agent (Codex, Claude, Cursor, etc.).

## Roadmap

**`PLAN.md` is the spec.** This repo is evolving from an aim trainer into a full
CS 1.6-derivative shooter: shared C++20 sim core, C++ WebGL2 browser client via
Emscripten, native authoritative server, WebRTC DataChannels, and server-side bots.
Read PLAN.md before starting work that touches movement, shooting, maps, rendering,
or networking — milestones M0–M8 define what gets built in which order and the
success criteria for each. JavaScript is limited to generated browser glue and the
dependency-free local static server; do not move gameplay or rendering out of C++.

## Commands

- `npm run dev` - build the C++ WebAssembly client, then serve it on port 3100
- `npm run build` - build the C++ WebAssembly client
- `npm run sim:test` - build and run the native C++ simulation tests

## Architecture (current state)

Browser-based CS 1.6-style shooter built in C++20 and compiled with Emscripten.

- Game loop and raw WebGL2 renderer: `client/src/main.cpp`
- Portable gameplay simulation and C ABI: `sim/`
- Native verification: `sim/tests/`
- Browser shell: `web/index.html` (canvas/loading text only)
- Local server: `tools/serve.mjs` (Node built-ins only)

The client and sim link into one WASM executable, so gameplay calls cross an
ordinary C++ boundary rather than marshalling state through JavaScript.

## Assets

- `assets/` holds reference GLBs (dust2 map, CS character pack, AK-47) — audited
  in `assets/README.md` (dimensions, scale, gaps). They are Valve-derived Sketchfab
  models: **dev placeholders only**, gitignored, never shipped publicly.
- `assets/models/hazmat/` is the chosen dev player model (rigged, unanimated);
  chosen CC0 weapon packs are listed in `assets/README.md`.
- Art direction: PSX/GoldSrc-era low-poly **with textures** — new asset sources
  must match that look (no modern flat-shaded stylized low-poly).
- Canonical sim unit is the GoldSrc unit (1u = 1 inch); the ref assets are ~meter
  scale and get scaled ×39.37 at import.
- New assets must be original or CC0; record provenance in `assets/README.md`.

## Conventions

- Keep gameplay tuning values in the C++ sim, not the renderer
- Prefer simple, surgical changes over broad refactors
- Match existing code style and structure
- Do not add speculative systems/features — PLAN.md milestones define scope
- Audio stays C++-generated until PLAN.md M3 introduces sampled sounds
- Geometry: simple original primitives first; optional glTF imports stay outside
  the sim and are normalized into the same runtime mesh format

## Agent Workflow Expectations

- Think before coding: surface assumptions and tradeoffs if ambiguity matters
- Define concrete success criteria before implementing
- Verify with commands (at minimum `npm run build`) after changes
- If a change is unrelated to the user request, call it out instead of silently modifying it
