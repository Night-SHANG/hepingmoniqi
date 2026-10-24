"""The decoder must reject incomplete/misattributed or headless evidence."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

SPEC = importlib.util.spec_from_file_location("decode_log", Path(__file__).with_name("decode_log.py"))
DECODER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DECODER)


def fixture():
    # Parser validation fixture, not an asserted real screenshot.
    jpeg = b"\xff\xd8" + bytes(range(256)) * 6 + b"\xff\xd9"
    chunks = base64.b64encode(jpeg).decode()
    records, lines = [], []
    for name in ("city", "blast", "rubble"):
        record = {"name": name, "width": 960, "height": 600,
                  "jpeg_bytes": len(jpeg), "sha256": hashlib.sha256(jpeg).hexdigest(),
                  "frame_post_draw": True, "engine_frame": 10,
                  "stage": {"city": "city", "blast": "core", "rubble": "smoke_rubble"}[name],
                  "paused": name != "city", "blast_count": 0 if name == "city" else 1,
                  "effects": [] if name == "city" else [
                      {"age": 0.25 if name == "blast" else 1.8, "position": [49.0, 3.0, 41.5]}]}
        records.append(record)
        lines.extend(["NATIVE_VISUAL_CAPTURE " + json.dumps(record),
                      f"NATIVE_VISUAL_JPEG {name} 0/1 {chunks}",
                      "NATIVE_VISUAL_CAPTURE_END " + name])
    report = {"schema": "native-visual-input-qa/v2", "mode": "graphical", "pass": True,
              "gpu_frame_verified": True, "failures": [], "captures": records,
              "direct_gameplay_calls": False}
    lines.append("NATIVE_VISUAL_RESULT " + json.dumps(report))
    return "\n".join(lines), jpeg


def mutate_capture(text, name, mutate):
    """Mutate capture metadata and report together, without a mismatch shortcut."""
    lines = []
    for line in text.splitlines():
        if line.startswith("NATIVE_VISUAL_CAPTURE "):
            prefix, payload = line.split(" ", 1)
            row = json.loads(payload)
            if row["name"] == name:
                mutate(row)
            line = prefix + " " + json.dumps(row)
        elif line.startswith("NATIVE_VISUAL_RESULT "):
            prefix, payload = line.split(" ", 1)
            report = json.loads(payload)
            for row in report["captures"]:
                if row["name"] == name:
                    mutate(row)
            line = prefix + " " + json.dumps(report)
        lines.append(line)
    return "\n".join(lines)


class DecoderTests(unittest.TestCase):
    def test_complete_timestamped_log_roundtrips_exact_bytes(self):
        text, expected = fixture()
        text = "\n".join("2026-10-24T14:00:00Z " + line for line in text.splitlines())
        images, report = DECODER.parse_log(text)
        self.assertEqual(set(images), {"city", "blast", "rubble"})
        self.assertEqual(images["blast"], expected)
        self.assertTrue(report["gpu_frame_verified"])

    def test_incomplete_chunk_is_not_a_screenshot(self):
        text, _ = fixture()
        text = "\n".join(line for line in text.splitlines() if not line.startswith("NATIVE_VISUAL_JPEG blast"))
        with self.assertRaisesRegex(ValueError, "chunks"):
            DECODER.parse_log(text)

    def test_checksum_mismatch_rejected(self):
        text, _ = fixture()
        line = next(line for line in text.splitlines() if line.startswith("NATIVE_VISUAL_JPEG city"))
        prefix, encoded = line.rsplit(" ", 1)
        text = text.replace(line, prefix + " A" + encoded[1:], 1)
        with self.assertRaises(ValueError):
            DECODER.parse_log(text)

    def test_duplicate_chunk_rejected(self):
        text, _ = fixture()
        duplicate = next(line for line in text.splitlines() if line.startswith("NATIVE_VISUAL_JPEG city"))
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            DECODER.parse_log(duplicate + "\n" + text)

    def test_headless_preflight_not_graphical_success(self):
        text, _ = fixture()
        text = text.replace('"mode": "graphical"', '"mode": "headless_preflight"')
        with self.assertRaisesRegex(ValueError, "graphical"):
            DECODER.parse_log(text)

    def test_runtime_error_cannot_hide_behind_success_marker(self):
        text, _ = fixture()
        with self.assertRaisesRegex(ValueError, "runtime"):
            DECODER.parse_log(text + "\n2026-10-24T14:00:00Z SCRIPT ERROR: failed")

    def test_metadata_and_result_must_agree(self):
        text, _ = fixture()
        text = text.replace('"width": 960', '"width": 768', 1)
        with self.assertRaisesRegex(ValueError, "metadata"):
            DECODER.parse_log(text)

    def test_missing_end_marker_rejected(self):
        text, _ = fixture()
        text = text.replace("NATIVE_VISUAL_CAPTURE_END city", "")
        with self.assertRaisesRegex(ValueError, "end marker"):
            DECODER.parse_log(text)

    def test_multiple_results_are_ambiguous(self):
        text, _ = fixture()
        with self.assertRaisesRegex(ValueError, "result"):
            DECODER.parse_log(text + "\n" + text.splitlines()[-1])

    def test_missing_stage_evidence_rejected(self):
        text, _ = fixture()
        for field in ("stage", "effects", "paused", "blast_count"):
            with self.subTest(field=field):
                broken = mutate_capture(text, "blast", lambda row: row.pop(field))
                with self.assertRaisesRegex(ValueError, "stage"):
                    DECODER.parse_log(broken)

    def test_capture_age_must_match_named_stage(self):
        text, _ = fixture()
        for name, age in (("blast", 0.0), ("blast", 0.8), ("rubble", 0.3),
                          ("rubble", 5.5), ("blast", float("nan")),
                          ("rubble", float("inf"))):
            with self.subTest(name=name, age=age):
                broken = mutate_capture(text, name, lambda row: row["effects"][0].update(age=age))
                with self.assertRaisesRegex(ValueError, "stage"):
                    DECODER.parse_log(broken)

    def test_capture_must_be_frozen_at_actual_effect_stage(self):
        text, _ = fixture()
        for change in ({"paused": False}, {"effects": []}, {"blast_count": 2}, {"stage": "smoke_rubble"}):
            with self.subTest(change=change):
                broken = mutate_capture(text, "blast", lambda row: row.update(change))
                with self.assertRaisesRegex(ValueError, "stage"):
                    DECODER.parse_log(broken)

    def test_core_and_smoke_must_show_same_effect_origin(self):
        text, _ = fixture()
        broken = mutate_capture(text, "rubble", lambda row: row["effects"][0].update(position=[0, 0, 0]))
        with self.assertRaisesRegex(ValueError, "origin"):
            DECODER.parse_log(broken)


if __name__ == "__main__":
    unittest.main()
