#!/usr/bin/env python3
"""Deterministically prepack pristine RGB cells into immutable 16^3 color blocks.

The output is rendering input only, never HP, fracture, save, or physics authority.
Run without --check to rebuild; --check fails if the checked-in artifacts differ.
Runtime must bind this artifact to a separately validated source-cell manifest.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct

BLOCK_SIZE = 16
BLOCK_BYTES = BLOCK_SIZE ** 3 * 4
RECORD_BYTES = 12 + BLOCK_BYTES
BOUNDS_KEYS = ("minX", "minY", "minZ", "maxX", "maxY", "maxZ")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def integer(value: object) -> bool:
    return type(value) is int


def build(directory: Path) -> tuple[bytes, bytes]:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    require(manifest.get("schema") == "godot-city-fixture/v1", "Unknown source schema")
    require(manifest.get("recordBytes") == 35 and manifest.get("littleEndian") is True,
            "Expected 35-byte little-endian cell records")
    count = manifest.get("cellCount")
    require(integer(count) and count > 0, "Expected positive integer cell count")
    cells = (directory / "city-cells.bin").read_bytes()
    sources = [entry for entry in manifest.get("files", []) if entry.get("name") == "city-cells.bin"]
    require(len(sources) == 1, "Expected exactly one source cell descriptor")
    source = sources[0]
    require(len(cells) == count * 35 == source.get("bytes"), "Source length does not match manifest")
    digest = hashlib.sha256(cells).hexdigest()
    require(digest == source.get("sha256"), "Source SHA-256 does not match manifest")
    bounds = manifest.get("bounds")
    require(isinstance(bounds, dict), "Expected source bounds")
    require(all(integer(bounds.get(key)) and -32768 <= bounds[key] <= 32767 for key in BOUNDS_KEYS),
            "Expected finite signed16 integer bounds")
    require(all(bounds[f"min{axis}"] <= bounds[f"max{axis}"] for axis in "XYZ"), "Inverted source bounds")
    blocks: dict[tuple[int, int, int], bytearray] = {}
    actual_min = [32767] * 3
    actual_max = [-32768] * 3
    for offset in range(0, len(cells), 35):
        position = struct.unpack_from("<hhh", cells, offset + 4)
        for axis, component in enumerate(position):
            actual_min[axis] = min(actual_min[axis], component)
            actual_max[axis] = max(actual_max[axis], component)
        block_position = tuple(component // BLOCK_SIZE for component in position)
        block = blocks.setdefault(block_position, None)
        if block is None:
            block = blocks[block_position] = bytearray(BLOCK_BYTES)
        x, y, z = (component % BLOCK_SIZE for component in position)
        destination = 4 * (y + BLOCK_SIZE * (x + BLOCK_SIZE * z))
        require(struct.unpack_from("<I", block, destination)[0] == 0,
                f"Duplicate occupied coordinate: {position}")
        rgb = struct.unpack_from("<I", cells, offset + 30)[0]
        require(rgb <= 0xFFFFFF, f"Source color must be RGB24: {position}")
        struct.pack_into("<I", block, destination, (rgb << 8) | 0xFF)
    require(all(actual_min[i] == bounds[f"min{axis}"] and actual_max[i] == bounds[f"max{axis}"]
                for i, axis in enumerate("XYZ")), "Actual coordinate extrema do not match source bounds")
    payload = b"".join(struct.pack("<iii", *position) + blocks[position] for position in sorted(blocks))
    metadata = {
        "schema": "godot-city-voxel-blocks/v1",
        "block_size": BLOCK_SIZE,
        "block_record_bytes": RECORD_BYTES,
        "color_depth_bits": 32,
        "color_channel": "CHANNEL_COLOR",
        "color_encoding": "rgba8-u32-le",
        "cell_order": "y-x-z",
        "cell_count": count,
        "block_count": len(blocks),
        "bounds": {key: bounds[key] for key in BOUNDS_KEYS},
        "source": {"name": "city-cells.bin", "bytes": len(cells), "sha256": digest},
        "payload": {"name": "city-voxel-blocks.bin", "bytes": len(payload),
                    "sha256": hashlib.sha256(payload).hexdigest()},
    }
    return payload, (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    parser.add_argument("--check", action="store_true", help="Verify output bytes without writing")
    args = parser.parse_args()
    try:
        payload, metadata = build(args.directory)
        outputs = (("city-voxel-blocks.bin", payload), ("city-voxel-blocks.json", metadata))
        if args.check:
            for name, expected in outputs:
                target = args.directory / name
                require(target.is_file() and target.read_bytes() == expected, f"Stale or missing output: {name}")
        else:
            # Validation completes before any writes. A partial process failure is
            # detected by the runtime payload hash, never silently consumed.
            for name, content in outputs:
                target = args.directory / name
                temporary = target.with_name(f".{name}.{os.getpid()}.tmp")
                try:
                    temporary.write_bytes(content)
                    os.replace(temporary, target)
                finally:
                    if temporary.exists():
                        temporary.unlink()
        print(f"PREBUILT_VOXEL_BLOCKS_{'CHECKED' if args.check else 'WRITTEN'} bytes={len(payload)} sha256={hashlib.sha256(payload).hexdigest()}")
        return 0
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"PREBUILT_VOXEL_BLOCKS_REJECTED: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
