extends SceneTree

var failures: Array[String] = []
var checks := 0
var Adapter: Script
var world: Node3D
var space: RID
var floor_body: RID
var floor_shape: RID
var report := {"schema":"native-rubble-adapter/v1", "headless_only":true, "gpu_frame_verified":false}
var report_path := "/tmp/native-rubble-result.json"

func check(ok: bool, label: String) -> void:
 checks += 1
 if not ok:
  failures.append(label)
  push_error(label)

func box_group(id: String, center: Vector3, compound: bool = false) -> Dictionary:
 var boxes := PackedFloat32Array()
 if compound:
  for x in [-0.45,0.45]: boxes.append_array(PackedFloat32Array([center.x+x,center.y,center.z,0.4,0.4,0.4]))
 else:
  boxes.append_array(PackedFloat32Array([center.x,center.y,center.z,0.55,0.5,0.55]))
 return {"id":id,"originalCenter":center,"packedBoxes":boxes,"mass":3.0,"regionIds":[id+"-region"],"rootShotId":"fixture-shot"}

func _initialize() -> void:
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="): report_path = arg.trim_prefix("--report=")
 if not ResourceLoader.exists("res://scripts/native_rubble_world.gd"):
  push_error("MISSING_BEHAVIOR: bounded same-world Jolt rubble lifecycle has not been implemented")
  quit(1)
  return
 Adapter = load("res://scripts/native_rubble_world.gd")
 var methods: Array[String] = []
 for method in Adapter.get_script_method_list(): methods.append(method.name)
 if not methods.has("refresh_group"):
  push_error("MISSING_BEHAVIOR: authority geometry cannot refresh active compound shapes")
  quit(1)
  return
 call_deferred("run")

func run() -> void:
 world = Node3D.new()
 root.add_child(world)
 space = world.get_world_3d().space
 check(PhysicsServer3D.space_get_direct_state(space).get_class()=="JoltPhysicsDirectSpaceState3D","actual Jolt backend")
 floor_shape = PhysicsServer3D.box_shape_create()
 PhysicsServer3D.shape_set_data(floor_shape,Vector3(20,0.5,20))
 floor_body = PhysicsServer3D.body_create()
 PhysicsServer3D.body_set_mode(floor_body,PhysicsServer3D.BODY_MODE_STATIC)
 PhysicsServer3D.body_add_shape(floor_body,floor_shape)
 PhysicsServer3D.body_set_state(floor_body,PhysicsServer3D.BODY_STATE_TRANSFORM,Transform3D(Basis.IDENTITY,Vector3(0,-0.5,0)))
 PhysicsServer3D.body_set_space(floor_body,space)
 await lifecycle_tests()
 await refresh_tests()
 await motion_contact_tests()
 PhysicsServer3D.free_rid(floor_body)
 PhysicsServer3D.free_rid(floor_shape)
 report.checks = checks
 report.failures = failures
 report.engine_version = Engine.get_version_info().string
 var file := FileAccess.open(report_path,FileAccess.WRITE)
 file.store_string(JSON.stringify(report,"\t")+"\n")
 file.close()
 print("NATIVE_RUBBLE_RESULT ",JSON.stringify(report))
 quit(0 if failures.is_empty() else 1)

