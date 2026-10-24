# Scale-priority city slice, 2026-10-24

User accepted approximate, scale-first simulation with local detail. This is an isolated entry and state namespace, not an old-save migration or normal-game replacement. Keep the same city extent, all36 buildings, finite eight-layer terrain, tools and UI vocabulary. No new external engine/dependencies.

## Explicit new semantics

Authority is a fixed regional partition, not per-voxel HP everywhere. Regions group occupied cells by spatial tile plus object/material/role; empty window/bridge volume is never filled with a bounding-box collider. Each region has mass-weighted durability and objective weight. One radial attack samples region position/bounds deterministically and changes that regional durability; this is deliberately not the old per-cell damage equation. Radius and trigger semantics remain unchanged. Damage accounting is based on cumulative normalized regional loss, capped by initial objective weight, never by particle count. Camera position cannot change damage or rewards.

Initial candidate granularity: structure regions up to4x4x4, soil4x2x4, with material/object/role boundaries and exact occupied collision boxes. Regional connections are compiled from real face adjacency; only surviving perimeter geology anchors support the static graph. Loss of foundations releases connected regional groups. Important connected components have real Rapier bodies and bounded compound shapes, small fragments are cosmetic but their original objective loss is already committed. No accepted damage waits for a cosmetic slot. Important-body saturation aggregates deterministically or queues with explicit finite progress, never silently deletes bodies or keeps simulation pending forever.

Near detail is an expansion of the same regional occupied mask and damage/departure state. Camera changes only select representation, using a hysteresis band; they never restore geometry or reset HP. Fine edge/chip presentation must not masquerade as independent precision HP. Region removal removes all its occupied collider boxes synchronously with the authoritative transaction. Settled rubble preserves identity/pose/remaining durability and can be hit again; additional research comes only from previously uncounted objective loss. Save/restore/reset owns epoch and all regional/dynamic state.

## Parallel ownership

- Core worker: src/scale-slice/model.ts, model.test.ts, fixture.ts, fixture.test.ts. Region compiler, durability/support/ledger/state contract.
- Dynamics/presentation worker: src/scale-slice/dynamics.ts, dynamics.test.ts, presentation.ts, presentation.test.ts. Single Rapier host, regional collision boxes, important connected fragments and local-detail presentation.
- Independent QA: src/scale-slice/independent-review.test.ts, scripts/scale-slice-profile.ts, scripts/scale-slice-browser-check.mjs. No production edits.
- Lead: contracts.ts, adapter/worker/main/entry build, integration tests and report. Existing core and normal game entry stay unchanged.

## Verification gates

First small fixture must show ground hole→foundation loss→connected falling body→independent neighboring target loss→persistent rubble, deduped reward, camera-independent saved state and reset isolation. Then the actual same city has three distinct-center nova attacks, natural settlement/save/restore, no accepted damage dropped. Report compile/start separately from hot damage and surface work, physics steps/debt, peak/resident memory and body/collider counts. Target input/main long tasks<100ms, damage commit<250ms, visible update<500ms and bounded natural recovery. These are acceptance targets, not promises. If a coarse body disappears without a recorded finite-world exit or terrain is merely a decorative plane, the slice fails irrespective of speed.

Only after native semantics/performance are credible run a single bounded real browser check on the existing approved performance branch. Preserve previous branch history; no main merge/release or new gameplay scope.

Finite-world boundary: only a body truly falling below minY−64 may enter explicit escaped terminal state. Keep IDs, last pose, reason and credited remaining objective loss; never expire by camera visibility or timer. Supported-ground fixtures must produce persistent rubble, not pass pending=0 by all escaping. Report escaped counts separately.

## Current evidence and explicit approximation boundaries (2026-10-24)

This entry is isolated (`scale-slice.html`), not the normal game or its save migration. Its displayed research is raw weighted objective HP loss, not the normal game's normalized research economy. The city recipe remains 454,913 logical cells, 36 buildings and eight finite terrain layers; this preserves inventory and extent, **not legacy per-cell damage/support equivalence**.

