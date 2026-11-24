# Asset Provenance & Licensing

Every binary asset under `client/public/assets/` is either **CC0 (Public Domain)**
or **original art generated specifically for cs-web**. No Valve, Half-Life,
Counter-Strike, or other proprietary assets exist in this repository.

---

## World Textures (`client/public/assets/textures/`)

### Poly Haven (CC0 1.0 Public Domain)
All textures below were sourced from [Poly Haven](https://polyhaven.com/textures)
under the **CC0 1.0 Universal** license and resized/colour-graded to 512×512 JPEG
for web delivery:

| File | Poly Haven Asset ID | License | Source URL |
|---|---|---|---|
| `concrete.jpg` | `concrete_wall_006` | CC0 | https://polyhaven.com/a/concrete_wall_006 |
| `concrete_dark.jpg` | `concrete_floor_worn_001` | CC0 | https://polyhaven.com/a/concrete_floor_worn_001 |
| `brick.jpg` | `brick_wall_003` | CC0 | https://polyhaven.com/a/brick_wall_003 |
| `sandstone.jpg` | `sandstone_blocks_05` | CC0 | https://polyhaven.com/a/sandstone_blocks_05 |
| `plaster.jpg` | `damaged_plaster` | CC0 | https://polyhaven.com/a/damaged_plaster |
| `sand.jpg` | `sand_02` | CC0 | https://polyhaven.com/a/sand_02 |
| `asphalt.jpg` | `asphalt_04` | CC0 | https://polyhaven.com/a/asphalt_04 |
| `metal.jpg` | `metal_plate` | CC0 | https://polyhaven.com/a/metal_plate |
| `rust.jpg` | `rust_coarse_01` | CC0 | https://polyhaven.com/a/rust_coarse_01 |
| `corrugated.jpg` | `rusty_corrugated_iron` | CC0 | https://polyhaven.com/a/rusty_corrugated_iron |
| `shutter.jpg` | `rusted_shutter` | CC0 | https://polyhaven.com/a/rusted_shutter |
| `grate.jpg` | `metal_grate_rusty` | CC0 | https://polyhaven.com/a/metal_grate_rusty |
| `wood.jpg` | `wood_planks_dirt` | CC0 | https://polyhaven.com/a/wood_planks_dirt |
| `crate_wood.jpg` | `plywood` | CC0 | https://polyhaven.com/a/plywood |
| `container.jpg` | `container_side` | CC0 | https://polyhaven.com/a/container_side |
| `alloy.jpg` | `blue_metal_plate` | CC0 | https://polyhaven.com/a/blue_metal_plate |
| `deck.jpg` | `metal_plate_02` | CC0 | https://polyhaven.com/a/metal_plate_02 |
| `tech.jpg` | `factory_wall` | CC0 | https://polyhaven.com/a/factory_wall |
| `detail.jpg` | Derived (high-pass) from `concrete_wall_006` | CC0 | https://polyhaven.com/a/concrete_wall_006 |

### Original Bespoke Textures (Generated for cs-web)
Original orthographic architectural & prop textures created specifically for
this project (no copyrighted source material):

| File | Description | License |
|---|---|---|
| `crate.jpg` | Weathered wooden military cargo crate face (`US-742` stencil, iron brackets, diagonal brace) | Original (project license) |
| `dust_wall.jpg` | Horizontally-tileable desert sandstone & weathered plaster compound wall with masonry wainscot and cornice | Original (project license) |
| `wood_door.jpg` | Weathered heavy timber double doors with iron strap hinges and latch | Original (project license) |
| `industrial_wall.jpg` | Horizontally-tileable industrial warehouse wall with cinderblock dado, hazard stripe, and concrete panels | Original (project license) |
| `ct_head.jpg` | Cylindrical UV head wrap: dark ribbed-knit SWAT balaclava with realistic shadowed eyes in eye-slit | Original (project license) |
| `t_head.jpg` | Cylindrical UV head wrap: rugged dark-haired guerrilla operator face with stubble and cropped hair | Original (project license) |
| `ct_vest.jpg` | Dark charcoal-navy SWAT Cordura plate carrier with stitched MOLLE webbing and scuffed buckles | Original (project license) |
| `t_vest.jpg` | Weathered olive-drab canvas tactical chest rig with brass snaps and stitched pouches | Original (project license) |
| `t_cloth.jpg`, `ct_cloth.jpg` | Seamless khaki/olive guerrilla BDU twill cloth and dark navy/slate SWAT urban BDU variant | Original (project license) |
| `glove.jpg` | Scuffed black Nomex and grained leather combat glove material with Kevlar double-stitching | Original (project license) |
| `gunmetal.jpg` | Seamless worn parkerized/blued firearm steel with horizontal machining grain | Original (project license) |
| `ak_wood.jpg` | Seamless Russian AK-47 shellac laminated birch stock wood grain | Original (project license) |

---

## 3D Models (`client/public/assets/models/`)

### Poly Haven (CC0 1.0 Public Domain)
Packed/decimated from [Poly Haven](https://polyhaven.com/models) 1K glTF downloads
under **CC0 1.0 Universal** (with embedded 512×512 JPEG maps):

| File | Poly Haven Asset ID | License | Source URL |
|---|---|---|---|
| `barrel.glb` | `Barrel_01` | CC0 | https://polyhaven.com/a/Barrel_01 |
| `crate_wood.glb` | `wooden_crate_01` | CC0 | https://polyhaven.com/a/wooden_crate_01 |
| `crate_mil.glb` | `old_military_crate` | CC0 | https://polyhaven.com/a/old_military_crate |
| `ammo_box.glb` | `ammo_box` | CC0 | https://polyhaven.com/a/ammo_box |
| `lamp_ind.glb` | `hanging_industrial_lamp` | CC0 | https://polyhaven.com/a/hanging_industrial_lamp |
| `awp.glb` | `bolt_action_rifle_7_62` (decimated + baked transforms in Blender) | CC0 | https://polyhaven.com/a/bolt_action_rifle_7_62 |
| `pistol.glb` | `service_pistol` (decimated + baked transforms in Blender) | CC0 | https://polyhaven.com/a/service_pistol |

### Original Blender-Authored Low-Poly Models
Modeled cleanly in Blender 5.3 for cs-web (GoldSrc inch scale, UV-mapped to the
original textures above):

| File | Description | License |
|---|---|---|
| `ak47.glb` | Sculpted low-poly AK-47 rifle with animated curved `magazine` and right-side `action` bolt carrier | Original (project license) |
| `m4a1.glb` | Sculpted low-poly M4A1 carbine with carry handle, ribbed handguard, animated `magazine` and `action` T-handle | Original (project license) |
| `mp5.glb` | Sculpted low-poly MP5 SMG with hooded drum sight, animated `magazine` and left-side `action` cocking handle | Original (project license) |
| `knife.glb` | Hollow-ground beveled clip-point combat Bowie knife with fuller groove and ribbed tactical grip | Original (project license) |
| `hand_gun_r.glb`, `hand_rifle_l.glb`, `hand_pistol_l.glb`, `hand_knife_r.glb` | Continuous sculpted first-person tactical gloved hands | Original (project license) |
| `sleeve_ct.glb`, `sleeve_t.glb` | Wrinkled BDU forearm sleeves with leather glove gauntlets (CT navy / T khaki) | Original (project license) |
| `ct_gasmask.glb` | Dual-lens SAS-style tactical respirator gas mask with side filter canister | Original (project license) |

---

## Audio Samples (`client/public/assets/audio/`)

All `.mp3` samples were trimmed, loudness-normalised, and encoded (44.1 kHz mono,
96 kbps) from **CC0 1.0 Public Domain** packs on OpenGameArt.org:

| File(s) | Upstream Pack / Creators | License | Source URL |
|---|---|---|---|
| `ak47.mp3`, `m4a1.mp3`, `awp.mp3`, `mp5.mp3`, `glock.mp3`, `usp.mp3` | *The Free Firearm Sound Library* (Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney / `bart`) — AK-47 `C_28P`, AR-15 `D_32P`, Tikka .30-06 `W_29P`, Carl Gustav M45 `G_31P`, Walther PPQ `X_39P`, Ruger Mark III `R_35P` (EQ-suppressed for USP) | CC0 | https://opengameart.org/content/the-free-firearm-sound-library |
| `reload_rifle.mp3`, `reload_pistol.mp3`, `cock.mp3` | *Gun Reload Sounds* (SpringySpringo) | CC0 | https://opengameart.org/content/gun-reload-sounds |
| `step_stone_1..3.mp3`, `step_sand_1..3.mp3` | *Fantozzi's Footsteps* (Fantozzi / `qubodup`) | CC0 | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone |
