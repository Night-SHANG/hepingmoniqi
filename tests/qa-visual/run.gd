extends SceneTree
## End-to-end native scene QA. Only InputEvents may change gameplay state.
## --headless -- --preflight checks input/lifecycle, never graphical success.

const MAIN_SCENE := "res://scenes/native_slice.tscn"
const WALL_TIMEOUT_MS := 150000
const READY_TIMEOUT_MS := 45000
const FRAME_TIMEOUT_MS := 10000
const MAX_JPEG_BYTES := 81920
const JPEG_CHUNK_CHARS := 4096

var view: Node3D
var session: Node3D
var checks: Array[Dictionary] = []
var failures: Array[String] = []
var captures: Array[Dictionary] = []
var snapshots: Array[Dictionary] = []
var preflight := false
var finished := false
var started_ms := 0
var frame_drawn := false
var baseline_image: Image
var report_path := ""

func _initialize() -> void:
 started_ms = Time.get_ticks_msec()
 for argument in OS.get_cmdline_user_args():
  if argument == "--preflight": preflight = true
  elif argument.begins_with("--report="): report_path = argument.trim_prefix("--report=")
 root.size = Vector2i(1280, 800)
 Input.use_accumulated_input = false
 call_deferred("_run")

func _process(_delta: float) -> bool:
 if not finished and Time.get_ticks_msec() - started_ms > WALL_TIMEOUT_MS:
  _check("bounded_wall_time", false, {"timeout_ms": WALL_TIMEOUT_MS})
  _finish()
 return false

