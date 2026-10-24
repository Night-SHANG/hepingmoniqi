# Compact static-ground collider A/B proof

This is an isolated, throwaway adapter. It is not imported by the game and does not alter production files, dependencies, saves, remote repositories, or releases. Rapier remains the project's installed 0.21.0. The caller owns the same single physics world; the adapter only adds/removes finite static terrain colliders in that world.

## Result

All 401,800 city soil cells can be represented for pristine static collision by 832 finite, clipped chunk boxes without constructing those 401,800 Cell objects, retained packed cell-ID lists, or a cell-to-collider Map. Exact per-cell IDs, HP, eight-layer depth, finite bounds, and removable root metadata remain in CompactTerrain. There is no hidden bottom plane.

832 is the **ground-only** collider count for both the compact and dense A/B paths. It must not be compared as a reduction from the game's 7,321 whole-map colliders: those include buildings, roads, and other objects. This proof does not build a 36-building city physics world.

The implementation retains coordinate regions and real Rapier handles. A hit is resolved from its actual contact point, clamped to that hit region, and checked against current static occupancy. A removed cell cannot be returned from stale collider geometry. No Rapier handle is coerced into an Int32 slot.

On removal, only the owning 8×8×8 chunk is marked dirty. Flush temporarily materializes its occupied cells, runs the existing exact packer, creates the exact replacement boxes, then releases temporary cells and member-ID lists. Each batch is at most 512 cells. Cuts on both sides of a chunk boundary dirty both owner chunks. An untouched neighboring chunk does not need collision repacking because boxes never span chunk boundaries; unlike surface rendering, collision has no neighbor-visibility mask.

## Actual Rapier checks

The eight tests exercise real Rapier 0.21.0, not mocked ray or collision responses:

1. Pristine chunks have finite clipped sides and eight-layer extent, with zero temporary cell materialization.
2. Removing the first layer exposes the second floor to both a ray and a downward ball shape cast. Removing all eight layers makes both queries miss entirely.
3. Cuts at −9/−8, −1/0, and 7/8 cross negative and positive chunk boundaries without phantom solids. A genuinely untouched chunk retains its native handle.
4. Hits resolve to the live cell at the contact point. A removed outer-bottom root stays `gone` in terrain state and sparse changes; an upward ray reaches the next real cell, not synthetic support.
5. Compact geometry matches independently populated, existing dense-packer geometry after mixed cuts: 315 vertical probes, 40 exterior horizontal probes, and 520 probes originating at every lattice cell center. The last group catches buried phantom solids invisible to surface-only rays.
6. Two successive real CCD balls pass through the same full-depth hole. An adjacent ball lands on real intact soil.
7. Partial HP damage does not repack. Promoting a cell to moving state and invalidating its original coordinate vacates its old static position without creating a fake collider at its moved pose.
8. Construction from preedited terrain is explicitly rejected rather than treating old holes as pristine.

This is not a proof of the complete projectile/secondary-impact/rubble lifecycle, support graph, or save importer. The projectile test uses actual Rapier dynamic CCD balls, not the game's complete weapon participant.

## Three-sample city ground-only measurement

Each sample ran in a separate fresh Node process with Rapier initialized first and `--expose-gc`. All six runs were sequential; every world was freed. Both paths use the same finite city descriptor and original ID ordering. The dense reference deliberately materializes ordinary soil Cell records, invokes the unmodified production packer, and retains its packed cell IDs and cell-to-collider Map. It is not a measurement of production's complete simulation initialization.

Median measured stage times:

| Stage | Compact | Dense ground reference |
|---|---:|---:|
| Descriptor and historical ID indexes | 11.14 ms | 11.69 ms |
| Materialize 401,800 ordinary Cell records | 0 | 429.76 ms |
| Existing exact packing of all soil | 0 | 389.65 ms |
| Native colliders plus retained memberships | 7.94 ms | 50.17 ms |
| Sum of measured pre-step work, per sample | 19.59 ms | 877.01 ms |
| First native physics step | 59.22 ms | 55.05 ms |

