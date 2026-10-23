/** Presentation flow never derives settlement from damage percentages. */
export function createExperimentFlow(){
 let state:'active'|'ending'|'settled'='active';
 return {requestFinish(){if(state==='active')state='ending';},settled(){if(state==='ending')state='settled';},reset(){state='active';},canAct:()=>state==='active',shouldSettle:(active:number,effects:boolean)=>state==='ending'&&active===0&&!effects,get state(){return state;}};
}
