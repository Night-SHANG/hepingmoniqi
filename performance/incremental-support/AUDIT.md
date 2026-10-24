# Compact incremental MIT support A/B proof

## Decision

Keep the existing MIT-derived incremental chunk algorithm. The minimal accessor
adaptation works without retained ground Cell metadata or a six-neighbor table.
All same-city outputs match the independent full-cell oracle exactly. This is
still an isolated proof, not a production patch or a frame-rate claim.

The major unresolved cost is initial seeded partitioning: **1.85–1.91 seconds of
support setup**, including **1.68–1.74 seconds in the unchanged seeded cut stage**.
Nothing in this proof hides, defers, approximates, or moves that cost to a Worker.
No initializer cache or hydration path has been implemented.

## Preserved behavior and representation

- `indexed-structure.ts` directly reuses the current executable MIT `cut`, `leave`,
  `split`, `unsupported`, RNG, and reciprocal edge-counter code. See
  `PROVENANCE.md`, `provenance-hashes.json`, and the retained MIT `LICENSE`.
- Input indices are in increasing public-ID order, including historical negative
  terrain IDs, arbitrary sparse structure IDs below the terrain interval, and
  zero/positive structure IDs. Initial object order and seeded RNG draw order
  therefore match the current public adapter exactly.
- Cell metadata is read from compact original-coordinate/scalar accessors. No
  source Cell array, all-city LatticeVoxel array, proxy cache, per-cell ID Map, or
  all-city six-neighbor array is retained.
- Original occupied neighbors are computed on demand in the same six-axis order.
  They are not filtered by terrain/structure mutable state. The original
  `present` and per-call `done` checks own batch face removal and subsequent splits.
- Explicit roots remain removable. Foundations, y=0 cells, and low object layers
  receive no synthetic grounding. Positive-axis face construction and Map edge
  insertion order match the original algorithm.
- Only numeric chunk member arrays, chunk records/edge Maps, presence bytes and
  chunk labels persist in the graph. Unsupported traversal is chunk-level; there
  is no whole-city cell flood in repeated queries.
- Constructors reject edited input stores rather than silently resurrecting gone
  or dynamic cells. Once constructed, store damage/promotion does not change
  original metadata or occupancy: callers must explicitly remove departed IDs.
  Replay/save initialization is not implemented. The descriptor wrapper/bounds
  are copied so replacing caller-owned fields cannot redirect future reads.
- `partition()` is an explicit bounded test/debug snapshot. It materializes all
  chunk public IDs and is never used by the city performance path.

## Test-first verification

`red-test.txt` records the initial assertion failures before implementation.
`red-initialization-test.txt` records missing pristine-input rejection and descriptor
ownership protection before those fixes. Final `proof-test.txt`: **11 tests pass,
0 fail**. `typecheck.txt`: strict TypeScript no-emit check passes.

Tests compare exact chunk member order, chunk order, explicit anchor counts, and
ordered reciprocal edge entries against the unchanged `SparseStructure`, not just
final connected/disconnected counts. Public unsupported member arrays also match
both `createSupportGraph` and the independent compact full-cell oracle.

Coverage includes 480 randomized cut batches over 16 fixtures/seeds; monolith and
mixed object/material partitions; foundation and either-bank bridge support; all
finite bottom-boundary roots removed; adjacent/duplicate/repeated cuts; sparse
negative/zero/positive IDs; preedited initialization rejection; caller store
mutation after construction; descriptor/output ownership; empty input; terrain
ID collision and occupancy overlap; mismatched descriptor bounds; and twelve
fractional sphere cuts. Unknown IDs are ignored and removal is idempotent.

These are isolated topology tests. No production source, renderer, native physics,
UI, local computer, remote repository, uploaded artifact, or release was changed.
Other isolated module tests were independently checked by the parent; this proof
is not a claim that the full game/browser/Rapier regression suite was rerun here.

## Same-city coverage and controlled process sequence

Exactly **401,800 eight-layer terrain cells + 53,113 structure cells = 454,913**,
with **36 buildings**, unchanged foundations, roads, bridge, and trees. Historical
terrain IDs come from the existing two-dimensional rank descriptor.

Six fresh Node v24.19.0/Linux processes ran strictly serially:
`incremental1, oracle1, incremental2, oracle2, incremental3, oracle3`.
Each performed the same twenty occupancy-sphere cuts. All **120 exact ordered
component-member SHA-256 hashes** match each other and the earlier verified oracle
run. Every run removes 18,337 actual cells, leaving 436,576 present cells; the last
query has 3,172 disconnected members. Initial unsupported count is zero.

