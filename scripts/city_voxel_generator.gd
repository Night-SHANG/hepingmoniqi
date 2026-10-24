extends VoxelGeneratorScript

# Immutable pristine renderer/collider input. This is not HP, support, fracture,
# save-game or dynamic-body authority. Initialize once before attaching terrain.
const BLOCK_SIZE := 16
const BLOCK_BYTES := BLOCK_SIZE * BLOCK_SIZE * BLOCK_SIZE * 4
const COLOR_CHANNEL := VoxelBuffer.CHANNEL_COLOR
const CityLoader := preload("res://scripts/native_city_loader.gd")

var _blocks: Dictionary = {}
var _initialized := false
var _cell_bounds := AABB()
var cell_bounds: AABB:
 get: return _cell_bounds
var terrain_translation: Vector3:
 get: return Vector3(-0.5, -0.5, -0.5)

func initialize_from_bytes(cells: PackedByteArray, manifest: Dictionary) -> Dictionary:
 if _initialized:
  return {"ok":false,"error":"Generator is immutable after initialization; create a new resource for a new pristine fixture"}
 if int(manifest.get("recordBytes",0)) != 35 or not manifest.get("littleEndian",false):
  return {"ok":false,"error":"Expected 35-byte little-endian cell records"}
 if not CityLoader.new().validate_cell_bytes(cells, manifest):
  return {"ok":false,"error":"Packed cell length or SHA-256 does not match manifest"}
 var cell_count := int(manifest.get("cellCount",0))
 if cell_count <= 0 or not manifest.get("bounds") is Dictionary:
  return {"ok":false,"error":"Fixture requires occupied cells and finite bounds"}
 var bounds: Dictionary = manifest.bounds
 for axis in ["minX","minY","minZ","maxX","maxY","maxZ"]:
  if not bounds.has(axis):
   return {"ok":false,"error":"Missing bounds component: " + axis}
 var declared_min := Vector3i(int(bounds.minX),int(bounds.minY),int(bounds.minZ))
 var declared_max := Vector3i(int(bounds.maxX),int(bounds.maxY),int(bounds.maxZ))
 var actual_min := Vector3i(32767,32767,32767)
 var actual_max := Vector3i(-32768,-32768,-32768)
 var block_ordinals: Dictionary = {}
 var started := Time.get_ticks_usec()
 # Discover block ordinals without retaining a Variant/Node for each cell.
 for i in cell_count:
  var offset := i*35
  var position := Vector3i(cells.decode_s16(offset+4),cells.decode_s16(offset+6),cells.decode_s16(offset+8))
  actual_min = actual_min.min(position)
  actual_max = actual_max.max(position)
  var block_position := _block_position(position)
  if not block_ordinals.has(block_position):
   block_ordinals[block_position] = block_ordinals.size()
 if actual_min != declared_min or actual_max != declared_max:
  return {"ok":false,"error":"Decoded coordinate extrema do not match manifest bounds"}
 # One contiguous temporary avoids copy-on-write of a 16 KiB block per cell.
 var packed_blocks := PackedByteArray()
 packed_blocks.resize(block_ordinals.size()*BLOCK_BYTES)
 packed_blocks.fill(0)
 for i in cell_count:
  var offset := i*35
  var position := Vector3i(cells.decode_s16(offset+4),cells.decode_s16(offset+6),cells.decode_s16(offset+8))
  var block_position := _block_position(position)
  var local := position - block_position*BLOCK_SIZE
  var index := (local.y + BLOCK_SIZE*(local.x + BLOCK_SIZE*local.z))*4
  var destination := int(block_ordinals[block_position])*BLOCK_BYTES + index
  if packed_blocks.decode_u32(destination) != 0:
   return {"ok":false,"error":"Duplicate occupied coordinate in fixture: %s" % position}
  var rgb := cells.decode_u32(offset+30)
  if rgb > 0xFFFFFF:
   return {"ok":false,"error":"Expected source RGB24, not an ambiguous alpha-packed color"}
  packed_blocks.encode_u32(destination,(rgb << 8) | 0xFF)
 var prepared: Dictionary = {}
 for block_position in block_ordinals:
  var offset := int(block_ordinals[block_position])*BLOCK_BYTES
  prepared[block_position] = packed_blocks.slice(offset,offset+BLOCK_BYTES)
 # Publish only after complete validation. Callback reads remain immutable.
 _blocks = prepared
 _cell_bounds = AABB(Vector3(actual_min),Vector3(actual_max-actual_min+Vector3i.ONE))
 _initialized = true
 return {"ok":true,"cell_count":cell_count,"block_count":_blocks.size(),"packed_color_bytes":_blocks.size()*BLOCK_BYTES,"nodes_created":0,"pack_ms":(Time.get_ticks_usec()-started)/1000.0}

