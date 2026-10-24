extends SceneTree

const Generator := preload("res://tests/qa-voxel/flat_fixture_generator.gd")
const Edits := preload("res://scripts/native_terrain_edits.gd")
const CollisionOwner := preload("res://scripts/native_static_world.gd")
const SOLID := 0x887766ff
const CHOSEN := [Vector3i(-17,-1,-1), Vector3i(-16,-1,-1), Vector3i(-1,-1,-1), Vector3i(0,-1,-1)]
var world: Node3D
var terrain: VoxelTerrain
var viewer: VoxelViewer
var voxel_tool: VoxelTool
var checks: Array[Dictionary] = []
var failures: Array[String] = []
var cells := PackedByteArray()
var ordinal_by_position := {}
var owner
var report_path := "res://tests/qa-voxel/game-adapters.json"
var ray_evidence: Array[Dictionary] = []

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
 call_deferred("_run")

func _run() -> void:
 world = Node3D.new()
 root.add_child(world)
 terrain = VoxelTerrain.new()
 terrain.position = Vector3(-0.5,-0.5,-0.5)
 terrain.bounds = AABB(Vector3(-128,-32,-32), Vector3(256,64,64))
 terrain.max_view_distance = 128
 terrain.mesh_block_size = 16
 terrain.generate_collisions = false
 var format := VoxelFormat.new()
 format.set_channel_depth(VoxelBuffer.CHANNEL_COLOR, VoxelBuffer.DEPTH_32_BIT)
 terrain.format = format
 terrain.mesher = VoxelMesherCubes.new()
 terrain.generator = Generator.new()
 world.add_child(terrain)
 viewer = VoxelViewer.new()
 viewer.position = Vector3(-8,4,-1)
 viewer.view_distance = 48
 viewer.requires_visuals = true
 viewer.requires_collisions = false
 world.add_child(viewer)
 voxel_tool = terrain.get_voxel_tool()
 voxel_tool.channel = VoxelBuffer.CHANNEL_COLOR
 var begin := Time.get_ticks_msec()
 while Time.get_ticks_msec() - begin < 20000:
  await physics_frame
  await process_frame
  if voxel_tool.is_area_editable(AABB(Vector3(-32,-16,-16),Vector3(48,16,16))) and terrain.is_area_meshed(AABB(Vector3(-20,-1,-3),Vector3(25,1,5))):
   break
 _check("all_test_chunks_loaded", voxel_tool.is_area_editable(AABB(Vector3(-32,-16,-16),Vector3(48,16,16))))
 if not failures.is_empty():
  await _finish()
  return
 _check("real_jolt_backend", world.get_world_3d().direct_space_state.get_class() == "JoltPhysicsDirectSpaceState3D")
 _check("no_voxel_terrain_collider_when_disabled", _ray(-17).is_empty() and _ray(0).is_empty())
 _pack_fixture()
 var edits := Edits.new()
 var selected := PackedInt32Array()
 for p in CHOSEN: selected.append(ordinal_by_position[p])
 # Duplicate chosen ordinals must not inflate counts or erase anything additional.
 selected.append(selected[0])
 var groups: Dictionary = edits.group_ordinals(cells, selected)
 _check("negative_floor_division_three_native_data_blocks", groups.size() == 3 and groups.has(Vector3i(-2,-1,-1)) and groups.has(Vector3i(-1,-1,-1)) and groups.has(Vector3i(0,-1,-1)))
 _check("negative_coordinate_local_index_exact", groups.get(Vector3i(-2,-1,-1),[]) == [Vector3i(15,15,15)] and groups.get(Vector3i(-1,-1,-1),[]) == [Vector3i(0,15,15),Vector3i(15,15,15)] and groups.get(Vector3i(0,-1,-1),[]) == [Vector3i(0,15,15)])
 _check_grid([], "pristine_exact_125")
 var pristine := _copy_slab()
 var mixed := PackedInt32Array([selected[0], 125])
 var rejected: Dictionary = edits.apply_removed(terrain, cells, mixed)
 _check("unloaded_mixed_batch_rejected", rejected.get("accepted") == false and rejected.get("reason") == "data-not-loaded", rejected)
 _check_grid([], "unloaded_mixed_batch_atomic_no_mutation")
 voxel_tool.paste(Vector3i(-20,-1,-3),pristine,VoxelBuffer.CHANNEL_COLOR_BIT)
 _check("in_bounds_distant_block_not_loaded", not terrain.has_data_block(Vector3i(7,-1,-1)))
 rejected = edits.apply_removed(terrain,cells,PackedInt32Array([selected[0],126]))
 _check("in_bounds_unloaded_mixed_batch_rejected", rejected.get("accepted") == false and rejected.get("reason") == "data-not-loaded", rejected)
 _check_grid([],"in_bounds_unloaded_batch_atomic_no_mutation")
 voxel_tool.paste(Vector3i(-20,-1,-3),pristine,VoxelBuffer.CHANNEL_COLOR_BIT)
 rejected = edits.apply_removed(terrain, cells, PackedInt32Array([selected[0],-1]))
 _check("invalid_negative_ordinal_rejected", rejected.get("accepted") == false and rejected.get("reason") == "invalid-ordinals")
 _check_grid([], "invalid_ordinal_atomic_no_mutation")
 rejected = edits.apply_removed(terrain, cells, PackedInt32Array([selected[0],127]))
 _check("past_end_ordinal_rejected", rejected.get("accepted") == false)
 _check_grid([], "past_end_atomic_no_mutation")
 var empty: Dictionary = edits.apply_removed(terrain, cells, PackedInt32Array())
 _check("empty_edit_no_op", empty.get("accepted") == true and empty.get("removed_cells") == 0 and empty.get("dirty_data_blocks") == 0)
 var saved := _copy_slab()
 var applied: Dictionary = edits.apply_removed(terrain, cells, selected)
 _check("only_four_unique_cells_three_data_blocks_submitted", applied.get("accepted") == true and applied.get("removed_cells") == 4 and applied.get("dirty_data_blocks") == 3, applied)
 _check("does_not_claim_async_mesh_or_collision_ack", applied.get("mesh_ack") == false and applied.get("collider_ack") == false)
 _check_grid(CHOSEN, "chosen_only_exact_121")
 for p in CHOSEN:
  _check("chosen_raw_zero_"+str(p), voxel_tool.get_voxel(p) == 0)
 voxel_tool.paste(Vector3i(-20,-1,-3), saved, VoxelBuffer.CHANNEL_COLOR_BIT)
 _check_grid([], "restored_125_including_untargeted_neighbors")
 # Deliberately stay in the same World3D, with voxel colliders disabled, while
 # exercising exact shape ownership, local replacement, and stale-RID mapping.
 owner = CollisionOwner.new(world.get_world_3d().space)
 var original := {
  100: PackedFloat32Array([-33,-1,-1,.5,.5,.5,-32,-1,-1,.5,.5,.5]),
  200: PackedFloat32Array([-17,-1,-1,.5,.5,.5]),
  300: PackedFloat32Array([0,-1,-1,.5,.5,.5]),
  400: PackedFloat32Array([1,-1,-1,.5,.5,.5]),
 }
 owner.install(original)
 await physics_frame
 await process_frame
 for pair in [[-33,100],[-32,100],[-17,200],[0,300],[1,400]]:
  _check_ray_owner(pair[0],pair[1],"installed")
 _check("shared_shape_resource_not_per_cell_bodies", owner.stats().bodies == 3 and owner.stats().shapes == 5 and owner.stats().shape_resources == 1, owner.stats())
 var distant_hit := _ray(-33)
 var replaced_hit := _ray(0)
 var tick_before := Engine.get_physics_frames()
 var replaced: Dictionary = owner.replace_regions({300:PackedFloat32Array()})
 _check("replace_did_not_step_physics", Engine.get_physics_frames() == tick_before)
 _check("immediate_removed_hole_before_next_tick", _ray(0).is_empty())
 _check("dirty_chunk_shape_count", replaced.get("dirty_chunks") == 1 and replaced.get("shapes") == 4, replaced)
 _check_ray_owner(1,400,"neighbor_after_rebuild")
 _check_ray_owner(-17,200,"separate_negative_chunk")
 _check("unaffected_distant_rid_retained", _ray(-33).get("rid") == distant_hit.get("rid"))
 _check("retired_body_rid_mapping_cleared", owner.region_for_shape(replaced_hit.rid,replaced_hit.shape) == -1)
 _check("invalid_shape_index_returns_sentinel", owner.region_for_shape(_ray(1).rid,-1) == -1 and owner.region_for_shape(_ray(1).rid,99999) == -1)
 owner.replace_regions({300:original[300]})
 _check("restore_also_before_next_tick", Engine.get_physics_frames() == tick_before)
 _check_ray_owner(0,300,"immediately_restored")
 # A region spanning two negative chunk-center bins is moved to a new positive bin.
 replaced = owner.replace_regions({100:PackedFloat32Array([33,-1,-1,.5,.5,.5])})
 _check("moved_region_dirties_old_and_new_chunks", replaced.get("dirty_chunks") == 3, replaced)
 _check("all_old_region_shapes_gone_immediately", _ray(-33).is_empty() and _ray(-32).is_empty())
 _check_ray_owner(33,100,"moved_region")
 _check_ray_owner(-17,200,"neighbor_survives_moved_region")
 owner.dispose()
 _check("dispose_removes_all_live_geometry_immediately", _ray(-17).is_empty() and _ray(0).is_empty() and _ray(1).is_empty() and _ray(33).is_empty())
 _check("dispose_clears_bodies_shapes_and_cache", owner.stats() == {"bodies":0,"shapes":0,"shape_resources":0})
 await physics_frame
 await process_frame
 _check("voxel_colliders_never_reappear_after_owner_dispose", _ray(-17).is_empty() and _ray(0).is_empty())
 await _finish()

