# 核平模拟器：小屋试验场

A first playable Three.js destruction sandbox. Fictional, unoccupied testing ground.

## Run

Node 22+: `npm ci`, `npm run dev -- --port 5191`.

`npm test` runs the domain checks. `npm run build` checks TypeScript and produces a Vite build.

Drag to orbit, wheel to zoom, click the cottage to aim, then click 发射 or press Space. Number keys 1–3 select unlocked tools. Reset rebuilds the cottage without clearing research. Settings includes a sandbox mode separated from growth progress. Progress is stored only in the current browser.

## Current boundaries

One E0 cottage, not the full eight-chapter concept. Structural support uses a discrete adjacency model. Flying debris is visual animation, not engineering simulation or real blast physics. Browser first playable only; no Android or Windows native package is claimed. Research unlocks two further tools. Scene resets are separate from profile deletion.

## Dependencies and assets

Three.js 0.180.0 and OrbitControls: MIT. Vite: MIT. TypeScript: Apache-2.0. Dependency versions are locked in package-lock.json. All initial cottage and environment geometry is authored procedurally within this project. User-provided concept images guided layout and are not embedded in the game. No external fonts or network service is required during gameplay.

## Verified first playable

Runtime commit `f4e0dcd7a0f24b6308766b47b6345c3aaef6a4cd` passed [real Chromium browser QA](https://github.com/Night-SHANG/hepingmoniqi/actions/runs/39893173987): rendered WebGL pixels, drag/aim/fire, saved damage after reload, reset preserving research, sandbox separation, and reachable landscape controls. Ten domain tests and the production build passed. See RELEASE-NOTES.md.

The target platform direction is browser plus Android. This package is the browser slice only, not an APK or a native Windows application. Fully extract the browser ZIP and run START-WINDOWS.bat (requires installed Python 3); it opens a local HTTP server and the default browser.
