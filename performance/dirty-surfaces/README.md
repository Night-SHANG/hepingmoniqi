# Local mutable dirty-surface proof

This directory is an isolated CPU geometry experiment. It is not imported by the game and does not create Rapier bodies, invoke a solver, submit GPU work, open a browser, or change production/UI/remote state.

## Contract

- `CompactSurfaceSource` combines existing `CompactTerrain.staticAt` with `CompactStructures.staticAt` / scalar `colorAt`. Soil colors use the current project formula. It never calls `cell()` during rendering and never retains a `Cell` / `CellView` inventory or duplicate city color cache. The initial fixture's structure source array is used only to construct the compact authority; no eight-layer terrain object array is made.
- Coordinates and IDs refer to a fixed original inventory. Terrain and structure coordinates are disjoint in this fixture. Dynamic/rubble cells no longer occupy their original static position, and moving poses are not rendered by this static generator.
- The caller must wrap each authority mutation with `source.captureEdit(id, mutation)`, then pass all returned edits to `mesh.applyEdits`. A later `mesh.rebuildDirty()` consumes the deduplicated dirty set. This explicit mutation-boundary API is the experiment's correctness contract, not automatic integration with production events. It does not poll `changes()` or `dirtySince()`, and uses its own monotonic revisions. Direct authority mutations that bypass notification are unsupported. Events are trusted internal authority records, not arbitrary public input. After whole-store restore/reset, construct a NEW source and NEW renderer; the old revision ledger cannot be reused. No reset/reinitialize API is claimed here.
- Initial chunk registration enumerates terrain chunk coordinates and structure scalar coordinates once. Initial geometry visits those registered chunks once. Later edits resolve their original coordinate and mark only the containing render chunk, plus an existing face-sharing chunk when the edited coordinate is actually on that boundary. Edge/corner diagonals are never marked.
- HP-only and already-absent edits do not invalidate geometry. Duplicate/reordered revisions do not rebuild again, and a later no-op cannot suppress an earlier real occupancy change. Each dirty chunk gets one new geometry object/revision per flush. Every unaffected chunk retains identical geometry object and typed-array references.
- Each rebuild has one bounded transient color/occupancy halo: Uint32 colors plus Uint8 occupancy. Halo queries are counted, including finite-world air. The whole-city cache retains only per-chunk typed output and sparse edited-ID revisions, not cell objects or halos.

## Exact output

Every exposed unit face emits the same six vertex coordinates, normal vectors and uint32 color as the existing preview oracle. Output is non-indexed Float32 positions, Int8 normals, and one Uint32 color per face: 94 typed bytes per face. This is a proof format, not a claim that a production shader consumes these buffers unchanged.

The independent small dense oracle verifies live edits, full-depth shafts, new floors, cavity walls, negative boundaries, static-to-dynamic departure, revisions, and identity. `equivalence.ts` compares a sorted SHA256 over every face's full position/normal/color payload against the existing initial-city preview oracle. The existing preview oracle was independently checked against the dense city elsewhere. No dense city Cell array or Rapier is created by this verification.

## Reproduce

From this directory, using the existing project dependencies only:

- `npm test`
- `node --expose-gc --import ../../hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs equivalence.ts`
- `node --expose-gc --import ../../hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs profile.ts 16`
- `node --expose-gc --import ../../hepingmoniqi-v09/node_modules/tsx/dist/loader.mjs profile.ts 32`

The profile applies one radius-2 topsoil cut (23 cells), flushes it, then applies 20 additional nonoverlapping cuts (460 cells), flushing after each. Timing separates authority mutation/invalidation, occupancy halo reads, face counting, and typed emission. Query counts and emitted bytes are deterministic; timings are machine/run dependent. This is occupancy-only surface regeneration, not complete blast, support, physics, upload, browser, or FPS performance.

Final measured results and verification commands are recorded in REPORT.md and JSON files.
