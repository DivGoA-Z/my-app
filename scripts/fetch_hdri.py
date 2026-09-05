#!/usr/bin/env python3
"""
scripts/fetch_hdri.py

Downloads CC0 indoor HDRI environment maps into public/hdri/ from Poly
Haven's HDRIs API (api.polyhaven.com), for use as a real IBL lighting
source in Room3DCanvas.tsx.

Pinned at 1k resolution deliberately, not higher — this app targets
budget Android devices on mobile data in Delhi NCR, and a 1k .hdr is
already ~1.6MB; 2k/4k would multiply that for detail that mostly
doesn't matter for soft ambient lighting.

Modelled closely on scripts/fetch_models.py: same PINNED-list +
write_source_note()/.SOURCE.txt + write_credits() + sync pattern, same
retry-with-backoff HTTP helpers, stdlib (urllib) only, no third-party
deps.

USAGE
    python3 scripts/fetch_hdri.py discover studio     # search Poly Haven HDRIs
    python3 scripts/fetch_hdri.py fetch studio_small_09 --as studio-small-09.hdr
    python3 scripts/fetch_hdri.py sync                # re-fetch everything in PINNED
    python3 scripts/fetch_hdri.py sync --force        # re-download even if present
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "kitchen-renovation-app/1.0 (hdri fetch script)"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
HDRI_DIR = PROJECT_ROOT / "public" / "hdri"
CREDITS_MD = HDRI_DIR / "CREDITS.md"

POLYHAVEN_ASSET_API = "https://api.polyhaven.com/assets"
POLYHAVEN_FILES_API = "https://api.polyhaven.com/files/{slug}"

# out_name (relative to public/hdri/) -> source spec. Each entry
# records enough to reproduce the file and to credit it correctly.
PINNED: list[dict] = [
    {
        "slug": "studio_small_09",
        "res": "1k",
        "as": "studio-small-09.hdr",
        "note": (
            "Small indoor studio HDRI — soft, directionally-varied "
            "light for IBL on glossy/metal finishes (chrome, polished "
            "quartz) that flat Lightformer panels can't reproduce. "
            "Chosen over lebombo/small_empty_room_1 as the best-lit "
            "indoor match for a kitchen countertop scene."
        ),
    },
]

REQUEST_DELAY_S = 1.0


def http_get(url: str, timeout: int = 120) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_get_with_retry(url: str, timeout: int = 120, attempts: int = 4) -> bytes:
    delay = 2.0
    last_err: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return http_get(url, timeout=timeout)
        except urllib.error.HTTPError as err:
            if err.code in (403, 404):
                raise
            last_err = err
        except urllib.error.URLError as err:
            last_err = err
        print(f"  ! attempt {attempt}/{attempts} failed ({last_err}); retrying in {delay:.0f}s")
        time.sleep(delay)
        delay *= 2
    assert last_err is not None
    raise last_err


def polyhaven_search(query: str, limit: int = 20) -> list[tuple[str, dict]]:
    raw = http_get(f"{POLYHAVEN_ASSET_API}?type=hdris")
    all_assets: dict = json.loads(raw.decode("utf-8"))
    query_lower = query.lower()
    hits = []
    for slug, asset in all_assets.items():
        haystack = " ".join(
            [slug, asset.get("name", ""), asset.get("category", ""), " ".join(asset.get("tags", []))]
        ).lower()
        if query_lower in haystack:
            hits.append((slug, asset))
    return hits[:limit]


def polyhaven_fetch(slug: str, res: str, out_name: str, note: str, force: bool = False) -> bool:
    out_path = HDRI_DIR / out_name
    if out_path.exists() and not force:
        print(f"{out_name}: already present (use --force to re-download)")
        return True

    print(f"{out_name}: fetching Poly Haven HDRI '{slug}' @ {res} ...")
    try:
        files_raw = http_get_with_retry(POLYHAVEN_FILES_API.format(slug=slug))
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"  ! could not fetch file manifest: {err}", file=sys.stderr)
        return False

    manifest = json.loads(files_raw.decode("utf-8"))
    res_entry = manifest.get("hdri", {}).get(res)
    hdr_entry = res_entry.get("hdr") if res_entry else None
    if not hdr_entry:
        available = list(manifest.get("hdri", {}).keys())
        print(f"  ! no hdri/{res}/hdr for '{slug}'. Available resolutions: {available}", file=sys.stderr)
        return False

    try:
        data = http_get_with_retry(hdr_entry["url"])
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"  ! download failed: {err}", file=sys.stderr)
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    print(f"  wrote {out_path.relative_to(PROJECT_ROOT)} ({len(data) / 1024:.0f} KB)")

    write_source_note(out_path, {
        "source": "Poly Haven",
        "asset": slug,
        "url": f"https://polyhaven.com/a/{slug}",
        "license": "CC0 1.0 Universal (public domain)",
        "resolution": res,
        "note": note,
    })
    return True


def write_source_note(out_path: Path, meta: dict) -> None:
    note_path = out_path.with_suffix(out_path.suffix + ".SOURCE.txt")
    lines = [f"{k}: {v}" for k, v in meta.items() if v]
    note_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_credits() -> None:
    lines = [
        "# HDRI credits",
        "",
        "Environment maps fetched by scripts/fetch_hdri.py. All CC0 1.0",
        "Universal (public domain), sourced from Poly Haven at 1k",
        "resolution (kept small deliberately — this app targets budget",
        "Android devices on mobile data).",
        "",
    ]
    for entry in PINNED:
        out_name = entry["as"]
        out_path = HDRI_DIR / out_name
        note_path = out_path.with_suffix(out_path.suffix + ".SOURCE.txt")
        if note_path.exists():
            lines.append(f"## {out_name}")
            lines.append("")
            lines.append("```")
            lines.append(note_path.read_text(encoding="utf-8").strip())
            lines.append("```")
            lines.append("")
    HDRI_DIR.mkdir(parents=True, exist_ok=True)
    CREDITS_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"credits: {CREDITS_MD.relative_to(PROJECT_ROOT)}")


def cmd_discover(args: argparse.Namespace) -> int:
    hits = polyhaven_search(args.query, args.limit)
    if not hits:
        print("No matches.")
        return 0
    print(f"\n{len(hits)} result(s) for '{args.query}':\n")
    for slug, asset in hits:
        print(f"  {slug:<28} {asset.get('category', ''):<30} https://polyhaven.com/a/{slug}")
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    ok = polyhaven_fetch(args.slug, args.res, args.out, args.note or "", force=args.force)
    write_credits()
    return 0 if ok else 1


def cmd_sync(args: argparse.Namespace) -> int:
    failures = 0
    for entry in PINNED:
        ok = polyhaven_fetch(entry["slug"], entry["res"], entry["as"], entry.get("note", ""), force=args.force)
        if not ok:
            failures += 1
        time.sleep(REQUEST_DELAY_S)
    write_credits()
    print(f"\n{len(PINNED) - failures}/{len(PINNED)} HDRIs fetched.")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_discover = sub.add_parser("discover", help="search Poly Haven HDRIs")
    p_discover.add_argument("query")
    p_discover.add_argument("--limit", type=int, default=20)
    p_discover.set_defaults(func=cmd_discover)

    p_fetch = sub.add_parser("fetch", help="download one Poly Haven HDRI")
    p_fetch.add_argument("slug")
    p_fetch.add_argument("--as", dest="out", required=True, help="output filename relative to public/hdri/, e.g. studio-small-09.hdr")
    p_fetch.add_argument("--res", default="1k", choices=["1k", "2k", "4k", "8k"])
    p_fetch.add_argument("--note", default="")
    p_fetch.add_argument("--force", action="store_true")
    p_fetch.set_defaults(func=cmd_fetch)

    p_sync = sub.add_parser("sync", help="re-fetch everything in PINNED")
    p_sync.add_argument("--force", action="store_true")
    p_sync.set_defaults(func=cmd_sync)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