# The caller must already validate the source cells against source_manifest (as
# read_native does). This binds that verified source identity to a prebuilt,
# immutable rendering artifact without scanning every cell a second time.
func initialize_from_prebuilt(payload: PackedByteArray, metadata: Dictionary, source_manifest: Dictionary) -> Dictionary:
 var started := Time.get_ticks_usec()
 if _initialized:
  return {"ok":false,"error":"Generator is immutable after initialization"}
 if metadata.get("schema") != "godot-city-voxel-blocks/v1" or metadata.get("block_size") != BLOCK_SIZE or metadata.get("block_record_bytes") != BLOCK_BYTES+12:
  return {"ok":false,"error":"Unsupported prebuilt block format"}
 if metadata.get("color_depth_bits") != 32 or metadata.get("color_channel") != "CHANNEL_COLOR" or metadata.get("color_encoding") != "rgba8-u32-le" or metadata.get("cell_order") != "y-x-z":
  return {"ok":false,"error":"Prebuilt color format must be 32-bit raw RGBA with Y-fast indexing"}
 if source_manifest.get("schema") != "godot-city-fixture/v1" or source_manifest.get("recordBytes") != 35 or source_manifest.get("littleEndian") != true:
  return {"ok":false,"error":"Unsupported source cell format"}
 var count: Variant = metadata.get("cell_count")
 var block_count: Variant = metadata.get("block_count")
 if not _is_integer(count) or not _is_integer(block_count) or count <= 0 or block_count <= 0 or count != source_manifest.get("cellCount") or count > block_count*4096 or block_count > count:
  return {"ok":false,"error":"Invalid prebuilt cell or block count"}
 var bounds: Dictionary = _validated_bounds(metadata.get("bounds"))
 var source_bounds: Dictionary = _validated_bounds(source_manifest.get("bounds"))
 if bounds.is_empty() or bounds != source_bounds:
  return {"ok":false,"error":"Prebuilt bounds do not match source"}
 if not metadata.get("source") is Dictionary or not metadata.get("payload") is Dictionary or not source_manifest.get("files") is Array:
  return {"ok":false,"error":"Missing prebuilt source or payload descriptor"}
 var source: Dictionary = metadata.source
 var expected: Dictionary = {}
 for entry in source_manifest.files:
  if not entry is Dictionary: return {"ok":false,"error":"Invalid source file descriptor"}
  if entry.get("name") == "city-cells.bin":
   if not expected.is_empty(): return {"ok":false,"error":"Ambiguous source file descriptor"}
   expected = entry
 if source.get("name") != "city-cells.bin" or source.get("bytes") != count*35 or source.get("bytes") != expected.get("bytes") or not _is_sha256(source.get("sha256")) or source.get("sha256") != expected.get("sha256"):
  return {"ok":false,"error":"Prebuilt source length or SHA-256 does not match source manifest"}
 var descriptor: Dictionary = metadata.payload
 if descriptor.get("name") != "city-voxel-blocks.bin" or payload.size() != block_count*(BLOCK_BYTES+12) or descriptor.get("bytes") != payload.size() or not _is_sha256(descriptor.get("sha256")):
  return {"ok":false,"error":"Invalid prebuilt payload length or descriptor"}
 var hash_ctx := HashingContext.new()
 if hash_ctx.start(HashingContext.HASH_SHA256) != OK:
  return {"ok":false,"error":"Cannot initialize SHA-256 verification"}
 hash_ctx.update(payload)
 if hash_ctx.finish().hex_encode() != descriptor.sha256:
  return {"ok":false,"error":"Prebuilt payload SHA-256 does not match"}
 var declared_min := Vector3i(int(bounds.minX),int(bounds.minY),int(bounds.minZ))
 var declared_max := Vector3i(int(bounds.maxX),int(bounds.maxY),int(bounds.maxZ))
 var min_block := _block_position(declared_min)
 var max_block := _block_position(declared_max)
 var prepared: Dictionary = {}
 # Only 438 blocks for the full fixture, not its 454,913 source cells.
 for i in int(block_count):
  var offset := i*(BLOCK_BYTES+12)
  var position := Vector3i(payload.decode_s32(offset),payload.decode_s32(offset+4),payload.decode_s32(offset+8))
  if position.x < min_block.x or position.y < min_block.y or position.z < min_block.z or position.x > max_block.x or position.y > max_block.y or position.z > max_block.z or prepared.has(position):
   return {"ok":false,"error":"Duplicate or out-of-bounds prebuilt block coordinate"}
  prepared[position] = payload.slice(offset+12,offset+12+BLOCK_BYTES)
 # Publish only after all validation. Caller/output mutation cannot modify these
 # packed slices because PackedByteArray uses copy-on-write value semantics.
 _blocks = prepared
 _cell_bounds = AABB(Vector3(declared_min),Vector3(declared_max-declared_min+Vector3i.ONE))
 _initialized = true
 return {"ok":true,"source":"prebuilt","cell_count":int(count),"block_count":_blocks.size(),"packed_color_bytes":_blocks.size()*BLOCK_BYTES,"nodes_created":0,"pack_ms":(Time.get_ticks_usec()-started)/1000.0}

