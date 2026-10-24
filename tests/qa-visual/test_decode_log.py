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
                  "frame_post_draw": True, "engine_frame": 10}
        records.append(record)
        lines.extend(["NATIVE_VISUAL_CAPTURE " + json.dumps(record),
                      f"NATIVE_VISUAL_JPEG {name} 0/1 {chunks}",
                      "NATIVE_VISUAL_CAPTURE_END " + name])
    report = {"schema": "native-visual-input-qa/v1", "mode": "graphical", "pass": True,
              "gpu_frame_verified": True, "failures": [], "captures": records,
              "direct_gameplay_calls": False}
    lines.append("NATIVE_VISUAL_RESULT " + json.dumps(report))
    return "\n".join(lines), jpeg


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


if __name__ == "__main__":
    unittest.main()
