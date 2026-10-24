/** Bounded read-only diagnostic evidence. Does not advance or alter simulation. */
export interface ActionTimingRecord {kind:string;at:number;id?:string;epoch?:number;weapon?:string;delivery?:string;trigger?:string;reason?:string;simulationAge?:number;accepted?:boolean}
export function createActionTiming(limit=64){
 const records:ActionTimingRecord[]=[];
 return {add(kind:string,record:Omit<ActionTimingRecord,'kind'>){if(!Number.isFinite(record.at))return;records.push({...record,kind});if(records.length>limit)records.splice(0,records.length-limit);},read:()=>records.map(r=>({...r}))};
}
