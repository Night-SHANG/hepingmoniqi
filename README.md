# 核平模拟器：有限弹药破坏实验 v0.4

A fictional, unoccupied Three.js destruction sandbox with Rapier projectile physics.

## Run

Node 22+: `npm ci`, then `npm run dev -- --port 5191`.
`npm test` runs 75 domain/physics/gameplay/model regressions. `npm run build` checks TypeScript and produces the browser package.

Fully extract the browser ZIP, then run START-WINDOWS.bat with Python 3 installed. It opens a loopback HTTP server and the default browser. macOS/Linux: `python3 serve.py`. Keep the server window open. Direct file:// opening is unsupported.

Drag to orbit, wheel to zoom, click to aim. Main mode gives six shared ammunition units per round. Partial building damage earns research; deliberate retry restores ammunition while preserving research. Unlock rocket at 40, remote package at 90 and warehouse at 120 research. There is no forced 70% or 100% pass, automatic result modal or automatic explosion pause.

Choose direct placement, real-physics trajectory preview with confirmation, or quick fire. Placement arms the selected tool for manual triggering. Launched tools can use automatic collision/fuse behavior or remain remotely armed. Preview does not spend ammunition; confirmation does. The manual detonator triggers all armed objects at their current positions. Explicit round ending triggers any armed remainder, waits for airborne rounds and visible effects, then shows results. Reset cancels in-flight ordnance and pending results.

Free mode selects either building and has unlimited ammunition/placement counts, but only tools unlocked in main mode are available. It grants no research and cannot overwrite the saved main round. Instanced bodies grow dynamically rather than hiding objects beyond an arbitrary limit. Existing saves migrate with earned research intact; current saves preserve spent ammunition across reload.

## Current boundaries

Two compact E0 maps, courtyard and warehouse, not the eight-chapter concept. The courtyard’s 1897 authoritative voxels include the cottage, trees, fences, planters, workbench, crates and logs. Grass, ground, paths, lake and distant mountains remain background and cannot be excavated. Structural collapse uses discrete connectivity per object. Debris is visual animation; launched projectiles use rigid-body physics. No real weapon engineering is simulated.

Browser plus Android is the target direction. This is the browser package only, not an APK or native Windows executable. Android device performance, sustained performance budgets and subjective speaker listening are not yet verified.

## Dependencies and assets

Three.js 0.180.0 and OrbitControls: MIT. Rapier compat 0.21.0: Apache-2.0. Vite: MIT. TypeScript: Apache-2.0. Versions are locked in package-lock.json; license copies are included. Geometry is authored procedurally. User concept images guided the layout but are not embedded. CC0 audio provenance is in public/audio/SOURCES.md. The bundled Courtyard Sans UI subset is derived from Noto Sans CJK under SIL OFL 1.1; its source and license are in public/fonts. Gameplay requires no paid service or external font.

## Verification

See RELEASE-NOTES.md for the precise runtime revision and evidence. Browser checks use real Chromium WebGL, pointer/button interactions, render captures and read-only diagnostics. No test-only mutation API is exposed.