func _pack_fixture() -> void:
 cells.resize(127*35)
 var ordinal := 0
 for z in range(-3,2):
  for x in range(-20,5):
   var p := Vector3i(x,-1,z)
   ordinal_by_position[p] = ordinal
   _pack_position(ordinal,p)
   ordinal += 1
 # This location is outside the terrain bounds and viewer coverage.
 _pack_position(125,Vector3i(-1024,-1,-1))
 _pack_position(126,Vector3i(127,-1,-1))

func _pack_position(o: int, p: Vector3i) -> void:
 cells.encode_s32(o*35,o)
 cells.encode_s16(o*35+4,p.x)
 cells.encode_s16(o*35+6,p.y)
 cells.encode_s16(o*35+8,p.z)

func _copy_slab() -> VoxelBuffer:
 var buffer := VoxelBuffer.new()
 buffer.create(25,1,5)
 buffer.set_channel_depth(VoxelBuffer.CHANNEL_COLOR,VoxelBuffer.DEPTH_32_BIT)
 voxel_tool.copy(Vector3i(-20,-1,-3),buffer,VoxelBuffer.CHANNEL_COLOR_BIT,false)
 return buffer

func _check_grid(removed: Array, label: String) -> void:
 var wrong := 0
 for z in range(-4,3):
  for x in range(-21,6):
   for y in range(-2,1):
    var p := Vector3i(x,y,z)
    var expected := SOLID if x >= -20 and x <= 4 and z >= -3 and z <= 1 and y == -1 and p not in removed else 0
    if voxel_tool.get_voxel(p) != expected: wrong += 1
 _check(label,wrong == 0,{"mismatch_count":wrong})

