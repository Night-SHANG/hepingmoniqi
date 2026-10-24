# Fixed-city pristine support table: isolated CPU result

This is not imported by the game. No production, browser, remote, physics, map, UI, weapon, or rules changes were made. The original MIT seeded `cut`, `leave`, `split`, and `unsupported` algorithms are preserved in `../incremental-support/indexed-structure.ts`; this proof only adds an alternate validated initial-state construction path and exposes its existing lattice adapter. MIT notice is preserved in that folder and copied to `LICENSE` here. Earlier adapter provenance hashes describe the pre-hydration historical revision; the manifest here records exact current source hashes.

## Result

The unchanged city has 454,913 cells: 401,800 implicit terrain cells, 53,113 structures, and 36 buildings. Seed 11 compiles to 3,409 chunks, 20,018 directed reciprocal edges, and 48 object IDs. The complete binary is **3,857,400 bytes**, including a small manifest; typed payload is 3,855,156 bytes. No 401,800 ground Cell objects or giant JSON state snapshot are generated or cached. The current sparse source generator still temporarily creates 53,113 structure Cells before packing them; this proof does not pretend that cost has vanished.

Three strictly serial fresh-process samples per mode, in alternating uncached/cold/warm order:

| Measurement | Original uncached | Compiled first read | Compiled second load |
| --- | ---: | ---: | ---: |
| Support initialization including full validation | 1811–2014 ms | 432–492 ms | 447–517 ms |
| Binary decode + SHA-256 | n/a | 12.0–14.1 ms | 11.7–12.4 ms |
| Topology digest, owned clone, canonical table digest, all invariants | n/a | 395–451 ms | 416–486 ms |
| Mutable graph hydration | n/a | 16.2–19.6 ms | 12.1–17.5 ms |
| 20 subsequent query median | 1.12–1.43 ms | 1.19–1.34 ms | 1.06–1.95 ms |
| 20 local-cut median | 2.79–3.01 ms | 2.86–3.25 ms | 2.83–3.52 ms |

“First read” means a fresh Node process, **not** flushed OS filesystem cache. “Second load” discards the first graph and runs decoding, full validation, and hydration again in the same process. Warm is not consistently faster; all samples, including outliers, remain in the raw results. The support timer excludes compact source preparation and source-file recipe preflight; these are separate from support initialization. Source/store preparation remains reported in every raw sample. No laptop, phone, network-fetch, browser or whole-game startup claim follows from these numbers.

Offline generation is also reported separately: original partition **1804 ms**, encode + full validation **517 ms**, source preparation **122 ms**. An independent second seeded partition + encode took **2387 ms** and produced byte-for-byte identical output. The original expensive partition was moved to asset preparation, not removed or hidden.

## Format and trust boundary

`city-seed-11.manifest.json` records actual SHA-256 checksums of source/recipe modules, a deterministic recipe digest, map ID, seed, binary schema version, streamed immutable topology digest, counts and payload digest. Schema version 1 describes the wire layout; it is not an arbitrary claimed map revision. Map/recipe identity derives from exact source bytes. There is no timestamp or machine-specific path in the generated asset.

Wire format is little-endian: 16-byte magic/version/length header, short UTF-8 manifest padded to four bytes, then compact typed columns in this order:

1. Index-to-chunk Int32 table.
2. Packed chunk member offsets and member indices.
3. Chunk object-ID indices and explicit root counts.
4. Packed directed edge offsets, destinations and face counts, retaining original Map insertion order.
5. UTF-8 object-string offset table and bytes.

Runtime rejects unexpected identity/format/seed/recipe/digest, truncated or trailing bytes, bad lengths/offsets/types, invalid UTF-8/padding, out-of-range or duplicate/missing members, object mismatches, incorrect root counts, duplicate/self/out-of-range edges, wrong actual reciprocal face counts, disconnected chunks and mixed-material chunks. A complete original-occupancy face pass recomputes true edges: reciprocal-but-false counts also fail.

A second canonical payload hash after copying decoded tables prevents a caller from reordering a valid membership table between decoding and validation. The digest is checked against the previously verified manifest, avoiding a second seeded partition run. Tests deliberately recompute claimed payload hashes for malformed tables to ensure semantic validators, not merely the digest, catch those cases.

Validated tokens are private WeakMap capabilities bound to the exact lattice instance, single-use, with no publicly accessible table aliases. Constructor hydration consumes a token before creating mutable graph members. Invalid candidates cannot mutate the separately existing active graph. Returned decoded tables can be changed by a caller, but cannot affect an already validated token. Wrong-source, reused and forged tokens fail.

