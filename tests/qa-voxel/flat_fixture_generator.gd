extends VoxelGeneratorScript

# Hand-checked tiny oracle: 125 occupied cells, one layer of 25 by 5 cubes.
# It crosses both negative X boundaries -16 and 0 and negative Z boundary 0.
const RAW_SOLID := 0x887766ff

func _get_used_channels_mask() -> int:
 return VoxelBuffer.CHANNEL_COLOR_BIT

func _generate_block(out_buffer: VoxelBuffer, origin_in_voxels: Vector3i, _lod: int) -> void:
 out_buffer.set_channel_depth(VoxelBuffer.CHANNEL_COLOR, VoxelBuffer.DEPTH_32_BIT)
 out_buffer.fill(0, VoxelBuffer.CHANNEL_COLOR)
 var size := out_buffer.get_size()
 for z in range(size.z):
  for x in range(size.x):
   var p := origin_in_voxels + Vector3i(x, 0, z)
   if p.x < -20 or p.x > 4 or p.z < -3 or p.z > 1:
    continue
   var local_y := -1 - origin_in_voxels.y
   if local_y >= 0 and local_y < size.y:
    out_buffer.set_voxel(RAW_SOLID, x, local_y, z, VoxelBuffer.CHANNEL_COLOR)