func _ray(x: float) -> Dictionary:
 return world.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x,2,-1),Vector3(x,-4,-1),1))

func _check_ray_owner(x: float, expected: int, label: String) -> void:
 var hit := _ray(x)
 var actual := -1 if hit.is_empty() else int(owner.region_for_shape(hit.rid,hit.shape))
 ray_evidence.append({"phase":label,"x":x,"expected_region":expected,"actual_region":actual,"shape_index":hit.get("shape",-1),"physics_frame":Engine.get_physics_frames()})
 _check(label+"_ray_region_"+str(x),not hit.is_empty() and actual == expected)

func _check(label: String, passed: bool, detail: Variant = null) -> void:
 checks.append({"name":label,"pass":passed,"detail":detail})
 if not passed:
  failures.append(label)
  printerr("FAIL ",label," ",detail)

func _finish() -> void:
 var report := {"schema":"voxel-game-adapter-qa/v1","pass":failures.is_empty(),"failures":failures,"checks":checks,"ray_evidence":ray_evidence,
  "engine":Engine.get_version_info().string,"backend":world.get_world_3d().direct_space_state.get_class(),"display_server":DisplayServer.get_name(),
  "gpu_frame_verified":false,"voxel_generate_collisions":terrain.generate_collisions,"physics_hz":Engine.physics_ticks_per_second}
 var file := FileAccess.open(report_path,FileAccess.WRITE)
 file.store_string(JSON.stringify(report,"\t")+"\n")
 file.close()
 print("VOXEL_GAME_ADAPTER_QA pass=",failures.is_empty()," checks=",checks.size()," failures=",failures)
 world.queue_free()
 await process_frame
 quit(0 if failures.is_empty() else 1)
