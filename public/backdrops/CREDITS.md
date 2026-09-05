# Backdrop credits

Exterior photos fetched by scripts/fetch_backdrops.py, used as
WallOpening.backdropUrl presets — what you SEE through a door or
window (types/opening.ts). The free-text backdropUrl field in
OpeningInspector.tsx stays available for a business's own site
photo; these are just a small starter library.

UNLIKE the ambientCG/Poly Haven assets used elsewhere in this repo
(CC0 everywhere, no attribution required), these come from
Wikimedia Commons, where license terms are PER FILE. None of the
three below is CC0 — each is CC BY or CC BY-SA and carries a real
attribution requirement, recorded exactly per file below.

All downscaled to ~1600px wide (sips -Z 1600) — these sit behind a
wall opening and are never inspected closely, so full resolution
is wasted bytes.

## urban-balcony.jpg

```
source: Wikimedia Commons — File:Gurgaon skyline.jpg
url: https://commons.wikimedia.org/wiki/File%3AGurgaon_skyline.jpg
license: CC BY-SA 3.0
attribution: Dealtroadd, via Wikimedia Commons
resolution: resized to 1600px wide (sips -Z 1600)
note: Urban high-rise/rooftop skyline over Gurgaon (Delhi NCR) — the default 'what's outside the window' for the app's stated Delhi NCR target market. A believable view from a kitchen window or balcony on a mid/high floor.
```

## green-trees.jpg

```
source: Wikimedia Commons — File:Green carpet ooty,tamilnadu - panoramio.jpg
url: https://commons.wikimedia.org/wiki/File%3AGreen_carpet_ooty%2Ctamilnadu_-_panoramio.jpg
license: CC BY 3.0
attribution: rajaraman sundaram, via Wikimedia Commons
resolution: resized to 1600px wide (sips -Z 1600)
note: Wide lawn framed by trees and a wooded hillside — a generic green/garden view for a window that doesn't face a street.
```

## plain-sky.jpg

```
source: Wikimedia Commons — File:Clouds (14355723635).jpg
url: https://commons.wikimedia.org/wiki/File%3AClouds_%2814355723635%29.jpg
license: CC BY-SA 2.0
attribution: Ryan McGuire (Bells Design) / Free for Commercial Use, via Wikimedia Commons
resolution: resized to 1600px wide (sips -Z 1600)
note: Plain blue sky with scattered cumulus, no horizon or foreground subject — the fallback for a window whose actual view isn't worth modelling (a light well, an airshaft, an upper-floor sky-only window).
```
