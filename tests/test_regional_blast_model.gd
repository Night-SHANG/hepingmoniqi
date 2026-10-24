extends SceneTree


# Pinned from the independent old TypeScript authority, no physics steps.
const CITY_ORACLE_JSON = '''{"physicsWorlds":0,"shots":[{"command":{"id":"native-city-nova-1","epoch":1,"sequence":1,"position":{"x":-48,"y":3,"z":42.5},"radius":48,"damage":20,"impulse":12},"stats":{"epoch":1,"revision":1,"geometryRevision":1,"regionCount":18447,"staticRegions":17302,"dynamicRegions":12,"rubbleRegions":0,"goneRegions":1133,"aliveCells":435682,"maskRegions":0,"maskedCells":0,"research":13757.653712290596,"objectiveWeight":102256.79999997237,"pendingGroups":3,"lastSequence":1,"processedEvents":1,"lastSupportVisited":17302,"lastCandidateRegions":2797,"lastCandidateCells":0,"lastCandidateBoxes":3552},"killed_sha256":"3fbe82b896719f744a3966eb1f37380cd34e5d387b76494c268a26dfd7a19f94","removed_sha256":"a01cdc4c5ac97076b53fab23cce69f975149a61c5d410902a621d5d066e1c73c","killed_count":19231,"removed_count":19265,"changed_sha256":"80b5b958f26f2a26d40a42e02c63ee833e34ccd72b66160cfd568e1c39de2c3c","states_sha256":"ff3c0c04a6d29d40c05fa830e4bef03fea98778fc1ada010565ad28c5fb94dff","alive_sha256":"106542ecaab94f9a530b6c7744c8ca0a556adca37565ff69f7be01b44c2ae391","group_indices":[[1692,2392,2393],[1693,2394,2395,2396,2397,2398,2399,5000],[2102]],"group_centers":[{"x":-83,"y":14.5,"z":45},{"x":-22,"y":11.5,"z":17},{"x":-19.5,"y":20,"z":14.5}],"hp_sum":8929051.504490118,"hp_weighted_sum":107353364580.48578},{"command":{"id":"native-city-nova-2","epoch":1,"sequence":2,"position":{"x":49,"y":3,"z":41.5},"radius":48,"damage":20,"impulse":12},"stats":{"epoch":1,"revision":2,"geometryRevision":2,"regionCount":18447,"staticRegions":15939,"dynamicRegions":48,"rubbleRegions":0,"goneRegions":2460,"aliveCells":413978,"maskRegions":0,"maskedCells":0,"research":32418.425054734078,"objectiveWeight":102256.79999997237,"pendingGroups":7,"lastSequence":2,"processedEvents":2,"lastSupportVisited":15939,"lastCandidateRegions":3035,"lastCandidateCells":0,"lastCandidateBoxes":4075},"killed_sha256":"112e11cf85670a16d5ddef49cff66274e872ed35d699eb2d78da222f9bf20d7b","removed_sha256":"d780cebd486a898ca962c36645e86119be251ac123863d396fae8e2b9c9e4d32","killed_count":21704,"removed_count":22115,"changed_sha256":"699cd4ee9f2159c581783c95f3f67f314505df959bc0991dadb4406a0cd40c93","states_sha256":"587681b91f8b5a30a73a2db8987197f16b5caf6d50bef4f6effe42232783157f","alive_sha256":"58c605037851ee8ab5cade2db7d169cf06cd3ddadb41a974c8fcb3e896066f73","group_indices":[[1694,2137,2138,2139,2140,2141,2142,2143,2144,2145,2147,2148,2149,2152,2157,2405,2406,2407,2408,4137,4141,4142,4169,4173,4203,4237],[1697],[2236],[2301,2302,2303,2304,2305,4620,4621,4622]],"group_centers":[{"x":21.143769968051117,"y":31.84664536741214,"z":20.057507987220447},{"x":77,"y":17,"z":27},{"x":81.4,"y":14.4,"z":15},{"x":81.56521739130434,"y":33.08695652173913,"z":45.5}],"hp_sum":8561444.457897007,"hp_weighted_sum":102120373440.44154},{"command":{"id":"native-city-nova-3","epoch":1,"sequence":3,"position":{"x":0,"y":3,"z":-42},"radius":48,"damage":20,"impulse":12},"stats":{"epoch":1,"revision":3,"geometryRevision":3,"regionCount":18447,"staticRegions":14632,"dynamicRegions":52,"rubbleRegions":0,"goneRegions":3763,"aliveCells":393236,"maskRegions":0,"maskedCells":0,"research":48521.71518540161,"objectiveWeight":102256.79999997237,"pendingGroups":10,"lastSequence":3,"processedEvents":3,"lastSupportVisited":14632,"lastCandidateRegions":2937,"lastCandidateCells":0,"lastCandidateBoxes":3835},"killed_sha256":"1c2e95195d6b202cd1cc0be59d08ccee2dd125ef513586550cebce7ede085671","removed_sha256":"3fefe452916b678c8ae273590fd229e73acd84095a704bfb71f3b2f840f8ff2d","killed_count":20742,"removed_count":20758,"changed_sha256":"fedd35a8dc03bf212255d7608ae6430e5c44ae34e98b49d055a6c1c38c44fead","states_sha256":"4251282e79697e232a5e769981a5a2469d7cb20e5af181604734ac0ec3103978","alive_sha256":"8519c360621cca40e68070c936df980dc376ea955eccf2303cc1bc0485b6c694","group_indices":[[8,10],[1684],[4864]],"group_centers":[{"x":0,"y":1.5,"z":-5},{"x":19,"y":35,"z":-50},{"x":28.666666666666668,"y":0,"z":-19.333333333333332}],"hp_sum":8196020.752274221,"hp_weighted_sum":97706793853.22559}]}'''

