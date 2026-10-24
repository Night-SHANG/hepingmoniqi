# Compact finite terrain: architecture audit and throwaway proof

Status: representation proof only. No production file changed. No new engine, package, external write, local-computer use, or browser workaround. The current game has not become faster from this spike.

## Decision

Use an implicit pristine finite terrain descriptor with copy-on-write 8 × 8 × 8 chunks, plus the existing explicit above-ground cells and dynamic/rubble lifecycle. Adapt authority, support, collision lookup, rendering, and saves together. A fixture-only replacement is insufficient because current consumers immediately materialize all cells again.

All 401,800 city soil cells remain addressable and destructible across the same eight layers. All 36 buildings remain. There is no infinite plane, invisible bottom, shortened depth, reduced HP, missing interior, or camera-dependent simulation deletion.

Alternative A, full typed arrays for all terrain, is a reasonable lower-risk intermediate storage step: Float64 HP and one state byte need 3,616,200 bytes for 401,800 cells, excluding metadata and other systems. It still initializes O(number of cells), so it does not eliminate pristine-city work.

Alternative B, one Map entry per changed cell, starts small but has variable object/hash overhead and poor locality after larger blasts. It can be useful as a very-small-overlay stage before converting a touched chunk to typed arrays. This is an optional optimization, not needed for the proof.

The recommended implicit-plus-chunks approach matches the current exact collider packer's 8³ locality, removes per-pristine-cell mutable state, and makes bounded queries natural. It is a substantial adapter migration, not a one-line optimization.

## What the current code actually allocates and scans

Paths below are relative to `hepingmoniqi-v09`.

- `src/structural/game-fixtures.ts:20–49`: for city, first constructs the older three-layer structural fixture, filters its non-terrain cells, builds column Maps, then expands every formal column into eight Cell objects. The temporary old terrain is thrown away.
- `src/structural/fixtures.ts:83–95`: soil is constructed before a sort and global positive-ID assignment. Removing this step naively changes building IDs, even if their shapes stay identical.
- `src/structural/simulation.ts:87–103`: deep-copies the full fixture, retains the full JSON signature, builds original/state/id/position/chunk/view-index maps. `initial()` at line 280 builds one State per cell before support and packing.
- `src/structural/support.ts:10–43`: sorts/copies cells into IDs and LatticeVoxel records and makes another ID-to-index map.
- `vendor/three-voxel-destruction/structure.ts:58–83`: allocates chunk and present arrays, a six-neighbor Int32 array, string occupancy, and object buckets. The six-neighbor array alone costs 9,643,200 bytes for city soil; this is not total support memory. Seed partitioning then examines neighboring seed buckets per cell.
- `src/structural/simulation.ts:143–164`: packed boxes retain `cellIds`; every packed member is also inserted into the cell-to-collider Map. Packing reduces native collider count but does not make the JS cell state compact.
- `src/structural/simulation.ts:109–130`: reset/read-cache initialization publishes one immutable view per cell. Later deltas are already sparse and useful, but first publication is still dense.
- `src/structural/game-world.ts:80–83`: retains full fixture/base maps, a Voxel per cell, and a complete immutable Voxel array.
- `src/voxel-renderer.ts:20–74`: surface culling still retains Entry objects and an occupancy key for all cells, including hidden interiors.
- `src/structural/simulation.ts:299`: a blast first copies/enumerates the complete cell Map and filters by distance. `checkRubbleSupport()` rebuilds buckets from all static/rubble cells.
- `src/structural/game-world.ts:49–63,174–180`: saves are already sparse externally, but restore constructs a complete pristine snapshot, expands all rows, recreates the JSON fixture signature, and validates the expanded state.

These are source-level findings, not timing attribution from a profiler. They explain why reducing native static collider count alone is not enough.

## Exact ID plan

Current city has 50,225 columns: 16,446 historical columns and 33,779 added columns. The original column order is X-major then Z because the structural source sorts by Y, X, Z before `game-fixtures` deduplicates columns.

For one-based depth d, zero-based original rank o, and zero-based added rank a:

- Historical cell ID = −(1 + (d − 1) × 16,446 + o).
- Added cell ID = −(1 + 8 × 16,446 + (d − 1) × 33,779 + a).

Do not replace these with one uniform X/Z/depth index: that would silently retarget old damage and body membership.

The proof retains two Int32 arrays per column, rank-to-column and column-to-rank. They total 401,800 bytes (about 0.383 MiB) for city, not 401,800 Cell records. A plain all-original rectangular map needs neither array. Original-column membership must come directly from layout/footprint descriptors; it must not call the old dense fixture generator just to recover ranks.

Non-terrain positive IDs also need preserving. City source starts at 2,000,001 and contains 3 × 16,446 source soil cells before any Y≥0 object. Its first non-soil ID therefore remains 2,049,339. Keep the original above-ground Y/X/Z ordering and source offset. Small-map domain IDs and negative road IDs stay unchanged.

Proof checks include the production historical city sentinel ID −4649 at (−45,−1,43), the corresponding depth-eight ID, first added ID −131569 at (−122,−1,−102), and last ID −401800 at (122,−8,102).