func _run() -> void:
 root.size = Vector2i(1280, 800)
 root.content_scale_size = Vector2i(1280, 800)
 root.content_scale_mode = Window.CONTENT_SCALE_MODE_VIEWPORT
 print("NATIVE_VISUAL_START ", JSON.stringify({"engine": Engine.get_version_info().string,
  "display_server": DisplayServer.get_name(), "preflight": preflight,
  "input_route": "Input.parse_input_event -> normal viewport GUI/unhandled input",
  "direct_gameplay_calls": false, "wall_timeout_ms": WALL_TIMEOUT_MS}))
 if not _check("graphical_display_or_explicit_preflight", DisplayServer.get_name() != "headless" or preflight):
  _finish(); return
 var packed := load(MAIN_SCENE) as PackedScene
 if not _check("actual_main_scene_loads", packed != null):
  _finish(); return
 view = packed.instantiate()
 root.add_child(view)
 current_scene = view
 if not await _wait_ready():
  _finish(); return
 session = view.get("_session")
 if not _check("same_world_actual_jolt", session.get_world_3d() == view.get_world_3d() and
  view.get_world_3d().direct_space_state.get_class() == "JoltPhysicsDirectSpaceState3D"):
  _finish(); return
 var baseline: Dictionary = session.status()
 _snapshot("city_ready")
 _check("pristine_city", baseline.blast_count == 0 and baseline.research == 0.0 and
  session.projectiles().is_empty() and session.rubble_views().is_empty())
 _check("ready_without_session_failures", baseline.failures.is_empty(), baseline.failures)
 if not await _capture("city"):
  _finish(); return

 # This real city surface is visible from the default camera. Projection only
 # chooses the pointer coordinates; the production input path owns ray picking.
 var camera := view.get_node("Camera3D") as Camera3D
 var pointer := camera.unproject_position(Vector3(-48, 3, 42.5))
 var panel := view.get_node("VerificationControls/ControlPanel") as Control
 if not _check("target_on_screen_outside_hud", root.get_visible_rect().has_point(pointer) and
  not panel.get_global_rect().has_point(pointer), {"pointer": str(pointer), "hud": str(panel.get_global_rect())}):
  _finish(); return
 await _click(pointer)
 await _frames(3)
 if not _check("mouse_world_pick_hits_real_surface", bool(view.get("_has_selection")) and
  (view.get_node("SelectionMarker") as MeshInstance3D).visible,
  {"selected": str(view.get("_selected")), "label": view.get("_selection_label").text}):
  _finish(); return
 if not await _click_button("[1]"):
  _finish(); return
 await _wait_wall(300)
 var placed: Dictionary = session.status()
 _check("gui_placement_creates_one_charge", session.projectiles().size() == 1 and
  session.projectiles()[0].kind == "charge")
 _check("placement_never_auto_detonates", placed.blast_count == 0 and placed.research == baseline.research and
  session.effects().is_empty())
 _snapshot("charge_placed_not_detonated")
 if not failures.is_empty():
  _finish(); return

 # Pause using a real HUD click, then prove both clock and charge stay fixed.
 if not await _click_button("[P]"):
  _finish(); return
 var paused_time: float = session.status().sim_time
 _check("gui_pause_pauses_tree", paused and bool(view.get("_paused")))
 await _wait_wall(300)
 _check("paused_clock_and_charge_stable", session.status().sim_time == paused_time and
  session.projectiles().size() == 1 and session.status().blast_count == 0)
 await _key(KEY_SPACE)
 _check("paused_keyboard_detonation_ignored", session.status().blast_count == 0 and session.projectiles().size() == 1)
 await _key(KEY_P)
 await _wait_wall(150)
 _check("keyboard_resume_advances_clock", not paused and not bool(view.get("_paused")) and
  session.status().sim_time > paused_time)
 _snapshot("resumed")

 await _key(KEY_SPACE)
 var blast_deadline := Time.get_ticks_msec() + 20000
 while session.status().blast_count < 1 and Time.get_ticks_msec() < blast_deadline:
  await process_frame
 if not _check("manual_key_detonates_once", session.status().blast_count == 1 and session.projectiles().is_empty()):
  _finish(); return
 _check("manual_blast_changes_real_authority", session.status().research > baseline.research and
  not session.effects().is_empty(), session.status())
 await _frames(2)
 _check("blast_visible_instances_exist", view.get("_fire_multimesh").instance_count > 0 and
  view.get("_dust_multimesh").instance_count > 0)
 _snapshot("manual_blast")
 if not await _capture("blast"):
  _finish(); return

 # Let native Jolt advance. Do not replace transforms, damage, or authority state.
 var after_blast_time: float = session.status().sim_time
 var rubble_deadline := Time.get_ticks_msec() + 25000
 while session.status().sim_time < after_blast_time + 1.25 and Time.get_ticks_msec() < rubble_deadline:
  await process_frame
 _check("simulation_advances_after_blast", session.status().sim_time >= after_blast_time + 1.25)
 var rubble: Array = session.rubble_views()
 _check("actual_rubble_readback_nonempty", not rubble.is_empty(), {"groups": rubble.size()})
 _check("rubble_render_nodes_match_authority", view.get("_rubble_nodes").size() == rubble.size())
 var finite := true
 var moved := false
 for row in rubble:
  var pose: Transform3D = row.transform
  var origin: Vector3 = row.originalCenter
  finite = finite and pose.is_finite()
  moved = moved or pose.origin.distance_to(origin) > 0.01
 _check("native_rubble_transforms_finite_and_moving", finite and moved)
 _snapshot("rubble")
 if not await _capture("rubble"):
  _finish(); return
 _check("no_runtime_session_failures", session.status().failures.is_empty(), session.status().failures)

 # Reset while paused is an interruption case: the reset button must release
 # old server resources, unpause, replace the session, and restore initial state.
 await _key(KEY_P)
 _check("pause_before_reset", paused)
 var old_session_id := session.get_instance_id()
 if not await _click_button("[R]"):
  _finish(); return
 if not await _wait_ready(old_session_id):
  _finish(); return
 session = view.get("_session")
 var reset: Dictionary = session.status()
 _check("gui_reset_replaces_session", session.get_instance_id() != old_session_id and
  not is_instance_id_valid(old_session_id))
 _check("reset_unpauses_and_clears_selection", not paused and not bool(view.get("_paused")) and
  not bool(view.get("_has_selection")))
 _check("reset_restores_pristine_authority", reset.blast_count == 0 and reset.research == 0.0 and
  session.projectiles().is_empty() and session.effects().is_empty() and session.rubble_views().is_empty())
 _check("reset_restores_collision_ownership", reset.owned_collision_rids == baseline.owned_collision_rids,
  {"initial": baseline.owned_collision_rids, "reset": reset.owned_collision_rids})
 _check("reset_has_no_failures", reset.failures.is_empty(), reset.failures)
 _snapshot("reset_ready")

 # Independent second route: a GUI launch creates a physical sphere. No manual
 # detonation input follows, so only the production contact path can explode it.
 await _click(pointer)
 await _frames(3)
 if not _check("reset_world_pick_still_works", bool(view.get("_has_selection"))):
  _finish(); return
 if not await _click_button("[2]"):
  _finish(); return
 var rounds: Array = session.projectiles()
 if not _check("gui_fire_creates_actual_round", rounds.size() == 1 and rounds[0].kind == "projectile"):
  _finish(); return
 var physical_rounds := 0
 for child in session.get_children():
  if child is RigidBody3D: physical_rounds += 1
 _check("round_uses_native_rigid_body", physical_rounds == 1)
 _check("launch_does_not_explode_immediately", session.status().blast_count == 0 and session.effects().is_empty())
 _snapshot("projectile_in_flight")
 var launch_position: Vector3 = rounds[0].position
 var saw_round_motion := false
 var projectile_deadline := Time.get_ticks_msec() + 25000
 while session.status().blast_count == 0 and Time.get_ticks_msec() < projectile_deadline:
  await process_frame
  var flying: Array = session.projectiles()
  if flying.size() == 1:
   var position: Vector3 = flying[0].position
   saw_round_motion = saw_round_motion or position.distance_to(launch_position) > 0.1
 _check("projectile_moves_before_contact", saw_round_motion)
 _check("projectile_contact_detonates_without_manual_input", session.status().blast_count == 1 and
  session.projectiles().is_empty() and session.status().research > 0.0)
 _check("projectile_contact_has_no_failures", session.status().failures.is_empty(), session.status().failures)
 _snapshot("projectile_contact")
 await _teardown_and_finish()