var failures: Array[String] = []
var Model: Script

func check(ok: bool, label: String) -> void:
 if not ok:
  failures.append(label)
  push_error(label)

func shot(id: String, seq: int, p: Vector3, radius: float, damage: float, epoch: int = 1) -> Dictionary:
 return {"id":id,"epoch":epoch,"sequence":seq,"position":p,"radius":radius,"damage":damage,"impulse":12.0}

# Small real packed fixtures: [position, initial HP, max HP, anchor]. Each group is a region.
func fixture(groups: Array, links: Array = []) -> Dictionary:
 var cells = PackedByteArray()
 var regions = PackedFloat64Array()
 var boxes = PackedFloat32Array()
 var members = PackedInt32Array()
 var contacts = PackedInt32Array()
 var pairs = PackedInt32Array()
 var ids: Array[String] = []
 for i in groups.size():
  var group: Array = groups[i]
  var offset = members.size()
  var hp = 0.0
  var maximum = 0.0
  var center = Vector3.ZERO
  var low = Vector3(INF,INF,INF)
  var high = Vector3(-INF,-INF,-INF)
  for cell in group:
   var ordinal = members.size()
   var p: Vector3 = cell[0]
   members.append(ordinal)
   cells.resize((ordinal+1)*35)
   var at = ordinal*35
   cells.encode_s32(at,ordinal+1)
   cells.encode_s16(at+4,int(p.x))
   cells.encode_s16(at+6,int(p.y))
   cells.encode_s16(at+8,int(p.z))
   cells.encode_u32(at+10,i)
   cells.encode_double(at+14,cell[1])
   cells.encode_double(at+22,cell[2])
   cells[at+34] = 1 | (2 if cell[3] else 0)
   hp += cell[1]
   maximum += cell[2]
   center += p
   low = low.min(p-Vector3.ONE*0.5)
   high = high.max(p+Vector3.ONE*0.5)
  center /= group.size()
  ids.append("r%d" % i)
  var box_start = boxes.size()/6
  # Unit boxes intentionally include initial zero-HP cells. The fine mask must exclude them.
  for cell in group:
   var p: Vector3 = cell[0]
   boxes.append_array(PackedFloat32Array([p.x,p.y,p.z,0.5,0.5,0.5]))
  regions.append_array(PackedFloat64Array([maximum,hp,maximum,center.x,center.y,center.z,low.x,high.x,low.y,high.y,low.z,high.z,0,box_start,group.size(),offset,group.size(),0,0,0,0,0,i,i]))
 for link in links:
  contacts.append_array(PackedInt32Array([int(cells.decode_u32(link[0]*35+10)),int(cells.decode_u32(link[1]*35+10)),pairs.size(),2]))
  pairs.append_array(PackedInt32Array(link))
 return {"metadata":{"schema":"godot-city-native-tables/v1","region_stride":24,"ids":ids},"regions":regions,"cells":cells,"members":members,"boxes":boxes,"contacts":contacts,"contact_pairs":pairs}

