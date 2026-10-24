import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createCompactSurfaceRenderer} from './surface-renderer';
import {createCompactSurfaceSource,type CompactSurfaceSource,type SurfaceEdit,type SurfaceBounds,type MovingSurfaceCell} from './surface-source';

const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const key=(x:number,y:number,z:number)=>`${x},${y},${z}`;
type Cell={id:number;x:number;y:number;z:number;color:number;hp:number;maxHp:number;live:boolean};
function fixture(coords:readonly (readonly [number,number,number])[]) {
 const cells=coords.map(([x,y,z],i)=>({id:i%2?-1000-i:70000+i,x,y,z,color:i%2?0x8b9650:0x995533,hp:10,maxHp:10,live:true}));
 const byPosition=new Map(cells.map(c=>[key(c.x,c.y,c.z),c])),byId=new Map(cells.map(c=>[c.id,c]));
 const bounds:SurfaceBounds={minX:Math.min(...cells.map(c=>c.x)),maxX:Math.max(...cells.map(c=>c.x)),minY:Math.min(...cells.map(c=>c.y)),maxY:Math.max(...cells.map(c=>c.y)),minZ:Math.min(...cells.map(c=>c.z)),maxZ:Math.max(...cells.map(c=>c.z))};
 let queries=0,registrations=0,revision=0;
 const source:CompactSurfaceSource={bounds,staticIdAt(x,y,z){queries++;const c=byPosition.get(key(x,y,z));return c?.live?c.id:null;},colorOf:id=>byId.get(id)!.color,hpOf:id=>byId.get(id)!.hp,maxHpOf:id=>byId.get(id)!.maxHp,forEachChunk(size,visit){registrations++;const seen=new Set<string>();for(const c of cells){const a=Math.floor(c.x/size),b=Math.floor(c.y/size),d=Math.floor(c.z/size),k=key(a,b,d);if(!seen.has(k)){seen.add(k);visit(a,b,d);}}}};
 return {cells,source,get queries(){return queries;},get registrations(){return registrations;},edit(c:Cell,change:Partial<Cell>):SurfaceEdit{const before=c.live,beforeColor=c.color,beforeHp=c.hp;Object.assign(c,change);return {id:c.id,revision:++revision,position:{x:c.x,y:c.y,z:c.z},topologyChanged:before!==c.live,appearanceChanged:beforeColor!==c.color||beforeHp!==c.hp};}};
}
function renderer(chunkSize=16){const scene=new THREE.Scene(),box=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();const render=createCompactSurfaceRenderer(scene,box,material,{chunkSize});return {scene,box,material,render,dispose(){render.dispose();box.dispose();material.dispose();}};}
const chunks=(r:ReturnType<typeof renderer>)=>new Map(r.render.group.children.map(o=>[o.name,(o as THREE.Mesh).geometry]));
function faces(r:ReturnType<typeof renderer>){const result:string[]=[];for(const o of r.render.group.children){const g=(o as THREE.Mesh).geometry,p=g.getAttribute('position'),n=g.getAttribute('normal'),c=g.getAttribute('color');for(let v=0;v<p.count;v+=6){const x=(p.getX(v)+p.getX(v+5))/2-n.getX(v)*.5,y=(p.getY(v)+p.getY(v+5))/2-n.getY(v)*.5,z=(p.getZ(v)+p.getZ(v+5))/2-n.getZ(v)*.5;result.push(`${x},${y},${z}:${n.getX(v)},${n.getY(v)},${n.getZ(v)}:${c.getX(v).toFixed(6)},${c.getY(v).toFixed(6)},${c.getZ(v).toFixed(6)}`);}}return result.sort();}
function oracle(f:ReturnType<typeof fixture>){const occupied=new Set(f.cells.filter(c=>c.live).map(c=>key(c.x,c.y,c.z))),result:string[]=[];for(const c of f.cells){if(!c.live)continue;const rgb=new THREE.Color(c.color);if(c.hp<c.maxHp)rgb.multiplyScalar(.6+.4*c.hp/c.maxHp);for(const [x,y,z]of directions)if(!occupied.has(key(c.x+x,c.y+y,c.z+z)))result.push(`${c.x},${c.y},${c.z}:${x},${y},${z}:${rgb.r.toFixed(6)},${rgb.g.toFixed(6)},${rgb.b.toFixed(6)}`);}return result.sort();}
const cube=(min:number,max:number)=>{const c:[number,number,number][]=[];for(let x=min;x<=max;x++)for(let y=min;y<=max;y++)for(let z=min;z<=max;z++)c.push([x,y,z]);return c;};

