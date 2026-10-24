# Responsive Destruction Authority Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. This document is a proposal, not implementation authorization.

**Goal:** Test whether one existing city can undergo three real central nova blasts while camera/UI remain responsive, authoritative simulation stays current, and actual geometry catches up promptly.

**Architecture:** Move the existing single Rapier world, projectiles, structural state and round ledger behind one worker command boundary. Keep Three rendering and the approved UI on the main thread. Send versioned typed geometry patches and owned scalar/event snapshots rather than cell objects or a second writable world.

**Tech Stack:** Existing Three 0.180.0, Rapier 0.21.0, TypeScript/Vite, standard module Worker and transferable ArrayBuffers. No new engine, SharedArrayBuffer/cross-origin headers, external software, maps or weapons in this slice.

**Spec:** Current approved compact performance investigation; `docs/performance/nova-batched-support.md`. The present assignment authorizes this plan only. Local limited fixes remain unsubmitted; remote branch remains `937989fb0e223064c614889c92d632bd42dcd703`.

## Global constraints

- Preserve v0.5.1 selection layout, three-tool rail, independent control panel, inventories, research, tool strength and eight destructible soil layers.
- Preserve one authoritative physics world, stable IDs, exact holes, support fracture, secondary damage, lasting rubble and save/reset isolation.
- No fake immediate explosion, hidden damage drops, silently slowing the simulation clock, or reduced destruction radius to pass timing.
- A worker removes main-thread blockage; it does not make the same work cheaper. UI-only success is not product success.
- Save serialization must also leave the UI thread: game-save-store currently JSON-stringifies synchronously. Return encoded save bytes/text from the worker, install only after validating epoch and committed sequence, and include its transfer/deserialization costs in long-task measurements.
- No full city/cell snapshot per frame. Do not transfer the authority's own live storage and detach it accidentally.

## Evidence and realistic boundary

Current local summary-path native damage phases are 805 / 369 / 229 ms. The preceding actual browser build required 1,243 ms damage plus 449 ms surface synchronization for the first nova; remote click to the first post-damage render submission was 2,369 ms. Three different buildings were hit, natural settlement and home release passed. These are different workloads/environments and must not be subtracted to claim a browser improvement.

The single-world worker slice alone is expected to improve camera/UI scheduling, not guarantee blast throughput. A roughly 0.8-second worker transaction still creates authoritative lag. That must be measured and may fail this experiment. Battlevox's reported physics debt is precisely the failure mode this plan refuses to hide.

## Current interface changes required

1. `src/structural/physics-host.ts` exposes `Rapier.World` and synchronous participant callbacks. Physics/projectiles must move together; this object cannot cross the worker boundary.
2. `src/structural/game-world.ts` owns round/research and synchronous damage/snapshot queries. It remains worker-owned. Main thread gets an immutable display mirror, not a second independently advancing ledger.
3. `src/main.ts` currently accepts a placement, decrements stock and reads completion synchronously. An accepted command acknowledgement must atomically include inventory/research revision. A pressed button or pending indicator is not evidence the command was accepted.
4. `src/compact/surface-source.ts` supplies closures and private identity proofs. These are not serializable. Mesh generation consumes the authority's scalar access inside the worker and exports arrays; the main thread must not fabricate its private proof tokens.
5. `src/compact/surface-renderer.ts` currently builds geometry and uploads it together. Separate CPU mesh output from Three buffer installation. Picking against the latest visible mesh yields a candidate; worker must validate its cell and surface against current authority before placement.
6. Saving requires a barrier acknowledged after all accepted preceding commands. Current saves do not persist all live projectile balls/packages/emitters; this slice must state that limitation. Its persistence test uses settled authority, and an in-flight save cannot be advertised as exact ordnance restoration. Extending in-flight persistence would be a separate explicit contract, not an accidental claim. End must wait for authoritative queues/projectiles plus the existing critical-effect condition. Smoke tails remain non-blocking.

## Protocol and ownership

Proposed files: `src/worker/protocol.ts`, `authority-worker.ts`, `authority-client.ts`, `mesh-patch-queue.ts`; isolate a temporary A/B entry before changing the normal entry.

Every message includes `worldId`, `epoch`, `sequence` and `mapRecipeHash`. Commands additionally carry unique `commandId` and the latest observed revision. Worker rejects stale epochs and deduplicates repeated IDs. Responses distinguish queued, accepted, rejected and fully committed; only accepted commands consume stock, exactly once.

Commands: initialize/activate; launch/place with candidate hit; detonate; pause/time-scale; end; save barrier; restore/reset/dispose. Worker advances the sole fixed-step clock. Main camera movement is local. Visibility pause is explicit; no wall-clock catch-up across a hidden tab. Existing scene/simulation dt caps must not be reused to hide foreground overload: record foreground eligible elapsed, requested scaled simulation time, completed simulation time and any explicitly discarded time separately. Foreground overload may create measurable debt, never silently erase it; the debt gate then fails.

