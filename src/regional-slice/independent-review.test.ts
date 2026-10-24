import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createDenseFixture,type CompactCell} from '../compact/fixture';
import type {CompactSurfaceSource} from '../compact/surface-source';

// Independent QA: these fixtures exercise scalar editing and rendered topology.
// They do NOT establish Rapier collider, support, secondary contact or settlement equivalence.
const loadGreedy=async()=>{const m=await import('./greedy-chunk-mesh').catch(()=>null);assert.ok(m?.buildGreedyChunk,'exact indexed greedy mesher must exist');return m;};
const loadBulk=async()=>{const m=await import('./bulk').catch(()=>null);assert.ok(m?.RegionalBulkStore&&m?.classifyBulkTile,'regional scalar editor must exist');return m;};
type Cell={x:number;y:number;z:number;hp?:number;color?:number};
const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as const;
const key=(p:Pick<Cell,'x'|'y'|'z'>)=>`${p.x},${p.y},${p.z}`;
function surface(cells:Cell[]){
 const positions=new Map(cells.map((c,i)=>[key(c),i])),ids=cells.map((_,i)=>i%2?-(2**40)-i:2**40+i),byId=new Map(ids.map((id,i)=>[id,i]));
 const source:CompactSurfaceSource={bounds:{minX:Math.min(...cells.map(c=>c.x)),maxX:Math.max(...cells.map(c=>c.x)),minY:Math.min(...cells.map(c=>c.y)),maxY:Math.max(...cells.map(c=>c.y)),minZ:Math.min(...cells.map(c=>c.z)),maxZ:Math.max(...cells.map(c=>c.z))},
  staticIdAt(x,y,z){const i=positions.get(`${x},${y},${z}`);return i===undefined?null:ids[i];},
  colorOf:id=>cells[byId.get(id)!].color??0xffffff,hpOf:id=>cells[byId.get(id)!].hp??10,maxHpOf:()=>10,
  forEachChunk(size,visit){for(const c of new Set(cells.map(p=>`${Math.floor(p.x/size)},${Math.floor(p.y/size)},${Math.floor(p.z/size)}`)))visit(...c.split(',').map(Number) as [number,number,number]);}};
 return source;
}
function finalColor(cell:Cell){
 // Independent sRGB formula, not Three.Color or either mesher's shading helper.
 const hex=cell.color??0xffffff,scale=(cell.hp??10)<10?.6+.4*(cell.hp??10)/10:1;
 return [hex>>>16&255,hex>>>8&255,hex&255].map(c=>{const s=c/255;return Math.fround((s<=.04045?s/12.92:((s+.055)/1.055)**2.4)*scale);});
}
function faceKey(center:number[],normal:readonly number[]){return [...center,...normal].join(',');}
async function verifySurface(cells:Cell[],size:number){
 const {buildGreedyChunk}=await loadGreedy(),source=surface(cells),occupied=new Set(cells.map(key)),expected=new Map<string,number[]>(),seen=new Map<string,number[]>();
 for(const c of cells)for(const n of directions)if(!occupied.has(`${c.x+n[0]},${c.y+n[1]},${c.z+n[2]}`))expected.set(faceKey([c.x+n[0]/2,c.y+n[1]/2,c.z+n[2]/2],n),finalColor(c));
 let totalArea=0,unitFaces=0;
 source.forEachChunk(size,(cx,cy,cz)=>{
  const mesh=buildGreedyChunk(source,`${cx},${cy},${cz}`,size);unitFaces+=mesh.unitFaces;
  assert.equal(mesh.position.length,mesh.faces*12);assert.equal(mesh.normal.length,mesh.position.length);assert.equal(mesh.color.length,mesh.position.length);assert.equal(mesh.index.length,mesh.faces*6);
  assert.equal(mesh.stats.outputBytes,[mesh.position,mesh.normal,mesh.color,mesh.index].reduce((sum,a)=>sum+a.byteLength,0),'credit includes actual index bytes');
  const arrays=[mesh.position,mesh.normal,mesh.color,mesh.index];assert.equal(new Set(arrays.map(a=>a.buffer)).size,4);for(const a of arrays){assert.equal(a.byteOffset,0);assert.equal(a.byteLength,a.buffer.byteLength);}
  for(let q=0;q<mesh.faces;q++){
   const p=Array.from({length:4},(_,v)=>Array.from(mesh.position.slice((q*4+v)*3,(q*4+v+1)*3))),n=Array.from(mesh.normal.slice(q*12,q*12+3)),color=Array.from(mesh.color.slice(q*12,q*12+3));
   const normalAxis=n.findIndex(v=>v!==0);assert.ok(normalAxis>=0);assert.equal(n.filter(v=>v!==0).length,1);assert.equal(Math.abs(n[normalAxis]),1);
   for(let v=1;v<4;v++){assert.deepEqual(Array.from(mesh.normal.slice((q*4+v)*3,(q*4+v+1)*3)),n);assert.deepEqual(Array.from(mesh.color.slice((q*4+v)*3,(q*4+v+1)*3)),color);}
   assert.ok(p.every(v=>v[normalAxis]===p[0][normalAxis]),'merged face remains exactly coplanar');
   const free=[0,1,2].filter(a=>a!==normalAxis),[u,v]=free,minU=Math.min(...p.map(a=>a[u])),maxU=Math.max(...p.map(a=>a[u])),minV=Math.min(...p.map(a=>a[v])),maxV=Math.max(...p.map(a=>a[v]));
   assert.ok(Number.isInteger(maxU-minU)&&maxU>minU&&Number.isInteger(maxV-minV)&&maxV>minV,'every quad is a positive integral rectangle');
   for(let t=0;t<2;t++){
    const indices=Array.from(mesh.index.slice(q*6+t*3,q*6+t*3+3));assert.ok(indices.every(i=>i>=q*4&&i<q*4+4));
    const points=indices.map(i=>new THREE.Vector3().fromArray(mesh.position,i*3)),cross=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    assert.ok(cross.dot(new THREE.Vector3(...n))>0,'winding must face its actual outward normal');totalArea+=cross.length()/2;
   }
   for(let a=minU+.5;a<maxU;a++)for(let b=minV+.5;b<maxV;b++){
    const center=[0,0,0];center[normalAxis]=p[0][normalAxis];center[u]=a;center[v]=b;const k=faceKey(center,n);
    assert.ok(expected.has(k),`unexpected filled hole, interior face, or wrong normal: ${k}`);assert.ok(!seen.has(k),`duplicate face coverage: ${k}`);
    const want=expected.get(k)!;color.forEach((c,i)=>assert.ok(Math.abs(c-want[i])<2e-7,`${k} exact final rendered shade component ${i}: ${c} vs ${want[i]}`));seen.set(k,color);
   }
  }
 });
 assert.equal(unitFaces,expected.size);assert.equal(totalArea,expected.size,'triangle area equals independent occupied-boundary area');assert.equal(seen.size,expected.size,'every required face covered exactly once');
 return {source,expectedFaces:expected.size};
}

