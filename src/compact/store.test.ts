import test from 'node:test';
import assert from 'node:assert/strict';

const load=async()=>{const f=await import('./fixture.js').catch(()=>null),s=await import('./store.js').catch(()=>null);assert.ok(f?.createDenseFixture&&s?.CompactAuthorityStore,'compact authority storage must exist');return {...f,...s};};
const cells=()=>[{id:30,objectId:'a',role:'building' as const,position:{x:0,y:0,z:0},material:'glass' as const,color:1,hp:.6,maxHp:.6,objective:true,group:'house' as const},{id:-4,objectId:'b',role:'terrain' as const,position:{x:1,y:0,z:0},material:'soil' as const,color:2,hp:3.2,maxHp:3.2}];

test('read owns ephemeral values while writable is the sole sparse mutable state authority',async()=>{
 const {createDenseFixture,CompactAuthorityStore}=await load(),store=new CompactAuthorityStore(createDenseFixture({id:'tiny',cells:cells()}));
 const a=store.read(30)!;a.hp=0;a.position.x=99;a.spec.position.x=99;assert.equal(store.read(30)!.hp,.6);assert.equal(store.read(30)!.position.x,0);assert.equal(store.diagnostics().mutableStates,0);
 const writable=store.writable(30)!;assert.equal(store.writable(30),writable);assert.equal(store.aggregate().loss,0);assert.deepEqual(store.changedIds(),[]);
 writable.hp-=.1;writable.loss=.1;store.markChanged(30);assert.equal(store.read(30)!.hp,.5);assert.equal(store.aggregate().loss,.1);assert.equal(store.diagnostics().mutableStates,1);
 const owned=store.read(30)!;owned.position.x=123;assert.equal(writable.position.x,0);assert.deepEqual(store.changedIds(),[30]);
});

test('independent revision cursors retain topology changes across later HP and pose edits',async()=>{
 const {createDenseFixture,CompactAuthorityStore}=await load(),store=new CompactAuthorityStore(createDenseFixture({id:'tiny',cells:cells()}));
 const start=store.changesSince();assert.equal(start.reset,true);assert.deepEqual(start.ids,[]);
 const c=store.writable(30)!;c.hp=.4;c.loss=.2;store.markChanged(30);const partial=store.changesSince(start.revision);assert.equal(partial.edits[0].topologyChanged,false);assert.equal(partial.edits[0].appearanceChanged,true);
 c.state='dynamic';c.loss=.6;c.chunkId='piece-1';store.markChanged(30);const detached=store.changesSince(partial.revision);assert.equal(detached.edits[0].topologyChanged,true);
 c.position.x=12;store.markChanged(30);assert.equal(store.changesSince(partial.revision).edits[0].topologyChanged,true);assert.equal(store.changesSince(detached.revision).edits[0].topologyChanged,false);
 assert.equal(store.staticIdAt(0,0,0),null);assert.equal(store.fixture.idAt(0,0,0),30);assert.deepEqual(store.queryStaticSphere({x:0,y:0,z:0},2),[-4]);assert.deepEqual(store.departedStates().map(s=>s.spec.id),[30]);
 assert.equal(store.aggregate().loss,.6);assert.equal(store.aggregate().objectiveDeparted,1);store.markChanged(30);assert.equal(store.aggregate().loss,.6);
 const beforeReset=store.revision;store.reset();assert.equal(store.changesSince(beforeReset).reset,true);assert.deepEqual(store.changesSince(beforeReset).ids,[]);assert.equal(store.diagnostics().mutableStates,0);assert.equal(store.aggregate().loss,0);
});

test('large pristine terrain keeps zero mutable state and one edit retains only one authority record',async()=>{
 const {createCompactGameFixture,CompactAuthorityStore}=await load(),store=new CompactAuthorityStore(createCompactGameFixture('city'));
 assert.equal(store.fixture.count,454913);assert.equal(store.diagnostics().mutableStates,0);assert.equal(store.fixture.diagnostics().retainedCellObjects,0);
 const id=store.fixture.idAt(120,-1,100)!;const c=store.writable(id)!;c.hp=0;c.loss=c.spec.hp;c.state='gone';store.markChanged(id);
 assert.equal(store.diagnostics().mutableStates,1);assert.equal(store.diagnostics().poseRecords,0);assert.equal(store.staticIdAt(120,-1,100),null);assert.equal(store.hpOf(id),0);assert.equal(store.aggregate().loss,0);assert.equal(store.aggregate().gone,1);
 assert.deepEqual(store.staticNeighbors({x:120,y:-1,z:100}).length,5);
});

test('idle and recent revision reads stay bounded while older valid cursors recover sparse edits',async()=>{
 const {createDenseFixture,CompactAuthorityStore}=await load();const source=Array.from({length:1000},(_,i)=>({...cells()[0],id:i,position:{x:i,y:0,z:0}}));
 const fixture=createDenseFixture({id:'many-edits',cells:source}),store=new CompactAuthorityStore(fixture);let ordinalReads=0;const ordinal=fixture.ordinal.bind(fixture);fixture.ordinal=id=>{ordinalReads++;return ordinal(id);};
 for(let i=0;i<1000;i++){const c=store.writable(i)!;c.hp=.5;c.loss=.1;store.markChanged(i);}
 let cursor=store.revision;ordinalReads=0;assert.deepEqual(store.changesSince(cursor).ids,[]);assert.equal(ordinalReads,0,'idle cursors must not traverse edited history');
 const c=store.writable(2)!;c.hp=.4;c.loss=.2;store.markChanged(2);ordinalReads=0;assert.deepEqual(store.changesSince(cursor).ids,[2]);assert.ok(ordinalReads<5,'recent cursor should visit the recent journal only');
 cursor=store.revision;for(let i=0;i<16385;i++)store.markChanged(2);assert.equal(store.changesSince(cursor).reset,false);assert.deepEqual(store.changesSince(cursor).ids,[2]);
});

test('moving iterator borrows only moving records and drops destroyed or reset members',async()=>{
 const {createDenseFixture,CompactAuthorityStore}=await load(),store=new CompactAuthorityStore(createDenseFixture({id:'moving',cells:cells()}));
 assert.equal(typeof store.movingStates,'function');const c=store.writable(30)!;c.state='dynamic';c.loss=.6;c.chunkId='piece-1';store.markChanged(30);
 assert.deepEqual([...store.movingStates()],[c]);assert.equal([...store.movingStates()][0],c);
 c.state='rubble';store.markChanged(30);assert.equal([...store.movingStates()].length,1);
 c.hp=0;c.state='gone';delete c.chunkId;store.markChanged(30);assert.deepEqual([...store.movingStates()],[]);assert.equal(store.departedStates().length,1);
 store.reset();assert.deepEqual([...store.movingStates()],[]);
});
