import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {compileScaleFixture} from '../src/scale-slice/fixture.js';
import {ScaleAuthority} from '../src/scale-slice/model.js';
import {TOOLS} from '../src/content-catalog.js';
import {createCompactGameFixture} from '../src/compact/fixture.js';
import {createScaleRuntime} from '../src/scale-slice/runtime.js';
import type {Cell,Point} from '../src/structural/types.js';

// Native CPU/solver evidence ONLY. This is not a browser, input-latency or FPS
// measurement. Full city execution requires the lead's exclusive heavy-job slot.
const TARGETS=Object.freeze({damageCommitMs:250,inputMs:100,mainLongTaskMs:100,visibleUpdateMs:500});
const memory=()=>({...process.memoryUsage(),processPeakRSSKiB:process.resourceUsage().maxRSS});
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const milliseconds=(fn:()=>unknown)=>{const at=performance.now();const value=fn();return {ms:performance.now()-at,value};};
const summary=(values:number[])=>({count:values.length,p95:values.length?values.slice().sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]:null,max:values.length?Math.max(...values):null});
const nativeGates=(rows:{commitMs:number;settled:boolean}[])=>({threeShots:rows.length===3,damageCommit:rows.length===3&&rows.every(r=>Number.isFinite(r.commitMs)&&r.commitMs<TARGETS.damageCommitMs),allNaturallySettled:rows.length===3&&rows.every(r=>r.settled),browserInput:null,browserMainLongTasks:null,browserVisibleUpdate:null});

function locality(){
 const make=(islands:number)=>{
  const cells:Cell[]=[];let id=1;
  for(let island=0;island<islands;island++)for(let x=0;x<8;x++)for(let z=0;z<8;z++)for(let y=-2;y<=0;y++){
   cells.push({id:id++,position:{x:x+island*128,y,z},objectId:`island-${island}`,role:y<0?'terrain':'building',material:y<0?'soil':'stone',color:0x999999,hp:100,maxHp:100,objective:y===0} as Cell);
  }
  return compileScaleFixture({id:`locality-${islands}`,cells});
 };
 const rows=[];
 for(const islands of [1,4]){
  const f=make(islands),m=new ScaleAuthority(f),before=m.regionViews();
  const run=milliseconds(()=>m.blast({id:'same-local-shot',epoch:m.epoch,sequence:1,position:{x:2,y:0,z:2},radius:9,damage:3,impulse:0}));
  assert.equal((run.value as {accepted:boolean}).accepted,true);
  assert.ok(m.regionViews().filter(r=>r.objectId!=='island-0').every(r=>r.hp===before.find(b=>b.id===r.id)!.hp),'remote material must remain untouched');
  rows.push({islands,cellCount:f.cellCount,regions:f.regions.length,compileMs:f.diagnostics.compileMs,blastCpuMs:run.ms,stats:m.stats(),localStateHash:hash(m.regionViews().filter(r=>r.objectId==='island-0').map(({index,...r})=>r))});
 }
 assert.equal(rows[0].localStateHash,rows[1].localStateHash,'unrelated islands cannot change local regional damage');
 return {scope:'Small synthetic 1× versus 4× disconnected remote inventory; no city-size physics or global-graph locality guarantee',rows,
  interpretation:'Candidate counts are not scan counts. Current authority may scan the entire region inventory, and structural support may legitimately visit the globally connected geology graph. Native timing here is descriptive, not a constant-time guarantee.'};
}

function selfTest(){
 const good=Array.from({length:3},()=>({commitMs:249,settled:true}));
 assert.equal(nativeGates(good).damageCommit,true);
 assert.equal(nativeGates([...good.slice(0,2),{commitMs:250,settled:true}]).damageCommit,false);
 assert.equal(nativeGates(good.slice(0,2)).threeShots,false);
 assert.equal(nativeGates([...good.slice(0,2),{commitMs:1,settled:false}]).allNaturallySettled,false);
 assert.equal(nativeGates(good).browserInput,null);assert.equal(summary([]).max,null);
 console.log(JSON.stringify({status:'profile-self-test-passed',browserExecuted:false,cityExecuted:false,targets:TARGETS}));
}

