extends Node3D
signal city_ready
const Loader=preload("res://scripts/native_city_loader.gd")
const Generator=preload("res://scripts/city_voxel_generator.gd")
const Model=preload("res://scripts/regional_blast_model.gd")
const Static=preload("res://scripts/native_static_world.gd")
const Rubble=preload("res://scripts/native_rubble_world.gd")
const Edits=preload("res://scripts/native_terrain_edits.gd")
class PhysicalRound extends RigidBody3D:
 var impact=false
 var impact_point=Vector3.ZERO
 var age=0.0
 func _integrate_forces(state:PhysicsDirectBodyState3D):
  if state.get_contact_count()>0 and age>.03:
   impact=true;impact_point=state.transform.origin
var is_ready=false
var _loading=false
var data:Dictionary
var model
var statics
var rubble
var edits=Edits.new()
var terrain:VoxelTerrain
var groups={}
var masses={}
var episodes={}
var serial=0
var tick=0
var impacts=[]
var _failures=[]
var all_finite=true
var _charges={}
var _rounds={}
var _effects=[]
var _pending=[]
var _next_id=0
var _blast_count=0
var _sim_time=0.0
var _last_blast_ms=0.0
var _cached_research=0.0
var _viewer:VoxelViewer
var _visuals={}
var _startup_begin_usec=0
var _startup_last_usec=0
var _startup_profile={}
func startup_metrics()->Dictionary: return _startup_profile.duplicate(true)
func _startup_mark(stage:String):
 var now=Time.get_ticks_usec()
 _startup_profile.stages_ms[stage]=(now-_startup_last_usec)/1000.0
 _startup_profile.total_ms=(now-_startup_begin_usec)/1000.0
 _startup_profile.process_to_ready_ms=now/1000.0
 _startup_last_usec=now
func start():
 if _loading or is_ready: return
 _loading=true
 _startup_begin_usec=Time.get_ticks_usec();_startup_last_usec=_startup_begin_usec
 _startup_profile={"schema":"native-startup-profile/v1","stages_ms":{},"total_ms":0.0,"process_to_ready_ms":0.0}
 Engine.physics_ticks_per_second=120
 data=Loader.new().read_native("res://data")
 _startup_mark("read_verify_decode")
 model=Model.new(data)
 _startup_mark("regional_model")
 var generator=Generator.new()
 var manifest=JSON.parse_string(FileAccess.get_file_as_string("res://data/manifest.json"))
 var prepared:Dictionary
 if "--native-startup-baseline" in OS.get_cmdline_user_args():
  prepared=generator.initialize_from_bytes(data.cells,manifest)
 else:
  var block_metadata=JSON.parse_string(FileAccess.get_file_as_string("res://data/city-voxel-blocks.json"))
  prepared=generator.initialize_from_prebuilt(FileAccess.get_file_as_bytes("res://data/city-voxel-blocks.bin"),block_metadata,manifest) if block_metadata is Dictionary else {"ok":false}
 _startup_profile.voxel_source="prebuilt" if not "--native-startup-baseline" in OS.get_cmdline_user_args() else "baseline"
 if not prepared.ok:
  _failures.append("generator_initialization_failed");_loading=false;return
 _startup_mark("voxel_prepare")
 statics=Static.new(get_world_3d().space)
 rubble=Rubble.new(get_world_3d().space,{"max_bodies":64,"max_shapes_per_group":32768,"max_total_shapes":32768,"max_contact_pairs":4096,"contacts_per_body":64})
 var initial={}
 for i in data.regions.size()/24: initial[i]=model.active_boxes(i)
 _startup_mark("collision_prepare")
 statics.install(initial)
 _startup_mark("collision_install")
 terrain=VoxelTerrain.new();terrain.position=Vector3(-.5,-.5,-.5)
 terrain.bounds=AABB(Vector3(-128,-32,-128),Vector3(256,96,256))
 terrain.max_view_distance=256;terrain.generate_collisions=false
 var fmt=VoxelFormat.new();fmt.set_channel_depth(VoxelBuffer.CHANNEL_COLOR,VoxelBuffer.DEPTH_32_BIT);terrain.format=fmt
 var mesher=VoxelMesherCubes.new();mesher.color_mode=VoxelMesherCubes.COLOR_RAW;mesher.greedy_meshing_enabled=true
 var material=StandardMaterial3D.new();material.vertex_color_use_as_albedo=true;material.roughness=.88
 mesher.opaque_material=material
 terrain.mesher=mesher;terrain.generator=generator;add_child(terrain)
 _viewer=VoxelViewer.new();_viewer.position=Vector3(0,16,0);_viewer.view_distance=256
 _viewer.requires_visuals=true;_viewer.requires_collisions=false;add_child(_viewer)
 _startup_mark("terrain_attach")
 var begun=Time.get_ticks_usec()
 while not terrain.is_area_meshed(generator.cell_bounds):
  await get_tree().process_frame
  if not _loading: return
  if Time.get_ticks_usec()-begun>30000000:
   _failures.append("initial_mesh_timeout");release();return
 _startup_mark("mesh_wait")
 is_ready=true;_loading=false
 print("NATIVE_STARTUP_PROFILE ",JSON.stringify(_startup_profile))
 print("NATIVE_SESSION_READY cells=454913 buildings=36 hashes_verified=",data.metrics.hashes_verified," voxel_extension=",ClassDB.class_exists("VoxelTerrain")," backend=",get_world_3d().direct_space_state.get_class())
 city_ready.emit()