Outputs: command acknowledgements; ordered real gameplay events; round/objective summaries; dynamic body pose batches; mesh patches; save barrier result; health/queue timings. Typed mesh patch header contains chunk key, monotonically increasing chunk revision, authority revision and dependencies, with position/normal/color/index buffers. Patches are complete replacements for that chunk, so a newer unsent patch may supersede an older unsent one. Gameplay damage/events are never coalesced away.

Transferred buffers are worker-owned outputs, separate from live authority. Main owns received buffers until installed/disposed. ACK credits bytes back to the worker. Initial trial limits: 16 MiB unacknowledged mesh data, 4 ms main-thread upload/disposal scheduling budget per frame. These are measurement defaults, not proven optimums. One upload can exceed its budget; record the overshoot and fail the long-task gate rather than pretending a timer preempts WebGL.

Backpressure retains dirty chunk IDs and recomputes the latest version when credits return; do not allocate endless historical mesh copies. Dynamic poses may use latest complete state, but structural detach/impact/reward events remain lossless. Queue depth, oldest item age and active/queued bodies are always observable. Commands, lossless events, latest poses and mesh data have separate transport credit limits. If command capacity is exhausted, reject before authority acceptance and before consuming inventory, with a visible busy outcome; never acknowledge then silently drop. Consumer starvation must cause a declared pause/backpressure state rather than unbounded event allocation. Such pauses count against the real-time gate. Complete chunk replacement can supersede old mesh output; partial topology/event streams require contiguous revisions or an explicit re-synchronization barrier. Incoming reset/dispose invalidates old epoch work; stale patches are discarded and their buffers released. No stale collider or deleted cell may reappear.

## Regional acceleration without changing damage semantics

A certified full-destruction shortcut may apply only if the exact damage lower bound over the region exceeds every surviving member's HP and the current rules have no blocking exception. Track aggregate HP/material/objective metadata and stable IDs. Partial terrain, mixed strengths, surviving cells, moving bodies and sphere-edge regions use the exact existing calculation. Preserve reward rounding over the complete command, boundary support bonds, collider holes, deterministic detach order and deduplication. A chunk's center lying inside the radius is not proof of full destruction.

This shortcut is a separate equivalence-gated task, not a prerequisite silently bundled into worker migration. If exact support/secondary outcomes cannot be retained, do not claim equivalence. Bulk removal may save iteration but cannot erase required fragments or collide against a filled bounding box.

Real wavefront propagation is a different game rule: regions receive damage at different simulated times, moving bodies can change position between arrivals, and earlier collapse can affect later hits. It needs an explicit timing decision and updated reference model. This slice keeps existing instantaneous damage order; it must not split damage across frames and call that unchanged behavior.

## Minimal implementation sequence, only after approval

### 1. Protocol and deterministic authority harness
- Files: new protocol/worker/client and `src/worker/protocol.test.ts`.
- First red tests: worker overload cannot erase elapsed time; damage/save/reset/restore interleavings keep rejected saves atomic; duplicate accept consumes one round; old epoch response cannot mutate current mirror; save barrier excludes no accepted command; reset during work cannot leak a later blast.
- Implement worker ownership of the existing physics, projectile and game-world modules, with no second world on main. Compare canonical state/HP/research/events and saved bodies to the synchronous reference at equal simulation ticks, not equal wall time.
- Pass: actual Worker/MessageChannel integration tests, full current regression suite. Failure is a protocol defect, not grounds to weaken exactness.

### 2. Transferable surface patches and bounded main installation
- Files: extract CPU meshing from surface-renderer into `src/compact/chunk-mesh.ts`; new patch queue and tests; minimal scene adapter.
- First red tests: out-of-order patch rejection; every transferred buffer ownership transition; dirty-neighbor hole exposure; reset/dispose while uploads pending; bounded bytes under deliberately slow main consumer.
- Implement complete chunk replacements with revision acknowledgements. Atomic authority collision update is independent of rendering; visible stale geometry is bounded and candidate hits are revalidated.
- Pass: geometry/face/picking equality to fresh reference, no lost events, no growing stale buffer backlog. Never report an uploaded old mesh as current.

### 3. Exact regional shortcut feasibility, isolated
- Files: new regional-damage oracle tests and a narrow authority adapter only if proofs pass.
- First red tests: sphere boundary, partially damaged chunk, mixed HP, holes, moving debris, support bonds crossing a region and overlapping consecutive blasts.
- Compare every resulting HP/state, reward, structural event and later collision against exact existing calculations. Benchmark actual eligible-region percentage. If few regions qualify or bookkeeping costs dominate, report that result and do not ship a false bulk shortcut.

