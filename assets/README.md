# assets/

**Nothing in this directory is used by the game or the build.**

As of the 2026-07-25 rework, all art is generated procedurally in code:

| What | Where |
|---|---|
| World textures (concrete, rust, grate, brick, crate, …) | `client/src/art/textures.ts` |
| Player models + animation | `client/src/art/character.ts` |
| Weapon models + viewmodel | `client/src/art/weapons.ts` |
| Map geometry | `client/src/map/maps/*.ts` (convex brushes) |
| Sound | `client/src/audio.ts` (Web Audio synthesis) |

`vite.config.ts` deliberately points `publicDir` at `client/public`, **not**
here. It used to point at this directory, which meant `npm run build` copied
everything below verbatim into `dist/` — including the Valve-derived `*_ref.glb`
files that `PLAN.md` says must never ship, plus raw `.blend`/`.psd` sources no
browser can load. `.gitignore` protected the repo; nothing protected the deploy
artifact. Do not repoint `publicDir` here.

## What is still on disk

**Valve-derived rips — gitignored, never tracked, must never ship.**
`maps/de_dust2_ref.glb`, `models/cs16_characters_ref.glb`, `models/ak47_ref.glb`.
Sketchfab uploads derived from Valve's CS 1.6 content. Nothing references them
any more. They are safe to delete; they are *not* in git, so deleting is
permanent (you would re-download from Sketchfab to get them back).

**`models/hazmat/` — committed, unused, licence not recorded.** Source is
[mcsteeg's Hazmat Character](https://mcsteeg.itch.io/hazmat-character), but no
licence was ever written down for it — the one committed asset whose
redistribution terms are unknown. Resolve or remove before any public release.

**`models/psx/` — committed, CC0, unused.** ~14 MB of legitimately licensed
PSX packs, kept only as art-direction reference now that the models are
procedural:

- `weapons/` — [Modern Weapons PS1 Style](https://ace-spectre.itch.io/modern-weapons-ps1-style)
  and [PS1 Heavy and Light Weapons Pack](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack)
  (ace-spectre, CC0; textures under texturer.com terms) plus
  [Low Poly Glock](https://mextie.itch.io/low-poly-glock) (mextie, CC0).
- `characters/` — CC0 packs indexed via
  [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection).
  Individual pack authors are not recorded; only the index is.

## Conventions

- **Art direction: PSX/GoldSrc-era low-poly with textures** — not modern
  flat-shaded stylized low-poly.
- Canonical unit is the **GoldSrc unit** (1u = 1 inch), Y-up.
- Any new asset must be original or CC0, with provenance recorded here. Prefer
  generating it in code: it diffs, it has no licence, and it costs no download.