test('independent greedy boundary oracle catches filled holes, missing facets, reversed winding, and shade merging',async()=>{
 const cells:Cell[]=[];for(let x=-2;x<=5;x++)for(let z=-2;z<=5;z++)if(!(x===1&&z===1)&&!(x===2&&z===1))cells.push({x,y:0,z,hp:x<1?10:5,color:z<1?0xffffff:0xff0000});
 cells.push({x:4,y:1,z:4,color:0x808080,hp:2.5},{x:4,y:2,z:4,color:0x808080,hp:2.5});
 for(const size of [1,2,4,32])await verifySurface(cells,size);
});

test('independent greedy rays pass through an actual hole and hit the surviving plate at the exact surface',async()=>{
 const {buildGreedyChunk}=await loadGreedy(),cells:Cell[]=[];for(let x=0;x<5;x++)for(let z=0;z<5;z++)if(x!==2||z!==2)cells.push({x,y:0,z});
 await verifySurface(cells,8);const built=buildGreedyChunk(surface(cells),'0,0,0',8),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(built.position,3));geometry.setAttribute('normal',new THREE.BufferAttribute(built.normal,3));geometry.setIndex(new THREE.BufferAttribute(built.index,1));
 const material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld(true);
 try{
  assert.equal(new THREE.Raycaster(new THREE.Vector3(2,4,2),new THREE.Vector3(0,-1,0)).intersectObject(mesh).length,0,'greedy must not cover an empty column');
  const hits=new THREE.Raycaster(new THREE.Vector3(1,4,2),new THREE.Vector3(0,-1,0)).intersectObject(mesh);assert.ok(hits.length);assert.equal(hits[0].distance,3.5);assert.deepEqual(hits[0].face!.normal.toArray(),[0,1,0]);
 }finally{geometry.dispose();material.dispose();}
});

