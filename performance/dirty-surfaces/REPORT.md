# Dirty mutable surface proof: result

## Outcome

The isolated generator is correct for the tested fixed-inventory mutation contract and localizes rebuild work. Use **16-cell render chunks** for the next CPU integration experiment, independently of the existing 8-cell collider chunk size. Do not infer browser or GPU performance from this proof.

Initial city equivalence is exact for both 16 and 32:

- 53,113 structure source cells, implicit eight-layer terrain, no full-world `Cell` / `CellView` array.
- 203,018 exposed faces; 19,083,692 typed output bytes.
- SHA256 `a365dfd1e7a7fb124734759253ba3db83debc32b55f379c396f9f9ef4956428f` matches the existing preview oracle over every face's six vertex coordinates, normals, and uint32 color, independent of chunk/visit order.
- Both authority `cell()` methods are replaced with throwing functions during this city verification, so a hidden renderer `CellView` query fails immediately. The city verification creates no Rapier world.

## Locality and timings

Six fresh Node processes, interleaved 16/32 for three runs each, executed serially in a coordinated quiet window. Values below are medians; JSON records retain ranges and every cut. Initial fixture/authority setup is separate from geometry timing. Initial column registration uses scalar metadata once; dirty updates do not enumerate city chunks or all source cells.

| Surface workload | Chunk size 16 | Chunk size 32 |
| --- | ---: | ---: |
| Initial registered/render chunks | 438 | 105 |
| Initial queried halo cells | 1,782,002 | 1,844,058 |
| Initial surface build | 167.91 ms | 163.95 ms |
| One 23-cell cut: rebuilt chunks | 2 | 2 |
| One cut: queried halo cells | 9,072 | 50,864 |
| One cut: newly emitted bytes | 53,016 | 318,472 |
| One cut: surface rebuild | 1.50 ms | 4.72 ms |
| One cut: authority mutation + invalidation | 0.84 ms | 0.86 ms |
| 20 additional cuts: removed cells | 460 | 460 |
| 20 cuts: chunk rebuild operations / distinct chunks | 36 / 36 | 36 / 36 |
| 20 cuts: queried halo cells | 147,744 | 749,088 |
| 20 cuts: newly emitted bytes | 1,769,080 | 7,913,202 |
| 20 cuts: total surface rebuild | 14.67 ms | 59.90 ms |
| 20 cuts: authority mutation + invalidation | 2.27 ms | 2.08 ms |
| Peak transient typed halo bytes | 29,160 | 196,520 |

One cut is a radius-2 topsoil hemisphere centered at `(-25,-1,-9)`. The 20 additional nonoverlapping cuts are all combinations of x `[-88,-44,0,44,88]` and z `[-75,-25,25,75]`, y `-1`. Each cut flushes separately; this is not an artificially combined batch. The original source may have buildings above some cuts, which is why a terrain top-boundary edit can dirty an existing structure render chunk.

Query counts are exact adapter samples, including halo air beyond the finite world bounds. They exclude candidate-selection and mutation bookkeeping, which are reported separately: 23 terrain candidate checks and 46 before/after color samples for one cut; 460 and 920 for the 20 cuts. The underlying terrain authority still uses its existing bounded `cell()` call when applying each individual damage operation. No rendering query does so. Output bytes are newly generated CPU typed data, not measured GPU upload bytes.

### Where CPU time goes

| 16-cell surface stage | Initial | One cut | 20 cuts total |
| --- | ---: | ---: | ---: |
| Occupancy/color halo reads | 120.78 ms | 1.30 ms | 11.37 ms |
| Face counting | 12.52 ms | 0.04 ms | 0.77 ms |
| Typed face emission | 29.40 ms | 0.07 ms | 2.17 ms |

These are medians of each stage separately, so their sum need not equal the median overall time. The overall time also includes allocation/setup/bookkeeping. Occupancy reads dominate, including existing `staticAt` address/string and structure index-search costs. No claim is made that typed storage automatically fixes those costs.

16 was selected because this edit workload visits 5.1–5.6 times fewer cells and emits 4.5–6.0 times fewer bytes than 32, with 3.1–4.1 times lower measured rebuild time. The tradeoff is more initial geometry chunks (438 versus 105); future draw submission/culling cost could favor another size. Initial timings are close and only three samples, not a universal ranking.

## Verified behavior

Eight tests pass in `proof-test.txt`:

1. First-layer digging exposes the exact next soil floor, coordinates, colors and normals.
2. An eight-layer shaft has the correct cavity walls and no false floor below its removed bottom.
3. Negative chunk-boundary holes invalidate the containing and face-sharing chunks only, not diagonals.
4. A moving structure vacates its ORIGINAL static location; its new dynamic pose does not appear in this static output.
5. Adjacent edits deduplicate; duplicate revisions and HP-only changes do not rebuild; unaffected geometry objects retain identity.
6. Dynamic soil departure also vacates original occupancy.
7. A later no-op notification cannot hide an earlier real edit delivered out of order.
8. Mutating the caller's original bounds object cannot change subsequent chunk coverage.

TDD failures are retained in `red-test.txt`, `red-revision-test.txt`, and `red-ownership-test.txt`. Focused TypeScript check passed (exit 0, `typecheck.txt`). The final city hash was rechecked after the ownership-only fix and still matches.

A redundant production `npm test` was started, then interrupted at the lead's request to avoid interfering with another worker's profiles. It is **not a completed or passed regression run**; its partial output is `production-regression-interrupted.txt`, exit 130. No production source was modified by this task.

## Explicit limits and integration contract

- Occupancy-only CPU surface regeneration. No complete blast model, support search, solver, body creation, physics update, browser render, GPU work, FPS, publishing or production integration was tested here.
- Caller must capture every authoritative mutation and deliver the returned trusted internal event. Unnotified mutations are unsupported; `applyEdits` is not a public/untrusted-event validator.
- Static membership/immutable color define the render input. This proof does not implement damage shading or dynamic body meshing.
- After authority restore/reset, construct a **new source and renderer**. No automatic reset detection or reuse of the old sparse revision ledger is claimed.
- Fixed original inventory only. Runtime addition of new coordinates/chunks is not implemented.
- Geometry uses the existing preview's triangle order and face-color convention. The 94 bytes/face proof format is not a tested production renderer upload layout.
- `dirty-surfaces.ts` contains the full new implementation. Only a public scalar `colorAt` accessor was requested from the structure-store owner; no private fields or whole-city duplicate cache are used.

## Evidence

- `equivalence-result.json`: complete city hashes, counts, final verification diagnostics.
- `profile-16-{1,2,3}.json`, `profile-32-{1,2,3}.json`: fresh-process raw measurements with each cut.
- `summary.json`: exact counters, medians and ranges.
- `dirty-surfaces.test.ts`, `proof-test.txt`: independent bounded dense oracle and current test result.
- `README.md`: API contract and reproduction commands.
