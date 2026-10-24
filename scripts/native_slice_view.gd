extends Node3D
## Verification-only native view. All destruction and physics belong to the session.
## No PhysicsBody3D, CollisionShape3D, secondary space, or per-cell scene nodes.

@export var auto_start := true
const SESSION_PATH := "res://scripts/native_city_session.gd"
const DEFAULT_CAMERA := Vector3(200, 160, 220)
const CAMERA_TARGET := Vector3(0, 4, 0)
const MAX_EFFECT_INSTANCES := 96
const FLIGHT_TIME := 1.5
const GRAVITY := 9.8
const FX_LIFETIME := 5.5

var _session: Node3D
var _camera: Camera3D
var _radius := (DEFAULT_CAMERA - CAMERA_TARGET).length()
var _yaw := atan2(DEFAULT_CAMERA.x, DEFAULT_CAMERA.z)
var _pitch := asin((DEFAULT_CAMERA.y - CAMERA_TARGET.y) / _radius)
var _orbiting := false
var _pending_pick := Vector2.ZERO
var _has_pending_pick := false
var _selected := Vector3.ZERO
var _selected_normal := Vector3.UP
var _has_selection := false
var _paused := false
var _loading := false
var _generation := 0
var _hud_elapsed := 0.0
var _status_label: Label
var _selection_label: Label
var _message_label: Label
var _pause_button: Button
var _reset_button: Button
var _action_buttons: Array[Button] = []
var _selection_marker: MeshInstance3D
var _rubble_root: Node3D
var _rubble_nodes: Dictionary = {}
var _rubble_cache: Dictionary = {}
var _region_colors: Dictionary = {}
var _box_mesh: BoxMesh
var _charge_multimesh: MultiMesh
var _round_multimesh: MultiMesh
var _fire_multimesh: MultiMesh
var _dust_multimesh: MultiMesh

func _ready() -> void:
 process_mode = Node.PROCESS_MODE_ALWAYS
 _build_environment()
 _load_region_colors()
 _build_render_views()
 _build_hud()
 if auto_start:
  call_deferred("_start_session")

func _exit_tree() -> void:
 _generation += 1
 # Children receive _exit_tree before this parent; their own cleanup owns RIDs.
 # Never call a removed session method that expects get_tree() to be non-null.
 if is_instance_valid(_session) and _session.is_inside_tree():
  _session.release()
 if is_inside_tree():
  get_tree().paused = false

func _build_environment() -> void:
 _camera = Camera3D.new()
 _camera.name = "Camera3D"
 _camera.fov = 48.0
 _camera.near = 0.2
 _camera.far = 1500.0
 add_child(_camera)
 _camera.current = true
 _update_camera()
 var sky_material := ProceduralSkyMaterial.new()
 sky_material.sky_top_color = Color("639bc6")
 sky_material.sky_horizon_color = Color("e8e0cc")
 sky_material.ground_bottom_color = Color("65615a")
 sky_material.ground_horizon_color = Color("d9c8a9")
 var sky := Sky.new()
 sky.sky_material = sky_material
 var environment := Environment.new()
 environment.background_mode = Environment.BG_SKY
 environment.sky = sky
 environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
 environment.ambient_light_color = Color("bcc7cd")
 environment.ambient_light_energy = 0.55
 environment.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
 environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
 var world_environment := WorldEnvironment.new()
 world_environment.name = "WorldEnvironment"
 world_environment.environment = environment
 add_child(world_environment)
 var sun := DirectionalLight3D.new()
 sun.name = "Sun"
 sun.rotation_degrees = Vector3(-48, -32, 0)
 sun.light_color = Color("ffe5b1")
 sun.light_energy = 1.25
 sun.shadow_enabled = true
 sun.directional_shadow_max_distance = 550.0
 add_child(sun)

func _material(color: Color, vertex_colors := false, transparent := false) -> StandardMaterial3D:
 var material := StandardMaterial3D.new()
 material.albedo_color = color
 material.vertex_color_use_as_albedo = vertex_colors
 material.roughness = 0.9
 if transparent:
  material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
 return material

