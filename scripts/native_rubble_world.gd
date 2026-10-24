extends RefCounted
## Bounded native representation only. Damage, occupancy and rewards remain external.
## The caller owns the single World3D space and MUST remove old static collision first.

var _space: RID
var _max_bodies := 32
var _max_shapes_per_group := 256
var _max_total_shapes := 2048
var _max_contact_pairs := 256
var _contacts_per_body := 16
var _groups: Dictionary = {}
var _order: Array[String] = []
var _active: Dictionary = {}
var _retired: Dictionary = {}
var _shape_cache: Dictionary = {}
var _rid_to_group: Dictionary = {}
var _static_targets: Dictionary = {}
var _contacts: Dictionary = {}
var _installed_shapes := 0
var _created_rids := 0
var _freed_rids := 0
var _peak_bodies := 0
var _peak_shapes := 0
var _contact_overflows := 0
var _callback_count := 0
var _generation := 1

func _init(existing_world_space: RID, options: Dictionary = {}) -> void:
 _space = existing_world_space
 _max_bodies = maxi(1,int(options.get("max_bodies",32)))
 _max_shapes_per_group = maxi(1,int(options.get("max_shapes_per_group",256)))
 _max_total_shapes = maxi(1,int(options.get("max_total_shapes",2048)))
 _max_contact_pairs = maxi(1,int(options.get("max_contact_pairs",256)))
 _contacts_per_body = maxi(1,int(options.get("contacts_per_body",16)))

func enqueue_group(group: Dictionary) -> Dictionary:
 var id := str(group.get("id",""))
 if not _space.is_valid(): return _rejected(id,"invalid_external_space")
 if id.is_empty(): return _rejected(id,"missing_group_id")
 if _retired.has(id): return _rejected(id,"group_already_retired")
 var center_value: Variant = group.get("originalCenter",null)
 var center := Vector3.ZERO
 if center_value is Vector3:
  center = center_value
 elif center_value is Dictionary and center_value.has_all(["x","y","z"]):
  center = Vector3(center_value.x,center_value.y,center_value.z)
 else:
  return _rejected(id,"invalid_original_center")
 if not center.is_finite(): return _rejected(id,"invalid_original_center")
 var boxes: Variant = group.get("packedBoxes",null)
 if not boxes is PackedFloat32Array or boxes.is_empty() or boxes.size()%6!=0:
  return _rejected(id,"invalid_packed_boxes")
 var count: int = boxes.size()/6
 if count>_max_shapes_per_group or count>_max_total_shapes:
  return _rejected(id,"group_shape_budget_exceeded")
 for i in count:
  var p := Vector3(boxes[i*6],boxes[i*6+1],boxes[i*6+2])
  var half := Vector3(boxes[i*6+3],boxes[i*6+4],boxes[i*6+5])
  if not p.is_finite() or not half.is_finite() or half.x<=0 or half.y<=0 or half.z<=0:
   return _rejected(id,"invalid_box_geometry")
 var mass := float(group.get("mass",1.0))
 var linear: Variant = group.get("linearVelocity",Vector3.ZERO)
 var angular: Variant = group.get("angularVelocity",Vector3.ZERO)
 if not is_finite(mass) or mass<=0: return _rejected(id,"invalid_mass")
 if not linear is Vector3 or not angular is Vector3 or not linear.is_finite() or not angular.is_finite():
  return _rejected(id,"invalid_velocity")
 var labels: Variant = group.get("boxRegionIds",[])
 if not labels is Array or (not labels.is_empty() and labels.size()!=count):
  return _rejected(id,"invalid_box_region_ids")
 var spec := {"id":id,"originalCenter":center,"packedBoxes":boxes.duplicate(),"mass":mass,
  "linearVelocity":linear,"angularVelocity":angular,"rootShotId":str(group.get("rootShotId","")),
  "regionIds":group.get("regionIds",[]).duplicate(),"boxRegionIds":labels.duplicate(),"epoch":int(group.get("epoch",0))}
 if _groups.has(id):
  if _groups[id].spec!=spec: return _rejected(id,"conflicting_group_payload")
  return {"accepted":true,"duplicate":true,"id":id,"status":_groups[id].status}
 _groups[id] = {"spec":spec,"status":"pending_static_removal"}
 _order.append(id)
 return {"accepted":true,"duplicate":false,"id":id,"status":"pending_static_removal"}

