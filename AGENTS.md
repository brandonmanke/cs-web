# AGENTS.md

Repository guidance for any coding agent (Codex, Claude, Cursor, etc.).

## Commands

- `bun run dev` (preferred) / `npm run dev` (fallback) - start Vite dev server (hot reload)
- `bun run build` (preferred) / `npm run build` (fallback) - type-check with `tsc` then bundle with Vite
- `bunx tsc --noEmit` (preferred) / `npx tsc --noEmit` (fallback) - type-check only

## Architecture

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

## Conventions

- Keep gameplay tuning values in `src/constants.ts`
- Prefer simple, surgical changes over broad refactors
- Match existing code style and structure
- Do not add speculative systems/features
- Keep geometry/audio asset-free (primitive meshes + synthesized audio)
- Use `MeshStandardMaterial` with flat colors unless a change explicitly needs otherwise

## Agent Workflow Expectations

- Think before coding: surface assumptions and tradeoffs if ambiguity matters
- Define concrete success criteria before implementing
- Verify with commands (at minimum `bun run build` or `npm run build`) after changes
- If a change is unrelated to the user request, call it out instead of silently modifying it
