# 原生验证片操作说明

This is an isolated interactive verification scene, not a migration of the old game's production UI, economy, progression, or save format. It displays the same native voxel city and the authoritative Jolt session, rather than playing a destruction animation.

## Launch

Scene: `res://scenes/native_slice.tscn`.

From this project directory, using the already installed Godot 4.7.1 wrapper:

```sh
/workspace/shared/godot-4.7.1/godot --path . res://scenes/native_slice.tscn
```

That command needs a working display and graphics device for actual visual verification. A headless run can validate startup, resources, scene structure, callbacks and physics, but cannot prove rendered appearance or usable frame rate. No user computer, remote publication, or new library is needed by this scene.

## Controls

- Right or middle mouse drag: orbit the city. The initial camera is `(200, 160, 220)`, looking at `(0, 4, 0)`.
- Mouse wheel: zoom, between 25 and 700 units from the camera target.
- Left click outside the control panel: select a surface using the current World3D's real Jolt ray query. A miss clears the selection; there is no imaginary fallback ground plane.
- `1` / 放置炸药: place a charge slightly outside the selected surface. A placed charge has no automatic fuse.
- `2` / 发射: launch a real radius-0.45 native physics sphere from in front of the camera. Initial velocity aims at the selected surface with a 1.5-second ballistic flight time and gravity 9.8. A nearer obstacle may intercept it.
- Space / 手动引爆: request detonation of all currently placed charges.
- `P` / 暂停 or 继续: pause/resume the physics and effect clocks. Camera controls and the resume/reset interface remain available.
- `R` / 重置: release the prior session's collision resources and create a clean copy of the same city. Selection, charges, rounds and visual debris views are cleared.
- Home: restore the initial camera without resetting city destruction.

The panel's research and last-blast processing values are diagnostic session data, not approved game balance or end-to-end visual latency measurements. Runtime failures are surfaced in the panel instead of substituting a fake city or a canned explosion.

## Rendering and authority boundaries

- The session is added as a Node3D child before `start()`. The scene and session share one World3D. No second collision space, terrain substitute, or visual-only damage authority is created by the view.
- The view runs while paused; the session is explicitly pausable. Children do not accidentally inherit the view's always-processing mode.
- Native VoxelTerrain supplies the intact city. Its cube mesher's opaque material uses the city vertex colors. The view adds a warm directional sun and procedural sky.
- A detached group gets one MultiMeshInstance3D, not a node per cell or collision box. Every authoritative `packedBoxes` row is drawn with one shared unit BoxMesh, scaled by the exact half extents. Rest-world box centers subtract `originalCenter`, then the group uses its current authoritative body transform.
- Region colors are read once from the immutable packed tables. Geometry is refreshed only when boxes, region labels, or the original center change; ordinary movement updates only the group transform. Removed groups are retired only when absent from session readback. Sleeping persistent rubble is not deleted by a visual timer.
- Placed charges and physical rounds are read-only shared-mesh views. They do not create another physics body, perform damage, or silently hide authoritative objects because of a visual count cap.
- Fire and dust are cosmetic, read-only MultiMesh views of real blast events. Each pool has at most 96 instances. Effects use the session's age, so pause freezes them, and their removal cannot remove rubble or collision. The small effect volume does not define the actual blast radius.
- The bundled subset font is loaded as a FontFile through ResourceLoader so exported import remaps are honored. Its source, licence and regeneration are owned by the project font pipeline; no machine-specific system font is required for the Chinese UI.

## Verified and unverified

On the installed Godot 4.7.1 engine, headless view tests exercised 20 assertions: camera/environment nodes, exact transform calculations, one node per rubble group, cache reuse, surviving geometry refresh, retirement, charge/round snapshots and bounded/cleared effect pools. A separate real-city lifecycle test exercised 20 assertions: same-world/Jolt identity, voxel color material, actual collider selection, placement, physical launch, pause/resume, camera movement while paused, absence of a charge fuse, repeated reset and collision cleanup.

The headless dummy renderer returns identity transforms and empty buffers for MultiMesh GPU readback. Therefore the geometry tests check the actual submitted transform calculations, instance counts and CPU node transforms; they do not claim the renderer displayed those instances. No GPU frame, screenshot, input feel, frame-rate budget, visual readability, export portability, or actual graphical teardown has been verified by those tests. The full project regression suite is a separate integration gate.

### Manual graphical acceptance still required

1. Open the native scene on an authorized graphics device and confirm the entire same city is visible, with readable Chinese controls and original city colors.
2. Orbit/zoom, select roof/ground/hole surfaces, and confirm the marker follows actual surviving collision, not an old collision shell.
3. Place several charges, wait without detonation, launch a physical round, and manually detonate the placed charges.
4. Confirm broken geometry follows physical motion and persistent settled rubble remains after fire/dust clear. Check a second hit against previously broken geometry.
5. Pause during flight or collapse; rotate the camera, resume, and reset while paused. Repeat reset and confirm no duplicate cities, stale rounds, stuck pause, or input capture remains.
6. Measure actual GPU frame timing and visible damage latency separately from the panel's CPU processing time before making any gameplay performance claim.
