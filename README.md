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

**Enemies are off by default** — you land in an empty map to move around and
look at. Turn PvP on with the menu's ENEMIES slider (or `?bots=N`); the match
restarts in place, no reload. SKILL next to it is a continuous 0–2 dial, not
three presets, and **0 is passive** — the bots roam the map and never shoot, so
you can learn a level with company in it. Both choices are remembered.

| `?map=` | mode | |
|---|---|---|
| `foundry` (default) | team | pit arena, three heights |
| `depot` | team | loading hall, long lanes — AWP country |
| `silo` | deathmatch | tight FFA donut |
| `practice` | range | movement/aim greybox; bots roam but never shoot |

Dev flags: `?bots=N`, `?skill=0..2` (fractions welcome), `?spawn=x,y,z`,
`?yaw=radians`, `?coords`. `practice` keeps its bots by default — they're
targets, not opponents.

**Bullets go through things.** Plank screens and thin panels are cover, not
safety: a rifle punches through 16u of board, only the AWP gets through 32u of
concrete, and steel stops nearly everything. Damage falls off with what the wall
cost you. `?map=practice` has a four-panel range to feel it out.

Wear headphones — footsteps and gunfire are positional and go muffled through
walls, and **Shift** is the only way to move without making any.

Controls: **WASD** move · **Space**/**wheel** jump · **Shift** walk (silent) ·
**Ctrl**/**C** duck · **R** reload · **1–7** weapons · **Q** last weapon ·
**Mouse1** fire · **Mouse2** scope (AWP) · **Tab** scoreboard.

## Test

```sh
npm run test        # native build + movement/determinism tests (ctest)
npm run mapcheck    # headless map validation against the real sim
npm run typecheck   # client TS
npm run build       # wasm + typecheck + production bundle
```
