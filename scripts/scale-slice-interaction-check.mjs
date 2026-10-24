import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Prepared CI harness. --self-test is browser-free. All browser mutations below
// are ordinary visible UI actions; diagnostics/project only read application data.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function assertDeeperImpact(target,damage){
 assert.equal(damage.weapon,'pulse');assert.equal(damage.transaction.accepted,true);assert.ok(damage.transaction.changedRegionCount>0,'Impact must damage real surviving regions');
 assert.ok(damage.position.y<target.y-.5,'Actual impact must be below the old selected surface');
 assert.ok(distance(damage.position,target)>.5,'A frozen old aim point is not a collision position');
}
export function assertPaused(before,after){
 assert.equal(before.summary.paused,true);assert.equal(after.summary.paused,true);
 assert.equal(before.summary.stats.physics.projectileCount,1);assert.equal(after.summary.stats.physics.projectileCount,1);
 assert.equal(before.lastProjectiles.length,1);assert.deepEqual(after.lastProjectiles,before.lastProjectiles,'Paused projectile position and velocity must not advance');
 for(const key of ['processedMs','requestedMs','steps'])assert.equal(after.summary.stats.clock[key],before.summary.stats.clock[key],`Paused clock ${key} must freeze`);
 assert.equal(after.summary.stats.physics.steps,before.summary.stats.physics.steps,'Paused physics steps must freeze');
 assert.equal(after.summary.geometryRevision,before.summary.geometryRevision,'Paused geometry must freeze');
 assert.deepEqual(after.events.map(e=>e.id),before.events.map(e=>e.id),'No new damage may happen during pause');
}

function selfTest(){
 const target={x:3,y:-.5,z:10},damage={weapon:'pulse',position:{x:2.4,y:-1.2,z:9.5},transaction:{accepted:true,changedRegionCount:3}};
 assert.doesNotThrow(()=>assertDeeperImpact(target,damage));
 assert.throws(()=>assertDeeperImpact(target,{...damage,position:target}),/old selected surface/);
 assert.throws(()=>assertDeeperImpact(target,{...damage,transaction:{accepted:false,changedRegionCount:0}}));
 const paused={summary:{paused:true,geometryRevision:1,stats:{clock:{processedMs:200,requestedMs:204,steps:24},physics:{steps:24,projectileCount:1}}},lastProjectiles:[{id:'flight',position:{x:20,y:12,z:20},velocity:{x:-20,y:-10,z:-20},radius:.3}],events:[{id:'first'}]};
 assert.doesNotThrow(()=>assertPaused(paused,structuredClone(paused)));
 const moved=structuredClone(paused);moved.lastProjectiles[0].position.y-=.01;assert.throws(()=>assertPaused(paused,moved),/projectile/);
 const advanced=structuredClone(paused);advanced.summary.stats.clock.processedMs++;assert.throws(()=>assertPaused(paused,advanced),/clock/);
 const exploded=structuredClone(paused);exploded.events.push({id:'flight:impact'});assert.throws(()=>assertPaused(paused,exploded),/damage/);
 console.log('Scale interaction validator self-tests passed. No browser imported, launched or connected.');
}

