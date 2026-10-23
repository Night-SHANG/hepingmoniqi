/*
 * Derived from three-voxel-destruction src/destruction.ts:90–117 at
 * 8c4b058866d78f161181fd1404aca76d9051457b.
 * Copyright (c) 2026 Steven Bobyn. MIT License, see ./LICENSE.
 * Adaptation: sparse snapshot coordinates; injected random source, empty guard,
 * bounded seed count. Connected/material-safe output splitting is in support.ts.
 */
import type { LatticeVoxel } from './structure.js';

/** Port of fragments: 75% distance-weighted seeds, then nearest-seed assignment. */
export function fragments(
  voxels:readonly LatticeVoxel[],at:readonly [number,number,number],mean:number,
  rnd:()=>number,falloff=2,reach=4,
):Map<number,number> {
  const n=voxels.length;
  if(n===0)return new Map();
  const count=Math.min(n,Math.max(1,Math.round(n/mean)));
  const dist=voxels.map(p=>Math.hypot(p.x-at[0],p.y-at[1],p.z-at[2]));
  const weight=dist.map(d=>(1+d/reach)**(-2*falloff));
  const total=weight.reduce((a,b)=>a+b,0);
  const seeds:number[]=[];
  for(let k=0;k<count;k++) {
    let pick=Math.floor(rnd()*n);
    if(k<count*.75) {
      let r=rnd()*total;
      for(pick=0;pick<n-1&&(r-=weight[pick])>0;pick++);
    }
    seeds.push(pick);
  }
  const of=new Map<number,number>();
  for(let v=0;v<n;v++) {
    let [best,bestD]=[0,Infinity];
    for(let k=0;k<seeds.length;k++) {
      const s=voxels[seeds[k]],p=voxels[v];
      const d=(p.x-s.x)**2+(p.y-s.y)**2+(p.z-s.z)**2;
      if(d<bestD)[best,bestD]=[k,d];
    }
    of.set(v,best);
  }
  return of;
}
