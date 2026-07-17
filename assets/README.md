# assets/

Reference assets for development. See `PLAN.md` §4.7 for the asset strategy.

> **Licensing:** the `*_ref.glb` files are Sketchfab-sourced models derived from
> Valve's CS 1.6 content. They are **dev/reference placeholders only** — fine for
> local development and feel-testing, must be replaced with originals before any
> public release.

## Audit (2026-07-17, via GLB inspection)

| File | Tris | Textures | Rig/Anims | AABB size (units) | Notes |
|---|---|---|---|---|---|
| `maps/de_dust2_ref.glb` | 9,318 | 34 PNGs (baked) | — | 95.3 × 13.1 × 112.5 | ~Meter scale (real dust2 ≈ 110 m footprint). Y-up. 36 meshes/materials (`material_N` names — no semantic material tags). |
| `models/cs16_characters_ref.glb` | 9,870 total | 14 PNGs | **none** (static) | lineup 15.5 × 1.84 × 0.54 | 8 characters (urban, arctic, GIGN, SAS, terror, leet, guerilla, GSG9) + hand meshes, ~1.2k tris each, ~1.84 units tall → meter scale, consistent with the map. Needs rigging in Blender before use as player models. |
| `models/ak47_ref.glb` | 1,836 | **none** (untextured) | — | 1.96 × 8.46 × 29.1 | 8 flat-color materials split by part (barrel, forearm, handle, magazine, …) — good for viewmodel anims. Scale/pivot are arbitrary (29 units long, AABB offset from origin) → must be recentered + rescaled on import. |
| `models/hazmat/` (.blend/.fbx/.png/.psd) | — | 1 PNG (+ PSD source) | **rigged** (27 skin clusters, 76 bones, Blender-standard names), no animations | — | Chosen dev player model. Author idle/run/crouch/jump/die in Blender, export glTF. Source: [mcsteeg's Hazmat Character](https://mcsteeg.itch.io/hazmat-character). |

## Chosen external packs (pull in M3, see PLAN.md §4.7)

- [Modern Weapons PS1 Style](https://ace-spectre.itch.io/modern-weapons-ps1-style) — CC0 (textures via texturer.com terms; one reported missing pistol texture)
- [PS1 Heavy and Light Weapons Pack](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack) — CC0 (same texture caveat)
- [Low Poly Glock](https://mextie.itch.io/low-poly-glock) — CC0, includes GLB

## Conventions

- **Art direction: PSX/GoldSrc-era low-poly with textures** — no modern
  flat-shaded stylized low-poly. Index for more:
  [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection).
- Canonical sim unit is the **GoldSrc unit** (1u = 1 inch). These meter-scale
  assets get scaled ×39.37 at import time (asset-normalization step, see PLAN.md M2).
- Subdirs: `maps/` (world geometry), `models/` (weapons, characters, props).
  TrenchBroom `.map` sources for original maps will live in `maps/` too.
- New assets must be original or CC0; record provenance in this file.
