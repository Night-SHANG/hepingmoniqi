# Compact support representation A/B proof

## Result and decision

This is an isolated, throwaway correctness oracle and representation experiment. It is not imported by the game. No production code, UI, dependency versions, native physics, remote repository, or published build was changed.

The complete city is preserved: **401,800 finite soil cells + 53,113 structure cells = 454,913 cells, including all 36 buildings**, roads, trees, bridge, and foundations. Every soil layer and outer-bottom root remains removable. A foundation at y=0 receives no synthetic support.

The compact representation avoids full-city ground Cell metadata and per-cell six-neighbor records. However, its whole-index flood is slower per support query than the current MIT-derived incremental chunk graph in the bounded A/B. **Keep this flood as a correctness oracle; do not replace production support with it or claim a real-time support improvement.**

## What was implemented

- `compact-support.ts`: implicit finite terrain addressing, one presence byte and visit stamp per indexed cell, one reusable typed BFS queue, typed sparse structure IDs/coordinates/anchor flags, and two numeric Maps for sparse structure positions and IDs. No stored neighbor arrays or per-cell neighbor objects.
- `sparse-structure-fixture.ts`: structure-only projection of existing project `src/structural/fixtures.ts`. Building/road/tree/bridge geometry and metadata are unchanged. Finish skips every legacy soil Cell and offsets positive structure IDs by `legacyColumnCount * 3`, exactly matching the original ordering.
- The existing compact terrain descriptor supplies historical negative terrain IDs. Its 2D rank maps preserve old plot-layer IDs and appended full-rectangle IDs.
- `remove(ids)` is idempotent and ignores unknown IDs. Terrain ID lookup may materialize only affected Cell values; it is not used by the measured city path. `removeAt` and `removeSphere` change presence without creating ground Cell metadata.
- `unsupported()` floods only actual face neighbors. It returns exact component member arrays, sorted by ID and component minimum, with the same `unsupported-${minimumID}` identities as the existing public support adapter. Returned arrays are owned values.
- A disconnected component remains in this static graph until explicitly removed. No detachment promotion, dynamic body, fragmentation, impulse, settled rubble, or secondary damage is modeled here.

## Exact accounting

For the full city, the support buffers are:

| Buffer | Bytes |
| --- | ---: |
| Uint8 presence | 454,913 |
| Uint32 visit generations | 1,819,652 |
| Int32 reusable queue | 1,819,652 |
| Float64 sparse structure IDs | 424,904 |
| Float64 sparse structure coordinates | 1,274,712 |
| Uint8 sparse structure anchors | 53,113 |
| **Support buffers total** | **5,846,946** |
| Existing terrain 2D rank buffers | 401,800 |
| **Combined typed buffers** | **6,248,746** |

The two structure Maps each retain 53,113 entries. The generator returns 53,113 sparse Cell specs and uses 16,446 unique legacy column records at finish. Those specs are held by the benchmark, not by `CompactSupport`; the support class snapshots only typed IDs/coordinates/anchors and numeric indexes.

These are exact buffer sizes and logical representation counts, not a complete V8 allocation census. JS Map/object overhead, repeated temporary column writes, building-local Maps and temporary positions, descriptor construction temporaries, and result-array allocation are not included in the buffer sum. The measured city path throws if `terrain.cell()` is called: it creates zero ground Cell values and zero neighbor objects. Output may allocate IDs for genuinely disconnected cells, not all pristine cells. The 20 queries returned 31,353 IDs cumulatively; final disconnected count was 3,172.

Process snapshots are collected with `--expose-gc`; JSON reports `gcAvailable`. They are post-requested-GC snapshots, not peak RSS or total allocations. No native Rapier or renderer memory is included.

## Verification

Fresh final check: **15 tests passed, 0 failed**, plus strict TypeScript no-emit check. `proof-test.txt` and `typecheck.txt` contain evidence. Deliberate test-first red failures are retained for the missing implementation and later boundary/mutation regressions.

Exact comparison with current `createSupportGraph` covers:

1. Foundation cuts with y=0 detachment.
2. A bridge supported by either bank until both leave.
3. Removing every outer-bottom root; duplicates and repeated removals.
4. Eight-layer ring cuts with exact center-soil + house membership and multiple components.
5. Duplicate IDs, overlapping occupancy, invalid lattice coordinates, empty input.
6. Input/output ownership, mixed materials/roles, diagonal gaps, stable ordering.
7. 250 randomized cut steps over ten fixtures, including explicit detached departure.
8. Exact complete sparse structure metadata parity with production source for lab, neighborhood, and city, including all 36 buildings.
9. Guard against pristine ground metadata or neighbor-object creation during flood.
10. Out-of-domain numeric-key alias rejection.
11. Sphere clipping for very large finite coordinates/radii, avoiding non-advancing loops.
12. Large safe-integer sparse coordinate normalization.
13. Rejecting later descriptor mutation before ID removal could read a moved pose as its original address.
14. Explicit bounded Int32 terrain coordinate domain.
15. Twelve fractional-center/radius sphere cuts against independent dense occupancy selection and exact MIT component membership.

An independent scoped reviewer also ran 1,000 randomized side/bottom adjacency comparisons and found no mismatch. Review findings were addressed; the reviewer independently reran the final 15-test suite successfully.

The sparse fixture parity test intentionally calls the production source generator, which temporarily creates approximately 49k legacy three-layer terrain Cells for city. That is a bounded verification-only path. The full-city performance path never calls the original fixture factory and never creates those source soil Cells or the 401,800 ground Cell array. Do not confuse test allocations with compact benchmark allocations.