func test_fine_cut_support_reward_and_retries() -> void:
 var city = fixture([[[Vector3.ZERO,1.0,1.0,true]],[[Vector3(0,1,0),10.0,10.0,false]],[[Vector3(0,2,0),10.0,10.0,false]]],[[0,1],[1,2]])
 var m = Model.new(city)
 var tx = m.blast(shot("cut",1,Vector3.ZERO,0.2,20.0))
 check(tx.accepted,"fine cut accepted")
 check(tx.killedCellOrdinals == PackedInt32Array([0]),"fine cut kills only anchor")
 check(tx.removedStaticCellOrdinals == PackedInt32Array([0,1,2]),"all detached members leave static terrain")
 check(tx.detachedGroups.size() == 1 and tx.detachedGroups[0].regionIds == ["r1","r2"],"surviving contact component stays one group")
 check(abs(tx.researchDelta-1.0)<1e-10,"support detach does not award undamaged HP")
 check(m.cell_hp(1)==10.0 and not m.is_static_cell(1),"detached HP remains authoritative")
 check(m.stats().pendingGroups == 1,"detachment remains pending until acknowledged")
 var snapshot = m.stats()
 check(not m.blast(shot("cut",2,Vector3.ZERO,48.0,20.0)).accepted,"duplicate shot rejected")
 check(not m.blast(shot("badseq",3,Vector3.ZERO,48.0,20.0)).accepted,"sequence gap rejected")
 check(not m.blast(shot("stale",2,Vector3.ZERO,48.0,20.0,0)).accepted,"stale epoch rejected")
 check(not m.blast(shot("invalid",2,Vector3.ZERO,-1.0,20.0)).accepted,"negative radius rejected")
 check(m.stats()==snapshot,"invalid commands change no counters, reward, or membership")
 tx = m.blast(shot("finish",2,Vector3.ZERO,48.0,20.0))
 check(tx.killedCellOrdinals == PackedInt32Array([1,2]),"large blast still damages detached authority members")
 check(tx.removedStaticCellOrdinals.is_empty(),"already detached members are not removed from static terrain twice")
 check(abs(tx.researchDelta-20.0)<1e-10 and m.stats().research==21.0,"reward awarded exactly once per HP loss")
 m.reset()
 check(m.stats().epoch==2 and m.stats().research==0.0 and m.is_static_cell(0),"reset advances epoch and restores inventory")
 check(not m.blast(shot("old",1,Vector3.ZERO,48.0,20.0)).accepted,"pre-reset events stay stale")
 check(m.blast(shot("cut",1,Vector3.ZERO,0.2,20.0,2)).accepted,"new epoch may reuse prior ID")

func test_masked_occupancy_and_contact_pairs() -> void:
 var city = fixture([[[Vector3(-1,0,0),5.0,5.0,true],[Vector3.ZERO,0.0,5.0,false],[Vector3(1,0,0),5.0,5.0,false]],[[Vector3(2,0,0),10.0,10.0,false]]],[[2,3]])
 var m = Model.new(city)
 check(m.cell_hp(1)==0.0 and m.stats().aliveCells==3,"nonuniform initial HP remains a fine mask")
 var tx = m.blast(shot("cut-contact",1,Vector3(1,0,0),0.0,5.0))
 check(tx.killedCellOrdinals==PackedInt32Array([2]),"radius zero only damages exact occupied center")
 check(tx.removedStaticCellOrdinals==PackedInt32Array([2,3]),"dead exact contact pair detaches neighbor, not anchored lobe")
 check(m.is_static_cell(0),"regional surviving lobe stays supported by surviving anchor")
 tx = m.blast(shot("large-after-mask",2,Vector3(10,0,0),9.5,1.0))
 check(m.cell_hp(0)==5.0,"large attack cannot hit removed positive-side box through stale occupancy")
 check(tx.accepted,"masked large attack accepted")

func sha_ordinals(values: PackedInt32Array) -> String:
 var hash_ctx = HashingContext.new()
 hash_ctx.start(HashingContext.HASH_SHA256)
 hash_ctx.update(values.to_byte_array())
 return hash_ctx.finish().hex_encode()