func place_charge(position:Vector3)->bool:
 if not is_ready or not position.is_finite() or get_tree().paused: return false
 _next_id+=1;_charges[str(_next_id)]=position
 return true
func launch_projectile(origin:Vector3,velocity:Vector3)->bool:
 if not is_ready or not origin.is_finite() or not velocity.is_finite() or get_tree().paused: return false
 _next_id+=1
 var body=PhysicalRound.new();body.position=origin;body.linear_velocity=velocity
 body.mass=1;body.continuous_cd=true;body.max_contacts_reported=8
 body.linear_damp_mode=RigidBody3D.DAMP_MODE_REPLACE;body.linear_damp=0.0
 body.collision_layer=2;body.collision_mask=1
 var shape=CollisionShape3D.new();var sphere=SphereShape3D.new();sphere.radius=.45;shape.shape=sphere;body.add_child(shape)
 add_child(body);_rounds[str(_next_id)]=body
 return true
func detonate_all():
 if not is_ready or get_tree().paused: return
 for point in _charges.values(): _pending.append(point)
 _charges.clear()
func set_paused(value:bool): get_tree().paused=value
func _physics_process(delta):
 if not is_ready: return
 _sim_time+=delta
 _step_contacts()
 for id in _rounds.keys():
  var body=_rounds[id];body.age+=delta
  if body.impact:
   _pending.append(body.impact_point);body.queue_free();_rounds.erase(id)
  elif body.age>20 or body.position.y< -100:
   body.queue_free();_rounds.erase(id)
 if not _pending.is_empty():
  var commands=_pending.duplicate();_pending.clear()
  for point in commands: blast(point)
 for effect in _effects: effect.age+=delta
 _effects=_effects.filter(func(e):return e.age<5.5)
func blast(point:Vector3):
 if not is_ready: return false
 _sync_poses();_blast_count+=1
 var begun=Time.get_ticks_usec()
 var command={"id":"native-nova-%d"%_blast_count,"epoch":1,"sequence":_blast_count,"position":point,"radius":48.0,"damage":20.0,"impulse":12.0}
 var tx=model.blast(command)
 if not tx.accepted: _failures.append("blast_rejected");return false
 _commit([tx],command)
 _last_blast_ms=(Time.get_ticks_usec()-begun)/1000.0
 _effects.append({"position":point,"age":0.0,"kind":"nova"})
 return true
func projectiles()->Array:
 var out=[]
 for id in _charges: out.append({"id":id,"position":_charges[id],"kind":"charge"})
 for id in _rounds: out.append({"id":id,"position":_rounds[id].global_position,"kind":"projectile"})
 return out
func effects()->Array: return _effects.duplicate(true)
func rubble_views()->Array:
 var out=[]
 if rubble==null: return out
 for body in rubble.readback():
  if _visuals.has(body.id):
   var v=_visuals[body.id].duplicate();v.transform=body.transform;out.append(v)
 return out
func status()->Dictionary:
 var rs=rubble.stats() if rubble!=null else {}
 return {"is_ready":is_ready,"sim_time":_sim_time,"blast_count":_blast_count,"research":_cached_research,"active_groups":rs.get("activeGroups",0),"pending_groups":rs.get("pendingGroups",0)+rs.get("readyGroups",0),"owned_collision_rids":rs.get("ownedRids",0)+(statics.stats().bodies+statics.stats().shape_resources if statics!=null else 0),"last_blast_ms":_last_blast_ms,"failures":_failures.duplicate()}
func release():
 is_ready=false;_loading=false
 get_tree().paused=false
 for body in _rounds.values(): body.queue_free()
 _rounds.clear();_charges.clear();_pending.clear();_effects.clear();_visuals.clear()
 groups.clear();masses.clear();episodes.clear()
 if rubble!=null: rubble.reset()
 if statics!=null: statics.dispose()
 if is_instance_valid(terrain): terrain.queue_free()
 if is_instance_valid(_viewer): _viewer.queue_free()
func _exit_tree():
 if rubble!=null: rubble.reset()
 if statics!=null: statics.dispose()

func _sync_poses():
 for body in rubble.readback():
  all_finite=all_finite and body.transform.origin.is_finite() and body.linearVelocity.is_finite()
  if not model.set_group_pose(body.id,body.transform,body.sleeping): _failures.append("pose_sync_rejected:"+body.id)
