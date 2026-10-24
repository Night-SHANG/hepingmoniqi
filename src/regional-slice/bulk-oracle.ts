/** Diagnostic scalar oracle, not a production import. This intentionally uses
 * the existing CompactAuthorityStore and the existing damage/destroy sequence.
 * Scope stops before support removal, fracture, detach, impulses or contacts. */
import {CompactAuthorityStore} from '../compact/store.js';
import type {CompactFixture} from '../compact/fixture.js';
import type {BulkAggregate,BulkBlast,BulkRow} from './bulk.js';
export class ScalarBulkOracle {
 readonly store:CompactAuthorityStore;private losses=new Map<number,number>();private rewardedLoss=0;private creditedResearch=0;private shots=new Set<string>();
 constructor(readonly fixture:CompactFixture,initialRows:readonly BulkRow[]=[]){this.store=new CompactAuthorityStore(fixture);for(const row of initialRows){const c=this.store.writable(row.id)!;Object.assign(c,row);this.store.markChanged(row.id);if(fixture.objectiveOf(row.id))this.losses.set(row.id,row.state==='static'?Math.max(0,1-row.hp/fixture.maxHpOf(row.id)):1);}}
 read(id:number):BulkRow|undefined{const c=this.store.peek(id);return c?{id,hp:c.hp,loss:c.loss,state:c.state}:undefined;}
 blast(command:BulkBlast){
  const start=performance.now();if(command.epoch!==1||this.shots.has(command.id))return {accepted:false,changed:0,deleted:0,markChangedCalls:0,totalMs:performance.now()-start};this.shots.add(command.id);
  const at=performance.now(),ids=this.store.queryStaticSphere(command.center,command.radius).sort((a,b)=>this.fixture.ordinal(a)-this.fixture.ordinal(b)),queryMs=performance.now()-at;let changed=0,deleted=0,markChangedCalls=0;
  for(const id of ids){const existing=this.store.peek(id)!,distance=Math.hypot(existing.position.x-command.center.x,existing.position.y-command.center.y,existing.position.z-command.center.z),value=command.damage*(1-.65*distance/command.radius);if(existing.hp<=0||!Number.isFinite(value)||value<=0)continue;
   const c=this.store.writable(id)!,used=Math.min(c.hp,value);c.hp-=used;c.loss=Math.min(c.spec.hp,c.loss+used);this.store.markChanged(id);markChangedCalls++;
   if(c.hp<=1e-8){c.hp=0;c.state='gone';c.loss=c.spec.hp;delete c.chunkId;this.store.markChanged(id);markChangedCalls++;deleted++;}changed++;
   if(this.fixture.objectiveOf(id)){const before=this.losses.get(id)??0,next=c.state!=='static'?1:Math.max(0,1-c.hp/this.fixture.maxHpOf(id));this.losses.set(id,next);if(command.reward!==false)this.rewardedLoss+=Math.max(0,next-before);}
  }
  const next=this.fixture.objectiveCount?Math.min(200,Math.ceil(Math.max(0,this.rewardedLoss)*200/this.fixture.objectiveCount)):0;this.creditedResearch=Math.max(this.creditedResearch,next);
  return {accepted:true,changed,deleted,markChangedCalls,queryMs,totalMs:performance.now()-start};
 }
 aggregate():BulkAggregate{const a=this.store.aggregate();let canonical=0;for(const id of this.store.changedIds()){const c=this.store.peek(id)!;if(c.spec.role!=='terrain')canonical+=c.loss;}return {...a,rewardedLoss:this.rewardedLoss,creditedResearch:this.creditedResearch,research:this.creditedResearch,structuralResearch:a.totalHp?Math.min(200,Math.ceil(200*canonical/a.totalHp)):0};}
}
