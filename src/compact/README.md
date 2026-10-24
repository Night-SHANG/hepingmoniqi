# Compact single-world representation

This development branch preserves the existing maps, gameplay UI, finite soil,
weapon inventory and schema-9 game saves. It replaces pristine per-cell objects
with an implicit eight-layer soil descriptor and typed structure columns. Only
changed cells acquire mutable state. Important detached pieces still use the
same authoritative Rapier world and retain their stable IDs and damage state.

- `fixture.ts` / `store.ts`: immutable source-order metadata and sparse authority.
- `support/`: MIT-derived incremental support graph, hydrated from validated
  deterministic build-time partitions. See its provenance and license files.
- `static-colliders.ts`: exact regional material boxes, with holes rebuilt before
  dependent queries; no unbreakable fallback floor.
- `surface-renderer.ts`: exposed chunk faces and sparse moving-cell transforms.
  Partial HP changes preserve the established damaged-color shading.
- `snapshot.ts`: strict sparse validation and existing four/twelve-column save
  encoding. Restoration never expands a pristine city to a full state array.
- `query-refresh.ts`: when Rapier's BVH is stale, exact native collider queries
  provide immediate ray/shape results without advancing simulation time.

## Reproducible generated assets

Run `npm run prepare:compact` after installing dependencies. `npm test` and
`npm run build` also perform this preparation. The compiler checks source recipe,
map/seed, payload and topology; stale or missing generated assets are rebuilt.
The browser loads only its requested binary asset, validates it, and does not
run the initial city partition algorithm. Tests load the same generated assets
through a Node host adapter, not a different support implementation.

## Evidence boundaries

An isolated browser city preview measured 588 ms cold and 406–514 ms subsequent
render-submit/frame-opportunity latency in Chrome with software rendering, versus
1.94–3.16 seconds for the old representation at the same viewport. These are not
GPU presentation times, game startup measurements, or Android performance claims.
The first native single-world city sample retained all 454,913 logical cells and
initialized in approximately 1.61 seconds, with 34.6 MB JS heap after forced GC.
Its process memory includes JS, WASM and runtime overhead; it is not GPU memory.
Full game interaction and repeated destruction/scene lifecycle checks are separate
acceptance gates. A preview result alone does not qualify a playable release.

The first integrated Chrome run (40064477963, commit 015cec17) completed twenty
real cumulative city detonations and ten city enter/leave cycles. It passed the
functional assertions, but start-to-interactive observation still took
3.49–5.08 seconds, so performance was not accepted. Natural city JS heap during
destruction was roughly 30–34 MB; separate backing-storage, WASM, and GPU costs
must not be conflated with that number. Subsequent changes reduce repeated
validation work and unnecessary idle render submissions without changing the
world or weakening validators. Their browser performance verdict is pending.
