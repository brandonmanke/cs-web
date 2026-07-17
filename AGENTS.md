# AGENTS.md

Repository guidance for any coding agent (Codex, Claude, Cursor, etc.).

## Roadmap

**`PLAN.md` is the spec.** This repo is evolving from an aim trainer into a full
CS 1.6-derivative shooter: shared C++20 sim core (compiled to WASM for the client,
native for the authoritative server), Three.js kept as the renderer, WebRTC
DataChannels for netcode, bots server-side. Read PLAN.md before starting work that
touches movement, shooting, maps, or networking — milestones M0–M8 define what gets
built in which order and the success criteria for each. The current TypeScript game
is the reference harness until PLAN.md M1 lands; don't build new gameplay systems
in TS that the plan assigns to the C++ sim core.

## Commands

- `bun run dev` (preferred) / `npm run dev` (fallback) - start Vite dev server (hot reload)
- `bun run build` (preferred) / `npm run build` (fallback) - type-check with `tsc` then bundle with Vite
- `bunx tsc --noEmit` (preferred) / `npx tsc --noEmit` (fallback) - type-check only

## Architecture (current state)

Browser-based CS 1.6-style aim trainer built with vanilla TypeScript + Three.js.

- Game loop: `src/main.ts` creates `Game`; `src/game.ts` owns scene/camera/renderer and runs `requestAnimationFrame`
- Viewmodel: weapon mesh is attached with `camera.add(model)` for classic FPS behavior
- Movement: acceleration toward wish direction + friction + hard speed cap; tune in `src/constants.ts`
- Hit detection: center-screen raycast against target meshes (`THREE.Raycaster`)
- Bounds: player clamped to room AABB each frame (no collision mesh/physics engine)
- HUD: CSS/DOM overlay (crosshair, score, ammo, hitmarker), not a 3D UI
- Audio: Web Audio API synthesis (no external assets)
- Frame timing: use `THREE.Timer`; call `timer.update()` before `timer.getDelta()`

Data flow for shooting:
`input.mouseDown -> weapon.canShoot() -> weapon.shoot() -> targets.checkHit(camera) -> hud/audio updates`

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

- Keep gameplay tuning values in `src/constants.ts`
- Prefer simple, surgical changes over broad refactors
- Match existing code style and structure
- Do not add speculative systems/features — PLAN.md milestones define scope
- Audio stays synthesized (Web Audio) until PLAN.md M3 introduces sampled sounds
- Geometry: primitive meshes or `assets/` GLBs; `MeshStandardMaterial` with flat
  colors unless a change explicitly needs otherwise

## Agent Workflow Expectations

- Think before coding: surface assumptions and tradeoffs if ambiguity matters
- Define concrete success criteria before implementing
- Verify with commands (at minimum `bun run build` or `npm run build`) after changes
- If a change is unrelated to the user request, call it out instead of silently modifying it
