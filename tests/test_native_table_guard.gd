extends SceneTree
func _initialize():
 var loader=load("res://scripts/native_city_loader.gd").new()
 if not loader.has_method("validate_native_table_bytes"):
  push_error("Missing release-safe native table validation");quit(1);return
 var b=PackedByteArray([1,2,3,4]);var h=HashingContext.new();h.start(HashingContext.HASH_SHA256);h.update(b)
 var meta={"bytes":4,"sha256":h.finish().hex_encode()}
 assert(loader.validate_native_table_bytes(b,meta))
 assert(not loader.validate_native_table_bytes(PackedByteArray([1,2,3,5]),meta))
 assert(not loader.validate_native_table_bytes(PackedByteArray(),meta))
 print("NATIVE_TABLE_GUARD_PASS explicit runtime integrity")
 quit()
