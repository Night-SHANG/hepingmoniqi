/** Bounded work scheduling, not time deletion. Hidden/paused intervals are
 * accounted separately; foreground solver backlog remains observable. */
export class ScaleClock {
 private requestedMs=0;private processedMs=0;private discardedMs=0;private peakDebtMs=0;private hiddenMs=0;private pausedMs=0;private steps=0;
 readonly stepSeconds=1/120;
 admit(ms:number,options:{paused?:boolean;hidden?:boolean}={}){if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid elapsed time');if(options.hidden)this.hiddenMs+=ms;else if(options.paused)this.pausedMs+=ms;else this.requestedMs+=ms;this.peakDebtMs=Math.max(this.peakDebtMs,this.stats().debtMs);}
 pump(step:(dt:number)=>void,maxSteps=8){if(!Number.isSafeInteger(maxSteps)||maxSteps<1)throw new RangeError('Invalid pump bound');let n=0;while(n<maxSteps&&this.stats().debtMs+1e-7>=this.stepSeconds*1000){step(this.stepSeconds);this.processedMs+=this.stepSeconds*1000;this.steps++;n++;}return n;}
 reset(){this.discardedMs+=this.stats().debtMs;}
 stats(){return {requestedMs:this.requestedMs,processedMs:this.processedMs,discardedMs:this.discardedMs,debtMs:Math.max(0,this.requestedMs-this.processedMs-this.discardedMs),peakDebtMs:this.peakDebtMs,hiddenMs:this.hiddenMs,pausedMs:this.pausedMs,steps:this.steps};}
}
