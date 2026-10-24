#!/usr/bin/env python3
"""Validate graphical evidence and reconstruct bounded JPEGs from a CI log.

No network access, external packages, or GitHub artifact storage is required.
Only logs from a successful graphical harness run are accepted.
"""
import argparse
import base64
import binascii
import hashlib
import json
from pathlib import Path
import re

NAMES = {"city", "blast", "rubble"}
MAX_JPEG_BYTES = 81920
CHUNK = re.compile(r"NATIVE_VISUAL_JPEG (city|blast|rubble) (\d+)/(\d+) ([A-Za-z0-9+/=]+)$")


def parse_log(text):
    """Return ({capture_name: exact_jpeg_bytes}, verified_report) or raise."""
    captures, chunks, totals, ended, reports = {}, {}, {}, set(), []
    if re.search(r"(?:^|\s)(?:SCRIPT ERROR|ERROR):", text):
        raise ValueError("Godot runtime error in log")
    for line in text.splitlines():
        if "NATIVE_VISUAL_CAPTURE " in line:
            record = json.loads(line.split("NATIVE_VISUAL_CAPTURE ", 1)[1])
            name = record.get("name")
            if name not in NAMES or name in captures:
                raise ValueError("Unexpected or duplicate capture metadata")
            if (record.get("frame_post_draw") is not True or
                    not 1000 < record.get("jpeg_bytes", 0) <= MAX_JPEG_BYTES or
                    not 0 < record.get("width", 0) <= 1280 or
                    not 0 < record.get("height", 0) <= 800):
                raise ValueError("Invalid capture metadata bounds")
            captures[name] = record
        elif "NATIVE_VISUAL_JPEG " in line:
            match = CHUNK.search(line.strip())
            if match is None:
                raise ValueError("Malformed JPEG chunk")
            name, index, total, encoded = match.groups()
            index, total = int(index), int(total)
            if not 0 <= index < total <= 28 or len(encoded) > 4096:
                raise ValueError("JPEG chunks exceed bounds")
            if name in totals and totals[name] != total:
                raise ValueError("Inconsistent chunk count")
            totals[name] = total
            bucket = chunks.setdefault(name, {})
            if index in bucket:
                raise ValueError("Duplicate JPEG chunk")
            bucket[index] = encoded
        elif "NATIVE_VISUAL_CAPTURE_END " in line:
            name = line.split("NATIVE_VISUAL_CAPTURE_END ", 1)[1].strip()
            if name not in NAMES or name in ended:
                raise ValueError("Invalid duplicate capture end marker")
            ended.add(name)
        elif "NATIVE_VISUAL_RESULT " in line:
            reports.append(json.loads(line.split("NATIVE_VISUAL_RESULT ", 1)[1]))
    if len(reports) != 1:
        raise ValueError("Expected exactly one final result")
    report = reports[0]
    if (report.get("schema") != "native-visual-input-qa/v1" or
            report.get("mode") != "graphical" or
            report.get("pass") is not True or
            report.get("gpu_frame_verified") is not True or
            report.get("failures") != [] or
            report.get("direct_gameplay_calls") is not False):
        raise ValueError("No successful real graphical run in result")
    if set(captures) != NAMES:
        raise ValueError("Missing required capture metadata")
    if ended != NAMES:
        raise ValueError("Missing capture end marker")
    listed = report.get("captures", [])
    if len(listed) != 3 or {row.get("name"): row for row in listed} != captures:
        raise ValueError("Capture metadata disagrees with final result")
    images = {}
    for name in sorted(NAMES):
        bucket = chunks.get(name, {})
        if set(bucket) != set(range(totals.get(name, 1))):
            raise ValueError(f"Missing JPEG chunks for {name}")
        try:
            jpeg = base64.b64decode("".join(bucket[i] for i in range(totals[name])), validate=True)
        except (binascii.Error, KeyError) as exc:
            raise ValueError(f"Invalid JPEG chunks for {name}") from exc
        record = captures[name]
        if (len(jpeg) != record["jpeg_bytes"] or len(jpeg) > MAX_JPEG_BYTES or
                hashlib.sha256(jpeg).hexdigest() != record["sha256"] or
                not jpeg.startswith(b"\xff\xd8") or not jpeg.endswith(b"\xff\xd9")):
            raise ValueError(f"JPEG byte length/checksum/signature mismatch for {name}")
        images[name] = jpeg
    return images, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    parser.add_argument("output", type=Path, help="local directory for verified captures and report")
    args = parser.parse_args()
    try:
        images, report = parse_log(args.log.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"VISUAL_LOG_INVALID: {exc}\n")
    args.output.mkdir(parents=True, exist_ok=True)
    for name, jpeg in images.items():
        (args.output / f"{name}.jpg").write_bytes(jpeg)
    (args.output / "visual-result.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("VISUAL_LOG_VERIFIED " + json.dumps({"captures": sorted(images), "output": str(args.output)}))


if __name__ == "__main__":
    main()
