import {performance} from 'node:perf_hooks';
import {createStructuralGameWorld} from '../src/structural/game-world.js';
const memory=()=>({...process.memoryUsage(),maxRSSKiB:process.resourceUsage().maxRSS});
const result:any={scope:'native compact single-world initialization, not browser/FPS',before:memory()};
const world=createStructuralGameWorld({free:true});
let at=performance.now();await world.loadMap('city',true);result.startMs=performance.now()-at;
const binding=world.getRenderBinding()!;result.authority={count:binding.fixture.count,terrain:binding.fixture.terrainCount,structures:binding.fixture.structureCount,storage:binding.diagnostics(),aggregate:binding.aggregate()};result.entered=memory();
if(global.gc){global.gc();result.enteredForcedGC=memory();}
at=performance.now();world.damage({id:'profile-pulse',epoch:world.epoch,target:{x:-45,y:-.5,z:43},weapon:'pulse',power:1,reward:false});result.directBlastMs=performance.now()-at;
let steps=0;at=performance.now();while(world.pending()&&steps<1200){world.step(1/60);steps++;}result.settle={cpuMs:performance.now()-at,steps,pending:world.pending(),aggregate:binding.aggregate(),storage:binding.diagnostics()};
result.afterBlast=memory();at=performance.now();const saved=world.getSnapshot();result.save={ms:performance.now()-at,bytes:JSON.stringify(saved).length};
world.suspend();result.left=memory();if(global.gc){global.gc();result.leftForcedGC=memory();}
console.log(JSON.stringify(result,null,2));
