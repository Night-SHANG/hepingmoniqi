extends RefCounted
# Single synchronous Jolt static collision owner. VoxelTerrain collision must be
# disabled when used alongside this adapter. Existing boxes are exact occupancy,
# not convex hulls. Only dirty 32-unit chunks are rebuilt.
var space: RID
var region_boxes: Dictionary={}
var chunks: Dictionary={}
var bodies: Dictionary={}
var shapes: Dictionary={}
var body_regions:Dictionary={}
var total_shapes:=0
func _init(world_space: RID):
 space=world_space
func _chunk(p:Vector3)->Vector2i:
 return Vector2i(floori(p.x/32.0),floori(p.z/32.0))
func install(data:Dictionary)->Dictionary:
 dispose()
 return replace_regions(data)
func replace_regions(changes:Dictionary)->Dictionary:
 var started=Time.get_ticks_usec()
 var dirty={}
 for id in changes:
  var prior:PackedFloat32Array=region_boxes.get(id,PackedFloat32Array())
  for j in range(0,prior.size(),6): dirty[_chunk(Vector3(prior[j],prior[j+1],prior[j+2]))]=true
  var next:PackedFloat32Array=changes[id]
  assert(next.size()%6==0)
  region_boxes[id]=next.duplicate()
  for j in range(0,next.size(),6): dirty[_chunk(Vector3(next[j],next[j+1],next[j+2]))]=true
 # Index only region membership; updates need no world-scale cell materialization.
 for key in dirty: chunks[key]={}
 for id in region_boxes:
  var boxes:PackedFloat32Array=region_boxes[id]
  for j in range(0,boxes.size(),6):
   var key=_chunk(Vector3(boxes[j],boxes[j+1],boxes[j+2]))
   if dirty.has(key):
    if not chunks[key].has(id): chunks[key][id]=PackedInt32Array()
    chunks[key][id].append(j)
 for key in dirty:
  if bodies.has(key):
   total_shapes-=PhysicsServer3D.body_get_shape_count(bodies[key])
   body_regions.erase(bodies[key])
   PhysicsServer3D.free_rid(bodies[key])
   bodies.erase(key)
  if chunks[key].is_empty(): continue
  var body=PhysicsServer3D.body_create()
  var shape_regions=PackedInt32Array()
  PhysicsServer3D.body_set_mode(body,PhysicsServer3D.BODY_MODE_STATIC)
  PhysicsServer3D.body_set_collision_layer(body,1)
  for id in chunks[key]:
   var boxes:PackedFloat32Array=region_boxes[id]
   for j in chunks[key][id]:
    var center=Vector3(boxes[j],boxes[j+1],boxes[j+2])
    var half=Vector3(boxes[j+3],boxes[j+4],boxes[j+5])
    assert(half.x>0 and half.y>0 and half.z>0)
    if not shapes.has(half):
     var shape=PhysicsServer3D.box_shape_create()
     PhysicsServer3D.shape_set_data(shape,half)
     shapes[half]=shape
    PhysicsServer3D.body_add_shape(body,shapes[half],Transform3D(Basis.IDENTITY,center))
    total_shapes+=1
    shape_regions.append(id)
  PhysicsServer3D.body_set_space(body,space)
  bodies[key]=body
  body_regions[body]=shape_regions
 return {"dirty_chunks":dirty.size(),"shapes":total_shapes,"elapsed_ms":(Time.get_ticks_usec()-started)/1000.0}
func region_for_shape(body:RID, shape_index:int)->int:
 var ids:PackedInt32Array=body_regions.get(body,PackedInt32Array())
 return ids[shape_index] if shape_index>=0 and shape_index<ids.size() else -1
func stats()->Dictionary:
 return {"bodies":bodies.size(),"shapes":total_shapes,"shape_resources":shapes.size()}
func dispose():
 for body in bodies.values(): PhysicsServer3D.free_rid(body)
 bodies.clear()
 body_regions.clear()
 for shape in shapes.values(): PhysicsServer3D.free_rid(shape)
 shapes.clear()
 chunks.clear()
 region_boxes.clear()
 total_shapes=0
