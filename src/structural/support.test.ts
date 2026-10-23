import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupportGraph, fractureCellIds } from './support.js';
import type { Cell, Piece, Point } from './types.js';

const cell = (id:number, x:number, y:number, z:number, options:Partial<Cell> = {}):Cell => ({
  id, objectId:'object', role:'building', position:{x,y,z}, material:'stone', color:0xffffff, hp:10, maxHp:10, ...options,
});
const normalized = (groups:readonly (readonly number[])[]):number[][] => groups.map(g=>[...g].sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);
const pieces = (list:Piece[]):number[][] => normalized(list.map(p=>p.cells));

// Independent cell-level flood fill, intentionally unaware of chunks/material seeds.
function reference(cells:readonly Cell[], removed:Set<number>):number[][] {
  const live = cells.filter(c=>!removed.has(c.id));
  const seen = new Set<number>();
  const groups:number[][] = [];
  for (const start of live) {
    if (seen.has(start.id)) continue;
    const queue = [start]; seen.add(start.id);
    for(let n=0;n<queue.length;n++) for(const candidate of live) {
      if(seen.has(candidate.id)) continue;
      const a=queue[n].position,b=candidate.position;
      if(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z)===1) {
        seen.add(candidate.id); queue.push(candidate);
      }
    }
    if(!queue.some(c=>c.anchor===true)) groups.push(queue.map(c=>c.id));
  }
  return normalized(groups);
}
function rng(seed:number):()=>number { let state=seed>>>0; return ()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32); }

test('removing terrain separates foundation and building despite their nominal base height',()=>{
  const graph=createSupportGraph([
    cell(1,0,-2,0,{role:'terrain',objectId:'soil',material:'soil',anchor:true}),
    cell(2,0,-1,0,{role:'terrain',objectId:'soil',material:'soil'}),
    cell(3,0,0,0,{role:'foundation',objectId:'footing'}),
    cell(4,0,1,0,{objectId:'house'}),
  ]);
  assert.deepEqual(graph.unsupported(),[]);
  graph.remove([2]);
  assert.deepEqual(pieces(graph.unsupported()),[[3,4]]);
});

test('bridge remains supported by either bank and disconnects after both supports leave',()=>{
  const graph=createSupportGraph([
    cell(10,-2,0,0,{objectId:'left',role:'terrain',anchor:true}),
    cell(20,-1,0,0,{objectId:'left',role:'terrain'}),
    cell(30,0,0,0,{objectId:'span',role:'bridge',material:'wood'}),
    cell(40,1,0,0,{objectId:'span',role:'bridge',material:'wood'}),
    cell(50,2,0,0,{objectId:'right',role:'terrain'}),
    cell(60,3,0,0,{objectId:'right',role:'terrain',anchor:true}),
  ]);
  graph.remove([20]); assert.deepEqual(graph.unsupported(),[]);
  graph.remove([50]); assert.deepEqual(pieces(graph.unsupported()),[[30,40]]);
});

test('cutting inside one same-material seed cell splits its formerly connected chunk',()=>{
  const graph=createSupportGraph(Array.from({length:5},(_,x)=>cell(x+1,x,2,0,{anchor:x===0})));
  graph.remove([3]);
  assert.deepEqual(pieces(graph.unsupported()),[[4,5]]);
  graph.remove([4,5]);
  assert.deepEqual(graph.unsupported(),[]);
});

test('global face connectivity crosses terrain, road, foundation, building, tree and bridge objects',()=>{
  const roles:Cell['role'][]=['terrain','road','foundation','building','tree','bridge'];
  const materials:Cell['material'][]=['soil','road','stone','glass','wood','metal'];
  const graph=createSupportGraph(roles.map((role,x)=>cell(x+1,x,-5,0,{role,material:materials[x],objectId:role,anchor:x===0})));
  assert.deepEqual(graph.unsupported(),[]);
  graph.remove([3]);
  assert.deepEqual(pieces(graph.unsupported()),[[4,5,6]]);
});

test('true gaps and diagonal contacts do not connect, and no y=0 or object-base anchor is implicit',()=>{
  const graph=createSupportGraph([
    cell(1,0,0,0,{anchor:true}), cell(2,2,0,0), cell(3,2,1,0),
    cell(4,1,1,1,{objectId:'diagonal'}), cell(5,-100,-50,200,{role:'foundation',objectId:'base'}),
  ]);
  assert.deepEqual(pieces(graph.unsupported()),[[2,3],[4],[5]]);
});

test('removing the last explicit root detaches every remaining connected cell',()=>{
  const graph=createSupportGraph([cell(101,0,0,0,{anchor:true}),cell(999,1,0,0),cell(-8,2,0,0)]);
  graph.remove([101,101,123456]);
  const detached=graph.unsupported();
  assert.deepEqual(pieces(detached),[[-8,999]]);
  assert.deepEqual(graph.unsupported(),detached,'querying does not silently remove unsupported cells');
  graph.remove([101]); assert.deepEqual(graph.unsupported(),detached,'repeated removal is idempotent');
  graph.remove(detached.flatMap(p=>p.cells)); assert.deepEqual(graph.unsupported(),[]);
});

test('batched removal decrements every shared face once even with duplicates and adjacent deletions',()=>{
  const cells:Cell[]=[];
  for(let x=0;x<6;x++)for(let y=0;y<3;y++) cells.push(cell(x*10+y,x,y,0,{objectId:x<3?'left':'right',anchor:x===0}));
  const graph=createSupportGraph(cells);
  graph.remove([20,21,20]); assert.deepEqual(graph.unsupported(),[]);
  graph.remove([22,30,31,32,31]);
  assert.deepEqual(pieces(graph.unsupported()),[[40,41,42,50,51,52]]);
});

