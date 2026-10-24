import test from 'node:test';
import assert from 'node:assert/strict';
import {createDenseFixture} from './fixture.js';
import {CompactAuthorityStore} from './store.js';
import type {CompactCell} from './fixture.js';
import type {CompactCellState,CompactStoreEdit} from './store.js';

const OVERFLOW=17_000;
const cell=(id:number,x:number):CompactCell=>({id,objectId:'overflow-fixture',role:'building',position:{x,y:2,z:-3},material:'wood',color:0x996238,hp:10,maxHp:10});
const tiny=()=>createDenseFixture({id:'overflow-tiny',cells:[cell(30,0),cell(-4,1),cell(99,2),cell(7,3)]});

test('one over-capacity burst returns every edited cell in fixture order without a reset',()=>{
 const source=Array.from({length:OVERFLOW+2},(_,i)=>cell(i%2===0?100_000-i:-i-1,i));
 const store=new CompactAuthorityStore(createDenseFixture({id:'overflow-burst',cells:source}));
 store.writable(source[OVERFLOW].id); // Owned but unpublished is not a change.
 for(let i=OVERFLOW-1;i>=0;i--){
  const row=store.writable(source[i].id)!;row.hp=i%2===0?0:5;
  if(i%2===0)row.state='gone';
  row.position.y=100;store.markChanged(row.spec.id);
 }
 const changes=store.changesSince(0);
 assert.equal(changes.reset,false,'journal overflow must not invalidate a same-epoch cursor');
 assert.equal(changes.revision,OVERFLOW);
 assert.deepEqual(changes.ids,source.slice(0,OVERFLOW).map(c=>c.id));
 assert.deepEqual(changes.edits,source.slice(0,OVERFLOW).map((c,i)=>({id:c.id,revision:OVERFLOW-i,position:{x:i,y:2,z:-3},topologyChanged:i%2===0,appearanceChanged:true})));
});

test('pose overwrites preserve earlier topology and HP flags relative to each independent cursor',()=>{
 const store=new CompactAuthorityStore(tiny()),moving=store.writable(30)!;
 moving.hp=8;store.markChanged(30); // Revision 1: appearance only.
 moving.state='dynamic';store.markChanged(30); // Revision 2: topology and appearance.
 store.writable(-4)!.hp=5;store.markChanged(-4); // Revision 3: later poses must not hide this row.
 for(let i=0;i<OVERFLOW;i++){moving.position.x=i+10;store.markChanged(30);}
 const latest=OVERFLOW+3,position={x:0,y:2,z:-3};
 const first=store.changesSince(0);
 assert.deepEqual(first,{revision:latest,reset:false,ids:[30,-4],edits:[
  {id:30,revision:latest,position,topologyChanged:true,appearanceChanged:true},
  {id:-4,revision:3,position:{x:1,y:2,z:-3},topologyChanged:false,appearanceChanged:true},
 ]});
 assert.deepEqual(store.changesSince(1),first,'reading another cursor does not consume changes');
 assert.deepEqual(store.changesSince(2),{...first,edits:[{...first.edits[0],topologyChanged:false,appearanceChanged:false},first.edits[1]]});
 assert.deepEqual(store.changesSince(3),{revision:latest,reset:false,ids:[30],edits:[{id:30,revision:latest,position,topologyChanged:false,appearanceChanged:false}]});
 assert.deepEqual(store.changesSince(0),first,'the slow consumer remains independent after fast-consumer reads');
 assert.deepEqual(store.changesSince(latest),{revision:latest,reset:false,ids:[],edits:[]});
});

test('invalid, future and pre-reset cursors still reset while post-reset overflow stays sparse',()=>{
 const store=new CompactAuthorityStore(tiny());store.writable(30)!.hp=8;store.markChanged(30);
 const beforeReset=store.revision;store.reset();const epoch=store.revision;
 assert.deepEqual(store.changesSince(epoch),{revision:epoch,reset:false,ids:[],edits:[]});
 const row=store.writable(-4)!;row.state='dynamic';store.markChanged(-4);
 for(let i=0;i<OVERFLOW;i++){row.position.y+=1;store.markChanged(-4);}
 const latest=store.revision;
 for(const cursor of [undefined,-1,0,beforeReset,NaN,Infinity,-Infinity,.5,Number.MAX_SAFE_INTEGER+1,latest+1]){
  assert.deepEqual(store.changesSince(cursor),{revision:latest,reset:true,ids:[],edits:[]},`cursor ${cursor} is not in the current epoch`);
 }
 assert.deepEqual(store.changesSince(epoch),{revision:latest,reset:false,ids:[-4],edits:[{id:-4,revision:latest,position:{x:1,y:2,z:-3},topologyChanged:true,appearanceChanged:true}]});
 assert.deepEqual(store.changesSince(epoch+1),{revision:latest,reset:false,ids:[-4],edits:[{id:-4,revision:latest,position:{x:1,y:2,z:-3},topologyChanged:false,appearanceChanged:false}]});
});