func _build_render_views() -> void:
 _rubble_root = Node3D.new()
 _rubble_root.name = "RubbleViews"
 add_child(_rubble_root)
 _box_mesh = BoxMesh.new()
 _box_mesh.size = Vector3.ONE
 _box_mesh.material = _material(Color.WHITE, true)
 var round_mesh := SphereMesh.new()
 round_mesh.radius = 0.45
 round_mesh.height = 0.9
 round_mesh.radial_segments = 12
 round_mesh.rings = 6
 round_mesh.material = _material(Color("39474f"), true)
 var charge_mesh := BoxMesh.new()
 charge_mesh.size = Vector3(1.2, 0.7, 1.2)
 charge_mesh.material = _material(Color("eea82c"), true)
 _charge_multimesh = _new_multimesh("Charges", charge_mesh)
 _round_multimesh = _new_multimesh("PhysicalRounds", round_mesh)
 var fire_mesh := SphereMesh.new()
 fire_mesh.radius = 1.0
 fire_mesh.height = 2.0
 fire_mesh.radial_segments = 8
 fire_mesh.rings = 4
 var fire_material := _material(Color.WHITE, true, true)
 fire_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
 fire_mesh.material = fire_material
 _fire_multimesh = _new_multimesh("BlastFireVisuals", fire_mesh)
 var dust_mesh := SphereMesh.new()
 dust_mesh.radius = 1.0
 dust_mesh.height = 2.0
 dust_mesh.radial_segments = 8
 dust_mesh.rings = 4
 dust_mesh.material = _material(Color.WHITE, true, true)
 _dust_multimesh = _new_multimesh("BlastDustVisuals", dust_mesh)
 _selection_marker = MeshInstance3D.new()
 _selection_marker.name = "SelectionMarker"
 var marker_mesh := TorusMesh.new()
 marker_mesh.inner_radius = 1.3
 marker_mesh.outer_radius = 1.65
 marker_mesh.rings = 16
 marker_mesh.ring_segments = 8
 var marker_material := _material(Color("ffe6a0"))
 marker_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
 marker_mesh.material = marker_material
 _selection_marker.mesh = marker_mesh
 _selection_marker.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
 _selection_marker.visible = false
 add_child(_selection_marker)

func _new_multimesh(label: String, mesh: Mesh) -> MultiMesh:
 var multimesh := MultiMesh.new()
 multimesh.transform_format = MultiMesh.TRANSFORM_3D
 multimesh.use_colors = true
 multimesh.mesh = mesh
 var instance := MultiMeshInstance3D.new()
 instance.name = label
 instance.multimesh = multimesh
 if label.begins_with("Blast"):
  instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
 add_child(instance)
 return multimesh