The city path overrides terrain.cell() and structureStore.cell() to throw, so no
pristine ground Cell or structure CellView materialization can slip into setup,
cut, or query. Sparse structure generation still creates 53,113 temporary source
Cell specs; they are released before the after-build GC snapshot in both modes.
The incremental path packs full compact immutable/state metadata; the oracle
stores its topology-only typed snapshot. This distinction matters for memory.

### Observed ranges across three runs

| Stage | Incremental MIT accessor | Independent full-cell oracle |
| --- | ---: | ---: |
| Terrain descriptor setup | 9.94–10.62 ms | 9.09–11.76 ms |
| Structure generation/packing | 92.58–94.47 ms | 59.30–72.32 ms |
| Support construction | 1846.83–1909.40 ms | 20.28–23.33 ms |
| Initial support query | 2.90–3.39 ms | 63.77–110.11 ms |
| Twenty-query per-run median | 1.10–1.28 ms | 41.50–42.55 ms |
| Twenty-query per-run p95 | 2.11–2.49 ms | 44.70–47.02 ms |
| Maximum observed query | **13.20 ms** | 48.93 ms |
| Removal per-run median | 2.71–3.31 ms | 0.127–0.150 ms |
| Removal per-run p95 | 3.99–4.56 ms | 0.386–0.451 ms |

The 13.20 ms query outlier is retained and disclosed, not discarded. Incremental
removal performs affected-chunk splitting; the oracle removal only clears presence
and postpones all connectivity work to its slower query. Compare cut plus query,
not removal alone. These host/JIT-dependent samples are indicative stage timings,
not statistically universal speedups or browser frame budgets.

Initial seeded cut costs 1680.56–1735.16 ms; its 401,800-cell geology partition alone
costs 1450.19–1495.15 ms. Original material-grid key strings, temporary numeric bucket
arrays, Maps/Sets, and repeated temporary position objects still allocate in this
initial hot loop. "Retained Cell records: 0" does not mean allocation-free setup.

Raw samples are `city-result-1.json` through `city-result-3.json` and
`oracle-result-1.json` through `oracle-result-3.json`; `summary.json` verifies parity
and records ranges. No dense whole-city MIT reference was materialized: exact
seeded chunk parity is bounded-test evidence; exact full-city membership is oracle
evidence. No full-city speedup over the old dense MIT adapter is claimed.

## Retained memory accounting

Incremental exact typed buffers:

| Buffer owner | Bytes |
| --- | ---: |
| Graph: Int32 chunk labels + Uint8 presence | 2,274,565 |
| Full compact structure metadata/state store | 2,496,311 |
| Terrain 2D historical-ID rank maps | 401,800 |
| **Total** | **5,172,676** |

At the end there are 3,465 chunk records, 436,576 numeric live member entries, and
19,240 directed edge Map entries. Graph member arrays/Map/object overhead is not
included in typed bytes. No source Cell specs remain held by the benchmark.

Post-requested-GC incremental delta from process baseline: retained heap
6,660,608–6,667,016 bytes, array buffers exactly 5,172,676 bytes. Oracle delta:
retained heap 4,150,984–4,160,712 bytes and array buffers 6,248,746 bytes. The
incremental graph has fewer typed bytes but more JS member/edge data; it is **not**
a demonstrated total-retained-memory improvement over the full-cell oracle.

RSS delta is substantially larger for incremental: 151.23–151.70 MB versus oracle
47.99–52.59 MB. These are process snapshots after requested GC, not peak memory,
not exact allocation counts, and not a proof of why RSS remains elevated. The
seeded initializer creates sizable temporary collections and objects; those costs
must not be concealed by quoting only compact retained buffers.

## Boundaries and next decision

Repeated static support checking is now materially cheaper than the independent
full-cell flood on this workload while retaining actual MIT chunk reuse. Initial
partitioning remains the bottleneck. A future separately approved proof could
compile or cache exact fixture/seed partitions and validate hydration, but that is
not implemented or measured here. Freeze this adapter proof before integration.

Not covered: real blast HP/impulse/occlusion, detached Rapier body creation, falling
or secondary impacts, rubble lifecycle, rendering invalidation, save restoration,
production startup, browser latency, memory peaks, frame rate, or cross-device
behavior. Sphere removal is occupancy-only, and unsupported members stay in the
static graph until explicit departure. Large detached outputs still allocate and
sort their full public member arrays.

## Reproduction

From the workspace root:

```sh
node --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs --test hepingmoniqi-performance-spikes/incremental-support/incremental-support.test.ts
./hepingmoniqi-v09/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node --typeRoots ./hepingmoniqi-v09/node_modules/@types hepingmoniqi-performance-spikes/incremental-support/*.ts
node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/incremental-support/profile.ts incremental
node --expose-gc --import ./hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs hepingmoniqi-performance-spikes/incremental-support/profile.ts oracle
```
