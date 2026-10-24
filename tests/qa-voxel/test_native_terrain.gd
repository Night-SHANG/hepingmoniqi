extends SceneTree

const Generator := preload("res://tests/qa-voxel/flat_fixture_generator.gd")
const RAW_SOLID := 0x887766ff
const CHANNEL_MASK := VoxelBuffer.CHANNEL_COLOR_BIT
const EDIT_AREA := AABB(Vector3(-18, -2, -2), Vector3(20, 3, 3))
const ORIGINAL_AREA := AABB(Vector3(-20, -1, -3), Vector3(25, 1, 5))
const HOLES := [Vector3i(-17, -1, -1), Vector3i(-16, -1, -1), Vector3i(-1, -1, -1), Vector3i(0, -1, -1)]
const GUARDS := [Vector3i(-18, -1, -1), Vector3i(-15, -1, -1), Vector3i(-2, -1, -1), Vector3i(1, -1, -1), Vector3i(-17, -1, 0), Vector3i(-16, -1, -2)]
var terrain: VoxelTerrain
var viewer: VoxelViewer
var voxel_tool: VoxelTool
var world: Node3D
var failures: Array[String] = []
var checks: Array[Dictionary] = []
var timing := {}
var report_path := "res://tests/qa-voxel/terrain-result.json"
var skip_edit := false
var mesh_size := 16
var edit_timeout := 10.0
var submission_stamps := {}
var readiness_observations := {}
var transparent_rgb_air := false
var current_phase := "setup"
var mesh_entered_events: Array[Dictionary] = []
var mesh_exited_events: Array[Dictionary] = []

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
  elif arg == "--skip-edit": skip_edit = true
  elif arg == "--transparent-rgb-air": transparent_rgb_air = true
  elif arg.begins_with("--mesh-size="): mesh_size = int(arg.trim_prefix("--mesh-size="))
  elif arg.begins_with("--edit-timeout="): edit_timeout = float(arg.trim_prefix("--edit-timeout="))
 call_deferred("_run")