func test_city_oracle() -> void:
 var oracle_path = ""
 for arg in OS.get_cmdline_user_args():
  if arg.begins_with("--oracle="): oracle_path = arg.trim_prefix("--oracle=")
 var oracle = JSON.parse_string(CITY_ORACLE_JSON if oracle_path.is_empty() else FileAccess.get_file_as_string(oracle_path))
 check(oracle is Dictionary and oracle.get("physicsWorlds")==0,"independent oracle has no physics trajectory")
 if not oracle is Dictionary: return
 var city = load("res://scripts/native_city_loader.gd").new().read_native("res://data")
 var m = Model.new(city)
 for expected in oracle.shots:
  var c: Dictionary = expected.command.duplicate(true)
  c.position = Vector3(c.position.x,c.position.y,c.position.z)
  var started = Time.get_ticks_usec()
  var tx = m.blast(c)
  var elapsed = (Time.get_ticks_usec()-started)/1000.0
  check(tx.accepted,"city shot accepted")
  if expected.has("transaction"):
   check(tx.changedRegionIds == expected.transaction.changedRegionIds,"city changed IDs match old authority")
  else:
   check(sha_ordinals(tx.changedRegionIndices)==expected.changed_sha256,"city changed indices match pinned old authority")
  check(sha_ordinals(tx.killedCellOrdinals)==expected.killed_sha256,"city killed membership hash matches")
  check(sha_ordinals(tx.removedStaticCellOrdinals)==expected.removed_sha256,"city removed static membership hash matches")
  var maximum_hp_error = 0.0
  if expected.has("transaction"):
   check(tx.detachedGroups.size()==expected.transaction.detachedGroups.size(),"city detached group count matches")
   for j in mini(tx.detachedGroups.size(),expected.transaction.detachedGroups.size()):
    var got: Dictionary = tx.detachedGroups[j]
    var want: Dictionary = expected.transaction.detachedGroups[j]
    check(got.id==want.id and got.regionIds==want.regionIds and got.rootShotId==want.rootShotId,"city detached group identity and members match")
    for axis in ["x","y","z"]:
     check(abs(got.originalCenter[axis]-want.originalCenter[axis])<1e-10,"city group mass center matches")
   for i in expected.hp.size():
    var row: Dictionary = m.region(i)
    maximum_hp_error = maxf(maximum_hp_error,abs(row.hp-expected.hp[i]))
    check(row.state==expected.states[i] and row.aliveCellCount==expected.alive[i],"city regional membership matches at %d" % i)
   check(maximum_hp_error<1e-9,"all regional HP match old authority within 1e-9")
  else:
   check(tx.detachedGroups.size()==expected.group_indices.size(),"pinned detached group count matches")
   for j in mini(tx.detachedGroups.size(),expected.group_indices.size()):
    check(tx.detachedGroups[j].regionIndices==PackedInt32Array(expected.group_indices[j]),"pinned group component membership matches")
    for axis in ["x","y","z"]:
     check(abs(tx.detachedGroups[j].originalCenter[axis]-expected.group_centers[j][axis])<1e-10,"pinned group center matches")
   var states = PackedInt32Array()
   var alive = PackedInt32Array()
   var hp_sum = 0.0
   var hp_weighted_sum = 0.0
   for i in 18447:
    var row: Dictionary = m.region(i)
    states.append(["static","dynamic","rubble","gone"].find(row.state))
    alive.append(row.aliveCellCount)
    hp_sum += row.hp
    hp_weighted_sum += row.hp*(i+1)
   check(sha_ordinals(states)==expected.states_sha256 and sha_ordinals(alive)==expected.alive_sha256,"pinned all-region state and alive hashes match")
   check(abs(hp_sum-expected.hp_sum)<1e-7 and abs(hp_weighted_sum-expected.hp_weighted_sum)<1e-4,"pinned HP total and index-weighted checksum match")
  var s: Dictionary = m.stats()
  for key in ["staticRegions","dynamicRegions","goneRegions","aliveCells","pendingGroups","lastSequence","processedEvents","lastCandidateRegions","lastCandidateCells","lastCandidateBoxes","lastSupportVisited"]:
   check(s[key]==expected.stats[key],"city stats match: "+key)
  check(abs(s.research-expected.stats.research)<1e-7,"city research matches old authority")
  print("REGIONAL_CITY_ORACLE ",JSON.stringify({"shot":c.sequence,"pure_authority_ms":elapsed,"killed":tx.killedCellOrdinals.size(),"removed_static":tx.removedStaticCellOrdinals.size(),"groups":tx.detachedGroups.size(),"maximum_hp_error":maximum_hp_error if expected.has("hp") else null,"full_hp_array_compared":expected.has("hp"),"physics_steps":0}))