func _build_hud() -> void:
 var canvas := CanvasLayer.new()
 canvas.name = "VerificationControls"
 add_child(canvas)
 var panel := PanelContainer.new()
 panel.name = "ControlPanel"
 panel.position = Vector2(18, 18)
 panel.custom_minimum_size = Vector2(340, 0)
 var theme := Theme.new()
 # ResourceLoader follows import remaps in exported PCKs; raw OTF loading does not.
 var font := ResourceLoader.load("res://assets/fonts/native-slice-sans.otf") as FontFile
 assert(font != null, "Bundled verification font failed to load")
 theme.default_font = font
 theme.default_font_size = 16
 panel.theme = theme
 var style := StyleBoxFlat.new()
 style.bg_color = Color(0.09, 0.12, 0.14, 0.92)
 style.corner_radius_top_left = 9
 style.corner_radius_top_right = 9
 style.corner_radius_bottom_left = 9
 style.corner_radius_bottom_right = 9
 style.content_margin_left = 16
 style.content_margin_right = 16
 style.content_margin_top = 13
 style.content_margin_bottom = 13
 panel.add_theme_stylebox_override("panel", style)
 canvas.add_child(panel)
 var column := VBoxContainer.new()
 column.add_theme_constant_override("separation", 8)
 panel.add_child(column)
 var title := Label.new()
 title.text = "原生验证片"
 title.add_theme_font_size_override("font_size", 24)
 title.add_theme_color_override("font_color", Color("ffe0a1"))
 column.add_child(title)
 var subtitle := Label.new()
 subtitle.text = "同城体素 · Jolt 碎块 · 非正式游戏界面"
 subtitle.add_theme_font_size_override("font_size", 13)
 column.add_child(subtitle)
 var instructions := Label.new()
 instructions.text = "右键 / 中键拖动：环绕    滚轮：缩放\n左键：选择真实碰撞表面\n1 放置炸药    2 发射    空格 引爆\nP 暂停    R 重置    Home 复位视角"
 instructions.add_theme_font_size_override("font_size", 14)
 column.add_child(instructions)
 _selection_label = Label.new()
 _selection_label.text = "尚未选点，点击城市表面"
 _selection_label.add_theme_font_size_override("font_size", 14)
 column.add_child(_selection_label)
 var actions := HFlowContainer.new()
 actions.add_theme_constant_override("h_separation", 6)
 actions.add_theme_constant_override("v_separation", 6)
 actions.custom_minimum_size.x = 330
 column.add_child(actions)
 _add_button(actions, "放置炸药 [1]", _place_charge)
 _add_button(actions, "发射 [2]", _fire_projectile)
 _add_button(actions, "手动引爆 [空格]", _detonate)
 _pause_button = _add_button(actions, "暂停 [P]", _toggle_pause)
 _reset_button = Button.new()
 _reset_button.focus_mode = Control.FOCUS_NONE
 _reset_button.text = "重置 [R]"
 _reset_button.pressed.connect(_reset_session)
 actions.add_child(_reset_button)
 _status_label = Label.new()
 _status_label.text = "正在准备原生城市…" if auto_start else "验证视图（未启动城市）"
 _status_label.add_theme_font_size_override("font_size", 14)
 column.add_child(_status_label)
 _message_label = Label.new()
 _message_label.custom_minimum_size.x = 330
 _message_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
 _message_label.add_theme_font_size_override("font_size", 13)
 _message_label.add_theme_color_override("font_color", Color("edcf92"))
 _message_label.text = "验证用途：性能与视觉质量需在实际图形设备上确认。"
 column.add_child(_message_label)
 _set_buttons_enabled(false)

func _add_button(container: Control, label: String, action: Callable) -> Button:
 var button := Button.new()
 button.focus_mode = Control.FOCUS_NONE
 button.text = label
 button.pressed.connect(action)
 container.add_child(button)
 _action_buttons.append(button)
 return button

func _set_buttons_enabled(enabled: bool) -> void:
 for button in _action_buttons:
  button.disabled = not enabled
 if is_instance_valid(_reset_button):
  _reset_button.disabled = _loading

func _start_session() -> void:
 if _loading or not is_inside_tree():
  return
 _loading = true
 _generation += 1
 var generation := _generation
 _set_buttons_enabled(false)
 if not ResourceLoader.exists(SESSION_PATH):
  _loading = false
  _status_label.text = "城市运行层尚未就绪"
  _message_label.text = "找不到原生城市运行脚本，未启动替代或模拟场景。"
  _set_buttons_enabled(false)
  return
 var session_script: Script = load(SESSION_PATH)
 _session = session_script.new()
 _session.name = "NativeCitySession"
 _session.process_mode = Node.PROCESS_MODE_PAUSABLE
 # Session is a child in this same World3D before its asynchronous startup.
 add_child(_session)
 _status_label.text = "正在加载同一座城市与原生碰撞…"
 await _session.start()
 if generation != _generation or not is_inside_tree():
  return
 _loading = false
 _set_buttons_enabled(_session.is_ready)
 if _session.is_ready:
  _message_label.text = "城市已就绪。先点选表面；放置炸药不会自动引爆。"
 else:
  _message_label.text = "城市未就绪，请查看状态中的实际错误。"
 _refresh_status()

func _reset_session() -> void:
 if _loading:
  return
 _generation += 1
 if is_instance_valid(_session):
  _session.release()
  _session.queue_free()
 _session = null
 _paused = false
 _pause_button.text = "暂停 [P]"
 _has_selection = false
 _has_pending_pick = false
 _selection_marker.visible = false
 _selection_label.text = "尚未选点，点击城市表面"
 _sync_rubble([])
 _sync_projectiles([])
 _sync_effects([])
 # Free the previous session and server resources before another city is created.
 await get_tree().process_frame
 await _start_session()