func _run() -> void:
 world = Node3D.new()
 root.add_child(world)
 terrain = VoxelTerrain.new()
 terrain.name = "QaNativeTerrain"
 terrain.position = Vector3(-0.5, -0.5, -0.5)
 terrain.bounds = AABB(Vector3(-32, -32, -32), Vector3(64, 64, 64))
 terrain.max_view_distance = 96
 terrain.mesh_block_size = mesh_size
 terrain.generate_collisions = true
 terrain.block_enter_notification_enabled = true
 terrain.mesh_block_entered.connect(func(p: Vector3i): mesh_entered_events.append({"position": str(p), "phase": current_phase, "physics_frame": Engine.get_physics_frames()}))
 terrain.mesh_block_exited.connect(func(p: Vector3i): mesh_exited_events.append({"position": str(p), "phase": current_phase, "physics_frame": Engine.get_physics_frames()}))
 terrain.collision_layer = 1
 var mesher := VoxelMesherCubes.new()
 mesher.greedy_meshing_enabled = true
 mesher.color_mode = VoxelMesherCubes.COLOR_RAW
 terrain.mesher = mesher
 var voxel_format := VoxelFormat.new()
 voxel_format.set_channel_depth(VoxelBuffer.CHANNEL_COLOR, VoxelBuffer.DEPTH_32_BIT)
 terrain.format = voxel_format
 terrain.generator = Generator.new()
 world.add_child(terrain)
 viewer = VoxelViewer.new()
 viewer.position = Vector3(-8, 4, -1)
 viewer.view_distance = 80
 viewer.requires_visuals = true
 viewer.requires_collisions = true
 world.add_child(viewer)
 voxel_tool = terrain.get_voxel_tool()
 voxel_tool.channel = VoxelBuffer.CHANNEL_COLOR
 var ready := await _await_state("initial", false, 20.0)
 _check("initial_data_mesh_and_real_colliders_ready", ready)
 if not ready:
  _finish()
  return
 var space := world.get_world_3d().direct_space_state
 _check("actual_jolt_backend", space.get_class() == "JoltPhysicsDirectSpaceState3D", space.get_class())
 _check("raw_color_depth_32", _copy_region(Vector3i(-20, -1, -3), Vector3i(25, 1, 5)).get_channel_depth(VoxelBuffer.CHANNEL_COLOR) == VoxelBuffer.DEPTH_32_BIT)
 _verify_complete_grid([])
 for p: Vector3i in HOLES + GUARDS:
  var hit := _ray(p)
  _check("initial_integer_center_surface_" + str(p), not hit.is_empty() and absf(hit.position.y + 0.5) < 0.01, _hit_json(hit))
 # One exact cell is removed before the wider cross-block edit. Fractional rays
 # detect shifted geometry and accidental broad/collateral removal.
 for p in [Vector3(-20.49, 0, -1), Vector3(4.49, 0, -1), Vector3(-8, 0, -3.49), Vector3(-8, 0, 1.49)]:
  _check("inside_original_outer_edge_" + str(p), not _ray(p).is_empty())
 for p in [Vector3(-20.51, 0, -1), Vector3(4.51, 0, -1), Vector3(-8, 0, -3.51), Vector3(-8, 0, 1.51)]:
  _check("outside_original_outer_edge_" + str(p), _ray(p).is_empty())
 var single_cell := Vector3i(-17, -1, -1)
 var single_original := _copy_region(single_cell, Vector3i.ONE)
 var single_air := _copy_region(single_cell, Vector3i.ONE)
 single_air.set_voxel(0x11223300 if transparent_rgb_air else 0, 0, 0, 0, VoxelBuffer.CHANNEL_COLOR)
 _begin_submission("single_cell_hole")
 if not skip_edit:
  voxel_tool.paste(single_cell, single_air, CHANNEL_MASK)
 _record_immediate("single_cell_hole", [single_cell], GUARDS + [Vector3i(-16, -1, -1)])
 var single_pass := await _await_points("single_cell_hole", [Vector3(single_cell)], [Vector3(-16, -1, -1), Vector3(-18, -1, -1)], edit_timeout)
 _check("single_cell_real_collider_hole", single_pass)
 _verify_complete_grid([single_cell])
 for p in [Vector3(-17.49, 0, -1), Vector3(-16.51, 0, -1), Vector3(-17, 0, -1.49), Vector3(-17, 0, -0.51)]:
  _check("inside_single_cell_hole_edge_" + str(p), _ray(p).is_empty())
 for p in [Vector3(-17.51, 0, -1), Vector3(-16.49, 0, -1), Vector3(-17, 0, -1.51), Vector3(-17, 0, -0.49)]:
  _check("outside_single_cell_hole_edge_" + str(p), not _ray(p).is_empty())
 _begin_submission("single_restored")
 voxel_tool.paste(single_cell, single_original, CHANNEL_MASK)
 _record_immediate("single_restored", [], HOLES + GUARDS)
 _check("single_cell_restored_collision", await _await_state("single_restored", false, edit_timeout))
 var edit_origin := Vector3i(-17, -1, -1)
 var original := _copy_region(edit_origin, Vector3i(18, 1, 1))
 var modified := _copy_region(edit_origin, Vector3i(18, 1, 1))
 for p: Vector3i in HOLES:
  modified.set_voxel(0x11223300 if transparent_rgb_air else 0, p.x - edit_origin.x, 0, 0, VoxelBuffer.CHANNEL_COLOR)
 _check("editable_before_exact_bulk_paste", voxel_tool.is_area_editable(EDIT_AREA))
 _begin_submission("hole_collider_update")
 if not skip_edit:
  voxel_tool.paste(edit_origin, modified, CHANNEL_MASK)
 _record_immediate("hole_collider_update", HOLES, GUARDS)
 _verify_complete_grid(HOLES)
 var clear := await _await_state("hole_collider_update", true, edit_timeout)
 _check("hole_rays_clear_after_native_remesh", clear)
 for p: Vector3i in GUARDS:
  _check("untargeted_neighbor_still_collides_" + str(p), not _ray(p).is_empty())
 for p: Vector3i in HOLES:
  _check("raw_air_is_exact_zero_" + str(p), voxel_tool.get_voxel(p) == 0)
  var visual_ray = voxel_tool.raycast(Vector3(p.x, 8, p.z), Vector3.DOWN, 20.0)
  _check("voxel_ray_agrees_with_hole_" + str(p), visual_ray == null)
 _check("edited_area_reports_meshed", terrain.is_area_meshed(EDIT_AREA))
 _begin_submission("restored_collider_update")
 voxel_tool.paste(edit_origin, original, CHANNEL_MASK)
 _record_immediate("restored_collider_update", [], HOLES + GUARDS)
 var restored := await _await_state("restored_collider_update", false, edit_timeout)
 _check("restored_rays_hit_again", restored)
 _verify_complete_grid([])
 for p: Vector3i in HOLES:
  _check("restored_center_surface_" + str(p), absf(_ray(p).get("position", Vector3.INF).y + 0.5) < 0.01)
 _finish()

