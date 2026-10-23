import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from './domain.js';
import {createProjectilePhysics} from './physics.js';
import {createExperimentFlow} from './experiment-flow.js';
import {capacityForResearch,toolAvailable,mapAvailable} from './gameplay.js';
import type {WorldSnapshot,ProjectilePhysics,Detonation,Loadout} from './contracts.js';
const advance=(p:ProjectilePhysics,s:number)=>{const events:Detonation[]=[];for(let i=0;i<Math.round(s*120);i++)events.push(...p.step(1/120));return events;};
const empty:Loadout={charge:0,pulse:0,shock:0,echo:0,split:0};
function legacy(){const s=createWorld().getSnapshot();return {...s,schemaVersion:5,research:420,round:{budget:6,used:2,startResearch:90,startDestroyed:0,settled:false,loadout:{charge:2,pulse:1,shock:1},remaining:{charge:0,pulse:1,shock:1}}} as unknown as WorldSnapshot;}
test('expansion exact 240/420 gates and free shared tools versus four open maps',()=>{
 for(const [id,gate] of [['echo',240],['split',420]] as const){assert.equal(toolAvailable(id,gate-1,true),false);assert.equal(toolAvailable(id,gate,true),true);}
 for(const [id,gate] of [['bridge',240],['tower',420]] as const){assert.equal(mapAvailable(id,gate-1),false);assert.equal(mapAvailable(id,gate),true);assert.equal(mapAvailable(id,0,true),true);}
 assert.deepEqual([119,120,419,420].map(capacityForResearch),[6,8,8,10]);
});
test('schema5 migration preserves six-slot partial ammo and adds strictly zero new stock until next round',()=>{
 const w=createWorld();assert.equal(w.restore(legacy()),true);assert.equal(w.getRound().budget,6);assert.equal(w.getRound().used,2);assert.deepEqual(w.getRound().remaining,{charge:0,pulse:1,shock:1,echo:0,split:0});assert.equal(w.getSnapshot().schemaVersion,6);
 const saved=w.getSnapshot();assert.equal(w.restore(saved),true);assert.deepEqual(w.getRound(),saved.round);assert.equal(w.recordShot('split'),false);
 w.finishRound();assert.equal(w.startRound('tower',{...empty,echo:1,split:1,charge:4}),true);assert.equal(w.getRound().budget,10);assert.equal(w.recordShot('split'),true);assert.equal(w.recordShot('split'),false);assert.equal(w.getRound().used,3);assert.equal(w.getRound().remaining?.echo,1);
 for(const extra of [{echo:0},{split:0},{surprise:0}]){const invalid=legacy();Object.assign(invalid.round!.loadout!,extra);assert.equal(createWorld().restore(invalid),false);}
});
test('crossing 420 preserves eight-slot current round; next round receives ten and retry exact counts',()=>{
 const w=createWorld(),s=w.getSnapshot();s.research=419;assert.ok(w.restore(s));const loadout={...empty,charge:2,echo:2};assert.ok(w.startRound('bridge',loadout));
 for(let n=0;n<30&&w.getSnapshot().research<420;n++){const v=w.getVoxels().find(v=>v.group==='house');assert.ok(v);w.damage({id:`cross-${n}`,epoch:w.epoch,weapon:'echo',power:1,target:v.position});}
 assert.ok(w.getSnapshot().research>=420);assert.equal(w.getRound().budget,8);assert.equal(w.recordShot('split'),false);w.finishRound();assert.ok(w.startRound('bridge',loadout));assert.equal(w.getRound().budget,10);assert.deepEqual(w.getRound().remaining,loadout);
});
test('echo remote emits exactly three spaced real events and pending work prevents early settlement',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);assert.ok(p.attach({id:'echo',epoch:1,weapon:'echo',power:1,surface:{voxelId:null,position:{x:0,y:0,z:0},normal:{x:0,y:1,z:0}}}));assert.deepEqual(advance(p,4),[]);
 const flow=createExperimentFlow();flow.requestFinish();const events=p.detonateAttached();assert.equal(events.length,1);assert.ok(p.getPendingWorkCount!()>0);assert.equal(flow.shouldSettle(p.getPendingWorkCount!(),false),false);assert.deepEqual(advance(p,.6),[]);events.push(...advance(p,.1));assert.equal(events.length,2);assert.equal(flow.shouldSettle(p.getPendingWorkCount!(),false),false);events.push(...advance(p,.7));assert.equal(events.length,3);assert.equal(new Set(events.map(e=>e.id)).size,3);assert.ok(events[1].age-events[0].age>=.64);assert.ok(events[2].age-events[1].age>=.64);assert.equal(p.getPendingWorkCount!(),0);assert.equal(flow.shouldSettle(0,false),true);assert.deepEqual(advance(p,3),[]);
 }finally{p.dispose();}
});
test('split parent flies then three physical children move and time out with exactly three hits',async()=>{
 const p=await createProjectilePhysics();try{p.syncVoxels([],1);assert.ok(p.launch({id:'split',epoch:1,weapon:'split',power:1,origin:{x:0,y:14,z:0},target:{x:0,y:0,z:0}}));assert.deepEqual(advance(p,.2),[]);assert.equal(p.getProjectiles()[0].stage,'parent');assert.deepEqual(advance(p,.46),[]);const children=p.getProjectiles();assert.equal(children.length,3);assert.ok(children.every(v=>v.stage==='child'&&v.state==='flying'));assert.deepEqual(advance(p,.3),[]);assert.notDeepEqual(p.getProjectiles().map(v=>v.position),children.map(v=>v.position));const events=advance(p,2);assert.equal(events.length,3);assert.ok(events.every(e=>e.stage==='child'&&e.reason==='timer'));assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(advance(p,3),[]);
 }finally{p.dispose();}
});
test('explicit reset and equal-epoch mode switch flush pending echo and split work without late events',async()=>{
 const p=await createProjectilePhysics();try{for(const weapon of ['echo','split'] as const){p.syncVoxels([],1);assert.ok(p.attach({id:weapon,epoch:1,weapon,power:1,surface:{voxelId:null,position:{x:0,y:0,z:0},normal:{x:0,y:1,z:0}}}));p.detonateAttached();assert.ok(p.getPendingWorkCount!()>0);p.reset!();p.syncVoxels([],1);assert.equal(p.getPendingWorkCount!(),0);assert.deepEqual(advance(p,5),[]);assert.deepEqual(p.getProjectiles(),[]);}}finally{p.dispose();}
});