test('overflow deltas exactly match a continuously drained journal oracle on a small fixture',()=>{
 const delayed=new CompactAuthorityStore(tiny()),oracle=new CompactAuthorityStore(tiny());
 const cursors=[0,2,8_000,16_800],expected=cursors.map(()=>new Map<number,CompactStoreEdit>());
 let oracleCursor=0;
 const change=(id:number,mutate:(row:CompactCellState)=>void)=>{
  for(const store of [delayed,oracle]){mutate(store.writable(id)!);store.markChanged(id);}
  const recent=oracle.changesSince(oracleCursor);assert.equal(recent.reset,false);oracleCursor=recent.revision;
  for(let i=0;i<cursors.length;i++)if(oracleCursor>cursors[i])for(const edit of recent.edits){
   const previous=expected[i].get(edit.id);
   expected[i].set(edit.id,{...edit,topologyChanged:edit.topologyChanged||previous?.topologyChanged===true,appearanceChanged:edit.appearanceChanged||previous?.appearanceChanged===true});
  }
 };
 change(-4,row=>{row.hp=8;});
 change(30,row=>{row.hp=7;row.state='dynamic';row.position.x=11;});
 change(99,row=>{row.hp=0;row.state='gone';});
 change(30,row=>{row.state='static';});
 delayed.writable(7);oracle.writable(7);
 for(let i=0;i<OVERFLOW;i++)change([30,-4,99][i%3],row=>{
  row.position.z+=.5;
  if(i===5_000){row.hp=2;row.state='rubble';}
  if(i===9_000||i===16_000)row.state='dynamic';
  if(i===12_000)row.hp=6;
 });
 for(let i=0;i<cursors.length;i++){
  const edits=[30,-4,99,7].flatMap(id=>expected[i].has(id)?[expected[i].get(id)!]:[]);
  assert.deepEqual(delayed.changesSince(cursors[i]),{revision:oracleCursor,reset:false,ids:edits.map(edit=>edit.id),edits},`cursor ${cursors[i]} must match incremental delivery exactly`);
 }
});

test('overflow recovery never enumerates pristine fixture inventory and unchanged reads stay idle',()=>{
 const fixture=tiny(),store=new CompactAuthorityStore(fixture),row=store.writable(30)!;
 row.state='dynamic';store.markChanged(30);store.writable(-4)!.hp=8;store.markChanged(-4);
 store.writable(99);
 for(let i=0;i<OVERFLOW;i++){row.position.x++;store.markChanged(30);}
 const forbidden=()=>{throw new Error('Overflow recovery must not enumerate fixture inventory or materialize pristine cells');};
 fixture.original=forbidden;fixture.idAtOrdinal=forbidden;fixture.diagnosticCells=forbidden;
 fixture.idsInBounds=forbidden;fixture.idsInSphere=forbidden;fixture.idsInChunk=forbidden;
 fixture.forEachChunk=forbidden;fixture.chunkKeys=forbidden;
 Object.defineProperty(fixture,'count',{get:forbidden});
 const ordinal=fixture.ordinal.bind(fixture);
 fixture.ordinal=id=>{assert.ok(id===30||id===-4,'only changed sparse rows need fixture lookups');return ordinal(id);};
 const first=store.changesSince(0);
 assert.equal(first.reset,false);assert.deepEqual(first.ids,[30,-4]);
 assert.equal(store.diagnostics().mutableStates,3,'the unmarked owned row and pristine row stay unpublished');
 first.edits[0].position.x=999;
 assert.deepEqual(store.changesSince(0).edits[0].position,{x:0,y:2,z:-3},'delta positions remain owned immutable-origin snapshots');
 fixture.ordinal=forbidden;fixture.originalPosition=forbidden;
 assert.deepEqual(store.changesSince(store.revision),{revision:store.revision,reset:false,ids:[],edits:[]});
});