func confirm_static_removed(group_id: String) -> bool:
 # An assertion by the collision owner, NOT an asynchronous terrain completion probe.
 if not _groups.has(group_id): return false
 if _groups[group_id].status=="pending_static_removal": _groups[group_id].status = "ready"
 return true

func flush_ready() -> PackedStringArray:
 var activated := PackedStringArray()
 for id in _order:
  if _groups[id].status!="ready": continue
  var spec: Dictionary = _groups[id].spec
  var count: int = spec.packedBoxes.size()/6
  # Preserve FIFO among eligible groups. Neither budget pressure nor sleep evicts anything.
  if _active.size()>=_max_bodies or _installed_shapes+count>_max_total_shapes: break
  _activate(spec)
  _groups[id].status = "active"
  activated.append(id)
 return activated

func body_rid(group_id: String) -> RID:
 return _active[group_id].body if _active.has(group_id) else RID()

func readback() -> Array[Dictionary]:
 var result: Array[Dictionary] = []
 for id in _order:
  if not _active.has(id): continue
  var entry: Dictionary = _active[id]
  var body: RID = entry.body
  var spec: Dictionary = _groups[id].spec
  result.append({"id":id,"epoch":spec.epoch,"rootShotId":spec.rootShotId,"regionIds":spec.regionIds.duplicate(),
   "originalCenter":spec.originalCenter,
   "transform":PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM),
   "linearVelocity":PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY),
   "angularVelocity":PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY),
   "sleeping":PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_SLEEPING)})
 return result

func release_group(group_id: String) -> Dictionary:
 if not _groups.has(group_id): return {"accepted":false,"reason":"unknown_group","activated":PackedStringArray()}
 _free_group(group_id)
 _groups.erase(group_id)
 _order.erase(group_id)
 _retired[group_id] = true
 # Progress is intrinsic to freeing capacity; caller need not remember another flush.
 return {"accepted":true,"activated":flush_ready()}

func refresh_group(group_id: String, packed_boxes: PackedFloat32Array, box_region_ids: Array = [], mass: float = -1.0) -> Dictionary:
 # Call only after the authority has established surviving membership, outside callbacks.
 if not _groups.has(group_id): return _rejected(group_id,"unknown_group")
 if packed_boxes.is_empty():
  var released := release_group(group_id)
  released.released = true
  return released
 if packed_boxes.size()%6!=0: return _rejected(group_id,"invalid_packed_boxes")
 var count: int = packed_boxes.size()/6
 if count>_max_shapes_per_group or count>_max_total_shapes: return _rejected(group_id,"group_shape_budget_exceeded")
 if not box_region_ids.is_empty() and box_region_ids.size()!=count: return _rejected(group_id,"invalid_box_region_ids")
 if not is_finite(mass) or (mass<=0.0 and mass!=-1.0): return _rejected(group_id,"invalid_mass")
 for i in count:
  var p := Vector3(packed_boxes[i*6],packed_boxes[i*6+1],packed_boxes[i*6+2])
  var half := Vector3(packed_boxes[i*6+3],packed_boxes[i*6+4],packed_boxes[i*6+5])
  if not p.is_finite() or not half.is_finite() or half.x<=0 or half.y<=0 or half.z<=0: return _rejected(group_id,"invalid_box_geometry")
 var entry: Dictionary = _active.get(group_id,{})
 var old_count: int = entry.shapeKeys.size() if not entry.is_empty() else 0
 if not entry.is_empty() and _installed_shapes-old_count+count>_max_total_shapes:
  return _rejected(group_id,"refresh_total_shape_budget_exceeded")
 var spec: Dictionary = _groups[group_id].spec
 spec.packedBoxes = packed_boxes.duplicate()
 spec.boxRegionIds = box_region_ids.duplicate()
 if mass>0: spec.mass = mass
 if not entry.is_empty():
  var body: RID = entry.body
  var pose: Transform3D = PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM)
  var linear: Vector3 = PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY)
  var angular: Vector3 = PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY)
  var sleeping: bool = PhysicsServer3D.body_get_state(body,PhysicsServer3D.BODY_STATE_SLEEPING)
  PhysicsServer3D.body_clear_shapes(body)
  _release_shape_keys(entry.shapeKeys)
  entry.shapeKeys = _install_shapes(body,spec)
  _installed_shapes += count-old_count
  PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_MASS,spec.mass)
  PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM,pose)
  PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY,linear)
  PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY,angular)
  PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_SLEEPING,sleeping)
  _peak_shapes = maxi(_peak_shapes,_installed_shapes)
  # Previously buffered shape indices refer to old geometry and cannot be replayed.
  _clear_group_contacts(group_id)
 return {"accepted":true,"released":false,"id":group_id,"activated":flush_ready()}