## Required adapters

### 1. Fixture/authority provider

Introduce an internal provider, not a fake lazy Array. It should expose:

- finite bounds, exact logical cell count, objective count, fixture revision/digest;
- `spec(id)` and `idAt(x,y,z)` without retaining returned Cell objects;
- static occupancy and HP read/write;
- bounded iteration/query with a callback or numeric IDs;
- changed-cell iteration and chunk dirty notifications;
- dynamic/rubble records by stable original ID.

Terrain defaults derive HP `[3.2,5.5,9,14,21,30,42,58]`, color, original position, soil role, object ID, and anchor from immutable configuration. Anchors exist only on the actual outer bottom boundary and disappear when those cells disappear. No interior or old-plot edge is rooted.

Use Float64 HP for parity with current JS arithmetic and thresholds. A Float32 migration can alter HP, damage thresholds, and exact save numbers. Static soil loss can be derived from original HP minus current HP within the existing validator's tolerance; detached/gone soil loss is its full original HP. Non-terrain research accounting must retain its current behavior.

The simple proof allocates 512 HP doubles plus 512 state bytes on first edit to a chunk: 4,608 bytes. Fully touched city terrain occupies at most 832 such chunks, 3,833,856 bytes of mutable arrays. Add the 401,800-byte ID index separately. These numbers exclude Maps/Sets, renderer, support, native physics, above-ground objects, and moving poses; they are not total game-memory predictions.

### 2. Exact support, with an implicit pristine fast path

The current support API ultimately returns global six-face connected components that have no surviving explicit anchor. The randomized/material-seeded internal partition is not itself an observable support outcome; preserve exact component membership rather than retaining its dense construction work.

A suitable exact hierarchical implementation:

1. A pristine clipped soil chunk is one connected component with implicit rectangular membership, face occupancy, and a count of actual outer-bottom roots. No seed calculation or per-cell adjacency is needed.
2. On a cut, flood only that chunk's at-most-512 present static cells. Produce exact local component labels, root counts, and six boundary-face label masks.
3. Reconnect neighboring chunk components only where corresponding boundary face cells both remain occupied. Update affected neighbors and above-ground interfaces. HP-only damage does not change topology.
4. Flood the component graph from surviving roots. A local destruction can disconnect a remote island: never assume a chunk is supported merely because it was supported before, and do not limit reachability to a blast radius.
5. Enumerate member IDs only for components that actually become dynamic; mark their original static occupancy absent before the next query/physics step.

The same boundary connector must include roads, foundations, buildings, trees, and bridges. Material/object boundaries do not break support. Diagonal contact is not support. Destroying the last real root can detach the entire remaining world.

The proof compares compact occupancy through the existing production support graph on a small cut-ring fixture, including last-root removal and a building attached to terrain. It does NOT implement or benchmark this hierarchical support algorithm. That is a separate required implementation gate with independent cell-level flood-fill parity tests.

### 3. Exact static collision provider

Pristine chunks can create one finite, clipped, solid soil box directly. Different soil HP and colors do not require collision splits: the existing packer already groups by material, not HP/color. Changed chunks can temporarily materialize at most 512 cells into the current packer, then discard those temporary Cell objects.

Change retained packed-box membership from complete `cellIds` arrays to explicit geometry plus an ID/occupancy provider. Otherwise 401,800 IDs are still duplicated across boxes and Maps. Preserve any compatibility list only in bounded tests or on explicit diagnostic export.

Replace static `colliders.get(id)` with `colliderForCell(id)`: pristine chunk directly returns its box; damaged chunk resolves local occupancy to its box index. Do not assume Rapier handles fit Int32; a compact local table can contain an index into the chunk's handle array instead.

Resolve a packed hit using the box's exact lattice extent and authority `idAt`, verifying live static occupancy. Repack dirty chunks before physics queries. Dynamic/rubble cells keep individual/compound collider paths and original IDs. Actual eight-layer holes remain holes all the way below the map.

Keep the SAME single Rapier World, physics-host ownership, projectile participants, event drain, and world-replacement callbacks. No second terrain world or independently stepped physics loop is introduced.

### 4. Blast and rubble queries

For terrain, intersect the blast AABB with finite bounds, test only integer candidates within the sphere, and read sparse overrides. For above-ground static and moved/rubble bodies, use their proper current-position spatial index or Rapier query plus exact cell tests. Never query moved debris at its original lattice location, and deduplicate overlapping candidate sources.

`checkRubbleSupport` must stop rebuilding a whole-world State bucket index. Query around rubble contacts/AABBs through the same authority/collider resolver, then retain its actual contact-normal/dependency rules. Existing episode keys, hit attribution, processed-event IDs, queued-body behavior, secondary damage, and persistent rubble remain intact.

### 5. Render/query publication

Current `getVoxels()` and `liveViews()` promise complete arrays, so using them on the hot startup path necessarily recreates the large object graph. Add a terrain-aware render source with finite descriptor + dirty chunk revision stream, while keeping `getVoxel(id)` as an on-demand value.