test('initial surface removes only shared faces and retains exact positions and linear colors',()=>{
 const f=fixture(cube(-1,1)),r=renderer();r.render.bind(f.source);assert.equal(r.render.getDiagnostics().faces,54);assert.deepEqual(faces(r),oracle(f));assert.equal(r.render.getBounds().min.x,-1.5);assert.equal(r.render.getBounds().max.z,1.5);r.dispose();
});
test('local boundary removal exposes the actual neighbor while unaffected geometry retains identity',()=>{
 const f=fixture([[15,0,0],[16,0,0],[0,0,0],[-17,0,0],[32,0,0]]),r=renderer();r.render.bind(f.source);const old=chunks(r),queries=f.queries,registrations=f.registrations;
 const edit=f.edit(f.cells[1],{live:false});r.render.applyEdits([edit,edit]);const report=r.render.flush();assert.deepEqual(report.keys.sort(),['0,0,0','1,0,0']);assert.equal(f.registrations,registrations);assert.ok(f.queries-queries<1500);assert.deepEqual(faces(r),oracle(f));for(const [k,g]of old)if(!report.keys.includes(k))assert.strictEqual(chunks(r).get(k),g);
 const after=f.queries;r.render.applyEdits([edit]);assert.equal(r.render.flush().chunks,0);assert.equal(f.queries,after);r.dispose();
});
test('HP-only edits update linear shading without replacing topology or rebuilding halos',()=>{
 const f=fixture([[0,0,0],[16,0,0]]),r=renderer();r.render.bind(f.source);const old=chunks(r),beforeQueries=f.queries;const edit=f.edit(f.cells[0],{hp:2.5});r.render.applyEdits([edit]);const report=r.render.flush();assert.equal(report.chunks,0);assert.equal(report.colorChunks,1);assert.ok(f.queries-beforeQueries<=6);assert.deepEqual(faces(r),oracle(f));for(const [k,g]of old)assert.strictEqual(chunks(r).get(k),g);r.dispose();
});
test('interior excavation has six cavity faces and a real ray resolves the next original cell ID',()=>{
 const f=fixture(cube(-1,1)),r=renderer();r.render.bind(f.source);const top=f.cells.find(c=>c.x===0&&c.y===1&&c.z===0)!,center=f.cells.find(c=>c.x===0&&c.y===0&&c.z===0)!;
 r.render.applyEdits([f.edit(top,{live:false})]);r.render.flush();const hit=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0)).intersectObjects(r.render.raycastObjects,true)[0];assert.ok(hit);const surface=r.render.resolveIntersection(hit)!;assert.equal(surface.voxelId,center.id);assert.deepEqual(surface.position,{x:0,y:.5,z:0});assert.deepEqual(surface.normal,{x:0,y:1,z:0});
 r.render.applyEdits([f.edit(center,{live:false})]);r.render.flush();assert.deepEqual(faces(r),oracle(f));r.dispose();
});
test('ten rebindings dispose every replaced geometry and discard stale revision ledgers and hits',()=>{
 const r=renderer();let lastHit:THREE.Intersection|undefined,disposed=0;
 for(let round=0;round<10;round++){const f=fixture([[0,0,0],[1,0,0]]);r.render.bind(f.source);if(lastHit)assert.equal(r.render.resolveIntersection(lastHit),null);const initial=faces(r);const old=[...chunks(r).values()];for(const g of old)g.addEventListener('dispose',()=>disposed++);lastHit=new THREE.Raycaster(new THREE.Vector3(0,10,0),new THREE.Vector3(0,-1,0)).intersectObjects(r.render.raycastObjects,true)[0];assert.ok(lastHit);r.render.applyEdits([f.edit(f.cells[0],{live:false})]);r.render.flush();assert.deepEqual(faces(r),oracle(f));const fresh=renderer();fresh.render.bind(f.source);assert.deepEqual(faces(r),faces(fresh));assert.notDeepEqual(faces(r),initial);fresh.dispose();}
 assert.equal(disposed,10);r.dispose();assert.equal(r.scene.children.length,0);
});
test('rotated sparse dynamic and rubble raycasts return authority IDs and true transformed normals',()=>{
 const r=renderer(),f=fixture([[50,0,0]]);r.render.bind(f.source);const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/4);const c:MovingSurfaceCell={id:-876543,objectId:'test',role:'bridge',material:'road',position:{x:4,y:5,z:6},rotation:{x:q.x,y:q.y,z:q.z,w:q.w},size:{x:4,y:1,z:1},color:0x8b9650,hp:5,maxHp:10,state:'dynamic'};
 r.render.setMoving([c]);const hits=new THREE.Raycaster(new THREE.Vector3(4,10,6),new THREE.Vector3(0,-1,0)).intersectObjects(r.render.raycastObjects,true),surface=r.render.resolveIntersection(hits[0])!;assert.equal(surface.voxelId,c.id);assert.ok(Math.abs(surface.position.y-(5+Math.SQRT1_2))<1e-5);assert.ok(Math.abs(surface.normal.x)>.7&&Math.abs(surface.normal.y)>.7);
 r.render.setMoving([{...c,state:'rubble'}]);assert.equal(r.render.getDiagnostics().movingCells,1);r.render.setMoving([{...c,state:'gone'}]);assert.equal(r.render.getDiagnostics().movingCells,0);r.dispose();
});
test('idle flush never polls full source and immutable source facade owns its bounds',()=>{
 const f=fixture([[0,0,0]]),r=renderer(),source=createCompactSurfaceSource({...f.source,fixture:{bounds:f.source.bounds,forEachChunk:f.source.forEachChunk}});r.render.bind(source);const before=f.queries,reg=f.registrations,revision=r.render.getDiagnostics().revision;r.render.flush();r.render.setMoving([]);assert.equal(f.queries,before);assert.equal(f.registrations,reg);assert.equal(r.render.getDiagnostics().revision,revision);assert.ok(Object.isFrozen(source));assert.ok(Object.isFrozen(source.bounds));r.dispose();
});

