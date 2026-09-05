# Finish texture credits

All textures sourced from [ambientCG](https://ambientcg.com), CC0 1.0
Universal (public domain) — free for commercial use, no attribution
required. These back individual `surface_finishes` catalogue rows
(types/finish.ts) via seed_finishes_and_appliances.mjs, distinct from
the older wood/quartz/tile procedural-fallback set in CREDITS.md.

## Resolution choice: floor-distance vs. close-up (2026-09-05)

A 1024x1024 JPG decodes to ~4MB of GPU VRAM regardless of on-disk size
(uncompressed in the GPU no matter how the file was compressed on disk),
and this project targets mid-range Android tablets on Delhi NCR mobile
data. With 15 texture sets x 3 maps each, shipping everything at 1K would
be on the order of 180MB of texture VRAM if all were resident at once.

The maps are only worth their resolution where the surface is actually
seen close up. A floor tile or worktop is seen from standing height,
several metres away, across a whole room — a viewer never gets close
enough for 1K detail to resolve on screen. A cabinet front or metal
handle fills much more of the frame at normal camera distance and is
genuinely viewed close, so it keeps its resolution.

Downscaled 1024 -> 512 (all three of color/normal/roughness resized
together so UVs stay matched; swatch_width_mm/swatch_height_mm in
scripts/seed_finishes_and_appliances.sql describe real-world PHYSICAL
size and are unaffected by a pixel-resolution change):

- **stone-black-granite** — floor-plausible stone finish
- **stone-white-quartz** — floor-plausible stone finish
- **stone-concrete** — floor-plausible; kept its native 1024x512 (2:1)
  ratio, resized to 512x256 rather than to a square
- **tile-large-ceramic-floor** — floor tile by name
- **tile-moroccan-geometric** — floor tile by name
- **tile** (procedural-fallback default floor set, credited in
  CREDITS.md) — this is literally the texture `RoomFloor` uses by
  default in Room3DCanvas.tsx

Kept at 1K (genuinely viewed close): all wood sets (cabinet fronts —
wood-dark-walnut, wood-plywood-edge, wood-reclaimed, and the procedural
`wood` default in CREDITS.md), `quartz` (countertop — closer viewing
distance than a floor), and all four metal sets (hardware/handles —
metal-brushed-steel, metal-polished-chrome, metal-matte-black,
metal-brushed-brass).

## wood-dark-walnut

```
assetId: Wood051
source: https://ambientcg.com/view?id=Wood051
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
note: closest CC0 dark hardwood grain
```

## wood-plywood-edge

```
assetId: Chipboard004
source: https://ambientcg.com/view?id=Chipboard004
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
note: chipboard/plywood edge grain
```

## wood-reclaimed

```
assetId: Wood066
source: https://ambientcg.com/view?id=Wood066
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
note: closest CC0 rough-sawn plain wood
```

## stone-black-granite

```
assetId: Granite002A
source: https://ambientcg.com/view?id=Granite002A
license: CC0 1.0 Universal (public domain)
resolution: 512-JPG (downscaled from 1K, 2026-09-05 — floor-distance surface, see resolution-choice note above)
```

## stone-white-quartz

```
assetId: Marble021
source: https://ambientcg.com/view?id=Marble021
license: CC0 1.0 Universal (public domain)
resolution: 512-JPG (downscaled from 1K, 2026-09-05 — floor-distance surface, see resolution-choice note above)
note: ambientCG has no true quartz scan; closest bright veined polished stone
```

## stone-concrete

```
assetId: Concrete034
source: https://ambientcg.com/view?id=Concrete034
license: CC0 1.0 Universal (public domain)
resolution: 512x256-JPG (downscaled from 1024x512, 2026-09-05, 2:1 ratio preserved — floor-distance surface, see resolution-choice note above)
```

## metal-brushed-steel

```
assetId: Metal050A
source: https://ambientcg.com/view?id=Metal050A
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
```

## metal-polished-chrome

```
assetId: Metal032
source: https://ambientcg.com/view?id=Metal032
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
note: ambientCG has no pure chrome scan; closest smooth reflective grey metal
```

## metal-matte-black

```
assetId: Metal046A
source: https://ambientcg.com/view?id=Metal046A
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
```

## metal-brushed-brass

```
assetId: Metal048A
source: https://ambientcg.com/view?id=Metal048A
license: CC0 1.0 Universal (public domain)
resolution: 1K-JPG
```

## tile-large-ceramic-floor

```
assetId: Tiles141
source: https://ambientcg.com/view?id=Tiles141
license: CC0 1.0 Universal (public domain)
resolution: 512-JPG (downscaled from 1K, 2026-09-05 — floor-distance surface, see resolution-choice note above)
```

## tile-moroccan-geometric

```
assetId: Tiles138
source: https://ambientcg.com/view?id=Tiles138
license: CC0 1.0 Universal (public domain)
resolution: 512-JPG (downscaled from 1K, 2026-09-05 — floor-distance surface, see resolution-choice note above)
note: ambientCG has no ornate Moroccan pattern; closest geometric stone/tile scan
```