test('uniform 32 by 32 plate emits six indexed quads without changing its 2176 unit boundary faces',async()=>{
 const {buildGreedyChunk}=await loadGreedy(),cells:Cell[]=[];for(let x=0;x<32;x++)for(let z=0;z<32;z++)cells.push({x,y:0,z});
 const mesh=buildGreedyChunk(surface(cells),'0,0,0',32);assert.equal(mesh.faces,6);assert.equal(mesh.unitFaces,2176);assert.equal(mesh.stats.outputBytes,792);await verifySurface(cells,32);
});

const cell=(id:number,x:number,hp:number,options:Partial<CompactCell>={}):CompactCell=>({id,objectId:'independent-fixture',role:'building',position:{x,y:0,z:0},material:'wood',color:0xffffff,hp,maxHp:Math.max(hp,10),objective:true,...options});

// Named mutations caught below: strict '<' instead of '<=' at kill/sphere edge;
// trusting nearest rather than farthest distance; max HP replaced by min HP;
// applying an aggregate kill over partial/mixed/moving cells; replaying reward.
test('bulk classifier proves the farthest actual cell center and exact kill threshold, never a nearest-point shortcut',async()=>{
 const {classifyBulkTile}=await loadBulk(),summary={bounds:{minX:0,maxX:7,minY:0,maxY:0,minZ:0,maxZ:0},count:8,materialCount:1,allStatic:true,pristine:true,maxHp:11.875};
 const blast={id:'threshold',epoch:1,center:{x:0,y:0,z:0},radius:16,damage:16};
 // At d=7 the real falloff is exactly 16 - .65*7 = 11.45.
 const edge={...summary,maxHp:11.45};assert.equal(classifyBulkTile(edge,blast).kind,'full-gone');
 assert.notEqual(classifyBulkTile({...edge,maxHp:11.450000000000003},blast).kind,'full-gone');
 assert.notEqual(classifyBulkTile({...edge,maxHp:15},blast).kind,'full-gone','nearest corner damage cannot kill a harder far corner');
 for(const change of [{materialCount:2},{allStatic:false},{pristine:false}])assert.notEqual(classifyBulkTile({...edge,...change},blast).kind,'full-gone');
 assert.notEqual(classifyBulkTile({...edge,bounds:{...edge.bounds,maxX:17}},blast).kind,'full-gone','sphere boundary intersection is not wholly inside');
});

