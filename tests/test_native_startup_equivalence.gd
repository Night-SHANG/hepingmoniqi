extends SceneTree

# Independent behavioral oracle for startup-only data preparation changes.
# Source identity is pinned here, not taken from the new prebuilt metadata.
# This test never claims a rendered frame, player GPU speed, or Windows timing.
const SOURCE_COUNT := 454913
const SOURCE_SHA256 := "da1492c3b63a7b60cc354c106852c2842f61d85d538340dc7a3eaf8b500ef5ff"
const SOURCE_BOUNDS := AABB(Vector3(-122, -8, -102), Vector3(245, 44, 205))
const BLOCK_SIZE := 16
const CHANNEL := VoxelBuffer.CHANNEL_COLOR
const Generator := preload("res://scripts/city_voxel_generator.gd")

var checks: Array[Dictionary] = []
var failures: Array[String] = []
var cells := PackedByteArray()
var block_positions: Dictionary = {}
var report_path := "res://tests/qa-startup/equivalence.json"
var data_only := false
var negative_corrupt_color := false
var negative_extra_voxel := false
var startup_profiles: Array[Dictionary] = []
var view

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg == "--data-only": data_only = true
  elif arg == "--negative-corrupt-color": negative_corrupt_color = true
  elif arg == "--negative-extra-voxel": negative_extra_voxel = true
  elif arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
 call_deferred("_run")

func _check(label: String, ok: bool, detail: Variant = null) -> void:
 checks.append({"name":label, "pass":ok, "detail":detail})
 if not ok:
  failures.append(label)
  printerr("FAIL ", label, " ", detail)

func _sha(bytes: PackedByteArray) -> String:
 var context := HashingContext.new()
 context.start(HashingContext.HASH_SHA256)
 context.update(bytes)
 return context.finish().hex_encode()

func _position(ordinal: int) -> Vector3i:
 var offset := ordinal * 35
 return Vector3i(cells.decode_s16(offset + 4), cells.decode_s16(offset + 6), cells.decode_s16(offset + 8))

func _block(position: Vector3i) -> Vector3i:
 # Deliberately use mathematical floor rather than the writer's signed shifts.
 return Vector3i(floori(position.x / 16.0), floori(position.y / 16.0), floori(position.z / 16.0))

func _source_color(ordinal: int) -> int:
 return (cells.decode_u32(ordinal * 35 + 30) << 8) | 255

