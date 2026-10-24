// Read-only baseline oracle. Imports inventory/compiler only, NEVER a physics runtime.
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const baseline=path.resolve(process.argv[2]??path.join(here,'../../../hepingmoniqi-v09'));
const {tsImport}=await import(pathToFileURL(path.join(baseline,'node_modules/tsx/dist/esm/api/index.mjs')).href);
const {createCompactGameFixture}=await tsImport(path.join(baseline,'src/compact/fixture.ts'),import.meta.url);
const {compileScaleFixture}=await tsImport(path.join(baseline,'src/scale-slice/fixture.ts'),import.meta.url);
const {TOOLS}=await tsImport(path.join(baseline,'src/content-catalog.ts'),import.meta.url);
const hash=v=>createHash('sha256').update(v).digest('hex');
const source=createCompactGameFixture('city');
const ids=Array.from({length:source.count},(_,i)=>source.idAtOrdinal(i)).sort((a,b)=>a-b);
const digest=createHash('sha256');digest.update('heping-independent-cell-inventory/v1\n');
const perBuilding={},perMaterial={},perLayer={},positions=new Set();let duplicatePositions=0,duplicateIds=0,objectiveCount=0,objectiveWeight=0,anchorCount=0,priorId=null;
function str(s){const v=Buffer.from(s,'utf8'),n=Buffer.alloc(4);n.writeUInt32LE(v.length);return Buffer.concat([n,v]);}
for(const id of ids){
 if(id===priorId)duplicateIds++;priorId=id;
 const x=source.xOf(id),y=source.yOf(id),z=source.zOf(id),hp=source.hpOf(id),maxHp=source.maxHpOf(id),color=source.colorOf(id),material=source.materialOf(id),role=source.roleOf(id),objectId=source.objectIdOf(id),objective=source.objectiveOf(id),anchor=source.anchorOf(id)===true;
 const b=Buffer.alloc(42);b.writeBigInt64LE(BigInt(id),0);b.writeInt32LE(x,8);b.writeInt32LE(y,12);b.writeInt32LE(z,16);b.writeDoubleLE(hp,20);b.writeDoubleLE(maxHp,28);b.writeUInt32LE(color,36);b[40]=Number(objective);b[41]=Number(anchor);digest.update(b);digest.update(str(material));digest.update(str(role));digest.update(str(objectId));
 const p=`${x},${y},${z}`;if(positions.has(p))duplicatePositions++;positions.add(p);
 perMaterial[material]=(perMaterial[material]??0)+1;
 if(role==='terrain')perLayer[y]=(perLayer[y]??0)+1;
 if(role==='building'||role==='foundation')perBuilding[objectId]=(perBuilding[objectId]??0)+1;
 if(objective){objectiveCount++;objectiveWeight+=maxHp;}if(anchor)anchorCount++;
}
const fixture=compileScaleFixture(source),anchors=[{x:-45,y:3,z:43},{x:45,y:3,z:43},{x:0,y:3,z:-43}],used=new Set();
const nativeShots=anchors.map((anchor,i)=>{
 const region=fixture.regions.filter(r=>r.role==='building'&&!used.has(r.objectId)).sort((a,b)=>Math.hypot(a.center.x-anchor.x,a.center.y-anchor.y,a.center.z-anchor.z)-Math.hypot(b.center.x-anchor.x,b.center.y-anchor.y,b.center.z-anchor.z)||a.id.localeCompare(b.id))[0];used.add(region.objectId);
 return {id:`native-city-nova-${i+1}`,sequence:i+1,position:region.center,radius:TOOLS.nova.radius,damage:TOOLS.nova.strength,impulse:Math.min(16,TOOLS.nova.strength*.6),power:1,objectId:region.objectId,regionId:region.id,pristineCandidateCellCount:source.idsInSphere(region.center,TOOLS.nova.radius).length};
});
const summary=JSON.parse(fs.readFileSync(path.join(baseline,'artifacts/scale-ci-40087965996/summary.json'),'utf8'));
const result={schema:'heping-independent-inventory-oracle/v1',provenance:{baselineCommit:summary.commit,baselineRun:summary.run,sourceFiles:Object.fromEntries(['src/compact/fixture.ts','src/scale-slice/fixture.ts','src/content-catalog.ts','src/world-layout.ts','src/structural/game-fixtures.ts','src/domain.ts','artifacts/scale-ci-40087965996/summary.json'].map(f=>[f,hash(fs.readFileSync(path.join(baseline,f)))]))},
 scope:{oracleOnly:true,livePhysicsWorldsCreatedByOracle:0,sameCentersAsHistoricalBrowserProven:false,notes:'Fixed native shots follow the existing native profile algorithm. Historical browser picks were surface-dependent and are not recorded by the supplied summary; do not claim paired browser centers.'},
 fixture:{id:source.id,recipeId:source.recipeId,cellCount:source.count,structureCount:source.structureCount,terrainCount:source.terrainCount,buildingCount:Object.keys(perBuilding).length,bounds:source.bounds,terrainLayers:Object.keys(perLayer).map(Number).sort((a,b)=>a-b),inventorySha256:digest.digest('hex'),canonicalEncoding:'heping-independent-cell-inventory/v1',objectiveCount,objectiveWeight,anchorCount,duplicatePositions,duplicateIds,perBuilding,perMaterial,perLayer,baselineRegionalSignature:fixture.signature,baselineRegionCount:fixture.regions.length,baselineBoxCount:fixture.diagnostics.boxCount},nativeShots,
 historicalBrowserObservations:summary.shots.map(s=>({shot:s.shot,damageCommitMs:s.damageCommitMs,inputP95Ms:s.input.p95,allDirectStaticVisibleMs:s.allDirectStaticVisibleMs,naturalRecoveryWallMs:s.naturalRecoveryWallMs,gates:s.gates})),
 targets:{inputP95MsExclusive:100,maxMainThreadStallMsExclusive:100,damagePlusCollisionMsExclusive:250,allDirectStaticRenderedMsExclusive:500,completeVisibleMsExclusive:500,finalDebtMsExclusive:100},limitations:['Historical browser software-rendered timings and headless Godot CPU timings are different measurement surfaces.','Equal inventory does not imply identical physics trajectory or exact old per-cell damage semantics.','No native GPU/display or trusted input evidence is created by this oracle.']};
fs.writeFileSync(path.join(here,'oracle-manifest.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({status:'oracle-generated',inventorySha256:result.fixture.inventorySha256,cellCount:source.count,nativeShots,physicsWorldsCreated:0}));
