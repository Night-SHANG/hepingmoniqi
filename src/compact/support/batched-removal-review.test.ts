import assert from 'node:assert/strict';
import test from 'node:test';
import {createDenseFixture} from '../fixture.js';
import {CompactAuthorityStore} from '../store.js';
import {createSupportGraph} from '../../structural/support.js';
import type {Cell, Piece} from '../../structural/types.js';
import {CompactSupportLattice, prepareCompactSupport} from './index.js';
import {IndexedStructure} from './indexed-structure.js';
import {encodePristine} from './node-codec.js';

// Characterization only: batching must preserve canonical public pieces, not
// seed-chunk numbering. These graph tests do not establish physics equivalence.
const cell=(id:number,x:number,y=0,z=0,over:Partial<Cell>={}):Cell=>({
 id,objectId:'structure',role:'building',position:{x,y,z},material:'stone',
 color:1,hp:10,maxHp:10,...over,
});
const offsets=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
function oracle(cells:Cell[],removed:Set<number>):Piece[]{
 const occupied=new Map(cells.filter(c=>!removed.has(c.id)).map(c=>[`${c.position.x},${c.position.y},${c.position.z}`,c]));
 const seen=new Set<number>(),pieces:Piece[]=[];
 for(const start of occupied.values()){
  if(seen.has(start.id))continue;
  const part=[start];seen.add(start.id);
  for(let at=0;at<part.length;at++)for(const [dx,dy,dz] of offsets){
   const p=part[at].position,next=occupied.get(`${p.x+dx},${p.y+dy},${p.z+dz}`);
   if(next&&!seen.has(next.id)){seen.add(next.id);part.push(next);}
  }
  if(!part.some(c=>c.anchor)){const ids=part.map(c=>c.id).sort((a,b)=>a-b);pieces.push({id:`unsupported-${ids[0]}`,cells:ids});}
 }
 return pieces.sort((a,b)=>a.cells[0]-b.cells[0]);
}
async function graphs(cells:Cell[]){
 const fixture=createDenseFixture({id:'batching-characterization',cells}),store=new CompactAuthorityStore(fixture);
 const source=new CompactSupportLattice(fixture),encoded=encodePristine(source,new IndexedStructure(source),{mapId:fixture.id,seed:11,sourceChecksums:{fixture:'a'.repeat(64)}});
 const fresh=await prepareCompactSupport(store,{artifactBytes:encoded.bytes,expectation:encoded.manifest});
 return ()=>({eager:fresh(),batch:fresh(),sparseEager:createSupportGraph(cells),sparseBatch:createSupportGraph(cells)});
}

test('batched removal changes private seed chunk numbering but preserves ordered public pieces',async()=>{
 const cells=Array.from({length:6},(_,i)=>cell(10+2*i,i));
 const source=new CompactSupportLattice(createDenseFixture({id:'numbering-witness',cells}));
 const eager=new IndexedStructure(source),batch=new IndexedStructure(source);
 eager.leave([2]);eager.leave([4]);batch.leave([2,4]);
 assert.notDeepEqual([...eager.chunk],[...batch.chunk],'intermediate largest-part retention genuinely changes internal IDs');
 const pair=(await graphs(cells))();
 try{
  pair.eager.remove([14]);pair.eager.remove([18]);pair.batch.remove([14,18]);
  assert.deepEqual(pair.eager.unsupported(),[{id:'unsupported-10',cells:[10,12]},{id:'unsupported-16',cells:[16]},{id:'unsupported-20',cells:[20]}]);
  assert.deepEqual(pair.batch.unsupported(),pair.eager.unsupported());
 }finally{pair.eager.dispose();pair.batch.dispose();}
});

test('successive command batches preserve former-root cuts, detach departures and repeated dynamic deletion',async()=>{
 const cells=Array.from({length:6},(_,i)=>cell(10+2*i,i,0,0,{anchor:i===0})).reverse();
 const pair=(await graphs(cells))(),removed=new Set<number>();
 const apply=(ids:number[])=>{
  for(const id of ids){pair.eager.remove([id]);pair.sparseEager.remove([id]);removed.add(id);}
  pair.batch.remove(ids);pair.sparseBatch.remove(ids);
  const expected=oracle(cells,removed);
  for(const graph of Object.values(pair))assert.deepEqual(graph.unsupported(),expected);
 };
 try{
  apply([14,18]); // First command splits the original seed chunk twice.
  assert.deepEqual(pair.batch.unsupported().map(p=>p.cells),[[16],[20]]);
  apply([10]); // A later command removes the former anchor, releasing [12].
  assert.deepEqual(pair.batch.unsupported().map(p=>p.cells),[[12],[16],[20]]);
  const detached=pair.batch.unsupported().flatMap(p=>p.cells);apply(detached);
  const before=pair.batch.diagnostics();
  apply([16]); // Singleton dynamic source is now gone: no live support member.
  apply([16,16,999999]);
  assert.deepEqual(pair.batch.diagnostics(),before);
  assert.equal(before.liveMembers,0);
 }finally{pair.eager.dispose();pair.batch.dispose();}
});

test('every 3 by 3 removal mask has equal ordered pieces in forward and reverse death order',async()=>{
 const cells:Cell[]=[];
 for(let x=0;x<3;x++)for(let y=0;y<3;y++)cells.push(cell(40+3*cells.length,x,y,0,{anchor:x===0&&y===0}));
 const fresh=await graphs(cells);
 for(let mask=0;mask<1<<cells.length;mask++)for(const reverse of [false,true]){
  const pair=fresh(),ids=cells.filter((_,i)=>mask&(1<<i)).map(c=>c.id);if(reverse)ids.reverse();
  try{
   for(const id of ids){pair.eager.remove([id]);pair.sparseEager.remove([id]);}
   pair.batch.remove(ids);pair.sparseBatch.remove(ids);
   const expected=oracle(cells,new Set(ids));
   for(const graph of Object.values(pair))assert.deepEqual(graph.unsupported(),expected,`mask ${mask}; reverse ${reverse}`);
  }finally{pair.eager.dispose();pair.batch.dispose();}
 }
});

test('mixed material and object faces retain support across repeated multi-cell command cuts',async()=>{
 const cells:Cell[]=[];
 for(let x=-7;x<=7;x++)for(let y=0;y<3;y++)for(let z=-1;z<=1;z++)cells.push(cell(-900+3*cells.length,x,y,z,{
  objectId:x<0?'left':'right',material:(x+y+z)%4===0?'wood':'stone',anchor:x===-7&&y===0,
 }));
 cells.reverse();const pair=(await graphs(cells))(),removed=new Set<number>();
 try{
  for(const x of [0,-4,4,-7,6,-2]){
   const ids=cells.filter(c=>c.position.x===x).map(c=>c.id);ids.push(ids[0],999999);
   for(const id of ids){pair.eager.remove([id]);pair.sparseEager.remove([id]);removed.add(id);}
   pair.batch.remove(ids);pair.sparseBatch.remove(ids);
   const expected=oracle(cells,removed);
   for(const graph of Object.values(pair))assert.deepEqual(graph.unsupported(),expected,`cut plane ${x}`);
  }
 }finally{pair.eager.dispose();pair.batch.dispose();}
});
