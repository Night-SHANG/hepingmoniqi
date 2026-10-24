extends SceneTree
func _initialize():
 if not FileAccess.file_exists("res://scripts/native_city_session.gd"):
  push_error("Missing native interactive session")
  quit(1);return
 call_deferred("_run")
func _run():
 var session=load("res://scripts/native_city_session.gd").new()
 root.add_child(session)
 await session.start()
 assert(session.is_ready)
 var baseline=session.status()
 assert(session.place_charge(Vector3(-48,3,42.5)))
 for i in 3: await physics_frame
 assert(session.status().research==baseline.research and session.projectiles().size()==1)
 session.set_paused(true)
 var before=session.status().sim_time
 for i in 4: await process_frame
 assert(session.status().sim_time==before)
 session.set_paused(false)
 session.detonate_all()
 for i in 10:
  await physics_frame
  await process_frame
  if session.status().blast_count==1: break
 assert(session.status().blast_count==1 and session.status().research>baseline.research)
 assert(session.projectiles().is_empty())
 assert(session.launch_projectile(Vector3(49,60,41.5),Vector3(0,-30,0)))
 assert(session.status().blast_count==1 and session.projectiles().size()==1)
 for child in session.get_children():
  if child is RigidBody3D: assert(child.linear_damp_mode==RigidBody3D.DAMP_MODE_REPLACE and child.linear_damp==0.0)
 for i in 360:
  await physics_frame
  await process_frame
  if session.status().blast_count==2: break
 assert(session.status().blast_count==2 and session.projectiles().is_empty())
 assert(session.status().failures.is_empty())
 session.release()
 assert(not session.is_ready and session.status().owned_collision_rids==0)
 assert(not session.place_charge(Vector3.ZERO))
 session.queue_free();await process_frame
 print("NATIVE_CITY_SESSION_PASS ready manual-only placement pause real-projectile-contact damage release")
 quit()