func _commit(transactions:Array,blast:Dictionary={})->Dictionary:
 var dirty={};var removed=PackedInt32Array();var detached=[];var dirty_groups={}
 for tx in transactions:
  if not tx.accepted: continue
  _cached_research+=tx.researchDelta
  for i in tx.changedRegionIndices:
   var region=model.region(i)
   dirty[i]=model.active_boxes(i) if region.state=="static" else PackedFloat32Array()
   if not region.groupId.is_empty(): dirty_groups[region.groupId]=true
  removed.append_array(tx.removedStaticCellOrdinals)
  detached.append_array(tx.detachedGroups)
 var collision=statics.replace_regions(dirty) if not dirty.is_empty() else {"dirty_chunks":0,"elapsed_ms":0}
 var terrain_result=edits.apply_removed(terrain,data.cells,removed)
 if not terrain_result.accepted: _failures.append("terrain_edit_not_admitted")
 var begin=Time.get_ticks_usec()
 for id in dirty_groups:
  if not groups.has(id): continue
  var boxes=PackedFloat32Array();var labels=[];var mass=0
  for rid in groups[id].regionIds:
   var b=model.active_boxes(rid);boxes.append_array(b)
   for j in b.size()/6: labels.append(rid)
   mass+=model.region(rid).aliveCellCount
  var updated=rubble.refresh_group(id,boxes,labels,maxf(1,mass))
  if not updated.accepted: _failures.append("rubble_refresh_rejected:"+str(updated))
  masses[id]=maxf(1,mass)
  if boxes.is_empty(): _visuals.erase(id)
  else: _visuals[id]={"id":id,"originalCenter":Vector3(groups[id].originalCenter.x,groups[id].originalCenter.y,groups[id].originalCenter.z),"packedBoxes":boxes,"boxRegionIds":labels}
 for group in detached:
  var spec=group.duplicate(true);var boxes=PackedFloat32Array();var labels=[];var mass=0
  for id in group.regionIds:
   var b=model.active_boxes(id);boxes.append_array(b)
   for j in b.size()/6: labels.append(id)
   mass+=model.region(id).aliveCellCount
  if boxes.is_empty():
   model.acknowledge_detached_group(group.id)
   continue
  spec.packedBoxes=boxes;spec.boxRegionIds=labels;spec.mass=maxf(1,mass)
  # Explicit native approximation: preserve attack impulse parameter with radial initial velocity.
  if not blast.is_empty():
   var c=Vector3(group.originalCenter.x,group.originalCenter.y,group.originalCenter.z)
   var delta=c-blast.position
   spec.linearVelocity=delta.normalized()*blast.impulse*maxf(0,1-delta.length()/blast.radius)
  var admitted=rubble.enqueue_group(spec)
  if not admitted.accepted: _failures.append("rubble_rejected:"+str(admitted))
  else:
   groups[group.id]=group
   masses[group.id]=spec.mass
   _visuals[group.id]={"id":group.id,"originalCenter":Vector3(group.originalCenter.x,group.originalCenter.y,group.originalCenter.z),"packedBoxes":boxes,"boxRegionIds":labels}
   rubble.confirm_static_removed(group.id)
   model.acknowledge_detached_group(group.id)
 rubble.flush_ready()
 return {"terrain":terrain_result,"collision":collision,"groups_ms":(Time.get_ticks_usec()-begin)/1000.0}
func _step_contacts():
 tick=Engine.get_physics_frames()
 _sync_poses()
 var touching={};var transactions=[];var strongest={}
 for c in rubble.take_contacts():
  var target=str(c.targetRegionId)
  if target.is_empty():
   var index=statics.region_for_shape(c.targetRid,c.targetShapeIndex)
   if index>=0: target=model.region(index).id
  if target.is_empty() or target==c.sourceRegionId: continue
  var key=c.sourceGroupId+":"+target
  touching[key]=true
  if not strongest.has(key) or strongest[key].contact.preContactClosingSpeed<c.preContactClosingSpeed:
   strongest[key]={"contact":c,"target":target}
 for key in strongest:
  var c=strongest[key].contact
  var target=strongest[key].target
  if episodes.has(key): continue
  episodes[key]=true
  if c.preContactClosingSpeed<2.5: continue
  serial+=1
  var damage=minf(100,.0125*minf(128,masses.get(c.sourceGroupId,1))*c.preContactClosingSpeed*c.preContactClosingSpeed)
  var before=model.region(target).hp
  var tx=model.apply_impact({"id":"native-impact-%d"%serial,"epoch":1,"targetRegionIds":[target],"damage":damage,"rootShotId":c.rootShotId})
  if tx.accepted:
   transactions.append(tx)
   var lost=before-model.region(target).hp
   if lost>0: impacts.append({"event_id":c.eventId,"source_group":c.sourceGroupId,"source_region":c.sourceRegionId,"root_shot":c.rootShotId,"contact_point":str(c.position),"target":target,"hp_before":before,"hp_after":model.region(target).hp,"research_delta":tx.researchDelta,"hp_lost":lost,"speed":c.preContactClosingSpeed,"tick":tick,"engine_physics_frame":c.physicsFrame})
 for key in episodes.keys():
  if not touching.has(key): episodes.erase(key)
 if not transactions.is_empty(): _commit(transactions)
