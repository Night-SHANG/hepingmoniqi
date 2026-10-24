extends SceneTree
func _initialize(): call_deferred('_run')
func _run():
 var session=load('res://scripts/native_city_session.gd').new()
 root.add_child(session)
 await session.start()
 if not session.is_ready or not session.has_method('startup_metrics'):
  print('STARTUP_TIMING_FAIL missing ready profile');session.release();session.queue_free();await process_frame;quit(1);return
 var profile=session.startup_metrics()
 var sum=0.0
 for stage in ['read_verify_decode','regional_model','voxel_prepare','collision_prepare','collision_install','terrain_attach','mesh_wait']:
  assert(profile.stages_ms.has(stage))
  assert(profile.stages_ms[stage]>=0.0)
  sum+=profile.stages_ms[stage]
 assert(abs(sum-profile.total_ms)<0.01)
 assert(profile.process_to_ready_ms>=profile.total_ms)
 var clone=session.startup_metrics();clone.stages_ms.clear()
 assert(session.startup_metrics().stages_ms.size()==7)
 print('STARTUP_TIMING_PASS ',JSON.stringify(profile))
 session.release();session.queue_free();await process_frame;quit()
