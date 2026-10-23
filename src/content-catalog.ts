import type {WeaponId,MapId} from './contracts';
/** The only progression source of truth. All numbers are fictional game units. */
export const WEAPON_IDS:readonly WeaponId[]=Object.freeze(['charge','pulse','shock','echo','split','phase','heavy','nova']);
export const MAP_IDS:readonly MapId[]=Object.freeze(['courtyard','warehouse','bridge','tower','cantilever','neighborhood','city']);
export const TOOLS=Object.freeze({
 charge:Object.freeze({id:'charge',name:'手榴弹',title:'手榴弹',cost:1,research:0,radius:2.6,strength:8}),
 pulse:Object.freeze({id:'pulse',name:'火箭弹',title:'火箭弹',cost:2,research:40,radius:3.5,strength:9}),
 shock:Object.freeze({id:'shock',name:'遥控爆破包',title:'遥控爆破包',cost:2,research:90,radius:5.4,strength:11}),
 echo:Object.freeze({id:'echo',name:'回声震荡器',title:'回声震荡器',cost:3,research:240,radius:2.8,strength:7}),
 phase:Object.freeze({id:'phase',name:'穿行球',title:'穿行球',cost:3,research:620,radius:2.1,strength:6}),
 heavy:Object.freeze({id:'heavy',name:'街区冲击弹',title:'街区冲击弹',cost:3,research:900,radius:16,strength:14}),
 nova:Object.freeze({id:'nova',name:'城市核爆弹',title:'城市核爆弹',cost:5,research:1400,radius:48,strength:20}),
 split:Object.freeze({id:'split',name:'分裂球',title:'分裂球',cost:3,research:420,radius:2,strength:6}),
});
export const MAPS=Object.freeze({
 courtyard:Object.freeze({id:'courtyard',name:'木屋庭院',title:'木屋拆除',research:0}),
 warehouse:Object.freeze({id:'warehouse',name:'双跨仓库',title:'双跨仓库拆除',research:120}),
 bridge:Object.freeze({id:'bridge',name:'高架连廊',title:'高架连廊拆除',research:240}),
 cantilever:Object.freeze({id:'cantilever',name:'悬臂观景台',title:'悬臂观景台拆除',research:620}),
 neighborhood:Object.freeze({id:'neighborhood',name:'九栋街区',title:'九栋街区拆除',research:900}),
 city:Object.freeze({id:'city',name:'六区城市',title:'六区城市拆除',research:1400}),
 tower:Object.freeze({id:'tower',name:'叠层塔楼',title:'叠层塔楼拆除',research:420}),
});
export const CAPACITY_TIERS:readonly Readonly<{research:number;capacity:number}>[]=Object.freeze([{research:0,capacity:6},{research:120,capacity:8},{research:420,capacity:10}].map(tier=>Object.freeze(tier)));
export const RESERVED_CAPACITY_TIERS=Object.freeze([12] as const);
export function toolAvailable(id:WeaponId,research:number,_free=false):boolean{return Object.hasOwn(TOOLS,id)&&Number.isFinite(research)&&research>=TOOLS[id].research;}
export function mapAvailable(id:MapId,research:number,free=false):boolean{return Object.hasOwn(MAPS,id)&&Number.isFinite(research)&&(free||research>=MAPS[id].research);}
export function weaponCost(id:WeaponId):number{return TOOLS[id]?.cost??NaN;}
export function capacityForResearch(research:number):number{return research>=420?10:research>=120?8:6;}
export function mapTitle(id:MapId):string{return MAPS[id].title;}
export function toolTitle(id:WeaponId):string{return TOOLS[id].title;}
export const UNLOCKS:ReadonlyArray<readonly [number,string]>=Object.freeze([
 [40,TOOLS.pulse.name],[90,TOOLS.shock.name],[120,MAPS.warehouse.name],[120,'携带容量 6 → 8 格'],
 [240,TOOLS.echo.name],[240,MAPS.bridge.name],[420,TOOLS.split.name],[420,MAPS.tower.name],[420,'携带容量 8 → 10 格'],[620,TOOLS.phase.name],[620,MAPS.cantilever.name],
 [900,TOOLS.heavy.name],[900,MAPS.neighborhood.name],[1400,TOOLS.nova.name],[1400,MAPS.city.name],
]);
