#!/usr/bin/env python3
"""
scripts/fetch_textures.py

Populates public/textures/ with CC0 PBR material maps from ambientCG,
then regenerates src/lib/textureManifest.ts so the app picks them up
automatically (see lib/textures3d.ts — a surface with real files uses
them, a surface without falls back to the procedural generator).

Standard library only. No pip install, no dependencies.

WHY THIS ISN'T A ONE-SHOT "DOWNLOAD 5 PER KEYWORD" SCRIPT
Texture quality is a judgement call, and a keyword search returns
whatever matches — for "Wood" that includes bark, firewood and rough
planks alongside the cabinet-grade grain we actually want. Grabbing the
top N and wiring them in blind tends to produce a kitchen that looks
worse than flat colors. So the workflow here is two-step:

    1. discover  — search and print candidates, with preview links
    2. fetch     — pin one specific asset to one of our three surfaces

Once pinned, the asset IDs live in PINNED below and `--sync` reproduces
the whole library on any machine, which is the part actually worth
automating.

USAGE
    python3 scripts/fetch_textures.py discover wood
    python3 scripts/fetch_textures.py discover "kitchen tile" --limit 15
    python3 scripts/fetch_textures.py fetch Wood062 --as wood
    python3 scripts/fetch_textures.py sync            # re-fetch all PINNED
    python3 scripts/fetch_textures.py clean

NOTE ON VERIFICATION: the ambientCG response shape wasn't verified while
writing this, so nothing here assumes an exact schema — download links
are found by walking the JSON for any node containing 'downloadLink'
(see iter_downloads), with a constructed-URL fallback. If the API
changes shape, `discover` prints what it actually received rather than
failing with a KeyError.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

API_URL = "https://ambientcg.com/api/v2/full_json"
GET_URL = "https://ambientcg.com/get?file={filename}"
USER_AGENT = "kitchen-renovation-app/1.0 (texture fetch script)"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEXTURE_DIR = PROJECT_ROOT / "public" / "textures"
MANIFEST_TS = PROJECT_ROOT / "src" / "lib" / "textureManifest.ts"
CREDITS_MD = TEXTURE_DIR / "CREDITS.md"

# The three surfaces lib/textures3d.ts knows about. Keys must match its
# SurfaceKind union exactly.
SURFACES = ("wood", "quartz", "tile")

# Pin the assets you picked via `discover` here, then `sync` rebuilds
# the library anywhere. Left empty on purpose — see the note above about
# why auto-picking search results is a bad default.
PINNED: dict[str, str] = {
    "wood": "Wood049",
    "quartz": "Marble012",
    "tile": "Tiles107",
}

RESOLUTION = "1K-JPG"

# Which map goes where. three.js wants the OpenGL normal convention
# (green channel points up) — ambientCG ships both, so prefer NormalGL
# and only fall back to NormalDX/Normal if that's all an asset has.
# Getting this wrong inverts the lighting on every bump, which reads as
# "the grain looks carved instead of raised" rather than as an error.
MAP_TARGETS = {
    "color.jpg": ("_color",),
    "normal.jpg": ("_normalgl", "_normal", "_normaldx"),
    "roughness.jpg": ("_roughness",),
}

REQUEST_DELAY_S = 1.0  # be polite to a free service


def http_get(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def search(query: str, limit: int) -> list[dict]:
    params = urllib.parse.urlencode(
        {"q": query, "type": "Material", "limit": limit, "include": "downloadData"}
    )
    raw = http_get(f"{API_URL}?{params}")
    data = json.loads(raw.decode("utf-8"))

    assets = data.get("foundAssets")
    if assets is None:
        # Don't guess — show what came back so the fix is obvious.
        print("Unexpected API response. Top-level keys:", list(data.keys()), file=sys.stderr)
        return []
    return assets


def iter_downloads(node):
    """Yield every dict in the response that looks like a download entry.

    Walks the whole tree rather than indexing a fixed path, so a schema
    change nests things differently without breaking this.
    """
    if isinstance(node, dict):
        if "downloadLink" in node:
            yield node
        for value in node.values():
            yield from iter_downloads(value)
    elif isinstance(node, list):
        for value in node:
            yield from iter_downloads(value)


def pick_zip_url(asset: dict, asset_id: str) -> str:
    """Prefer a real link from the API; fall back to the known URL shape."""
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
    """Pull the three maps we care about out of the asset zip."""
    written: dict[str, str] = {}
    destination.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        names = archive.namelist()
        for out_name, suffixes in MAP_TARGETS.items():
            match = None
            # Ordered by preference — first suffix that matches wins.
            for suffix in suffixes:
                for name in names:
                    stem = Path(name).stem.lower()
                    if stem.endswith(suffix):
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


def fetch(asset_id: str, surface: str, force: bool = False) -> bool:
    if surface not in SURFACES:
        print(f"Unknown surface '{surface}'. Expected one of: {', '.join(SURFACES)}", file=sys.stderr)
        return False

    destination = TEXTURE_DIR / surface
    if destination.exists() and not force and (destination / "color.jpg").exists():
        print(f"{surface}: already present (use --force to re-download)")
        return True

    print(f"{surface}: fetching {asset_id} ...")
    # One search call purely to get the asset's real download links.
    try:
        results = search(asset_id, limit=5)
    except urllib.error.URLError as err:
        print(f"  ! search failed ({err}); falling back to constructed URL")
        results = []

    asset = next((a for a in results if a.get("assetId") == asset_id), {})
    zip_url = pick_zip_url(asset, asset_id)

    try:
        zip_bytes = http_get(zip_url, timeout=180)
    except urllib.error.HTTPError as err:
        print(f"  ! download failed: HTTP {err.code} for {zip_url}", file=sys.stderr)
        return False
    except urllib.error.URLError as err:
        print(f"  ! download failed: {err}", file=sys.stderr)
        return False

    written = extract_maps(zip_bytes, destination)
    if "color.jpg" not in written:
        print(f"  ! {surface}: no color map extracted, leaving surface procedural", file=sys.stderr)
        return False

    (destination / "SOURCE.txt").write_text(
        f"assetId: {asset_id}\nsource: https://ambientcg.com/view?id={asset_id}\n"
        f"license: CC0 1.0 Universal (public domain)\nresolution: {RESOLUTION}\n",
        encoding="utf-8",
    )
    return True


def installed_surfaces() -> dict[str, dict[str, str] | None]:
    result: dict[str, dict[str, str] | None] = {}
    for surface in SURFACES:
        directory = TEXTURE_DIR / surface
        color = directory / "color.jpg"
        normal = directory / "normal.jpg"
        roughness = directory / "roughness.jpg"
        # All three are required — a partial set would render worse than
        # the procedural fallback, so treat it as absent.
        if color.exists() and normal.exists() and roughness.exists():
            result[surface] = {
                "map": f"/textures/{surface}/color.jpg",
                "normalMap": f"/textures/{surface}/normal.jpg",
                "roughnessMap": f"/textures/{surface}/roughness.jpg",
            }
        else:
            result[surface] = None
    return result


def write_manifest() -> None:
    entries = installed_surfaces()

    lines = [
        "// src/lib/textureManifest.ts",
        "//",
        "// AUTO-GENERATED by scripts/fetch_textures.py — do not edit by hand.",
        "// Run `python3 scripts/fetch_textures.py sync` to regenerate.",
        "//",
        "// A surface mapped to null has no downloaded texture files and",
        "// falls back to the procedural generator in lib/textures3d.ts.",
        "",
        "import type { SurfaceFileSet, SurfaceKind } from './textures3d';",
        "",
        "export const GENERATED_TEXTURE_FILES: Record<SurfaceKind, SurfaceFileSet | null> = {",
    ]
    for surface in SURFACES:
        entry = entries[surface]
        if entry is None:
            lines.append(f"  {surface}: null,")
        else:
            lines.append(f"  {surface}: {{")
            lines.append(f"    map: '{entry['map']}',")
            lines.append(f"    normalMap: '{entry['normalMap']}',")
            lines.append(f"    roughnessMap: '{entry['roughnessMap']}',")
            lines.append("  },")
    lines.append("};")
    lines.append("")

    MANIFEST_TS.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_TS.write_text("\n".join(lines), encoding="utf-8")

    active = [s for s in SURFACES if entries[s]]
    print(f"\nmanifest: {MANIFEST_TS.relative_to(PROJECT_ROOT)}")
    print(f"  textured: {', '.join(active) if active else '(none)'}")
    print(f"  procedural: {', '.join(s for s in SURFACES if not entries[s]) or '(none)'}")


def write_credits() -> None:
    lines = [
        "# Texture credits",
        "",
        "All textures sourced from [ambientCG](https://ambientcg.com) and released",
        "under CC0 1.0 Universal (public domain) — free for commercial use with no",
        "attribution required. Credited here anyway as good practice and so the",
        "provenance of every asset in this repo is traceable.",
        "",
    ]
    for surface in SURFACES:
        source = TEXTURE_DIR / surface / "SOURCE.txt"
        if source.exists():
            lines.append(f"## {surface}")
            lines.append("")
            lines.append("```")
            lines.append(source.read_text(encoding="utf-8").strip())
            lines.append("```")
            lines.append("")

    TEXTURE_DIR.mkdir(parents=True, exist_ok=True)
    CREDITS_MD.write_text("\n".join(lines), encoding="utf-8")


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
    print(
        "\nOpen a few, pick the one that looks like real cabinet/counter/floor stock,\n"
        f"then:  python3 {Path(__file__).name} fetch <assetId> --as <{'|'.join(SURFACES)}>\n"
    )
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    ok = fetch(args.asset_id, args.surface, force=args.force)
    write_manifest()
    write_credits()
    return 0 if ok else 1


def cmd_sync(args: argparse.Namespace) -> int:
    if not PINNED:
        print(
            "Nothing pinned yet. Use `discover` to find assets, `fetch` to try one,\n"
            "then add the ones you keep to PINNED at the top of this script."
        )
        write_manifest()
        return 0

    failures = 0
    for surface, asset_id in PINNED.items():
        if not fetch(asset_id, surface, force=args.force):
            failures += 1
        time.sleep(REQUEST_DELAY_S)

    write_manifest()
    write_credits()
    return 1 if failures else 0


def cmd_clean(_args: argparse.Namespace) -> int:
    removed = 0
    for surface in SURFACES:
        directory = TEXTURE_DIR / surface
        if not directory.exists():
            continue
        for file in directory.iterdir():
            file.unlink()
            removed += 1
        directory.rmdir()
    if CREDITS_MD.exists():
        CREDITS_MD.unlink()  # would otherwise credit assets no longer present
        removed += 1
    print(f"Removed {removed} file(s). All surfaces back to procedural.")
    write_manifest()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_discover = sub.add_parser("discover", help="search ambientCG and print candidates")
    p_discover.add_argument("query")
    p_discover.add_argument("--limit", type=int, default=10)
    p_discover.set_defaults(func=cmd_discover)

    p_fetch = sub.add_parser("fetch", help="download one asset into one surface slot")
    p_fetch.add_argument("asset_id")
    p_fetch.add_argument("--as", dest="surface", required=True, choices=SURFACES)
    p_fetch.add_argument("--force", action="store_true")
    p_fetch.set_defaults(func=cmd_fetch)

    p_sync = sub.add_parser("sync", help="re-fetch everything in PINNED")
    p_sync.add_argument("--force", action="store_true")
    p_sync.set_defaults(func=cmd_sync)

    p_clean = sub.add_parser("clean", help="delete downloaded textures, revert to procedural")
    p_clean.set_defaults(func=cmd_clean)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
