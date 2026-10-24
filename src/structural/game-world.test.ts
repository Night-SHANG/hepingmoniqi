import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld} from '../domain.js';
import type {Loadout} from '../contracts.js';
const stock=(charge=6):Loadout=>({charge,pulse:0,shock:0,echo:0,split:0,phase:0,heavy:0,nova:0});
const load=async()=>{const module=await import('./game-world.js').catch(()=>null);assert.ok(module?.createStructuralGameWorld,'formal lazy game adapter must exist');return module;};

test('lazy world has immutable cached preview and does not initialize physics',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 assert.equal(w.physicsHost,null);assert.equal(w.getResearch(),0);assert.strictEqual(w.getVoxels(),w.getVoxels());assert.ok(Object.isFrozen(w.getVoxels()));assert.ok(Object.isFrozen(w.getVoxels()[0]));assert.equal(w.getSnapshot().schemaVersion,9);assert.deepEqual(w.getSnapshot().voxels,[]);
});
test('round inventory is frozen at start, repeated damage is idempotent, settlement freezes damage and rewards',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{assert.ok(await w.startRound('courtyard',stock()));assert.ok(w.recordShot('charge'));assert.equal(w.getRound().remaining!.charge,5);
 const command={id:'wood',epoch:w.epoch,target:{x:7,y:3,z:0},weapon:'charge' as const,power:1};assert.ok(w.damage(command).accepted);assert.ok(w.getResearch()>0);const earned=w.getResearch();assert.ok(!w.damage(command).accepted);assert.equal(w.getResearch(),earned);
 for(let i=0;i<1800&&w.pending();i++)w.step(1/120);assert.equal(w.pending(),0);const result=w.finishRound(),before=w.getSnapshot();assert.equal(result.researchEarned,w.getResearch());assert.ok(!w.damage({...command,id:'late'}).accepted);w.step(1);assert.deepEqual(w.getSnapshot(),before);assert.deepEqual(w.finishRound(),result);
 }finally{w.suspend();}
});
test('strict legacy migration keeps exact spent inventory and does not silently refill',async()=>{
 const {createStructuralGameWorld}=await load(),old=createWorld();old.recordShot('charge');const save=old.getSnapshot(),w=createStructuralGameWorld();
 try{assert.ok(await w.restore(save));assert.equal(w.migrationPending,true);assert.deepEqual(w.getRound(),save.round);assert.equal(w.physicsHost,null);assert.ok(!w.recordShot('charge'));await w.activate();assert.equal(w.migrationPending,true);assert.deepEqual(w.getRound(),save.round);const bad=structuredClone(save);bad.voxels[0].position.x+=1;const prior=w.getSnapshot();assert.ok(!await w.restore(bad));assert.deepEqual(w.getSnapshot(),prior);assert.ok(await w.startRound('courtyard',stock(2)));assert.equal(w.migrationPending,false);assert.equal(w.getRound().remaining!.charge,2);
 }finally{w.suspend();}
});
test('compact active save restores persistent structural poses and inventory, rejects corrupted ledger atomically',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{await w.startRound('courtyard',stock());w.recordShot('charge');w.damage({id:'cut',epoch:w.epoch,target:{x:0,y:0,z:0},weapon:'shock',power:1});w.step(.2);const save=w.getSnapshot(),views=w.getVoxels(),round=w.getRound();assert.ok(JSON.stringify(save).length<1_000_000);assert.ok(!JSON.stringify(save).includes('fixtureSignature'));
 await w.reset();assert.equal(w.getRound().used,0);assert.ok(await w.restore(save));assert.deepEqual(w.getRound(),round);assert.deepEqual(w.getVoxels(),views);const baseline=w.getSnapshot();const bad=structuredClone(baseline);bad.research=-1;assert.equal(await w.restore(bad),false);assert.deepEqual(w.getSnapshot(),baseline);
 }finally{w.suspend();}
});
test('unrewarded damage and its secondary fallout cannot mint research',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{await w.startRound('courtyard',stock());w.damage({id:'unrewarded',epoch:w.epoch,target:{x:0,y:0,z:0},weapon:'shock',power:2,reward:false});for(let i=0;i<1200&&w.pending();i++)w.step(1/120);assert.equal(w.getResearch(),0);
 }finally{w.suspend();}
});

