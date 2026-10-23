# Physical projectile regression plan

## Failure being corrected

Before this change, `main.ts` called `world.damage` synchronously from `fire()` at the selected voxel's center. The renderer immediately displayed that result. No projectile state, travel, collision, or fuse existed. `scene.ts` raycast only the cottage mesh; fence, trees, planters, crates, and workbench existed only in a static decorative batch. The earlier browser acceptance test checked only that destruction increased after an 800 ms wait, so instantaneous remote damage passed.

## Required deterministic model tests

Use fixed simulation steps and actual live collider data, never wall-clock sleeps or a mocked successful hit. Every test should fail if its named behavior is removed.

1. Launch is not damage: spawn a round away from a target. It must appear in active projectile state, move over several simulation steps, and leave world damage unchanged until contact/fuse expiry.
2. Contact fuse: a swept segment crossing a thin solid surface detonates exactly once at the encountered surface, not at the originally selected aim coordinate. Include a near obstacle in front of a farther aim target.
3. Delayed fuse: first contact changes motion (bounce/settle) but does not detonate. The projectile survives until its documented simulation-time deadline; damage occurs at its current position, not its original contact or aim point.
4. Hole traversal: destroy roof cells, rebuild collision data from survivors, and repeat the original launch/aim ray. The second round passes below the removed roof layer before detonation, eventually encountering a lower live surface.
5. Collider freshness: removed and detached cells are both absent from collision queries. No stale instance index may refer to a different surviving cell.
6. Pause: advancing with zero simulation time leaves projectile position, velocity, fuse age, and explosion count unchanged. Slow motion uses scaled simulation time for both motion and fuse.
7. Reset and mode change: clearing flight state prevents old projectiles from detonating after reconstruction, sandbox entry/exit, or restore; epoch mismatch remains a final rejection boundary.
8. Environment: representative fence/tree/yard props participate in target selection, live collision, and damage. Removed props stay absent, do not leave invisible colliders, and do not accidentally grant cottage completion rewards unless explicitly part of its documented score model.
9. Bounded work: sustained launch spam never exceeds the documented active-round cap. Misses eventually expire; all positions and velocities remain finite. Large time steps do not tunnel through colliders or generate unbounded substeps.
10. Validation: malformed launch vectors, non-finite time deltas, stale epochs, duplicate IDs, and post-disposal work cannot mutate a valid simulation or create late effects.

## Browser acceptance through real input

Use Playwright mouse/pointer events and the visible fire/weapon/pause/reset/settings controls. Diagnostics may read state or project coordinates, but must not launch, set targets, damage the world, advance game time, or toggle gameplay state directly.

- Click an actual rendered roof point, click Fire, capture an in-flight frame, and assert no immediate increase in destruction. Then wait for the real collision and confirm damage.
- Fire again without re-aiming at the removed roof: observe the new round below the old roof layer and confirm a lower detonation location.
- Choose an immediate-contact and a delayed tool using real controls. Capture travel, post-contact bounce/settle, and final detonation; verify their timing differs as specified.
- Pause an in-flight delayed round; verify its state and damage remain unchanged across real elapsed time; resume and verify completion.
- Reset with a live round; verify no late damage after its old fuse deadline. Repeat around sandbox entry/exit if those routes invalidate flight state independently.
- Click and shoot representative fence/tree/yard objects using canvas input; verify selected target and subsequent removed prop state match the actual object.
- Preserve console-error checks, desktop/mobile reachable controls, persistence checks, and rendered-canvas checks from the existing acceptance script. Existing fixed 800 ms post-fire assumptions must be replaced with explicit bounded waits for impact state.

## Evidence boundary

Unit tests establish deterministic collision/fuse/lifecycle behavior. Browser checks establish that real aiming and fire controls invoke that behavior and show a visible moving mesh. A diagnostic projectile count alone is not evidence that the round is visible: retain an in-flight screenshot and inspect its rendered trail/body. No browser test or screenshot should be described as passing until actually executed.

## Implementation and observed checks

- `scripts/projectile-browser-check.mjs` drives real pointer clicks and visible UI controls, waits for the physics-ready diagnostic, and records in-flight, roof-hole, timer, reset, and fence evidence under `artifacts/projectile-regression/`. It uses the actual Pause/Resume buttons to freeze a round for screenshots on software-rendered browsers.
- Selected screenshots are also printed as JPEG base64 with the existing CI log convention. No gameplay mutator is called through diagnostics.
- A full local `npm test` run after integration passed 22/22 tests, including the domain owner's environment/save tests and physics owner's actual Rapier contact, timer, roof-hole, bounce, reset, budget, expiry, and frame-rate tests.
- Browser execution is a separate acceptance gate. Syntax checking the harness and passing unit tests do not establish a browser pass or visual quality.

### CI feedback and harness corrections

Two browser runs provided partial, not final, acceptance evidence. Both cleared the initial and repeated roof-shot checks. One reached the timed explosion at age approximately 3.0 simulation seconds and confirmed reset cleanup, then failed to select the unnecessarily restricted front fence. Another timed out awaiting the timed explosion on a slow software renderer; simulation clock corrections are owned by the scene/physics implementation.

The harness now selects any genuinely ray-hit fence rather than requiring a front-fence coordinate. It verifies the projected point actually exposes the canvas with `elementFromPoint`, instead of assuming fixed HUD exclusion rectangles. Before in-flight captures it activates the real slow-motion control, pauses through the UI, then restores the previous speed before resuming. Timer/contact and no-immediate-damage assertions are unchanged. A timeout now records the latest projectile age, fuse and position, recent detonations, epoch, damage, target, pause/slow state, and document visibility.

A subsequent independent full local unit run passed 24/24 tests after the low-frame-rate physics regressions were added. A complete browser rerun is still required; earlier partial passes are not a final acceptance result.