func _teardown_and_finish() -> void:
 # Observe ordinary scene teardown, not a direct gameplay/session command.
 var rubble_owner = session.get("rubble")
 var static_owner = session.get("statics")
 view.queue_free()
 await process_frame
 _check("scene_teardown_frees_collision_owners", rubble_owner.stats().ownedRids == 0 and
  static_owner.stats().bodies == 0 and static_owner.stats().shape_resources == 0)
 _check("scene_teardown_leaves_tree_unpaused", not paused)
 _finish()

func _wait_ready(previous_id: int = 0) -> bool:
 var deadline := Time.get_ticks_msec() + READY_TIMEOUT_MS
 while Time.get_ticks_msec() < deadline:
  await process_frame
  var candidate: Node3D = view.get("_session")
  if (is_instance_valid(candidate) and candidate.get_instance_id() != previous_id and
   bool(candidate.get("is_ready")) and not bool(view.get("_loading"))):
   await _frames(3)
   return _check("scene_ready" if previous_id == 0 else "reset_scene_ready", true)
 return _check("scene_ready" if previous_id == 0 else "reset_scene_ready", false,
  {"timeout_ms": READY_TIMEOUT_MS, "status_label": view.get("_status_label").text})

func _click(position: Vector2) -> void:
 var motion := InputEventMouseMotion.new()
 motion.position = position
 motion.global_position = position
 Input.parse_input_event(motion)
 for down in [true, false]:
  var event := InputEventMouseButton.new()
  event.position = position
  event.global_position = position
  event.button_index = MOUSE_BUTTON_LEFT
  event.button_mask = MOUSE_BUTTON_MASK_LEFT if down else 0
  event.pressed = down
  Input.parse_input_event(event)
  await process_frame

func _click_button(suffix: String) -> bool:
 var buttons := view.find_children("*", "Button", true, false)
 for node in buttons:
  var button := node as Button
  if button.text.ends_with(suffix):
   if not _check("button_enabled_" + suffix, button.is_visible_in_tree() and not button.disabled): return false
   print("NATIVE_VISUAL_INPUT ", JSON.stringify({"type": "gui_click", "button": button.text,
    "position": str(button.get_global_rect().get_center())}))
   await _click(button.get_global_rect().get_center())
   return true
 return _check("button_present_" + suffix, false)

func _key(code: Key) -> void:
 print("NATIVE_VISUAL_INPUT ", JSON.stringify({"type": "key", "keycode": code}))
 for down in [true, false]:
  var event := InputEventKey.new()
  event.keycode = code
  event.physical_keycode = code
  event.pressed = down
  event.echo = false
  Input.parse_input_event(event)
  await process_frame

func _frames(count: int) -> void:
 for index in count: await process_frame

func _wait_wall(milliseconds: int) -> void:
 var deadline := Time.get_ticks_msec() + milliseconds
 while Time.get_ticks_msec() < deadline: await process_frame

func _on_frame_post_draw() -> void:
 frame_drawn = true