### 4. Same-city real browser A/B and decision
- New `scripts/worker-city-ab-browser-check.mjs`, no production UI redesign.
- Actual 100% central building placement+remote trigger, then two distinct central building collision blasts. Keep camera drag and a reversible UI control active during each blast. Also issue the fixed three-shot sequence at 2-second wall intervals to expose throughput debt; do not wait for settlement between this stress sequence's commands.
- Preserve natural settlement, actual rubble poses, secondary damage, main/free isolation, save/reload, pause/slow motion and reset-in-flight tests. Capture actual event/render ages and frames, not just precomputed visuals.
- Add a 4x logical-map fixture by placing three distant independent city copies outside blast/visibility/collision locality. Separate cold initialization cost from warmed local-blast cost. No duplicate active worlds and no demand to simulate unseen independent islands. Then test a genuinely connected distant support structure separately; global connectivity work is legitimate and must not be disguised as a local-only success.

## Pass/fail gates and stopping rule

These are proposed acceptance targets, not achieved claims:

- Trusted camera/control input to the corresponding rendered feedback: p95 <100 ms; no destruction-caused main-thread task >100 ms. Report maxima and software-renderer limitations. A pending button highlight alone does not satisfy command acceptance.
- Command acceptance/rejection acknowledgement p95 <100 ms; first authoritative damage event <250 ms after the real trigger/collision; latest visible affected geometry <500 ms behind its committed authority revision. If the worker's monolithic calculation prevents these, the slice fails throughput despite smooth camera movement.
- Record admitted wall time, simulated time, completed fixed tick, oldest accepted command age, mesh queue age and oldest queued body's age independently. Do not reset the lag baseline after a stall. Under the three-shot stress sequence: maximum eligible simulation debt <=500 ms, debt returns <=100 ms within two wall seconds after the last blast's computation, and no monotonically growing queue. Pause/slow motion are normalized explicitly.
- Natural settlement state matches the synchronous reference at equal simulation ticks. Wall settlement must not exceed reference simulated settlement duration / time scale by more than two seconds for this bounded workload. Sleeping is physical state, not a timeout that deletes debris. Failure at this gate is the Battlevox-style debt problem, even if rendering looks smooth.
- Canonical HP/state/holes/support/secondary damage/rewards and save restore are identical for unchanged rules. No hidden fragment dropping or permanently queued important bodies. Memory/bytes are bounded, reset returns zero worlds and no pending authority work.
- Fourfold distant-map local-blast authority and mesh work <=1.25x warmed baseline, with visited regions/collider counts recorded. This is a locality target for independent remote volumes, not proof of arbitrary global support connectivity or an entire galaxy exploding simultaneously.

Stop after this one slice and its measured comparison. If responsive UI passes but debt/freshness gates fail, do not package it as fixed. First identify whether the cost is exact regional damage, connectivity, body collision or mesh generation. Further work requires a new bounded design decision: hierarchical regional destruction/physical clusters (new semantics where necessary), or an engine/native/WASM route whose complete workload is actually demonstrated. No infinite sequence of relaxed test limits or waiting longer for an unbounded queue.

## Review focus

- Reset and late results: epoch tests cover command, mesh, save and audio/effect events.
- Slow consumers: byte credits and dirty-key supersession cover memory without discarding damage.
- Stale visible holes: worker hit validation and revision-age gates cover render/collision mismatch.
- Saturated physical fragments: oldest queued-body age and natural settlement cover hidden permanent debt.
- Equal state but wrong timing: separate input, command, physics-debt and geometry-age gates prevent a smooth but many-seconds-late game from passing.

## Primary references and applicability

- Voxel Tools performance: https://voxel-tools.readthedocs.io/en/latest/performance/ . Uses worker threads and main-thread time budgets, and discusses mesh block-size tradeoffs. This informs scheduling; its Godot implementation is not a directly imported browser subsystem.
- NVIDIA Blast introduction: https://docs.omniverse.nvidia.com/kit/docs/blast-sdk/latest/docs/api/introduction.html . Hierarchical chunks, support graphs and bonds describe pre-fractured rigid destruction. This is a design reference, not evidence of drop-in runtime voxel carving or a JS binding.
- Chaos destruction: https://dev.epicgames.com/documentation/unreal-engine/destruction-overview?lang=en-US . Clusters combine connected geometry into larger rigid bodies before separation. Cached cinematic replay is not a substitute for interactive authority.
- Dennis Gustafsson 2024 summary: https://blog.voxagon.se/2024/12/29/year-summary.html . Discusses a next-engine Vulkan/hardware-raytracing prototype and a data-parallel task manager. It does not establish browser or mobile compatibility, nor permission to execute unrelated source.

Self-review: all requested boundaries map to protocol, meshing, regional oracle or A/B gates. No code implementation, new dependency, external upload, CI or remote write is performed by this plan.
