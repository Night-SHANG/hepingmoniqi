# Regional bulk and exact greedy slice: measured outcome

Date: 2026-10-24. Local isolated experiments only. No new remote commit, CI, package, shader or normal-game integration in this pass.

## Outcome: reject both current candidates as the performance fix

The strict bulk classifier does not cover enough of the actual city blast. The exact-color greedy mesher preserves appearance but has almost nothing to merge. Do not publish their unit-test success as a solved nuclear-blast performance problem.

### Bulk static damage

Same city, center (0,3,0), radius48, damage20. The scalar direct damage phase affects67,103 cells and kills31,535. Across1,607 tiles, only47 sparse homogeneous tiles/926 cells qualify for guaranteed full-gone:1.38% of affected cells. No fully occupied512-cell city tile qualifies, and no complete terrain tile qualifies. Deepest terrain HP58 exceeds maximum damage20.

All454,913 stable-ID scalar HP/state/loss rows match the independent CompactAuthorityStore oracle. Integer counters and research match (objective departed9349, game research38, structural research43). Aggregate Float64 loss differs1.05e-9 from summation order, so bit-exact aggregate equivalence is not claimed. Seven paired warm measurements: bulk median70.45ms versus same-storage forced-scalar68.85ms. This is static storage/edit evidence, not full support, physics, browser or GPU equivalence. About98,638 markChanged calls in the old path arise from67,103 damage writes plus31,535 destruction writes, not98,638 separate damaged cells.

Sources: artifacts/regional-bulk/coverage.json and benchmark.json.

### Exact-color indexed greedy geometry

Intact city:454,913 authority cells,105 nonempty32³ chunks. Baseline203,018 unit faces /1,218,108 vertices /32,888,916 bytes. Exact greedy202,794 quads /811,176 vertices /26,768,808 bytes. Actual quad reduction0.110%; byte reduction18.608% is predominantly indexing. Initial CPU observation244ms baseline versus485ms greedy was slower, not a GPU measurement.

One actual central authority nova produced31,671 departures (31,535 gone and136 dynamic), revision98,844. Immediate static geometry185,706 unit faces→185,573 quads;30,084,372→24,495,636 bytes. Exact expanded face, normal and color parity across105 chunks passed. Meshing left source hash, revision and aggregates unchanged. This checks the geometry of an actual blast state, not a separate physics implementation.

Sources: artifacts/regional-mesh/intact-first.json, actual-nova-report.json and related parity results. Initial report cleanup boolean compared undefined against the API's null value; see worker report caveat, not evidence of a proven live-world leak or a fabricated rerun.

## Read-only next possibility: separate color detail from geometry

Holding identical occupancy but grouping only material+normal yields11,820 quads /47,280 vertices /1,560,240 geometry bytes:94.178% fewer quads and95.256% fewer geometry bytes than baseline. This hypothetical source deliberately ignores original palette/HP shade. It is not visually equivalent, not implemented, and excludes the required color/HP material payload and shader cost.

Current code facts:
- Compact terrain top layer selects a three-color palette by abs(x*7+z*11)%3.
- Deeper soil selects by abs(x*73+y*31+z*17)%3.
- Warm buildings select their material palette by abs(x*73+y*31+z*17+variant*13)%paletteLength. Tree foliage has its own supplied shade index. Material and position alone are insufficient to reconstruct every structure variant.
- Existing legacy maps preserve authored per-cell colors rather than one universal coordinate formula.
- The current final linear vertex color is source sRGB color converted through Three.Color, then multiplied by0.6+0.4*hp/maxHp for damaged cells.

A style-preserving material prototype would therefore need original-coordinate palette/variant data or a compact lookup, current HP data, and the same color-space conversion/shading. Negative coordinates, face-normal inward cell selection, new crater faces and moving rubble's original local coordinates are essential. Merged triangles must not interpolate a checkerboard into a solid wash. GPU lookup/texture bytes, uploads, precision and filtering must be counted. No shader was implemented in this pass.

## HP-field expression: feasible representation, nontrivial semantics

A tile can retain an ordered set of blast fields (center, radius, damage) and evaluate exact scalar HP only when read, but arbitrary radial damage is not a uniform HP decrement. Overlap order, clamping and death thresholds must remain the same. Proving an entire deep-soil region remains alive can avoid unnecessary per-cell state writes; terrain produces no research, making this narrower case easier than buildings.

Risks that prevent calling this an O(1) complete solution:
- Immediate exact building research aggregates generally still require evaluating clipped loss over cells; lazy storage must not defer or change the displayed reward.
- Death/support/collider transitions must be committed before another projectile can interact. Deferred HP cannot preserve an obsolete solid collider after a kill.
- Repeated fields grow query, save and shader costs; bounded compaction must not silently drop fields or shift unlimited debt to future reads.
- Floating arithmetic and summation order can change threshold/reward boundaries. Preserve Float64 authority and test near-boundary cases.
- Dynamic rubble uses transformed contacts/original IDs and cannot be treated as a static terrain tile.

The measured current shortcuts are NO-GO. The hypothetical material separation suggests substantial geometry reduction worth a distinct bounded, style-equivalent experiment if requested. It does not prove reduced authoritative damage latency, and no new iteration is promised to solve both bottlenecks.