## Measurements

Runtime: Node v24.19.0, Linux, existing locked project tsx loader. No new dependency installation or third-party source execution.

### Bounded same-input A/B

3,778 cells, twenty identical removal batches, including 46 nonempty disconnected member IDs from cut ten onward. Exact ordered member sets match on every step.

- Current MIT graph: setup 37.49 ms; twenty support queries total 0.690 ms.
- Compact typed flood: setup 0.868 ms; twenty support queries total 5.280 ms.

This is one process with MIT first and compact second, no warm-up, not a statistically controlled speedup comparison. It demonstrates the important trade-off: materially cheaper representation/setup, but worse repeated support-query cost. Raw data: `ab-small-result.json`.

### Full-city compact-only measurement

Three serial fresh processes retained identical topology and performed twenty bounded occupancy-sphere removals. All twenty exact sorted-membership hashes match across all three runs. The removals deleted 18,337 actual cells in total, leaving 436,576 present cells. Initial unsupported count was zero.

Observed ranges across runs:

- Terrain descriptor setup: 9.11–18.00 ms.
- Sparse structure generation: 54.91–87.01 ms.
- Support construction: 22.44–36.45 ms.
- Initial full support query: 68.67–78.20 ms.
- Twenty subsequent full support queries: per-run median 42.00–47.76 ms; p95 44.41–62.51 ms.

Raw data: `city-result-1.json` through `city-result-3.json`; `city-result.json` is a copy of run one; `summary.json` records deterministic replay and ranges. Host/JIT variability is visible. These are static topology stage timings, **not browser load time, time-to-interactive, frame rate, collision build time, or physics simulation timings**.

The full-city MIT graph was deliberately not constructed: full-size reference generation is optional for this proof, and bounded exact equivalence plus full initial coverage suffices for its stated conclusion. There is no measured full-city old/new speedup claim.

## Limits and the smallest useful next step

The current flood visits live cells and scans the **entire original indexed capacity**, then sorts disconnected member IDs. Its asymptotic query cost is O(indexed capacity + disconnected-ID sorting), not proportional only to recently affected cells. Even without materialized ground objects, ~40–60 ms queries are not a 60 fps solution.

Keep the mature MIT-derived `SparseStructure.cut/leave/split/unsupported` algorithms and license/provenance. The next minimal representation adaptation can target their data access rather than invent a new support algorithm:

1. Replace retained full `LatticeVoxel[]` terrain metadata with indexed immutable getters: original x/y/z, material, objectId, and explicit-anchor predicate. Terrain getters are arithmetic/descriptor-backed; sparse structure metadata remains available separately.
2. Replace the stored `Int32Array(n * 6)` adjacency with `forEachOriginalNeighbor(index, callback)` or a six-slot scalar accessor. Terrain neighbors are arithmetic; terrain/structure boundary neighbors use sparse occupancy lookup. The query must enumerate **original occupied neighbors**, including neighbors removed earlier or in the current batch. It must not silently filter to alive neighbors.
3. Preserve `SparseStructure.present` and each `leave` call's local `done` set. Current leave intentionally checks `present[u]` and `done.has(u)` while decrementing shared faces, then clears presence after the first pass, and splits damaged chunks. Switching to alive-only adjacency or clearing presence prematurely would lose face decrements and break adjacent/duplicate batch removal semantics.
4. Keep the seeded `cut` partitions, chunk IDs, anchor counts, exact face counters, damaged-chunk `split`, and chunk-level support traversal unchanged. A split still examines the affected chunk's live numeric members; it need not rescan the entire city. `unsupported` still traverses the chunk graph and materializes only actual disconnected members.
5. Adapt stable public ID conversion without an all-terrain per-ID Map. Preserve historical negative IDs through the existing 2D rank mapping. Reuse this typed flood as the independent exact-membership oracle for repeated cuts, root loss, and cross-object bridges.
6. Re-measure build and repeated cuts before touching physics/UI integration. Initial seeded partitioning may still be expensive even after metadata and adjacency storage shrink; nothing in this proof establishes that cost is solved.

This proposed adapter can avoid the new flood's whole-city rescans while preserving current batch-leave semantics. It is only the next bounded experiment recommendation; no new hierarchical/incremental support system was implemented in this task.

### API and integration boundaries

- Terrain descriptor input must be pristine and remain unchanged for this isolated graph's lifetime. Support presence is owned separately. Later descriptor mutation is rejected by ID-based removal rather than silently applying a moving pose as an original address.
- Terrain coordinates are explicitly limited to Int32 bounds; current city bounds are ±122/±102. The existing sibling terrain descriptor has not been changed or certified for huge translated coordinates.
- `removeSphere` is geometry/occupancy removal only, not the game's HP/radius/occlusion/impulse/impact rules.
- Save/restore, historical migration, renderer invalidation, real Rapier detach/fall/contact/rubble lifecycle, full game regression, browser latency, and peak memory remain unverified by this proof.

## Reproduction

From the workspace root:

```sh
node --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs --test hepingmoniqi-performance-spikes/support-ab/compact-support.test.ts
node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/support-ab/profile.ts small
node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/support-ab/profile.ts city
./hepingmoniqi-v09/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node --typeRoots ./hepingmoniqi-v09/node_modules/@types hepingmoniqi-performance-spikes/support-ab/*.ts
```
