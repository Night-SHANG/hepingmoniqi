# Compact single-world integration checkpoints

This plan does not authorize remote writes and does not replace the playable v09 until checks pass. UI, maps, weapon limits, research and destruction rules remain unchanged.

## 1. Compile deterministic pristine support

For each existing map and fixed seed, run the existing MIT partition algorithm during asset preparation. Encode index-to-chunk membership, packed chunk member offsets, object-ID table, anchor counts and reciprocal face edges in typed arrays. Record a reproducible map/recipe version, seed, source checksums and payload digest. Do not cache Cell objects or a JSON dump of the full city.

Validate identity and all index/count/edge invariants before hydration. A wrong map/version, truncated data, duplicate or missing member, invalid root count or inconsistent edge must reject without changing an active game. Compare seeded partitions, unsupported sets and later removal sequences against uncached construction. Measure file size, decoding, hydration and retained memory independently. First isolate this step; do not conceal the original ~1.86-second setup cost in A/B results.

## 2. Narrow simulation storage

Introduce a compact fixture descriptor combining implicit terrain and immutable typed structure columns. Keep IDs and original coordinates stable. Allocate HP/state changes and moving poses only when edited. Convert blast region lookup, secondary-contact lookup, support removal and static collider maintenance to the store API. Keep the existing single Rapier world, queued dynamic pieces, contact episodes, reward attribution, epochs and sleep/wake lifecycle.

Do not re-expand to fixture.cells, JSON.stringify(original), full State maps or full immutable liveViews after construction. Surface output is dirty-chunk geometry plus dynamic piece transforms, not an array of 454,913 CellViews. Diagnostic single-cell lookup remains possible but full-world materialization is explicitly a test-only operation.

## 3. Save and collider restoration

Restore sparse state before creating dirty static chunks. Preserve legacy schema-9 research, inventory and destroyed/moved IDs. Validate the complete candidate before disposing the live world. A corrupt save must not change epoch, inventory, geometry or pending ordnance. Precompiled pristine support must replay departures from sparse state before use. Changed colliders must be flushed before the next query or physics step; no hidden floor fills old holes.

## 4. Selection preview and runtime lifecycle

Use compact surface geometry for selection without constructing physics. Preserve approved layout and camera. Dispose superseded geometry, materials/buffers and old world bindings; exact surface membership must remain identical across repeated map switches. Runtime geometry changes only at affected chunks and their face-sharing neighbors. Dynamic pieces keep their authoritative bodies and stable IDs, not decorative replacements.

## 5. Staged verification

- CPU: identical same-city metadata, exposed geometry, seeded support, collision holes and sparse restores.
- Native physics: first-layer crater, full-depth hole, second projectile passage, foundation loss, falling structure, neighbor damage, stationary no-repeat reward, persistent rubble, epoch/reset and finite queue drain.
- Actual browser: same viewport and city, cold/warm card click to presented city; Start to actual picking/projectile interaction; long tasks and rAF gaps; 20 explosions and ten enters/leaves; JS heap, native/WASM measures and GPU estimates reported separately. Record real interaction progress, not only loading-label responsiveness.
- Visual review: intact city, hole, falling/settled pieces and real explosion stages remain visible. No UI redesign or extra maps are part of this work.

## Risks not yet resolved

Pristine support caching does not remove work needed after extensive fragmentation. Dynamic chunks can still dominate solver cost; transparent effects can dominate GPU fill. Large blast edits need bounded dirty-chunk scheduling without delaying authoritative collision updates or silently losing damage. Legacy fixture-signature compatibility needs a streaming/versioned check rather than rebuilding the old giant snapshot for every save. All combined-world latency and memory claims remain unproven until integration and real-browser measurement.
