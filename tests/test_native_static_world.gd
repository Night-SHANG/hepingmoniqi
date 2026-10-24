extends SceneTree
func _initialize():
 if not FileAccess.file_exists("res://scripts/native_static_world.gd"):
  push_error("Missing exact-box collision owner")
  quit(1)
  return
 call_deferred("_run")
func _run():
 var w=Node3D.new()
 root.add_child(w)
 var owner=load("res://scripts/native_static_world.gd").new(w.get_world_3d().space)
 var regions={0:PackedFloat32Array([0,0,0,.5,.5,.5]),1:PackedFloat32Array([1,0,0,.5,.5,.5]),2:PackedFloat32Array([-33,0,0,.5,.5,.5])}
 owner.install(regions)
 await physics_frame
 var s=w.get_world_3d().direct_space_state
 assert(not ray(s,0).is_empty() and not ray(s,1).is_empty() and not ray(s,-33).is_empty())
 var hit=ray(s,1)
 assert(owner.region_for_shape(hit.rid,hit.shape)==1)
 var result=owner.replace_regions({0:PackedFloat32Array()})
 assert(result.dirty_chunks==1 and result.shapes==2)
 # Mutation occurs outside physics callbacks, before another step: native shape state is already changed.
 assert(ray(s,0).is_empty() and not ray(s,1).is_empty() and not ray(s,-33).is_empty())
 owner.replace_regions({0:regions[0]})
 assert(not ray(s,0).is_empty())
 owner.dispose()
 assert(ray(s,0).is_empty() and ray(s,1).is_empty() and ray(s,-33).is_empty())
 assert(owner.stats().bodies==0 and owner.stats().shapes==0)
 w.queue_free()
 await process_frame
 print("NATIVE_STATIC_WORLD_PASS exact-hole same-world immediate replacement restore release")
 quit()
func ray(s,x):
 return s.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x,2,0),Vector3(x,-2,0),1))