The pre-step sum excludes forced collection between measurement stages, module loading, and Rapier initialization. These are local prototype measurements, not game load-time promises. Native first-step work is not improved, as expected: both paths have the same 832 collider topology.

Separately measured storage evidence:

- Terrain historical-ID arrays: exactly 401,800 bytes in both paths; no mutable terrain chunks for pristine ground.
- Retained packed member IDs and cell-to-collider entries: compact 0/0; dense 401,800/401,800.
- Median post-GC JS heap increase over post-Rapier-init baseline: compact 1,098,032 bytes; dense 143,124,352 bytes. Objects were kept reachable through an explicit root during collection. These deltas include the measured adapter/reference payload and runtime overhead, not just terrain arrays.
- Median sampled process RSS increase: compact 12,455,936 bytes; dense 311,771,136 bytes. RSS includes allocator behavior and released intermediate allocations and is **not** a precise retained-native-memory or peak-memory measure.
- ArrayBuffer increase: 401,840 bytes in both; 401,800 bytes are the known terrain index arrays. The remaining 40 bytes are not attributed to terrain storage.
- Rapier serialized snapshot length: 200,700 bytes in every sample. This is a serialized size, **not** native resident bytes. Equal lengths do not establish byte-for-byte serialization equality.
- Node external-memory deltas were negative because initialization buffers were collected after the baseline; they must not be advertised as native-memory savings.

Raw three-sample results are `city-compact-1.json` through `city-compact-3.json`, `city-dense-1.json` through `city-dense-3.json`, and `city-summary.json`. The unsuffixed JSON files are exploratory earlier measurements and are not used in the summary.

## Integration gates and limits

- The provider must expose immutable original coordinates and dirty-chunk revisions before restore integration. Current moving poses cannot identify original collision chunks. This proof requires pristine construction and explicit invalidation by original lattice coordinate.
- The caller must flush topology edits before its normal physics step and scene queries. This adapter does not independently step a second world.
- Root metadata is terrain state, not an extra physics constraint. Hierarchical global support, root reachability, above-ground interfaces, and detachment remain separate work.
- Dynamic/rubble bodies continue to need the existing body lifecycle. The spike only removes vacated static membership.
- No renderer, full-array API, sparse strict validator, legacy save, world replacement, resource-budget, or mobile performance claim is made.
- Dirty chunks can eventually become expensive after extensive destruction. The proof removes pristine-city allocation, not the cost of genuinely fragmented or moving material.

## Reproduce

From this folder, using the symlink to the project's existing node_modules, without installing anything:

```sh
node --import tsx --test --test-concurrency=1 compact-colliders.test.ts
../../hepingmoniqi-v09/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions compact-colliders.ts compact-colliders.test.ts city-ground-benchmark.ts
node --expose-gc --import tsx city-ground-benchmark.ts compact
node --expose-gc --import tsx city-ground-benchmark.ts dense
```

`red-test.txt` records the initial missing-behavior failures. `proof-test.txt` and `typecheck.txt` contain the final focused checks. Production's unchanged regression suite is recorded separately in `production-regression.txt`; consult its final status rather than assuming the spike tests cover production.

## Final verification

- Focused actual-Rapier proof: 8 passed, 0 failed (about 1.15 seconds).
- Strict TypeScript no-emit check for the adapter, tests, and benchmark: passed.
- Full existing production `npm test`: 411 tests, 410 passed, 0 failed, 1 optional benchmark skipped (about 53.46 seconds). This command was already running when the lead reported equivalent prior verification, so it was allowed to finish.
- Three fresh compact and three fresh dense city-ground samples all passed their finite-boundary probes and 832-collider assertions; all worlds were freed.
- No production integration, external upload, publication, CI trigger, remote write, dependency installation, or user-computer action was performed by this spike.
