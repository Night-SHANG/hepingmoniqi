# Next same-city A/B: minimal interfaces, not a replacement core

The next experiment should retain Three, current game content, the existing single Rapier host, and existing ordnance/secondary-damage behavior. Introduce narrow storage/query adapters so the A/B can isolate representation cost. Do not introduce another physics engine, generic ECS, job framework, or a second support system in the same change.

## 1. One static-cell store facade

Keep stable external cell IDs. A compact numeric reference may be internal only.

```ts
type CellRef = number;
type StaticState = 'static' | 'departed' | 'gone';
type ChunkKey = number;

interface StaticCellStore {
  readonly logicalCount: number;
  readonly revision: number;
  refForId(id: number): CellRef | null;
  idForRef(ref: CellRef): number;

  // Immutable ORIGINAL occupancy: necessary for the existing support algorithm.
  originalRefAt(x: number, y: number, z: number): CellRef | null;
  originalPosition(ref: CellRef, out: MutablePoint): void;
  originalNeighbor(ref: CellRef, direction: 0|1|2|3|4|5): CellRef | null;

  // Live fixed occupancy: excludes gone, dynamic, queued, and settled rubble.
  staticRefAt(x: number, y: number, z: number): CellRef | null;
  state(ref: CellRef): StaticState;
  hp(ref: CellRef): number;
  maxHp(ref: CellRef): number;
  anchor(ref: CellRef): boolean;
  spec(ref: CellRef): Cell; // owned on-demand value, not a retained city cache

  forEachStaticInAabb(bounds: Aabb, visit: (ref: CellRef) => void): void;
  forEachStaticInChunk(chunk: ChunkKey, visit: (ref: CellRef) => void): void;
  applyHp(ref: CellRef, hp: number): void;
  depart(ref: CellRef): void;
  remove(ref: CellRef): void;

  // Independent cursors: collider consumption must not steal renderer changes.
  changedRefs(sinceRevision: number): ChangeBatch<CellRef>;
  dirtyChunks(sinceRevision: number): ChangeBatch<ChunkKey>;
}
```

This is an interface sketch, not compiled code or a new subsystem implementation. `spec()` is for a requested value, small compatibility range, debug export, or save validation; hot loops should read numeric properties and reuse output points.

Storage behind it:

- Terrain: finite bounds/layer constants, two per-column Int32 rank arrays where historical ID mapping needs them, and lazy typed dirty chunks. Original position and metadata are derived.
- Structures/roads/trees/bridges: typed columns for original coordinates, ID, material/role/object/group indices, HP/max HP, color, and state. Object strings/palettes live once in dictionaries. Above-ground occupancy uses spatial chunks with numeric local slots, not one retained coordinate string/object per cell.
- Current game IDs fit signed Int32, but the generic existing fixture contract permits any safe integer. Guard ID ranges before selecting Int32 or use Float64 for IDs; never silently truncate imported/test IDs. Internal slot arrays can remain Int32.
- Terrain/structure boundaries share `originalRefAt` and `staticRefAt`; no collision at Y=−1/0 may disappear between providers.
- Dynamic/rubble map retains only cells that actually departed. Keep the current chunk/body state and poses initially, rather than changing storage and rigid-body math simultaneously. The static store remembers departure so the original location remains empty even after rubble moves or is destroyed.

Above-ground objects remain explicit in this phase; they are not deleted to hit a benchmark. Typed arrays are storage, not reduced simulation fidelity.

## 2. Support queries, not a per-cell six-neighbor table

Keep the public `SupportGraph.remove(ids)` / `unsupported()` contract and compare exact member IDs to the current implementation.

The minimal adapter should let support read coordinates, material/object index, anchor, and neighbors from the store instead of constructing copied LatticeVoxel objects and an Int32[6 × N] adjacency array. Preserve existing ownership/present state and face-counting rules while this change is isolated.

Critical distinction: the current `leave()` visits original neighbors and separately checks `present` and the batch's `done` set. Replacing its neighbor source with a live-only lookup can silently miss face decrements and split bookkeeping. `originalNeighbor()` must return the original neighbor ref even if either cell has just been removed; live occupancy is a separate API.

