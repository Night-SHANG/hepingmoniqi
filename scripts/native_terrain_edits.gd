extends RefCounted
# Native component owns data edits/dirty mesh scheduling; only the game authority
# chooses removed cells. Never replace partial HP damage with a spherical erase.
func group_ordinals(cells:PackedByteArray, ordinals:PackedInt32Array)->Dictionary:
 var result={}
 var seen={}
 for o in ordinals:
  if o<0 or (o+1)*35>cells.size(): return {}
  if seen.has(o): continue
  seen[o]=true
  var p=Vector3i(cells.decode_s16(o*35+4),cells.decode_s16(o*35+6),cells.decode_s16(o*35+8))
  var chunk=Vector3i(floori(p.x/16.0),floori(p.y/16.0),floori(p.z/16.0))
  if not result.has(chunk): result[chunk]=[]
  result[chunk].append(p-chunk*16)
 return result
func apply_removed(terrain:VoxelTerrain,cells:PackedByteArray,ordinals:PackedInt32Array)->Dictionary:
 var started=Time.get_ticks_usec()
 var groups=group_ordinals(cells,ordinals)
 if groups.is_empty() and not ordinals.is_empty(): return {"accepted":false,"reason":"invalid-ordinals"}
 var tool=terrain.get_voxel_tool()
 tool.channel=VoxelBuffer.CHANNEL_COLOR
 # Verify all buffers before any mutation. No partial admission or dropped edit.
 for chunk in groups:
  if not terrain.has_data_block(chunk) or not terrain.bounds.encloses(AABB(Vector3(chunk*16),Vector3(16,16,16))) or not tool.is_area_editable(AABB(Vector3(chunk*16),Vector3(16,16,16))):
   return {"accepted":false,"reason":"data-not-loaded","chunk":chunk}
 var count=0
 for chunk in groups:
  var buffer=VoxelBuffer.new()
  buffer.create(16,16,16)
  buffer.set_channel_depth(VoxelBuffer.CHANNEL_COLOR,VoxelBuffer.DEPTH_32_BIT)
  tool.copy(chunk*16,buffer,VoxelBuffer.CHANNEL_COLOR_BIT)
  for p in groups[chunk]:
   buffer.set_voxel(0,p.x,p.y,p.z,VoxelBuffer.CHANNEL_COLOR)
   count+=1
  tool.paste(chunk*16,buffer,VoxelBuffer.CHANNEL_COLOR_BIT)
 return {"accepted":true,"removed_cells":count,"dirty_data_blocks":groups.size(),"submit_ms":(Time.get_ticks_usec()-started)/1000.0,"collider_ack":false,"mesh_ack":false}
