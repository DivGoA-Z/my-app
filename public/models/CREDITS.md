# Model credits

## Kenney — Furniture Kit (kitchen-sink, kitchen-stove, range-hood)

```
source: https://kenney.nl/assets/furniture-kit
license: CC0 1.0 Universal (public domain) — attribution appreciated, not required
format: glTF binary (.glb), single file per model
```

Files: `kitchen-sink.glb`, `kitchen-stove.glb`, `range-hood.glb` — extracted from
the "GLTF format" folder of the Furniture Kit zip.

## Suggested wiring

`modelUrl` on a `PlacedApplianceItem` (see src/types/appliance.ts):

- `stove` → `/models/kitchen-stove.glb`
- `chimney` → `/models/range-hood.glb`

`kitchen-sink.glb` has no wiring point yet — `sink-unit` is a cabinet
`ModuleType` (types/cabinet.ts), not an appliance, and `PlacedCabinetItem`
has no `modelUrl` field the way appliances do. Rendered as a plain box
until that field is added.

## Other model sources

- **CREDITS_SOURCED.md** — real CC0 models fetched by
  `scripts/fetch_models.py` (Poly Haven, Khronos glTF-Sample-Assets).
- **Placeholder models** (`hob-gas-4burner.glb`, `oven-built-in.glb`,
  `sink-undermount-single.glb`, `sink-topmount-double.glb`) — generated
  by `scripts/build_placeholder_models.mjs`, not downloaded. No CC0
  .glb of a gas hob w/ trivets, glass-front oven, or the two sink
  styles was found on ambientCG/Poly Haven/Khronos (the only sources
  this pipeline scrapes — no Sketchfab, since it gates downloads
  behind a login). Each is a small stack of boxes shaped like the real
  appliance (a hob slab with raised trivets, an oven body with a dark
  glass door panel) rather than a bare cube, at a handful of triangles.
  Swap any of these for a real asset the moment one turns up.
