# Isolated material/color mesh slice

This is an optional `worker-slice.html?mesh=material` experiment, not the normal game, a release, or a replacement authority. Baseline remains available without the query. No weapon, damage, support, physics, research or explosion timing changes are made.

## Representation

Merge only equal actual material and normal on an occupied surface. Reconstruct each original cell's color with an owned integer 3D palette-index texture, padded linear RGBA32F palette, and an optional R32F HP presentation multiplier. Lookup uses original object/lattice coordinates rather than transformed world coordinates. Missing cells remain holes. Original HP stays Float64 in authority. Pristine colors are exact Float32; damaged display color has a stated absolute tolerance of 1e-7 due separate Float32 multiplications.

Every texture buffer participates in the existing epoch/versioned byte-credit transfer queue. A replacement disposes its owned textures and material as well as geometry. Empty replacements allocate no texture. Array payload accounting includes retained air, palette-row padding and optional shade. It is not a measurement of driver VRAM or upload completion.

## Local evidence, 2026-10-24

Same intact city: 203,018 unit faces become 11,820 merged quads. Baseline 32,888,916 bytes becomes 2,590,218 total bytes, including 1,560,240 geometry, 1,012,714 index texture and 17,264 palette bytes. All 609,054 CPU color probes are exact. Single-pass build is slower: baseline 276.445 ms versus combined 587.596 ms.

After unchanged central nova (radius 48, damage 20): 185,706 unit faces become 10,720 quads. Full resident static payload 30,084,372 bytes becomes 2,780,941 bytes: geometry 1,415,040, index texture 859,085, palette 15,296, HP shade 491,520. Of 557,118 color probes, 33,417 differ bitwise; maximum absolute difference is 2.98e-8. Exact occupied/material surface parity and source scalar hash/revision/aggregates are unchanged. Baseline construction 415.176 ms versus geometry 405.121 ms plus cell data 257.146 ms. Native world disposed successfully. These are full resident outputs, not measured GPU traffic or dirty-update bandwidth. This immediate post-blast snapshot is not natural settlement evidence.

Memory was not recorded in the original nova run, and that process was not launched with exposed GC. A separate intact-fixture memory measurement must not be labeled post-nova or browser memory.

## Browser evidence pending

One actual browser A/B will compare the same city/camera and one unchanged remotely triggered nova. Initial canvas pixel comparison is separate from settled visual evidence. Screenshots are excluded from pressure. Record actual geometry and texture bytes, renderer submission cost, main-thread long tasks, input response, authority latency and eligible simulation debt separately. A presentation gain does not clear the existing authority latency/debt failures. No GPU, Android, three-shot or four-times-map performance pass is implied by these CPU results.

Separate intact-only explicit-GC pass: heapUsed 16,947,488→17,906,488 (+959,000); ArrayBuffers 4,291,756→6,881,974 (+2,590,218), matching retained payload exactly. RSS +44,654,592 and external +8,038,287 include allocator and transient effects. After dropping payload references and one GC, ArrayBuffers remained 5,961,382, above baseline. Complete reclamation is not established; browser lifecycle must be measured independently.
