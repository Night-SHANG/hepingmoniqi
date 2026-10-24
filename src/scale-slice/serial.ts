/** Accepted jobs remain FIFO and are never coalesced/dropped. Capacity rejection
 * occurs before admission. Transport ACKs do not consume mutation slots. */
export class SerialCommands {
 private tail:Promise<unknown>=Promise.resolve();private count=0;
 constructor(readonly capacity=16){if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid capacity');}
 get size(){return this.count;}
 run<T>(job:()=>Promise<T>):Promise<T>{if(this.count>=this.capacity)return Promise.reject(new Error('command capacity'));this.count++;const next=this.tail.then(job);const result=next.finally(()=>this.count--);this.tail=result.catch(()=>undefined);return result;}
}
