/*
 * Derived from three-voxel-destruction, src/structure.ts, at
 * 8c4b058866d78f161181fd1404aca76d9051457b.
 * Copyright (c) 2026 Steven Bobyn. MIT License, see ./LICENSE.
 * Adaptation: sparse unit lattice, cross-object faces, explicit anchors only,
 * internal fixed-state ownership, no per-storey overload or GPU dependencies.
 * See ../../THIRD-PARTY-DESTRUCTION.md for source sections and modifications.
 */

export interface LatticeVoxel {
  x:number; y:number; z:number;
  material:string;
  objectId:string;
  anchor:boolean;
}
export interface Chunk {
  objectId:string;
  /** Still-present fixed voxels, indexed into the adapter's immutable snapshot. */
  voxels:number[];
  /** Explicit anchor count. This is NOT inferred from height or object base. */
  ground:number;
  /** Number of still-present faces shared with each adjacent chunk. */
  edges:Map<number,number>;
}
export interface ChunkPiece { voxels:number[]; chunks:number[] }

// Upstream concrete/roof use 10, wall/wood/glass/steel use 6, leaves use 8.
// New soil/road/stone materials use the concrete value, at this adapter's unit scale.
const CELL:Readonly<Record<string,number>> = {soil:10,road:10,stone:10,roof:10,wood:6,glass:6,metal:6,foliage:8};
const bump = (edges:Map<number,number>,to:number,by:number):void => {
  const n=(edges.get(to)??0)+by;
  if(n>0)edges.set(to,n);
  else edges.delete(to);
};
const atKey = (x:number,y:number,z:number):string => `${x},${y},${z}`;
const OFFSETS = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]] as const;

/** Mulberry32; ported from upstream src/world.ts:85–95. */
export function random(seed:number):()=>number {
  let s=seed>>>0;
  return ()=>{
    s=(s+0x6d2b79f5)>>>0;
    let t=s;
    t=Math.imul(t^(t>>>15),t|1);
    t^=t+Math.imul(t^(t>>>7),t|61);
    return ((t^(t>>>14))>>>0)/2**32;
  };
}

/** Material-seeded chunk support graph, adapted from the pinned Structure class. */
export class SparseStructure {
  readonly chunk:Int32Array;
  readonly chunks:Chunk[]=[];
  private readonly present:Uint8Array;
  private readonly adjacent:Int32Array;
  private readonly damaged=new Set<number>();

  constructor(private readonly voxels:readonly LatticeVoxel[],seed=11) {
    this.chunk=new Int32Array(voxels.length).fill(-1);
    this.present=new Uint8Array(voxels.length).fill(1);
    this.adjacent=new Int32Array(voxels.length*6).fill(-1);
    const occupancy=new Map<string,number>();
    const byObject=new Map<string,number[]>();
    voxels.forEach((v,i)=>{
      occupancy.set(atKey(v.x,v.y,v.z),i);
      const list=byObject.get(v.objectId);
      if(list)list.push(i);else byObject.set(v.objectId,[i]);
    });
    // Sparse occupied positions only: no bounding-box fill and no synthetic ground.
    voxels.forEach((v,i)=>OFFSETS.forEach(([dx,dy,dz],a)=>{
      this.adjacent[i*6+a]=occupancy.get(atKey(v.x+dx,v.y+dy,v.z+dz))??-1;
    }));
    const rnd=random(seed);
    for(const [objectId,list] of byObject)this.cut(objectId,list,rnd);
    // Upstream constructor's face-counting pass, now across ALL objects/materials.
    for(let v=0;v<voxels.length;v++) {
      for(const a of [1,3,5]) { // +x, +y, +z: each shared face counted exactly once.
        const u=this.adjacent[v*6+a];
        if(u<0||this.chunk[u]===this.chunk[v])continue;
        bump(this.chunks[this.chunk[v]].edges,this.chunk[u],1);
        bump(this.chunks[this.chunk[u]].edges,this.chunk[v],1);
      }
    }
  }

  private holds(v:number):boolean {return this.voxels[v].anchor===true;}

