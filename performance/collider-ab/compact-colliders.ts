// THROWAWAY ground-only adapter. Not imported by the game.
// The caller owns and steps its existing single Rapier World.
import RAPIER from '@dimforge/rapier3d-compat';
import { CompactTerrain, type Bounds } from '../terrain/compact-terrain.ts';
import {chunkKey,packStaticCells} from '../../src/structural/static-packing.ts';
import type {Point} from '../../src/structural/types.ts';

export interface CollisionRegion {handle:number;chunkKey:string;min:Point;max:Point}
interface ChunkRegion {key:string;bounds:Bounds;handles:number[]}
/** Geometry membership replaces retained cellIds arrays and cell-to-collider Maps.
 * Pristine construction uses O(chunks) boxes, not O(cells) objects or scans.
 * Edited regions alone temporarily materialize <=512 cells for the SAME packer.
 * Caller must flush after topology edits and before its normal world step/queries.
 */
export class CompactGroundColliders {
  private readonly chunks=new Map<string,ChunkRegion>();
  private readonly boxes=new Map<number,CollisionRegion>();
  private readonly dirty=new Set<string>();
  private temporaryCells=0;
  private peakTemporaryCells=0;
  private repackedChunks=0;
  readonly bounds:Bounds;
  constructor(readonly world:RAPIER.World,readonly terrain:CompactTerrain,bounds:Bounds){
    this.bounds={minX:bounds.minX,maxX:bounds.maxX,minZ:bounds.minZ,maxZ:bounds.maxZ};
    if(terrain.diagnostics().changedCells!==0)throw new Error('This bounded proof requires pristine construction; restore needs original-position and dirty-chunk provider APIs');
    for(let x=Math.floor(bounds.minX/8);x<=Math.floor(bounds.maxX/8);x++)for(let z=Math.floor(bounds.minZ/8);z<=Math.floor(bounds.maxZ/8);z++){
      const key=`${x},-1,${z}`,region={minX:Math.max(bounds.minX,x*8),maxX:Math.min(bounds.maxX,x*8+7),minZ:Math.max(bounds.minZ,z*8),maxZ:Math.min(bounds.maxZ,z*8+7)};
      const chunk:ChunkRegion={key,bounds:region,handles:[]};this.chunks.set(key,chunk);
      this.add(chunk,{x:region.minX,y:-8,z:region.minZ},{x:region.maxX,y:-1,z:region.maxZ});
    }
  }
  private add(chunk:ChunkRegion,min:Point,max:Point){
    const half={x:(max.x-min.x+1)/2,y:(max.y-min.y+1)/2,z:(max.z-min.z+1)/2},center={x:(max.x+min.x)/2,y:(max.y+min.y)/2,z:(max.z+min.z)/2};
    const collider=this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x,half.y,half.z).setTranslation(center.x,center.y,center.z).setFriction(.85).setRestitution(.02).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS|RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0));
    this.boxes.set(collider.handle,{handle:collider.handle,chunkKey:chunk.key,min,max});chunk.handles.push(collider.handle);
  }
  damageAt(p:Point,amount:number){
    const id=this.terrain.staticAt(p.x,p.y,p.z);if(id===null)return 0;
    const used=this.terrain.damage(id,amount);if(this.terrain.staticAt(p.x,p.y,p.z)===null)this.markDirty(p);return used;
  }
  /** p is the ORIGINAL lattice coordinate, never a current dynamic/rubble pose. */
  markDirty(p:Point){if(this.terrain.idAt(p.x,p.y,p.z)!==null)this.dirty.add(chunkKey(p));}
  flush(){
    for(const key of this.dirty){
      const chunk=this.chunks.get(key);if(!chunk)throw new Error('Dirty coordinate outside collision descriptor');
      const cells=this.terrain.staticCellsInBounds(chunk.bounds);
      this.temporaryCells+=cells.length;this.peakTemporaryCells=Math.max(this.peakTemporaryCells,cells.length);
      const packed=packStaticCells(cells);
      for(const handle of chunk.handles){this.world.removeCollider(this.world.getCollider(handle),true);this.boxes.delete(handle);}
      chunk.handles=[];
      for(const box of packed)this.add(chunk,
        {x:box.center.x-box.half.x+.5,y:box.center.y-box.half.y+.5,z:box.center.z-box.half.z+.5},
        {x:box.center.x+box.half.x-.5,y:box.center.y+box.half.y-.5,z:box.center.z+box.half.z-.5});
      // packed.cellIds and bounded cells become unreachable; retain only geometry.
      this.repackedChunks++;
    }
    this.dirty.clear();
  }
  resolve(handle:number,point:Point):number|null{
    const region=this.boxes.get(handle);if(!region||![point.x,point.y,point.z].every(Number.isFinite))return null;
    // A true face contact may lie exactly between lattice centers. Restrict it
    // to this hit region, then consult live authority rather than stale geometry.
    for(const axis of ['x','y','z'] as const)if(point[axis]<region.min[axis]-.5001||point[axis]>region.max[axis]+.5001)return null;
    const axis=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,Math.round(v)));
    return this.terrain.staticAt(axis(point.x,region.min.x,region.max.x),axis(point.y,region.min.y,region.max.y),axis(point.z,region.min.z,region.max.z));
  }
  regions():readonly CollisionRegion[]{return [...this.boxes.values()];}
  diagnostics(){return {chunkCount:this.chunks.size,colliderCount:this.boxes.size,temporaryCells:this.temporaryCells,peakTemporaryCells:this.peakTemporaryCells,retainedCellIds:0,dirtyChunks:this.dirty.size,repackedChunks:this.repackedChunks};}
}
