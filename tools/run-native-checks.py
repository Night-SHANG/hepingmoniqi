from pathlib import Path
import subprocess,json,time
root=Path(__file__).resolve().parent.parent
engine='/workspace/shared/godot-4.7.1/godot'
commands=[['node','--test','tools/export-format.test.mjs'],['python3','-m','unittest','discover','-s','tests/qa'],['python3','tests/qa-voxel/run_suite.py']]
for name in ['test_city_loader','test_native_tables','test_cell_payload_guard','test_native_table_guard','test_native_static_world','test_native_terrain_edits','test_regional_blast_model','test_native_rubble_world','test_native_city_session','test_native_slice_view','test_native_slice_lifecycle','test_prebuilt_voxel_blocks','test_native_startup_timing','test_native_startup_equivalence']:
 commands.append([engine,'--headless','--path',str(root),'--script',f'tests/{name}.gd'])
results=[]
for i,c in enumerate(commands):
 started=time.time();r=subprocess.run(c,cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=150)
 log=root/'probes/extension'/f'aggregate-{i:02d}.log';log.write_text(r.stdout)
 ok=r.returncode==0 and not ('SCRIPT ERROR:' in r.stdout or '\nERROR:' in r.stdout)
 results.append(dict(command=c,exit=r.returncode,passed=ok,seconds=round(time.time()-started,3),log=str(log.relative_to(root))))
 print('PASS' if ok else 'FAIL', ' '.join(c),flush=True)
 if not ok: print(r.stdout[-2500:],flush=True)
(root/'probes/extension/aggregate-results.json').write_text(json.dumps(results,indent=2)+'\n')
raise SystemExit(0 if all(x['passed'] for x in results) else 1)