test('construction and cuts preserve caller-owned cell data and output cannot mutate the graph',()=>{
  const cells=[cell(1,0,0,0,{anchor:true}),cell(2,1,0,0),cell(3,2,0,0)];
  const before=structuredClone(cells);
  cells.forEach(c=>{Object.freeze(c.position);Object.freeze(c);});Object.freeze(cells);
  const graph=createSupportGraph(cells); graph.remove([2]);
  const out=graph.unsupported();out[0].cells.push(123);out.length=0;
  assert.deepEqual(pieces(graph.unsupported()),[[3]]);
  assert.deepEqual(cells,before);
});

test('empty graph is valid and duplicate IDs, overlapping voxels and non-lattice coordinates are rejected',()=>{
  assert.deepEqual(createSupportGraph([]).unsupported(),[]);
  assert.throws(()=>createSupportGraph([cell(1,0,0,0),cell(1,1,0,0)]),/duplicate.*id/i);
  assert.throws(()=>createSupportGraph([cell(1,0,0,0),cell(2,0,0,0)]),/occup|overlap/i);
  assert.throws(()=>createSupportGraph([cell(1,0.5,0,0)]),/integer|lattice/i);
});

test('chunk graph matches independent flood fill through repeated random cuts and detached-piece removal',()=>{
  const materials:Cell['material'][]=['soil','stone','roof','wood','metal','glass','foliage','road'];
  for(let seed=1;seed<=18;seed++) {
    const random=rng(seed),cells:Cell[]=[];
    for(let x=-3;x<4;x++)for(let y=-2;y<4;y++)for(let z=-2;z<3;z++){
      if(random()<.19)continue;
      const id=cells.length*7+13;
      cells.push(cell(id,x,y,z,{objectId:seed%3===0?'monolith':`object-${Math.floor(random()*4)}`,material:seed%3===0?'stone':materials[Math.floor(random()*materials.length)],anchor:y===-2&&x===-3}));
    }
    const graph=createSupportGraph(cells), removed=new Set<number>();
    for(let cut=0;cut<28;cut++) {
      const ids=Array.from({length:1+Math.floor(random()*10)},()=>cells[Math.floor(random()*cells.length)].id);
      graph.remove([...ids,ids[0]]);ids.forEach(id=>removed.add(id));
      const actual=graph.unsupported();
      assert.deepEqual(pieces(actual),reference(cells,removed),`seed=${seed}, cut=${cut}`);
      assert.equal(new Set(actual.map(p=>p.id)).size,actual.length,'piece identities are unique');
      if(cut%4===3) { const detached=actual.flatMap(p=>p.cells); graph.remove(detached); detached.forEach(id=>removed.add(id)); }
    }
  }
});

test('fracture assignments cover every input exactly once, preserve holes, and never bind disconnected cells',()=>{
  const cells=[cell(1,0,0,0),cell(2,1,0,0),cell(3,4,0,0),cell(4,4,1,0),cell(5,1,1,1)];
  const groups=fractureCellIds(cells,{x:0,y:0,z:0},100,17);
  assert.deepEqual(normalized(groups),[[1,2],[3,4],[5]]);
});

test('fracture uses seeded nearest assignment reproducibly without mutating cells or joining materials',()=>{
  const cells=Array.from({length:80},(_,x)=>cell(x,x,0,0,{material:x%2===0?'stone':'wood'}));
  const before=structuredClone(cells),at:Point={x:40,y:0,z:0};
  const a=fractureCellIds(cells,at,6,123),b=fractureCellIds([...cells].reverse(),at,6,123);
  assert.deepEqual(a,b);
  assert.deepEqual([...a.flat()].sort((x,y)=>x-y),cells.map(c=>c.id));
  for(const group of a)assert.equal(new Set(group.map(id=>cells[id].material)).size,1);
  assert.deepEqual(cells,before);
});

test('fracture handles empty input and rejects invalid mean rather than unbounded seed allocation',()=>{
  assert.deepEqual(fractureCellIds([],{x:0,y:0,z:0},4,2),[]);
  assert.throws(()=>fractureCellIds([cell(1,0,0,0)],{x:0,y:0,z:0},0,2),/mean/i);
  assert.throws(()=>fractureCellIds([cell(1,0,0,0)],{x:NaN,y:0,z:0},2,2),/finite/i);
});

// Mutation guard: an all-one-label or ignored-seed implementation must not pass.
test('fracture seed changes real homogeneous pieces while every resulting piece stays connected',()=>{
  const cells:Cell[]=[];
  for(let x=0;x<12;x++)for(let y=0;y<8;y++)cells.push(cell(x*8+y,x,y,0));
  const at={x:3,y:2,z:0};
  const a=fractureCellIds(cells,at,8,123);
  const b=fractureCellIds(cells,at,8,124);
  assert.ok(a.length>1);
  assert.notDeepEqual(a,b);
  for(const group of a){
    const members=new Set(group);
    assert.equal(reference(cells.filter(c=>members.has(c.id)),new Set()).length,1);
  }
  assert.deepEqual([...a.flat()].sort((x,y)=>x-y),cells.map(c=>c.id));
});

test('fracture tiny positive mean caps seed allocation and output at the cell count',()=>{
  const cells=Array.from({length:20},(_,x)=>cell(x,x,0,0));
  for(const mean of [1e-9,Number.MIN_VALUE]) {
    const groups=fractureCellIds(cells,{x:0,y:0,z:0},mean,17);
    assert.ok(groups.length<=cells.length);
    assert.deepEqual([...groups.flat()].sort((a,b)=>a-b),cells.map(c=>c.id));
  }
});