func _process(delta: float) -> void:
 if not is_instance_valid(_session) or not _session.is_ready:
  return
 _sync_rubble(_session.rubble_views())
 _sync_projectiles(_session.projectiles())
 _sync_effects(_session.effects())
 _hud_elapsed += delta
 if _hud_elapsed >= 0.2:
  _hud_elapsed = 0.0
  _refresh_status()

func _physics_process(_delta: float) -> void:
 if _has_pending_pick:
  _has_pending_pick = false
  _select_surface(_pending_pick)

func _unhandled_input(event: InputEvent) -> void:
 if event is InputEventMouseButton:
  if event.button_index == MOUSE_BUTTON_RIGHT or event.button_index == MOUSE_BUTTON_MIDDLE:
   _orbiting = event.pressed
   get_viewport().set_input_as_handled()
  elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_UP:
   _radius = maxf(25.0, _radius * 0.88)
   _update_camera()
  elif event.pressed and event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
   _radius = minf(700.0, _radius / 0.88)
   _update_camera()
  elif event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
   _pending_pick = event.position
   _has_pending_pick = true
 elif event is InputEventMouseMotion and _orbiting:
  _yaw -= event.relative.x * 0.006
  _pitch = clampf(_pitch + event.relative.y * 0.004, 0.08, 1.45)
  _update_camera()
 elif event is InputEventKey and event.pressed and not event.echo:
  match event.keycode:
   KEY_1: _place_charge()
   KEY_2: _fire_projectile()
   KEY_SPACE: _detonate()
   KEY_P: _toggle_pause()
   KEY_R: _reset_session()
   KEY_HOME:
    _radius = (DEFAULT_CAMERA - CAMERA_TARGET).length()
    _yaw = atan2(DEFAULT_CAMERA.x, DEFAULT_CAMERA.z)
    _pitch = asin((DEFAULT_CAMERA.y - CAMERA_TARGET.y) / _radius)
    _update_camera()

func _input(event: InputEvent) -> void:
 # A release over the HUD must end an orbit started outside the HUD.
 if event is InputEventMouseButton and not event.pressed:
  if event.button_index == MOUSE_BUTTON_RIGHT or event.button_index == MOUSE_BUTTON_MIDDLE:
   _orbiting = false
 if event is InputEventMouseMotion and not Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) and not Input.is_mouse_button_pressed(MOUSE_BUTTON_MIDDLE):
  _orbiting = false

func _notification(what: int) -> void:
 if what == NOTIFICATION_WM_WINDOW_FOCUS_OUT:
  _orbiting = false

func _update_camera() -> void:
 _camera.position = CAMERA_TARGET + Vector3(sin(_yaw) * cos(_pitch), sin(_pitch), cos(_yaw) * cos(_pitch)) * _radius
 _camera.look_at(CAMERA_TARGET, Vector3.UP)

func _can_act() -> bool:
 return is_instance_valid(_session) and _session.is_ready and not _loading

func _select_surface(screen_position: Vector2) -> void:
 if not _can_act():
  return
 var origin := _camera.project_ray_origin(screen_position)
 var direction := _camera.project_ray_normal(screen_position)
 var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 1500.0)
 query.collision_mask = 1
 query.collide_with_areas = false
 var hit := get_world_3d().direct_space_state.intersect_ray(query)
 if hit.is_empty():
  _has_selection = false
  _selection_marker.visible = false
  _selection_label.text = "未命中实体表面，请重新选点"
  return
 _selected = hit.position
 _selected_normal = hit.normal
 _has_selection = true
 _selection_marker.position = _selected + _selected_normal * 0.12
 var normal := _selected_normal.normalized()
 var tangent := normal.cross(Vector3.RIGHT if absf(normal.dot(Vector3.UP)) > 0.98 else Vector3.UP).normalized()
 _selection_marker.basis = Basis(tangent, normal, tangent.cross(normal)).orthonormalized()
 _selection_marker.visible = true
 _selection_label.text = "选点：%.1f, %.1f, %.1f" % [_selected.x, _selected.y, _selected.z]

