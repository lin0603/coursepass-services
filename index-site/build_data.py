#!/usr/bin/env python3
"""Build index data for the unpacked-publisher directory site.

Walks every unpacked archive under ``--root`` (default the Seagate drive) and
writes ``data/manifest.json`` plus one ``data/<slug>.json`` per archive.  The
per-archive files are flat ``[path, size]`` lists so the browser can rebuild
the tree and keep payloads compact.
"""

import argparse
import json
import os
from collections import Counter
from pathlib import Path

DEFAULT_ROOT = Path("/Volumes/Seagate Drive/coursepass-115-publisher")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def human(num):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num < 1024:
            return f"{num:.1f}{unit}"
        num /= 1024
    return f"{num:.1f}PB"


def slugify(name):
    keep = []
    for char in name:
        if char.isalnum() or char in "-_.()":
            keep.append(char.lower())
        else:
            keep.append("_")
    return "".join(keep)


def scan(archive: Path):
    files = []
    ext = Counter()
    total = 0
    for dirpath, _dirnames, filenames in os.walk(archive):
        for filename in filenames:
            full = Path(dirpath) / filename
            try:
                size = full.stat().st_size
            except OSError:
                size = 0
            rel = str(full.relative_to(archive))
            files.append([rel, size])
            total += size
            ext[("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else "(無)"] += 1
    files.sort()
    return files, total, ext


def main():
    opts = parse_args()
    data_dir = opts.out / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    for kind in ("iso", "zip"):
        base = opts.root / kind
        if not base.exists():
            continue
        for name in sorted(os.listdir(base)):
            archive = base / name
            if not archive.is_dir():
                continue
            files, total, ext = scan(archive)
            slug = f"{kind}-{slugify(name)}"
            payload = {
                "name": name,
                "kind": kind,
                "fileCount": len(files),
                "totalSize": total,
                "extensions": ext.most_common(),
                "files": files,
            }
            (data_dir / f"{slug}.json").write_text(
                json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
            manifest.append({
                "slug": slug,
                "name": name,
                "kind": kind,
                "fileCount": len(files),
                "totalSize": total,
                "extensions": ext.most_common(8),
            })
            print(f"{kind}/{name}: {len(files):,} files, {human(total)}")

    manifest.sort(key=lambda item: (item["kind"], item["name"]))
    (data_dir / "manifest.json").write_text(
        json.dumps({"generatedFrom": str(opts.root), "archives": manifest},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    total_files = sum(item["fileCount"] for item in manifest)
    total_size = sum(item["totalSize"] for item in manifest)
    print(f"\n{len(manifest)} archives, {total_files:,} files, {human(total_size)}")


if __name__ == "__main__":
    main()
