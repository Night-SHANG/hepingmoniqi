# City nova performance investigation

This is a continuation of the compact-core performance branch, not new content or a release verdict. The v0.9.1 browser run exercised 19 terrain-targeted rockets and one district impact tool, not a city nuclear-blast workload.

## Reproducible native workload

Run `node --import tsx --import ./scripts/register-compact-test-assets.mjs scripts/profile-city-nova-authority.ts --output=artifacts/city-nova-authority/local --blasts=3 --phase-budget-ms=90000` from the repository root, with no other city world running.

The instrumented workload creates real shared-host remote nova ordnance and detonates at (0, 3, 0), using unchanged 100% power, radius 48, strength 20 and the default 32-body concurrency budget. It observes natural settlement, then repeats at the same center. It is not a browser click/flight test, nor three different districts collapsing.

Baseline direct authority phases were 6,893 / 2,611 / 1,485 ms. Per-cell support removal immediately recomputed split connectivity 31,545 / 12,258 / 7,805 times; split alone consumed roughly 84% / 81% / 75%. First-blast collider repacking was about 109 ms, not the dominant stall.

## Limited changes

- Collect pre-death static IDs within one blast damage loop or native contact-command batch. Flush support removal once before fracture/detach. HP, collider, event, reward, and chunk changes remain immediate and ordered. Never batch across commands or physics steps.
- Do not remove dynamic/rubble cells from static support again: detach already removed their membership.
- Keep the 16,384-entry revision journal bounded. When a valid same-epoch consumer is older than the journal, recover exact cursor-relative deltas from sparse records instead of falsely requesting a complete city rebuild. Invalid/future/pre-reset cursors still reset.

After both changes, the same instrumented phases were 1,051 / 441 / 263 ms. This is native CPU evidence, not FPS or final browser latency. First-blast natural settlement consumed 1,063 ms across exactly 568 fixed steps (4.733 simulated seconds); later same-center shots required no new active bodies.

## Exact semantics checks

Baseline and modified final summaries match: 454,913 logical cells, 51,743 departed cells, 67,248 sparse change rows, one saved rubble body, 126,011 processed IDs, and tick 568. Changed-cell SHA-256 is `855abcbbbe8fc42e782e5201851938eb654b3dc99615b16dd05ac3c626312cde`; body-state SHA-256 is `de5ba0e5200cdc2989d48e930c3ff10be83f200b59cff2033d187c30506dc10d`. Each blast's damage summary and immediate authority summary also match. Save/restore reproduces sparse and body hashes, aggregates and pending=0 while advancing epoch.

Independent graph tests enumerate 1,024 small mask/order cases and later cuts; private graph chunk indices can differ, but public canonical components are identical. Real Rapier integration tests cover ordered blast damage/reward, dynamic/rubble destruction, actual simultaneous contact damage, duplicate events, reset and restore. Overflow-delta tests cover 17,000 cells, repeated pose overwrites, independent cursors, reset and no full-fixture enumeration.

## Remaining evidence boundaries

The first blast removes 31,535 cells and detaches 136; subsequent shots deepen the same area, not fresh districts. The snapshot is about 6.39 MB. Large-blast full browser performance, shifted shots, rendering/driver cost and natural UI settlement still require the separate nova browser check. No Android performance claim. VFX synthetic CPU measurements do not prove GPU overdraw is cheap; no elapsed-time cap, strength reduction, deletion of important fragments or reduced terrain coverage was used.