async function city(){
 assert.equal(process.env.SCALE_NATIVE_HEAVY_SLOT,'granted','The lead must grant the single native city heavy-job slot before execution');
 const maxSteps=Number(process.env.SCALE_PROFILE_MAX_STEPS??7200);
 assert.ok(Number.isSafeInteger(maxSteps)&&maxSteps>=960&&maxSteps<=14400,'Natural observation limit must be explicit and bounded, never a fake settlement operation');
 const evidence:any={schema:'scale-priority-native-profile/v1',startedAt:new Date().toISOString(),status:'running',targets:TARGETS,
  execution:'Native Node CPU and real Rapier, accelerated fixed steps; not real-time browser performance',
  scope:{sameCity:true,expected:{cells:454913,structures:53113,terrain:401800,buildings:36,terrainLayers:8},novaCount:3,distinctCenters:true,resetBetweenShots:false,power:1,radius:TOOLS.nova.radius,damage:TOOLS.nova.strength,stepSeconds:1/120,observationStepsPerShot:maxSteps},
  limitations:['No browser input, main-thread long task, physical presentation, or FPS is measured here.','Node RSS peak includes immutable compile temporary allocations and is process-scoped, not per-phase or native-WASM-only.','Damage authority commit and synchronous collider synchronization are separate fields; neither is mislabeled as visible update.','Budget, work, unsettled bodies and escaped geometry are reported; no radius, power, damage, map extent or terrain layer is reduced to pass.'],
  before:memory(),shots:[],browser:{inputMs:null,longTaskMs:null,visibleUpdateMs:null,verdict:'not-executed'}};
 let runtime:Awaited<ReturnType<typeof createScaleRuntime>>|undefined;
 try{
  const sourceAt=performance.now(),source=createCompactGameFixture('city');evidence.sourceBuildMs=performance.now()-sourceAt;
  const at=performance.now();runtime=await createScaleRuntime(source);const fixture=runtime.fixture;let model=runtime.model,dynamics=runtime.dynamics;
  assert.equal(fixture.cellCount,454913);assert.equal(fixture.terrainCount,401800);assert.equal(fixture.structureCount,53113);assert.equal(fixture.buildingCount,36);assert.equal(fixture.bounds.minY,-8);
  evidence.compile={...runtime.initialization,diagnostics:fixture.diagnostics,bounds:fixture.bounds};
  evidence.nativeInitialize={ms:performance.now()-at,authority:model.stats(),dynamics:dynamics.stats()};evidence.ready=memory();
  const anchors:Point[]=[{x:-45,y:3,z:43},{x:45,y:3,z:43},{x:0,y:3,z:-43}],used=new Set<string>();
  const targets=anchors.map(anchor=>{
   const region=fixture.regions.filter(r=>r.role==='building'&&!used.has(r.objectId)).sort((a,b)=>Math.hypot(a.center.x-anchor.x,a.center.y-anchor.y,a.center.z-anchor.z)-Math.hypot(b.center.x-anchor.x,b.center.y-anchor.y,b.center.z-anchor.z)||a.id.localeCompare(b.id))[0];
   assert.ok(region);used.add(region.objectId);return {objectId:region.objectId,position:{...region.center},regionId:region.id};
  });
  assert.equal(new Set(targets.map(t=>JSON.stringify(t.position))).size,3);evidence.targets=targets;
  const terrainState=()=>fixture.regions.filter(r=>r.role==='terrain').reduce((n,r)=>{const v=model.region(r.id)!;n.aliveCells+=v.aliveCellCount;n.hp+=v.hp;if(v.state==='gone')n.goneRegions++;if(v.state==='dynamic'||v.state==='rubble')n.movingRegions++;return n;},{aliveCells:0,hp:0,goneRegions:0,movingRegions:0});
  const craterSample=(center:Point)=>{let fullyOpenColumns=0,missingCells=0;for(let dx=-4;dx<=4;dx++)for(let dz=-4;dz<=4;dz++){let gone=0;for(let y=-8;y<=-1;y++){const id=source.idAt(Math.round(center.x)+dx,y,Math.round(center.z)+dz);if(id===null||model.cellHp(source.ordinal(id))<=0)gone++;}missingCells+=gone;if(gone===8)fullyOpenColumns++;}return {sample:'9 by 9 local columns, all 8 finite terrain layers',columns:81,layers:8,fullyOpenColumns,missingCells};};
  for(let i=0;i<targets.length;i++){
   const before=model.stats(),beforeNative=dynamics.stats(),terrainBefore=terrainState(),craterBefore=craterSample(targets[i].position),start=performance.now(),command={id:`native-city-nova-${i+1}`,epoch:model.epoch,sequence:i+1,position:targets[i].position,radius:TOOLS.nova.radius,damage:TOOLS.nova.strength,impulse:Math.min(16,TOOLS.nova.strength*.6)};
   const committed=runtime.blast(command),transaction=committed.transaction,commitMs=committed.totalMs;assert.equal(transaction.accepted,true);
   const authorityMs=committed.modelMs,colliderSyncMs=committed.collisionSyncMs;
   console.log('SCALE_NATIVE_COMMIT '+JSON.stringify({shot:i+1,center:command.position,commitMs,authorityMs,colliderSyncMs,changedRegions:transaction.changedRegionIds.length,detachedGroups:transaction.detachedGroups.length,authority:model.stats(),dynamics:dynamics.stats()}));
   let steps=0;const costs:number[]=[];const settleStart=performance.now();
   let active=model.stats().dynamicRegions>0||model.pendingDetachedGroups().length>0;
   while(active&&steps<maxSteps){const tick=performance.now();runtime.advance(1000/120);costs.push(performance.now()-tick);steps++;if(steps%30===0)active=model.stats().dynamicRegions>0||model.pendingDetachedGroups().length>0;}
   const final=model.stats(),native=dynamics.stats(),settled=final.dynamicRegions===0&&model.pendingDetachedGroups().length===0;
   const row={shot:i+1,command,transaction,commitMs,authorityMs,colliderSyncMs,acceptedToCollidersCpuMs:commitMs,settlement:{cpuMs:performance.now()-settleStart,steps,simulationSeconds:steps/120,stepCpu:summary(costs),observationLimitReached:!settled},settled,before,beforeNative,after:final,dynamics:native,crater:{before:terrainBefore,after:terrainState(),localBefore:craterBefore,localAfter:craterSample(command.position)},clock:runtime.clock.stats(),memory:memory()};
   evidence.shots.push(row);console.log('SCALE_NATIVE_SHOT '+JSON.stringify(row));
   if(!settled){evidence.status='incomplete-natural-settlement';break;}
  }
  evidence.primaryThreeNovaEnd=runtime.stats();
  evidence.rubbleRehits=[];
  if(evidence.shots.length===3&&evidence.shots.every((row:any)=>row.settled)){
   let priorTarget:string|undefined;
   for(let probe=1;probe<=2;probe++){
    const rubble=model.regionViews().filter(r=>r.state==='rubble'&&r.hp>0).sort((a,b)=>(a.id===priorTarget?-1:b.id===priorTarget?1:b.hp-a.hp));assert.ok(rubble.length,'real persistent rubble must remain for repeated damage');
    const target=rubble[0],boxes=model.activeBoxes(target.id);assert.ok(boxes.length);const local={x:boxes[0].center.x-target.center.x,y:boxes[0].center.y-target.center.y,z:boxes[0].center.z-target.center.z},q=target.rotation,tx=2*(q.y*local.z-q.z*local.y),ty=2*(q.z*local.x-q.x*local.z),tz=2*(q.x*local.y-q.y*local.x);
    const position={x:target.position.x+local.x+q.w*tx+q.y*tz-q.z*ty,y:target.position.y+local.y+q.w*ty+q.z*tx-q.x*tz,z:target.position.z+local.z+q.w*tz+q.x*ty-q.y*tx};
    const command={id:`native-persistent-rubble-pulse-${probe}`,epoch:model.epoch,sequence:3+probe,position,radius:TOOLS.pulse.radius,damage:TOOLS.pulse.strength,impulse:Math.min(16,TOOLS.pulse.strength*.6)},before=model.region(target.id)!,committed=runtime.blast(command),after=model.region(target.id)!;
    assert.equal(committed.transaction.accepted,true);assert.ok(after.hp<before.hp,'a fixed catalog pulse must damage persistent rubble at its current occupied world position');
    const duplicateBefore=hash(model.snapshot()),duplicate=runtime.blast(command);assert.equal(duplicate.transaction.accepted,false);assert.equal(hash(model.snapshot()),duplicateBefore,'same rubble damage cannot be credited twice');
    let steps=0;while(steps<maxSteps&&(model.stats().dynamicRegions>0||model.pendingDetachedGroups().length>0)){runtime.advance(1000/120);steps++;}
    assert.equal(model.stats().dynamicRegions,0);assert.equal(model.pendingDetachedGroups().length,0);
    evidence.rubbleRehits.push({probe,scope:'Additional fixed catalog pulse outside the three-nova performance sample',command,targetId:target.id,sameTargetAsPrior:target.id===priorTarget,before,after,commitMs:committed.totalMs,researchDelta:committed.transaction.researchDelta,duplicateRejected:true,naturalSteps:steps,afterSettlement:model.region(target.id),physics:dynamics.stats()});priorTarget=target.id;
   }
  }
  const saveAt=performance.now(),saved=dynamics.snapshot(),text=JSON.stringify(saved),modelHash=hash(model.snapshot());evidence.save={ms:performance.now()-saveAt,utf8Bytes:Buffer.byteLength(text),authorityHash:modelHash,physicsHash:hash(saved)};
  evidence.explicitEscapes=saved.impacts.filter(e=>e.reason==='escaped-world').map(e=>({...e,terminalAuthority:model.region(e.targetRegionId)}));
  // Only one full-city Rapier world exists at a time, including restore testing.
  runtime.dispose();runtime=undefined;evidence.afterDispose=memory();
  const restoreAt=performance.now();runtime=await createScaleRuntime(source);model=runtime.model;dynamics=runtime.dynamics;assert.equal(runtime.restore(JSON.parse(text)),true);
  const savedModel=structuredClone(saved.authority),restoredModel=model.snapshot();
  let maxPoseDifference=0;for(let i=0;i<savedModel.regions.length;i++)for(const field of ['position','rotation'] as const){const a=savedModel.regions[i][field],b=restoredModel.regions[i][field];for(const axis of Object.keys(a) as (keyof typeof a)[])maxPoseDifference=Math.max(maxPoseDifference,Math.abs(a[axis]-b[axis]));}
  const withoutPoses=(s:typeof savedModel)=>({...s,regions:s.regions.map(({position,rotation,...row})=>row)});assert.deepEqual(withoutPoses(restoredModel),withoutPoses(savedModel));assert.ok(maxPoseDifference<1e-5);
  evidence.restore={ms:performance.now()-restoreAt,maxPoseDifference,poseTolerance:1e-5,exactNonPoseAuthority:true,authorityHash:hash(model.snapshot()),authority:model.stats(),dynamics:dynamics.stats()};
  const beforePersistence=model.snapshot(),stable=hash(beforePersistence);for(let i=0;i<120;i++)runtime.advance(1000/120);
  const afterPersistence=model.snapshot();let maxRestoredPoseDrift=0;for(let i=0;i<beforePersistence.regions.length;i++)for(const field of ['position','rotation'] as const){const a=beforePersistence.regions[i][field],b=afterPersistence.regions[i][field];for(const axis of Object.keys(a) as (keyof typeof a)[])maxRestoredPoseDrift=Math.max(maxRestoredPoseDrift,Math.abs(a[axis]-b[axis]));}
  assert.deepEqual(withoutPoses(afterPersistence),withoutPoses(beforePersistence));assert.ok(maxRestoredPoseDrift<1e-5,'settled restore may only incur bounded native pose reprojection');
  evidence.restoredNaturalPersistence={unchangedExactPoseHash:hash(afterPersistence)===stable,maxRestoredPoseDrift,poseTolerance:1e-5,exactNonPoseAuthority:true,authority:model.stats(),dynamics:dynamics.stats()};
  evidence.gates=nativeGates(evidence.shots);evidence.status=evidence.shots.length===3&&evidence.shots.every((r:any)=>r.settled)?'completed-native-observations':evidence.status;
  evidence.verdict=evidence.gates.damageCommit&&evidence.gates.allNaturallySettled?'native-targets-observed-browser-unmeasured':'native-target-failed-or-incomplete';
  if(evidence.verdict!=='native-targets-observed-browser-unmeasured')process.exitCode=1;
 }catch(error){evidence.status='failed-or-incomplete';evidence.error=String(error instanceof Error?error.stack:error);process.exitCode=1;}
 finally{runtime?.dispose();evidence.after=memory();evidence.finishedAt=new Date().toISOString();console.log('SCALE_NATIVE_RESULT '+JSON.stringify(evidence));}
}

if(process.argv.includes('--self-test'))selfTest();
else if(process.argv.includes('--locality'))console.log('SCALE_LOCALITY_RESULT '+JSON.stringify(locality()));
else if(process.argv.includes('--city'))await city();
else throw new Error('Choose --self-test, --locality, or --city. Full city additionally requires SCALE_NATIVE_HEAVY_SLOT=granted.');
