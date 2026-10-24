extends SceneTree

# Independent extension/API smoke gate. This script deliberately uses ClassDB so
# missing native classes produce a readable failed report rather than parse errors.
const EXPECTED := {
 "VoxelFormat": ["set_channel_depth", "get_channel_depth"],
 "VoxelBuffer": ["create", "set_voxel", "get_voxel", "set_channel_depth"],
 "VoxelTerrain": ["get_voxel_tool", "is_area_meshed", "get_statistics"],
 "VoxelViewer": [],
 "VoxelMesherCubes": ["build_mesh"],
 "VoxelGeneratorScript": [],
 "VoxelTool": ["copy", "paste", "get_voxel", "set_voxel", "is_area_editable", "raycast"],
}

func _initialize() -> void:
 var failures: Array[String] = []
 var classes := {}
 for class_name_: String in EXPECTED:
  var present := ClassDB.class_exists(class_name_)
  var methods := {}
  for method: String in EXPECTED[class_name_]:
   var exists := present and ClassDB.class_has_method(class_name_, method)
   methods[method] = exists
   if not exists:
    failures.append(class_name_ + "." + method)
  if not present:
   failures.append(class_name_)
  classes[class_name_] = {"present": present, "required_methods": methods}
  if present:
   classes[class_name_]["properties"] = ClassDB.class_get_property_list(class_name_, true)
   classes[class_name_]["signals"] = ClassDB.class_get_signal_list(class_name_, true)
   classes[class_name_]["methods"] = ClassDB.class_get_method_list(class_name_, true)
   var constants := {}
   for constant: String in ClassDB.class_get_integer_constant_list(class_name_):
    constants[constant] = ClassDB.class_get_integer_constant(class_name_, constant)
   classes[class_name_]["constants"] = constants
 var report := {
  "schema": "voxel-native-api-qa/v1", "engine": Engine.get_version_info().string,
  "display_server": DisplayServer.get_name(), "gpu_frame_verified": false,
  "classes": classes, "failures": failures, "pass": failures.is_empty(),
 }
 var report_path := "res://tests/qa-voxel/native-api.json"
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--report="):
   report_path = arg.trim_prefix("--report=")
 var file := FileAccess.open(report_path, FileAccess.WRITE)
 file.store_string(JSON.stringify(report, "\t") + "\n")
 file.close()
 print("VOXEL_NATIVE_API_QA pass=", failures.is_empty(), " failures=", failures)
 quit(0 if failures.is_empty() else 1)
