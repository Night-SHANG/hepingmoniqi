/** Bounded diagnostic attribution only; wrappers preserve native call semantics. */
export function instrumentRenderCalls(target:object,names:readonly string[],now:()=>number,phase:()=>string,limit=4096){
 const calls:Record<string,{count:number;totalMs:number;maxMs:number}>={},rows:{method:string;phase:string;at:number;ms:number}[]=[],restore:(()=>void)[]=[];let dropped=0;
 for(const name of names){const object=target as Record<string,unknown>,original=object[name];if(typeof original!=='function')continue;const wrapped=function(this:unknown,...args:unknown[]){const at=now();try{return original.apply(this,args);}finally{const ms=now()-at,c=calls[name]??(calls[name]={count:0,totalMs:0,maxMs:0});c.count++;c.totalMs+=ms;c.maxMs=Math.max(c.maxMs,ms);if(ms>=1){if(rows.length<limit)rows.push({method:name,phase:phase(),at,ms});else dropped++;}}};object[name]=wrapped;restore.push(()=>{if(object[name]===wrapped)object[name]=original;});}
 return{snapshot:()=>({calls:structuredClone(calls),rows:rows.map(r=>({...r})),dropped}),dispose:()=>{for(const fn of restore.splice(0))fn();}};
}