func apply_central_impulse(group_id: String, impulse: Vector3) -> bool:
 if not _active.has(group_id) or not impulse.is_finite(): return false
 PhysicsServer3D.body_set_state(_active[group_id].body,PhysicsServer3D.BODY_STATE_SLEEPING,false)
 PhysicsServer3D.body_apply_central_impulse(_active[group_id].body,impulse)
 return true

func register_static_target(body: RID, target_id: String) -> bool:
 if not body.is_valid() or target_id.is_empty(): return false
 _static_targets[body.get_id()] = target_id
 return true

func unregister_static_target(body: RID) -> void:
 _static_targets.erase(body.get_id())

func take_contacts() -> Array[Dictionary]:
 # At most one strongest observation per source/target shape pair between drains.
 # Call once per physics tick for impact processing; this is not a reward ledger.
 var result: Array[Dictionary] = []
 for contact in _contacts.values(): result.append(contact)
 _contacts.clear()
 return result

func stats() -> Dictionary:
 var pending := 0
 var ready := 0
 for entry in _groups.values():
  if entry.status=="pending_static_removal": pending += 1
  elif entry.status=="ready": ready += 1
 return {"activeGroups":_active.size(),"pendingGroups":pending,"readyGroups":ready,"retiredGroups":_retired.size(),
  "installedShapes":_installed_shapes,"sharedShapeRids":_shape_cache.size(),"ownedRids":_created_rids-_freed_rids,
  "createdRids":_created_rids,"freedRids":_freed_rids,"peakBodies":_peak_bodies,"peakShapes":_peak_shapes,
  "maxBodies":_max_bodies,"maxTotalShapes":_max_total_shapes,"contactPairOverflows":_contact_overflows,
  "contactPairsWaiting":_contacts.size(),"stateSyncCallbacks":_callback_count,"generation":_generation,
  "ownedSpaces":0,"pieceNodes":0}

func reset() -> void:
 for id in _active.keys(): _free_group(id)
 _groups.clear()
 _order.clear()
 _active.clear()
 _retired.clear()
 _rid_to_group.clear()
 _static_targets.clear()
 _contacts.clear()
 _generation += 1

func _activate(spec: Dictionary) -> void:
 var body := PhysicsServer3D.body_create()
 _created_rids += 1
 PhysicsServer3D.body_set_mode(body,PhysicsServer3D.BODY_MODE_RIGID)
 var keys := _install_shapes(body,spec)
 PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_MASS,spec.mass)
 PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_FRICTION,0.65)
 PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_BOUNCE,0.0)
 PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_LINEAR_DAMP,0.1)
 PhysicsServer3D.body_set_param(body,PhysicsServer3D.BODY_PARAM_ANGULAR_DAMP,0.15)
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_TRANSFORM,Transform3D(Basis.IDENTITY,spec.originalCenter))
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY,spec.linearVelocity)
 PhysicsServer3D.body_set_state(body,PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY,spec.angularVelocity)
 PhysicsServer3D.body_set_max_contacts_reported(body,_contacts_per_body)
 PhysicsServer3D.body_set_enable_continuous_collision_detection(body,true)
 PhysicsServer3D.body_set_state_sync_callback(body,_sync.bind(spec.id,_generation))
 _active[spec.id] = {"body":body,"shapeKeys":keys}
 _rid_to_group[body.get_id()] = spec.id
 PhysicsServer3D.body_set_space(body,_space)
 _installed_shapes += keys.size()
 _peak_bodies = maxi(_peak_bodies,_active.size())
 _peak_shapes = maxi(_peak_shapes,_installed_shapes)

func _install_shapes(body: RID, spec: Dictionary) -> Array[Vector3]:
 var boxes: PackedFloat32Array = spec.packedBoxes
 var keys: Array[Vector3] = []
 for i in boxes.size()/6:
  var p := Vector3(boxes[i*6],boxes[i*6+1],boxes[i*6+2])
  var half := Vector3(boxes[i*6+3],boxes[i*6+4],boxes[i*6+5])
  if not _shape_cache.has(half):
   var shape := PhysicsServer3D.box_shape_create()
   _created_rids += 1
   PhysicsServer3D.shape_set_data(shape,half)
   _shape_cache[half] = {"rid":shape,"refs":0}
  _shape_cache[half].refs += 1
  keys.append(half)
  PhysicsServer3D.body_add_shape(body,_shape_cache[half].rid,Transform3D(Basis.IDENTITY,p-spec.originalCenter))
 return keys

