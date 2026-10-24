extends SceneTree
## Serial startup comparison through the actual main scene and real R input.
## Headless reports session readiness only; no draw is inferred or synthesized.

const READY_TIMEOUT_MS := 45000
const SOURCE_COUNT := 454913
var view
var checks: Array[Dictionary] = []
var failures: Array[String] = []
var generations: Array[Dictionary] = []
var report_path := ""
var expected_source := "prebuilt"
var headless := true

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
  elif arg == "--native-startup-baseline": expected_source = "baseline"
 headless = DisplayServer.get_name() == "headless"
 Input.use_accumulated_input = false
 root.size = Vector2i(1280, 800)
 call_deferred("_run")

func _check(label: String, ok: bool, detail: Variant = null) -> bool:
 checks.append({"name":label, "pass":ok, "detail":detail})
 if not ok:
  failures.append(label)
  printerr("FAIL ", label, " ", detail)
 return ok

func _wait_ready(previous_id: int = 0) -> bool:
 var deadline := Time.get_ticks_msec() + READY_TIMEOUT_MS
 while Time.get_ticks_msec() < deadline:
  await process_frame
  var candidate = view.get("_session")
  if not is_instance_valid(candidate) or candidate.get_instance_id() == previous_id: continue
  if not candidate.is_ready or view.get("_loading"): continue
  var profile: Dictionary = view.startup_view_metrics()
  if not profile.has("session_ready_ms"): continue
  if not headless and profile.get("ready_draw_ms") == null: continue
  return _check("initial_ready" if previous_id == 0 else "r_key_reset_ready", true)
 return _check("initial_ready" if previous_id == 0 else "r_key_reset_ready", false,
  {"timeout_ms":READY_TIMEOUT_MS, "profile":view.startup_view_metrics()})

func _snapshot(label: String) -> Dictionary:
 var session = view.get("_session")
 var profile: Dictionary = view.startup_view_metrics()
 var status: Dictionary = session.status()
 var counters: Dictionary = session.model.stats()
 var statics: Dictionary = session.statics.stats()
 _check(label + "_full_source_population", session.data.cells.size() == SOURCE_COUNT * 35 and counters.aliveCells == SOURCE_COUNT)
 _check(label + "_source_hash_verified", session.data.metrics.hashes_verified)
 _check(label + "_expected_initializer", profile.authority.get("voxel_source") == expected_source, profile.authority.get("voxel_source"))
 _check(label + "_pristine_counters", status.blast_count == 0 and status.research == 0 and counters.processedEvents == 0 and counters.lastSequence == 0)
 _check(label + "_no_commands_effects_or_rubble", session.projectiles().is_empty() and session.effects().is_empty() and session.rubble_views().is_empty())
 _check(label + "_no_failures", status.failures.is_empty(), status.failures)
 _check(label + "_collision_owners_present", statics.bodies > 0 and statics.shapes > 0 and status.owned_collision_rids > 0)
 _check(label + "_same_actual_jolt_world", session.get_world_3d() == view.get_world_3d() and session.get_world_3d().direct_space_state.get_class() == "JoltPhysicsDirectSpaceState3D")
 if headless:
  _check(label + "_headless_draw_timings_stay_null", profile.has("ready_draw_ms") and profile.ready_draw_ms == null and profile.has("process_to_ready_draw_ms") and profile.process_to_ready_draw_ms == null)
 else:
  _check(label + "_real_ready_frame_observed", profile.ready_draw_ms != null and profile.process_to_ready_draw_ms != null and Engine.get_frames_drawn() > 0)
  _check(label + "_draw_follows_session_ready", profile.ready_draw_ms >= profile.session_ready_ms and profile.process_to_ready_draw_ms >= profile.authority.process_to_ready_ms)
 var stage_sum := 0.0
 var stages_present := true
 for stage in ["read_verify_decode", "regional_model", "voxel_prepare", "collision_prepare", "collision_install", "terrain_attach", "mesh_wait"]:
  stages_present = stages_present and profile.authority.stages_ms.has(stage)
  var duration := float(profile.authority.stages_ms.get(stage, -1.0))
  stages_present = stages_present and duration >= 0
  stage_sum += duration
 _check(label + "_all_startup_stages_accounted", stages_present and absf(stage_sum - profile.authority.total_ms) < 0.01)
 var snapshot := {"label":label, "view":profile, "model_counters":counters,
  "static_owners":statics, "owned_collision_rids":status.owned_collision_rids,
  "source_cells":SOURCE_COUNT, "frames_drawn":Engine.get_frames_drawn()}
 generations.append(snapshot)
 print("NATIVE_STARTUP_GENERATION ", JSON.stringify(snapshot))
 return snapshot

func _key_r() -> void:
 for down in [true, false]:
  var event := InputEventKey.new()
  event.keycode = KEY_R
  event.physical_keycode = KEY_R
  event.pressed = down
  event.echo = false
  Input.parse_input_event(event)
  await process_frame

func _run() -> void:
 var scene: PackedScene = load("res://scenes/native_slice.tscn")
 view = scene.instantiate()
 root.add_child(view)
 current_scene = view
 if not await _wait_ready():
  await _finish()
  return
 var initial := _snapshot("initial")
 var old_id: int = view._session.get_instance_id()
 var old_rubble = view._session.rubble
 var old_statics = view._session.statics
 var requested := Time.get_ticks_usec()
 await _key_r()
 if not await _wait_ready(old_id):
  await _finish()
  return
 var reset := _snapshot("r_key_reset")
 reset.r_key_to_observed_ready_ms = (Time.get_ticks_usec() - requested) / 1000.0
 _check("reset_advances_generation", int(reset.view.generation) > int(initial.view.generation))
 _check("reset_releases_prior_collision_owners", old_rubble.stats().ownedRids == 0 and old_statics.stats() == {"bodies":0, "shapes":0, "shape_resources":0})
 _check("reset_preserves_pristine_model_counters", reset.model_counters == initial.model_counters)
 _check("reset_preserves_collision_shape_inventory", reset.static_owners == initial.static_owners and reset.owned_collision_rids == initial.owned_collision_rids)
 await _finish()

func _finish() -> void:
 if is_instance_valid(view):
  view.queue_free()
  await process_frame
 var report := {"schema":"native-startup-observation/v1", "pass":failures.is_empty(),
  "checks":checks, "failures":failures, "generations":generations,
  "engine":Engine.get_version_info().string, "platform":OS.get_name(),
  "display_server":DisplayServer.get_name(), "initializer":expected_source,
  "headless_only":headless, "ready_frame_observed":not headless and generations.size() == 2 and failures.is_empty(),
  "gpu_frame_verified":false, "pixel_readback_verified":false,
  "input_route":"Input.parse_input_event -> normal viewport unhandled R input",
  "scope":"Same-city startup readiness and first post-ready frame signal; no screenshot, player-GPU FPS, or Windows visual acceptance"}
 if not report_path.is_empty():
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(report_path.get_base_dir()))
  var file := FileAccess.open(report_path, FileAccess.WRITE)
  if file == null:
   printerr("Cannot write startup report: ", report_path)
   quit(1)
   return
  file.store_string(JSON.stringify(report, "\t") + "\n")
 print("NATIVE_STARTUP_RESULT ", JSON.stringify(report))
 quit(0 if failures.is_empty() else 1)
