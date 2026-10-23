import {createProjectilePhysics} from '../physics.js';
import {TOOLS} from '../content-catalog.js';
import type {Detonation} from '../contracts.js';
import type {StructuralSimulation} from './types.js';
import type {StructuralPhysicsHost} from './physics-host.js';
/** Isolated integration adapter. Existing progression and UI are deliberately untouched.
 * The shared host is the sole clock. Manual events enter the same deduplicated
 * domain route as collision/fuse events; VFX callbacks cannot create damage.
 * Callback delivery is exclusive: step() advances but returns no duplicate events.
 * Call either this adapter step() or the host clock, never both in one frame.
 */
export async function createStructuralOrdnance(world:StructuralSimulation & {physicsHost:StructuralPhysicsHost},onEffect?:(event:Detonation)=>void){
 function apply(event:Detonation){
  const tool=TOOLS[event.weapon];
  if(world.blast({id:event.id,epoch:event.epoch,position:event.position,radius:tool.radius*Math.sqrt(event.power),damage:tool.strength*event.power,impulse:Math.min(16,tool.strength*.6*Math.sqrt(event.power))}))onEffect?.(structuredClone(event));
 }
 const physics=await createProjectilePhysics({host:world.physicsHost,onDetonation:apply});
 return {...physics,detonateAttached(){const events=physics.detonateAttached();events.forEach(apply);return events;}};
}
