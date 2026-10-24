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

## Follow-up UI evidence and local-only payload fix

Run 40070644703 at commit 937989fb0e223064c614889c92d632bd42dcd703 passed the actual UI checks: one placed/remote nova followed by two collision-triggered nova shots at three different surviving city buildings, natural settlement without reset, actual body-member rubble persistence, deliberate End, zero live world after leaving, and unchanged durable main progress. It is a functional pass, not a performance pass. First remote click reached the real detonation handler in 0.6 ms, but synchronous damage took 1,243 ms, surface synchronization 449 ms and first post-damage renderer submission completed around 2,369 ms after the click. These are instrumented software-Chrome observations, not physical display/GPU completion or Android performance.

The final city objective counted 21,639 / 49,296 building cells departed (43.90%). One actual building cell survived as rubble, 21 units below its original location, and remained unchanged through ordinary unpaused callbacks. Earlier shots left 27 and 17 rubble cells, some subsequently destroyed by the next real blast. Snapshot-driven sampling replaced an invalid fixed-grid sample. The test does not claim browser restoration of the damaged free city; that remains separate native evidence.

A subsequent local-only change offers `damage(command, {details:false})` for the actual main caller, which only consumes `accepted`. Default detailed results remain compatible. The summary path avoids unused legacy Voxel projections, cloning and moving-before payload collection; sparse immutable state still drives identical research and queries. The same native three-shot workload now measures 805 / 369 / 229 ms versus the previous 1,051 / 441 / 263 ms. Final sparse/body hashes, each immediate authority summary, natural settlement and save/restore are identical. This is still substantial synchronous work, not an instant-explosion claim.

Surface diagnostics now maintain one numerical union count instead of reconstructing a Set from historical revision IDs. At 138,259 IDs, two renderer-only diagnostic reads fell from p50 24.042 ms to below 0.001 ms. No additional history collection was added. Actual browser samples show no evidence of same-revision mesh rebuilding: unchanged authority revisions retained unchanged surface revisions. `lastRebuild` records the prior rebuild and must not be summed again on repeated reads. The real dirty-chunk mesh work remains.

The local-only follow-up has not been uploaded or browser-tested. Further long CI and package publication are paused while the larger-scale architecture is evaluated. Moving authority and meshing off the UI thread would require an explicit asynchronous command/event/mesh protocol, not merely an early flash or a loading message.
