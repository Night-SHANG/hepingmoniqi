# Compact support integration provenance

This production adapter reuses executable MIT code, not merely an algorithm idea.

Upstream: Steven Bobyn, three-voxel-destruction, pinned commit
`8c4b058866d78f161181fd1404aca76d9051457b`. The complete MIT notice is retained
in `LICENSE`. Original source evidence remains in the application's
`vendor/three-voxel-destruction/upstream` directory.

`indexed-structure.ts` is the proven local incremental-support implementation,
with its imports relocated to this directory. Its material-seeded `cut`, batch
`leave`, damaged-chunk `split`, reciprocal face accounting, Mulberry32 random
source, and `unsupported` graph traversal are unchanged. The relevant upstream
sections are `src/structure.ts` lines 53–58, 89–104, 113–185, 206–232, 235–280,
and 283–314, plus `src/world.ts` lines 85–95 at the pinned commit:
https://github.com/sbobyn/three-voxel-destruction/tree/8c4b058866d78f161181fd1404aca76d9051457b

`pristine-core.ts`, `node-codec.ts`, `node-validation.ts`, and `runtime.ts` reuse
the proven compiled-support and native-WebCrypto code. Their original SHA-256
hashes are recorded in `provenance-inputs.json`. Changes are import relocation, the source-bound reset token factory, and
`runtime.ts` one-pass bounded canonical topology buffering. Its output is
byte-for-byte identical to the original two-pass driver; native hashing and all
semantic validation remain unchanged. That factory consumes an already
validated, single-use token and retains its owned tables privately; each reset
receives independent cloned arrays in a new source-bound single-use token.
Duplicate member, object, root, connected-material, reciprocal geometric edge,
capacity, padding, digest, recipe, and token checks are not weakened.

`lattice.ts` adapts immutable CompactFixture scalar queries. It retains only a
sorted structure-ID typed array and ranks contiguous negative geology IDs
arithmetically. It never enumerates complete city Cell records, retains a
terrain ID map, or reads mutable live-neighbor occupancy. It rejects overlapping
structure occupancy and invalid IDs before graph construction. Its optional
scalar fast paths prove sorted contiguous structure IDs and all eight terrain
layers against original occupancy and inverse coordinates before replacing
repeated lookups. Noncanonical inputs retain the original accessor route.
Exact ordered-neighbor, topology-byte, and twenty-cut regressions cover parity.

`index.ts` integrates CompactAuthorityStore departures. Initial construction
validates before creating a graph; synchronous reset hydrates the original
validated baseline and replays every sparse non-static departure (gone, dynamic,
or rubble). Graph presence is not rebuilt from a live-neighbor snapshot.

`city-cut-oracle.json` retains the established twenty-cut ordered-membership
oracle, including removed counts. New native tests replay those cuts against the
actual integrated compact fixture. They are correctness evidence only, not new
browser timing, frame rate, Rapier, GPU, or full-game performance evidence.

`index.ts` additionally keeps at most two validated immutable templates keyed by
exact managed-fixture identity. Cached tokens remain source-bound and single-use;
each graph receives independent tables and store-specific departure replay.
Explicit artifact inputs and unbranded fixtures still undergo full validation.
Loader replacement or cleanup invalidates the cache namespace; rejected and
evicted pending entries cannot repopulate it. This is local lifecycle reuse, not
a relaxation of the original artifact validation.