Surface generation should query occupancy directly and retain only actual surface instances or chunk meshes. Do not allocate renderer Entries for every invisible interior. On a cut, invalidate the edited chunk and the six neighboring chunk faces. Preserve color/HP shading, stable hit-to-cell ID mapping, and dynamically exposed lower layers.

The preview should use this same finite descriptor/surface builder without Rapier. Keeping `previewGameVoxels()` dense would keep the bad city-selection latency even if simulation activation improves.

Any legacy complete-array compatibility export should be explicit/on-demand and kept out of routine game loops, progress reads, and setup previews. All call sites in `main.ts`, physics sync, debug hooks, and scene updates need auditing.

### 6. Sparse validation and legacy saves

Current outer `structural-game/v1` saves already omit fixture signatures and pristine cells. Preserve their changes, body queues, transforms, shot/contact episodes, research/round progress, epoch handling, and malformed-restore atomicity.

Validate changed rows and cross-record references directly against `spec(id)` and metadata instead of expanding the whole baseline. Still verify duplicate IDs, bounds, HP/loss, state/chunk membership, rigid transforms, queues, active budget, event/episode references, and research totals. An absent sparse row means pristine only when the descriptor version/hash is validated. Do not weaken strict checks just to avoid dense reconstruction.

Use an explicit compact fixture revision/digest for new internal snapshots. Do not simply substitute a short digest into the existing `structural-simulation/v1` fixtureSignature contract; migrate/version that format or retain the exact historical path when importing it.

Historical irregular-plot saves are special: city total 184,681 and neighborhood total 50,016 use the same fixture string ID as the new geometry but different bounds/root semantics. Preserve the current historical validation and migration-pending/new-round behavior. Never silently fill newly added terrain through restored moving rubble. Historical descriptors require the original column mask and the old outer extent, not the current full rectangle. The spike does not implement that legacy importer.

Direct old full simulation snapshots should be validated through a bounded/streaming historical adapter if supported. A literal full JSON signature is expensive to reconstruct; new saves should not need it. Existing saved data must not be reinterpreted under a changed ID order or new-root layout.

## Proof and measured evidence

Files in this folder:

- `compact-terrain.ts`: throwaway implicit descriptor and typed dirty chunk storage.
- `legacy-layout-columns.ts`: topology-only extraction from current neighborhood/city layout rules. It never constructs buildings, source soil cells, or a physics world.
- `compact-terrain.test.ts`: nine tests, including independent bounded dense oracle and actual production courtyard metadata parity.
- `red-test.txt`: deliberate initial missing-implementation failure.
- `proof-test.txt`: final proof test output.
- `typecheck.txt`: TypeScript verification output (empty on success).

Run from this folder:

    node --import ../../hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs --test compact-terrain.test.ts

Observed last run: 9 tests passed, 0 failed, about 0.43 seconds. City descriptor setup (topology + 2D ranks only) was about 10.6 ms, retaining 401,800 index bytes and zero mutable chunks. This is NOT city load time or a prediction of end-to-end performance. The descriptor test materializes only a handful of queried city Cell values; no dense city is generated. The courtyard oracle creates the existing small-map fixture once and checks all 19,800 soil cells.

Coverage: finite domain, original/added layer IDs, exact HP updates, negative chunk coordinates, six-neighbor occupancy, bounded sphere candidates, all-eight-layer excavation, production packed-box equality, outer-root removal/global support equality, vacated static positions, moved/rubble state records, and sparse change roundtrip. TypeScript strict/no-emit check also passed.

Not verified here: integrated city startup/render timing, full game suite, hierarchical support performance, actual Rapier falling/secondary-impact/rubble lifecycle using the new store, malicious save rejection, legacy geometry migration, or production-memory peaks. The storage roundtrip method is explicitly not the production validator.

## Safe implementation and acceptance order

1. Introduce a provider adapter behind current APIs and golden-test every map's IDs/metadata; keep buildings/objectives/content unchanged.
2. Replace terrain authority and local collision lookup/packing; verify holes, material boundaries, hit attribution, and one-world ownership.
3. Implement exact hierarchical support with randomized cut-sequence parity against an independent dense flood reference, including global root loss and cross-object bridges.
4. Move preview/render/hot query consumers off full arrays; test surface appearance, exposed cavities, negative chunk boundaries, and stable selection IDs.
5. Implement sparse strict restore and legacy adapters; verify invalid input leaves the live native world and in-flight projectiles untouched.
6. Run full regression suites and isolated city load/first-frame/peak-memory measurements. Include repeated entry/exit, crater restore, secondary collapse, settled rubble waking, and large connected-detachment scenarios.

An extreme excavation can still detach hundreds of thousands of true cells. Sparse pristine storage cannot make those actual dynamic collision and render costs vanish. Body-level transforms and exact compound collider packing may reduce that cost, but they require separate parity checks. The active-body budget is not a cell-count budget. Do not advertise this representation proof as solving arbitrary whole-city motion.
