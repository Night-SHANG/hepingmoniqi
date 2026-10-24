# Isolated compact structure storage proof

Status: 11 tests pass; strict TypeScript passes. This directory is the entire change scope. No production import, UI, remote upload, CI, dependency install, Rapier world, support engine replacement, or gameplay timing claim is included.

## Result

All 53,113 city aboveground cells reconstruct exactly against the existing structure-only fixture helper, including stable IDs, positions, HP/maxHP, materials, colors, roles and object IDs. All 36 buildings remain represented. The helper constructs zero ground Cell objects.

The pristine store retains no Cell, position, rotation or mutable-state object per cell and no position-string map. It retains 47 interned object ID strings, private typed columns, and an initially empty sparse edit Map. Explicit cell(id) reads return newly owned temporary values, not cached per-cell objects.

Exact typed payload: **2,496,311 bytes**, or **47 bytes per cell**:

| Column | Bytes per cell |
| --- | ---: |
| Int32 stable ID | 4 |
| Int32 x/y/z | 12 |
| Float64 original HP/maxHP | 16 |
| Uint32 color/group index | 8 |
| Uint8 material/role/three-way optional anchor | 3 |
| Uint32 sorted spatial index | 4 |

IDs and original coordinates must fit the signed Int32 integer lattice. Dynamic positions remain ordinary finite JS numbers. HP is never stored in Float32. Unknown/out-of-range data is rejected rather than silently truncated.

## Fresh-process storage A/B

profile-result.json records three independent fresh processes for each arm. Both arms run identical bounded warmup, allow an event-loop turn, and explicitly GC. The baseline arm retains only existing source Cell specifications, not the substantially broader production State/maps/cached-view system.

Medians from this run (Node v24.19.0):

| Measure | Source Cell specs | Compact store |
| --- | ---: | ---: |
| Retained JS heap delta | 11,313,824 B | 72,464 B |
| Retained array-buffer delta | -416 B | 2,495,895 B |
| Retained heap + array buffers | 11,313,408 B | 2,568,359 B |

The measured retained total is **77.3% smaller**. Exact compact buffers are 2,496,311 B; process deltas include runtime noise (including 416 B of unrelated buffer release in both arms). Do not mistake heap-only reduction for total-memory reduction: typed backing stores sit outside heapUsed. external overlaps arrayBuffers and is not added again.

Compact conversion median: 22.71 ms, after helper generation. This is storage conversion only, not scene startup. After 2,000 sparse HP edits, of which 50 have dynamic poses, the additional median JS heap is 304,416 B. Sparse edit records grow with touched cells; this is not a claim of constant memory after arbitrary destruction.

The compact arm drops its source fixture and array before the retained measurement. After a new event-loop turn and three GCs, WeakRefs to the source array and its first/middle/last Cell objects are empty in all three runs. Combined with the typed-only implementation, this distinguishes retained storage from just keeping both representations alive.

## Temporary allocation and peak limitations

This proof does **not** eliminate the helper's temporary generation objects. It still creates 53,113 structure Cell specifications, builder maps, legacy-column data, sorting references, and conversion arrays before release. Ground Cell generation remains zero.

In the compact runs, post-generation/pre-GC heap checkpoints ranged from 27,323,168 to 35,374,048 B (absolute process values, not retained deltas). Process-lifetime RSS high-water marks measured after conversion ranged from 115,003,392 to 118,509,568 B. Those include Node, tsx, warmup, native pages and allocation slack. They are not generation-only peaks and should not be subtracted as if RSS were exact object storage.

Synchronous helper allocation peaks may exceed endpoint heap samples. The benchmark labels these as temporary checkpoints, **not an exact measured heap peak**. A future streaming numeric generator would need a separate A/B to remove that temporary cost. This report makes no claim that city physics, rendering or frames are now cheap.

## Behavior verified

- Exact reconstruction of every city cell and all 36 buildings.
- Input/output deep ownership, optional anchors, noncontiguous and negative IDs.
- Repeated fractional double-precision damage, cumulative loss, destruction threshold and no-op inputs.
- Sparse dirty-ID cursors for independent readers, deduplication, owned responses and reset signaling.
- Dynamic/rubble metadata ownership, original lattice departure, retained IDs/HP and destroyed moving-cell metadata.
- Numeric static neighbors and sphere queries against independent dense occupancy.
- Sparse JSON save roundtrip, invalid-restore atomicity, deep copy of nested poses, and 400 deterministic city edits followed by every-cell comparison.
- Original scalar/index reads work when cell() is replaced by a throwing guard, including bounds validation and post-promotion stable coordinates.

The restore validator belongs only to this storage proof. It does not replace production validation of bodies, events, queues, episodes, research or replay metadata. Promotion stores supplied physics-derived values; it does not simulate physics or resolve impacts.

## Allocation-free topology adapter contract

- indexOf(id: number): number returns stable ID-sorted index or -1.
- indexAt(x: number, y: number, z: number): number returns original-position index or -1.
- idAtIndex(index), xAt(index), yAt(index), zAt(index): number | null.
- materialAt(index): Cell['material'] | null.
- objectIdAt(index): string | null.
- anchorAt(index): boolean | undefined; absence and invalid index return undefined, explicit false is preserved.

These scalar/index methods allocate neither coordinate arrays nor CellViews. ID and spatial lookup are binary searches, not per-cell JS Maps. Original positions stay stable after movement; staticAt filters departed/gone records. Dirty cursors return reset=true after restore, with no implicit full-city materialization. Callers can enumerate indices 0..cellCount-1 to rebuild their view if needed.

## Reproduction

From this directory:

```sh
npm test
node ../../hepingmoniqi-v09/node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --skipLibCheck --types node --typeRoots ../../hepingmoniqi-v09/node_modules/@types compact-structures.ts compact-structures.test.ts profile.ts
node --expose-gc --import ../../hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs profile.ts > profile-result.json
```

The red-* logs record failing tests before implementation. proof-test.txt and typecheck.txt record final focused verification. Sibling/production code was not edited; the lead already verified the other 33 isolated tests, so this worker did not duplicate that aggregate run.
