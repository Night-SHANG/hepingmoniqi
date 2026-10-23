#!/usr/bin/env python3
"""Losslessly convert the archived CC0 MagicaVoxel models to bounded damage boxes.

Uses only Python's standard library. No downloaded converter is executed.
Run from any directory: python3 scripts/import-voxel-buildings.py [--check].
Box coordinates remain native X/Y/Z and preserve palette indexes. Runtime alone
performs world placement and converts native Z-up to world Y-up.
"""
from __future__ import annotations

import argparse
from collections import deque
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
MAX_BOX_AXIS = 8
SOURCE_URL = "https://opengameart.org/content/voxel-buildings"
LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/"


def chunks(data: bytes, start: int, end: int):
    while start < end:
        if end - start < 12:
            raise ValueError("truncated VOX chunk header")
        kind, length, child_length = struct.unpack_from("<4sII", data, start)
        content_start = start + 12
        content_end = content_start + length
        child_end = content_end + child_length
        if child_end > end:
            raise ValueError("truncated VOX chunk content or children")
        yield kind, data[content_start:content_end]
        yield from chunks(data, content_end, child_end)
        start = child_end


def read_vox(path: Path):
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"VOX " or struct.unpack_from("<I", data, 4)[0] not in (150, 200):
        raise ValueError(f"invalid VOX header: {path.name}")
    if data[8:12] != b"MAIN" or struct.unpack_from("<II", data, 12) != (0, len(data) - 20):
        raise ValueError(f"invalid or truncated MAIN chunk: {path.name}")
    canvas = None
    cells = None
    rgba = None
    for kind, content in chunks(data, 20, len(data)):
        if kind == b"SIZE":
            if canvas is not None or len(content) != 12:
                raise ValueError("invalid SIZE; this importer requires one native model per file")
            canvas = struct.unpack("<III", content)
            if any(n < 1 or n > 256 for n in canvas):
                raise ValueError("invalid native model dimensions")
        elif kind == b"XYZI":
            if cells is not None or len(content) < 4:
                raise ValueError("invalid XYZI; this importer requires one native model per file")
            count = struct.unpack_from("<I", content)[0]
            if not count or len(content) != 4 + count * 4:
                raise ValueError("invalid or truncated XYZI voxel data")
            cells = {}
            for x, y, z, color in struct.iter_unpack("4B", content[4:]):
                if (x, y, z) in cells:
                    raise ValueError("duplicate occupied native cell")
                if color == 0:
                    raise ValueError("invalid zero palette index in occupied cell")
                cells[x, y, z] = color
        elif kind == b"RGBA":
            if rgba is not None or len(content) != 1024:
                raise ValueError("invalid RGBA palette")
            rgba = list(struct.iter_unpack("4B", content))
    if canvas is None or cells is None or rgba is None:
        raise ValueError("invalid model: SIZE, XYZI and explicit RGBA palette are required")
    if any(any(p[i] >= canvas[i] for i in range(3)) for p in cells):
        raise ValueError("invalid cell outside declared native canvas")
    if any(rgba[color - 1][3] != 255 for color in set(cells.values())):
        raise ValueError("invalid transparent native color: opaque box format cannot preserve it")
    # Palette index 1 addresses RGBA record 0, per the MagicaVoxel format.
    palette = [0] + [(r << 16) | (g << 8) | b for r, g, b, _a in rgba[:255]]
    return data, list(canvas), cells, palette


def greedy_boxes(cells):
    remaining = dict(cells)
    boxes = []
    # Stable Z/Y/X traversal and X-then-Y-then-Z growth are part of the format.
    for x, y, z in sorted(cells, key=lambda p: (p[2], p[1], p[0])):
        color = remaining.get((x, y, z))
        if color is None:
            continue
        dx = dy = dz = 1
        while dx < MAX_BOX_AXIS and remaining.get((x + dx, y, z)) == color:
            dx += 1
        while dy < MAX_BOX_AXIS and all(remaining.get((xx, y + dy, z)) == color for xx in range(x, x + dx)):
            dy += 1
        while dz < MAX_BOX_AXIS and all(remaining.get((xx, yy, z + dz)) == color for yy in range(y, y + dy) for xx in range(x, x + dx)):
            dz += 1
        for zz in range(z, z + dz):
            for yy in range(y, y + dy):
                for xx in range(x, x + dx):
                    if remaining.pop((xx, yy, zz), None) != color:
                        raise ValueError("invalid greedy merge: overlap, added cell or changed color")
        boxes.append([x, y, z, dx, dy, dz, color])
    if remaining or sum(b[3] * b[4] * b[5] for b in boxes) != len(cells):
        raise ValueError("invalid greedy merge: missing native cells")
    return boxes


