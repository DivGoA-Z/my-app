# Sourced model credits

Models fetched by scripts/fetch_models.py. All CC0 1.0 Universal
(public domain). Distinct from CREDITS.md, which covers the
original Kenney Furniture Kit models bundled before this script
existed.

## appliances/cooktop-induction.glb

```
source: Poly Haven
asset: electric_stove
url: https://polyhaven.com/a/electric_stove
license: CC0 1.0 Universal (public domain)
resolution: 1k baseColor/normal/metallicRoughness textures downscaled to
  512x512 with `gltf-transform resize` on 2026-09-05 (geometry
  untouched — this asset's vertex count is negligible, ~2MB of its
  original 2.48MB was four 1024x1024 JPEG textures). File dropped from
  2.48MB to 666KB. See note on public/models/README.md's "Keep them
  light" section.
note: Poly Haven has no dedicated gas-hob/induction-cooktop asset; this flat-glass electric stove is the closest CC0 stand-in for the induction cooktop slot.
```

## appliances/microwave.glb

```
source: Poly Haven
asset: vintage_microwave
url: https://polyhaven.com/a/vintage_microwave
license: CC0 1.0 Universal (public domain)
resolution: 1k textures downscaled to 512x512 with `gltf-transform
  resize` on 2026-09-05 (geometry untouched). File dropped from 2.12MB
  to 393KB.
```

## lighting/pendant-industrial.glb

```
source: Poly Haven
asset: hanging_industrial_lamp
url: https://polyhaven.com/a/hanging_industrial_lamp
license: CC0 1.0 Universal (public domain)
resolution: 1k textures (5 maps: emissive/normal/baseColor/
  metallicRoughness/glass-normal) downscaled to 512x512 with
  `gltf-transform resize` on 2026-09-05 (geometry untouched — this was
  the heaviest of the three real assets almost entirely because of its
  five full-resolution texture maps). File dropped from 3.24MB to
  568KB.
note: Wired into fixture placements (src/components/canvas3d/FixtureModel.tsx) — no longer future-use-only as of the pendant-fixture task.
```
