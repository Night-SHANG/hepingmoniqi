extends RefCounted

# Engine-neutral bridge only. No Node, body or collider is created per cell.
func read_city(directory: String) -> Dictionary:
 var started = Time.get_ticks_usec()
 var memory_before = OS.get_static_memory_usage()
 var manifest = JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("manifest.json")))
 assert(manifest is Dictionary and manifest.schema == "godot-city-fixture/v1")
 var cells = FileAccess.get_file_as_bytes(directory.path_join("city-cells.bin"))
 assert(cells.size() == int(manifest.cellCount) * 35)
 var read_finished = Time.get_ticks_usec()
 var data = JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("city-regions.json")))
 assert(data is Dictionary and data.regions.size() == int(manifest.regionCount))
 var hash_ctx = HashingContext.new()
 assert(hash_ctx.start(HashingContext.HASH_SHA256) == OK)
 hash_ctx.update(cells)
 assert(hash_ctx.finish().hex_encode() == manifest.files[0].sha256)
 var result = {"cells":cells,"regions":data.regions,"contacts":data.contacts,"cell_count":int(manifest.cellCount),"building_count":int(manifest.buildingCount),"terrain_count":int(manifest.terrainCount),"node_count":0,"manifest":manifest}
 result.metrics = {"schema":"native-city-load/v1","load_ms":(Time.get_ticks_usec()-started)/1000.0,"packed_cell_read_ms":(read_finished-started)/1000.0,"memory_delta_bytes":OS.get_static_memory_usage()-memory_before,"cell_bytes":cells.size(),"regions":data.regions.size(),"nodes_created":0,"headless_only":true,"gpu_frame_verified":false}
 return result

func read_native(directory: String) -> Dictionary:
 var started = Time.get_ticks_usec()
 var memory_before = OS.get_static_memory_usage()
 var meta = JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("native-tables.json")))
 if not meta is Dictionary or meta.get("schema") != "godot-city-native-tables/v1" or int(meta.get("region_stride",0)) != 24: return {}
 var cells = FileAccess.get_file_as_bytes(directory.path_join("city-cells.bin"))
 var manifest = JSON.parse_string(FileAccess.get_file_as_string(directory.path_join("manifest.json")))
 if not validate_cell_bytes(cells, manifest): return {}
 var result = {"metadata":meta,"cells":cells}
 for key in meta.files:
  var bytes = FileAccess.get_file_as_bytes(directory.path_join(key+".bin"))
  if not validate_native_table_bytes(bytes,meta.files[key]): return {}
  var field = key.replace("-", "_")
  if key == "regions": result[field] = bytes.to_float64_array()
  elif key == "boxes": result[field] = bytes.to_float32_array()
  else: result[field] = bytes.to_int32_array()
 result.metrics = {"schema":"native-packed-city-load/v1","load_ms":(Time.get_ticks_usec()-started)/1000.0,"memory_delta_bytes":OS.get_static_memory_usage()-memory_before,"nodes_created":0,"headless_only":true,"gpu_frame_verified":false,"hashes_verified":true}
 return result

func validate_cell_bytes(bytes: PackedByteArray, manifest: Dictionary) -> bool:
 if manifest.get("schema") != "godot-city-fixture/v1" or bytes.size() != int(manifest.get("cellCount",0))*35: return false
 var expected = ""
 for file in manifest.get("files",[]):
  if file.get("name") == "city-cells.bin": expected = file.get("sha256", "")
 if expected.is_empty(): return false
 var hash_ctx = HashingContext.new()
 hash_ctx.start(HashingContext.HASH_SHA256)
 hash_ctx.update(bytes)
 return hash_ctx.finish().hex_encode() == expected

func validate_native_table_bytes(bytes:PackedByteArray, metadata:Dictionary)->bool:
 if bytes.size()!=int(metadata.get("bytes",-1)): return false
 var hash_ctx=HashingContext.new()
 if hash_ctx.start(HashingContext.HASH_SHA256)!=OK: return false
 hash_ctx.update(bytes)
 return hash_ctx.finish().hex_encode()==metadata.get("sha256","")
