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
 assert.ok(result.researchEarned>0); assert.equal(w.getSnapshot().research,result.researchEarned);
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
test('full building damage earns only base research; reset preserves progression and rejects old epochs',()=>{
 const w=createWorld(); const old=w.epoch; let earned=0;
 for(const v of [...w.getVoxels()]) earned+=hit(w,`clear-${v.id}`,v.position,'shock',3).researchEarned;
 const s=w.getSnapshot(); assert.equal(s.destroyedCount,s.totalCount); assert.equal(s.firstRewardClaimed,false); assert.equal(earned,200);
 w.reset(); assert.ok(w.epoch>old); assert.equal(w.getSnapshot().research,earned); assert.equal(w.getSnapshot().destroyedCount,0); assert.equal(w.getSnapshot().firstRewardClaimed,false);
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
test('repeat attempts earn building research without milestone bonuses',()=>{
 const w=createWorld(); const clear=(prefix:string)=>{for(const v of [...w.getVoxels()])hit(w,`${prefix}-${v.id}`,v.position,'shock',3);};
 clear('first');w.reset();clear('second');assert.equal(w.getSnapshot().research,400);
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
 assert.equal((s as any).schemaVersion,6);assert.equal(createWorld().restore(s),true);
 assert.equal(w.restore({...s,schemaVersion:99} as any),false);
});
test('legacy cottage saves migrate explicitly, preserving damage and RP while adding intact yard',()=>{
 const w=createWorld();const house=w.getVoxels().filter(v=>v.group==='house');
 const legacyVoxels=house.map(({group,objectId,...v})=>v);
 const legacy={epoch:9,totalCount:1096,destroyedCount:0,research:37,firstRewardClaimed:false,voxels:legacyVoxels};
 assert.equal(w.restore(legacy),true);const migrated=w.getSnapshot();
 assert.equal(migrated.schemaVersion,6);assert.equal(migrated.research,37);assert.equal(migrated.destroyedCount,0);
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

test('objective is informative and yard destruction earns no research',()=>{
 const w=createWorld();const before=w.getObjective();assert.equal(before.total,1096);assert.equal(before.goal,1);assert.equal(before.mapId,'courtyard');
 hit(w,'tree-only',{x:-16,y:2,z:6},'pulse');
 assert.deepEqual(w.getObjective(),before);assert.equal(w.getSnapshot().research,0);assert.ok(w.getSnapshot().destroyedCount>0);
});
test('warehouse unlocks at 120 research without requiring a completed building',()=>{
 const w=createWorld();assert.equal(w.loadMap('warehouse'),false);
 const locked={...w.getSnapshot(),research:119}; assert.equal(w.restore(locked),true);assert.equal(w.loadMap('warehouse'),false);
 const unlocked={...w.getSnapshot(),research:120};assert.equal(w.restore(unlocked),true);assert.equal(w.getObjective().complete,false);
 const oldEpoch=w.epoch;assert.equal(w.loadMap('warehouse'),true);assert.ok(w.epoch>oldEpoch);assert.equal(w.getObjective().mapId,'warehouse');assert.equal(w.getObjective().fraction,0);assert.equal(w.getSnapshot().research,120);
 const warehouse=w.getSnapshot();assert.ok(warehouse.voxels.some(v=>v.objectId==='warehouse:left'));assert.ok(warehouse.voxels.some(v=>v.objectId==='warehouse:right'));
 const positions=new Set(warehouse.voxels.map(v=>`${v.position.x},${v.position.y},${v.position.z}`));assert.equal(positions.size,warehouse.voxels.length);
 assert.equal(createWorld().restore(warehouse),true);w.reset();assert.deepEqual(w.getSnapshot().voxels,warehouse.voxels);assert.equal(w.getSnapshot().research,120);
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
 assert.equal(w.getSnapshot().research,480);assert.equal(w.getSnapshot().schemaVersion,6);
});
test('v2 building-complete migration does not require old whole-yard milestone or mint a reward',()=>{
 const w=createWorld();for(const v of [...w.getVoxels()].filter(v=>v.group==='house')){hit(w,`partial-${v.id}`,v.position,'shock',3);if(w.getObjective().fraction>=.7)break;}
 const current=w.getSnapshot();assert.ok(current.destroyedCount/current.totalCount<.8);
 const oldResearch=Math.floor(current.destroyedCount*200/current.totalCount);
 const old={...current,schemaVersion:2 as const,mapId:undefined,completedMaps:undefined,research:oldResearch,firstRewardClaimed:false};
 const migrated=createWorld();assert.equal(migrated.restore(old),true);assert.equal(migrated.getSnapshot().research,oldResearch);assert.ok(migrated.getObjective().fraction>=.7);assert.equal(migrated.getObjective().complete,false);assert.deepEqual(migrated.getObjective().completedMaps,[]);
 assert.equal(hit(migrated,'miss-after-migration',{x:100,y:100,z:100}).researchEarned,0);assert.equal(createWorld().restore(migrated.getSnapshot()),true);
});
test('warehouse building damage has no completion bonus and map changes reject stale commands',()=>{
 const w=createWorld();w.loadMap('warehouse',true);const before=w.epoch;let initial=0;
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))initial+=hit(w,`warehouse-${v.id}`,v.position,'shock',3).researchEarned;
 assert.equal(initial,200);assert.deepEqual(w.getObjective().completedMaps,[]);
 w.reset();for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))hit(w,`repeat-${v.id}`,v.position,'shock',3);
 assert.equal(w.getSnapshot().research,400);w.loadMap('courtyard');assert.equal(w.damage({id:'late',epoch:before,target:{x:0,y:3,z:5},weapon:'shock',power:1}).accepted,false);
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


test('default grenade inventory permits six successful executions and exhaustion does not auto-settle',()=>{
 const w=createWorld();assert.deepEqual(w.getRound(),{budget:6,used:0,startResearch:0,startDestroyed:0,settled:false,loadout:{charge:6,pulse:0,shock:0,echo:0,split:0},remaining:{charge:6,pulse:0,shock:0,echo:0,split:0}});
 for(let i=0;i<6;i++)assert.equal(w.recordShot(),true);
 const exhausted=w.getSnapshot();assert.equal(w.recordShot(),false);assert.deepEqual(w.getSnapshot(),exhausted);
 assert.equal(w.getRound().used,6);assert.equal(w.getRound().settled,false);
 assert.equal(hit(w,'last-impact').accepted,true,'already launched ordnance can resolve after ammunition runs out');
});
test('partially damaged building cells earn research without requiring any destroyed cells',()=>{
 const w=createWorld();const result=hit(w,'gentle',{x:0,y:0,z:0},'charge',.01);
 assert.equal(result.accepted,true);assert.equal(result.newlyDestroyed,0);assert.equal(result.researchEarned,1);
 assert.equal(w.getObjective().fraction,0);assert.equal(w.getSnapshot().research,1);
 assert.ok(w.getVoxels().some(v=>v.group==='house'&&v.hp<v.maxHp));
 const again=hit(w,'gentle-again',{x:0,y:0,z:0},'charge',.01);
 assert.equal(again.researchEarned,0,'round cumulative damage upwards, not every hit');
});
test('settlement is explicit, idempotent, adds no research and rejects later execution or damage',()=>{
 const w=createWorld();w.recordShot();const impact=hit(w,'experiment');const before=w.getSnapshot();
 const result=w.finishRound();assert.deepEqual(result,{used:1,budget:6,destruction:w.getObjective().fraction,researchEarned:impact.researchEarned});
 assert.equal(w.getSnapshot().research,before.research);assert.equal(w.getRound().settled,true);
 result.researchEarned=999;assert.equal(w.finishRound().researchEarned,impact.researchEarned);
 const settled=w.getSnapshot();assert.equal(w.recordShot(),false);assert.equal(hit(w,'too-late').accepted,false);assert.deepEqual(w.getSnapshot(),settled);
});
test('schema 5 reload preserves spent ammo and settlement while retry and map change refill deliberately',()=>{
 const w=createWorld();w.recordShot();w.recordShot();hit(w,'before-save');
 const saved=w.getSnapshot();assert.equal(saved.schemaVersion,6);
 const restored=createWorld();assert.equal(restored.restore(saved),true);assert.equal(restored.getRound().used,2);
 assert.equal(restored.getRound().startResearch,0);assert.equal(restored.finishRound().researchEarned,saved.research);
 const settled=createWorld();assert.equal(settled.restore(restored.getSnapshot()),true);assert.equal(settled.recordShot(),false);
 const research=settled.getSnapshot().research;settled.reset();assert.equal(settled.getRound().used,0);assert.equal(settled.getRound().startResearch,research);assert.equal(settled.getRound().settled,false);
 assert.equal(settled.recordShot(),true);assert.equal(settled.loadMap('warehouse',true),true);assert.equal(settled.getRound().used,0);assert.equal(settled.getSnapshot().research,research);
});
test('snapshot and round readouts do not leak mutable ammunition state',()=>{
 const w=createWorld();const round=w.getRound();round.used=6;round.settled=true;
 const saved=w.getSnapshot();saved.round!.used=6;saved.round!.settled=true;
 assert.equal(w.recordShot(),true);assert.equal(w.getRound().used,1);assert.equal(w.getRound().settled,false);
});
test('malformed round state is rejected atomically rather than silently refilling ammunition',()=>{
 const w=createWorld();w.recordShot();const baseline=w.getSnapshot();
 for(const round of [undefined,null,{}, {...baseline.round,budget:7},{...baseline.round,used:-1},{...baseline.round,used:7},{...baseline.round,used:1.5},{...baseline.round,settled:'yes'},{...baseline.round,startResearch:-1},{...baseline.round,startResearch:1},{...baseline.round,startDestroyed:-1},{...baseline.round,startDestroyed:1},{...baseline.round,startDestroyed:Infinity}]){
  assert.equal(w.restore({...baseline,round} as any),false);assert.deepEqual(w.getSnapshot(),baseline);
 }
});
test('v3 migration preserves research, partial damage and completion history without adding new milestones',()=>{
 const source=createWorld();hit(source,'old-damage');const saved=source.getSnapshot();
 const old={...saved,schemaVersion:3 as const,round:undefined,research:95,completedMaps:['courtyard' as const],firstRewardClaimed:true};
 const w=createWorld();assert.equal(w.restore(old),true);assert.deepEqual(w.getVoxels(),saved.voxels);assert.equal(w.getSnapshot().research,95);
 assert.deepEqual(w.getObjective().completedMaps,['courtyard']);assert.equal(w.getRound().used,0);assert.equal(w.getRound().startResearch,95);
 assert.equal(w.loadMap('warehouse'),false,'legacy completion history does not bypass the current research lock');
 assert.equal(w.finishRound().researchEarned,0);assert.equal(createWorld().restore(w.getSnapshot()),true);
});
test('crossing the old 70 percent threshold neither awards a bonus nor settles the round',()=>{
 const w=createWorld();let crossed=false;
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house')){
  hit(w,`threshold-${v.id}`,v.position,'shock',3);
  if(w.getObjective().fraction>=.7){crossed=true;break;}
 }
 assert.equal(crossed,true);assert.ok(w.getObjective().fraction<1);assert.equal(w.getObjective().complete,false);
 assert.equal(w.getRound().settled,false);assert.deepEqual(w.getObjective().completedMaps,[]);assert.equal(w.getSnapshot().firstRewardClaimed,false);assert.ok(w.getSnapshot().research<=200);
 assert.equal(createWorld().restore(w.getSnapshot()),true,'new saves above the historical threshold need no completion marker');
});

test('free damage changes the building but never earns research or unlocks the next map',()=>{
 const w=createWorld();const target={x:0,y:0,z:0};
 const free=w.damage({id:'free-damage',epoch:w.epoch,target,weapon:'charge',power:.01,reward:false});
 assert.equal(free.accepted,true);assert.equal(free.researchEarned,0);assert.equal(w.getSnapshot().research,0);
 assert.ok(w.getVoxels().some(v=>v.group==='house'&&v.hp<v.maxHp));
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house'))w.damage({id:`free-clear-${v.id}`,epoch:w.epoch,target:v.position,weapon:'shock',power:3,reward:false});
 assert.equal(w.getObjective().fraction,1);assert.equal(w.getSnapshot().research,0);assert.equal(w.loadMap('warehouse'),false);assert.equal(createWorld().restore(w.getSnapshot()),true);
});

// A wrong cost, a refill, or cross-type spending must fail these real-world tests.
test('main round starts with a copied mixed loadout and consumes weighted per-type ammunition',()=>{
 const w=createWorld();assert.equal(typeof w.startRound,'function');
 assert.equal(w.restore({...w.getSnapshot(),research:90}),true);
 const loadout={charge:2,pulse:1,shock:1,echo:0,split:0};const before=w.epoch;
 assert.equal(w.startRound('courtyard',loadout),true);assert.ok(w.epoch>before);assert.equal(w.getSnapshot().research,90);
 loadout.charge=0;
 assert.deepEqual(w.getRound(),{budget:6,used:0,startResearch:90,startDestroyed:0,settled:false,loadout:{charge:2,pulse:1,shock:1,echo:0,split:0},remaining:{charge:2,pulse:1,shock:1,echo:0,split:0}});
 assert.equal(w.recordShot('pulse'),true);assert.equal(w.getRound().used,2);
 const pulseSpent=w.getSnapshot();assert.equal(w.recordShot('pulse'),false);assert.deepEqual(w.getSnapshot(),pulseSpent);
 assert.equal(w.recordShot('charge'),true);assert.equal(w.recordShot(),true);assert.equal(w.getRound().used,4);
 assert.equal(w.recordShot('shock'),true);assert.equal(w.getRound().used,6);
 assert.deepEqual(w.getRound().remaining,{charge:0,pulse:0,shock:0,echo:0,split:0});assert.equal(w.getRound().settled,false);
 const exhausted=w.getSnapshot();for(const id of ['charge','pulse','shock'])assert.equal(w.recordShot(id as any),false);
 assert.deepEqual(w.getSnapshot(),exhausted);assert.equal(hit(w,'late-impact').accepted,true);
});
test('failed round setup is atomic for locked scenes, weapons, overcapacity and malformed inventories',()=>{
 const w=createWorld();assert.equal(typeof w.startRound,'function');w.recordShot();hit(w,'keep-existing-damage');
 const before=w.getSnapshot();
 for(const [map,loadout] of [
  ['warehouse',{charge:1,pulse:0,shock:0,echo:0,split:0}], ['bogus',{charge:1,pulse:0,shock:0,echo:0,split:0}],
  ['courtyard',{charge:0,pulse:1,shock:0,echo:0,split:0}], ['courtyard',{charge:0,pulse:0,shock:1,echo:0,split:0}],
  ['courtyard',{charge:7,pulse:0,shock:0,echo:0,split:0}], ['courtyard',{charge:-1,pulse:0,shock:0,echo:0,split:0}],
  ['courtyard',{charge:0,pulse:0,shock:0,echo:0,split:0}], ['courtyard',{charge:1.5,pulse:0,shock:0,echo:0,split:0}],
  ['courtyard',null]
 ] as const){assert.equal(w.startRound(map as any,loadout as any),false);assert.deepEqual(w.getSnapshot(),before);}
});
test('new main rounds rebuild their scene, preserve research and expand to eight capacity only at 120',()=>{
 const w=createWorld();assert.equal(typeof w.startRound,'function');assert.equal(w.restore({...w.getSnapshot(),research:119}),true);
 assert.equal(w.startRound('courtyard',{charge:6,pulse:0,shock:0,echo:0,split:0}),true);hit(w,'cross-120');
 assert.ok(w.getSnapshot().research>=120);assert.equal(w.getRound().budget,6);assert.equal(w.getRound().startResearch,119);
 const research=w.getSnapshot().research;const old=w.epoch;
 assert.equal(w.startRound('warehouse',{charge:4,pulse:1,shock:1,echo:0,split:0}),true);
 assert.ok(w.epoch>old);assert.equal(w.getObjective().mapId,'warehouse');assert.equal(w.getObjective().fraction,0);
 assert.equal(w.getRound().budget,8);assert.equal(w.getRound().used,0);assert.equal(w.getRound().startResearch,research);assert.equal(w.getSnapshot().research,research);
 assert.equal(w.damage({id:'stale',epoch:old,target:{x:0,y:3,z:5},weapon:'charge',power:1}).accepted,false);
});
test('research unlocked during a round never changes its selected inventory or start eligibility',()=>{
 const w=createWorld();assert.equal(typeof w.startRound,'function');assert.equal(w.startRound('courtyard',{charge:6,pulse:0,shock:0,echo:0,split:0}),true);
 for(const v of [...w.getVoxels()].filter(v=>v.group==='house')){hit(w,`unlock-${v.id}`,v.position,'shock',3);if(w.getSnapshot().research>=90)break;}
 assert.ok(w.getSnapshot().research>=90);assert.equal(w.getRound().startResearch,0);assert.equal(w.getRound().budget,6);
 assert.equal(w.recordShot('pulse'),false);assert.equal(w.recordShot('shock'),false);assert.equal(w.recordShot('bogus' as any),false);
 assert.deepEqual(w.getRound().remaining,{charge:6,pulse:0,shock:0,echo:0,split:0});
 assert.equal(w.startRound('courtyard',{charge:2,pulse:1,shock:1,echo:0,split:0}),true);assert.equal(w.recordShot('shock'),true);
});
test('schema 5 deep-owns every inventory boundary and reload never refills selected ammo',()=>{
 const w=createWorld();assert.equal(typeof w.startRound,'function');assert.equal(w.restore({...w.getSnapshot(),research:90}),true);
 assert.equal(w.startRound('courtyard',{charge:2,pulse:1,shock:1,echo:0,split:0}),true);assert.equal(w.recordShot('pulse'),true);
 const read=w.getRound();read.loadout!.shock=99;read.remaining!.shock=99;
 const snapshot=w.getSnapshot();assert.equal(snapshot.schemaVersion,6);const saved=structuredClone(snapshot);
 snapshot.round!.loadout!.charge=99;snapshot.round!.remaining!.charge=99;
 assert.deepEqual(w.getRound().remaining,{charge:2,pulse:0,shock:1,echo:0,split:0});
 const restored=createWorld();assert.equal(restored.restore(saved),true);saved.round!.loadout!.shock=0;saved.round!.remaining!.shock=0;
 assert.deepEqual(restored.getRound().remaining,{charge:2,pulse:0,shock:1,echo:0,split:0});assert.equal(restored.recordShot('pulse'),false);
 assert.equal(restored.recordShot('shock'),true);assert.equal(restored.getRound().used,4);
});
test('schema 5 rejects incoherent inventory, locked round allocation and unsupported capacity atomically',()=>{
 const w=createWorld();const baseline=w.getSnapshot();
 const mutations=[
  (s:any)=>s.round.loadout=undefined,(s:any)=>s.round.remaining=undefined,
  (s:any)=>s.round.loadout=null,(s:any)=>s.round.remaining=null,
  (s:any)=>s.round.loadout.charge=0,(s:any)=>s.round.loadout.charge=7,
  (s:any)=>s.round.remaining.charge=7,(s:any)=>s.round.remaining.charge=-1,
  (s:any)=>s.round.remaining.charge=1.5,(s:any)=>s.round.remaining.fake=0,
  (s:any)=>s.round.remaining.pulse=1,(s:any)=>s.round.used=1,
  (s:any)=>{s.round.loadout={charge:4,pulse:1,shock:0,echo:0,split:0};s.round.remaining={charge:4,pulse:1,shock:0,echo:0,split:0};s.research=100;},
  (s:any)=>s.round.budget=8,(s:any)=>s.round.budget=10,(s:any)=>s.round.budget=12
 ];
 for(const mutate of mutations){const bad=structuredClone(baseline);mutate(bad);assert.equal(w.restore(bad),false);assert.deepEqual(w.getSnapshot(),baseline);}
});
test('schema 4 migration preserves spent legacy capacity even after research has unlocked eight slots',()=>{
 const source=createWorld();const fresh=source.getSnapshot();
 for(const [research,used,settled] of [[0,2,false],[130,5,false],[130,6,true]] as const){
  const old={...fresh,schemaVersion:4 as const,research,round:{budget:6,used,startResearch:research,startDestroyed:0,settled}};
  const w=createWorld();assert.equal(w.restore(old),true);assert.equal(w.getSnapshot().research,research);
  assert.equal(w.getRound().budget,6);assert.equal(w.getRound().used,used);assert.equal(w.getRound().settled,settled);
  assert.deepEqual(w.getRound().loadout,{charge:6,pulse:0,shock:0,echo:0,split:0});assert.deepEqual(w.getRound().remaining,{charge:6-used,pulse:0,shock:0,echo:0,split:0});
  const reloaded=createWorld();assert.equal(reloaded.restore(w.getSnapshot()),true);assert.deepEqual(reloaded.getRound(),w.getRound());
  let count=0;while(reloaded.recordShot())count++;assert.equal(count,settled?0:6-used);
  if(research>=120){assert.equal(w.startRound('warehouse',{charge:8,pulse:0,shock:0,echo:0,split:0}),true);assert.equal(w.getRound().budget,8);}
 }
});

test('schema 5 migration validates exact old keys before zero-extending without refill',()=>{
 const base=createWorld().getSnapshot();
 for(const budget of [6,8])for(const settled of [false,true]){
  const legacy:any={...base,schemaVersion:5,research:500,round:{budget,used:2,startResearch:500,startDestroyed:0,settled,loadout:{charge:2,pulse:1,shock:0},remaining:{charge:2,pulse:0,shock:0}}};
  const w=createWorld();assert.equal(w.restore(legacy),true);
  assert.equal(w.getSnapshot().schemaVersion,6);
  assert.deepEqual(w.getRound(),{...legacy.round,loadout:{...legacy.round.loadout,echo:0,split:0},remaining:{...legacy.round.remaining,echo:0,split:0}});
  const reload=createWorld();assert.equal(reload.restore(w.getSnapshot()),true);assert.deepEqual(reload.getRound(),w.getRound());
  for(const field of ['loadout','remaining'])for(const change of ['extra','missing','new']){
   const bad=structuredClone(legacy);if(change==='missing')delete bad.round[field].shock;else bad.round[field][change==='new'?'echo':'extra']=0;
   assert.equal(createWorld().restore(bad),false);
  }
 }
});
test('new maps use supported building groups and unlock only at catalog gates',()=>{
 const w=createWorld();
 for(const [map,gate] of [['bridge',240],['tower',420]] as const){
  assert.equal(w.restore({...w.getSnapshot(),research:gate-1}),true);assert.equal(w.loadMap(map),false);
  assert.equal(w.restore({...w.getSnapshot(),research:gate}),true);assert.equal(w.loadMap(map),true);
  assert.ok(w.getObjective().total>0);assert.match(w.getObjective().title,map==='bridge'?/连廊/:/塔楼/);
  assert.equal(createWorld().restore(w.getSnapshot()),true,'all baseline cells must be supported');
 }
});

test('new tools consume their three-slot allocation once and reload conserves remaining inventory',()=>{
 const w=createWorld();assert.equal(w.restore({...w.getSnapshot(),research:420}),true);
 const loadout={charge:1,pulse:0,shock:0,echo:1,split:2};
 assert.equal(w.startRound('tower',loadout),true);assert.equal(w.getRound().budget,10);
 assert.equal(w.recordShot('echo'),true);assert.equal(w.getRound().used,3);assert.equal(w.recordShot('echo'),false);
 assert.equal(w.recordShot('split'),true);assert.equal(w.getRound().used,6);
 const saved=w.getSnapshot(),restored=createWorld();assert.equal(restored.restore(saved),true);
 assert.deepEqual(restored.getRound().remaining,{charge:1,pulse:0,shock:0,echo:0,split:1});
 for(const mutate of [(s:any)=>delete s.round.remaining.echo,(s:any)=>s.round.loadout.other=0,(s:any)=>s.round.remaining.split=2,(s:any)=>s.round.used=5,(s:any)=>s.round.budget=12]){
  const bad=structuredClone(saved);mutate(bad);assert.equal(restored.restore(bad),false);assert.deepEqual(restored.getRound(),w.getRound());
 }
});
test('crossing 420 during a round freezes capacity and never silently allocates new tools',()=>{
 const w=createWorld();assert.equal(w.restore({...w.getSnapshot(),research:419}),true);
 const selected={charge:2,pulse:0,shock:0,echo:2,split:0};
 assert.equal(w.startRound('bridge',selected),true);assert.equal(w.recordShot('echo'),true);
 w.damage({id:'cross-tier',epoch:w.epoch,weapon:'echo',power:1,target:{x:-7,y:2,z:0}});
 assert.ok(w.getSnapshot().research>=420);assert.equal(w.getRound().budget,8);assert.equal(w.recordShot('split'),false);
 const reloaded=createWorld();assert.equal(reloaded.restore(w.getSnapshot()),true);assert.equal(reloaded.getRound().budget,8);
 assert.equal(reloaded.startRound('tower',selected),true);assert.equal(reloaded.getRound().budget,10);assert.deepEqual(reloaded.getRound().remaining,selected);
});