func _sync(state: PhysicsDirectBodyState3D, id: String, generation: int) -> void:
 if generation!=_generation or not _active.has(id): return
 _callback_count += 1
 var spec: Dictionary = _groups[id].spec
 for c in state.get_contact_count():
  var target: RID = state.get_contact_collider(c)
  var target_group: String = _rid_to_group.get(target.get_id(),"")
  var source_shape := state.get_contact_local_shape(c)
  var target_shape := state.get_contact_collider_shape(c)
  var source_region := _shape_region(spec,source_shape)
  var target_region := ""
  if not target_group.is_empty(): target_region = _shape_region(_groups[target_group].spec,target_shape)
  var own_velocity := state.get_contact_local_velocity_at_position(c)
  var other_velocity := state.get_contact_collider_velocity_at_position(c)
  var normal := state.get_contact_local_normal(c).normalized()
  var relative := own_velocity-other_velocity
  var closing := maxf(0.0,-relative.dot(normal))
  var impulse := state.get_contact_impulse(c)
  var key := "%s:%d:%d:%d" % [id,target.get_id(),source_shape,target_shape]
  if not _contacts.has(key) and _contacts.size()>=_max_contact_pairs:
   _contact_overflows += 1
   continue
  if _contacts.has(key) and _contacts[key].preContactClosingSpeed>=closing: continue
  var frame := Engine.get_physics_frames()
  _contacts[key] = {"eventId":"rubble:%d:%d:%s" % [_generation,frame,key],"physicsFrame":frame,
   "sourceGroupId":id,"rootShotId":spec.rootShotId,"epoch":spec.epoch,"sourceRegionId":source_region,
   "sourceShapeIndex":source_shape,"targetGroupId":target_group,"targetRegionId":target_region,
   "targetId":target_group if not target_group.is_empty() else _static_targets.get(target.get_id(),""),
   "targetRid":target,"targetRidId":target.get_id(),"targetShapeIndex":target_shape,
   "position":state.get_contact_local_position(c),"targetPosition":state.get_contact_collider_position(c),
   "normal":normal,"preContactSourceVelocity":own_velocity,"preContactTargetVelocity":other_velocity,
   "preContactRelativeSpeed":relative.length(),"preContactClosingSpeed":closing,
   "estimatedImpulse":impulse,"estimatedImpulseMagnitude":impulse.length(),
   "impulseKind":"jolt_estimated_collision_response","velocityKind":"jolt_contact_point_pre_response",
   "postStepBodySpeed":state.linear_velocity.length()}

func _shape_region(spec: Dictionary, shape_index: int) -> String:
 var labels: Array = spec.boxRegionIds
 if shape_index>=0 and shape_index<labels.size(): return str(labels[shape_index])
 if spec.regionIds.size()==1: return str(spec.regionIds[0])
 return ""

func _free_group(id: String) -> void:
 if not _active.has(id): return
 var entry: Dictionary = _active[id]
 var body: RID = entry.body
 PhysicsServer3D.body_set_state_sync_callback(body,Callable())
 _rid_to_group.erase(body.get_id())
 PhysicsServer3D.free_rid(body)
 _freed_rids += 1
 _release_shape_keys(entry.shapeKeys)
 _installed_shapes -= entry.shapeKeys.size()
 _active.erase(id)
 _clear_group_contacts(id)

func _release_shape_keys(keys: Array) -> void:
 for key in keys:
  _shape_cache[key].refs -= 1
  if _shape_cache[key].refs==0:
   PhysicsServer3D.free_rid(_shape_cache[key].rid)
   _freed_rids += 1
   _shape_cache.erase(key)

func _clear_group_contacts(id: String) -> void:
 for key in _contacts.keys():
  if _contacts[key].sourceGroupId==id or _contacts[key].targetGroupId==id: _contacts.erase(key)

func _rejected(id: String, reason: String) -> Dictionary:
 return {"accepted":false,"duplicate":false,"id":id,"reason":reason}