test('negative corner edits rebuild face neighbors but never diagonal chunks',()=>{
 const f=fixture([[-16,-16,-16],[-17,-16,-16],[-16,-17,-16],[-16,-16,-17],[-17,-17,-17],[16,16,16]]),r=renderer();r.render.bind(f.source);const previous=chunks(r);
 r.render.applyEdits([f.edit(f.cells[0],{live:false})]);const report=r.render.flush();assert.deepEqual(report.keys.sort(),['-1,-1,-1','-1,-1,-2','-1,-2,-1','-2,-1,-1']);assert.strictEqual(chunks(r).get('-2,-2,-2'),previous.get('-2,-2,-2'));assert.deepEqual(faces(r),oracle(f));r.dispose();
});
test('later appearance and no-op revisions cannot hide an earlier undelivered topology edit',()=>{
 const f=fixture([[0,0,0],[1,0,0]]),r=renderer();r.render.bind(f.source);const removal=f.edit(f.cells[0],{live:false}),appearance=f.edit(f.cells[0],{hp:1}),noop=f.edit(f.cells[0],{hp:1});r.render.applyEdits([noop,appearance,removal]);assert.equal(r.render.flush().chunks,1);assert.deepEqual(faces(r),oracle(f));r.render.applyEdits([appearance,removal]);assert.equal(r.render.flush().chunks,0);r.dispose();
});
test('six real Three face raycasts agree with exact emitted corners and outward winding',()=>{
 const f=fixture([[0,0,0]]),r=renderer();r.render.bind(f.source);const geometry=[...chunks(r).values()][0],p=geometry.getAttribute('position');
 // These literal first-face corners independently lock the proof's +X winding.
 assert.deepEqual(Array.from(p.array.slice(0,18)),[.5,-.5,-.5,.5,.5,-.5,.5,-.5,.5,.5,-.5,.5,.5,.5,-.5,.5,.5,.5]);
 for(const [x,y,z]of directions){const hit=new THREE.Raycaster(new THREE.Vector3(x*3,y*3,z*3),new THREE.Vector3(-x,-y,-z)).intersectObjects(r.render.raycastObjects,true)[0];assert.ok(hit);const surface=r.render.resolveIntersection(hit)!;assert.equal(surface.voxelId,f.cells[0].id);assert.deepEqual([surface.normal.x,surface.normal.y,surface.normal.z],[x,y,z]);assert.deepEqual([surface.position.x,surface.position.y,surface.position.z],[x*.5,y*.5,z*.5]);}r.dispose();
});
test('sparse pool growth, reordering, compaction and pose updates retain stable IDs and owned shared assets',()=>{
 const f=fixture([[50,0,0]]),r=renderer();r.render.bind(f.source);let boxDisposed=0,materialDisposed=0;r.box.addEventListener('dispose',()=>boxDisposed++);r.material.addEventListener('dispose',()=>materialDisposed++);
 const cells:MovingSurfaceCell[]=Array.from({length:40},(_,i)=>({id:-90000-i,objectId:'moving',role:'terrain',material:'soil',position:{x:i*2,y:2,z:0},rotation:{x:0,y:0,z:0,w:1},color:0x995533,hp:3,maxHp:5,state:i%2?'rubble':'dynamic'}));
 r.render.setMoving(cells);assert.equal(r.render.getDiagnostics().movingCells,40);assert.equal(r.render.getDiagnostics().retainedCellViews,0);assert.equal(r.render.getDiagnostics().movingCapacity,40);const revision=r.render.getDiagnostics().revision;r.render.setMoving([...cells].reverse());assert.equal(r.render.getDiagnostics().revision,revision);assert.equal(r.render.getDiagnostics().movingMatrixWrites,0);assert.equal(r.render.getDiagnostics().movingColorWrites,0);
 r.render.setMoving([cells[39],cells[0],{...cells[17],position:{x:-5,y:20,z:0}}]);assert.equal(r.render.getDiagnostics().movingCells,3);for(const [x,y,id]of [[78,2,cells[39].id],[0,2,cells[0].id],[-5,20,cells[17].id]]){const hit=new THREE.Raycaster(new THREE.Vector3(x,y+5,0),new THREE.Vector3(0,-1,0)).intersectObjects(r.render.raycastObjects,true)[0];assert.equal(r.render.resolveIntersection(hit)?.voxelId,id);}assert.equal(r.render.getBounds().max.y,20.5);
 r.render.bind(f.source);assert.equal(r.render.getDiagnostics().movingCells,0);r.render.dispose();assert.equal(r.scene.children.length,0);assert.equal(boxDisposed,0);assert.equal(materialDisposed,0);r.box.dispose();r.material.dispose();
});