func _new_buffer() -> VoxelBuffer:
 var buffer := VoxelBuffer.new()
 buffer.create(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
 buffer.set_channel_depth(CHANNEL, VoxelBuffer.DEPTH_32_BIT)
 return buffer

func _generator_buffers(generator) -> Dictionary:
 var buffers := {}
 for position: Vector3i in block_positions:
  var buffer := _new_buffer()
  generator._generate_block(buffer, position * BLOCK_SIZE, 0)
  buffers[position] = buffer
 return buffers

func _terrain_buffers(terrain: VoxelTerrain) -> Dictionary:
 var buffers := {}
 var tool := terrain.get_voxel_tool()
 tool.channel = CHANNEL
 for position: Vector3i in block_positions:
  var buffer := _new_buffer()
  tool.copy(position * BLOCK_SIZE, buffer, VoxelBuffer.CHANNEL_COLOR_BIT, false)
  buffers[position] = buffer
 return buffers

func _buffer_hash(buffers: Dictionary) -> String:
 var context := HashingContext.new()
 context.start(HashingContext.HASH_SHA256)
 for position: Vector3i in block_positions:
  var buffer: VoxelBuffer = buffers[position]
  buffer.decompress_channel(CHANNEL)
  context.update(buffer.get_channel_as_byte_array(CHANNEL))
 return context.finish().hex_encode()

func _verify_buffers(buffers: Dictionary, label: String, model = null) -> void:
 var mismatches := 0
 var first_mismatch := {}
 var expected_occupied := 0
 var occupied := 0
 var wrong_depth := 0
 for ordinal in SOURCE_COUNT:
  var p := _position(ordinal)
  var block := _block(p)
  var local := p - block * BLOCK_SIZE
  var buffer: VoxelBuffer = buffers[block]
  var expected := _source_color(ordinal)
  if model != null and not model.is_static_cell(ordinal): expected = 0
  if expected != 0: expected_occupied += 1
  # Read via the native 3D accessor, not the prebuilder's Y-fast byte formula.
  var actual := buffer.get_voxel(local.x, local.y, local.z, CHANNEL)
  if actual != expected:
   mismatches += 1
   if first_mismatch.is_empty():
    first_mismatch = {"ordinal":ordinal, "position":str(p), "actual":actual, "expected":expected}
 for block in buffers:
  var buffer: VoxelBuffer = buffers[block]
  if buffer.get_channel_depth(CHANNEL) != VoxelBuffer.DEPTH_32_BIT: wrong_depth += 1
  buffer.decompress_channel(CHANNEL)
  var raw: PackedByteArray = buffer.get_channel_as_byte_array(CHANNEL)
  for value in raw.to_int32_array():
   if value != 0: occupied += 1
 _check(label + "_every_source_coordinate_and_rgba", mismatches == 0,
  {"compared_cells":SOURCE_COUNT, "mismatches":mismatches, "first_mismatch":first_mismatch})
 # Combined with exact source matches, this catches phantom cells in source air,
 # unoccupied chunks and extra prebuilt records, not merely missing source cells.
 _check(label + "_no_extra_or_missing_occupied_cells", occupied == expected_occupied,
  {"occupied":occupied, "expected":expected_occupied, "checked_blocks":buffers.size()})
 _check(label + "_all_buffers_rgba32", wrong_depth == 0)

func _run() -> void:
 cells = FileAccess.get_file_as_bytes("res://data/city-cells.bin")
 _check("pinned_full_source_length", cells.size() == SOURCE_COUNT * 35)
 _check("pinned_full_source_sha256", _sha(cells) == SOURCE_SHA256)
 if not failures.is_empty():
  await _finish()
  return
 var manifest: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/manifest.json"))
 var generator = Generator.new()
 _check("prebuilt_initializer_available", generator.has_method("initialize_from_prebuilt"))
 _check("prebuilt_metadata_available", FileAccess.file_exists("res://data/city-voxel-blocks.json"))
 _check("prebuilt_payload_available", FileAccess.file_exists("res://data/city-voxel-blocks.bin"))
 if not failures.is_empty():
  await _finish()
  return
 var metadata: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/city-voxel-blocks.json"))
 var payload := FileAccess.get_file_as_bytes("res://data/city-voxel-blocks.bin")
 var record_bytes := 12 + BLOCK_SIZE * BLOCK_SIZE * BLOCK_SIZE * 4
 _check("prebuilt_records_have_expected_length", payload.size() % record_bytes == 0)
 var actual_min := Vector3i(32767, 32767, 32767)
 var actual_max := Vector3i(-32768, -32768, -32768)
 for ordinal in SOURCE_COUNT:
  var p := _position(ordinal)
  actual_min = actual_min.min(p)
  actual_max = actual_max.max(p)
  block_positions[_block(p)] = true
 # Include every payload block even if it has no matching source coordinate.
 for offset in range(0, payload.size(), record_bytes):
  if offset + record_bytes > payload.size(): break
  block_positions[Vector3i(payload.decode_s32(offset), payload.decode_s32(offset + 4), payload.decode_s32(offset + 8))] = true
 var decoded_bounds := AABB(Vector3(actual_min), Vector3(actual_max - actual_min + Vector3i.ONE))
 _check("pinned_source_extrema", decoded_bounds == SOURCE_BOUNDS)
 var mutable_payload := payload.duplicate()
 var mutable_metadata := metadata.duplicate(true)
 var mutable_manifest := manifest.duplicate(true)
 var prepared: Dictionary = generator.initialize_from_prebuilt(mutable_payload, mutable_metadata, mutable_manifest)
 _check("prebuilt_initializer_accepts_same_city", prepared.get("ok", false), prepared)
 if not prepared.get("ok", false):
  await _finish()
  return
 _check("prebuilt_reports_same_cell_count", prepared.get("cell_count") == SOURCE_COUNT)
 _check("generator_bounds_match_source_exactly", generator.cell_bounds == SOURCE_BOUNDS)
 _check("generator_preserves_integer_center_translation", generator.terrain_translation == Vector3(-0.5, -0.5, -0.5))
 var buffers := _generator_buffers(generator)
 var pristine_hash := _buffer_hash(buffers)
 if negative_corrupt_color:
  var p := _position(SOURCE_COUNT / 2)
  var local := p - _block(p) * BLOCK_SIZE
  buffers[_block(p)].set_voxel(0x123456ff, local.x, local.y, local.z, CHANNEL)
 if negative_extra_voxel:
  var injected := false
  for buffer: VoxelBuffer in buffers.values():
   if injected: break
   for z in BLOCK_SIZE:
    if injected: break
    for x in BLOCK_SIZE:
     if injected: break
     for y in BLOCK_SIZE:
      if buffer.get_voxel(x, y, z, CHANNEL) == 0:
       buffer.set_voxel(0x123456ff, x, y, z, CHANNEL)
       injected = true
       break
 _verify_buffers(buffers, "prebuilt")
 # Mutate all caller-owned inputs and all output voxels. None is storage owned
 # by the generator or a later session, even when the implementation uses COW.
 mutable_payload.fill(0)
 mutable_metadata.clear()
 mutable_manifest.bounds.minX = 999
 for buffer: VoxelBuffer in buffers.values(): buffer.fill(0, CHANNEL)
 buffers.clear()
 _check("input_and_output_mutations_cannot_alias_pristine_blocks", _buffer_hash(_generator_buffers(generator)) == pristine_hash)
 _check("input_manifest_mutation_cannot_alias_bounds", generator.cell_bounds == SOURCE_BOUNDS)
 var again: Dictionary = generator.initialize_from_prebuilt(payload, metadata, manifest)
 _check("initialized_generator_rejects_replacement", not again.get("ok", true))
 _check("rejected_reinitialization_does_not_change_pristine_blocks", _buffer_hash(_generator_buffers(generator)) == pristine_hash)
 var fresh = Generator.new()
 var fresh_result: Dictionary = fresh.initialize_from_prebuilt(payload, metadata, manifest)
 _check("fresh_generator_initializes_after_other_outputs_destroyed", fresh_result.get("ok", false))
 if fresh_result.get("ok", false):
  _check("fresh_generator_is_identical_to_pristine", _buffer_hash(_generator_buffers(fresh)) == pristine_hash)
 var outside := Vector3i(1000, 1000, 1000)
 _check("absent_block_returns_air", generator.get_raw_color(outside) == 0)
 if not data_only and failures.is_empty(): await _test_destructive_reset(pristine_hash)
 await _finish()

func _test_destructive_reset(pristine_hash: String) -> void:
 var scene: PackedScene = load("res://scenes/native_slice.tscn")
 view = scene.instantiate()
 view.auto_start = false
 root.add_child(view)
 await process_frame
 await view._start_session()
 _check("real_session_starts", view._session.is_ready)
 if not view._session.is_ready: return
 var session = view._session
 session.set_physics_process(false)
 startup_profiles.append(session.startup_metrics())
 _check("initial_session_uses_prebuilt_not_silent_fallback", startup_profiles[-1].get("voxel_source") == "prebuilt")
 _verify_buffers(_terrain_buffers(session.terrain), "initial_session")
 var original_model = session.model
 var original_stats: Dictionary = original_model.stats()
 var original_generator = session.terrain.generator
 var original_rubble = session.rubble
 var original_statics = session.statics
 _check("original_pristine_model_full_population", original_stats.aliveCells == SOURCE_COUNT)
 _check("actual_session_blast_accepted", session.blast(Vector3(-48, 3, 42.5)))
 var damaged_stats: Dictionary = original_model.stats()
 _check("actual_blast_changes_authoritative_population", damaged_stats.aliveCells < SOURCE_COUNT and damaged_stats.research > 0)
 _verify_buffers(_terrain_buffers(session.terrain), "damaged_session", original_model)
 _check("terrain_destruction_does_not_mutate_generator", _buffer_hash(_generator_buffers(original_generator)) == pristine_hash)
 _check("terrain_destruction_does_not_mutate_source_cells", _sha(session.data.cells) == SOURCE_SHA256)
 _check("damaged_session_has_no_failures", session.status().failures.is_empty())
 # Exercise the actual R-button reset path, not a test-only restoration helper.
 await view._reset_session()
 _check("destructive_reset_starts_fresh_session", view._session != null and view._session.is_ready)
 if view._session == null or not view._session.is_ready: return
 var restored = view._session
 restored.set_physics_process(false)
 startup_profiles.append(restored.startup_metrics())
 _check("reset_session_uses_prebuilt_not_silent_fallback", startup_profiles[-1].get("voxel_source") == "prebuilt")
 _check("destructive_reset_releases_previous_owners", original_rubble.stats().ownedRids == 0 and original_statics.stats().bodies == 0 and original_statics.stats().shape_resources == 0)
 _check("reset_model_is_distinct_from_damaged_model", restored.model != original_model)
 _check("reset_preserves_old_model_damage_without_aliasing", original_model.stats() == damaged_stats)
 _check("reset_model_matches_all_pristine_counters", restored.model.stats() == original_stats)
 _check("reset_clears_session_effects_and_commands", restored.status().blast_count == 0 and restored.status().research == 0 and restored.effects().is_empty() and restored.projectiles().is_empty())
 _verify_buffers(_terrain_buffers(restored.terrain), "reset_session")
 var hp_mismatches := 0
 for ordinal in SOURCE_COUNT:
  if restored.model.cell_hp(ordinal) != cells.decode_double(ordinal * 35 + 14): hp_mismatches += 1
 _check("reset_restores_every_source_cell_hp", hp_mismatches == 0, {"compared_cells":SOURCE_COUNT, "mismatches":hp_mismatches})
 _check("reset_generator_is_exactly_pristine", _buffer_hash(_generator_buffers(restored.terrain.generator)) == pristine_hash)
 _check("reset_keeps_source_bytes_immutable", _sha(restored.data.cells) == SOURCE_SHA256)
 _check("reset_session_has_no_failures", restored.status().failures.is_empty())

func _finish() -> void:
 if is_instance_valid(view):
  view.queue_free()
  await process_frame
 var report := {"schema":"native-startup-equivalence/v1", "pass":failures.is_empty(),
  "checks":checks, "failures":failures, "source_cells":SOURCE_COUNT, "source_sha256":SOURCE_SHA256,
  "data_only":data_only, "negative_corrupt_color":negative_corrupt_color,
  "negative_extra_voxel":negative_extra_voxel, "startup_profiles":startup_profiles,
  "display_server":DisplayServer.get_name(), "gpu_frame_verified":false,
  "scope":"Exact source colors/occupancy/bounds, ownership isolation, and actual destructive R-reset; not performance or GPU evidence"}
 DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(report_path.get_base_dir()))
 var file := FileAccess.open(report_path, FileAccess.WRITE)
 if file == null:
  printerr("Cannot write equivalence report: ", report_path)
  quit(1)
  return
 file.store_string(JSON.stringify(report, "\t") + "\n")
 print("NATIVE_STARTUP_EQUIVALENCE ", JSON.stringify({"pass":failures.is_empty(), "checks":checks.size(), "failures":failures, "data_only":data_only}))
 quit(0 if failures.is_empty() else 1)