test('deep crater cuts cottage foundations, retains solid lower soil and real resting building rubble',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{await w.activate();const original=w.getVoxels(),foundationIds=original.filter(v=>v.role==='foundation').map(v=>v.id);const result=w.damage({id:'foundation-cut',epoch:w.epoch,target:{x:0,y:-1,z:0},weapon:'shock',power:3});
 assert.ok(result.detached.some(v=>v.group==='house'));assert.ok(foundationIds.every(id=>w.getVoxel(id)===null),'soil/foundation destruction must really release the house');
 for(let i=0;i<2400&&w.pending();i++)w.step(1/120);assert.equal(w.pending(),0);
 const debris=w.getVoxels().filter(v=>v.structuralState==='rubble'&&v.group==='house');assert.ok(debris.length>100,'surviving house cells remain physical rubble instead of falling out');assert.ok(debris.some(v=>v.position.y<0));
 const floor=w.getVoxels().find(v=>v.role==='terrain'&&v.position.x===0&&v.position.z===0&&v.position.y===-6);assert.ok(floor&&floor.hp>0&&floor.hp<floor.maxHp,'blast leaves a damaged, destructible crater floor');assert.ok(w.events().some(e=>e.kind==='impact'));
 }finally{w.suspend();}
});

test('repeated deep excavations remove all eight layers, not a hidden invulnerable bottom',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{await w.activate();const column=w.getVoxels().filter(v=>v.role==='terrain'&&v.position.x===20&&v.position.z===0);assert.equal(column.length,8);
 for(const [i,y] of [-1,-6,-6,-6].entries())assert.ok(w.damage({id:`dig-${i}`,epoch:w.epoch,target:{x:20,y,z:0},weapon:'shock',power:3}).accepted);
 assert.ok(column.every(c=>w.getVoxel(c.id)===null),'every finite depth layer can be destroyed');
 }finally{w.suspend();}
});

test('falling tower damages new lower targets once and preserves the additional research through restore',async()=>{
 const {createStructuralGameWorld}=await load(),old=createWorld().getSnapshot(),w=createStructuralGameWorld();old.research=900;
 try{await w.restore(old);await w.startRound('tower',{...stock(0),shock:2});const originalHouseIds=new Set(w.getVoxels().filter(v=>v.group==='house').map(v=>v.id));w.damage({id:'upper-cut',epoch:w.epoch,target:{x:0,y:10,z:0},weapon:'shock',power:1});const direct=w.getResearch();
 for(let i=0;i<2400&&w.pending();i++)w.step(1/120);assert.equal(w.pending(),0);assert.ok(w.getResearch()>direct,'secondary collisions must credit damage to lower supported targets');const earned=w.getResearch();assert.ok(w.events().some(e=>e.kind==='impact'&&e.targetId!==undefined&&originalHouseIds.has(e.targetId)));
 for(let i=0;i<120;i++)w.step(1/60);assert.equal(w.getResearch(),earned);const saved=w.getSnapshot();assert.ok(await w.restore(saved));for(let i=0;i<120;i++)w.step(1/60);assert.equal(w.getResearch(),earned);
 }finally{w.suspend();}
});

test('free selection keeps three unlocked types without the weighted ammunition cap',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld({free:true}),old=createWorld().getSnapshot();old.research=1400;
 try{await w.restore(old);const tools={...stock(0),heavy:1,nova:1,shock:1};assert.ok(await w.startRound('courtyard',tools));assert.ok(w.recordShot('nova'));assert.equal(w.getRound().remaining!.nova,1);const saved=w.getSnapshot();assert.ok(await w.restore(saved));assert.equal(w.getRound().used,0);assert.deepEqual(w.getRound().loadout,tools);
 }finally{w.suspend();}
});

test('incremental event cursors return immutable new events and reset across new epochs',async()=>{
 const {createStructuralGameWorld}=await load(),w=createStructuralGameWorld();
 try{await w.activate();assert.equal(typeof w.eventsSince,'function');const initial=w.eventsSince();w.damage({id:'event-cursor',epoch:w.epoch,target:{x:20,y:-1,z:0},weapon:'charge',power:1});const next=w.eventsSince(initial.cursor);assert.ok(next.events.some(e=>e.rootShotId==='event-cursor'));assert.ok(Object.isFrozen(next.events)&&Object.isFrozen(next.events[0])&&Object.isFrozen(next.events[0].position));assert.equal(w.eventsSince(next.cursor).events.length,0);w.suspend();assert.equal(w.eventsSince(next.cursor).events.length,0);await w.reset();assert.equal(w.eventsSince(next.cursor).reset,true);
 }finally{w.suspend();}
});
