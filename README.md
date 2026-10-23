# 核平模拟器：庭院拆除挑战 v0.3

A fictional, unoccupied Three.js destruction sandbox with Rapier projectile physics.

## Run

Node 22+: `npm ci`, then `npm run dev -- --port 5191`.
`npm test` runs 43 domain/physics/gameplay/model regressions. `npm run build` checks TypeScript and produces the browser package.

Fully extract the browser ZIP, then run START-WINDOWS.bat with Python 3 installed. It opens a loopback HTTP server and the default browser. macOS/Linux: `python3 serve.py`. Keep the server window open. Direct file:// opening is unsupported.

Drag to orbit, wheel to zoom, click a live object to aim. Start with a spinning grenade (key 1): throw, bounce, then explode after three simulated seconds. Earn 40 research to unlock the direction-oriented contact rocket (key 2), then 90 to unlock the attached remote package (key 3). Place packages on live voxel surfaces and press 遥控引爆; they never use an automatic fuse and cannot attach to background ground. Pause freezes physics and fuses; slow motion slows both. Rockets can enter previously opened roof holes.

Demolish 70% of the named building, not trees or fences. Courtyard completion opens a result screen and unlocks the warehouse. Retry retains earned unlocks. Free mode provides all tools while isolating its damage and rewards from saved growth. Settings also offers audio controls. Existing browser saves migrate without losing earned research.

## Current boundaries

Two compact E0 maps, courtyard and warehouse, not the eight-chapter concept. The courtyard’s 1897 authoritative voxels include the cottage, trees, fences, planters, workbench, crates and logs. Grass, ground, paths, lake and distant mountains remain background and cannot be excavated. Structural collapse uses discrete connectivity per object. Debris is visual animation; launched projectiles use rigid-body physics. No real weapon engineering is simulated.

Browser plus Android is the target direction. This is the browser package only, not an APK or native Windows executable. Android device performance, sustained performance budgets and subjective speaker listening are not yet verified.

## Dependencies and assets

Three.js 0.180.0 and OrbitControls: MIT. Rapier compat 0.21.0: Apache-2.0. Vite: MIT. TypeScript: Apache-2.0. Versions are locked in package-lock.json; license copies are included. Geometry is authored procedurally. User concept images guided the layout but are not embedded. CC0 audio provenance is in public/audio/SOURCES.md. The bundled Courtyard Sans UI subset is derived from Noto Sans CJK under SIL OFL 1.1; its source and license are in public/fonts. Gameplay requires no paid service or external font.

## Verification

See RELEASE-NOTES.md for the precise runtime revision and evidence. Browser checks use real Chromium WebGL, pointer/button interactions, render captures and read-only diagnostics. No test-only mutation API is exposed.
