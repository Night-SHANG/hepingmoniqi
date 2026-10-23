import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from './domain.js';
import type { DamageCommand, WorldModel } from './contracts.js';

const hit = (world: WorldModel, id: string, target = { x: 0, y: 3, z: 5 }, weapon: DamageCommand['weapon'] = 'pulse', power = 1) => world.damage({ id, epoch: world.epoch, target, weapon, power });
test('cottage is deterministic, detailed, grounded and has diverse materials', () => {
 const a=createWorld(), b=createWorld();
 assert.deepEqual(a.getSnapshot(),b.getSnapshot());
 assert.ok(a.getVoxels().length>700);
 assert.equal(new Set(a.getVoxels().map(v=>v.material)).size,6);
 assert.ok(a.getVoxels().some(v=>v.anchored));
 assert.equal(new Set(a.getVoxels().map(v=>`${v.position.x},${v.position.y},${v.position.z}`)).size,a.getVoxels().length);
});
test('first pulse destroys targeted timber and earns research exactly once',()=>{
 const w=createWorld(); const target=w.getVoxels().find(v=>v.material==='wood'&&v.position.y===3)!.position;
 const result=hit(w,'one',target);
 assert.equal(result.accepted,true); assert.ok(result.removed.length>0); assert.ok(result.newlyDestroyed>0);
 assert.equal(result.researchEarned,Math.floor([...result.removed,...result.detached].filter(v=>v.group==='house').length*200/w.getObjective().total));
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
test('70 percent building milestone pays once; reset preserves progression and rejects old epochs',()=>{
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
test('yard props have distinct authoritative ids and every interactive category is destructible',()=>{
 const w=createWorld(); const initial=w.getVoxels();
 assert.ok(initial.length>1600);assert.ok(initial.length<3500);
 for(const group of ['house','tree','fence','crate','table','planter','logs']) {
  const groupVoxels=initial.filter(v=>(v as any).group===group);assert.ok(groupVoxels.length>0,group);
  assert.ok(groupVoxels.some(v=>v.anchored),`${group} is grounded`);
  const target=groupVoxels.find(v=>v.material==='wood')??groupVoxels[0];
  const r=hit(w,`prop-${group}`,target.position,'pulse',1);
  assert.ok(r.removed.some(v=>v.id===target.id)||w.getVoxels().find(v=>v.id===target.id)!.hp<target.hp,`${group} takes damage`);
 }
 assert.ok(initial.filter(v=>(v as any).group==='house').every(v=>v.id<10000));
 assert.ok(initial.filter(v=>(v as any).group!=='house').every(v=>v.id>=10000));
});
test('cut tree trunk detaches crown without damaging distant cottage or other trees',()=>{
 const w=createWorld();const houseBefore=w.getVoxels().filter(v=>(v as any).group==='house');
 const r=hit(w,'cut-tree',{x:-16,y:2,z:6},'pulse',1);
 assert.ok(r.detached.some(v=>(v as any).group==='tree'&&v.position.y>=5));
 assert.deepEqual(w.getVoxels().filter(v=>(v as any).group==='house'),houseBefore);
 assert.ok(r.detached.every(v=>Math.abs(v.position.x+16)<=4&&Math.abs(v.position.z-6)<=4));
});
test('expanded save schema roundtrips with props and rejects unknown versions',()=>{
 const w=createWorld();hit(w,'yard',{x:13,y:1,z:4},'charge');const s=w.getSnapshot();
 assert.equal((s as any).schemaVersion,3);assert.equal(createWorld().restore(s),true);
 assert.equal(w.restore({...s,schemaVersion:99} as any),false);
});
test('legacy cottage saves migrate explicitly, preserving damage and RP while adding intact yard',()=>{
 const w=createWorld();const house=w.getVoxels().filter(v=>v.group==='house');
 const legacyVoxels=house.map(({group,objectId,...v})=>v);
 const legacy={epoch:9,totalCount:1096,destroyedCount:0,research:37,firstRewardClaimed:false,voxels:legacyVoxels};
 assert.equal(w.restore(legacy),true);const migrated=w.getSnapshot();
 assert.equal(migrated.schemaVersion,3);assert.equal(migrated.research,37);assert.equal(migrated.destroyedCount,0);
 assert.deepEqual(migrated.voxels.filter(v=>v.group==='house'),house);
 assert.ok(migrated.voxels.some(v=>v.group==='tree'));
 assert.equal(createWorld().restore(migrated),true);
 const allCleared={...legacy,voxels:[],destroyedCount:1096,research:280,firstRewardClaimed:true};
 assert.equal(w.restore(allCleared),true);assert.equal(w.getSnapshot().research,280);assert.equal(w.getSnapshot().destroyedCount,1096);
 assert.equal(w.getVoxels().some(v=>v.group==='house'),false);assert.equal(createWorld().restore(w.getSnapshot()),true);
 const before=w.getSnapshot();assert.equal(w.restore({...legacy,totalCount:1097}),false);assert.deepEqual(w.getSnapshot(),before);
});
test('prop support and group identity cannot be forged in saves; extra payload cells are rejected',()=>{
 const w=createWorld();const before=w.getSnapshot();
 for(const mutate of [(s:any)=>s.voxels.find((v:any)=>v.group==='tree').objectId='house',(s:any)=>s.voxels.find((v:any)=>v.group==='tree').group='house',(s:any)=>s.voxels.push(...s.voxels)]){
  const invalid=structuredClone(before);mutate(invalid);assert.equal(w.restore(invalid),false);assert.deepEqual(w.getSnapshot(),before);
 }
});

test('v3 objective counts only building and yard destruction earns no research',()=>{
 const w=createWorld();const before=w.getObjective();assert.equal(before.total,1096);assert.equal(before.goal,.7);assert.equal(before.mapId,'courtyard');
 hit(w,'tree-only',{x:-16,y:2,z:6},'pulse');
 assert.deepEqual(w.getObjective(),before);assert.equal(w.getSnapshot().research,0);assert.ok(w.getSnapshot().destroyedCount>0);
});
test('building completion unlocks warehouse without requiring yard cleanup and rewards once',()=>{
 const w=createWorld();assert.equal(w.loadMap('warehouse'),false);
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))hit(w,`house-${v.id}`,v.position,'shock',3);
 const objective=w.getObjective();assert.equal(objective.complete,true);assert.ok(w.getVoxels().some(v=>v.group!=='house'));assert.deepEqual(objective.completedMaps,['courtyard']);assert.equal(w.getSnapshot().research,280);
 const oldEpoch=w.epoch;assert.equal(w.loadMap('warehouse'),true);assert.ok(w.epoch>oldEpoch);assert.equal(w.getObjective().mapId,'warehouse');assert.equal(w.getObjective().fraction,0);assert.equal(w.getSnapshot().research,280);
 const warehouse=w.getSnapshot();assert.ok(warehouse.voxels.some(v=>v.objectId==='warehouse:left'));assert.ok(warehouse.voxels.some(v=>v.objectId==='warehouse:right'));
 const positions=new Set(warehouse.voxels.map(v=>`${v.position.x},${v.position.y},${v.position.z}`));assert.equal(positions.size,warehouse.voxels.length);
 assert.equal(createWorld().restore(warehouse),true);w.reset();assert.deepEqual(w.getSnapshot().voxels,warehouse.voxels);assert.equal(w.getSnapshot().research,280);
});
test('completed map records are deep-owned, validated and retained across map revisits',()=>{
 const w=createWorld();assert.equal(w.loadMap('warehouse',true),true);const before=w.getSnapshot();
 for(const completedMaps of [['bogus'],['courtyard','courtyard'],null]){assert.equal(w.restore({...before,completedMaps} as any),false);assert.deepEqual(w.getSnapshot(),before);}
 const objective=w.getObjective();objective.completedMaps.push('courtyard');assert.deepEqual(w.getObjective().completedMaps,[]);
 assert.equal(w.loadMap('courtyard'),true);assert.equal(w.loadMap('warehouse'),false);
});
test('v2 migration preserves earned research and cannot pay an already claimed milestone twice',()=>{
 const w=createWorld();const fresh=w.getSnapshot();const old={...fresh,schemaVersion:2 as const,mapId:undefined,completedMaps:undefined,research:280,firstRewardClaimed:true};
 assert.equal(w.restore(old),true);assert.deepEqual(w.getObjective().completedMaps,['courtyard']);assert.equal(w.getSnapshot().research,280);
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))hit(w,`clear-${v.id}`,v.position,'shock',3);
 assert.equal(w.getSnapshot().research,480);assert.equal(w.getSnapshot().schemaVersion,3);
});
test('v2 building-complete migration does not require old whole-yard milestone or mint a reward',()=>{
 const w=createWorld();for(const v of [...w.getVoxels()].filter(v=>v.group==='house')){hit(w,`partial-${v.id}`,v.position,'shock',3);if(w.getObjective().complete)break;}
 const current=w.getSnapshot();assert.ok(current.destroyedCount/current.totalCount<.8);
 const oldResearch=Math.floor(current.destroyedCount*200/current.totalCount);
 const old={...current,schemaVersion:2 as const,mapId:undefined,completedMaps:undefined,research:oldResearch,firstRewardClaimed:false};
 const migrated=createWorld();assert.equal(migrated.restore(old),true);assert.equal(migrated.getSnapshot().research,oldResearch);assert.equal(migrated.getObjective().complete,true);assert.deepEqual(migrated.getObjective().completedMaps,['courtyard']);
 assert.equal(hit(migrated,'miss-after-migration',{x:100,y:100,z:100}).researchEarned,0);assert.equal(createWorld().restore(migrated.getSnapshot()),true);
});
test('warehouse completion rewards its own milestone once and map changes reject stale commands',()=>{
 const w=createWorld();w.loadMap('warehouse',true);const before=w.epoch;let initial=0;
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))initial+=hit(w,`warehouse-${v.id}`,v.position,'shock',3).researchEarned;
 assert.equal(initial,280);assert.deepEqual(w.getObjective().completedMaps,['warehouse']);
 w.reset();for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))hit(w,`repeat-${v.id}`,v.position,'shock',3);
 assert.equal(w.getSnapshot().research,480);w.loadMap('courtyard');assert.equal(w.damage({id:'late',epoch:before,target:{x:0,y:3,z:5},weapon:'shock',power:1}).accepted,false);
 assert.equal(createWorld().restore(w.getSnapshot()),true);
});

test('unlocked rocket destroys more timber than grenade at the same intact wall target',()=>{
 const target={x:0,y:3,z:5}, grenadeWorld=createWorld(), rocketWorld=createWorld();
 assert.ok(grenadeWorld.getVoxels().some(v=>v.material==='wood'&&v.position.x===target.x&&v.position.y===target.y&&v.position.z===target.z));
 const grenade=hit(grenadeWorld,'grenade',target,'charge');
 const rocket=hit(rocketWorld,'rocket',target,'pulse');
 assert.ok(grenade.newlyDestroyed>0);
 assert.ok(rocket.newlyDestroyed>grenade.newlyDestroyed,`rocket ${rocket.newlyDestroyed} must exceed grenade ${grenade.newlyDestroyed}`);
});
