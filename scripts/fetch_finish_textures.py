#!/usr/bin/env python3
"""
scripts/fetch_finish_textures.py

Downloads CC0 PBR material sets from ambientCG straight into
public/textures/<material_name>/ as color.jpg / normal.jpg /
roughness.jpg, one folder per SurfaceFinish catalogue row.

Distinct from scripts/fetch_textures.py, which feeds the OLDER
3-slot procedural-fallback system (SurfaceKind: wood/quartz/tile,
consumed by lib/textures3d.ts for cabinet fronts/counters/floor
when a finish has no photographed swatch). This script instead
targets the newer, per-product SurfaceFinish catalogue (types/
finish.ts) — every row there carries its own albedoUrl/
normalMapUrl/roughnessMapUrl, independent of SurfaceKind, so any
number of named materials can be added without touching that
union. Run this first; run seed_finishes_and_appliances.mjs after
to write the matching surface_finishes rows.

Standard library only. No pip install.

USAGE
    python3 scripts/fetch_finish_textures.py sync            # fetch everything in PINNED
    python3 scripts/fetch_finish_textures.py fetch Wood051 --as dark-walnut
    python3 scripts/fetch_finish_textures.py discover walnut
    python3 scripts/fetch_finish_textures.py clean
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

API_URL = "https://ambientcg.com/api/v2/full_json"
GET_URL = "https://ambientcg.com/get?file={filename}"
USER_AGENT = "kitchen-renovation-app/1.0 (finish texture fetch script)"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEXTURE_DIR = PROJECT_ROOT / "public" / "textures"
CREDITS_MD = TEXTURE_DIR / "CREDITS_FINISHES.md"

RESOLUTION = "1K-JPG"

# material_name (-> public/textures/<name>/) -> ambientCG assetId.
# Picked by hand via `discover`, same workflow as fetch_textures.py.
# A few categories ambientCG's photogrammetry library has no exact
# match for (true quartz, polished chrome, ornate Moroccan tile) use
# the closest honest substitute — noted in the "note" field, which
# lands in CREDITS_FINISHES.md so the substitution is never silent.
PINNED: dict[str, dict[str, str]] = {
    "wood-dark-walnut":   {"assetId": "Wood051",     "note": "closest CC0 dark hardwood grain"},
    "wood-plywood-edge":  {"assetId": "Chipboard004", "note": "chipboard/plywood edge grain"},
    "wood-reclaimed":     {"assetId": "Wood066",      "note": "closest CC0 rough-sawn plain wood"},
    "stone-black-granite": {"assetId": "Granite002A", "note": ""},
    "stone-white-quartz": {"assetId": "Marble021",    "note": "ambientCG has no true quartz scan; closest bright veined polished stone"},
    "stone-concrete":     {"assetId": "Concrete034",  "note": ""},
    "metal-brushed-steel": {"assetId": "Metal050A",   "note": ""},
    "metal-polished-chrome": {"assetId": "Metal032",  "note": "ambientCG has no pure chrome scan; closest smooth reflective grey metal"},
    "metal-matte-black":  {"assetId": "Metal046A",    "note": ""},
    "metal-brushed-brass": {"assetId": "Metal048A",   "note": ""},
    "tile-large-ceramic-floor": {"assetId": "Tiles141", "note": ""},
    "tile-moroccan-geometric": {"assetId": "Tiles138", "note": "ambientCG has no ornate Moroccan pattern; closest geometric stone/tile scan"},
}

# The room-surface library (§120): floors, walls, stone, wood flooring,
# chosen by eye from ambientCG previews for what Delhi NCR kitchens use.
# Seen from standing height across a room, so stored at 512 px (see the
# resolution note in CREDITS_FINISHES.md); `fetch` downsizes them.
SURFACE_LIBRARY: dict[str, dict[str, str]] = {
    "tile-plain-white":         {"assetId": "Tiles107",  "note": "plain white grid; tinted to any vitrified shade"},
    "tile-glossy-black":        {"assetId": "Tiles108",  "note": ""},
    "tile-beige-stone-rect":    {"assetId": "Tiles143",  "note": "limestone-look rectangular"},
    "tile-cream-matt":          {"assetId": "Tiles139",  "note": ""},
    "tile-checker-marble":      {"assetId": "Tiles074",  "note": ""},
    "tile-black-marble":        {"assetId": "Tiles075",  "note": ""},
    "tile-botticino-marble":    {"assetId": "Tiles078",  "note": ""},
    "tile-bw-pattern-marble":   {"assetId": "Tiles081",  "note": ""},
    "tile-dark-grey-stone":     {"assetId": "Tiles140",  "note": ""},
    "tile-white-square-wall":   {"assetId": "Tiles036",  "note": ""},
    "tile-white-small-square":  {"assetId": "Tiles133A", "note": ""},
    "tile-white-subway":        {"assetId": "Tiles136A", "note": ""},
    "tile-white-hexagon":       {"assetId": "Tiles071",  "note": ""},
    "tile-black-penny":         {"assetId": "Tiles129B", "note": ""},
    "tile-encaustic":           {"assetId": "Tiles131",  "note": ""},
    "tile-blue-white-painted":  {"assetId": "Tiles101",  "note": ""},
    "tile-white-large-matt":    {"assetId": "Tiles040",  "note": ""},
    "tile-terrazzo-white":      {"assetId": "Tiles043",  "note": ""},
    "tile-charcoal-large":      {"assetId": "Tiles052",  "note": ""},
    "tile-green-subway":        {"assetId": "Tiles032",  "note": ""},
    "marble-grey-veined":       {"assetId": "Marble012", "note": ""},
    "marble-black-white-vein":  {"assetId": "Marble016", "note": ""},
    "marble-cream":             {"assetId": "Marble014", "note": ""},
    "marble-rose-beige":        {"assetId": "Marble020", "note": ""},
    "marble-yellow-cream":      {"assetId": "Marble026", "note": ""},
    "marble-dark-green":        {"assetId": "Marble009", "note": ""},
    "marble-taupe":             {"assetId": "Marble024", "note": ""},
    "marble-white":             {"assetId": "Marble001", "note": ""},
    "marble-golden-brown":      {"assetId": "Marble008", "note": ""},
    "marble-blue-grey":         {"assetId": "Marble003", "note": ""},
    "granite-rosy-pink":        {"assetId": "Granite001A", "note": ""},
    "granite-grey-speckled":    {"assetId": "Granite003A", "note": ""},
    "granite-brown":            {"assetId": "Granite004A", "note": ""},
    "granite-light-grey":       {"assetId": "Granite005A", "note": ""},
    "granite-red":              {"assetId": "Granite006A", "note": ""},
    "granite-black-gold":       {"assetId": "Granite007A", "note": ""},
    "terrazzo-multicolour":     {"assetId": "Terrazzo013", "note": ""},
    "terrazzo-beige":           {"assetId": "Terrazzo019M", "note": ""},
    "terrazzo-black-chips":     {"assetId": "Terrazzo005", "note": ""},
    "terrazzo-deep-green":      {"assetId": "Terrazzo016", "note": ""},
    "travertine-cream":         {"assetId": "Travertine009", "note": ""},
    "travertine-silver":        {"assetId": "Travertine004", "note": ""},
    "onyx-honey":               {"assetId": "Onyx007", "note": ""},
    "woodfloor-oak-natural":    {"assetId": "WoodFloor051", "note": ""},
    "woodfloor-walnut-parquet": {"assetId": "WoodFloor070", "note": ""},
    "woodfloor-oak-herringbone": {"assetId": "WoodFloor034", "note": ""},
    "woodfloor-dark-walnut":    {"assetId": "WoodFloor046", "note": ""},
    "woodfloor-pale-ash":       {"assetId": "WoodFloor066A", "note": ""},
    "woodfloor-teak-tone":      {"assetId": "WoodFloor064", "note": ""},
    "microcement-ivory":        {"assetId": "Concrete046", "note": ""},
    "microcement-grey":         {"assetId": "Concrete016", "note": ""},
    "plaster-white-textured":   {"assetId": "Plaster001", "note": ""},
    "brick-white-painted":      {"assetId": "Bricks060", "note": ""},
    "brick-red-exposed":        {"assetId": "Bricks092", "note": ""},
}
PINNED.update(SURFACE_LIBRARY)
LIBRARY_PX = 512

MAP_TARGETS = {
    "color.jpg": ("_color",),
    "normal.jpg": ("_normalgl", "_normal", "_normaldx"),
    "roughness.jpg": ("_roughness",),
}

REQUEST_DELAY_S = 1.0


def http_get(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_with_retry(url: str, timeout: int = 60, attempts: int = 4) -> bytes:
    delay = 2.0
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return http_get(url, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code in (403, 404):
                raise  # not retryable — caller falls back to an alternative asset
            last_err = err
        except urllib.error.URLError as err:
            last_err = err
        print(f"  ! attempt {attempt}/{attempts} failed ({last_err}); retrying in {delay:.0f}s")
        time.sleep(delay)
        delay *= 2
    assert last_err is not None
    raise last_err


def search(query: str, limit: int) -> list[dict]:
    params = urllib.parse.urlencode(
        {"q": query, "type": "Material", "limit": limit, "include": "downloadData"}
    )
    raw = http_get(f"{API_URL}?{params}")
    data = json.loads(raw.decode("utf-8"))
    assets = data.get("foundAssets")
    if assets is None:
        print("Unexpected API response. Top-level keys:", list(data.keys()), file=sys.stderr)
        return []
    return assets


def iter_downloads(node):
    if isinstance(node, dict):
        if "downloadLink" in node:
            yield node
        for value in node.values():
            yield from iter_downloads(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_downloads(value)


def pick_zip_url(asset: dict, asset_id: str) -> str:
    for entry in iter_downloads(asset):
        haystack = " ".join(
            str(entry.get(key, "")) for key in ("attribute", "downloadAttribute", "fileName", "downloadLink")
        ).lower()
        if RESOLUTION.lower() in haystack and ".zip" in haystack:
            link = entry.get("downloadLink")
            if link:
                return link
    return GET_URL.format(filename=f"{asset_id}_{RESOLUTION}.zip")


def extract_maps(zip_bytes: bytes, destination: Path) -> dict[str, str]:
    written: dict[str, str] = {}
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
        for out_name, suffixes in MAP_TARGETS.items():
            match = None
            for suffix in suffixes:
                for name in names:
                    if Path(name).stem.lower().endswith(suffix):
                        match = name
                        break
                if match:
                    break
            if not match:
                print(f"  ! no {out_name} in archive (has: {', '.join(sorted(names))})")
                continue
            (destination / out_name).write_bytes(archive.read(match))
            written[out_name] = match
            print(f"  + {out_name}  <- {match}")
    return written


def fetch(material_name: str, asset_id: str, note: str, force: bool = False) -> bool:
    destination = TEXTURE_DIR / material_name
    if destination.exists() and not force and (destination / "color.jpg").exists():
        print(f"{material_name}: already present (use --force to re-download)")
        return True

    print(f"{material_name}: fetching {asset_id} ...")
    try:
        results = search(asset_id, limit=5)
    except urllib.error.URLError as err:
        print(f"  ! search failed ({err}); falling back to constructed URL")
        results = []

    asset = next((a for a in results if a.get("assetId") == asset_id), {})
    zip_url = pick_zip_url(asset, asset_id)

    try:
        zip_bytes = http_get_with_retry(zip_url, timeout=180)
    except urllib.error.HTTPError as err:
        print(f"  ! download failed: HTTP {err.code} for {zip_url}", file=sys.stderr)
        return False
    except urllib.error.URLError as err:
        print(f"  ! download failed: {err}", file=sys.stderr)
        return False

    written = extract_maps(zip_bytes, destination)
    if "color.jpg" not in written:
        print(f"  ! {material_name}: no color map extracted", file=sys.stderr)
        return False

    if material_name in SURFACE_LIBRARY:
        import subprocess
        for f in written:
            subprocess.run(["sips", "-Z", str(LIBRARY_PX), str(destination / f)], check=True, capture_output=True)

    note_line = f"note: {note}\n" if note else ""
    (destination / "SOURCE.txt").write_text(
        f"assetId: {asset_id}\nsource: https://ambientcg.com/view?id={asset_id}\n"
        f"license: CC0 1.0 Universal (public domain)\nresolution: {RESOLUTION}\n{note_line}",
        encoding="utf-8",
    )
    return True


def write_credits() -> None:
    lines = [
        "# Finish texture credits",
        "",
        "All textures sourced from [ambientCG](https://ambientcg.com), CC0 1.0",
        "Universal (public domain) — free for commercial use, no attribution",
        "required. These back individual `surface_finishes` catalogue rows",
        "(types/finish.ts) via seed_finishes_and_appliances.mjs, distinct from",
        "the older wood/quartz/tile procedural-fallback set in CREDITS.md.",
        "",
    ]
    for material_name in PINNED:
        source = TEXTURE_DIR / material_name / "SOURCE.txt"
        if source.exists():
            lines.append(f"## {material_name}")
            lines.append("")
            lines.append("```")
            lines.append(source.read_text(encoding="utf-8").strip())
            lines.append("```")
            lines.append("")
    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    CREDITS_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"credits: {CREDITS_MD.relative_to(PROJECT_ROOT)}")


def cmd_discover(args: argparse.Namespace) -> int:
    try:
        results = search(args.query, args.limit)
    except urllib.error.URLError as err:
        print(f"Search failed: {err}", file=sys.stderr)
        return 1
    if not results:
        print("No assets found.")
        return 0
    print(f"\n{len(results)} result(s) for '{args.query}':\n")
    for asset in results:
        asset_id = asset.get("assetId", "?")
        print(f"  {asset_id:<20} https://ambientcg.com/view?id={asset_id}")
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    ok = fetch(args.material_name, args.asset_id, args.note or "", force=args.force)
    write_credits()
    return 0 if ok else 1


def cmd_sync(args: argparse.Namespace) -> int:
    failures = 0
    for material_name, spec in PINNED.items():
        if not fetch(material_name, spec["assetId"], spec.get("note", ""), force=args.force):
            failures += 1
        time.sleep(REQUEST_DELAY_S)
    write_credits()
    print(f"\n{len(PINNED) - failures}/{len(PINNED)} material sets fetched.")
    return 1 if failures else 0


def cmd_clean(_args: argparse.Namespace) -> int:
    removed = 0
    for material_name in PINNED:
        directory = TEXTURE_DIR / material_name
        if not directory.exists():
            continue
        for file in directory.iterdir():
            file.unlink()
            removed += 1
        directory.rmdir()
    if CREDITS_MD.exists():
        CREDITS_MD.unlink()
        removed += 1
    print(f"Removed {removed} file(s).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_discover = sub.add_parser("discover", help="search ambientCG and print candidates")
    p_discover.add_argument("query")
    p_discover.add_argument("--limit", type=int, default=10)
    p_discover.set_defaults(func=cmd_discover)

    p_fetch = sub.add_parser("fetch", help="download one asset into one material slot")
    p_fetch.add_argument("asset_id")
    p_fetch.add_argument("--as", dest="material_name", required=True)
    p_fetch.add_argument("--note", default="")
    p_fetch.add_argument("--force", action="store_true")
    p_fetch.set_defaults(func=cmd_fetch)

    p_sync = sub.add_parser("sync", help="re-fetch everything in PINNED")
    p_sync.add_argument("--force", action="store_true")
    p_sync.set_defaults(func=cmd_sync)

    p_clean = sub.add_parser("clean", help="delete all downloaded finish textures")
    p_clean.set_defaults(func=cmd_clean)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