**Node-only boundary:** SHA-256 currently uses `node:crypto`, including the hydration validator import from `IndexedStructure`. Browser production must not import these spike modules as-is. A browser-native crypto/validation port and integrated lifecycle need their own tests. The trusted expected manifest must come from the intended build, not be blindly accepted from an arbitrary downloaded cache.

## Correctness and retained memory

Eight new tests plus all eleven unchanged incremental-support tests pass (19/19); strict TypeScript passes for codec, validator, generator, runner, tests and both adapter files. New tests cover exact ordered chunk membership/roots/edges and later splits, corrupted/wrong assets, malformed semantic tables, owned token lifecycle, stable logical-ID/position/material/object/anchor digest binding, empty/modified graphs, post-decode tampering, and Buffer subviews with nonzero byte offsets. RED logs preserve the missing implementation, mutation-digest regression, and Buffer-subview regression.

Generation compares the complete hydrated index/chunk/member/edge state to a fresh original seeded graph. All nine profiles replay the same twenty sphere cuts; all **180 exact ordered unsupported-membership SHA-256 values**, piece counts and removed-cell counts agree with the existing independent topology oracle. This is stronger than equal counts alone, but is still topology-only: no HP, dynamic-body, collider, reward, contact-episode or render equivalence is implied.

Post-GC retained compact source + active support after twenty cuts:

- Uncached: 6.68–6.69 MB JS heap delta, 5,172,676 typed bytes.
- Compiled first read: 6.60 MB JS heap delta, the same 5,172,676 typed bytes.
- Compiled second load: 6.38–6.63 MB JS heap delta, the same 5,172,676 typed bytes.
- Dropping the entire compiled graph-owning frame releases **2,274,565 graph typed bytes** in every sample and about **5.88 MB heap**. Compact stores are intentionally retained. Uncached first-GC typed release varies from 1,819,652 to 2,274,565 bytes; this is reported rather than treated as exact immediate finalization.
- Decoded buffers and build-time packed payload copies are not retained with the graph. The active algorithm still owns mutable JS arrays of numeric chunk members and Maps of edges; it is not a fully typed runtime graph.

RSS after work differs substantially by allocation history (uncached ~153–155 MB delta; compiled first read ~84–86 MB; compiled warm ~94–98 MB), but RSS is not exact peak, native memory or an allocation census. ArrayBuffers are also included in external and must not be added to it. No Rapier/WASM or GPU objects are created in this proof.

An early measurement harness accidentally retained source Cells through shared closure context and observed graph references before leaving their owner stack frame. The final harness assigns forbidden-Cell guards as top-level functions and measures release only after the complete graph frame returns. Only the corrected final runs are summarized.

## Reproduction

From `hepingmoniqi-performance-spikes/`, using already installed local dependencies:

```sh
node --import tsx --test compiled-support/compiled-support.test.ts incremental-support/incremental-support.test.ts
node --expose-gc --import tsx compiled-support/generate.ts
for i in 1 2 3; do
  for kind in uncached compiled-cold compiled-warm; do
    node --expose-gc --import tsx compiled-support/profile.ts "$kind" > "compiled-support/$kind-result-$i.json"
  done
done
python3 compiled-support/summarize.py
```

Only this one existing city/seed asset is generated here. Other fixtures can use the codec, but do not claim their shipped asset coverage without generating/verifying them. Original project tests were not rerun by this worker: the lead reported the unchanged production guard already passed 410 tests with one skip and asked this worker to run the scoped old/new tests; lead owns the aggregate spike run.

## Still unproven

Browser-compatible hashing, asset delivery, cross-map manifest selection, edited-save replay before pristine support use, actual game mutation scheduling, whole-world physics/collider integration, selection-to-interaction latency, long tasks/rAF gaps, ten enter/leave cycles, native/WASM memory, GPU allocation and visual/mobile acceptance remain unproven. Full runtime validation itself is still a 0.4–0.5 second CPU task here. A faster seed cache alone does not solve responsiveness or expensive fragmentation.

## Frozen source and measurement window evidence

`source-evidence/` preserves byte-identical copies of all fourteen manifest-listed source files, plus the final generator, profile, tests and summarizer. This keeps these historical Node results reproducible after a later browser port changes the active source files. Do not overwrite this artifact/manifest with the ported version; generate the latter separately.

`sample-timestamps.json` records final output file timestamps in UTC. The final nine measurements completed between **03:48:21.985 and 03:48:34.137 UTC** on 2026-10-24. Another worker later reported starting a heavy production test at 03:48:44 UTC; therefore it did not overlap any of these final samples. This was checked explicitly rather than assuming the coordination messages guaranteed isolation.
