/** Transport lifetime is separate from the exactly restorable authority epoch. */
export class LifecycleGeneration {private value=0;get current(){return this.value;}advance(){if(this.value>=Number.MAX_SAFE_INTEGER)throw new Error('Transport generation exhausted');return ++this.value;}accepts(value:unknown){return Number.isSafeInteger(value)&&value===this.value;}}
