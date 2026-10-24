extends SceneTree
func _initialize() -> void:
 for cl in ["VoxelTerrain", "VoxelNode", "VoxelFormat", "VoxelMesher"]:
  print("CLASS ", cl)
  if not ClassDB.class_exists(cl): continue
  for p in ClassDB.class_get_property_list(cl): print("PROPERTY ",p)
  for m in ClassDB.class_get_method_list(cl, true): print("METHOD ", m)
 quit()
