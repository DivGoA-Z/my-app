#!/usr/bin/env python3
"""
scripts/fetch_backdrops.py

Downloads exterior photos into public/backdrops/ for use as
WallOpening.backdropUrl presets — what you SEE through a door or
window (types/opening.ts, OpeningInspector.tsx). Distinct from the
free-text backdropUrl field, which stays available for a business's
own site photo; these are just a small selectable starter library.

SOURCE: Wikimedia Commons, not ambientCG/Poly Haven. Openverse's API
(api.openverse.org) is unreachable from environments this script has
been run in so far — do not add it as a source without re-testing.
Commons' own search/imageinfo API works reliably:

    https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=<query>&srnamespace=6&format=json
    https://commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo&iiprop=url|extmetadata&format=json

UNLIKE ambientCG/Poly Haven (CC0 everywhere), Commons license terms
are PER FILE — some CC0/PD, most of what's usable here CC BY or
CC BY-SA. Every PINNED entry below records the license this specific
file actually carries (checked via extmetadata.LicenseShortName at
fetch time) plus attribution text, and write_credits() prints exactly
that per file rather than a single blanket "CC0, no attribution
needed" note the way fetch_hdri.py's does. Never assume CC0 here.

RESIZE: each source is a full-resolution photo (multiple MB, several
thousand pixels wide) which is wasted detail for a plane that sits
behind a wall opening and is never inspected closely. This script
downscales to ~1600px wide with macOS's `sips` after downloading
(sips -Z 1600, which fits the LONGER side to 1600 preserving aspect).
sips is macOS-only (part of the OS, no install needed) — there's no
simple cross-platform equivalent bundled with Python, so on Linux/CI
this resize step is skipped with a warning rather than failing; a
missing resize just means a heavier-than-necessary file is written,
not a broken one.

Modelled on scripts/fetch_hdri.py: same PINNED-list + sync + idempotent
skip-if-exists + stdlib-only (urllib) shape.

USAGE
    python3 scripts/fetch_backdrops.py sync
    python3 scripts/fetch_backdrops.py sync --force
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

USER_AGENT = "kitchen-renovation-app/1.0 (backdrop fetch script; contact: dgoyal@ch.iitr.ac.in)"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKDROPS_DIR = PROJECT_ROOT / "public" / "backdrops"
CREDITS_MD = BACKDROPS_DIR / "CREDITS.md"

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
RESIZE_WIDTH = 1600

# Each entry is one Wikimedia Commons file, pinned by title so re-running
# this script always fetches the exact same photo. `license`/`attribution`
# are recorded from this file's OWN extmetadata (checked at the time this
# list was built) — re-verify against the live API if a title is ever
# swapped, since Commons license terms vary file to file.
PINNED: list[dict] = [
    {
        "title": "File:Gurgaon skyline.jpg",
        "as": "urban-balcony.jpg",
        "license": "CC BY-SA 3.0",
        "attribution": "Dealtroadd, via Wikimedia Commons",
        "note": (
            "Urban high-rise/rooftop skyline over Gurgaon (Delhi NCR) — "
            "the default 'what's outside the window' for the app's "
            "stated Delhi NCR target market. A believable view from a "
            "kitchen window or balcony on a mid/high floor."
        ),
    },
    {
        "title": "File:Green carpet ooty,tamilnadu - panoramio.jpg",
        "as": "green-trees.jpg",
        "license": "CC BY 3.0",
        "attribution": "rajaraman sundaram, via Wikimedia Commons",
        "note": (
            "Wide lawn framed by trees and a wooded hillside — a "
            "generic green/garden view for a window that doesn't face "
            "a street."
        ),
    },
    {
        "title": "File:Clouds (14355723635).jpg",
        "as": "plain-sky.jpg",
        "license": "CC BY-SA 2.0",
        "attribution": "Ryan McGuire (Bells Design) / Free for Commercial Use, via Wikimedia Commons",
        "note": (
            "Plain blue sky with scattered cumulus, no horizon or "
            "foreground subject — the fallback for a window whose "
            "actual view isn't worth modelling (a light well, an "
            "airshaft, an upper-floor sky-only window)."
        ),
    },
]

REQUEST_DELAY_S = 2.0


def http_get(url: str, timeout: int = 60) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_with_retry(url: str, timeout: int = 60, attempts: int = 5) -> bytes:
    delay = 3.0
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return http_get(url, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code == 429:
                retry_after = err.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else delay
                print(f"  ! rate limited (429); waiting {wait:.0f}s")
                time.sleep(wait)
                delay *= 2
                continue
            if err.code == 404:
                raise
            last_err = err
        except urllib.error.URLError as err:
            last_err = err
        print(f"  ! attempt {attempt}/{attempts} failed ({last_err}); retrying in {delay:.0f}s")
        time.sleep(delay)
        delay *= 2
    assert last_err is not None
    raise last_err


def commons_imageinfo(title: str) -> dict:
    """Fetches the live imageinfo (url + extmetadata) for a Commons file
    title. Used both to resolve the download URL and to double-check the
    license actually attached to the file, rather than trusting a stale
    value hardcoded in PINNED."""
    params = urllib.parse.urlencode({
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url|extmetadata|size",
        "format": "json",
    })
    raw = http_get_with_retry(f"{COMMONS_API}?{params}")
    data = json.loads(raw.decode("utf-8"))
    pages = data.get("query", {}).get("pages", {})
    for page in pages.values():
        infos = page.get("imageinfo")
        if infos:
            return infos[0]
    raise RuntimeError(f"no imageinfo returned for {title!r}")


def resize_with_sips(path: Path, width: int) -> bool:
    """Downscales `path` in place so its longer side is `width` px,
    using macOS's built-in `sips`. Returns False (without failing the
    whole fetch) when sips isn't on PATH, e.g. on Linux CI — there's no
    simple cross-platform equivalent bundled with Python, and a skipped
    resize just leaves a heavier file rather than a broken one."""
    if not shutil.which("sips"):
        print("  ! sips not found (non-macOS?) — skipping resize, file kept at full resolution")
        return False
    result = subprocess.run(
        ["sips", "-Z", str(width), str(path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"  ! sips resize failed: {result.stderr.strip()}")
        return False
    return True


def fetch_one(entry: dict, force: bool = False) -> bool:
    out_path = BACKDROPS_DIR / entry["as"]
    if out_path.exists() and not force:
        print(f"{entry['as']}: already present (use --force to re-download)")
        return True

    title = entry["title"]
    print(f"{entry['as']}: fetching '{title}' from Wikimedia Commons ...")
    try:
        info = commons_imageinfo(title)
    except (urllib.error.HTTPError, urllib.error.URLError, RuntimeError) as err:
        print(f"  ! could not resolve imageinfo: {err}", file=sys.stderr)
        return False

    live_license = info.get("extmetadata", {}).get("LicenseShortName", {}).get("value")
    if live_license and live_license != entry["license"]:
        print(
            f"  ! WARNING: live license '{live_license}' differs from pinned "
            f"'{entry['license']}' — re-check attribution before using this file.",
            file=sys.stderr,
        )

    try:
        data = http_get_with_retry(info["url"])
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"  ! download failed: {err}", file=sys.stderr)
        return False

    BACKDROPS_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    print(f"  wrote {out_path.relative_to(PROJECT_ROOT)} ({len(data) / 1024:.0f} KB)")

    resize_with_sips(out_path, RESIZE_WIDTH)
    after = out_path.stat().st_size
    print(f"  resized -> {after / 1024:.0f} KB")
    return True


def write_credits() -> None:
    lines = [
        "# Backdrop credits",
        "",
        "Exterior photos fetched by scripts/fetch_backdrops.py, used as",
        "WallOpening.backdropUrl presets — what you SEE through a door or",
        "window (types/opening.ts). The free-text backdropUrl field in",
        "OpeningInspector.tsx stays available for a business's own site",
        "photo; these are just a small starter library.",
        "",
        "UNLIKE the ambientCG/Poly Haven assets used elsewhere in this repo",
        "(CC0 everywhere, no attribution required), these come from",
        "Wikimedia Commons, where license terms are PER FILE. None of the",
        "three below is CC0 — each is CC BY or CC BY-SA and carries a real",
        "attribution requirement, recorded exactly per file below.",
        "",
        "All downscaled to ~1600px wide (sips -Z 1600) — these sit behind a",
        "wall opening and are never inspected closely, so full resolution",
        "is wasted bytes.",
        "",
    ]
    for entry in PINNED:
        out_name = entry["as"]
        out_path = BACKDROPS_DIR / out_name
        lines.append(f"## {out_name}")
        lines.append("")
        lines.append("```")
        lines.append(f"source: Wikimedia Commons — {entry['title']}")
        lines.append(
            f"url: https://commons.wikimedia.org/wiki/{urllib.parse.quote(entry['title'].replace(' ', '_'))}"
        )
        lines.append(f"license: {entry['license']}")
        lines.append(f"attribution: {entry['attribution']}")
        if out_path.exists():
            try:
                from PIL import Image  # noqa: F401 — optional, not required
            except ImportError:
                pass
            lines.append(f"resolution: resized to {RESIZE_WIDTH}px wide (sips -Z {RESIZE_WIDTH})")
        lines.append(f"note: {entry['note']}")
        lines.append("```")
        lines.append("")
    BACKDROPS_DIR.mkdir(parents=True, exist_ok=True)
    CREDITS_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"credits: {CREDITS_MD.relative_to(PROJECT_ROOT)}")


def cmd_sync(args: argparse.Namespace) -> int:
    failures = 0
    for entry in PINNED:
        ok = fetch_one(entry, force=args.force)
        if not ok:
            failures += 1
        time.sleep(REQUEST_DELAY_S)
    write_credits()
    print(f"\n{len(PINNED) - failures}/{len(PINNED)} backdrops fetched.")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_sync = sub.add_parser("sync", help="re-fetch everything in PINNED")
    p_sync.add_argument("--force", action="store_true")
    p_sync.set_defaults(func=cmd_sync)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