func _is_integer(value: Variant) -> bool:
 return (value is int or value is float) and is_finite(float(value)) and float(value) == floor(float(value))

func _is_sha256(value: Variant) -> bool:
 return value is String and value.length() == 64 and value.is_valid_hex_number(false)

func _validated_bounds(value: Variant) -> Dictionary:
 if not value is Dictionary: return {}
 var result: Dictionary = {}
 for key in ["minX","minY","minZ","maxX","maxY","maxZ"]:
  var component: Variant = value.get(key)
  if not _is_integer(component) or component < -32768 or component > 32767: return {}
  result[key] = int(component)
 for axis in ["X","Y","Z"]:
  if result["min"+axis] > result["max"+axis]: return {}
 return result

func get_raw_color(position: Vector3i) -> int:
 var block_position := _block_position(position)
 if not _blocks.has(block_position): return 0
 var local := position - block_position*BLOCK_SIZE
 var bytes: PackedByteArray = _blocks[block_position]
 return bytes.decode_u32((local.y + BLOCK_SIZE*(local.x + BLOCK_SIZE*local.z))*4)

func _get_used_channels_mask() -> int:
 return 1 << COLOR_CHANNEL

func _generate_block(out_buffer: VoxelBuffer, origin_in_voxels: Vector3i, lod: int) -> void:
 # VoxelTerrain requests aligned 16^3 LOD0 blocks. VoxelLodTerrain is not supported.
 # Never touch SceneTree, mutable game state or retain out_buffer in this callback.
 out_buffer.set_channel_depth(COLOR_CHANNEL,VoxelBuffer.DEPTH_32_BIT)
 out_buffer.fill(0,COLOR_CHANNEL)
 if not _initialized or lod != 0 or out_buffer.get_size() != Vector3i.ONE*BLOCK_SIZE or origin_in_voxels != _block_position(origin_in_voxels)*BLOCK_SIZE:
  push_error("City voxel generator requires initialized, aligned 16^3 LOD0 VoxelTerrain blocks")
  return
 var block_position := _block_position(origin_in_voxels)
 if _blocks.has(block_position):
  out_buffer.set_channel_from_byte_array(COLOR_CHANNEL,_blocks[block_position])
 out_buffer.compress_uniform_channels()

func _block_position(position: Vector3i) -> Vector3i:
 # Signed arithmetic shift is floor division for power-of-two chunk boundaries.
 return Vector3i(position.x >> 4,position.y >> 4,position.z >> 4)
