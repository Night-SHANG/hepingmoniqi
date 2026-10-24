extends RefCounted

# Pure regional truth adapter. It never creates nodes, colliders, meshes or physics worlds.
# The packed loader tables are borrowed read-only. Numeric authority remains float64.
const STRIDE = 24
const STATIC = 0
const DYNAMIC = 1
const RUBBLE = 2
const GONE = 3
const STATE_NAMES = ["static","dynamic","rubble","gone"]

var _city: Dictionary
var _regions: PackedFloat64Array
var _cells: PackedByteArray
var _members: PackedInt32Array
var _boxes: PackedFloat32Array
var _contacts: PackedInt32Array
var _pairs: PackedInt32Array
var _ids: Array
var _by_id: Dictionary = {}
var _edges: Array = []
var _anchors: Array = []
var _local_index = PackedInt32Array()
var _hp = PackedFloat64Array()
var _alive = PackedInt32Array()
var _state = PackedByteArray()
var _row_revision = PackedInt64Array()
var _masks: Dictionary = {}
var _mask_boxes: Dictionary = {}
var _positions = PackedFloat64Array()
var _rotations = PackedFloat64Array()
var _group_for_region: Dictionary = {}
var _processed: Dictionary = {}
var _groups: Dictionary = {}
var _pending: Dictionary = {}
var _killed: Dictionary = {}
var _epoch: int
var _revision = 0
var _geometry_revision = 0
var _sequence = 0
var _serial = 0
var _research = 0.0
var _objective_weight = 0.0
var _last_support_visited = 0
var _last_candidate_regions = 0
var _last_candidate_cells = 0
var _last_candidate_boxes = 0
var _last_masked_nearest_cells = 0

func _init(city: Dictionary, epoch: int = 1) -> void:
 assert(epoch >= 0)
 assert(city.metadata.schema == "godot-city-native-tables/v1" and int(city.metadata.region_stride) == STRIDE)
 _city = city
 _regions = city.regions
 _cells = city.cells
 _members = city.members
 _boxes = city.boxes
 _contacts = city.contacts
 _pairs = city.contact_pairs
 _ids = city.metadata.ids
 _epoch = epoch
 var count = _regions.size()/STRIDE
 _local_index.resize(_cells.size()/35)
 _edges.resize(count)
 _anchors.resize(count)
 for i in count:
  _by_id[_region_id(i)] = i
  _edges[i] = PackedInt32Array()
  var anchors = PackedInt32Array()
  var start = int(_r(i,15))
  for j in int(_r(i,16)):
   var o = _members[start+j]
   _local_index[o] = j
   if _cells[o*35+34] & 2: anchors.append(o)
  _anchors[i] = anchors
 for e in _contacts.size()/4:
  _edges[_contacts[e*4]].append(e)
  _edges[_contacts[e*4+1]].append(e)
 # Source compiler sums objective max HP in original ordinal order.
 for o in _cells.size()/35:
  if _cells[o*35+34] & 1: _objective_weight += _cells.decode_double(o*35+22)
 _initialize()

func _r(i: int, column: int) -> float:
 return _regions[i*STRIDE+column]

func _region_id(i: int) -> String:
 return _ids[int(_r(i,22))]

func _initialize() -> void:
 var count = _regions.size()/STRIDE
 _hp.resize(count)
 _alive.resize(count)
 _state.resize(count)
 _row_revision.resize(count)
 _masks.clear()
 _mask_boxes.clear()
 _positions.resize(count*3)
 _rotations.resize(count*4)
 _group_for_region.clear()
 for i in count:
  for axis in 3: _positions[i*3+axis] = _r(i,3+axis)
  for axis in 4: _rotations[i*4+axis] = 1.0 if axis==3 else 0.0
  _hp[i] = _r(i,1)
  _state[i] = STATIC if _hp[i]>0 else GONE
  _row_revision[i] = _revision
  var start = int(_r(i,15))
  var n = int(_r(i,16))
  var ratio = _hp[i]/_r(i,0)
  var mask = PackedFloat64Array()
  var nonuniform = false
  var living = 0
  for j in n:
   var o = _members[start+j]*35
   var hp = _cells.decode_double(o+14)
   mask.append(hp)
   if hp>0: living += 1
   if abs(hp-_cells.decode_double(o+22)*ratio)>1e-9: nonuniform = true
  if nonuniform: _masks[i] = mask
  _alive[i] = living if nonuniform else (n if _hp[i]>0 else 0)

