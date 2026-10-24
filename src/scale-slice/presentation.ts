import type { ScaleAuthority } from './model.js';
import type { Point, Rotation } from '../structural/types.js';
import type { ScaleBox } from './fixture.js';

export interface ScalePresentationOptions {nearDistance?:number;farDistance?:number}
export interface ScalePresentedBox {position:Point;halfExtents:Point;rotation:Rotation;color:number}
export interface ScaleRegionPresentation {regionId:string;detail:'fine'|'coarse';state:'static'|'dynamic'|'rubble';hp:number;maxHp:number;damageFraction:number;occupiedCellCount:number;boxes:ScalePresentedBox[]}
const rotate=(p:Point,q:Rotation):Point=>{const tx=2*(q.y*p.z-q.z*p.y),ty=2*(q.z*p.x-q.x*p.z),tz=2*(q.x*p.y-q.y*p.x);return {x:p.x+q.w*tx+q.y*tz-q.z*ty,y:p.y+q.w*ty+q.z*tx-q.x*tz,z:p.z+q.w*tz+q.x*ty-q.y*tx};};

/** Camera selects only how the same occupied boxes are drawn. There is no
 * independent fine HP, synthetic crack geometry, or pristine-mask rebuild. */
export function createScalePresentation(authority:ScaleAuthority,options:ScalePresentationOptions={}){
 const nearDistance=options.nearDistance??18,farDistance=options.farDistance??24;
 if(!Number.isFinite(nearDistance)||!Number.isFinite(farDistance)||nearDistance<0||farDistance<=nearDistance)throw new RangeError('Invalid detail hysteresis');
 const selected=new Map<string,'fine'|'coarse'>();
 // Cache only the requested immutable original-space expansions. Pose and HP
 // are read afresh; topology changes invalidate by the active box identity.
 const geometry=new Map<string,{source:readonly ScaleBox[];fine:ScaleBox[]}>();
 let epoch=authority.epoch;
 function reset(){selected.clear();geometry.clear();epoch=authority.epoch;}
 function region(id:string,camera:Point):ScaleRegionPresentation|undefined{
  if(epoch!==authority.epoch)reset();
  const r=authority.region(id);if(!r||r.state==='gone'){selected.delete(id);geometry.delete(id);return undefined;}
  const distance=Math.hypot(r.position.x-camera.x,r.position.y-camera.y,r.position.z-camera.z),prior=selected.get(id);
  const detail=prior==='fine'?(distance>farDistance?'coarse':'fine'):(distance<nearDistance?'fine':'coarse');selected.set(id,detail);
  const source=authority.activeBoxes(id);
  let boxes:readonly ScaleBox[]=source;
  if(detail==='fine'){
   let cached=geometry.get(id);
   if(!cached||cached.source!==source){
    const fine:ScaleBox[]=[];
    for(const box of source){const {center:c,halfExtents:h}=box;for(let y=c.y-h.y+.5;y<c.y+h.y;y++)for(let z=c.z-h.z+.5;z<c.z+h.z;z++)for(let x=c.x-h.x+.5;x<c.x+h.x;x++)fine.push({center:{x,y,z},halfExtents:{x:.5,y:.5,z:.5}});}
    cached={source,fine};geometry.set(id,cached);
   }
   boxes=cached.fine;
  }else geometry.delete(id);
  const color=authority.fixture.regions[r.index].color;
  return {regionId:id,detail,state:r.state,hp:r.hp,maxHp:r.maxHp,damageFraction:1-r.hp/r.maxHp,occupiedCellCount:r.aliveCellCount,boxes:boxes.map(box=>{
   const offset=rotate({x:box.center.x-r.center.x,y:box.center.y-r.center.y,z:box.center.z-r.center.z},r.rotation);
   return {position:{x:r.position.x+offset.x,y:r.position.y+offset.y,z:r.position.z+offset.z},halfExtents:{...box.halfExtents},rotation:{...r.rotation},color};
  })};
 }
 return {region,frame(camera:Point,ids?:readonly string[]){return (ids??authority.fixture.regions.map(r=>r.id)).flatMap(id=>{const result=region(id,camera);return result?[result]:[];});},reset,stats(){return {retainedRegions:selected.size,fineCachedRegions:geometry.size,cachedFineBoxes:[...geometry.values()].reduce((n,g)=>n+g.fine.length,0)};}};
}
export type ScalePresentation=ReturnType<typeof createScalePresentation>;
