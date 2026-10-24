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
