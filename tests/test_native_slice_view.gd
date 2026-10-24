extends SceneTree
var failures: Array[String] = []
var checks := 0
func check(value: bool, label: String) -> void:
 checks += 1
 if not value:
  failures.append(label)
  push_error(label)
func _initialize() -> void:
 if not ResourceLoader.exists("res://scenes/native_slice.tscn"):
  push_error("MISSING_BEHAVIOR: native scene with bounded read-only views and interactive controls does not exist")
  quit(1)
  return
 call_deferred("run")
func run() -> void:
 var scene: PackedScene = load("res://scenes/native_slice.tscn")
 var view = scene.instantiate()
 view.auto_start = false
 root.add_child(view)
 await process_frame
 check(view.get_node_or_null("Camera3D") != null,"orbit camera exists")
 check(view.get_node_or_null("WorldEnvironment") != null,"native sky exists")
 check(view.get_node_or_null("Sun") != null,"warm sun exists")
 check(view.get_node("Camera3D").position.is_equal_approx(Vector3(200,160,220)),"exact default camera")
 var before := view.get_child_count()
 var boxes := PackedFloat32Array([10,8,5,1,2,3,14,8,5,0.5,1,1])
 var pose := Transform3D(Basis(Vector3.UP,0.7),Vector3(30,20,15))
 var rows := [{"id":"group-a","transform":pose,"originalCenter":Vector3(12,8,5),"packedBoxes":boxes,"boxRegionIds":["r1","r2"]}]
 view._sync_rubble(rows)
 check(view._rubble_nodes.size()==1,"one render node per group, never per cell")
 var item: MultiMeshInstance3D = view._rubble_nodes["group-a"]
 check(item.multimesh.instance_count==2,"every exact compound box rendered")
 check(item.transform.is_equal_approx(pose),"body transform used unchanged")
 check(view._box_transform(boxes, 0, Vector3(12,8,5)).origin.is_equal_approx(Vector3(-2,0,0)),"rest-world centers converted to body-local offsets")
 check(view._box_transform(boxes, 0, Vector3(12,8,5)).basis.get_scale().is_equal_approx(Vector3(2,4,6)),"exact half extents become mesh dimensions")
 var mesh = item.multimesh.mesh
 view._sync_rubble(rows)
 check(view._rubble_nodes["group-a"]==item,"repeated readback reuses render nodes")
 check(view.get_child_count()==before,"rubble nodes remain within dedicated branch")
 rows[0].packedBoxes = PackedFloat32Array([14,8,5,0.5,1,1])
 rows[0].boxRegionIds = ["r2"]
 view._sync_rubble(rows)
 check(item.multimesh.instance_count==1,"repeated damage updates exact surviving geometry")
 check(item.multimesh.mesh==mesh,"shared BoxMesh cache reused after refresh")
 view._sync_rubble([])
 check(view._rubble_nodes.is_empty(),"retired authority group removed")
 view._sync_projectiles([{"id":"placed","position":Vector3(1,2,3),"kind":"charge"},{"id":"round","position":Vector3(4,5,6),"kind":"projectile"}])
 check(view._charge_multimesh.instance_count==1 and view._round_multimesh.instance_count==1,"charge and physical round views separated")
 check(view._position_transform(Vector3(4,5,6)).origin.is_equal_approx(Vector3(4,5,6)),"round submitted transform preserves authority position (GPU readback unavailable)")
 var many := []
 for i in 200: many.append({"position":Vector3(i,0,0),"age":0.1,"kind":"blast"})
 view._sync_effects(many)
 check(view._fire_multimesh.instance_count<=view.MAX_EFFECT_INSTANCES,"fire effects have fixed instance budget")
 check(view._dust_multimesh.instance_count<=view.MAX_EFFECT_INSTANCES,"dust effects have fixed instance budget")
 var count_before: int = view._fire_multimesh.instance_count
 view._sync_effects(many)
 check(view._fire_multimesh.instance_count==count_before,"repeated snapshots do not accumulate effects")
 view._sync_effects([])
 check(view._fire_multimesh.instance_count==0 and view._dust_multimesh.instance_count==0,"expired visuals clear without physics lifetime changes")
 view.queue_free()
 await process_frame
 print("NATIVE_SLICE_VIEW_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"headless_only":true,"gpu_frame_verified":false}))
 quit(0 if failures.is_empty() else 1)
