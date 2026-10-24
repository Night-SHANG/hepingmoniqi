# Native graphical/input QA

This harness loads `scenes/native_slice.tscn`, not a fake scene. It never calls a
session mutation or production control method directly: world picking, GUI
placement/pause/reset/fire, and keyboard detonation/resume all enter through
`Input.parse_input_event`. State inspection uses the actual session's read-only
snapshots and render views. The viewport is normalized to 1280 × 800.

## Graphical CI run

Run on the approved Ubuntu Xvfb/Mesa runner, using the pinned Godot build and
already-installed Voxel Tools extension. Example from the project root:

```sh
set -o pipefail
LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s '-screen 0 1280x800x24' \
  timeout 180s "$GODOT" --path . --rendering-method gl_compatibility \
  --audio-driver Dummy --script tests/qa-visual/run.gd \
  2>&1 | tee visual.log
python3 tests/qa-visual/decode_log.py visual.log verified-visual
```

Use an external process timeout as well as the harness's 150-second wall guard.
The guard can interrupt yielding work but not a stuck native call. Startup/reset
have independent 45-second readiness deadlines. No screenshots are written or
uploaded by the harness, and no GitHub Actions artifacts are required.

The decoder exits nonzero unless the run is explicitly graphical, all checks
passed, all three captures are complete and match the final report, checksums
match, and no Godot runtime error appears anywhere in the log. `gpu_frame_verified`
means real renderer frame readback, including software Mesa. It does not claim
physical-GPU performance, manual visual approval, or Windows interaction QA.

## Verified sequence

1. Load the actual city and wait for native meshing/session readiness.
2. Capture the city after `RenderingServer.frame_post_draw`.
3. Project a known visible real city surface into pointer coordinates, click it,
   and verify the production ray pick and selection marker.
4. Click the placement button. Verify one charge and no silent fuse/damage.
5. Click Pause. Verify the simulation clock and charge remain fixed and keyboard
   detonation is ignored. Press P to resume and verify the clock advances.
6. Press Space. Verify one real blast, damage/research, and rendered fire/dust.
7. Capture blast and subsequent moving native rubble after rendered frames.
8. Pause, click Reset, and verify replacement of the old session, no stale
   selection/effects/rubble, restored collision ownership, and automatic unpause.
9. Pick again and click Fire. Verify an actual native rigid body and visible
   projectile state before contact, movement, no immediate blast, then a contact-
   triggered blast without any manual detonation input.
10. Remove the scene normally and verify collision owners release all resources.

## Headless preflight is not graphical evidence

```sh
"$GODOT" --headless --path . --script tests/qa-visual/run.gd -- \
  --preflight --report=res://tests/qa-visual/preflight.json
python3 -m unittest discover -s tests/qa-visual -p 'test_*.py'
```

A headless run without `--preflight` fails explicitly. Preflight skips image
readback and emits `gpu_frame_verified: false`, even when every input/lifecycle
check passes. The graphical log decoder intentionally rejects it.

## Log format and bounded screenshots

- `NATIVE_VISUAL_CHECK`: one JSON record per assertion.
- `NATIVE_VISUAL_STATE`: real read-only state at named phases.
- `NATIVE_VISUAL_CAPTURE`: name, dimensions, byte length, SHA-256, rendered-frame
  evidence, simulation time, and world-image nonblank statistics.
- `NATIVE_VISUAL_JPEG name zero_based_index/total BASE64`: chunks of at most 4096
  characters. Each JPEG is capped at 80 KiB, normally 960 × 600, falling back to
  768 × 480. Three captures total at most 240 KiB JPEG/320 KiB base64.
- `NATIVE_VISUAL_CAPTURE_END name`: a completeness marker.
- `NATIVE_VISUAL_RESULT`: one final machine-readable report, including checks,
  state snapshots, capture metadata, and honest graphical/headless mode.

`decode_log.py` accepts raw or timestamp-prefixed CI logs, reconstructs the three
JPEG files to a local output directory, and writes `visual-result.json`. It has
no network or third-party Python dependencies. Review the decoded images as well
as the machine checks before describing visual quality as verified.