func _capture(label: String) -> bool:
 if preflight:
  print("NATIVE_VISUAL_CAPTURE_SKIPPED ", label, " headless_preflight_not_graphical_evidence")
  return true
 frame_drawn = false
 RenderingServer.frame_post_draw.connect(_on_frame_post_draw, CONNECT_ONE_SHOT)
 var deadline := Time.get_ticks_msec() + FRAME_TIMEOUT_MS
 while not frame_drawn and Time.get_ticks_msec() < deadline: await process_frame
 if not _check("frame_post_draw_" + label, frame_drawn): return false
 var image := root.get_texture().get_image()
 if not _check("frame_readback_" + label, image != null and not image.is_empty()): return false
 image.convert(Image.FORMAT_RGB8)
 # Reject blank/flat frame readbacks on the world side, excluding the HUD.
 var stats := _image_stats(image)
 if not _check("nonblank_world_pixels_" + label, stats.unique_colors > 24 and stats.luminance_range > 0.15, stats): return false
 if baseline_image == null:
  baseline_image = image.duplicate()
 else:
  var changed := _changed_world_pixels(baseline_image, image)
  if not _check("world_pixels_changed_" + label, changed > 10, {"changed_samples": changed}): return false
 image.resize(960, 600, Image.INTERPOLATE_LANCZOS)
 var jpeg := image.save_jpg_to_buffer(0.65)
 if jpeg.size() > MAX_JPEG_BYTES:
  image.resize(768, 480, Image.INTERPOLATE_LANCZOS)
  jpeg = image.save_jpg_to_buffer(0.50)
 if not _check("bounded_jpeg_" + label, jpeg.size() > 1000 and jpeg.size() <= MAX_JPEG_BYTES, {"bytes": jpeg.size()}): return false
 var digest := HashingContext.new()
 digest.start(HashingContext.HASH_SHA256)
 digest.update(jpeg)
 var record := {"name": label, "width": image.get_width(), "height": image.get_height(),
  "jpeg_bytes": jpeg.size(), "sha256": digest.finish().hex_encode(), "frame_post_draw": true,
  "engine_frame": Engine.get_frames_drawn(), "sim_time": session.status().sim_time, "image_stats": stats}
 captures.append(record)
 print("NATIVE_VISUAL_CAPTURE ", JSON.stringify(record))
 var encoded := Marshalls.raw_to_base64(jpeg)
 var chunks := ceili(float(encoded.length()) / JPEG_CHUNK_CHARS)
 for index in chunks:
  print("NATIVE_VISUAL_JPEG ", label, " ", index, "/", chunks, " ", encoded.substr(index * JPEG_CHUNK_CHARS, JPEG_CHUNK_CHARS))
 print("NATIVE_VISUAL_CAPTURE_END ", label)
 return true

func _image_stats(image: Image) -> Dictionary:
 var colors := {}
 var low := 1.0
 var high := 0.0
 for y in range(int(image.get_height() * 0.25), int(image.get_height() * 0.90), 8):
  for x in range(int(image.get_width() * 0.34), int(image.get_width() * 0.95), 8):
   var color := image.get_pixel(x, y)
   colors[color.to_rgba32()] = true
   var light := color.get_luminance()
   low = minf(low, light)
   high = maxf(high, light)
 return {"unique_colors": colors.size(), "luminance_range": high - low}

func _changed_world_pixels(before: Image, after: Image) -> int:
 var count := 0
 if before.get_size() != after.get_size(): return 0
 for y in range(int(after.get_height() * 0.25), int(after.get_height() * 0.90), 4):
  for x in range(int(after.get_width() * 0.34), int(after.get_width() * 0.95), 4):
   var a := before.get_pixel(x, y)
   var b := after.get_pixel(x, y)
   if absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b) > 0.08: count += 1
 return count

func _snapshot(label: String) -> void:
 var row: Dictionary = session.status().duplicate(true)
 row.phase = label
 row.charges_or_projectiles = session.projectiles().size()
 row.effect_count = session.effects().size()
 row.rubble_views = session.rubble_views().size()
 row.paused = paused
 row.wall_elapsed_ms = Time.get_ticks_msec() - started_ms
 snapshots.append(row)
 print("NATIVE_VISUAL_STATE ", JSON.stringify(row))

func _check(label: String, passed: bool, detail: Variant = null) -> bool:
 checks.append({"name": label, "pass": passed, "detail": detail})
 print("NATIVE_VISUAL_CHECK ", JSON.stringify(checks.back()))
 if not passed: failures.append(label)
 return passed

func _finish() -> void:
 if finished: return
 finished = true
 var graphical_pass := not preflight and failures.is_empty() and captures.size() == 3
 var report := {"schema": "native-visual-input-qa/v1", "pass": failures.is_empty(),
  "mode": "headless_preflight" if preflight else "graphical", "gpu_frame_verified": graphical_pass,
  "engine": Engine.get_version_info().string, "display_server": DisplayServer.get_name(),
  "wall_elapsed_ms": Time.get_ticks_msec() - started_ms, "failures": failures, "checks": checks,
  "captures": captures, "snapshots": snapshots, "direct_gameplay_calls": false}
 if not report_path.is_empty():
  var file := FileAccess.open(report_path, FileAccess.WRITE)
  if file != null:
   file.store_string(JSON.stringify(report, "\t") + "\n")
   file.close()
  else:
   report.pass = false
   report.gpu_frame_verified = false
   report.failures.append("report_write_failed")
 print("NATIVE_VISUAL_RESULT ", JSON.stringify(report))
 # Normal scene exit owns resource cleanup; no session mutation or fake teardown.
 quit(0 if report.pass else 1)
