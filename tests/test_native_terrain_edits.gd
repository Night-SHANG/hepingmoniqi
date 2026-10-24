extends SceneTree
func _initialize():
 if not FileAccess.file_exists("res://scripts/native_terrain_edits.gd"):
  push_error("Missing batched authority terrain edit adapter")
  quit(1)
  return
 var cells=PackedByteArray()
 cells.resize(3*35)
 for i in 3:
  cells.encode_s16(i*35+4,[-17,-16,0][i]);cells.encode_s16(i*35+6,-1);cells.encode_s16(i*35+8,-1)
 var adapter=load("res://scripts/native_terrain_edits.gd").new()
 var groups=adapter.group_ordinals(cells,PackedInt32Array([0,1,2,0]))
 assert(groups.size()==3 and groups[Vector3i(-2,-1,-1)].size()==1)
 assert(groups[Vector3i(-1,-1,-1)][0]==Vector3i(0,15,15))
 assert(groups[Vector3i(0,-1,-1)][0]==Vector3i(0,15,15))
 assert(adapter.group_ordinals(cells,PackedInt32Array([-1,3])).is_empty())
 print("NATIVE_TERRAIN_EDITS_PASS negative chunks unique removals invalid atomic")
 quit()