  /** Port of Structure.cut: nearest same-material seed, then connected cell parts. */
  private cut(objectId:string,list:readonly number[],rnd:()=>number):void {
    const grid=new Map<string,number[]>();
    // String tuples replace upstream's bounded packed key; negatives never alias.
    const key=(m:string,gx:number,gy:number,gz:number):string=>`${m}|${gx},${gy},${gz}`;
    for(const v of list) {
      const {x,y,z,material:m}=this.voxels[v];
      const s=CELL[m]??6;
      const k=key(m,Math.floor(x/s),Math.floor(y/s),Math.floor(z/s));
      const bucket=grid.get(k);
      if(bucket)bucket.push(v);else grid.set(k,[v]);
    }
    const seeds=new Map<string,number>();
    for(const [k,bucket]of grid)seeds.set(k,bucket[Math.floor(rnd()*bucket.length)]);
    const prelim=new Map<number,number[]>();
    for(const bucket of grid.values())for(const v of bucket) {
      const {x,y,z,material:m}=this.voxels[v];
      const s=CELL[m]??6;
      const [gx,gy,gz]=[Math.floor(x/s),Math.floor(y/s),Math.floor(z/s)];
      let [best,bestD]=[-1,Infinity];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++) {
        const seed=seeds.get(key(m,gx+dx,gy+dy,gz+dz));
        if(seed===undefined)continue;
        const {x:sx,y:sy,z:sz}=this.voxels[seed];
        const d=(sx-x)**2+(sy-y)**2+(sz-z)**2;
        if(d<bestD)[best,bestD]=[seed,d];
      }
      const group=prelim.get(best);
      if(group)group.push(v);else prelim.set(best,[v]);
    }
    // A chunk per connected part of each seed cell, exactly as in upstream cut.
    const mark=new Map<number,number>();
    for(const [seed,group]of prelim)for(const v of group)mark.set(v,seed);
    const seen=new Set<number>();
    for(const group of prelim.values())for(const start of group) {
      if(seen.has(start))continue;
      const id=this.chunks.length;
      const part=[start];seen.add(start);
      for(let n=0;n<part.length;n++)this.neighbours(part[n],u=>{
        if(!seen.has(u)&&mark.has(u)&&mark.get(u)===mark.get(start)) {
          seen.add(u);part.push(u);
        }
      });
      let ground=0;
      for(const v of part) {this.chunk[v]=id;if(this.holds(v))ground++;}
      this.chunks.push({objectId,voxels:part,ground,edges:new Map()});
    }
  }

  private neighbours(v:number,fn:(u:number)=>void):void {
    for(let a=0;a<6;a++){const u=this.adjacent[v*6+a];if(u>=0)fn(u);}
  }

  /** Port of Structure.leave, owning present state so repeated removal is safe. */
  leave(voxels:readonly number[]):void {
    const done=new Set<number>();
    for(const v of voxels) {
      if(this.present[v]!==1||done.has(v))continue;
      done.add(v);
      const id=this.chunk[v];
      const ch=this.chunks[id];
      if(this.holds(v))ch.ground--;
      this.neighbours(v,u=>{
        if(this.present[u]!==1||done.has(u))return;
        const other=this.chunk[u];
        if(other===id)return;
        bump(ch.edges,other,-1);
        bump(this.chunks[other].edges,id,-1);
      });
      this.damaged.add(id);
    }
    for(const v of done)this.present[v]=0;
    for(const id of this.damaged)this.split(id,done);
    this.damaged.clear();
  }

  /** Port of Structure.split: retain largest part, move other parts and face counts. */
  private split(id:number,gone:Set<number>):void {
    const ch=this.chunks[id];
    const live=ch.voxels.filter(v=>this.present[v]===1&&!gone.has(v));
    const seen=new Set<number>();
    const parts:number[][]=[];
    for(const start of live) {
      if(seen.has(start))continue;
      const part=[start];seen.add(start);
      for(let n=0;n<part.length;n++)this.neighbours(part[n],u=>{
        if(!seen.has(u)&&this.chunk[u]===id&&this.present[u]===1&&!gone.has(u)) {
          seen.add(u);part.push(u);
        }
      });
      parts.push(part);
    }
    parts.sort((x,y)=>y.length-x.length);
    ch.voxels=parts[0]??[];
    ch.ground=ch.voxels.filter(v=>this.holds(v)).length;
    for(const part of parts.slice(1)) {
      const nid=this.chunks.length;
      const nc:Chunk={objectId:ch.objectId,voxels:part,ground:0,edges:new Map()};
      this.chunks.push(nc);
      for(const v of part)this.chunk[v]=nid;
      for(const v of part) {
        if(this.holds(v))nc.ground++;
        // Parts share no face; outside fixed neighbours are in other chunks.
        this.neighbours(v,u=>{
          if(this.present[u]!==1||gone.has(u))return;
          const o=this.chunk[u];if(o===nid)return;
          bump(ch.edges,o,-1);
          bump(this.chunks[o].edges,id,-1);
          bump(nc.edges,o,1);
          bump(this.chunks[o].edges,nid,1);
        });
      }
    }
  }

  /** Port of Structure.unsupported, with global roots/edges instead of per-building. */
  unsupported():ChunkPiece[] {
    const reached=new Set<number>();
    const queue:number[]=[];
    for(let id=0;id<this.chunks.length;id++) {
      const ch=this.chunks[id];
      if(ch.ground>0&&ch.voxels.length>0){reached.add(id);queue.push(id);}
    }
    const flood=(set:Set<number>,from:number[],ok:(id:number)=>boolean):void=>{
      for(let n=0;n<from.length;n++)for(const [o,faces]of this.chunks[from[n]].edges) {
        if(faces>0&&!set.has(o)&&ok(o)){set.add(o);from.push(o);}
      }
    };
    flood(reached,queue,()=>true);
    const pieces:ChunkPiece[]=[];
    const taken=new Set<number>();
    for(let id=0;id<this.chunks.length;id++) {
      if(reached.has(id)||taken.has(id)||this.chunks[id].voxels.length===0)continue;
      const chunks=[id];taken.add(id);
      flood(taken,chunks,o=>!reached.has(o));
      pieces.push({chunks,voxels:chunks.flatMap(c=>this.chunks[c].voxels)});
    }
    return pieces;
  }
}
