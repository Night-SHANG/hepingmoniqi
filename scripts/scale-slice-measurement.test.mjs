import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

// Import the executable in its guaranteed browser-free mode. This also exercises
// startup ordering: helpers referenced by self-test must exist before dispatch.
const argv=process.argv;
process.argv=[...argv,'--self-test'];
let measurement;
try{measurement=await import('./scale-slice-browser-check.mjs');}finally{process.argv=argv;}

const damage={id:'command-1:0',epoch:3,geometryRevision:7,committedAt:1000};
const pose=(receivedAt,sentAt=receivedAt-5,extra={})=>({epoch:3,tick:receivedAt,geometryRevision:7,receivedAt,sentAt,boxes:10,...extra});
const upload=(key,at,extra={})=>({key,at,epoch:3,revision:7,damageIds:['command-1:0'],bytes:20,...extra});
const frame=(renderNo,at,finish,extra={})=>({renderNo,at,finishedAt:finish,pose:null,installedChunks:[],renderedChunks:[],effectIds:[],...extra});
const state=(extra={})=>({at:1600,summary:{epoch:3,geometryRevision:7,mesh:{pendingDirty:0,inFlightPatches:0}},presentation:{pending:0},poses:[],uploads:[],renders:[],...extra});
const tracker=()=>{assert.equal(typeof measurement.createDamageMeasurement,'function','damage visibility tracker must be exported for browser-free regression tests');return measurement.createDamageMeasurement(damage);};

test('freeze the first rendered eligible pose instead of chasing the latest receipt',()=>{
 const m=tracker(),first=pose(1050),newer=pose(1100),latest=pose(1200);
 measurement.observeDamageMeasurement(m,state({poses:[first,newer],lastPose:newer,renders:[frame(1,1060,1080,{pose:first})]}));
 assert.equal(m.fixedPose.receivedAt,1050);assert.equal(m.poseRender.finishedAt,1080);
 measurement.observeDamageMeasurement(m,state({poses:[first,newer,latest],lastPose:latest,renders:[frame(2,1150,1180,{pose:newer})]}));
 assert.equal(m.fixedPose.receivedAt,1050);assert.equal(m.poseRender.finishedAt,1080);
});

test('skip never-rendered received poses without crediting them as rendered',()=>{
 const m=tracker(),skipped=pose(1030),shown=pose(1050);
 measurement.observeDamageMeasurement(m,state({poses:[skipped,shown],renders:[frame(1,1060,1080,{pose:shown})]}));
 assert.equal(m.firstEligibleReceivedPose.receivedAt,1030);
 assert.equal(m.fixedPose.receivedAt,1050);assert.equal(m.skippedEligiblePoseCount,1);
});

test('separate VFX, first changed chunk, all patch upload, static render and fixed pose timing',()=>{
 const m=tracker(),p=pose(1040),a=upload('a',1100),b=upload('b',1250);
 measurement.observeDamageMeasurement(m,state({at:1210,summary:{epoch:3,geometryRevision:7,mesh:{pendingDirty:1,inFlightPatches:0}},poses:[p],uploads:[a],renders:[frame(1,1050,1070,{pose:p,effectIds:['command-1:0']}),frame(2,1110,1140,{pose:p,installedChunks:[a],renderedChunks:[a]})]}));
 assert.equal(m.firstVfxRender.finishedAt,1070);assert.equal(m.firstDamagedChunkRender.finishedAt,1140);assert.equal(m.allPatchUploads,null);
 measurement.observeDamageMeasurement(m,state({poses:[p],uploads:[a,b],renders:[frame(3,1260,1300,{pose:p,installedChunks:[b],renderedChunks:[b]}),frame(4,1400,1450,{pose:pose(1350)})]}));
 const result=measurement.damageMeasurementResult(m);
 assert.equal(result.firstVfxVisibleMs,70);assert.equal(result.firstDamagedChunkVisibleMs,140);assert.equal(result.allPatchUploadsMs,250);
 assert.equal(result.staticVisibleMs,300);assert.equal(result.fixedPoseVisibleMs,70);assert.equal(result.visibleMs,300);
 assert.equal(result.staticVisibleEvidence.observedAt,1600,'poll time must be recorded but never substituted for render time');
});

test('reject stale epochs, unrelated chunks and poses sent before commit',()=>{
 const m=tracker(),stale=pose(1040,1035,{epoch:2}),before=pose(1060,990),wrong=upload('x',1100,{damageIds:['other']}),old=upload('y',1110,{epoch:2});
 measurement.observeDamageMeasurement(m,state({poses:[stale,before],uploads:[wrong,old],renders:[frame(1,1120,1150,{pose:stale,installedChunks:[wrong,old],renderedChunks:[wrong,old],effectIds:['other']})]}));
 assert.equal(m.fixedPose,null);assert.equal(m.firstDamagedChunkRender,null);assert.equal(m.firstVfxRender,null);assert.equal(m.allPatchUploads,null);
 assert.equal(measurement.damageMeasurementResult(m).visibleMs,null);
});