func cell_hp(ordinal: int) -> float:
 if ordinal<0 or ordinal>=_local_index.size(): return 0.0
 var i = int(_cells.decode_u32(ordinal*35+10))
 if _masks.has(i): return _masks[i][_local_index[ordinal]]
 return _hp[i]/_r(i,0)*_cells.decode_double(ordinal*35+22)

func is_static_cell(ordinal: int) -> bool:
 return ordinal>=0 and ordinal<_local_index.size() and _state[_cells.decode_u32(ordinal*35+10)]==STATIC and cell_hp(ordinal)>0

func region(id: Variant) -> Dictionary:
 var i = _index(id)
 if i<0: return {}
 return {"id":_region_id(i),"index":i,"hp":_hp[i],"maxHp":_r(i,0),"aliveCellCount":_alive[i],"cellCount":int(_r(i,16)),"state":STATE_NAMES[_state[i]],"revision":_row_revision[i],"groupId":_group_for_region.get(i,""),"position":{"x":_positions[i*3],"y":_positions[i*3+1],"z":_positions[i*3+2]},"loss":maxf(0,_r(i,1)-_hp[i])*(_r(i,2)/_r(i,0))}

func _index(id: Variant) -> int:
 if id is int and id>=0 and id<_hp.size(): return id
 if id is String: return _by_id.get(id,-1)
 return -1

func _reject(reason: String) -> Dictionary:
 return {"accepted":false,"reason":reason,"changedRegionIds":[],"changedRegionIndices":PackedInt32Array(),"detachedGroups":[],"killedCellOrdinals":PackedInt32Array(),"removedStaticCellOrdinals":PackedInt32Array(),"researchDelta":0.0,"revision":_revision}

func _valid_number(v: Variant) -> bool:
 return (v is int or v is float) and is_finite(float(v))

func blast(command: Dictionary) -> Dictionary:
 var id = command.get("id",null)
 if not id is String or id.is_empty() or id.length()>512 or command.get("epoch")!=_epoch or _processed.has(id): return _reject("epoch-or-duplicate")
 if command.get("sequence")!=_sequence+1: return _reject("sequence")
 var p = command.get("position")
 if not p is Vector3 or not p.is_finite(): return _reject("invalid-command")
 for key in ["radius","damage","impulse"]:
  if not _valid_number(command.get(key)) or command[key]<0: return _reject("invalid-command")
 _processed[id] = true
 _sequence = int(command.sequence)
 var radius: float = command.radius
 var damage: float = command.damage
 var before = _research
 var state_before = _state.duplicate()
 var changed: Dictionary = {}
 var topology = false
 _killed.clear()
 _last_candidate_regions = 0
 _last_candidate_cells = 0
 _last_candidate_boxes = 0
 _last_masked_nearest_cells = 0
 for i in _hp.size():
  if _hp[i]<=0: continue
  var ex = maxf(_r(i,3)-_r(i,6),_r(i,7)-_r(i,3))
  var ey = maxf(_r(i,4)-_r(i,8),_r(i,9)-_r(i,4))
  var ez = maxf(_r(i,5)-_r(i,10),_r(i,11)-_r(i,5))
  if _distance(_positions[i*3]-p.x,_positions[i*3+1]-p.y,_positions[i*3+2]-p.z)>radius+_distance(ex,ey,ez): continue
  _last_candidate_regions += 1
  if radius<=8.0:
   var previous = _hp[i]
   var mask: PackedFloat64Array = _masks.get(i,PackedFloat64Array())
   var start = int(_r(i,15))
   for j in int(_r(i,16)):
    var o = _members[start+j]
    if cell_hp(o)<=0: continue
    _last_candidate_cells += 1
    var world = _world_cell(i,o)
    var distance = _distance(world[0]-p.x,world[1]-p.y,world[2]-p.z)
    if distance>radius: continue
    var amount = damage*(1.0 if radius==0 else 1.0-distance/radius)
    if amount<=0: continue
    if mask.is_empty(): mask = _make_mask(i)
    var loss = minf(mask[j],amount)
    mask[j] -= loss
    if mask[j]<=0: _killed[o] = true
    _hp[i] -= loss
   if not mask.is_empty(): _masks[i] = mask
   topology = _finish_damage(i,previous,changed) or topology
  else:
   var local = _rotate(i,p.x-_positions[i*3],p.y-_positions[i*3+1],p.z-_positions[i*3+2],true)
   for axis in 3: local[axis] += _r(i,3+axis)
   var nearest = _nearest_occupied(i,local)
   if nearest<radius: topology = _aggregate_damage(i,damage*(1.0-nearest/radius),changed) or topology
 return _commit(id,changed,before,topology,state_before)

