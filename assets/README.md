# assets/

Audited art sources for development and the eventual shippable game. See
`PLAN.md` §4.7 for the asset strategy.

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
| `models/hazmat/` (.blend/.fbx/.png/.psd) | — | 1 PNG (+ PSD source) | **rigged** (27 skin clusters, 76 bones, Blender-standard names), no animations | — | Secondary character source. Author clips before gameplay use. Source: [mcsteeg's Hazmat Character](https://mcsteeg.itch.io/hazmat-character). |

## Imported PSX/GoldSrc-style CC0 sources

These files are intentionally kept in their author's supplied interchange format.
The runtime asset build may normalize axes, scale, texture size, and format, but the
source files remain the provenance anchor.

| Path | Source | License/audit | Intended use |
|---|---|---|---|
| `models/psx/weapons/arms/player_arms.glb` | [FPS Arms](https://cemckrc.itch.io/fps-arms-psx-style) | CC0; 1,516 tris, 1 embedded texture, 1 skin / 44 joints, no authored clips | Alternate first-person arms source |
| `models/psx/weapons/arms/animated_arms.glb` | [PSX First Person Arms](https://drillimpact.itch.io/psx-first-person-arms-free) | CC0; 1,176 tris, 1 embedded texture, 1 skin / 52 joints, 18 clips | Primary first-person arms rig; includes rest, guard, knife, jab, grab, and finger-gun clips |
| `models/psx/weapons/knife/knife.glb` | [PSX Knives](https://dleom.itch.io/psx-knives) | CC0; 330 tris, 2 embedded textures | Knife view/world model |
| `models/psx/weapons/glock/glock.glb` | [Low-Poly Glock](https://mextie.itch.io/low-poly-glock) | CC0; 272 tris, 1 embedded texture | Glock-analog view/world model |
| `models/psx/weapons/ak47/ak47.glb` | [PSX-style AK-47](https://plewr.itch.io/psx-style-ak-47-model) | CC0; 934 tris, 2 embedded images / 3 texture bindings | AK-analog view/world model |
| `models/psx/weapons/mp5/mp5.glb` | [PSX-style MP5](https://plewr.itch.io/psx-style-mp5-model) | CC0; 838 tris, 1 embedded texture | MP5-analog view/world model |
| `models/psx/weapons/m4a1/m4a1.glb` | [PSX-style M4A1](https://plewr.itch.io/psx-style-m4a1-model) | CC0; 1,468 tris, 1 embedded texture | Runtime M4-analog view/world model |
| `models/psx/weapons/m4a1/m4a1.fbx` + diffuse | [Low-Poly M4A1](https://opengameart.org/content/low-poly-m4a1) | CC0; author reports 167 tris / 106 verts, hand-painted diffuse; magazine is separate | Lower-poly source candidate and reload fixture |
| `models/psx/weapons/double-barrel/` | [Double Barrel Shotgun](https://cemckrc.itch.io/double-barrel-shotgun-psx-ps1-style) | CC0 model and texture sources | Future shotgun / art-pipeline fixture |
| `models/psx/characters/police-set/` | [German Police Officer Set](https://stephrobertgames.itch.io/german-police-officer-set) | Entire pack CC0; ~650 tris; rigged FBX plus idle/walk/run/holster/aim/shoot clips and 128–256 px textures | Primary M4/M5 remote-player and bot art fixture |
| `models/psx/characters/ordinary-man/` | [Lofi Ordinary Man](https://stephrobertgames.itch.io/lofi-ordinary-man) | CC0; textured, rigged, Mixamo-ready FBX; 256 px texture retained | Alternate player silhouette |
| `models/psx/characters/anime-character/` | [80s Anime Character](https://stephrobertgames.itch.io/anime-character-low-poly-psx) | CC0; textured, rigged, Mixamo-ready FBX; 256 px texture retained | Alternate player silhouette |
| `models/psx/characters/cartoon-woman/` | [Cartoon Woman](https://stephrobertgames.itch.io/cartoon-woman-retro-psx-low-poly) | CC0; textured FBX, explicitly unrigged | Art/reference source; rig before gameplay use |

The collection's [submission rules](https://github.com/Miziziziz/Retro3DGraphicsCollection)
require commercial-use and redistribution rights for every component. We still
audit each source page instead of treating inclusion in the index as a license.

### Reviewed but not vendored

- [Modern Weapons PS1 Style](https://ace-spectre.itch.io/modern-weapons-ps1-style)
  and [Heavy and Light Weapons](https://ace-spectre.itch.io/ps1-heavy-and-light-weapons-pack):
  the meshes are CC0, but the supplied textures cite the now-unavailable
  `texturer.com` terms. Keep the downloaded intake outside the repository until
  redistribution is verified or replace the textures with known-CC0 originals.
- Valve-derived `*_ref.glb` files remain local, gitignored references only.

## Intake tools

- `node tools/fetch-itch-asset.mjs <itch-page-url> <output-directory>` downloads
  the files exposed by a free or name-your-price itch.io asset page.
- `node tools/audit-glb.mjs <file.glb> [...]` reports glTF 2.0 mesh, triangle,
  texture, skin, joint, animation, and accessor-bound counts without adding a
  JavaScript package dependency.

## Conventions

- **Art direction: PSX/GoldSrc-era low-poly with textures** — no modern
  flat-shaded stylized low-poly. Index for more:
  [Retro3DGraphicsCollection](https://github.com/Miziziziz/Retro3DGraphicsCollection).
- Canonical sim unit is the **GoldSrc unit** (1u = 1 inch). Asset-specific
  import metadata owns scale and axes; meter-authored assets scale ×39.37.
- Subdirs: `maps/` (world geometry), `models/` (weapons, characters, props).
  TrenchBroom `.map` sources for original maps will live in `maps/` too.
- New assets must be original or CC0; record provenance in this file.
