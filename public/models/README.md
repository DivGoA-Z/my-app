# 3D models

Drop `.glb` files here and point an appliance's **3D Model** field at
them (Manage Inventory → Appliances), e.g. `/models/hob-600.glb`. Light
fixtures work the same way (Manage Inventory → Light Fixtures), e.g.
`/models/lighting/pendant-industrial.glb` — see "Fixtures" below for
what's different about them.

Anything in `public/` is served by Vite at the matching path, so
`public/models/hob-600.glb` is reachable as `/models/hob-600.glb`.

## Where to get them

All CC0 / permissively licensed:

- **Poly Haven** — https://polyhaven.com/models
- **Khronos glTF Sample Assets** — https://github.com/KhronosGroup/glTF-Sample-Assets
- **Sketchfab** — filter by CC0 or CC-BY (CC-BY needs attribution)

Prefer `.glb` (single self-contained file) over `.gltf` (which
references external textures by relative path and is easy to break when
moving files).

## What the renderer does for you

`src/components/canvas3d/ApplianceModel.tsx` measures each model's
bounding box and scales it to the width/depth/height stored on the
appliance, then sits its base on the appliance's elevation. So a model
does **not** need to arrive at real-world scale or be centred on its
origin — those are normalised automatically.

Two consequences worth knowing:

- Scaling is **per-axis**, so the model occupies exactly the box the
  quote was priced against. If a model looks stretched, its proportions
  differ from the appliance's stored dimensions — fix the dimensions,
  since those are what the client is being charged for.
- A model that fails to load falls back to the plain box and logs a
  warning. It won't blank the 3D view.

## Fixtures

Light fixtures (`src/components/canvas3d/FixtureModel.tsx`) work the
same way as appliances — same measure-and-normalise fit, same
Suspense + error-boundary fallback to a plain shape on any failure —
with two differences:

- A fixture has no priced widthMm/heightMm/depthMm the way an appliance
  does, so its model is fitted to a fixed real-world size chosen in
  code rather than one read off the catalogue. It's a decorative body,
  not a priced/measured item.
- The emissive glow and the real light a fixture casts are computed
  from its lumens/colour-temperature/throw-direction regardless of
  which body renders — a fixture model is body geometry ONLY, never a
  light source. This app used to have a bug where a fixture's visible
  body glowed by itself while lighting nothing; a GLB with its own
  baked-bright material must not bring that back.

## Keep them light

These load in the browser, often on mobile over mobile data. Aim for
low-poly assets under a couple of MB each. Draco-compressed files are
**not** currently supported — the loader has no decoder configured.
