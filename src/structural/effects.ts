import type {Matter, Point} from './types.js';

/** Seconds and world-space proportions, authored independently for each tool. */
export const EFFECT_PROFILES = {
 charge: {color:0xffa442,flash:.065,fire:.34,smoke:2.1,ring:0,spread:1,lobes:8,smokeLobes:26,fragments:18,fragmentLife:1.3,shape:'burst'},
 pulse: {color:0xffbc64,flash:.07,fire:.42,smoke:2.5,ring:.15,spread:.95,lobes:10,smokeLobes:30,fragments:22,fragmentLife:1.6,shape:'jet'},
 shock: {color:0xffb95b,flash:.06,fire:.27,smoke:2.1,ring:.23,spread:1.15,lobes:7,smokeLobes:30,fragments:24,fragmentLife:1.3,shape:'disk'},
 echo: {color:0xf3d4a2,flash:.035,fire:.13,smoke:1.9,ring:.42,spread:1.25,lobes:4,smokeLobes:26,fragments:12,fragmentLife:1.1,shape:'ripple'},
 split: {color:0xffa94d,flash:.05,fire:.3,smoke:1.8,ring:.12,spread:.8,lobes:9,smokeLobes:27,fragments:18,fragmentLife:1.4,shape:'split'},
 phase: {color:0xd8d4b1,flash:.03,fire:.16,smoke:1.35,ring:.09,spread:.55,lobes:5,smokeLobes:18,fragments:10,fragmentLife:.9,shape:'needle'},
 heavy: {color:0xff9638,flash:.085,fire:.61,smoke:3.6,ring:.28,spread:1.7,lobes:14,smokeLobes:46,fragments:32,fragmentLife:2,shape:'column'},
 nova: {color:0xffb44b,flash:.095,fire:.86,smoke:5,ring:.34,spread:2.5,lobes:18,smokeLobes:66,fragments:40,fragmentLife:2.3,shape:'mushroom'},
} as const;
export type EffectTool = keyof typeof EFFECT_PROFILES;
export type EffectProfile = typeof EFFECT_PROFILES[EffectTool];
export interface EffectInput {
 id:string;
 epoch:number;
 position:Point;
 tool?:EffectTool;
 kind?:'detonation'|'impact';
 /** Physical blast radius for detonation; local puff size for impact. */
 scale?:number;
 material?:Matter;
 /** Cosmetic impact intensity only. Never damage or research. */
 intensity?:number;
}
export interface EffectFrame extends EffectInput {
 tool:EffectTool;
 kind:'detonation'|'impact';
 age:number;
 flash:number;
 fire:number;
 smoke:number;
 ring:number;
}
const clamp01 = (value:number) => Math.max(0, Math.min(1, value));
export function effectSmokeDuration(frame:EffectInput):number {
 return frame.kind === 'impact' ? 1.4 + .6 * (frame.intensity ?? .5) : EFFECT_PROFILES[frame.tool ?? 'charge'].smoke;
}
/** Only a short primary blast envelope, never its smoke/fragment aftermath. */
export function effectCoreDuration(frame:EffectInput):number {
 if (frame.kind === 'impact') return 0;
 const profile = EFFECT_PROFILES[frame.tool ?? 'charge'];
 return Math.max(profile.flash, profile.fire, profile.ring);
}
function sample(frame:EffectFrame):void {
 const p = EFFECT_PROFILES[frame.tool], impact = frame.kind === 'impact';
 frame.flash = impact ? 0 : clamp01(1 - frame.age / p.flash);
 frame.fire = impact ? 0 : clamp01(1 - frame.age / p.fire);
 const rise = impact ? .09 : .2, delay = impact ? 0 : .045;
 frame.smoke = clamp01((frame.age - delay) / rise) * clamp01(1 - frame.age / effectSmokeDuration(frame));
 frame.ring = impact || !p.ring ? 0 : clamp01(1 - frame.age / p.ring);
}
/** Presentation only. No damage, physics, research, or settlement authority.
 * The caller supplies simulation time (already paused/slowed), never wall time.
 */
export class EffectTimeline {
 private epoch = 1;
 private active = new Map<string,EffectFrame>();
 private seen = new Set<string>();
 get activeCount():number { return this.active.size; }
 reset(epoch:number):void { this.epoch = epoch; this.clear(); this.seen.clear(); }
 /** Clear visuals without replaying authoritative events already seen this epoch. */
 clear():void { this.active.clear(); }
 add(input:EffectInput):void {
  if (input.epoch !== this.epoch || this.seen.has(input.id)) return;
  if (![input.position.x,input.position.y,input.position.z].every(Number.isFinite)) return;
  this.seen.add(input.id);
  const frame:EffectFrame = {...input,position:{...input.position},tool:input.tool ?? 'charge',kind:input.kind ?? 'detonation',age:0,flash:0,fire:0,smoke:0,ring:0};
  if (input.scale !== undefined) frame.scale = Number.isFinite(input.scale) ? Math.max(.05,Math.min(128,input.scale)) : 1;
  if (input.intensity !== undefined) frame.intensity = Number.isFinite(input.intensity) ? clamp01(input.intensity) : .5;
  sample(frame);this.active.set(input.id,frame);
 }
 step(dt:number):void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  for (const [id,frame] of this.active) {
   frame.age += dt;sample(frame);
   if (frame.age >= effectSmokeDuration(frame)) this.active.delete(id);
  }
 }
 hasActiveCore():boolean { return [...this.active.values()].some(frame=>frame.age < effectCoreDuration(frame)); }
 frames():EffectFrame[] { return [...this.active.values()].map(frame=>({...frame,position:{...frame.position}})); }
}
