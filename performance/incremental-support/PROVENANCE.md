# Indexed compact adaptation provenance

This isolated proof reuses executable code, not merely an idea or algorithm name.
`indexed-structure.ts` is directly derived from the current project's MIT adaptation
at `../../hepingmoniqi-v09/vendor/three-voxel-destruction/structure.ts`. It preserves
`random`, `bump`, seeded `cut`, batch `leave`, damaged-chunk `split`, and chunk-graph
`unsupported` control flow. The main changes are an `IndexedLattice` accessor
interface, sorted-index object enumeration, original occupancy computed on demand,
and explicit setup/representation diagnostics. There is no per-cell proxy cache.

Original upstream: Steven Bobyn, three-voxel-destruction, MIT, pinned commit
`8c4b058866d78f161181fd1404aca76d9051457b`.
Complete MIT notice is retained in `LICENSE`; executable adapted source retains its
attribution header. Original sources are already retained as non-executable text
in the project's `vendor/three-voxel-destruction/upstream` directory.

| Upstream source | Reused section |
| --- | --- |
| [structure.ts lines 53–58](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L53-L58) | Reciprocal shared-face increment/decrement helper. |
| [structure.ts lines 89–104](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L89-L104) | Positive-axis face count construction. |
| [structure.ts lines 113–185](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L113-L185) | Material-grid seeds, 27-cell nearest seed search, face-connected seed parts. |
| [structure.ts lines 206–232](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L206-L232) | Batch leaving, face and root counts, damaged chunks. |
| [structure.ts lines 235–280](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L235-L280) | Largest-part retention and external face transfer after splits. |
| [structure.ts lines 283–314](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L283-L314) | Anchored chunk traversal and unsupported connected pieces. |
| [world.ts lines 85–95](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/world.ts#L85-L95) | Deterministic Mulberry32 random source. |

The parent adaptation already replaced per-building storage and implicit grounding
with global occupancy, cross-object faces, explicit removable roots, and sorted
public-ID snapshots. This proof preserves those adaptations; it does not claim
byte-for-byte equivalence with original upstream city/physics behavior.

`incremental-support.ts` supplies immutable metadata from existing CompactStructures
scalar/index getters and CompactTerrain.originalPosition/idAt. Original occupancy
is never filtered by either store's mutable static/dynamic/gone state. The graph
owns presence independently, rejects preedited store initialization, and requires
explicit remove calls when live cells depart. Whole-world replay is not implemented.

Sparse fixture geometry is reused from `../support-ab/sparse-structure-fixture.ts`;
its production parity is covered by the sibling suite. This task modified only
files in this incremental-support directory. Related public getter changes were
made and verified by their owning parent/structure-store workers.