func lifecycle_tests() -> void:
 var rubble = Adapter.new(space,{"max_bodies":1,"max_shapes_per_group":2,"max_total_shapes":2})
 var nodes_before := world.get_child_count()
 var a := box_group("group-a",Vector3(0,8,0),true)
 check(rubble.enqueue_group(a).accepted,"compound group enqueued")
 check(rubble.enqueue_group(a).duplicate,"identical enqueue is idempotent")
 var conflicting := a.duplicate(true)
 conflicting.mass = 99.0
 check(not rubble.enqueue_group(conflicting).accepted,"same stable ID cannot replace different payload")
 check(rubble.stats().pendingGroups==1 and rubble.stats().createdRids==0,"queued static group allocates no physics RIDs")
 check(rubble.flush_ready().is_empty(),"cannot activate before explicit static-removal assertion")
 for i in 3: await physics_frame
 check(rubble.stats().activeGroups==0,"elapsed ticks never implicitly release old-static guard")
 check(not rubble.confirm_static_removed("missing"),"unknown static removal assertion rejected")
 check(rubble.confirm_static_removed("group-a"),"explicit static removal acknowledged")
 check(rubble.flush_ready()==PackedStringArray(["group-a"]),"ready group activates")
 var a_body: RID = rubble.body_rid("group-a")
 check(a_body.is_valid() and PhysicsServer3D.body_get_space(a_body)==space,"dynamic body belongs to caller World3D space")
 check(PhysicsServer3D.body_get_shape_count(a_body)==2,"connected group is one compound body with two shapes")
 check(PhysicsServer3D.body_get_shape_transform(a_body,0).origin.is_equal_approx(Vector3(-0.45,0,0)),"world boxes converted to correct group-local offsets")
 check(rubble.readback()[0].id=="group-a" and rubble.readback()[0].rootShotId=="fixture-shot","readback preserves authority identity")
 check(rubble.enqueue_group(box_group("group-b",Vector3(3,8,0))).accepted,"overflow group retained")
 rubble.confirm_static_removed("group-b")
 check(rubble.flush_ready().is_empty() and rubble.stats().readyGroups==1,"saturated group stays ready, not silently discarded")
 var release: Dictionary = rubble.release_group("group-a")
 check(release.accepted and release.activated==PackedStringArray(["group-b"]),"freeing body slot immediately drains ready queue")
 check(rubble.body_rid("group-b").is_valid() and not rubble.body_rid("group-a").is_valid(),"old body retired and queued body live")
 check(not rubble.enqueue_group(a).accepted,"retired group cannot respawn from delayed duplicate")
 check(not rubble.release_group("missing").accepted,"release of unknown group is explicit failure")
 var invalid := box_group("bad",Vector3.ZERO)
 invalid.packedBoxes[3] = -1.0
 check(not rubble.enqueue_group(invalid).accepted,"invalid negative box size rejected without RIDs")
 invalid = box_group("too-many",Vector3.ZERO,true)
 invalid.packedBoxes.append_array(PackedFloat32Array([2,0,0,0.5,0.5,0.5]))
 check(rubble.enqueue_group(invalid).reason=="group_shape_budget_exceeded","oversized groups explicitly rejected, never approximated")
 check(world.get_child_count()==nodes_before,"adapter creates no per-group or per-cell Nodes")
 rubble.reset()
 var stats: Dictionary = rubble.stats()
 check(stats.createdRids==stats.freedRids and stats.ownedRids==0,"reset releases all adapter body and shape RIDs")
 check(stats.pendingGroups==0 and stats.readyGroups==0 and stats.activeGroups==0,"reset clears all lifecycle queues")
 check(PhysicsServer3D.body_get_space(floor_body)==space and PhysicsServer3D.space_get_direct_state(space)!=null,"reset does not free caller space or static terrain")
 check(rubble.enqueue_group(a).accepted,"reset permits deliberate fresh-epoch replay")
 rubble.reset()
 # Independent shape budget, not only body budget.
 rubble = Adapter.new(space,{"max_bodies":3,"max_shapes_per_group":2,"max_total_shapes":2})
 rubble.enqueue_group(a)
 rubble.confirm_static_removed("group-a")
 rubble.flush_ready()
 rubble.enqueue_group(box_group("group-c",Vector3(5,8,0)))
 rubble.confirm_static_removed("group-c")
 check(rubble.flush_ready().is_empty() and rubble.stats().readyGroups==1,"total compound shape budget backpressures activation")
 check(rubble.release_group("group-a").activated==PackedStringArray(["group-c"]),"shape capacity also drains queued groups")
 rubble.reset()
 report.lifecycle = rubble.stats()


func ray_segment(from: Vector3, to: Vector3) -> Dictionary:
 return PhysicsServer3D.space_get_direct_state(space).intersect_ray(PhysicsRayQueryParameters3D.create(from,to))

func refresh_tests() -> void:
 var rubble = Adapter.new(space,{"max_bodies":1,"max_shapes_per_group":2,"max_total_shapes":2})
 var group := box_group("refresh-group",Vector3(0,8,0),true)
 group.boxRegionIds = ["removed-region","surviving-region"]
 group.originalCenter = {"x":0.0,"y":8.0,"z":0.0}
 check(rubble.enqueue_group(group).accepted,"authority dictionary center supported")
 rubble.confirm_static_removed("refresh-group")
 rubble.flush_ready()
 var body: RID = rubble.body_rid("refresh-group")
 var pose := Transform3D(Basis(Vector3.UP,0.7),Vector3(4,8,2))
 var velocity := Vector3(2,0,0)
 var angular := Vector3(0,0.3,0)
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM,pose)
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY,velocity)
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY,angular)
 var removed_at := pose*Vector3(-0.45,0,0)
 var surviving_at := pose*Vector3(0.45,0,0)
 check(not ray_segment(removed_at+Vector3.UP*2,removed_at-Vector3.UP*2).is_empty(),"removed lobe originally has real Jolt collision")
 var survivor := PackedFloat32Array([0.45,8,0,0.4,0.4,0.4])
 check(rubble.refresh_group("refresh-group",survivor,["surviving-region"]).accepted,"exact surviving boxes replace active compound")
 check(rubble.body_rid("refresh-group")==body,"shape refresh keeps same stable group and body RID")
 check(PhysicsServer3D.body_get_shape_count(body)==1,"shape refresh removes old shape, not only visuals")
 var snapshot: Dictionary = rubble.readback()[0]
 check(snapshot.transform.is_equal_approx(pose),"shape refresh preserves translated and rotated current pose")
 check(snapshot.linearVelocity.is_equal_approx(velocity) and snapshot.angularVelocity.is_equal_approx(angular),"shape refresh preserves linear and angular motion")
 check(ray_segment(removed_at+Vector3.UP*2,removed_at-Vector3.UP*2).is_empty(),"removed rotated lobe immediately has no stale collider")
 var hit := ray_segment(surviving_at+Vector3.UP*2,surviving_at-Vector3.UP*2)
 check(not hit.is_empty() and hit.rid==body,"rotated survivor collision stays in same world and same RID")
 var oversized := survivor.duplicate()
 oversized.append_array(survivor)
 oversized.append_array(survivor)
 check(not rubble.refresh_group("refresh-group",oversized).accepted and PhysicsServer3D.body_get_shape_count(body)==1,"rejected over-budget refresh leaves existing geometry intact")
 rubble.enqueue_group(box_group("waiting-for-destroy",Vector3(10,8,0)))
 rubble.confirm_static_removed("waiting-for-destroy")
 check(rubble.refresh_group("refresh-group",PackedFloat32Array()).released,"empty authority geometry explicitly destroys body")
 check(rubble.body_rid("waiting-for-destroy").is_valid(),"legitimate geometry destruction drains saturated queue")
 rubble.reset()
 check(rubble.stats().ownedRids==0 and rubble.stats().createdRids==rubble.stats().freedRids,"shape replacement reference counts and reset free every RID")
 report.refresh = rubble.stats()

