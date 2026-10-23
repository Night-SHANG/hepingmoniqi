import {performance} from 'node:perf_hooks';
import {createStructuralFixture} from '../src/structural/fixtures.js';
import {createStructuralSimulation} from '../src/structural/simulation.js';
const map=(process.argv[2]??'lab') as 'lab'|'neighborhood'|'city';
if(!['lab','neighborhood','city'].includes(map))throw new Error('Invalid map');
const start=performance.now();const fixture=createStructuralFixture(map);const generated=performance.now();
const before=process.memoryUsage();const sim=await createStructuralSimulation(fixture,{maxActiveBodies:24});const initialized=performance.now();
console.log(JSON.stringify({map,cells:fixture.cells.length,buildings:new Set(fixture.cells.filter(c=>c.role==='building').map(c=>c.objectId)).size,generationMs:generated-start,initializationMs:initialized-generated,pending:sim.pending(),memoryBefore:before,memoryAfter:process.memoryUsage(),evidence:'Cloud Node CPU/static initialization only. No browser, GPU or active city collapse performance claim.'},null,2));
sim.dispose();