func _distance(x: float, y: float, z: float) -> float:
 return sqrt(x*x+y*y+z*z)

func _make_mask(i: int) -> PackedFloat64Array:
 var mask = PackedFloat64Array()
 var start = int(_r(i,15))
 for j in int(_r(i,16)):
  mask.append(_cells.decode_double(_members[start+j]*35+22)*_hp[i]/_r(i,0))
 return mask

func _nearest_occupied(i: int, p: PackedFloat64Array) -> float:
 var nearest = INF
 var boxes = active_boxes(i)
 for j in boxes.size()/6:
  var at = j*6
  _last_candidate_boxes += 1
  # JavaScript Math.round uses floor(v + .5), including negative ties.
  var x = clampf(floor(p[0]+0.5),boxes[at]-boxes[at+3]+0.5,boxes[at]+boxes[at+3]-0.5)
  var y = clampf(floor(p[1]+0.5),boxes[at+1]-boxes[at+4]+0.5,boxes[at+1]+boxes[at+4]-0.5)
  var z = clampf(floor(p[2]+0.5),boxes[at+2]-boxes[at+5]+0.5,boxes[at+2]+boxes[at+5]-0.5)
  nearest = minf(nearest,_distance(p[0]-x,p[1]-y,p[2]-z))
 return nearest

# Returns original world-lattice box centers and half extents, NOT posed boxes.
# Caller subtracts the detached group's originalCenter to construct local shapes.
func active_boxes(id: Variant) -> PackedFloat32Array:
 var i = _index(id)
 if i<0 or _hp[i]<=0: return PackedFloat32Array()
 if not _masks.has(i):
  var start = int(_r(i,13))*6
  return _boxes.slice(start,start+int(_r(i,14))*6)
 if _mask_boxes.has(i): return _mask_boxes[i].duplicate()
 # Same bounded greedy occupied-cube packing as TypeScript packScaleBoxes.
 # This is an adapter for the existing region membership, not a voxel mesher.
 var points: Dictionary = {}
 var order: Array[Vector3i] = []
 for j in int(_r(i,16)):
  var o = _members[int(_r(i,15))+j]
  if cell_hp(o)<=0: continue
  var at = o*35
  var point = Vector3i(_cells.decode_s16(at+4),_cells.decode_s16(at+6),_cells.decode_s16(at+8))
  points[point] = true
  order.append(point)
 order.sort_custom(func(a: Vector3i,b: Vector3i) -> bool: return a.y<b.y if a.y!=b.y else (a.z<b.z if a.z!=b.z else a.x<b.x))
 var result = PackedFloat32Array()
 for point in order:
  if not points.has(point): continue
  var nx = 1
  var nz = 1
  var ny = 1
  while points.has(point+Vector3i(nx,0,0)): nx += 1
  while _has_rectangle(points,point,Vector3i(nx,1,1),Vector3i(0,0,nz)): nz += 1
  while _has_rectangle(points,point,Vector3i(nx,1,nz),Vector3i(0,ny,0)): ny += 1
  for dy in ny:
   for dz in nz:
    for dx in nx: points.erase(point+Vector3i(dx,dy,dz))
  result.append_array(PackedFloat32Array([point.x+(nx-1)/2.0,point.y+(ny-1)/2.0,point.z+(nz-1)/2.0,nx/2.0,ny/2.0,nz/2.0]))
 _mask_boxes[i] = result
 return result.duplicate()

