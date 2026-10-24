# Isolated exposed-surface proof

This is not imported by the playable game and is not a replacement physics core.

Run from the existing v09 project with its installed dependencies:

- `node --import tsx --test ../hepingmoniqi-performance-spikes/preview/surface.test.ts`
- `node --import tsx ../hepingmoniqi-performance-spikes/preview/equivalence.ts`
- `node --import tsx ../hepingmoniqi-performance-spikes/preview/profile.ts`

## Exact coverage

The dense city comparison passed for all 203,018 exposed faces: world coordinates, face orientation and packed RGB, with no missing or extra faces. Pristine eight-layer soil is a finite implicit solid. Only its exposed top, bottom and perimeter are enumerated; 401,800 ground Cell/Voxel records are not allocated. The structure-only helper preserves every original above-ground ID, coordinate and color without first generating temporary plot soil.

## Measurement boundary

The latest saved native CPU sample (`profile-structure-only-result.json`) measured source generation at 80.5 ms and surface generation at 262.9 ms, totaling 343.4 ms. Output contains 406,036 triangles in 19.08 MB of typed buffers. Observed JS heap was 54.4 MB. This is not a controlled browser timing comparison, and excludes GPU upload, actual rendering, physics and gameplay. The older `profile-result.json` retains the previous temporary-soil generation experiment for provenance.

The isolated `browser.ts` A/B viewer builds successfully but has not been run in a browser. It labels CPU build and render submission separately; submission time is not a presented GPU frame. Browser cold/warm latency, long tasks, graphics memory and repeated disposal remain unverified.

Reference pattern: https://threejs.org/manual/pages/voxel-geometry.html . No example asset or texture was copied; the example's externally licensed Minecraft texture is not used.