This query adapter by itself does NOT remove all O(N) support startup work: existing seeded partitioning still traverses every cell. Measure it honestly in the same-city A/B. If startup remains dominated there, the next bounded step is the implicit pristine-component/local split optimization described in `AUDIT.md`, gated by independent support parity tests. Do not silently swap in a second unverified global solver during the storage experiment.

## 3. Dirty-chunk collider facade

```ts
interface StaticColliderIndex {
  flushChanges(): void;
  colliderForCell(ref: CellRef): RAPIER.Collider | null;
  resolveHit(handle: number, point: Point): number | null; // stable public cell ID
}
```

Pristine finite terrain chunks make direct clipped boxes. Dirty chunks use the existing exact material-aware packer on bounded temporary data. Above-ground chunks can use the existing packing policy unchanged. Retain box geometry and local membership lookup, not a global Map entry and a box member list for every pristine terrain cell.

HP-only changes invalidate rendering/save state but not static collision topology. Destruction/departure invalidates the owning collider chunk. Neighbor render faces may also become visible. Flush before any native query or physics step that depends on the new occupancy.

Use local box-array indices if a typed membership table is needed, not truncated Rapier handles.

## 4. Keep the existing RapierHost and ordnance contract

No changes are required to the public `StructuralPhysicsHost` methods:

- `world`: the same single Rapier World.
- `register`, `advance`, `epoch`, and replacement callbacks: unchanged ownership/lifecycle.
- `cell(id)`: first read a departed dynamic/rubble record when present, otherwise derive the static/gone value from the store. Return owned data as today.
- `colliderCell(handle, point)`: use the existing individual/dynamic mapping, otherwise call the static collider facade's exact hit resolver.

Ordnance continues sharing this host/world, never creates separate terrain physics, and remains registered for the same before/after-step callbacks. Projectile hit-to-cell mapping and damage attribution still use stable IDs.

Keep `destroyCell`, `spawn`, `activate`, `fracture`, `settle`, `wake`, queue ordering, active-body budget, contact episodes, and impact commands semantically unchanged while their reads/writes are routed through the facade. Secondary impact targets can be untouched implicit terrain; an impact must materialize only the necessary dirty chunk, not the whole world.

The new dynamic map is NOT a separate simulation. It is a sparse record table inside the same authority. Settled rubble remains in that table with its real current pose and native colliders, rather than being written back into original lattice slots.

## 5. Keep external schema 9

Do not change the public save shape merely to test in-memory representation:

- Keep `schemaVersion: 9`, `structural-game/v1`, map/fixture IDs, totalCount, epoch, round/research fields, objective counts, and compact change-row encoding.
- The same sparse rows reference the same original cell IDs. A missing row still means deterministic pristine state.
- Preserve body transforms/membership, queue, shots, processed commands, contacts/episode counts, event history, reward suppression, and active-body budget validation.
- Derive base cells through the provider during compaction and validation. Add an explicit internal `restoreCompact`/provider-validation path; do not make the existing strict full `restore()` accept an incomplete array under the same contract.
- Validate every row and body/reference before replacing the active world or notifying participants. Check all departed cells appear in valid body records; default-pristine cells cannot masquerade as a body member.
- Keep the existing exact historic geometry-count branch (city 184,681, neighborhood 50,016) and its migration-pending behavior. Old-root geometry must not become current full-rectangle geometry in place.
- Full `structural-simulation/v1` snapshots and their literal JSON signatures are a separate compatibility boundary. New internal formats can be versioned later; do not reinterpret old signature strings or claim a new short hash matches them.

Sparse validation must preserve the full original checks. The spike's `restoreChanges()` does not meet those requirements and must not be copied into production as a validator.

## 6. A/B acceptance boundary

First compare existing and provider-backed static authority on the same content/IDs, before changing rigid-body math. Then compare bounded blast sequences, support outputs, packed geometry, projectile hits, and saved/restored state. Measure city selection, activation, first rendered frame, idle memory, save/restore peaks, and repeat entry/exit separately.

The nine passing spike tests prove storage/query equivalence, not integrated gameplay. In particular, the dynamic/rubble test writes pose records directly: it does not run Rapier, drop a body, produce a secondary impact, settle debris, or wake rubble. Real secondary-damage/persistent-rubble verification remains an explicit A/B gate, not a claimed result.

No production change or new unknown project is required to adopt this interface proposal.