The authority compiles 18,447 connected material/object/role regions and 23,339 occupied boxes. Large blasts damage regional HP using the nearest occupied box, while small blasts can create exact local masks. A cut can leave separate lobes inside an original region sharing regional support until that region is removed. At the dynamic-body budget, disconnected groups can be coupled into a compound body; their geometry and identities remain, but independent rigid motion is approximated. Camera detail never changes authority state or heals holes. Important escaped bodies are explicitly retired and accounted, not reported as sleeping rubble.

The first complete native run measured three accepted city nova transactions, including collider changes, at 43.4, 28.3 and 27.7 ms. Its largest physics steps were 132, 108 and 22 ms. This is **not browser responsiveness proof**. Natural settlement took 5, 8.25 and 6 simulated seconds; nine sleeping bodies held 41 rubble regions, while two bodies/five regions escaped the finite world. A later fixed-target run and browser evidence supersede these provisional numbers when available.

First-run memory was approximately 398 MB RSS after initialization and 596 MB after destruction. The approximately 905 MB process peak also contained a second compiled/restored world for comparison, so it is not a single-scene resident measurement. Initialization was approximately 2.37 seconds and remains outside the blast transaction. It is not rebuilt on each explosion.

Reconstructing sleeping Rapier bodies from poses caused a small repeatable post-restore gravity step. The slice now preserves native Rapier snapshot/contact state alongside the validated portable authority ledger and bindings. Snapshot bytes and restore time are reported separately. The worker transport has a separate lifecycle generation, so restoring an old authority epoch cannot admit queued pre-restore commands or stale mesh/pose messages. No permanent fixed-rubble substitute is used.

Browser gates remain separate: actual input response, main-thread long tasks, command-to-authority commit, static mesh submission, dynamic pose submission, and naturally repaid simulation debt. No screenshot is taken during the measured pressure interval. Passing native tests alone does not satisfy these gates.

### Final native targeted follow-up

Three low-building centers produced complete commits of 45.48 / 26.55 / 23.83 ms and naturally settled after 6 / 5.75 / 7 simulated seconds. Terrain removed was 12,832 / 13,792 / 12,960 cells, respectively. Local column checks show partial-depth craters, not claimed eight-layer-through holes for a nova. The separate small-mask regression proves a fully excavated eight-layer hole and a subsequent real projectile pass.

The three-shot final state retained ten sleeping bodies with 45 rubble regions; two bodies/eleven regions escaped and are explicitly counted. Two catalog pulse re-hits on the same surviving roof rubble reduced its HP from 40.552 to 6.654 to 0.510. Both settled, and replaying each command produced no extra reward.

The native contact-preserving save was 12.15 MB JSON, including 4.75 MB binary Rapier data encoded in base64. Snapshot generation took approximately 223 ms. Restore itself took approximately 237 ms, and second-runtime compilation plus restore approximately 2.77 seconds. After 120 additional steps the restored authority hash remained exact and pose drift was zero. The process peak of approximately 943 MB included both comparison runtimes. Largest physics step was 122.75 ms; browser response remains a separate unmeasured gate until CI completes.

### First real browser result and focused rendering follow-up

Run 40085622829 completed three real city shots, natural settlement and save/restore, but failed the performance gates. Command-to-authority commits were 52.7 / 49.5 / 58.1 ms. All-static presentation observations were approximately 928 / 917 / 637 ms; main-thread long tasks were 307 / 270 / 211 ms. The first input response was approximately 185 ms. Natural simulation recovery passed without discarding time. The original dynamic-pose polling chased a changing latest snapshot and therefore overstated its first-render timing; it is not a reliable 1.4–2 second first-pose estimate.

The limited follow-up retains actual shader-program variants across effects retirement. Three 0.180 WebGLRenderer releases program references on material disposal; WebGLPrograms destroys at reference count zero. WebGLProgram also defers link-status/uniform/attribute introspection until first use. A detached prewarm scene compiles actual existing materials, forces that introspection and keeps cache references alive. It never renders a fake explosion or alters authority. Source establishes the mechanism, not proof that all measured stalls were compilation.

New GL-call and segment metrics will test that attribution. First VFX draw, first tagged damaged-chunk draw, complete patch installation/render, and first actually rendered eligible rubble pose are separate measurements. `onAfterRender` establishes a draw submission, not GPU/display completion or proof that every fragment is unoccluded. Skipped obsolete pose snapshots are reported rather than credited. Thresholds remain unchanged; a fast flash does not substitute for real destruction.
