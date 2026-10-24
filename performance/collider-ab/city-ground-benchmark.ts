// Standalone, sequential-process ground-only comparison. No city building world.
import RAPIER from '@dimforge/rapier3d-compat';
import {CompactTerrain} from '../terrain/compact-terrain.ts';
import {legacyLayoutColumns} from '../terrain/legacy-layout-columns.ts';
import {CompactGroundColliders} from './compact-colliders.ts';
import {packStaticCells} from '../../src/structural/static-packing.ts';
import type {Cell} from '../../src/structural/types.ts';
import assert from 'node:assert/strict';

function cityDescriptor(){
 const layout=legacyLayoutColumns('city');assert.equal(layout.buildingCount,36);
 const {map,minX,maxX,minZ,maxZ}=layout.config;
 return {terrain:new CompactTerrain(layout.config),config:{map,minX,maxX,minZ,maxZ}};
}
async function main(){
 const mode=process.argv[2];if(mode!=='compact'&&mode!=='dense')throw new Error('mode must be compact or dense');
 await RAPIER.init();if(!global.gc)throw new Error('Use --expose-gc');
 const memory=()=>{global.gc!();return process.memoryUsage();};
 const baseline=memory(),start=performance.now(),{terrain,config}=cityDescriptor(),descriptorMs=performance.now()-start,descriptorMemory=memory();
 assert.equal(terrain.cellCount,401800);
 const metrics:Record<string,unknown>={mode,scope:'ground-only; 401800 cells, 8 layers, full finite bounds; no buildings/support/render/save',rapierVersion:RAPIER.version(),descriptorMs,knownTerrainArrayBytes:terrain.diagnostics(),baseline,descriptorMemory};
 const world=new RAPIER.World({x:0,y:-18,z:0});
 let liveRefs:unknown[]=[terrain,world];
 const roots=globalThis as typeof globalThis & {groundBenchmarkKeepAlive?:unknown[]};
 roots.groundBenchmarkKeepAlive=liveRefs;
 try{
  if(mode==='compact'){
   const t=performance.now(),ground=new CompactGroundColliders(world,terrain,config);metrics.colliderConstructionMs=performance.now()-t;metrics.adapter=ground.diagnostics();liveRefs.push(ground);
  }else{
   const t=performance.now(),cells:Cell[]=[];
   for(let x=config.minX;x<=config.maxX;x++)for(let y=-8;y<=-1;y++)for(let z=config.minZ;z<=config.maxZ;z++){
    const {state:_,rotation:__,...cell}=terrain.cell(terrain.idAt(x,y,z)!)!;cells.push(cell);
   }
   metrics.cellMaterializationMs=performance.now()-t;metrics.cellMemory=memory();
   const packStart=performance.now(),boxes=packStaticCells(cells);metrics.packingMs=performance.now()-packStart;metrics.packedMemory=memory();
   const byCell=new Map<number,RAPIER.Collider>(),byHandle=new Map<number,typeof boxes[number]>(),buildStart=performance.now();
   for(const b of boxes){const collider=world.createCollider(RAPIER.ColliderDesc.cuboid(b.half.x,b.half.y,b.half.z).setTranslation(b.center.x,b.center.y,b.center.z).setFriction(.85).setRestitution(.02).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS|RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0));byHandle.set(collider.handle,b);for(const id of b.cellIds)byCell.set(id,collider);}
   metrics.colliderConstructionMs=performance.now()-buildStart;metrics.cellObjects=cells.length;metrics.retainedPackedCellIds=boxes.reduce((n,b)=>n+b.cellIds.length,0);metrics.cellToColliderEntries=byCell.size;
   liveRefs.push(cells,boxes,byCell,byHandle);
  }
  const stepStart=performance.now();world.step();metrics.initialPhysicsStepMs=performance.now()-stepStart;
  assert.equal(world.colliders.len(),832);metrics.nativeColliderCount=world.colliders.len();metrics.retainedMemory=memory();
  const after=metrics.retainedMemory as NodeJS.MemoryUsage;metrics.memoryDeltaFromBaseline=Object.fromEntries(Object.keys(baseline).map(k=>[k,after[k as keyof NodeJS.MemoryUsage]-baseline[k as keyof NodeJS.MemoryUsage]]));
  const probes=[[-122,-102],[0,0],[122,102],[-45,43]];for(const [x,z]of probes)assert.equal(world.castRay(new RAPIER.Ray({x,y:2,z},{x:0,y:-1,z:0}),20,true)?.timeOfImpact,2.5);
  assert.equal(world.castRay(new RAPIER.Ray({x:123,y:2,z:0},{x:0,y:-1,z:0}),20,true),null);
  metrics.validation='832 finite colliders; four in-domain surface rays and one out-of-bounds ray passed';
  metrics.physicsSnapshotBytes=world.takeSnapshot().byteLength;
  metrics.retainedGroups=liveRefs.length;
  console.log(JSON.stringify(metrics,null,2));
 }finally{world.free();delete roots.groundBenchmarkKeepAlive;liveRefs=[];}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