func _place_charge() -> void:
 if not _can_act() or not _has_selection:
  _message_label.text = "请先在真实碰撞表面选点。"
  return
 if _paused:
  _message_label.text = "当前暂停，继续后再放置。"
  return
 if _session.place_charge(_selected + _selected_normal * 0.4):
  _message_label.text = "已放置炸药；按空格或“手动引爆”触发。"
 else:
  _message_label.text = "运行层未接纳放置，请检查数量限制或状态。"

func _fire_projectile() -> void:
 if not _can_act() or not _has_selection:
  _message_label.text = "请先选择弹体的目标表面。"
  return
 if _paused:
  _message_label.text = "当前暂停，继续后再发射。"
  return
 # Real sphere starts in front of the camera. This ballistic aim uses session gravity;
 # obstructions may intercept it before the selected target, as physical collision should.
 var origin := _camera.global_position - _camera.global_basis.z * 3.0
 var velocity := (_selected - origin) / FLIGHT_TIME + Vector3.UP * (0.5 * GRAVITY * FLIGHT_TIME)
 if _session.launch_projectile(origin, velocity):
  _message_label.text = "已发射物理弹体，命中实体后触发爆破。"
 else:
  _message_label.text = "运行层未接纳发射，请检查弹体限制或状态。"

func _detonate() -> void:
 if not _can_act() or _paused:
  return
 _session.detonate_all()
 _message_label.text = "已请求引爆所有放置的炸药。"

func _toggle_pause() -> void:
 if not _can_act():
  return
 _paused = not _paused
 _session.set_paused(_paused)
 _pause_button.text = "继续 [P]" if _paused else "暂停 [P]"
 _message_label.text = "物理与爆破时钟已暂停；仍可移动视角。" if _paused else "已继续原生模拟。"
 _refresh_status()

func _refresh_status() -> void:
 if not is_instance_valid(_session):
  return
 var status: Dictionary = _session.status()
 _status_label.text = "模拟 %.1f s%s · 爆破 %d 次\n活动碎块 %d · 等待 %d · 科研 %.1f\n最近爆破处理 %.1f ms（验证计时）" % [
  float(status.get("sim_time", 0.0)), "（暂停）" if _paused else "", int(status.get("blast_count", 0)),
  int(status.get("active_groups", 0)), int(status.get("pending_groups", 0)), float(status.get("research", 0.0)), float(status.get("last_blast_ms", 0.0))]
 var failures: Array = status.get("failures", [])
 if not failures.is_empty():
  _message_label.text = "运行层报告：" + str(failures.back())