def floating_cells(cells):
    """Report authored floating details, without altering or filling them."""
    visited = {p for p in cells if p[2] == 0}
    queue = deque(visited)
    while queue:
        x, y, z = queue.popleft()
        for p in ((x - 1, y, z), (x + 1, y, z), (x, y - 1, z), (x, y + 1, z), (x, y, z - 1), (x, y, z + 1)):
            if p in cells and p not in visited:
                visited.add(p)
                queue.append(p)
    return len(cells) - len(visited)


def build_pack(source_dir):
    paths = sorted(source_dir.glob("*.vox"), key=lambda p: int(p.stem))
    if not paths:
        raise ValueError("invalid source directory: no native VOX models")
    models = []
    files = []
    for path in paths:
        data, canvas, cells, palette = read_vox(path)
        sha256 = hashlib.sha256(data).hexdigest()
        boxes = greedy_boxes(cells)
        model = {
            "id": int(path.stem), "sourceFile": f"assets/source-buildings/{path.name}",
            "sha256": sha256, "canvas": canvas,
            "bounds": {"min": [min(p[i] for p in cells) for i in range(3)], "max": [max(p[i] for p in cells) for i in range(3)]},
            "nativeVoxelCount": len(cells), "unanchoredNativeCellCount": floating_cells(cells),
            "palette": palette, "boxes": boxes,
        }
        models.append(model)
        files.append({"file": model["sourceFile"], "bytes": len(data), "sha256": sha256,
                      "occupiedCells": len(cells), "damageBoxes": len(boxes),
                      "unanchoredNativeCells": model["unanchoredNativeCellCount"]})
    pack = {"schemaVersion": 1, "coordinates": "native X/Y/Z, Z up; each box is [x,y,z,dx,dy,dz,paletteIndex]",
            "maxBoxAxis": MAX_BOX_AXIS, "models": models}
    manifest = {
        "name": "Voxel Buildings", "author": "mehrasaur (preview branding: Creators Sin)",
        "source": SOURCE_URL, "download": "https://opengameart.org/sites/default/files/Voxel%20Buildings.zip",
        "license": "CC0-1.0", "licenseSource": SOURCE_URL, "licenseUrl": LICENSE_URL,
        "attributionRequired": False,
        "originalArchiveSha256": "db516b8a32c1830b5c6ddcb3abb95405ae91c8a820825b61424612310764cb1d",
        "verifiedOn": "2026-10-23", "sourceBytes": sum(f["bytes"] for f in files),
        "transformation": "Lossless palette-uniform greedy boxes; deterministic Z/Y/X traversal; X/Y/Z growth capped at 8 native cells on every axis. No filled gaps, removed cells, recoloring, hulls, hand-built replacement buildings or occupancy approximation.",
        "runtime": "Native Z becomes world Y; default scale 0.5 world units per native cell (neighborhood model 6: 0.3; model 7: 0.4). Actual box sizes drive rendering, collision, damage and support. Box weight is native occupied-cell count (dx*dy*dz), not number of merged boxes. Source base bottom is world Y=-0.5.",
        "limitations": "Original assets are decorative buildings with mostly solid interiors, not walkable room meshes. Models 8–11 contain authored floating details; no gaps are filled. Only fully grounded models 1–7, 12 and 13 are placed in the maps. All thirteen unmodified source VOX files and lossless conversions are preserved.",
        "files": files,
    }
    return pack, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "assets/source-buildings")
    parser.add_argument("--output", type=Path, default=ROOT / "src/generated/voxel-buildings.json")
    parser.add_argument("--manifest", type=Path, default=ROOT / "public/licenses/voxel-buildings/source-manifest.json")
    parser.add_argument("--check", action="store_true", help="Verify committed files without changing them")
    args = parser.parse_args()
    pack, manifest = build_pack(args.source_dir)
    for path, value, compact in ((args.output, pack, True), (args.manifest, manifest, False)):
        text = json.dumps(value, separators=(",", ":") if compact else None, indent=None if compact else 2, ensure_ascii=False) + "\n"
        if args.check:
            if not path.exists() or path.read_text() != text:
                raise ValueError(f"generated artifact is stale: {path}; rerun importer")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    print(f"{'Verified' if args.check else 'Converted'} {len(pack['models'])} models; "
          f"{sum(m['nativeVoxelCount'] for m in pack['models'])} native cells -> "
          f"{sum(len(m['boxes']) for m in pack['models'])} exact damage boxes.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, struct.error) as error:
        print(f"VOX import failed: {error}", file=sys.stderr)
        sys.exit(1)
