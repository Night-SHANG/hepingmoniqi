import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './domain.js';
import type { DamageCommand, WorldModel } from './contracts.js';

const hit = (world: WorldModel, id: string, target = { x: 0, y: 3, z: 5 }, weapon: DamageCommand['weapon'] = 'pulse', power = 1) => world.damage({ id, epoch: world.epoch, target, weapon, power });
test('cottage is deterministic, detailed, grounded and has diverse materials', () => {
 const a=createWorld(), b=createWorld();
 assert.deepEqual(a.getSnapshot(),b.getSnapshot());
 assert.ok(a.getVoxels().length>700);
 assert.equal(new Set(a.getVoxels().map(v=>v.material)).size,5);
 assert.ok(a.getVoxels().some(v=>v.anchored));
 assert.equal(new Set(a.getVoxels().map(v=>`${v.position.x},${v.position.y},${v.position.z}`)).size,a.getVoxels().length);
});
test('first pulse destroys targeted timber and earns research exactly once',()=>{
 const w=createWorld(); const target=w.getVoxels().find(v=>v.material==='wood'&&v.position.y===3)!.position;
 const result=hit(w,'one',target);
 assert.equal(result.accepted,true); assert.ok(result.removed.length>0); assert.ok(result.newlyDestroyed>0);
 assert.equal(result.researchEarned,Math.floor(result.newlyDestroyed*200/w.getSnapshot().totalCount));
 const before=w.getSnapshot(); assert.equal(hit(w,'one',target).accepted,false); assert.deepEqual(w.getSnapshot(),before);
});
test('invalid commands do not mutate state or consume valid command ids',()=>{
 const w=createWorld(), before=w.getSnapshot();
 for(const command of [ {id:'bad',epoch:w.epoch,target:{x:NaN,y:3,z:5},weapon:'pulse',power:1}, {id:'bad',epoch:w.epoch-1,target:{x:0,y:3,z:5},weapon:'pulse',power:1}, {id:'bad',epoch:w.epoch,target:{x:0,y:3,z:5},weapon:'fake',power:1}, {id:'bad',epoch:w.epoch,target:{x:0,y:3,z:5},weapon:'pulse',power:-1}]) assert.equal(w.damage(command as DamageCommand).accepted,false);
 assert.deepEqual(w.getSnapshot(),before); assert.equal(hit(w,'bad').accepted,true);
});
test('support loss detaches blocks, accounting counts each voxel once',()=>{
 const w=createWorld(); let detached=0;
 for(let x=-7;x<=7;x+=2) for(let z=-5;z<=5;z+=2){ const r=hit(w,`${x},${z}`,{x,y:1,z},'charge',3); detached+=r.detached.length; assert.equal(r.newlyDestroyed,r.removed.length+r.detached.length); }
 assert.ok(detached>0); const s=w.getSnapshot(); assert.equal(s.totalCount,s.voxels.length+s.destroyedCount);
});
test('80 percent milestone pays once; reset preserves progression and rejects old epochs',()=>{
 const w=createWorld(); const old=w.epoch; let earned=0;
 for(const v of [...w.getVoxels()]) earned+=hit(w,`clear-${v.id}`,v.position,'shock',3).researchEarned;
 const s=w.getSnapshot(); assert.equal(s.destroyedCount,s.totalCount); assert.equal(s.firstRewardClaimed,true); assert.equal(earned,280);
 w.reset(); assert.ok(w.epoch>old); assert.equal(w.getSnapshot().research,earned); assert.equal(w.getSnapshot().destroyedCount,0); assert.equal(w.getSnapshot().firstRewardClaimed,true);
 assert.equal(w.damage({id:'late',epoch:old,target:{x:0,y:3,z:5},weapon:'shock',power:3}).accepted,false);
});
test('snapshots and read views cannot mutate world; valid restore invalidates callbacks',()=>{
 const w=createWorld(); hit(w,'first'); const saved=w.getSnapshot(); const copy=JSON.parse(JSON.stringify(saved)); saved.voxels[0].hp=999; saved.voxels[0].position.x=999;
 assert.notDeepEqual(w.getSnapshot(),saved); const old=w.epoch; w.reset(); assert.equal(w.restore(copy),true); assert.ok(w.epoch>old); assert.equal(w.getSnapshot().research,copy.research); assert.deepEqual(w.getSnapshot().voxels,copy.voxels);
 const view=w.getVoxels() as any; try{view[0].hp=999;}catch{} assert.notEqual(w.getVoxels()[0].hp,999);
});
test('restore rejects malformed, fabricated, inconsistent and oversized saves atomically',()=>{
 const w=createWorld(), baseline=w.getSnapshot();
 const cases:any[]=[null,{}, {...baseline,research:-1},{...baseline,totalCount:2},{...baseline,destroyedCount:1},{...baseline,epoch:Infinity},{...baseline,firstRewardClaimed:'yes'}, {...baseline,voxels:[baseline.voxels[0],baseline.voxels[0]]}];
 for(const mutate of [(s:any)=>s.voxels[0].hp=Infinity,(s:any)=>s.voxels[0].position.x=1000,(s:any)=>s.voxels[0].anchored=false,(s:any)=>s.voxels[0].material='ice']){const s=structuredClone(baseline); mutate(s); cases.push(s);}
 for(const bad of cases){assert.equal(w.restore(bad),false);assert.deepEqual(w.getSnapshot(),baseline);}
});
test('untouched cottage is supported; a missed shot does not award research',()=>{
 const w=createWorld(); const miss=hit(w,'miss',{x:100,y:100,z:100}); assert.equal(miss.newlyDestroyed,0);assert.equal(miss.researchEarned,0);
 const v=w.getVoxels().find(v=>v.material==='wood'&&v.position.y===3)!;
 assert.equal(hit(w,'local',v.position).detached.length,0);
});
test('restore rejects unsupported floating fragments and impossible reward state',()=>{
 const w=createWorld(), before=w.getSnapshot();
 const roof=before.voxels.find(v=>v.material==='roof')!;
 assert.equal(w.restore({...before,voxels:[roof],destroyedCount:before.totalCount-1,research:280,firstRewardClaimed:true}),false);
 assert.equal(w.restore({...before,research:0,firstRewardClaimed:true}),false);
 assert.deepEqual(w.getSnapshot(),before);
});
test('second clear awards base research without repeating the first milestone',()=>{
 const w=createWorld(); const clear=(prefix:string)=>{for(const v of [...w.getVoxels()])hit(w,`${prefix}-${v.id}`,v.position,'shock',3);};
 clear('first');w.reset();clear('second');assert.equal(w.getSnapshot().research,480);
});