test('actual compact city matches every certified preview vertex, normal and color without CellView queries',async()=>{
 const {createHash}=await import('node:crypto'),{createCompactGameFixture}=await import('./fixture'),{CompactAuthorityStore}=await import('./store');
 const inventory=createCompactGameFixture('city'),store=new CompactAuthorityStore(inventory),r=renderer();
 const deny=()=>{throw new Error('Renderer must use scalar compact reads, not dense views or cell objects');};store.read=deny;store.peek=deny;inventory.original=deny;inventory.diagnosticCells=deny;
 r.render.bind(createCompactSurfaceSource(store));assert.equal(r.render.getDiagnostics().faces,203018);const rows:string[]=[],color=new THREE.Color();
 for(const geometry of chunks(r).values()){
  const p=geometry.getAttribute('position'),n=geometry.getAttribute('normal'),c=geometry.getAttribute('color');
  for(let vertex=0;vertex<p.count;vertex+=6){color.setRGB(c.getX(vertex),c.getY(vertex),c.getZ(vertex),THREE.LinearSRGBColorSpace);const hex=color.getHex(),expected=new THREE.Color(hex);
   // Check exact float32 linear channels as well as the recovered palette hex.
   assert.equal(c.getX(vertex),Math.fround(expected.r));assert.equal(c.getY(vertex),Math.fround(expected.g));assert.equal(c.getZ(vertex),Math.fround(expected.b));
   rows.push(`${hex}|${Array.from(p.array.slice(vertex*3,(vertex+6)*3)).join(',')}|${Array.from(n.array.slice(vertex*3,(vertex+6)*3)).join(',')}`);
  }
 }
 rows.sort();const hash=createHash('sha256');for(const row of rows)hash.update(row+'\n');
 // Frozen dirty-surfaces proof, independently certified against dense city.
 assert.equal(hash.digest('hex'),'a365dfd1e7a7fb124734759253ba3db83debc32b55f379c396f9f9ef4956428f');assert.equal(store.diagnostics().mutableStates,0);r.dispose();
});