func test_dynamic_pose_and_impact_dedup() -> void:
 var city = fixture([[[Vector3.ZERO,1.0,1.0,true]],[[Vector3(1,0,0),10.0,10.0,false],[Vector3(2,0,0),10.0,10.0,false]]],[[0,1]])
 var m = Model.new(city)
 if not m.has_method("set_group_pose") or not m.has_method("apply_impact"):
  check(false,"MISSING_BEHAVIOR: dynamic group pose and deduplicated impacts")
  return
 var detached = m.blast(shot("cut",1,Vector3.ZERO,0.0,1.0)).detachedGroups[0]
 var pose = Transform3D(Basis(Vector3.UP,PI/2),Vector3(40,3,0))
 check(m.set_group_pose(detached.id,pose,true),"group sleeping pose accepted")
 check(m.region(1).state=="rubble","sleeping group has persistent rubble authority")
 var tx = m.blast(shot("old-position",2,Vector3(1,0,0),0.1,50.0))
 check(tx.researchDelta==0.0 and m.cell_hp(1)==10.0,"moved rubble cannot be hit at original position")
 # Original offset (-.5,0,0) rotates to (0,0,+.5) about group center.
 tx = m.blast(shot("rotated-cell",3,Vector3(40,3,0.5),0.1,3.0))
 check(abs(tx.researchDelta-3.0)<1e-5 and abs(m.cell_hp(1)-7.0)<1e-5,"local attack hits rotated current member center")
 tx = m.blast(shot("large-current-pose",4,Vector3(40,3,0.5),9.0,1.0))
 check(abs(tx.researchDelta-2.0)<1e-5,"regional attack inverse-transforms current rotated pose")
 var before: Dictionary = m.stats()
 var invalid = Transform3D(Basis.from_scale(Vector3(2,1,1)),Vector3.ZERO)
 check(not m.set_group_pose(detached.id,invalid,false),"scaled pose rejected without corrupting authority")
 check(not m.set_group_pose("unknown",pose,false),"unknown group pose rejected")
 check(m.stats()==before,"pose rejection changes no authority counters")
 var impact = {"id":"contact:1","epoch":1,"targetRegionIds":["r1","r1"],"damage":2.0,"rootShotId":"cut"}
 tx = m.apply_impact(impact)
 check(tx.accepted and abs(tx.researchDelta-4.0)<1e-5,"impact deduplicates target list before alive-count damage")
 before = m.stats()
 check(not m.apply_impact(impact).accepted,"repeated impact event awards no extra reward")
 check(not m.blast(shot("contact:1",5,Vector3.ZERO,48.0,20.0)).accepted,"blast and impact share event dedup ledger")
 check(not m.apply_impact({"id":"bad","epoch":1,"targetRegionIds":["missing"],"damage":1.0}).accepted,"unknown impact target rejects atomically")
 check(m.stats()==before,"rejected impacts preserve complete ledger")
 check(m.stats().lastSequence==4,"impacts do not consume shot sequence")
 check(m.acknowledge_detached_group(detached.id),"acknowledgment removes one pending group")
 check(not m.acknowledge_detached_group(detached.id),"group acknowledgment is idempotent")
 check(m.cell_hp(1)>0 and m.region(1).state=="rubble","acknowledgment never discards persistent rubble")

func test_active_boxes_preserve_holes() -> void:
 var city = fixture([[[Vector3.ZERO,10.0,10.0,true],[Vector3(1,0,0),10.0,10.0,false],[Vector3(2,0,0),10.0,10.0,false]]])
 var m = Model.new(city)
 if not m.has_method("active_boxes"):
  check(false,"MISSING_BEHAVIOR: exact active occupied boxes")
  return
 m.blast(shot("hole",1,Vector3(1,0,0),0.0,10.0))
 var boxes: PackedFloat32Array = m.active_boxes(0)
 check(boxes.size()==12,"hole separates occupied spans into two boxes")
 var covered: Array[int] = []
 for b in boxes.size()/6:
  var at = b*6
  for x in range(roundi(boxes[at]-boxes[at+3]+0.5),roundi(boxes[at]+boxes[at+3]-0.5)+1): covered.append(x)
 covered.sort()
 check(covered==[0,2],"active geometry covers exactly surviving lattice cells, never hole")
 boxes[0] = 999
 check(m.active_boxes(0)[0]!=999,"consumer cannot mutate cached active geometry")

func _initialize() -> void:
 if not ResourceLoader.exists("res://scripts/regional_blast_model.gd"):
  push_error("MISSING_BEHAVIOR: packed regional authority has not been implemented")
  quit(1)
  return
 Model = load("res://scripts/regional_blast_model.gd")
 test_fine_cut_support_reward_and_retries()
 test_masked_occupancy_and_contact_pairs()
 test_dynamic_pose_and_impact_dedup()
 test_active_boxes_preserve_holes()
 test_city_oracle()
 if failures.is_empty(): print("REGIONAL_BLAST_MODEL_PASS")
 quit(0 if failures.is_empty() else 1)
