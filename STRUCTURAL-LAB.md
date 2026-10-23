# Isolated v0.9 structural laboratory

This branch preserves the existing playable game and adds an independent verification entry. It is **not a complete v0.9 release** and does not replace the approved scene-selection or three-tool game UI.

## Run

- `npm ci --ignore-scripts`
- `npm test`
- `npm run build:structural`
- Serve `dist-structural` using a static HTTP server and open `/structural-lab.html`.

The laboratory uses real canvas clicks to apply test impulses, not the full eight-tool inventory/launch flow. Select an effect profile, click a visible cell, drag to orbit, or use the pause, reset and in-memory save/restore buttons. The 1/20 slow control slows both physics and presentation together. It is a diagnostic control, not a change to the normal game's timing.

## Implemented foundation

- Warm, hollow unit-cell building generators for two-building laboratory, nine-building neighborhood and 36-building/six-block city fixtures.
- Finite three-layer soil, roads, foundations, trees and bridge cells participate in the support/HP model. Only finite outer lower-boundary cells anchor the authored terrain. No permanent invisible ground box remains within the destructible area.
- Explicit support loss, connected dynamic components, contact-driven secondary damage and persistent reactivatable rubble in one Rapier world.
- Exact same-material static box packing within dirty chunks. Empty holes are not filled; dynamic pieces retain their cell identities and collision shapes.
- Snapshot validation, epoch invalidation, contact deduplication, and FIFO active-body scheduling. Significant queued pieces are not silently discarded to meet a cosmetic budget.
- Independent explosion instances with eight authored visual profiles; fine smoke is presentation only and cannot hold settlement open.
- An optional shared-world adapter for existing projectile physics. One host advances time. Callback delivery and pull delivery are mutually exclusive, preventing duplicate events; shared-world trajectory preview is deliberately unsupported because the feature was removed from the game UI.

## Evidence and limitations

CPU tests cover support changes, holes, real impact damage, still-pile stability, rotation-following attachments, deferred echo/split work, replay/reset, and large-fixture settlement. CPU timing is not browser frame rate or Android performance. Browser acceptance must be recorded separately using the included scripts and actual screenshots.

Structural snapshots preserve cell/chunk poses and the damage ledger. Restoring the structural world cancels active projectiles; it does not promise to resume an in-flight ordnance sequence. Game progression integration and migration are not yet wired to this entry. The normal game remains the previous implementation.

The whole upstream WebGPU renderer/solver is not adopted. See `THIRD-PARTY-DESTRUCTION.md` for exact MIT source reuse and retained notices. This is stylized game physics, not an engineering or explosive-science simulation.

A separate `/structural-lab.html?fixture=rubble` contact-calibration page provides a clearly labeled precise-cut probe. This is a diagnostic fixture and probe, not a ninth weapon or a new level. It isolates a soil support, a connected falling building piece, an independent receiver and a finite supporting floor so persistence can be checked separately from warm-map cuts whose fragments can fall out of the finite map.