func _load_region_colors() -> void:
 var metadata: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/native-tables.json"))
 if not metadata is Dictionary:
  return
 var regions := FileAccess.get_file_as_bytes("res://data/regions.bin").to_float64_array()
 var ids: Array = metadata.get("ids", [])
 for index in regions.size() / 24:
  var token := int(regions[index * 24 + 22])
  if token >= 0 and token < ids.size():
   var rgb := int(regions[index * 24 + 12])
   _region_colors[str(ids[token])] = Color8((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)

func _sync_rubble(views: Array) -> void:
 var live := {}
 for row in views:
  var id := str(row.get("id", ""))
  if id.is_empty():
   continue
  live[id] = true
  var boxes: PackedFloat32Array = row.get("packedBoxes", PackedFloat32Array())
  var labels: Array = row.get("boxRegionIds", [])
  var original_center: Vector3 = row.get("originalCenter", Vector3.ZERO)
  var node: MultiMeshInstance3D
  if not _rubble_nodes.has(id):
   node = MultiMeshInstance3D.new()
   node.name = "Rubble_%d" % _rubble_nodes.size()
   var multimesh := MultiMesh.new()
   multimesh.transform_format = MultiMesh.TRANSFORM_3D
   multimesh.use_colors = true
   multimesh.mesh = _box_mesh
   node.multimesh = multimesh
   _rubble_root.add_child(node)
   _rubble_nodes[id] = node
  else:
   node = _rubble_nodes[id]
  node.transform = row.get("transform", Transform3D.IDENTITY)
  var cached: Dictionary = _rubble_cache.get(id, {})
  if not cached.is_empty() and cached.boxes == boxes and cached.labels == labels and cached.center == original_center:
   continue
  var count: int = boxes.size() / 6
  node.multimesh.instance_count = count
  for index in count:
   var offset := index * 6
   node.multimesh.set_instance_transform(index, _box_transform(boxes, offset, original_center))
   var color: Color = _region_colors.get(str(labels[index]), Color("a59886")) if index < labels.size() else Color("a59886")
   node.multimesh.set_instance_color(index, color)
  _rubble_cache[id] = {"boxes": boxes.duplicate(), "labels": labels.duplicate(), "center": original_center}
 for id in _rubble_nodes.keys():
  if not live.has(id):
   _rubble_nodes[id].queue_free()
   _rubble_nodes.erase(id)
   _rubble_cache.erase(id)

func _box_transform(boxes: PackedFloat32Array, offset: int, original_center: Vector3) -> Transform3D:
 var center := Vector3(boxes[offset], boxes[offset + 1], boxes[offset + 2]) - original_center
 var size := Vector3(boxes[offset + 3], boxes[offset + 4], boxes[offset + 5]) * 2.0
 return Transform3D(Basis.IDENTITY.scaled(size), center)

func _position_transform(position: Vector3) -> Transform3D:
 return Transform3D(Basis.IDENTITY, position)

func _sync_projectiles(views: Array) -> void:
 var charges: Array[Vector3] = []
 var rounds: Array[Vector3] = []
 for row in views:
  if str(row.get("kind", "")) == "charge":
   charges.append(row.position)
  else:
   rounds.append(row.position)
 _charge_multimesh.instance_count = charges.size()
 _round_multimesh.instance_count = rounds.size()
 for index in charges.size():
  _charge_multimesh.set_instance_transform(index, _position_transform(charges[index]))
  _charge_multimesh.set_instance_color(index, Color.WHITE)
 for index in rounds.size():
  _round_multimesh.set_instance_transform(index, _position_transform(rounds[index]))
  _round_multimesh.set_instance_color(index, Color.WHITE)

func _sync_effects(views: Array) -> void:
 # Pure read-only cosmetics: no damages, collision RIDs, timers, or lifetime removal.
 var fires: Array[Transform3D] = []
 var fire_colors: Array[Color] = []
 var dust: Array[Transform3D] = []
 var dust_colors: Array[Color] = []
 for row in views:
  var age := float(row.get("age", 0.0))
  if age < 0.0 or age > FX_LIFETIME:
   continue
  var origin: Vector3 = row.get("position", Vector3.ZERO)
  for lobe in 6:
   var angle := float(lobe) * TAU / 6.0
   var direction := Vector3(cos(angle), 0.0, sin(angle))
   if age < 0.8 and fires.size() < MAX_EFFECT_INSTANCES:
    var size := (1.0 + age * 6.0) * (1.0 - age / 0.9)
    var position := origin + direction * age * 3.0 + Vector3.UP * (1.0 + age * 4.0)
    fires.append(Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * size), position))
    fire_colors.append(Color(1.0, 0.42 + 0.4 * (1.0 - age), 0.08, 0.85 * (1.0 - age / 0.8)))
   if dust.size() < MAX_EFFECT_INSTANCES:
    var size := 1.6 + age * 1.2
    var position := origin + direction * (1.0 + age * 2.6) + Vector3.UP * (0.7 + age * 1.6)
    dust.append(Transform3D(Basis.IDENTITY.scaled(Vector3(size, size * 0.8, size)), position))
    dust_colors.append(Color(0.47, 0.43, 0.36, 0.3 * (1.0 - age / FX_LIFETIME)))
  if fires.size() >= MAX_EFFECT_INSTANCES and dust.size() >= MAX_EFFECT_INSTANCES:
   break
 _fire_multimesh.instance_count = fires.size()
 _dust_multimesh.instance_count = dust.size()
 for index in fires.size():
  _fire_multimesh.set_instance_transform(index, fires[index])
  _fire_multimesh.set_instance_color(index, fire_colors[index])
 for index in dust.size():
  _dust_multimesh.set_instance_transform(index, dust[index])
  _dust_multimesh.set_instance_color(index, dust_colors[index])
