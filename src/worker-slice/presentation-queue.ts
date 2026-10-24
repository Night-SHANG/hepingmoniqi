/** Complete mesh replacements only. Never use this latest-wins queue for damage/events. */
export interface PresentationHeader {epoch:number;key:string;chunkRevision:number;authorityRevision:number}
export class PresentationQueue<T>{
 private epoch=0;private pending=new Map<string,{header:PresentationHeader;payload:T;bytes:number}>();private installed=new Map<string,PresentationHeader>();private bytes=0;
 constructor(private acknowledge:(header:PresentationHeader)=>void,private maxBytes=16*1024*1024){}
 reset(epoch:number){for(const row of this.pending.values())this.acknowledge(row.header);this.pending.clear();this.installed.clear();this.bytes=0;this.epoch=epoch;}
 enqueue(header:PresentationHeader,payload:T,bytes:number){
  if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(header.chunkRevision)||header.chunkRevision<1||!Number.isSafeInteger(header.authorityRevision)||header.authorityRevision<0||typeof header.key!=='string')throw new Error('Malformed mesh header');
  const old=this.pending.get(header.key),current=this.installed.get(header.key);
  if(header.epoch!==this.epoch||header.chunkRevision<=(old?.header.chunkRevision??current?.chunkRevision??0)||header.authorityRevision<(old?.header.authorityRevision??current?.authorityRevision??0)){this.acknowledge(header);return false;}
  if(this.bytes-(old?.bytes??0)+bytes>this.maxBytes)throw new Error('Mesh credit exceeded');
  if(old){this.pending.delete(header.key);this.bytes-=old.bytes;this.acknowledge(old.header);}
  this.pending.set(header.key,{header:{...header},payload,bytes});this.bytes+=bytes;return true;
 }
 drain(install:(payload:T,header:PresentationHeader)=>void,budgetMs=4,now=()=>performance.now()){
  const start=now();let installed=0;
  for(const [key,row]of this.pending){if(installed&&now()-start>=budgetMs)break;install(row.payload,row.header);this.pending.delete(key);this.bytes-=row.bytes;this.installed.set(key,row.header);this.acknowledge(row.header);installed++;}
  const elapsedMs=now()-start;return{installed,elapsedMs,overBudgetMs:Math.max(0,elapsedMs-budgetMs)};
 }
 diagnostics(){return{epoch:this.epoch,pending:this.pending.size,bytes:this.bytes,applied:[...this.installed.values()].map(h=>({...h}))};}
}