test('bulk scalar editing preserves exact spherical edge HP, mixed HP, outside cells, and already departed cells',async()=>{
 const {RegionalBulkStore}=await loadBulk();
 const fixture=createDenseFixture({id:'independent-scalar-boundary',cells:[cell(1,0,20),cell(2,20,7),cell(3,19,8),cell(4,21,10),cell(5,1,10),cell(6,2,10,{material:'stone'})]});
 const store=new RegionalBulkStore(fixture,[{id:5,hp:0,loss:10,state:'gone'},{id:6,hp:10,loss:10,state:'dynamic'}]);
 const beforeDynamic=store.read(6);store.blast({id:'boundary',epoch:1,center:{x:0,y:0,z:0},radius:20,damage:20});
 assert.equal(store.read(1)!.state,'gone');assert.equal(store.read(2)!.state,'gone','cell center exactly on sphere is hit');
 assert.ok(Math.abs(store.read(3)!.hp-.35)<1e-12);assert.equal(store.read(3)!.state,'static');assert.equal(store.read(4)!.hp,10);
 assert.deepEqual(store.read(5),{id:5,hp:0,loss:10,state:'gone'});assert.deepEqual(store.read(6),beforeDynamic,'this scalar slice must leave body-owned rows to the real simulation');
 const after=store.snapshot();store.blast({id:'boundary',epoch:1,center:{x:0,y:0,z:0},radius:20,damage:20});assert.deepEqual(store.snapshot(),after,'duplicate command cannot reapply HP, journal or reward');
});

test('new shot IDs cannot reward gone or detached material twice, including after scalar save restore',async()=>{
 const {RegionalBulkStore}=await loadBulk(),fixture=createDenseFixture({id:'independent-reward',cells:[cell(11,0,10),cell(12,1,10),cell(13,2,10)]});
 const initial=[{id:12,hp:0,loss:10,state:'gone' as const},{id:13,hp:10,loss:10,state:'dynamic' as const}],store=new RegionalBulkStore(fixture,initial);
 const blast={id:'first',epoch:1,center:{x:0,y:0,z:0},radius:32,damage:100};store.blast(blast);
 const aggregate=store.aggregate();assert.equal(aggregate.rewardedLoss,1,'only one previously static objective cell earns one normalized loss unit');assert.equal(aggregate.objectiveDeparted,3);assert.ok(aggregate.research>0);
 store.blast({...blast,id:'second'});assert.deepEqual(store.aggregate(),aggregate,'a fresh command ID is not fresh destroyed material');
 const saved=store.snapshot(),restored=new RegionalBulkStore(fixture);assert.equal(restored.restore(saved),true);assert.deepEqual(restored.aggregate(),aggregate);
 restored.blast({...blast,id:'third'});assert.deepEqual(restored.aggregate(),aggregate,'restoring compact gone regions must not reset earned-loss accounting');
 const beforeReplay=restored.snapshot();restored.blast(blast);assert.deepEqual(restored.snapshot(),beforeReplay,'save retains command deduplication');
});

test('unrewarded full-gone regions stay unrewarded and reset restores original stable IDs without prior commands',async()=>{
 const {RegionalBulkStore}=await loadBulk(),cells=Array.from({length:8},(_,i)=>cell(i%2?-(2**40)-i:2**40+i,i,10)),fixture=createDenseFixture({id:'independent-full-gone',cells}),store=new RegionalBulkStore(fixture);
 const blast={id:'unrewarded',epoch:1,center:{x:0,y:0,z:0},radius:32,damage:100,reward:false};store.blast(blast);
 assert.equal(store.aggregate().gone,8);assert.equal(store.aggregate().rewardedLoss,0);assert.equal(store.aggregate().research,0);
 store.blast({...blast,id:'later-reward-attempt',reward:true});assert.equal(store.aggregate().research,0,'later shots cannot retroactively reward earlier unrewarded destruction');
 const restored=new RegionalBulkStore(fixture);assert.equal(restored.restore(store.snapshot()),true);for(const c of cells)assert.equal(restored.read(c.id)!.state,'gone');
 restored.reset();assert.equal(restored.snapshot().epoch,2);for(const c of cells)assert.deepEqual(restored.read(c.id),{id:c.id,hp:10,loss:0,state:'static'});
 const afterReset=restored.snapshot();restored.blast(blast);assert.deepEqual(restored.snapshot(),afterReset,'old epoch cannot mutate reset state');
 restored.blast({...blast,epoch:2,reward:true});assert.equal(restored.aggregate().gone,8);assert.equal(restored.aggregate().rewardedLoss,8);assert.ok(restored.aggregate().research>0,'reset must clear the previous command IDs');
});