test('a changed chunk upload is not a rendered frame and a frame predating upload is not all-visible',()=>{
 const m=tracker(),a=upload('a',1200),p=pose(1040);
 measurement.observeDamageMeasurement(m,state({poses:[p],uploads:[a],renders:[frame(1,1100,1250,{pose:p})]}));
 assert.equal(m.firstDamagedChunkRender,null);assert.equal(m.allPatchUploads.at,1200);assert.equal(m.allStaticRender,null);
 assert.equal(measurement.damageMeasurementResult(m).staticVisibleMs,null);
});

test('segment and GL attribution is bounded but retains counts and maxima',()=>{
 assert.equal(typeof measurement.summarizeAttribution,'function');
 const costs=Array.from({length:30},(_,i)=>({kind:i%2?'render':'message-poses',at:1000+i,ms:i+1}));
 const renders=[frame(1,1000,1040,{renderInfo:{calls:24,triangles:1000},installedChunks:[],effectIds:[]})];
 const glMetrics={calls:{texImage2D:{count:999,totalMs:999,maxMs:999}},rows:Array.from({length:40},(_,i)=>({method:'texImage2D',phase:'render',at:1000+i,ms:i+1})),dropped:2};
 const a=measurement.summarizeAttribution(costs,renders,glMetrics,1000,1100);
 assert.equal(a.segments.render.count,15);assert.equal(a.segments.render.max,30);assert.equal(a.topCosts.length,8);assert.equal(a.topCosts[0].ms,30);
 assert.equal(a.gl.windowMethods.texImage2D.count,40);assert.equal(a.gl.windowMethods.texImage2D.max,40);assert.equal(a.gl.topCalls.length,8);assert.equal(a.gl.dropped,2);
 assert.equal(a.renderInfo.calls.max,24);assert.equal(a.renderInfo.triangles.max,1000);
});

test('CLI self-test executes runtime-used helpers before top-level dispatch can leave them uninitialized',()=>{
 const r=spawnSync(process.execPath,['scripts/scale-slice-browser-check.mjs','--self-test'],{encoding:'utf8',cwd:new URL('..',import.meta.url)});
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Scale browser gate self-tests passed/);
});

test('an unsubmitted offscreen chunk cannot satisfy first visible destruction',()=>{
 const m=tracker(),a=upload('a',1100);
 measurement.observeDamageMeasurement(m,state({uploads:[a],renders:[frame(1,1110,1140,{installedChunks:[a],renderedChunks:[]})]}));
 assert.equal(m.firstDamagedChunkRender,null);
 measurement.observeDamageMeasurement(m,state({uploads:[a],renders:[frame(2,1200,1230,{installedChunks:[],renderedChunks:[a]})]}));
 assert.equal(m.firstDamagedChunkRender.finishedAt,1230);
});

test('a render pose without matching receipt evidence is not credited',()=>{
 const m=tracker();measurement.observeDamageMeasurement(m,state({renders:[frame(1,1060,1080,{pose:pose(1050)})]}));assert.equal(m.poseRender,null);
});

test('self-test detects the original helper-after-await temporal-dead-zone mutation',async()=>{
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'scale-harness-tdz-'));
 try{
  const source=await readFile(new URL('./scale-slice-browser-check.mjs',import.meta.url),'utf8');
  const mutant=source.replace(/function distance\(a,b\)\{return Math\.hypot\(a\.x-b\.x,a\.y-b\.y,a\.z-b\.z\);\}/,'')+'\nconst distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);\n';
  const path=join(dir,'scale-slice-browser-check.mjs');await writeFile(path,mutant);
  const r=spawnSync(process.execPath,[path,'--self-test'],{encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/Cannot access 'distance' before initialization/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('direct transaction completes without waiting for later independent collapse dirty work',()=>{
 const m=measurement.createDamageMeasurement({...damage,expectedChunkKeys:['a','b']});
 const a=upload('a',1100),b=upload('b',1200);
 measurement.observeDamageMeasurement(m,state({summary:{epoch:3,geometryRevision:9,mesh:{pendingDirty:5,inFlightPatches:2}},uploads:[a,b],renders:[frame(1,1210,1220)],presentation:{pending:3}}));
 const result=measurement.damageMeasurementResult(m);
 assert.equal(result.staticVisibleMs,220);assert.equal(result.allPatchUploadsMs,200);
 assert.equal(result.staticVisibleEvidence.allPatchUploads.scope,'direct-transaction');
});
