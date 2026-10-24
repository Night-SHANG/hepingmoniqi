import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import * as THREE from 'three';
import {createGameFixture,gameCellVoxel} from '../src/structural/game-fixtures.js';
import {createVoxelInstanceRenderer} from '../src/voxel-renderer.js';
import type {MapId,Voxel} from '../src/contracts.js';

const map=(process.argv[2]??'courtyard') as MapId;
if(!['courtyard','neighborhood','city'].includes(map))throw new Error('Unsupported profile map');
const output=process.argv[3];
const identity=Object.freeze({x:0,y:0,z:0,w:1}),unit=Object.freeze({x:1,y:1,z:1});
const frozen=(v:Voxel):Voxel=>Object.freeze({...v,position:Object.freeze(v.position),rotation:v.rotation&&Object.freeze(v.rotation),size:unit});
const measure=<T>(fn:()=>T)=>{const start=performance.now(),value=fn();return {value,ms:performance.now()-start};};
const generated=measure(()=>createGameFixture(map)),fixture=generated.value;
const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
const renderer=createVoxelInstanceRenderer(scene,geometry,material);
let preview:readonly Voxel[]|undefined=measure(()=>fixture.cells.map(c=>gameCellVoxel(c))).value;
const previewSet=measure(()=>renderer.set(preview!)),previewDiagnostics=renderer.getDiagnostics();
const authoritative=measure(()=>Object.freeze(fixture.cells.map(c=>frozen({...gameCellVoxel(c),rotation:identity}))));
const rebind=measure(()=>renderer.set(authoritative.value)),rebindDiagnostics=renderer.getDiagnostics();preview=undefined;
const idle=measure(()=>{for(let frame=0;frame<120;frame++)renderer.set(authoritative.value);});
const idleDiagnostics=renderer.getDiagnostics();
let current=authoritative.value;const movingIndex=current.findIndex(v=>v.role==='building');
const movingTimes:number[]=[],arrayTimes:number[]=[];
for(let frame=0;frame<30;frame++){
 const update=measure(()=>{const next=[...current],prior=next[movingIndex];next[movingIndex]=frozen({...prior,position:{...prior.position,y:prior.position.y+.01},structuralState:'dynamic'});return Object.freeze(next);});
 current=update.value;arrayTimes.push(update.ms);movingTimes.push(measure(()=>renderer.set(current)).ms);
}
const movingDiagnostics=renderer.getDiagnostics();
const sum=(a:number[])=>a.reduce((n,v)=>n+v,0);
const result={map,cells:fixture.cells.length,fixtureMs:generated.ms,previewSetMs:previewSet.ms,preview:previewDiagnostics,authorityMappingMs:authoritative.ms,rebindMs:rebind.ms,rebind:rebindDiagnostics,idle120Ms:idle.ms,idle:idleDiagnostics,moving30SetMs:sum(movingTimes),movingAverageSetMs:sum(movingTimes)/movingTimes.length,movingArrayCopyMs:sum(arrayTimes),moving:movingDiagnostics,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),peakRssMiB:Math.round(process.resourceUsage().maxRSS/1024),includesRapier:false,includesWebGL:false,evidence:'Native CPU fixture/instance preparation only. No GPU, browser, shadow rendering or full startup timing.'};
console.log(JSON.stringify(result,null,2));if(output)writeFileSync(output,JSON.stringify(result,null,2));
renderer.dispose();geometry.dispose();material.dispose();
