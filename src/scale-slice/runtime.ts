import type {CompactFixture} from '../compact/fixture';
import {compileScaleFixture} from './fixture';
import {ScaleAuthority,type ScaleBlast} from './model';
import {createScaleDynamics} from './dynamics';
import {createScaleSurface} from './surface';
import {ScaleClock} from './clock';
/** One authority and one physics world. This slice does not install into old saves. */
export async function createScaleRuntime(source:CompactFixture){
 const start=performance.now(),fixture=compileScaleFixture(source),compileMs=performance.now()-start,model=new ScaleAuthority(fixture),physicsStart=performance.now(),dynamics=await createScaleDynamics(model),physicsCreateMs=performance.now()-physicsStart,surface=createScaleSurface(source,model),clock=new ScaleClock();let disposed=false;
 const assertLive=()=>{if(disposed)throw new Error('Scale runtime disposed');};
 return {source,fixture,model,dynamics,surface,clock,initialization:{compileMs,physicsCreateMs,totalMs:performance.now()-start},
  blast(command:ScaleBlast){assertLive();const at=performance.now(),transaction=model.blast(command),modelMs=performance.now()-at,syncAt=performance.now();if(transaction.accepted)dynamics.sync(transaction.changedRegionIds);return {transaction,modelMs,collisionSyncMs:performance.now()-syncAt,totalMs:performance.now()-at};},
  advance(elapsedMs:number,options:{paused?:boolean;hidden?:boolean}={}){assertLive();clock.admit(elapsedMs,options);if(options.paused||options.hidden)return 0;return clock.pump(dt=>dynamics.step(dt),8);},
  stats(){return {model:model.stats(),physics:dynamics.stats(),clock:clock.stats(),liveWorlds:disposed?0:1};},
  snapshot(){assertLive();return dynamics.snapshot();},
  restore(value:unknown){assertLive();const result=dynamics.restore(value as Parameters<typeof dynamics.restore>[0]);if(result)clock.reset();return result;},
  reset(){assertLive();dynamics.reset();clock.reset();},
  dispose(){if(disposed)return;dynamics.dispose();disposed=true;clock.reset();}
 };
}
export type ScaleRuntime=Awaited<ReturnType<typeof createScaleRuntime>>;
