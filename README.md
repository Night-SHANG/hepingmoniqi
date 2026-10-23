# 核平模拟器：小屋试验场 v0.2

A fictional, unoccupied Three.js destruction sandbox with Rapier projectile physics.

## Run

Node 22+: `npm ci`, then `npm run dev -- --port 5191`.
`npm test` runs 24 domain/physics regressions. `npm run build` checks TypeScript and produces the browser package.

Fully extract the browser ZIP, then run START-WINDOWS.bat with Python 3 installed. It opens a loopback HTTP server and the default browser. macOS/Linux: `python3 serve.py`. Keep the server window open. Direct file:// opening is unsupported.

Drag to orbit, wheel to zoom, click a live object or ground to aim, then 发射 or Space. The aim sets the initial trajectory, not a guaranteed detonation point. Pulse and shock tools explode on physical contact. The delayed charge bounces and explodes three simulated seconds after launch, at its current location. Pause freezes the fuse; slow motion slows it. Repeated shots can enter a previously opened roof hole.

Number keys 1–3 select unlocked tools. Reset restores cottage and yard while retaining research. Settings offers a separate sandbox and audio controls. Browser-local progress includes strict migration of the earlier cottage-only save.

## Current boundaries

One E0 courtyard, not the eight-chapter concept. Its 1897 authoritative voxels include the cottage, trees, fences, planters, workbench, crates and logs. Grass, ground, paths, lake and distant mountains remain background and cannot be excavated. Structural collapse uses discrete connectivity per object. Debris is visual animation; launched projectiles use rigid-body physics. No real weapon engineering is simulated.

Browser plus Android is the target direction. This is the browser package only, not an APK or native Windows executable. Android device performance, sustained performance budgets and subjective speaker listening are not yet verified.

## Dependencies and assets

Three.js 0.180.0 and OrbitControls: MIT. Rapier compat 0.21.0: Apache-2.0. Vite: MIT. TypeScript: Apache-2.0. Versions are locked in package-lock.json; license copies are included. Geometry is authored procedurally. User concept images guided the layout but are not embedded. CC0 audio provenance is in public/audio/SOURCES.md. The bundled Courtyard Sans UI subset is derived from Noto Sans CJK under SIL OFL 1.1; its source and license are in public/fonts. Gameplay requires no paid service or external font.

## Verification

See RELEASE-NOTES.md for the precise runtime revision and evidence. Browser checks use real Chromium WebGL, pointer/button interactions, render captures and read-only diagnostics. No test-only mutation API is exposed.
