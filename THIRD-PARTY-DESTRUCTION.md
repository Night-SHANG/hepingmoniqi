# Destruction support and fracture reuse

## Source, version and license

This isolated v0.9 prototype contains actual adapted source from [Steven Bobyn's three-voxel-destruction](https://github.com/sbobyn/three-voxel-destruction), pinned to commit **8c4b058866d78f161181fd1404aca76d9051457b**. The source is MIT licensed, Copyright (c) 2026 Steven Bobyn. Its complete copyright and permission notice is retained verbatim in `vendor/three-voxel-destruction/LICENSE`. The runtime ports also carry attribution headers. This is code reuse, not a claim that independently written flood-fill code is an upstream import.

Unmodified source snapshots are retained as non-executable text under `vendor/three-voxel-destruction/upstream/`. `PROVENANCE.json` records SHA-256 hashes, the pinned repository and source sections. The upstream checkout used for extraction was verified at the commit above. The upstream project and renderer are not bundled or run wholesale.

## Exact reused sections

All line numbers refer to the pinned source, not the adapted file.

| Pinned upstream source | Runtime derivative | Identifiable code retained |
| --- | --- | --- |
| [`src/structure.ts:53–58`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L53-L58) | `vendor/three-voxel-destruction/structure.ts`, `bump` | Add/decrement face counts and delete exhausted graph edges. |
| [`src/structure.ts:89–104`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L89-L104) | `SparseStructure` constructor | Scan positive-axis voxel faces once and write both directed chunk edge counts. |
| [`src/structure.ts:113–185`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L113-L185) | `SparseStructure.cut` | One random same-material voxel seed per grid cell; search the 27 neighboring material cells; nearest squared-distance assignment; split each seed cell into face-connected chunks. |
| [`src/structure.ts:206–232`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L206-L232) | `SparseStructure.leave` | Deduplicate departing voxels, decrement shared face counts and anchor counts, record damaged chunks, then split them. |
| [`src/structure.ts:235–280`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L235-L280) | `SparseStructure.split` | Flood remaining same-chunk voxels, keep the largest connected part, create chunks for others, transfer reciprocal edge counts for their external faces. |
| [`src/structure.ts:283–314`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/structure.ts#L283-L314) | `SparseStructure.unsupported` | Traverse chunk graph from anchored chunks; group unreached chunks into connected unsupported components. |
| [`src/destruction.ts:90–117`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/destruction.ts#L90-L117) | `vendor/three-voxel-destruction/fragments.ts` | Draw three quarters of seeds with distance weights `(1 + d/reach)^(-2*falloff)`, the rest uniformly; assign each voxel to its nearest seed. |
| [`src/world.ts:85–95`](https://github.com/sbobyn/three-voxel-destruction/blob/8c4b058866d78f161181fd1404aca76d9051457b/src/world.ts#L85-L95) | `structure.ts`, `random` | Deterministic seeded Mulberry32 generator replacing ambient `Math.random` in the fracture port. |

## Deliberate adaptations and boundaries

- The original per-building dense `City` storage is replaced by a sparse, global occupied-position lookup plus a dense six-neighbor table. Input cells remain unit-size integer lattice cells. Empty coordinates are genuinely empty; no enclosing solid bounding box is manufactured.
- Initial chunk seeds still partition each authored object and material independently. Support edges and root traversal are now global, so terrain, roads, foundations, buildings, trees and bridges can support one another through real face contacts. Diagonal or corner contact does not support a structure.
- The original implicit object ground-layer fallback is intentionally **removed**. `holds` returns true only for `cell.anchor === true`. Fixture creation is responsible for marking finite-map bottom/boundary terrain roots. A building at `y = 0`, a foundation, a road or a lowest object layer is never anchored automatically.
- Global string-tuple seed keys replace the source's bounded packed numeric keys, avoiding collisions for negative or distant map coordinates. Material sizes retain the source's 10/6/8 grouping: soil/road/stone/roof use 10 cells; wood/glass/metal use 6; foliage uses 8. These values are unit-cell chunking parameters, not claims of matching upstream metre dimensions.
- The adapter owns a copied cell snapshot and its own present-state bitmap. `remove` accepts public IDs, ignores unknown IDs and duplicate removals, updates graph faces before splitting, and never edits caller-owned cells. `unsupported` returns fresh output arrays, does not remove them, and reports complete still-present connected components rather than isolated Voronoi chunks. The caller removes all detached cell IDs when transferring them to dynamics.
- IDs and coordinates must be safe integers. Duplicate IDs and overlapping occupied lattice positions are rejected explicitly. Objects are not required to use contiguous IDs. The snapshot is sorted by public ID to make seeded operations independent of input ordering.
- The optional `fractureCellIds(cells, at, mean, seed = 11)` export ports the actual weighted-seed source algorithm, uses deterministic injected randomness, guards empty input, and bounds seed count to the voxel count. A separate adapter flood then splits labels by material and six-face connectivity so no disconnected or mixed-material set is bound as a rigid fragment. The result is `number[][]`. This helper does not mutate support state or allocate physics bodies.
- The weighted-seed fracture helper is intended for an already-localized detached piece, not an entire city: like upstream it has roughly `O(voxels × seedCount)` nearest-seed assignment cost. Its presence does not imply the physics integration invokes it yet.
- Storey overload, glazing, bonds, GPU compute, upstream rendering, blast classification and upstream physics are not ported here. This module proves connectivity-based support and supplies optional fracture partitions; it does not claim full structural load-bearing mechanics or physically exact material strength. There are no added dependencies.

## Verification

Run the dedicated adapter suite:

`node --import tsx --test src/structural/support.test.ts`

Coverage includes terrain excavation disconnecting a building, two-ended bridge support, internal chunk splits, cross-object/mixed-material support, true holes and diagonal gaps, root removal, duplicate/batched face deletion, immutable caller data, invalid coordinates and duplicate occupancy, and 18 deterministic random scenes with 28 sequential cuts each compared against an independent cell-level flood fill. Random scenes include homogeneous monoliths as well as mixed objects/materials. Fracture tests check deterministic seeded partitions, different-seed behavior, complete one-time cell coverage and connected homogeneous output.

The inherited top-level test command may not discover subdirectory tests unless the integrating branch includes `src/structural/*.test.ts`; the explicit command above is authoritative for this adapter. No production v0.8 files or remote repositories are modified by this work.

### Measured support integration (cloud Node, 2026-10-23)

These are single-run diagnostics, not browser FPS or device-independent guarantees. Actual generated fixtures were used with the adapter: lab 4,570 cells, neighborhood 27,301, city 102,451. All initially returned zero unsupported cells. Construction took approximately 39/296/765 ms; initial graph queries approximately 2.04/1.48/2.44 ms. Removing the 24 bridge-pier cells in each map produced exactly one 55-cell unsupported bridge component, containing all 33 deck cells. The city cut took 0.28 ms plus a 1.65 ms support query.

Removing only the 80 topsoil cells under lab building 01 detached all 345 of that building's cells and left neighboring building 02 supported. A separate homogeneous 151,200-cell stress volume built in about 871 ms; a local 2,969-cell cut took 8.82 ms and the subsequent graph query 0.45 ms.

Tiny positive fracture means, including `1e-9` and `Number.MIN_VALUE`, are covered explicitly: seed count and output group count never exceed input cell count. The adapter suite currently contains 15 passing tests.