func _has_rectangle(points: Dictionary, origin: Vector3i, size: Vector3i, offset: Vector3i) -> bool:
 for dz in size.z:
  for dx in size.x:
   if not points.has(origin+offset+Vector3i(dx,0,dz)): return false
 return true

func _rotate(i: int, x: float, y: float, z: float, inverse: bool = false) -> PackedFloat64Array:
 var sign = -1.0 if inverse else 1.0
 var qx = _rotations[i*4]*sign
 var qy = _rotations[i*4+1]*sign
 var qz = _rotations[i*4+2]*sign
 var qw = _rotations[i*4+3]
 var tx = 2.0*(qy*z-qz*y)
 var ty = 2.0*(qz*x-qx*z)
 var tz = 2.0*(qx*y-qy*x)
 return PackedFloat64Array([x+qw*tx+qy*tz-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty-qy*tx])

func _world_cell(i: int, ordinal: int) -> PackedFloat64Array:
 var at = ordinal*35
 var x = float(_cells.decode_s16(at+4))
 var y = float(_cells.decode_s16(at+6))
 var z = float(_cells.decode_s16(at+8))
 if _state[i]==STATIC: return PackedFloat64Array([x,y,z])
 var p = _rotate(i,x-_r(i,3),y-_r(i,4),z-_r(i,5))
 for axis in 3: p[axis] += _positions[i*3+axis]
 return p

# Feed only actual physics readback. No implicit simulation/settlement is performed.
func set_group_pose(group_id: String, transform: Transform3D, sleeping: bool) -> bool:
 if not _groups.has(group_id) or not transform.is_finite(): return false
 var basis = transform.basis
 if abs(basis.x.length_squared()-1.0)>1e-5 or abs(basis.y.length_squared()-1.0)>1e-5 or abs(basis.z.length_squared()-1.0)>1e-5 or abs(basis.x.dot(basis.y))>1e-5 or abs(basis.x.dot(basis.z))>1e-5 or abs(basis.y.dot(basis.z))>1e-5 or basis.determinant()<0: return false
 var q = basis.get_rotation_quaternion().normalized()
 var group: Dictionary = _groups[group_id]
 for i in group.regionIndices:
  if _state[i]==GONE or _state[i]==STATIC: continue
  _rotations[i*4] = q.x
  _rotations[i*4+1] = q.y
  _rotations[i*4+2] = q.z
  _rotations[i*4+3] = q.w
  var offset = _rotate(i,_r(i,3)-group.originalCenter.x,_r(i,4)-group.originalCenter.y,_r(i,5)-group.originalCenter.z)
  for axis in 3: _positions[i*3+axis] = transform.origin[axis]+offset[axis]
  _state[i] = RUBBLE if sleeping else DYNAMIC
 return true

