# Native startup investigation, 2026-10-24

Scope: same city, 454,913 source cells / 36 buildings; no change to destruction,
physics, effect, tool, or research semantics. The user's native explosion is
responsive, but initial terrain preparation was reported as 8–9 seconds.

## First measurements (local official 4.7.1 headless, not user GPU)

Actual session entry to meshed-ready: 1040.870 ms. Engine clock at ready:
1198.144 ms. Stages: read/verify/decode 128.625; regional model 280.971;
voxel preparation 418.550; collider box preparation 24.943; Jolt installation
79.798; terrain/viewer attach 0.294; meshing wait 107.689 ms.

Independent generator-only three runs: total 401.241 / 394.841 / 386.316 ms,
of which two full source-cell scans/packing cost 340.922 / 335.384 / 326.590 ms.
These cannot explain or reproduce the full reported 8–9 seconds by themselves.

The six-part launcher also rewrites a 48,540,573-byte archive and expands
147,460,328 bytes across 54 files on every run before process start. This is
separate from waiting after the game window appears, and separate from R reset.

## Bounded changes under evaluation

- Build immutable 16³ source-color blocks ahead of time; verify source/version,
  bounds and payload hashes at runtime. Do not bake mutable destruction state.
- Reuse a launcher cache only after authenticating the archive and every cached
  member; never trust an unauthenticated local cache manifest. Corrupt/partial
  caches must not start; preserve existing files and rebuild in a new directory.
- Record actual session phases, engine-clock ready, first post-ready renderer
  frame, and distinct generations on reset. Frame timing includes submission;
  it does not separately prove GPU completion or shader compilation time.

Acceptance requires identical occupancy/color/collision and fresh reset state,
real Windows CMD cache behavior, and actual Linux graphical entry/reset. A
0.33-second packing improvement alone is not a claim that 8-second loading is
fixed on the user's machine. Main and the previous game build remain intact.

## First real runner results and order caveat

Run 40111967962: both native jobs passed. Windows headless session CPU was
1389.957 ms baseline versus 808.580 ms prebuilt; renderer preparation was
630.385 versus 36.153 ms. Reset was 1369.137 versus 801.389 ms.
Linux Mesa first ready draw was 4926.229 ms from engine start for the first
baseline process versus 1905.371 ms for the subsequent prebuilt process.
That end-to-end comparison is confounded by process order and shader/file cache
warming and MUST NOT be advertised as a 3-second code improvement. The reset
comparisons were 1585.856 versus 1357.709 ms from session entry. The next
bounded runner sequence is A/B/B/A, separate processes, each with a real R reset.
No hardware GPU cache isolation is claimed; shared warm-state results are
reported separately from the first cold process.
