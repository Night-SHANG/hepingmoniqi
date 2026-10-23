import type {WeaponId,MapId} from './contracts';
export function toolAvailable(id:WeaponId,research:number,free:boolean):boolean{return free||id==='charge'||research>=(id==='pulse'?40:90);}
export function nextGoal(research:number,complete:boolean,map:MapId):string{
 if(complete)return map==='courtyard'?'双跨仓库已解锁 · 选择下一场实验':'两处建筑已完成 · 可重试或进入自由模式';
 if(research<40)return `下一工具：火箭弹 · ${research}/40 研究`;
 if(research<90)return `下一工具：遥控爆破包 · ${research}/90 研究`;
 return '下一目标：建筑拆除70% · 不用清理树木和围栏';
}
