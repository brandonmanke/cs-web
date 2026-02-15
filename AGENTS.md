# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `bun run dev` — start Vite dev server (hot reload)
- `bun run build` — type-check with tsc then bundle with Vite
- `npx tsc --noEmit` — type-check only (no test framework currently)

## Architecture

Browser-based CS 1.6-style aim trainer. Vanilla TypeScript + Three.js, no framework, no physics engine.

**Game loop:** `main.ts` creates `Game` → `game.ts` owns the scene, camera, renderer, and runs `requestAnimationFrame` loop. Each frame: update player, process shooting, update weapon/targets/HUD, render.

**Key patterns:**
- **Viewmodel attachment:** Weapon model is `camera.add(model)` — follows view automatically like CS 1.6
- **Movement model:** CS-style acceleration toward wish direction + friction when idle + hard speed cap (not lerp-based). Tuning constants in `constants.ts`
- **Hit detection:** Raycaster from screen center (0,0) against target meshes. No physics engine
- **Room bounds:** AABB clamping on player position each frame (no collision meshes)
- **HUD:** Pure CSS overlay (crosshair, score, ammo) — not rendered in 3D
- **Audio:** Web Audio API synthesized sounds (noise burst for gunshot, oscillator for hit). No external audio files
- **Timer:** Uses `THREE.Timer` (not deprecated `Clock`). Must call `timer.update()` before `timer.getDelta()`

**Data flow for shooting:** `input.mouseDown` → `weapon.canShoot()` → `weapon.shoot()` + `targets.checkHit(camera)` → `hud.addScore()` + `audio.playHitSound()`

## Conventions

- All tuning values (speeds, fire rate, room dimensions, etc.) live in `constants.ts`
- No external assets — geometry is built from Three.js primitives, audio is synthesized
- Materials use `MeshStandardMaterial` (responds to lights) with flat colors, no textures
