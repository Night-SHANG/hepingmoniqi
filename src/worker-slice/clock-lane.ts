/** One control command in transit and one coalesced desired state, independent of gameplay credits. */
export class ClockLane<T>{
 private generation=0;private activeResolve:((value:T)=>void)|null=null;private active=false;private queued:{state:Record<string,unknown>;resolve:(value:T)=>void}|null=null;
 constructor(private transmit:(state:Record<string,unknown>)=>Promise<T>,private superseded:()=>T){}
 send(state:Record<string,unknown>):Promise<T>{return new Promise(resolve=>{if(this.active){const prior=this.queued;this.queued={state:{...prior?.state,...state},resolve};prior?.resolve(this.superseded());}else this.start(state,resolve);});}
 reset(){this.generation++;this.activeResolve?.(this.superseded());this.queued?.resolve(this.superseded());this.activeResolve=null;this.queued=null;this.active=false;}
 private start(state:Record<string,unknown>,resolve:(value:T)=>void){const generation=this.generation;this.active=true;this.activeResolve=resolve;void this.transmit(state).then(resolve,()=>resolve(this.superseded())).finally(()=>{if(generation!==this.generation)return;this.activeResolve=null;this.active=false;const next=this.queued;this.queued=null;if(next)this.start(next.state,next.resolve);});}
}
