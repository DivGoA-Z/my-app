#!/usr/bin/env python3
"""
scripts/fetch_models.py

Downloads CC0 .glb appliance models into public/models/<category>/ from
two sources:

  polyhaven  Poly Haven's Models API (api.polyhaven.com). Ships as a
             .gltf + external .bin + external textures, never a single
             .glb, so this always pipes the download through
             scripts/gltf_to_glb.mjs (Node) to pack one self-contained
             .glb — this project's README (public/models/README.md)
             specifically prefers .glb because a multi-file .gltf
             breaks the moment its relative texture paths move, which
             is exactly what happens when files land in public/models/.

  khronos    Raw file URLs under the KhronosGroup/glTF-Sample-Assets
             GitHub repo. Most of its model folders already ship a
             ready-made glTF-Binary/*.glb, used directly with no
             conversion.

Deliberately NOT Sketchfab — it requires a browser login/API key and
mostly gates downloads behind a UI, which fails the "no scraping
UI-heavy/login sites" constraint this pipeline was built under.

Standard library only for the network/orchestration half; shells out
to `node scripts/gltf_to_glb.mjs` for the one binary-packing step that
needs a JSON+binary transform (kept in JS since gltf_to_glb.mjs is
reused by hand too).

USAGE
    python3 scripts/fetch_models.py polyhaven-discover stove
    python3 scripts/fetch_models.py polyhaven electric_stove --as appliances/cooktop-induction --res 1k
    python3 scripts/fetch_models.py khronos CommercialRefrigerator --as appliances/fridge --variant glTF-Binary
    python3 scripts/fetch_models.py sync            # re-fetch everything in PINNED
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "kitchen-renovation-app/1.0 (model fetch script)"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = PROJECT_ROOT / "public" / "models"
SCRATCH_DIR = PROJECT_ROOT / ".model_fetch_scratch"  # cleaned up after each run
GLTF_TO_GLB = PROJECT_ROOT / "scripts" / "gltf_to_glb.mjs"
CREDITS_MD = MODELS_DIR / "CREDITS_SOURCED.md"

POLYHAVEN_ASSET_API = "https://api.polyhaven.com/assets"
POLYHAVEN_FILES_API = "https://api.polyhaven.com/files/{slug}"
KHRONOS_RAW = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/{model}/{variant}/{filename}"

# out_path (relative to public/models/) -> source spec. Each entry
# records enough to reproduce the file and to credit it correctly.
PINNED: list[dict] = [
    {
        "source": "polyhaven",
        "slug": "electric_stove",
        "res": "1k",
        "as": "appliances/cooktop-induction.glb",
        "note": "Poly Haven has no dedicated gas-hob/induction-cooktop asset; this flat-glass electric stove is the closest CC0 stand-in for the induction cooktop slot.",
    },
    {
        "source": "polyhaven",
        "slug": "vintage_microwave",
        "res": "1k",
        "as": "appliances/microwave.glb",
        "note": "",
    },
    # CommercialRefrigerator (Khronos glTF-Sample-Assets) was tried and
    # dropped: 208k triangles at ~9.7MB, far past "low-poly, mobile-safe"
    # for a single appliance. Not on the original shopping list either —
    # left out of PINNED rather than kept as a bad default.
    {
        "source": "polyhaven",
        "slug": "hanging_industrial_lamp",
        "res": "1k",
        "as": "lighting/pendant-industrial.glb",
        "note": "Organized for future use only — FixtureCatalogItem (types/fixture.ts) has no modelUrl field yet, so this isn't wired into the app.",
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


# ---- Poly Haven ----

def polyhaven_search(query: str, limit: int = 20) -> list[tuple[str, dict]]:
    raw = http_get(f"{POLYHAVEN_ASSET_API}?type=models")
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


def polyhaven_fetch(slug: str, res: str, out_rel: str, note: str, force: bool = False) -> bool:
    out_path = MODELS_DIR / out_rel
    if out_path.exists() and not force:
        print(f"{out_rel}: already present (use --force to re-download)")
        return True

    print(f"{out_rel}: fetching Poly Haven '{slug}' @ {res} ...")
    try:
        files_raw = http_get_with_retry(POLYHAVEN_FILES_API.format(slug=slug))
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"  ! could not fetch file manifest: {err}", file=sys.stderr)
        return False

    manifest = json.loads(files_raw.decode("utf-8"))
    res_entry = manifest.get("gltf", {}).get(res)
    gltf_entry = res_entry.get("gltf") if res_entry else None
    if not gltf_entry:
        available = list(manifest.get("gltf", {}).keys())
        print(f"  ! no gltf/{res} for '{slug}'. Available: {available}", file=sys.stderr)
        return False

    scratch = SCRATCH_DIR / slug
    scratch.mkdir(parents=True, exist_ok=True)

    def download_to(rel_name: str, url: str) -> Path:
        dest = scratch / rel_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(http_get_with_retry(url))
        return dest

    gltf_path = download_to(f"{slug}.gltf", gltf_entry["url"])
    for rel_name, entry in gltf_entry.get("include", {}).items():
        download_to(rel_name, entry["url"])

    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["node", str(GLTF_TO_GLB), str(gltf_path), str(out_path)],
        cwd=PROJECT_ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"  ! gltf_to_glb.mjs failed:\n{result.stderr}", file=sys.stderr)
        return False
    print(f"  {result.stdout.strip()}")

    write_source_note(out_path, {
        "source": "Poly Haven",
        "asset": slug,
        "url": f"https://polyhaven.com/a/{slug}",
        "license": "CC0 1.0 Universal (public domain)",
        "resolution": res,
        "note": note,
    })
    return True


# ---- Khronos glTF-Sample-Assets ----

def khronos_fetch(model: str, variant: str, filename: str, out_rel: str, note: str, force: bool = False) -> bool:
    out_path = MODELS_DIR / out_rel
    if out_path.exists() and not force:
        print(f"{out_rel}: already present (use --force to re-download)")
        return True

    url = KHRONOS_RAW.format(model=model, variant=variant, filename=filename)
    print(f"{out_rel}: fetching Khronos '{model}/{variant}/{filename}' ...")
    try:
        data = http_get_with_retry(url)
    except (urllib.error.HTTPError, urllib.error.URLError) as err:
        print(f"  ! download failed: {err}", file=sys.stderr)
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    print(f"  wrote {out_path.relative_to(PROJECT_ROOT)} ({len(data) / 1024:.0f} KB)")

    write_source_note(out_path, {
        "source": "KhronosGroup/glTF-Sample-Assets",
        "asset": model,
        "url": f"https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/{model}",
        "license": "CC0 1.0 Universal (public domain) — per-model license varies, check the model's own README; this one is CC0",
        "resolution": "as shipped",
        "note": note,
    })
    return True


def write_source_note(out_path: Path, meta: dict) -> None:
    note_path = out_path.with_suffix(out_path.suffix + ".SOURCE.txt")
    lines = [f"{k}: {v}" for k, v in meta.items() if v]
    note_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_credits() -> None:
    lines = [
        "# Sourced model credits",
        "",
        "Models fetched by scripts/fetch_models.py. All CC0 1.0 Universal",
        "(public domain). Distinct from CREDITS.md, which covers the",
        "original Kenney Furniture Kit models bundled before this script",
        "existed.",
        "",
    ]
    for entry in PINNED:
        out_rel = entry["as"]
        out_path = MODELS_DIR / out_rel
        note_path = out_path.with_suffix(out_path.suffix + ".SOURCE.txt")
        if note_path.exists():
            lines.append(f"## {out_rel}")
            lines.append("")
            lines.append("```")
            lines.append(note_path.read_text(encoding="utf-8").strip())
            lines.append("```")
            lines.append("")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CREDITS_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"credits: {CREDITS_MD.relative_to(PROJECT_ROOT)}")


def cleanup_scratch() -> None:
    if SCRATCH_DIR.exists():
        import shutil
        shutil.rmtree(SCRATCH_DIR)


def cmd_polyhaven_discover(args: argparse.Namespace) -> int:
    hits = polyhaven_search(args.query, args.limit)
    if not hits:
        print("No matches.")
        return 0
    print(f"\n{len(hits)} result(s) for '{args.query}':\n")
    for slug, asset in hits:
        print(f"  {slug:<28} {asset.get('category', ''):<40} https://polyhaven.com/a/{slug}")
    return 0


def cmd_polyhaven(args: argparse.Namespace) -> int:
    ok = polyhaven_fetch(args.slug, args.res, args.out, args.note or "", force=args.force)
    cleanup_scratch()
    write_credits()
    return 0 if ok else 1


def cmd_khronos(args: argparse.Namespace) -> int:
    ok = khronos_fetch(args.model, args.variant, args.filename, args.out, args.note or "", force=args.force)
    write_credits()
    return 0 if ok else 1


def cmd_sync(args: argparse.Namespace) -> int:
    failures = 0
    for entry in PINNED:
        if entry["source"] == "polyhaven":
            ok = polyhaven_fetch(entry["slug"], entry["res"], entry["as"], entry.get("note", ""), force=args.force)
        else:
            ok = khronos_fetch(entry["model"], entry["variant"], entry["filename"], entry["as"], entry.get("note", ""), force=args.force)
        if not ok:
            failures += 1
        time.sleep(REQUEST_DELAY_S)
    cleanup_scratch()
    write_credits()
    print(f"\n{len(PINNED) - failures}/{len(PINNED)} models fetched.")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_ph_discover = sub.add_parser("polyhaven-discover", help="search Poly Haven models")
    p_ph_discover.add_argument("query")
    p_ph_discover.add_argument("--limit", type=int, default=20)
    p_ph_discover.set_defaults(func=cmd_polyhaven_discover)

    p_ph = sub.add_parser("polyhaven", help="download+convert one Poly Haven model")
    p_ph.add_argument("slug")
    p_ph.add_argument("--as", dest="out", required=True, help="output path relative to public/models/, e.g. appliances/cooktop.glb")
    p_ph.add_argument("--res", default="1k", choices=["1k", "2k", "4k", "8k"])
    p_ph.add_argument("--note", default="")
    p_ph.add_argument("--force", action="store_true")
    p_ph.set_defaults(func=cmd_polyhaven)

    p_kh = sub.add_parser("khronos", help="download one Khronos sample-assets .glb as-is")
    p_kh.add_argument("model")
    p_kh.add_argument("--variant", default="glTF-Binary")
    p_kh.add_argument("--filename", required=True)
    p_kh.add_argument("--as", dest="out", required=True)
    p_kh.add_argument("--note", default="")
    p_kh.add_argument("--force", action="store_true")
    p_kh.set_defaults(func=cmd_khronos)

    p_sync = sub.add_parser("sync", help="re-fetch everything in PINNED")
    p_sync.add_argument("--force", action="store_true")
    p_sync.set_defaults(func=cmd_sync)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
