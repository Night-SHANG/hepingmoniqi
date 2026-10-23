import type {WeaponId,MapId,Loadout,TriggerMode} from './contracts';
import {WEAPON_IDS,UNLOCKS,toolAvailable,capacityForResearch,weaponCost} from './content-catalog';
export {toolAvailable,mapAvailable,mapTitle,toolTitle,capacityForResearch,weaponCost,RESERVED_CAPACITY_TIERS} from './content-catalog';
export function nextGoal(research:number,_complete:boolean,_map:MapId):string {
 const next=UNLOCKS.find(([gate])=>research<gate);
 return next?`下一解锁：${next[1]} · ${research}/${next[0]} 研究`:'全部场地已解锁 · 继续实验或进入自由模式';
}
/** Accept exact, safe, nonempty inventories without spending permanent research. */
export function validateLoadout(loadout:Loadout,research:number):boolean{
 if(!Number.isSafeInteger(research)||research<0||!loadout||typeof loadout!=='object'||Array.isArray(loadout))return false;
 const ids=WEAPON_IDS;
 if(Object.keys(loadout).length!==ids.length||!ids.every(id=>Object.hasOwn(loadout,id)))return false;
 let used=0;
 for(const id of ids){
  const count=loadout[id];
  if(!Number.isSafeInteger(count)||count<0||count>0&&!toolAvailable(id,research,false))return false;
  used+=count*weaponCost(id);
 }
 return used>0&&used<=capacityForResearch(research);
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
