# Same-city compact representation: local phase report

Date: 2026-10-24. These are isolated CPU and bounded Rapier proofs, not a new playable release or browser-performance acceptance.

## Why the city card stalls

The production selection path synchronously creates all 454,913 authority-shaped cell records, copies them into nested render records, and builds full occupancy/dirty indexes. Only after this work are 301,198 interior cells excluded from rendering. Three fresh native samples measured a median 2.641 seconds before GPU upload or browser paint. No Rapier world is necessary to reproduce this menu stall.

A separate map-switch ownership bug erased newer occupancy entries while removing stale coordinates. The local two-guard fix restores exact visible-ID membership across city → courtyard → city and prevents erroneous capacity doubling. It does not solve the architecture latency. Local production regression: 410 passed, one optional benchmark skipped, zero failed.

## Verified isolated boundaries

1. Exposed surface preview: implicit finite eight-layer terrain and structure-only generation produce the exact same 203,018 exposed faces, coordinates, normals and colors. Three fresh compact CPU samples were 388.8, 355.0 and 335.3 ms (median 355.0 ms). Output has 406,036 triangles and 19.08 MB of typed buffers. The built A/B browser viewer has not been executed. CPU build is not browser first-frame latency.
2. Terrain state: pristine terrain uses a finite descriptor and historical-ID arrays, with mutable chunks allocated only on edits. Nine focused tests cover IDs, HP, neighbors, eight-layer holes, sparse changes and pose ownership. Pose-storage tests alone are not dynamic-physics verification.
3. Static terrain collision: eight real Rapier tests pass, including two successive CCD balls through a full-depth hole and exact comparison against 875 independent dense-reference rays. Both city ground-only representations have 832 native colliders. Median measured pre-step work is 19.6 versus 877.0 ms; post-GC JS heap increments are about 1.10 versus 143.12 MB. The first native physics step is unchanged. This does not measure the complete city or its buildings.
4. Support correctness oracle: compact typed traversal preserves exact unsupported members against the existing MIT-derived graph in bounded tests. Full-city global traversal still costs about 52 ms per query. It is a useful correctness oracle, not an acceptable per-frame replacement for the existing incremental chunk graph.

## Recommended next implementation boundary

Keep Rapier as the sole dynamic authority, the licensed chunk cut/leave/split graph, all current IDs and research, and the approved UI. Replace storage/access boundaries rather than rewriting game rules:

- Surface-only selection geometry, with no full game fixture or world construction.
- Implicit pristine terrain plus typed above-ground records, sparse changed HP and dynamic poses.
- Existing incremental support graph with computed immutable adjacency and compact metadata, rather than a whole-city flood on every hit.
- Finite per-chunk collider descriptors and immediate dirty-chunk rebuilds before queries/steps; no hidden plane and no lost holes.
- Bounded dynamic pieces retain current contact, reward, sleep, reset and save semantics. Decorative particles never replace authority.

The components are not yet joined. Restoring edited terrain before collider creation, shared schema-9 validation, dirty surface updates, dynamic/rubble state and whole-world disposal remain explicit integration gates. No measured partial saving should be summed into a claimed final game memory figure.

## Acceptance still required

Same browser, viewport and city: cold/warm card click to actual city presentation; Start to real picking/projectile interaction; 20 explosions; ten city round trips; main-thread long tasks; before/after/GC memory with active-world counts. JS heap, WebAssembly/native allocations and GPU estimates must be reported separately. Save/reload, holes, foundation collapse, secondary damage, persistent rubble, stale epochs and duplicate rewards must still pass after integration.

Galaxy-scale gameplay needs separate volume and region hierarchies, not this city lattice repeated through space. That hierarchy is not implemented by these proofs.

No new remote commit, upload, workflow or release was performed in this phase.

## Official-document cross-check

Three's voxel geometry guide explicitly recommends generating only exposed faces and allocating bounded occupied cells/chunks instead of a separate mesh for every voxel: https://threejs.org/manual/pages/voxel-geometry.html . This supports the representation change, not a claim that Three supplies a complete destruction engine.

Rapier's JavaScript 0.21 collider guide describes finite shape colliders and warns that removed handles may be reused: https://rapier.rs/docs/user_guides/javascript/colliders/ . Compact collision metadata must therefore resolve current live occupancy and retain epoch/stable logical identities; a native handle alone is not a permanent cell identity.

Independent lead verification of preview, terrain, support and collider test files: 33/33 passed in one serial run (`/tmp/compact-phase-independent.txt`). The additional structure-store verification is tracked separately until its final run completes.

## Active next checkpoint

A separate `incremental-support` proof is adapting the existing licensed cut/leave/split/unsupported implementation to immutable scalar storage access and computed original neighbors. Exact seeded ordering and batch edge accounting are retained for the first A/B. Its initial cut/seeding cost may remain significant; removing object storage does not itself prove low initialization time. The full-cell traversal above remains a test oracle only.

### Production call sites that must change together

The current simulation constructor still deep-copies `fixture.cells`, serializes the whole original array as `fixtureSignature`, and builds `originals`, `cells`, coordinate strings, chunk member arrays and full view indexes. `liveViews()` and first `viewChanges()` publish every cell. Replacing only the terrain generator would immediately expand compact data again at these boundaries. The new store must be consumed directly by damage/support/static collision queries, with sparse dynamic state and dirty surface chunks. Save validation must preserve legacy schema-9 identity without expanding an entire pristine city for every write; any signature migration needs explicit compatibility tests and must not discard old damage/research.

## Completed upper-structure store and combined check

The 53,113 above-ground cells reconstruct exactly, including all 36 buildings and 47 interned object IDs. Pristine typed payload is 2,496,311 bytes; changed HP and dynamic poses are sparse owned records. Three fresh-process source-release comparisons measured median retained heap plus ArrayBuffers of 11,313,408 bytes for source Cell specs versus 2,568,359 bytes for the compact store. WeakRefs confirmed collection of the source array and sampled first/middle/last Cells in each compact run. This compares immutable structure metadata, not the whole simulation.

Lead independently ran all five isolated test groups together, serially: 45/45 passed (`/tmp/compact-phase-all.txt`). This includes 11 structure-store checks and the new original-terrain-coordinate ownership test. The incremental MIT support adapter remains a separate unfinished checkpoint.

## Incremental support checkpoint completed

The actual MIT-derived cut/leave/split/unsupported bodies now use compact metadata and computed original neighbors. Eleven tests passed, including seeded chunk membership and reciprocal edge order, randomized batches, invalid/preedited input rejection and explicit root semantics. Six serial fresh processes matched all 120 ordered unsupported-component hashes.

Incremental query medians were 1.10–1.28 ms (p95 2.11–2.49 ms); one 13.20 ms outlier remains disclosed. Local cuts were 2.71–3.31 ms median. Initialization remains 1.85–1.91 seconds, principally the unchanged seeded cut stage (1.68–1.74 seconds). This resolves the repeated global-flood approach, not startup latency. The next isolated step is a versioned, validated pristine partition binary plus hydration; that work is still in progress.

### Rendering trade-off to measure, not hide

The native preview's 19.08 MB output includes packed per-face colors. Its current Three viewer expands colors into linear Float32 vertex attributes to preserve material color semantics, so estimated uploaded position/normal/color buffers are larger than that native output. Surface-only geometry reduces submitted triangles versus full cubes but does not automatically reduce GPU buffer memory versus instancing. The viewer records its attribute-byte estimate; actual graphics residency, shadow pass cost and ray picking still require browser measurements. An indexed or instanced-face layout may be evaluated later without changing occupied geometry; it is not claimed implemented now.
