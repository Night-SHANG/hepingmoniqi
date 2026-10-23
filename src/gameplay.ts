import type {WeaponId,MapId,Loadout,TriggerMode,RoundState} from './contracts';
import {WEAPON_IDS,UNLOCKS,toolAvailable,capacityForResearch,weaponCost} from './content-catalog';
export {toolAvailable,mapAvailable,mapTitle,toolTitle,capacityForResearch,weaponCost,RESERVED_CAPACITY_TIERS} from './content-catalog';
export function nextGoal(research:number,_complete:boolean,_map:MapId):string {
 const next=UNLOCKS.find(([gate])=>research<gate);
 return next?`下一解锁：${next[1]} · ${research}/${next[0]} 研究`:'全部场地已解锁 · 继续实验或进入自由模式';
}
export const MAX_SELECTED_TOOL_TYPES=3;
/** A selected kind occupies one slot regardless of its ammunition quantity. */
export function selectedToolTypes(loadout:Loadout):WeaponId[]{return WEAPON_IDS.filter(id=>loadout[id]>0);}
export function selectedToolTypeCount(loadout:Loadout):number{return selectedToolTypes(loadout).length;}
/** Slot eligibility only: callers separately enforce research and carrying cost. */
export function canSelectToolType(loadout:Loadout,weapon:WeaponId):boolean{
 return WEAPON_IDS.includes(weapon)&&(loadout[weapon]>0||selectedToolTypeCount(loadout)<MAX_SELECTED_TOOL_TYPES);
}
/** Use original allocations, not remaining ammo, so exhaustion cannot free a mid-round slot. */
export function requiresLoadoutReselection(round:Pick<RoundState,'loadout'>):boolean{
 return !!round.loadout&&selectedToolTypeCount(round.loadout)>MAX_SELECTED_TOOL_TYPES;
}
function validInventory(loadout:Loadout,research:number):boolean{
 if(!Number.isSafeInteger(research)||research<0||!loadout||typeof loadout!=='object'||Array.isArray(loadout))return false;
 const ids=WEAPON_IDS;
 if(Object.keys(loadout).length!==ids.length||!ids.every(id=>Object.hasOwn(loadout,id)))return false;
 let nonempty=false;
 for(const id of ids){
  const count=loadout[id];
  if(!Number.isSafeInteger(count)||count<0||count>0&&!toolAvailable(id,research,false))return false;
  nonempty ||= count>0;
 }
 return nonempty;
}
/** Free mode uses the same kind/unlock limits but no weighted ammunition cap. */
export function validateToolSelection(loadout:Loadout,research:number):boolean{
 return validInventory(loadout,research)&&selectedToolTypeCount(loadout)<=MAX_SELECTED_TOOL_TYPES;
}
/** Historical inventories may need reselection but must not be erased on restore. */
export function validateHistoricalLoadout(loadout:Loadout,research:number):boolean{
 return validInventory(loadout,research)&&WEAPON_IDS.reduce((sum,id)=>sum+loadout[id]*weaponCost(id),0)<=capacityForResearch(research);
}
/** Accept exact, safe, nonempty inventories without spending permanent research. */
export function validateLoadout(loadout:Loadout,research:number):boolean{
 return validateToolSelection(loadout,research)&&validateHistoricalLoadout(loadout,research);
}

export function crossedUnlocks(startResearch:number,endResearch:number):string[]{return UNLOCKS.filter(([gate])=>startResearch<gate&&endResearch>=gate).map(([,name])=>name);}
/** Placement always uses remote detonation; remote packages cannot be launched. */
export function deliveryPolicy(weapon:WeaponId,delivery:'quick'|'place',requestedTrigger:TriggerMode):{
 delivery:'quick'|'place';trigger:TriggerMode;canLaunch:boolean;canChooseTrigger:boolean;
}{
 const canLaunch=weapon!=='shock'&&weapon!=='echo';
 const effectiveDelivery=canLaunch?delivery:'place';
 const canChooseTrigger=effectiveDelivery==='quick';
 return {delivery:effectiveDelivery,trigger:canChooseTrigger?requestedTrigger:'remote',canLaunch,canChooseTrigger};
}