func apply_impact(command: Dictionary) -> Dictionary:
 var id = command.get("id",null)
 if not id is String or id.is_empty() or id.length()>512 or command.get("epoch")!=_epoch or _processed.has(id): return _reject("epoch-or-duplicate")
 var targets = command.get("targetRegionIds")
 if not targets is Array or not _valid_number(command.get("damage")) or command.damage<0: return _reject("invalid-impact")
 var root_id = command.get("rootShotId",id)
 if not root_id is String: return _reject("invalid-impact")
 var indices: Dictionary = {}
 for target in targets:
  var i = _index(target)
  if i<0: return _reject("invalid-impact")
  indices[i] = true
 _processed[id] = true
 var before = _research
 var state_before = _state.duplicate()
 var changed: Dictionary = {}
 var topology = false
 _killed.clear()
 for i in indices: topology = _aggregate_damage(i,command.damage,changed) or topology
 return _commit(root_id,changed,before,topology,state_before)

func _aggregate_damage(i: int, damage: float, changed: Dictionary) -> bool:
 var previous = _hp[i]
 if previous<=0: return false
 var next = maxf(0,previous-damage*_alive[i])
 var factor = next/previous
 if _masks.has(i):
  var mask: PackedFloat64Array = _masks[i]
  for j in mask.size():
   if mask[j]>0 and factor==0: _killed[_members[int(_r(i,15))+j]] = true
   mask[j] *= factor
  _masks[i] = mask
 elif next==0:
  for j in int(_r(i,16)): _killed[_members[int(_r(i,15))+j]] = true
 _hp[i] = next
 return _finish_damage(i,previous,changed)

func _finish_damage(i: int, previous: float, changed: Dictionary) -> bool:
 if _masks.has(i):
  _hp[i] = 0.0
  for hp in _masks[i]: _hp[i] += hp
 else: _hp[i] = maxf(0,_hp[i])
 if previous==_hp[i]: return false
 var old_alive = _alive[i]
 if _masks.has(i):
  _alive[i] = 0
  for hp in _masks[i]:
   if hp>0: _alive[i] += 1
 else: _alive[i] = int(_r(i,16)) if _hp[i]>0 else 0
 if _alive[i]!=old_alive: _mask_boxes.erase(i)
 if _hp[i]==0: _state[i] = GONE
 _research += (previous-_hp[i])*(_r(i,2)/_r(i,0))
 changed[i] = true
 return old_alive!=_alive[i]

func _contact_alive(edge: int) -> bool:
 var at = edge*4
 var a = _contacts[at]
 var b = _contacts[at+1]
 if _state[a]!=STATIC or _state[b]!=STATIC or _hp[a]<=0 or _hp[b]<=0: return false
 if not _masks.has(a) and not _masks.has(b): return true
 var start = _contacts[at+2]
 for j in range(0,_contacts[at+3],2):
  if cell_hp(_pairs[start+j])>0 and cell_hp(_pairs[start+j+1])>0: return true
 return false

func _release_unsupported(root_shot_id: String, changed: Dictionary) -> Array:
 var visited = PackedByteArray()
 visited.resize(_hp.size())
 var queue = PackedInt32Array()
 _last_support_visited = 0
 for i in _hp.size():
  if _state[i]!=STATIC: continue
  for o in _anchors[i]:
   if cell_hp(o)>0:
    visited[i] = 1
    queue.append(i)
    break
 var head = 0
 while head<queue.size():
  var i = queue[head]
  head += 1
  _last_support_visited += 1
  for edge in _edges[i]:
   var j = _contacts[edge*4+1] if _contacts[edge*4]==i else _contacts[edge*4]
   if not visited[j] and _contact_alive(edge):
    visited[j] = 1
    queue.append(j)
 var detached: Array = []
 for i in _hp.size():
  if visited[i] or _state[i]!=STATIC: continue
  visited[i] = 1
  var component = PackedInt32Array([i])
  head = 0
  while head<component.size():
   var index = component[head]
   head += 1
   for edge in _edges[index]:
    var j = _contacts[edge*4+1] if _contacts[edge*4]==index else _contacts[edge*4]
    if not visited[j] and _contact_alive(edge):
     visited[j] = 1
     component.append(j)
  var x = 0.0
  var y = 0.0
  var z = 0.0
  var mass = 0
  for j in component:
   x += _r(j,3)*_alive[j]
   y += _r(j,4)*_alive[j]
   z += _r(j,5)*_alive[j]
   mass += _alive[j]
  component.sort()
  var region_ids: Array[String] = []
  for j in component: region_ids.append(_region_id(j))
  _serial += 1
  var group_id = "group:%d:%d" % [_epoch,_serial]
  var group = {"id":group_id,"epoch":_epoch,"regionIds":region_ids,"regionIndices":component,"originalCenter":{"x":x/mass,"y":y/mass,"z":z/mass},"rootShotId":root_shot_id}
  for j in component:
   _state[j] = DYNAMIC
   _group_for_region[j] = group_id
   changed[j] = true
  _groups[group_id] = group
  _pending[group_id] = true
  detached.append(group.duplicate(true))
 return detached

