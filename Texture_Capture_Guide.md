# Photographing Material Samples for the 3D Preview

The 3D preview (`src/components/canvas3d/Room3DCanvas.tsx`) currently renders every cabinet with a flat placeholder color per Material/Finish combination (see `src/lib/materials3d.ts`). That's fine for checking that cabinets are the right size and in the right place, but it won't look like *your* acrylics, laminates, or wood grains.

To replace a placeholder with a real texture, someone at the business photographs a physical sample of that material/finish and the photo gets turned into a texture image the 3D preview can use. This guide is what "a good photo" means for that purpose — it's a different job than photographing a finished kitchen, so the rules are different too.

## What you're actually making

Not a nice photo of a cabinet — a small, flat, evenly-lit square image of *just the material surface*, with no shadows, no glare, and no visible edges or background. Software can repeat ("tile") a good one seamlessly across an entire cabinet door; a bad one shows visible seams, dark corners, or a bright glare spot in the middle of every cabinet in the room.

## Setup

**The sample.** Get the largest flat offcut or sample chip you can of the material/finish — at least 300mm x 300mm if possible. Lay it flat on a table.

**Camera position.** Point the camera straight down at the sample — as close to a perfect 90-degree angle (perpendicular to the surface) as you can manage. Any noticeable tilt introduces perspective distortion, which stretches the pattern unevenly and makes it obviously wrong once tiled. A phone on a small tripod or propped level above the sample works better than handheld.

**Distance / framing.** Fill the frame with the material — no table edge, no background, no fingers in the shot. Get close enough that the sample takes up the whole photo, but not so close that you're photographing less than roughly a 200mm x 200mm patch (too small an area tends to tile obviously — you'll see the pattern visibly repeat).

**Height.** There's no fixed number here — it depends on your camera's lens — but as a starting point, 300-400mm above the sample usually frames a 300mm sample nicely on a typical phone camera. Adjust so the sample fills the frame per the distance/framing note above.

## Lighting — the part most likely to go wrong

**Use soft, even, shadow-free light.** The goal is light that looks the same everywhere across the sample. Good options:
- Daylight through a window on an overcast day (bright but diffuse — no direct sun).
- Two lamps or softboxes, one on each side at roughly 45 degrees, aimed at the sample rather than the camera.

**Avoid a single direct light source** (a bare bulb, direct sun, or a phone's flash) pointed straight at the sample. That creates a hotspot — a bright blown-out patch — usually right in the center where the camera is, which is the worst possible place for it since it'll be the most visible part of every tile.

**Glossy finishes (Acrylic, PU) are the hardest case.** A glossy surface will mirror whatever's in front of it, including the camera and the photographer. If you see a reflection of yourself or the light source in the sample, move the light to the side (not eliminate it — just get the reflection off to the side, out of frame) or shoot at a very slight angle to dodge the hotspot, accepting a small amount of perspective correction afterward. A polarizing filter on the camera lens, if you have one, helps a lot here.

**Matte finishes (Veneer, Membrane, Laminate) are more forgiving** but still benefit from even lighting — uneven light still shows up as a fake-looking gradient across an otherwise uniform material.

## File specs

- **Format:** JPG or PNG.
- **Resolution:** 1024x1024px minimum, 2048x2048px preferred. Crop to a square.
- **Crop:** crop out any background, table edge, or sample border — the final image should be *only* the material's surface, edge to edge.
- **Naming:** `material-finish.jpg`, all lowercase, spaces replaced with hyphens, matching the values in `src/types/cabinet.ts` — e.g. `hdmr-laminate.jpg`, `plywood-laminate.jpg`, `mdf-pu.jpg`. This is what will let the code automatically match a photo to the right combination.

## What a photo can't give you

The photo becomes the *color/pattern* (the "map" in PBR material terms) — it does not tell the code how glossy or matte the finish is. Roughness and metalness (how shiny vs. dull a finish looks under light) stay as manually-set values in `src/lib/materials3d.ts`, tuned by eye once the real photo is in place. If a finish looks too shiny or too dull once its real texture is loaded, that's the roughness number to adjust, not the photo.

## What happens next

This guide describes the *input*. Wiring the photos into the actual 3D rendering (loading them as textures, applying them to the right cabinets) is separate follow-up work — `src/lib/materials3d.ts` has a comment marking exactly where that plugs in once real photos exist to test against.
