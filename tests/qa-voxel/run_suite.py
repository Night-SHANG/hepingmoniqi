#!/usr/bin/env python3
"""Serial, bounded native terrain QA; no downloads, external writes, or GPU claims."""
from __future__ import annotations
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent.parent
DIAGNOSTICS = re.compile(r"SCRIPT ERROR|ERROR:|WARNING:|Aborted|Segmentation fault")


def run(binary: str, label: str, script: str, flags: list[str], expected_pass=True):
    report = HERE / f"{label}.json"
    log = HERE / f"{label}.log"
    cmd = [binary, "--headless", "--path", str(PROJECT), "--script", script,
           "--", f"--report={report}", *flags]
    process = subprocess.run(cmd, cwd=PROJECT, text=True, capture_output=True, timeout=35)
    output = process.stdout + process.stderr
    log.write_text(output)
    if process.returncode != (0 if expected_pass else 1):
        raise AssertionError(f"{label}: unexpected exit {process.returncode}; see {log}")
    if DIAGNOSTICS.search(output):
        raise AssertionError(f"{label}: unexpected engine diagnostics; see {log}")
    if not report.exists():
        raise AssertionError(f"{label}: no result was written")
    data = json.loads(report.read_text())
    assert data["pass"] is expected_pass, (label, data.get("failures"))
    assert data["display_server"] == "headless"
    assert data["gpu_frame_verified"] is False
    print(f"{'PASS' if expected_pass else 'EXPECTED FAIL'} {label}: {len(data.get('checks', []))} checks")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--godot", default="/workspace/shared/godot-4.7.1/godot")
    parser.add_argument("--repeat", type=int, default=3)
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be at least 1")
    run(args.godot, "native-api", "tests/qa-voxel/inspect_native_api.gd", [])
    runs = []
    for size in (16, 32):
        for i in range(1, args.repeat + 1):
            label = f"terrain-{size}-{i}"
            data = run(args.godot, label, "tests/qa-voxel/test_native_terrain.gd", [f"--mesh-size={size}"])
            assert data["backend"] == "JoltPhysicsDirectSpaceState3D"
            assert not data["failures"]
            assert len(data["checks"]) == 57
            assert data["render_frames_drawn"] == 0
            stale = []
            for phase, samples in data["readiness_observations"].items():
                if phase == "initial":
                    continue
                first = samples[0]
                if first["area_meshed"] and not first["ray_set_matches_expected"]:
                    stale.append(phase)
                assert samples[-1]["ray_set_matches_expected"], (label, phase)
                assert samples[-1]["area_meshed"], (label, phase)
            runs.append({"label": label, "mesh_size": size, "timing": data["timing"],
                         "immediate_mesh_ready_but_stale_collision": stale})
    skipped = run(args.godot, "negative-skip-edit", "tests/qa-voxel/test_native_terrain.gd",
                  ["--skip-edit", "--edit-timeout=0.25"], expected_pass=False)
    for expected in ["single_cell_real_collider_hole", "hole_rays_clear_after_native_remesh", "full_grid_exact_removed_4"]:
        assert expected in skipped["failures"], (expected, skipped["failures"])
    rgb = run(args.godot, "negative-transparent-rgb", "tests/qa-voxel/test_native_terrain.gd",
              ["--transparent-rgb-air", "--edit-timeout=0.25"], expected_pass=False)
    for expected in ["full_grid_exact_removed_1", "full_grid_exact_removed_4",
                     "raw_air_is_exact_zero_(-17, -1, -1)", "voxel_ray_agrees_with_hole_(-17, -1, -1)"]:
        assert expected in rgb["failures"], (expected, rgb["failures"])
    adapter_runs = []
    for i in range(1, args.repeat + 1):
        label = f"game-adapters-{i}"
        data = run(args.godot, label, "tests/qa-voxel/test_game_adapters.gd", [])
        assert len(data["checks"]) == 47
        assert data["backend"] == "JoltPhysicsDirectSpaceState3D"
        assert data["voxel_generate_collisions"] is False
        adapter_runs.append({"label": label, "checks": len(data["checks"]), "pass": data["pass"]})
    projectile_runs = []
    for i in range(1, args.repeat + 1):
        label = f"projectile-hole-{i}"
        data = run(args.godot, label, "tests/qa-voxel/test_projectile_hole.gd", [])
        assert len(data["checks"]) == 10
        assert data["real_physics_ticks"] >= 120
        assert data["remaining_owned_static_bodies"] == 0
        projectile_runs.append({"label": label, "checks": 10, "real_physics_ticks": data["real_physics_ticks"]})
    solid = run(args.godot, "negative-projectile-solid", "tests/qa-voxel/test_projectile_hole.gd",
                ["--keep-hole-cell"], expected_pass=False)
    assert set(solid["failures"]) == {"hole_sync_before_next_tick", "removed_cell_projectile_falls_below_floor", "removed_cell_projectile_has_no_contact"}
    summary = {"schema": "voxel-native-qa-suite/v1", "pass": True, "positive_runs": runs,
               "positive_check_count": 57 * len(runs), "adapter_runs": adapter_runs,
               "adapter_check_count": 47 * len(adapter_runs), "projectile_runs": projectile_runs, "projectile_check_count": 10 * len(projectile_runs), "negative_controls": [
                   {"label": "skip-edit", "expected_failure_count": len(skipped["failures"])},
                   {"label": "transparent-rgb", "expected_failure_count": len(rgb["failures"])},
                   {"label": "projectile-solid", "expected_failure_count": len(solid["failures"])}],
               "gpu_frame_verified": False,
               "scope": "Tiny static terrain integration, exact edits, real Jolt ray queries; not gameplay or city performance"}
    (HERE / "suite-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(f"PASS voxel suite: {len(runs)} terrain, {len(adapter_runs)} adapter, {len(projectile_runs)} projectile processes; three rejected negative controls")


if __name__ == "__main__":
    main()
