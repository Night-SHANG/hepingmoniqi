import type {Point} from './types.js';
export const EFFECT_PROFILES={
 charge:{color:0xffb54a,flash:.08,fire:.35,smoke:2,ring:0,spread:1,lobes:3},
 pulse:{color:0xffdd85,flash:.1,fire:.4,smoke:2.5,ring:.12,spread:.8,lobes:2},
 shock:{color:0xffc67a,flash:.1,fire:.28,smoke:2,ring:.18,spread:.65,lobes:2},
 echo:{color:0x8cddff,flash:.06,fire:.12,smoke:1.8,ring:.65,spread:1.2,lobes:1},
 split:{color:0xffbd72,flash:.06,fire:.25,smoke:1.6,ring:.12,spread:.7,lobes:3},
 phase:{color:0xafe9ff,flash:.04,fire:.16,smoke:1,ring:.1,spread:.4,lobes:1},
 heavy:{color:0xffa64c,flash:.1,fire:.6,smoke:3.5,ring:.8,spread:1.6,lobes:5},
 nova:{color:0xffd891,flash:.12,fire:.9,smoke:5,ring:1.1,spread:2.4,lobes:7},
} as const;
export type EffectTool=keyof typeof EFFECT_PROFILES;
export interface EffectInput {id:string;epoch:number;position:Point;tool:EffectTool;scale?:number}
export interface EffectFrame extends EffectInput {age:number;flash:number;fire:number;smoke:number;ring:number}
/** Presentation only. No damage, physics, research, or settlement authority. */
export class EffectTimeline {
 private epoch=1;private active=new Map<string,EffectFrame>();private seen=new Set<string>();
 reset(epoch:number){this.epoch=epoch;this.active.clear();this.seen.clear();}
 add(e:EffectInput){if(e.epoch!==this.epoch||this.seen.has(e.id))return;this.seen.add(e.id);this.active.set(e.id,{...e,position:{...e.position},age:0,flash:1,fire:1,smoke:0,ring:0});}
 step(dt:number){if(!Number.isFinite(dt)||dt<=0)return;for(const [id,f] of this.active){f.age+=Math.min(1,dt);const p=EFFECT_PROFILES[f.tool];f.flash=Math.max(0,1-f.age/p.flash);f.fire=Math.max(0,1-f.age/p.fire);f.smoke=Math.max(0,Math.min(1,(f.age-.1)/.3))*Math.max(0,1-f.age/p.smoke);f.ring=p.ring?Math.max(0,1-f.age/p.ring):0;if(f.age>=p.smoke)this.active.delete(id);}}
 frames(){return [...this.active.values()].map(f=>({...f,position:{...f.position}}));}
}
