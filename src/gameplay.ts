import type {WeaponId,MapId} from './contracts';
/** Free experiments use saved main research; they never bypass weapon locks. */
export function toolAvailable(id:WeaponId,research:number,_free:boolean):boolean{return id==='charge'||research>=(id==='pulse'?40:90);}
export function nextGoal(research:number,_complete:boolean,map:MapId):string{
 if(research<40)return `下一工具：火箭弹 · ${research}/40 研究`;
 if(research<90)return `下一工具：遥控爆破包 · ${research}/90 研究`;
 if(research<120)return `下一场地：双跨仓库 · ${research}/120 研究`;
 return map==='courtyard'?'双跨仓库已解锁 · 随时选择下一场实验':'继续实验 · 可重试或进入自由模式';
}