func _copy_region(origin: Vector3i, size: Vector3i) -> VoxelBuffer:
 var buffer := VoxelBuffer.new()
 buffer.create(size.x, size.y, size.z)
 buffer.set_channel_depth(VoxelBuffer.CHANNEL_COLOR, VoxelBuffer.DEPTH_32_BIT)
 voxel_tool.copy(origin, buffer, CHANNEL_MASK, false)
 return buffer

func _verify_complete_grid(removed_cells: Array) -> void:
 var wrong := 0
 var occupied := 0
 # Include an air border around all 125 original cells and both vertical layers.
 for z in range(-4, 3):
  for x in range(-21, 6):
   for y in range(-2, 1):
    var p := Vector3i(x, y, z)
    var expected := RAW_SOLID if x >= -20 and x <= 4 and z >= -3 and z <= 1 and y == -1 else 0
    if p in removed_cells: expected = 0
    var actual := voxel_tool.get_voxel(p)
    if actual != expected: wrong += 1
    if actual != 0: occupied += 1
 _check("full_grid_exact_removed_" + str(removed_cells.size()), wrong == 0, {"mismatch_count": wrong, "occupied": occupied, "expected_occupied": 125 - removed_cells.size()})

func _await_state(label: String, holes_expected: bool, timeout_sec: float) -> bool:
 var misses: Array = HOLES if holes_expected else []
 var hits: Array = GUARDS if holes_expected else HOLES + GUARDS
 return await _await_points(label, misses, hits, timeout_sec)

func _begin_submission(label: String) -> void:
 current_phase = label
 submission_stamps[label] = {"usec": Time.get_ticks_usec(), "physics_frame": Engine.get_physics_frames()}
 readiness_observations[label] = []

func _record_immediate(label: String, misses: Array, hits: Array) -> void:
 readiness_observations[label].append(_observe(label, misses, hits, "immediately_after_paste"))

func _observe(label: String, misses: Array, hits: Array, phase: String) -> Dictionary:
 var correct := true
 var unexpected_hits := 0
 var missing_hits := 0
 for p in misses:
  if not _ray(Vector3(p)).is_empty(): unexpected_hits += 1
 for p in hits:
  if _ray(Vector3(p)).is_empty(): missing_hits += 1
 correct = unexpected_hits == 0 and missing_hits == 0
 return {
  "phase": phase,
  "wall_ms_from_submit": float(Time.get_ticks_usec() - submission_stamps[label].usec) / 1000.0,
  "physics_frames_from_submit": Engine.get_physics_frames() - submission_stamps[label].physics_frame,
  "mesh_entered_signal_count": mesh_entered_events.size(),
  "mesh_exited_signal_count": mesh_exited_events.size(),
  "area_editable": voxel_tool.is_area_editable(EDIT_AREA),
  "area_meshed": terrain.is_area_meshed(EDIT_AREA),
  "ray_set_matches_expected": correct,
  "unexpected_hits_in_holes": unexpected_hits,
  "missing_hits_on_solid": missing_hits,
 }

