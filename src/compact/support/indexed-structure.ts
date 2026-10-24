/*
 * Derived from three-voxel-destruction, src/structure.ts, at
 * 8c4b058866d78f161181fd1404aca76d9051457b.
 * Copyright (c) 2026 Steven Bobyn. MIT License, see ./LICENSE.
 * Adaptation: sparse unit lattice, cross-object faces, explicit anchors only,
 * internal fixed-state ownership, no per-storey overload or GPU dependencies.
 * Incremental compact spike: accessor-backed original metadata and occupancy only.
 * Seed ordering, face accounting, cut/leave/split/unsupported control flow retained.
 * Upstream source line provenance is in ./PROVENANCE.md; MIT notice in ./LICENSE.
 */

import { consumeValidatedPristine, type ValidatedPristine } from './pristine-core.js';

export interface IndexedLattice {
  readonly count:number;
  position(index:number):{x:number;y:number;z:number};
  material(index:number):string;
  objectId(index:number):string;
  anchor(index:number):boolean;
  /** ORIGINAL occupied neighbors in -x,+x,-y,+y,-z,+z order; never presence-filtered. */
  neighbours(index:number,fn:(neighbor:number,axis:number)=>void):void;
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
export class IndexedStructure {
  readonly chunk:Int32Array;
  readonly chunks:Chunk[]=[];
  private readonly present:Uint8Array;
  readonly setup={groupMs:0,cutMs:0,edgesMs:0,cutObjects:[] as {objectId:string,cells:number,ms:number}[]};
  private readonly damaged=new Set<number>();

  static fromPristine(source:IndexedLattice,token:ValidatedPristine):IndexedStructure {return new IndexedStructure(source,11,token);}

  constructor(private readonly source:IndexedLattice,seed=11,token?:ValidatedPristine) {
    if(token!==undefined){
      const t=consumeValidatedPristine(source,token);
      this.chunk=t.chunk;this.present=new Uint8Array(source.count).fill(1);
      for(let c=0;c<t.roots.length;c++){
        const edges=new Map<number,number>();
        for(let e=t.edgeOffsets[c];e<t.edgeOffsets[c+1];e++)edges.set(t.edgeDest[e],t.edgeFaces[e]);
        this.chunks.push({objectId:t.objectIds[t.objectIndex[c]],voxels:Array.from(t.members.subarray(t.memberOffsets[c],t.memberOffsets[c+1])),ground:t.roots[c],edges});
      }
      return;
    }
    this.chunk=new Int32Array(source.count).fill(-1);
    this.present=new Uint8Array(source.count).fill(1);
    let at=performance.now();
    const byObject=new Map<string,number[]>();
    // Source iteration is sorted public-ID order, exactly as the existing adapter.
    for(let i=0;i<source.count;i++) {
      const objectId=source.objectId(i),list=byObject.get(objectId);
      if(list)list.push(i);else byObject.set(objectId,[i]);
    }
    this.setup.groupMs=performance.now()-at;at=performance.now();
    const rnd=random(seed);
    for(const [objectId,list] of byObject) {
      const start=performance.now();this.cut(objectId,list,rnd);
      this.setup.cutObjects.push({objectId,cells:list.length,ms:performance.now()-start});
    }
    this.setup.cutMs=performance.now()-at;at=performance.now();
    // Same positive-axis face pass; original neighbors are computed on demand.
    for(let v=0;v<source.count;v++)source.neighbours(v,(u,a)=>{
      if(a%2===0||this.chunk[u]===this.chunk[v])return;
      bump(this.chunks[this.chunk[v]].edges,this.chunk[u],1);
      bump(this.chunks[this.chunk[u]].edges,this.chunk[v],1);
    });
    this.setup.edgesMs=performance.now()-at;
  }

  private holds(v:number):boolean {return this.source.anchor(v);}

  /** Port of Structure.cut: nearest same-material seed, then connected cell parts. */
  private cut(objectId:string,list:readonly number[],rnd:()=>number):void {
    const grid=new Map<string,number[]>();
    // String tuples replace upstream's bounded packed key; negatives never alias.
    const key=(m:string,gx:number,gy:number,gz:number):string=>`${m}|${gx},${gy},${gz}`;
    for(const v of list) {
      const {x,y,z}=this.source.position(v),m=this.source.material(v);
      const s=CELL[m]??6;
      const k=key(m,Math.floor(x/s),Math.floor(y/s),Math.floor(z/s));
      const bucket=grid.get(k);
      if(bucket)bucket.push(v);else grid.set(k,[v]);
    }
    const seeds=new Map<string,number>();
    for(const [k,bucket]of grid)seeds.set(k,bucket[Math.floor(rnd()*bucket.length)]);
    const prelim=new Map<number,number[]>();
    for(const bucket of grid.values())for(const v of bucket) {
      const {x,y,z}=this.source.position(v),m=this.source.material(v);
      const s=CELL[m]??6;
      const [gx,gy,gz]=[Math.floor(x/s),Math.floor(y/s),Math.floor(z/s)];
      let [best,bestD]=[-1,Infinity];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++) {
        const seed=seeds.get(key(m,gx+dx,gy+dy,gz+dz));
        if(seed===undefined)continue;
        const {x:sx,y:sy,z:sz}=this.source.position(seed);
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
    this.source.neighbours(v,fn);
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

  diagnostics(){return {cells:this.source.count,chunks:this.chunks.length,liveMembers:this.chunks.reduce((n,c)=>n+c.voxels.length,0),directedEdges:this.chunks.reduce((n,c)=>n+c.edges.size,0),typedBufferBytes:this.chunk.byteLength+this.present.byteLength,storedNeighborSlots:0,retainedVoxelRecords:0};}

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
