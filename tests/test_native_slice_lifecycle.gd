extends SceneTree
var failures: Array[String] = []
var checks := 0
var view
func check(value: bool, label: String) -> void:
 checks += 1
 if not value:
  failures.append(label)
  push_error(label)
func _initialize() -> void:
 call_deferred("run")
func run() -> void:
 var scene: PackedScene = load("res://scenes/native_slice.tscn")
 view = scene.instantiate()
 view.auto_start = false
 root.add_child(view)
 await process_frame
 await view._start_session()
 check(view._session.is_ready,"actual same-city session started")
 check(view._session.get_world_3d().space==view.get_world_3d().space,"view and session share single World3D")
 check(view.get_world_3d().direct_space_state.get_class()=="JoltPhysicsDirectSpaceState3D","native selection uses actual Jolt world")
 check(view._session.process_mode==Node.PROCESS_MODE_PAUSABLE and view.process_mode==Node.PROCESS_MODE_ALWAYS,"pause separates view controls from simulation")
 check(view._session.terrain.mesher.opaque_material.vertex_color_use_as_albedo,"voxel renderer material uses real city vertex colors")
 await physics_frame
 var screen_point: Vector2 = view._camera.unproject_position(Vector3(-48,3,42.5))
 view._select_surface(screen_point)
 check(view._has_selection,"camera ray selects actual native collider")
 view._place_charge()
 check(view._session.projectiles().size()==1 and view._session.projectiles()[0].kind=="charge","placement control reaches authoritative charge store")
 var before_time: float = view._session.status().sim_time
 var before_camera: Transform3D = view._camera.transform
 view._toggle_pause()
 check(paused and view._pause_button.text=="继续 [P]","pause control pauses tree and exposes resume")
 for i in 8: await process_frame
 check(view._session.status().sim_time==before_time,"physics clock does not advance while paused")
 view._yaw+=0.1;view._update_camera()
 check(not view._camera.transform.is_equal_approx(before_camera),"orbit camera remains operable while paused")
 view._toggle_pause()
 check(not paused,"same control resumes tree")
 for i in 4: await physics_frame
 check(view._session.status().sim_time>before_time,"simulation resumes")
 check(view._session.status().blast_count==0,"placed charge has no silent fuse")
 view._fire_projectile()
 check(view._session.projectiles().size()==2,"fire control launches actual physical round")
 var old_session = view._session
 var old_rubble = old_session.rubble
 view._toggle_pause()
 view._reset_session()
 view._reset_session()
 var start := Time.get_ticks_msec()
 while view._session==null or not view._session.is_ready:
  await process_frame
  if Time.get_ticks_msec()-start>35000:
   check(false,"reset completes before startup deadline")
   break
 check(not paused and not view._paused,"reset from paused state unpauses and clears view state")
 check(old_rubble.stats().ownedRids==0,"reset releases prior session collision ownership")
 check(view._session.projectiles().is_empty() and view._session.status().blast_count==0,"reset removes charges and rounds and starts clean city")
 var session_count := 0
 for child in view.get_children():
  if child.get_script() != null and child.get_script().resource_path.ends_with("native_city_session.gd"):
   session_count+=1
 check(session_count==1,"repeated reset creates only one session")
 check(view._rubble_nodes.is_empty() and not view._selection_marker.visible,"reset clears read-only render state and selection")
 var current_rubble = view._session.rubble
 view.queue_free()
 await process_frame
 check(current_rubble.stats().ownedRids==0,"scene teardown releases collision resources")
 print("NATIVE_SLICE_LIFECYCLE_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"headless_only":true,"gpu_frame_verified":false}))
 quit(0 if failures.is_empty() else 1)