func _commit(root_shot_id: String, changed: Dictionary, before: float, topology: bool, state_before: PackedByteArray) -> Dictionary:
 var detached = _release_unsupported(root_shot_id,changed) if topology else []
 _revision += 1
 if not changed.is_empty(): _geometry_revision += 1
 var indices = PackedInt32Array(changed.keys())
 indices.sort()
 var region_ids: Array[String] = []
 var removed = PackedInt32Array()
 for i in indices:
  _row_revision[i] = _revision
  region_ids.append(_region_id(i))
  if state_before[i]!=STATIC: continue
  for j in int(_r(i,16)):
   var o = _members[int(_r(i,15))+j]
   if _killed.has(o) or (_state[i]!=STATIC and cell_hp(o)>0): removed.append(o)
 var killed = PackedInt32Array(_killed.keys())
 killed.sort()
 removed.sort()
 _research = clampf(_research,0,_objective_weight)
 return {"accepted":true,"changedRegionIds":region_ids,"changedRegionIndices":indices,"detachedGroups":detached,"killedCellOrdinals":killed,"removedStaticCellOrdinals":removed,"researchDelta":_research-before,"revision":_revision}

func pending_detached_groups() -> Array:
 var result: Array = []
 for id in _pending: result.append(_groups[id].duplicate(true))
 return result

func acknowledge_detached_group(id: String) -> bool:
 return _pending.erase(id)

func stats() -> Dictionary:
 var counts = PackedInt32Array([0,0,0,0])
 var alive = 0
 var masked_cells = 0
 for i in _hp.size():
  counts[_state[i]] += 1
  alive += _alive[i]
 for mask in _masks.values(): masked_cells += mask.size()
 return {"epoch":_epoch,"revision":_revision,"geometryRevision":_geometry_revision,"regionCount":_hp.size(),"staticRegions":counts[STATIC],"dynamicRegions":counts[DYNAMIC],"rubbleRegions":counts[RUBBLE],"goneRegions":counts[GONE],"aliveCells":alive,"maskRegions":_masks.size(),"maskedCells":masked_cells,"research":_research,"objectiveWeight":_objective_weight,"pendingGroups":_pending.size(),"lastSequence":_sequence,"processedEvents":_processed.size(),"lastSupportVisited":_last_support_visited,"lastCandidateRegions":_last_candidate_regions,"lastCandidateCells":_last_candidate_cells,"lastCandidateBoxes":_last_candidate_boxes,"lastMaskedNearestCells":_last_masked_nearest_cells,"physicsWorldsCreated":0,"poseMode":"explicit-group-readback"}

func reset() -> void:
 _epoch += 1
 _revision += 1
 _geometry_revision += 1
 _sequence = 0
 _serial = 0
 _research = 0.0
 _last_support_visited = 0
 _last_candidate_regions = 0
 _last_candidate_cells = 0
 _last_candidate_boxes = 0
 _last_masked_nearest_cells = 0
 _processed.clear()
 _groups.clear()
 _pending.clear()
 _killed.clear()
 _initialize()
