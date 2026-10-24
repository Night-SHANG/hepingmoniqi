/** Bound gameplay before postMessage; transport acknowledgements cannot be starved by it. */
export class SenderCredit {
 private ids=new Set<string>();constructor(private capacity=16){}
 reserve(id:string,kind:string){if(kind==='pose-ack'||kind==='event-ack')return true;if(this.ids.size>=this.capacity)return false;this.ids.add(id);return true;}
 release(id:string){this.ids.delete(id);}clear(){this.ids.clear();}get size(){return this.ids.size;}
}
