extends SceneTree

const StaticOwner := preload("res://scripts/native_static_world.gd")
var world: Node3D
var owner
var sphere_shape: RID
var bodies := {}
var contacts := {"hole": [], "neighbor": []}
var samples: Array[Dictionary] = []
var failures: Array[String] = []
var checks: Array[Dictionary] = []
var report_path := "res://tests/qa-voxel/projectile-hole.json"
var keep_hole_cell := false
var started_frame := 0
var started_usec := 0

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
  elif arg == "--keep-hole-cell": keep_hole_cell = true
 call_deferred("_run")

func _run() -> void:
 Engine.physics_ticks_per_second = 120
 world = Node3D.new()
 root.add_child(world)
 owner = StaticOwner.new(world.get_world_3d().space)
 var guard_ring := PackedFloat32Array()
 for z in range(-1,2):
  for x in range(-1,2):
   if x == 0 and z == 0: continue
   guard_ring.append_array(PackedFloat32Array([x,0,z,.5,.5,.5]))
 owner.install({100:PackedFloat32Array([0,0,0,.5,.5,.5]),200:guard_ring})
 await physics_frame
 await process_frame
 _check("both_cells_initially_have_collision", not _ray(0).is_empty() and not _ray(1).is_empty())
 var before_tick := Engine.get_physics_frames()
 if not keep_hole_cell: owner.replace_regions({100:PackedFloat32Array()})
 var retained_ring_hits := 0
 for z in range(-1,2):
  for x in range(-1,2):
   if x == 0 and z == 0: continue
   if not _ray(x,z).is_empty(): retained_ring_hits += 1
 _check("hole_sync_before_next_tick", _ray(0).is_empty() and retained_ring_hits == 8 and before_tick == Engine.get_physics_frames(), {"retained_ring_hits":retained_ring_hits})
 sphere_shape = PhysicsServer3D.sphere_shape_create()
 PhysicsServer3D.shape_set_data(sphere_shape,0.15)
 for id in ["hole","neighbor"]:
  var x := 0.0 if id == "hole" else 1.0
  var body := PhysicsServer3D.body_create()
  PhysicsServer3D.body_set_mode(body,PhysicsServer3D.BODY_MODE_RIGID)
  PhysicsServer3D.body_add_shape(body,sphere_shape)
  PhysicsServer3D.body_set_collision_layer(body,2)
  PhysicsServer3D.body_set_collision_mask(body,1)
  PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_MASS,1.0)
  PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_BOUNCE,0.0)
  PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_FRICTION,0.5)
  PhysicsServer3D.body_set_enable_continuous_collision_detection(body,true)
  PhysicsServer3D.body_set_max_contacts_reported(body,8)
  PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM,Transform3D(Basis.IDENTITY,Vector3(x,2,0)))
  PhysicsServer3D.body_set_state_sync_callback(body,_observe_contacts.bind(id))
  PhysicsServer3D.body_set_space(body,world.get_world_3d().space)
  bodies[id] = body
 started_frame = Engine.get_physics_frames()
 started_usec = Time.get_ticks_usec()
 while Engine.get_physics_frames() - started_frame < 150 and Time.get_ticks_usec() - started_usec < 5000000:
  await physics_frame
  await process_frame
  samples.append({"physics_frame":Engine.get_physics_frames(),"hole":_state("hole"),"neighbor":_state("neighbor")})
 var hole := _state("hole")
 var neighbor := _state("neighbor")
 _check("observed_at_least_120_real_physics_ticks", Engine.get_physics_frames()-started_frame >= 120)
 _check("removed_cell_projectile_falls_below_floor", hole.position[1] < -2.0, hole)
 _check("removed_cell_projectile_has_no_contact", contacts.hole.is_empty(), contacts.hole)
 _check("retained_neighbor_projectile_supported", neighbor.position[1] > 0.60 and neighbor.position[1] < 0.70 and absf(neighbor.position[0]-1.0) < 0.05, neighbor)
 _check("retained_neighbor_actual_contact_observed", not contacts.neighbor.is_empty(), contacts.neighbor)
 var only_correct_target: bool = not contacts.neighbor.is_empty()
 for contact in contacts.neighbor:
  if contact.region != 200: only_correct_target = false
 _check("neighbor_contact_maps_to_retained_region", only_correct_target)
 _check("neighbor_does_not_tunnel_through_solid", neighbor.velocity[1] > -0.1 and neighbor.position[1] > 0.5)
 _check("single_real_jolt_space", world.get_world_3d().direct_space_state.get_class() == "JoltPhysicsDirectSpaceState3D")
 var result := {"schema":"native-jolt-projectile-hole-qa/v1","pass":failures.is_empty(),"failures":failures,"checks":checks,
  "engine":Engine.get_version_info().string,"backend":world.get_world_3d().direct_space_state.get_class(),"display_server":DisplayServer.get_name(),
  "gpu_frame_verified":false,"physics_hz":Engine.physics_ticks_per_second,"real_physics_ticks":Engine.get_physics_frames()-started_frame,
  "wall_ms":float(Time.get_ticks_usec()-started_usec)/1000.0,"sphere_radius":0.15,"initial_floor_cells":9,"retained_ring_cells":retained_ring_hits,"gravity_enabled":true,"contacts":contacts,"samples":samples,"negative_keep_hole_cell":keep_hole_cell}
 for body in bodies.values():
  PhysicsServer3D.body_set_state_sync_callback(body,Callable())
  PhysicsServer3D.free_rid(body)
 PhysicsServer3D.free_rid(sphere_shape)
 owner.dispose()
 result["remaining_owned_static_bodies"] = owner.stats().bodies
 var file := FileAccess.open(report_path,FileAccess.WRITE)
 file.store_string(JSON.stringify(result,"\t")+"\n")
 file.close()
 print("NATIVE_JOLT_PROJECTILE_HOLE_QA pass=",failures.is_empty()," checks=",checks.size()," failures=",failures," real_physics_ticks=",result.real_physics_ticks)
 world.queue_free()
 await process_frame
 quit(0 if failures.is_empty() else 1)

func _observe_contacts(state: PhysicsDirectBodyState3D,id: String) -> void:
 for i in state.get_contact_count():
  if contacts[id].size() >= 8: return
  var rid: RID = state.get_contact_collider(i)
  contacts[id].append({"physics_frame":Engine.get_physics_frames(),"region":owner.region_for_shape(rid,state.get_contact_collider_shape(i)),"source_shape":state.get_contact_local_shape(i)})

func _state(id: String) -> Dictionary:
 var pose: Transform3D = PhysicsServer3D.body_get_state(bodies[id],PhysicsServer3D.BODY_STATE_TRANSFORM)
 var velocity: Vector3 = PhysicsServer3D.body_get_state(bodies[id],PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY)
 return {"position":[pose.origin.x,pose.origin.y,pose.origin.z],"velocity":[velocity.x,velocity.y,velocity.z],"sleeping":PhysicsServer3D.body_get_state(bodies[id],PhysicsServer3D.BODY_STATE_SLEEPING)}

func _ray(x: float,z: float = 0.0) -> Dictionary:
 return world.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x,2,z),Vector3(x,-2,z),1))

func _check(label: String, condition: bool, detail: Variant = null) -> void:
 checks.append({"name":label,"pass":condition,"detail":detail})
 if not condition:
  failures.append(label)
  printerr("FAIL ",label," ",detail)
