import type {WeaponId,MapId,Loadout} from './contracts';
/** Free experiments use saved main research; they never bypass weapon locks. */
export function toolAvailable(id:WeaponId,research:number,_free:boolean):boolean{return id==='charge'||research>=(id==='pulse'?40:90);}
export function nextGoal(research:number,_complete:boolean,map:MapId):string{
 if(research<40)return `下一工具：火箭弹 · ${research}/40 研究`;
 if(research<90)return `下一工具：遥控爆破包 · ${research}/90 研究`;
 if(research<120)return `下一场地：双跨仓库 · ${research}/120 研究`;
 return map==='courtyard'?'双跨仓库已解锁 · 随时选择下一场实验':'继续实验 · 可重试或进入自由模式';
}

/** Later capacity tiers are reserved metadata, not progression reachable today. */
export const RESERVED_CAPACITY_TIERS = Object.freeze([10,12] as const);
export function capacityForResearch(research:number):number{return research>=120?8:6;}
export function weaponCost(id:WeaponId):number{return id==='charge'?1:2;}
/** Accept exact, safe, nonempty inventories without spending permanent research. */
export function validateLoadout(loadout:Loadout,research:number):boolean{
 if(!Number.isSafeInteger(research)||research<0||!loadout||typeof loadout!=='object'||Array.isArray(loadout))return false;
 const ids:WeaponId[]=['charge','pulse','shock'];
 if(Object.keys(loadout).length!==ids.length||!ids.every(id=>Object.hasOwn(loadout,id)))return false;
 let used=0;
 for(const id of ids){
  const count=loadout[id];
  if(!Number.isSafeInteger(count)||count<0||count>0&&!toolAvailable(id,research,false))return false;
  used+=count*weaponCost(id);
 }
 return used>0&&used<=capacityForResearch(research);
}