async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true','Only separately authorized GitHub CI may run this harness');
 assert.equal(process.env.QA_BROWSER_CHANNEL,'chrome','Use existing preinstalled Chrome only');
 assert.equal(process.env.QA_SCALE_SLICE_AUTHORIZED,'true','This isolated slice needs its authorized bounded CI run');
 const {chromium}=await import('@playwright/test'),{tsImport}=await import('tsx/esm/api');
 const {preflightScaleInteraction}=await tsImport('./scale-slice-interaction-preflight.ts',import.meta.url);
 const native=await preflightScaleInteraction();
 const url=process.env.GAME_URL??'http://127.0.0.1:5192/scale-slice.html',output=process.env.QA_OUTPUT??'artifacts/scale-slice-interaction';
 const limit=Number(process.env.QA_OVERALL_TIMEOUT_MS??180000);assert.ok(Number.isSafeInteger(limit)&&limit>=30000&&limit<=240000);
 const evidence={schema:'scale-real-ui-interaction/v1',status:'running',startedAt:new Date().toISOString(),url,
  provenance:{execution:'Authorized GitHub CI; preinstalled Chrome; software WebGL',commit:process.env.GITHUB_SHA??null,runId:process.env.GITHUB_RUN_ID??null,attempt:process.env.GITHUB_RUN_ATTEMPT??null},
  scope:{entry:'Isolated scale-slice.html, not production main',map:'courtyard',weapon:'pulse',radius:3.5,strength:9,hiddenStateMutations:false,clockOverrides:false,uiOrder:['initialize courtyard','select pulse','real canvas aim','place','detonate','pause','launch into the existing hole while paused','observe active sphere frozen','resume','actual deeper collision','dispose','re-enter pristine world'],observationLimitMs:limit},
  limitations:['This is a bounded interaction smoke, not a performance benchmark or full game acceptance.','Pause is selected before launch to avoid a roughly one-second flight racing software-browser automation. The launched real sphere remains active and frozen, then resumes into the existing hole.','The native preflight independently raycasts generated material meshes; browser evidence uses real UI target selection, actual damage/mesh submissions, worker projectile poses and collision damage positions.','Screenshots are taken only after all interaction checks and re-entry, so they show the reset world rather than an in-flight frame.'],
  native,checks:{},commands:[],projectileSamples:[],errors:[],consoleErrors:[],screenshots:[]};
 await fs.mkdir(output,{recursive:true});const persist=()=>fs.writeFile(`${output}/results.json`,JSON.stringify(evidence,null,2));
 const started=Date.now();let browser,page,fatal,stage='boot';
 const deadline=()=>assert.ok(Date.now()-started<limit,`Observation deadline reached during ${stage}; an unfinished check is not a pass`);
 const watchdog=setTimeout(()=>{evidence.status='failed-observation-deadline';evidence.failure=`Timed out during ${stage}`;void persist().finally(()=>browser?.close());},limit);watchdog.unref();
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-webgl']});
  evidence.provenance.browserVersion=browser.version();page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000);
  page.on('pageerror',error=>{fatal=String(error);if(evidence.errors.length<20)evidence.errors.push(fatal);});page.on('console',message=>{if(message.type()==='error'&&evidence.consoleErrors.length<20)evidence.consoleErrors.push(message.text().slice(0,1000));});
  await page.addInitScript(()=>{const clicks=[];Object.defineProperty(window,'__scaleInteractionObserver',{value:clicks});addEventListener('click',event=>{if(event.isTrusted&&clicks.length<64)clicks.push({at:performance.timeOrigin+event.timeStamp,id:event.target?.id??null,tag:event.target?.tagName??null});},true);});
  await page.goto(url);await page.waitForFunction(()=>typeof window.__scaleSlice?.diagnostics==='function');
  const read=async()=>{
   deadline();if(fatal)throw new Error(fatal);
   const d=await page.evaluate(()=>{const d=window.__scaleSlice.diagnostics();return {at:performance.timeOrigin+performance.now(),summary:d.summary,ready:d.ready,target:d.target,lastPose:d.lastPose,lastProjectiles:d.lastProjectiles,events:d.events,commands:d.commands,errors:d.errors,currentMesh:d.currentMesh,presentation:d.presentation,uploads:d.uploads,renders:d.renders.slice(-8),worldsReported:d.worldsReported};});
   assert.deepEqual(d.errors,[],'Application diagnostics must stay error-free');assert.ok(Array.isArray(d.lastProjectiles),'Read-only actual projectile poses are required');return d;
  };
  const wait=async(label,predicate,ms=20000)=>{
   stage=label;const until=Date.now()+ms;
   while(true){const d=await read();if(predicate(d))return d;assert.ok(Date.now()<until,`Timed out waiting for ${label}`);await page.waitForTimeout(60);}
  };
  const issue=async(kind,button=kind)=>{
   const known=new Set((await read()).commands.map(c=>c.id));await page.locator(`#${button}`).click();
   const d=await wait(`${kind} acknowledgment`,d=>d.commands.some(c=>!known.has(c.id)&&c.kind===kind&&c.ack));
   const row=d.commands.find(c=>!known.has(c.id)&&c.kind===kind);assert.equal(row.ack.accepted,true,`${kind} rejected: ${row.ack.reason??''}`);evidence.commands.push(row);return row;
  };
  const meshReady=d=>d.ready&&!!d.summary&&!d.summary.mesh.pendingDirty&&!d.summary.mesh.inFlightPatches&&!d.presentation.pending&&d.currentMesh.chunks>0;
  const idle=d=>meshReady(d)&&d.summary.stats.physics.activeBodyCount===0&&d.summary.stats.physics.projectileCount===0&&d.summary.stats.physics.pendingGroups===0&&d.summary.stats.clock.debtMs<100;
  const selected=async point=>{
   const pixel=await page.evaluate(point=>window.__scaleSlice.project(point),point);assert.equal(pixel.visible,true);
   const top=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,pixel);assert.equal(top,'CANVAS','UI overlay must not intercept the terrain selection');
   await page.mouse.click(pixel.x,pixel.y);const d=await wait('actual canvas terrain selection',d=>!!d.target);return {pixel,target:d.target};
  };
  await page.locator('#map').selectOption('courtyard');await issue('initialize');
  const pristine=await wait('pristine courtyard rendered',idle,90000);assert.equal(pristine.worldsReported,1);assert.equal(pristine.summary.fixture.cellCount,native.fixture.cellCount);assert.equal(pristine.summary.stats.model.aliveCells,native.fixture.cellCount);assert.equal(pristine.target,null);assert.equal(pristine.summary.geometryRevision,0);
  evidence.pristine={worldId:pristine.summary.worldId,epoch:pristine.summary.epoch,fixture:pristine.summary.fixture,model:pristine.summary.stats.model,mesh:pristine.currentMesh};
  await page.locator('#weapon').selectOption('pulse');
  const selection=await selected(native.target);assert.ok(distance(selection.target.position,native.target)<.08);assert.ok(selection.target.normal.y>.99);evidence.selection=selection;
  await issue('place');await wait('one real placement',d=>d.summary.placed===1);
  const detonate=await issue('detonate'),committed=await wait('real placed pulse damage',d=>d.events.some(e=>e.id===`${detonate.id}:0`));
  const crater=committed.events.find(e=>e.id===`${detonate.id}:0`);assert.equal(crater.weapon,'pulse');assert.equal(crater.transaction.accepted,true);assert.ok(crater.transaction.changedRegionCount>0);assert.ok(distance(crater.position,selection.target.position)<1e-6);assert.ok(crater.geometryRevision>pristine.summary.geometryRevision);evidence.crater=crater;
  const craterReady=await wait('real crater mesh rendered',d=>idle(d)&&d.uploads.some(u=>u.damageIds.includes(crater.id))&&d.renders.some(r=>r.finishedAt>=crater.committedAt&&r.geometryRevision>=crater.geometryRevision));
  assert.ok(craterReady.summary.stats.model.aliveCells<pristine.summary.stats.model.aliveCells,'First pulse must remove actual cells, not only show VFX');assert.deepEqual(craterReady.target,selection.target,'The original selected point must remain unchanged after the hole opens');
  evidence.craterState={aliveCells:craterReady.summary.stats.model.aliveCells,geometryRevision:craterReady.summary.geometryRevision,placed:craterReady.summary.placed,changedMeshUploads:craterReady.uploads.filter(u=>u.damageIds.includes(crater.id)).map(({key,revision,at})=>({key,revision,at})).slice(0,16)};assert.equal(craterReady.summary.placed,0);evidence.checks.realTerrainCrater=true;
  await issue('clock','pause');await wait('pause acknowledged',d=>d.summary.paused===true);
  const launch=await issue('launch');
  const frozen=await wait('active real projectile present while paused',d=>d.summary.paused&&d.summary.stats.physics.projectileCount===1&&d.lastProjectiles.some(p=>p.id===launch.id));
  const sphere=frozen.lastProjectiles.find(p=>p.id===launch.id);assert.equal(sphere.radius,.3);assert.ok(sphere.position.y>selection.target.position.y+2);assert.ok(Math.hypot(sphere.velocity.x,sphere.velocity.y,sphere.velocity.z)>1);assert.deepEqual(frozen.target,selection.target);
  await page.waitForTimeout(600);
  const stillFrozen=await wait('fresh paused worker observation',d=>d.summary.at>=frozen.summary.at+400);
  assertPaused(frozen,stillFrozen);evidence.pause={wallMs:stillFrozen.at-frozen.at,first:{at:frozen.summary.at,clock:frozen.summary.stats.clock,projectiles:frozen.lastProjectiles},last:{at:stillFrozen.summary.at,clock:stillFrozen.summary.stats.clock,projectiles:stillFrozen.lastProjectiles}};evidence.checks.pausedActiveProjectileAndClockFrozen=true;
  await issue('clock','pause');
  const collision=await wait('resumed projectile actual deeper impact',d=>{
   if(evidence.projectileSamples.length<48)for(const p of d.lastProjectiles)if(p.id===launch.id)evidence.projectileSamples.push({at:d.at,tick:d.lastPose?.tick,...p});
   return d.events.some(e=>e.id===`${launch.id}:impact`);
  },20000);
  const impact=collision.events.find(e=>e.id===`${launch.id}:impact`);assertDeeperImpact(selection.target.position,impact);assert.equal(collision.summary.paused,false);assert.ok(collision.summary.stats.clock.processedMs>stillFrozen.summary.stats.clock.processedMs);assert.deepEqual(collision.target,selection.target,'Launch must not secretly retarget to a new point');evidence.impact=impact;evidence.checks.oldAimNotUsedAsExplosionPosition=true;
  const settled=await wait('post-impact natural settlement',idle,30000);assert.equal(settled.lastProjectiles.length,0);assert.ok(settled.summary.stats.model.aliveCells<craterReady.summary.stats.model.aliveCells);assert.equal(settled.summary.stats.clock.discardedMs,0);evidence.settled={worldId:settled.summary.worldId,geometryRevision:settled.summary.geometryRevision,model:settled.summary.stats.model,physics:settled.summary.stats.physics,clock:settled.summary.stats.clock};
  // Only now use another real click to inspect the hole. Never replace the old
  // target before the projectile has collided.
  const hole=await selected(native.target);assert.ok(hole.target.position.y<selection.target.position.y-.5,'Real post-impact canvas hit must expose the hole');evidence.holeSelection=hole;evidence.checks.realCanvasHoleSurface=true;
  await issue('dispose');
  const disposed=await wait('released world and render state',d=>d.summary===null&&d.worldsReported===0&&d.currentMesh.chunks===0&&d.lastProjectiles.length===0&&d.target===null);
  evidence.disposed={worldsReported:disposed.worldsReported,mesh:disposed.currentMesh,target:disposed.target,projectiles:disposed.lastProjectiles};
  await issue('initialize');const reentered=await wait('re-entered pristine courtyard',idle,90000);
  assert.notEqual(reentered.summary.worldId,pristine.summary.worldId);assert.equal(reentered.worldsReported,1);assert.equal(reentered.target,null);assert.equal(reentered.lastProjectiles.length,0);assert.equal(reentered.summary.placed,0);assert.equal(reentered.summary.geometryRevision,0);assert.equal(reentered.summary.paused,false);
  for(const key of ['aliveCells','staticRegions','dynamicRegions','rubbleRegions','goneRegions','maskRegions','research'])assert.equal(reentered.summary.stats.model[key],pristine.summary.stats.model[key],`Re-entered ${key} must not carry damaged state`);
  const restoredSurface=await selected(native.target);assert.ok(distance(restoredSurface.target.position,selection.target.position)<.08);assert.ok(restoredSurface.target.normal.y>.99);
  evidence.reentered={worldId:reentered.summary.worldId,model:reentered.summary.stats.model,mesh:reentered.currentMesh,targetBeforeClick:reentered.target,restoredSurface};evidence.checks.releaseAndReentryResetWorld=true;
  const trusted=await page.evaluate(()=>window.__scaleInteractionObserver);for(const id of ['initialize','place','detonate','launch','pause','dispose'])assert.ok(trusted.some(c=>c.id===id),`Real trusted ${id} click required`);assert.ok(trusted.filter(c=>c.tag==='CANVAS').length>=3);evidence.trustedClicks=trusted;
  assert.deepEqual(evidence.errors,[]);assert.deepEqual(evidence.consoleErrors,[]);evidence.checks.noCrash=true;
  // Every smoke assertion above is complete before screenshot work starts.
  stage='post-smoke screenshot';let jpg=await page.locator('#viewport canvas').screenshot({type:'jpeg',quality:55});if(jpg.length>240000)jpg=await page.locator('#viewport canvas').screenshot({type:'jpeg',quality:25});assert.ok(jpg.length<=300000,'Screenshot log must stay bounded');
  const name='reentered-pristine-after-smoke.jpg';await fs.writeFile(`${output}/${name}`,jpg);evidence.screenshots.push({name,bytes:jpg.length,afterSmoke:true});console.log('SCREENSHOT_BASE64 '+JSON.stringify({name,data:jpg.toString('base64')}));
  await issue('dispose');await wait('final release',d=>d.summary===null&&d.currentMesh.chunks===0&&d.lastProjectiles.length===0);
  evidence.status='passed-real-browser-interaction-smoke';
 }catch(error){evidence.status='failed-or-incomplete';evidence.failure=String(error?.stack??error);evidence.failureStage=stage;process.exitCode=1;}
 finally{clearTimeout(watchdog);evidence.finishedAt=new Date().toISOString();evidence.elapsedMs=Date.now()-started;await persist();console.log('SCALE_INTERACTION_RESULT '+JSON.stringify(evidence));await browser?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.includes('--self-test'))selfTest();else await main();}