func motion_contact_tests() -> void:
 var rubble = Adapter.new(space,{"max_bodies":3,"max_shapes_per_group":8,"max_total_shapes":16,"max_contact_pairs":64})
 check(rubble.register_static_target(floor_body,"fixture-floor"),"external static target registered without ownership")
 rubble.enqueue_group(box_group("sleeping-base",Vector3(0,2,0),true))
 rubble.confirm_static_removed("sleeping-base")
 rubble.flush_ready()
 for i in 240: await physics_frame
 var settled: Dictionary = rubble.readback()[0]
 check(settled.transform.origin.y<1.0,"compound connected group falls under native gravity")
 check(settled.sleeping,"compound group naturally sleeps")
 var before: Vector3 = settled.transform.origin
 var saw_floor := false
 for contact in rubble.take_contacts():
  if contact.targetId=="fixture-floor": saw_floor = true
 check(saw_floor,"contact target identity resolves registered static collider")
 var impactor := box_group("secondary-impactor",before+Vector3(-0.2,6.0,0))
 impactor.mass = 18.0
 impactor.linearVelocity = Vector3(0.9,-7.0,0.2)
 rubble.enqueue_group(impactor)
 rubble.confirm_static_removed("secondary-impactor")
 rubble.flush_ready()
 var reawoken := false
 var max_speed := 0.0
 var max_impulse := 0.0
 var meaningful := {}
 for i in 240:
  await physics_frame
  for snapshot in rubble.readback():
   if snapshot.id=="sleeping-base" and not snapshot.sleeping: reawoken = true
  for contact in rubble.take_contacts():
   if contact.sourceGroupId=="secondary-impactor" and contact.targetGroupId=="sleeping-base":
    max_speed = maxf(max_speed,contact.preContactClosingSpeed)
    max_impulse = maxf(max_impulse,contact.estimatedImpulseMagnitude)
    if meaningful.is_empty() or contact.preContactClosingSpeed>meaningful.preContactClosingSpeed: meaningful = contact
 check(reawoken,"secondary body reawakens previously sleeping group")
 check(max_speed>2.0,"secondary contact reports meaningful pre-response closing speed")
 check(max_impulse>1.0,"secondary contact reports positive Jolt estimated impulse")
 check(not meaningful.is_empty() and meaningful.targetRidId==rubble.body_rid("sleeping-base").get_id(),"secondary contact resolves stable group plus actual RID identity")
 var displaced := false
 for snapshot in rubble.readback():
  check(snapshot.transform.origin.is_finite(),"physics readback finite")
  if snapshot.id=="sleeping-base": displaced = before.distance_to(snapshot.transform.origin)>0.05
 check(displaced,"secondary impact physically displaces settled rubble")
 check(rubble.stats().activeGroups==2,"sleeping rubble persists, never auto-evicted")
 check(rubble.apply_central_impulse("sleeping-base",Vector3(0,5,0)),"subsequent authorized impulse reaches existing group")
 check(not rubble.apply_central_impulse("unknown",Vector3.UP),"missing impulse target explicitly rejected")
 report.contact_evidence = meaningful
 report.max_precontact_closing_speed = max_speed
 report.max_estimated_impulse = max_impulse
 report.motion_before_reset = rubble.stats()
 rubble.reset()
 check(rubble.stats().ownedRids==0 and rubble.stats().createdRids==rubble.stats().freedRids,"motion reset frees all RIDs and callbacks")
 check(rubble.take_contacts().is_empty(),"reset clears stale contact events")
 report.motion_after_reset = rubble.stats()
