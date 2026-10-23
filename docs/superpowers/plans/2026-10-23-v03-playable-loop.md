# v0.3 Playable Loop Implementation Plan

> Execute with isolated file ownership and test-first changes. User approved the gameplay and weapon direction on 2026-10-23.

Goal: Turn the current courtyard into a clear building-demolition loop with three mechanically and visually distinct tools and a small unlocked warehouse.
Architecture: Keep Three.js, Rapier and authoritative voxel state. Lead owns shared contracts/UI/integration; independent workers own domain, physics and scene. No paid generation, cities, planets or Android packaging.

Approved design: building-specific objective, completion and next action; grenade throws/bounces/times out, rocket faces its velocity and impacts, charge attaches to a live surface and waits for remote command. Free mode remains separate.
Implementation choices: 70% building destruction completes a map; growth has unlimited tools, no economy/ammo penalty. Grenade initially available, rocket at40 research, remote at90; research derives from building destruction, not yard cleanup. Completing courtyard unlocks warehouse. Existing research retained. Attached packages lose validity if their host voxel disappears. These are small-game rules, not real weapon engineering.

## Tasks
- [ ] Domain worker: tests first for objective excluding yard, first completion once, map unlock/reset/save and legacy migration; add deterministic warehouse. Own domain.ts/domain.test.ts.
- [ ] Physics worker: tests first for live-surface attachment, remote-only trigger, invalid host/reset cleanup, rotation/velocity views; retain existing flight/timer/hole tests. Own physics.ts/physics.test.ts.
- [ ] Scene worker: distinct shared-geometry grenade/rocket/package renderers, proper orientation, actual live hit surface/normal, preserve instanced scenery. Own scene.ts and weapon model module/tests if needed.
- [ ] Lead: integrate building objective HUD, tool-specific controls and remote button, completion/next map/retry/free-mode state, version/migration and font subset. Own contracts.ts/main.ts/style.css/config/docs/browser acceptance.
- [ ] Verify full tests/build then real Chrome objective→completion→warehouse/retry/free mode plus physics regressions and clear weapon screenshots. Preserve history and publish only authorized project content.

Review risks: stale attached host, changing maps with pending rounds, repeated completion rewards, old saves and tool unlocks, mobile controls overlapping modal/remote action. Each belongs to owning module tests and final real-input checks.
