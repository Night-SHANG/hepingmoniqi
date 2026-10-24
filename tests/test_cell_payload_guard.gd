extends SceneTree
func _initialize():
 var loader = load("res://scripts/native_city_loader.gd").new()
 if not loader.has_method("validate_cell_bytes"):
  push_error("Cell payload validation missing from native loader")
  quit(1)
  return
 var manifest = JSON.parse_string(FileAccess.get_file_as_string("res://data/manifest.json"))
 var bytes = FileAccess.get_file_as_bytes("res://data/city-cells.bin")
 assert(loader.validate_cell_bytes(bytes,manifest))
 bytes[0] ^= 1
 assert(not loader.validate_cell_bytes(bytes,manifest))
 assert(not loader.validate_cell_bytes(PackedByteArray(),manifest))
 print("CELL_PAYLOAD_GUARD_PASS")
 quit(0)