func _await_points(label: String, misses: Array, hits: Array, timeout_sec: float) -> bool:
 if not submission_stamps.has(label): _begin_submission(label)
 var begin: int = submission_stamps[label].usec
 while float(Time.get_ticks_usec() - begin) / 1000000.0 < timeout_sec:
  await physics_frame
  await process_frame
  var sample := _observe(label, misses, hits, "after_physics_step")
  readiness_observations[label].append(sample)
  if sample.area_meshed and not timing.has(label + "_first_mesh_ready_wall_ms"):
   timing[label + "_first_mesh_ready_wall_ms"] = sample.wall_ms_from_submit
  if sample.ray_set_matches_expected and not timing.has(label + "_first_collision_ready_wall_ms"):
   timing[label + "_first_collision_ready_wall_ms"] = sample.wall_ms_from_submit
   timing[label + "_first_collision_ready_physics_ticks"] = sample.physics_frames_from_submit
  if sample.area_editable and sample.area_meshed and sample.ray_set_matches_expected:
   timing[label + "_wall_ms"] = sample.wall_ms_from_submit
   timing[label + "_physics_ticks"] = sample.physics_frames_from_submit
   return true
 timing[label + "_timeout"] = true
 return false

func _ray(p: Vector3) -> Dictionary:
 var query := PhysicsRayQueryParameters3D.create(Vector3(p.x, 8, p.z), Vector3(p.x, -8, p.z), 1)
 return world.get_world_3d().direct_space_state.intersect_ray(query)

func _hit_json(hit: Dictionary) -> Dictionary:
 return {"hit": not hit.is_empty(), "position": str(hit.get("position", "")), "normal": str(hit.get("normal", ""))}

func _check(label: String, condition: bool, detail: Variant = null) -> void:
 checks.append({"name": label, "pass": condition, "detail": detail})
 if not condition:
  failures.append(label)
  printerr("FAIL ", label, " ", detail)

func _finish() -> void:
 var result := {
  "schema": "voxel-native-terrain-qa/v1", "pass": failures.is_empty(), "failures": failures, "checks": checks,
  "engine": Engine.get_version_info().string, "backend": world.get_world_3d().direct_space_state.get_class(),
  "physics_hz": Engine.physics_ticks_per_second, "scene_nodes_created": world.find_children("*", "", true, false).size(),
  "display_server": DisplayServer.get_name(), "gpu_frame_verified": false, "render_frames_drawn": Engine.get_frames_drawn(),
  "mesh_block_size": mesh_size, "tested_grid_samples_per_pass": 567,
  "terrain_transform": str(terrain.transform), "timing": timing, "statistics": terrain.get_statistics(), "readiness_observations": readiness_observations,
  "mesh_entered_events": mesh_entered_events, "mesh_exited_events": mesh_exited_events,
  "ray_evidence": "PhysicsDirectSpaceState3D.intersect_ray against terrain-created colliders", "negative_control_skip_edit": skip_edit, "negative_control_transparent_rgb_air": transparent_rgb_air,
 }
 var file := FileAccess.open(report_path, FileAccess.WRITE)
 file.store_string(JSON.stringify(result, "\t") + "\n")
 file.close()
 print("VOXEL_NATIVE_TERRAIN_QA pass=", failures.is_empty(), " checks=", checks.size(), " failures=", failures, " timing=", timing)
 world.queue_free()
 await process_frame
 quit(0 if failures.is_empty() else 1)
